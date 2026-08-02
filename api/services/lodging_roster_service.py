"""Assembles the per-weekend lodging roster.

Two grains, one surface. Family camp enrols only children, so accompanying
adults come from family_camp_adults and a party is a HOUSEHOLD. Adult
weekends enrol individuals directly, so a party is a PERSON. That mirrors
lodging_assignments' dual grain exactly.

PHI: this service reads family_camp_medical to derive BOOLEANS from the
presence of a value. The narrative text is returned only by
get_household_medical, behind Permission.LODGING_PHI at the router.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, cast

from api.schemas.lodging import (
    PHI_FIELD_NAMES,
    AccessibilityFlagSummary,
    HouseholdMedicalResponse,
    LodgingUnitSummary,
    PartyAdult,
    PartyChild,
    ProximityKind,
    RosterCounts,
    RosterParty,
    ShareEligibility,
    ShareEligibilitySource,
    SharePreference,
    ShareRequestSummary,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSessionSummary,
    WeekendSummaryEntry,
    WeekendSummaryResponse,
)
from api.services.lodging_rules import (
    effective_bathroom,
    is_family_available,
    unit_capacity,
)
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository

logger = get_logger(__name__)

# family_camp_registrations.share_cabin_gate values, which are the Go ingest's.
# An empty column means nobody answered; it renders as "unknown" and is never
# coerced into permission to pair.
_GATE_VALUES: frozenset[str] = frozenset({"no_share", "maybe_mutual", "yes_share"})
# "unknown" / "none" are deliberately absent: they are what an unrecognised or
# empty column FALLS BACK to, so accepting them here would be redundant and
# would hide a value drifting out of the migration's select list.
_ELIGIBILITY_VALUES: frozenset[str] = frozenset({"open", "named", "declined"})
_ELIGIBILITY_SOURCE_VALUES: frozenset[str] = frozenset({"form", "registration"})


class SessionNotFoundError(LookupError):
    """No family/adult session matches the requested (year, cm_id)."""


def _s(record: Any, field: str, default: str = "") -> str:
    value = getattr(record, field, default)
    return default if value is None else str(value)


def _i(record: Any, field: str, default: int = 0) -> int:
    value = getattr(record, field, default)
    try:
        return int(value)
    except TypeError, ValueError:
        return default


def _b(record: Any, field: str) -> bool:
    return bool(getattr(record, field, False))


def _f(record: Any, field: str) -> float | None:
    value = getattr(record, field, None)
    try:
        return None if value is None else float(value)
    except TypeError, ValueError:
        return None


def _person_display_name(person: Any) -> str:
    preferred = _s(person, "preferred_name")
    first = preferred or _s(person, "first_name")
    last = _s(person, "last_name")
    return f"{first} {last}".strip()


def _household_display_name(household: Any, fallback_cm_id: int) -> str:
    for field in ("mailing_title", "greeting"):
        value = _s(household, field)
        if value:
            return value
    return f"Household {fallback_cm_id}"


class LodgingRosterService:
    """Builds the read-only weekend roster from repository output."""

    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def list_sessions(self, year: int) -> WeekendSessionListResponse:
        rows = await self.repository.fetch_weekend_sessions(year)
        return WeekendSessionListResponse(
            year=year,
            sessions=[self._session_summary(row) for row in rows],
        )

    @staticmethod
    def _session_summary(row: Any) -> WeekendSessionSummary:
        """One weekend's identity. Shared so the lander and the session list
        can never describe the same weekend differently."""
        return WeekendSessionSummary(
            session_id=_s(row, "id"),
            session_cm_id=_i(row, "cm_id"),
            name=_s(row, "name"),
            session_type=_s(row, "session_type"),
            start_date=_s(row, "start_date"),
            end_date=_s(row, "end_date"),
            sort_order=_i(row, "sort_order"),
        )

    async def build_roster(self, year: int, session_cm_id: int, scenario: str = "") -> WeekendRosterResponse:
        """One weekend's roster, optionally resolved through a scenario.

        No scenario is the CampMinder mirror -- the synced rows, exactly as
        before this layer existed, and read-only for everyone. A scenario
        OVERLAYS its draft rows on top of that base, per party and per unit,
        which is what lets a freshly-created scenario render the synced
        placements instead of an empty board.
        """
        session = await self.repository.fetch_session(year, session_cm_id)
        if session is None:
            raise SessionNotFoundError(f"No weekend session {session_cm_id} in {year}")

        session_pb_id = _s(session, "id")
        session_type = _s(session, "session_type")

        # TaskGroup rather than asyncio.gather: typeshed only types gather
        # precisely up to six awaitables, and beyond that every result widens to
        # `object`, which would need eleven casts to use. Tasks keep their own
        # types and still run concurrently.
        #
        # There is no raw custom-value fetch here. The share gate, the NEAR/WITH
        # modes and the request text all arrive as derived columns on the
        # registration row -- already collapsed to household grain, already
        # carrying the normaliser fixes this layer cannot see.
        async with asyncio.TaskGroup() as tg:
            units_task = tg.create_task(self.repository.fetch_units())
            availability_task = tg.create_task(self.repository.fetch_availability(year, session_pb_id))
            assignments_task = tg.create_task(self.repository.fetch_assignments(year, session_pb_id))
            attendees_task = tg.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            medical_task = tg.create_task(self.repository.fetch_family_camp_medical(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases())
            unconfirmed_task = tg.create_task(self.repository.count_unconfirmed_units())
            # The scenario layer joins the SAME group rather than running after
            # it: production mode must cost exactly what it did before, and
            # scenario mode must not cost a second round trip.
            draft_task = (
                tg.create_task(self.repository.fetch_draft_assignments(year, session_pb_id, scenario))
                if scenario
                else None
            )
            scenario_availability_task = (
                tg.create_task(self.repository.fetch_scenario_availability(year, session_pb_id, scenario))
                if scenario
                else None
            )

        unit_summaries = self._build_units(
            units_task.result(),
            availability_task.result(),
            scenario_availability_task.result() if scenario_availability_task is not None else [],
        )
        parties = self._build_parties(
            session_type=session_type,
            attendees=attendees_task.result(),
            households=households_task.result(),
            prior_cm_ids=prior_task.result(),
            adults_by_household=adults_task.result(),
            registrations=registrations_task.result(),
            medical=medical_task.result(),
            assignments=assignments_task.result(),
            draft_assignments=draft_task.result() if draft_task is not None else [],
        )
        counts = self._build_counts(unit_summaries, parties, aliases_task.result(), unconfirmed_task.result())

        return WeekendRosterResponse(
            year=year,
            session_cm_id=session_cm_id,
            session_name=_s(session, "name"),
            session_type=session_type,
            parties=parties,
            units=unit_summaries,
            counts=counts,
        )

    async def build_summary(self, year: int, scenario: str = "") -> WeekendSummaryResponse:
        """Every weekend in the year with its counts, in one pass.

        `build_roster` makes eleven fetches, of which EIGHT are year-scoped --
        the unit registry, households, the prior-household set, family-camp
        adults, registrations, medical, and two registry counts are identical
        for every weekend in the year. Calling it once per weekend to fill the
        lander repeats all eight N times, which is why a weekend with zero
        parties still costs about three seconds.

        So the year-scoped work happens once here, and only the genuinely
        session-scoped reads run per weekend: availability, assignments and
        attendees always, plus the scenario's draft placements and its
        availability overrides when a scenario is named. The per-weekend
        numbers then come from the SAME `_build_units` / `_build_parties` /
        `_build_counts` helpers the roster uses, so the lander cannot drift
        from the page it links to.

        Scenario mode therefore costs five session-scoped reads per weekend
        rather than three, and nothing caps the resulting fan-out. That is
        deliberate for now -- there is no lander calling this with a scenario
        yet, so there is nothing to measure against -- and kindred#1920 records
        the two ways to bound it when there is.
        """
        sessions = await self.repository.fetch_weekend_sessions(year)
        if not sessions:
            return WeekendSummaryResponse(year=year, weekends=[])

        async with asyncio.TaskGroup() as tg:
            units_task = tg.create_task(self.repository.fetch_units())
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            medical_task = tg.create_task(self.repository.fetch_family_camp_medical(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases())
            unconfirmed_task = tg.create_task(self.repository.count_unconfirmed_units())

        units = units_task.result()
        households = households_task.result()
        prior_cm_ids = prior_task.result()
        adults_by_household = adults_task.result()
        registrations = registrations_task.result()
        medical = medical_task.result()
        unresolved_aliases = aliases_task.result()
        unconfirmed_units = unconfirmed_task.result()

        async def _entry(session: Any) -> WeekendSummaryEntry:
            session_pb_id = _s(session, "id")
            async with asyncio.TaskGroup() as inner:
                availability_task = inner.create_task(self.repository.fetch_availability(year, session_pb_id))
                assignments_task = inner.create_task(self.repository.fetch_assignments(year, session_pb_id))
                attendees_task = inner.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
                draft_task = (
                    inner.create_task(self.repository.fetch_draft_assignments(year, session_pb_id, scenario))
                    if scenario
                    else None
                )
                scenario_availability_task = (
                    inner.create_task(self.repository.fetch_scenario_availability(year, session_pb_id, scenario))
                    if scenario
                    else None
                )

            unit_summaries = self._build_units(
                units,
                availability_task.result(),
                scenario_availability_task.result() if scenario_availability_task is not None else [],
            )
            parties = self._build_parties(
                session_type=_s(session, "session_type"),
                attendees=attendees_task.result(),
                households=households,
                prior_cm_ids=prior_cm_ids,
                adults_by_household=adults_by_household,
                registrations=registrations,
                medical=medical,
                assignments=assignments_task.result(),
                draft_assignments=draft_task.result() if draft_task is not None else [],
            )
            return WeekendSummaryEntry(
                session=self._session_summary(session),
                counts=self._build_counts(unit_summaries, parties, unresolved_aliases, unconfirmed_units),
            )

        async with asyncio.TaskGroup() as tg:
            entry_tasks = [tg.create_task(_entry(session)) for session in sessions]

        return WeekendSummaryResponse(year=year, weekends=[task.result() for task in entry_tasks])

    async def get_household_medical(self, year: int, household_cm_id: int) -> HouseholdMedicalResponse:
        """PHI. The router gates this on Permission.LODGING_PHI.

        Two narrow reads, deliberately sequential: the household resolves the
        PB id that the medical read is anchored to. The whole-year maps this
        used to scan would put every family's narrative in memory to answer
        one -- a PHI-surface problem before it is a performance one.
        """
        household = await self.repository.fetch_household_by_cm_id(year, household_cm_id)
        household_pb_id = _s(household, "id") if household is not None else ""
        record = await self.repository.fetch_medical_for_household(year, household_pb_id)
        if record is None:
            return HouseholdMedicalResponse(household_cm_id=household_cm_id, year=year)
        return HouseholdMedicalResponse(
            household_cm_id=household_cm_id,
            year=year,
            **{field: _s(record, field) for field in sorted(PHI_FIELD_NAMES)},
        )

    # ---------------------------------------------------------------- units

    def _build_units(
        self,
        units: list[Any],
        availability: list[Any],
        scenario_availability: list[Any] | None = None,
    ) -> list[LodgingUnitSummary]:
        # Live rows first, then the scenario's on top: reserving one cabin
        # inside a scenario must not discard every live reservation, and a
        # scenario row for the same unit must win.
        override_by_unit = {_s(row, "unit"): _s(row, "state") for row in availability}
        for row in scenario_availability or []:
            override_by_unit[_s(row, "unit")] = _s(row, "state")

        # Bathroom groups are computed across ALL units, because a group's
        # membership does not depend on the session.
        group_members: dict[str, set[str]] = {}
        for unit in units:
            group = _s(unit, "bathroom_group")
            if group:
                group_members.setdefault(group, set()).add(_s(unit, "code"))

        summaries: list[LodgingUnitSummary] = []
        for unit in units:
            code = _s(unit, "code")
            group = _s(unit, "bathroom_group")
            area = (getattr(unit, "expand", None) or {}).get("area")
            allocation_default = _s(unit, "allocation_default")
            override = override_by_unit.get(_s(unit, "id"))
            summaries.append(
                LodgingUnitSummary(
                    unit_id=_s(unit, "id"),
                    code=code,
                    name=_s(unit, "name"),
                    area_code=_s(area, "code") if area is not None else "",
                    area_name=_s(area, "name") if area is not None else "",
                    sleeps=unit_capacity(_i(unit, "sleeps")),
                    # The units INVENTORY is not merge-aware in slice 1, so a
                    # unit is evaluated as its own one-element slot. (Merges do
                    # reach the roster elsewhere -- an assignment to a merge
                    # sets RosterParty.is_merged_slot -- so the gap is here,
                    # not on the surface as a whole.) When the board ships,
                    # pass the merge's member codes here instead.
                    bathroom=cast(
                        Any,
                        effective_bathroom(
                            _s(unit, "bathroom"),
                            group,
                            frozenset(group_members.get(group, set())),
                            frozenset({code}),
                        ),
                    ),
                    bathroom_group=group,
                    near_bathhouse=_b(unit, "near_bathhouse"),
                    has_power=_b(unit, "has_power"),
                    has_ac=_b(unit, "has_ac"),
                    has_fridge=_b(unit, "has_fridge"),
                    is_accessible=_b(unit, "is_accessible"),
                    is_confirmed=_b(unit, "is_confirmed"),
                    is_active=_b(unit, "is_active"),
                    is_container=_b(unit, "is_container"),
                    allocation_default=allocation_default,
                    reservation_state=override,
                    is_family_available=is_family_available(allocation_default, override),
                    map_x=_f(unit, "map_x"),
                    map_y=_f(unit, "map_y"),
                )
            )
        return summaries

    # -------------------------------------------------------------- parties

    def _build_parties(
        self,
        *,
        session_type: str,
        attendees: list[Any],
        households: dict[str, Any],
        prior_cm_ids: set[int],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        medical: dict[str, Any],
        assignments: list[Any],
        draft_assignments: list[Any] | None = None,
    ) -> list[RosterParty]:
        placement_by_household, placement_by_person = self._index_assignments(assignments)
        self._overlay_draft_assignments(placement_by_household, placement_by_person, draft_assignments or [])

        if session_type == "adult":
            return self._build_person_parties(attendees, placement_by_person)

        return self._build_household_parties(
            attendees=attendees,
            households=households,
            prior_cm_ids=prior_cm_ids,
            adults_by_household=adults_by_household,
            registrations=registrations,
            medical=medical,
            placement_by_household=placement_by_household,
        )

    @staticmethod
    def _placement_of(row: Any) -> tuple[str, str, bool] | None:
        """(unit_code, display_name, is_merged_slot) for a row, or None.

        None means the row names NO target. On a synced row that is an orphan
        -- the unit was deleted out from under it, which the DB allows -- and
        on a DRAFT row it is the deliberate "staff took this party off the
        board" tombstone. Both read the same here; what differs is how the
        caller treats it, which is why this returns None rather than skipping.

        `merge_draft` is checked before `merge`: a board-built slot is the more
        specific answer when a row somehow carries both. The schema enforces no
        XOR between the three, exactly as it does not on the truth table.
        """
        expand = getattr(row, "expand", None) or {}
        merge_draft = expand.get("merge_draft")
        if merge_draft is not None and _s(row, "merge_draft"):
            return "", _s(merge_draft, "display_name"), True
        merge = expand.get("merge")
        if merge is not None and _s(row, "merge"):
            return "", _s(merge, "display_name"), True
        unit = expand.get("unit")
        if unit is not None and _s(row, "unit"):
            return _s(unit, "code"), _s(unit, "name"), False
        return None

    @staticmethod
    def _grain_key(row: Any) -> tuple[str, int] | None:
        """("person" | "household", cm_id), or None for a row with neither.

        A person row OVERRIDES its household's, which is the dual grain the
        assignment tables were built around: family camp places households,
        adult weekends place people, and a grandparent housed apart from their
        family is a household row plus one person override.
        """
        person_cm_id = _i(row, "person_cm_id")
        if person_cm_id > 0:
            return "person", person_cm_id
        household_cm_id = _i(row, "household_cm_id")
        if household_cm_id > 0:
            return "household", household_cm_id
        return None

    def _index_assignments(
        self, assignments: list[Any]
    ) -> tuple[dict[int, tuple[str, str, bool]], dict[int, tuple[str, str, bool]]]:
        """Map cm_id -> (unit_code, display_name, is_merged_slot)."""
        by_household: dict[int, tuple[str, str, bool]] = {}
        by_person: dict[int, tuple[str, str, bool]] = {}
        for row in assignments:
            placement = self._placement_of(row)
            if placement is None:
                continue
            grain = self._grain_key(row)
            if grain is None:
                continue
            if grain[0] == "person":
                by_person[grain[1]] = placement
            else:
                by_household[grain[1]] = placement
        return by_household, by_person

    def _overlay_draft_assignments(
        self,
        by_household: dict[int, tuple[str, str, bool]],
        by_person: dict[int, tuple[str, str, bool]],
        drafts: list[Any],
    ) -> None:
        """Apply one scenario's draft rows over the synced placements, in place.

        PER PARTY, not all-or-nothing. A scenario that has moved one family
        must leave the other sixty-one showing what CampMinder says, or
        selecting a scenario would read as "everyone is suddenly unplaced".

        A draft row with no target REMOVES the synced placement rather than
        being ignored. That distinction is the whole reason the overlay cannot
        be a dict update: "staff dragged this family off the board" and "this
        family has no draft row" are different states, and only the second one
        should fall through to the CampMinder mirror.
        """
        for row in drafts:
            grain = self._grain_key(row)
            if grain is None:
                continue
            target = by_person if grain[0] == "person" else by_household
            placement = self._placement_of(row)
            if placement is None:
                target.pop(grain[1], None)
            else:
                target[grain[1]] = placement

    def _build_person_parties(
        self, attendees: list[Any], placement_by_person: dict[int, tuple[str, str, bool]]
    ) -> list[RosterParty]:
        parties: list[RosterParty] = []
        for attendee in attendees:
            person = (getattr(attendee, "expand", None) or {}).get("person")
            if person is None:
                continue
            person_cm_id = _i(person, "cm_id") or _i(attendee, "person_id")
            unit_code, unit_name, is_merged = placement_by_person.get(person_cm_id, ("", "", False))
            parties.append(
                RosterParty(
                    grain="person",
                    person_cm_id=person_cm_id,
                    display_name=_person_display_name(person),
                    adults=[PartyAdult(adult_number=1, display_name=_person_display_name(person))],
                    party_size=1,
                    unit_code=unit_code,
                    unit_name=unit_name,
                    is_merged_slot=is_merged,
                )
            )
        parties.sort(key=lambda p: p.display_name)
        return parties

    def _build_household_parties(
        self,
        *,
        attendees: list[Any],
        households: dict[str, Any],
        prior_cm_ids: set[int],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        medical: dict[str, Any],
        placement_by_household: dict[int, tuple[str, str, bool]],
    ) -> list[RosterParty]:
        children_by_household: dict[str, list[Any]] = {}
        for attendee in attendees:
            person = (getattr(attendee, "expand", None) or {}).get("person")
            if person is None:
                continue
            household_pb_id = _s(person, "household")
            if not household_pb_id:
                continue
            children_by_household.setdefault(household_pb_id, []).append(person)

        parties: list[RosterParty] = []
        for household_pb_id, children in children_by_household.items():
            household = households.get(household_pb_id)
            household_cm_id = _i(household, "cm_id") if household is not None else 0
            registration = registrations.get(household_pb_id)
            medical_record = medical.get(household_pb_id)
            adults = adults_by_household.get(household_pb_id, [])
            unit_code, unit_name, is_merged = placement_by_household.get(household_cm_id, ("", "", False))

            parties.append(
                RosterParty(
                    grain="household",
                    household_cm_id=household_cm_id,
                    display_name=_household_display_name(household, household_cm_id),
                    adults=[
                        PartyAdult(
                            adult_number=_i(adult, "adult_number"),
                            display_name=_s(adult, "name")
                            or f"{_s(adult, 'first_name')} {_s(adult, 'last_name')}".strip(),
                            relationship=_s(adult, "relationship_to_camper"),
                        )
                        for adult in adults
                    ],
                    children=[
                        PartyChild(
                            person_cm_id=_i(child, "cm_id"),
                            display_name=_person_display_name(child),
                            age=_i(child, "age") or None,
                            grade=_i(child, "grade") or None,
                        )
                        for child in sorted(children, key=lambda c: -_i(c, "age"))
                    ],
                    party_size=len(adults) + len(children),
                    unit_code=unit_code,
                    unit_name=unit_name,
                    is_merged_slot=is_merged,
                    arrival_eta=_s(registration, "arrival_eta") if registration is not None else "",
                    is_returning=household_cm_id in prior_cm_ids,
                    share=self._build_share(registration),
                    flags=self._build_flags(registration, medical_record),
                )
            )
        parties.sort(key=lambda p: p.display_name)
        return parties

    def _build_share(self, registration: Any) -> ShareRequestSummary:
        """Read the ingest-derived request layer. Do NOT re-parse it here.

        Every field below has a raw counterpart still on the row
        (share_cabin_preference, shared_cabin_modes_raw) kept for provenance,
        and re-deriving from those is the trap this method exists to avoid:

        * The gate normaliser requires the sentence to mention sharing before a
          leading "no" reads as a decline, because the modes field's own
          "No requests" option -- 209 rows across 2025-2026 -- otherwise parses
          as a hard no and silently strips the household's pairing eligibility.
        * NEAR and WITH are tested independently, not as ordered arms, so an
          option naming more than one sets both.
        * request_text is already deduplicated across siblings (the source
          fields are person-partition) and joined across three source fields.

        One writer, one reader. If a value looks wrong, fix it in the ingest
        layer so every surface sees the correction.
        """
        if registration is None:
            return ShareRequestSummary()

        gate = _s(registration, "share_cabin_gate")
        # An unrecognised or empty value is "unknown", never a default of open.
        preference: SharePreference = cast(SharePreference, gate if gate in _GATE_VALUES else "unknown")

        # Stable order, and similar_ages always follows the "with" it refines
        # rather than replacing it -- anything filtering on "with" must still
        # match these households.
        proximity: list[ProximityKind] = []
        if _b(registration, "wants_near"):
            proximity.append("near")
        if _b(registration, "wants_with"):
            proximity.append("with")
        if _b(registration, "wants_similar_ages"):
            proximity.append("similar_ages")

        request_text = _s(registration, "request_text")

        # Read, never re-derived. The two share questions are resolved once, in
        # the Go ingest, for the same reason `preference` is: doing it here
        # would fork a rule that has already been wrong twice. An unpopulated
        # column falls to "unknown"/"none", which places as no-share -- the
        # safe direction, and the honest one on a database whose
        # family_camp_derived has not re-run.
        raw_eligibility = _s(registration, "share_eligibility")
        eligibility = cast(
            ShareEligibility,
            raw_eligibility if raw_eligibility in _ELIGIBILITY_VALUES else "unknown",
        )
        raw_source = _s(registration, "share_eligibility_source")
        eligibility_source = cast(
            ShareEligibilitySource,
            raw_source if raw_source in _ELIGIBILITY_SOURCE_VALUES else "none",
        )

        return ShareRequestSummary(
            preference=preference,
            preference_raw=_s(registration, "share_cabin_preference"),
            proximity=proximity,
            request_text=request_text,
            # Slice 1 resolves no names, so any free text is outstanding work.
            needs_resolution=bool(request_text),
            eligibility=eligibility,
            eligibility_source=eligibility_source,
            answers_conflict=_b(registration, "share_answers_conflict"),
        )

    def _build_flags(self, registration: Any, medical_record: Any) -> AccessibilityFlagSummary:
        """Read the derived flags. Do NOT re-derive them here.

        This method used to compute all three from raw sources, which was
        correct only while the columns did not exist. Phase C of the ingest
        plan writes them, and its rules are not reproducible from what this
        service can see:

        * `needs_power` came from `bool(cpap_info)`. The CPAP fields are
          multi-option selects, and 75 answers say the need is *"not CPAP
          related"* -- narrative presence reads those as power (kindred#1875).
        * `needs_private_bathroom` came from `FAM CAMP-bathroom` alone, so it
          missed `Adult-Bathroom` and those same 75 bathroom answers.
        * `accommodation_is_mandatory` came from `not opt_out_vip`, which is
          OR'd across household members and inverts on conflict
          (kindred#1874).

        One writer, one reader. If a flag looks wrong, fix it in the ingest
        layer so every surface sees the correction.
        """
        has_narrative = medical_record is not None and any(_s(medical_record, field) for field in PHI_FIELD_NAMES)
        if registration is None:
            return AccessibilityFlagSummary(has_medical_narrative=has_narrative)
        return AccessibilityFlagSummary(
            needs_private_bathroom=_b(registration, "needs_private_bathroom"),
            needs_power=_b(registration, "needs_power"),
            needs_accommodation=_b(registration, "needs_accommodation"),
            accommodation_is_mandatory=_b(registration, "accommodation_is_mandatory"),
            has_infant=_b(registration, "has_infant"),
            has_medical_narrative=has_narrative,
        )

    # --------------------------------------------------------------- counts

    def _build_counts(
        self,
        units: list[LodgingUnitSummary],
        parties: list[RosterParty],
        unresolved_aliases: int,
        unconfirmed_units: int,
    ) -> RosterCounts:
        # Containers are building/grouping rows carrying whole-building
        # aggregates. Including them double-counts beds (408 vs a true 389).
        bookable = [u for u in units if not u.is_container and u.is_active]
        available = [u for u in bookable if u.is_family_available]
        assigned = sum(1 for p in parties if p.unit_code or p.unit_name)
        return RosterCounts(
            parties_total=len(parties),
            parties_assigned=assigned,
            parties_unassigned=len(parties) - assigned,
            units_total=len(bookable),
            units_family_available=len(available),
            units_reserved=len(bookable) - len(available),
            beds_family_available=sum(u.sleeps for u in available if u.sleeps is not None),
            units_capacity_unknown=sum(1 for u in bookable if u.sleeps is None),
            units_unconfirmed=unconfirmed_units,
            units_missing_allocation=sum(1 for u in bookable if not u.allocation_default),
            unresolved_aliases=unresolved_aliases,
        )

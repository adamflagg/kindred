"""Assembles the per-weekend lodging roster.

Two grains, one surface. Family camp enrols only children, so accompanying
adults come from family_camp_adults and a party is a HOUSEHOLD. Adult
weekends enrol individuals directly, so a party is a PERSON. That mirrors
lodging_assignments' dual grain exactly.

PHI: the roster and summary reads do not touch family_camp_medical at all.
They used to, to derive a boolean from the presence of a value -- see
`_build_flags` for why that boolean is gone (kindred#1889). The narrative has
one reader, get_household_medical, which fetches ONE household behind
Permission.LODGING_PHI at the router.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, NamedTuple, cast

from api.schemas.lodging import (
    PHI_FIELD_NAMES,
    AccessibilityFlagSummary,
    EffectiveBathroom,
    HouseholdMedicalResponse,
    LodgingUnitSummary,
    PartyAdult,
    PartyChild,
    ProximityKind,
    RosterCounts,
    RosterParty,
    Shareability,
    ShareEligibility,
    ShareEligibilitySource,
    SharePreference,
    ShareRequestSummary,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSessionStatus,
    WeekendSessionSummary,
    WeekendSummaryEntry,
    WeekendSummaryResponse,
)
from api.services.lodging_rules import (
    container_bathroom,
    effective_bathroom,
    is_family_available,
    unit_capacity,
    unit_shareability,
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

# kindred#1920: `build_summary` opens a `TaskGroup` per weekend and each one
# opens four `to_thread` reads of its own, so an uncapped year is 4x its
# weekend count in concurrent reads against one executor -- 48 for 2026's 12
# weekends, 72 for 2024's 18. The default `to_thread` pool is
# `min(32, cpu+4)`, so 8 concurrent weekends (32 reads) keeps the fan-out
# from ever queuing behind itself.
SUMMARY_ENTRY_CONCURRENCY = 8


class SessionNotFoundError(LookupError):
    """No family/adult session matches the requested (year, cm_id)."""


class _Placement(NamedTuple):
    """A row's resolved target(s) -- the RosterParty placement fields.

    unit_code/unit_name/is_merged_slot are the exact triple `_placement_of`
    returned before kindred#1931's map-view follow-up added unit_codes: the
    response shape a `lodging_merges` row used to produce, preserved so the
    board needs no changes. unit_codes adds every leaf code the party
    occupies, in the same order unit_name's label was built from, for a
    caller (the map view) that needs to know WHICH units a merged party
    spans, not just how many.

    A plain 3-tuple was the return type before this, and still type-checks
    and still unpacks as a 3-tuple -- the trap is a fallback default left at
    the old shape, which only breaks on `.unit_codes` attribute access, on
    the one path that never hits `_placement_of` at all. `_NO_PLACEMENT`
    below is the fix: every fallback site uses this NamedTuple's own zero
    value, not a bare tuple literal.
    """

    unit_code: str
    unit_name: str
    is_merged_slot: bool
    unit_codes: tuple[str, ...]


_NO_PLACEMENT = _Placement("", "", False, ())


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


def _map_point(record: Any) -> tuple[float | None, float | None]:
    """A unit's map coordinates, with the unset pair reported as unset.

    PAIR-level, deliberately, and NOT the per-field treatment `sleeps` gets a
    few lines above (kindred#1941). `sleeps` maps 0 -> None because zero beds
    is never a meaningful answer. Coordinates are normalised 0-1 fractions --
    observed x 0.074-0.888, y 0.154-0.761 -- so a zero on ONE axis is a unit
    sitting exactly on the map edge, which is legitimate. Only both axes at
    zero is the "never positioned" signal `LodgingUnitForm` leaves behind when
    it omits the key.

    `_f` sees a single field and structurally cannot make this call, which is
    why this reads both. Do not replace it with an `_f_or_none()`: that ships
    a bug for a unit at (0, 0.47).

    The frontend keeps its own `hasCoordinates` guard (`mapModel.ts`) --
    defense in depth, and it is the guard that has been holding this up so
    far.
    """
    x = _f(record, "map_x")
    y = _f(record, "map_y")
    if x == 0 and y == 0:
        return None, None
    return x, y


def resolved_units(row: Any) -> list[Any]:
    """The unit RECORDS a placement row resolves to, in stored relation order.

    Shared with the write layer's copy operation, which needs the same answer
    in ids: a scenario seeded by resolving a row differently from how the
    roster reads it would disagree with the mirror it was copied from.

    Order comes from `row.units` (the relation's own stored id order), not
    from iterating `row.expand["units"]`. Expand comes back from an IN-clause
    query and PocketBase does not promise that order matches the field's
    stored order, so reading expand's own order would let a merged slot's
    label -- and its unit_codes -- reorder between requests.

    An id in `units` with no matching record in `expand["units"]` names a unit
    that no longer exists -- the DB permits a relation to outlive its target --
    and is dropped rather than surfacing as a placeholder.
    """
    by_id = {_s(u, "id"): u for u in (getattr(row, "expand", None) or {}).get("units") or []}
    return [by_id[uid] for uid in (getattr(row, "units", None) or []) if uid in by_id]


def placement_grain(row: Any) -> tuple[str, int] | None:
    """("person" | "household", cm_id), or None for a row with neither.

    A person row OVERRIDES its household's, which is the dual grain the
    assignment tables were built around: family camp places households, adult
    weekends place people, and a grandparent housed apart from their family is
    a household row plus one person override.

    Shared with the write layer for the same reason `resolved_units` is: the
    copy must key a seeded row exactly as the roster will read it back.
    """
    person_cm_id = _i(row, "person_cm_id")
    if person_cm_id > 0:
        return "person", person_cm_id
    household_cm_id = _i(row, "household_cm_id")
    if household_cm_id > 0:
        return "household", household_cm_id
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


def _last_token(value: str) -> str:
    """Last whitespace-delimited token. The one heuristic in the chain, reached
    only when no enrolled child on the party carries a last_name.

    For a household its input is the MAILING TITLE, not a name, so its answer
    is wrong whenever the title does not end in the surname -- "The Chen
    Family" files under F. Pinned rather than fixed
    (`test_last_resort_yields_family_for_a_real_mailing_title`), and safe to
    leave that way: every household party has an enrolled child by
    construction, and measured against production ZERO rostered households in
    any year 2022-2026 lack a child `last_name`, so nothing reaches this rung.
    """
    parts = value.split()
    return parts[-1] if parts else ""


def _household_sort_name(children: list[Any], display_name: str) -> str:
    """Surname for a household party, from the ELDEST enrolled child's column.

    `children` arrives oldest-first, so the child rung prefers the eldest
    enrolled camper.

    THERE IS DELIBERATELY NO ADULT RUNG (kindred#1945). This used to read
    `family_camp_adults.last_name` first, on the reasoning that a household's
    surname is its adults'. That column is DEAD UPSTREAM: its two CampMinder
    sources (`Family Camp-P1/P2 Last Name`, cm_id 216785/216786) stopped being
    populated after 2022, so measured against the production snapshot the
    column holds 0 of 834 rows in 2026 and 2 rows a year in 2023-2025. The rung
    could not fire on any current weekend -- retiring it moved the sort key for
    ZERO of the 382 rostered 2026 households -- while its docstring described a
    walk over "adults 1-2" that in fact reached nothing.

    Do NOT reinstate it by deriving a surname from the combined `name` column
    instead. `name` is a whole name typed into a field CampMinder labels "First
    Name" (773 of 788 2026 values contain a space), so a last-token split is a
    heuristic, and the rung it would shadow -- the child's `last_name` -- is a
    real column that is actually populated. Never persist such a derivation
    back to the database either; a split that works on ~95% mishandles the rest
    permanently.
    """
    for child in children:
        child_last = _s(child, "last_name")
        if child_last:
            return child_last
    return _last_token(display_name)


def _is_planning_inventory(unit: LodgingUnitSummary) -> bool:
    """Whether this unit is inventory the weekend is planned against.

    THE SAME PREDICATE the board applies in `boardLayout.isPlanningInventory`
    (frontend). If the two drift, the Housing tab and the stats bar describe
    different weekends -- the board drawing 81 cards beside a bar reporting
    102 units is exactly the disagreement this shape exists to prevent.

    Reads RESOLVED availability rather than the standing role, so a staff
    cabin released to families for one weekend rejoins the inventory; hiding
    the cabin staff just released would make the release capability useless.

    The converse is deliberately NOT symmetric: a family cabin held back this
    weekend is still inventory and is reported by `units_reserved`. Permanent
    staff housing was never inventory, so it cannot be "held back".
    """
    return unit.inventory_class != "staff_default" or unit.is_family_available


def resolve_combined(*, default: bool, override: bool | None, session_override: bool | None = None) -> bool:
    """The draw level for one container, resolved through up to two override tiers.

    Highest first: `override` (this scenario's own `lodging_slot_merges` row),
    then `session_override` (the WEEKEND-LEVEL row -- `scenario == ""`,
    1500000140), then `default` (`lodging_units.default_combined`).

    The weekend-level tier exists because a merge is a fact about the
    weekend, not only about a plan: unlike a placement, no sync ever writes a
    draw level, so there is no CampMinder record of truth a writable mirror
    would corrupt. It is seen on the CampMinder mirror itself (`override` is
    always None there -- no scenario means no scenario row) AND inherited by
    every scenario that has not overridden it locally. Same argument
    1500000135 already made for lodging_availability.

    `is None` at EITHER tier means NO ROW at that tier, which inherits down
    to the next one -- it is not False. Flattening either absence to False
    would make it impossible to split a container whose registry default is
    combined with no scenario row present, or to have a scenario un-close a
    weekend-level split with no scenario row of its own (a bare
    `session_override` falling through to `default` while a real
    `session_override = False` got treated the same as "absent" would make a
    weekend-level split unreachable from a scenario that never touched the
    unit).
    """
    if override is not None:
        return override
    if session_override is not None:
        return session_override
    return default


def drawn_units(units: list[LodgingUnitSummary]) -> list[LodgingUnitSummary]:
    """The units that get a CARD, at the level each tree resolves to.

    THE PYTHON MIRROR of `drawnUnits` in
    `frontend/src/components/weekend/unitLevel.ts`, and the counts' half of
    the invariant `_is_planning_inventory` states for its own predicate: if
    the two drift, the Housing tab and the stats bar describe different
    weekends. Reads the RESOLVED `is_combined` (see `resolve_combined`), never
    `default_combined`, so a scenario merge moves the counts with the board.

    A leaf always draws. A container draws only when combined -- otherwise it
    is pure grouping and the walk descends past it. Nothing beneath a combined
    node draws, because combined means "draw the card here and stop
    descending": two nodes on one root-to-leaf path can both resolve combined
    (a scenario override can set one where an ancestor default already holds)
    and taking the higher is what keeps a room from being counted under a card
    that does not exist.

    Leaf-ness reads the `is_container` FLAG, never child count -- the same
    rule the frontend walk applies, and for the same reason: inferring "this
    is bookable" from an empty child list infers from missing data. Only a
    CONTAINER can block a descendant, which also makes this immune to a stale
    `is_combined` on a leaf. The admin form clears `default_combined` when "is
    a building" is unticked, so nothing writes that combination any more -- but
    rows saved before it did still carry it, and no migration went back for
    them.

    Cycle guard for the same reason `coveredCodes` carries one: the server
    guards against WRITING a cycle (`guardUnitParentCycle`, #1899), but a
    cycle already in the data must not hang a request. A cycle BLOCKS rather
    than merely stopping the walk -- see the comment at the guard for why
    that is what keeps this in step with the frontend.

    A blank `code` is a valid, if unfortunate, registry value, and `by_code`
    is keyed on it -- so a row with no code occupies the SAME `""` key that
    `parent_code == ""` uses to mean "no parent". `_parent_of` is the guard:
    an empty code is looked up as "no parent" and never handed to `by_code`,
    so a root can never be misread as a child of whichever row happens to
    have a blank code.
    """
    by_code = {unit.code: unit for unit in units}

    def _parent_of(code: str) -> LodgingUnitSummary | None:
        return by_code.get(code) if code else None

    drawn: list[LodgingUnitSummary] = []
    for unit in units:
        if unit.is_container and not unit.is_combined:
            continue
        seen = {unit.code}
        cursor = _parent_of(unit.parent_code)
        blocked = False
        while cursor is not None:
            if cursor.code in seen:
                # A CYCLE BLOCKS, rather than merely stopping the walk. The
                # frontend mirror seeds from ROOTS, so a unit whose ancestry
                # loops has no path from one and is never visited there --
                # it draws no card. Falling through to "not blocked" here
                # would count a unit the board will not draw, which is the
                # precise drift this function exists to prevent. The party
                # placed there rails to `offBoard`, which `buildBoard` is
                # total over, so nobody is lost either way.
                blocked = True
                break
            seen.add(cursor.code)
            if cursor.is_container and cursor.is_combined:
                blocked = True
                break
            cursor = _parent_of(cursor.parent_code)
        if not blocked:
            drawn.append(unit)
    return drawn


class _BathroomIndex(NamedTuple):
    """The unit tree, built ONCE per roster/summary call from the unit
    registry and threaded through to every consumer, rather than rebuilt per
    consumer -- the same "compute across all units, read per party" split
    `_build_units` already uses for `group_members`.

    Two consumers share it: `_resolve_party_bathroom` (via `_build_parties`)
    and, since kindred#2041, `_build_counts`'s `_effective_sleeps`, which
    walks `leaf_codes_under` to total a combined container's rooms. Both
    orchestrators (`build_roster`, `build_summary`'s per-weekend `_entry`)
    build ONE instance right after `_build_units` and pass it to both --
    building a second one from the same `units` list was caught in review on
    kindred#2041's PR and is exactly the duplicate work this docstring
    already warned against.
    """

    units_by_code: dict[str, LodgingUnitSummary]
    # Immediate children only, keyed by the PARENT's code. Nesting (a
    # container inside a container, e.g. Doctor's House under a larger
    # block) is walked at read time in `leaf_codes_under`, mirroring
    # `drawn_units`' own upward walk of the same `parent_code` relation.
    children_by_parent: dict[str, tuple[LodgingUnitSummary, ...]]
    group_members: dict[str, frozenset[str]]

    @classmethod
    def build(cls, units: list[LodgingUnitSummary]) -> _BathroomIndex:
        units_by_code = {unit.code: unit for unit in units}

        children: dict[str, list[LodgingUnitSummary]] = {}
        for unit in units:
            if unit.parent_code:
                children.setdefault(unit.parent_code, []).append(unit)

        group_members: dict[str, set[str]] = {}
        for unit in units:
            if unit.bathroom_group:
                group_members.setdefault(unit.bathroom_group, set()).add(unit.code)

        return cls(
            units_by_code=units_by_code,
            children_by_parent={code: tuple(rows) for code, rows in children.items()},
            group_members={group: frozenset(codes) for group, codes in group_members.items()},
        )

    def leaf_codes_under(self, container_code: str) -> frozenset[str]:
        """Every LEAF unit code under a container, walking the tree.

        Recurses rather than reading one level, because a container's own
        children may themselves be containers. Cycle-guarded for the same
        reason `drawn_units` guards its walk: a cycle already in the data
        must not hang a request.
        """
        leaves: set[str] = set()
        seen: set[str] = {container_code}
        stack = list(self.children_by_parent.get(container_code, ()))
        while stack:
            child = stack.pop()
            if child.code in seen:
                continue
            seen.add(child.code)
            if child.is_container:
                stack.extend(self.children_by_parent.get(child.code, ()))
            else:
                leaves.add(child.code)
        return frozenset(leaves)


def _resolve_party_bathroom(unit_codes: list[str], index: _BathroomIndex) -> str:
    """The bathroom a party ends up with once every code it occupies counts
    toward ONE merge -- kindred#2022.

    `effective_bathroom`'s exclusivity branch is unreachable at its one
    existing call site (`_build_units`, below) because that call always
    passes a one-element `frozenset({code})`: the units INVENTORY has no
    occupant, so it is evaluated one unit at a time and stays that way (see
    the comment there). This is the OTHER caller, added for exactly this
    fix: it passes the full set of codes the placement actually covers, so
    a real multi-unit merge can clear the bar.

    A container in `unit_codes` (a whole-let placement naming the building
    rather than its rooms) is expanded to its leaf descendants via
    `container_bathroom`, rather than read from its own registry row, which
    is always "none" -- see that function's docstring.

    The FIRST occupied code supplies the representative bathroom/group fed
    to `effective_bathroom`; every registry bathroom_group's members share
    one physical bathroom by construction, so any member speaks for the
    group. `unit_codes` naming units from two DIFFERENT groups is not a
    case any registry data produces today.
    """
    if not unit_codes:
        return "unknown"

    occupied: set[str] = set()
    bathroom = ""
    group = ""
    for code in unit_codes:
        unit = index.units_by_code.get(code)
        if unit is None:
            # A code the registry cannot resolve makes the WHOLE placement
            # unknown, rather than scoring from whatever else resolved.
            # Continuing here would answer "private"/"shared" on the strength
            # of a placement we can only partly see -- the same claim the
            # empty-`unit_codes` guard above already refuses to make.
            return "unknown"
        if unit.is_container:
            leaves = index.leaf_codes_under(code)
            occupied |= leaves
            leaf_groups = frozenset(index.units_by_code[leaf].bathroom_group for leaf in leaves)
            inherited_bathroom, inherited_group = container_bathroom(leaf_groups)
            if not bathroom:
                bathroom, group = inherited_bathroom, inherited_group
        else:
            occupied.add(code)
            if not bathroom:
                bathroom, group = unit.bathroom, unit.bathroom_group

    if not bathroom:
        return "unknown"
    return effective_bathroom(bathroom, group, index.group_members.get(group, frozenset()), frozenset(occupied))


class LodgingRosterService:
    """Builds the read-only weekend roster from repository output."""

    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def _fetch_session_statuses_or_active(self, year: int) -> Mapping[int, str]:
        """`fetch_session_statuses`, degraded to {} on a failed read.

        kindred#2092 finding 2. This method's caller runs the read INSIDE a
        TaskGroup alongside reads that must not fail -- `asyncio.TaskGroup`
        cancels every sibling task the moment any one of them raises, so an
        unwrapped failure here would 500 the whole endpoint (`/sessions` or
        `/summary`) over a status badge. The realistic trigger is ordinary:
        the API container starting against a PocketBase that has not yet
        applied migration 1500000142, so the collection does not exist yet.

        {} is not a made-up fallback -- it is the SAME value an empty,
        untouched `lodging_session_status` table produces, and this layer's
        own design is that absence of a row means active. Degrading a failed
        read to {} keeps that design holding end to end instead of adding a
        second "unknown" state nothing downstream understands.
        """
        try:
            return await self.repository.fetch_session_statuses(year)
        except Exception as exc:
            logger.warning(
                f"lodging_session_status read failed for year {year}, treating every weekend as active: {exc}"
            )
            return {}

    async def list_sessions(self, year: int) -> WeekendSessionListResponse:
        async with asyncio.TaskGroup() as tg:
            rows_task = tg.create_task(self.repository.fetch_weekend_sessions(year))
            statuses_task = tg.create_task(self._fetch_session_statuses_or_active(year))

        statuses = statuses_task.result()
        return WeekendSessionListResponse(
            year=year,
            sessions=[self._session_summary(row, statuses) for row in rows_task.result()],
        )

    @staticmethod
    def _weekend_status(raw: str) -> WeekendSessionStatus:
        """One stored value -> the vocabulary this layer publishes.

        TOTAL BY DESIGN, and it falls back to "active". The select is
        widenable on purpose (owner, 2026-08-07: two values now so a third is
        a value addition, not a type migration), so a value added to the
        column before this layer knows it must not be rendered as a
        cancellation -- telling staff a running weekend is cancelled is the
        one error here that empties a board somebody is working.
        """
        return "cancelled" if raw == "cancelled" else "active"

    @classmethod
    def _session_summary(cls, row: Any, statuses: Mapping[int, str]) -> WeekendSessionSummary:
        """One weekend's identity. Shared so the lander and the session list
        can never describe the same weekend differently.

        `statuses` is the season's staff-owned status map keyed by CampMinder
        id (kindred#2092). A weekend with no entry is ACTIVE -- the migration
        seeds nothing, so absence of a row is the normal state and not a gap
        to warn about.
        """
        session_cm_id = _i(row, "cm_id")
        return WeekendSessionSummary(
            session_id=_s(row, "id"),
            session_cm_id=session_cm_id,
            name=_s(row, "name"),
            session_type=_s(row, "session_type"),
            start_date=_s(row, "start_date"),
            end_date=_s(row, "end_date"),
            sort_order=_i(row, "sort_order"),
            status=cls._weekend_status(statuses.get(session_cm_id, "")),
        )

    async def build_roster(self, year: int, session_cm_id: int, scenario: str = "") -> WeekendRosterResponse:
        """One weekend's roster, resolved through a scenario or not.

        No scenario is the CampMinder mirror -- the synced rows, exactly as
        before this layer existed, and read-only for everyone. A scenario
        REPLACES them with its own draft rows (kindred#1974), exactly as
        summer's `useCohortBunkAssignments` swaps `bunk_assignments` for
        `bunk_assignments_draft`. A party with no draft row is UNPLACED in
        that scenario; the mirror is not consulted, and is not even read.

        AVAILABILITY used to be the exception and is not any more. 1500000135
        deleted this table's scenario dimension, so there is ONE availability
        read, issued identically with or without a scenario -- a burst pipe
        closes a cabin in every plan for that weekend. See the TaskGroup below.
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
            units_task = tg.create_task(self.repository.fetch_units(year))
            availability_task = tg.create_task(self.repository.fetch_availability(year, session_pb_id))
            attendees_task = tg.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases(year))
            # ONE placement source, chosen here rather than merged later. A
            # scenario does not read the mirror at all -- which is what makes
            # "no fall-through" a property of the request rather than of the
            # merge that used to follow it, and saves a session-scoped round
            # trip while it is at it.
            placements_task = tg.create_task(
                self.repository.fetch_draft_assignments(year, session_pb_id, scenario)
                if scenario
                else self.repository.fetch_assignments(year, session_pb_id)
            )
            # There is deliberately NO second availability read here. 1500000135
            # deleted this table's scenario dimension, so a scenario has nothing
            # to overlay -- see fetch_availability.
            #
            # ALWAYS fetched now, mirror included (1500000140). A merge is a
            # fact about the weekend, not only about a plan -- unlike a
            # placement, no sync writes a draw level, so there is no record of
            # truth a scenario-gated read was ever protecting here. The
            # CampMinder mirror (`scenario == ""`) still gets no SCENARIO row
            # -- there is none to have -- but it can and does have a
            # WEEKEND-LEVEL row, and fetch_slot_merges returns exactly that
            # tier for a blank scenario rather than an empty list.
            # resolve_combined then sees both tiers.
            merges_task = tg.create_task(self.repository.fetch_slot_merges(year, session_pb_id, scenario))

        households = await self._resolve_households(session_type, attendees_task.result(), households_task.result())

        unit_summaries = self._build_units(
            units_task.result(),
            availability_task.result(),
            merges_task.result(),
        )
        # ONE index, threaded to both consumers below -- see `_BathroomIndex`'s
        # own "built ONCE per call" docstring. Rebuilding a second one from the
        # same `unit_summaries` for `_build_counts` was caught in review on
        # kindred#2041's PR.
        unit_index = _BathroomIndex.build(unit_summaries)
        parties = self._build_parties(
            session_type=session_type,
            attendees=attendees_task.result(),
            households=households,
            prior_cm_ids=prior_task.result(),
            adults_by_household=adults_task.result(),
            registrations=registrations_task.result(),
            assignments=placements_task.result(),
            unit_index=unit_index,
        )
        counts = self._build_counts(unit_summaries, parties, aliases_task.result(), unit_index)

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

        `build_roster` makes ten fetches, of which SIX are year-scoped -- the
        unit registry, households, the prior-household set, family-camp adults,
        registrations and the unresolved-alias count are identical for every
        weekend in the year. Calling it once per weekend to fill the lander
        repeats all six N times, which is why a weekend with zero parties still
        costs about three seconds.

        kindred#1963 measures this from eleven and eight, so that issue is
        partly pre-paid: kindred#1889 deleted `has_medical_narrative`, the only
        consumer of the whole-year `family_camp_medical` map, and kindred#1995
        deleted `count_unconfirmed_units` -- `units_unconfirmed` is now derived
        in `_build_counts` from units already in hand rather than fetched.

        So the year-scoped work happens once here, and only the genuinely
        session-scoped reads run per weekend: availability, attendees and one
        placement read -- the synced rows, or the scenario's own. The
        per-weekend numbers then come from the SAME `_build_units` /
        `_build_parties` / `_build_counts` helpers the roster uses, so the
        lander cannot drift from the page it links to, and it resolves a
        scenario the same way: replace, never fall through.

        FOUR session-scoped reads per weekend, with or without a scenario:
        availability, attendees, one placement source, and slot merges (the
        last of these unconditional since 1500000140). A `Semaphore` below
        bounds how many weekends' worth of those run at once -- kindred#1920,
        which also records why a per-weekend cap was chosen over collapsing
        the placement read to one call for the whole year.
        """
        sessions = await self.repository.fetch_weekend_sessions(year)
        if not sessions:
            return WeekendSummaryResponse(year=year, weekends=[])

        async with asyncio.TaskGroup() as tg:
            units_task = tg.create_task(self.repository.fetch_units(year))
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases(year))
            # Season-scoped like the six above, and read HERE rather than per
            # weekend for the same reason: it is one small table for the whole
            # year, and the lander must badge from the same map `/sessions`
            # reads or the two pages would disagree about a weekend.
            #
            # Wrapped, not the raw repository call: this TaskGroup has six
            # OTHER reads in it, and this is the one PocketBase collection
            # that can legitimately not exist yet (a fresh migration). See
            # `_fetch_session_statuses_or_active` for why a failed read here
            # must not cancel the other six and 500 the lander.
            statuses_task = tg.create_task(self._fetch_session_statuses_or_active(year))

        units = units_task.result()
        households = households_task.result()
        prior_cm_ids = prior_task.result()
        adults_by_household = adults_task.result()
        registrations = registrations_task.result()
        unresolved_aliases = aliases_task.result()
        statuses = statuses_task.result()

        # Bounds how many weekends' four-read TaskGroups run at once. Per-year
        # (one instance per `build_summary` call), not module-level -- see
        # SUMMARY_ENTRY_CONCURRENCY.
        entry_gate = asyncio.Semaphore(SUMMARY_ENTRY_CONCURRENCY)

        async def _entry(session: Any) -> WeekendSummaryEntry:
            session_pb_id = _s(session, "id")
            async with entry_gate, asyncio.TaskGroup() as inner:
                availability_task = inner.create_task(self.repository.fetch_availability(year, session_pb_id))
                attendees_task = inner.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
                # One placement source, exactly as build_roster chooses it.
                placements_task = inner.create_task(
                    self.repository.fetch_draft_assignments(year, session_pb_id, scenario)
                    if scenario
                    else self.repository.fetch_assignments(year, session_pb_id)
                )
                # No second availability read, exactly as build_roster issues
                # none. These are separate TaskGroups and fixing only one of
                # them is the half-fix the guard tests exist to catch.
                #
                # Merges are ALWAYS fetched, exactly as build_roster now does
                # (1500000140) -- the mirror gets the weekend-level tier
                # rather than an empty list.
                merges_task = inner.create_task(self.repository.fetch_slot_merges(year, session_pb_id, scenario))

            # Own local variable, not a mutation of the shared `households`
            # above: `_entry` runs concurrently, one per weekend, in the
            # TaskGroup below, and `_resolve_households` returns a merged
            # COPY rather than patching in place (kindred#2143) -- so two
            # weekends resolving different missing households at once can
            # never step on each other or leak one weekend's fresh fetch into
            # another's.
            session_households = await self._resolve_households(
                _s(session, "session_type"), attendees_task.result(), households
            )

            unit_summaries = self._build_units(
                units,
                availability_task.result(),
                merges_task.result(),
            )
            # Same one-index-per-call rule `build_roster` follows -- see the
            # comment there and `_BathroomIndex`'s own docstring.
            unit_index = _BathroomIndex.build(unit_summaries)
            parties = self._build_parties(
                session_type=_s(session, "session_type"),
                attendees=attendees_task.result(),
                households=session_households,
                prior_cm_ids=prior_cm_ids,
                adults_by_household=adults_by_household,
                registrations=registrations,
                assignments=placements_task.result(),
                unit_index=unit_index,
            )
            return WeekendSummaryEntry(
                session=self._session_summary(session, statuses),
                counts=self._build_counts(unit_summaries, parties, unresolved_aliases, unit_index),
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

    def _build_units(self, units: list[Any], availability: list[Any], merges: list[Any]) -> list[LodgingUnitSummary]:
        # ONE layer. The scenario overlay is gone (1500000135) -- availability
        # is a fact about the weekend, so a scenario has nothing to overlay.
        # `family_available` is stored EXPLICITLY, so the row IS the answer and
        # the absence of a row falls through to the unit's role. A unit with no
        # row must therefore map to None and not to False: those are different
        # answers, and `bool(...)` on a missing row would silently close every
        # cabin nobody has said anything about.
        override_by_unit = {_s(row, "unit"): _b(row, "family_available") for row in availability}
        # Display text travels BESIDE the decision, never into it. Stored in the
        # `note` column (the migration header says why `note` was kept rather
        # than renamed to `reason`); surfaced to the API as `reason`. This and
        # `set_availability` are the only two places that translate.
        reason_by_unit = {_s(row, "unit"): _s(row, "note") for row in availability}

        # id -> code, so the parent relation can be published as a code.
        code_by_id = {_s(unit, "id"): _s(unit, "code") for unit in units}

        # Two tiers in one list (1500000140), split on whether the row's own
        # `scenario` is set. Absent row at EITHER tier means inherit -- see
        # resolve_combined -- so this builds two dicts rather than merging
        # session-level rows into `scenario_merge_by_unit` under a `, False`
        # default, which would collapse "no scenario row" into "scenario row
        # says split" and make a weekend-level combine unreachable from a
        # scenario that never touched the unit. Both keyed by unit id, which
        # is what the relation stores.
        scenario_merge_by_unit: dict[str, bool] = {}
        session_merge_by_unit: dict[str, bool] = {}
        for row in merges:
            target = scenario_merge_by_unit if _s(row, "scenario") else session_merge_by_unit
            target[_s(row, "unit")] = _b(row, "combined")

        # Bathroom groups are computed across ALL units, because a group's
        # membership does not depend on the session.
        group_members: dict[str, set[str]] = {}
        for unit in units:
            group = _s(unit, "bathroom_group")
            if group:
                group_members.setdefault(group, set()).add(_s(unit, "code"))

        summaries: list[LodgingUnitSummary] = []
        for unit in units:
            map_x, map_y = _map_point(unit)
            code = _s(unit, "code")
            group = _s(unit, "bathroom_group")
            area = (getattr(unit, "expand", None) or {}).get("area")
            inventory_class = _s(unit, "inventory_class")
            override = override_by_unit.get(_s(unit, "id"))
            summaries.append(
                LodgingUnitSummary(
                    unit_id=_s(unit, "id"),
                    code=code,
                    name=_s(unit, "name"),
                    area_code=_s(area, "code") if area is not None else "",
                    area_name=_s(area, "name") if area is not None else "",
                    sleeps=unit_capacity(_i(unit, "sleeps")),
                    # The units INVENTORY evaluates each unit as its own
                    # one-element slot, so a room that only clears the
                    # bathroom bar as half of a two-room placement is scored
                    # here as if it stood alone. (Multi-room placements do
                    # reach the roster: a placement whose `units` set has 2+
                    # members sets RosterParty.is_merged_slot and lists every
                    # leaf code on RosterParty.unit_codes -- so the gap is
                    # here, on the inventory, not on the surface as a whole.)
                    # When the board ships, pass the occupying placement's
                    # unit_codes here instead of the single unit's own code.
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
                    parent_code=code_by_id.get(_s(unit, "parent_unit"), ""),
                    is_combined=resolve_combined(
                        default=_b(unit, "default_combined"),
                        override=scenario_merge_by_unit.get(_s(unit, "id")),
                        session_override=session_merge_by_unit.get(_s(unit, "id")),
                    ),
                    inventory_class=inventory_class,
                    # cast, not a re-derivation: `unit_shareability` is total
                    # over the Literal's three members and rails everything
                    # else to `unknown`, but mypy cannot narrow a `str` return
                    # to the Literal on its own.
                    shareability=cast(Shareability, unit_shareability(_s(unit, "shareability"))),
                    family_available_override=override,
                    reason=reason_by_unit.get(_s(unit, "id"), ""),
                    is_family_available=is_family_available(inventory_class, override),
                    map_x=map_x,
                    map_y=map_y,
                )
            )
        return summaries

    # -------------------------------------------------------------- parties

    async def _resolve_households(
        self, session_type: str, attendees: list[Any], households: dict[str, Any]
    ) -> dict[str, Any]:
        """`households`, patched with any household a fresh attendee names
        that the cached year snapshot does not have (kindred#2143).

        `households` is cached for up to 15 minutes (`fetch_households`,
        kindred#1963); `attendees` is fetched fresh on every call, in the
        SAME TaskGroup. A household created after the snapshot was cached is
        absent from the cached dict even though a brand-new attendee can
        already name it -- the fresh half of this mixed read outrunning the
        cached half. Left alone, `_build_household_parties` falls through to
        a blank record: display_name renders "Household 0" and is_returning
        reads False for a family that may have been coming for years.

        Person-grain (adult weekend) parties never read `households` at all
        (see `_build_parties`), so there is nothing to patch and no reason to
        pay for the check.

        Scoped to exactly the missing ids -- typically zero -- and never
        written back to `lodging_cache`: this is a per-request patch for a
        rare race, not a second cache to keep coherent with the first.
        """
        if session_type == "adult":
            return households
        missing_ids = sorted(
            {
                household_pb_id
                for attendee in attendees
                if (person := (getattr(attendee, "expand", None) or {}).get("person")) is not None
                and (household_pb_id := _s(person, "household"))
                and household_pb_id not in households
            }
        )
        if not missing_ids:
            return households
        fresh = await self.repository.fetch_households_by_ids(missing_ids)
        if not fresh:
            return households
        logger.info(f"Lodging roster: fetched {len(fresh)} household(s) fresh past the {len(households)}-entry cache")
        return {**households, **fresh}

    def _build_parties(
        self,
        *,
        session_type: str,
        attendees: list[Any],
        households: dict[str, Any],
        prior_cm_ids: set[int],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        assignments: list[Any],
        unit_index: _BathroomIndex,
    ) -> list[RosterParty]:
        placement_by_household, placement_by_person = self._index_assignments(assignments)

        if session_type == "adult":
            return self._build_person_parties(attendees, placement_by_person, unit_index)

        return self._build_household_parties(
            attendees=attendees,
            households=households,
            prior_cm_ids=prior_cm_ids,
            adults_by_household=adults_by_household,
            registrations=registrations,
            placement_by_household=placement_by_household,
            bathroom_index=unit_index,
        )

    @staticmethod
    def _placement_of(row: Any) -> _Placement | None:
        """A row's resolved placement, or None.

        None means the row places nobody. On a synced row that is an orphan --
        every unit it named was deleted out from under it, which the DB allows
        -- and on a draft row it is the same thing: a row that says nothing.
        It used to mean more on a draft row (the tombstone, which suppressed
        the CampMinder mirror underneath); kindred#1974 removed the mirror
        from under a scenario, so there is nothing left to suppress.

        Bookability is not this function's concern. A unit that resolves --
        even a container, even an inactive one -- still places the party, and
        never reads as an unresolvable id. Whether staff CAN place a party
        onto such a unit is a write-path question.

        One unit is a normal placement; 2+ read as a merged slot with no unit
        code -- byte for byte the shape the old `lodging_merges` row produced,
        so callers and the board are unaffected by the collapse to one
        relation.
        """
        units = resolved_units(row)
        if not units:
            return None
        codes = tuple(_s(u, "code") for u in units)
        if len(units) == 1:
            return _Placement(codes[0], _s(units[0], "name"), False, codes)
        return _Placement("", " + ".join(_s(u, "name") for u in units), True, codes)

    def _index_assignments(self, assignments: list[Any]) -> tuple[dict[int, _Placement], dict[int, _Placement]]:
        """Map cm_id -> its resolved placement.

        One source, whichever the caller chose: the synced rows in production
        mode, a scenario's own rows under a scenario. There is no merge step
        -- that was the overlay, and kindred#1974 removed it.
        """
        by_household: dict[int, _Placement] = {}
        by_person: dict[int, _Placement] = {}
        for row in assignments:
            placement = self._placement_of(row)
            if placement is None:
                continue
            grain = placement_grain(row)
            if grain is None:
                continue
            if grain[0] == "person":
                by_person[grain[1]] = placement
            else:
                by_household[grain[1]] = placement
        return by_household, by_person

    def _build_person_parties(
        self,
        attendees: list[Any],
        placement_by_person: dict[int, _Placement],
        bathroom_index: _BathroomIndex,
    ) -> list[RosterParty]:
        parties: list[RosterParty] = []
        for attendee in attendees:
            person = (getattr(attendee, "expand", None) or {}).get("person")
            if person is None:
                continue
            person_cm_id = _i(person, "cm_id") or _i(attendee, "person_id")
            placement = placement_by_person.get(person_cm_id, _NO_PLACEMENT)
            parties.append(
                RosterParty(
                    grain="person",
                    person_cm_id=person_cm_id,
                    display_name=_person_display_name(person),
                    sort_name=_s(person, "last_name") or _last_token(_person_display_name(person)),
                    adults=[PartyAdult(adult_number=1, display_name=_person_display_name(person))],
                    party_size=1,
                    unit_code=placement.unit_code,
                    unit_name=placement.unit_name,
                    is_merged_slot=placement.is_merged_slot,
                    unit_codes=list(placement.unit_codes),
                    effective_bathroom=cast(
                        EffectiveBathroom, _resolve_party_bathroom(list(placement.unit_codes), bathroom_index)
                    ),
                )
            )
        parties.sort(key=lambda p: (p.sort_name.casefold(), p.display_name.casefold()))
        return parties

    def _build_household_parties(
        self,
        *,
        attendees: list[Any],
        households: dict[str, Any],
        prior_cm_ids: set[int],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        placement_by_household: dict[int, _Placement],
        bathroom_index: _BathroomIndex,
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
            adults = adults_by_household.get(household_pb_id, [])
            placement = placement_by_household.get(household_cm_id, _NO_PLACEMENT)
            children_oldest_first = sorted(children, key=lambda c: -(_f(c, "age") or 0.0))

            parties.append(
                RosterParty(
                    grain="household",
                    household_cm_id=household_cm_id,
                    display_name=_household_display_name(household, household_cm_id),
                    sort_name=_household_sort_name(
                        children_oldest_first, _household_display_name(household, household_cm_id)
                    ),
                    adults=[
                        PartyAdult(
                            adult_number=_i(adult, "adult_number"),
                            # `name` is the COLUMN OF RECORD for an attending
                            # adult, and the split columns are a best-effort
                            # Adult-1/2-only extra: first_name/last_name are
                            # empty for 100% of adult_number 3-5 rows in every
                            # measured year, and last_name is empty for all of
                            # 2026 (kindred#1945).
                            #
                            # THE FALLBACK IS LOAD-BEARING -- do not "simplify"
                            # it away on the grounds that `name` is
                            # authoritative. 377 of 382 rostered 2026
                            # households have a non-blank `name`; for several
                            # of the rest this is the only thing that renders
                            # an adult at all. Equally, never conclude a row is
                            # empty from the split columns alone: 136 real
                            # adults across 2022-2026 are blank in
                            # first_name/last_name and populated in `name`.
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
                            # persons.age is CampMinder's yy.mm as a REAL (kindred#2088):
                            # 0.06 is a real 6-month-old, not a rounding artifact, so this
                            # must read the raw float, not _i()'s truncated int. `or None`
                            # is still deliberate here -- age == 0.0 is the UNKNOWN-AGE
                            # population (no birthdate on file), not a newborn.
                            age=_f(child, "age") or None,
                            grade=_i(child, "grade") or None,
                        )
                        for child in children_oldest_first
                    ],
                    party_size=len(adults) + len(children),
                    unit_code=placement.unit_code,
                    unit_name=placement.unit_name,
                    is_merged_slot=placement.is_merged_slot,
                    unit_codes=list(placement.unit_codes),
                    effective_bathroom=cast(
                        EffectiveBathroom, _resolve_party_bathroom(list(placement.unit_codes), bathroom_index)
                    ),
                    arrival_eta=_s(registration, "arrival_eta") if registration is not None else "",
                    is_returning=household_cm_id in prior_cm_ids,
                    share=self._build_share(registration),
                    flags=self._build_flags(registration),
                )
            )
        parties.sort(key=lambda p: (p.sort_name.casefold(), p.display_name.casefold()))
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

    def _build_flags(self, registration: Any) -> AccessibilityFlagSummary:
        """Read the derived flags. Do NOT re-derive them here.

        No medical record reaches this method, and that is deliberate
        (kindred#1889). It used to take one to set `has_medical_narrative`
        from the mere presence of text in any PHI column -- a flag that was
        true for 745/745 households in 2026 and 100.0% in every year measured,
        because these questions store their negative answer as the word "No".

        The flag is gone rather than filtered. Normalising the boilerplate
        negatives still lands at 67.7% / 52.6% / 55.9% across 2024-26, and a
        flag that swings 15 points a year on answer phrasing is not a signal.
        Deriving it from the housing-relevant columns instead was considered
        and rejected: the five housing booleans above already answer that
        question from the ingest's option-level classification, and inferring
        a need from `cpap_info` presence is the exact class of bug kindred#1875
        fixed -- worse here, because it would hide a severe-allergy disclosure
        behind a housing question.

        Deleting it took the whole-year `family_camp_medical` read out of both
        `build_roster` and `build_summary`. The narrative now has exactly one
        reader, `get_household_medical`, which fetches ONE household behind
        `Permission.LODGING_PHI`.

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
        if registration is None:
            return AccessibilityFlagSummary()
        return AccessibilityFlagSummary(
            needs_private_bathroom=_b(registration, "needs_private_bathroom"),
            needs_power=_b(registration, "needs_power"),
            needs_accommodation=_b(registration, "needs_accommodation"),
            accommodation_is_mandatory=_b(registration, "accommodation_is_mandatory"),
            has_infant=_b(registration, "has_infant"),
        )

    # --------------------------------------------------------------- counts

    def _build_counts(
        self,
        units: list[LodgingUnitSummary],
        parties: list[RosterParty],
        unresolved_aliases: int,
        unit_index: _BathroomIndex,
    ) -> RosterCounts:
        # The population the BOARD DRAWS, at each tree's resolved level -- not
        # "every non-container row". A combined container IS one space a
        # family can hold, and its rooms are not separately lettable, so
        # counting them instead reports more spaces than the board draws
        # cards. That is the exact drift `_is_planning_inventory` exists to
        # prevent, one field over.
        #
        # A NON-combined container is still excluded, for the original reason:
        # it carries a whole-building aggregate its rooms already report, and
        # counting both double-counts beds (408 vs a true 389). What changed is
        # that "container" stopped being the same question as "not drawn".
        #
        # Owner ruling, kindred#2041: a container's `sleeps` is a DELTA over
        # its rooms -- the beds in space belonging to no single room, e.g. a
        # futon on a landing -- never a whole-house total. A drawn combined
        # container's true capacity is its own `sleeps` PLUS every LEAF
        # beneath it, walked past any intermediate container via
        # `unit_index.leaf_codes_under` -- the SAME index `_build_parties`
        # already built for bathroom resolution, passed in rather than
        # rebuilt here (see `_BathroomIndex`'s own "built ONCE" docstring).
        # An unset container reads as a delta of 0 -- real common space
        # nobody measured, correctly zero and never "unknown" -- so only a
        # genuinely unmeasured LEAF can still leave a total unknown.
        #
        # And it DOES leave it unknown, including a leaf beneath a drawn
        # container. That sentence used to be aspirational: the container
        # branch dropped unmeasured leaves from its sum, so it could never
        # return None, which structurally excluded every container from
        # `units_capacity_unknown` and let a half-measured house report a
        # confident undercount. Latent when fixed -- 0 of 15 active production
        # containers had an unmeasured active leaf, so no reported number moved
        # -- and live the moment staff add a room with no bed count under a
        # combined house.
        drawn = [u for u in drawn_units(units) if u.is_active]
        bookable = [u for u in drawn if _is_planning_inventory(u)]
        staff_housing = [u for u in drawn if not _is_planning_inventory(u)]
        available = [u for u in bookable if u.is_family_available]
        assigned = sum(1 for p in parties if p.unit_code or p.unit_name)

        def _effective_sleeps(unit: LodgingUnitSummary) -> int | None:
            # MIRRORED by `effectiveSleeps` in
            # `frontend/src/components/weekend/rosterAttention.ts`, which
            # `countUnmeasuredSpaces` reads to answer the same "has anyone
            # measured this?" question for the chip `WeekendStatsBar` prints
            # beside `beds_family_available`. Named in BOTH directions on
            # purpose: the pairing being undocumented is what let the two drift
            # apart unnoticed until kindred#1945's PR, and a change here that
            # is not made there puts two disagreeing numbers on one line.
            if not unit.is_container:
                return unit.sleeps
            leaf_sleeps = [
                leaf.sleeps
                for code in unit_index.leaf_codes_under(unit.code)
                if (leaf := unit_index.units_by_code.get(code)) is not None and leaf.is_active
            ]
            # ACTIVE leaves only, in both directions: a retired room adds no
            # beds, and equally must not drag its whole house into "unknown".
            #
            # NOT additionally filtered by `_is_planning_inventory`, and that
            # is deliberate rather than an oversight. Six active
            # `staff_default` leaves sit under active containers in production
            # (44 family_pool + 6 staff_default under 15 containers), and the
            # SUM below has counted their beds since kindred#2041 -- a family
            # holding the whole house holds that room too, which is what
            # "combined" means. Gating the unknown on a narrower leaf set than
            # the sum reads from would let a room's beds count while its
            # missing measurement did not.
            if any(s is None for s in leaf_sleeps):
                return None
            # The degenerate case. "Unset container reads as a delta of 0"
            # holds only because its rooms supply the rest of the answer --
            # with no rooms to supply it, 0 is not a delta over anything, it
            # is the claim "this house sleeps nobody".
            if unit.sleeps is None and not leaf_sleeps:
                return None
            return (unit.sleeps or 0) + sum(s for s in leaf_sleeps if s is not None)

        effective_sleeps = {u.unit_id: _effective_sleeps(u) for u in bookable}

        return RosterCounts(
            parties_total=len(parties),
            parties_assigned=assigned,
            parties_unassigned=len(parties) - assigned,
            units_total=len(bookable),
            units_family_available=len(available),
            units_reserved=len(bookable) - len(available),
            units_staff_housing=len(staff_housing),
            beds_family_available=sum(s for u in available if (s := effective_sleeps[u.unit_id]) is not None),
            units_capacity_unknown=sum(1 for u in bookable if effective_sleeps[u.unit_id] is None),
            # Over `bookable`, NOT a separate PocketBase count. The old query
            # filtered is_confirmed/is_container/is_active with no inventory
            # predicate, so once units_total dropped staff housing the two
            # described different populations -- and the stats bar divides one
            # by the other ("N of M cabins have unconfirmed amenities"). Every
            # unit is already here with its is_confirmed, so the second answer
            # bought nothing but a chance to disagree, and one fetch.
            units_unconfirmed=sum(1 for u in bookable if not u.is_confirmed),
            units_missing_allocation=sum(1 for u in bookable if not u.inventory_class),
            unresolved_aliases=unresolved_aliases,
        )

"""LodgingRosterService assembly rules.

Domain facts these tests pin down:
  * Family camp enrols only CHILDREN, so a party is a household and its
    adults come from family_camp_adults.
  * Adult weekends enrol individuals, so a party is a person.
  * Container units are in the payload; a SPLIT one never counts on its own
    row. A COMBINED one counts at its own `sleeps` PLUS every leaf beneath
    it -- `sleeps` on a container is a DELTA over its rooms, never a
    whole-house total (owner ruling, kindred#2041).
  * sleeps = 0 is UNKNOWN on a leaf, so it is neither summed nor rendered.
    On a container it is a legitimate zero delta (no measured common space)
    and does not block totalling its rooms.
  * Staff-reserved units stay visible but are excluded from availability.
  * The share layer is READ from ingest-derived columns, never re-parsed.

Records are SimpleNamespace, not MagicMock, deliberately. A MagicMock
auto-creates every attribute that is read, so `_b(registration, "needs_power")`
against a fixture that never set it would return True and the flag assertions
below would pass without the service doing anything. A namespace raises the
same AttributeError a real record would, so getattr defaults are exercised.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.lodging_roster_service import LodgingRosterService, SessionNotFoundError, _BathroomIndex


def _rec(**kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


def _unit(
    pb_id: str,
    code: str,
    name: str,
    *,
    sleeps: int = 0,
    is_container: bool = False,
    inventory_class: str = "family_pool",
    is_active: bool = True,
    is_confirmed: bool = True,
    bathroom: str = "none",
    bathroom_group: str = "",
    map_x: float | None = 0.5,
    map_y: float | None = 0.5,
    default_combined: bool = False,
    parent_unit: str = "",
) -> SimpleNamespace:
    return _rec(
        id=pb_id,
        code=code,
        name=name,
        sleeps=sleeps,
        is_container=is_container,
        inventory_class=inventory_class,
        is_active=is_active,
        is_confirmed=is_confirmed,
        bathroom=bathroom,
        bathroom_group=bathroom_group,
        near_bathhouse=False,
        has_power=False,
        has_ac=False,
        has_fridge=False,
        is_accessible=False,
        map_x=map_x,
        map_y=map_y,
        default_combined=default_combined,
        parent_unit=parent_unit,
        expand={"area": _rec(code="RIDGE", name="Ridge Side", sort_order=1)},
    )


def _repo(**overrides: Any) -> MagicMock:
    """A repository mock with empty defaults; override only what a test needs."""
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_weekend_sessions": [],
        # The staff-owned cancelled flag (kindred#2092), keyed by CampMinder
        # session id. EMPTY is the honest default: the migration seeds
        # nothing, so absence of a row means active.
        "fetch_session_statuses": {},
        "fetch_session": None,
        "fetch_units": [],
        "fetch_availability": [],
        "fetch_assignments": [],
        # The scenario layer. Only read when a scenario is asked for, which is
        # itself asserted below -- no scenario must cost no extra fetches.
        "fetch_draft_assignments": [],
        # A container's draw-level override, at a scenario or at the
        # weekend. UNLIKE the draft placements above, this is now read
        # unconditionally (1500000140) -- the mirror gets the weekend-level
        # tier instead of skipping the round trip. See TestSlotMergeTiers.
        "fetch_slot_merges": [],
        "fetch_attendees_for_session": [],
        "fetch_households": {},
        # The kindred#2143 fallback: a fresh attendee can name a household the
        # cached year snapshot above does not have yet. Empty by default so a
        # test that never sets it up fails loudly (AttributeError on a bare
        # dict, not a silently-invented MagicMock) if the service calls it
        # unexpectedly.
        "fetch_households_by_ids": {},
        "fetch_prior_household_cm_ids": set(),
        "fetch_family_camp_adults": {},
        "fetch_family_camp_registrations": {},
        "fetch_family_camp_medical": {},
        # The PHI path reads one household, not the whole-year maps above.
        "fetch_household_by_cm_id": None,
        "fetch_medical_for_household": None,
        "count_open_unresolved_aliases": 0,
        # DELIBERATELY still here, though the repository method is gone: the
        # tests that pin the roster no longer asking for this count need an
        # attribute to run `assert_not_called()` against. A bare MagicMock
        # would invent one on access and pass no matter what, which is the
        # failure mode those tests exist to rule out.
        "count_unconfirmed_units": 0,
        # Same reason, same shape. 1500000135 deleted availability's scenario
        # dimension and this repository method with it, but the guard tests
        # that stop the overlay being REINTRODUCED assert `await_count == 0`
        # against it -- and on a bare MagicMock that assertion is vacuous,
        # because the attribute springs into existence on access with a fresh
        # count of 0. Deleting this line would leave those tests passing
        # against an implementation that reads the overlay twice.
        "fetch_scenario_availability": [],
    }
    defaults.update(overrides)
    for method, value in defaults.items():
        setattr(repo, method, AsyncMock(return_value=value))
    return repo


FAMILY_SESSION = _rec(
    id="sess_1",
    cm_id=1000001,
    name="Family Camp 1",
    session_type="family",
    year=2026,
    start_date="2026-09-04",
    end_date="2026-09-07",
    sort_order=1,
)
ADULT_SESSION = _rec(
    id="sess_2",
    cm_id=1000002,
    name="Women's Weekend",
    session_type="adult",
    year=2026,
    start_date="2026-10-10",
    end_date="2026-10-12",
    sort_order=2,
)


def _household(pb_id: str = "hh_1", cm_id: int = 2000001, title: str = "The Johnson Family") -> SimpleNamespace:
    return _rec(id=pb_id, cm_id=cm_id, mailing_title=title, greeting="")


def _child(
    cm_id: int = 1000001,
    first: str = "Emma",
    last: str = "Johnson",
    age: float = 9,
    grade: int = 4,
    household_pb_id: str = "hh_1",
) -> SimpleNamespace:
    person = _rec(
        cm_id=cm_id,
        first_name=first,
        last_name=last,
        preferred_name="",
        age=age,
        grade=grade,
        household=household_pb_id,
    )
    return _rec(person_id=cm_id, expand={"person": person})


class TestSessionLookup:
    @pytest.mark.asyncio
    async def test_unknown_session_raises_session_not_found(self) -> None:
        service = LodgingRosterService(_repo(fetch_session=None))
        with pytest.raises(SessionNotFoundError):
            await service.build_roster(2026, 9999999)

    @pytest.mark.asyncio
    async def test_list_sessions_maps_both_weekend_types(self) -> None:
        service = LodgingRosterService(_repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION]))

        result = await service.list_sessions(2026)

        assert result.year == 2026
        assert [s.session_cm_id for s in result.sessions] == [1000001, 1000002]
        assert [s.session_type for s in result.sessions] == ["family", "adult"]


class TestWeekendCancellation:
    """kindred#2092: a cancelled weekend is STAFF-OWNED data.

    CampMinder's Sessions API carries no status field, and neither derived
    rule the issue tried survived measurement -- "attendee rows exist but none
    are enrolled" fires on one owner-confirmed cancelled weekend and not on
    another, because a weekend cancelled before anyone registered is
    byte-identical to one that has not opened yet. So the flag is read from a
    table nothing syncs, and every weekend without a row is ACTIVE.

    BADGE, DO NOT HIDE: a cancelled weekend still holds lodging rows the sync
    deliberately cannot clean up (1500000124), and deep links to it must keep
    resolving, so it stays in both payloads.
    """

    @pytest.mark.asyncio
    async def test_a_weekend_with_no_status_row_is_active(self) -> None:
        service = LodgingRosterService(_repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION]))

        result = await service.list_sessions(2026)

        assert [s.status for s in result.sessions] == ["active", "active"]

    @pytest.mark.asyncio
    async def test_a_cancelled_weekend_is_reported_cancelled_and_still_listed(self) -> None:
        service = LodgingRosterService(
            _repo(
                fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION],
                fetch_session_statuses={1000002: "cancelled"},
            )
        )

        result = await service.list_sessions(2026)

        assert [s.session_cm_id for s in result.sessions] == [1000001, 1000002]
        assert [s.status for s in result.sessions] == ["active", "cancelled"]

    @pytest.mark.asyncio
    async def test_an_unrecognised_stored_value_reads_as_active(self) -> None:
        """The select is widenable by decision (owner, 2026-08-07).

        Two values today, more later. A value this layer does not know must
        not be rendered as a cancellation -- saying a running weekend is
        cancelled is the one error that empties a board staff are working.
        """
        service = LodgingRosterService(
            _repo(
                fetch_weekend_sessions=[FAMILY_SESSION],
                fetch_session_statuses={1000001: "closed_for_registration"},
            )
        )

        result = await service.list_sessions(2026)

        assert [s.status for s in result.sessions] == ["active"]

    @pytest.mark.asyncio
    async def test_a_status_row_for_another_weekend_does_not_leak(self) -> None:
        service = LodgingRosterService(
            _repo(
                fetch_weekend_sessions=[FAMILY_SESSION],
                fetch_session_statuses={9999999: "cancelled"},
            )
        )

        result = await service.list_sessions(2026)

        assert [s.status for s in result.sessions] == ["active"]

    @pytest.mark.asyncio
    async def test_the_lander_summary_reports_the_same_status(self) -> None:
        """The lander reads `/summary`, not `/sessions`.

        Both build their identity block through `_session_summary`, so wiring
        only one of them is exactly the half-fix that would leave the badge
        invisible on the page it was asked for.
        """
        service = LodgingRosterService(
            _repo(
                fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION],
                fetch_session_statuses={1000001: "cancelled"},
            )
        )

        summary = await service.build_summary(2026)

        assert [e.session.status for e in summary.weekends] == ["cancelled", "active"]

    @pytest.mark.asyncio
    async def test_a_failed_status_read_degrades_list_sessions_to_active(self) -> None:
        """kindred#2092 finding 2. `fetch_session_statuses` sits in the SAME
        TaskGroup as the read that must not fail -- a broken read of the
        brand-new `lodging_session_status` collection (the realistic trigger:
        the API container starting against a PocketBase that has not yet
        applied migration 1500000142) must not cancel the sibling task and
        500 the whole endpoint. This layer's own design is that absence of a
        row means active; a FAILED read degrading to the same {} an EMPTY
        table produces keeps that design holding end to end.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        repo.fetch_session_statuses = AsyncMock(side_effect=RuntimeError("collection not found"))
        service = LodgingRosterService(repo)

        result = await service.list_sessions(2026)

        assert [s.status for s in result.sessions] == ["active", "active"]

    @pytest.mark.asyncio
    async def test_a_failed_status_read_degrades_build_summary_to_active(self) -> None:
        """Same failure, the lander's own endpoint. See the sibling test on
        `list_sessions` above for why this must not 500."""
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        repo.fetch_session_statuses = AsyncMock(side_effect=RuntimeError("collection not found"))
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)

        assert [e.session.status for e in summary.weekends] == ["active", "active"]


class TestFamilyCampParties:
    @pytest.mark.asyncio
    async def test_household_party_merges_adults_and_children(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [
                    _rec(
                        adult_number=1,
                        name="Olivia Johnson",
                        first_name="Olivia",
                        last_name="Johnson",
                        relationship_to_camper="Parent",
                    ),
                    _rec(
                        adult_number=2,
                        name="Noah Johnson",
                        first_name="Noah",
                        last_name="Johnson",
                        relationship_to_camper="Parent",
                    ),
                ]
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert len(roster.parties) == 1
        party = roster.parties[0]
        assert party.grain == "household"
        assert party.household_cm_id == 2000001
        assert party.person_cm_id == 0
        assert party.display_name == "The Johnson Family"
        assert [a.display_name for a in party.adults] == ["Olivia Johnson", "Noah Johnson"]
        assert [c.display_name for c in party.children] == ["Emma Johnson"]
        assert party.party_size == 3

    @pytest.mark.asyncio
    async def test_a_blank_name_column_falls_back_to_first_plus_last(self) -> None:
        """THE LOAD-BEARING COALESCE (kindred#1945). Do not remove it.

        `family_camp_adults.name` is the column of record, but it is blank on a
        small tail of rows. Measured against 2026: of the 382 rostered family
        households, 377 have at least one non-blank `name` and 5 do not -- and
        this fallback is the only thing that renders any adult at all for
        several of those. Deleting it in the name of "name is authoritative"
        would blank real adults off the board.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [
                    _rec(
                        adult_number=1,
                        name="",
                        first_name="Olivia",
                        last_name="Johnson",
                        relationship_to_camper="Parent",
                    ),
                ]
            },
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert [a.display_name for a in roster.parties[0].adults] == ["Olivia Johnson"]

    @pytest.mark.asyncio
    async def test_fractional_age_survives_as_the_raw_float(self) -> None:
        """kindred#2088: persons.age is CampMinder's yy.mm as a REAL --

        7 years 4 months is literally 7.04. `int()` truncated an infant's
        0.06 to 0 before `or None` ever saw it, so it rendered blank. The
        fix is to stop truncating: the raw float must pass through whole.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(age=0.06)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].children[0].age == 0.06

    @pytest.mark.asyncio
    async def test_zero_age_is_unknown_not_a_newborn(self) -> None:
        """age == 0.0 is the UNKNOWN-AGE population (no birthdate on file),

        not a newborn -- `or None` deliberately collapses it to None. Do
        NOT "fix" this into `is not None`; that would turn 18 unknown-age
        rows into fake newborns.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(age=0.0)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].children[0].age is None

    @pytest.mark.asyncio
    async def test_children_sort_oldest_first_by_the_raw_float(self) -> None:
        """1.11 (1 year 11 months) must sort above 1.02 (1 year 2 months).

        Truncated to int they both round to 1 and the sort becomes a coin
        flip on input order -- the sort key has to compare the float, not
        the int() of it.
        """
        # Leo (1.02) is listed BEFORE Mia (1.11) deliberately: truncated to
        # int they tie at 1, and a stable sort on the tied int key would
        # leave Leo ahead of Mia -- the wrong order. Only comparing the raw
        # float breaks the tie correctly.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[
                _child(cm_id=1000003, first="Leo", last="Nguyen", age=1.02),
                _child(cm_id=1000002, first="Mia", last="Nguyen", age=1.11),
                _child(cm_id=1000001, first="Ava", last="Nguyen", age=0.06),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert [c.display_name for c in roster.parties[0].children] == [
            "Mia Nguyen",
            "Leo Nguyen",
            "Ava Nguyen",
        ]

    @pytest.mark.asyncio
    async def test_returning_family_flag_from_prior_year_household(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Garcia Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Liam", last="Garcia")],
            fetch_prior_household_cm_ids={2000001},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].is_returning is True

    @pytest.mark.asyncio
    async def test_request_text_is_read_from_the_derived_column(self) -> None:
        """The ingest already collapsed sibling duplicates to household grain.

        `Shared-request` is Camper-partition, so two children carry the same
        sentence twice; the Go layer dedupes and joins the three request source
        fields before this surface ever sees it. Re-splitting the join here
        would be lossy, so the string is passed through whole.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[
                _child(cm_id=1000001, first="Olivia", last="Chen", age=10, grade=5),
                _child(cm_id=1000003, first="Noah", last="Chen", age=7, grade=2),
            ],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="Near the Garcia family please")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert share.request_text == "Near the Garcia family please"
        assert share.needs_resolution is True

    @pytest.mark.asyncio
    async def test_no_request_text_is_not_outstanding_work(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.needs_resolution is False

    @pytest.mark.asyncio
    async def test_share_gate_and_proximity_are_read_not_reparsed(self) -> None:
        """The gate vocabulary is the ingest's, verbatim.

        Note the raw answer is kept alongside for staff, but the classification
        comes from share_cabin_gate. Re-deriving from the raw sentence here is
        what the "No requests" bug was.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Smith Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Noah", last="Smith", age=11, grade=6)],
            fetch_family_camp_registrations={
                "hh_1": _rec(
                    share_cabin_gate="maybe_mutual",
                    share_cabin_preference="Maybe, if a specific family we know",
                    wants_near=True,
                    wants_with=False,
                    wants_similar_ages=False,
                    arrival_eta="Friday around 4pm",
                    needs_accommodation=True,
                    # Set by the ingest layer, not recomputed here. opt_out_vip
                    # is deliberately absent from this fixture: reading it is
                    # the kindred#1874 inversion.
                    accommodation_is_mandatory=True,
                )
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.share.preference == "maybe_mutual"
        assert party.share.preference_raw == "Maybe, if a specific family we know"
        assert party.share.proximity == ["near"]
        assert party.arrival_eta == "Friday around 4pm"
        assert party.flags.needs_accommodation is True
        assert party.flags.accommodation_is_mandatory is True

    @pytest.mark.asyncio
    async def test_similar_ages_accompanies_with_never_replaces_it(self) -> None:
        """similar_ages is a refinement of WITH: an unnamed partner.

        Anything filtering on "with" must still see these households, so both
        kinds are emitted.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(wants_near=False, wants_with=True, wants_similar_ages=True)},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.proximity == ["with", "similar_ages"]

    @pytest.mark.asyncio
    async def test_unanswered_gate_is_unknown_not_open(self) -> None:
        """An empty column means nobody answered, never permission to pair."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(share_cabin_gate="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.preference == "unknown"

    @pytest.mark.asyncio
    async def test_household_with_no_registration_row_still_builds(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.share.preference == "unknown"
        assert party.share.proximity == []
        assert party.flags.needs_private_bathroom is False


class TestFreshHouseholdOutrunsTheCache:
    """kindred#2143: households is cached for up to 15 minutes (kindred#1963)
    but attendees is always fetched fresh, in the SAME TaskGroup. A household
    created after the cache snapshot was taken is absent from the cached dict
    even though a brand-new attendee can already name it. Left unhandled,
    `_build_household_parties` falls through to a blank record -- the
    confirmed failure rendered "Household 0" with a spurious
    `is_returning=False` on screen. The fix is a targeted live fetch for
    exactly the missing ids, never a second cache.
    """

    @pytest.mark.asyncio
    async def test_a_household_missing_from_the_cache_is_fetched_fresh_not_rendered_as_household_zero(
        self,
    ) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            # The cached year snapshot predates this household entirely --
            # it is absent, not present with a stale value.
            fetch_households={},
            fetch_households_by_ids={"hh_1": _household(cm_id=2000009, title="The Nguyen Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Mai", last="Nguyen", household_pb_id="hh_1")],
            fetch_prior_household_cm_ids={2000009},
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert len(roster.parties) == 1
        party = roster.parties[0]
        assert party.household_cm_id == 2000009
        assert party.display_name == "The Nguyen Family"
        assert party.is_returning is True
        repo.fetch_households_by_ids.assert_awaited_once_with(["hh_1"])

    @pytest.mark.asyncio
    async def test_no_missing_households_never_calls_the_fallback(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001)

        repo.fetch_households_by_ids.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_adult_weekend_never_calls_the_household_fallback(self) -> None:
        """Person-grain parties never read the households dict at all, so
        there is nothing for this fallback to patch."""
        attendee = _rec(
            person_id=1000004,
            expand={
                "person": _rec(
                    cm_id=1000004,
                    first_name="Ava",
                    last_name="Kim",
                    preferred_name="",
                    age=34,
                    grade=0,
                    household="hh_missing",
                )
            },
        )
        repo = _repo(fetch_session=ADULT_SESSION, fetch_attendees_for_session=[attendee])

        await LodgingRosterService(repo).build_roster(2026, 1000002)

        repo.fetch_households_by_ids.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_build_summary_gets_the_same_fallback_as_build_roster(self) -> None:
        """The parallel TaskGroup in build_summary carries the identical
        cached-households/fresh-attendees mix (see TestBuildSummary's own
        guard tests for this file's established pattern: fixing only one of
        the two TaskGroups is the half-fix those tests exist to catch)."""
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_session=FAMILY_SESSION,
            fetch_households={},
            fetch_households_by_ids={"hh_1": _household(cm_id=2000009, title="The Nguyen Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Mai", last="Nguyen", household_pb_id="hh_1")],
        )

        summary = await LodgingRosterService(repo).build_summary(2026)

        assert summary.weekends[0].counts.parties_total == 1
        repo.fetch_households_by_ids.assert_awaited_once_with(["hh_1"])


class TestAdultWeekendParties:
    @pytest.mark.asyncio
    async def test_adult_session_produces_person_grain_parties(self) -> None:
        attendee = _rec(
            person_id=1000004,
            expand={
                "person": _rec(
                    cm_id=1000004,
                    first_name="Olivia",
                    last_name="Chen",
                    preferred_name="",
                    age=41,
                    grade=None,
                    household="hh_9",
                )
            },
        )
        repo = _repo(fetch_session=ADULT_SESSION, fetch_attendees_for_session=[attendee])

        roster = await LodgingRosterService(repo).build_roster(2026, 1000002)

        assert len(roster.parties) == 1
        party = roster.parties[0]
        assert party.grain == "person"
        assert party.person_cm_id == 1000004
        assert party.household_cm_id == 0
        assert party.display_name == "Olivia Chen"
        assert party.party_size == 1
        # The person-grain fallback path: no assignment row at all, so
        # placement_by_person is empty and the lookup default fires.
        assert party.unit_codes == []


class TestUnitsAndCounts:
    @pytest.mark.asyncio
    async def test_build_roster_passes_its_year_to_the_unit_fetch(self) -> None:
        """Units became year-scoped in 1500000141.

        `fetch_units` filters to one season now, and `build_roster` already
        receives the year for every other fetch on this TaskGroup -- the unit
        read must not be the one left reading every season at once.
        """
        repo = _repo(fetch_session=FAMILY_SESSION)

        await LodgingRosterService(repo).build_roster(2027, 1000001)

        repo.fetch_units.assert_awaited_once_with(2027)

    @pytest.mark.asyncio
    async def test_containers_are_in_the_payload_but_not_in_counts(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-wawona", "Wawona", sleeps=7, is_container=True),
                _unit("u2", "gt-wawona-front", "Wawona Front", sleeps=4),
                _unit("u3", "gt-wawona-back", "Wawona Back", sleeps=3),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert len(roster.units) == 3
        assert any(u.is_container for u in roster.units)
        assert roster.counts.units_total == 2
        assert roster.counts.beds_family_available == 7  # 4 + 3, NOT 14

    @pytest.mark.asyncio
    async def test_sleeps_zero_is_unknown_not_zero(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=0),
                _unit("u2", "ridge-b", "Ridge B", sleeps=5),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].sleeps is None
        assert by_code["ridge-b"].sleeps == 5
        assert roster.counts.units_capacity_unknown == 1
        assert roster.counts.beds_family_available == 5

    @pytest.mark.asyncio
    async def test_a_unit_with_no_coordinates_reports_none_on_both_axes(self) -> None:
        """kindred#1941. `sleeps` already maps 0 -> None in this service; an
        unset coordinate arrives as 0.0 and renders in the map's exact
        top-left corner, reading as a real placement.

        `LodgingUnitForm` omits the key when the field is blank, so a cabin
        added through the admin UI without coordinates is how this arrives.
        All 93 units today carry real coordinates, and all 21 that the 2026
        rollout adds do too -- this is latent, not live.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5, map_x=0, map_y=0)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].map_x is None
        assert roster.units[0].map_y is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("map_x", "map_y"),
        [(0, 0.47), (0.31, 0)],
    )
    async def test_a_zero_on_one_axis_is_a_real_edge_coordinate(self, map_x: float, map_y: float) -> None:
        """The rule is PAIR-level, and this is the whole reason.

        `sleeps` is per-field because 0 beds is never meaningful. Coordinates
        are not: they are normalised 0-1 fractions (observed x 0.074-0.888,
        y 0.154-0.761), so a single-axis zero means "exactly on the map edge"
        -- legitimate, and nothing sits there today only by accident.

        Anyone who mirrors `sleeps` by writing an `_f_or_none()` and swapping
        it in ships a bug for a unit at (0, 0.47). `_f` sees one field and
        structurally cannot decide this; the fix belongs where both axes are
        read together.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5, map_x=map_x, map_y=map_y)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].map_x == map_x
        assert roster.units[0].map_y == map_y

    @pytest.mark.asyncio
    async def test_a_missing_coordinate_key_stays_none(self) -> None:
        """The admin form omits the key rather than sending 0 -- the shape
        that reaches the API first. It must not become 0.0 on the way out.

        The attributes are DELETED rather than set to `None`, because those
        are not the same input and only one of them is what this test is
        named for. They travel the same path today solely because `_f` reads
        `getattr(record, field, None)`; swap that for `record.map_x` and the
        omitted key raises AttributeError while a `None` fixture sails
        through, which is exactly the regression this test should catch.
        """
        unit = _unit("u1", "ridge-a", "Ridge A", sleeps=5)
        del unit.map_x
        del unit.map_y
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[unit],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].map_x is None
        assert roster.units[0].map_y is None

    @pytest.mark.asyncio
    async def test_reserved_units_stay_visible_but_leave_availability(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "le-shack", "Le Shack", sleeps=4, inventory_class="staff_default"),
            ],
            fetch_availability=[_rec(unit="u1", family_available=False, note="Program director")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].family_available_override is False
        assert by_code["ridge-a"].is_family_available is False
        assert by_code["le-shack"].is_family_available is False
        # Both units stay VISIBLE in `roster.units` -- that is what this test
        # is named for, and it is unchanged. What changed is the counts: the
        # staff cabin is no longer reported as "reserved", because it was
        # never bookable and so cannot be held back. It is planning inventory
        # that is missing, not planning inventory that is unavailable.
        assert len(roster.units) == 2
        assert roster.counts.units_total == 1
        assert roster.counts.units_family_available == 0
        assert roster.counts.units_reserved == 1
        assert roster.counts.units_staff_housing == 1
        assert roster.counts.beds_family_available == 0

    @pytest.mark.asyncio
    async def test_a_true_override_beats_a_false_default(self) -> None:
        """THIS scenario says "combined", overriding a registry default of split."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=False)],
            # `scenario="scn_1"` set explicitly, matching the call below:
            # this is what puts the row in the SCENARIO tier rather than the
            # weekend-level one -- see TestSlotMergeTiers for a row that
            # deliberately omits it.
            fetch_slot_merges=[_rec(unit="u1", combined=True, scenario="scn_1")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is True

    @pytest.mark.asyncio
    async def test_a_false_override_beats_a_true_default(self) -> None:
        """The direction that dies if `.get(id)` grows a `, False` default.

        The registry says this container draws combined; THIS scenario has
        split it. An absent-row-means-False bug would make this container
        look combined no matter what the scenario says, which is exactly
        backwards -- it would make split unreachable whenever the default is
        combined.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=True)],
            fetch_slot_merges=[_rec(unit="u1", combined=False, scenario="scn_1")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is False

    @pytest.mark.asyncio
    async def test_no_override_row_inherits_a_true_default(self) -> None:
        """No row at EITHER tier is INHERIT, not False -- the whole reason
        `override` and `session_override` are each a tri-state.
        `merge_by_unit.get(_s(unit, "id"), False)` would flatten the absent
        row to False here and this would fail: the registry default is True
        and nothing in this scenario, or at the weekend level, has touched
        it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=True)],
            fetch_slot_merges=[],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is True

    @pytest.mark.asyncio
    async def test_the_unit_index_is_built_once_per_roster_call(self) -> None:
        """`_BathroomIndex`'s own docstring says built ONCE per roster/summary
        call, not once per consumer. kindred#2041 added a second consumer
        (`_build_counts`'s `_effective_sleeps`) and an early draft rebuilt the
        index there instead of reusing `_build_parties`'s -- caught in
        review, not by a test. This pins the invariant down so a future
        consumer cannot reintroduce the same duplicate walk.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
        )

        with patch.object(_BathroomIndex, "build", wraps=_BathroomIndex.build) as spy:
            await LodgingRosterService(repo).build_roster(2026, 1000001)

        spy.assert_called_once()


class TestCountsFollowTheDrawLevel:
    """The counts describe the population the BOARD DRAWS, at its resolved level.

    `_is_planning_inventory` already states the invariant these pin: "If the
    two drift, the Housing tab and the stats bar describe different weekends
    -- the board drawing 81 cards beside a bar reporting 102 units is exactly
    the disagreement this shape exists to prevent." A combined container is
    ONE space a family can hold; its rooms are not separately lettable and
    never draw their own card.

    Owner ruling, kindred#2041: a container's `sleeps` is a DELTA over its
    rooms -- the beds in space belonging to no single room, e.g. a futon on a
    landing -- never a whole-house total. A combined container's true
    capacity is therefore its own `sleeps` PLUS every LEAF beneath it, walked
    past any intermediate container rather than stopping at its immediate
    children. An unset container reads as a delta of zero (real, not
    "unknown") and still totals its measured rooms.

    "Measured" is load-bearing in that last sentence (kindred#1945's PR): a
    delta of zero over rooms that HAVE numbers is a real total, but a delta of
    zero over a room nobody counted -- or over no rooms at all -- is not. Any
    active leaf with `sleeps` unset makes its container UNKNOWN, so it counts
    in `units_capacity_unknown` and contributes no beds.
    """

    @pytest.mark.asyncio
    async def test_a_combined_container_counts_its_own_delta_plus_every_leaf_beneath_it(self) -> None:
        """7 (the container's own delta) + 3 + 3 (its rooms) = 13, not 7.

        Summing ONLY the rooms would report 6 and silently drop the space the
        container's own row measures; reading the container's row ALONE (the
        pre-#2041 behaviour) would report 7 and silently drop the rooms.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-wawona", "Wawona", sleeps=7, is_container=True, default_combined=True),
                _unit("u2", "gt-wawona-front", "Wawona Front", sleeps=3, parent_unit="u1"),
                _unit("u3", "gt-wawona-back", "Wawona Back", sleeps=3, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.units_family_available == 1
        assert roster.counts.beds_family_available == 13

    @pytest.mark.asyncio
    async def test_a_combined_containers_sleeps_is_a_delta_not_a_whole_house_total(self) -> None:
        """The real shape kindred#2041 measured against production: a
        whole-let building's own `sleeps` records ONE piece of shared
        furniture (a futon on a landing), not the building's capacity. Its
        four rooms sleep 8 between them. The whole-house total is 9 -- the
        live defect was reporting 1.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "wl-lodge", "Lodge", sleeps=1, is_container=True, default_combined=True),
                _unit("u2", "wl-lodge-1", "Lodge Room 1", sleeps=2, parent_unit="u1"),
                _unit("u3", "wl-lodge-2", "Lodge Room 2", sleeps=2, parent_unit="u1"),
                _unit("u4", "wl-lodge-3", "Lodge Room 3", sleeps=2, parent_unit="u1"),
                _unit("u5", "wl-lodge-4", "Lodge Room 4", sleeps=2, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 9

    @pytest.mark.asyncio
    async def test_a_split_container_still_counts_its_rooms_and_not_itself(self) -> None:
        """The pre-feature behaviour, unchanged. Regression guard: the fix for
        the combined case must not start counting a grouping row that never
        gets a card.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-wawona", "Wawona", sleeps=7, is_container=True),
                _unit("u2", "gt-wawona-front", "Wawona Front", sleeps=3, parent_unit="u1"),
                _unit("u3", "gt-wawona-back", "Wawona Back", sleeps=3, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 2
        assert roster.counts.beds_family_available == 6

    @pytest.mark.asyncio
    async def test_a_combined_ancestor_swallows_an_intermediate_container(self) -> None:
        """Top-down, first-true -- the same rule `drawnUnits` applies. Two
        nodes on one root-to-leaf path can both resolve combined; the higher
        one draws and nothing beneath it gets its OWN card, or the block's
        rooms would be counted under a card that does not exist.

        The total still walks THROUGH the intermediate container to the real
        LEAVES beneath it (10 + room1 3 + room2 3 = 16). The intermediate
        container's own `sleeps` (7) is not itself a leaf, so it is not
        added a second time -- only the outermost drawn container's own
        delta and the actual rooms count.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u0", "block", "The Block", sleeps=10, is_container=True, default_combined=True),
                _unit("u1", "house", "The House", sleeps=7, is_container=True, default_combined=True, parent_unit="u0"),
                _unit("u2", "r1", "Room 1", sleeps=3, parent_unit="u1"),
                _unit("u3", "r2", "Room 2", sleeps=3, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 16

    @pytest.mark.asyncio
    async def test_a_container_with_an_unmeasured_room_is_unknown_not_a_confident_undercount(self) -> None:
        """An unmeasured ACTIVE room leaves its container's total UNKNOWN.

        This reverses what this test asserted before. It used to pin "6, not
        unknown", on the reasoning that an unmeasured room gets "the same
        silent-skip treatment an unmeasured LEAF gets everywhere else". That
        reasoning does not hold: a STANDALONE unmeasured leaf is not skipped at
        all -- it returns None and lands in `units_capacity_unknown`. Only a
        leaf that happened to sit under a container was silently read as zero.

        It also contradicted the kindred#2041 delta ruling the container branch
        is built on. If the container's own `sleeps` is a DELTA over its rooms
        -- the futon on the landing, not the house -- then 6 plus two unknowns
        is unknown, and reporting 6 is a confident undercount of a house nobody
        has measured. `_build_counts`' own comment already said so ("only a
        genuinely unmeasured LEAF can still leave a total unknown"); the code
        was what disagreed.

        Latent, not live, when this changed: measured against the production
        snapshot, 0 of 15 active containers had an unmeasured active leaf, so
        no reported number moved. It goes live the moment staff add a room with
        no bed count under a combined house.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "hc-house", "Combined House", sleeps=6, is_container=True, default_combined=True),
                _unit("u2", "hc-house-a", "Combined House A", sleeps=4, parent_unit="u1"),
                _unit("u3", "hc-house-b", "Combined House B", sleeps=0, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        # NOT 10. The house is not measured, so it contributes no bed count
        # and is flagged for measurement instead.
        assert roster.counts.beds_family_available == 0
        assert roster.counts.units_capacity_unknown == 1

    @pytest.mark.asyncio
    async def test_an_inactive_room_does_not_make_its_container_unknown(self) -> None:
        """Only an ACTIVE leaf counts, in both directions.

        A retired room contributes no beds to the total (the behaviour that
        was already there) and equally must not drag the whole house into
        `units_capacity_unknown` because nobody bothered to measure a room
        that is out of service.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "hc-house", "Combined House", sleeps=6, is_container=True, default_combined=True),
                _unit("u2", "hc-house-a", "Combined House A", sleeps=4, parent_unit="u1"),
                _unit("u3", "hc-house-b", "Combined House B", sleeps=0, parent_unit="u1", is_active=False),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 10
        assert roster.counts.units_capacity_unknown == 0

    @pytest.mark.asyncio
    async def test_an_unset_container_with_nothing_measured_beneath_it_is_unknown(self) -> None:
        """The degenerate case: no figure of its own, and no leaf to total.

        "Unset container" reads as a delta of ZERO only because its rooms
        supply the rest of the answer. With no rooms to supply it, zero is not
        a delta over anything -- it is the claim "this house sleeps nobody",
        which is never a measurement anyone took.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "hc-house", "Combined House", sleeps=0, is_container=True, default_combined=True),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 0
        assert roster.counts.units_capacity_unknown == 1

    @pytest.mark.asyncio
    async def test_a_combined_container_with_no_own_figure_still_totals_its_measured_rooms(self) -> None:
        """The inverse of the Doctor's House case: no common-space furniture
        was ever recorded for this house, and that is a real zero, not a
        missing measurement (kindred#2041) -- 14 of 15 production containers
        are in exactly this state. The card drawn still totals what its
        rooms report: 0 + 2 + 2 = 4, and the total is KNOWN.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "The House", sleeps=0, is_container=True, default_combined=True),
                _unit("u2", "r1", "Room 1", sleeps=2, parent_unit="u1"),
                _unit("u3", "r2", "Room 2", sleeps=2, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.units_capacity_unknown == 0
        assert roster.counts.beds_family_available == 4

    @pytest.mark.asyncio
    async def test_a_scenario_merge_moves_the_counts_the_same_way_the_default_does(self) -> None:
        """The counts read the RESOLVED level, not `default_combined`. A
        scenario that merges a house the registry leaves split must move the
        bar with the board, or the two disagree the moment anybody drags.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "The House", sleeps=7, is_container=True),
                _unit("u2", "r1", "Room 1", sleeps=3, parent_unit="u1"),
                _unit("u3", "r2", "Room 2", sleeps=3, parent_unit="u1"),
            ],
            fetch_slot_merges=[_rec(unit="u1", scenario="scn_1", combined=True)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 13

    @pytest.mark.asyncio
    async def test_an_inactive_room_does_not_swell_a_combined_containers_total(self) -> None:
        """A decommissioned room stays in the registry (kindred#1899-adjacent
        history), but never contributes beds -- the same guard `drawn` already
        applies to a container's OWN row. The inactive room here carries a
        deliberately large `sleeps` (10) so the assertion fails loudly if the
        leaf walk ever stops filtering it out.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "The House", sleeps=5, is_container=True, default_combined=True),
                _unit("u2", "r1", "Room 1", sleeps=3, parent_unit="u1"),
                _unit("u3", "r2", "Room 2 (decommissioned)", sleeps=10, parent_unit="u1", is_active=False),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.beds_family_available == 8


class TestSlotMergeTiers:
    """resolve_combined's three tiers, exercised through the roster assembly.

    Highest first: THIS scenario's own `lodging_slot_merges` row, the
    WEEKEND-LEVEL row (`scenario == ""`, inherited by every scenario and seen
    on the CampMinder mirror), then `lodging_units.default_combined`.
    1500000140 added the middle tier -- these are the cases
    `TestUnitsAndCounts` above could not previously express, because
    `fetch_slot_merges` used to be skipped outright for the mirror and
    `scenario` was a required relation. A merge is a fact about the weekend,
    not only about a plan (LodgingBoard.tsx:100-104 makes the identical
    argument for availability), which is why the mirror participates here at
    all rather than only in TestScenarioResolution's call-count guards.
    """

    @pytest.mark.asyncio
    async def test_a_scenario_row_beats_a_weekend_level_row(self) -> None:
        """A scenario can un-combine a house the weekend has combined.

        Two rows on the same unit, different tiers: the weekend-level row
        says True, THIS scenario's own row says False. A resolver that only
        looked as far as the first row it found -- or that let the
        weekend-level tier shadow the scenario tier -- would report this
        container as combined in a plan that has explicitly split it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=False)],
            fetch_slot_merges=[
                _rec(unit="u1", combined=False, scenario="scn_1"),
                _rec(unit="u1", combined=True, scenario=""),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is False

    @pytest.mark.asyncio
    async def test_a_weekend_level_false_beats_a_true_default(self) -> None:
        """The weekend has split a house the registry defaults to combined.

        No scenario row at all -- only the weekend-level one -- so this also
        proves the middle tier is reachable with an EMPTY scenario tier, not
        only when a scenario row happens to agree with it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=True)],
            fetch_slot_merges=[_rec(unit="u1", combined=False, scenario="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is False

    @pytest.mark.asyncio
    async def test_a_weekend_level_true_beats_a_false_default(self) -> None:
        """The weekend has combined a house the registry defaults to split.

        The direction that dies if the weekend-level lookup grows a
        `, False` default the way the scenario one already guards against
        above: an absent-row-means-False bug at this tier would make a
        weekend-level combine unreachable whenever the registry default is
        split.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=False)],
            fetch_slot_merges=[_rec(unit="u1", combined=True, scenario="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.units[0].is_combined is True

    @pytest.mark.asyncio
    async def test_no_rows_at_either_tier_inherits_the_registry_default(self) -> None:
        """Nothing has touched this container, at any tier."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=True),
                _unit("u2", "le-shack", "Le Shack", sleeps=4, default_combined=False),
            ],
            fetch_slot_merges=[],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        by_code = {u.code: u for u in roster.units}
        assert by_code["gt-wawona"].is_combined is True
        assert by_code["le-shack"].is_combined is False

    @pytest.mark.asyncio
    async def test_the_mirror_sees_a_weekend_level_row(self) -> None:
        """The whole point of 1500000140: the CampMinder mirror is no longer
        blind to `lodging_slot_merges`.

        No `scenario` argument at all -- this is the production/no-plan call,
        which used to skip `fetch_slot_merges` entirely (see
        TestScenarioResolution.test_no_scenario_never_reads_the_draft, which
        pinned `await_count == 0` for exactly this call before the reversal).
        The weekend-level row must still resolve, proving the mirror is not
        merely CALLING fetch_slot_merges now but actually seeing what it
        returns.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona", "Wawona", sleeps=7, default_combined=False)],
            fetch_slot_merges=[_rec(unit="u1", combined=True, scenario="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].is_combined is True
        repo.fetch_slot_merges.assert_awaited_once_with(2026, "sess_1", "")

    @pytest.mark.asyncio
    async def test_parent_code_resolves_through_the_id_to_code_map(self) -> None:
        """`parent_unit` stores an id; the payload publishes the sibling's code."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-wawona", "Wawona", sleeps=7, is_container=True),
                _unit("u2", "gt-wawona-front", "Wawona Front", sleeps=4, parent_unit="u1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["gt-wawona-front"].parent_code == "gt-wawona"

    @pytest.mark.asyncio
    async def test_a_dangling_parent_id_yields_an_empty_parent_code(self) -> None:
        """`parent_unit` names an id absent from this batch of units.

        Distinct from "no parent set at all": that path never reaches
        `code_by_id` with a truthy key. This one does, misses, and must fall
        back to "" rather than leaking the raw id onto the wire -- exactly
        the failure mode `parent_code` exists to rule out. 1500000139's
        header flags this as live once `lodging_units` is year-scoped, which
        lands right after this branch.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "gt-wawona-front", "Wawona Front", sleeps=4, parent_unit="ghost-id")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].parent_code == ""

    @pytest.mark.asyncio
    async def test_staff_housing_leaves_the_planning_inventory_counts(self) -> None:
        """Staff housing was never inventory, so it is not "held back" either.

        `units_reserved` reading 21 says staff took 21 cabins out of service
        this weekend. They were never in service -- they hold full-time staff
        who are not enrolled per session and never appear on a roster. Same
        for `units_capacity_unknown`: not one of the 21 has a measured
        `sleeps` and none ever will, so counting them reads as a data-quality
        backlog somebody still owes.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "aspen-lodge", "Aspen Lodge", inventory_class="staff_default"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.units_family_available == 1
        assert roster.counts.units_reserved == 0
        assert roster.counts.units_staff_housing == 1
        assert roster.counts.units_capacity_unknown == 0

    @pytest.mark.asyncio
    async def test_a_released_staff_cabin_rejoins_the_planning_inventory(self) -> None:
        """Releasing is the whole reason the capability is kept."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "aspen-lodge", "Aspen Lodge", sleeps=4, inventory_class="staff_default"),
            ],
            fetch_availability=[_rec(unit="u2", family_available=True, note="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 2
        assert roster.counts.units_staff_housing == 0
        assert roster.counts.units_family_available == 2

    @pytest.mark.asyncio
    async def test_a_held_family_cabin_is_reserved_not_staff_housing(self) -> None:
        """The two must not blur: one is temporary, the other never was ours.

        A burst pipe closes a cabin for the weekend and it is still inventory.
        Staff housing is not inventory at all. Reporting both as "reserved" is
        what made the old number unreadable.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4),
            ],
            fetch_availability=[_rec(unit="u2", family_available=False, note="Burst pipe")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 2
        assert roster.counts.units_reserved == 1
        assert roster.counts.units_staff_housing == 0

    @pytest.mark.asyncio
    async def test_staff_default_released_to_family_counts_as_available(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "manzanita-7", "New Trailer (Manzanitas)", sleeps=4, inventory_class="staff_default")
            ],
            fetch_availability=[_rec(unit="u1", family_available=True, note="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_family_available == 1
        assert roster.counts.beds_family_available == 4

    @pytest.mark.asyncio
    async def test_unresolved_alias_and_unconfirmed_counts_are_surfaced(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5, is_confirmed=False),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4, is_confirmed=False),
            ],
            count_open_unresolved_aliases=3,
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.unresolved_aliases == 3
        assert roster.counts.units_unconfirmed == 2

    @pytest.mark.asyncio
    async def test_unconfirmed_counts_the_same_population_as_units_total(self) -> None:
        """The stats bar divides one by the other, so they must agree.

        `count_unconfirmed_units` asked PocketBase for is_confirmed = false
        && is_container = false && is_active = true -- no inventory predicate.
        Once `units_total` stopped counting staff housing the two described
        different populations, and the bar's note reads "N of M cabins have
        unconfirmed amenities" off both. With every staff cabin unconfirmed it
        could claim more unconfirmed cabins than cabins, or trip its
        `unconfirmed >= unitsTotal` branch and report "No cabin amenities
        confirmed yet" while planning-inventory cabins were confirmed.

        The repository value is deliberately non-zero here: the count now comes
        from the units the roster already holds, so this pins that the stale
        fetch is not consulted.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5, is_confirmed=True),
                _unit("u2", "aspen-lodge", "Aspen Lodge", inventory_class="staff_default"),
            ],
            count_unconfirmed_units=1,
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 1
        assert roster.counts.units_staff_housing == 1
        assert roster.counts.units_unconfirmed == 0

    @pytest.mark.asyncio
    async def test_the_roster_no_longer_asks_pocketbase_for_the_unconfirmed_count(self) -> None:
        """One fewer fetch on both paths, because the units already say.

        Every unit is already in the payload with its `is_confirmed`, so the
        separate count query was a second answer to a question the roster could
        answer itself -- and the two could disagree.
        """
        repo = _repo(fetch_session=FAMILY_SESSION)
        await LodgingRosterService(repo).build_roster(2026, 1000001)
        repo.count_unconfirmed_units.assert_not_called()

    @pytest.mark.asyncio
    async def test_full_bathroom_group_merge_is_not_assumed_for_a_lone_unit(self) -> None:
        """A unit is evaluated as its own one-element slot in slice 1.

        Tioga 1 alone does not get the whole group's bathroom, so it stays
        shared. Only merging every member of the group upgrades it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "gt-tioga-1", "Tioga 1", sleeps=4, bathroom="shared", bathroom_group="gt-tioga-12"),
                _unit("u2", "gt-tioga-2", "Tioga 2", sleeps=4, bathroom="shared", bathroom_group="gt-tioga-12"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.bathroom for u in roster.units} == {"shared"}


class TestPartyEffectiveBathroom:
    """kindred#2022 -- `RosterParty.effective_bathroom`, resolved against the
    OCCUPYING placement rather than any single unit's own view.

    `TestUnitsAndCounts.test_full_bathroom_group_merge_is_not_assumed_for_a_lone_unit`
    above pins that the units INVENTORY is unaffected by this fix -- it has
    no occupant, so `roster.units[*].bathroom` keeps evaluating one unit at
    a time. This class is the party-level half: the same exclusivity rule,
    now reachable, plus the container-inheritance arm #2022's re-measurement
    widened the issue to cover.

    SCORE ONLY: this field feeds matching/scoring. It is not surfaced as a
    claim to staff on any card or panel in this PR -- that is #1982's.
    """

    @pytest.mark.asyncio
    async def test_full_group_merge_upgrades_the_party_to_private(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Garcia Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Liam", last="Garcia")],
            fetch_units=[
                _unit("u1", "gt-tioga-1", "Tioga 1", sleeps=4, bathroom="shared", bathroom_group="gt-tioga-12"),
                _unit("u2", "gt-tioga-2", "Tioga 2", sleeps=4, bathroom="shared", bathroom_group="gt-tioga-12"),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="gt-tioga-1", name="Tioga 1"),
                            _rec(id="u2", code="gt-tioga-2", name="Tioga 2"),
                        ]
                    },
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.is_merged_slot is True
        assert party.effective_bathroom == "private"
        # The units inventory has no occupant and is untouched by this fix.
        assert {u.bathroom for u in roster.units} == {"shared"}

    @pytest.mark.asyncio
    async def test_a_placement_naming_an_unindexed_code_is_unknown_not_scored_on_the_rest(self) -> None:
        """A code the index cannot resolve makes the WHOLE placement unknown.

        Skipping the absent code and scoring from whatever is left asserts a
        bathroom for a placement we cannot see all of: the party below spans
        two units, only one of which is in the registry, and that one is
        private. Answering "private" would claim exclusivity on the strength
        of half the evidence. `unknown` is the same answer the function
        already gives for an empty `unit_codes` -- absence of evidence, not
        evidence of a private bathroom.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            # Only u1 is in the registry. u2's code is named by the placement
            # but resolves to nothing -- a stale or not-yet-rolled-forward row.
            fetch_units=[
                _unit("u1", "gt-tioga-1", "Tioga 1", sleeps=4, bathroom="private", bathroom_group=""),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="gt-tioga-1", name="Tioga 1"),
                            _rec(id="u2", code="gt-absent-9", name="Absent 9"),
                        ]
                    },
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "unknown"

    @pytest.mark.asyncio
    async def test_partial_group_merge_stays_shared(self) -> None:
        """merge{Upstairs 1, Upstairs 2} leaves a third member of the group
        out, so the party does not clear the bar -- same fixture shape as
        `TestEffectiveBathroom.test_partial_group_merge_stays_shared`."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[
                _unit("u1", "hc-upstairs-1", "Upstairs 1", bathroom="shared", bathroom_group="hc-upstairs-hall"),
                _unit("u2", "hc-upstairs-2", "Upstairs 2", bathroom="shared", bathroom_group="hc-upstairs-hall"),
                _unit("u3", "hc-upstairs-3", "Upstairs 3", bathroom="shared", bathroom_group="hc-upstairs-hall"),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="hc-upstairs-1", name="Upstairs 1"),
                            _rec(id="u2", code="hc-upstairs-2", name="Upstairs 2"),
                        ]
                    },
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "shared"

    @pytest.mark.asyncio
    async def test_lone_leaf_in_a_group_stays_shared(self) -> None:
        """One occupant does not clear the bar alone. Party-level mirror of
        `test_full_bathroom_group_merge_is_not_assumed_for_a_lone_unit`."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[
                _unit("u1", "gt-tioga-1", "Tioga 1", bathroom="shared", bathroom_group="gt-tioga-12"),
                _unit("u2", "gt-tioga-2", "Tioga 2", bathroom="shared", bathroom_group="gt-tioga-12"),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="gt-tioga-1", name="Tioga 1")]},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "shared"

    @pytest.mark.asyncio
    async def test_genuinely_private_single_unit_passes_through(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[_unit("u1", "hc-upstairs-5", "Upstairs 5", bathroom="private")],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="hc-upstairs-5", name="Upstairs 5")]},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "private"

    @pytest.mark.asyncio
    async def test_whole_container_let_covering_its_bathroom_group_is_private(self) -> None:
        """A party placed on the CONTAINER id alone -- staff booked the whole
        Doctor's House rather than naming its two bedrooms. The container's
        own row is bathroom="none" (a building is not a room), so without
        inheritance from its leaves this reads as no bathroom at all -- the
        "container whole-let" gap #2022's re-measurement widened the issue
        to cover, separate from the plain multi-leaf merge above.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[
                _unit("u1", "hc-dh", "Doctor's House", sleeps=6, is_container=True, default_combined=True),
                _unit(
                    "u2",
                    "hc-dh-a",
                    "Doctor's House A",
                    sleeps=3,
                    bathroom="shared",
                    bathroom_group="hc-dh-bath",
                    parent_unit="u1",
                ),
                _unit(
                    "u3",
                    "hc-dh-b",
                    "Doctor's House B",
                    sleeps=3,
                    bathroom="shared",
                    bathroom_group="hc-dh-bath",
                    parent_unit="u1",
                ),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="hc-dh", name="Doctor's House")]},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.is_merged_slot is False  # one unit named -- the container itself
        assert party.effective_bathroom == "private"

    @pytest.mark.asyncio
    async def test_partial_container_stays_at_its_own_value(self) -> None:
        """A container whose leaves DISAGREE on a group has nothing to
        inherit, and reports its own registry row -- "none" -- unchanged."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[
                _unit("u1", "block", "The Block", sleeps=6, is_container=True, default_combined=True),
                _unit(
                    "u2", "block-a", "Block A", sleeps=3, bathroom="shared", bathroom_group="group-a", parent_unit="u1"
                ),
                _unit(
                    "u3", "block-b", "Block B", sleeps=3, bathroom="shared", bathroom_group="group-b", parent_unit="u1"
                ),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="block", name="The Block")]},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "none"

    @pytest.mark.asyncio
    async def test_unplaced_party_is_unknown(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].effective_bathroom == "unknown"

    @pytest.mark.asyncio
    async def test_adult_weekend_party_gets_the_same_scoring(self) -> None:
        """Adult weekends place PERSONS, not households -- the resolver must
        not be wired to the household branch alone."""
        attendee = _rec(
            person_id=1000004,
            expand={
                "person": _rec(
                    cm_id=1000004,
                    first_name="Olivia",
                    last_name="Chen",
                    preferred_name="",
                    age=41,
                    grade=None,
                    household="hh_9",
                )
            },
        )
        repo = _repo(
            fetch_session=ADULT_SESSION,
            fetch_attendees_for_session=[attendee],
            fetch_units=[
                _unit("u1", "gt-tioga-1", "Tioga 1", bathroom="shared", bathroom_group="gt-tioga-12"),
                _unit("u2", "gt-tioga-2", "Tioga 2", bathroom="shared", bathroom_group="gt-tioga-12"),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=0,
                    person_cm_id=1000004,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="gt-tioga-1", name="Tioga 1"),
                            _rec(id="u2", code="gt-tioga-2", name="Tioga 2"),
                        ]
                    },
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000002)

        assert roster.parties[0].effective_bathroom == "private"


class TestPlacementOf:
    """`_placement_of` in isolation.

    The roster-level tests below thread it through households, attendees and
    counts, which is right for pinning the API response shape but too noisy
    for pinning the primitive's own rules -- ordering and unresolvable ids
    would be buried in party-assembly detail that has nothing to do with
    them.
    """

    def test_single_unit_returns_its_code(self) -> None:
        row = _rec(units=["u1"], expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]})

        assert LodgingRosterService._placement_of(row) == ("ridge-a", "Ridge A", False, ("ridge-a",))

    def test_two_units_read_as_a_merged_slot(self) -> None:
        row = _rec(
            units=["u1", "u2"],
            expand={
                "units": [
                    _rec(id="u1", code="gt-tioga-1", name="Tioga 1"),
                    _rec(id="u2", code="gt-tioga-2", name="Tioga 2"),
                ]
            },
        )

        placement = LodgingRosterService._placement_of(row)

        assert placement is not None
        code, name, merged, unit_codes = placement
        assert code == ""
        assert merged is True
        assert "Tioga 1" in name
        assert "Tioga 2" in name
        assert unit_codes == ("gt-tioga-1", "gt-tioga-2")

    def test_no_units_is_none(self) -> None:
        assert LodgingRosterService._placement_of(_rec(units=[], expand={})) is None

    def test_label_and_codes_order_follows_the_stored_relation_not_the_expand_order(self) -> None:
        """`expand` comes back from an IN-clause query, which PocketBase does
        not promise matches the relation field's own stored order. Building
        the label -- and unit_codes -- from `units` (the id list) rather than
        from `expand["units"]` directly keeps both stable across requests
        even if the query's row order is not."""
        row = _rec(
            units=["u2", "u1"],
            expand={
                "units": [
                    _rec(id="u1", code="gt-tioga-1", name="Tioga 1"),
                    _rec(id="u2", code="gt-tioga-2", name="Tioga 2"),
                ]
            },
        )

        placement = LodgingRosterService._placement_of(row)

        assert placement is not None
        assert placement.unit_name == "Tioga 2 + Tioga 1"
        assert placement.unit_codes == ("gt-tioga-2", "gt-tioga-1")

    def test_an_unresolvable_id_is_dropped_not_treated_as_a_full_orphan(self) -> None:
        """PocketBase tolerates a relation id whose target record is gone --
        its own cascade cleanup relies on that. The surviving id still places
        the party, as a single unit rather than a merge, instead of the whole
        row reading as unplaced."""
        row = _rec(units=["u1", "u_deleted"], expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]})

        assert LodgingRosterService._placement_of(row) == ("ridge-a", "Ridge A", False, ("ridge-a",))

    def test_a_row_naming_a_container_or_inactive_unit_still_places(self) -> None:
        """`_placement_of` has no opinion about bookability, only about
        whether the relation resolves. If it ever grew one, a row naming a
        container (or an inactive unit) would read as unresolvable -- and
        with zero units left, as no placement at all. That is a severe silent
        failure: the party would read as unplaced instead of showing where it
        was actually placed, and on a scenario there is no longer a mirror
        underneath to disguise it. Filtering what staff can PLACE a party onto
        belongs to the write path, not here.
        """
        row = _rec(
            units=["u1"],
            expand={"units": [_rec(id="u1", code="gt-wawona", name="Wawona", is_container=True, is_active=False)]},
        )

        assert LodgingRosterService._placement_of(row) is not None


class TestAssignments:
    @pytest.mark.asyncio
    async def test_household_assignment_resolves_to_a_unit(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.unit_code == "ridge-a"
        assert party.unit_name == "Ridge A"
        assert party.is_merged_slot is False
        assert party.unit_codes == ["ridge-a"]
        assert roster.counts.parties_assigned == 1
        assert roster.counts.parties_unassigned == 0

    @pytest.mark.asyncio
    async def test_unplaced_party_has_empty_unit_codes(self) -> None:
        """The fallback path for a party with no assignment row at all: the
        lookup dict is empty, so `.get(key, default)` returns the DEFAULT
        rather than anything `_placement_of` built. A bare 3-tuple default
        would still satisfy that lookup and still unpack into
        unit_code/unit_name/is_merged_slot -- a plain tuple unpacks into
        however many names ask for it -- and only fail later, on
        `.unit_codes` attribute access, which a plain tuple does not have.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].unit_codes == []

    @pytest.mark.asyncio
    async def test_two_unit_assignment_reads_as_a_merged_slot(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Garcia Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Liam", last="Garcia")],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="gt-wawona-front", name="Wawona Front"),
                            _rec(id="u2", code="gt-wawona-back", name="Wawona Back"),
                        ]
                    },
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.unit_code == ""
        assert party.is_merged_slot is True
        assert "Wawona Front" in party.unit_name
        assert "Wawona Back" in party.unit_name
        assert party.unit_codes == ["gt-wawona-front", "gt-wawona-back"]

    @pytest.mark.asyncio
    async def test_orphaned_assignment_leaves_the_party_unassigned(self) -> None:
        """lodging_assignments.units is optional, so deleting every unit it
        named leaves the row pointing at nothing. That is not a placement."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_assignments=[
                _rec(household_cm_id=2000001, person_cm_id=0, units=[], expand={}),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].unit_code == ""
        assert roster.counts.parties_assigned == 0
        assert roster.counts.parties_unassigned == 1
        assert roster.parties[0].unit_codes == []


class TestScenarioResolution:
    """Draft REPLACES truth, as summer's scenarios do (kindred#1974).

    The board has two modes, taken verbatim from summer: NO scenario is the
    CampMinder mirror and is read-only for everyone, and a SELECTED scenario is
    the draft and is editable. Selecting a scenario swaps the source of
    placements outright -- `useCohortBunkAssignments.ts:47` swaps the
    collection, and this does the same thing one layer down.

    A scenario therefore starts EMPTY and is seeded by an explicit copy
    (`LodgingWriteService.copy_from_mirror`). The overlay this replaced made a
    fresh scenario render the synced placements with no seed step, at the cost
    of a three-state table -- placed / tombstoned / untouched -- that summer
    does not have and that the board had to get right on every read and every
    write.

    Availability arrived at the same place by a different route. It was the one
    lodging read left as an overlay after kindred#1974, on the argument that
    nothing syncs into `lodging_availability` so there was no record of truth
    to replace. That argued only against a draft TWIN; it never established
    that availability varies by scenario, and it does not -- a burst pipe
    closes a cabin in every plan for that weekend. 1500000135 deleted the
    dimension outright, so there is now exactly one availability layer and a
    scenario reads it unchanged.
    """

    @pytest.mark.asyncio
    async def test_no_scenario_never_reads_the_draft(self) -> None:
        """Production mode costs exactly what it did before this layer existed."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert repo.fetch_draft_assignments.await_count == 0
        assert repo.fetch_scenario_availability.await_count == 0
        # REVERSED by 1500000140 (was `== 0`): a merge is a fact about the
        # weekend, not only about a plan, so the mirror is no longer skipped
        # here -- it reads the WEEKEND-LEVEL tier (`scenario = ""`) exactly
        # as a named scenario reads its own tier plus this one.
        # TestSlotMergeTiers.test_the_mirror_sees_a_weekend_level_row covers
        # the content this now returns, not just the call count.
        assert repo.fetch_slot_merges.await_count == 1

    @pytest.mark.asyncio
    async def test_a_scenario_never_reads_the_campminder_mirror(self) -> None:
        """The structural half of "no fall-through".

        Every behavioural test below could be satisfied by reading the mirror
        and then discarding it. This asserts the read is not issued at all,
        which is what makes "the scenario replaces the mirror" a property of
        the request rather than of the merge that follows it -- and is a
        session-scoped round trip saved per weekend on `/summary`.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert repo.fetch_assignments.await_count == 0
        assert repo.fetch_draft_assignments.await_count == 1
        # A named scenario CAN carry container overrides -- the same "one
        # source, chosen once" rule as the placements above.
        assert repo.fetch_slot_merges.await_count == 1

    @pytest.mark.asyncio
    async def test_a_draft_placement_is_what_the_scenario_shows(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=5),
            ],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]},
                ),
            ],
            fetch_draft_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u2"],
                    expand={"units": [_rec(id="u2", code="ridge-b", name="Ridge B")]},
                ),
            ],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.parties[0].unit_code == "ridge-b"
        assert roster.counts.parties_assigned == 1

    @pytest.mark.asyncio
    async def test_a_party_with_no_draft_row_is_unplaced_in_the_scenario(self) -> None:
        """No draft row means UNPLACED, not "wherever CampMinder put them".

        This is the whole of kindred#1974 in one assertion, and the exact
        behaviour that inverted: under the overlay this party kept its synced
        cabin. A scenario is now a plan of its own, seeded by an explicit copy
        or by hand, and a party nobody placed in it is a party nobody placed.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(), "hh_2": _household("hh_2", 2000002, "The Garcia Family")},
            fetch_attendees_for_session=[
                _child(),
                _child(cm_id=1000002, first="Liam", last="Garcia", household_pb_id="hh_2"),
            ],
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000002,
                    person_cm_id=0,
                    units=["u1"],
                    expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]},
                ),
            ],
            fetch_draft_assignments=[],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        placed = {p.display_name: p.unit_code for p in roster.parties}
        assert placed["The Garcia Family"] == "", "the mirror leaked into a scenario"
        assert roster.counts.parties_assigned == 0
        assert roster.counts.parties_unassigned == 2

    @pytest.mark.asyncio
    async def test_a_draft_row_naming_no_unit_reads_as_unplaced(self) -> None:
        """The retired tombstone degrades to what it always meant.

        Rows shaped like this exist on any database written before
        kindred#1974 -- an empty `units` set was how the overlay spelled
        "staff took this party off the board" -- and `deleteRefRecords` can
        still produce one by removing a placement's last unit id. Under
        replace semantics there is nothing left to suppress, so such a row is
        simply a row that places nobody. The write path no longer creates one:
        `PlacementWriteRequest.unit_ids` refuses an empty list, and DELETE is
        how a party is unplaced.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_draft_assignments=[
                _rec(household_cm_id=2000001, person_cm_id=0, units=[], expand={}),
            ],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        assert roster.parties[0].unit_code == ""
        assert roster.counts.parties_assigned == 0
        assert roster.counts.parties_unassigned == 1

    @pytest.mark.asyncio
    async def test_a_draft_placement_onto_two_units_reads_as_a_merged_slot(self) -> None:
        """The board can place a party across multiple rooms directly.

        There is no separate merge concept any more: any row -- synced or a
        scenario's own draft -- that names 2+ ids in `units` reads as merged.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_draft_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1", "u2"],
                    expand={
                        "units": [
                            _rec(id="u1", code="gt-tenaya-1", name="Tenaya 1"),
                            _rec(id="u2", code="gt-tenaya-2", name="Tenaya 2"),
                        ]
                    },
                ),
            ],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        party = roster.parties[0]
        assert "Tenaya 1" in party.unit_name
        assert "Tenaya 2" in party.unit_name
        assert party.is_merged_slot is True
        assert party.unit_codes == ["gt-tenaya-1", "gt-tenaya-2"]

    @pytest.mark.asyncio
    async def test_the_person_grain_resolves_independently(self) -> None:
        """Adult weekends place PERSONS, and the draft keys on that grain."""
        person = _rec(
            cm_id=1000001,
            first_name="Riley",
            last_name="Sam",
            preferred_name="",
            age=42,
            grade=0,
            household="hh_1",
        )
        repo = _repo(
            fetch_session=ADULT_SESSION,
            fetch_attendees_for_session=[_rec(person_id=1000001, expand={"person": person})],
            fetch_units=[_unit("u2", "ridge-b", "Ridge B", sleeps=5)],
            fetch_draft_assignments=[
                _rec(
                    household_cm_id=0,
                    person_cm_id=1000001,
                    units=["u2"],
                    expand={"units": [_rec(id="u2", code="ridge-b", name="Ridge B")]},
                ),
            ],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000002, scenario="scn_1")

        assert roster.parties[0].unit_code == "ridge-b"

    @pytest.mark.asyncio
    async def test_a_scenario_reads_no_second_availability_layer(self) -> None:
        """The overlay is GONE: a scenario and the live plan see one table.

        This is the assertion that stops it being reintroduced. 1500000135
        deleted availability's scenario dimension rather than mirroring it with
        a draft twin, because availability is a fact about the WEEKEND and not
        about the plan -- a burst pipe closes a cabin in every scenario for
        that weekend, so there was never anything for a scenario to disagree
        about.

        Two assertions, because either alone is satisfiable by a half-fix: one
        read issued, and the scenario read not issued at all.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn123")

        repo.fetch_availability.assert_awaited_once()
        assert repo.fetch_scenario_availability.await_count == 0

    @pytest.mark.asyncio
    async def test_a_scenario_resolves_availability_identically_to_the_live_plan(self) -> None:
        """The behavioural half of the same fact.

        The previous specification had a scenario's own rows overlay the live
        ones. There is now one layer, so naming a scenario changes nothing
        about which cabins are open -- only which PLACEMENTS are read.
        """
        units = [
            _unit("u1", "ridge-a", "Ridge A", sleeps=5),
            _unit("u2", "ridge-b", "Ridge B", sleeps=4),
        ]
        availability = [_rec(unit="u1", family_available=False, note="Burst pipe")]
        service = LodgingRosterService(
            _repo(fetch_session=FAMILY_SESSION, fetch_units=units, fetch_availability=availability)
        )
        scenario_service = LodgingRosterService(
            _repo(fetch_session=FAMILY_SESSION, fetch_units=units, fetch_availability=availability)
        )

        live = await service.build_roster(2026, 1000001)
        scoped = await scenario_service.build_roster(2026, 1000001, scenario="scn_1")

        assert [u.is_family_available for u in live.units] == [u.is_family_available for u in scoped.units]
        assert live.counts.units_family_available == scoped.counts.units_family_available == 1
        by_code = {u.code: u for u in scoped.units}
        assert by_code["ridge-a"].family_available_override is False
        assert by_code["ridge-a"].reason == "Burst pipe"
        # No row for ridge-b: absence means "ask the unit's role", which is not
        # the same answer as a stored False and must not be flattened into one.
        assert by_code["ridge-b"].family_available_override is None


class TestMedicalFlagsAndNarrative:
    @pytest.mark.asyncio
    async def test_the_narrative_never_reaches_the_roster_payload(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Smith Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Noah", last="Smith", age=12, grade=7)],
            fetch_family_camp_registrations={"hh_1": _rec(needs_power=True)},
            fetch_family_camp_medical={"hh_1": _rec(cpap_info="Uses a CPAP nightly and needs an outlet")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.flags.needs_power is True
        # The narrative itself must not appear anywhere in the payload.
        assert "CPAP nightly" not in roster.model_dump_json()

    @pytest.mark.asyncio
    async def test_the_roster_never_reads_the_years_medical_narratives(self) -> None:
        """kindred#1889, and the reason the fix is a deletion.

        `has_medical_narrative` was the ONLY consumer of the whole-year
        `family_camp_medical` map in this read path. Deriving a boolean that
        was true for every household cost a fetch of every household's
        narrative into API memory on every roster build.

        The gated endpoint is unaffected: `get_household_medical` reads ONE
        household through `fetch_medical_for_household`, which is a different
        repository call and is what `Permission.LODGING_PHI` actually guards.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_medical={"hh_1": _rec(cpap_info="Uses a CPAP nightly")},
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001)

        repo.fetch_family_camp_medical.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_summary_never_reads_the_years_medical_narratives(self) -> None:
        """The lander inherits the same read helpers, so it inherits the win.

        `build_summary` hoists the year-scoped reads out of its per-weekend
        loop, and the medical map was one of them.
        """
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_medical={"hh_1": _rec(cpap_info="Uses a CPAP nightly")},
        )

        await LodgingRosterService(repo).build_summary(2026)

        repo.fetch_family_camp_medical.assert_not_called()

    @pytest.mark.asyncio
    async def test_cpap_narrative_alone_does_not_imply_power(self) -> None:
        """kindred#1875: 75 households answered a CPAP field to say their need
        is a bathroom and explicitly *not* CPAP-related. Their narrative lands
        in cpap_info, so inferring needs_power from narrative presence -- which
        this service used to do -- gives them an outlet instead of a bathroom.
        The ingest layer classifies at the option level; this surface obeys it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Olivia", last="Chen", age=10, grade=5)],
            fetch_family_camp_registrations={"hh_1": _rec(needs_power=False, needs_private_bathroom=True)},
            fetch_family_camp_medical={
                "hh_1": _rec(
                    cpap_info="Bathroom or other housing accommodation for a medical (not CPAP related) reason needed"
                )
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        flags = roster.parties[0].flags
        assert flags.needs_power is False
        assert flags.needs_private_bathroom is True

    @pytest.mark.asyncio
    async def test_bathroom_need_comes_from_the_derived_column(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Olivia", last="Chen", age=10, grade=5)],
            fetch_family_camp_registrations={"hh_1": _rec(needs_private_bathroom=True)},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].flags.needs_private_bathroom is True

    @pytest.mark.asyncio
    async def test_has_infant_reaches_the_roster(self) -> None:
        """kindred#1876: Adult-Infant was loaded every sync and discarded. An
        infant changes what a unit has to provide, so it reaches the board."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Olivia", last="Chen", age=10, grade=5)],
            fetch_family_camp_registrations={"hh_1": _rec(has_infant=True)},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].flags.has_infant is True

    @pytest.mark.asyncio
    async def test_get_household_medical_returns_the_narrative(self) -> None:
        repo = _repo(
            fetch_household_by_cm_id=_rec(id="hh_1", cm_id=2000001),
            fetch_medical_for_household=_rec(cpap_info="Uses a CPAP nightly", allergy_info="Peanut"),
        )
        result = await LodgingRosterService(repo).get_household_medical(2026, 2000001)

        assert result.household_cm_id == 2000001
        assert result.cpap_info == "Uses a CPAP nightly"
        assert result.allergy_info == "Peanut"
        # The medical read is anchored to the household the caller asked for.
        repo.fetch_medical_for_household.assert_awaited_once_with(2026, "hh_1")
        # ...and no whole-year map was materialised to get there.
        repo.fetch_households.assert_not_awaited()
        repo.fetch_family_camp_medical.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_get_household_medical_for_an_unknown_household_is_empty(self) -> None:
        result = await LodgingRosterService(_repo()).get_household_medical(2026, 9999999)

        assert result.household_cm_id == 9999999
        assert result.cpap_info == ""


class TestBuildSummary:
    """The lander's batched read.

    It exists for one reason: `build_roster` makes ten fetches of which seven
    are year-scoped, so filling a lander weekend-by-weekend repeats that
    year-wide work once per weekend. The point of these tests is that the
    batch does it ONCE and still agrees with the roster.

    Both counts were one higher until kindred#1889 removed the whole-year
    medical read from both paths.
    """

    @pytest.mark.asyncio
    async def test_year_scoped_reads_happen_once_for_the_whole_year(self) -> None:
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        service = LodgingRosterService(repo)

        await service.build_summary(2026)

        # Six year-scoped fetches, two weekends: each must still be one call.
        # `fetch_family_camp_medical` was the eighth until kindred#1889 deleted
        # its only consumer, and `count_unconfirmed_units` the seventh until
        # `_build_counts` started counting `is_confirmed` off the units it
        # already holds -- see the assertions below, which pin that neither is
        # read at all rather than merely read once.
        for method in (
            "fetch_units",
            "fetch_households",
            "fetch_prior_household_cm_ids",
            "fetch_family_camp_adults",
            "fetch_family_camp_registrations",
            "count_open_unresolved_aliases",
        ):
            assert getattr(repo, method).await_count == 1, f"{method} was not batched"

        repo.fetch_family_camp_medical.assert_not_called()
        repo.count_unconfirmed_units.assert_not_called()

    @pytest.mark.asyncio
    async def test_session_scoped_reads_happen_once_per_weekend(self) -> None:
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        service = LodgingRosterService(repo)

        await service.build_summary(2026)

        for method in ("fetch_availability", "fetch_assignments", "fetch_attendees_for_session"):
            assert getattr(repo, method).await_count == 2, f"{method} should be per-weekend"

    @pytest.mark.asyncio
    async def test_build_summary_passes_its_year_to_the_unit_fetch(self) -> None:
        """The batched sibling of `build_roster`'s equivalent guard.

        Both methods carry their own TaskGroup calling `fetch_units`, so
        fixing one and leaving the other is the half-fix this file's own
        `test_the_summary_reads_no_second_availability_layer` warns about.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2027)

        repo.fetch_units.assert_awaited_once_with(2027)

    @pytest.mark.asyncio
    async def test_a_scenario_reads_the_draft_per_weekend_and_the_mirror_never(self) -> None:
        """The lander resolves a scenario exactly as the roster does.

        A `/summary` that still read `lodging_assignments` under a scenario
        would report a family placed while the page it links to shows them
        unplaced -- the two disagreeing by resolving the scenario differently
        rather than by drifting apart in code.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026, scenario="scn_1")

        assert repo.fetch_assignments.await_count == 0
        assert repo.fetch_draft_assignments.await_count == 2

    @pytest.mark.asyncio
    async def test_the_summary_reads_no_second_availability_layer(self) -> None:
        """`build_summary` has its OWN TaskGroup, and that is the whole point.

        Fixing `build_roster` and leaving this one is the obvious half-fix --
        the two methods carry parallel blocks that must be edited separately --
        and this is the test that catches it. One availability read per
        weekend, with or without a scenario.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026, scenario="scn123")

        assert repo.fetch_availability.await_count == 2
        assert repo.fetch_scenario_availability.await_count == 0

    @pytest.mark.asyncio
    async def test_returns_one_entry_per_weekend_carrying_its_identity(self) -> None:
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)

        assert summary.year == 2026
        assert [entry.session.session_cm_id for entry in summary.weekends] == [1000001, 1000002]
        assert [entry.session.session_type for entry in summary.weekends] == ["family", "adult"]

    @pytest.mark.asyncio
    async def test_counts_match_what_the_roster_reports_for_the_same_weekend(self) -> None:
        """The lander links to the roster; they must not disagree about it."""
        units = [
            _unit("u1", "ridge-a", "Ridge A", sleeps=5),
            _unit("u2", "wawona", "Wawona", sleeps=7, is_container=True),
        ]
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION], fetch_session=FAMILY_SESSION, fetch_units=units)
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)
        roster = await service.build_roster(2026, 1000001)

        assert summary.weekends[0].counts == roster.counts

    @pytest.mark.asyncio
    async def test_counts_match_the_roster_under_a_scenario_too(self) -> None:
        """The same guarantee, under replace semantics.

        Before the draft layer the two endpoints could only disagree by
        drifting apart in code. They can now disagree by resolving the
        scenario differently, which is a live hazard rather than a
        hypothetical one, so the fixture is built so that ONE of them falling
        back to the mirror changes the number: the Johnson household is placed
        in the mirror and absent from the draft, the Garcia household is the
        other way round. Under replace, both endpoints must count exactly one
        assigned party -- an overlay would count two.
        """
        units = [
            _unit("u1", "ridge-a", "Ridge A", sleeps=5),
            _unit("u2", "ridge-b", "Ridge B", sleeps=4),
        ]
        mirror = [
            _rec(
                household_cm_id=2000001,
                person_cm_id=0,
                units=["u1"],
                expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]},
            ),
        ]
        draft = [
            _rec(
                household_cm_id=2000002,
                person_cm_id=0,
                units=["u2"],
                expand={"units": [_rec(id="u2", code="ridge-b", name="Ridge B")]},
            ),
        ]
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_session=FAMILY_SESSION,
            fetch_units=units,
            fetch_households={"hh_1": _household(), "hh_2": _household("hh_2", 2000002, "The Garcia Family")},
            fetch_attendees_for_session=[
                _child(),
                _child(cm_id=1000002, first="Liam", last="Garcia", household_pb_id="hh_2"),
            ],
            fetch_assignments=mirror,
            fetch_draft_assignments=draft,
            fetch_availability=[_rec(unit="u1", family_available=False)],
        )
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026, scenario="scn_1")
        roster = await service.build_roster(2026, 1000001, scenario="scn_1")

        assert summary.weekends[0].counts == roster.counts
        # The scenario actually moved something, so the equality above is not
        # two identical empty results agreeing with each other -- and 1 rather
        # than 2 is what pins out the mirror.
        assert roster.counts.parties_total == 2
        assert roster.counts.parties_assigned == 1
        assert roster.counts.units_family_available == 1
        assert {p.display_name: p.unit_code for p in roster.parties} == {
            "The Johnson Family": "",
            "The Garcia Family": "ridge-b",
        }

    @pytest.mark.asyncio
    async def test_a_year_with_no_weekends_does_no_year_scoped_work(self) -> None:
        repo = _repo(fetch_weekend_sessions=[])
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)

        assert summary.weekends == []
        assert repo.fetch_units.await_count == 0


class TestShareEligibility:
    """The board places on ELIGIBILITY, not on the registration gate.

    Share intent lives in two CampMinder fields asked at different times, and
    staff treat the later Family Camp information form as authoritative. The
    resolution is done once, in the Go ingest, so this layer only READS it --
    the same one-writer rule that keeps `preference` from being recomputed.

    Measured on 2026 family-camp attendees, reading the gate instead of the
    eligibility is wrong both ways: 3 households said no at registration then
    named a partner (flagged though legitimate), and 51 said yes-or-maybe then
    declined on the form (silent, and read as permissive).
    """

    @pytest.mark.asyncio
    async def test_eligibility_is_read_not_derived_from_the_gate(self) -> None:
        """A no_share gate with a form WITH answer is SHAREABLE.

        The gate stays visible as `preference` because it is what a staff
        member sees when asked why a household is flagged, but it must not
        drive placement.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_attendees_for_session=[_child()],
            fetch_households={"hh_1": _household()},
            fetch_family_camp_registrations={
                "hh_1": _rec(
                    share_cabin_gate="no_share",
                    wants_with=True,
                    share_eligibility="named",
                    share_eligibility_source="form",
                    share_answers_conflict=True,
                )
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert share.preference == "no_share", "the raw gate stays visible"
        assert share.eligibility == "named", "the form outranks the gate"
        assert share.eligibility_source == "form"
        assert share.answers_conflict is True

    @pytest.mark.asyncio
    async def test_registration_fallback_is_marked_provisional(self) -> None:
        """No form answer falls back to the gate, and says that it did.

        The fallback verdict is provisional -- the household has not answered
        the authoritative question -- so the surface must be able to tell the
        two apart rather than presenting both as settled.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_attendees_for_session=[_child()],
            fetch_households={"hh_1": _household()},
            fetch_family_camp_registrations={
                "hh_1": _rec(
                    share_cabin_gate="maybe_mutual",
                    share_eligibility="named",
                    share_eligibility_source="registration",
                    share_answers_conflict=False,
                )
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert share.eligibility == "named"
        assert share.eligibility_source == "registration"
        assert share.answers_conflict is False

    @pytest.mark.asyncio
    async def test_absent_columns_read_as_unknown_never_as_open(self) -> None:
        """An unpopulated column is UNKNOWN, which never consents.

        These columns are written by family_camp_derived, so on any database
        that has not re-run it they are empty. Empty must fall to the safe
        side: `unknown` places as no-share. Defaulting to `open` would let the
        board green-light every household on a stale database.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_attendees_for_session=[_child()],
            fetch_households={"hh_1": _household()},
            fetch_family_camp_registrations={"hh_1": _rec(share_cabin_gate="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert share.eligibility == "unknown"
        assert share.eligibility_source == "none"
        assert share.answers_conflict is False

    @pytest.mark.asyncio
    async def test_adult_weekend_parties_carry_no_eligibility(self) -> None:
        """Adult weekends have no share question AT ALL, so nothing is claimed.

        The fields are partition ["Camper"] and no Adult-Share field exists;
        28 of 29 adult-only households are blank on registration and none
        answered the form. A person-grain party therefore gets the default
        summary, and `unknown` is the honest value -- the board must not read
        a household's family-camp answers onto an adult attendee, since those
        may belong to a different weekend and different people.
        """
        repo = _repo(
            fetch_session=ADULT_SESSION,
            fetch_attendees_for_session=[_child()],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000002)

        share = roster.parties[0].share
        assert share.eligibility == "unknown"
        assert share.eligibility_source == "none"


class TestPartySortName:
    """A household's display_name is a mailing title, so it cannot be the sort key.

    "The Johnson Family" would file under T. sort_name carries the surname the
    list actually needs, read from the ENROLLED CHILD's `last_name` column.

    There used to be a rung above it reading `family_camp_adults.last_name`.
    kindred#1945 retired it: that column is dead upstream. Its two CampMinder
    source fields (`Family Camp-P1/P2 Last Name`) have carried nothing since
    2022, so the column holds 0 of 834 rows in 2026 and 2 rows a year in
    2023-2025. The rung could not fire, and the child rung it shadowed reads a
    column that is actually populated.
    """

    @pytest.mark.asyncio
    async def test_household_sorts_under_the_enrolled_childs_surname(self) -> None:
        # The adults carry a `last_name` that DISAGREES with the child, so the
        # two rungs give different answers and the test pins which one wins.
        # A fixture where they agreed would pass against either implementation.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Johnson Family")},
            fetch_attendees_for_session=[_child(first="Emma", last="Johnson")],
            fetch_family_camp_adults={
                "hh_1": [
                    _rec(
                        adult_number=2,
                        name="Noah Garcia",
                        first_name="Noah",
                        last_name="Garcia",
                        relationship_to_camper="Parent",
                    ),
                    _rec(
                        adult_number=1,
                        name="Liam Silva",
                        first_name="Liam",
                        last_name="Silva",
                        relationship_to_camper="Parent",
                    ),
                ]
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        # NOT "Silva" (adult 1's dead column) and NOT "Garcia" (adult 2's).
        assert roster.parties[0].sort_name == "Johnson"

    @pytest.mark.asyncio
    async def test_the_adults_are_name_only_which_is_productions_actual_shape(self) -> None:
        """Adults 3-5 carry ONLY the combined `name`; 1-2 usually do too.

        first_name/last_name are empty for 100% of adult_number 3-5 rows in
        every measured year, so this fixture is the common case, not an edge.
        The sort key still has to come out right.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child(first="Olivia", last="Chen")],
            fetch_family_camp_adults={
                "hh_1": [
                    _rec(
                        adult_number=1,
                        name="Sofia Chen",
                        first_name="",
                        last_name="",
                        relationship_to_camper="Parent",
                    ),
                    _rec(
                        adult_number=3,
                        name="Mateo Rivera",
                        first_name="",
                        last_name="",
                        relationship_to_camper="Grandparent",
                    ),
                ]
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert roster.parties[0].sort_name == "Chen"
        assert [a.display_name for a in roster.parties[0].adults] == ["Sofia Chen", "Mateo Rivera"]

    @pytest.mark.asyncio
    async def test_falls_back_to_the_enrolled_child_when_no_adult_has_a_surname(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Sam Family")},
            fetch_attendees_for_session=[_child(first="Riley", last="Sam")],
            fetch_family_camp_adults={},
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert roster.parties[0].sort_name == "Sam"

    @pytest.mark.asyncio
    async def test_last_resort_is_the_display_names_last_token(self) -> None:
        # No adults, and a child whose person row carries no last_name at all.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="Household of Olivia Chen")},
            fetch_attendees_for_session=[_child(first="Olivia", last="")],
            fetch_family_camp_adults={},
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert roster.parties[0].sort_name == "Chen"

    @pytest.mark.asyncio
    async def test_last_resort_yields_family_for_a_real_mailing_title(self) -> None:
        # The rung above uses a title that happens to END in a surname. The
        # shape RosterParty.sort_name's own comment names as production's does
        # not: CampMinder's mailing_title is "The Chen Family", whose last
        # token is "Family". So the last resort files every household that
        # reaches it under F, not under its surname.
        #
        # Pinned rather than fixed. Since kindred#1945 retired the dead adult
        # rung this is the ONLY rung below the child's `last_name`, so it is
        # worth saying how rare it is rather than leaving that implied: every
        # household party has an enrolled child by construction
        # (`_build_household_parties` iterates them), and measured against
        # production ZERO rostered households in any year 2022-2026 lack a
        # child surname. Nothing reaches this rung today, and the pair still
        # tie-break on display_name. Recorded here so the rung's real output is
        # on the page instead of implied by a kinder fixture.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child(first="Olivia", last="")],
            fetch_family_camp_adults={},
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert roster.parties[0].sort_name == "Family"

    @pytest.mark.asyncio
    async def test_adult_weekend_person_sorts_under_their_own_surname(self) -> None:
        person = _rec(
            cm_id=1000002,
            first_name="Liam",
            last_name="Garcia",
            preferred_name="",
            age=41,
            grade=0,
            household="",
        )
        repo = _repo(
            fetch_session=ADULT_SESSION,
            fetch_attendees_for_session=[_rec(person_id=1000002, expand={"person": person})],
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000002)

        assert roster.parties[0].sort_name == "Garcia"

    @pytest.mark.asyncio
    async def test_roster_is_ordered_by_surname_not_by_mailing_title(self) -> None:
        # THE defect. The two titles are chosen so the orderings DISAGREE:
        # by surname it is Chen then Johnson, by mailing title it is "Johnson
        # Household" then "The Chen Family". A pair that sorted the same either
        # way would pass against the bug and pin nothing.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={
                "hh_1": _household(pb_id="hh_1", cm_id=2000001, title="Johnson Household"),
                "hh_2": _household(pb_id="hh_2", cm_id=2000002, title="The Chen Family"),
            },
            fetch_attendees_for_session=[
                _child(cm_id=1000001, first="Emma", last="Johnson", household_pb_id="hh_1"),
                _child(cm_id=1000002, first="Olivia", last="Chen", household_pb_id="hh_2"),
            ],
            fetch_family_camp_adults={},
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert [p.sort_name for p in roster.parties] == ["Chen", "Johnson"]

    @pytest.mark.asyncio
    async def test_board_order_across_the_three_adult_shapes(self) -> None:
        """BOARD SORT ORDER IS VISIBLE OUTPUT -- pin it across every adult shape.

        The three households cover what `family_camp_adults` actually contains:
        name-only rows (all of adults 3-5, and most of 1-2), first+last rows
        (the adults 1-2 tail), and no adult row at all. Retiring the dead
        `last_name` rung changes the answer for exactly the middle one, so the
        surnames are chosen to make that a REORDER rather than a relabel: under
        the old chain hh_2 filed under "Rivera" and the order was
        Adams/Johnson/Rivera.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={
                "hh_1": _household(pb_id="hh_1", cm_id=2000001, title="The Johnson Family"),
                "hh_2": _household(pb_id="hh_2", cm_id=2000002, title="The Chen Family"),
                "hh_3": _household(pb_id="hh_3", cm_id=2000003, title="The Adams Family"),
            },
            fetch_attendees_for_session=[
                _child(cm_id=1000001, first="Emma", last="Johnson", household_pb_id="hh_1"),
                _child(cm_id=1000002, first="Olivia", last="Chen", household_pb_id="hh_2"),
                _child(cm_id=1000003, first="Noah", last="Adams", household_pb_id="hh_3"),
            ],
            fetch_family_camp_adults={
                # Name-only: the shape 100% of adults 3-5 arrive in.
                "hh_1": [
                    _rec(
                        adult_number=1,
                        name="Sofia Silva",
                        first_name="",
                        last_name="",
                        relationship_to_camper="Parent",
                    ),
                ],
                # first + last populated, and DISAGREEING with the child.
                "hh_2": [
                    _rec(
                        adult_number=1,
                        name="Mateo Rivera",
                        first_name="Mateo",
                        last_name="Rivera",
                        relationship_to_camper="Parent",
                    ),
                ],
                # hh_3 has no adult row at all.
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert [p.sort_name for p in roster.parties] == ["Adams", "Chen", "Johnson"]
        assert [p.household_cm_id for p in roster.parties] == [2000003, 2000002, 2000001]

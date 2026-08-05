"""LodgingRosterService assembly rules.

Domain facts these tests pin down:
  * Family camp enrols only CHILDREN, so a party is a household and its
    adults come from family_camp_adults.
  * Adult weekends enrol individuals, so a party is a person.
  * Container units are in the payload but never in a capacity count.
  * sleeps = 0 is UNKNOWN, so it is neither summed nor rendered.
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
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.lodging_roster_service import LodgingRosterService, SessionNotFoundError


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
        expand={"area": _rec(code="RIDGE", name="Ridge Side", sort_order=1)},
    )


def _repo(**overrides: Any) -> MagicMock:
    """A repository mock with empty defaults; override only what a test needs."""
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_weekend_sessions": [],
        "fetch_session": None,
        "fetch_units": [],
        "fetch_availability": [],
        "fetch_assignments": [],
        # The scenario layer. Only read when a scenario is asked for, which is
        # itself asserted below -- no scenario must cost no extra fetches.
        "fetch_draft_assignments": [],
        "fetch_attendees_for_session": [],
        "fetch_households": {},
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
    age: int = 9,
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
        """Units became year-scoped in 1500000140.

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
    list actually needs, read from last_name COLUMNS -- family_camp_adults
    populates first/last only for adults 1-2, which is exactly the range the
    adult rungs look at.
    """

    @pytest.mark.asyncio
    async def test_household_sorts_under_adult_ones_surname(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Johnson Family")},
            fetch_attendees_for_session=[_child()],
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
                        name="Emma Johnson",
                        first_name="Emma",
                        last_name="Johnson",
                        relationship_to_camper="Parent",
                    ),
                ]
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        # Adult 1 wins even though adult 2 is listed first in the payload.
        assert roster.parties[0].sort_name == "Johnson"

    @pytest.mark.asyncio
    async def test_falls_back_to_a_later_adult_when_adult_one_has_no_surname(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Chen Family")},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [
                    _rec(
                        adult_number=1,
                        name="Olivia",
                        first_name="Olivia",
                        last_name="",
                        relationship_to_camper="Parent",
                    ),
                    _rec(
                        adult_number=2,
                        name="Liam Chen",
                        first_name="Liam",
                        last_name="Chen",
                        relationship_to_camper="Parent",
                    ),
                ]
            },
        )
        service = LodgingRosterService(repo)

        roster = await service.build_roster(2026, 1000001)

        assert roster.parties[0].sort_name == "Chen"

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
        # Pinned rather than fixed. This rung is reached only when NO adult and
        # NO child on the party carries a last_name, and family_camp_adults
        # populates those columns for adults 1-2 — so it is the rare tail, and
        # the pair still tie-break on display_name. Recorded here so the rung's
        # real output is on the page instead of implied by a kinder fixture.
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

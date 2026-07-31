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
    allocation_default: str = "family_pool",
    is_active: bool = True,
    is_confirmed: bool = True,
    bathroom: str = "none",
    bathroom_group: str = "",
) -> SimpleNamespace:
    return _rec(
        id=pb_id,
        code=code,
        name=name,
        sleeps=sleeps,
        is_container=is_container,
        allocation_default=allocation_default,
        is_active=is_active,
        is_confirmed=is_confirmed,
        bathroom=bathroom,
        bathroom_group=bathroom_group,
        near_bathhouse=False,
        has_power=False,
        has_ac=False,
        has_fridge=False,
        is_accessible=False,
        map_x=0.5,
        map_y=0.5,
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
        "count_unconfirmed_units": 0,
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


class TestUnitsAndCounts:
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
    async def test_reserved_units_stay_visible_but_leave_availability(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "le-shack", "Le Shack", sleeps=4, allocation_default="staff_default"),
            ],
            fetch_availability=[_rec(unit="u1", state="reserved_staff", note="Program director")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].reservation_state == "reserved_staff"
        assert by_code["ridge-a"].is_family_available is False
        assert by_code["le-shack"].is_family_available is False
        assert roster.counts.units_total == 2
        assert roster.counts.units_family_available == 0
        assert roster.counts.units_reserved == 2
        assert roster.counts.beds_family_available == 0

    @pytest.mark.asyncio
    async def test_staff_default_released_to_family_counts_as_available(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "manzanita-7", "New Trailer (Manzanitas)", sleeps=4, allocation_default="staff_default")
            ],
            fetch_availability=[_rec(unit="u1", state="released_to_family", note="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_family_available == 1
        assert roster.counts.beds_family_available == 4

    @pytest.mark.asyncio
    async def test_unresolved_alias_and_unconfirmed_counts_are_surfaced(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            count_open_unresolved_aliases=3,
            count_unconfirmed_units=6,
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.unresolved_aliases == 3
        assert roster.counts.units_unconfirmed == 6

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
                    unit="u1",
                    merge="",
                    expand={"unit": _rec(code="ridge-a", name="Ridge A")},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.unit_code == "ridge-a"
        assert party.unit_name == "Ridge A"
        assert party.is_merged_slot is False
        assert roster.counts.parties_assigned == 1
        assert roster.counts.parties_unassigned == 0

    @pytest.mark.asyncio
    async def test_merge_assignment_uses_the_merge_display_name(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Garcia Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Liam", last="Garcia")],
            fetch_assignments=[
                _rec(
                    household_cm_id=2000001,
                    person_cm_id=0,
                    unit="",
                    merge="mrg_1",
                    expand={"merge": _rec(display_name="Wawona")},
                ),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.unit_name == "Wawona"
        assert party.is_merged_slot is True

    @pytest.mark.asyncio
    async def test_orphaned_assignment_leaves_the_party_unassigned(self) -> None:
        """lodging_assignments.unit is optional, so deleting the unit returns
        204 and leaves the row pointing at nothing. That is not a placement."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_assignments=[
                _rec(household_cm_id=2000001, person_cm_id=0, unit="", merge="", expand={}),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].unit_code == ""
        assert roster.counts.parties_assigned == 0
        assert roster.counts.parties_unassigned == 1


class TestMedicalFlagsAndNarrative:
    @pytest.mark.asyncio
    async def test_medical_narrative_presence_becomes_a_flag_only(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Smith Family")},
            fetch_attendees_for_session=[_child(cm_id=1000001, first="Noah", last="Smith", age=12, grade=7)],
            fetch_family_camp_registrations={"hh_1": _rec(needs_power=True)},
            fetch_family_camp_medical={"hh_1": _rec(cpap_info="Uses a CPAP nightly and needs an outlet")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        party = roster.parties[0]
        assert party.flags.has_medical_narrative is True
        assert party.flags.needs_power is True
        # The narrative itself must not appear anywhere in the payload.
        assert "CPAP nightly" not in roster.model_dump_json()

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
        assert flags.has_medical_narrative is True

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
    async def test_blank_medical_row_is_not_a_narrative(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_medical={"hh_1": _rec(cpap_info="", allergy_info="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].flags.has_medical_narrative is False

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

    It exists for one reason: `build_roster` makes eleven fetches of which
    eight are year-scoped, so filling a lander weekend-by-weekend repeats that
    year-wide work once per weekend. The point of these tests is that the
    batch does it ONCE and still agrees with the roster.
    """

    @pytest.mark.asyncio
    async def test_year_scoped_reads_happen_once_for_the_whole_year(self) -> None:
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        service = LodgingRosterService(repo)

        await service.build_summary(2026)

        # Eight year-scoped fetches, two weekends: each must still be one call.
        for method in (
            "fetch_units",
            "fetch_households",
            "fetch_prior_household_cm_ids",
            "fetch_family_camp_adults",
            "fetch_family_camp_registrations",
            "fetch_family_camp_medical",
            "count_open_unresolved_aliases",
            "count_unconfirmed_units",
        ):
            assert getattr(repo, method).await_count == 1, f"{method} was not batched"

    @pytest.mark.asyncio
    async def test_session_scoped_reads_happen_once_per_weekend(self) -> None:
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])
        service = LodgingRosterService(repo)

        await service.build_summary(2026)

        for method in ("fetch_availability", "fetch_assignments", "fetch_attendees_for_session"):
            assert getattr(repo, method).await_count == 2, f"{method} should be per-weekend"

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
    async def test_a_year_with_no_weekends_does_no_year_scoped_work(self) -> None:
        repo = _repo(fetch_weekend_sessions=[])
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)

        assert summary.weekends == []
        assert repo.fetch_units.await_count == 0

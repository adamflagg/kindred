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

import asyncio
import logging
from datetime import date
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from api.schemas.lodging import LodgingUnitSummary
from api.services.lodging_repository import RequestValueRow
from api.services.lodging_roster_service import (
    SUMMARY_ENTRY_CONCURRENCY,
    LodgingRosterService,
    SessionNotFoundError,
    _BathroomIndex,
    write_in_covers,
)


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
    shareability: str = "",
    has_power: bool = False,
    # False builds the default RIDGE area (honouring `area_sort_order`); True
    # resolves the expanded `area` relation to None -- the missing-area case.
    area_missing: bool = False,
    area_sort_order: int = 1,
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
        has_power=has_power,
        has_ac=False,
        has_fridge=False,
        is_accessible=False,
        map_x=map_x,
        map_y=map_y,
        default_combined=default_combined,
        parent_unit=parent_unit,
        # Blank by default: the migration leaves an unclassifiable row empty
        # rather than guessing, so "" is a state the service really sees.
        shareability=shareability,
        expand={"area": None if area_missing else _rec(code="RIDGE", name="Ridge Side", sort_order=area_sort_order)},
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
        # Write-in OCCUPANCY, split out of `lodging_availability` by
        # kindred#2382. Empty by default -- most weekends have no write-in at
        # all, and that must be the shape the board sees.
        "fetch_write_ins": [],
        # The scenario half of the same split (kindred#2382, PR 3). A request
        # naming a scenario reads THIS instead of `fetch_write_ins` and
        # REPLACES it -- see TestAScenariosWriteInsReplaceTheLiveOnes. Empty by
        # default for the same reason its live sibling is.
        "fetch_draft_write_ins": [],
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
        # kindred#2075: last year's staff-written cabin string, keyed by
        # household CampMinder id. Empty by default -- most families have no
        # prior-year cabin, and that must be the shape the card sees.
        "fetch_cabin_assignments_by_household_cm_id": {},
        # kindred#2073's three cross-year reads, for ONE household. Empty by
        # default -- a first-time family is the shape the journey must handle,
        # and a bare MagicMock would return an un-awaitable attribute instead
        # of failing where the mistake is.
        "fetch_household_family_attendees": [],
        "fetch_household_adults_by_year": {},
        "fetch_household_registration_years": set(),
        "fetch_family_camp_adults": {},
        "fetch_family_camp_registrations": {},
        # kindred#2330: the RAW per-field, per-child request answers, keyed by
        # household PB id. Empty by default -- 112 of 382 rostered 2026
        # households have no free-text signal at all, and that must be the
        # shape the panel sees.
        "fetch_request_text_values": {},
        "fetch_family_camp_medical": {},
        # The medical read takes one household, not the whole-year maps above.
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
    birthdate: str = "",
) -> SimpleNamespace:
    person = _rec(
        cm_id=cm_id,
        first_name=first,
        last_name=last,
        preferred_name="",
        age=age,
        grade=grade,
        household=household_pb_id,
        # The bed-exemption input (kindred#2046). Blank by default because
        # most fixtures here do not care -- and a blank one must keep its
        # bed, which is itself pinned below.
        birthdate=birthdate,
    )
    return _rec(person_id=cm_id, expand={"person": person})


def _adult(
    adult_number: int = 1,
    name: str = "Olivia Johnson",
    first_name: str = "",
    last_name: str = "",
    relationship: str = "Parent",
) -> SimpleNamespace:
    return _rec(
        adult_number=adult_number,
        name=name,
        first_name=first_name,
        last_name=last_name,
        relationship_to_camper=relationship,
    )


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
        small tail of rows. Re-measured directly against production
        2026-08-09: of the 382 rostered family households, 376 have at least
        one non-blank `name` and 6 do not. This fallback rescues 5 of those 6
        -- taking coverage to 381/382 -- and is the only thing that renders
        any adult at all for them. (An earlier version of this docstring said
        377 and 5; the number was never re-measured after the cohort was
        corrected.) Deleting it in the name of "name is authoritative" would
        blank real adults off the board.
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
    async def test_a_child_carries_its_structured_last_name_not_just_a_display_name(self) -> None:
        """kindred#2180: the board names a family from its children's surnames.

        `display_name` is `preferred_or_first + ' ' + last_name`, so splitting
        the trailing token back off it is the wrong surname for every child
        whose `last_name` itself contains a space -- 32 of 2026's 680 distinct
        rostered children, measured against production 2026-08-09. The client
        cannot recover the surname from the string, so the surname travels as
        its own field.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(first="Ava", last="Martinez Garcia")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        child = roster.parties[0].children[0]
        assert child.display_name == "Ava Martinez Garcia"
        assert child.last_name == "Martinez Garcia"

    @pytest.mark.asyncio
    async def test_a_child_with_no_last_name_on_file_sends_an_empty_surname(self) -> None:
        """Not the display name, and not a guess. No 2026 rostered child has a
        blank `last_name` (0 of 680), but the schema default has to be the
        honest empty string so the client's "every child shares one surname"
        test cannot pass on a household it knows nothing about.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(first="Ava", last="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        child = roster.parties[0].children[0]
        assert child.display_name == "Ava"
        assert child.last_name == ""

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
    async def test_last_year_cabin_comes_from_the_directly_prior_year(self) -> None:
        """kindred#2075, ruled Option A: the DIRECTLY prior year, like summer.

        `year - 1` is computed here and nowhere else -- the repository read
        takes a plain year so kindred#2073 can sweep 2022-2025 with it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Garcia Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Liam", last="Garcia")],
            fetch_prior_household_cm_ids={2000001},
            fetch_cabin_assignments_by_household_cm_id={2000001: "Cedar Lodge - Room 2"},
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].last_year_cabin == "Cedar Lodge - Room 2"
        repo.fetch_cabin_assignments_by_household_cm_id.assert_awaited_once_with(2025)

    @pytest.mark.asyncio
    async def test_a_household_with_no_prior_year_cabin_carries_an_empty_string(self) -> None:
        """The COMMON case, and it must render as nothing at all.

        202 of 2026's 459 registered households have no 2025 cabin -- a
        first-timer, a family who skipped a year, or anyone whose last visit
        predates 2022 (`cabin_assignment` is blank on all 1,433 rows from
        2017-2021). None of those is "nobody assigned them", so the field
        stays empty and the card prints no placeholder.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household(title="The Johnson Family")},
            fetch_attendees_for_session=[_child(cm_id=1000002, first="Noah", last="Johnson")],
            # Returning -- but the prior year they were here is not 2025.
            fetch_prior_household_cm_ids={2000001},
            fetch_cabin_assignments_by_household_cm_id={2000777: "Pine Cabin"},
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].is_returning is True
        assert roster.parties[0].last_year_cabin == ""

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
    async def test_area_sort_order_travels_from_the_expanded_area_to_the_summary(self) -> None:
        """kindred#2076: the board keys area order off the Manage screen's
        rank, which lives on the expanded `area.sort_order` column. It never
        reached the payload before this -- see `LodgingUnitSummary`.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", area_sort_order=7),
                _unit("u2", "cedar-a", "Cedar A", area_sort_order=2),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].area_sort_order == 7
        assert by_code["cedar-a"].area_sort_order == 2

    @pytest.mark.asyncio
    async def test_a_unit_with_no_expanded_area_reports_zero_sort_order(self) -> None:
        """No `area` relation resolves (a dangling or unset link) means the
        service has nothing to rank by -- 0, the schema default, same
        treatment `area_code`/`area_name` already give a missing area.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", area_missing=True)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].area_sort_order == 0

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
    async def test_a_write_in_on_a_building_reaches_the_rooms_beneath_it(self) -> None:
        # THE WIRING, not the resolver -- `TestWriteInCovers` pins the rule
        # itself. This is the pass that puts the answer on the payload, and it
        # is a SECOND pass over the summaries for a reason: a unit's cover can
        # come from a row on a unit built after it, so there is no single order
        # in which one pass sees every own-row it needs.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "House", is_container=True, default_combined=True),
                _unit("u2", "house-a", "House A", sleeps=4, parent_unit="u1"),
            ],
            # kindred#2382: occupancy lives in `lodging_write_ins` now. The row
            # is the same row -- unit, occupant, note -- moved out of the
            # boolean it used to share with the staff<->family role.
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="Back Monday")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        # The room holds no row of its own -- and is closed all the same.
        assert by_code["house-a"].family_available_override is None
        assert by_code["house-a"].write_in is not None
        assert by_code["house-a"].write_in.unit_id == "u1"
        assert by_code["house-a"].write_in.occupant_name == "Liam Garcia"
        assert by_code["house-a"].write_in.note == "Back Monday"
        # And the building still reads as its own, so the card that holds the
        # row does not start attributing it elsewhere.
        assert by_code["house"].write_in is not None
        assert by_code["house"].write_in.unit_code == "house"

    @pytest.mark.asyncio
    async def test_a_write_in_on_a_room_reaches_the_building_over_it(self) -> None:
        # The mirror, through the same pass: merge a building over a
        # written-into room and the room stops being drawn, so without this the
        # building's card said nothing about the caretaker in it.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "House", is_container=True, default_combined=True),
                _unit("u2", "house-a", "House A", sleeps=4, parent_unit="u1"),
            ],
            fetch_write_ins=[_rec(unit="u2", occupant_name="Ava Martinez", note="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["house"].write_in is not None
        assert by_code["house"].write_in.unit_id == "u2"
        assert by_code["house"].write_in.occupant_name == "Ava Martinez"

    @pytest.mark.asyncio
    async def test_an_ordinary_open_cabin_carries_no_cover_at_all(self) -> None:
        # The common case by far, and the one that must stay None: a cover on
        # every unit would close the whole board.
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].write_in is None

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


class TestShareabilityPassthrough:
    """kindred#2026. The unit's classification is READ, never re-derived here.

    The registry is canonical (`feedback_registry_no_silent_fallback`): the
    rule that produces `shareable` / `single_party` lives in exactly two
    places, the migration backfill and the Go loader, and this layer must not
    grow a third copy that could disagree with the stored column. So the only
    thing worth pinning here is that the value arrives intact and that an
    unclassified row surfaces as `unknown` rather than being guessed into
    either real answer.
    """

    @pytest.mark.asyncio
    async def test_the_stored_classification_reaches_the_payload(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=15, shareability="shareable"),
                _unit("u2", "hc-upstairs-1", "Upstairs 1", sleeps=4, shareability="single_party"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].shareability == "shareable"
        assert by_code["hc-upstairs-1"].shareability == "single_party"

    @pytest.mark.asyncio
    async def test_an_unclassified_row_reads_unknown_not_a_guess(self) -> None:
        """An empty column is the ONE case a read-time default would be
        tempting, and the one where it would do the damage: `sleeps` 15 is
        exactly the shape the rule calls shareable, so a service that
        re-derived would answer `shareable` here off a column nobody set.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=15, shareability="")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].shareability == "unknown"

    @pytest.mark.asyncio
    async def test_an_unrecognised_stored_value_reads_unknown_not_permissive(self) -> None:
        """A select gains values over time and a stale API build must not fail
        open. Anything this layer does not recognise degrades to `unknown`,
        the non-permissive state, rather than raising or passing through into
        a Literal the frontend has no branch for.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=15, shareability="two_parties_max")],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].shareability == "unknown"


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
        repo.fetch_slot_merges.assert_awaited_once_with(2026, 1000001, "")

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
    async def test_a_write_in_surfaces_its_occupant_name_beside_the_note(self) -> None:
        """kindred#2078: a hold IS a write-in, and a write-in has an occupant.

        `occupant_name` is its own column, translated nowhere -- unlike `note`,
        which the API renames to `reason` on the way out. The two travel
        together so the card can print the occupant as a NAME and keep the
        note as the note.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[
                _rec(unit="u1", family_available=False, note="Kitchen lead, Fri-Sun", occupant_name="Emma Johnson")
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-a"].occupant_name == "Emma Johnson"
        assert by_code["ridge-a"].reason == "Kitchen lead, Fri-Sun"

    @pytest.mark.asyncio
    async def test_a_unit_with_no_availability_row_names_no_occupant(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].occupant_name == ""

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
        repository call and is what `Permission.BUNKING_MANAGE` actually guards
        (kindred#2312 retargeted the gate from the now-removed `lodging.phi`).
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

    It exists for one reason: `build_roster` makes twelve fetches of which
    seven are year-scoped, so filling a lander weekend-by-weekend repeats that
    year-wide work once per weekend. The point of these tests is that the
    batch does it ONCE and still agrees with the roster.

    Both counts were one lower until kindred#2075 added last year's cabins,
    and one higher again before that until kindred#1889 removed the whole-year
    medical read from both paths. The lander batches SIX of the seven -- see
    `test_the_lander_never_reads_last_years_cabins` for the one it declines.
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
    async def test_the_lander_never_reads_last_years_cabins(self) -> None:
        """kindred#2075's read belongs to the ROSTER, not the lander.

        `build_summary` shares `_build_parties`, but it keeps only
        `_build_counts`' numbers off the result -- no `WeekendSummaryEntry`
        carries a party. Fetching a whole prior year of registrations and
        households to fill a field nothing reads would put the cost back that
        kindred#1963 bought out.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026)

        repo.fetch_cabin_assignments_by_household_cm_id.assert_not_called()

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

    @pytest.mark.asyncio
    async def test_per_weekend_fan_out_is_bounded_by_a_semaphore(self) -> None:
        """kindred#1920: `_entry` must not run unboundedly for every weekend at once.

        12 weekends (2026's real count) each open a `TaskGroup` of four
        concurrent reads inside `_entry`. Uncapped, that is 48 simultaneous
        `asyncio.to_thread` calls sharing one executor. This pins the ACTUAL
        bound -- peak concurrent `_entry` bodies in flight -- rather than
        merely asserting a `Semaphore` object exists, which would pin nothing
        (a `Semaphore(9999)` would satisfy that check and cap nothing real).
        """
        sessions = [
            _rec(
                id=f"sess_{i}",
                cm_id=1000000 + i,
                name=f"Weekend {i}",
                session_type="family",
                year=2026,
                start_date="2026-09-04",
                end_date="2026-09-07",
                sort_order=i,
            )
            for i in range(12)
        ]
        repo = _repo(fetch_weekend_sessions=sessions)

        concurrency = {"current": 0, "peak": 0}

        async def _tracked_fetch_availability(*_args: Any, **_kwargs: Any) -> list[Any]:
            concurrency["current"] += 1
            concurrency["peak"] = max(concurrency["peak"], concurrency["current"])
            # Cede control so overlapping `_entry` calls actually interleave --
            # without a yield point, cooperative scheduling would never let a
            # second `_entry` start before the first one finishes.
            await asyncio.sleep(0.01)
            concurrency["current"] -= 1
            return []

        repo.fetch_availability = AsyncMock(side_effect=_tracked_fetch_availability)

        await LodgingRosterService(repo).build_summary(2026)

        assert concurrency["peak"] <= SUMMARY_ENTRY_CONCURRENCY, (
            f"peak concurrent weekend entries ({concurrency['peak']}) exceeded the bound ({SUMMARY_ENTRY_CONCURRENCY})"
        )
        # Not a tautology: with 12 weekends and a bound below 12, the fan-out
        # must actually have been throttled at some point, not merely never
        # have reached the cap by coincidence.
        assert concurrency["peak"] == SUMMARY_ENTRY_CONCURRENCY

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


class TestTheRosterNamesTheWeekendByItsCampMinderId:
    """kindred#2042: the four lodging reads key on `session_cm_id`.

    `build_roster` and `build_summary` each carry their OWN TaskGroup issuing
    the same four lodging reads, so re-keying one and not the other is the
    obvious half-fix -- the same shape `test_the_summary_reads_no_second_availability_layer`
    guards against. Both are pinned here.

    `fetch_attendees_for_session` is deliberately still passed the PocketBase
    record id: `attendees` is not a lodging table and has no `session_cm_id`
    column to key on.
    """

    @pytest.mark.asyncio
    async def test_build_roster_passes_the_campminder_id_to_the_lodging_reads(self) -> None:
        repo = _repo(fetch_session=FAMILY_SESSION)

        await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        repo.fetch_availability.assert_awaited_once_with(2026, 1000001)
        repo.fetch_draft_assignments.assert_awaited_once_with(2026, 1000001, "scn_1")
        repo.fetch_slot_merges.assert_awaited_once_with(2026, 1000001, "scn_1")
        repo.fetch_attendees_for_session.assert_awaited_once_with(2026, "sess_1")

    @pytest.mark.asyncio
    async def test_build_roster_without_a_scenario_reads_the_mirror_by_campminder_id(self) -> None:
        repo = _repo(fetch_session=FAMILY_SESSION)

        await LodgingRosterService(repo).build_roster(2026, 1000001)

        repo.fetch_assignments.assert_awaited_once_with(2026, 1000001)

    @pytest.mark.asyncio
    async def test_build_summary_passes_each_weekends_own_campminder_id(self) -> None:
        """Two weekends, two different CampMinder ids -- not one repeated.

        `_entry` runs per session, so reading the id off the wrong record
        would report both weekends against the first one's placements.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026)

        assert sorted(call.args[1] for call in repo.fetch_availability.await_args_list) == [1000001, 1000002]
        assert sorted(call.args[1] for call in repo.fetch_assignments.await_args_list) == [1000001, 1000002]
        assert sorted(call.args[1] for call in repo.fetch_slot_merges.await_args_list) == [1000001, 1000002]


class TestPartySizeIsABedCount:
    """`party_size` counts BEDS, not bodies (kindred#1925 + kindred#2046).

    Two independent corrections to the same expression, one per term:

    * ADULTS -- a `family_camp_adults` slot only counts when the load-bearing
      `name`/`first+last` coalesce yields a name that is not blank and not a
      placeholder. Measured on 2026's 382 rostered households: 3 blank rows
      and 2 placeholder rows (`NA`, `0`) were being counted as people, and
      both placeholders were RENDERED on the family card -- staff were
      looking at an adult called "NA".
    * CHILDREN -- a child under 18 months at session start travels in a cot
      or shares with a parent, so consumes no bed (owner ruling). Derived
      from `persons.birthdate` against `camp_sessions.start_date`, never from
      `persons.age`.

    Because the chip is now beds rather than names, the card deliberately
    shows one fewer than the people it prints for the 24 households with an
    infant. That two-numbers split is kindred#2152's, not this layer's: the
    payload keeps every adult row it always did, placeholders included, and
    only the COUNT changes here.
    """

    @staticmethod
    async def _party(**repo_overrides: Any) -> Any:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            **repo_overrides,
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)
        assert len(roster.parties) == 1
        return roster.parties[0]

    @pytest.mark.asyncio
    async def test_placeholder_adult_name_is_not_a_bed(self) -> None:
        party = await self._party(
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [_adult(1, "Olivia Johnson"), _adult(2, "NA")],
            },
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_placeholder_adult_row_is_still_in_the_payload(self) -> None:
        """The COUNT drops it; the payload does not.

        Provenance stays server-side so the board can explain itself, and the
        frontend applies the SAME predicate at render time
        (`householdIdentity.isAttendingAdultName`). Filtering the row out here
        instead would leave the two surfaces unable to disagree only because
        one of them had been blinded.
        """
        party = await self._party(
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [_adult(1, "Olivia Johnson"), _adult(2, "NA")],
            },
        )
        assert [a.display_name for a in party.adults] == ["Olivia Johnson", "NA"]

    @pytest.mark.asyncio
    async def test_a_zero_in_the_name_column_is_not_a_bed(self) -> None:
        party = await self._party(
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson"), _adult(3, "0")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_a_blank_adult_slot_is_not_a_bed(self) -> None:
        """`family_camp_adults` leaves an unused slot blank rather than
        omitting the row, so `len(adults)` counted furniture."""
        party = await self._party(
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={
                "hh_1": [_adult(1, "Olivia Johnson"), _adult(2, "", "", ""), _adult(3, "   ")],
            },
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_the_coalesce_still_feeds_the_count(self) -> None:
        """A row blank in `name` but populated in first/last is a real adult
        and a real bed -- 196 such rows across 2022-2026 (kindred#1945)."""
        party = await self._party(
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={"hh_1": [_adult(1, "", "Olivia", "Johnson")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_a_child_under_eighteen_months_consumes_no_bed(self) -> None:
        # 2025-04-04 is 17 months before the 2026-09-04 session start.
        party = await self._party(
            fetch_attendees_for_session=[
                _child(cm_id=1, first="Emma", age=9, birthdate="2016-05-01"),
                _child(cm_id=2, first="Liam", age=1.05, birthdate="2025-04-04"),
            ],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert len(party.children) == 2
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_a_child_of_exactly_eighteen_months_keeps_its_bed(self) -> None:
        """The cutoff is `< 18`, not `<= 18`."""
        party = await self._party(
            fetch_attendees_for_session=[_child(cm_id=2, age=1.06, birthdate="2025-03-04")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_the_last_month_counts_only_once_it_has_finished(self) -> None:
        """Born 2025-03-10, session starts 2026-09-04: eighteen calendar
        months have been ENTERED but only seventeen completed, so the child is
        still exempt. Dropping the day-of-month adjustment ages every child
        born after the session's day-of-month by a month.
        """
        party = await self._party(
            fetch_attendees_for_session=[_child(cm_id=2, age=1.05, birthdate="2025-03-10")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert party.party_size == 1

    @pytest.mark.asyncio
    async def test_a_nineteen_month_old_keeps_its_bed_despite_the_yy_mm_trap(self) -> None:
        """THE TRAP kindred#2046 exists to stop being re-introduced.

        This child's `persons.age` is 1.07 -- CampMinder's `yy.mm`, meaning
        one year seven months. Every naive threshold spelled against that
        column (`age < 1.5`, and any decimal-years reading of it) discounts
        this child, because months never exceed `.11` so `1.5` is really "24
        months". The owner's ruling is 18 months and this child is 19.
        """
        party = await self._party(
            fetch_attendees_for_session=[_child(cm_id=2, age=1.07, birthdate="2025-02-04")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_the_unknown_age_sentinel_keeps_its_bed(self) -> None:
        """`persons.age == 0.0` is the UNKNOWN-AGE sentinel, and a bed is
        never removed on the strength of a sentinel. The birthdate here says
        one month old; the sentinel outranks it, and the party keeps the bed.
        Measured on 2026: exactly one rostered child is in this state, which
        is why the derived rule discounts 24 households and not 25.
        """
        party = await self._party(
            fetch_attendees_for_session=[_child(cm_id=2, age=0.0, birthdate="2026-08-01")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_a_child_with_no_birthdate_keeps_its_bed(self) -> None:
        """Coverage is 100% on the rostered cohort, so this is a guard rather
        than a live case -- and it fails toward the bed, which is the safe
        direction for a capacity read."""
        party = await self._party(
            fetch_attendees_for_session=[_child(cm_id=2, age=0.05, birthdate="")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        assert party.party_size == 2

    @pytest.mark.asyncio
    async def test_an_unreadable_session_start_keeps_every_bed(self) -> None:
        repo = _repo(
            fetch_session=_rec(
                id="sess_1",
                cm_id=1000001,
                name="Family Camp 1",
                session_type="family",
                year=2026,
                start_date="",
                end_date="",
                sort_order=1,
            ),
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(cm_id=2, age=0.05, birthdate="2026-08-01")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)
        assert roster.parties[0].party_size == 2

    @pytest.mark.asyncio
    async def test_an_unreadable_session_start_says_so_out_loud(self, caplog: pytest.LogCaptureFixture) -> None:
        """The discount switching itself off must not be silent.

        `_build_parties` takes `session_start` as a REQUIRED keyword precisely
        so a caller that omitted it would raise rather than "stop discounting
        on every weekend at once with nothing to notice" -- its own comment.
        An unreadable `start_date` produces the identical outage from the DATA
        side, and the keyword guard cannot see it: every party on the weekend
        quietly keeps its infant bed and the board looks ordinary. One
        WARNING per roster build, bounded, is the whole cost of noticing.

        Deliberately NOT extended to a child's missing `birthdate`: that fails
        one bed at a time toward keeping it, and coverage on the rostered
        cohort is 100%. This one fails a whole weekend.
        """
        repo = _repo(
            fetch_session=_rec(
                id="sess_1",
                cm_id=1000001,
                name="Family Camp 1",
                session_type="family",
                year=2026,
                start_date="not-a-date",
                end_date="",
                sort_order=1,
            ),
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(cm_id=2, age=0.05, birthdate="2026-08-01")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        with caplog.at_level(logging.WARNING, logger="api.services.lodging_roster_service"):
            roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].party_size == 2
        warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("infant" in message and "start_date" in message for message in warnings), warnings

    @pytest.mark.asyncio
    async def test_a_readable_session_start_warns_about_nothing(self, caplog: pytest.LogCaptureFixture) -> None:
        """The mutation guard on the test above: a warning on the ordinary
        path would be noise on every weekend and would stop being read."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        with caplog.at_level(logging.WARNING, logger="api.services.lodging_roster_service"):
            await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING] == []

    @pytest.mark.asyncio
    async def test_a_timestamped_session_start_is_read_as_a_date(self) -> None:
        """PocketBase hands dates back as `YYYY-MM-DD HH:MM:SS.mmmZ`."""
        repo = _repo(
            fetch_session=_rec(
                id="sess_1",
                cm_id=1000001,
                name="Family Camp 1",
                session_type="family",
                year=2026,
                start_date="2026-09-04 07:00:00.000Z",
                end_date="2026-09-07 07:00:00.000Z",
                sort_order=1,
            ),
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child(cm_id=2, age=1.05, birthdate="2025-04-04")],
            fetch_family_camp_adults={"hh_1": [_adult(1, "Olivia Johnson")]},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)
        assert roster.parties[0].party_size == 1

    @pytest.mark.asyncio
    async def test_the_summary_lander_dates_every_weekend_it_builds(self) -> None:
        """`build_summary` shares `_build_parties` with `build_roster`, so it
        must supply the SAME as-of date -- its own weekend's start, not the
        first one it happened to fetch.

        The lander publishes counts rather than parties, so there is no bed
        figure in its response to assert against; this pins the wiring at the
        seam instead. A summary that passed `None` would silently stop
        discounting infants on every weekend at once.
        """
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION],
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )
        service = LodgingRosterService(repo)
        with patch.object(LodgingRosterService, "_build_parties", return_value=[]) as build_parties:
            await service.build_summary(2026)

        seen = {call.kwargs["session_start"] for call in build_parties.call_args_list}
        assert seen == {date(2026, 9, 4), date(2026, 10, 10)}


class TestUnitPowerCoverage:
    """kindred#1912 -- `LodgingUnitSummary.power_coverage`, resolved over LEAF
    descendants rather than read off the row.

    A container's stored amenity flags describe the CONTAINER, not its rooms:
    the same shape as the settled "a container's `sleeps` is a delta" ruling,
    on a different column. Twelve of the fourteen 2026 family-pool containers
    record `has_power = 0` while every leaf beneath them has power, so reading
    the row marks twelve entirely-powered buildings unpowered.

    Computed here rather than stored, because the admin panels write
    `lodging_units` straight to PocketBase from the browser
    (`frontend/src/services/lodgingCrud.ts`), bypassing FastAPI entirely -- a
    stored `effective_has_power` would have no recompute trigger on the one
    path that actually edits amenities.
    """

    @pytest.mark.asyncio
    async def test_a_leaf_answers_for_itself(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-1", "Ridge 1", sleeps=4, has_power=True),
                _unit("u2", "ridge-2", "Ridge 2", sleeps=4, has_power=False),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["ridge-1"].power_coverage == "all"
        assert by_code["ridge-2"].power_coverage == "none"

    @pytest.mark.asyncio
    async def test_a_container_inherits_from_its_rooms_not_its_own_row(self) -> None:
        """The 12-of-14 trap. The building records no power; every room has it."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=False),
                _unit("u1", "gt-lodge-1", "Lodge 1", sleeps=4, has_power=True, parent_unit="c1"),
                _unit("u2", "gt-lodge-2", "Lodge 2", sleeps=4, has_power=True, parent_unit="c1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["gt-lodge"].power_coverage == "all"
        assert by_code["gt-lodge"].has_power is False

    @pytest.mark.asyncio
    async def test_it_resolves_to_leaves_at_any_depth_never_direct_children(self) -> None:
        """The `hc-health-center` shape, which is why one level is not enough.

        The building's two direct children are themselves containers recording
        no power, and every leaf beneath THEM has power. A one-level walk
        answers "none" here -- wrong in the direction that looks plausible.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "hc-block", "Health Block", is_container=True, has_power=False),
                _unit("c2", "hc-wing-a", "Wing A", is_container=True, has_power=False, parent_unit="c1"),
                _unit("c3", "hc-wing-b", "Wing B", is_container=True, has_power=False, parent_unit="c1"),
                _unit("u1", "hc-a-1", "A1", sleeps=2, has_power=True, parent_unit="c2"),
                _unit("u2", "hc-b-1", "B1", sleeps=2, has_power=True, parent_unit="c3"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.code: u.power_coverage for u in roster.units}["hc-block"] == "all"

    @pytest.mark.asyncio
    async def test_a_split_building_is_some_not_all_or_none(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=True),
                _unit("u1", "gt-lodge-1", "Lodge 1", sleeps=4, has_power=True, parent_unit="c1"),
                _unit("u2", "gt-lodge-2", "Lodge 2", sleeps=4, has_power=False, parent_unit="c1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.code: u.power_coverage for u in roster.units}["gt-lodge"] == "some"

    @pytest.mark.asyncio
    async def test_an_unconfirmed_room_is_unknown_not_unmet(self) -> None:
        """`has_power = False` on an unconfirmed row means "nobody has said"."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-1", "Ridge 1", sleeps=4, is_confirmed=False, has_power=False)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].power_coverage == "unknown"

    @pytest.mark.asyncio
    async def test_one_unconfirmed_room_makes_the_whole_building_unknown(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=True),
                _unit("u1", "gt-lodge-1", "Lodge 1", sleeps=4, has_power=True, parent_unit="c1"),
                _unit("u2", "gt-lodge-2", "Lodge 2", sleeps=4, has_power=True, is_confirmed=False, parent_unit="c1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.code: u.power_coverage for u in roster.units}["gt-lodge"] == "unknown"

    @pytest.mark.asyncio
    async def test_a_deactivated_room_does_not_answer_for_the_building(self) -> None:
        """Nobody can be placed in it, so it cannot supply the building's
        power -- the same `is_active` filter `_effective_sleeps` applies when
        totalling a combined container's rooms."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=False),
                _unit("u1", "gt-lodge-1", "Lodge 1", sleeps=4, has_power=True, parent_unit="c1"),
                _unit("u2", "gt-lodge-2", "Lodge 2", sleeps=4, has_power=False, is_active=False, parent_unit="c1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.code: u.power_coverage for u in roster.units}["gt-lodge"] == "all"

    @pytest.mark.asyncio
    async def test_a_building_with_no_active_room_left_is_unknown_never_its_own_row(self) -> None:
        """The degenerate case, ruled the same way `_effective_sleeps` rules it.

        `_effective_sleeps` refuses to answer for a container once no active
        room is left to supply the answer -- "0 is not a delta over anything,
        it is the claim 'this house sleeps nobody'". A container's `has_power`
        is the same kind of value: THIRTEEN of the fifteen 2026 containers
        record `has_power = 0` while their rooms are powered, so falling back
        to the row here would take the one field this whole function exists to
        distrust and turn it into "nothing here has power" -- a hatch stating
        a fact no row supports, in the plausible-looking direction.

        A LEAF is different and still answers for itself: it has no rooms to
        inherit from, so its own row is the only fact there is.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=False),
                _unit("u1", "gt-lodge-1", "Lodge 1", sleeps=4, has_power=True, is_active=False, parent_unit="c1"),
            ],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert {u.code: u.power_coverage for u in roster.units}["gt-lodge"] == "unknown"

    @pytest.mark.asyncio
    async def test_a_container_that_never_had_rooms_is_unknown_too(self) -> None:
        """Same rule, reached without anyone retiring anything."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("c1", "gt-lodge", "Lodge", is_container=True, has_power=False)],
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].power_coverage == "unknown"


def _journey_repo(**overrides: Any) -> MagicMock:
    """A repository mock for the household journey's three cross-year reads.

    `fetch_cabin_assignments_by_household_cm_id` is the ONE read the journey
    still issues per year (kindred#2075's helper, whose year is the
    parameter), so it is mocked as a per-year MAP that a `side_effect` serves
    -- the plain `_repo` default returns the same dict for every year, which
    would make the whole housing-state derivation untestable.
    """
    cabins_by_year: dict[int, dict[int, str]] = overrides.pop("cabins_by_year", {})
    # kindred#2420: each traced year's `camp_sessions` rows, so the journey
    # can derive that year's age at ITS OWN family session start rather than
    # publishing `persons.age` (a live attribute) unchanged. Empty by
    # default -- a test that does not care gets no session for any year,
    # which is the `as_of=None` / "keep the stored value" path and matches
    # every pre-existing journey fixture here.
    weekend_sessions_by_year: dict[int, list[Any]] = overrides.pop("weekend_sessions_by_year", {})
    repo = _repo(**overrides)

    async def _cabins(year: int) -> dict[int, str]:
        return cabins_by_year.get(year, {})

    async def _sessions(year: int) -> list[Any]:
        return weekend_sessions_by_year.get(year, [])

    repo.fetch_cabin_assignments_by_household_cm_id = AsyncMock(side_effect=_cabins)
    repo.fetch_weekend_sessions = AsyncMock(side_effect=_sessions)
    return repo


class TestHouseholdJourney:
    """The household's year-over-year record (kindred#2073).

    THE DATA HAS FIVE STATES, NOT TWO, and conflating any pair of them is the
    main risk this view carries. Measured on the production snapshot
    2026-08-09:

    1. 2022-2025 -- housing history exists. 423 households are placed in two
       or more of those four years; that is the population this pays off for.
    2. 2017-2021 -- 1,433 family registrations and ZERO cabin assignments. A
       year with attendance and no cabin is UNKNOWN HOUSING, not "attended,
       unplaced".
    3. 2026 -- about 16% placed. A blank there is a genuine to-do, not a gap
       in the record, and the two must not read alike.
    4. 2020 -- 1,264 family attendee rows and not one with `status_id = 2`.
       The season was cancelled.
    5. 2021 -- no family attendee rows AT ALL despite 247 registrations and 7
       family sessions, while `family_camp_adults` carries 647 rows across 351
       households. So 2021 shows adults and no children.
    """

    @pytest.mark.asyncio
    async def test_a_placed_year_carries_the_staff_written_cabin(self) -> None:
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2025, **vars(_child()))],
            cabins_by_year={2025: {2000001: "Cedar Lodge - Room 2"}},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [y.year for y in journey.years] == [2025]
        assert journey.years[0].housing == "placed"
        assert journey.years[0].cabin_name == "Cedar Lodge - Room 2"

    @pytest.mark.asyncio
    async def test_a_year_nobody_was_placed_in_is_unknown_housing_not_unplaced(self) -> None:
        """State 2. 2017-2021 record no cabin for ANY household, so a blank
        there is a gap in the record and must never be reported as a family
        who went unhoused.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2019, **vars(_child()))],
            cabins_by_year={},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert journey.years[0].housing == "unknown"
        assert journey.years[0].cabin_name == ""

    @pytest.mark.asyncio
    async def test_a_blank_in_a_year_others_were_placed_in_is_not_placed(self) -> None:
        """State 3, and the distinction that is the whole point. The year
        records housing for somebody, so this household's blank is a real
        absence rather than an unrecorded one.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2026, **vars(_child()))],
            cabins_by_year={2026: {2000999: "Pine Cabin"}},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert journey.years[0].housing == "not_placed"
        assert journey.years[0].cabin_name == ""

    @pytest.mark.asyncio
    async def test_a_cancelled_season_leaves_the_year_registered_with_no_enrollment(self) -> None:
        """State 4. Every 2020 attendee row is cancelled, so `status_id = 2`
        removes them all -- the year still happened on the registration and
        must not vanish, and it is not a childless family.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[],
            fetch_household_registration_years={2020},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [y.year for y in journey.years] == [2020]
        assert journey.years[0].enrollment == "none_on_file"
        assert journey.years[0].children == []

    @pytest.mark.asyncio
    async def test_a_year_with_adults_and_no_attendee_rows_still_lists_the_adults(self) -> None:
        """State 5. 2021 has no family attendee rows at all, so the ONLY
        representation of that year's party is `family_camp_adults` -- adults
        who have no `persons` row anywhere.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[],
            fetch_household_adults_by_year={2021: [_adult(name="Olivia Johnson")]},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [y.year for y in journey.years] == [2021]
        assert [a.display_name for a in journey.years[0].adults] == ["Olivia Johnson"]
        assert journey.years[0].enrollment == "none_on_file"

    @pytest.mark.asyncio
    async def test_the_party_is_derived_per_year_never_carried_forward(self) -> None:
        """HOUSEHOLD GRAIN, NOT CAMPER GRAIN. A household's party changes
        composition year to year -- children age out, adults change -- so
        each year's members come from that year's rows and no other's.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[
                _rec(year=2024, **vars(_child(cm_id=1000001, first="Ava", last="Martinez"))),
                _rec(year=2025, **vars(_child(cm_id=1000001, first="Ava", last="Martinez"))),
                _rec(year=2025, **vars(_child(cm_id=1000002, first="Liam", last="Martinez"))),
            ],
            fetch_household_adults_by_year={2025: [_adult(name="Sofia Martinez")]},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        by_year = {y.year: y for y in journey.years}
        assert [c.display_name for c in by_year[2024].children] == ["Ava Martinez"]
        assert by_year[2024].adults == []
        assert sorted(c.display_name for c in by_year[2025].children) == ["Ava Martinez", "Liam Martinez"]
        assert [a.display_name for a in by_year[2025].adults] == ["Sofia Martinez"]

    @pytest.mark.asyncio
    async def test_a_child_enrolled_in_two_weekends_of_one_year_is_listed_once(self) -> None:
        """A JOURNEY ROW IS A YEAR, NOT A SESSION, and this is the seam where
        that stops being a wording point.

        A family can book two of a season's weekends, which gives one child
        TWO enrolled family attendee rows in the same year -- both expanding
        to the same `persons` record, because `persons` is per-year rather
        than per-enrollment. Measured on the production snapshot 2026-08-09:
        every year from 2017 on has some, 9 to 20 children a year, across 64
        distinct (household, year) pairs. One household alone lists three
        children in 2026 and five attendee rows for them.

        Collecting per attendee row therefore prints the child twice, adds
        them twice to the modal's headcount, and renders two <li>s under one
        `person_cm_id` React key. Dedupe on the CampMinder person id, which is
        the identity the wire already keys the child by.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[
                _rec(year=2026, **vars(_child(cm_id=1000001, first="Emma", last="Johnson", age=9))),
                _rec(year=2026, **vars(_child(cm_id=1000001, first="Emma", last="Johnson", age=9))),
                _rec(year=2026, **vars(_child(cm_id=1000002, first="Liam", last="Johnson", age=7))),
            ],
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [c.person_cm_id for c in journey.years[0].children] == [1000001, 1000002]

    @pytest.mark.asyncio
    async def test_years_run_newest_first_and_span_every_trace(self) -> None:
        """The window is DISCOVERED, not chosen. A hard-coded floor would
        either invent empty rows or truncate a long-standing family, and the
        three traces disagree about which years exist -- attendance reaches
        further back than housing, and registration reaches years that carry
        neither a child nor an adult.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2018, **vars(_child()))],
            fetch_household_adults_by_year={2021: [_adult()]},
            fetch_household_registration_years={2024},
            cabins_by_year={2024: {2000001: "Pine Cabin"}},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [y.year for y in journey.years] == [2024, 2021, 2018]

    @pytest.mark.asyncio
    async def test_the_cabin_read_is_issued_once_per_traced_year(self) -> None:
        """Composes kindred#2075's helper rather than writing a second
        housing query, and never at a hard-coded year: the helper takes a
        plain year precisely so this can sweep. It is asked only about years
        the household actually appears in.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[
                _rec(year=2024, **vars(_child())),
                _rec(year=2025, **vars(_child())),
            ],
        )

        await LodgingRosterService(repo).build_household_journey(2000001)

        asked = sorted(call.args[0] for call in repo.fetch_cabin_assignments_by_household_cm_id.await_args_list)
        assert asked == [2024, 2025]

    @pytest.mark.asyncio
    async def test_a_household_with_no_trace_at_all_returns_no_years(self) -> None:
        """Empty is a legitimate answer -- a first-time family -- and must be
        an empty list rather than a fabricated current-year row.
        """
        journey = await LodgingRosterService(_journey_repo()).build_household_journey(2000001)

        assert journey.household_cm_id == 2000001
        assert journey.years == []

    @pytest.mark.asyncio
    async def test_a_blank_adult_slot_is_published_unfiltered(self) -> None:
        """Same contract as the roster's own party (kindred#1925/#2046): the
        server publishes every `family_camp_adults` row and only the COUNT is
        filtered, so the client can still see what was declined. The client
        applies `isAttendingAdultName` at render time.
        """
        repo = _journey_repo(
            fetch_household_adults_by_year={2025: [_adult(name="Olivia Johnson"), _adult(adult_number=2, name="NA")]},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert [a.display_name for a in journey.years[0].adults] == ["Olivia Johnson", "NA"]

    @pytest.mark.asyncio
    async def test_children_carry_the_structured_surname_the_naming_rule_reads(self) -> None:
        """kindred#2180 put `last_name` on the wire because the family label
        is built from the children's deduplicated surnames, and splitting the
        trailing token off `display_name` is the wrong surname for the 4.7% of
        children whose own last_name contains a space. The journey's heading
        takes the UNION of these across years, so it needs the same column.
        """
        repo = _journey_repo(
            fetch_household_family_attendees=[
                _rec(year=2025, **vars(_child(first="Ava", last="Martinez Garcia"))),
            ],
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        child = journey.years[0].children[0]
        assert child.display_name == "Ava Martinez Garcia"
        assert child.last_name == "Martinez Garcia"

    @pytest.mark.asyncio
    async def test_an_unresolvable_household_is_an_empty_journey_not_a_query(self) -> None:
        """`_build_household_parties` gives an unresolvable household
        `household_cm_id = 0`; a journey for it must read nothing.
        """
        repo = _journey_repo()

        journey = await LodgingRosterService(repo).build_household_journey(0)

        assert journey.years == []
        repo.fetch_cabin_assignments_by_household_cm_id.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_historical_years_age_is_the_childs_age_that_year_not_today_kindred_2420(self) -> None:
        """The regression pin for kindred#2420.

        `persons.age` is CampMinder's LIVE attribute, mirrored verbatim
        whenever the sync last touched the row -- not "age as of that
        year's season", however plausible a stored number looks on its own.
        A fixture whose stored `age` is a PLAUSIBLE-BUT-WRONG "today's age"
        must still render the age computed at that YEAR's own family-camp
        session start -- asserting on the stored value would re-pin the bug
        this issue fixes (kindred#2420's acceptance condition 5).

        Ava Chen, born 2010-08-01: the 2019 family session started
        2019-07-05, four weeks before her ninth birthday, so she was
        completed-8-years-11-months old that week -- nowhere near the
        `age=17.04` the fixture's `persons` row carries (a later sync's
        snapshot of her CURRENT age).
        """
        session_2019 = _rec(
            id="sess_2019",
            cm_id=3000001,
            name="Family Camp 1",
            session_type="family",
            year=2019,
            start_date="2019-07-05",
            end_date="2019-07-08",
            sort_order=1,
        )
        child = _child(cm_id=1000001, first="Ava", last="Chen", age=17.04, birthdate="2010-08-01")
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2019, **vars(child))],
            weekend_sessions_by_year={2019: [session_2019]},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert journey.years[0].children[0].age == 8.11

    @pytest.mark.asyncio
    async def test_a_historical_child_with_no_birthdate_shows_no_age_kindred_2420(self) -> None:
        """Acceptance condition 3: a child with no usable birthdate must
        show NO age for a historical year, rather than falling back to the
        stale stored value (which is exactly the bug being fixed) or
        crashing on an unparseable date.
        """
        session_2019 = _rec(
            id="sess_2019",
            cm_id=3000001,
            name="Family Camp 1",
            session_type="family",
            year=2019,
            start_date="2019-07-05",
            end_date="2019-07-08",
            sort_order=1,
        )
        child = _child(cm_id=1000001, age=17.04, birthdate="")
        repo = _journey_repo(
            fetch_household_family_attendees=[_rec(year=2019, **vars(child))],
            weekend_sessions_by_year={2019: [session_2019]},
        )

        journey = await LodgingRosterService(repo).build_household_journey(2000001)

        assert journey.years[0].children[0].age is None


class TestWriteInCovers:
    """Which space a write-in closes, once the tree is taken into account.

    THE UNIT A ROW NAMES IS NOT THE ONLY SPACE IT CLOSES. A write-in is a fact
    about a physical space, and a building's space contains its rooms'. The
    board draws whichever level the tree currently resolves to (`drawn_units`),
    and merging or splitting moves that level under staff's feet -- so a
    write-in recorded on a merged building went silent the moment somebody
    split it, and one recorded on a room said nothing on the building's card
    after a merge. Both left the same hole: a family could be dropped into a
    space somebody is already sleeping in.

    Resolved on READ rather than cascaded on write. Writing a row per leaf
    would duplicate a single fact across rows that then drift -- clear one room
    and the others still close the space -- and would leave orphans behind a
    re-merge. There is still exactly ONE row; this decides which units it
    covers.

    Fictional data throughout.
    """

    @staticmethod
    def _unit(code: str, **kwargs: Any) -> LodgingUnitSummary:
        return LodgingUnitSummary(unit_id=f"id-{code}", code=code, name=code.title(), **kwargs)

    @staticmethod
    def _written(*codes: str) -> frozenset[str]:
        """The `lodging_write_ins` rows, as the ids the walk is handed.

        WHICH UNITS HOLD A WRITE-IN IS AN INPUT since kindred#2382, not a value
        read off the summary. It used to be `family_available_override is
        False`, which was the only spelling occupancy had while it shared one
        boolean with the staff<->family role; the two are separate tables now,
        so the walk is given the occupancy source directly.
        """
        return frozenset(f"id-{code}" for code in codes)

    def test_a_room_inherits_the_write_in_of_the_building_above_it(self) -> None:
        # The SPLIT case. Staff wrote into the whole house while it was merged,
        # then split it back to rooms: the row still names the house, which now
        # has no card at all.
        house = self._unit(
            "house",
            is_container=True,
            occupant_name="Liam Garcia",
            reason="Back Monday",
        )
        room = self._unit("house-a", parent_code="house")

        covers = write_in_covers([house, room], self._written("house"))

        assert covers["house-a"].unit_code == "house"
        assert covers["house-a"].occupant_name == "Liam Garcia"
        assert covers["house-a"].note == "Back Monday"

    def test_a_building_surfaces_the_write_in_of_a_room_beneath_it(self) -> None:
        # The MERGE case, and the mirror of the one above: the row names a room
        # that stopped being drawn when staff merged the building over it.
        house = self._unit("house", is_container=True, is_combined=True)
        written_room = self._unit("house-a", parent_code="house", occupant_name="Liam Garcia")
        other_room = self._unit("house-b", parent_code="house")

        covers = write_in_covers([house, written_room, other_room], self._written("house-a"))

        assert covers["house"].unit_code == "house-a"
        assert covers["house"].occupant_name == "Liam Garcia"

    def test_a_sibling_room_is_not_covered(self) -> None:
        # The one direction that must NOT propagate. A caretaker in room A says
        # nothing about room B, and closing B too would take a lettable room
        # off the board for no reason. It reaches B's BUILDING (above) without
        # reaching B, because each unit resolves from OWN rows only -- never
        # transitively through a cover it just computed for somebody else.
        house = self._unit("house", is_container=True)
        written_room = self._unit("house-a", parent_code="house", occupant_name="Liam Garcia")
        other_room = self._unit("house-b", parent_code="house")

        covers = write_in_covers([house, written_room, other_room], self._written("house-a"))

        assert "house-b" not in covers
        assert covers["house"].unit_code == "house-a"

    def test_a_units_own_write_in_beats_an_inherited_one(self) -> None:
        house = self._unit("house", is_container=True, occupant_name="Liam Garcia")
        room = self._unit("house-a", parent_code="house", occupant_name="Ava Martinez")

        covers = write_in_covers([house, room], self._written("house", "house-a"))

        assert covers["house-a"].unit_code == "house-a"
        assert covers["house-a"].occupant_name == "Ava Martinez"

    def test_the_nearest_ancestor_wins(self) -> None:
        block = self._unit("block", is_container=True, occupant_name="Ava Martinez")
        house = self._unit(
            "house",
            parent_code="block",
            is_container=True,
            occupant_name="Liam Garcia",
        )
        room = self._unit("house-a", parent_code="house")

        covers = write_in_covers([block, house, room], self._written("block", "house"))

        assert covers["house-a"].unit_code == "house"

    def test_a_release_is_not_a_write_in(self) -> None:
        # A ROLE release is a staff cabin OPENED to families for the weekend. It
        # names no occupant and closes nothing, so it must not travel:
        # inheriting it would silently open every room beneath a released
        # building. It lives in `lodging_availability` and never appears in the
        # occupancy set at all, which is what makes that structural rather than
        # a branch somebody can forget.
        house = self._unit("house", is_container=True, inventory_class="staff_default", family_available_override=True)
        room = self._unit("house-a", parent_code="house")

        covers = write_in_covers([house, room], self._written())

        assert covers == {}

    def test_a_bare_false_override_with_no_write_in_row_covers_nothing(self) -> None:
        """The classification guard, and the reason the walk stopped reading it.

        `family_available_override is False` was the old predicate. After
        kindred#2382's split it means only "this unit is closed this weekend",
        which a ROLE row can say without naming anybody -- and a cover built
        from one would have the board print an occupant that exists in no row.
        1500000162 leaves no such row behind and no writer creates another, so
        this is bad data meeting the rule, not a state the product can reach.
        """
        house = self._unit("house", is_container=True, family_available_override=False)
        room = self._unit("house-a", parent_code="house")

        assert write_in_covers([house, room], self._written()) == {}

    def test_a_unit_with_nothing_on_its_path_is_absent(self) -> None:
        assert write_in_covers([self._unit("cedar-1")], self._written()) == {}

    def test_a_parent_cycle_does_not_hang(self) -> None:
        # The server guards against writing one (#1899), but a cycle already in
        # the data must not spin the roster build.
        a = self._unit("a", parent_code="b", is_container=True)
        b = self._unit("b", parent_code="a", is_container=True)

        # Nobody is written in, so every cover the walks could return is the
        # product of the cycle rather than of a row -- an empty map is the only
        # right answer, and reaching it at all means both guards fired. Without
        # them this hangs rather than failing.
        assert write_in_covers([a, b], self._written()) == {}

    def test_a_blank_coded_unit_never_lends_its_cover_to_another(self) -> None:
        # "" is the same key `parent_code == ""` uses for "no parent", which is
        # why `by_code` drops a blank-coded unit on the LOOKUP side. The result
        # map has to drop it too, or two blank-coded rows share one key and the
        # second reads the first's occupant off a row it does not hold.
        #
        # A blank code is a valid if unfortunate registry value, so this is bad
        # data meeting a collision, not a state the schema forbids.
        written = self._unit("", occupant_name="Liam Garcia")
        other = LodgingUnitSummary(unit_id="id-other", code="", name="Other")

        assert write_in_covers([written, other], self._written("")) == {}

    def test_several_written_rooms_pick_one_deterministically(self) -> None:
        # A building over two written-into rooms is closed either way; the
        # point is that two identical payloads never disagree about WHICH row
        # the card names, which a set-ordered walk would not guarantee.
        house = self._unit("house", is_container=True, is_combined=True)
        room_b = self._unit("house-b", parent_code="house", occupant_name="Ava Martinez")
        room_a = self._unit("house-a", parent_code="house", occupant_name="Liam Garcia")
        written = self._written("house-a", "house-b")

        assert write_in_covers([house, room_b, room_a], written)["house"].unit_code == "house-a"
        assert write_in_covers([house, room_a, room_b], written)["house"].unit_code == "house-a"


class TestWriteInsResolveFromTheirOwnTable:
    """Write-in OCCUPANCY is read from `lodging_write_ins`, not from availability.

    kindred#2382, PR 2 of 4. `lodging_availability.family_available` answered
    two unrelated questions through one boolean: `true` on a staff cabin is a
    staff<->family ROLE override for the weekend, `false` was an occupancy --
    somebody is in the room. The owner ruled the ROLE is NOT scenario-scoped
    while an occupancy IS, so the two facts are split apart and each scoped on
    its own terms.

    This class pins the READ half of the split at BEHAVIOURAL PARITY: the board
    looks and behaves exactly as it did, and the only thing that moved is which
    table the occupancy came out of. PR 4 then disentangled the boolean itself
    -- see TestTheWireStopsSpellingAnOccupancyAsFamilyAvailableFalse -- so
    `family_available_override` reports the ROLE row alone and
    `is_family_available` is where the two facts meet.

    Fictional data throughout.
    """

    @pytest.mark.asyncio
    async def test_a_write_in_row_closes_the_unit_and_names_its_occupant(self) -> None:
        """The whole read, on one unit, with availability holding nothing.

        The row that used to live in `lodging_availability` with
        `family_available = false` now lives here, and every field the card
        reads still arrives: the unit is closed, the occupant is named, and the
        note travels beside it under the API's `reason` name.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="Back Monday")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        assert unit.occupant_name == "Liam Garcia"
        assert unit.reason == "Back Monday"
        # The unit holds no `lodging_availability` row, so it reports no ROLE
        # override -- the write-in says nothing about the staff<->family
        # question. `is_family_available` is where the two facts meet, and it
        # is the number staff read; PR 4 removed the shim that had this field
        # answering both. See TestTheWireStopsSpellingAnOccupancyAsFamilyAvailableFalse.
        assert unit.family_available_override is None
        assert unit.is_family_available is False
        assert unit.write_in is not None
        assert unit.write_in.unit_id == "u1"
        assert unit.write_in.occupant_name == "Liam Garcia"

    @pytest.mark.asyncio
    async def test_a_stale_availability_occupancy_row_no_longer_writes_anybody_in(self) -> None:
        """The other side of the split, and the one a half-fix would miss.

        1500000162 moves every `family_available = false` row out, and no
        writer creates another -- `set_availability` sends an occupancy to the
        write-in table now. So a `false` row surviving in `lodging_availability`
        names nobody: it is a bare ROLE value with no occupant behind it, and
        reading it as a write-in would have the board report an occupant who
        exists in no row anywhere.

        It still CLOSES the unit, because that is what a `false` role says and
        flattening it would silently open a cabin. What it must not do is
        produce a cover.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[_rec(unit="u1", family_available=False, occupant_name="", note="")],
            fetch_write_ins=[],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.units[0].is_family_available is False
        assert roster.units[0].write_in is None

    @pytest.mark.asyncio
    async def test_a_role_release_still_comes_from_availability(self) -> None:
        """The half that does NOT move, stated so a sweep cannot take it too.

        "we're moving staff to X for weekend Y" is an operational fact about
        the weekend, not a modelling choice, so `lodging_availability` keeps it
        and keeps its no-scenario shape -- 1500000135's original reasoning,
        which turns out to be exactly right for this half.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "le-shack", "Le Shack", sleeps=4, inventory_class="staff_default")],
            fetch_availability=[_rec(unit="u1", family_available=True, occupant_name="", note="Director away")],
            fetch_write_ins=[],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        assert unit.family_available_override is True
        assert unit.is_family_available is True
        assert unit.reason == "Director away"
        # A release names no occupant and closes nothing, so it must never
        # resolve to a cover -- inheriting one would silently open every room
        # beneath a released building.
        assert unit.write_in is None

    @pytest.mark.asyncio
    async def test_a_write_in_outranks_a_release_on_the_same_unit(self) -> None:
        """Two rows, two tables, one unit -- and occupancy wins.

        No writer produces this pair (`set_availability` clears the other fact
        on every write), but two staff racing on one cabin can, and the answer
        has to be the safe one: somebody is in the room, so the room is closed.
        Reading the release instead would open a cabin with an occupant in it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "le-shack", "Le Shack", sleeps=4, inventory_class="staff_default")],
            fetch_availability=[_rec(unit="u1", family_available=True, occupant_name="", note="Director away")],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Ava Martinez", note="")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        # The ROLE row still reports what it says (PR 4 stopped this field
        # doubling as the occupancy); the occupancy wins the DERIVED answer,
        # which is the half that keeps the cabin closed.
        assert unit.family_available_override is True
        assert unit.is_family_available is False
        assert unit.occupant_name == "Ava Martinez"
        assert unit.write_in is not None

    @pytest.mark.asyncio
    async def test_the_roster_reads_the_write_in_table_for_this_weekend(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001)

        repo.fetch_write_ins.assert_awaited_once_with(2026, 1000001)

    @pytest.mark.asyncio
    async def test_the_lander_reads_the_write_in_table_once_per_weekend(self) -> None:
        """`build_summary` carries its OWN TaskGroup, which is the whole point.

        Wiring `build_roster` and leaving the lander is the obvious half-fix --
        the two methods hold parallel blocks that must be edited separately --
        and it would put a cabin's write-in on the board while the weekend card
        linking to it still counted the cabin as open.

        THE ARGUMENTS ARE PINNED, not only the count. `build_summary` holds the
        one `year` for the whole sweep and each weekend's OWN CampMinder id, and
        a read keyed on the PocketBase id instead would still be awaited twice
        -- kindred#2042 is exactly the mistake a bare `await_count` waves
        through. `test_the_lander_counts_a_written_into_cabin_as_reserved`
        below is the other half: this pins that the table is ASKED, that one
        pins that the answer is USED.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026)

        assert repo.fetch_write_ins.await_args_list == [call(2026, 1000001), call(2026, 1000002)]
        # The LIVE table, and only it, because this sweep names no scenario --
        # the same line `test_the_mirror_reads_the_live_table_and_never_the_draft`
        # holds for the roster. Two TaskGroups, two places to get it wrong;
        # `test_the_lander_reads_each_weekends_draft_write_ins_in_a_scenario`
        # is this assertion's mirror image.
        assert repo.fetch_draft_write_ins.await_count == 0

    @pytest.mark.asyncio
    async def test_the_lander_counts_a_written_into_cabin_as_reserved(self) -> None:
        """The rows the lander fetches have to REACH `_build_units`.

        Awaiting `fetch_write_ins` and then dropping its result on the floor is
        a half-fix a call-count assertion cannot see, and it is the exact
        failure the comment at that fetch site names: a weekend card reporting
        a written-into cabin as open beside a board that draws it closed.
        Measured -- passing `[]` in place of `write_ins_task.result()` left every
        other test in this file green.

        Pinned against `build_roster`'s own counts rather than against
        literals alone, which is how the lander's contract is already stated in
        `TestBuildSummary` -- the two endpoints link to each other and must
        never disagree about one weekend. The literals are kept beside it so a
        failure says WHICH number moved rather than only that the two differ.
        """
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4),
            ],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="")],
        )
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026)
        roster = await service.build_roster(2026, 1000001)

        counts = summary.weekends[0].counts
        assert counts.units_reserved == 1
        assert counts.units_family_available == 1
        # The written-into cabin's five beds are NOT on offer; only Ridge B's.
        assert counts.beds_family_available == 4
        assert counts == roster.counts

    @pytest.mark.asyncio
    async def test_the_mirror_reads_the_live_table_and_never_the_draft(self) -> None:
        """No scenario means the LIVE board, which is a scope in its own right.

        The other side of `TestAScenariosWriteInsReplaceTheLiveOnes` below: a
        request naming no scenario must not touch the draft table at all, the
        same way it reads `fetch_assignments` rather than
        `fetch_draft_assignments`. Reading both and merging is the overlay
        kindred#1974 deleted for placements and this table never had.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        repo.fetch_write_ins.assert_awaited_once_with(2026, 1000001)
        assert repo.fetch_draft_write_ins.await_count == 0
        assert roster.units[0].write_in is not None

    @pytest.mark.asyncio
    async def test_a_written_into_cabin_is_still_counted_as_reserved(self) -> None:
        """The stats bar must not move. `units_reserved` is the number staff read.

        It is derived from `is_family_available`, which is derived from
        `family_available_override` -- so a write-in that stopped spelling
        itself there would silently return a closed cabin to the open count and
        to `beds_family_available`.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4),
            ],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 2
        assert roster.counts.units_family_available == 1
        assert roster.counts.units_reserved == 1
        assert roster.counts.beds_family_available == 4

    @pytest.mark.asyncio
    async def test_a_write_in_on_a_building_still_reaches_the_rooms_beneath_it(self) -> None:
        """The tree walk is unchanged; only its input moved tables."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "House", is_container=True, default_combined=True),
                _unit("u2", "house-a", "House A", sleeps=4, parent_unit="u1"),
            ],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="Back Monday")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        by_code = {u.code: u for u in roster.units}
        assert by_code["house-a"].family_available_override is None
        assert by_code["house-a"].write_in is not None
        assert by_code["house-a"].write_in.unit_id == "u1"
        assert by_code["house-a"].write_in.occupant_name == "Liam Garcia"
        assert by_code["house-a"].write_in.note == "Back Monday"


class TestTheWireStopsSpellingAnOccupancyAsFamilyAvailableFalse:
    """kindred#2382, PR 4 of 4 -- the COMPAT SHIM comes out.

    PR 2 split the table but deliberately kept the wire conflated: a write-in
    still reported `family_available_override = False`, because
    `is_family_available` -- and through it every count on the stats bar, and
    the board's own forest open-tint -- was derived from that one field. Every
    consumer has since been re-pointed at the occupancy source (`write_in`, and
    `writeInOccupant` on the client), so the field can go back to answering the
    ONE question it is named for.

    | on the wire | what it means now |
    |---|---|
    | `family_available_override` | the staff<->family ROLE row, and nothing else |
    | `write_in` | somebody is in this space -- the occupancy, resolved |
    | `is_family_available` | the DERIVED answer, which still folds both in |

    `is_family_available` is what does not move, and that is the point of the
    class: it is the number staff read, so it stays exactly what it was while
    the two facts underneath it come apart.

    Fictional data throughout.
    """

    @pytest.mark.asyncio
    async def test_a_written_into_unit_reports_no_role_override(self) -> None:
        """A write-in says nothing about the staff<->family role, so it says nothing here.

        The unit holds no `lodging_availability` row at all, and `None` is the
        honest answer for a question nobody has answered -- not `False`, which
        used to mean "somebody is in it" and now would claim a role decision
        that was never made.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="Back Monday")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        assert unit.family_available_override is None
        # THE HALF THAT MUST NOT MOVE. The derived answer still folds the
        # occupancy in, so nothing staff read changes.
        assert unit.is_family_available is False
        assert unit.write_in is not None
        assert unit.occupant_name == "Liam Garcia"

    @pytest.mark.asyncio
    async def test_a_released_cabin_that_is_also_written_into_keeps_its_role_on_the_wire(self) -> None:
        """Two rows, two tables, two answers -- and the wire now carries both.

        REACHABLE WITHOUT A RACE since PR 4. `set_availability` still drops the
        fact it is not writing, but the occupancy drop is scoped to the
        caller's own grain while the role row is shared by every scope: write
        somebody in on the live board, then release the cabin from inside a
        scenario, and the live write-in is still there beside the new role row.
        Two staff racing on one cabin get to the same place.

        The conflated field could only report one of the two and reported the
        occupancy; with the axes apart, the role row is reported as what it is
        AND the derived answer still comes out closed.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "le-shack", "Le Shack", sleeps=4, inventory_class="staff_default")],
            fetch_availability=[_rec(unit="u1", family_available=True, occupant_name="", note="Director away")],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Ava Martinez", note="")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        assert unit.family_available_override is True
        # Occupancy still outranks the role in the DERIVED answer, which is the
        # safe direction: reading the release instead would open a cabin with
        # somebody sleeping in it.
        assert unit.is_family_available is False
        assert unit.write_in is not None

    @pytest.mark.asyncio
    async def test_the_counts_do_not_move_when_the_shim_comes_out(self) -> None:
        """`units_reserved` and `beds_family_available` are what staff read.

        They are derived from `is_family_available`, which used to be derived
        from the conflated boolean. Re-pointing the derivation without keeping
        the occupancy in it would silently return a written-into cabin to the
        open count -- the exact failure the shim was kept to prevent.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4),
            ],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.counts.units_total == 2
        assert roster.counts.units_family_available == 1
        assert roster.counts.units_reserved == 1
        assert roster.counts.beds_family_available == 4

    @pytest.mark.asyncio
    async def test_a_stale_role_false_still_closes_the_unit_and_still_reports_itself(self) -> None:
        """A bare `false` in `lodging_availability` is a ROLE value, and stays one.

        1500000162 moved every occupancy row out and no writer creates another,
        so nothing should carry one -- but a surviving row must not be
        laundered into "no override" either. It reports what it says and closes
        the unit, and it produces no cover, because it names nobody.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_availability=[_rec(unit="u1", family_available=False, occupant_name="", note="")],
            fetch_write_ins=[],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        unit = roster.units[0]
        assert unit.family_available_override is False
        assert unit.is_family_available is False
        assert unit.write_in is None


class TestAScenariosWriteInsReplaceTheLiveOnes:
    """kindred#2382, PR 3 of 4 -- the occupancy half gains its scenario dimension.

    REPLACE, NOT OVERLAY, and that is the whole rule. A request naming a
    scenario reads `lodging_write_ins_draft` and does not read the live table
    at all, exactly as kindred#1974 made a scenario read
    `lodging_assignments_draft` instead of `lodging_assignments`. A unit with
    no draft row holds NO write-in in that scenario, whatever the live board
    says -- the live rows are not consulted, and are not even fetched.

    Two staff members can therefore model the same paper-registered family into
    two different cabins, which is the requirement the owner stated on
    2026-08-15 and the thing a single shared table could not express.

    The seed is what stops a fresh scenario losing the live board's write-ins:
    `copy_from_mirror` and `copy_scenario_to_scenario` both copy them (owner
    ruling, 2026-08-16). That is asserted in test_lodging_write_service.py; the
    reason it is not asserted by rendering the live rows through the gaps HERE
    is that doing so is precisely the fall-through this class forbids.

    Fictional data throughout.
    """

    @pytest.mark.asyncio
    async def test_a_scenario_reads_the_draft_table_and_not_the_live_one(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="")],
        )

        await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        repo.fetch_draft_write_ins.assert_awaited_once_with(2026, 1000001, "scn_1")
        assert repo.fetch_write_ins.await_count == 0

    @pytest.mark.asyncio
    async def test_a_live_write_in_does_not_fall_through_into_a_scenario(self) -> None:
        """The live board holds a write-in; the scenario holds none. The scenario is EMPTY.

        This is the assertion a merge implementation would fail, and the one an
        overlay was always going to get wrong in the safe-looking direction:
        showing the live occupancy in a scenario that never asked for it is
        exactly the shared-table behaviour kindred#2382 exists to end.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_write_ins=[_rec(unit="u1", occupant_name="Liam Garcia", note="Back Monday")],
            fetch_draft_write_ins=[],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        unit = roster.units[0]
        assert unit.write_in is None
        assert unit.family_available_override is None
        assert unit.is_family_available is True
        assert unit.occupant_name == ""

    @pytest.mark.asyncio
    async def test_a_scenarios_own_write_in_closes_the_unit_and_names_its_occupant(self) -> None:
        """Every field the card reads arrives from the draft row, unchanged.

        The positive control for the two assertions above: without it, a
        service that read the draft table and then dropped the rows on the
        floor would pass both.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "ridge-a", "Ridge A", sleeps=5)],
            fetch_write_ins=[],
            fetch_draft_write_ins=[_rec(unit="u1", occupant_name="Olivia Chen", note="Paper registration")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        unit = roster.units[0]
        # No ROLE row anywhere for this unit, so no role override -- the draft
        # write-in answers the occupancy question only (PR 4).
        assert unit.family_available_override is None
        assert unit.is_family_available is False
        assert unit.occupant_name == "Olivia Chen"
        assert unit.reason == "Paper registration"
        assert unit.write_in is not None
        assert unit.write_in.unit_id == "u1"

    @pytest.mark.asyncio
    async def test_two_scenarios_can_write_the_same_family_into_different_cabins(self) -> None:
        """The requirement in one test.

        Owner, 2026-08-15: "we do unfortunately need write in to be scenario
        scoped, not only session scoped, because not all write ins would be for
        staff, some are paper registrations for families coming with no kids."
        A shared table could not express this at all -- the second write would
        collide with the first on `idx_lodging_write_in_unique`.
        """
        units = [
            _unit("u1", "ridge-a", "Ridge A", sleeps=5),
            _unit("u2", "ridge-b", "Ridge B", sleeps=4),
        ]
        service_a = LodgingRosterService(
            _repo(
                fetch_session=FAMILY_SESSION,
                fetch_units=units,
                fetch_draft_write_ins=[_rec(unit="u1", occupant_name="Olivia Chen", note="")],
            )
        )
        service_b = LodgingRosterService(
            _repo(
                fetch_session=FAMILY_SESSION,
                fetch_units=units,
                fetch_draft_write_ins=[_rec(unit="u2", occupant_name="Olivia Chen", note="")],
            )
        )

        roster_a = await service_a.build_roster(2026, 1000001, scenario="scn_a")
        roster_b = await service_b.build_roster(2026, 1000001, scenario="scn_b")

        assert {u.code: u.occupant_name for u in roster_a.units} == {"ridge-a": "Olivia Chen", "ridge-b": ""}
        assert {u.code: u.occupant_name for u in roster_b.units} == {"ridge-a": "", "ridge-b": "Olivia Chen"}

    @pytest.mark.asyncio
    async def test_a_scenarios_write_in_still_covers_the_rooms_beneath_a_building(self) -> None:
        """The cover walk takes the scenario's rows, not the live ones.

        `_resolve_write_in_covers` is fed from whichever source the request
        chose, so a scenario that writes into a building closes the rooms under
        it in THAT scenario. Wiring the fetch and leaving the cover walk on the
        live list is the half-fix this catches.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "house", "House", is_container=True, default_combined=True),
                _unit("u2", "house-a", "House A", sleeps=4, parent_unit="u1"),
            ],
            fetch_write_ins=[],
            fetch_draft_write_ins=[_rec(unit="u1", occupant_name="Olivia Chen", note="Paper registration")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        by_code = {u.code: u for u in roster.units}
        assert by_code["house-a"].write_in is not None
        assert by_code["house-a"].write_in.unit_id == "u1"
        assert by_code["house-a"].write_in.occupant_name == "Olivia Chen"

    @pytest.mark.asyncio
    async def test_the_role_override_is_still_read_from_the_live_table_in_a_scenario(self) -> None:
        """The ROLE half does NOT gain a scenario dimension, by owner ruling.

        "staff vs family_available is not scenario scoped, no, that's more of a
        known 'were moving staff to X for weekend Y'" -- so a release is read
        from `lodging_availability` with no scenario predicate whether or not
        the request names one. Scoping this half too is the mistake
        1500000135's reasoning already argued against.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_units=[_unit("u1", "le-shack", "Le Shack", sleeps=4, inventory_class="staff_default")],
            fetch_availability=[_rec(unit="u1", family_available=True, occupant_name="", note="Director away")],
        )

        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, scenario="scn_1")

        repo.fetch_availability.assert_awaited_once_with(2026, 1000001)
        assert roster.units[0].family_available_override is True
        assert roster.units[0].reason == "Director away"

    @pytest.mark.asyncio
    async def test_the_lander_reads_each_weekends_draft_write_ins_in_a_scenario(self) -> None:
        """`build_summary` carries its OWN TaskGroup -- two places to get this wrong.

        The mirror image of the assertion in
        `test_the_lander_reads_the_write_in_table_once_per_weekend`: wiring
        `build_roster` and leaving the lander would put a scenario's write-in
        on the board while the weekend card linking to it still counted from
        the live table.

        THE ARGUMENTS ARE PINNED, not only the count: the one `year`, each
        weekend's OWN CampMinder id, and the one scenario for the sweep.
        """
        repo = _repo(fetch_weekend_sessions=[FAMILY_SESSION, ADULT_SESSION])

        await LodgingRosterService(repo).build_summary(2026, scenario="scn_1")

        assert repo.fetch_draft_write_ins.await_args_list == [
            call(2026, 1000001, "scn_1"),
            call(2026, 1000002, "scn_1"),
        ]
        assert repo.fetch_write_ins.await_count == 0

    @pytest.mark.asyncio
    async def test_the_lander_counts_a_scenarios_write_in_as_reserved(self) -> None:
        """The rows the lander fetches have to REACH `_build_units`.

        Awaiting `fetch_draft_write_ins` and then dropping its result on the
        floor is a half-fix a call-count assertion cannot see -- the same trap
        `test_the_lander_counts_a_written_into_cabin_as_reserved` names for the
        live table. Pinned against `build_roster`'s own counts, because the two
        endpoints link to each other and must never disagree about one weekend.
        """
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_session=FAMILY_SESSION,
            fetch_units=[
                _unit("u1", "ridge-a", "Ridge A", sleeps=5),
                _unit("u2", "ridge-b", "Ridge B", sleeps=4),
            ],
            fetch_write_ins=[],
            fetch_draft_write_ins=[_rec(unit="u1", occupant_name="Olivia Chen", note="")],
        )
        service = LodgingRosterService(repo)

        summary = await service.build_summary(2026, scenario="scn_1")
        roster = await service.build_roster(2026, 1000001, scenario="scn_1")

        counts = summary.weekends[0].counts
        assert counts.units_reserved == 1
        assert counts.units_family_available == 1
        # The written-into cabin's five beds are NOT on offer; only Ridge B's.
        assert counts.beds_family_available == 4
        assert counts == roster.counts


def _person(pb_id: str = "p_1", first: str = "Emma", last: str = "Johnson") -> SimpleNamespace:
    """The answering person on a raw request value."""
    return _rec(id=pb_id, first_name=first, last_name=last, preferred_name="")


def _value(source_field: str, text: str, person: SimpleNamespace | None = None) -> RequestValueRow:
    return RequestValueRow(source_field=source_field, text=text, person=person or _person())


class TestRequestProvenanceBlocks:
    """kindred#2330: which FORM said it, and which CHILD said it.

    `family_camp_registrations.request_text` joins its sources with `'; '` and
    keeps no field boundary, and 10 of 422 non-blank 2026 values contain that
    separator themselves -- so both dimensions are destroyed there and neither
    is recoverable downstream. The blocks below are built from the raw values
    instead, and `request_text` is left exactly as it was for the roster table
    that still reads it.

    Owner ruling 2026-08-17: one block per SOURCE FIELD, every contributing
    child inside it, labels verbatim from CampMinder.
    """

    @pytest.mark.asyncio
    async def test_each_source_field_becomes_its_own_block(self) -> None:
        """128 of the 270 rostered 2026 households with any request text carry
        it in two or more distinct source fields. That is the defect."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="Near the Garcia family; Cabin with a fridge")},
            fetch_request_text_values={
                "hh_1": [
                    _value("COVID-19 Bunking Requests", "Near the Garcia family"),
                    _value("Share Bunk With", "Cabin with a fridge"),
                ]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert [block.source_field for block in share.request_blocks] == [
            "COVID-19 Bunking Requests",
            "Share Bunk With",
        ]
        assert [entry.text for block in share.request_blocks for entry in block.entries] == [
            "Near the Garcia family",
            "Cabin with a fridge",
        ]
        # The joined column is untouched -- HouseholdRosterTable still reads it.
        assert share.request_text == "Near the Garcia family; Cabin with a fridge"

    @pytest.mark.asyncio
    async def test_two_children_answering_one_field_are_sub_labelled_by_child(self) -> None:
        """103 households have two or more children answering the same field,
        and 83 of those 131 (household, field) groups hold DIVERGENT text --
        `Share Bunk With` almost universally, because siblings name their own
        friends. Picking a winner would drop a real request."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [
                    _value("Share Bunk With", "With Olivia Chen", _person("p_1", "Emma", "Johnson")),
                    _value("Share Bunk With", "With Riley Sam", _person("p_2", "Liam", "Johnson")),
                ]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        blocks = roster.parties[0].share.request_blocks
        assert len(blocks) == 1
        assert [(entry.contributors, entry.text) for entry in blocks[0].entries] == [
            (["Emma Johnson"], "With Olivia Chen"),
            (["Liam Johnson"], "With Riley Sam"),
        ]

    @pytest.mark.asyncio
    async def test_identical_text_from_two_children_collapses_to_one_entry_naming_both(self) -> None:
        """48 of the 131 sibling groups are exact duplicates -- one parent's
        answer written onto every child's record. Rendering it twice is noise;
        dropping a contributor is a lie about who asked."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [
                    _value("Shared-request", "Please house us near a bathhouse", _person("p_2", "Liam", "Johnson")),
                    _value("Shared-request", "please house us near a bathhouse", _person("p_1", "Emma", "Johnson")),
                ]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        entries = roster.parties[0].share.request_blocks[0].entries
        assert len(entries) == 1
        assert entries[0].contributors == ["Emma Johnson", "Liam Johnson"]
        assert entries[0].text == "Please house us near a bathhouse"

    @pytest.mark.asyncio
    async def test_the_two_bunking_note_fields_are_marked_staff_authored(self) -> None:
        """All 34 `BunkingNotes` values end in an inline staff signature and
        timestamp; 0 of the parent-authored fields' 548 values do. The panel
        renders these in grey so an internal note never reads as a family's
        own ask.

        `include_staff_notes` is passed because these two blocks need
        `bunking.manage` -- see `TestStaffAuthoredBlocksAreScreenReduced`.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [
                    _value("Internal Bunk Notes", "Watch the cabin split here."),
                    _value("COVID-19 Bunking Requests", "We would like a quiet cabin."),
                    _value("BunkingNotes Notes", "Called the family Tuesday."),
                ]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001, include_staff_notes=True)

        blocks = roster.parties[0].share.request_blocks
        assert [(block.source_field, block.authorship) for block in blocks] == [
            ("COVID-19 Bunking Requests", "family"),
            ("BunkingNotes Notes", "staff"),
            ("Internal Bunk Notes", "staff"),
        ]

    @pytest.mark.asyncio
    async def test_a_household_with_no_request_values_carries_no_blocks(self) -> None:
        """112 of 382 rostered 2026 households. No block, no placeholder --
        kindred#2255's ruling for this same modal."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.request_blocks == []

    @pytest.mark.asyncio
    async def test_another_households_values_never_leak_onto_this_party(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={"hh_2": [_value("Shared-request", "Not this family's ask")]},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.request_blocks == []

    @pytest.mark.asyncio
    async def test_the_excluded_sixth_field_never_reaches_the_panel(self) -> None:
        """`Do Not Share Bunk With` (3 rostered households) was NOT named by
        the 2026-08-17 ruling. The repository filter already excludes it; this
        pins that a row arriving anyway is dropped rather than rendered under
        a label nobody approved."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [
                    _value("Do Not Share Bunk With", "Anyone from Oak Valley Middle"),
                    _value("RetParent-Socializewithbest", "Yes, my child socializes best with..."),
                    _value("Shared-request", "A cabin on the flat, please"),
                ]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        blocks = roster.parties[0].share.request_blocks
        assert [block.source_field for block in blocks] == ["Shared-request"]

    @pytest.mark.asyncio
    async def test_an_answering_person_with_no_name_on_file_contributes_no_label(self) -> None:
        """A blank contributor is dropped, never rendered as an empty
        sub-label or as the string "None" over a real request."""
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [RequestValueRow(source_field="Shared-request", text="A quiet corner", person=None)]
            },
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        entry = roster.parties[0].share.request_blocks[0].entries[0]
        assert entry.contributors == []
        assert entry.text == "A quiet corner"

    @pytest.mark.asyncio
    async def test_a_csv_only_household_still_reads_as_needing_resolution(self) -> None:
        """32 rostered 2026 households carry request text ONLY in the bunking-CSV
        lane, so `family_camp_registrations.request_text` is blank for them.

        `needs_resolution` is what the panel's marker reads, and its contract
        is "there is request text and no named family has been resolved yet".
        Deriving it from `request_text` alone was correct while that column
        WAS the text; now that blocks carry text the column never held, those
        32 households would render their ask with no marker beside it.
        """
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="")},
            fetch_request_text_values={"hh_1": [_value("Share Bunk With", "With the Garcia family")]},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        share = roster.parties[0].share
        assert share.request_text == ""
        assert [block.source_field for block in share.request_blocks] == ["Share Bunk With"]
        assert share.needs_resolution is True

    @pytest.mark.asyncio
    async def test_a_household_with_no_text_at_all_needs_no_resolution(self) -> None:
        repo = _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_family_camp_registrations={"hh_1": _rec(request_text="")},
        )
        roster = await LodgingRosterService(repo).build_roster(2026, 1000001)

        assert roster.parties[0].share.needs_resolution is False

    @pytest.mark.asyncio
    async def test_the_lander_summary_does_not_pay_for_the_raw_request_read(self) -> None:
        """`build_summary` counts parties and renders none of them, so the
        blocks would be work no response can read -- the same reason last
        year's cabins are absent from its TaskGroup."""
        repo = _repo(
            fetch_weekend_sessions=[FAMILY_SESSION],
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
        )
        await LodgingRosterService(repo).build_summary(2026)

        repo.fetch_request_text_values.assert_not_called()


class TestStaffAuthoredBlocksAreScreenReduced:
    """`Internal Bunk Notes` / `BunkingNotes Notes` need `bunking.manage`.

    Both live in `original_bunk_requests`, whose PocketBase listRule is
    `bunking.manage`, and every other API route that serves that table's raw
    `content` requires an admin (`api/routers/debug.py`). `/lodging/roster`
    takes only `get_current_user`, so emitting the two staff-authored blocks
    unconditionally would hand internal staff commentary to 8 of the 13
    production users who cannot read it anywhere else -- and
    `api/routers/lodging.py` says in as many words that internal notes are
    behind `bunking.manage`.

    The family-authored blocks are NOT gated, exactly as `request_text` is
    not: a household's own housing ask is a placement input any authenticated
    user legitimately reads (kindred#2398).
    """

    @staticmethod
    def _repo_with_both_lanes() -> MagicMock:
        return _repo(
            fetch_session=FAMILY_SESSION,
            fetch_households={"hh_1": _household()},
            fetch_attendees_for_session=[_child()],
            fetch_request_text_values={
                "hh_1": [
                    _value("COVID-19 Bunking Requests", "We would like a quiet cabin."),
                    _value("BunkingNotes Notes", "Called the family Tuesday."),
                    _value("Internal Bunk Notes", "Watch the cabin split here."),
                ]
            },
        )

    @pytest.mark.asyncio
    async def test_a_caller_without_the_permission_gets_only_the_family_blocks(self) -> None:
        roster = await LodgingRosterService(self._repo_with_both_lanes()).build_roster(2026, 1000001)

        blocks = roster.parties[0].share.request_blocks
        assert [block.source_field for block in blocks] == ["COVID-19 Bunking Requests"]

    @pytest.mark.asyncio
    async def test_the_default_is_screen_reduced_not_open(self) -> None:
        """The keyword defaults to WITHHOLDING. A caller that forgets to pass
        it shows less than it could, never more than it may."""
        roster = await LodgingRosterService(self._repo_with_both_lanes()).build_roster(
            2026, 1000001, include_staff_notes=False
        )

        assert all(block.authorship == "family" for block in roster.parties[0].share.request_blocks)

    @pytest.mark.asyncio
    async def test_a_caller_holding_bunking_manage_gets_both_lanes(self) -> None:
        roster = await LodgingRosterService(self._repo_with_both_lanes()).build_roster(
            2026, 1000001, include_staff_notes=True
        )

        blocks = roster.parties[0].share.request_blocks
        assert [(block.source_field, block.authorship) for block in blocks] == [
            ("COVID-19 Bunking Requests", "family"),
            ("BunkingNotes Notes", "staff"),
            ("Internal Bunk Notes", "staff"),
        ]

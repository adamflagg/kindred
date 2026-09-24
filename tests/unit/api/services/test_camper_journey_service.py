"""The camper journey merge, server-side (kindred#2776).

A ONE-FOR-ONE PORT of the client spec it replaces, so the spec provably moves
rather than changes:

- `frontend/src/hooks/camper/fetchCamperJourney.test.ts` (53 tests, as of
  #2807's head) -> `build_journey_feed`. Each test keeps its client name and
  carries a `C<n>` tag in its docstring, numbered in the client file's order.
- The `personJourneyFacts` cases in `useCamperJourney.test.tsx` (5) ->
  `person_journey_facts`, tagged `F<n>`.

The PocketBase mock mirrors the client's: one `get_full_list` per collection,
and any other collection is an error. A filter assertion reads the query the
repository actually sent, as the client test read the one `pb` was sent.

Tests after the port (`TestCamperJourneyService`, `TestAdultAgeMatchesTheClient`)
are new: they pin the orchestration `useCamperJourney` used to do across four
queries -- the person's facts, the household and housing reads, the feed.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.schemas.camper_journey import CamperJourneyCounts, CamperJourneyRow
from api.schemas.lodging import (
    HouseholdJourneyResponse,
    HouseholdJourneySession,
    HouseholdJourneyWeekendCabin,
    HouseholdJourneyYear,
    PersonHousingResponse,
    PersonHousingWeekend,
)
from api.services.camper_journey_service import (
    ADULT_AGE,
    CamperJourneyService,
    JourneyFeed,
    PersonJourneyFacts,
    build_journey_feed,
    person_journey_facts,
)
from api.services.lodging_repository import LodgingRepository
from api.utils.session_metrics import CAMPER_JOURNEY_SESSION_TYPES

PERSON = 8000101
CURRENT_YEAR = 2026


class FakePB:
    """`pb.collection(name).get_full_list`, one mock per collection.

    The client mock threw on an unexpected collection; so does this one, so a
    read the port adds shows up as a failure rather than as an empty list.
    """

    def __init__(self, *extra: str) -> None:
        names = ("attendees", "bunk_assignments", "camp_sessions", *extra)
        self.lists: dict[str, MagicMock] = {name: MagicMock(return_value=[]) for name in names}

    def collection(self, name: str) -> SimpleNamespace:
        if name not in self.lists:
            raise AssertionError(f"Unexpected collection: {name}")
        return SimpleNamespace(get_full_list=self.lists[name])

    def filter_of(self, name: str, call: int = 0) -> str:
        params: dict[str, Any] = self.lists[name].call_args_list[call].kwargs["query_params"]
        return str(params.get("filter", ""))


@pytest.fixture
def pb() -> FakePB:
    return FakePB()


def _repo(pb: FakePB) -> LodgingRepository:
    return LodgingRepository(cast(Any, pb))


async def _feed(pb: FakePB, person_cm_id: int = PERSON, year: int = CURRENT_YEAR, **options: Any) -> JourneyFeed:
    return await build_journey_feed(_repo(pb), person_cm_id, year, **options)


def attendee(
    year: int,
    session_cm_id: int,
    session_type: str,
    name: str,
    parent_id: int | None = None,
    start_date: str | None = None,
) -> SimpleNamespace:
    session = SimpleNamespace(id=f"sess-{session_cm_id}", cm_id=session_cm_id, name=name, session_type=session_type)
    if parent_id is not None:
        session.parent_id = parent_id
    if start_date is not None:
        session.start_date = start_date
    return SimpleNamespace(
        id=f"att-{year}-{session_cm_id}",
        person_id=PERSON,
        year=year,
        status="enrolled",
        expand={"session": session},
    )


def assignment(
    year: int,
    session_cm_id: int | None,
    bunk_name: str,
    session_type: str | None = None,
) -> SimpleNamespace:
    expand: dict[str, Any] = {"bunk": SimpleNamespace(name=bunk_name)}
    if session_cm_id is not None:
        session = SimpleNamespace(cm_id=session_cm_id)
        if session_type:
            session.session_type = session_type
        expand["session"] = session
    return SimpleNamespace(
        id=f"asn-{year}-{session_cm_id if session_cm_id is not None else 'x'}", year=year, expand=expand
    )


def camp_session(year: int, cm_id: int, name: str, session_type: str) -> SimpleNamespace:
    return SimpleNamespace(year=year, cm_id=cm_id, name=name, session_type=session_type)


def by_name(rows: list[CamperJourneyRow], name: str) -> CamperJourneyRow | None:
    return next((row for row in rows if row.session_name == name), None)


def assert_matches(row: CamperJourneyRow | None, **fields: Any) -> None:
    """The client's `toMatchObject`: every named field equal, the rest free."""
    assert row is not None
    for field, value in fields.items():
        assert getattr(row, field) == value, f"{field}: {getattr(row, field)!r} != {value!r}"


def housing_weekend(year: int, session_cm_id: int, cabin_name: str, cabin_name_raw: str) -> PersonHousingWeekend:
    return PersonHousingWeekend(
        year=year, session_cm_id=session_cm_id, cabin_name=cabin_name, cabin_name_raw=cabin_name_raw
    )


def household_session(session_cm_id: int, name: str, start_date: str) -> HouseholdJourneySession:
    return HouseholdJourneySession(session_cm_id=session_cm_id, name=name, start_date=start_date)


# --------------------------------------------------------------------------
# describe('fetchCamperJourney')
# --------------------------------------------------------------------------


class TestFetchCamperJourney:
    @pytest.mark.asyncio
    async def test_returns_empty_without_querying_when_person_cm_id_is_falsy(self, pb: FakePB) -> None:
        """C1: returns [] without querying when personCmId is falsy."""
        out = await _feed(pb, person_cm_id=0)
        assert out.rows == []
        pb.lists["attendees"].assert_not_called()

    @pytest.mark.asyncio
    async def test_sources_rows_from_attendees_and_queries_through_the_view_year_enrolled_curated_types(
        self, pb: FakePB
    ) -> None:
        """C2: sources rows from attendees and queries by year <= currentYear,
        enrolled, curated types.

        #2113: family camp was reversed into the journey set. Adult programs
        joined it too; bmitzvah/hebrew/school/teen/other remain excluded. The
        read runs THROUGH the viewed year so the header counts include it; the
        rows stay prior-year. "Enrolled" is `status_id = 2`, the server's one
        spelling of the client's `status = "enrolled"` (the Go sync maps the
        one to the other, `pocketbase/sync/attendees.go`).
        """
        pb.lists["attendees"].return_value = [attendee(2023, 100, "main", "Session 3")]
        await _feed(pb)
        f = pb.filter_of("attendees")
        assert f"person_id = {PERSON}" in f
        assert f"year <= {CURRENT_YEAR}" in f
        assert ACTIVE_ENROLLED_FILTER in f
        assert 'session.session_type = "family"' in f
        assert 'session.session_type = "adult"' in f
        assert '"bmitzvah"' not in f
        assert 'session.session_type = "scit"' in f

    @pytest.mark.asyncio
    async def test_restricts_the_bunk_assignments_query_to_journey_session_types(self, pb: FakePB) -> None:
        """C3: restricts the bunk_assignments query to journey session types
        (family included, others still excluded) -- the year-fallback must not
        let a non-journey type leak in (fb1a88d2)."""
        pb.lists["attendees"].return_value = [attendee(2022, 100, "main", "Session 3")]
        await _feed(pb)
        f = pb.filter_of("bunk_assignments")
        assert f"person.cm_id = {PERSON}" in f
        assert f"year < {CURRENT_YEAR}" in f
        assert 'session.session_type = "family"' in f
        assert '"bmitzvah"' not in f
        assert 'session.session_type = "main"' in f

    @pytest.mark.asyncio
    async def test_labels_a_row_via_exact_year_session_assignment_match(self, pb: FakePB) -> None:
        """C4: labels a row via exact (year, session) assignment match."""
        pb.lists["attendees"].return_value = [attendee(2023, 100, "main", "Session 3")]
        pb.lists["bunk_assignments"].return_value = [assignment(2023, 100, "G-8B")]
        out = await _feed(pb)
        assert_matches(out.rows[0], year=2023, session_name="Session 3", bunk_name="G-8B")

    @pytest.mark.asyncio
    async def test_does_not_leak_a_lone_family_camp_assignment_onto_an_unrelated_summer_row(self, pb: FakePB) -> None:
        """C5: does not leak a lone family-camp assignment onto an unrelated
        summer row via the year-fallback. The family row's own day group is
        dropped too (kindred#2466), and no household housing was supplied."""
        pb.lists["attendees"].return_value = [
            attendee(2019, 100, "main", "Session 2"),
            attendee(2019, 900, "family", "Winter Family Weekend"),
        ]
        pb.lists["bunk_assignments"].return_value = [assignment(2019, 900, "Cabin FC-2", "family")]
        out = await _feed(pb)
        assert_matches(by_name(out.rows, "Winter Family Weekend"), bunk_name=None)
        assert_matches(by_name(out.rows, "Session 2"), bunk_name=None)  # must NOT inherit the family bunk

    @pytest.mark.asyncio
    async def test_still_applies_the_year_fallback_within_summer_types(self, pb: FakePB) -> None:
        """C6: still applies the year-fallback within summer types (pinned on
        an embedded row since Q9 took Quest's cabin away)."""
        pb.lists["attendees"].return_value = [attendee(2020, 500, "embedded", "Session X")]
        pb.lists["bunk_assignments"].return_value = [assignment(2020, 501, "Q-Cabin", "main")]
        out = await _feed(pb)
        assert out.rows[0].bunk_name == "Q-Cabin"

    @pytest.mark.asyncio
    async def test_relabels_an_ag_only_year_to_its_parent_main_keeping_the_ag_bunk(self, pb: FakePB) -> None:
        """C7: relabels an AG-only year to its parent main via camp_sessions
        lookup, keeping the AG bunk."""
        pb.lists["attendees"].return_value = [attendee(2021, 200, "ag", "Session B (AG)", 199)]
        pb.lists["bunk_assignments"].return_value = [assignment(2021, 200, "AG-4")]
        pb.lists["camp_sessions"].return_value = [camp_session(2021, 199, "Session B", "main")]
        out = await _feed(pb)
        assert len(out.rows) == 1
        assert_matches(out.rows[0], year=2021, session_type="main", session_name="Session B", bunk_name="AG-4")
        lookup = pb.filter_of("camp_sessions")
        assert "cm_id = 199" in lookup
        assert "year = 2021" in lookup

    @pytest.mark.asyncio
    async def test_collapses_a_same_year_main_and_ag_enrollment_into_one_main_row(self, pb: FakePB) -> None:
        """C8: collapses a same-year Main + AG enrollment into one Main row."""
        pb.lists["attendees"].return_value = [
            attendee(2023, 100, "main", "Session 2"),
            attendee(2023, 101, "ag", "Session 2 AG", 100),
        ]
        out = await _feed(pb)
        assert len(out.rows) == 1
        assert_matches(out.rows[0], year=2023, session_type="main", session_name="Session 2")

    @pytest.mark.asyncio
    async def test_does_not_collapse_a_parentless_ag_row_against_a_cm_id_less_session(self, pb: FakePB) -> None:
        """C9: does not collapse a parentless AG row (parent_id 0) against an
        unrelated cm_id-less session (cm_id 0) -- the `> 0` sentinel guard."""
        pb.lists["attendees"].return_value = [
            attendee(2023, 0, "main", "Session With No CM ID"),
            attendee(2023, 200, "ag", "Standalone AG Session", 0),
        ]
        out = await _feed(pb)
        assert len(out.rows) == 2
        assert {row.session_name for row in out.rows} >= {"Session With No CM ID", "Standalone AG Session"}

    @pytest.mark.asyncio
    async def test_leaves_a_row_unlabeled_when_its_year_has_two_assignments_and_none_match(self, pb: FakePB) -> None:
        """C10: leaves a row unlabeled when its year has >=2 assignments and
        none match the session."""
        pb.lists["attendees"].return_value = [attendee(2020, 300, "embedded", "Session X")]
        pb.lists["bunk_assignments"].return_value = [
            assignment(2020, 301, "Cabin 1"),
            assignment(2020, 302, "Cabin 2"),
        ]
        out = await _feed(pb)
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_includes_a_no_assignment_year_with_no_bunk_label(self, pb: FakePB) -> None:
        """C11: includes a no-assignment (e.g. 2022 gap / teen) year with no
        bunk label."""
        pb.lists["attendees"].return_value = [
            attendee(2024, 400, "scit", "Counselor In-Training"),
            attendee(2022, 100, "main", "Session 3"),
        ]
        out = await _feed(pb)
        assert [row.year for row in out.rows] == [2024, 2022]
        for row in out.rows:
            assert row.bunk_name is None

    @pytest.mark.asyncio
    async def test_sorts_output_by_year_descending_regardless_of_input_order(self, pb: FakePB) -> None:
        """C12: sorts output by year descending regardless of input order."""
        pb.lists["attendees"].return_value = [
            attendee(2019, 1, "main", "a"),
            attendee(2023, 2, "main", "b"),
            attendee(2021, 3, "main", "c"),
        ]
        out = await _feed(pb)
        assert [row.year for row in out.rows] == [2023, 2021, 2019]


# --------------------------------------------------------------------------
# describe('ordering within a year')
# --------------------------------------------------------------------------


class TestOrderingWithinAYear:
    """Owner report, 2026-08-18: a year reads chronologically ACROSS programs."""

    @pytest.mark.asyncio
    async def test_orders_a_year_chronologically_across_programs(self, pb: FakePB) -> None:
        """C13: orders a year chronologically ACROSS programs, not program by
        program."""
        pb.lists["attendees"].return_value = [
            attendee(2026, 201, "embedded", "Session 2a", None, "2026-06-14"),
            attendee(2026, 202, "embedded", "Session 3a", None, "2026-07-05"),
            attendee(2026, 101, "family", "Family Camp 1: Memorial Day Weekend", None, "2026-05-22"),
            attendee(2026, 106, "family", "Family Camp 6", None, "2026-09-24"),
        ]
        out = await _feed(pb, year=2027)
        assert [row.session_name for row in out.rows] == [
            "Family Camp 1: Memorial Day Weekend",
            "Session 2a",
            "Session 3a",
            "Family Camp 6",
        ]

    @pytest.mark.asyncio
    async def test_keeps_a_row_with_no_start_date_last_in_its_year(self, pb: FakePB) -> None:
        """C14: keeps a row with no start date LAST in its year, never first."""
        pb.lists["attendees"].return_value = [
            attendee(2026, 300, "main", "Undated Session"),
            attendee(2026, 101, "family", "Family Camp 1: Memorial Day Weekend", None, "2026-05-22"),
        ]
        out = await _feed(pb, year=2027)
        assert [row.session_name for row in out.rows] == ["Family Camp 1: Memorial Day Weekend", "Undated Session"]

    @pytest.mark.asyncio
    async def test_still_orders_years_newest_first(self, pb: FakePB) -> None:
        """C15: still orders years newest first."""
        pb.lists["attendees"].return_value = [
            attendee(2024, 101, "family", "Family Camp 1: Memorial Day Weekend", None, "2024-05-24"),
            attendee(2026, 101, "family", "Family Camp 1: Memorial Day Weekend", None, "2026-05-22"),
        ]
        out = await _feed(pb, year=2027)
        assert [row.year for row in out.rows] == [2026, 2024]


# --------------------------------------------------------------------------
# describe('family-camp housing (kindred#2466)')
# --------------------------------------------------------------------------


def family_housing_year(**overrides: Any) -> HouseholdJourneyYear:
    fields: dict[str, Any] = {
        "year": 2024,
        "housing": "placed",
        "cabin_name": "Cedar Lodge",
        "cabin_name_raw": "Cedar Lodge",
        "housing_session_cm_id": 900,
    }
    fields.update(overrides)
    return HouseholdJourneyYear(**fields)


class TestFamilyCampHousing:
    """kindred#2466: a family row shows the household's ACTUAL HOUSING, never
    the CampMinder day group `bunk_assignments` matches on a family session."""

    @pytest.mark.asyncio
    async def test_drops_the_day_group_entirely_when_no_household_housing_is_supplied(self, pb: FakePB) -> None:
        """C16: drops the day group entirely when no household housing is
        supplied."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        pb.lists["bunk_assignments"].return_value = [assignment(2024, 900, "Acorns (with parents)", "family")]
        out = await _feed(pb)
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_shows_the_household_cabin_when_the_year_attributes_it_to_this_rows_session(self, pb: FakePB) -> None:
        """C17: shows the household cabin name when the year unambiguously
        attributes it to this row's session."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        pb.lists["bunk_assignments"].return_value = [assignment(2024, 900, "Acorns (with parents)", "family")]
        out = await _feed(pb, family_years=[family_housing_year()])
        assert_matches(out.rows[0], year=2024, bunk_name="Cedar Lodge")

    @pytest.mark.asyncio
    async def test_declines_when_the_year_attributes_housing_to_a_different_weekend(self, pb: FakePB) -> None:
        """C18: declines when the year attributes housing to a DIFFERENT
        weekend (ambiguous multi-weekend year)."""
        pb.lists["attendees"].return_value = [
            attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2024, 901, "family", "Family Camp 5"),
        ]
        out = await _feed(pb, family_years=[family_housing_year(housing_session_cm_id=900)])
        assert_matches(by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge")
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name=None)

    @pytest.mark.asyncio
    async def test_labels_every_family_weekend_of_a_placed_season_not_pinned_to_one_weekend(self, pb: FakePB) -> None:
        """C19: labels EVERY family weekend of a placed season whose cabin is
        not pinned to one weekend (owner ruling 2026-09-22 late)."""
        pb.lists["attendees"].return_value = [
            attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2024, 901, "family", "Family Camp 5"),
        ]
        out = await _feed(
            pb, family_years=[family_housing_year(housing_session_cm_id=None, cabin_name_raw="Old Cedar")]
        )
        assert_matches(
            by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge", bunk_name_recorded="Old Cedar"
        )
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name="Cedar Lodge", bunk_name_recorded="Old Cedar")

    @pytest.mark.asyncio
    async def test_still_labels_nothing_for_an_unpinned_season_with_no_cabin(self, pb: FakePB) -> None:
        """C20: still labels nothing for an unpinned season with no cabin."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[family_housing_year(housing_session_cm_id=None, cabin_name="  ")])
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_never_lets_an_unpinned_season_label_a_non_family_row(self, pb: FakePB) -> None:
        """C21: never lets an unpinned season label a non-family row."""
        pb.lists["attendees"].return_value = [attendee(2024, 500, "main", "Session 3")]
        out = await _feed(pb, family_years=[family_housing_year(housing_session_cm_id=None)])
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_declines_when_the_year_is_not_placed(self, pb: FakePB) -> None:
        """C22: declines when the year is not placed."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[family_housing_year(housing="not_placed", cabin_name="")])
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_never_applies_household_housing_to_a_non_family_row(self, pb: FakePB) -> None:
        """C23: never applies household housing to a non-family row, even if
        the year matches by coincidence."""
        pb.lists["attendees"].return_value = [attendee(2024, 500, "main", "Session 3")]
        pb.lists["bunk_assignments"].return_value = [assignment(2024, 500, "G-4A")]
        out = await _feed(pb, family_years=[family_housing_year(housing_session_cm_id=500)])
        assert out.rows[0].bunk_name == "G-4A"


# --------------------------------------------------------------------------
# describe('per-weekend cabins from the CampMinder layer (kindred#2801)')
# --------------------------------------------------------------------------


def weekend_cabin(session_cm_id: int = 900, cabin_name: str = "Cedar Lodge", cabin_name_raw: str = "Cedar Lodge"):
    return HouseholdJourneyWeekendCabin(
        session_cm_id=session_cm_id, cabin_name=cabin_name, cabin_name_raw=cabin_name_raw
    )


def live_household_year(**overrides: Any) -> HouseholdJourneyYear:
    """Two live weekends that season, named apart -- the shape #2789 publishes
    only once EVERY enrolled weekend has a live row. The year-level fields
    still hold just the first weekend's cabin."""
    fields: dict[str, Any] = {
        "year": 2026,
        "housing": "placed",
        "cabin_name": "Cedar Lodge",
        "cabin_name_raw": "Cedar Lodge",
        "housing_session_cm_id": None,
        "sessions": [
            household_session(900, "Family Camp 2: Keshet Weekend", "2026-05-23"),
            household_session(901, "Family Camp 5", "2026-08-15"),
        ],
        "weekend_cabins": [
            weekend_cabin(900, "Cedar Lodge", "Cedar Lodge"),
            weekend_cabin(901, "Meadow House 1", "Meadow House 1"),
        ],
    }
    fields.update(overrides)
    return HouseholdJourneyYear(**fields)


class TestPerWeekendCabins:
    @pytest.mark.asyncio
    async def test_shows_each_weekends_own_live_cabin_when_the_weekends_differ(self, pb: FakePB) -> None:
        """C24: shows each weekend's own live cabin, not the year's single
        label, when the weekends differ."""
        pb.lists["attendees"].return_value = [
            attendee(2026, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2026, 901, "family", "Family Camp 5"),
        ]
        out = await _feed(pb, year=2027, family_years=[live_household_year()])
        assert_matches(by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge")
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name="Meadow House 1")

    @pytest.mark.asyncio
    async def test_carries_each_weekends_own_as_typed_string_from_its_own_entry(self, pb: FakePB) -> None:
        """C25: carries each weekend's OWN as-typed string as bunkNameRecorded,
        from its own weekend_cabins entry."""
        pb.lists["attendees"].return_value = [
            attendee(2026, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2026, 901, "family", "Family Camp 5"),
        ]
        out = await _feed(
            pb,
            year=2027,
            family_years=[
                live_household_year(
                    weekend_cabins=[
                        weekend_cabin(900, "Cedar Lodge", "Old Cedar"),
                        weekend_cabin(901, "Meadow House 1", "Meadow House 1"),
                    ]
                )
            ],
        )
        assert_matches(
            by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge", bunk_name_recorded="Old Cedar"
        )
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name="Meadow House 1", bunk_name_recorded=None)

    @pytest.mark.asyncio
    async def test_falls_back_to_todays_year_level_rule_when_no_per_weekend_cabins_are_published(
        self, pb: FakePB
    ) -> None:
        """C26: falls back to today's year-level rule when no per-weekend
        cabins are published."""
        pb.lists["attendees"].return_value = [
            attendee(2026, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2026, 901, "family", "Family Camp 5"),
        ]
        out = await _feed(pb, year=2027, family_years=[live_household_year(weekend_cabins=[])])
        assert_matches(by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge")
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name="Cedar Lodge")

    @pytest.mark.asyncio
    async def test_applies_the_same_per_weekend_override_to_a_parent_weekend(self, pb: FakePB) -> None:
        """C27: applies the same per-weekend override to a parent weekend."""
        out = await _feed(pb, year=2027, family_years=[live_household_year()], viewer_is_adult=True)
        assert_matches(by_name(out.rows, "Family Camp 2: Keshet Weekend"), bunk_name="Cedar Lodge")
        assert_matches(by_name(out.rows, "Family Camp 5"), bunk_name="Meadow House 1")

    @pytest.mark.asyncio
    async def test_leaves_2025_and_earlier_unaffected(self, pb: FakePB) -> None:
        """C28: leaves 2025 and earlier unaffected -- no weekend_cabins field
        to read."""
        pb.lists["attendees"].return_value = [attendee(2025, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(
            pb,
            family_years=[
                live_household_year(
                    year=2025,
                    sessions=[household_session(900, "Family Camp 2: Keshet Weekend", "2025-05-24")],
                    weekend_cabins=[],
                    housing_session_cm_id=900,
                )
            ],
        )
        assert_matches(out.rows[0], bunk_name="Cedar Lodge")


# --------------------------------------------------------------------------
# describe('adult programs')
# --------------------------------------------------------------------------


def adult_housing(year: int, session_cm_id: int, cabin: str) -> PersonHousingWeekend:
    return housing_weekend(year, session_cm_id, cabin, cabin)


class TestAdultPrograms:
    @pytest.mark.asyncio
    async def test_labels_an_adult_row_with_its_attributed_cabin(self, pb: FakePB) -> None:
        """C29: labels an adult row with its attributed cabin."""
        pb.lists["attendees"].return_value = [attendee(2024, 1001, "adult", "Women's Weekend")]
        out = await _feed(pb, adult_weekends=[adult_housing(2024, 1001, "River F")])
        assert_matches(out.rows[0], year=2024, session_type="adult", bunk_name="River F")

    @pytest.mark.asyncio
    async def test_carries_the_as_typed_string_when_cabin_name_differs_from_raw(self, pb: FakePB) -> None:
        """C30: carries the as-typed string as bunkNameRecorded when the
        server's cabin_name differs from cabin_name_raw."""
        pb.lists["attendees"].return_value = [attendee(2022, 1001, "adult", "Women's Weekend")]
        out = await _feed(pb, adult_weekends=[housing_weekend(2022, 1001, "Meadow House 1", "Old Meadow 1")])
        assert_matches(out.rows[0], bunk_name="Meadow House 1", bunk_name_recorded="Old Meadow 1")

    @pytest.mark.asyncio
    async def test_omits_the_recorded_string_when_the_server_agrees_with_itself(self, pb: FakePB) -> None:
        """C31: omits bunkNameRecorded on an adult row when the server
        already agrees with itself."""
        pb.lists["attendees"].return_value = [attendee(2024, 1001, "adult", "Women's Weekend")]
        out = await _feed(pb, adult_weekends=[adult_housing(2024, 1001, "River F")])
        assert out.rows[0].bunk_name_recorded is None

    @pytest.mark.asyncio
    async def test_never_treats_outer_whitespace_on_cabin_name_raw_as_a_disagreement(self, pb: FakePB) -> None:
        """C32: never treats outer whitespace on cabin_name_raw as a
        disagreement with a trimmed cabin_name."""
        pb.lists["attendees"].return_value = [attendee(2024, 1001, "adult", "Women's Weekend")]
        out = await _feed(pb, adult_weekends=[housing_weekend(2024, 1001, "River F", "  River F  ")])
        assert out.rows[0].bunk_name_recorded is None

    @pytest.mark.asyncio
    async def test_never_labels_an_adult_row_with_a_bunk_even_a_lone_same_year_one(self, pb: FakePB) -> None:
        """C33: never labels an adult row with a bunk, even a lone same-year
        one."""
        pb.lists["attendees"].return_value = [attendee(2024, 1001, "adult", "Women's Weekend")]
        pb.lists["bunk_assignments"].return_value = [assignment(2024, 555, "G-8B", "main")]
        out = await _feed(pb)
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_leaves_an_adult_row_unlabeled_when_its_weekend_has_no_attributed_cabin(self, pb: FakePB) -> None:
        """C34: leaves an adult row unlabeled when its weekend has no
        attributed cabin."""
        pb.lists["attendees"].return_value = [attendee(2024, 1002, "adult", "Divorce & Discovery")]
        out = await _feed(pb, adult_weekends=[adult_housing(2024, 1001, "River F")])
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_counts_adult_weekends_through_the_current_year_while_rows_stay_prior_year(self, pb: FakePB) -> None:
        """C35: counts adult weekends through the current year while rows stay
        prior-year -- (year, session) pairs, since CampMinder reuses ids."""
        pb.lists["attendees"].return_value = [
            attendee(2024, 1001, "adult", "Women's Weekend"),
            attendee(2025, 1001, "adult", "Women's Weekend"),
            attendee(CURRENT_YEAR, 1001, "adult", "Women's Weekend"),
        ]
        out = await _feed(pb)
        assert [row.year for row in out.rows] == [2025, 2024]
        assert out.adult_weekends == 3


# --------------------------------------------------------------------------
# describe("family camp, today's name with recorded provenance, and as a parent")
# --------------------------------------------------------------------------


def household_year(**overrides: Any) -> HouseholdJourneyYear:
    fields: dict[str, Any] = {
        "year": 2024,
        "housing": "placed",
        "cabin_name": "Meadow House 1",
        "cabin_name_raw": "Old Meadow 1",
        "housing_session_cm_id": 900,
        "sessions": [household_session(900, "Family Camp 2: Keshet Weekend", "2024-05-24")],
    }
    fields.update(overrides)
    return HouseholdJourneyYear(**fields)


class TestFamilyCampTodaysNameAndAsAParent:
    @pytest.mark.asyncio
    async def test_labels_a_childs_family_row_with_todays_registry_name(self, pb: FakePB) -> None:
        """C36: labels a child's family row with today's registry name, not
        the as-typed string (owner ruling 2026-09-22 evening)."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[household_year()])
        assert out.rows[0].bunk_name == "Meadow House 1"

    @pytest.mark.asyncio
    async def test_adds_the_weekends_a_child_in_the_household_attended_for_an_adult_viewer(self, pb: FakePB) -> None:
        """C37: adds the weekends a child in the household attended, for an
        adult viewer."""
        out = await _feed(pb, family_years=[household_year()], viewer_is_adult=True)
        assert len(out.rows) == 1
        assert_matches(
            out.rows[0],
            year=2024,
            session_type="family",
            session_name="Family Camp 2: Keshet Weekend",
            bunk_name="Meadow House 1",
        )
        assert out.family_weekends == 1

    @pytest.mark.asyncio
    async def test_adds_no_parent_rows_for_a_child_viewer(self, pb: FakePB) -> None:
        """C38: adds no parent rows for a child viewer."""
        out = await _feed(pb, family_years=[household_year()])
        assert out.rows == []
        assert out.family_weekends == 0

    @pytest.mark.asyncio
    async def test_does_not_double_a_weekend_the_adult_attended_themself(self, pb: FakePB) -> None:
        """C39: does not double a weekend the adult attended themself."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[household_year()], viewer_is_adult=True)
        assert len(out.rows) == 1
        assert out.family_weekends == 1

    @pytest.mark.asyncio
    async def test_shows_a_parent_weekend_with_no_cabin_when_the_year_pins_it_elsewhere(self, pb: FakePB) -> None:
        """C40: shows a parent weekend with no cabin when the year pins the
        cabin elsewhere."""
        out = await _feed(pb, family_years=[household_year(housing_session_cm_id=901)], viewer_is_adult=True)
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_labels_every_parent_weekend_of_a_placed_season_that_is_not_pinned(self, pb: FakePB) -> None:
        """C41: labels EVERY parent weekend of a placed season whose cabin is
        not pinned."""
        out = await _feed(
            pb,
            family_years=[
                household_year(
                    housing_session_cm_id=None,
                    sessions=[
                        household_session(900, "Family Camp 2: Keshet Weekend", "2024-05-24"),
                        household_session(901, "Family Camp 5", "2024-08-16"),
                    ],
                )
            ],
            viewer_is_adult=True,
        )
        assert len(out.rows) == 2
        for row in out.rows:
            assert_matches(row, bunk_name="Meadow House 1", bunk_name_recorded="Old Meadow 1")

    @pytest.mark.asyncio
    async def test_adds_no_row_and_counts_nothing_for_a_paper_registration_year(self, pb: FakePB) -> None:
        """C42: adds no row and counts nothing for a paper-registration year
        (no sessions)."""
        out = await _feed(pb, family_years=[household_year(sessions=[])], viewer_is_adult=True)
        assert out.rows == []
        assert out.family_weekends == 0

    @pytest.mark.asyncio
    async def test_counts_a_current_year_parent_weekend_but_adds_no_row_for_it(self, pb: FakePB) -> None:
        """C43: counts a current-year parent weekend but adds no row for it."""
        out = await _feed(pb, family_years=[household_year(year=CURRENT_YEAR)], viewer_is_adult=True)
        assert out.rows == []
        assert out.family_weekends == 1

    @pytest.mark.asyncio
    async def test_carries_the_as_typed_string_when_it_differs_from_the_label(self, pb: FakePB) -> None:
        """C44: carries the as-typed string as bunkNameRecorded when it differs
        from the label."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[household_year()])
        assert_matches(out.rows[0], bunk_name="Meadow House 1", bunk_name_recorded="Old Meadow 1")

    @pytest.mark.asyncio
    async def test_omits_the_recorded_string_when_the_as_typed_string_already_is_the_label(self, pb: FakePB) -> None:
        """C45: omits bunkNameRecorded when the as-typed string already IS the
        label."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[household_year(cabin_name="Cedar Lodge", cabin_name_raw="Cedar Lodge")])
        assert out.rows[0].bunk_name == "Cedar Lodge"
        assert out.rows[0].bunk_name_recorded is None

    @pytest.mark.asyncio
    async def test_carries_the_recorded_string_on_a_parent_row_too(self, pb: FakePB) -> None:
        """C46: carries bunkNameRecorded on a parent row too, for an adult
        viewer."""
        out = await _feed(pb, family_years=[household_year()], viewer_is_adult=True)
        assert_matches(out.rows[0], bunk_name="Meadow House 1", bunk_name_recorded="Old Meadow 1")

    @pytest.mark.asyncio
    async def test_never_treats_outer_whitespace_on_the_household_raw_string_as_a_disagreement(
        self, pb: FakePB
    ) -> None:
        """C47: never treats outer whitespace on the household record
        cabin_name_raw as a disagreement."""
        pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        out = await _feed(pb, family_years=[household_year(cabin_name="River F", cabin_name_raw="  River F  ")])
        assert out.rows[0].bunk_name_recorded is None


# --------------------------------------------------------------------------
# describe('teen-program and Quest cabins (Q9)')
# --------------------------------------------------------------------------

RESOLVED_TEEN = housing_weekend(2025, 2001, "Village Cabin 2", "Teen 2")


class TestTeenProgramAndQuestCabins:
    """Owner ruling 2026-09-22 (late, Q9): a TLI/SCIT cabin comes ONLY from the
    registry-resolved `teen_cabins`; a Quest row never shows a cabin."""

    @pytest.mark.asyncio
    async def test_labels_a_teen_row_with_the_registry_name_the_as_typed_string_on_hover(self, pb: FakePB) -> None:
        """C48: labels a TLI/SCIT row with the server's registry name, the
        as-typed string on hover."""
        pb.lists["attendees"].return_value = [attendee(2025, 2001, "scit", "Counselor In-Training")]
        pb.lists["bunk_assignments"].return_value = [assignment(2025, 2001, "Teen 2", "scit")]
        out = await _feed(pb, teen_cabins=[RESOLVED_TEEN])
        assert_matches(out.rows[0], bunk_name="Village Cabin 2", bunk_name_recorded="Teen 2")

    @pytest.mark.asyncio
    async def test_gives_an_unresolved_teen_row_no_label_never_the_raw_program_group(self, pb: FakePB) -> None:
        """C49: gives an unresolved TLI/SCIT row no label -- never the raw
        program group."""
        pb.lists["attendees"].return_value = [
            attendee(2025, 2001, "scit", "Counselor In-Training"),
            attendee(2025, 2002, "tli", "Teen Leadership"),
        ]
        pb.lists["bunk_assignments"].return_value = [
            assignment(2025, 2001, "SCIT A", "scit"),
            assignment(2025, 2002, "TLI", "tli"),
        ]
        out = await _feed(pb, teen_cabins=[])
        assert len(out.rows) == 2
        for row in out.rows:
            assert row.bunk_name is None
            assert row.bunk_name_recorded is None

    @pytest.mark.asyncio
    async def test_omits_the_hover_when_the_registry_name_already_is_the_recorded_string(self, pb: FakePB) -> None:
        """C50: omits the hover when the registry name already IS the recorded
        string."""
        pb.lists["attendees"].return_value = [attendee(2025, 2002, "tli", "Teen Leadership")]
        out = await _feed(pb, teen_cabins=[housing_weekend(2025, 2002, "Cedar Lodge", "Cedar Lodge")])
        assert out.rows[0].bunk_name == "Cedar Lodge"
        assert out.rows[0].bunk_name_recorded is None

    @pytest.mark.asyncio
    async def test_never_borrows_a_teen_cabin_from_another_year_or_session(self, pb: FakePB) -> None:
        """C51: never borrows a teen cabin from another year or session."""
        pb.lists["attendees"].return_value = [attendee(2024, 2001, "scit", "Counselor In-Training")]
        out = await _feed(pb, teen_cabins=[RESOLVED_TEEN])
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_gives_a_quest_row_no_label_even_when_a_bunk_assignment_exists(self, pb: FakePB) -> None:
        """C52: gives a Quest row no label even when a bunk_assignment exists."""
        pb.lists["attendees"].return_value = [attendee(2025, 3001, "quest", "Quest Session")]
        pb.lists["bunk_assignments"].return_value = [assignment(2025, 3001, "Trip Name", "quest")]
        out = await _feed(pb)
        assert out.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_never_lets_a_lone_program_group_bunk_reach_a_summer_row_through_the_fallback(
        self, pb: FakePB
    ) -> None:
        """C53: never lets a lone program-group bunk reach a summer row
        through the year-fallback."""
        pb.lists["attendees"].return_value = [
            attendee(2025, 100, "main", "Session 2"),
            attendee(2025, 2001, "scit", "Counselor In-Training"),
        ]
        pb.lists["bunk_assignments"].return_value = [assignment(2025, 2001, "SCIT A", "scit")]
        out = await _feed(pb)
        for row in out.rows:
            assert row.bunk_name is None


# --------------------------------------------------------------------------
# describe('personJourneyFacts')  (useCamperJourney.test.tsx)
# --------------------------------------------------------------------------

YEAR = 2026


def person_row(year: int, **extra: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {"year": year, "household_id": 555, "years_at_camp": 0, "age": 43.01}
    fields.update(extra)
    return SimpleNamespace(**fields)


class TestPersonJourneyFacts:
    def test_takes_summers_from_the_most_recent_non_zero_years_at_camp(self) -> None:
        """F1: takes summers from the most recent NON-ZERO years_at_camp --
        CampMinder zeroes it for adults."""
        facts = person_journey_facts([person_row(2019, years_at_camp=1, age=21.11), person_row(YEAR)], YEAR)
        assert facts.summers == 1

    def test_ignores_a_later_years_count_when_viewing_an_earlier_year(self) -> None:
        """F2: ignores a LATER year's count when viewing an earlier year."""
        rows = [person_row(2024, years_at_camp=2), person_row(YEAR, years_at_camp=5)]
        assert person_journey_facts(rows, 2024).summers == 2

    def test_reads_household_and_adulthood_off_the_view_year_row(self) -> None:
        """F3: reads household and adulthood off the view-year row."""
        assert person_journey_facts([person_row(YEAR)], YEAR) == PersonJourneyFacts(
            household_id=555, summers=0, is_adult=True
        )
        assert person_journey_facts([person_row(YEAR, age=12.04, household_id=0)], YEAR) == PersonJourneyFacts(
            household_id=None, summers=0, is_adult=False
        )

    def test_uses_no_view_row_when_every_row_postdates_the_view_year(self) -> None:
        """F4: uses no view row when every row postdates viewYear -- never
        leaks a later household/adulthood (CR #5, kindred#2753)."""
        rows = [person_row(2027, household_id=999, age=45)]
        assert person_journey_facts(rows, 2026) == PersonJourneyFacts(household_id=None, summers=0, is_adult=False)

    def test_is_not_an_adult_at_19_11_below_the_raised_21_cutoff(self) -> None:
        """F5: is not an adult at 19.11 -- below the raised 21 cutoff (owner
        ruling 2026-09-22: 18 -> 21)."""
        assert person_journey_facts([person_row(YEAR, age=19.11)], YEAR).is_adult is False


# --------------------------------------------------------------------------
# New: the orchestration `useCamperJourney` did across four client queries.
# --------------------------------------------------------------------------


def _service(
    pb: FakePB,
    *,
    household: HouseholdJourneyResponse | Exception | None = None,
    housing: PersonHousingResponse | Exception | None = None,
) -> tuple[CamperJourneyService, AsyncMock, AsyncMock]:
    household_read = AsyncMock(
        side_effect=household if isinstance(household, Exception) else None,
        return_value=household if isinstance(household, HouseholdJourneyResponse) else HouseholdJourneyResponse(),
    )
    housing_read = AsyncMock(
        side_effect=housing if isinstance(housing, Exception) else None,
        return_value=housing if isinstance(housing, PersonHousingResponse) else PersonHousingResponse(),
    )
    service = CamperJourneyService(_repo(pb), household_journey=household_read, person_housing=housing_read)
    return service, household_read, housing_read


@pytest.fixture
def people_pb() -> FakePB:
    return FakePB("persons")


class TestCamperJourneyService:
    @pytest.mark.asyncio
    async def test_reads_nothing_for_no_person(self, people_pb: FakePB) -> None:
        service, household_read, housing_read = _service(people_pb)

        result = await service.build_camper_journey(0, YEAR)

        assert result.rows == []
        assert result.counts == CamperJourneyCounts()
        for mock in people_pb.lists.values():
            mock.assert_not_called()
        household_read.assert_not_called()
        housing_read.assert_not_called()

    @pytest.mark.asyncio
    async def test_reads_the_persons_rows_by_campminder_id(self, people_pb: FakePB) -> None:
        service, _, _ = _service(people_pb)

        await service.build_camper_journey(PERSON, YEAR)

        assert f"cm_id = {PERSON}" in people_pb.filter_of("persons")

    @pytest.mark.asyncio
    async def test_threads_the_view_year_household_into_the_household_journey_read(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(YEAR), person_row(2024, household_id=444)]
        service, household_read, housing_read = _service(people_pb)

        await service.build_camper_journey(PERSON, YEAR)

        household_read.assert_awaited_once_with(555)
        housing_read.assert_awaited_once_with(PERSON)

    @pytest.mark.asyncio
    async def test_runs_with_no_family_housing_when_the_person_has_no_household(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(YEAR, household_id=0)]
        people_pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        service, household_read, _ = _service(people_pb)

        result = await service.build_camper_journey(PERSON, YEAR)

        household_read.assert_not_called()
        assert result.rows[0].bunk_name is None

    @pytest.mark.asyncio
    async def test_labels_family_rows_from_the_household_journey(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(YEAR, age=12.04)]
        people_pb.lists["attendees"].return_value = [attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend")]
        household = HouseholdJourneyResponse(household_cm_id=555, years=[household_year()])
        service, _, _ = _service(people_pb, household=household)

        result = await service.build_camper_journey(PERSON, YEAR)

        assert_matches(result.rows[0], bunk_name="Meadow House 1", bunk_name_recorded="Old Meadow 1")

    @pytest.mark.asyncio
    async def test_adds_parent_rows_only_for_a_viewer_the_person_rows_call_an_adult(self, people_pb: FakePB) -> None:
        household = HouseholdJourneyResponse(household_cm_id=555, years=[household_year()])

        people_pb.lists["persons"].return_value = [person_row(YEAR, age=43.01)]
        adult, _, _ = _service(people_pb, household=household)
        assert len((await adult.build_camper_journey(PERSON, YEAR)).rows) == 1

        people_pb.lists["persons"].return_value = [person_row(YEAR, age=12.04)]
        child, _, _ = _service(people_pb, household=household)
        assert (await child.build_camper_journey(PERSON, YEAR)).rows == []

    @pytest.mark.asyncio
    async def test_labels_adult_and_teen_rows_from_the_person_housing_read(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(YEAR)]
        people_pb.lists["attendees"].return_value = [
            attendee(2024, 1001, "adult", "Women's Weekend"),
            attendee(2025, 2001, "scit", "Counselor In-Training"),
        ]
        housing = PersonHousingResponse(
            person_cm_id=PERSON, weekends=[adult_housing(2024, 1001, "River F")], teen_cabins=[RESOLVED_TEEN]
        )
        service, _, _ = _service(people_pb, housing=housing)

        result = await service.build_camper_journey(PERSON, YEAR)

        assert_matches(by_name(result.rows, "Women's Weekend"), bunk_name="River F")
        assert_matches(by_name(result.rows, "Counselor In-Training"), bunk_name="Village Cabin 2")

    @pytest.mark.asyncio
    async def test_passes_the_teen_cabins_through_for_the_clients_current_year_rows(self, people_pb: FakePB) -> None:
        """`useCamperHistory` builds the current year from live attendees and
        labels a TLI/SCIT row from these -- the endpoint replaces the housing
        read that used to supply them."""
        people_pb.lists["persons"].return_value = [person_row(YEAR)]
        current = housing_weekend(YEAR, 2001, "Village Cabin 2", "Teen 2")
        housing = PersonHousingResponse(person_cm_id=PERSON, teen_cabins=[RESOLVED_TEEN, current])
        service, _, _ = _service(people_pb, housing=housing)

        result = await service.build_camper_journey(PERSON, YEAR)

        assert result.teen_cabins == [RESOLVED_TEEN, current]

    @pytest.mark.asyncio
    async def test_composes_counts_from_summers_and_the_feed(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(2019, years_at_camp=1), person_row(YEAR)]
        people_pb.lists["attendees"].return_value = [
            attendee(2024, 1001, "adult", "Women's Weekend"),
            attendee(2025, 1001, "adult", "Women's Weekend"),
            attendee(2023, 900, "family", "Family Camp 2: Keshet Weekend"),
        ]
        service, _, _ = _service(people_pb)

        result = await service.build_camper_journey(PERSON, YEAR)

        assert result.counts == CamperJourneyCounts(summers=1, family_weekends=1, adult_weekends=2)

    @pytest.mark.asyncio
    async def test_the_feed_reads_through_the_requested_year(self, people_pb: FakePB) -> None:
        people_pb.lists["persons"].return_value = [person_row(2024)]
        service, _, _ = _service(people_pb)

        await service.build_camper_journey(PERSON, 2024)

        assert "year <= 2024" in people_pb.filter_of("attendees")

    @pytest.mark.asyncio
    async def test_degrades_to_unlabeled_rows_when_a_housing_read_fails(self, people_pb: FakePB) -> None:
        """The client's deliberate graceful degradation, kept: an ERRORED
        household or housing read still let the feed run with empty housing,
        and the rows rendered unlabeled rather than the journey erroring."""
        people_pb.lists["persons"].return_value = [person_row(YEAR)]
        people_pb.lists["attendees"].return_value = [
            attendee(2024, 900, "family", "Family Camp 2: Keshet Weekend"),
            attendee(2024, 1001, "adult", "Women's Weekend"),
        ]
        service, _, _ = _service(people_pb, household=RuntimeError("boom"), housing=RuntimeError("boom"))

        result = await service.build_camper_journey(PERSON, YEAR)

        assert len(result.rows) == 2
        for row in result.rows:
            assert row.bunk_name is None
        assert result.teen_cabins == []

    @pytest.mark.asyncio
    async def test_a_failed_persons_read_is_an_error_not_an_empty_journey(self, people_pb: FakePB) -> None:
        """The client surfaced a failed persons read as the hook's error; only
        the two housing reads degraded."""
        people_pb.lists["persons"].side_effect = RuntimeError("boom")
        service, _, _ = _service(people_pb)

        with pytest.raises(RuntimeError):
            await service.build_camper_journey(PERSON, YEAR)


class TestAdultAgeMatchesTheClient:
    def test_adult_age_is_the_same_cutoff_the_client_formats_ages_with(self) -> None:
        """`utils/age.ts` still owns the display cutoff (`formatAge`); two
        copies of 21 are how the two would drift the next time it moves."""
        age_ts = Path(__file__).resolve().parents[4] / "frontend" / "src" / "utils" / "age.ts"
        match = re.search(r"export const ADULT_AGE = (\d+)", age_ts.read_text())
        assert match is not None
        assert int(match.group(1)) == ADULT_AGE


class TestJourneyTypesMatchTheClient:
    def test_the_journey_session_types_are_the_clients_camper_journey_types(self) -> None:
        """`CAMPER_JOURNEY_TYPES` is CAMPER_DETAIL_TYPES plus 'family', deduped,
        and the Siblings panel still reads it. The server's copy must name the
        same programs, or one surface would show a year the other hides."""
        predicates = Path(__file__).resolve().parents[4] / "frontend" / "src" / "utils" / "sessionTypePredicates.ts"
        match = re.search(r"export const CAMPER_DETAIL_TYPES = \[(.*?)\] as const", predicates.read_text(), re.S)
        assert match is not None
        detail = set(re.findall(r"'([a-z]+)'", match.group(1)))
        assert set(CAMPER_JOURNEY_SESSION_TYPES) == detail | {"family"}
        assert len(set(CAMPER_JOURNEY_SESSION_TYPES)) == len(CAMPER_JOURNEY_SESSION_TYPES)

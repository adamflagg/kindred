"""Tenure bands read CampMinder's Years At Camp (epic #3207 decisions 36 and 36b).

"Summers at Camp" on Registration, Retention, Trends and their drill-downs is the
camper's `persons.years_at_camp` for the season being viewed. Attendance history
only reaches back to 2017, so before 2025 it undercounted long-tenure campers
(no one could show 8+ summers in 2022-2024). First Summer Year stays a year read
from history, and its earliest bucket, 2017, holds everyone whose first summer is
2017 or earlier.
"""

from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock

import pytest


@dataclass
class Person:
    cm_id: int
    years_at_camp: int | None = None
    gender: str | None = "F"
    grade: int | None = 6
    first_name: str = "Emma"
    last_name: str = "Johnson"
    preferred_name: str | None = None
    age: int | None = 11
    school: str | None = None
    normalized_school: str | None = None
    normalized_city: str | None = None
    address_city: str | None = None
    normalized_congregation: str | None = None
    household_id: int | None = None


@dataclass
class Session:
    cm_id: int
    year: int
    name: str = "Session 2"
    session_type: str = "main"
    parent_id: int | None = None
    start_date: str = ""
    end_date: str = ""

    def __post_init__(self) -> None:
        self.start_date = self.start_date or f"{self.year}-06-20"
        self.end_date = self.end_date or f"{self.year}-07-10"


@dataclass
class Attendee:
    person_id: int
    year: int
    session: Session
    status: str = "enrolled"
    status_id: int = 2
    expand: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.expand = {"session": self.session}


def _session(year: int) -> Session:
    return Session(cm_id=1000 + year, year=year)


def _history(person_id: int, *years: int) -> list[Attendee]:
    """Enrolled summer history: one main session per year."""
    return [Attendee(person_id, y, _session(y)) for y in years]


def _repo(
    attendees_by_year: dict[int, list[Attendee]],
    persons_by_year: dict[int, dict[int, Person]],
    history: list[Attendee],
) -> AsyncMock:
    repo = AsyncMock()

    async def fetch_attendees(year: int, *args: Any, **kwargs: Any) -> list[Attendee]:
        status = args[0] if args else kwargs.get("status_filter")
        rows = attendees_by_year.get(year, [])
        if status in (None, "enrolled", ["enrolled"]):
            return rows
        return []

    async def fetch_persons(year: int, *args: Any, **kwargs: Any) -> dict[int, Person]:
        return persons_by_year.get(year, {})

    async def fetch_sessions(year: int, *args: Any, **kwargs: Any) -> dict[int, Session]:
        s = _session(year)
        types = args[0] if args else kwargs.get("session_types")
        return {s.cm_id: s} if types is None or s.session_type in types else {}

    async def fetch_history(person_ids: set[int], max_year: int) -> list[Attendee]:
        return [r for r in history if r.year <= max_year and r.person_id in person_ids]

    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_persons.side_effect = fetch_persons
    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_summer_enrollment_history.side_effect = fetch_history
    repo.fetch_bunk_plans.return_value = []
    repo.fetch_bunk_assignments.return_value = []
    repo.fetch_capacity_config.return_value = 12
    return repo


# A long-tenure camper: CampMinder says 9 summers in 2024, history (2017+, no 2020) holds only 7.
LONG_TENURE_HISTORY = _history(1, 2017, 2018, 2019, 2021, 2022, 2023, 2024)


class TestRegistrationSummersAtCamp:
    @pytest.mark.asyncio
    async def test_summers_at_camp_is_years_at_camp_not_history(self) -> None:
        from api.services.registration_service import RegistrationService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=9), 2: Person(2, years_at_camp=1)}},
            [*LONG_TENURE_HISTORY, *_history(2, 2024)],
        )

        result = await RegistrationService(repo).calculate_registration(2024)

        assert {b.summer_years: b.count for b in result.by_summer_years} == {1: 1, 9: 1}

    @pytest.mark.asyncio
    async def test_a_camper_with_no_persons_row_is_left_out_like_every_person_field(self) -> None:
        from api.services.registration_service import RegistrationService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=3)}},
            [*_history(1, 2022, 2023, 2024), *_history(2, 2023, 2024)],
        )

        result = await RegistrationService(repo).calculate_registration(2024)

        assert {b.summer_years: b.count for b in result.by_summer_years} == {3: 1}

    @pytest.mark.asyncio
    async def test_no_years_recorded_reads_zero_as_the_years_at_camp_chart_does(self) -> None:
        from api.services.registration_service import RegistrationService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=None)}},
            _history(1, 2023, 2024),
        )

        result = await RegistrationService(repo).calculate_registration(2024)

        assert {b.summer_years: b.count for b in result.by_summer_years} == {0: 1}

    @pytest.mark.asyncio
    async def test_first_summer_year_folds_anything_before_2017_into_2017(self) -> None:
        """36b: the earliest bucket is "2017 or earlier", so an older history row lands in it."""
        from api.services.registration_service import RegistrationService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=6), 2: Person(2, years_at_camp=5)}},
            [*_history(1, 2015, 2024), *_history(2, 2017, 2024)],
        )

        result = await RegistrationService(repo).calculate_registration(2024)

        assert {b.first_summer_year: b.count for b in result.by_first_summer_year} == {2017: 2}


class TestRetentionBySummersAtCamp:
    @pytest.mark.asyncio
    async def test_band_is_the_base_years_years_at_camp(self) -> None:
        """Retention 2024 -> 2025 bands each camper by their 2024 Years At Camp."""
        from api.services.retention_service import RetentionService

        repo = _repo(
            {
                2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))],
                2025: [Attendee(1, 2025, _session(2025))],
            },
            {
                2024: {1: Person(1, years_at_camp=9), 2: Person(2, years_at_camp=9)},
                2025: {1: Person(1, years_at_camp=10)},
            },
            [*LONG_TENURE_HISTORY, *_history(2, 2023, 2024)],
        )

        result = await RetentionService(repo).calculate_retention(2024, 2025)

        assert {b.summer_years: (b.base_count, b.returned_count) for b in result.by_summer_years} == {9: (2, 1)}

    @pytest.mark.asyncio
    async def test_a_camper_with_no_persons_row_is_left_out(self) -> None:
        from api.services.retention_service import RetentionService

        repo = _repo(
            {
                2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))],
                2025: [],
            },
            {2024: {1: Person(1, years_at_camp=4)}},
            [*_history(1, 2024), *_history(2, 2024)],
        )

        result = await RetentionService(repo).calculate_retention(2024, 2025)

        assert {b.summer_years: b.base_count for b in result.by_summer_years} == {4: 1}

    @pytest.mark.asyncio
    async def test_first_summer_year_folds_before_2017(self) -> None:
        from api.services.retention_service import RetentionService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))], 2025: []},
            {2024: {1: Person(1, years_at_camp=6)}},
            _history(1, 2016, 2024),
        )

        result = await RetentionService(repo).calculate_retention(2024, 2025)

        assert [b.first_summer_year for b in result.by_first_summer_year] == [2017]


class TestTrendsSummersAtCamp:
    @pytest.mark.asyncio
    async def test_each_year_reads_that_years_years_at_camp(self) -> None:
        from api.services.retention_trends_service import RetentionTrendsService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))], 2025: [Attendee(1, 2025, _session(2025))]},
            {2024: {1: Person(1, years_at_camp=9)}, 2025: {1: Person(1, years_at_camp=10)}},
            [*LONG_TENURE_HISTORY, *_history(1, 2025)],
        )

        result = await RetentionTrendsService(repo).calculate_retention_trends(current_year=2025, num_years=1)

        by_year = {e.year: {b.summer_years: b.count for b in e.by_summer_years} for e in result.enrollment_by_year}
        assert by_year == {2024: {9: 1}, 2025: {10: 1}}

    @pytest.mark.asyncio
    async def test_first_summer_year_folds_before_2017(self) -> None:
        from api.services.retention_trends_service import RetentionTrendsService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))], 2025: [Attendee(1, 2025, _session(2025))]},
            {2024: {1: Person(1, years_at_camp=5)}, 2025: {1: Person(1, years_at_camp=6)}},
            _history(1, 2015, 2024, 2025),
        )

        result = await RetentionTrendsService(repo).calculate_retention_trends(current_year=2025, num_years=1)

        assert {e.year: [b.first_summer_year for b in e.by_first_summer_year] for e in result.enrollment_by_year} == {
            2024: [2017],
            2025: [2017],
        }


class TestDrilldowns:
    @pytest.mark.asyncio
    async def test_summer_years_drilldown_lists_campers_by_years_at_camp(self) -> None:
        from api.services.drilldown_service import DrilldownService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=9), 2: Person(2, years_at_camp=7)}},
            [*LONG_TENURE_HISTORY, *_history(2, 2023, 2024)],
        )

        rows = await DrilldownService(repo).get_attendees_for_breakdown(2024, "summer_years", "9")

        assert [r.person_id for r in rows] == [1]

    @pytest.mark.asyncio
    async def test_retention_summer_years_drilldown_reads_the_base_year(self) -> None:
        from api.services.drilldown_service import DrilldownService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))], 2025: [Attendee(1, 2025, _session(2025))]},
            {2024: {1: Person(1, years_at_camp=9)}, 2025: {1: Person(1, years_at_camp=10)}},
            LONG_TENURE_HISTORY,
        )

        rows = await DrilldownService(repo).get_attendees_for_breakdown(2024, "summer_years", "9", compare_year=2025)

        assert [(r.person_id, r.is_returning) for r in rows] == [(1, True)]

    @pytest.mark.asyncio
    async def test_years_at_camp_zero_bar_lists_campers_with_no_years_recorded(self) -> None:
        """The Summers at Camp bar counts a missing value as 0; its drill-down lists the same camper."""
        from api.services.drilldown_service import DrilldownService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=None)}},
            _history(1, 2024),
        )

        rows = await DrilldownService(repo).get_attendees_for_breakdown(2024, "years_at_camp", "0")

        assert [r.person_id for r in rows] == [1]

    @pytest.mark.asyncio
    async def test_first_summer_2017_drilldown_includes_earlier_first_summers(self) -> None:
        from api.services.drilldown_service import DrilldownService

        repo = _repo(
            {2024: [Attendee(1, 2024, _session(2024)), Attendee(2, 2024, _session(2024))]},
            {2024: {1: Person(1, years_at_camp=6), 2: Person(2, years_at_camp=5)}},
            [*_history(1, 2015, 2024), *_history(2, 2017, 2024)],
        )

        rows = await DrilldownService(repo).get_attendees_for_breakdown(2024, "first_summer_year", "2017")

        assert sorted(r.person_id for r in rows) == [1, 2]


class TestFirstSummerYears:
    def test_folds_before_the_first_history_summer(self) -> None:
        from api.utils.session_metrics import FIRST_HISTORY_SUMMER, compute_first_summer_years

        assert FIRST_HISTORY_SUMMER == 2017
        history = [*_history(1, 2014, 2019), *_history(2, 2019, 2021)]
        assert compute_first_summer_years(history, {1, 2}) == {1: 2017, 2: 2019}


class TestAverageSummersAtCamp:
    """D-UNCOVERED (owner, 2026-10-15): "Average N summers per camper, this one included",
    the mean of the charted campers' Years At Camp (decision 12: CampMinder's figure)."""

    @pytest.mark.asyncio
    async def test_average_is_the_mean_of_the_charted_campers_years_at_camp(self) -> None:
        from api.services.registration_service import RegistrationService

        repo = _repo(
            {2024: [Attendee(pid, 2024, _session(2024)) for pid in (1, 2, 3, 4)]},
            {2024: {1: Person(1, years_at_camp=1), 2: Person(2, years_at_camp=2), 3: Person(3, years_at_camp=6)}},
            [],
        )

        result = await RegistrationService(repo).calculate_registration(2024)

        # Camper 4 has no persons row, so is off the chart and out of the average.
        assert result.average_summers_at_camp == pytest.approx(3.0)

    @pytest.mark.asyncio
    async def test_no_campers_means_no_average(self) -> None:
        from api.services.registration_service import RegistrationService

        repo = _repo({2024: []}, {2024: {}}, [])

        result = await RegistrationService(repo).calculate_registration(2024)

        assert result.average_summers_at_camp is None

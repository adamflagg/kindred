"""Retention compares with the same point last year while registration is live (#3207 PR 11, decision 7).

``calculate_retention(B-1, B, ..., same_point_of=C)`` reads season ``B`` as it stood at the registration
day season ``C`` has reached today, so the prior year's retention is "of the campers enrolled in B-1, the
share registered for B by that day and not cancelled by then". After season C, or when B has no anchor,
it reads B as it stands now ("final"). Retention and Trends pair these figures with this season's.

``calculate_retention_trends(..., same_point=True)`` adds, while the newest season is live, each
transition's retention at the same registration day of its own season (ruling #89's dashed line).
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.retention_service import RetentionService
from api.services.retention_trends_service import RetentionTrendsService

CURRENT = 2026
PRIOR = 2025
BASE = 2024
ANCHORS = {2026: "2025-11-12", 2025: "2024-11-12", 2024: "2023-11-07"}
STATUS_IDS = {"enrolled": 2, "cancelled": 32, "withdrawn": 256, "waitlisted": 8}


@dataclass
class _Session:
    cm_id: int
    name: str
    session_type: str = "main"
    parent_id: int | None = None
    start_date: str | None = "2025-06-15"
    end_date: str | None = "2025-07-05"


@dataclass
class _Person:
    cm_id: int
    gender: str | None = "F"
    grade: int | None = 5
    years_at_camp: int | None = 1
    normalized_school: str | None = None
    school: str | None = None
    normalized_city: str | None = None
    address_city: str | None = None
    normalized_congregation: str | None = None
    gender_identity_name: str | None = None


@dataclass
class _Att:
    person_id: int
    year: int
    status: str = "enrolled"
    status_id: int = 2
    effective_date: str = ""
    enrollment_date: str = ""
    expand: dict[str, Any] = field(default_factory=dict)


SESSION = _Session(1000, "Session 2")


def _att(pid: int, year: int, status: str = "enrolled", registered: str = "", posted: str | None = None) -> _Att:
    return _Att(
        person_id=pid,
        year=year,
        status=status,
        status_id=STATUS_IDS[status],
        effective_date=registered,
        enrollment_date=posted or registered,
        expand={"session": SESSION},
    )


# 2024's six campers: the base the prior read counts from.
BASE_ROWS = [_att(pid, BASE, registered="2023-11-07") for pid in range(1, 7)]
# 2025 read at day 110 of 2026's season (2026-03-02) -> cutoff 2025-03-02 (day 110 from 2024-11-12).
PRIOR_ROWS = [
    _att(1, PRIOR, "enrolled", "2024-11-12"),  # registered on the priority day, still enrolled
    _att(2, PRIOR, "enrolled", "2025-03-02"),  # registered on the cutoff day itself: counts
    _att(3, PRIOR, "enrolled", "2025-04-20"),  # registered after the cutoff: not yet returned then
    _att(4, PRIOR, "cancelled", "2024-11-13", "2025-05-01"),  # cancelled after the cutoff: returned then
    _att(5, PRIOR, "cancelled", "2024-11-13", "2025-01-10"),  # cancelled by the cutoff: not returned
    _att(6, PRIOR, "withdrawn", "2024-11-20", "2025-02-01"),  # withdrawn by the cutoff: not returned
]


def _repo(rows: list[_Att], anchors: dict[int, str] | None = None) -> AsyncMock:
    anchors = ANCHORS if anchors is None else anchors
    repo = AsyncMock()

    async def fetch_attendees(year: int, status_filter: Any = None, expand_person: bool = False) -> list[Any]:
        return [a for a in rows if a.year == year and a.status == "enrolled"]

    async def with_dates(year: int, session_cm_id: int | None = None, expand_person: bool = False) -> list[Any]:
        return [a for a in rows if a.year == year]

    async def fetch_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": anchors[year]} if year in anchors else {}

    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_attendees_with_dates.side_effect = with_dates
    repo.fetch_registration_dates.side_effect = fetch_dates
    repo.fetch_sessions.return_value = {1000: SESSION}
    repo.fetch_persons.return_value = {i: _Person(i, grade=5 if i < 4 else 6) for i in range(1, 10)}
    repo.fetch_bunk_assignments.return_value = []
    repo.fetch_summer_enrollment_history.return_value = []
    return repo


class TestRetentionSamePoint:
    @pytest.mark.asyncio
    async def test_live_season_reads_the_prior_year_at_the_same_registration_day(self) -> None:
        service = RetentionService(_repo(BASE_ROWS + PRIOR_ROWS))

        result = await service.calculate_retention(BASE, PRIOR, same_point_of=CURRENT, today=date(2026, 3, 2))

        assert result.prior_basis == "same_point"
        assert result.day_offset == 110
        assert result.prior_day_offset == 110
        assert result.as_of_date == "2025-03-02"
        # 1, 2 and 4 were registered for 2025 by the day and not cancelled by it
        assert result.base_year_total == 6
        assert result.returned_count == 3
        assert result.overall_retention_rate == pytest.approx(0.5)

    @pytest.mark.asyncio
    async def test_every_breakdown_reads_the_same_day(self) -> None:
        """Decision #87: no half-switched page, so the breakdowns count the same returners as the headline."""
        service = RetentionService(_repo(BASE_ROWS + PRIOR_ROWS))

        result = await service.calculate_retention(BASE, PRIOR, same_point_of=CURRENT, today=date(2026, 3, 2))

        grades = {g.grade: (g.base_count, g.returned_count) for g in result.by_grade}
        assert grades == {5: (3, 2), 6: (3, 1)}  # 1, 2 returned of grade 5; 4 of grade 6
        assert sum(s.returned_count for s in result.by_session) == 3
        assert sum(s.returned_count for s in result.by_prior_session) == 3
        assert sum(g.returned_count for g in result.by_gender) == 3

    @pytest.mark.asyncio
    async def test_priority_date_reads_the_prior_year_through_the_next_day(self) -> None:
        """Decision 45: day 0 reads the prior through day 1, where its batch-dated sign-ups sit."""
        rows = BASE_ROWS + [_att(1, PRIOR, "enrolled", "2024-11-12"), _att(2, PRIOR, "enrolled", "2024-11-13")]
        service = RetentionService(_repo(rows))

        result = await service.calculate_retention(BASE, PRIOR, same_point_of=CURRENT, today=date(2025, 11, 12))

        assert result.prior_basis == "same_point"
        assert result.day_offset == 0
        assert result.prior_day_offset == 1
        assert result.as_of_date == "2024-11-13"
        assert result.returned_count == 2

    @pytest.mark.asyncio
    async def test_before_the_anchor_reads_the_prior_year_at_the_same_negative_day(self) -> None:
        """2027 before its priority date: a negative day, read the same way (nothing registered may be 0)."""
        anchors = {2027: "2026-11-11", 2026: "2025-11-12"}
        rows = [_att(1, 2025, registered="2024-11-12"), _att(2, 2025, registered="2024-11-12")]
        rows += [_att(1, 2026, "enrolled", "2025-10-01"), _att(2, 2026, "enrolled", "2025-11-12")]
        service = RetentionService(_repo(rows, anchors))

        result = await service.calculate_retention(2025, 2026, same_point_of=2027, today=date(2026, 10, 16))

        assert result.prior_basis == "same_point"
        assert result.day_offset == -26
        assert result.as_of_date == "2025-10-17"
        assert result.returned_count == 1  # only the early deposit was in by then

    @pytest.mark.asyncio
    async def test_after_the_season_reads_the_prior_year_final(self) -> None:
        service = RetentionService(_repo(BASE_ROWS + PRIOR_ROWS))

        result = await service.calculate_retention(BASE, PRIOR, same_point_of=CURRENT, today=date(2026, 9, 30))

        assert result.prior_basis == "final"
        assert result.as_of_date is None
        assert result.day_offset is None
        # As 2025 stands now: 1, 2, 3 are enrolled
        assert result.returned_count == 3

    @pytest.mark.asyncio
    async def test_no_anchor_for_the_live_season_compares_finals(self) -> None:
        service = RetentionService(_repo(BASE_ROWS + PRIOR_ROWS, {PRIOR: "2024-11-12"}))

        result = await service.calculate_retention(BASE, PRIOR, same_point_of=CURRENT, today=date(2026, 3, 2))

        assert result.prior_basis == "final"
        assert result.as_of_date is None

    @pytest.mark.asyncio
    async def test_without_same_point_of_the_read_is_unchanged(self) -> None:
        repo = _repo(BASE_ROWS + PRIOR_ROWS)
        service = RetentionService(repo)

        result = await service.calculate_retention(BASE, PRIOR)

        assert result.prior_basis is None
        assert result.returned_count == 3
        repo.fetch_attendees_with_dates.assert_not_called()


def _trend_repo(rows: list[_Att], anchors: dict[int, str] | None = None) -> AsyncMock:
    repo = _repo(rows, anchors)
    # The trends service reads every year's sessions unfiltered and gates the summer window from main
    repo.fetch_sessions.return_value = {1000: SESSION}
    return repo


class TestRetentionTrendsSamePoint:
    # 2025's base 1-6; 2026 so far: 1, 2, 3 (today's count, as the solid line has it)
    # 2025 final: 1, 2 and 3 of 2024's six returned. By 2025-03-02 only 1 and 4 had (2 and 3 came later).
    TREND_ROWS = (
        BASE_ROWS
        + [
            _att(1, PRIOR, "enrolled", "2024-11-12"),
            _att(2, PRIOR, "enrolled", "2025-04-01"),
            _att(3, PRIOR, "enrolled", "2025-04-20"),
            _att(4, PRIOR, "cancelled", "2024-11-13", "2025-05-01"),
        ]
        + [_att(pid, CURRENT, "enrolled", "2025-11-12") for pid in (1, 2, 3)]
    )

    @pytest.mark.asyncio
    async def test_live_season_adds_each_year_at_the_same_registration_day(self) -> None:
        service = RetentionTrendsService(_trend_repo(self.TREND_ROWS))

        result = await service.calculate_retention_trends(CURRENT, num_years=2, same_point=True, today=date(2026, 3, 2))

        assert result.prior_basis == "same_point"
        assert result.day_offset == 110
        assert result.prior_day_offset == 110
        # The live season's prior, as it stood: 2025 on 2025-03-02
        assert result.as_of_date == "2025-03-02"
        by_to = {y.to_year: y for y in result.years}
        # 2024 -> 2025 at day 110 of 2025's season: 1 and 4 of 2024's six
        assert by_to[PRIOR].same_point_rate == pytest.approx(2 / 6)
        assert by_to[PRIOR].same_point_as_of == "2025-03-02"
        # 2024 -> 2025 final is unchanged: 1, 2, 3
        assert by_to[PRIOR].retention_rate == pytest.approx(0.5)
        # The live season's own point is today's count, read on today
        live = by_to[CURRENT]
        assert live.same_point_rate == pytest.approx(live.retention_rate)
        assert live.same_point_as_of == "2026-03-02"

    @pytest.mark.asyncio
    async def test_a_year_without_an_anchor_has_no_same_point(self) -> None:
        anchors = {2026: "2025-11-12"}  # 2025 has no priority or early date
        service = RetentionTrendsService(_trend_repo(self.TREND_ROWS, anchors))

        result = await service.calculate_retention_trends(CURRENT, num_years=2, same_point=True, today=date(2026, 3, 2))

        by_to = {y.to_year: y for y in result.years}
        assert by_to[PRIOR].same_point_rate is None
        assert by_to[CURRENT].same_point_rate == pytest.approx(by_to[CURRENT].retention_rate)

    @pytest.mark.asyncio
    async def test_after_the_season_there_is_no_same_point_series(self) -> None:
        repo = _trend_repo(self.TREND_ROWS)
        service = RetentionTrendsService(repo)

        result = await service.calculate_retention_trends(
            CURRENT, num_years=2, same_point=True, today=date(2026, 9, 30)
        )

        assert result.prior_basis == "final"
        assert result.as_of_date is None
        assert all(y.same_point_rate is None for y in result.years)
        repo.fetch_attendees_with_dates.assert_not_called()

    @pytest.mark.asyncio
    async def test_without_same_point_nothing_is_read_by_date(self) -> None:
        repo = _trend_repo(self.TREND_ROWS)
        service = RetentionTrendsService(repo)

        result = await service.calculate_retention_trends(CURRENT, num_years=2)

        assert result.prior_basis is None
        assert all(y.same_point_rate is None for y in result.years)
        repo.fetch_registration_dates.assert_not_called()

"""Tests for 10th grader exclusion in retention trends.

Verifies that:
- 10th graders are excluded from trend base counts and returned counts
- Enrollment counts are NOT affected (only retention is filtered)
- aged_out_count is reported per trend year
"""

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from api.services.retention_trends_service import RetentionTrendsService

# ============================================================================
# Helpers
# ============================================================================


def _make_person(cm_id: int, grade: int | None = 7, gender: str = "M") -> Mock:
    p = Mock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    p.years_at_camp = 2
    p.school = "Riverside Elementary"
    p.normalized_school = None
    p.normalized_city = None
    p.normalized_congregation = None
    p.address_city = "Springfield"
    return p


def _make_session(cm_id: int, name: str = "Session 2", session_type: str = "main") -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = None
    s.start_date = "2025-06-15"
    s.end_date = "2025-07-05"
    return s


def _make_attendee(person_id: int, session: Mock) -> Mock:
    a = Mock()
    a.person_id = person_id
    a.expand = {"session": session}
    a.status = "enrolled"
    return a


class TestRetentionTrendsAgedOutExclusion:
    """10th graders should be excluded from retention trend calculations."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup_repo(
        self,
        repo: AsyncMock,
        data_by_year: dict[int, dict[str, Any]],
    ) -> None:
        """Wire up mock repository with multi-year data."""

        async def fetch_attendees(year: int, *args: Any, **kwargs: Any) -> list[Any]:
            return data_by_year.get(year, {}).get("attendees", [])  # type: ignore[no-any-return]

        async def fetch_persons(year: int) -> dict[int, Any]:
            return data_by_year.get(year, {}).get("persons", {})  # type: ignore[no-any-return]

        async def fetch_sessions(year: int, types: Any) -> dict[int, Any]:
            return data_by_year.get(year, {}).get("sessions", {})  # type: ignore[no-any-return]

        repo.fetch_attendees = AsyncMock(side_effect=fetch_attendees)
        repo.fetch_persons = AsyncMock(side_effect=fetch_persons)
        repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_trend_base_count(self, repo: AsyncMock) -> None:
        """Trend base_count should not include 10th graders."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),  # grade 7
                    _make_attendee(2, session_2025),  # grade 10 - excluded
                    _make_attendee(3, session_2025),  # grade 8
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                    3: _make_person(3, grade=8),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [
                    _make_attendee(1, session_2026),
                    _make_attendee(3, session_2026),
                ],
                "persons": {
                    1: _make_person(1, grade=8),
                    3: _make_person(3, grade=9),
                },
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        assert len(result.years) == 1
        trend = result.years[0]
        # Base should be 2 (persons 1, 3) not 3
        assert trend.base_count == 2
        # Both returned
        assert trend.returned_count == 2

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_returns_aged_out_count(self, repo: AsyncMock) -> None:
        """Each trend year should report aged_out_count."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),
                    _make_attendee(2, session_2025),  # grade 10
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        assert result.years[0].aged_out_count == 1

    @pytest.mark.asyncio
    async def test_enrollment_not_affected_by_exclusion(self, repo: AsyncMock) -> None:
        """enrollment_by_year totals should NOT exclude 10th graders."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),
                    _make_attendee(2, session_2025),  # grade 10
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        # Enrollment should include ALL persons (including 10th graders)
        enrollment_2025 = next((e for e in result.enrollment_by_year if e.year == 2025), None)
        assert enrollment_2025 is not None
        assert enrollment_2025.total == 2  # both persons

    @pytest.mark.asyncio
    async def test_trend_retention_rate_correct_after_exclusion(self, repo: AsyncMock) -> None:
        """Retention rate should be calculated from filtered base."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),  # grade 7, returns
                    _make_attendee(2, session_2025),  # grade 10, excluded
                    _make_attendee(3, session_2025),  # grade 8, doesn't return
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                    3: _make_person(3, grade=8),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        # Base=2 (1,3), returned=1 (1), rate=50%
        assert result.years[0].retention_rate == pytest.approx(0.5)

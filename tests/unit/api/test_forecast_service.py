"""
TDD tests for the forecast service.

Tests verify per-session enrollment vs budget goals, prior year comparison,
capacity calculation, and revenue projections.

These tests are written FIRST before implementation (TDD).
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, Mock

import pytest

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.forecast_service import ForecastService

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_session(
    cm_id: int,
    name: str,
    year: int = 2026,
    session_type: str = "main",
    start_date: str = "2026-06-15",
    parent_id: int | None = None,
    pb_id: str | None = None,
    sort_order: int = 0,
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.id = pb_id or f"pb_{cm_id}"
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.parent_id = parent_id
    session.sort_order = sort_order
    return session


def create_mock_attendee(
    person_id: int,
    session_cm_id: int,
    year: int = 2026,
    status: str = "enrolled",
    is_active: bool = True,
    status_id: int = 2,
) -> Mock:
    """Create a mock attendee with session expand."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.year = year
    attendee.status = status
    attendee.is_active = is_active
    attendee.status_id = status_id

    session = Mock()
    session.cm_id = session_cm_id
    attendee.expand = {"session": session}
    return attendee


def create_mock_bunk_plan(
    session_pb_id: str,
    bunk_name: str = "B-1",
) -> Mock:
    """Create a mock bunk_plan with bunk expand."""
    plan = Mock()
    plan.session = session_pb_id

    bunk = Mock()
    bunk.name = bunk_name
    plan.expand = {"bunk": bunk}
    return plan


def create_mock_budget_config(
    session_cm_id: int,
    participant_goal: int | None = None,
    session_fee: float | None = None,
) -> tuple[int, dict]:
    """Return (session_cm_id, config_dict) for budget config."""
    config: dict = {}
    if participant_goal is not None:
        config["participant_goal"] = participant_goal
    if session_fee is not None:
        config["session_fee"] = session_fee
    return (session_cm_id, config)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository with default empty returns."""
    repo = AsyncMock()
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_bunk_plans = AsyncMock(return_value=[])
    repo.fetch_capacity_config = AsyncMock(return_value=12)
    repo.fetch_budget_config = AsyncMock(return_value={})
    return repo


@pytest.fixture
def service(mock_repository):
    """Create a ForecastService with mock repository."""
    return ForecastService(mock_repository)


# ============================================================================
# Basic Enrollment Tests
# ============================================================================


class TestForecastBasicEnrollment:
    """Test basic enrollment counting without budget config."""

    @pytest.mark.asyncio
    async def test_forecast_basic_enrollment(self, service, mock_repository):
        """Two sessions with attendees, no budget config.

        Should return correct enrolled counts with null budget fields.
        """
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [
            create_mock_attendee(101, 1001),
            create_mock_attendee(102, 1001),
            create_mock_attendee(103, 1001),
            create_mock_attendee(201, 1002),
            create_mock_attendee(202, 1002),
        ]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        assert result.year == 2026
        assert len(result.sessions) == 2

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 3
        assert s1.participant_goal is None
        assert s1.pct_of_goal is None
        assert s1.budget_revenue is None
        assert s1.actual_revenue is None
        assert s1.revenue_pct is None

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.enrolled == 2

        # Grand total should sum all sessions
        assert result.grand_total.enrolled == 5


# ============================================================================
# Budget Config Tests
# ============================================================================


class TestForecastWithBudgetConfig:
    """Test forecast with budget goals and fees configured."""

    @pytest.mark.asyncio
    async def test_forecast_with_budget_config(self, service, mock_repository):
        """Sessions with budget config should compute revenue and pct fields."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions

        budget = dict(
            [
                create_mock_budget_config(1001, participant_goal=100, session_fee=2500.0),
                create_mock_budget_config(1002, participant_goal=80, session_fee=3000.0),
            ]
        )
        mock_repository.fetch_budget_config.return_value = budget

        enrolled = [
            *[create_mock_attendee(i, 1001) for i in range(50)],
            *[create_mock_attendee(i + 100, 1002) for i in range(40)],
        ]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 50
        assert s1.participant_goal == 100
        assert s1.session_fee == 2500.0
        assert s1.pct_of_goal == 50.0  # 50/100 * 100
        assert s1.budget_revenue == 250000.0  # 100 * 2500
        assert s1.actual_revenue == 125000.0  # 50 * 2500
        assert s1.revenue_pct == 50.0  # 125000 / 250000 * 100

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.pct_of_goal == 50.0  # 40/80 * 100
        assert s2.budget_revenue == 240000.0  # 80 * 3000
        assert s2.actual_revenue == 120000.0  # 40 * 3000

    @pytest.mark.asyncio
    async def test_forecast_partial_budget(self, service, mock_repository):
        """Session with goal but no fee: pct_of_goal computed, revenue fields None."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        budget = dict([create_mock_budget_config(1001, participant_goal=100)])
        mock_repository.fetch_budget_config.return_value = budget

        enrolled = [create_mock_attendee(i, 1001) for i in range(60)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.pct_of_goal == 60.0  # 60/100 * 100
        assert s1.session_fee is None
        assert s1.budget_revenue is None
        assert s1.actual_revenue is None
        assert s1.revenue_pct is None

    @pytest.mark.asyncio
    async def test_forecast_missing_budget_shows_none(self, service, mock_repository):
        """Sessions without budget config should have None for all budget fields."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions

        # Only session 1001 has budget config
        budget = dict([create_mock_budget_config(1001, participant_goal=100, session_fee=2000.0)])
        mock_repository.fetch_budget_config.return_value = budget

        async def fetch_attendees_side_effect(year, status_filter=None):
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.participant_goal is None
        assert s2.session_fee is None
        assert s2.pct_of_goal is None
        assert s2.budget_revenue is None
        assert s2.actual_revenue is None
        assert s2.revenue_pct is None


# ============================================================================
# AG Session Merging Tests
# ============================================================================


class TestForecastAGMerging:
    """Test that AG session attendees merge into parent main session."""

    @pytest.mark.asyncio
    async def test_forecast_ag_merged_into_parent(self, service, mock_repository):
        """AG session attendees counted under the parent main session.

        AG should not appear as a separate row in sessions.
        """
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "AG Session 1", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [
            create_mock_attendee(101, 1001),
            create_mock_attendee(102, 1001),
            create_mock_attendee(201, 2001),  # AG attendee
            create_mock_attendee(202, 2001),  # AG attendee
        ]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        # AG should NOT appear as separate session
        session_types = {s.session_type for s in result.sessions}
        assert "ag" not in session_types

        # All 4 attendees (2 main + 2 AG) counted under Session 1
        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 4

        assert result.grand_total.enrolled == 4


# ============================================================================
# Capacity Tests
# ============================================================================


class TestForecastCapacity:
    """Test capacity calculation from bunk plans."""

    @pytest.mark.asyncio
    async def test_forecast_capacity_from_bunk_plans(self, service, mock_repository):
        """Capacity = count(bunk_plans for session) * defaultCapacity.

        utilization_pct = enrolled / capacity * 100.
        """
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_capacity_config.return_value = 12

        bunk_plans = [
            create_mock_bunk_plan("pb_1001", "B-1"),
            create_mock_bunk_plan("pb_1001", "B-2"),
            create_mock_bunk_plan("pb_1001", "G-1"),
            create_mock_bunk_plan("pb_1001", "G-2"),
            create_mock_bunk_plan("pb_1001", "G-3"),
        ]
        mock_repository.fetch_bunk_plans.return_value = bunk_plans

        enrolled = [create_mock_attendee(i, 1001) for i in range(30)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.capacity == 60  # 5 bunks * 12
        assert s1.utilization_pct == 50.0  # 30/60 * 100


# ============================================================================
# Prior Year Comparison Tests
# ============================================================================


class TestForecastPriorYear:
    """Test prior year and 2-year-prior enrollment comparison."""

    @pytest.mark.asyncio
    async def test_forecast_prior_year_comparison(self, service, mock_repository):
        """Prior year counts matched by session NAME across years, not cm_id."""
        current_sessions = {
            1001: create_mock_session(1001, "Session 1", year=2026),
            1002: create_mock_session(1002, "Session 2", year=2026),
        }

        prior_sessions = {
            9001: create_mock_session(9001, "Session 1", year=2025),
            9002: create_mock_session(9002, "Session 2", year=2025),
        }

        two_year_sessions = {
            8001: create_mock_session(8001, "Session 1", year=2024),
            8002: create_mock_session(8002, "Session 2", year=2024),
        }

        current_enrolled = [
            create_mock_attendee(101, 1001, year=2026),
            create_mock_attendee(102, 1002, year=2026),
        ]

        prior_enrolled = [
            *[create_mock_attendee(i, 9001, year=2025) for i in range(10, 30)],
            *[create_mock_attendee(i, 9002, year=2025) for i in range(30, 45)],
        ]

        two_year_enrolled = [
            *[create_mock_attendee(i, 8001, year=2024) for i in range(50, 68)],
            *[create_mock_attendee(i, 8002, year=2024) for i in range(68, 80)],
        ]

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return current_sessions
            if year == 2025:
                return prior_sessions
            if year == 2024:
                return two_year_sessions
            return {}

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return current_enrolled
            if year == 2025:
                return prior_enrolled
            if year == 2024:
                return two_year_enrolled
            return []

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.prior_year_count == 20  # 10..30 = 20 attendees
        assert s1.two_year_prior_count == 18  # 50..68 = 18 attendees

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.prior_year_count == 15  # 30..45 = 15 attendees
        assert s2.two_year_prior_count == 12  # 68..80 = 12 attendees


# ============================================================================
# Waitlist Tests
# ============================================================================


class TestForecastWaitlist:
    """Test waitlist counting."""

    @pytest.mark.asyncio
    async def test_forecast_waitlist_count(self, service, mock_repository):
        """Should separately count waitlisted attendees."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [create_mock_attendee(i, 1001) for i in range(10)]
        waitlisted = [create_mock_attendee(100 + i, 1001, status="waitlisted") for i in range(3)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                if year == 2026:
                    return waitlisted
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 10
        assert s1.waitlisted == 3


# ============================================================================
# Grand Total Tests
# ============================================================================


class TestForecastGrandTotal:
    """Test grand total aggregation across sessions."""

    @pytest.mark.asyncio
    async def test_forecast_grand_total(self, service, mock_repository):
        """Grand total sums enrolled, waitlisted, capacity. Fee fields are None."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_capacity_config.return_value = 10

        bunk_plans = [
            create_mock_bunk_plan("pb_1001", "B-1"),
            create_mock_bunk_plan("pb_1001", "B-2"),
            create_mock_bunk_plan("pb_1002", "G-1"),
            create_mock_bunk_plan("pb_1002", "G-2"),
            create_mock_bunk_plan("pb_1002", "G-3"),
        ]
        mock_repository.fetch_bunk_plans.return_value = bunk_plans

        enrolled = [
            *[create_mock_attendee(i, 1001) for i in range(20)],
            *[create_mock_attendee(i + 100, 1002) for i in range(15)],
        ]
        waitlisted = [
            create_mock_attendee(200, 1001, status="waitlisted"),
            *[create_mock_attendee(300 + i, 1002, status="waitlisted") for i in range(2)],
        ]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                if year == 2026:
                    return waitlisted
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        gt = result.grand_total
        assert gt.enrolled == 35  # 20 + 15
        assert gt.waitlisted == 3  # 1 + 2
        assert gt.capacity == 50  # (2 + 3) bunks * 10

        # Fee-related fields should be None in grand total
        assert gt.session_fee is None
        assert gt.budget_revenue is None
        assert gt.actual_revenue is None
        assert gt.revenue_pct is None


# ============================================================================
# Session Filter Tests
# ============================================================================


class TestForecastSessionFilter:
    """Test filtering forecast to a specific session."""

    @pytest.mark.asyncio
    async def test_forecast_session_filter(self, service, mock_repository):
        """When session_cm_id provided, return only that session plus AG children."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            1002: create_mock_session(1002, "Session 2", session_type="main"),
            2001: create_mock_session(2001, "AG Session 1", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [
            *[create_mock_attendee(i, 1001) for i in range(10)],
            *[create_mock_attendee(i + 100, 1002) for i in range(5)],
            *[create_mock_attendee(i + 200, 2001) for i in range(3)],
        ]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026, session_cm_id=1001)

        # Only session 1001 should be returned (AG merged in)
        assert len(result.sessions) == 1
        s1 = result.sessions[0]
        assert s1.session_cm_id == 1001
        assert s1.enrolled == 13  # 10 main + 3 AG

        # Grand total matches the single session
        assert result.grand_total.enrolled == 13

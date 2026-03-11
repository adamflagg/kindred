"""
TDD tests for the forecast service.

Tests verify per-session enrollment vs budget goals, prior year comparison,
and revenue projections.

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


def create_mock_budget_config(
    session_cm_id: int,
    participant_goal: int | None = None,
    session_fee: float | None = None,
) -> tuple[int, dict[str, int | float]]:
    """Return (session_cm_id, config_dict) for budget config."""
    config: dict[str, int | float] = {}
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
    repo.fetch_budget_config = AsyncMock(return_value={})
    repo.fetch_registration_dates = AsyncMock(return_value={})
    repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
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
        assert s1.participants_vs_budget == -50  # 50 - 100
        assert s1.revenue_delta == -125000.0  # 125000 - 250000

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.pct_of_goal == 50.0  # 40/80 * 100
        assert s2.budget_revenue == 240000.0  # 80 * 3000
        assert s2.actual_revenue == 120000.0  # 40 * 3000
        assert s2.participants_vs_budget == -40  # 40 - 80
        assert s2.revenue_delta == -120000.0  # 120000 - 240000

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


class TestForecastAGSeparateRows:
    """Test that AG sessions appear as separate rows with own counts."""

    @pytest.mark.asyncio
    async def test_forecast_ag_as_separate_row(self, service, mock_repository):
        """AG session appears as its own row, not merged into parent.

        Each session counts only its own attendees.
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

        # AG SHOULD appear as separate session
        session_types = {s.session_type for s in result.sessions}
        assert "ag" in session_types

        # Main session counts only its own 2 attendees
        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 2

        # AG session counts its own 2 attendees
        ag = next(s for s in result.sessions if s.session_cm_id == 2001)
        assert ag.enrolled == 2

        # Grand total is still 4
        assert result.grand_total.enrolled == 4


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
        assert s1.participants_vs_prior_year == -19  # 1 - 20

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.prior_year_count == 15  # 30..45 = 15 attendees
        assert s2.two_year_prior_count == 12  # 68..80 = 12 attendees
        assert s2.participants_vs_prior_year == -14  # 1 - 15


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
        """Grand total sums enrolled and waitlisted. Fee fields are None."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions

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

        # Fee-related fields should be None in grand total
        assert gt.session_fee is None
        assert gt.budget_revenue is None
        assert gt.actual_revenue is None
        assert gt.revenue_pct is None

        # Delta fields also None when no budget config
        assert gt.participants_vs_budget is None
        assert gt.revenue_delta is None


# ============================================================================
# Session Filter Tests
# ============================================================================


class TestForecastSessionFilter:
    """Test filtering forecast to a specific session."""

    @pytest.mark.asyncio
    async def test_forecast_session_filter(self, service, mock_repository):
        """When session_cm_id provided, return that session plus AG children as separate rows."""
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

        # Session 1001 and its AG child both returned as separate rows
        assert len(result.sessions) == 2

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 10  # Only main attendees

        ag = next(s for s in result.sessions if s.session_cm_id == 2001)
        assert ag.enrolled == 3  # Only AG attendees

        # Grand total includes both
        assert result.grand_total.enrolled == 13


# ============================================================================
# Session Alias Matching Tests
# ============================================================================


class TestForecastSessionAliasMatching:
    """Test that prior year matching uses session alias resolution."""

    @pytest.mark.asyncio
    async def test_alias_resolves_renamed_session(self, service, mock_repository):
        """Prior year has 'Taste of Camp' (old name), current year has 'Taste of Camp 1'.

        Alias resolution should bridge these so prior_year_count is populated.
        """
        current_sessions = {
            1001: create_mock_session(1001, "Taste of Camp 1", year=2026),
            1002: create_mock_session(1002, "Session 2", year=2026),
        }

        prior_sessions = {
            9001: create_mock_session(9001, "Taste of Camp", year=2025),
            9002: create_mock_session(9002, "Session 2", year=2025),
        }

        current_enrolled = [
            create_mock_attendee(101, 1001, year=2026),
            create_mock_attendee(102, 1002, year=2026),
        ]

        prior_enrolled = [
            *[create_mock_attendee(i, 9001, year=2025) for i in range(10, 25)],
            *[create_mock_attendee(i, 9002, year=2025) for i in range(30, 40)],
        ]

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return current_sessions
            if year == 2025:
                return prior_sessions
            return {}

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return current_enrolled
            if year == 2025:
                return prior_enrolled
            return []

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        # "Taste of Camp" → "Taste of Camp 1" via alias
        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.prior_year_count == 15  # 10..25 = 15 attendees

        # "Session 2" unchanged, should still match
        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.prior_year_count == 10  # 30..40 = 10 attendees

    @pytest.mark.asyncio
    async def test_alias_resolves_session_2b(self, service, mock_repository):
        """Prior year 'Session 2b' should match current year 'Taste of Camp 2'."""
        current_sessions = {
            1001: create_mock_session(1001, "Taste of Camp 2", year=2026),
        }

        prior_sessions = {
            9001: create_mock_session(9001, "Session 2b", year=2025),
        }

        current_enrolled = [create_mock_attendee(101, 1001, year=2026)]
        prior_enrolled = [
            *[create_mock_attendee(i, 9001, year=2025) for i in range(10, 18)],
        ]

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return current_sessions
            if year == 2025:
                return prior_sessions
            return {}

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return current_enrolled
            if year == 2025:
                return prior_enrolled
            return []

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.prior_year_count == 8  # 10..18 = 8 attendees


# ============================================================================
# Delta Field Tests
# ============================================================================


class TestForecastDeltaFields:
    """Test the 3 new delta fields: participants_vs_budget, participants_vs_prior_year, revenue_delta."""

    @pytest.mark.asyncio
    async def test_delta_fields_with_budget(self, service, mock_repository):
        """participants_vs_budget = enrolled - goal, revenue_delta = actual - budget."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_sessions.return_value = sessions

        budget = dict([create_mock_budget_config(1001, participant_goal=100, session_fee=2500.0)])
        mock_repository.fetch_budget_config.return_value = budget

        enrolled = [create_mock_attendee(i, 1001) for i in range(50)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.participants_vs_budget == -50  # 50 - 100
        assert s1.revenue_delta == -125000.0  # (50*2500) - (100*2500)

    @pytest.mark.asyncio
    async def test_delta_fields_with_prior_year(self, service, mock_repository):
        """participants_vs_prior_year = enrolled - prior_year_count."""
        current_sessions = {
            1001: create_mock_session(1001, "Session 1", year=2026),
        }
        prior_sessions = {
            9001: create_mock_session(9001, "Session 1", year=2025),
        }

        current_enrolled = [create_mock_attendee(i, 1001, year=2026) for i in range(30)]
        prior_enrolled = [create_mock_attendee(i, 9001, year=2025) for i in range(10, 35)]

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return current_sessions
            if year == 2025:
                return prior_sessions
            return {}

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return current_enrolled
            if year == 2025:
                return prior_enrolled
            return []

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.participants_vs_prior_year == 5  # 30 - 25

    @pytest.mark.asyncio
    async def test_delta_fields_none_without_config(self, service, mock_repository):
        """Delta fields are None when inputs are missing."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [create_mock_attendee(i, 1001) for i in range(10)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.participants_vs_budget is None  # no goal configured
        assert s1.participants_vs_prior_year is None  # no prior year data
        assert s1.revenue_delta is None  # no fee configured

    @pytest.mark.asyncio
    async def test_grand_total_delta_fields(self, service, mock_repository):
        """Grand total should compute delta fields from totals."""
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

        prior_sessions = {
            9001: create_mock_session(9001, "Session 1", year=2025),
            9002: create_mock_session(9002, "Session 2", year=2025),
        }

        enrolled = [
            *[create_mock_attendee(i, 1001) for i in range(50)],
            *[create_mock_attendee(i + 100, 1002) for i in range(40)],
        ]
        prior_enrolled = [
            *[create_mock_attendee(i, 9001, year=2025) for i in range(10, 55)],
            *[create_mock_attendee(i, 9002, year=2025) for i in range(60, 95)],
        ]

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return sessions
            if year == 2025:
                return prior_sessions
            return {}

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            if year == 2025:
                return prior_enrolled
            return []

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        gt = result.grand_total
        # Total enrolled: 50 + 40 = 90, total goal: 100 + 80 = 180
        assert gt.participants_vs_budget == -90  # 90 - 180
        # Total prior: 45 + 35 = 80
        assert gt.participants_vs_prior_year == 10  # 90 - 80
        # Total budget rev: 100*2500 + 80*3000 = 490000
        # Total actual rev: 50*2500 + 40*3000 = 245000
        assert gt.revenue_delta == -245000.0  # 245000 - 490000


# ============================================================================
# Prior Year Failure Graceful Degradation Tests
# ============================================================================


class TestForecastPriorYearFailure:
    """Test that prior year fetch failures degrade gracefully."""

    @pytest.mark.asyncio
    async def test_prior_year_fetch_failure_returns_valid_forecast(self, service, mock_repository):
        """When prior year data fetch fails, forecast should still return with null prior fields.

        This handles intermittent PocketBase 400 errors from concurrent SQLite access.
        Prior year data is "nice to have" — failures should not crash the endpoint.
        """
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }

        enrolled = [
            *[create_mock_attendee(i, 1001) for i in range(50)],
            *[create_mock_attendee(i + 100, 1002) for i in range(40)],
        ]

        budget = dict(
            [
                create_mock_budget_config(1001, participant_goal=100, session_fee=2500.0),
                create_mock_budget_config(1002, participant_goal=80, session_fee=3000.0),
            ]
        )

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return sessions
            # Prior year fetches fail
            raise Exception("PocketBase 400: expand relation session not found")

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            # Prior year fetches fail
            raise Exception("PocketBase 400: expand relation session not found")

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect
        mock_repository.fetch_budget_config.return_value = budget

        result = await service.calculate_forecast(year=2026)

        # Forecast should succeed with current year data
        assert result.year == 2026
        assert len(result.sessions) == 2

        # Current year enrollment should be correct
        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 50
        assert s1.participant_goal == 100
        assert s1.pct_of_goal == 50.0

        s2 = next(s for s in result.sessions if s.session_cm_id == 1002)
        assert s2.enrolled == 40

        # Prior year fields should be None (not available)
        assert s1.prior_year_count is None
        assert s1.two_year_prior_count is None
        assert s1.participants_vs_prior_year is None

        assert s2.prior_year_count is None
        assert s2.two_year_prior_count is None
        assert s2.participants_vs_prior_year is None

        # Grand total prior fields should also be None
        assert result.grand_total.prior_year_count is None
        assert result.grand_total.two_year_prior_count is None
        assert result.grand_total.participants_vs_prior_year is None


# ============================================================================
# Reconstruction Lookback Tests
# ============================================================================


class TestForecastReconstructionLookback:
    """Test historical forecast viewing via day_offset using reconstruction."""

    @pytest.mark.asyncio
    async def test_day_offset_uses_reconstruction(self, service, mock_repository):
        """When day_offset is provided, enrolled/waitlisted come from reconstruction."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_budget_config.return_value = dict(
            [create_mock_budget_config(1001, participant_goal=100, session_fee=1000)]
        )

        from types import SimpleNamespace

        # Provide attendees that reconstruct to 50 enrolled at offset 123
        current_attendees = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date=f"2025-10-{16 + (i % 10):02d}",
                effective_date=f"2025-10-{16 + (i % 10):02d}",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                },
            )
            for i in range(50)
        ]

        mock_repository.fetch_attendees_with_dates.return_value = current_attendees

        result = await service.calculate_forecast(year=2026, day_offset=123)

        session = result.sessions[0]
        assert session.enrolled == 50

    @pytest.mark.asyncio
    async def test_day_offset_none_uses_live_data(self, service, mock_repository):
        """When day_offset is None (default), behavior is unchanged — live attendee data."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [create_mock_attendee(101, 1001)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            return enrolled

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        assert result.sessions[0].enrolled == 1

    @pytest.mark.asyncio
    async def test_day_offset_preserves_budget_config(self, service, mock_repository):
        """Budget goals should use current config even in day_offset mode."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_budget_config.return_value = dict(
            [create_mock_budget_config(1001, participant_goal=100, session_fee=1000)]
        )

        from types import SimpleNamespace

        current_attendees = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date="2025-10-20",
                effective_date="2025-10-20",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                },
            )
            for i in range(50)
        ]

        mock_repository.fetch_attendees_with_dates.return_value = current_attendees

        result = await service.calculate_forecast(year=2026, day_offset=123)

        session = result.sessions[0]
        assert session.participant_goal == 100
        assert session.session_fee == 1000

    @pytest.mark.asyncio
    async def test_response_has_week_and_day_offset(self, service, mock_repository):
        """Response should include week_number and day_offset when day_offset is set."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_budget_config.return_value = {}
        mock_repository.fetch_attendees_with_dates.return_value = []

        result = await service.calculate_forecast(year=2026, day_offset=123)
        assert result.week_number == 17  # 123 // 7 = 17
        assert result.day_offset == 123

    @pytest.mark.asyncio
    async def test_no_week_or_day_offset_in_response_for_live(self, service, mock_repository):
        """Response should have week_number=None and day_offset=None for live data."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees.return_value = []

        result = await service.calculate_forecast(year=2026)
        assert result.week_number is None
        assert result.day_offset is None

    @pytest.mark.asyncio
    async def test_week_zero_includes_first_day(self, service, mock_repository):
        """Week 0 (day_offset=0) should include registration data from the anchor date."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_budget_config.return_value = {}

        from types import SimpleNamespace

        # 3 attendees registered on the anchor date itself (Oct 15)
        attendees = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date="2025-10-15",
                effective_date="2025-10-15",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                },
            )
            for i in range(3)
        ]
        mock_repository.fetch_attendees_with_dates.return_value = attendees

        result = await service.calculate_forecast(year=2026, day_offset=0)

        s1 = result.sessions[0]
        # day_offset=0 with inclusive cutoff should count these 3 attendees
        assert s1.enrolled == 3
        assert result.week_number == 0


# ============================================================================
# Day Offset with Reconstruction Tests
# ============================================================================


class TestForecastWithDayOffset:
    """Test forecast with day_offset using reconstruction for prior years."""

    @pytest.mark.asyncio
    async def test_day_offset_uses_reconstruction_for_prior_year(self, mock_repository, service):
        """Prior year counts should come from reconstruction at same offset."""
        current_sessions = {
            1001: create_mock_session(1001, "Session 1", year=2026),
        }
        prior_sessions = {
            9001: create_mock_session(9001, "Session 1", year=2025),
        }

        async def fetch_sessions_side_effect(year, session_types=None):
            if year == 2026:
                return current_sessions
            if year == 2025:
                return prior_sessions
            return {}

        mock_repository.fetch_sessions.side_effect = fetch_sessions_side_effect

        async def fetch_reg_dates_side_effect(year):
            if year == 2026:
                return {"priority_reg_date": "2025-10-15"}
            if year == 2025:
                return {"priority_reg_date": "2024-10-10"}
            return {}

        mock_repository.fetch_registration_dates.side_effect = fetch_reg_dates_side_effect
        mock_repository.fetch_budget_config.return_value = {}

        from types import SimpleNamespace

        # Current year: 75 attendees enrolled within offset 123 of 2025-10-15
        current_attendees = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date=f"2025-10-{16 + (i % 10):02d}",
                effective_date=f"2025-10-{16 + (i % 10):02d}",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                },
            )
            for i in range(75)
        ]

        # Prior year: 20 attendees enrolled within offset 123 of 2024-10-10
        prior_attendees = [
            SimpleNamespace(
                person_id=i,
                year=2025,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date=f"2024-10-{15 + (i % 10):02d}",
                effective_date=f"2024-10-{15 + (i % 10):02d}",
                expand={
                    "session": SimpleNamespace(
                        cm_id=9001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2025-06-15",
                        end_date="2025-07-15",
                    )
                },
            )
            for i in range(20)
        ]

        async def fetch_attendees_with_dates_side_effect(year, expand_person=False):
            if year == 2026:
                return current_attendees
            if year == 2025:
                return prior_attendees
            return []

        mock_repository.fetch_attendees_with_dates.side_effect = fetch_attendees_with_dates_side_effect

        result = await service.calculate_forecast(year=2026, day_offset=123)

        s1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert s1.enrolled == 75
        assert s1.prior_year_count == 20
        assert s1.participants_vs_prior_year == 55  # 75 - 20

    @pytest.mark.asyncio
    async def test_day_offset_none_uses_live_mode(self, mock_repository, service):
        """day_offset=None should use live attendee data (existing behavior)."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        enrolled = [create_mock_attendee(i, 1001) for i in range(5)]

        async def fetch_attendees_side_effect(year, status_filter=None):
            if status_filter == "waitlisted":
                return []
            if year == 2026:
                return enrolled
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await service.calculate_forecast(year=2026)

        assert result.sessions[0].enrolled == 5
        mock_repository.fetch_registration_dates.assert_not_called()
        mock_repository.fetch_attendees_with_dates.assert_not_called()
        assert result.week_number is None
        assert result.day_offset is None

    @pytest.mark.asyncio
    async def test_response_has_week_number_and_day_offset(self, mock_repository, service):
        """Response should include week_number and day_offset when day_offset is set."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_budget_config.return_value = {}
        mock_repository.fetch_attendees_with_dates.return_value = []

        result = await service.calculate_forecast(year=2026, day_offset=49)

        assert result.week_number == 7  # 49 // 7 = 7
        assert result.day_offset == 49


# ============================================================================
# Gender Fields Tests
# ============================================================================


class TestForecastGenderFields:
    """Test gender field population from reconstruction and live data."""

    @pytest.mark.asyncio
    async def test_gender_from_reconstruction(self, service, mock_repository):
        """Reconstruction mode should populate enrolled_boys and enrolled_girls."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-10-15"}
        mock_repository.fetch_budget_config.return_value = {}

        from types import SimpleNamespace

        # 42 boys + 38 girls = 80 enrolled
        boys = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date="2025-10-20",
                effective_date="2025-10-20",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                },
            )
            for i in range(42)
        ]
        girls = [
            SimpleNamespace(
                person_id=i + 100,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date="2025-10-20",
                effective_date="2025-10-20",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                    "person": SimpleNamespace(gender="F", cm_id=i + 2000),
                },
            )
            for i in range(38)
        ]

        mock_repository.fetch_attendees_with_dates.return_value = boys + girls

        result = await service.calculate_forecast(year=2026, day_offset=7)
        s1 = result.sessions[0]
        assert s1.enrolled == 80
        assert s1.enrolled_boys == 42
        assert s1.enrolled_girls == 38

    @pytest.mark.asyncio
    async def test_gender_null_when_no_person_expand(self, service, mock_repository):
        """Reconstruction without person expand should return null gender fields."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-10-15"}
        mock_repository.fetch_budget_config.return_value = {}

        from types import SimpleNamespace

        # Attendees without person expand
        attendees = [
            SimpleNamespace(
                person_id=i,
                year=2026,
                status="enrolled",
                status_id=2,
                is_active=1,
                enrollment_date="2025-10-20",
                effective_date="2025-10-20",
                expand={
                    "session": SimpleNamespace(
                        cm_id=1001,
                        name="Session 1",
                        session_type="main",
                        parent_id=None,
                        start_date="2026-06-15",
                        end_date="2026-07-15",
                    ),
                },
            )
            for i in range(10)
        ]

        mock_repository.fetch_attendees_with_dates.return_value = attendees

        result = await service.calculate_forecast(year=2026, day_offset=7)
        s1 = result.sessions[0]
        assert s1.enrolled == 10
        assert s1.enrolled_boys is None
        assert s1.enrolled_girls is None

    @pytest.mark.asyncio
    async def test_gender_grand_total(self, service, mock_repository):
        """Grand total should sum gender counts with null-aware logic."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-10-15"}
        mock_repository.fetch_budget_config.return_value = {}

        from types import SimpleNamespace

        # Session 1001: 42 boys + 38 girls = 80
        # Session 1002: 30 boys + 30 girls = 60
        attendees = []
        for i in range(42):
            attendees.append(
                SimpleNamespace(
                    person_id=i,
                    year=2026,
                    status="enrolled",
                    status_id=2,
                    is_active=1,
                    enrollment_date="2025-10-20",
                    effective_date="2025-10-20",
                    expand={
                        "session": SimpleNamespace(
                            cm_id=1001,
                            name="Session 1",
                            session_type="main",
                            parent_id=None,
                            start_date="2026-06-15",
                            end_date="2026-07-15",
                        ),
                        "person": SimpleNamespace(gender="M", cm_id=i + 1000),
                    },
                )
            )
        for i in range(38):
            attendees.append(
                SimpleNamespace(
                    person_id=i + 100,
                    year=2026,
                    status="enrolled",
                    status_id=2,
                    is_active=1,
                    enrollment_date="2025-10-20",
                    effective_date="2025-10-20",
                    expand={
                        "session": SimpleNamespace(
                            cm_id=1001,
                            name="Session 1",
                            session_type="main",
                            parent_id=None,
                            start_date="2026-06-15",
                            end_date="2026-07-15",
                        ),
                        "person": SimpleNamespace(gender="F", cm_id=i + 2000),
                    },
                )
            )
        for i in range(30):
            attendees.append(
                SimpleNamespace(
                    person_id=i + 200,
                    year=2026,
                    status="enrolled",
                    status_id=2,
                    is_active=1,
                    enrollment_date="2025-10-20",
                    effective_date="2025-10-20",
                    expand={
                        "session": SimpleNamespace(
                            cm_id=1002,
                            name="Session 2",
                            session_type="main",
                            parent_id=None,
                            start_date="2026-06-15",
                            end_date="2026-07-15",
                        ),
                        "person": SimpleNamespace(gender="M", cm_id=i + 3000),
                    },
                )
            )
        for i in range(30):
            attendees.append(
                SimpleNamespace(
                    person_id=i + 300,
                    year=2026,
                    status="enrolled",
                    status_id=2,
                    is_active=1,
                    enrollment_date="2025-10-20",
                    effective_date="2025-10-20",
                    expand={
                        "session": SimpleNamespace(
                            cm_id=1002,
                            name="Session 2",
                            session_type="main",
                            parent_id=None,
                            start_date="2026-06-15",
                            end_date="2026-07-15",
                        ),
                        "person": SimpleNamespace(gender="F", cm_id=i + 4000),
                    },
                )
            )

        mock_repository.fetch_attendees_with_dates.return_value = attendees

        result = await service.calculate_forecast(year=2026, day_offset=7)
        assert result.grand_total.enrolled_boys == 72
        assert result.grand_total.enrolled_girls == 68

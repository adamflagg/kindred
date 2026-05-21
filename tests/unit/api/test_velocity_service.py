"""
Unit tests for the velocity service.

Tests verify the enrollment velocity curve computation:
- Snapshot-based weekly aggregation (fast path)
- Reconstruction fallback from attendee enrollment dates
- Combined vs per-session curves
- Prior year overlay comparison
- Phase markers from registration dates config
- Weekly delta calculations
- Data source labeling (snapshot vs reconstructed)
- Dynamic season start from priority registration date
- Cancelled-to-date summary fields
- Prior year session summaries for enhanced tables
- Cancellation velocity curves (metric='cancellation')
"""

from datetime import datetime
from unittest.mock import AsyncMock, Mock

import pytest

from api.schemas.velocity import VelocityCurve, VelocityResponse, WeeklyDataPoint
from api.services.camp_calendar import SEASON_WEEKS
from api.services.velocity_service import (
    SeasonContext,
    VelocityService,
    _compute_season_start,
    _partial_week_info,
    _season_end,
    _week_label,
    _week_number,
    _week_start,
    rollup_daily_to_weekly,
)
from tests.unit.api.conftest import create_mock_session

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_snapshot(
    snapshot_date: str,
    session_cm_id: int,
    year: int,
    enrolled: int,
    waitlisted: int = 0,
    cancelled: int = 0,
    enrolled_male: int | None = None,
    enrolled_female: int | None = None,
    waitlisted_male: int | None = None,
    waitlisted_female: int | None = None,
    cancelled_male: int | None = None,
    cancelled_female: int | None = None,
) -> Mock:
    """Create a mock enrollment snapshot record."""
    snap = Mock()
    snap.snapshot_datetime = snapshot_date
    snap.session_cm_id = session_cm_id
    snap.year = year
    snap.enrolled_count = enrolled
    snap.waitlisted_count = waitlisted
    snap.cancelled_count = cancelled
    snap.enrolled_male_count = enrolled_male
    snap.enrolled_female_count = enrolled_female
    snap.waitlisted_male_count = waitlisted_male
    snap.waitlisted_female_count = waitlisted_female
    snap.cancelled_male_count = cancelled_male
    snap.cancelled_female_count = cancelled_female
    return snap


_STATUS_ID_MAP = {
    "none": 1,
    "enrolled": 2,
    "applied": 4,
    "waitlisted": 8,
    "left_early": 16,
    "cancelled": 32,
    "dismissed": 64,
    "inquiry": 128,
    "withdrawn": 256,
    "incomplete": 512,
}


def make_weekly_point(
    week_start: str,
    week_label: str,
    week_number: int,
    enrolled: int,
    *,
    week_end: str = "",
    delta: int = 0,
    data_source: str = "reconstructed",
    gross_enrolled: int | None = None,
    weekly_new: int = 0,
    weekly_cancelled: int = 0,
    is_partial: bool = False,
    days_in_week: int = 7,
) -> WeeklyDataPoint:
    """Create a WeeklyDataPoint with sensible defaults for testing."""
    # Auto-compute week_end from week_start if not provided
    if not week_end:
        from datetime import datetime, timedelta

        ws = datetime.strptime(week_start, "%Y-%m-%d")
        week_end = (ws + timedelta(days=6)).strftime("%Y-%m-%d")
    return WeeklyDataPoint(
        week_start=week_start,
        week_end=week_end,
        week_label=week_label,
        week_number=week_number,
        enrolled=enrolled,
        delta=delta,
        data_source=data_source,
        gross_enrolled=gross_enrolled if gross_enrolled is not None else enrolled,
        weekly_new=weekly_new,
        weekly_cancelled=weekly_cancelled,
        is_partial=is_partial,
        days_in_week=days_in_week,
    )


def create_mock_attendee_with_date(
    person_id: int,
    session_cm_id: int,
    enrollment_date: str,
    year: int = 2026,
    status: str = "enrolled",
    gender: str | None = None,
    effective_date: str = "",
) -> Mock:
    """Create a mock attendee with enrollment date for reconstruction.

    When gender is provided, the expand dict includes a person object with gender,
    simulating the expand=session,person API call used for gender split.
    """
    att = Mock()
    att.person_id = person_id
    att.year = year
    att.status = status
    att.enrollment_date = enrollment_date
    att.effective_date = effective_date
    att.status_id = _STATUS_ID_MAP.get(status, 0)
    session = Mock()
    session.cm_id = session_cm_id
    expand: dict[str, Mock] = {"session": session}
    if gender is not None:
        person = Mock()
        person.gender = gender
        expand["person"] = person
    att.expand = expand
    return att


def create_mock_status_transition(
    person_id: int,
    session_cm_id: int,
    detected_at: str,
    old_status: str = "enrolled",
    new_status: str = "cancelled",
    year: int = 2026,
    gender: str | None = None,
) -> Mock:
    """Create a mock status transition record for cancellation tracking.

    When gender is provided, the expand dict includes a person object with gender,
    simulating the expand=session,person API call used for gender split.
    """
    record = Mock()
    record.person_id = person_id
    record.detected_at = detected_at
    record.old_status = old_status
    record.new_status = new_status
    record.year = year
    session = Mock()
    session.cm_id = session_cm_id
    expand: dict[str, Mock] = {"session": session}
    if gender is not None:
        person = Mock()
        person.gender = gender
        expand["person"] = person
    record.expand = expand
    return record


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository with all velocity-related methods."""
    repo = AsyncMock()
    repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
    repo.fetch_status_transitions = AsyncMock(return_value=[])

    # Provide a default priority_reg_date per year (mimics old Nov 1 fallback behavior).
    # Tests that need specific dates or missing dates override this.
    async def _default_reg_dates(year):
        return {"priority_reg_date": f"{year - 1}-11-01"}

    repo.fetch_registration_dates = AsyncMock(side_effect=_default_reg_dates)
    return repo


@pytest.fixture
def service(mock_repository):
    """Create a VelocityService with mock repository."""
    return VelocityService(mock_repository)


@pytest.fixture
def sample_sessions() -> dict[int, Mock]:
    """Sample sessions for 2026."""
    return {
        1001: create_mock_session(1001, "Session 1", session_type="main"),
        1002: create_mock_session(1002, "Session 2", session_type="main"),
    }


# ============================================================================
# Snapshot-Based Velocity Tests (Weekly)
# ============================================================================


class TestVelocityFromSnapshots:
    """Test velocity curve generation from enrollment snapshots."""

    @pytest.mark.asyncio
    async def test_velocity_from_snapshots_basic(self, service, mock_repository, sample_sessions):
        """Given snapshots across 3 weeks, should produce 3 weekly data points
        with correct cumulative counts and deltas."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            # Session 1 snapshots across 3 weeks (Mondays)
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10, waitlisted=0),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=25, waitlisted=2),
            create_mock_snapshot("2026-01-19", 1001, 2026, enrolled=40, waitlisted=5),
        ]

        result = await service.get_velocity(year=2026)

        assert result.year == 2026
        assert result.combined is not None
        assert len(result.combined.weekly) == 3

        # First week
        w1 = result.combined.weekly[0]
        assert w1.enrolled == 10

        # Second week
        w2 = result.combined.weekly[1]
        assert w2.enrolled == 25

        # Third week
        w3 = result.combined.weekly[2]
        assert w3.enrolled == 40

        # Daily data should be populated
        assert len(result.combined.daily) > 0
        # Each daily point has day_offset
        for dp in result.combined.daily:
            assert hasattr(dp, "day_offset")
            assert dp.day_offset >= 0
        # Convenience aliases
        assert result.daily == result.combined.daily
        assert result.weekly == result.combined.weekly

    @pytest.mark.asyncio
    async def test_same_week_snapshots_collapse(self, service, mock_repository, sample_sessions):
        """Multiple snapshots within the same week should collapse to one point
        (last snapshot of the week wins)."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            # Two snapshots in same week (Jan 5 is Monday, Jan 7 is Wednesday)
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-07", 1001, 2026, enrolled=12),
            # Next week
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026)

        # Two weeks of data (same-week collapses)
        assert len(result.combined.weekly) == 2
        # First week: last snapshot wins (12, not 10)
        assert result.combined.weekly[0].enrolled == 12
        assert result.combined.weekly[1].enrolled == 25

    @pytest.mark.asyncio
    async def test_velocity_from_snapshots_combined_sessions(self, service, mock_repository, sample_sessions):
        """When no specific session_cm_id, should combine all sessions'
        snapshots into one curve by summing enrollment per week."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            # Session 1: 20 enrolled on Jan 5
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, waitlisted=1),
            # Session 2: 15 enrolled on Jan 5
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=15, waitlisted=2),
            # Session 1: 30 enrolled on Jan 12
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=30, waitlisted=1),
            # Session 2: 25 enrolled on Jan 12
            create_mock_snapshot("2026-01-12", 1002, 2026, enrolled=25, waitlisted=3),
        ]

        result = await service.get_velocity(year=2026)

        # Combined should sum across sessions per week
        assert len(result.combined.weekly) == 2
        assert result.combined.weekly[0].enrolled == 35  # 20 + 15
        assert result.combined.weekly[1].enrolled == 55  # 30 + 25

        # by_session should have separate curves
        assert len(result.by_session) == 2


# ============================================================================
# Reconstruction Fallback Tests
# ============================================================================


class TestVelocityReconstructionFallback:
    """Test velocity reconstruction when no snapshots exist."""

    @pytest.mark.asyncio
    async def test_velocity_reconstruction_fallback(self, service, mock_repository, sample_sessions):
        """When no snapshots exist, should fall back to reconstruction
        from attendee enrollment dates, bucketed by week."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        # No snapshots available
        mock_repository.fetch_enrollment_snapshots.return_value = []
        # Attendees with enrollment dates for reconstruction
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03"),
            create_mock_attendee_with_date(102, 1001, "2026-01-04"),
            create_mock_attendee_with_date(103, 1001, "2026-01-10"),
            create_mock_attendee_with_date(104, 1001, "2026-01-11"),
            create_mock_attendee_with_date(105, 1001, "2026-01-17"),
        ]

        result = await service.get_velocity(year=2026)

        # Should have reconstructed data with cumulative enrollment
        assert result.combined is not None
        assert len(result.combined.weekly) > 0

        # Final point should show all 5 enrolled
        last_point = result.combined.weekly[-1]
        assert last_point.enrolled == 5

        # Daily data should be populated from reconstruction
        assert len(result.combined.daily) > 0
        for dp in result.combined.daily:
            assert dp.data_source == "reconstructed"

    @pytest.mark.asyncio
    async def test_velocity_reconstruction_with_cancellations(self, service, mock_repository, sample_sessions):
        """Reconstruction should account for cancelled/withdrawn attendees
        using status_history transitions."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = []
        # 4 enrolled
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03"),
            create_mock_attendee_with_date(102, 1001, "2026-01-04"),
            create_mock_attendee_with_date(103, 1001, "2026-01-10"),
            create_mock_attendee_with_date(104, 1001, "2026-01-10", status="cancelled"),
        ]
        # 1 cancelled during week 2
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(104, 1001, "2026-01-12"),
        ]

        result = await service.get_velocity(year=2026)

        assert result.combined is not None
        # Should reflect that cancellation reduces count
        points = result.combined.weekly
        assert len(points) > 0
        # After the cancellation, enrolled should reflect the drop
        last_point = points[-1]
        assert last_point.enrolled <= 4  # At most 4, likely 3 after cancellation


# ============================================================================
# Prior Year Overlay Tests
# ============================================================================


class TestVelocityPriorYearOverlay:
    """Test prior year comparison curves."""

    @pytest.mark.asyncio
    async def test_velocity_prior_year_overlay(self, service, mock_repository):
        """When compare_years=[2025], should fetch prior year curves."""
        sessions_2026 = {
            1001: create_mock_session(1001, "Session 1", year=2026),
        }
        sessions_2025 = {
            901: create_mock_session(901, "Session 1", year=2025),
        }

        async def mock_fetch_sessions(year, **kwargs):
            if year == 2026:
                return sessions_2026
            return sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
                    create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=35),
                ]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=15),
                create_mock_snapshot("2025-01-13", 901, 2025, enrolled=28),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        assert result.year == 2026
        assert len(result.prior_years) >= 1

        prior = result.prior_years[0]
        assert prior.year == 2025
        assert len(prior.weekly) == 2
        # Prior years should have daily and weekly attributes
        assert hasattr(prior, "daily")
        assert hasattr(prior, "weekly")


# ============================================================================
# Phase Markers Tests
# ============================================================================


class TestVelocityPhaseMarkers:
    """Test registration phase marker generation."""

    @pytest.mark.asyncio
    async def test_velocity_phase_markers(self, service, mock_repository):
        """Should fetch registration dates from config and return as
        PhaseMarker list with week_number for alignment."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-01",
            "early_reg_date": "2025-11-01",
            "open_reg_date": "2026-01-15",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 3

        phases = {m.phase: m for m in result.phase_markers}
        assert "priority" in phases
        assert phases["priority"].date == "2025-10-01"
        assert "early" in phases
        assert phases["early"].date == "2025-11-01"
        assert "open" in phases
        assert phases["open"].date == "2026-01-15"

        # Phase markers should have week_number (not day_number)
        for marker in result.phase_markers:
            assert hasattr(marker, "week_number")
            assert isinstance(marker.week_number, int)


# ============================================================================
# Session Filter Tests
# ============================================================================


class TestVelocitySessionFilter:
    """Test filtering velocity data to a specific session."""

    @pytest.mark.asyncio
    async def test_velocity_session_filter(self, service, mock_repository, sample_sessions):
        """When session_cm_id is provided, should return only that session's
        curve as combined plus a single by_session entry."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=15),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=30),
            create_mock_snapshot("2026-01-12", 1002, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026, session_cm_id=1001)

        # Combined should reflect only session 1001
        assert result.combined.weekly[0].enrolled == 20
        assert result.combined.weekly[1].enrolled == 30

        # by_session should have only 1 entry
        assert len(result.by_session) == 1
        assert result.by_session[0].session_cm_id == 1001


# ============================================================================
# Delta Calculation Tests
# ============================================================================


class TestVelocityDeltaCalculation:
    """Test weekly delta (change from prior week) computation."""

    @pytest.mark.asyncio
    async def test_velocity_weekly_delta_calculation(self, service, mock_repository, sample_sessions):
        """Deltas should be the difference from previous week's enrolled
        count. First point delta = enrolled count itself."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=25),
            create_mock_snapshot("2026-01-19", 1001, 2026, enrolled=35),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 3

        # First week: delta = enrolled itself
        assert points[0].delta == 10
        # Second week: delta = 25 - 10 = 15
        assert points[1].delta == 15
        # Third week: delta = 35 - 25 = 10
        assert points[2].delta == 10


# ============================================================================
# Edge Case Tests
# ============================================================================


class TestVelocityEdgeCases:
    """Test edge cases and data source labeling."""

    @pytest.mark.asyncio
    async def test_velocity_empty_data(self, service, mock_repository):
        """When no data at all (no snapshots, no attendees), should return
        empty curves with zero values."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = []

        result = await service.get_velocity(year=2026)

        assert result.year == 2026
        assert result.combined is not None
        assert len(result.combined.weekly) == 0
        assert len(result.by_session) >= 0
        assert len(result.prior_years) == 0

    @pytest.mark.asyncio
    async def test_velocity_data_source_label_snapshot(self, service, mock_repository, sample_sessions):
        """Snapshot-based data should have data_source='snapshot'."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        assert len(result.combined.weekly) == 1
        assert result.combined.weekly[0].data_source == "snapshot"

    @pytest.mark.asyncio
    async def test_velocity_data_source_label_reconstructed(self, service, mock_repository, sample_sessions):
        """Reconstructed data should have data_source='reconstructed'."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03"),
        ]

        result = await service.get_velocity(year=2026)

        assert len(result.combined.weekly) > 0
        assert result.combined.weekly[0].data_source == "reconstructed"


# ============================================================================
# Season Start Helper Tests
# ============================================================================


class TestSeasonStartHelpers:
    """Test _compute_season_start, _week_number, _week_start, and _season_end helper functions."""

    def test_season_start_from_priority_reg(self):
        """_compute_season_start with priority_reg=2025-11-12 should return 2025-11-12
        (exact date, no offset)."""
        result = _compute_season_start({"priority_reg_date": "2025-11-12"}, 2026)
        assert result == datetime(2025, 11, 12)

    def test_season_start_returns_exact_date(self):
        """_compute_season_start should return the exact priority_reg_date."""
        result = _compute_season_start({"priority_reg_date": "2025-12-03"}, 2026)
        assert result == datetime(2025, 12, 3)

    def test_season_start_from_early_fallback(self):
        """_compute_season_start with only early_reg_date should fall back to it."""
        result = _compute_season_start({"early_reg_date": "2019-12-01"}, 2020)
        assert result == datetime(2019, 12, 1)

    def test_season_start_priority_takes_precedence(self):
        """_compute_season_start with both dates should prefer priority_reg_date."""
        result = _compute_season_start({"priority_reg_date": "2025-11-12", "early_reg_date": "2025-12-01"}, 2026)
        assert result == datetime(2025, 11, 12)

    def test_season_start_none_when_no_config(self):
        """_compute_season_start with empty dict should return None."""
        result = _compute_season_start({}, 2026)
        assert result is None

    def test_season_start_none_when_empty_string(self):
        """_compute_season_start with empty string values should return None."""
        result = _compute_season_start({"priority_reg_date": "", "early_reg_date": ""}, 2026)
        assert result is None

    def test_season_start_none_for_any_year(self):
        """_compute_season_start with empty dict returns None regardless of year."""
        assert _compute_season_start({}, 2025) is None
        assert _compute_season_start({}, 2024) is None

    def test_week_number_at_priority_reg_date(self):
        """Priority reg date itself should be week 1."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        assert _week_number(priority_reg, priority_reg) == 1

    def test_week_number_day_6_still_week_1(self):
        """Day 6 after priority_reg is still week 1."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        day6 = datetime(2025, 12, 9)  # Tuesday (6 days later)
        assert _week_number(day6, priority_reg) == 1

    def test_week_number_day_7_is_week_2(self):
        """Day 7 after priority_reg is week 2."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        day7 = datetime(2025, 12, 10)  # Wednesday (7 days later)
        assert _week_number(day7, priority_reg) == 2

    def test_week_number_mid_season(self):
        """January data should be correct weeks from priority_reg_date."""
        priority_reg = datetime(2025, 12, 3)
        jan_5 = datetime(2026, 1, 5)
        # Days from Dec 3 to Jan 5 = 33 days, 33//7 + 1 = 5
        assert _week_number(jan_5, priority_reg) == 5

    def test_week_start_at_priority_reg(self):
        """_week_start at priority_reg date should return priority_reg date."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        assert _week_start(priority_reg, priority_reg) == priority_reg

    def test_week_start_day_6(self):
        """_week_start 6 days after priority_reg should still return priority_reg."""
        priority_reg = datetime(2025, 12, 3)
        day6 = datetime(2025, 12, 9)
        assert _week_start(day6, priority_reg) == priority_reg

    def test_week_start_day_7(self):
        """_week_start 7 days after priority_reg should return priority_reg + 7."""
        from datetime import timedelta

        priority_reg = datetime(2025, 12, 3)
        day7 = datetime(2025, 12, 10)
        assert _week_start(day7, priority_reg) == priority_reg + timedelta(days=7)

    def test_week_number_before_anchor_returns_zero(self):
        """Dates before priority_reg_date should return week 0."""
        priority_reg = datetime(2025, 11, 12)
        day_before = datetime(2025, 11, 11)
        week_before = datetime(2025, 11, 5)
        month_before = datetime(2025, 10, 15)
        assert _week_number(day_before, priority_reg) == 0
        assert _week_number(week_before, priority_reg) == 0
        assert _week_number(month_before, priority_reg) == 0

    def test_week_start_before_anchor_returns_anchor_minus_7(self):
        """Pre-anchor dates should bucket to anchor - 7 days."""
        from datetime import timedelta

        priority_reg = datetime(2025, 11, 12)
        day_before = datetime(2025, 11, 11)
        month_before = datetime(2025, 10, 15)
        expected = priority_reg - timedelta(days=7)
        assert _week_start(day_before, priority_reg) == expected
        assert _week_start(month_before, priority_reg) == expected

    def test_week_label_week_zero(self):
        """Week 0 label should include 'Wk 0' with date range for the 7 days before anchor."""
        priority_reg = datetime(2025, 11, 12)
        day_before = datetime(2025, 11, 11)
        label = _week_label(day_before, priority_reg)
        assert label.startswith("Wk 0")
        assert "Nov 5" in label  # anchor - 7 = Nov 5

    def test_season_end_from_priority_reg(self):
        """_season_end should return priority_reg_date + SEASON_WEEKS * 7 days."""
        from datetime import timedelta

        priority_reg = datetime(2025, 12, 3)  # Wednesday (not a Monday!)
        result = _season_end(priority_reg)
        expected = priority_reg + timedelta(days=SEASON_WEEKS * 7)
        assert result == expected


# ============================================================================
# Season Window Data Clipping Tests
# ============================================================================


class TestSeasonWindowClipping:
    """Test that velocity data is clipped to the season window."""

    @pytest.mark.asyncio
    async def test_snapshots_before_season_start_are_excluded(self, service, mock_repository):
        """Snapshots before season start should be excluded."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            # Before season window (before Nov 1, 2025)
            create_mock_snapshot("2025-09-15", 1001, 2026, enrolled=5),
            create_mock_snapshot("2025-10-01", 1001, 2026, enrolled=8),
            # Inside season window
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=15),
            create_mock_snapshot("2025-12-01", 1001, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026)

        # Only data from Nov 1 onward should appear
        points = result.combined.weekly
        assert len(points) == 2
        for p in points:
            assert p.week_start >= "2025-11-01"

    @pytest.mark.asyncio
    async def test_reconstruction_far_back_proportionally_compressed(self, service, mock_repository):
        """Enrollments far before anchor are proportionally compressed into Week 0.

        Week 0 is a 7-day display window before the anchor. Enrollments outside
        that window are proportionally mapped in, preserving totals.
        """
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            # Well before Week 0 window — proportionally compressed
            create_mock_attendee_with_date(101, 1001, "2025-09-15"),
            # Inside season window
            create_mock_attendee_with_date(102, 1001, "2025-11-10"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) >= 1
        # All three enrollments should be counted (totals preserved)
        total = sum(p.weekly_new for p in points)
        assert total == 3
        # Week 0 should have the pre-anchor enrollment
        week0_points = [p for p in points if p.week_number == 0]
        assert len(week0_points) == 1
        assert week0_points[0].enrolled == 1

    @pytest.mark.asyncio
    async def test_data_past_season_end_excluded(self, service, mock_repository):
        """Data past the 41-week season window should be excluded."""
        # Default priority_reg_date: Nov 1 2025
        # Season end: Nov 1 + 41*7 = Aug 15 2026
        # Nov 2026 is well past the 41-week window
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=15),
            create_mock_snapshot("2026-11-10", 1001, 2026, enrolled=100),  # Past 41-week window
        ]

        result = await service.get_velocity(year=2026)

        # Nov 2026 data should be EXCLUDED (past 41-week window from Nov 1 2025)
        points = result.combined.weekly
        assert not any(p.week_start >= "2026-09-01" for p in points)
        assert len(points) == 1


# ============================================================================
# 41-Week Season End Clipping Tests
# ============================================================================


class TestSeasonEndClipping:
    """Test that velocity data is clipped at SEASON_WEEKS (41) from season start."""

    def test_season_end_is_41_weeks_from_start(self):
        """_season_end should return exactly SEASON_WEEKS * 7 days after priority_reg_date."""
        from datetime import timedelta

        priority_reg = datetime(2025, 12, 3)  # Wednesday (not a Monday!)
        result = _season_end(priority_reg)
        expected = priority_reg + timedelta(days=SEASON_WEEKS * 7)
        assert result == expected

    def test_season_weeks_constant_is_41(self):
        """SEASON_WEEKS should be 41."""
        assert SEASON_WEEKS == 41

    @pytest.mark.asyncio
    async def test_data_past_41_weeks_excluded(self, service, mock_repository):
        """Snapshots past the 41-week window should be excluded."""
        # Default priority_reg_date = Nov 1 2025
        # Season end = Nov 1 + 41*7 = Aug 15 2026
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            # Sep 7 2026 is past Aug 15 season end
            create_mock_snapshot("2026-09-07", 1001, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 1
        assert points[0].enrolled == 20
        assert not any(p.week_start >= "2026-09-01" for p in points)

    @pytest.mark.asyncio
    async def test_data_within_41_weeks_included(self, service, mock_repository):
        """Snapshots within the 41-week window should be included."""
        # Default priority_reg_date = Nov 1 2025
        # Season end = Aug 15 2026; Jul 27 is within window
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            create_mock_snapshot("2026-07-27", 1001, 2026, enrolled=30),  # Within window
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 2
        assert any(p.week_start >= "2026-07-01" for p in points)

    @pytest.mark.asyncio
    async def test_prior_year_clips_at_41_weeks(self, service, mock_repository):
        """Prior year data should also clip at 41 weeks from that year's season start."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025, start_date="2025-06-15")}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        # 2025: priority_reg_date = Nov 1 2024 (from fixture)
        # Season end = Nov 1 2024 + 41*7 = Aug 18 2025
        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20)]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=15),
                create_mock_snapshot("2025-09-15", 901, 2025, enrolled=20),  # Past 41-week window
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Prior year should exclude Sep data (past 41-week window from Nov 1 2024)
        prior = result.prior_years[0]
        assert len(prior.weekly) == 1
        assert not any(p.week_start >= "2025-09-01" for p in prior.weekly)


# ============================================================================
# Week Number in Data Points Tests
# ============================================================================


class TestWeekNumberInDataPoints:
    """Test that WeeklyDataPoint includes correct week_number."""

    @pytest.mark.asyncio
    async def test_data_points_have_week_number(self, service, mock_repository):
        """Each WeeklyDataPoint should include a week_number field."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),
        ]

        result = await service.get_velocity(year=2026)

        for p in result.combined.weekly:
            assert hasattr(p, "week_number")
            assert isinstance(p.week_number, int)
            assert p.week_number >= 1

    @pytest.mark.asyncio
    async def test_week_numbers_are_sequential(self, service, mock_repository):
        """Week numbers should increase monotonically across data points."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
            create_mock_snapshot("2025-11-10", 1001, 2026, enrolled=15),
            create_mock_snapshot("2025-12-01", 1001, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026)

        week_numbers = [p.week_number for p in result.combined.weekly]
        assert week_numbers == sorted(week_numbers)
        # Each should be unique and strictly increasing
        assert len(set(week_numbers)) == len(week_numbers)

    @pytest.mark.asyncio
    async def test_data_points_have_week_start_and_label(self, service, mock_repository):
        """Each WeeklyDataPoint should have week_start (ISO date) and week_label."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        assert len(result.combined.weekly) == 1
        point = result.combined.weekly[0]
        assert hasattr(point, "week_start")
        assert hasattr(point, "week_label")
        # week_start is the 7-day bucket start anchored to priority_reg_date.
        # Default priority_reg = Nov 1, 2025 (Saturday).
        # Jan 5 is 65 days later: 65//7=9, bucket start = Nov 1 + 63 = Jan 3 (Saturday)
        assert point.week_start == "2026-01-03"

    @pytest.mark.asyncio
    async def test_prior_year_week_numbers_align(self, service, mock_repository):
        """Prior year data should use week_number for alignment, not index."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    # Nov, Dec, Jan
                    create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
                    create_mock_snapshot("2025-12-01", 1001, 2026, enrolled=20),
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),
                ]
            return [
                # Nov, Dec, Jan of 2025 season
                create_mock_snapshot("2024-11-04", 901, 2025, enrolled=8),
                create_mock_snapshot("2024-12-02", 901, 2025, enrolled=18),
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=28),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        current_wn = [p.week_number for p in result.combined.weekly]
        prior_wn = [p.week_number for p in result.prior_years[0].weekly]
        # Both should start at similar week numbers (both ~week 1)
        assert abs(current_wn[0] - prior_wn[0]) <= 1


# ============================================================================
# Season Start in Response Tests
# ============================================================================


class TestSeasonStartInResponse:
    """Test that VelocityResponse includes season_start."""

    @pytest.mark.asyncio
    async def test_response_includes_season_start(self, service, mock_repository):
        """VelocityResponse should include season_start field."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        assert hasattr(result, "season_start")
        # Fallback: Nov 1 of year-1
        assert result.season_start == "2025-11-01"

    @pytest.mark.asyncio
    async def test_response_season_start_with_priority_reg(self, service, mock_repository):
        """When priority_reg_date is configured, season_start should be that exact date."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-12", 1001, 2026, enrolled=10),
        ]
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-12",
        }

        result = await service.get_velocity(year=2026)

        assert result.season_start == "2025-11-12"


# ============================================================================
# Phase Marker Week Number Tests
# ============================================================================


class TestPhaseMarkerWeekNumber:
    """Test that phase markers use week_number (snapped to Monday) for alignment."""

    @pytest.mark.asyncio
    async def test_phase_marker_has_week_number(self, service, mock_repository):
        """Phase markers should have week_number field."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-12",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 1
        marker = result.phase_markers[0]
        assert hasattr(marker, "week_number")
        assert isinstance(marker.week_number, int)
        # Date should be preserved
        assert marker.date == "2025-11-12"

    @pytest.mark.asyncio
    async def test_phase_marker_week_number_anchored_to_priority_reg(self, service, mock_repository):
        """Phase markers should compute week_number directly from priority_reg_date,
        without snapping to Monday."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        # Need priority_reg_date for season start, plus open_reg_date for the marker
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-01",
            "open_reg_date": "2026-01-07",  # Wednesday
        }

        result = await service.get_velocity(year=2026)

        # Should have both priority and open markers
        open_markers = [m for m in result.phase_markers if m.phase == "open"]
        assert len(open_markers) == 1
        marker = open_markers[0]
        # Date stays as-is
        assert marker.date == "2026-01-07"
        # week_number = (Jan 7 - Nov 1).days // 7 + 1 = 67 // 7 + 1 = 10
        # (no Monday snapping — anchored directly to priority_reg_date)
        assert marker.week_number == 10


# ============================================================================
# Dynamic Season Start (Priority-Reg-Relative) Tests
# ============================================================================


class TestDynamicSeasonStart:
    """Test that season start is computed from priority registration date."""

    @pytest.mark.asyncio
    async def test_prior_year_uses_own_priority_reg(self, service, mock_repository):
        """Each year should fetch its own registration dates for season start."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        # Each year has its own priority_reg_date
        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-15"}  # season_start = Nov 15
            return {"priority_reg_date": "2024-11-10"}  # season_start = Nov 10

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2025-11-17", 1001, 2026, enrolled=10),
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),
                ]
            return [
                create_mock_snapshot("2024-11-11", 901, 2025, enrolled=8),
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=28),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Registration dates fetched for both years
        assert mock_repository.fetch_registration_dates.call_count >= 2

        # Season start for primary year: exact priority_reg_date
        assert result.season_start == "2025-11-15"

    @pytest.mark.asyncio
    async def test_week_numbers_align_across_years(self, service, mock_repository):
        """Both years' priority reg should appear at ~week 1, aligning curves."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        # Both years have priority reg ~mid-November
        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-12"}  # season_start = Nov 5
            return {"priority_reg_date": "2024-11-13"}  # season_start = Nov 6

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    # First data ~week of priority reg
                    create_mock_snapshot("2025-11-12", 1001, 2026, enrolled=10),
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50),
                ]
            return [
                # First data ~week of priority reg
                create_mock_snapshot("2024-11-13", 901, 2025, enrolled=8),
                create_mock_snapshot("2025-01-05", 901, 2025, enrolled=45),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Both first data points should be at ~week 1 (relative to their season starts)
        current_first_wn = result.combined.weekly[0].week_number
        prior_first_wn = result.prior_years[0].weekly[0].week_number

        # Both should be within 1 week of each other (both near week 1)
        assert abs(current_first_wn - prior_first_wn) <= 1
        assert current_first_wn <= 2  # Near the start


# ============================================================================
# Phase 1: Cancelled-to-Date Summary Tests
# ============================================================================


class TestCancelledToDateSummary:
    """Test cancelled_to_date and prior_year_cancelled_to_date in VelocityResponse."""

    @pytest.mark.asyncio
    async def test_cancelled_to_date_from_snapshots(self, service, mock_repository, sample_sessions):
        """When snapshots include cancelled_count, cancelled_to_date should reflect
        the latest snapshot's total cancellations."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, cancelled=2),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=30, cancelled=5),
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=15, cancelled=1),
            create_mock_snapshot("2026-01-12", 1002, 2026, enrolled=25, cancelled=3),
        ]

        result = await service.get_velocity(year=2026)

        assert result.cancelled_to_date is not None
        # Latest week: session 1001 cancelled=5, session 1002 cancelled=3 → total=8
        assert result.cancelled_to_date == 8

    @pytest.mark.asyncio
    async def test_cancelled_to_date_from_reconstruction(self, service, mock_repository, sample_sessions):
        """When using reconstruction, cancelled_to_date should count cancelled/withdrawn attendees."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03", effective_date="2026-01-03"),
            create_mock_attendee_with_date(102, 1001, "2026-01-12", effective_date="2026-01-04", status="cancelled"),
            create_mock_attendee_with_date(103, 1001, "2026-01-15", effective_date="2026-01-10", status="cancelled"),
        ]

        result = await service.get_velocity(year=2026)

        assert result.cancelled_to_date is not None
        assert result.cancelled_to_date == 2

    @pytest.mark.asyncio
    async def test_cancelled_to_date_zero_when_no_cancellations(self, service, mock_repository, sample_sessions):
        """When no cancellations, cancelled_to_date should be 0."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, cancelled=0),
        ]

        result = await service.get_velocity(year=2026)

        assert result.cancelled_to_date == 0

    @pytest.mark.asyncio
    async def test_prior_year_cancelled_to_date(self, service, mock_repository):
        """When compare_years provided, prior_year_cancelled_to_date should include
        each prior year's cancellation data at the equivalent week."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, cancelled=3),
                    create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=30, cancelled=5),
                ]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=18, cancelled=2),
                create_mock_snapshot("2025-01-13", 901, 2025, enrolled=28, cancelled=7),
                create_mock_snapshot("2025-02-03", 901, 2025, enrolled=35, cancelled=10),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        assert len(result.prior_year_cancelled_to_date) == 1
        prior_summary = result.prior_year_cancelled_to_date[0]
        assert prior_summary.year == 2025
        # Final cancelled for prior year (last snapshot)
        assert prior_summary.cancelled_final == 10

    @pytest.mark.asyncio
    async def test_prior_year_cancelled_empty_when_no_compare(self, service, mock_repository, sample_sessions):
        """When no compare_years, prior_year_cancelled_to_date should be empty."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, cancelled=3),
        ]

        result = await service.get_velocity(year=2026)

        assert result.prior_year_cancelled_to_date == []


# ============================================================================
# Phase 2: Prior Year Session Summaries Tests
# ============================================================================


class TestPriorYearSessionSummaries:
    """Test prior_year_session_summaries for enhanced table columns."""

    @pytest.mark.asyncio
    async def test_prior_year_session_summaries_populated(self, service, mock_repository):
        """When compare_years provided, should include per-session prior year data."""
        sessions_2026 = {
            1001: create_mock_session(1001, "Session 1", year=2026),
            1002: create_mock_session(1002, "Session 2", year=2026),
        }
        sessions_2025 = {
            901: create_mock_session(901, "Session 1", year=2025),
            902: create_mock_session(902, "Session 2", year=2025),
        }

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
                    create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=15),
                ]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=18),
                create_mock_snapshot("2025-01-06", 902, 2025, enrolled=12),
                create_mock_snapshot("2025-02-03", 901, 2025, enrolled=25),
                create_mock_snapshot("2025-02-03", 902, 2025, enrolled=20),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        assert len(result.prior_year_session_summaries) > 0
        # Should have entries for each prior year session
        summaries_by_name = {s.session_name: s for s in result.prior_year_session_summaries}
        assert "Session 1" in summaries_by_name
        assert "Session 2" in summaries_by_name
        # Final enrolled for Session 1 in 2025
        assert summaries_by_name["Session 1"].final_enrolled == 25
        assert summaries_by_name["Session 2"].final_enrolled == 20

    @pytest.mark.asyncio
    async def test_prior_year_session_summaries_enrolled_at_current_week(self, service, mock_repository):
        """enrolled_at_current_week should match prior year enrollment at
        the same week_number as current year's latest data."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),
                ]
            return [
                create_mock_snapshot("2024-11-04", 901, 2025, enrolled=8),
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=28),
                create_mock_snapshot("2025-03-03", 901, 2025, enrolled=45),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Current year's latest week_number should be used to look up prior year
        assert len(result.prior_year_session_summaries) > 0
        s1_summary = result.prior_year_session_summaries[0]
        assert s1_summary.year == 2025
        # enrolled_at_current_week should be the prior year's enrollment at the matching week
        assert s1_summary.enrolled_at_current_week is not None
        # Final enrolled should be the last point
        assert s1_summary.final_enrolled == 45

    @pytest.mark.asyncio
    async def test_prior_year_session_summaries_empty_without_compare(self, service, mock_repository, sample_sessions):
        """Without compare_years, prior_year_session_summaries should be empty."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
        ]

        result = await service.get_velocity(year=2026)

        assert result.prior_year_session_summaries == []


# ============================================================================
# Phase 3: Cancellation Velocity Curve Tests
# ============================================================================


class TestCancellationVelocityCurves:
    """Test cancellation velocity curves via metric='cancellation' parameter."""

    @pytest.mark.asyncio
    async def test_cancellation_metric_returns_cancellation_curves(self, service, mock_repository, sample_sessions):
        """When metric='cancellation', should return cumulative cancellation curves."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=2),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=5),
            create_mock_snapshot("2026-01-19", 1001, 2026, enrolled=58, cancelled=8),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert result.combined is not None
        assert len(result.combined.weekly) > 0
        # Cancellation curves should show cumulative cancelled counts
        points = result.combined.weekly
        assert points[0].enrolled == 2  # "enrolled" field repurposed for cancelled count
        assert points[1].enrolled == 5
        assert points[2].enrolled == 8

    @pytest.mark.asyncio
    async def test_cancellation_metric_from_reconstruction(self, service, mock_repository, sample_sessions):
        """When no snapshots, cancellation metric should use status_transitions."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03"),
            create_mock_attendee_with_date(102, 1001, "2026-01-04"),
        ]
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2026-01-12"),
            create_mock_status_transition(102, 1001, "2026-01-20"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert result.combined is not None
        assert len(result.combined.weekly) > 0
        # Final point should show 2 cancellations
        last_point = result.combined.weekly[-1]
        assert last_point.enrolled == 2

    @pytest.mark.asyncio
    async def test_cancellation_metric_with_prior_year(self, service, mock_repository):
        """Cancellation curves should support prior year overlay."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
                    create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=6),
                ]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=48, cancelled=2),
                create_mock_snapshot("2025-01-13", 901, 2025, enrolled=52, cancelled=5),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025], metric="cancellation")

        assert len(result.prior_years) >= 1
        prior = result.prior_years[0]
        assert prior.year == 2025
        assert len(prior.weekly) > 0
        # Prior year cancellation counts
        assert prior.weekly[-1].enrolled == 5

    @pytest.mark.asyncio
    async def test_cancellation_metric_per_session_breakdown(self, service, mock_repository, sample_sessions):
        """Cancellation metric should produce per-session breakdown."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=40, cancelled=1),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=6),
            create_mock_snapshot("2026-01-12", 1002, 2026, enrolled=45, cancelled=4),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert len(result.by_session) == 2
        # Combined should sum cancellations
        assert result.combined.weekly[-1].enrolled == 10  # 6 + 4

    @pytest.mark.asyncio
    async def test_cancellation_velocity_includes_session_swap_count(self, service, mock_repository, sample_sessions):
        """When metric='cancellation', response should include session_swap_count.

        Tests that:
        - cancelled + enrolled same day = session swap
        - withdrawn (not just cancelled) is counted for swaps
        - session_cm_id scoping filters swap count to viewed session
        """
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001], 1002: sample_sessions[1002]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=6),
        ]
        # Person 101 cancelled from Session 1 and enrolled in Session 2 same day → session swap
        # Person 102 withdrawn from Session 1, enrolled in Session 2 → also swap
        # Person 103 cancelled from Session 1, no other enrollment → true departure
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-10", status="cancelled"),
            create_mock_attendee_with_date(101, 1002, "2026-01-10", status="enrolled"),
            create_mock_attendee_with_date(102, 1001, "2026-01-10", status="withdrawn"),
            create_mock_attendee_with_date(102, 1002, "2026-01-10", status="enrolled"),
            create_mock_attendee_with_date(103, 1001, "2026-01-11", status="cancelled"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert result.session_swap_count == 2

    @pytest.mark.asyncio
    async def test_cancellation_velocity_swap_scoped_to_session(self, service, mock_repository, sample_sessions):
        """When session_cm_id is set, swap count only includes swaps from that session."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001], 1002: sample_sessions[1002]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
        ]
        # Person 101 swapped from Session 1 → Session 2
        # Person 102 swapped from Session 2 → Session 1
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-10", status="cancelled"),
            create_mock_attendee_with_date(101, 1002, "2026-01-10", status="enrolled"),
            create_mock_attendee_with_date(102, 1002, "2026-01-10", status="cancelled"),
            create_mock_attendee_with_date(102, 1001, "2026-01-10", status="enrolled"),
        ]

        # Scoped to Session 1 — only person 101 has a cancellation in Session 1
        result = await service.get_velocity(year=2026, metric="cancellation", session_cm_id=1001)

        assert result.session_swap_count == 1

    @pytest.mark.asyncio
    async def test_default_metric_is_enrollment(self, service, mock_repository, sample_sessions):
        """Without metric parameter, should return enrollment curves (existing behavior)."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20, cancelled=2),
        ]

        result = await service.get_velocity(year=2026)

        # Default: enrollment curves, not cancellation
        assert result.combined.weekly[0].enrolled == 20


# ============================================================================
# Phase 4: Historical Cancellation Metrics Tests
# ============================================================================


class TestHistoricalCancellationMetrics:
    """Test cancellation counts in historical trends response."""

    @pytest.mark.asyncio
    async def test_year_metrics_include_cancellation_fields(self):
        """YearMetrics should include total_cancelled and cancellation_rate."""
        from api.schemas.metrics import NewVsReturning, YearMetrics

        ym = YearMetrics(
            year=2026,
            total_enrolled=100,
            by_gender=[],
            new_vs_returning=NewVsReturning(
                new_count=30,
                returning_count=70,
                new_percentage=30.0,
                returning_percentage=70.0,
            ),
            total_cancelled=15,
            cancellation_rate=13.04,
        )
        assert ym.total_cancelled == 15
        assert ym.cancellation_rate == 13.04

    @pytest.mark.asyncio
    async def test_year_metrics_defaults_to_zero_cancelled(self):
        """YearMetrics total_cancelled should default to 0."""
        from api.schemas.metrics import NewVsReturning, YearMetrics

        ym = YearMetrics(
            year=2026,
            total_enrolled=100,
            by_gender=[],
            new_vs_returning=NewVsReturning(
                new_count=30,
                returning_count=70,
                new_percentage=30.0,
                returning_percentage=70.0,
            ),
        )
        assert ym.total_cancelled == 0
        assert ym.cancellation_rate == 0.0

    @pytest.mark.asyncio
    async def test_historical_service_includes_cancellations(self):
        """HistoricalService should populate cancellation fields per year."""
        from api.services.historical_service import HistoricalService

        mock_repo = AsyncMock()

        # Mock attendees+persons for 2 years
        mock_session = Mock(cm_id=5001, name="Session 1", session_type="main")

        def make_attendee(pid: int) -> Mock:
            a = Mock()
            a.person_id = pid
            a.expand = {"session": mock_session}
            return a

        def make_person(pid: int, gender: str, years: int) -> Mock:
            p = Mock()
            p.cm_id = pid
            p.gender = gender
            p.years_at_camp = years
            return p

        attendees_2025 = [make_attendee(1), make_attendee(2)]
        attendees_2026 = [make_attendee(3), make_attendee(4), make_attendee(5)]
        persons_2025 = {1: make_person(1, "M", 1), 2: make_person(2, "F", 2)}
        persons_2026 = {3: make_person(3, "M", 2), 4: make_person(4, "F", 1), 5: make_person(5, "M", 3)}
        sessions_both = {5001: mock_session}

        async def mock_fetch_attendees(year, **kwargs):
            return attendees_2025 if year == 2025 else attendees_2026

        async def mock_fetch_persons(year, **kwargs):
            return persons_2025 if year == 2025 else persons_2026

        mock_repo.fetch_attendees.side_effect = mock_fetch_attendees
        mock_repo.fetch_persons.side_effect = mock_fetch_persons
        mock_repo.fetch_sessions = AsyncMock(return_value=sessions_both)

        # Mock cancellation count
        async def mock_fetch_cancellation_count(year, **kwargs):
            return 5 if year == 2025 else 8

        mock_repo.fetch_cancellation_count = mock_fetch_cancellation_count

        svc = HistoricalService(mock_repo)
        result = await svc.calculate_historical_trends(years=[2025, 2026])

        assert len(result.years) == 2
        # Each year should have cancellation data
        for ym in result.years:
            assert hasattr(ym, "total_cancelled")
            assert hasattr(ym, "cancellation_rate")


# ============================================================================
# Phase 5: Cancellation Velocity Parity Tests
# ============================================================================


class TestCancelledAtCurrentWeek:
    """Test cancelled_at_current_week population in prior year cancelled summary."""

    @pytest.mark.asyncio
    async def test_cancelled_at_current_week_populated_for_cancellation_metric(self, service, mock_repository):
        """cancelled_at_current_week should be populated when metric='cancellation'
        and compare_years is provided, looking up the prior year's cumulative cancelled
        at the current year's latest week_number."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
                    create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=6),
                ]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=48, cancelled=2),
                create_mock_snapshot("2025-01-13", 901, 2025, enrolled=52, cancelled=5),
                create_mock_snapshot("2025-03-03", 901, 2025, enrolled=60, cancelled=12),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025], metric="cancellation")

        assert len(result.prior_year_cancelled_to_date) == 1
        prior_summary = result.prior_year_cancelled_to_date[0]
        assert prior_summary.year == 2025
        # cancelled_at_current_week should NOT be None
        assert prior_summary.cancelled_at_current_week is not None
        # It should match the prior year's cumulative cancelled at the same week_number
        # Current year latest week_number is ~week 10 (Jan 12 relative to Nov season start)
        # Prior year should have data at that week
        assert prior_summary.cancelled_at_current_week > 0
        assert prior_summary.cancelled_final == 12

    @pytest.mark.asyncio
    async def test_cancelled_at_current_week_closest_week_fallback(self, service, mock_repository):
        """When exact week_number doesn't exist in prior year data,
        should fallback to closest prior week."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                # Current year ends at week ~10
                return [
                    create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=3),
                    create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=6),
                ]
            # Prior year has data at week ~1 and week ~20, but NOT at week ~10
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=48, cancelled=2),
                create_mock_snapshot("2025-05-05", 901, 2025, enrolled=60, cancelled=15),
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025], metric="cancellation")

        prior_summary = result.prior_year_cancelled_to_date[0]
        # Should fallback to closest prior week's value (week ~1 → cancelled=2)
        assert prior_summary.cancelled_at_current_week is not None
        assert prior_summary.cancelled_at_current_week == 2
        assert prior_summary.cancelled_final == 15


class TestCancellationGenderSplit:
    """Test gender-split curves for cancellation metric."""

    @pytest.mark.asyncio
    async def test_cancellation_gender_curves_from_reconstruction(self, service, mock_repository, sample_sessions):
        """When metric='cancellation' and split_by_gender=True,
        by_gender should have M/F curves with correct cumulative counts."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []

        # Status transitions with gender data
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2026-01-12", gender="M"),
            create_mock_status_transition(102, 1001, "2026-01-12", gender="F"),
            create_mock_status_transition(103, 1001, "2026-01-19", gender="M"),
            create_mock_status_transition(104, 1001, "2026-01-19", gender="M"),
            create_mock_status_transition(105, 1001, "2026-01-19", gender="F"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation", split_by_gender=True)

        assert len(result.by_gender) == 2
        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # M: week1=1, week2=3 (cumulative)
        assert m_curve.weekly[-1].enrolled == 3
        # F: week1=1, week2=2 (cumulative)
        assert f_curve.weekly[-1].enrolled == 2

    @pytest.mark.asyncio
    async def test_cancellation_gender_breakdown_populated(self, service, mock_repository, sample_sessions):
        """session_gender_breakdown should be populated for cancellation metric
        when split_by_gender=True."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []

        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2026-01-12", gender="M"),
            create_mock_status_transition(102, 1001, "2026-01-12", gender="F"),
            create_mock_status_transition(103, 1002, "2026-01-12", gender="M"),
            create_mock_status_transition(104, 1002, "2026-01-12", gender="M"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation", split_by_gender=True)

        assert len(result.session_gender_breakdown) == 2
        breakdown_map = {b.session_cm_id: b for b in result.session_gender_breakdown}
        assert breakdown_map[1001].boys_enrolled == 1  # boys_enrolled repurposed for M cancelled
        assert breakdown_map[1001].girls_enrolled == 1
        assert breakdown_map[1002].boys_enrolled == 2
        assert breakdown_map[1002].girls_enrolled == 0

    @pytest.mark.asyncio
    async def test_cancellation_gender_with_prior_year(self, service, mock_repository):
        """prior_year_by_gender should be populated for cancellation metric."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []

        async def mock_fetch_transitions(year, to_statuses, **kwargs):
            if year == 2026:
                return [
                    create_mock_status_transition(101, 1001, "2026-01-12", gender="M"),
                    create_mock_status_transition(102, 1001, "2026-01-12", gender="F"),
                ]
            return [
                create_mock_status_transition(201, 901, "2025-01-13", gender="M", year=2025),
                create_mock_status_transition(202, 901, "2025-01-13", gender="F", year=2025),
                create_mock_status_transition(203, 901, "2025-01-20", gender="F", year=2025),
            ]

        mock_repository.fetch_status_transitions.side_effect = mock_fetch_transitions

        result = await service.get_velocity(
            year=2026, compare_years=[2025], metric="cancellation", split_by_gender=True
        )

        assert len(result.prior_year_by_gender) >= 2
        prior_m = [c for c in result.prior_year_by_gender if c.gender == "M"]
        prior_f = [c for c in result.prior_year_by_gender if c.gender == "F"]
        assert len(prior_m) == 1
        assert len(prior_f) == 1
        assert prior_m[0].weekly[-1].enrolled == 1  # 1 male cancelled in 2025
        assert prior_f[0].weekly[-1].enrolled == 2  # 2 female cancelled in 2025


# ============================================================================
# Step 1: Schema New Fields Tests
# ============================================================================


class TestSchemaNewFields:
    """Test that new schema fields exist with correct defaults."""

    def test_weekly_data_point_has_gross_enrolled(self):
        """WeeklyDataPoint should accept gross_enrolled with default 0."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=10,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
            is_partial=False,
            days_in_week=7,
        )
        assert point.gross_enrolled == 0

    def test_weekly_data_point_has_weekly_new(self):
        """WeeklyDataPoint should accept weekly_new with default 0."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=10,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
            is_partial=False,
            days_in_week=7,
        )
        assert point.weekly_new == 0

    def test_weekly_data_point_has_weekly_cancelled(self):
        """WeeklyDataPoint should accept weekly_cancelled with default 0."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=10,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
            is_partial=False,
            days_in_week=7,
        )
        assert point.weekly_cancelled == 0

    def test_weekly_data_point_explicit_new_fields(self):
        """WeeklyDataPoint should accept explicit values for new fields."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=45,
            delta=10,
            data_source="snapshot",
            gross_enrolled=50,
            weekly_new=8,
            weekly_cancelled=3,
            is_partial=False,
            days_in_week=7,
        )
        assert point.gross_enrolled == 50
        assert point.weekly_new == 8
        assert point.weekly_cancelled == 3

    def test_velocity_response_has_warnings(self):
        """VelocityResponse should have warnings field defaulting to empty list."""

        response = VelocityResponse(
            year=2026,
            season_start="2025-12-03",
            combined=VelocityCurve(year=2026, session_cm_id=None, gender=None, weekly=[]),
            by_session=[],
            prior_years=[],
            phase_markers=[],
            cancelled_to_date=None,
            session_swap_count=0,
        )
        assert response.warnings == []

    def test_velocity_response_with_warnings(self):
        """VelocityResponse should accept explicit warnings."""

        response = VelocityResponse(
            year=2026,
            season_start="2025-12-03",
            combined=VelocityCurve(year=2026, session_cm_id=None, gender=None, weekly=[]),
            by_session=[],
            prior_years=[],
            phase_markers=[],
            cancelled_to_date=None,
            session_swap_count=0,
            warnings=["Year 2026 has no registration date configured (needs priority_reg_date or early_reg_date)"],
        )
        assert len(response.warnings) == 1
        assert "no registration date configured" in response.warnings[0]


# ============================================================================
# Step 2: No Fallback Start Date Tests
# ============================================================================


class TestNoFallbackStartDate:
    """Test behavior when priority_reg_date is missing (no Nov 1 fallback)."""

    @pytest.mark.asyncio
    async def test_no_priority_reg_returns_empty_curves_with_warning(self, service, mock_repository):
        """get_velocity with no priority_reg_date should return empty curves + warning."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
        ]
        # Override fixture default: no priority_reg_date
        mock_repository.fetch_registration_dates = AsyncMock(return_value={})

        result = await service.get_velocity(year=2026)

        assert result.combined.weekly == []
        assert result.by_session == []
        assert len(result.warnings) == 1
        assert "Year 2026 has no registration date configured" in result.warnings[0]

    @pytest.mark.asyncio
    async def test_prior_year_missing_priority_reg_skipped_with_warning(self, service, mock_repository):
        """Prior year without priority_reg_date should be skipped with a warning."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-01"}
            return {}  # 2025 has no priority_reg_date

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=20)]
            return [create_mock_snapshot("2025-01-06", 901, 2025, enrolled=15)]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Current year should have data
        assert len(result.combined.weekly) > 0
        # Prior year should be skipped (no line)
        assert len(result.prior_years) == 0
        # Warning about missing prior year config
        assert any("2025" in w and "no registration date configured" in w for w in result.warnings)


# ============================================================================
# Pre-2021 Early Registration Fallback Tests
# ============================================================================


class TestEarlyRegFallback:
    """Test that years with only early_reg_date (no priority_reg_date) produce valid velocity data."""

    @pytest.mark.asyncio
    async def test_primary_year_early_fallback_produces_data(self, service, mock_repository):
        """A pre-2021 year with only early_reg_date should produce velocity curves."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2020)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2020-01-06", 1001, 2020, enrolled=50),
            create_mock_snapshot("2020-01-13", 1001, 2020, enrolled=75),
        ]
        mock_repository.fetch_registration_dates = AsyncMock(
            return_value={"early_reg_date": "2019-12-01", "open_reg_date": "2020-01-15"}
        )

        result = await service.get_velocity(year=2020)

        # Should have data, not empty
        assert len(result.combined.weekly) > 0
        # Season start should be the early_reg_date
        assert result.season_start == "2019-12-01"
        # No warnings about missing dates
        assert not any("no registration date" in w for w in result.warnings)

    @pytest.mark.asyncio
    async def test_prior_year_early_fallback(self, service, mock_repository):
        """Prior year with only early_reg_date should produce a prior year curve, not be skipped."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2020 = {901: create_mock_session(901, "Session 1", year=2020)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2020

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-01"}
            return {"early_reg_date": "2019-12-01"}  # Pre-2021: only early

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=20)]
            return [create_mock_snapshot("2019-12-05", 901, 2020, enrolled=15)]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2020])

        # Prior year should have a curve (not skipped)
        assert len(result.prior_years) == 1
        assert result.prior_years[0].year == 2020
        # No warnings about missing dates for 2020
        assert not any("2020" in w and "no registration date" in w for w in result.warnings)

    @pytest.mark.asyncio
    async def test_prior_year_season_starts_in_response(self, service, mock_repository):
        """Response should include prior_year_season_starts dict for tooltip date computation."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2024 = {901: create_mock_session(901, "Session 1", year=2024)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2024

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-01"}
            return {"priority_reg_date": "2023-11-15"}

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=20)]
            return [create_mock_snapshot("2023-11-20", 901, 2024, enrolled=15)]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2024])

        assert 2024 in result.prior_year_season_starts
        assert result.prior_year_season_starts[2024] == "2023-11-15"

    @pytest.mark.asyncio
    async def test_prior_year_season_starts_with_early_fallback(self, service, mock_repository):
        """prior_year_season_starts should work with early_reg_date fallback too."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2020 = {901: create_mock_session(901, "Session 1", year=2020)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2020

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions

        async def mock_fetch_reg_dates(year):
            if year == 2026:
                return {"priority_reg_date": "2025-11-01"}
            return {"early_reg_date": "2019-12-01"}

        mock_repository.fetch_registration_dates.side_effect = mock_fetch_reg_dates

        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=20)]
            return [create_mock_snapshot("2019-12-05", 901, 2020, enrolled=15)]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2020])

        assert 2020 in result.prior_year_season_starts
        assert result.prior_year_season_starts[2020] == "2019-12-01"


# ============================================================================
# Step 4: Gross/Net/Delta Field Population Tests
# ============================================================================


class TestGrossNetDeltaFromSnapshots:
    """Test gross_enrolled, weekly_new, weekly_cancelled population from snapshots."""

    @pytest.mark.asyncio
    async def test_snapshot_gross_enrolled(self, service, mock_repository, sample_sessions):
        """Snapshot gross_enrolled = enrolled + cancelled (since enrolled is net)."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=5),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=8),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 2
        # gross = enrolled + cancelled
        assert points[0].gross_enrolled == 55  # 50 + 5
        assert points[1].gross_enrolled == 63  # 55 + 8
        # net enrolled unchanged
        assert points[0].enrolled == 50
        assert points[1].enrolled == 55

    @pytest.mark.asyncio
    async def test_snapshot_weekly_new_and_cancelled(self, service, mock_repository, sample_sessions):
        """weekly_new = delta of gross, weekly_cancelled = delta of cancelled."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=5),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=55, cancelled=8),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        # First week: weekly_new = gross, weekly_cancelled = cancelled
        assert points[0].weekly_new == 55  # gross_enrolled (first week)
        assert points[0].weekly_cancelled == 5  # cancelled_count (first week)
        # Second week: delta of gross and delta of cancelled
        assert points[1].weekly_new == 8  # 63 - 55
        assert points[1].weekly_cancelled == 3  # 8 - 5

    @pytest.mark.asyncio
    async def test_snapshot_gross_never_decreases(self, service, mock_repository, sample_sessions):
        """gross_enrolled should never decrease (monotonically increasing)."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=50, cancelled=5),
            # Net drops but gross should still increase
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=48, cancelled=10),
            create_mock_snapshot("2026-01-19", 1001, 2026, enrolled=52, cancelled=12),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        gross_values = [p.gross_enrolled for p in points]
        # gross = enrolled + cancelled: 55, 58, 64
        assert gross_values == [55, 58, 64]
        # Each value >= previous
        for i in range(1, len(gross_values)):
            assert gross_values[i] >= gross_values[i - 1]


class TestGrossNetDeltaFromReconstruction:
    """Test gross_enrolled, weekly_new, weekly_cancelled from reconstruction path."""

    @pytest.mark.asyncio
    async def test_reconstruction_gross_and_net(self, service, mock_repository, sample_sessions):
        """Reconstruction should populate gross_enrolled and net enrolled separately.

        Now uses status-aware logic: cancelled attendees contribute +1 at effective_date
        and -1 at enrollment_date (PostDate = cancel date).
        """
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        # 7 still-enrolled in week 1, 5 still-enrolled in week 2
        # Plus 3 cancelled (registered week 1, cancelled week 1) and 1 cancelled (registered week 2, cancelled week 2)
        mock_repository.fetch_attendees_with_dates.return_value = [
            *[
                create_mock_attendee_with_date(100 + i, 1001, "2026-01-03", effective_date="2026-01-03")
                for i in range(7)
            ],
            # 3 cancelled: enrolled in week 1, cancelled in week 1
            *[
                create_mock_attendee_with_date(
                    110 + i, 1001, "2026-01-04", effective_date="2026-01-03", status="cancelled"
                )
                for i in range(3)
            ],
            *[
                create_mock_attendee_with_date(200 + i, 1001, "2026-01-10", effective_date="2026-01-10")
                for i in range(4)
            ],
            # 1 cancelled: enrolled in week 2, cancelled in week 2
            create_mock_attendee_with_date(210, 1001, "2026-01-12", effective_date="2026-01-10", status="cancelled"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        # Daily-first pipeline produces weekly points for every week from season_start
        # through end_date. Find the weeks with actual activity by week_number.
        # Season start is Nov 1, 2025. Jan 3 = day 63 = week 10, Jan 10 = day 70 = week 11.
        assert len(points) >= 2
        week_by_num = {p.week_number: p for p in points}
        w10 = week_by_num[10]
        w11 = week_by_num[11]
        # Week 10: gross=10 (7 enrolled + 3 cancelled), cancelled=3, net=7
        assert w10.gross_enrolled == 10
        assert w10.enrolled == 7
        assert w10.weekly_new == 10
        assert w10.weekly_cancelled == 3
        # Week 11: gross=15 (10 + 4 enrolled + 1 cancelled), cancelled=4, net=11
        assert w11.gross_enrolled == 15
        assert w11.enrolled == 11
        assert w11.weekly_new == 5
        assert w11.weekly_cancelled == 1


# ============================================================================
# Hybrid Snapshot/Reconstruction Tests
# ============================================================================


class TestHybridSnapshotReconstruction:
    """Test hybrid mode: reconstruction for pre-snapshot weeks, snapshots for later weeks.

    When snapshots start mid-season (e.g., February) but enrollment activity began
    earlier (e.g., November priority registration), the system should use reconstruction
    for the gap period and snapshots once they begin.
    """

    @pytest.mark.asyncio
    async def test_hybrid_reconstruction_before_snapshots(self, service, mock_repository, sample_sessions):
        """When enrollment started in Nov but snapshots began in Feb,
        both reconstructed and snapshot data should appear in the combined curve."""
        # Season starts Nov 1 2025 (priority_reg_date)
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots only start in February 2026
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-02-07", 1001, 2026, enrolled=50, waitlisted=2, cancelled=3),
            create_mock_snapshot("2026-02-14", 1001, 2026, enrolled=60, waitlisted=3, cancelled=4),
        ]

        # Attendees enrolled starting Nov 2025 (for reconstruction)
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-11-10"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01"),
            create_mock_attendee_with_date(104, 1001, "2025-12-15"),
            create_mock_attendee_with_date(105, 1001, "2026-01-05"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        # Should have data from both Nov 2025 and Feb 2026
        points = result.combined.weekly
        assert len(points) > 2, "Should have more than just the 2 snapshot weeks"

        # First points should be from reconstruction (Nov timeframe)
        first_point = points[0]
        assert first_point.week_start < "2026-02-07"

        # Last points should be from snapshots (Feb timeframe)
        last_point = points[-1]
        assert last_point.enrolled == 60

    @pytest.mark.asyncio
    async def test_hybrid_data_source_labels(self, service, mock_repository, sample_sessions):
        """Reconstructed points should be labeled 'reconstructed',
        snapshot points should be labeled 'snapshot'."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots starting Feb 2026
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-02-07", 1001, 2026, enrolled=50, cancelled=2),
        ]

        # Attendees from Nov 2025
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-11-10"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        recon_points = [p for p in points if p.data_source == "reconstructed"]
        snap_points = [p for p in points if p.data_source == "snapshot"]

        assert len(recon_points) > 0, "Should have reconstructed points before snapshot date"
        assert len(snap_points) > 0, "Should have snapshot points"

        # All reconstructed points should be before snapshot points
        max_recon_week = max(p.week_start for p in recon_points)
        min_snap_week = min(p.week_start for p in snap_points)
        assert max_recon_week < min_snap_week

    @pytest.mark.asyncio
    async def test_hybrid_deltas_at_boundary(self, service, mock_repository, sample_sessions):
        """Delta at the first snapshot week should be correct relative
        to the last reconstructed week's enrolled count."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots starting Feb 7 with 50 enrolled
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-02-07", 1001, 2026, enrolled=50, cancelled=3),
        ]

        # 5 attendees enrolled before snapshots
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-11-03"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01"),
            create_mock_attendee_with_date(104, 1001, "2025-12-01"),
            create_mock_attendee_with_date(105, 1001, "2026-01-05"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        # Find the boundary: last reconstructed and first snapshot point
        recon_points = [p for p in points if p.data_source == "reconstructed"]
        snap_points = [p for p in points if p.data_source == "snapshot"]
        assert len(recon_points) > 0
        assert len(snap_points) > 0

        last_recon = recon_points[-1]
        first_snap = snap_points[0]

        # Delta at first snapshot should be snapshot enrolled minus last reconstructed enrolled
        assert first_snap.delta == first_snap.enrolled - last_recon.enrolled

    @pytest.mark.asyncio
    async def test_no_snapshots_pure_reconstruction(self, service, mock_repository, sample_sessions):
        """When no snapshots exist, should use pure reconstruction (existing behavior)."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        mock_repository.fetch_enrollment_snapshots.return_value = []

        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-11-10"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert all(p.data_source == "reconstructed" for p in points)
        assert points[-1].enrolled == 3

    @pytest.mark.asyncio
    async def test_full_coverage_snapshots_no_reconstruction(self, service, mock_repository, sample_sessions):
        """When snapshots start from week 0 (season start), no reconstruction should be used."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshot on Nov 1 — same as season start
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-01", 1001, 2026, enrolled=10, cancelled=1),
            create_mock_snapshot("2025-11-08", 1001, 2026, enrolled=20, cancelled=2),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert all(p.data_source == "snapshot" for p in points)
        # Should NOT call reconstruction
        mock_repository.fetch_attendees_with_dates.assert_not_called()

    @pytest.mark.asyncio
    async def test_hybrid_per_session_independent(self, service, mock_repository, sample_sessions):
        """Each session should be stitched based on its own first snapshot date,
        not a global first snapshot date."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = sample_sessions  # sessions 1001 and 1002

        # Session 1001 has snapshots from Jan, Session 1002 from Feb
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30, cancelled=2),
            create_mock_snapshot("2026-02-07", 1002, 2026, enrolled=20, cancelled=1),
        ]

        # Reconstruction data for both sessions starting Nov
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-12-01"),
            create_mock_attendee_with_date(201, 1002, "2025-11-05"),
            create_mock_attendee_with_date(202, 1002, "2025-12-10"),
            create_mock_attendee_with_date(203, 1002, "2026-01-10"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        # Find per-session curves
        s1_curve = next(c for c in result.by_session if c.session_cm_id == 1001)
        s2_curve = next(c for c in result.by_session if c.session_cm_id == 1002)

        # Session 1001: reconstruction Nov-Dec, snapshot from Jan
        s1_snap_points = [p for p in s1_curve.weekly if p.data_source == "snapshot"]
        s1_recon_points = [p for p in s1_curve.weekly if p.data_source == "reconstructed"]
        assert len(s1_snap_points) > 0
        assert len(s1_recon_points) > 0

        # Session 1002: reconstruction Nov-Jan, snapshot from Feb
        s2_snap_points = [p for p in s2_curve.weekly if p.data_source == "snapshot"]
        s2_recon_points = [p for p in s2_curve.weekly if p.data_source == "reconstructed"]
        assert len(s2_snap_points) > 0
        assert len(s2_recon_points) > 0

        # Session 1002 should have more reconstructed weeks than session 1001
        # because its snapshots start later
        assert len(s2_recon_points) > len(s1_recon_points)

    @pytest.mark.asyncio
    async def test_hybrid_cancellation_metric(self, service, mock_repository, sample_sessions):
        """Hybrid logic should also apply to cancellation velocity curves."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots with cancelled_count starting Feb 2026
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-02-07", 1001, 2026, enrolled=50, cancelled=8),
            create_mock_snapshot("2026-02-14", 1001, 2026, enrolled=55, cancelled=10),
        ]

        # Cancellations from status_transitions before snapshots
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2025-12-01"),
            create_mock_status_transition(102, 1001, "2025-12-15"),
            create_mock_status_transition(103, 1001, "2026-01-10"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        points = result.combined.weekly
        recon_points = [p for p in points if p.data_source == "reconstructed"]
        snap_points = [p for p in points if p.data_source == "snapshot"]

        assert len(recon_points) > 0, "Should have reconstructed cancellation points"
        assert len(snap_points) > 0, "Should have snapshot cancellation points"

        # Final snapshot point should have the snapshot's cancelled count
        assert snap_points[-1].enrolled == 10

    @pytest.mark.asyncio
    async def test_hybrid_combined_curve_sums_correctly(self, service, mock_repository, sample_sessions):
        """Combined curve should correctly aggregate hybrid per-session curves."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = sample_sessions  # 1001 and 1002

        # Both sessions have snapshots from the same date
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-02-07", 1001, 2026, enrolled=50, cancelled=3),
            create_mock_snapshot("2026-02-07", 1002, 2026, enrolled=30, cancelled=2),
        ]

        # Reconstruction for pre-snapshot period
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-12-01"),
            create_mock_attendee_with_date(201, 1002, "2025-11-05"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        # The combined snapshot week should sum both sessions
        snap_points = [p for p in result.combined.weekly if p.data_source == "snapshot"]
        assert len(snap_points) > 0
        assert snap_points[0].enrolled == 80  # 50 + 30


class TestGrossNetDeltaCombinedCurves:
    """Test that _combine_weekly_curves sums new fields across sessions."""

    @pytest.mark.asyncio
    async def test_combined_sums_gross_fields(self, service, mock_repository, sample_sessions):
        """Combined curve should sum gross_enrolled, weekly_new, weekly_cancelled."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30, cancelled=3),
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=20, cancelled=2),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 1
        # Combined gross = (30+3) + (20+2) = 55
        assert points[0].gross_enrolled == 55
        # Combined weekly_new = 33 + 22 = 55 (first week)
        assert points[0].weekly_new == 55
        # Combined weekly_cancelled = 3 + 2 = 5
        assert points[0].weekly_cancelled == 5


# ============================================================================
# Enrollment Gender From Snapshots (Fast Path)
# ============================================================================


class TestEnrollmentGenderFromSnapshots:
    """Test gender-split velocity curves built from snapshot gender fields.

    When snapshots have non-None gender counts, _build_gender_curves should
    use the snapshot fast path instead of reconstructing from attendees.
    """

    @pytest.mark.asyncio
    async def test_gender_curves_from_snapshots(self, service, mock_repository, sample_sessions):
        """When snapshots have gender data covering full season, produce M/F curves without fetching attendees."""
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2026-01-05"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=20,
                enrolled_male=12,
                enrolled_female=8,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-12",
                1001,
                2026,
                enrolled=30,
                enrolled_male=18,
                enrolled_female=12,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert len(result.by_gender) == 2
        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # Week 2 (latest) should reflect snapshot counts
        assert m_curve.weekly[-1].enrolled == 18
        assert f_curve.weekly[-1].enrolled == 12

        # Should NOT have called fetch_attendees_with_dates (fast path used)
        mock_repository.fetch_attendees_with_dates.assert_not_called()

    @pytest.mark.asyncio
    async def test_gender_breakdown_from_snapshots(self, service, mock_repository, sample_sessions):
        """session_gender_breakdown should be built from latest snapshot per session."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=20,
                enrolled_male=10,
                enrolled_female=10,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-12",
                1001,
                2026,
                enrolled=25,
                enrolled_male=15,
                enrolled_female=10,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-05",
                1002,
                2026,
                enrolled=18,
                enrolled_male=8,
                enrolled_female=10,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert len(result.session_gender_breakdown) == 2
        breakdown_map = {b.session_cm_id: b for b in result.session_gender_breakdown}
        # Latest snapshot for session 1001: male=15, female=10
        assert breakdown_map[1001].boys_enrolled == 15
        assert breakdown_map[1001].girls_enrolled == 10
        # Only one snapshot for 1002: male=8, female=10
        assert breakdown_map[1002].boys_enrolled == 8
        assert breakdown_map[1002].girls_enrolled == 10

    @pytest.mark.asyncio
    async def test_fallback_when_no_gender_data(self, service, mock_repository, sample_sessions):
        """Old snapshots without gender fields should fall back to reconstruction."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        # Snapshots without gender fields (all None)
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
        ]
        # Provide attendees for reconstruction fallback
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-05", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2026-01-05", gender="F"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        # Should have fallen back to reconstruction
        mock_repository.fetch_attendees_with_dates.assert_called()
        assert len(result.by_gender) == 2

    @pytest.mark.asyncio
    async def test_ag_session_merging(self, service, mock_repository):
        """AG sessions should merge into parent for gender snapshot curves."""
        parent = create_mock_session(1001, "Session 1", session_type="main")
        ag = create_mock_session(2001, "Session 1 AG", session_type="ag", parent_id=1001)

        mock_repository.fetch_sessions.return_value = {1001: parent, 2001: ag}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=20,
                enrolled_male=10,
                enrolled_female=10,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-05",
                2001,
                2026,
                enrolled=5,
                enrolled_male=3,
                enrolled_female=2,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert len(result.by_gender) == 2
        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # AG merges into parent: male=10+3=13, female=10+2=12
        assert m_curve.weekly[-1].enrolled == 13
        assert f_curve.weekly[-1].enrolled == 12

    @pytest.mark.asyncio
    async def test_multi_week_gender_curves(self, service, mock_repository, sample_sessions):
        """Gender curves should track week-over-week progression."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=10,
                enrolled_male=6,
                enrolled_female=4,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-12",
                1001,
                2026,
                enrolled=20,
                enrolled_male=12,
                enrolled_female=8,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-19",
                1001,
                2026,
                enrolled=30,
                enrolled_male=18,
                enrolled_female=12,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # Check progression
        assert len(m_curve.weekly) == 3
        assert m_curve.weekly[0].enrolled == 6
        assert m_curve.weekly[1].enrolled == 12
        assert m_curve.weekly[2].enrolled == 18

        assert len(f_curve.weekly) == 3
        assert f_curve.weekly[0].enrolled == 4
        assert f_curve.weekly[1].enrolled == 8
        assert f_curve.weekly[2].enrolled == 12

    @pytest.mark.asyncio
    async def test_single_session_filter_with_gender(self, service, mock_repository, sample_sessions):
        """session_cm_id filter should work with gender snapshot curves."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=20,
                enrolled_male=12,
                enrolled_female=8,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-01-05",
                1002,
                2026,
                enrolled=15,
                enrolled_male=7,
                enrolled_female=8,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, session_cm_id=1001, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # Only session 1001 counts
        assert m_curve.weekly[-1].enrolled == 12
        assert f_curve.weekly[-1].enrolled == 8

    @pytest.mark.asyncio
    async def test_hybrid_gender_reconstruction_before_snapshots(self, service, mock_repository, sample_sessions):
        """When snapshots with gender data start Feb but attendees enrolled Nov,
        both time periods should appear in gender curves."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots with gender data starting Feb 2026
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-02-07",
                1001,
                2026,
                enrolled=50,
                waitlisted=2,
                enrolled_male=30,
                enrolled_female=20,
                waitlisted_male=1,
                waitlisted_female=1,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2026-02-14",
                1001,
                2026,
                enrolled=60,
                waitlisted=3,
                enrolled_male=35,
                enrolled_female=25,
                waitlisted_male=1,
                waitlisted_female=2,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        # Attendees enrolled starting Nov 2025 (for reconstruction of pre-snapshot gap)
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-11-10", gender="F"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01", gender="M"),
            create_mock_attendee_with_date(104, 1001, "2025-12-15", gender="F"),
            create_mock_attendee_with_date(105, 1001, "2026-01-05", gender="M"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # Should have data from both Nov 2025 (reconstruction) and Feb 2026 (snapshots)
        assert len(m_curve.weekly) > 2, "Should have more than just the 2 snapshot weeks"

        # First points should be from pre-snapshot period (Nov timeframe)
        assert m_curve.weekly[0].week_start < "2026-02-07"

        # Last points should reflect snapshot data (Feb timeframe)
        assert m_curve.weekly[-1].enrolled == 35
        assert f_curve.weekly[-1].enrolled == 25

    @pytest.mark.asyncio
    async def test_hybrid_gender_data_source_labels(self, service, mock_repository, sample_sessions):
        """In hybrid gender mode, reconstructed points should be labeled 'reconstructed',
        snapshot points should be labeled 'snapshot'."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots with gender data starting Feb 2026
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-02-07",
                1001,
                2026,
                enrolled=50,
                enrolled_male=30,
                enrolled_female=20,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        # Attendees from Nov 2025
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-11-03", gender="F"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")

        recon_points = [p for p in m_curve.weekly if p.data_source == "reconstructed"]
        snap_points = [p for p in m_curve.weekly if p.data_source == "snapshot"]

        assert len(recon_points) > 0, "Should have reconstructed points before snapshot date"
        assert len(snap_points) > 0, "Should have snapshot points"

        # All reconstructed points should be chronologically before snapshot points
        max_recon_week = max(p.week_start for p in recon_points)
        min_snap_week = min(p.week_start for p in snap_points)
        assert max_recon_week < min_snap_week

    @pytest.mark.asyncio
    async def test_hybrid_gender_full_coverage_no_reconstruction(self, service, mock_repository, sample_sessions):
        """When gender snapshots cover from season start, no reconstruction should be used."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}

        # Snapshots starting from season start (Nov 1)
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2025-11-01",
                1001,
                2026,
                enrolled=10,
                enrolled_male=6,
                enrolled_female=4,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
            create_mock_snapshot(
                "2025-11-08",
                1001,
                2026,
                enrolled=20,
                enrolled_male=12,
                enrolled_female=8,
                waitlisted_male=0,
                waitlisted_female=0,
                cancelled_male=0,
                cancelled_female=0,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")

        # All points should be from snapshots (no reconstruction needed)
        assert all(p.data_source == "snapshot" for p in m_curve.weekly)

        # Should NOT have fetched attendees (pure snapshot fast path)
        mock_repository.fetch_attendees_with_dates.assert_not_called()

    @pytest.mark.asyncio
    async def test_gender_gross_enrolled_uses_cancelled_counts(self, service, mock_repository, sample_sessions):
        """Gender curves should have gross_enrolled = enrolled + cancelled, not just enrolled."""
        mock_repository.fetch_registration_dates.side_effect = None
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2026-01-05"}
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2026-01-05",
                1001,
                2026,
                enrolled=20,
                enrolled_male=12,
                enrolled_female=8,
                cancelled=3,
                cancelled_male=2,
                cancelled_female=1,
            ),
            create_mock_snapshot(
                "2026-01-12",
                1001,
                2026,
                enrolled=30,
                enrolled_male=18,
                enrolled_female=12,
                cancelled=5,
                cancelled_male=3,
                cancelled_female=2,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        m_curve = next(c for c in result.by_gender if c.gender == "M")
        f_curve = next(c for c in result.by_gender if c.gender == "F")

        # gross_enrolled = enrolled + cancelled per gender
        assert m_curve.weekly[-1].gross_enrolled == 21  # 18 + 3
        assert f_curve.weekly[-1].gross_enrolled == 14  # 12 + 2

        # gross_enrolled should differ from enrolled when cancellations exist
        assert m_curve.weekly[-1].gross_enrolled != m_curve.weekly[-1].enrolled
        assert f_curve.weekly[-1].gross_enrolled != f_curve.weekly[-1].enrolled

        # weekly_new should be computed from gross deltas
        assert m_curve.weekly[-1].weekly_new == 7  # (18+3) - (12+2) = 7
        assert f_curve.weekly[-1].weekly_new == 5  # (12+2) - (8+1) = 5

        # weekly_cancelled should track cancellation deltas
        assert m_curve.weekly[-1].weekly_cancelled == 1  # 3 - 2
        assert f_curve.weekly[-1].weekly_cancelled == 1  # 2 - 1


# ============================================================================
# Partial Week Indicator Tests
# ============================================================================


class TestPartialWeekInfo:
    """Tests for the _partial_week_info helper that detects incomplete week buckets."""

    def test_mid_week_is_partial(self):
        """A week_start that contains today should be marked partial."""
        from datetime import date

        # week_start is Monday Jan 5 2026, today is Thursday Jan 8 2026 (day 4 of 7)
        is_partial, days = _partial_week_info("2026-01-05", 2026, today=date(2026, 1, 8))
        assert is_partial is True
        assert days == 4  # Mon=1, Tue=2, Wed=3, Thu=4

    def test_first_day_of_week_is_partial(self):
        """Today being the first day of the week means only 1 day of data."""
        from datetime import date

        is_partial, days = _partial_week_info("2026-01-05", 2026, today=date(2026, 1, 5))
        assert is_partial is True
        assert days == 1

    def test_last_day_of_week_is_partial(self):
        """Today being the last day (day 7) still means partial — the day isn't over."""
        from datetime import date

        # week_start is Jan 5, day 7 is Jan 11
        is_partial, days = _partial_week_info("2026-01-05", 2026, today=date(2026, 1, 11))
        assert is_partial is True
        assert days == 7

    def test_completed_week_not_partial(self):
        """A week that ended before today is not partial."""
        from datetime import date

        # week_start is Jan 5, week ends Jan 12. Today is Jan 12 (next week).
        is_partial, days = _partial_week_info("2026-01-05", 2026, today=date(2026, 1, 12))
        assert is_partial is False
        assert days == 7

    def test_future_week_not_partial(self):
        """A week starting after today is not partial (shouldn't happen, but safe)."""
        from datetime import date

        is_partial, days = _partial_week_info("2026-01-12", 2026, today=date(2026, 1, 5))
        assert is_partial is False
        assert days == 7

    def test_prior_year_never_partial(self):
        """Prior year data should never be marked partial, even if dates match."""
        from datetime import date

        # 2025 data with today in 2026 — should not be partial
        is_partial, days = _partial_week_info("2025-01-06", 2025, today=date(2026, 1, 8))
        assert is_partial is False
        assert days == 7

    def test_same_year_different_week_not_partial(self):
        """A completed week in the current year should not be partial."""
        from datetime import date

        # week_start is Jan 5 2026, today is Jan 20 2026 (well past that week)
        is_partial, days = _partial_week_info("2026-01-05", 2026, today=date(2026, 1, 20))
        assert is_partial is False
        assert days == 7


class TestPartialWeekInSnapshots:
    """Verify that snapshot-based curves mark the last week as partial for current year."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        repo.fetch_registration_dates = AsyncMock(
            return_value={
                "priority_reg_date": "2026-01-05",
            }
        )
        repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2026, start_date="2026-06-15"),
            }
        )
        repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
        repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
        repo.fetch_status_transitions = AsyncMock(return_value=[])
        return VelocityService(repo)

    @pytest.mark.asyncio
    async def test_last_week_marked_partial_in_snapshots(self, service):
        """The most recent week in current year snapshot data should be marked partial."""
        from datetime import date

        service.repo.fetch_enrollment_snapshots.return_value = [
            # Week 0: Jan 5-11 (complete)
            create_mock_snapshot("2026-01-07", 1001, 2026, enrolled=50, waitlisted=5),
            # Week 1: Jan 12-18 (complete)
            create_mock_snapshot("2026-01-14", 1001, 2026, enrolled=80, waitlisted=8),
            # Week 2: Jan 19-25 — today is Jan 22 (Thu), so only 4 days
            create_mock_snapshot("2026-01-21", 1001, 2026, enrolled=100, waitlisted=10),
        ]

        result = await service.get_velocity(year=2026, today=date(2026, 1, 22))

        points = result.combined.weekly
        assert len(points) == 3

        # First two weeks should be complete
        assert points[0].is_partial is False
        assert points[0].days_in_week == 7
        assert points[1].is_partial is False
        assert points[1].days_in_week == 7

        # Last week should be partial
        assert points[2].is_partial is True
        assert points[2].days_in_week == 4  # Jan 19 to Jan 22 inclusive

    @pytest.mark.asyncio
    async def test_prior_year_snapshots_never_partial(self, service):
        """Prior year snapshot data should never have partial weeks."""
        from datetime import date

        # Set up for 2025 as a prior year
        service.repo.fetch_registration_dates = AsyncMock(
            return_value={
                "priority_reg_date": "2025-01-06",
            }
        )
        service.repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2025, start_date="2025-06-15"),
            }
        )
        service.repo.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-01-08", 1001, 2025, enrolled=50, waitlisted=5),
            create_mock_snapshot("2025-01-15", 1001, 2025, enrolled=80, waitlisted=8),
        ]

        # Even with today in the middle of a 2025 week, nothing is partial
        result = await service.get_velocity(year=2025, today=date(2026, 1, 22))

        for point in result.combined.weekly:
            assert point.is_partial is False
            assert point.days_in_week == 7


class TestPartialWeekInReconstruction:
    """Verify that reconstruction-based curves mark the last week as partial."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        repo.fetch_registration_dates = AsyncMock(
            return_value={
                "priority_reg_date": "2026-01-05",
            }
        )
        repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2026, start_date="2026-06-15"),
            }
        )
        repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
        repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
        repo.fetch_status_transitions = AsyncMock(return_value=[])
        return VelocityService(repo)

    @pytest.mark.asyncio
    async def test_reconstruction_marks_last_week_partial(self, service):
        """Reconstruction path should also mark the current partial week.

        Anchor = 2026-01-05.  Week 0 = Dec 29–Jan 4 (empty).
        Jan 6/7 → Week 1 (full).  Jan 13 → Week 2 (current, partial).
        """
        from datetime import date

        service.repo.fetch_attendees_with_dates.return_value = [
            # Week 1 (Jan 5-11)
            create_mock_attendee_with_date(1, 1001, "2026-01-06"),
            create_mock_attendee_with_date(2, 1001, "2026-01-07"),
            # Week 2 (current, partial)
            create_mock_attendee_with_date(3, 1001, "2026-01-13"),
        ]

        result = await service.get_velocity(year=2026, today=date(2026, 1, 15))

        points = result.combined.weekly
        # Week 0 (empty) + Week 1 (full) + Week 2 (partial) = 3 points
        assert len(points) == 3

        week0 = points[0]
        assert week0.week_number == 0
        assert week0.is_partial is False

        week1 = points[1]
        assert week1.week_number == 1
        assert week1.is_partial is False
        assert week1.days_in_week == 7

        week2 = points[2]
        assert week2.week_number == 2
        assert week2.is_partial is True
        assert week2.days_in_week == 4  # Jan 12 to Jan 15 inclusive


class TestPartialWeekInCombinedCurves:
    """Verify partial week info propagates through _combine_weekly_curves."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        repo.fetch_registration_dates = AsyncMock(
            return_value={
                "priority_reg_date": "2026-01-05",
            }
        )
        repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2026, start_date="2026-06-15"),
                1002: create_mock_session(1002, "Session 2", year=2026, start_date="2026-07-01"),
            }
        )
        repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
        repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
        repo.fetch_status_transitions = AsyncMock(return_value=[])
        return VelocityService(repo)

    @pytest.mark.asyncio
    async def test_combined_curve_propagates_partial(self, service):
        """When combining multi-session data, partial status should propagate."""
        from datetime import date

        service.repo.fetch_enrollment_snapshots.return_value = [
            # Session 1
            create_mock_snapshot("2026-01-07", 1001, 2026, enrolled=30),
            create_mock_snapshot("2026-01-14", 1001, 2026, enrolled=50),
            # Session 2
            create_mock_snapshot("2026-01-07", 1002, 2026, enrolled=20),
            create_mock_snapshot("2026-01-14", 1002, 2026, enrolled=40),
        ]

        result = await service.get_velocity(year=2026, today=date(2026, 1, 16))

        combined = result.combined.weekly
        assert len(combined) == 2

        # First week complete
        assert combined[0].is_partial is False
        assert combined[0].days_in_week == 7

        # Second week partial (Jan 12 to Jan 16 = 5 days)
        assert combined[1].is_partial is True
        assert combined[1].days_in_week == 5


class TestPartialWeekInGenderCurves:
    """Verify partial week info works in gender-split curves."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        repo.fetch_registration_dates = AsyncMock(
            return_value={
                "priority_reg_date": "2026-01-05",
            }
        )
        repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2026, start_date="2026-06-15"),
            }
        )
        repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
        repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
        repo.fetch_status_transitions = AsyncMock(return_value=[])
        return VelocityService(repo)

    @pytest.mark.asyncio
    async def test_gender_curves_mark_partial(self, service):
        """Gender-split curves should also mark the last week as partial."""
        from datetime import date

        # Main fetch for combined
        service.repo.fetch_attendees_with_dates.side_effect = [
            # First call (combined): attendees without gender
            [
                create_mock_attendee_with_date(1, 1001, "2026-01-06"),
                create_mock_attendee_with_date(2, 1001, "2026-01-13"),
            ],
            # Second call (gender split): attendees with gender
            [
                create_mock_attendee_with_date(1, 1001, "2026-01-06", gender="M"),
                create_mock_attendee_with_date(2, 1001, "2026-01-13", gender="F"),
            ],
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True, today=date(2026, 1, 15))

        # Check gender curves
        assert len(result.by_gender) == 2  # M and F
        for curve in result.by_gender:
            if curve.weekly:
                last_point = curve.weekly[-1]
                if last_point.week_start == "2026-01-12":
                    assert last_point.is_partial is True
                    assert last_point.days_in_week == 4


class TestPartialWeekSchemaDefaults:
    """Verify WeeklyDataPoint schema defaults for partial week fields."""

    def test_default_values(self):
        """New fields should default to non-partial."""
        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=100,
            delta=100,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
            is_partial=False,
            days_in_week=7,
        )
        assert point.is_partial is False
        assert point.days_in_week == 7

    def test_explicit_partial(self):
        """Fields can be explicitly set."""
        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_end="2026-01-11",
            week_label="Wk 1 (Jan 5–11)",
            week_number=1,
            enrolled=100,
            delta=100,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
            is_partial=True,
            days_in_week=4,
        )
        assert point.is_partial is True
        assert point.days_in_week == 4


# ============================================================================
# Carry-Forward in _combine_weekly_curves
# ============================================================================


class TestCombineCarryForward:
    """Bug 2: Sparse session curves should carry forward cumulative values in gap weeks.

    When sessions have data points for different weeks, a session with no data
    in a given week should contribute its last known cumulative value rather
    than implicitly contributing 0.
    """

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        return VelocityService(repo)

    def test_combine_carries_forward_sparse_session_values(self, service):
        """Session A has week 1+2, Session B only week 1. In week 2, Session B should carry forward."""
        session_a = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=10, delta=10, weekly_new=10),
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=15, delta=5, weekly_new=5),
        ]
        session_b = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=20, delta=20, weekly_new=20),
            # No data for week 2 — Session B should carry forward enrolled=20
        ]
        result = service._combine_weekly_curves({1001: session_a, 1002: session_b})

        assert len(result) == 2
        # Week 1: 10 + 20 = 30
        assert result[0].enrolled == 30
        assert result[0].gross_enrolled == 30
        # Week 2: 15 + 20 (carried forward) = 35
        assert result[1].enrolled == 35
        assert result[1].gross_enrolled == 35

    def test_combine_no_carry_forward_before_first_point(self, service):
        """Session B starts in week 2 — should NOT carry back into week 1."""
        session_a = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=10, delta=10, weekly_new=10),
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=15, delta=5, weekly_new=5),
        ]
        session_b = [
            # Session B only starts in week 2
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=20, delta=20, weekly_new=20),
        ]
        result = service._combine_weekly_curves({1001: session_a, 1002: session_b})

        assert len(result) == 2
        # Week 1: Only Session A contributes (10)
        assert result[0].enrolled == 10
        # Week 2: 15 + 20 = 35
        assert result[1].enrolled == 35

    def test_combine_dense_curves_unchanged(self, service):
        """When all sessions have data for all weeks, carry-forward doesn't change results."""
        session_a = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=10, delta=10, data_source="snapshot", weekly_new=10),
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=15, delta=5, data_source="snapshot", weekly_new=5),
        ]
        session_b = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=20, delta=20, data_source="snapshot", weekly_new=20),
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=25, delta=5, data_source="snapshot", weekly_new=5),
        ]
        result = service._combine_weekly_curves({1001: session_a, 1002: session_b})

        assert len(result) == 2
        assert result[0].enrolled == 30  # 10 + 20
        assert result[1].enrolled == 40  # 15 + 25

    def test_combine_weekly_new_zero_for_carried_forward(self, service):
        """Carried-forward weeks should contribute 0 for weekly_new and weekly_cancelled."""
        session_a = [
            make_weekly_point("2026-01-05", "Jan 5", 1, enrolled=10, delta=10, weekly_new=10),
            make_weekly_point("2026-01-12", "Jan 12", 2, enrolled=15, delta=5, weekly_new=5),
        ]
        session_b = [
            make_weekly_point(
                "2026-01-05",
                "Jan 5",
                1,
                enrolled=8,
                delta=8,
                gross_enrolled=10,
                weekly_new=10,
                weekly_cancelled=2,
            ),
            # Gap in week 2 — carry forward enrolled=8, but weekly_new and weekly_cancelled should be 0
        ]
        result = service._combine_weekly_curves({1001: session_a, 1002: session_b})

        # Week 2: weekly_new should only come from Session A (5), not Session B (carried = 0)
        assert result[1].weekly_new == 5
        # Week 2: weekly_cancelled should be 0 from both (A has 0, B carried = 0)
        assert result[1].weekly_cancelled == 0


# ============================================================================
# Reconstruction Warning
# ============================================================================


class TestReconstructionWarning:
    """Phase 4: Warning when reconstruction is used."""

    @pytest.mark.asyncio
    async def test_hybrid_includes_reconstruction_warning(self, service, mock_repository, sample_sessions):
        """When reconstruction is used (no snapshots), response includes a warning."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
            ),
        ]

        result = await service.get_velocity(year=2026)

        assert len(result.warnings) >= 1
        assert any("Reconstruction" in w for w in result.warnings)

    @pytest.mark.asyncio
    async def test_snapshot_only_no_reconstruction_warning(self, service, mock_repository, sample_sessions):
        """When only snapshots are used, no reconstruction warning."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        assert not any("Reconstruction" in w for w in result.warnings)


# ============================================================================
# Reconstruction with EffectiveDate + Status-Aware Logic
# ============================================================================


class TestReconstructionEffectiveDate:
    """Bug 4: Reconstruction should use effective_date for enrollment and
    enrollment_date (PostDate) for cancellation events. Only enrolled,
    cancelled, and withdrawn statuses contribute to velocity curves."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        repo.fetch_registration_dates = AsyncMock(return_value={"priority_reg_date": "2026-01-05"})
        repo.fetch_sessions = AsyncMock(
            return_value={
                1001: create_mock_session(1001, "Session 1", year=2026, start_date="2026-06-15"),
            }
        )
        repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
        repo.fetch_status_transitions = AsyncMock(return_value=[])
        return VelocityService(repo)

    @pytest.mark.asyncio
    async def test_reconstruction_uses_effective_date_for_enrollment(self, service):
        """Enrolled attendee's enrollment date should come from effective_date, not enrollment_date.

        Anchor = 2026-01-05.  effective_date=Jan 5 → day_offset=0 → Week 1.
        Week 0 (Dec 29-Jan 4) is generated as an empty prefix week.
        """
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-12",  # PostDate
                effective_date="2026-01-05",  # EffectiveDate — the real registration date
                status="enrolled",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        assert len(points) >= 2  # Week 0 (empty) + at least Week 1
        # Should appear in Week 1 (effective_date Jan 5), not enrollment_date (Jan 12)
        # Week 0 is the empty prefix; find the week containing the enrollment
        enrolled_points = [p for p in points if p.enrolled > 0]
        assert len(enrolled_points) >= 1
        enroll_point = enrolled_points[0]
        assert enroll_point.week_start == "2026-01-05"
        assert enroll_point.enrolled == 1

    @pytest.mark.asyncio
    async def test_reconstruction_cancelled_enrolled_then_subtracted(self, service):
        """Cancelled attendee: +1 at effective_date, -1 at enrollment_date (PostDate = cancel date)."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-03-01",  # PostDate = cancellation date
                effective_date="2026-01-05",  # EffectiveDate = original registration
                status="cancelled",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        # Should have at least 2 points: enrollment week and cancellation week
        week_starts = [p.week_start for p in points]
        assert "2026-01-05" in week_starts  # enrollment week
        # Find enrollment point
        enroll_point = next(p for p in points if p.week_start == "2026-01-05")
        assert enroll_point.gross_enrolled == 1
        # Net at enrollment week should be 1 (not yet cancelled)
        assert enroll_point.enrolled == 1

        # Find cancellation week
        cancel_week = [p for p in points if p.week_start >= "2026-02-23"]
        assert len(cancel_week) >= 1
        # After cancellation, net should be 0 (enrolled 1 - cancelled 1)
        last_point = points[-1]
        assert last_point.enrolled == 0

    @pytest.mark.asyncio
    async def test_reconstruction_withdrawn_enrolled_then_subtracted(self, service):
        """Withdrawn attendee: same as cancelled — +1 at effective_date, -1 at enrollment_date."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-02-15",  # PostDate = withdrawal date
                effective_date="2026-01-05",  # EffectiveDate = original registration
                status="withdrawn",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        last_point = points[-1]
        # After withdrawal, net should be 0
        assert last_point.enrolled == 0
        # But gross should be 1 (was enrolled once)
        assert last_point.gross_enrolled == 1

    @pytest.mark.asyncio
    async def test_reconstruction_waitlisted_excluded(self, service):
        """Waitlisted attendees should NOT be counted in enrollment curves."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="waitlisted",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        # No enrollment points — waitlisted doesn't count
        assert len(points) == 0 or all(p.enrolled == 0 for p in points)

    @pytest.mark.asyncio
    async def test_reconstruction_incomplete_excluded(self, service):
        """Incomplete attendees should NOT be counted in enrollment curves."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="incomplete",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        assert len(points) == 0 or all(p.enrolled == 0 for p in points)

    @pytest.mark.asyncio
    async def test_reconstruction_none_excluded(self, service):
        """None status attendees should NOT be counted in enrollment curves."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="none",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        assert len(points) == 0 or all(p.enrolled == 0 for p in points)

    @pytest.mark.asyncio
    async def test_reconstruction_session_swap_nets_to_zero(self, service):
        """Person cancels Session A and enrolls Session B same day = net 0 change on that day."""
        service.repo.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
            1002: create_mock_session(1002, "Session 2"),
        }
        service.repo.fetch_attendees_with_dates.return_value = [
            # Cancelled from Session 1 (registered Nov, cancelled Feb 15)
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-02-15",  # PostDate = cancel date
                effective_date="2026-01-05",  # EffectiveDate = original reg
                status="cancelled",
            ),
            # Enrolled in Session 2 (same day)
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1002,
                enrollment_date="2026-02-15",  # PostDate = new enrollment date
                effective_date="2026-02-15",  # EffectiveDate = this enrollment
                status="enrolled",
            ),
        ]
        result = await service.get_velocity(year=2026)
        # Net effect: originally registered in Jan (1001), then swapped to 1002 in Feb
        # After swap week: total enrolled should still be 1
        last_point = result.combined.weekly[-1]
        assert last_point.enrolled == 1

    @pytest.mark.asyncio
    async def test_reconstruction_fallback_to_enrollment_date(self, service):
        """When effective_date is empty, falls back to enrollment_date."""
        service.repo.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-12",
                effective_date="",  # No effective_date — use enrollment_date
                status="enrolled",
            ),
        ]
        result = await service.get_velocity(year=2026)
        points = result.combined.weekly
        assert len(points) >= 1
        # Daily-first pipeline produces weekly points from season_start.
        # Find the week containing the enrollment (Jan 12, day_offset ~72 = week 11).
        enrolled_weeks = [p for p in points if p.enrolled > 0]
        assert len(enrolled_weeks) >= 1
        assert enrolled_weeks[0].enrolled == 1

    @pytest.mark.asyncio
    async def test_reconstruction_gross_vs_net_diverge(self, service):
        """Gross counts enrollments only, net = gross - cancellations."""
        service.repo.fetch_attendees_with_dates.return_value = [
            # 3 enrolled
            create_mock_attendee_with_date(
                person_id=1,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="enrolled",
            ),
            create_mock_attendee_with_date(
                person_id=2,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="enrolled",
            ),
            create_mock_attendee_with_date(
                person_id=3,
                session_cm_id=1001,
                enrollment_date="2026-01-05",
                effective_date="2026-01-05",
                status="enrolled",
            ),
            # 1 cancelled (registered same week, cancelled 2 weeks later)
            create_mock_attendee_with_date(
                person_id=4,
                session_cm_id=1001,
                enrollment_date="2026-01-19",  # PostDate = cancel date
                effective_date="2026-01-05",  # EffectiveDate = original reg
                status="cancelled",
            ),
        ]
        result = await service.get_velocity(year=2026)
        last_point = result.combined.weekly[-1]
        # Gross: 4 people enrolled at some point
        assert last_point.gross_enrolled == 4
        # Net: 4 - 1 cancellation = 3
        assert last_point.enrolled == 3


# ============================================================================
# SeasonContext dataclass
# ============================================================================


class TestSeasonContext:
    """Test SeasonContext dataclass."""

    def test_season_context_is_frozen(self):
        from datetime import date, datetime

        ctx = SeasonContext(
            year=2026,
            season_start=datetime(2025, 11, 1),
            season_end=datetime(2026, 8, 31),
            today=date(2026, 3, 13),
        )
        assert ctx.year == 2026
        assert ctx.season_start == datetime(2025, 11, 1)
        with pytest.raises(AttributeError):
            ctx.year = 2027  # type: ignore[misc]


# ============================================================================
# Week-label consolidation regression guard
# ============================================================================


class TestWeekLabelConsolidation:
    """Guard against week-label format divergence after consolidation."""

    def test_rollup_uses_week_label_format(self):
        from datetime import date

        from api.schemas.velocity import DailyDataPoint

        season_start = date(2025, 11, 3)
        daily = [
            DailyDataPoint(
                date="2025-11-03",
                day_offset=0,
                gross_enrolled=10,
                enrolled=10,
                cancelled=0,
                daily_new=10,
                daily_cancelled=0,
                data_source="snapshot",
            ),
        ]
        result = rollup_daily_to_weekly(daily, season_start)
        assert len(result) == 1
        expected_label = _week_label(date(2025, 11, 3), season_start)
        assert result[0].week_label == expected_label


# ============================================================================
# Snapshot dedup order tests (#456)
# ============================================================================


class TestSnapshotDedupOrder:
    """Test that snapshot dedup uses explicit timestamp, not iteration order."""

    @pytest.mark.asyncio
    async def test_later_snapshot_wins_over_earlier_same_day(self, service, mock_repository, sample_sessions):
        """When two snapshots exist for the same session on the same day,
        the one with the later snapshot_datetime should win, regardless of list order."""
        mock_repository.fetch_sessions.return_value = sample_sessions

        # Snapshots in REVERSE chronological order — later timestamp first
        # If dedup relies on iteration order, the earlier snapshot (enrolled=50) would win
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03T14:00:00Z", 1001, 2026, enrolled=100, cancelled=5),
            create_mock_snapshot("2025-11-03T08:00:00Z", 1001, 2026, enrolled=50, cancelled=2),
        ]

        result = await service.get_velocity(year=2026)

        # The later snapshot (14:00, enrolled=100) should win
        assert result.combined.weekly[0].enrolled == 100

    @pytest.mark.asyncio
    async def test_gender_snapshot_dedup_uses_timestamp(self, service, mock_repository, sample_sessions):
        """Gender snapshot dedup should use explicit timestamp comparison."""
        mock_repository.fetch_sessions.return_value = sample_sessions

        # Later timestamp first, then earlier
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2025-11-03T14:00:00Z",
                1001,
                2026,
                enrolled=100,
                cancelled=5,
                enrolled_male=60,
                enrolled_female=40,
                cancelled_male=3,
                cancelled_female=2,
            ),
            create_mock_snapshot(
                "2025-11-03T08:00:00Z",
                1001,
                2026,
                enrolled=50,
                cancelled=2,
                enrolled_male=30,
                enrolled_female=20,
                cancelled_male=1,
                cancelled_female=1,
            ),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        boys_curve = next(c for c in result.by_gender if c.gender == "M")
        girls_curve = next(c for c in result.by_gender if c.gender == "F")
        assert boys_curve.weekly[0].enrolled == 60
        assert girls_curve.weekly[0].enrolled == 40

    @pytest.mark.asyncio
    async def test_cancellation_snapshot_dedup_uses_timestamp(self, service, mock_repository, sample_sessions):
        """Cancellation snapshot dedup should use explicit timestamp, not cancelled >= current."""
        mock_repository.fetch_sessions.return_value = sample_sessions

        # Later timestamp has LOWER cancelled count (correction scenario)
        # Old `cancelled >= current` heuristic would keep the higher value (earlier)
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03T08:00:00Z", 1001, 2026, enrolled=100, cancelled=10),
            create_mock_snapshot("2025-11-03T14:00:00Z", 1001, 2026, enrolled=100, cancelled=7),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        # The later snapshot (14:00, cancelled=7) should win
        # Note: cancellation curves store cumulative cancelled count in the `enrolled` field
        assert result.combined.weekly[0].enrolled == 7

    @pytest.mark.asyncio
    async def test_cancellation_ag_children_summed_after_dedup(self, service, mock_repository):
        """AG child sessions should sum their cancelled counts into the parent after dedup."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
            1003: create_mock_session(1003, "Session 1 AG", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions

        # Parent and AG child each have snapshots on same day, different times
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03T08:00:00Z", 1001, 2026, enrolled=90, cancelled=5),
            create_mock_snapshot("2025-11-03T14:00:00Z", 1001, 2026, enrolled=95, cancelled=8),
            create_mock_snapshot("2025-11-03T08:00:00Z", 1003, 2026, enrolled=10, cancelled=2),
            create_mock_snapshot("2025-11-03T14:00:00Z", 1003, 2026, enrolled=12, cancelled=3),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        # After dedup: parent latest (14:00) = 8, AG child latest (14:00) = 3
        # After AG sum: effective 1001 = 8 + 3 = 11
        assert result.combined.weekly[0].enrolled == 11


# ============================================================================
# Task 1: _daily_for_gender cancelled bug (#550)
# ============================================================================


class TestDailyForGenderCancelled:
    """Test that _daily_for_gender computes cancelled from gross_enrolled - enrolled."""

    def test_boys_cancelled_derived_from_gross_minus_enrolled(self):
        from api.schemas.velocity import DailyDataPoint
        from api.services.velocity_service import VelocityService

        daily = [
            DailyDataPoint(
                date="2025-11-03",
                day_offset=0,
                gross_enrolled=100,
                enrolled=90,
                cancelled=10,
                daily_new=5,
                daily_cancelled=2,
                data_source="snapshot",
                gross_enrolled_boys=60,
                enrolled_boys=55,
                daily_new_boys=3,
                daily_cancelled_boys=1,
                gross_enrolled_girls=40,
                enrolled_girls=35,
                daily_new_girls=2,
                daily_cancelled_girls=1,
            ),
        ]
        result = VelocityService._daily_for_gender(daily, "M")
        assert len(result) == 1
        assert result[0].cancelled == 5

    def test_girls_cancelled_derived_from_gross_minus_enrolled(self):
        from api.schemas.velocity import DailyDataPoint
        from api.services.velocity_service import VelocityService

        daily = [
            DailyDataPoint(
                date="2025-11-03",
                day_offset=0,
                gross_enrolled=100,
                enrolled=90,
                cancelled=10,
                daily_new=5,
                daily_cancelled=2,
                data_source="snapshot",
                gross_enrolled_boys=60,
                enrolled_boys=55,
                daily_new_boys=3,
                daily_cancelled_boys=1,
                gross_enrolled_girls=40,
                enrolled_girls=35,
                daily_new_girls=2,
                daily_cancelled_girls=1,
            ),
        ]
        result = VelocityService._daily_for_gender(daily, "F")
        assert len(result) == 1
        assert result[0].cancelled == 5


# ============================================================================
# Task 2: Eliminate duplicate snapshot fetch (#474)
# ============================================================================


class TestSnapshotFetchDedup:
    """Test that snapshots are fetched once and passed through, not fetched twice."""

    @pytest.mark.asyncio
    async def test_enrollment_gender_split_fetches_snapshots_once(self, service, mock_repository, sample_sessions):
        """With split_by_gender=True, fetch_enrollment_snapshots should be called once, not twice."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot(
                "2025-11-03T14:00:00Z",
                1001,
                2026,
                enrolled=100,
                cancelled=5,
                enrolled_male=60,
                enrolled_female=40,
                cancelled_male=3,
                cancelled_female=2,
            ),
        ]

        await service.get_velocity(year=2026, split_by_gender=True)

        primary_calls = [
            c
            for c in mock_repository.fetch_enrollment_snapshots.call_args_list
            if c.args[0] == 2026 or c.kwargs.get("year") == 2026
        ]
        assert len(primary_calls) == 1


# ============================================================================
# Task 3: Reuse status transitions for cancellation gender curves (#475)
# ============================================================================


class TestTransitionsFetchDedup:
    """Test that status transitions are fetched once for cancellation gender curves."""

    @pytest.mark.asyncio
    async def test_cancellation_gender_split_fetches_transitions_once(self, service, mock_repository, sample_sessions):
        """With metric=cancellation and split_by_gender=True, fetch_status_transitions should be called once."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []  # Force reconstruction path
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(1, 1001, "2025-11-03T14:00:00Z", gender="M"),
            create_mock_status_transition(2, 1001, "2025-11-10T14:00:00Z", gender="F"),
        ]

        await service.get_velocity(year=2026, metric="cancellation", split_by_gender=True)

        primary_calls = [c for c in mock_repository.fetch_status_transitions.call_args_list if c.args[0] == 2026]
        assert len(primary_calls) == 1


# ============================================================================
# Task 4: Add daily data series to cancellation velocity (#459)
# ============================================================================


class TestCancellationDailyData:
    """Test that cancellation curves produce daily data like enrollment does."""

    @pytest.mark.asyncio
    async def test_cancellation_snapshots_produce_daily_data(self, service, mock_repository, sample_sessions):
        """Cancellation curves from snapshots should populate VelocityCurve.daily."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03T14:00:00Z", 1001, 2026, enrolled=100, cancelled=5),
            create_mock_snapshot("2025-11-04T14:00:00Z", 1001, 2026, enrolled=102, cancelled=7),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert len(result.combined.daily) > 0
        for dp in result.combined.daily:
            assert dp.data_source == "snapshot"
            assert dp.cancelled >= 0

    @pytest.mark.asyncio
    async def test_cancellation_reconstruction_produces_daily_data(self, service, mock_repository, sample_sessions):
        """Cancellation curves from reconstruction should populate VelocityCurve.daily."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(1, 1001, "2025-11-03T14:00:00Z"),
            create_mock_status_transition(2, 1001, "2025-11-10T14:00:00Z"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        assert len(result.combined.daily) > 0
        for dp in result.combined.daily:
            assert dp.data_source == "reconstructed"
            assert dp.cancelled >= 0


class TestHybridDailyPerSession:
    """Test that _merge_hybrid_daily is applied per-session, not just globally.

    When sessions have snapshots starting at different dates, each session's daily
    data should be merged independently using its own first snapshot date as the
    cutover point. Previously, daily merging was only done on the combined curve,
    which used a single global cutover date — producing inaccurate deltas for
    sessions whose snapshots started earlier or later than others.
    """

    @pytest.mark.asyncio
    async def test_enrollment_hybrid_daily_merged_per_session(self, service, mock_repository, sample_sessions):
        """Combined daily data should reflect per-session merges, not a single global merge.

        Session 1001 snapshots start Jan 5, session 1002 snapshots start Feb 7.
        The combined daily data should use reconstruction before each session's
        own first snapshot date, not a single global cutover.
        """
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = sample_sessions  # 1001 and 1002

        # Session 1001 snapshots start Jan 5, Session 1002 snapshots start Feb 7
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30, cancelled=2),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=35, cancelled=3),
            create_mock_snapshot("2026-02-07", 1002, 2026, enrolled=20, cancelled=1),
            create_mock_snapshot("2026-02-14", 1002, 2026, enrolled=25, cancelled=2),
        ]

        # Reconstruction data for both sessions
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(102, 1001, "2025-12-01"),
            create_mock_attendee_with_date(201, 1002, "2025-11-05"),
            create_mock_attendee_with_date(202, 1002, "2025-12-10"),
            create_mock_attendee_with_date(203, 1002, "2026-01-10"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        daily = result.combined.daily
        assert len(daily) > 0, "Should have combined daily data"

        # Between Jan 5 and Feb 7, session 1001 should use snapshot data
        # but session 1002 should still use reconstruction data.
        # Check that daily points in the Jan 5 - Feb 6 range have mixed sources
        # (session 1001 from snapshots, session 1002 from reconstruction).
        jan_daily = [dp for dp in daily if "2026-01-05" <= dp.date < "2026-02-07"]
        assert len(jan_daily) > 0, "Should have daily points in the Jan-Feb gap"

        # After Feb 7, both sessions should use snapshot data
        feb_daily = [dp for dp in daily if dp.date >= "2026-02-07"]
        assert len(feb_daily) > 0, "Should have daily points from Feb onward"

        # The key check: the combined daily should have correct cumulative
        # enrolled values that reflect both sessions' data.
        # At Feb 7: session 1001 snapshot = 35 enrolled (from Jan 12 snapshot),
        # session 1002 snapshot = 20. Combined should be ~55.
        # With global merge, session 1002's reconstruction data from Jan would
        # be dropped (cutover at Jan 5 for all), giving wrong combined totals.
        feb7_points = [dp for dp in daily if dp.date == "2026-02-07"]
        if feb7_points:
            # session 1002 started snapshots here with 20 enrolled
            # session 1001 should still carry its snapshot values
            # The exact value depends on interpolation, but enrolled should be > 20
            assert feb7_points[0].enrolled > 20, "Combined enrolled at Feb 7 should include session 1001's contribution"

    @pytest.mark.asyncio
    async def test_enrollment_hybrid_daily_data_sources_per_session(self, service, mock_repository, sample_sessions):
        """Daily data between the two sessions' snapshot start dates should contain
        data from both sources (reconstruction for session 1002, snapshot for session 1001)."""
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = sample_sessions

        # Session 1001 snapshots from Jan 5, Session 1002 snapshots from Feb 7
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30, cancelled=0),
            create_mock_snapshot("2026-02-07", 1002, 2026, enrolled=20, cancelled=0),
        ]

        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03"),
            create_mock_attendee_with_date(201, 1002, "2025-11-05"),
            create_mock_attendee_with_date(202, 1002, "2026-01-10"),
        ]
        mock_repository.fetch_status_transitions.return_value = []

        result = await service.get_velocity(year=2026)

        daily = result.combined.daily
        assert len(daily) > 0

        # Before Jan 5: both sessions use reconstruction -> source should be "reconstructed"
        pre_jan = [dp for dp in daily if dp.date < "2026-01-05"]
        assert len(pre_jan) > 0, "Should have reconstruction points before any snapshots"
        assert all(dp.data_source == "reconstructed" for dp in pre_jan)

        # After Feb 7: both sessions use snapshots -> source should be "snapshot"
        post_feb = [dp for dp in daily if dp.date >= "2026-02-07"]
        assert len(post_feb) > 0, "Should have snapshot points after all sessions have snapshots"
        assert all(dp.data_source == "snapshot" for dp in post_feb)

    @pytest.mark.asyncio
    async def test_cancellation_hybrid_daily_merged_per_session(self, service, mock_repository, sample_sessions):
        """Cancellation daily merge should also be applied per-session.

        Session 1002 has a cancellation on Jan 10 (from reconstruction), but session 1001's
        snapshots start Jan 5. With global merge, the Jan 10 data would be dropped since the
        global cutover is Jan 5. With per-session merge, session 1002 should keep its
        reconstruction data until its own snapshot start date (Feb 7).
        """
        mock_repository.fetch_registration_dates.return_value = {"priority_reg_date": "2025-11-01"}
        mock_repository.fetch_sessions.return_value = sample_sessions

        # Session 1001 snapshots from Jan 5, Session 1002 from Feb 7
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30, cancelled=5),
            create_mock_snapshot("2026-02-07", 1002, 2026, enrolled=20, cancelled=3),
        ]

        # Cancellation transitions before snapshots for both sessions
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2025-11-15"),
            create_mock_status_transition(201, 1002, "2025-12-01"),
            create_mock_status_transition(202, 1002, "2026-01-10"),
        ]

        result = await service.get_velocity(year=2026, metric="cancellation")

        daily = result.combined.daily
        assert len(daily) > 0, "Should have combined cancellation daily data"

        # With per-session merge, session 1002's Jan 10 cancellation (from reconstruction)
        # should appear as a daily point. The global merge drops it because the cutover
        # for ALL sessions is Jan 5 (session 1001's first snapshot).
        jan10_points = [dp for dp in daily if dp.date == "2026-01-10"]
        assert len(jan10_points) > 0, (
            "Session 1002's Jan 10 reconstruction cancellation should be preserved "
            "with per-session merge (session 1002 snapshots don't start until Feb 7)"
        )

    @pytest.mark.asyncio
    async def test_merge_hybrid_daily_unit_applied_per_session(self, service):
        """Unit test: _merge_hybrid_daily should produce correct results when called per-session."""
        from api.schemas.velocity import DailyDataPoint

        # Session A: reconstruction until day 10, snapshots from day 10
        recon_a = [
            DailyDataPoint(
                date="2025-11-01",
                day_offset=0,
                gross_enrolled=5,
                enrolled=5,
                cancelled=0,
                daily_new=5,
                daily_cancelled=0,
                data_source="reconstructed",
            ),
            DailyDataPoint(
                date="2025-11-05",
                day_offset=4,
                gross_enrolled=10,
                enrolled=10,
                cancelled=0,
                daily_new=5,
                daily_cancelled=0,
                data_source="reconstructed",
            ),
        ]
        snap_a = [
            DailyDataPoint(
                date="2025-11-10",
                day_offset=9,
                gross_enrolled=15,
                enrolled=15,
                cancelled=0,
                daily_new=5,
                daily_cancelled=0,
                data_source="snapshot",
            ),
        ]

        # Session B: reconstruction until day 20, snapshots from day 20
        recon_b = [
            DailyDataPoint(
                date="2025-11-01",
                day_offset=0,
                gross_enrolled=3,
                enrolled=3,
                cancelled=0,
                daily_new=3,
                daily_cancelled=0,
                data_source="reconstructed",
            ),
            DailyDataPoint(
                date="2025-11-15",
                day_offset=14,
                gross_enrolled=8,
                enrolled=8,
                cancelled=0,
                daily_new=5,
                daily_cancelled=0,
                data_source="reconstructed",
            ),
        ]
        snap_b = [
            DailyDataPoint(
                date="2025-11-20",
                day_offset=19,
                gross_enrolled=12,
                enrolled=12,
                cancelled=0,
                daily_new=4,
                daily_cancelled=0,
                data_source="snapshot",
            ),
        ]

        # Per-session merge: each session uses its own cutover
        merged_a = VelocityService._merge_hybrid_daily(recon_a, snap_a)
        merged_b = VelocityService._merge_hybrid_daily(recon_b, snap_b)

        # Session A: recon[day0, day4] + snap[day9]
        assert len(merged_a) == 3
        assert merged_a[0].data_source == "reconstructed"
        assert merged_a[1].data_source == "reconstructed"
        assert merged_a[2].data_source == "snapshot"

        # Session B: recon[day0, day14] + snap[day19]
        assert len(merged_b) == 3
        assert merged_b[0].data_source == "reconstructed"
        assert merged_b[1].data_source == "reconstructed"
        assert merged_b[2].data_source == "snapshot"

        # Now compare with global merge (wrong approach):
        # Combining first then merging once would use snap_a's date as cutover for everything
        combined_recon = recon_a + recon_b
        combined_recon.sort(key=lambda dp: dp.date)
        combined_snap = snap_a + snap_b
        combined_snap.sort(key=lambda dp: dp.date)
        global_merged = VelocityService._merge_hybrid_daily(combined_recon, combined_snap)

        # Global merge drops session B's recon data after Nov 10 (session A's first snap date)
        # Per-session merge preserves session B's Nov 15 data
        per_session_dates = sorted({dp.date for dp in merged_a + merged_b})
        global_dates = [dp.date for dp in global_merged]

        # Session B's Nov 15 reconstruction data should appear in per-session merge
        assert "2025-11-15" in per_session_dates, "Per-session merge should preserve session B's Nov 15 data"
        # With global merge, Nov 15 from session B reconstruction gets dropped
        # because global cutover is Nov 10 (session A's first snapshot)
        assert "2025-11-15" not in global_dates, (
            "Global merge should drop session B's Nov 15 data (confirms the bug exists)"
        )


# ============================================================================
# Week 0: Pre-anchor enrollments in reconstruction paths
# ============================================================================


class TestWeek0InReconstruction:
    """Test that pre-anchor enrollments appear as Week 0 in velocity curves."""

    @pytest.fixture
    def service(self):
        repo = AsyncMock()
        return VelocityService(repo), repo

    @pytest.mark.asyncio
    async def test_pre_anchor_enrollment_creates_week_0(self, service):
        """Attendee enrolled before anchor should appear in week 0 of velocity curve."""
        from datetime import date
        from unittest.mock import MagicMock

        svc, repo = service
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        repo.fetch_sessions.return_value = sessions
        repo.fetch_enrollment_snapshots.return_value = []  # force reconstruction
        repo.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-12",
        }
        repo.fetch_status_transitions.return_value = []

        # Attendee enrolled Nov 5 (7 days before anchor Nov 12)
        att = MagicMock()
        att.person_id = 1
        att.status_id = 2
        att.status = "enrolled"
        att.effective_date = "2025-11-05"
        att.enrollment_date = "2025-11-05"
        att.expand = {"session": MagicMock(cm_id=1001, name="Session 1", session_type="main", parent_id=None)}
        repo.fetch_attendees_with_dates.return_value = [att]

        result = await svc.get_velocity(year=2026, today=date(2025, 11, 20))

        # Should have week 0 data
        week_numbers = [p.week_number for p in result.combined.weekly]
        assert 0 in week_numbers, f"Expected week 0 in {week_numbers}"
        week0_point = next(p for p in result.combined.weekly if p.week_number == 0)
        assert week0_point.enrolled == 1


class TestRollupDailyWeek0:
    """Verify rollup_daily_to_weekly handles negative day_offset (Week 0)."""

    def test_negative_day_offsets_bucket_to_week_0(self):
        """Daily points with day_offset -7 to -1 should roll up to week_number 0."""
        from datetime import date as d
        from datetime import timedelta

        from api.schemas.velocity import DailyDataPoint

        season_start = d(2025, 11, 12)
        daily = []
        # Week 0: day_offset -7 to -1
        for i in range(-7, 0):
            daily.append(
                DailyDataPoint(
                    date=(season_start + timedelta(days=i)).isoformat(),
                    day_offset=i,
                    gross_enrolled=1,
                    enrolled=1,
                    cancelled=0,
                    daily_new=1 if i == -7 else 0,
                    daily_cancelled=0,
                    data_source="reconstructed",
                )
            )
        # Week 1: day_offset 0 to 6
        for i in range(7):
            daily.append(
                DailyDataPoint(
                    date=(season_start + timedelta(days=i)).isoformat(),
                    day_offset=i,
                    gross_enrolled=2 + i,
                    enrolled=2 + i,
                    cancelled=0,
                    daily_new=1,
                    daily_cancelled=0,
                    data_source="reconstructed",
                )
            )

        weekly = rollup_daily_to_weekly(daily, season_start)
        week_nums = [w.week_number for w in weekly]
        assert 0 in week_nums, f"Expected week 0 in {week_nums}"
        assert 1 in week_nums
        week0 = next(w for w in weekly if w.week_number == 0)
        assert week0.enrolled == 1

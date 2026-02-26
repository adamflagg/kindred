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

from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import AsyncMock, Mock

import pytest

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.schemas.velocity import VelocityCurve, VelocityResponse, WeeklyDataPoint
from api.services.velocity_service import (
    SEASON_WEEKS,
    VelocityService,
    _compute_season_start,
    _season_end,
    _week_number,
    _week_start,
)

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
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.id = f"pb_{cm_id}"
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.parent_id = parent_id
    return session


def create_mock_snapshot(
    snapshot_date: str,
    session_cm_id: int,
    year: int,
    enrolled: int,
    waitlisted: int = 0,
    cancelled: int = 0,
) -> Mock:
    """Create a mock enrollment snapshot record."""
    snap = Mock()
    snap.snapshot_date = snapshot_date
    snap.session_cm_id = session_cm_id
    snap.year = year
    snap.enrolled_count = enrolled
    snap.waitlisted_count = waitlisted
    snap.cancelled_count = cancelled
    return snap


def create_mock_attendee_with_date(
    person_id: int,
    session_cm_id: int,
    enrollment_date: str,
    year: int = 2026,
    status: str = "enrolled",
    gender: str | None = None,
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
    att.is_active = 1 if status == "enrolled" else 0
    att.status_id = 2 if status == "enrolled" else 0
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
        assert w1.waitlisted == 0

        # Second week
        w2 = result.combined.weekly[1]
        assert w2.enrolled == 25
        assert w2.waitlisted == 2

        # Third week
        w3 = result.combined.weekly[2]
        assert w3.enrolled == 40
        assert w3.waitlisted == 5

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
        assert result.combined.weekly[0].waitlisted == 3  # 1 + 2
        assert result.combined.weekly[1].enrolled == 55  # 30 + 25
        assert result.combined.weekly[1].waitlisted == 4  # 1 + 3

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
        result = _compute_season_start("2025-11-12", 2026)
        assert result == datetime(2025, 11, 12)

    def test_season_start_returns_exact_date(self):
        """_compute_season_start should return the exact priority_reg_date."""
        result = _compute_season_start("2025-12-03", 2026)
        assert result == datetime(2025, 12, 3)

    def test_season_start_none_when_no_config(self):
        """_compute_season_start with no priority_reg should return None."""
        result = _compute_season_start(None, 2026)
        assert result is None

    def test_season_start_none_when_empty_string(self):
        """_compute_season_start with empty string should return None."""
        result = _compute_season_start("", 2026)
        assert result is None

    def test_season_start_none_for_any_year(self):
        """_compute_season_start with None returns None regardless of year."""
        assert _compute_season_start(None, 2025) is None
        assert _compute_season_start(None, 2024) is None

    def test_week_number_at_priority_reg_date(self):
        """Priority reg date itself should be week 0."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        assert _week_number(priority_reg, priority_reg) == 0

    def test_week_number_day_6_still_week_0(self):
        """Day 6 after priority_reg is still week 0."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        day6 = datetime(2025, 12, 9)  # Tuesday (6 days later)
        assert _week_number(day6, priority_reg) == 0

    def test_week_number_day_7_is_week_1(self):
        """Day 7 after priority_reg is week 1."""
        priority_reg = datetime(2025, 12, 3)  # Wednesday
        day7 = datetime(2025, 12, 10)  # Wednesday (7 days later)
        assert _week_number(day7, priority_reg) == 1

    def test_week_number_mid_season(self):
        """January data should be correct weeks from priority_reg_date."""
        priority_reg = datetime(2025, 12, 3)
        jan_5 = datetime(2026, 1, 5)
        # Days from Dec 3 to Jan 5 = 33 days, 33//7 = 4
        assert _week_number(jan_5, priority_reg) == 4

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
    async def test_reconstruction_before_season_start_excluded(self, service, mock_repository):
        """Reconstruction from enrollment dates before season start should be excluded."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            # Before season window
            create_mock_attendee_with_date(101, 1001, "2025-09-15"),
            # Inside season window
            create_mock_attendee_with_date(102, 1001, "2025-11-10"),
            create_mock_attendee_with_date(103, 1001, "2025-12-01"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) >= 1
        for p in points:
            assert p.week_start >= "2025-11-01"

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
            assert p.week_number >= 0

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
        # week_number = (Jan 7 - Nov 1).days // 7 = 67 // 7 = 9
        # (no Monday snapping — anchored directly to priority_reg_date)
        assert marker.week_number == 9


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
        """When using reconstruction, cancelled_to_date should count status transitions."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-03"),
            create_mock_attendee_with_date(102, 1001, "2026-01-04"),
            create_mock_attendee_with_date(103, 1001, "2026-01-10"),
        ]
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(102, 1001, "2026-01-12"),
            create_mock_status_transition(103, 1001, "2026-01-15"),
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
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
        )
        assert point.gross_enrolled == 0

    def test_weekly_data_point_has_weekly_new(self):
        """WeeklyDataPoint should accept weekly_new with default 0."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
        )
        assert point.weekly_new == 0

    def test_weekly_data_point_has_weekly_cancelled(self):
        """WeeklyDataPoint should accept weekly_cancelled with default 0."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
            gross_enrolled=0,
            weekly_new=0,
            weekly_cancelled=0,
        )
        assert point.weekly_cancelled == 0

    def test_weekly_data_point_explicit_new_fields(self):
        """WeeklyDataPoint should accept explicit values for new fields."""

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=45,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
            gross_enrolled=50,
            weekly_new=8,
            weekly_cancelled=3,
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
            warnings=["Year 2026 has no priority registration date configured"],
        )
        assert len(response.warnings) == 1
        assert "no priority registration date" in response.warnings[0]


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
        assert "Year 2026 has no priority registration date configured" in result.warnings[0]

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
        assert any("2025" in w and "no priority registration date" in w for w in result.warnings)


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
        """Reconstruction should populate gross_enrolled and net enrolled separately."""
        mock_repository.fetch_sessions.return_value = {1001: sample_sessions[1001]}
        mock_repository.fetch_enrollment_snapshots.return_value = []
        # 10 enrollments in week 1, 5 in week 2
        mock_repository.fetch_attendees_with_dates.return_value = [
            *[create_mock_attendee_with_date(100 + i, 1001, "2026-01-03") for i in range(10)],
            *[create_mock_attendee_with_date(200 + i, 1001, "2026-01-10") for i in range(5)],
        ]
        # 3 cancellations in week 1, 1 in week 2
        mock_repository.fetch_status_transitions.return_value = [
            create_mock_status_transition(101, 1001, "2026-01-04"),
            create_mock_status_transition(102, 1001, "2026-01-05"),
            create_mock_status_transition(103, 1001, "2026-01-06"),
            create_mock_status_transition(201, 1001, "2026-01-12"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.weekly
        assert len(points) == 2
        # Week 1: gross=10, cancelled=3, net=7
        assert points[0].gross_enrolled == 10
        assert points[0].enrolled == 7
        assert points[0].weekly_new == 10
        assert points[0].weekly_cancelled == 3
        # Week 2: gross=15, cancelled=4, net=11
        assert points[1].gross_enrolled == 15
        assert points[1].enrolled == 11
        assert points[1].weekly_new == 5
        assert points[1].weekly_cancelled == 1


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

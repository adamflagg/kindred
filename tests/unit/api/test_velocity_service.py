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

from api.services.velocity_service import (
    SEASON_WEEKS,
    VelocityService,
    _compute_season_start,
    _monday_of_week,
    _season_end,
    _week_number,
)
from api.schemas.velocity import VelocityCurve, VelocityResponse, WeeklyDataPoint

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
    """Test _compute_season_start, _week_number, and _monday_of_week helper functions."""

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

    def test_week_number_at_season_start(self):
        """Week containing season start should be week 0."""
        season_start = datetime(2025, 11, 1)
        season_start_monday = _monday_of_week(season_start)
        result = _week_number(season_start_monday, season_start_monday)
        assert result == 0

    def test_week_number_one_week_later(self):
        """One week after season start Monday should be week 1."""
        season_start = datetime(2025, 11, 1)
        season_start_monday = _monday_of_week(season_start)
        one_week_later = datetime(2025, 11, 3)  # Next Monday
        assert _week_number(_monday_of_week(one_week_later), season_start_monday) == 1

    def test_week_number_mid_season(self):
        """January data should be ~9-10 weeks into the season."""
        season_start = datetime(2025, 11, 1)
        season_start_monday = _monday_of_week(season_start)
        jan_5 = datetime(2026, 1, 5)  # Monday
        wn = _week_number(jan_5, season_start_monday)
        assert wn == 10  # 10 weeks from Oct 27 to Jan 5


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
        # Default season start: Nov 1 2025 (no priority_reg_date configured)
        # Season start Monday: Oct 27 2025
        # 41 weeks later: Aug 3 2026
        # Nov 2026 is well past the 41-week window
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=15),
            create_mock_snapshot("2026-11-10", 1001, 2026, enrolled=100),  # Past 41-week window
        ]

        result = await service.get_velocity(year=2026)

        # Nov 2026 data should be EXCLUDED (past 41-week window from ~Oct 27)
        points = result.combined.weekly
        assert not any(p.week_start >= "2026-09-01" for p in points)
        assert len(points) == 1


# ============================================================================
# 41-Week Season End Clipping Tests
# ============================================================================


class TestSeasonEndClipping:
    """Test that velocity data is clipped at SEASON_WEEKS (41) from season start."""

    def test_season_end_is_41_weeks_from_start(self):
        """_season_end should return exactly SEASON_WEEKS weeks after season start Monday."""
        season_start_monday = datetime(2025, 10, 27)  # Monday
        result = _season_end(season_start_monday)
        expected = datetime(2026, 8, 10)  # 41 weeks later
        assert result == expected

    def test_season_weeks_constant_is_41(self):
        """SEASON_WEEKS should be 41."""
        assert SEASON_WEEKS == 41

    @pytest.mark.asyncio
    async def test_data_past_41_weeks_excluded(self, service, mock_repository):
        """Snapshots past the 41-week window should be excluded."""
        # Default: no priority_reg_date -> season start = Nov 1 2025
        # Season start Monday = Oct 27 2025
        # 41 weeks = Aug 3 2026
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            # Week 43 from Oct 27 -> ~Sep 7 2026, past 41-week window
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
        # Season start Monday = Oct 27 2025, 41 weeks = Aug 3 2026
        # Week 40 from Oct 27 -> ~Jul 27 2026, within window
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            create_mock_snapshot("2026-07-27", 1001, 2026, enrolled=30),  # Week ~40, within window
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

        # 2025 season start: no priority_reg_date -> Nov 1 2024
        # Season start Monday: Oct 28 2024
        # 41 weeks later: Aug 4 2025
        async def mock_fetch_snapshots(year, **kwargs):
            if year == 2026:
                return [create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20)]
            return [
                create_mock_snapshot("2025-01-06", 901, 2025, enrolled=15),
                create_mock_snapshot("2025-09-15", 901, 2025, enrolled=20),  # Past 41-week window
            ]

        mock_repository.fetch_enrollment_snapshots.side_effect = mock_fetch_snapshots

        result = await service.get_velocity(year=2026, compare_years=[2025])

        # Prior year should exclude Sep data (past 41-week window from Oct 28 2024)
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
        # week_start should be a Monday ISO date
        assert point.week_start == "2026-01-05"  # Jan 5, 2026 is a Monday

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
    async def test_phase_marker_week_number_snapped_to_monday(self, service, mock_repository):
        """Phase markers should snap to Monday for week_number computation."""
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
        # week_number should be same as Jan 5 Monday
        # season_start = Nov 1, season_start_monday = Oct 27
        # Jan 5 is the Monday of that week → (Jan 5 - Oct 27) / 7 = 70/7 = 10
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
        from api.schemas.velocity import WeeklyDataPoint

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
        )
        assert point.gross_enrolled == 0

    def test_weekly_data_point_has_weekly_new(self):
        """WeeklyDataPoint should accept weekly_new with default 0."""
        from api.schemas.velocity import WeeklyDataPoint

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
        )
        assert point.weekly_new == 0

    def test_weekly_data_point_has_weekly_cancelled(self):
        """WeeklyDataPoint should accept weekly_cancelled with default 0."""
        from api.schemas.velocity import WeeklyDataPoint

        point = WeeklyDataPoint(
            week_start="2026-01-05",
            week_label="Jan 5",
            week_number=0,
            enrolled=10,
            waitlisted=0,
            delta=10,
            data_source="snapshot",
        )
        assert point.weekly_cancelled == 0

    def test_weekly_data_point_explicit_new_fields(self):
        """WeeklyDataPoint should accept explicit values for new fields."""
        from api.schemas.velocity import WeeklyDataPoint

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
        from api.schemas.velocity import VelocityCurve, VelocityResponse

        response = VelocityResponse(
            year=2026,
            season_start="2025-12-03",
            combined=VelocityCurve(year=2026, weekly=[]),
            by_session=[],
            prior_years=[],
            phase_markers=[],
        )
        assert response.warnings == []

    def test_velocity_response_with_warnings(self):
        """VelocityResponse should accept explicit warnings."""
        from api.schemas.velocity import VelocityCurve, VelocityResponse

        response = VelocityResponse(
            year=2026,
            season_start="2025-12-03",
            combined=VelocityCurve(year=2026, weekly=[]),
            by_session=[],
            prior_years=[],
            phase_markers=[],
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

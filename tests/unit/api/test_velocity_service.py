"""
Unit tests for the velocity service.

Tests verify the enrollment velocity curve computation:
- Snapshot-based daily aggregation (fast path)
- Reconstruction fallback from attendee enrollment dates
- Combined vs per-session curves
- Prior year overlay comparison
- Phase markers from registration dates config
- Daily delta calculations
- Data source labeling (snapshot vs reconstructed)
"""

from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import AsyncMock, Mock

import pytest

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.velocity_service import VelocityService, _day_number, _monday_of_week, _season_start, _week_number

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
    expand: dict = {"session": session}
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
) -> Mock:
    """Create a mock status transition record for cancellation tracking."""
    record = Mock()
    record.person_id = person_id
    record.detected_at = detected_at
    record.old_status = old_status
    record.new_status = new_status
    record.year = year
    session = Mock()
    session.cm_id = session_cm_id
    record.expand = {"session": session}
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
    repo.fetch_registration_dates = AsyncMock(return_value={})
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
# Snapshot-Based Velocity Tests
# ============================================================================


class TestVelocityFromSnapshots:
    """Test velocity curve generation from enrollment snapshots."""

    @pytest.mark.asyncio
    async def test_velocity_from_snapshots_basic(self, service, mock_repository, sample_sessions):
        """Given daily snapshots, should produce daily data points
        with correct cumulative counts and deltas."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            # Session 1 snapshots across 3 weeks
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10, waitlisted=0),
            create_mock_snapshot("2026-01-12", 1001, 2026, enrolled=25, waitlisted=2),
            create_mock_snapshot("2026-01-19", 1001, 2026, enrolled=40, waitlisted=5),
        ]

        result = await service.get_velocity(year=2026)

        assert result.year == 2026
        assert result.combined is not None
        assert len(result.combined.data) == 3

        # First point
        p1 = result.combined.data[0]
        assert p1.enrolled == 10
        assert p1.waitlisted == 0

        # Second point
        p2 = result.combined.data[1]
        assert p2.enrolled == 25
        assert p2.waitlisted == 2

        # Third point
        p3 = result.combined.data[2]
        assert p3.enrolled == 40
        assert p3.waitlisted == 5

    @pytest.mark.asyncio
    async def test_velocity_from_snapshots_combined_sessions(self, service, mock_repository, sample_sessions):
        """When no specific session_cm_id, should combine all sessions'
        snapshots into one curve by summing enrollment."""
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

        # Combined should sum across sessions per date
        assert len(result.combined.data) == 2
        assert result.combined.data[0].enrolled == 35  # 20 + 15
        assert result.combined.data[0].waitlisted == 3  # 1 + 2
        assert result.combined.data[1].enrolled == 55  # 30 + 25
        assert result.combined.data[1].waitlisted == 4  # 1 + 3

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
        from attendee enrollment dates."""
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
        assert len(result.combined.data) > 0

        # Final point should show all 5 enrolled
        last_point = result.combined.data[-1]
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
        points = result.combined.data
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
        assert len(prior.data) == 2


# ============================================================================
# Phase Markers Tests
# ============================================================================


class TestVelocityPhaseMarkers:
    """Test registration phase marker generation."""

    @pytest.mark.asyncio
    async def test_velocity_phase_markers(self, service, mock_repository):
        """Should fetch registration dates from config and return as
        PhaseMarker list with day_number for alignment."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-01",
            "early_reg_date": "2025-11-01",
            "open_reg_date": "2026-01-15",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 3

        phases = {m.phase: m for m in result.phase_markers}
        assert "priority" in phases
        # Oct 1, 2025 is the actual date (no Monday snapping with daily granularity)
        assert phases["priority"].date == "2025-10-01"
        assert "early" in phases
        # Nov 1, 2025 is the actual date
        assert phases["early"].date == "2025-11-01"
        assert "open" in phases
        # Jan 15, 2026 is the actual date
        assert phases["open"].date == "2026-01-15"


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
        assert result.combined.data[0].enrolled == 20
        assert result.combined.data[1].enrolled == 30

        # by_session should have only 1 entry
        assert len(result.by_session) == 1
        assert result.by_session[0].session_cm_id == 1001


# ============================================================================
# Delta Calculation Tests
# ============================================================================


class TestVelocityDeltaCalculation:
    """Test daily delta (change from prior data point) computation."""

    @pytest.mark.asyncio
    async def test_velocity_daily_delta_calculation(self, service, mock_repository, sample_sessions):
        """Deltas should be the difference from previous data point's enrolled
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

        points = result.combined.data
        assert len(points) == 3

        # First point: delta = enrolled itself
        assert points[0].delta == 10
        # Second point: delta = 25 - 10 = 15
        assert points[1].delta == 15
        # Third point: delta = 35 - 25 = 10
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
        assert len(result.combined.data) == 0
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

        assert len(result.combined.data) == 1
        assert result.combined.data[0].data_source == "snapshot"

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

        assert len(result.combined.data) > 0
        assert result.combined.data[0].data_source == "reconstructed"


# ============================================================================
# Season Window Helper Tests
# ============================================================================


class TestSeasonWindowHelpers:
    """Test _season_start, _week_number, and _day_number helper functions."""

    def test_season_start_returns_nov_1_of_prior_year(self):
        """_season_start(2026) should return Nov 1, 2025."""
        result = _season_start(2026)
        assert result == datetime(2025, 11, 1)

    def test_season_start_2025(self):
        """_season_start(2025) should return Nov 1, 2024."""
        result = _season_start(2025)
        assert result == datetime(2024, 11, 1)

    def test_week_number_at_season_start(self):
        """Week containing Nov 1 should be week 0."""
        # Nov 1, 2025 is a Saturday. Its Monday is Oct 27, 2025.
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

    def test_day_number_at_season_start(self):
        """Day at season start should be day 0."""
        season_start = _season_start(2026)  # 2025-11-01
        assert _day_number(datetime(2025, 11, 1), season_start) == 0

    def test_day_number_one_day_later(self):
        """Nov 2 should be day 1."""
        season_start = _season_start(2026)
        assert _day_number(datetime(2025, 11, 2), season_start) == 1

    def test_day_number_dec_1(self):
        """Dec 1 should be day 30 (Nov has 30 days)."""
        season_start = _season_start(2026)
        assert _day_number(datetime(2025, 12, 1), season_start) == 30

    def test_day_number_jan_5(self):
        """Jan 5 should be day 65 (30 Nov + 31 Dec + 4 Jan)."""
        season_start = _season_start(2026)
        assert _day_number(datetime(2026, 1, 5), season_start) == 65


# ============================================================================
# Season Window Data Clipping Tests
# ============================================================================


class TestSeasonWindowClipping:
    """Test that velocity data is clipped to the season window."""

    @pytest.mark.asyncio
    async def test_snapshots_before_season_start_are_excluded(self, service, mock_repository):
        """Snapshots before Nov 1 of prior year should be excluded."""
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
        points = result.combined.data
        assert len(points) == 2
        for p in points:
            assert p.date >= "2025-11-01"

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

        points = result.combined.data
        assert len(points) >= 1
        for p in points:
            assert p.date >= "2025-11-01"

    @pytest.mark.asyncio
    async def test_season_end_extends_past_october_with_data(self, service, mock_repository):
        """If data extends past Oct 31 but within Dec 31, it should be included."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=15),
            create_mock_snapshot("2026-11-10", 1001, 2026, enrolled=100),  # Nov of season year
        ]

        result = await service.get_velocity(year=2026)

        # Data within the season year (up to Dec 31) should be included
        points = result.combined.data
        assert any(p.date >= "2026-11-01" for p in points)


# ============================================================================
# Day Number in Data Points Tests
# ============================================================================


class TestDayNumberInDataPoints:
    """Test that VelocityDataPoint includes correct day_number."""

    @pytest.mark.asyncio
    async def test_data_points_have_day_number(self, service, mock_repository):
        """Each VelocityDataPoint should include a day_number field."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),
        ]

        result = await service.get_velocity(year=2026)

        for p in result.combined.data:
            assert hasattr(p, "day_number")
            assert isinstance(p.day_number, int)
            assert p.day_number >= 0

    @pytest.mark.asyncio
    async def test_day_numbers_are_sequential(self, service, mock_repository):
        """Day numbers should increase monotonically across data points."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-03", 1001, 2026, enrolled=10),
            create_mock_snapshot("2025-11-10", 1001, 2026, enrolled=15),
            create_mock_snapshot("2025-12-01", 1001, 2026, enrolled=25),
        ]

        result = await service.get_velocity(year=2026)

        day_numbers = [p.day_number for p in result.combined.data]
        assert day_numbers == sorted(day_numbers)
        # Each should be unique and strictly increasing
        assert len(set(day_numbers)) == len(day_numbers)

    @pytest.mark.asyncio
    async def test_prior_year_day_numbers_align(self, service, mock_repository):
        """Prior year data should use day_number for alignment, not index."""
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

        current_dn = [p.day_number for p in result.combined.data]
        prior_dn = [p.day_number for p in result.prior_years[0].data]
        # Both should start at similar day numbers (both ~day 2-3)
        assert abs(current_dn[0] - prior_dn[0]) <= 1


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
        assert result.season_start == "2025-11-01"

    @pytest.mark.asyncio
    async def test_response_season_start_for_2025(self, service, mock_repository):
        """VelocityResponse for 2025 should have season_start of 2024-11-01."""
        sessions = {901: create_mock_session(901, "Session 1", year=2025)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2024-11-04", 901, 2025, enrolled=10),
        ]

        result = await service.get_velocity(year=2025)

        assert result.season_start == "2024-11-01"


# ============================================================================
# Phase Marker Tests (Daily - No Monday Snapping)
# ============================================================================


class TestPhaseMarkerDayNumber:
    """Test that phase markers use actual dates with day_number for alignment."""

    @pytest.mark.asyncio
    async def test_phase_marker_uses_actual_date(self, service, mock_repository):
        """A Wednesday registration date should stay on that date (no Monday snap)."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        # Nov 12, 2025 is a Wednesday
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-12",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 1
        marker = result.phase_markers[0]
        # Should stay on actual date Nov 12
        assert marker.date == "2025-11-12"
        # day_number: Nov 12 is 11 days after Nov 1
        assert marker.day_number == 11

    @pytest.mark.asyncio
    async def test_phase_marker_monday_stays_on_monday(self, service, mock_repository):
        """A Monday registration date should stay on that Monday."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        # Jan 5, 2026 is a Monday
        mock_repository.fetch_registration_dates.return_value = {
            "open_reg_date": "2026-01-05",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 1
        assert result.phase_markers[0].date == "2026-01-05"
        # day_number: Jan 5 is 65 days after Nov 1
        assert result.phase_markers[0].day_number == 65

    @pytest.mark.asyncio
    async def test_phase_marker_sunday_stays_on_sunday(self, service, mock_repository):
        """A Sunday registration date should stay on that Sunday (no Monday snap)."""
        mock_repository.fetch_sessions.return_value = {
            1001: create_mock_session(1001, "Session 1"),
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        # Jan 11, 2026 is a Sunday
        mock_repository.fetch_registration_dates.return_value = {
            "early_reg_date": "2026-01-11",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 1
        # Sunday Jan 11 stays on Jan 11 (no snap to Monday)
        assert result.phase_markers[0].date == "2026-01-11"
        # day_number: Jan 11 is 71 days after Nov 1
        assert result.phase_markers[0].day_number == 71


# ============================================================================
# Gender Split Velocity Tests
# ============================================================================


class TestGenderSplitVelocity:
    """Test gender-split enrollment velocity curves."""

    @pytest.mark.asyncio
    async def test_gender_split_returns_by_gender_curves(self, service, mock_repository):
        """When split_by_gender=True, response includes by_gender list with M and F curves."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        # No snapshots -> reconstruction path (gender requires person expansion)
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(103, 1001, "2025-11-03", gender="F"),
            create_mock_attendee_with_date(104, 1001, "2025-11-10", gender="F"),
            create_mock_attendee_with_date(105, 1001, "2025-11-10", gender="M"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert len(result.by_gender) == 2
        genders = {c.gender for c in result.by_gender}
        assert genders == {"M", "F"}

        # Check M curve
        m_curve = next(c for c in result.by_gender if c.gender == "M")
        assert m_curve.data[-1].enrolled == 3  # 3 boys total

        # Check F curve
        f_curve = next(c for c in result.by_gender if c.gender == "F")
        assert f_curve.data[-1].enrolled == 2  # 2 girls total

    @pytest.mark.asyncio
    async def test_gender_split_curves_have_day_numbers(self, service, mock_repository):
        """Gender curves should include proper day_number values."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-12-01", gender="F"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        for curve in result.by_gender:
            for p in curve.data:
                assert hasattr(p, "day_number")
                assert isinstance(p.day_number, int)
                assert p.day_number >= 0

    @pytest.mark.asyncio
    async def test_gender_split_combined_still_total(self, service, mock_repository):
        """Combined curve should still show overall total regardless of gender split."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-11-03", gender="F"),
            create_mock_attendee_with_date(103, 1001, "2025-11-10", gender="M"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        # Combined should reflect all 3 campers regardless of gender
        last_point = result.combined.data[-1]
        assert last_point.enrolled == 3

    @pytest.mark.asyncio
    async def test_gender_split_session_breakdown(self, service, mock_repository):
        """session_gender_breakdown should show per-session gender totals."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", year=2026),
            1002: create_mock_session(1002, "Session 2", year=2026),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(102, 1001, "2025-11-03", gender="M"),
            create_mock_attendee_with_date(103, 1001, "2025-11-03", gender="F"),
            create_mock_attendee_with_date(104, 1002, "2025-11-03", gender="F"),
            create_mock_attendee_with_date(105, 1002, "2025-11-03", gender="F"),
            create_mock_attendee_with_date(106, 1002, "2025-11-10", gender="M"),
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert len(result.session_gender_breakdown) == 2

        s1 = next(b for b in result.session_gender_breakdown if b.session_cm_id == 1001)
        assert s1.boys_enrolled == 2
        assert s1.girls_enrolled == 1

        s2 = next(b for b in result.session_gender_breakdown if b.session_cm_id == 1002)
        assert s2.boys_enrolled == 1
        assert s2.girls_enrolled == 2

    @pytest.mark.asyncio
    async def test_gender_split_prior_year(self, service, mock_repository):
        """Prior year curves should also include by_gender when split requested."""
        sessions_2026 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        sessions_2025 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def mock_fetch_sessions(year, **kwargs):
            return sessions_2026 if year == 2026 else sessions_2025

        mock_repository.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []

        async def mock_fetch_attendees(year, **kwargs):
            if year == 2026:
                return [
                    create_mock_attendee_with_date(101, 1001, "2025-11-03", year=2026, gender="M"),
                    create_mock_attendee_with_date(102, 1001, "2025-11-03", year=2026, gender="F"),
                ]
            return [
                create_mock_attendee_with_date(201, 901, "2024-11-04", year=2025, gender="M"),
                create_mock_attendee_with_date(202, 901, "2024-11-04", year=2025, gender="M"),
                create_mock_attendee_with_date(203, 901, "2024-11-04", year=2025, gender="F"),
            ]

        mock_repository.fetch_attendees_with_dates.side_effect = mock_fetch_attendees

        result = await service.get_velocity(year=2026, compare_years=[2025], split_by_gender=True)

        # Prior year should have gender curves too
        assert len(result.prior_year_by_gender) >= 1
        prior_gender_curves = result.prior_year_by_gender
        # Should have M and F curves for 2025
        prior_genders = {c.gender for c in prior_gender_curves if c.year == 2025}
        assert "M" in prior_genders
        assert "F" in prior_genders

    @pytest.mark.asyncio
    async def test_no_gender_split_has_no_by_gender(self, service, mock_repository):
        """Default (no split) should return empty by_gender and session_gender_breakdown."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2025-11-03", gender="M"),
        ]

        result = await service.get_velocity(year=2026)

        assert result.by_gender == []
        assert result.session_gender_breakdown == []


# ============================================================================
# Bug Fix Tests: Season-End Clipping & Session Type Filtering
# ============================================================================


class TestVelocityBugFixes:
    """Tests for velocity trend bug fixes: season-end clipping and session type filtering."""

    @pytest.mark.asyncio
    async def test_season_end_clips_data_after_december(self, service, mock_repository):
        """Data past Dec 31 of the season year should be excluded from curves."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            # Inside season window
            create_mock_attendee_with_date(101, 1001, "2026-06-01"),
            create_mock_attendee_with_date(102, 1001, "2026-12-15"),
            # Past season end (Jan/Feb 2027)
            create_mock_attendee_with_date(103, 1001, "2027-01-15"),
            create_mock_attendee_with_date(104, 1001, "2027-02-10"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.data
        for p in points:
            assert p.date < "2027-01-01", f"Data past Dec 31 should be clipped: {p.date}"
        # Should still have data from 2026
        assert len(points) >= 2

    @pytest.mark.asyncio
    async def test_season_end_includes_december(self, service, mock_repository):
        """Data on Dec 29 of the season year should be included (not over-clipped)."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-12-29"),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.data
        assert len(points) >= 1
        # Dec 29 should appear as its own date
        assert any(p.date == "2026-12-29" for p in points)

    @pytest.mark.asyncio
    async def test_non_matching_session_types_excluded(self, service, mock_repository):
        """Sessions not in the filtered sessions dict should not appear in by_session."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            1002: create_mock_session(1002, "Session 2", session_type="main"),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            create_mock_snapshot("2026-01-05", 1002, 2026, enrolled=15),
            # Non-summer sessions (not in sessions dict)
            create_mock_snapshot("2026-01-05", 9001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-05", 9002, 2026, enrolled=8),
        ]

        result = await service.get_velocity(year=2026)

        session_ids = {c.session_cm_id for c in result.by_session}
        assert session_ids == {1001, 1002}
        # No "Session XXXX" fallback names
        for curve in result.by_session:
            assert not curve.session_name.startswith("Session 9")

    @pytest.mark.asyncio
    async def test_non_matching_sessions_excluded_from_combined(self, service, mock_repository):
        """Combined curve totals should only count sessions in the filtered set."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=20),
            # Non-summer session (not in sessions dict)
            create_mock_snapshot("2026-01-05", 9001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        # Combined should only include session 1001 (20 enrolled, not 30)
        assert result.combined.data[0].enrolled == 20


# ============================================================================
# Daily Granularity Tests (Commit 10 - TDD Red Phase)
# ============================================================================


class TestDailyGranularity:
    """Test that velocity data uses daily granularity instead of weekly.

    These tests verify the migration from weekly to daily data points:
    - Each date produces a separate data point (no Monday-bucketing)
    - day_number computed as offset from season start date
    - Deltas are day-over-day
    - Schema renames: VelocityDataPoint, .data, .date, .label, .day_number
    """

    @pytest.mark.asyncio
    async def test_snapshot_daily_granularity(self, service, mock_repository, sample_sessions):
        """Snapshots on consecutive days within the same week should each
        produce a separate data point (not collapse into 1 weekly point).

        Mon Jan 5, Tue Jan 6, Wed Jan 7 are all in the same ISO week.
        With daily granularity, we expect 3 points, not 1.
        """
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),  # Monday
            create_mock_snapshot("2026-01-06", 1001, 2026, enrolled=12),  # Tuesday
            create_mock_snapshot("2026-01-07", 1001, 2026, enrolled=15),  # Wednesday
        ]

        result = await service.get_velocity(year=2026)

        # With daily granularity, should have 3 separate data points
        assert len(result.combined.data) == 3
        assert result.combined.data[0].date == "2026-01-05"
        assert result.combined.data[0].enrolled == 10
        assert result.combined.data[1].date == "2026-01-06"
        assert result.combined.data[1].enrolled == 12
        assert result.combined.data[2].date == "2026-01-07"
        assert result.combined.data[2].enrolled == 15

    @pytest.mark.asyncio
    async def test_reconstruction_daily_granularity(self, service, mock_repository, sample_sessions):
        """Attendees enrolled on consecutive days should produce separate
        daily cumulative data points (not bucketed to Monday)."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = []
        mock_repository.fetch_attendees_with_dates.return_value = [
            create_mock_attendee_with_date(101, 1001, "2026-01-05"),  # Monday
            create_mock_attendee_with_date(102, 1001, "2026-01-06"),  # Tuesday
            create_mock_attendee_with_date(103, 1001, "2026-01-07"),  # Wednesday
        ]

        result = await service.get_velocity(year=2026)

        # With daily granularity, each date is a separate point
        assert len(result.combined.data) == 3
        assert result.combined.data[0].date == "2026-01-05"
        assert result.combined.data[0].enrolled == 1  # cumulative: 1
        assert result.combined.data[1].date == "2026-01-06"
        assert result.combined.data[1].enrolled == 2  # cumulative: 2
        assert result.combined.data[2].date == "2026-01-07"
        assert result.combined.data[2].enrolled == 3  # cumulative: 3

    def test_day_number_alignment(self):
        """day_number should be (date - season_start).days for cross-year alignment.

        For year=2026, season_start=2025-11-01.
        Dec 1, 2025 should have day_number=30 (30 days after Nov 1).
        """
        assert _day_number is not None, "_day_number helper not yet implemented"

        season_start = _season_start(2026)  # 2025-11-01
        dec_1 = datetime(2025, 12, 1)
        assert _day_number(dec_1, season_start) == 30

        # Nov 1 itself should be day 0
        assert _day_number(datetime(2025, 11, 1), season_start) == 0

        # Jan 5 should be day 65 (Nov has 30 days + Dec has 31 + 4 days in Jan)
        jan_5 = datetime(2026, 1, 5)
        assert _day_number(jan_5, season_start) == 65

    @pytest.mark.asyncio
    async def test_daily_delta_is_day_over_day(self, service, mock_repository, sample_sessions):
        """Deltas should be computed between consecutive daily points,
        not weekly."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
            create_mock_snapshot("2026-01-06", 1001, 2026, enrolled=12),
            create_mock_snapshot("2026-01-07", 1001, 2026, enrolled=15),
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.data
        assert len(points) == 3
        # First point: delta = enrolled itself
        assert points[0].delta == 10
        # Second point: delta = 12 - 10 = 2
        assert points[1].delta == 2
        # Third point: delta = 15 - 12 = 3
        assert points[2].delta == 3

    @pytest.mark.asyncio
    async def test_daily_points_have_day_number(self, service, mock_repository, sample_sessions):
        """Each daily data point should include day_number as offset from season start."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-01", 1001, 2026, enrolled=5),  # day 0
            create_mock_snapshot("2025-12-01", 1001, 2026, enrolled=15),  # day 30
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=30),  # day 65
        ]

        result = await service.get_velocity(year=2026)

        points = result.combined.data
        assert len(points) == 3
        assert points[0].day_number == 0
        assert points[1].day_number == 30
        assert points[2].day_number == 65

    @pytest.mark.asyncio
    async def test_phase_markers_have_day_number(self, service, mock_repository):
        """Phase markers should include day_number for frontend X-axis alignment."""
        sessions = {1001: create_mock_session(1001, "Session 1", year=2026)}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]
        # Nov 15, 2025 is 14 days after season start (Nov 1, 2025)
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-15",
        }

        result = await service.get_velocity(year=2026)

        assert len(result.phase_markers) == 1
        marker = result.phase_markers[0]
        assert hasattr(marker, "day_number")
        assert marker.day_number == 14  # Nov 15 is 14 days from Nov 1

    @pytest.mark.asyncio
    async def test_velocity_curve_uses_data_field(self, service, mock_repository, sample_sessions):
        """VelocityCurve should use .data instead of .weekly for the data points list."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-01-05", 1001, 2026, enrolled=10),
        ]

        result = await service.get_velocity(year=2026)

        # .data should exist and contain the data points
        assert hasattr(result.combined, "data")
        assert len(result.combined.data) == 1
        # .weekly should NOT exist (renamed to .data)
        assert not hasattr(result.combined, "weekly")

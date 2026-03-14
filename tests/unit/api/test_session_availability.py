"""
Unit tests for the session availability service.

Tests verify the availability matrix computation:
- Per-session, per-gender enrollment counting
- Capacity calculation from bunk_plans (boys/girls/AG split)
- Status logic: open / limited / waitlist
- AG sessions handled separately
- Config-based grade eligibility and capacity overrides
"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.session_availability_service import SessionAvailabilityService

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
    session.sort_order = 0
    return session


def create_mock_attendee(
    person_id: int,
    session_cm_id: int,
    gender: str = "M",
    year: int = 2026,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
) -> Mock:
    """Create a mock attendee with person and session expand."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active

    # Person expand
    person = Mock()
    person.gender = gender
    person.cm_id = person_id

    # Session expand
    session = Mock()
    session.cm_id = session_cm_id

    attendee.expand = {"person": person, "session": session}
    return attendee


def create_mock_bunk_plan(
    session_pb_id: str,
    bunk_gender: str = "M",
) -> Mock:
    """Create a mock bunk_plan with bunk expand."""
    bp = Mock()
    bp.session = session_pb_id

    bunk = Mock()
    bunk.gender = bunk_gender
    bp.expand = {"bunk": bunk}
    return bp


def create_mock_config(
    config_key: str,
    value: dict[str, object] | int,
    record_id: str = "cfg1",
) -> Mock:
    """Create a mock config record."""
    config = Mock()
    config.id = record_id
    config.category = "session_availability"
    config.subcategory = "2026"
    config.config_key = config_key
    config.value = value
    return config


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository."""
    repo = Mock()
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_attendees_with_persons = AsyncMock(return_value=[])
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_bunk_plans = AsyncMock(return_value=[])
    repo.fetch_capacity_config = AsyncMock(return_value=12)
    repo.pb = Mock()
    repo.pb.collection = Mock(return_value=Mock(get_full_list=Mock(return_value=[])))
    return repo


@pytest.fixture
def service(mock_repository):
    """Create a SessionAvailabilityService with mock repository."""
    return SessionAvailabilityService(mock_repository)


@pytest.fixture
def sample_sessions() -> dict[int, Mock]:
    """Sample sessions for 2026."""
    return {
        1001: create_mock_session(1001, "Session 1", session_type="main"),
        1002: create_mock_session(1002, "Session 2", session_type="main"),
        1003: create_mock_session(1003, "Session 2a", session_type="embedded"),
        2001: create_mock_session(2001, "AG Session 1", session_type="ag", parent_id=1001),
    }


# ============================================================================
# Status Computation Tests
# ============================================================================


class TestComputeStatus:
    """Test the status computation logic."""

    def test_open_when_below_threshold(self, service):
        """Status is 'open' when enrollment is below threshold."""
        assert service.compute_status(enrolled=5, waitlisted=0, capacity=20, threshold_pct=80) == "open"

    def test_limited_when_at_threshold(self, service):
        """Status is 'limited' when enrollment reaches threshold."""
        assert service.compute_status(enrolled=16, waitlisted=0, capacity=20, threshold_pct=80) == "limited"

    def test_waitlist_when_waitlisted_exist(self, service):
        """Status is 'waitlist' when there are waitlisted campers."""
        assert service.compute_status(enrolled=20, waitlisted=3, capacity=20, threshold_pct=80) == "waitlist"

    def test_waitlist_overrides_limited(self, service):
        """Waitlist status takes priority over limited."""
        assert service.compute_status(enrolled=10, waitlisted=1, capacity=20, threshold_pct=80) == "waitlist"

    def test_open_when_no_capacity(self, service):
        """Status is 'open' when capacity is None (unknown)."""
        assert service.compute_status(enrolled=100, waitlisted=0, capacity=None, threshold_pct=80) == "open"

    def test_open_when_zero_capacity(self, service):
        """Status is 'open' when capacity is 0 (avoid division by zero)."""
        assert service.compute_status(enrolled=5, waitlisted=0, capacity=0, threshold_pct=80) == "open"


# ============================================================================
# Capacity Calculation Tests
# ============================================================================


class TestCapacityCalculation:
    """Test per-gender capacity calculation from bunk plans."""

    @pytest.mark.asyncio
    async def test_boys_girls_capacity_from_bunk_plans(self, service, mock_repository, sample_sessions):
        """Capacity should be split by bunk gender (M/F)."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            # Session 1: 3 boys bunks, 2 girls bunks
            create_mock_bunk_plan("pb_1001", "M"),
            create_mock_bunk_plan("pb_1001", "M"),
            create_mock_bunk_plan("pb_1001", "M"),
            create_mock_bunk_plan("pb_1001", "F"),
            create_mock_bunk_plan("pb_1001", "F"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert session1.boys.capacity == 36  # 3 bunks * 12
        assert session1.girls.capacity == 24  # 2 bunks * 12

    @pytest.mark.asyncio
    async def test_ag_capacity_from_mixed_bunks(self, service, mock_repository, sample_sessions):
        """AG sessions use Mixed-gender bunks for capacity."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        ag = next(a for a in result.ag_sessions if a.session_cm_id == 2001)
        assert ag.capacity == 24  # 2 bunks * 12

    @pytest.mark.asyncio
    async def test_capacity_override_from_config(self, service, mock_repository, sample_sessions):
        """When config has capacity_override, use that instead of bunk_plans."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        # Config specifies capacity override with unified grade range
        config_records = [
            create_mock_config(
                "1001",
                {
                    "min_grade": 2,
                    "max_grade": 10,
                    "capacity_override": 30,
                },
            ),
        ]
        mock_repository.pb.collection.return_value.get_full_list.return_value = config_records

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        # With override of 30, each gender gets 15
        assert session1.boys.capacity == 15
        assert session1.girls.capacity == 15


# ============================================================================
# Enrollment Counting Tests
# ============================================================================


class TestEnrollmentCounting:
    """Test per-gender enrollment counting."""

    @pytest.mark.asyncio
    async def test_enrolled_count_by_gender(self, service, mock_repository, sample_sessions):
        """Enrollment counts should be split by person gender."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_1001", "M"),
            create_mock_bunk_plan("pb_1001", "F"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12

        # 3 boys, 2 girls enrolled
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(101, 1001, "M", status="enrolled"),
            create_mock_attendee(102, 1001, "M", status="enrolled"),
            create_mock_attendee(103, 1001, "M", status="enrolled"),
            create_mock_attendee(201, 1001, "F", status="enrolled"),
            create_mock_attendee(202, 1001, "F", status="enrolled"),
        ]

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert session1.boys.enrolled == 3
        assert session1.girls.enrolled == 2

    @pytest.mark.asyncio
    async def test_waitlisted_count_by_gender(self, service, mock_repository, sample_sessions):
        """Waitlisted counts tracked separately from enrolled."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12

        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(101, 1001, "M", status="enrolled"),
            create_mock_attendee(102, 1001, "M", status="waitlisted"),
            create_mock_attendee(201, 1001, "F", status="waitlisted"),
        ]

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert session1.boys.enrolled == 1
        assert session1.boys.waitlisted == 1
        assert session1.girls.waitlisted == 1

    @pytest.mark.asyncio
    async def test_ag_enrollment_separate(self, service, mock_repository, sample_sessions):
        """AG session enrollment counted separately."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12

        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(101, 2001, "M", status="enrolled"),
            create_mock_attendee(201, 2001, "F", status="enrolled"),
        ]

        result = await service.calculate_availability(year=2026)

        ag = next(a for a in result.ag_sessions if a.session_cm_id == 2001)
        assert ag.enrolled == 2


# ============================================================================
# Grade Eligibility Tests
# ============================================================================


class TestGradeEligibility:
    """Test grade range from config records."""

    @pytest.mark.asyncio
    async def test_grade_range_from_config(self, service, mock_repository, sample_sessions):
        """Grade ranges should come from unified min_grade/max_grade config."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        config_records = [
            create_mock_config(
                "1001",
                {
                    "min_grade": 3,
                    "max_grade": 8,
                    "capacity_override": None,
                },
            ),
        ]
        mock_repository.pb.collection.return_value.get_full_list.return_value = config_records

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        # Both genders get the same unified grade range
        assert session1.girls.min_grade == 3
        assert session1.girls.max_grade == 8
        assert session1.boys.min_grade == 3
        assert session1.boys.max_grade == 8

    @pytest.mark.asyncio
    async def test_no_config_returns_none_grades(self, service, mock_repository, sample_sessions):
        """Sessions without config should have None grade ranges."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert session1.girls.min_grade is None
        assert session1.boys.min_grade is None


# ============================================================================
# Threshold Tests
# ============================================================================


class TestThreshold:
    """Test limited_threshold config."""

    @pytest.mark.asyncio
    async def test_default_threshold_80(self, service, mock_repository, sample_sessions):
        """Default threshold should be 80 if not configured."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_1001", "M"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        assert result.limited_threshold == 80

    @pytest.mark.asyncio
    async def test_custom_threshold(self, service, mock_repository, sample_sessions):
        """Custom threshold from config should be used."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        config_records = [
            create_mock_config("limited_threshold", 90, record_id="thr1"),
        ]
        mock_repository.pb.collection.return_value.get_full_list.return_value = config_records

        result = await service.calculate_availability(year=2026)

        assert result.limited_threshold == 90


# ============================================================================
# Response Structure Tests
# ============================================================================


class TestResponseStructure:
    """Test response schema shape."""

    @pytest.mark.asyncio
    async def test_sessions_exclude_ag(self, service, mock_repository, sample_sessions):
        """The sessions list should not include AG sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        session_types = {s.session_type for s in result.sessions}
        assert "ag" not in session_types

    @pytest.mark.asyncio
    async def test_ag_sessions_separate_list(self, service, mock_repository, sample_sessions):
        """AG sessions should be in the ag_sessions list."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        assert len(result.ag_sessions) == 1
        assert result.ag_sessions[0].session_cm_id == 2001

    @pytest.mark.asyncio
    async def test_session_sort_order(self, service, mock_repository):
        """Sessions should be sorted by start_date."""
        sessions = {
            1002: create_mock_session(1002, "Session 2", start_date="2026-07-01"),
            1001: create_mock_session(1001, "Session 1", start_date="2026-06-15"),
            1003: create_mock_session(1003, "Session 3", start_date="2026-07-15"),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        names = [s.session_name for s in result.sessions]
        assert names == ["Session 1", "Session 2", "Session 3"]


# ============================================================================
# Session Type Filtering Tests
# ============================================================================


class TestSessionTypeFiltering:
    """Test session_types parameter filtering."""

    @pytest.mark.asyncio
    async def test_default_session_types_passed_to_repository(self, service, mock_repository):
        """When session_types is None, default summer types should be passed."""
        mock_repository.fetch_sessions.return_value = {}
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        await service.calculate_availability(year=2026)

        # fetch_sessions should be called with default summer types
        mock_repository.fetch_sessions.assert_called_once_with(2026, session_types=["main", "embedded", "ag", "quest"])

    @pytest.mark.asyncio
    async def test_custom_session_types_passed_to_repository(self, service, mock_repository):
        """When session_types is provided, it should be passed to repository."""
        mock_repository.fetch_sessions.return_value = {}
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        await service.calculate_availability(year=2026, session_types=["main", "embedded"])

        mock_repository.fetch_sessions.assert_called_once_with(2026, session_types=["main", "embedded"])

    @pytest.mark.asyncio
    async def test_explicit_none_uses_defaults(self, service, mock_repository):
        """Passing session_types=None explicitly should use default summer types."""
        mock_repository.fetch_sessions.return_value = {}
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        await service.calculate_availability(year=2026, session_types=None)

        mock_repository.fetch_sessions.assert_called_once_with(2026, session_types=["main", "embedded", "ag", "quest"])


# ============================================================================
# Session CM ID Filtering Tests
# ============================================================================


class TestSessionCmIdFiltering:
    """Test session_cm_id parameter filtering."""

    @pytest.mark.asyncio
    async def test_filter_to_specific_session(self, service, mock_repository, sample_sessions):
        """When session_cm_id is set, only that session should appear in results."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026, session_cm_id=1001)

        # Only Session 1 in sessions list
        assert len(result.sessions) == 1
        assert result.sessions[0].session_cm_id == 1001

    @pytest.mark.asyncio
    async def test_filter_includes_ag_children(self, service, mock_repository, sample_sessions):
        """Filtering by session_cm_id should include AG sessions whose parent_id matches."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        # Filter to Session 1 (cm_id=1001), AG Session 1 has parent_id=1001
        result = await service.calculate_availability(year=2026, session_cm_id=1001)

        assert len(result.sessions) == 1
        assert result.sessions[0].session_cm_id == 1001
        # AG child should be included
        assert len(result.ag_sessions) == 1
        assert result.ag_sessions[0].session_cm_id == 2001

    @pytest.mark.asyncio
    async def test_filter_excludes_unrelated_sessions(self, service, mock_repository, sample_sessions):
        """Filtering by session_cm_id should exclude unrelated sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        # Filter to Session 2 (cm_id=1002), which has no AG children
        result = await service.calculate_availability(year=2026, session_cm_id=1002)

        assert len(result.sessions) == 1
        assert result.sessions[0].session_cm_id == 1002
        # AG Session 1 has parent_id=1001, not 1002
        assert len(result.ag_sessions) == 0

    @pytest.mark.asyncio
    async def test_no_filter_returns_all(self, service, mock_repository, sample_sessions):
        """Without session_cm_id, all sessions should be returned."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        # 3 non-AG sessions + 1 AG session
        assert len(result.sessions) == 3
        assert len(result.ag_sessions) == 1


# ============================================================================
# Defunct AG Session Hiding Tests
# ============================================================================


class TestDefunctAGHiding:
    """Test that defunct AG sessions (no capacity, no enrollment) are hidden."""

    @pytest.mark.asyncio
    async def test_defunct_ag_hidden(self, service, mock_repository):
        """AG session with no bunk plans and no enrollment should be hidden."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "Active AG", session_type="ag", parent_id=1001),
            2002: create_mock_session(2002, "Defunct AG", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions
        # Only active AG has bunk plans
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        ag_ids = {a.session_cm_id for a in result.ag_sessions}
        assert 2001 in ag_ids  # Active AG with bunk plan
        assert 2002 not in ag_ids  # Defunct AG hidden

    @pytest.mark.asyncio
    async def test_ag_with_enrollment_but_no_capacity_kept(self, service, mock_repository):
        """AG session with enrollment but no bunk plans should still be shown."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "AG with enrollees", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []  # No bunk plans
        mock_repository.fetch_capacity_config.return_value = 12
        # But has enrolled attendees
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(101, 2001, "M", status="enrolled"),
        ]

        result = await service.calculate_availability(year=2026)

        assert len(result.ag_sessions) == 1
        assert result.ag_sessions[0].session_cm_id == 2001

    @pytest.mark.asyncio
    async def test_ag_with_waitlisted_but_no_capacity_kept(self, service, mock_repository):
        """AG session with waitlisted campers but no capacity should be shown."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "AG with waitlist", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(101, 2001, "F", status="waitlisted"),
        ]

        result = await service.calculate_availability(year=2026)

        assert len(result.ag_sessions) == 1

    @pytest.mark.asyncio
    async def test_ag_with_capacity_but_no_enrollment_kept(self, service, mock_repository):
        """AG session with bunk plans but no enrollment should still be shown."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "AG empty but valid", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        assert len(result.ag_sessions) == 1

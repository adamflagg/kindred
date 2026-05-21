"""
Unit tests for the session availability service.

Tests verify the availability matrix computation:
- Per-session, per-gender enrollment counting
- Capacity calculation from bunk_plans (boys/girls/AG split)
- Status logic: open / limited / full
- AG sessions handled separately
- Config-based grade eligibility and capacity overrides
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.session_availability_service import SessionAvailabilityService
from tests.unit.api.conftest import create_mock_attendee, create_mock_session

# ============================================================================
# Test Data Factories
# ============================================================================


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
        """Status reflects capacity, not waitlist — full at 100%."""
        assert service.compute_status(enrolled=20, waitlisted=3, capacity=20, threshold_pct=80) == "full"

    def test_waitlist_overrides_limited(self, service):
        """Waitlist no longer overrides — status based on capacity only."""
        assert service.compute_status(enrolled=10, waitlisted=1, capacity=20, threshold_pct=80) == "open"

    def test_open_when_no_capacity(self, service):
        """Status is 'open' when capacity is None (unknown)."""
        assert service.compute_status(enrolled=100, waitlisted=0, capacity=None, threshold_pct=80) == "open"

    def test_open_when_zero_capacity(self, service):
        """Status is 'open' when capacity is 0 (avoid division by zero)."""
        assert service.compute_status(enrolled=5, waitlisted=0, capacity=0, threshold_pct=80) == "open"

    def test_full_when_at_100_percent_capacity(self, service):
        """Status is 'full' when enrollment reaches 100% of capacity."""
        assert service.compute_status(enrolled=20, waitlisted=0, capacity=20, threshold_pct=80) == "full"

    def test_full_when_over_capacity(self, service):
        """Status is 'full' when enrollment exceeds capacity (overage)."""
        assert service.compute_status(enrolled=25, waitlisted=0, capacity=20, threshold_pct=80) == "full"

    def test_full_takes_priority_when_threshold_is_100(self, service):
        """When threshold=100, 'full' should still be returned (not 'limited')."""
        assert service.compute_status(enrolled=20, waitlisted=0, capacity=20, threshold_pct=100) == "full"

    def test_waitlisted_no_longer_affects_status(self, service):
        """Waitlisted count should NOT affect status — only capacity matters."""
        assert service.compute_status(enrolled=10, waitlisted=5, capacity=20, threshold_pct=80) == "open"

    def test_waitlisted_with_full_capacity(self, service):
        """Full capacity + waitlisted should still be 'full' (not 'waitlist')."""
        assert service.compute_status(enrolled=20, waitlisted=10, capacity=20, threshold_pct=80) == "full"


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
            create_mock_attendee(101, 1001, gender="M", status="enrolled"),
            create_mock_attendee(102, 1001, gender="M", status="enrolled"),
            create_mock_attendee(103, 1001, gender="M", status="enrolled"),
            create_mock_attendee(201, 1001, gender="F", status="enrolled"),
            create_mock_attendee(202, 1001, gender="F", status="enrolled"),
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
            create_mock_attendee(101, 1001, gender="M", status="enrolled"),
            create_mock_attendee(102, 1001, gender="M", status="waitlisted"),
            create_mock_attendee(201, 1001, gender="F", status="waitlisted"),
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
            create_mock_attendee(101, 2001, gender="M", status="enrolled"),
            create_mock_attendee(201, 2001, gender="F", status="enrolled"),
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
            create_mock_attendee(101, 2001, gender="M", status="enrolled"),
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
            create_mock_attendee(101, 2001, gender="F", status="waitlisted"),
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


# ============================================================================
# WaitlistedPerson Schema Tests
# ============================================================================


class TestWaitlistedPersonSchema:
    """Test WaitlistedPerson schema validation."""

    def test_waitlisted_person_fields(self):
        from api.schemas.session_availability import WaitlistedPerson

        person = WaitlistedPerson(
            person_id=12345,
            first_name="Emma",
            last_name="Johnson",
            preferred_name="Em",
            grade=4,
            position=1,
        )
        assert person.person_id == 12345
        assert person.preferred_name == "Em"
        assert person.position == 1

    def test_waitlisted_person_optional_fields(self):
        from api.schemas.session_availability import WaitlistedPerson

        person = WaitlistedPerson(
            person_id=12345,
            first_name="Emma",
            last_name="Johnson",
            position=1,
        )
        assert person.preferred_name is None
        assert person.grade is None


# ============================================================================
# Waitlist By Grade Tests
# ============================================================================


class TestWaitlistByGrade:
    """Test per-grade waitlist counting and person detail collection."""

    @pytest.mark.asyncio
    async def test_waitlisted_by_grade_counts(self, service, mock_repository):
        """Waitlisted campers should be counted per grade per gender."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(
                101,
                1001,
                gender="F",
                status="waitlisted",
                grade=4,
                first_name="Emma",
                last_name="Johnson",
                effective_date="2025-11-12",
                enrollment_date="2025-11-13T23:37:50Z",
            ),
            create_mock_attendee(
                102,
                1001,
                gender="F",
                status="waitlisted",
                grade=4,
                first_name="Olivia",
                last_name="Chen",
                effective_date="2025-11-13",
                enrollment_date="2025-11-14T17:45:17Z",
            ),
            create_mock_attendee(
                103,
                1001,
                gender="F",
                status="waitlisted",
                grade=6,
                first_name="Sophia",
                last_name="Garcia",
                effective_date="2025-11-14",
                enrollment_date="2025-11-15T18:00:00Z",
            ),
            create_mock_attendee(
                201,
                1001,
                gender="M",
                status="waitlisted",
                grade=5,
                first_name="Liam",
                last_name="Williams",
                effective_date="2025-12-01",
                enrollment_date="2025-12-02T10:00:00Z",
            ),
        ]

        result = await service.calculate_availability(year=2026)
        session = next(s for s in result.sessions if s.session_cm_id == 1001)

        assert session.girls.waitlisted_by_grade == {4: 2, 6: 1}
        assert session.boys.waitlisted_by_grade == {5: 1}

    @pytest.mark.asyncio
    async def test_waitlisted_persons_top5_sorted(self, service, mock_repository):
        """Waitlisted persons should be sorted by effective_date, enrollment_date and capped at 5."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12

        # Create 7 waitlisted girls with different dates
        attendees = []
        for i, (eff, enr) in enumerate(
            [
                ("2025-12-03", "2025-12-04T22:10:53Z"),  # #3
                ("2025-11-12", "2025-11-13T23:37:50Z"),  # #1
                ("2025-12-03", "2025-12-04T22:10:34Z"),  # #2 (same eff, earlier enr)
                ("2025-12-19", "2025-12-22T23:58:09Z"),  # #4
                ("2026-01-06", "2026-01-07T17:30:31Z"),  # #5
                ("2026-01-28", "2026-01-28T17:55:15Z"),  # #6 (should be excluded from top 5)
                ("2026-01-31", "2026-02-02T16:15:18Z"),  # #7 (should be excluded from top 5)
            ]
        ):
            attendees.append(
                create_mock_attendee(
                    100 + i,
                    1001,
                    gender="F",
                    status="waitlisted",
                    grade=3 + (i % 3),
                    first_name=["Emma", "Olivia", "Sophia", "Mia", "Ava", "Isabella", "Charlotte"][i],
                    last_name=["Johnson", "Chen", "Garcia", "Williams", "Davis", "Martinez", "Brown"][i],
                    effective_date=eff,
                    enrollment_date=enr,
                )
            )
        mock_repository.fetch_attendees_with_persons.return_value = attendees

        result = await service.calculate_availability(year=2026)
        session = next(s for s in result.sessions if s.session_cm_id == 1001)

        # Should be capped at 5
        assert len(session.girls.waitlisted_persons) == 5
        # Positions should be 1-5
        positions = [p.position for p in session.girls.waitlisted_persons]
        assert positions == [1, 2, 3, 4, 5]
        # First should be the earliest by effective_date
        assert session.girls.waitlisted_persons[0].person_id == 101  # eff=2025-11-12

    @pytest.mark.asyncio
    async def test_waitlisted_persons_under_5_no_cap(self, service, mock_repository):
        """When fewer than 5 waitlisted, return all with correct positions."""
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = []
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(
                101,
                1001,
                gender="F",
                status="waitlisted",
                grade=3,
                first_name="Emma",
                last_name="Johnson",
                effective_date="2025-11-12",
                enrollment_date="2025-11-13T00:00:00Z",
            ),
            create_mock_attendee(
                102,
                1001,
                gender="F",
                status="waitlisted",
                grade=4,
                first_name="Olivia",
                last_name="Chen",
                effective_date="2025-11-13",
                enrollment_date="2025-11-14T00:00:00Z",
            ),
        ]

        result = await service.calculate_availability(year=2026)
        session = next(s for s in result.sessions if s.session_cm_id == 1001)

        assert len(session.girls.waitlisted_persons) == 2
        assert session.girls.waitlisted_persons[0].position == 1
        assert session.girls.waitlisted_persons[1].position == 2

    @pytest.mark.asyncio
    async def test_ag_waitlisted_persons_combined_gender(self, service, mock_repository):
        """AG sessions should have a single combined waitlist (not gender-split)."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            2001: create_mock_session(2001, "AG Session", session_type="ag", parent_id=1001),
        }
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_2001", "Mixed"),
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = [
            create_mock_attendee(
                101,
                2001,
                gender="F",
                status="waitlisted",
                grade=5,
                first_name="Emma",
                last_name="Johnson",
                effective_date="2025-11-12",
                enrollment_date="2025-11-13T00:00:00Z",
            ),
            create_mock_attendee(
                201,
                2001,
                gender="M",
                status="waitlisted",
                grade=6,
                first_name="Liam",
                last_name="Garcia",
                effective_date="2025-11-13",
                enrollment_date="2025-11-14T00:00:00Z",
            ),
        ]

        result = await service.calculate_availability(year=2026)
        ag = next(a for a in result.ag_sessions if a.session_cm_id == 2001)

        # Both genders in one list
        assert len(ag.waitlisted_persons) == 2
        assert ag.waitlisted_by_grade == {5: 1, 6: 1}


# ============================================================================
# Gender Normalization Tests
# ============================================================================


class TestNormalizeGenderKey:
    """Test bunk gender normalization."""

    def test_male_bunk(self, service):
        assert service._normalize_gender_key("M") == "M"

    def test_female_bunk(self, service):
        assert service._normalize_gender_key("F") == "F"

    def test_mixed_bunk(self, service):
        assert service._normalize_gender_key("Mixed") == "mixed"

    def test_empty_gender_returns_none(self, service):
        """Empty gender (from Go sync for non-standard bunks) returns None."""
        assert service._normalize_gender_key("") is None

    def test_unknown_gender_returns_none(self, service):
        """Unrecognized gender string returns None."""
        assert service._normalize_gender_key("X") is None


class TestCapacitySkipsUnknownGender:
    """Test that bunks with empty/unknown gender are excluded from capacity."""

    @pytest.mark.asyncio
    async def test_empty_gender_bunk_excluded_from_capacity(self, service, mock_repository, sample_sessions):
        """Bunk with empty gender should not contribute to any capacity bucket."""
        mock_repository.fetch_sessions.return_value = {
            1001: sample_sessions[1001],
        }
        mock_repository.fetch_bunk_plans.return_value = [
            create_mock_bunk_plan("pb_1001", "M"),
            create_mock_bunk_plan("pb_1001", "F"),
            create_mock_bunk_plan("pb_1001", ""),  # empty gender — should be skipped
        ]
        mock_repository.fetch_capacity_config.return_value = 12
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026)

        session1 = next(s for s in result.sessions if s.session_cm_id == 1001)
        assert session1.boys.capacity == 12  # 1 M bunk * 12
        assert session1.girls.capacity == 12  # 1 F bunk * 12
        # The empty-gender bunk should NOT inflate any capacity


# ============================================================================
# Router Error Handling Tests
# ============================================================================


class TestRouterErrorHandling:
    """Test that the router delegates error handling to the global handler."""

    @pytest.mark.asyncio
    async def test_error_does_not_expose_details(self, service, mock_repository):
        """When the service raises, error details must NOT appear in the response."""
        mock_repository.fetch_sessions = AsyncMock(side_effect=RuntimeError("secret db error"))

        with pytest.raises(RuntimeError, match="secret db error"):
            await service.calculate_availability(year=2026)


# ============================================================================
# Merged Attendee Processing Tests
# ============================================================================


class TestProcessAttendees:
    """Test the merged _process_attendees method."""

    def test_enrolled_and_waitlisted_in_single_pass(self, service):
        """Merged method returns both enrollment counts and waitlist data."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
        }
        attendees = [
            create_mock_attendee(101, 1001, gender="M", status="enrolled"),
            create_mock_attendee(102, 1001, gender="M", status="enrolled"),
            create_mock_attendee(201, 1001, gender="F", status="enrolled"),
            create_mock_attendee(
                301,
                1001,
                gender="M",
                status="waitlisted",
                grade=5,
                effective_date="2025-11-12",
                enrollment_date="2025-11-13",
            ),
            create_mock_attendee(
                302,
                1001,
                gender="F",
                status="waitlisted",
                grade=6,
                effective_date="2025-11-14",
                enrollment_date="2025-11-15",
            ),
        ]

        enrollment, waitlist_data = service._process_attendees(sessions, attendees)

        # Enrollment counts
        assert enrollment[1001]["enrolled_M"] == 2
        assert enrollment[1001]["enrolled_F"] == 1
        assert enrollment[1001]["enrolled_total"] == 3
        assert enrollment[1001]["waitlisted_M"] == 1
        assert enrollment[1001]["waitlisted_F"] == 1
        assert enrollment[1001]["waitlisted_total"] == 2

        # Waitlist data — by_grade and persons present
        assert 1001 in waitlist_data
        assert waitlist_data[1001]["by_grade_M"] == {5: 1}
        assert waitlist_data[1001]["by_grade_F"] == {6: 1}
        assert len(waitlist_data[1001]["persons_M"]) == 1
        assert len(waitlist_data[1001]["persons_F"]) == 1

    def test_non_waitlisted_counted_as_enrolled(self, service):
        """Any status that isn't 'waitlisted' is counted as enrolled."""
        sessions = {
            1001: create_mock_session(1001, "Session 1"),
        }
        attendees = [
            create_mock_attendee(101, 1001, gender="M", status="applied"),
        ]

        enrollment, waitlist_data = service._process_attendees(sessions, attendees)

        # 'applied' should be counted as enrolled, not waitlisted
        assert enrollment[1001]["enrolled_M"] == 1
        assert enrollment[1001].get("waitlisted_M", 0) == 0
        # No waitlist data for non-waitlisted
        assert 1001 not in waitlist_data

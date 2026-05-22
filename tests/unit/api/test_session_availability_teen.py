"""
Unit tests for teen (SCIT/TLI) aggregation in SessionAvailabilityService.

Verifies:
- SCIT (CIT + SIT merged) and TLI appear as exactly two teen_sessions rows
- Teens are excluded from result.sessions and result.ag_sessions
- Off-season teen sessions are window-gated out
- No-config case: null grade + null capacity + status open
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.session_availability_service import SessionAvailabilityService
from tests.unit.api.conftest import create_mock_attendee, create_mock_session

# ============================================================================
# Helpers
# ============================================================================


def create_mock_config(
    config_key: str,
    value: object,
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


def create_mock_bunk_plan(session_pb_id: str, bunk_gender: str = "M") -> Mock:
    bp = Mock()
    bp.session = session_pb_id
    bunk = Mock()
    bunk.gender = bunk_gender
    bp.expand = {"bunk": bunk}
    return bp


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
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
    return SessionAvailabilityService(mock_repository)


# ============================================================================
# Core: SCIT/TLI aggregation
# ============================================================================


class TestTeenAggregation:
    """Teen sessions aggregate into teen_sessions rows (not sessions/ag_sessions)."""

    @pytest.mark.asyncio
    async def test_teen_sessions_two_rows_scit_and_tli(self, service, mock_repository):
        """Result has exactly two teen_sessions: one SCIT and one TLI."""
        # main anchors the summer window
        main_session = create_mock_session(
            1001, "Session 1", session_type="main", start_date="2026-06-15", end_date="2026-07-05"
        )
        cit_session = create_mock_session(
            3001,
            "Counselor In Training",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        sit_session = create_mock_session(
            3002,
            "Specialist In Training",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        tli_session = create_mock_session(
            4001,
            "Teen Leader Institute",
            session_type="tli",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )

        sessions = {1001: main_session, 3001: cit_session, 3002: sit_session, 4001: tli_session}
        mock_repository.fetch_sessions.return_value = sessions

        # CIT: 2 enrolled, SIT: 1 enrolled, TLI: 3 enrolled
        attendees = [
            create_mock_attendee(101, 3001, gender="M", status="enrolled"),
            create_mock_attendee(102, 3001, gender="F", status="enrolled"),
            create_mock_attendee(103, 3002, gender="M", status="enrolled"),
            create_mock_attendee(201, 4001, gender="F", status="enrolled"),
            create_mock_attendee(202, 4001, gender="M", status="enrolled"),
            create_mock_attendee(203, 4001, gender="F", status="enrolled"),
        ]
        mock_repository.fetch_attendees_with_persons.return_value = attendees

        # Grade config for scit and tli
        config_records = [
            create_mock_config("type_scit", {"min_grade": 12, "max_grade": 12, "capacity_override": 50}, "cfg_scit"),
            create_mock_config("type_tli", {"min_grade": 11, "max_grade": 11, "capacity_override": 40}, "cfg_tli"),
        ]
        mock_repository.pb.collection.return_value.get_full_list.return_value = config_records

        result = await service.calculate_availability(year=2026, session_types=["main", "scit", "tli"])

        # Two teen rows, in order: SCIT first, TLI second
        assert len(result.teen_sessions) == 2
        scit = result.teen_sessions[0]
        tli = result.teen_sessions[1]

        assert scit.session_type == "scit"
        assert scit.session_name == "SCIT"
        assert scit.enrolled == 3  # CIT(2) + SIT(1)
        assert scit.min_grade == 12
        assert scit.max_grade == 12
        assert scit.capacity == 50

        assert tli.session_type == "tli"
        assert tli.session_name == "TLI"
        assert tli.enrolled == 3
        assert tli.min_grade == 11
        assert tli.max_grade == 11
        assert tli.capacity == 40

    @pytest.mark.asyncio
    async def test_teens_not_in_sessions_or_ag_sessions(self, service, mock_repository):
        """Teen sessions must NOT appear in result.sessions or result.ag_sessions."""
        main_session = create_mock_session(
            1001, "Session 1", session_type="main", start_date="2026-06-15", end_date="2026-07-05"
        )
        cit_session = create_mock_session(
            3001,
            "CIT",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        tli_session = create_mock_session(
            4001,
            "TLI",
            session_type="tli",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )

        sessions = {1001: main_session, 3001: cit_session, 4001: tli_session}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons.return_value = []

        result = await service.calculate_availability(year=2026, session_types=["main", "scit", "tli"])

        session_cm_ids = [s.session_cm_id for s in result.sessions]
        ag_cm_ids = [a.session_cm_id for a in result.ag_sessions]

        assert 3001 not in session_cm_ids
        assert 4001 not in session_cm_ids
        assert 3001 not in ag_cm_ids
        assert 4001 not in ag_cm_ids

    @pytest.mark.asyncio
    async def test_waitlisted_summed_for_scit(self, service, mock_repository):
        """Waitlisted counts from CIT and SIT are summed in the SCIT row."""
        main_session = create_mock_session(
            1001, "Session 1", session_type="main", start_date="2026-06-15", end_date="2026-07-05"
        )
        cit_session = create_mock_session(
            3001,
            "CIT",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        sit_session = create_mock_session(
            3002,
            "SIT",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )

        sessions = {1001: main_session, 3001: cit_session, 3002: sit_session}
        mock_repository.fetch_sessions.return_value = sessions

        attendees = [
            create_mock_attendee(101, 3001, gender="M", status="enrolled"),
            create_mock_attendee(102, 3001, gender="F", status="waitlisted"),
            create_mock_attendee(103, 3002, gender="M", status="waitlisted"),
        ]
        mock_repository.fetch_attendees_with_persons.return_value = attendees

        result = await service.calculate_availability(year=2026, session_types=["main", "scit"])

        assert len(result.teen_sessions) == 1
        scit = result.teen_sessions[0]
        assert scit.enrolled == 1  # only 3001/101
        assert scit.waitlisted == 2  # 3001/102 + 3002/103


# ============================================================================
# Window gate: off-season teens excluded
# ============================================================================


class TestTeenWindowGate:
    """Off-season teen sessions (e.g. fall Family-Camp CIT) are excluded."""

    @pytest.mark.asyncio
    async def test_off_season_scit_excluded(self, service, mock_repository):
        """A SCIT session with Sept dates (outside summer window) is not aggregated."""
        main_session = create_mock_session(
            1001, "Session 1", session_type="main", start_date="2026-06-15", end_date="2026-07-05"
        )
        summer_cit = create_mock_session(
            3001,
            "Summer CIT",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        fall_cit = create_mock_session(
            3099,
            "Family Camp CIT",
            session_type="scit",
            start_date="2026-09-10",
            end_date="2026-09-15",  # Sept — off season
        )

        sessions = {1001: main_session, 3001: summer_cit, 3099: fall_cit}
        mock_repository.fetch_sessions.return_value = sessions

        attendees = [
            create_mock_attendee(101, 3001, gender="M", status="enrolled"),
            create_mock_attendee(102, 3099, gender="F", status="enrolled"),  # fall — excluded
        ]
        mock_repository.fetch_attendees_with_persons.return_value = attendees

        config_records = [
            create_mock_config("type_scit", {"min_grade": 12, "max_grade": 12, "capacity_override": 50}, "cfg_scit"),
        ]
        mock_repository.pb.collection.return_value.get_full_list.return_value = config_records

        result = await service.calculate_availability(year=2026, session_types=["main", "scit"])

        assert len(result.teen_sessions) == 1
        scit = result.teen_sessions[0]
        # Only summer_cit enrolled count (1), not fall_cit (1)
        assert scit.enrolled == 1


# ============================================================================
# No-config case
# ============================================================================


class TestTeenNoConfig:
    """When no type_ grade config exists, teen rows have null grade/capacity + open status."""

    @pytest.mark.asyncio
    async def test_no_type_config_yields_null_grade_and_capacity(self, service, mock_repository):
        """Without type_scit/type_tli config, grade and capacity are None; status is open."""
        main_session = create_mock_session(
            1001, "Session 1", session_type="main", start_date="2026-06-15", end_date="2026-07-05"
        )
        cit_session = create_mock_session(
            3001,
            "CIT",
            session_type="scit",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )
        tli_session = create_mock_session(
            4001,
            "TLI",
            session_type="tli",
            start_date="2026-06-20",
            end_date="2026-07-04",
        )

        sessions = {1001: main_session, 3001: cit_session, 4001: tli_session}
        mock_repository.fetch_sessions.return_value = sessions

        attendees = [
            create_mock_attendee(101, 3001, gender="M", status="enrolled"),
            create_mock_attendee(201, 4001, gender="F", status="enrolled"),
        ]
        mock_repository.fetch_attendees_with_persons.return_value = attendees

        # No type_ config — empty config records
        mock_repository.pb.collection.return_value.get_full_list.return_value = []

        result = await service.calculate_availability(year=2026, session_types=["main", "scit", "tli"])

        assert len(result.teen_sessions) == 2
        scit = result.teen_sessions[0]
        tli = result.teen_sessions[1]

        assert scit.min_grade is None
        assert scit.max_grade is None
        assert scit.capacity is None
        assert scit.status == "open"

        assert tli.min_grade is None
        assert tli.max_grade is None
        assert tli.capacity is None
        assert tli.status == "open"

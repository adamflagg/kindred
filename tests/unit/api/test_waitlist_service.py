"""
Unit tests for the waitlist service.

These tests verify waitlist analysis logic for the four use cases:
- UC1: Currently waitlisted, no other enrolled summer sessions
- UC2: Currently waitlisted, has other enrolled summer sessions
- UC3: Previously waitlisted, accepted (now enrolled)
- UC4: Previously waitlisted, declined (cancelled/withdrawn/dismissed)
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, Mock

import pytest

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.waitlist_service import WaitlistService

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_person(
    cm_id: int,
    first_name: str,
    last_name: str,
    gender: str = "M",
    grade: int = 6,
    years_at_camp: int = 2,
    year: int = 2026,
    school: str = "Riverside Elementary",
    address_city: str = "Springfield",
    address_state: str = "IL",
) -> Mock:
    """Create a mock person record."""
    person = Mock()
    person.cm_id = cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.gender = gender
    person.grade = grade
    person.years_at_camp = years_at_camp
    person.year = year
    person.school = school
    person.address_city = address_city
    person.address_state = address_state
    person.preferred_name = None
    person.age = 12
    person.normalized_school = None
    person.normalized_city = None
    person.normalized_congregation = None
    return person


def create_mock_session(
    cm_id: int,
    name: str,
    year: int = 2026,
    session_type: str = "main",
    start_date: str = "2026-06-15",
    end_date: str = "2026-07-05",
    parent_id: int | None = None,
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.end_date = end_date
    session.parent_id = parent_id
    return session


def create_mock_attendee(
    person_id: int,
    session: Mock,
    year: int = 2026,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
) -> Mock:
    """Create a mock attendee record with embedded session."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    attendee.expand = {"session": session}
    return attendee


def create_mock_status_history(
    person_id: int,
    session: Mock,
    person: Mock | None,
    old_status: str,
    new_status: str,
    detected_at: str = "2026-01-15 10:00:00.000Z",
    year: int = 2026,
) -> Mock:
    """Create a mock attendee_status_history record."""
    record = Mock()
    record.person_id = person_id
    record.old_status = old_status
    record.new_status = new_status
    record.detected_at = detected_at
    record.year = year
    record.expand = {"session": session}
    if person:
        record.expand["person"] = person
    return record


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository with waitlist-specific methods."""
    repo = Mock()
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_persons = AsyncMock(return_value={})
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_status_history = AsyncMock(return_value=[])
    return repo


@pytest.fixture
def waitlist_service(mock_repository):
    """Create a WaitlistService with mock repository."""
    return WaitlistService(mock_repository)


@pytest.fixture
def sample_sessions() -> dict[int, Mock]:
    """Sample sessions for 2026."""
    return {
        1001: create_mock_session(1001, "Session 1", 2026, "main"),
        1002: create_mock_session(1002, "Session 2", 2026, "main"),
        1003: create_mock_session(1003, "Session 2a", 2026, "embedded"),
        1004: create_mock_session(1004, "AG Session 1", 2026, "ag", parent_id=1001),
    }


@pytest.fixture
def sample_persons() -> dict[int, Mock]:
    """Sample persons."""
    return {
        101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
        103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=1),
        104: create_mock_person(104, "Noah", "Williams", "M", 8, years_at_camp=3),
        105: create_mock_person(105, "Ava", "Brown", "F", 6, years_at_camp=2),
    }


# ============================================================================
# UC1: Waitlisted, No Other Enrolled Sessions
# ============================================================================


class TestWaitlistedNoEnrollment:
    """UC1: Currently waitlisted with no other enrolled summer sessions."""

    @pytest.mark.asyncio
    async def test_waitlisted_person_with_no_enrollment(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in Session 1 with no enrolled records anywhere."""
        session1 = sample_sessions[1001]
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees: list[Mock] = []

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.waitlisted_no_enrollment == 1
        assert result.waitlisted_has_enrollment == 0

    @pytest.mark.asyncio
    async def test_multiple_waitlisted_no_enrollment(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Multiple persons waitlisted with no enrolled records."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(103, session2, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees: list[Mock] = []

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.waitlisted_no_enrollment == 2
        assert result.waitlisted_has_enrollment == 0


# ============================================================================
# UC2: Waitlisted, Has Other Enrolled Sessions
# ============================================================================


class TestWaitlistedHasEnrollment:
    """UC2: Currently waitlisted but has other enrolled summer sessions."""

    @pytest.mark.asyncio
    async def test_waitlisted_with_enrolled_in_other_session(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in Session 1 but enrolled in Session 2."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        waitlisted_attendees = [
            create_mock_attendee(102, session1, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session2, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.waitlisted_no_enrollment == 0
        assert result.waitlisted_has_enrollment == 1

    @pytest.mark.asyncio
    async def test_mix_of_uc1_and_uc2(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Mix: Emma waitlisted only, Liam waitlisted but also enrolled elsewhere."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(102, session1, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session2, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.waitlisted_no_enrollment == 1
        assert result.waitlisted_has_enrollment == 1
        assert result.total_waitlisted == 2


# ============================================================================
# UC3: Previously Waitlisted, Accepted (Now Enrolled)
# ============================================================================


class TestPreviouslyWaitlistedAccepted:
    """UC3: Previously waitlisted, now enrolled (accepted)."""

    @pytest.mark.asyncio
    async def test_accepted_from_waitlist(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """History shows waitlisted→enrolled transition."""
        session1 = sample_sessions[1001]
        person = sample_persons[104]
        history = [
            create_mock_status_history(104, session1, person, old_status="waitlisted", new_status="enrolled"),
        ]

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: (history if new_statuses == ["enrolled"] else [])
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.total_accepted == 1

    @pytest.mark.asyncio
    async def test_multiple_accepted(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Multiple persons accepted from waitlist."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        history = [
            create_mock_status_history(
                104, session1, sample_persons[104], old_status="waitlisted", new_status="enrolled"
            ),
            create_mock_status_history(
                105, session2, sample_persons[105], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: (history if new_statuses == ["enrolled"] else [])
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.total_accepted == 2


# ============================================================================
# UC4: Previously Waitlisted, Declined
# ============================================================================


class TestPreviouslyWaitlistedDeclined:
    """UC4: Previously waitlisted, cancelled/withdrawn/dismissed."""

    @pytest.mark.asyncio
    async def test_declined_from_waitlist(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """History shows waitlisted→cancelled transition."""
        session1 = sample_sessions[1001]
        person = sample_persons[103]
        declined_statuses = ["cancelled", "withdrawn", "dismissed"]
        history = [
            create_mock_status_history(103, session1, person, old_status="waitlisted", new_status="cancelled"),
        ]

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: (history if new_statuses == declined_statuses else [])
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.total_declined == 1


# ============================================================================
# Session Filtering
# ============================================================================


class TestSessionFiltering:
    """Test that session_cm_id and session_types filters work correctly."""

    @pytest.mark.asyncio
    async def test_session_type_filter_excludes_ag(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Waitlisted attendees in AG sessions are still counted (AG folds into parent)."""
        ag_session = sample_sessions[1004]
        main_session = sample_sessions[1001]
        waitlisted_attendees = [
            create_mock_attendee(101, main_session, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(102, ag_session, status="waitlisted", status_id=8, is_active=False),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted_attendees if status_filter == "waitlisted" else [])
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026, session_types=["main", "embedded", "ag"])

        # Both should be counted (AG sessions are included in summer)
        assert result.total_waitlisted == 2


# ============================================================================
# Empty State
# ============================================================================


class TestEmptyState:
    """Test graceful handling when no data exists."""

    @pytest.mark.asyncio
    async def test_no_waitlisted_no_history(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """No waitlisted attendees and no history returns all zeros."""
        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = {}
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.total_waitlisted == 0
        assert result.waitlisted_no_enrollment == 0
        assert result.waitlisted_has_enrollment == 0
        assert result.total_accepted == 0
        assert result.total_declined == 0
        assert result.by_session == []

    @pytest.mark.asyncio
    async def test_empty_history_returns_zero_transitions(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """Empty history table returns zero for accepted/declined."""
        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = {}
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.total_accepted == 0
        assert result.total_declined == 0


# ============================================================================
# Per-Session Breakdown
# ============================================================================


class TestSessionBreakdown:
    """Test per-session breakdown aggregation."""

    @pytest.mark.asyncio
    async def test_by_session_breakdown(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Session breakdown shows counts per session."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(102, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(103, session2, status="waitlisted", status_id=8, is_active=False),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted_attendees if status_filter == "waitlisted" else [])
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert len(result.by_session) >= 2
        session_map = {s.session_cm_id: s for s in result.by_session}
        assert session_map[1001].waitlisted == 2
        assert session_map[1002].waitlisted == 1


# ============================================================================
# Enrolled-In Breakdown (per-session enrollment detail)
# ============================================================================


class TestEnrolledInBreakdown:
    """Test enrolled_in field on WaitlistSessionBreakdown.

    The enrolled_in list shows which specific sessions the "has_enrollment"
    persons are enrolled in, enabling stacked bar chart visualization.
    """

    @pytest.mark.asyncio
    async def test_enrolled_in_breakdown_shows_specific_sessions(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted for Session 2a, enrolled in Session 1 -> enrolled_in contains Session 1."""
        session1 = sample_sessions[1001]
        session2a = sample_sessions[1003]  # Session 2a (embedded)
        # Emma (101) waitlisted for Session 2a, enrolled in Session 1
        waitlisted_attendees = [
            create_mock_attendee(101, session2a, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, session1, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        # Find the Session 2a breakdown
        session_map = {s.session_cm_id: s for s in result.by_session}
        session_2a = session_map[1003]
        assert session_2a.has_enrollment == 1

        # enrolled_in should show Session 1 with count=1
        assert len(session_2a.enrolled_in) == 1
        assert session_2a.enrolled_in[0].session_cm_id == 1001
        assert session_2a.enrolled_in[0].session_name == "Session 1"
        assert session_2a.enrolled_in[0].count == 1

    @pytest.mark.asyncio
    async def test_enrolled_in_multi_session(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person enrolled in Sessions 1 and 2 -> both appear in enrolled_in."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        session2a = sample_sessions[1003]
        # Liam (102) waitlisted for Session 2a, enrolled in Sessions 1 and 2
        waitlisted_attendees = [
            create_mock_attendee(102, session2a, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session1, status="enrolled", status_id=2, is_active=True),
            create_mock_attendee(102, session2, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        session_map = {s.session_cm_id: s for s in result.by_session}
        session_2a = session_map[1003]
        assert session_2a.has_enrollment == 1

        # enrolled_in should have both sessions
        enrolled_names = {e.session_name for e in session_2a.enrolled_in}
        assert enrolled_names == {"Session 1", "Session 2"}
        for entry in session_2a.enrolled_in:
            assert entry.count == 1

    @pytest.mark.asyncio
    async def test_enrolled_in_aggregates_multiple_persons(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Two persons waitlisted for same session, both enrolled in Session 1 -> count=2."""
        session1 = sample_sessions[1001]
        session2a = sample_sessions[1003]
        # Emma (101) and Liam (102) both waitlisted for Session 2a, both enrolled in Session 1
        waitlisted_attendees = [
            create_mock_attendee(101, session2a, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(102, session2a, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, session1, status="enrolled", status_id=2, is_active=True),
            create_mock_attendee(102, session1, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        session_map = {s.session_cm_id: s for s in result.by_session}
        session_2a = session_map[1003]
        assert session_2a.has_enrollment == 2

        # enrolled_in should show Session 1 with count=2
        assert len(session_2a.enrolled_in) == 1
        assert session_2a.enrolled_in[0].session_cm_id == 1001
        assert session_2a.enrolled_in[0].count == 2

    @pytest.mark.asyncio
    async def test_no_enrollment_session_has_empty_enrolled_in(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person with no_enrollment -> enrolled_in is empty list."""
        session1 = sample_sessions[1001]
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted_attendees if status_filter == "waitlisted" else [])
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        session_map = {s.session_cm_id: s for s in result.by_session}
        session_1 = session_map[1001]
        assert session_1.no_enrollment == 1
        assert session_1.enrolled_in == []


# ============================================================================
# Bug A: Cross-type enrollment lookup
# ============================================================================


class TestCrossTypeEnrollment:
    """Bug fix: Camper waitlisted for quest + enrolled in main session
    should show has_enrollment with the main session in enrolled_in.

    Previously, filtering enrolled attendees to only the selected session type
    (e.g. "quest") would miss enrollments in other types (e.g. "main").
    """

    @pytest.mark.asyncio
    async def test_quest_waitlist_sees_main_session_enrollment(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_persons: dict[int, Mock],
    ) -> None:
        """Camper waitlisted for quest, enrolled in main session -> has_enrollment.

        Bug: When filtering to 'quest' session types, fetch_sessions only returns quest
        sessions. Enrolled attendees are then filtered against this subset, so enrollment
        in a main session is invisible. The fix should fetch ALL session types for
        enrollment lookup, using the type filter only for waitlist filtering.
        """
        # Create sessions: one main, one quest
        main_session = create_mock_session(1001, "Session 1", 2026, "main")
        quest_session = create_mock_session(2001, "Teen Quest", 2026, "quest", start_date="2026-06-10")
        all_sessions = {1001: main_session, 2001: quest_session}
        quest_only = {2001: quest_session}

        # Mock fetch_sessions to respect type filtering (this is how the real repo works)
        async def mock_fetch_sessions(year: int, types: list[str]) -> dict[int, Mock]:
            return {k: v for k, v in all_sessions.items() if v.session_type in types}

        # Emma (101) waitlisted for quest, enrolled in main
        waitlisted_attendees = [
            create_mock_attendee(101, quest_session, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, main_session, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        # Filter to quest sessions only (simulating "All Quests" dropdown)
        result = await waitlist_service.calculate_waitlist(year=2026, session_types=["quest"])

        # Person should show as has_enrollment (enrolled in main, even though filter is quest)
        assert result.waitlisted_has_enrollment == 1
        assert result.waitlisted_no_enrollment == 0

        # The session breakdown should show the main session in enrolled_in
        session_map = {s.session_cm_id: s for s in result.by_session}
        quest_breakdown = session_map[2001]
        assert quest_breakdown.has_enrollment == 1
        assert len(quest_breakdown.enrolled_in) == 1
        assert quest_breakdown.enrolled_in[0].session_cm_id == 1001
        assert quest_breakdown.enrolled_in[0].session_name == "Session 1"

    @pytest.mark.asyncio
    async def test_quest_waitlist_no_enrollment_anywhere(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_persons: dict[int, Mock],
    ) -> None:
        """Camper waitlisted for quest with no enrollment anywhere -> no_enrollment."""
        quest_session = create_mock_session(2001, "Teen Quest", 2026, "quest", start_date="2026-06-10")

        async def mock_fetch_sessions(year: int, types: list[str]) -> dict[int, Mock]:
            all_s = {2001: quest_session}
            return {k: v for k, v in all_s.items() if v.session_type in types}

        waitlisted_attendees = [
            create_mock_attendee(101, quest_session, status="waitlisted", status_id=8, is_active=False),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted_attendees if status_filter == "waitlisted" else [])
        )
        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_persons.return_value = {101: sample_persons[101]}
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026, session_types=["quest"])

        assert result.waitlisted_no_enrollment == 1
        assert result.waitlisted_has_enrollment == 0


# ============================================================================
# Bug B: Per-session deduplication for breakdown
# ============================================================================


class TestPerSessionDedup:
    """Bug fix: Person waitlisted in 2 sessions should contribute to BOTH
    session breakdowns, not just the first one processed.

    Previously, global dedup caused the second session to show 0 for both
    no_enrollment and has_enrollment while total (waitlisted) was correct.
    """

    @pytest.mark.asyncio
    async def test_person_waitlisted_two_sessions_both_show_counts(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in Session 1 AND Session 2 -> both session breakdowns show no_enrollment."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        # Emma (101) waitlisted in BOTH sessions, not enrolled anywhere
        waitlisted_attendees = [
            create_mock_attendee(101, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(101, session2, status="waitlisted", status_id=8, is_active=False),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted_attendees if status_filter == "waitlisted" else [])
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        session_map = {s.session_cm_id: s for s in result.by_session}

        # BOTH sessions should show no_enrollment = 1
        assert session_map[1001].no_enrollment == 1
        assert session_map[1002].no_enrollment == 1

        # Both should show waitlisted = 1
        assert session_map[1001].waitlisted == 1
        assert session_map[1002].waitlisted == 1

        # Summary should still deduplicate: only 1 unique person
        assert result.total_waitlisted == 1
        assert result.waitlisted_no_enrollment == 1

    @pytest.mark.asyncio
    async def test_person_waitlisted_two_sessions_enrolled_in_third(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in 2 sessions + enrolled in 3rd -> both show has_enrollment with enrolled_in."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        session2a = sample_sessions[1003]

        # Liam (102) waitlisted in Session 1 and Session 2, enrolled in Session 2a
        waitlisted_attendees = [
            create_mock_attendee(102, session1, status="waitlisted", status_id=8, is_active=False),
            create_mock_attendee(102, session2, status="waitlisted", status_id=8, is_active=False),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session2a, status="enrolled", status_id=2, is_active=True),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        session_map = {s.session_cm_id: s for s in result.by_session}

        # BOTH waitlisted sessions should show has_enrollment = 1
        assert session_map[1001].has_enrollment == 1
        assert session_map[1002].has_enrollment == 1

        # BOTH should have enrolled_in referencing Session 2a
        assert len(session_map[1001].enrolled_in) == 1
        assert session_map[1001].enrolled_in[0].session_cm_id == 1003
        assert len(session_map[1002].enrolled_in) == 1
        assert session_map[1002].enrolled_in[0].session_cm_id == 1003

        # Summary should still deduplicate: only 1 unique person
        assert result.total_waitlisted == 1
        assert result.waitlisted_has_enrollment == 1

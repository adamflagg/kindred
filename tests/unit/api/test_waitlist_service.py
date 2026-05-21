"""
Unit tests for the waitlist service.

These tests verify waitlist analysis logic for the four use cases:
- UC1: Currently waitlisted, no other enrolled summer sessions
- UC2: Currently waitlisted, has other enrolled summer sessions
- UC3: Previously waitlisted, accepted (now enrolled)
- UC4: Previously waitlisted, declined (cancelled/withdrawn/dismissed)
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.waitlist_service import WaitlistService
from tests.unit.api.conftest import (
    create_mock_attendee,
    create_mock_person,
    create_mock_session,
    create_mock_status_history,
)

# ============================================================================
# Test Data Factories
# ============================================================================


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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(103, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
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
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
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
            side_effect=lambda year, old_status, new_statuses: history if new_statuses == ["enrolled"] else []
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
            side_effect=lambda year, old_status, new_statuses: history if new_statuses == ["enrolled"] else []
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
            side_effect=lambda year, old_status, new_statuses: history if new_statuses == declined_statuses else []
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
            create_mock_attendee(
                101,
                session_cm_id=main_session.cm_id,
                session=main_session,
                status="waitlisted",
                status_id=8,
            ),
            create_mock_attendee(
                102,
                session_cm_id=ag_session.cm_id,
                session=ag_session,
                status="waitlisted",
                status_id=8,
            ),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026, session_types=["main", "embedded", "ag"])

        # Both should be counted (AG sessions are included in summer)
        assert result.total_waitlisted == 2

    @pytest.mark.asyncio
    async def test_ag_session_waitlist_merges_into_parent_in_by_session(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """AG session waitlist counts should merge into parent main session in by_session.

        Person waitlisted in AG Session 1 (parent=1001) should appear under
        Session 1 in the by_session breakdown, not as a separate AG entry.
        """
        ag_session = sample_sessions[1004]  # AG Session 1, parent_id=1001
        main_session = sample_sessions[1001]
        waitlisted_attendees = [
            create_mock_attendee(
                101,
                session_cm_id=main_session.cm_id,
                session=main_session,
                status="waitlisted",
                status_id=8,
            ),
            create_mock_attendee(
                102,
                session_cm_id=ag_session.cm_id,
                session=ag_session,
                status="waitlisted",
                status_id=8,
            ),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026)

        # AG session should NOT appear as a separate entry in by_session
        session_ids = {s.session_cm_id for s in result.by_session}
        assert 1004 not in session_ids, "AG session should be merged into parent, not shown separately"

        # Parent main session should have combined count (1 from main + 1 from AG)
        session_map = {s.session_cm_id: s for s in result.by_session}
        assert session_map[1001].waitlisted == 2


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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(103, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
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
            create_mock_attendee(
                101, session_cm_id=session2a.cm_id, session=session2a, status="waitlisted", status_id=8
            ),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="enrolled", status_id=2),
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
            create_mock_attendee(
                102, session_cm_id=session2a.cm_id, session=session2a, status="waitlisted", status_id=8
            ),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="enrolled", status_id=2),
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
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
            create_mock_attendee(
                101, session_cm_id=session2a.cm_id, session=session2a, status="waitlisted", status_id=8
            ),
            create_mock_attendee(
                102, session_cm_id=session2a.cm_id, session=session2a, status="waitlisted", status_id=8
            ),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="enrolled", status_id=2),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="enrolled", status_id=2),
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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
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

        # Mock fetch_sessions to respect type filtering (this is how the real repo works)
        async def mock_fetch_sessions(year: int, types: list[str]) -> dict[int, Mock]:
            return {k: v for k, v in all_sessions.items() if v.session_type in types}

        # Emma (101) waitlisted for quest, enrolled in main
        waitlisted_attendees = [
            create_mock_attendee(
                101,
                session_cm_id=quest_session.cm_id,
                session=quest_session,
                status="waitlisted",
                status_id=8,
            ),
        ]
        enrolled_attendees = [
            create_mock_attendee(
                101,
                session_cm_id=main_session.cm_id,
                session=main_session,
                status="enrolled",
                status_id=2,
            ),
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
            create_mock_attendee(
                101,
                session_cm_id=quest_session.cm_id,
                session=quest_session,
                status="waitlisted",
                status_id=8,
            ),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
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
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(101, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
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
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2a.cm_id, session=session2a, status="enrolled", status_id=2),
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


# ============================================================================
# Bug 1: _filter_to_sessions lets everything through
# ============================================================================


class TestFilterToSessionsBug:
    """Bug: _filter_to_sessions has `or session_cmid in sessions` which
    lets ALL attendees through even when valid_session_ids is narrowed.

    When session_cm_id is set, valid_session_ids is narrowed to just that
    one session, but the `or sessions` clause matches everything in
    filtered_sessions (which contains all type-filtered sessions).
    """

    @pytest.mark.asyncio
    async def test_session_cm_id_filter_narrows_waitlist_counts(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filtering to Session 1 should only count waitlisted attendees in Session 1."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        # Emma waitlisted in S1, Olivia waitlisted in S2
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(103, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        # Filter to Session 1 only
        result = await waitlist_service.calculate_waitlist(year=2026, session_cm_id=1001)

        # Should only count Emma (S1), NOT Olivia (S2)
        assert result.total_waitlisted == 1
        assert result.waitlisted_no_enrollment == 1

    @pytest.mark.asyncio
    async def test_session_cm_id_filter_narrows_session_breakdown(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Session breakdown should only contain the filtered session."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(103, session_cm_id=session2.cm_id, session=session2, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await waitlist_service.calculate_waitlist(year=2026, session_cm_id=1001)

        # by_session should only contain Session 1
        assert len(result.by_session) == 1
        assert result.by_session[0].session_cm_id == 1001


# ============================================================================
# Bug 2: Accepted/declined counts not session-filtered
# ============================================================================


class TestAcceptedDeclinedSessionFilter:
    """Bug: Accepted/declined history records are counted globally without
    checking valid_session_ids. When filtering to a specific session,
    accepted/declined numbers should only count transitions for that session.
    """

    @pytest.mark.asyncio
    async def test_accepted_filtered_by_session(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Accepted count should only include transitions for the filtered session."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        # Noah accepted from S1 waitlist, Ava accepted from S2 waitlist
        accepted_history = [
            create_mock_status_history(104, session1, sample_persons[104], "waitlisted", "enrolled"),
            create_mock_status_history(105, session2, sample_persons[105], "waitlisted", "enrolled"),
        ]

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: accepted_history if new_statuses == ["enrolled"] else []
        )

        # Filter to Session 1 only
        result = await waitlist_service.calculate_waitlist(year=2026, session_cm_id=1001)

        # Should only count Noah (S1), NOT Ava (S2)
        assert result.total_accepted == 1

    @pytest.mark.asyncio
    async def test_declined_filtered_by_session(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Declined count should only include transitions for the filtered session."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        declined_history = [
            create_mock_status_history(103, session1, sample_persons[103], "waitlisted", "cancelled"),
            create_mock_status_history(101, session2, sample_persons[101], "waitlisted", "withdrawn"),
        ]

        declined_statuses = ["cancelled", "withdrawn", "dismissed"]
        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: (
                declined_history if new_statuses == declined_statuses else []
            )
        )

        # Filter to Session 1 only
        result = await waitlist_service.calculate_waitlist(year=2026, session_cm_id=1001)

        # Should only count Olivia (S1), NOT Emma (S2)
        assert result.total_declined == 1

    @pytest.mark.asyncio
    async def test_accepted_declined_session_breakdown_filtered(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Per-session accepted/declined breakdown should respect session filter."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        accepted_history = [
            create_mock_status_history(104, session1, sample_persons[104], "waitlisted", "enrolled"),
            create_mock_status_history(105, session2, sample_persons[105], "waitlisted", "enrolled"),
        ]

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status, new_statuses: accepted_history if new_statuses == ["enrolled"] else []
        )

        # Filter to Session 1 only
        result = await waitlist_service.calculate_waitlist(year=2026, session_cm_id=1001)

        # by_session should only have Session 1 with accepted=1
        session_map = {s.session_cm_id: s for s in result.by_session}
        assert 1001 in session_map
        assert session_map[1001].accepted == 1
        # Session 2 should NOT appear in breakdown
        assert 1002 not in session_map


# ============================================================================
# Demographic Enrollment Split (grade/gender with no_enrollment/has_enrollment)
# ============================================================================


class TestDemographicEnrollmentSplit:
    """Test that grade and gender breakdowns include no_enrollment/has_enrollment counts.

    The _compute_demographics method should split each grade/gender bucket into
    persons who have other enrolled sessions vs those who don't.
    """

    @pytest.mark.asyncio
    async def test_grade_breakdown_includes_enrollment_split(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Grade breakdown should have no_enrollment and has_enrollment counts."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        # Emma (101, grade 5) waitlisted in S1, no enrollment
        # Liam (102, grade 6) waitlisted in S1, enrolled in S2
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        grade_map = {g.grade: g for g in result.by_grade}
        # Emma: grade 5, no enrollment
        assert grade_map[5].no_enrollment == 1
        assert grade_map[5].has_enrollment == 0
        assert grade_map[5].count == 1
        # Liam: grade 6, has enrollment
        assert grade_map[6].no_enrollment == 0
        assert grade_map[6].has_enrollment == 1
        assert grade_map[6].count == 1

    @pytest.mark.asyncio
    async def test_gender_breakdown_includes_enrollment_split(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Gender breakdown should have no_enrollment and has_enrollment counts."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        # Emma (101, F) waitlisted in S1, no enrollment
        # Liam (102, M) waitlisted in S1, enrolled in S2
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        gender_map = {g.gender: g for g in result.by_gender}
        # Emma: F, no enrollment
        assert gender_map["F"].no_enrollment == 1
        assert gender_map["F"].has_enrollment == 0
        assert gender_map["F"].count == 1
        # Liam: M, has enrollment
        assert gender_map["M"].no_enrollment == 0
        assert gender_map["M"].has_enrollment == 1
        assert gender_map["M"].count == 1

    @pytest.mark.asyncio
    async def test_mixed_enrollment_within_same_grade(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Same grade has both enrolled and non-enrolled persons."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        # Liam (102, grade 6) waitlisted, enrolled in S2
        # Ava (105, grade 6) waitlisted, no enrollment
        waitlisted_attendees = [
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(105, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        grade_map = {g.grade: g for g in result.by_grade}
        # Grade 6: Liam has enrollment, Ava does not
        assert grade_map[6].count == 2
        assert grade_map[6].no_enrollment == 1
        assert grade_map[6].has_enrollment == 1

    @pytest.mark.asyncio
    async def test_all_enrolled_edge_case(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """All waitlisted persons have enrollment -> no_enrollment is 0 for all."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        # Emma (101) and Liam (102) both waitlisted in S1, both enrolled in S2
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(101, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        for grade in result.by_grade:
            assert grade.no_enrollment == 0
            assert grade.has_enrollment == grade.count
        for gender in result.by_gender:
            assert gender.no_enrollment == 0
            assert gender.has_enrollment == gender.count

    @pytest.mark.asyncio
    async def test_none_enrolled_edge_case(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """No waitlisted persons have enrollment -> has_enrollment is 0 for all."""
        session1 = sample_sessions[1001]
        # Emma (101) and Liam (102) both waitlisted, neither enrolled
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted_attendees if status_filter == "waitlisted" else []
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        for grade in result.by_grade:
            assert grade.has_enrollment == 0
            assert grade.no_enrollment == grade.count
        for gender in result.by_gender:
            assert gender.has_enrollment == 0
            assert gender.no_enrollment == gender.count

    @pytest.mark.asyncio
    async def test_percentages_relative_to_total(
        self,
        waitlist_service: WaitlistService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Percentages should be relative to total waitlisted, not enrollment split."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]
        # 3 waitlisted: Emma (grade 5), Liam (grade 6), Ava (grade 6)
        waitlisted_attendees = [
            create_mock_attendee(101, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(102, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
            create_mock_attendee(105, session_cm_id=session1.cm_id, session=session1, status="waitlisted", status_id=8),
        ]
        enrolled_attendees = [
            create_mock_attendee(102, session_cm_id=session2.cm_id, session=session2, status="enrolled", status_id=2),
        ]

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted_attendees if status_filter == "waitlisted" else enrolled_attendees
            )
        )
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons

        result = await waitlist_service.calculate_waitlist(year=2026)

        grade_map = {g.grade: g for g in result.by_grade}
        # Grade 5: 1/3 = 33.3%
        assert grade_map[5].percentage == pytest.approx(33.3, abs=0.1)
        # Grade 6: 2/3 = 66.7%
        assert grade_map[6].percentage == pytest.approx(66.7, abs=0.1)


# ============================================================================
# Waitlist Duration Tests
# ============================================================================


def create_mock_attendee_with_dates(
    person_id: int,
    session: Mock,
    year: int = 2026,
    status: str = "enrolled",
    status_id: int = 2,
    enrollment_date: str | None = None,
    effective_date: str | None = None,
) -> Mock:
    """Create a mock attendee with enrollment_date and effective_date."""
    attendee = create_mock_attendee(
        person_id,
        session_cm_id=session.cm_id,
        year=year,
        status=status,
        status_id=status_id,
        session=session,
    )
    attendee.enrollment_date = enrollment_date
    attendee.effective_date = effective_date
    return attendee


class TestWaitlistDuration:
    """Tests for waitlist duration tracking (time between apply and accept/decline)."""

    @pytest.mark.asyncio
    async def test_accepted_waitlist_duration(self, waitlist_service, mock_repository, sample_sessions, sample_persons):
        """UC3: effective_date=Nov 18, enrollment_date=Feb 15 → 89 days."""
        session1 = sample_sessions[1001]

        # Person 101 was waitlisted, then accepted
        # effective_date = when they applied, enrollment_date = when accepted
        attendee = create_mock_attendee_with_dates(
            101, session1, status="enrolled", enrollment_date="2026-02-15", effective_date="2025-11-18"
        )

        history = [
            create_mock_status_history(
                101, session1, sample_persons[101], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: [attendee] if status_filter == "enrolled" else []
        )
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status=None, new_statuses=None: history if new_statuses == ["enrolled"] else []
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.avg_days_to_acceptance == pytest.approx(89.0, abs=1)
        assert result.median_days_to_acceptance == pytest.approx(89.0, abs=1)

    @pytest.mark.asyncio
    async def test_declined_waitlist_duration(self, waitlist_service, mock_repository, sample_sessions, sample_persons):
        """UC4: effective_date=Nov 20, enrollment_date=Mar 10 → 110 days.

        Declined persons have status cancelled/withdrawn/dismissed, so the attendee
        must be returned via the cancelled status_filter fetch, not the enrolled fetch.
        """
        session1 = sample_sessions[1001]

        attendee = create_mock_attendee_with_dates(
            102, session1, status="cancelled", enrollment_date="2026-03-10", effective_date="2025-11-20"
        )

        history = [
            create_mock_status_history(
                102, session1, sample_persons[102], old_status="waitlisted", new_status="cancelled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                [attendee] if isinstance(status_filter, list) and "cancelled" in status_filter else []
            )
        )
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status=None, new_statuses=None: (
                history if new_statuses and "cancelled" in new_statuses else []
            )
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.avg_days_to_decline == pytest.approx(110.0, abs=1)
        assert result.median_days_to_decline == pytest.approx(110.0, abs=1)

    @pytest.mark.asyncio
    async def test_waitlist_duration_missing_effective_date(
        self, waitlist_service, mock_repository, sample_sessions, sample_persons
    ):
        """Skip records without effective_date — duration stats are None."""
        session1 = sample_sessions[1001]

        # No effective_date set
        attendee = create_mock_attendee_with_dates(
            101, session1, status="enrolled", enrollment_date="2026-02-15", effective_date=None
        )

        history = [
            create_mock_status_history(
                101, session1, sample_persons[101], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: [attendee] if status_filter == "enrolled" else []
        )
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status=None, new_statuses=None: history if new_statuses == ["enrolled"] else []
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        assert result.avg_days_to_acceptance is None
        assert result.median_days_to_acceptance is None

    @pytest.mark.asyncio
    async def test_waitlist_duration_stats(self, waitlist_service, mock_repository, sample_sessions, sample_persons):
        """Avg/median computed correctly with multiple accepted records."""
        session1 = sample_sessions[1001]

        # Two accepted: 89 days and 120 days
        att1 = create_mock_attendee_with_dates(
            101,
            session1,
            status="enrolled",
            enrollment_date="2026-02-15",
            effective_date="2025-11-18",  # 89 days
        )
        att2 = create_mock_attendee_with_dates(
            102,
            session1,
            status="enrolled",
            enrollment_date="2026-03-18",
            effective_date="2025-11-18",  # 120 days
        )

        history = [
            create_mock_status_history(
                101, session1, sample_persons[101], old_status="waitlisted", new_status="enrolled"
            ),
            create_mock_status_history(
                102, session1, sample_persons[102], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: [att1, att2] if status_filter == "enrolled" else []
        )
        mock_repository.fetch_status_history = AsyncMock(
            side_effect=lambda year, old_status=None, new_statuses=None: history if new_statuses == ["enrolled"] else []
        )

        result = await waitlist_service.calculate_waitlist(year=2026)

        # avg of 89 and 120 = 104.5
        assert result.avg_days_to_acceptance == pytest.approx(104.5, abs=1)
        # median of [89, 120] = 104.5
        assert result.median_days_to_acceptance == pytest.approx(104.5, abs=1)

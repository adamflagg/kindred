"""Tests for CancellationService - cancellation analysis metrics.

Tests business logic for:
- was_enrolled / was_waitlisted classification from status history
- has_other_sessions / no_other_sessions cross-reference
- re-enrolled count (cancelled -> enrolled transitions)
- AG session merging into parent
- Session filtering via session_cm_id
- Demographics breakdowns (grade, gender) with was_enrolled/was_waitlisted splits
- Empty data returns zeros
- Person deduplication across sessions
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

# ============================================================================
# Helpers
# ============================================================================


def _make_session(cm_id: int, name: str, session_type: str = "main", parent_id: int = 0) -> MagicMock:
    """Create a mock session record."""
    s = MagicMock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = parent_id
    return s


def _make_attendee(
    person_id: int,
    session_cm_id: int,
    session_name: str,
    status: str = "cancelled",
    enrollment_date: str | None = None,
) -> MagicMock:
    """Create a mock attendee record with expand.session."""
    att = MagicMock()
    att.person_id = person_id
    att.status = status
    att.enrollment_date = enrollment_date
    session = MagicMock()
    session.cm_id = session_cm_id
    session.name = session_name
    session.session_type = "main"
    att.expand = {"session": session}
    return att


def _make_person(cm_id: int, gender: str = "M", grade: int | None = 5, years_at_camp: int = 1) -> MagicMock:
    """Create a mock person record."""
    p = MagicMock()
    p.cm_id = cm_id
    p.gender = gender
    p.grade = grade
    p.years_at_camp = years_at_camp
    p.normalized_school = None
    p.normalized_city = None
    p.normalized_congregation = None
    p.address_city = None
    p.address_state = None
    return p


def _make_history_record(
    person_id: int,
    session_cm_id: int,
    session_name: str,
    old_status: str,
    new_status: str,
) -> MagicMock:
    """Create a mock status history record with expand.session."""
    rec = MagicMock()
    rec.person_id = person_id
    rec.old_status = old_status
    rec.new_status = new_status
    session = MagicMock()
    session.cm_id = session_cm_id
    session.name = session_name
    session.session_type = "main"
    rec.expand = {"session": session}
    return rec


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repo() -> AsyncMock:
    """Create a mock MetricsRepository."""
    repo = AsyncMock()
    # Default: return empty data
    repo.fetch_sessions.return_value = {}
    repo.fetch_attendees.return_value = []
    repo.fetch_persons.return_value = {}
    repo.fetch_status_history.return_value = []
    return repo


@pytest_asyncio.fixture
async def service(mock_repo: AsyncMock) -> Any:
    """Create CancellationService with mocked repository."""
    from api.services.cancellation_service import CancellationService

    return CancellationService(mock_repo)


# ============================================================================
# Empty data
# ============================================================================


class TestEmptyData:
    """Tests for empty/zero data handling."""

    @pytest.mark.asyncio
    async def test_empty_data_returns_zeros(self, service: Any, mock_repo: AsyncMock) -> None:
        """All counts should be zero when there are no cancelled attendees."""
        result = await service.calculate_cancellations(year=2025)

        assert result.year == 2025
        assert result.total_cancelled == 0
        assert result.was_enrolled == 0
        assert result.was_waitlisted == 0
        assert result.has_other_sessions == 0
        assert result.no_other_sessions == 0
        assert result.total_re_enrolled == 0
        assert result.by_session == []
        assert result.by_grade == []
        assert result.by_gender == []


# ============================================================================
# Core cancellation counts
# ============================================================================


class TestCancellationCounts:
    """Tests for was_enrolled / was_waitlisted classification."""

    @pytest.fixture
    def setup_basic_data(self, mock_repo: AsyncMock) -> None:
        """Set up basic test data with cancelled attendees and status history."""
        sessions = {
            1001: _make_session(1001, "Session 1"),
            1002: _make_session(1002, "Session 2"),
        }
        mock_repo.fetch_sessions.return_value = sessions

        # 3 cancelled attendees
        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "withdrawn"),
            _make_attendee(103, 1002, "Session 2", "dismissed"),
        ]

        # 1 enrolled attendee (person 101 is still in another session)
        enrolled = [
            _make_attendee(101, 1002, "Session 2", "enrolled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if status_filter == "enrolled" or status_filter == ["enrolled"]:
                return enrolled
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        # Status history: all transitions to cancelled in single call
        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(103, 1002, "Session 2", "enrolled", "dismissed"),
            _make_history_record(102, 1001, "Session 1", "waitlisted", "withdrawn"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            if old_status == "cancelled" and new_statuses and "enrolled" in new_statuses:
                return []  # no re-enrollments
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect

        persons = {
            101: _make_person(101, "F", 5),
            102: _make_person(102, "M", 6),
            103: _make_person(103, "F", 7),
        }
        mock_repo.fetch_persons.return_value = persons

    @pytest.mark.asyncio
    async def test_total_cancelled(self, service: Any, setup_basic_data: None) -> None:
        """Total cancelled = unique persons with cancelled/withdrawn/dismissed status."""
        result = await service.calculate_cancellations(year=2025)
        assert result.total_cancelled == 3

    @pytest.mark.asyncio
    async def test_was_enrolled_count(self, service: Any, setup_basic_data: None) -> None:
        """was_enrolled counts persons whose prior status was enrolled."""
        result = await service.calculate_cancellations(year=2025)
        # persons 101, 103 had enrolled -> cancelled transitions
        assert result.was_enrolled == 2

    @pytest.mark.asyncio
    async def test_was_waitlisted_count(self, service: Any, setup_basic_data: None) -> None:
        """was_waitlisted counts persons whose prior status was waitlisted."""
        result = await service.calculate_cancellations(year=2025)
        # person 102 had waitlisted -> withdrawn transition
        assert result.was_waitlisted == 1

    @pytest.mark.asyncio
    async def test_has_other_sessions(self, service: Any, setup_basic_data: None) -> None:
        """has_other_sessions = cancelled but still enrolled in another session."""
        result = await service.calculate_cancellations(year=2025)
        # person 101 is cancelled in session 1 but enrolled in session 2
        assert result.has_other_sessions == 1

    @pytest.mark.asyncio
    async def test_no_other_sessions(self, service: Any, setup_basic_data: None) -> None:
        """no_other_sessions = cancelled with no remaining enrollment."""
        result = await service.calculate_cancellations(year=2025)
        # persons 102, 103 are cancelled with no other enrollment
        assert result.no_other_sessions == 2


# ============================================================================
# Re-enrolled count
# ============================================================================


class TestReEnrolled:
    """Tests for cancelled -> enrolled transitions (recovery)."""

    @pytest.mark.asyncio
    async def test_re_enrolled_count(self, service: Any, mock_repo: AsyncMock) -> None:
        """re_enrolled counts persons who cancelled then later re-enrolled."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions
        mock_repo.fetch_attendees.return_value = []
        mock_repo.fetch_persons.return_value = {}

        # Status history: 2 people went cancelled -> enrolled
        re_enrolled_history = [
            _make_history_record(201, 1001, "Session 1", "cancelled", "enrolled"),
            _make_history_record(202, 1001, "Session 1", "cancelled", "enrolled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status == "cancelled" and new_statuses and "enrolled" in new_statuses:
                return re_enrolled_history
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect

        result = await service.calculate_cancellations(year=2025)
        assert result.total_re_enrolled == 2

    @pytest.mark.asyncio
    async def test_re_enrolled_deduplicates_by_person(self, service: Any, mock_repo: AsyncMock) -> None:
        """Re-enrolled should be unique by person, not by record."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions
        mock_repo.fetch_attendees.return_value = []
        mock_repo.fetch_persons.return_value = {}

        # Same person re-enrolled twice (different sessions)
        re_enrolled_history = [
            _make_history_record(201, 1001, "Session 1", "cancelled", "enrolled"),
            _make_history_record(201, 1001, "Session 1", "cancelled", "enrolled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status == "cancelled" and new_statuses and "enrolled" in new_statuses:
                return re_enrolled_history
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect

        result = await service.calculate_cancellations(year=2025)
        assert result.total_re_enrolled == 1


# ============================================================================
# Session breakdown
# ============================================================================


class TestSessionBreakdown:
    """Tests for per-session cancellation breakdown."""

    @pytest.mark.asyncio
    async def test_by_session_breakdown(self, service: Any, mock_repo: AsyncMock) -> None:
        """Per-session breakdown should have correct counts."""
        sessions = {
            1001: _make_session(1001, "Session 1"),
            1002: _make_session(1002, "Session 2"),
        }
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
            _make_attendee(103, 1002, "Session 2", "cancelled"),
        ]
        enrolled = [_make_attendee(101, 1002, "Session 2", "enrolled")]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if status_filter == "enrolled" or status_filter == ["enrolled"]:
                return enrolled
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        # Person 101: enrolled -> cancelled, Person 102: waitlisted -> cancelled
        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "waitlisted", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
            103: _make_person(103),
        }

        result = await service.calculate_cancellations(year=2025)
        assert len(result.by_session) == 2

        s1 = next(s for s in result.by_session if s.session_cm_id == 1001)
        assert s1.total_cancelled == 2
        assert s1.was_enrolled == 1
        assert s1.was_waitlisted == 1

        s2 = next(s for s in result.by_session if s.session_cm_id == 1002)
        assert s2.total_cancelled == 1


# ============================================================================
# AG session merging
# ============================================================================


class TestAGMerging:
    """Tests for AG session counts merging into parent."""

    @pytest.mark.asyncio
    async def test_ag_sessions_merge_into_parent(self, service: Any, mock_repo: AsyncMock) -> None:
        """AG session cancellation counts should merge into parent main session."""
        sessions = {
            1001: _make_session(1001, "Session 1", "main"),
            1010: _make_session(1010, "Session 1 AG", "ag", parent_id=1001),
        }
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1010, "Session 1 AG", "cancelled"),
        ]
        # Manually set AG session type on attendee 102
        cancelled[1].expand["session"].session_type = "ag"
        cancelled[1].expand["session"].parent_id = 1001

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect
        mock_repo.fetch_status_history.return_value = []
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
        }

        result = await service.calculate_cancellations(year=2025)

        # Should have only 1 session entry (AG merged into parent)
        assert len(result.by_session) == 1
        assert result.by_session[0].session_cm_id == 1001
        assert result.by_session[0].total_cancelled == 2


# ============================================================================
# Session filtering
# ============================================================================


class TestSessionFiltering:
    """Tests for session_cm_id filtering."""

    @pytest.mark.asyncio
    async def test_filter_by_session_cm_id(self, service: Any, mock_repo: AsyncMock) -> None:
        """When session_cm_id is provided, only that session's data should appear."""
        sessions = {
            1001: _make_session(1001, "Session 1"),
            1002: _make_session(1002, "Session 2"),
        }
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1002, "Session 2", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect
        mock_repo.fetch_status_history.return_value = []
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
        }

        result = await service.calculate_cancellations(year=2025, session_cm_id=1001)

        assert result.total_cancelled == 1
        assert len(result.by_session) == 1
        assert result.by_session[0].session_cm_id == 1001


# ============================================================================
# Demographics (grade/gender with was_enrolled/was_waitlisted splits)
# ============================================================================


class TestDemographics:
    """Tests for grade and gender breakdowns with enrollment split."""

    @pytest.fixture
    def setup_demographics(self, mock_repo: AsyncMock) -> None:
        """Set up data for demographics testing."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
            _make_attendee(103, 1001, "Session 1", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        # 101,103 were enrolled before cancelling, 102 was waitlisted
        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(103, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "waitlisted", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect

        persons = {
            101: _make_person(101, "F", 5),
            102: _make_person(102, "M", 5),
            103: _make_person(103, "F", 7),
        }
        mock_repo.fetch_persons.return_value = persons

    @pytest.mark.asyncio
    async def test_grade_breakdown_with_splits(self, service: Any, setup_demographics: None) -> None:
        """Grade breakdown should include was_enrolled/was_waitlisted splits."""
        result = await service.calculate_cancellations(year=2025)

        assert len(result.by_grade) > 0
        grade_5 = next((g for g in result.by_grade if g.grade == 5), None)
        assert grade_5 is not None
        assert grade_5.count == 2
        assert grade_5.was_enrolled == 1  # person 101
        assert grade_5.was_waitlisted == 1  # person 102

    @pytest.mark.asyncio
    async def test_gender_breakdown_with_splits(self, service: Any, setup_demographics: None) -> None:
        """Gender breakdown should include was_enrolled/was_waitlisted splits."""
        result = await service.calculate_cancellations(year=2025)

        assert len(result.by_gender) > 0
        female = next((g for g in result.by_gender if g.gender == "F"), None)
        assert female is not None
        assert female.count == 2  # persons 101, 103
        assert female.was_enrolled == 2  # both were enrolled

        male = next((g for g in result.by_gender if g.gender == "M"), None)
        assert male is not None
        assert male.count == 1  # person 102
        assert male.was_waitlisted == 1


# ============================================================================
# Deduplication
# ============================================================================


class TestDeduplication:
    """Tests for person deduplication across sessions."""

    @pytest.mark.asyncio
    async def test_person_cancelled_in_multiple_sessions(self, service: Any, mock_repo: AsyncMock) -> None:
        """A person cancelled in 2 sessions should count as 1 in summary."""
        sessions = {
            1001: _make_session(1001, "Session 1"),
            1002: _make_session(1002, "Session 2"),
        }
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(101, 1002, "Session 2", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect
        mock_repo.fetch_status_history.return_value = []
        mock_repo.fetch_persons.return_value = {101: _make_person(101)}

        result = await service.calculate_cancellations(year=2025)

        # Summary: unique person count = 1
        assert result.total_cancelled == 1
        # Per-session: each session gets its own count
        assert len(result.by_session) == 2
        assert result.by_session[0].total_cancelled == 1
        assert result.by_session[1].total_cancelled == 1


# ============================================================================
# Prior status: was_applied + other_prior_status
# ============================================================================


class TestPriorStatusClassification:
    """Tests for classifying all prior statuses (enrolled, waitlisted, applied, other)."""

    @pytest.mark.asyncio
    async def test_was_applied_summary(self, service: Any, mock_repo: AsyncMock) -> None:
        """Persons with applied->cancelled should be counted as was_applied."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "applied", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "enrolled", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
        }

        result = await service.calculate_cancellations(year=2025)
        assert result.was_applied == 1
        assert result.was_enrolled == 1

    @pytest.mark.asyncio
    async def test_was_applied_per_session(self, service: Any, mock_repo: AsyncMock) -> None:
        """was_applied should be tracked per session in by_session breakdown."""
        sessions = {
            1001: _make_session(1001, "Session 1"),
            1002: _make_session(1002, "Session 2"),
        }
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1002, "Session 2", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "applied", "cancelled"),
            _make_history_record(102, 1002, "Session 2", "enrolled", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
        }

        result = await service.calculate_cancellations(year=2025)
        s1 = next(s for s in result.by_session if s.session_cm_id == 1001)
        assert s1.was_applied == 1
        assert s1.was_enrolled == 0

        s2 = next(s for s in result.by_session if s.session_cm_id == 1002)
        assert s2.was_applied == 0
        assert s2.was_enrolled == 1

    @pytest.mark.asyncio
    async def test_other_prior_status_groups_minor_statuses(self, service: Any, mock_repo: AsyncMock) -> None:
        """inquiry, incomplete, none, left_early should be grouped as other_prior_status."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
            _make_attendee(103, 1001, "Session 1", "cancelled"),
            _make_attendee(104, 1001, "Session 1", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "inquiry", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "incomplete", "cancelled"),
            _make_history_record(103, 1001, "Session 1", "none", "cancelled"),
            _make_history_record(104, 1001, "Session 1", "left_early", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
            103: _make_person(103),
            104: _make_person(104),
        }

        result = await service.calculate_cancellations(year=2025)
        assert result.other_prior_status == 4
        assert result.was_enrolled == 0
        assert result.was_waitlisted == 0
        assert result.was_applied == 0

        # Per-session too
        s1 = result.by_session[0]
        assert s1.other_prior_status == 4

    @pytest.mark.asyncio
    async def test_all_prior_statuses_together(self, service: Any, mock_repo: AsyncMock) -> None:
        """All four prior status categories should work together in one response."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
            _make_attendee(103, 1001, "Session 1", "cancelled"),
            _make_attendee(104, 1001, "Session 1", "cancelled"),
            _make_attendee(105, 1001, "Session 1", "cancelled"),  # no history
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "waitlisted", "cancelled"),
            _make_history_record(103, 1001, "Session 1", "applied", "cancelled"),
            _make_history_record(104, 1001, "Session 1", "inquiry", "cancelled"),
            # person 105 has no status history (pre-launch cancellation)
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101),
            102: _make_person(102),
            103: _make_person(103),
            104: _make_person(104),
            105: _make_person(105),
        }

        result = await service.calculate_cancellations(year=2025)
        assert result.total_cancelled == 5
        assert result.was_enrolled == 1
        assert result.was_waitlisted == 1
        assert result.was_applied == 1
        assert result.other_prior_status == 1
        # person 105 has no history - not counted in any prior status bucket

        # Per-session breakdown
        s1 = result.by_session[0]
        assert s1.total_cancelled == 5
        assert s1.was_enrolled == 1
        assert s1.was_waitlisted == 1
        assert s1.was_applied == 1
        assert s1.other_prior_status == 1

    @pytest.mark.asyncio
    async def test_empty_data_includes_new_fields(self, service: Any, mock_repo: AsyncMock) -> None:
        """Empty response should have was_applied=0 and other_prior_status=0."""
        result = await service.calculate_cancellations(year=2025)
        assert result.was_applied == 0
        assert result.other_prior_status == 0

    @pytest.mark.asyncio
    async def test_demographics_include_all_prior_statuses(self, service: Any, mock_repo: AsyncMock) -> None:
        """Grade and gender breakdowns should include was_applied and other_prior_status splits."""
        sessions = {1001: _make_session(1001, "Session 1")}
        mock_repo.fetch_sessions.return_value = sessions

        cancelled = [
            _make_attendee(101, 1001, "Session 1", "cancelled"),
            _make_attendee(102, 1001, "Session 1", "cancelled"),
            _make_attendee(103, 1001, "Session 1", "cancelled"),
            _make_attendee(104, 1001, "Session 1", "cancelled"),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: Any = None) -> list[Any]:
            if isinstance(status_filter, list) and "cancelled" in status_filter:
                return cancelled
            return []

        mock_repo.fetch_attendees.side_effect = fetch_attendees_side_effect

        all_to_cancelled = [
            _make_history_record(101, 1001, "Session 1", "enrolled", "cancelled"),
            _make_history_record(102, 1001, "Session 1", "waitlisted", "cancelled"),
            _make_history_record(103, 1001, "Session 1", "applied", "cancelled"),
            _make_history_record(104, 1001, "Session 1", "inquiry", "cancelled"),
        ]

        async def fetch_history_side_effect(
            year: int, old_status: str | None = None, new_statuses: list[str] | None = None
        ) -> list[Any]:
            if old_status is None:
                return all_to_cancelled
            return []

        mock_repo.fetch_status_history.side_effect = fetch_history_side_effect

        # All same grade and gender so we can check the splits simply
        mock_repo.fetch_persons.return_value = {
            101: _make_person(101, "F", 5),
            102: _make_person(102, "F", 5),
            103: _make_person(103, "F", 5),
            104: _make_person(104, "F", 5),
        }

        result = await service.calculate_cancellations(year=2025)

        # Grade breakdown
        grade_5 = next(g for g in result.by_grade if g.grade == 5)
        assert grade_5.count == 4
        assert grade_5.was_enrolled == 1
        assert grade_5.was_waitlisted == 1
        assert grade_5.was_applied == 1
        assert grade_5.other_prior_status == 1

        # Gender breakdown
        female = next(g for g in result.by_gender if g.gender == "F")
        assert female.count == 4
        assert female.was_enrolled == 1
        assert female.was_waitlisted == 1
        assert female.was_applied == 1
        assert female.other_prior_status == 1

"""
Unit tests for cancellation timing and session swap detection.

Tests verify:
- Session swap detection (cancel Session A, enroll in Session B within 1 day)
- True departure detection (cancel with no other enrollment)
- Time-to-cancellation calculation (days between effective_date and enrollment_date)
- Time-to-cancellation distribution buckets
- Registration month breakdown (cancellations grouped by effective_date month)
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.cancellation_service import CancellationService
from tests.unit.api.conftest import (
    create_mock_attendee,
    create_mock_person,
    create_mock_session,
)

# ============================================================================
# Test Data Factories
# ============================================================================


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository."""
    repo = Mock()
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_persons = AsyncMock(return_value={})
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_status_history = AsyncMock(return_value=[])
    return repo


@pytest.fixture
def cancellation_service(mock_repository):
    """Create a CancellationService with mock repository."""
    return CancellationService(mock_repository)


@pytest.fixture
def sample_sessions() -> dict[int, Mock]:
    """Sample sessions for 2026."""
    return {
        1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
        1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
        1003: create_mock_session(1003, "Session 3", 2026, "main", "2026-07-27", "2026-08-16"),
    }


@pytest.fixture
def sample_persons() -> dict[int, Mock]:
    """Sample persons."""
    return {
        101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
        103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=2),
        104: create_mock_person(104, "Noah", "Williams", "M", 5, years_at_camp=1),
        105: create_mock_person(105, "Ava", "Brown", "F", 6, years_at_camp=2),
    }


# ============================================================================
# Session Swap Detection Tests
# ============================================================================


class TestSessionSwapDetection:
    """Tests for session swap detection in cancellation metrics."""

    @pytest.mark.asyncio
    async def test_session_swap_detection_same_day(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Cancel from Session 1, enroll in Session 2 same PostDate → flagged as session swap."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        # Emma cancelled from Session 1 and enrolled in Session 2 same day
        cancelled = [
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
        ]
        enrolled = [
            create_mock_attendee(
                101,
                session_cm_id=session2.cm_id,
                session=session2,
                status="enrolled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else enrolled
            )
        )
        # No status transitions for prior status — just need the main flow
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        assert result.session_swap_count == 1
        assert result.true_departure_count == 0

    @pytest.mark.asyncio
    async def test_session_swap_detection_one_day_offset(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """1-day window between cancel and enroll still flagged as session swap."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        cancelled = [
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
        ]
        enrolled = [
            create_mock_attendee(
                101,
                session_cm_id=session2.cm_id,
                session=session2,
                status="enrolled",
                enrollment_date="2026-02-16",
                effective_date="2025-11-10",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else enrolled
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        assert result.session_swap_count == 1
        assert result.true_departure_count == 0

    @pytest.mark.asyncio
    async def test_session_swap_vs_true_departure(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """No enrolled records for a cancelled person → true departure."""
        session1 = sample_sessions[1001]

        cancelled = [
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
        ]
        # No enrolled attendees at all
        enrolled: list[Mock] = []

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else enrolled
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        assert result.session_swap_count == 0
        assert result.true_departure_count == 1


# ============================================================================
# Time-to-Cancellation Tests
# ============================================================================


class TestTimeToCancellation:
    """Tests for time-to-cancellation calculation."""

    @pytest.mark.asyncio
    async def test_time_to_cancellation_calculation(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Avg/median days between effective_date (registration) and enrollment_date (cancellation)."""
        session1 = sample_sessions[1001]

        # Emma: registered Nov 10, cancelled Feb 15 → 97 days
        # Liam: registered Nov 15, cancelled Mar 10 → 115 days
        cancelled = [
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
            create_mock_attendee(
                102,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-03-10",
                effective_date="2025-11-15",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else []
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        # avg of 97 and 115 = 106
        assert result.avg_days_to_cancellation == pytest.approx(106.0, abs=1)
        # median of [97, 115] = 106
        assert result.median_days_to_cancellation == pytest.approx(106.0, abs=1)

    @pytest.mark.asyncio
    async def test_time_to_cancellation_distribution_buckets(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Time-to-cancellation bucketed into <30d, 30-90d, 90-180d, 180d+."""
        session1 = sample_sessions[1001]

        cancelled = [
            # 20 days → <30d bucket
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2025-12-01",
                effective_date="2025-11-11",
            ),
            # 60 days → 30-90d bucket
            create_mock_attendee(
                102,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-01-10",
                effective_date="2025-11-11",
            ),
            # 120 days → 90-180d bucket
            create_mock_attendee(
                103,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-03-11",
                effective_date="2025-11-11",
            ),
            # 200 days → 180d+ bucket
            create_mock_attendee(
                104,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-05-30",
                effective_date="2025-11-11",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else []
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        bucket_map = {b.label: b.count for b in result.time_to_cancellation_buckets}
        assert bucket_map.get("< 30 days") == 1
        assert bucket_map.get("30–90 days") == 1
        assert bucket_map.get("90–180 days") == 1
        assert bucket_map.get("180+ days") == 1

    @pytest.mark.asyncio
    async def test_session_swap_excluded_from_timing(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Session swaps are excluded from time-to-cancellation stats."""
        session1 = sample_sessions[1001]
        session2 = sample_sessions[1002]

        # Emma: session swap (cancel + enroll same day)
        # Liam: true departure (90 days)
        cancelled = [
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
            create_mock_attendee(
                102,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-10",
                effective_date="2025-11-12",
            ),
        ]
        enrolled = [
            # Emma enrolled in Session 2 same day as cancel → swap
            create_mock_attendee(
                101,
                session_cm_id=session2.cm_id,
                session=session2,
                status="enrolled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else enrolled
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        # Only Liam's timing included (90 days), not Emma's swap
        assert result.avg_days_to_cancellation == pytest.approx(90.0, abs=1)
        assert result.median_days_to_cancellation == pytest.approx(90.0, abs=1)


# ============================================================================
# Registration Month Breakdown Tests
# ============================================================================


class TestRegistrationMonthBreakdown:
    """Tests for registration month breakdown of cancellations."""

    @pytest.mark.asyncio
    async def test_registration_month_breakdown(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Cancellations grouped by effective_date month."""
        session1 = sample_sessions[1001]

        cancelled = [
            # 2 from November registration
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-02-15",
                effective_date="2025-11-10",
            ),
            create_mock_attendee(
                102,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-03-10",
                effective_date="2025-11-20",
            ),
            # 1 from December registration
            create_mock_attendee(
                103,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-04-01",
                effective_date="2025-12-05",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else []
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        month_map = {m.month: m.count for m in result.by_registration_month}
        assert month_map.get("Nov 2025") == 2
        assert month_map.get("Dec 2025") == 1

    @pytest.mark.asyncio
    async def test_registration_month_chronological_sort(
        self, cancellation_service, mock_repository, sample_sessions, sample_persons
    ):
        """Registration months must be in chronological order, not alphabetical."""
        session1 = sample_sessions[1001]

        cancelled = [
            # Mar 2025 registration
            create_mock_attendee(
                101,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-06-15",
                effective_date="2025-03-10",
            ),
            # Jan 2026 registration
            create_mock_attendee(
                102,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-06-20",
                effective_date="2026-01-05",
            ),
            # Nov 2025 registration
            create_mock_attendee(
                103,
                session_cm_id=session1.cm_id,
                session=session1,
                status="cancelled",
                enrollment_date="2026-06-25",
                effective_date="2025-11-15",
            ),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else []
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026)

        # Months must be chronologically ordered: Mar 2025 → Nov 2025 → Jan 2026
        months = [m.month for m in result.by_registration_month]
        assert months == ["Mar 2025", "Nov 2025", "Jan 2026"]


class TestTeenCrossSessionEnrollment:
    """A cancelled teen who is still enrolled in another teen session must count
    as 'has other sessions', not a true departure. The cross-session enrollment
    lookup has to span teen programs (SCIT/TLI), not just summer-camp types.
    """

    @pytest.mark.asyncio
    async def test_teen_kept_in_other_teen_session_counts_as_has_other(
        self, cancellation_service, mock_repository, sample_persons
    ):
        scit = create_mock_session(2001, "SCIT", 2026, "scit", "2026-06-15", "2026-07-05")
        tli = create_mock_session(2002, "TLI", 2026, "tli", "2026-06-15", "2026-07-05")
        summer_sessions = {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
        }
        teen_sessions = {2001: scit, 2002: tli}

        # Olivia (103) cancelled SCIT but is still enrolled in TLI.
        cancelled = [
            create_mock_attendee(
                103,
                session_cm_id=scit.cm_id,
                session=scit,
                status="cancelled",
                effective_date="2026-01-10",
            ),
        ]
        enrolled = [
            create_mock_attendee(
                103,
                session_cm_id=tli.cm_id,
                session=tli,
                status="enrolled",
                effective_date="2025-11-10",
            ),
        ]

        def fetch_sessions_side_effect(year, session_types=None):
            requested = set(session_types or [])
            # Teen-only requests (the teen-enrollment lookup and the Teens filter)
            # resolve to teen sessions; everything else is summer camp.
            if requested and requested <= {"scit", "tli"}:
                return teen_sessions
            return summer_sessions

        mock_repository.fetch_sessions = AsyncMock(side_effect=fetch_sessions_side_effect)
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                cancelled if status_filter == ["cancelled", "withdrawn", "dismissed"] else enrolled
            )
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await cancellation_service.calculate_cancellations(year=2026, session_types=["scit", "tli"])

        assert result.has_other_sessions == 1
        assert result.no_other_sessions == 0

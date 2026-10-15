"""Tests for HistoricalService - TDD tests written first.

These tests define the expected behavior of the HistoricalService.
The service MUST use attendees+persons (not camper_history) for metrics.
Implementation must conform to these tests, not the other way around.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.metrics_repository import MetricsRepository


def make_mock_person(
    cm_id: int,
    gender: str,
    years_at_camp: int = 1,
) -> MagicMock:
    """Create a mock person record."""
    person = MagicMock()
    person.cm_id = cm_id
    person.gender = gender
    person.years_at_camp = years_at_camp
    return person


def make_mock_attendee(
    person_id: int,
    session_cm_id: int,
    session_name: str = "Session 1",
    session_type: str = "main",
) -> MagicMock:
    """Create a mock attendee record with session expand."""
    attendee = MagicMock()
    attendee.person_id = person_id

    session = MagicMock()
    session.cm_id = session_cm_id
    session.name = session_name
    session.session_type = session_type

    attendee.expand = {"session": session}
    return attendee


def make_mock_transition(
    person_id: int,
    session_cm_id: int,
    session_type: str = "main",
    new_status: str = "cancelled",
) -> MagicMock:
    """Create a mock attendee_status_history transition with session expand.

    Shaped identically to make_mock_attendee's expand so the same
    session-scoping helper (filter_attendees_by_session) can filter both.
    """
    transition = MagicMock()
    transition.person_id = person_id
    transition.new_status = new_status

    session = MagicMock()
    session.cm_id = session_cm_id
    session.session_type = session_type

    transition.expand = {"session": session}
    return transition


def make_mock_session(
    cm_id: int,
    name: str,
    session_type: str = "main",
    parent_id: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> MagicMock:
    """Create a mock session record."""
    session = MagicMock()
    session.cm_id = cm_id
    session.name = name
    session.session_type = session_type
    session.parent_id = parent_id
    session.start_date = start_date
    session.end_date = end_date
    return session


def _make_repo_with_defaults() -> MagicMock:
    """Create a mock MetricsRepository with safe defaults for all methods."""
    repo = MagicMock(spec=MetricsRepository)
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_persons = AsyncMock(return_value={})
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_status_transitions = AsyncMock(return_value=[])
    repo.fetch_status_history = AsyncMock(return_value=[])
    return repo


def _route_attendees(
    repo: MagicMock,
    enrolled_by_year: dict[int, list[Any]],
    cancelled_by_year: dict[int, list[Any]],
) -> None:
    """fetch_attendees answers by status: "cancelled" gets the cancelled list, else enrolled."""

    async def fetch_attendees(year: int, status_filter: Any = None, **_: Any) -> list[Any]:
        source = cancelled_by_year if status_filter == "cancelled" else enrolled_by_year
        return source.get(year, [])

    repo.fetch_attendees = AsyncMock(side_effect=fetch_attendees)


def _calls(repo: MagicMock) -> list[Any]:
    return list(repo.fetch_attendees.call_args_list)


# ============================================================================
# TestHistoricalServiceFromAttendees - Core: uses attendees+persons, NOT camper_history
# ============================================================================


class TestHistoricalServiceFromAttendees:
    """Test that HistoricalService uses attendees+persons, NOT camper_history.

    This is the primary bug fix: camper_history has one record per (person, session, year),
    so a camper in Session 1 + Session 2 = 2 records, counted twice.
    The fix uses attendees + persons with person_id set deduplication.
    """

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_total_enrolled_counts_unique_persons(self, mock_repository: MagicMock) -> None:
        """A camper in 2 sessions should be counted once, not twice.

        This is the core bug: camper_history had one record per (person, session),
        so len(history) double-counted multi-session campers.
        """
        from api.services.historical_service import HistoricalService

        # Person 1001 is in Session 1 AND Session 2 (two attendee records)
        # Person 1002 is only in Session 1
        attendees = [
            make_mock_attendee(1001, 5001, "Session 1"),
            make_mock_attendee(1001, 5002, "Session 2"),  # Same person, different session
            make_mock_attendee(1002, 5001, "Session 1"),
        ]
        persons = {
            1001: make_mock_person(1001, "M", years_at_camp=2),
            1002: make_mock_person(1002, "F", years_at_camp=1),
        }
        sessions = {
            5001: make_mock_session(5001, "Session 1"),
            5002: make_mock_session(5002, "Session 2"),
        }

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2025])

        # Should be 2 unique persons, NOT 3 attendee records
        assert result.years[0].total_enrolled == 2

    @pytest.mark.asyncio
    async def test_gender_breakdown_from_persons(self, mock_repository: MagicMock) -> None:
        """Gender breakdown should use persons table, not record count."""
        from api.services.historical_service import HistoricalService

        # 3 male persons, 2 female persons (some with multiple sessions)
        attendees = [
            make_mock_attendee(1001, 5001),
            make_mock_attendee(1002, 5001),
            make_mock_attendee(1002, 5002),  # Person 1002 in two sessions
            make_mock_attendee(1003, 5001),
            make_mock_attendee(1004, 5001),
            make_mock_attendee(1005, 5001),
        ]
        persons = {
            1001: make_mock_person(1001, "M"),
            1002: make_mock_person(1002, "M"),
            1003: make_mock_person(1003, "M"),
            1004: make_mock_person(1004, "F"),
            1005: make_mock_person(1005, "F"),
        }
        sessions = {
            5001: make_mock_session(5001, "Session 1"),
            5002: make_mock_session(5002, "Session 2"),
        }

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2025])

        year_metric = result.years[0]
        gender_dict = {g.gender: g for g in year_metric.by_gender}

        # 5 unique persons: 3M, 2F
        assert gender_dict["M"].count == 3
        assert gender_dict["F"].count == 2
        assert abs(gender_dict["M"].percentage - 60.0) < 0.001
        assert abs(gender_dict["F"].percentage - 40.0) < 0.001

    @pytest.mark.asyncio
    async def test_new_vs_returning_from_persons(self, mock_repository: MagicMock) -> None:
        """New vs returning should use years_at_camp from persons table."""
        from api.services.historical_service import HistoricalService

        attendees = [
            make_mock_attendee(1001, 5001),
            make_mock_attendee(1002, 5001),
            make_mock_attendee(1003, 5001),
            make_mock_attendee(1004, 5001),
        ]
        persons = {
            1001: make_mock_person(1001, "M", years_at_camp=1),  # New
            1002: make_mock_person(1002, "M", years_at_camp=1),  # New
            1003: make_mock_person(1003, "F", years_at_camp=3),  # Returning
            1004: make_mock_person(1004, "F", years_at_camp=2),  # Returning
        }
        sessions = {5001: make_mock_session(5001, "Session 1")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2025])

        nvr = result.years[0].new_vs_returning
        assert nvr.new_count == 2
        assert nvr.returning_count == 2
        assert abs(nvr.new_percentage - 50.0) < 0.001
        assert abs(nvr.returning_percentage - 50.0) < 0.001

    @pytest.mark.asyncio
    async def test_does_not_call_fetch_camper_history(self, mock_repository: MagicMock) -> None:
        """Service must NOT use fetch_camper_history at all."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_persons = AsyncMock(return_value={})
        mock_repository.fetch_sessions = AsyncMock(return_value={})

        service = HistoricalService(mock_repository)
        await service.calculate_historical_trends(years=[2025])

        # fetch_camper_history has been removed from the repository entirely
        assert not hasattr(mock_repository, "fetch_camper_history")

    @pytest.mark.asyncio
    async def test_session_type_filtering(self, mock_repository: MagicMock) -> None:
        """Only attendees in requested session types should be counted."""
        from api.services.historical_service import HistoricalService

        # Person 1001 in main, person 1002 in family (should be excluded)
        attendees = [
            make_mock_attendee(1001, 5001, "Session 1", "main"),
            make_mock_attendee(1002, 5002, "Family Camp", "family"),
        ]
        persons = {
            1001: make_mock_person(1001, "M"),
            1002: make_mock_person(1002, "F"),
        }
        sessions = {
            5001: make_mock_session(5001, "Session 1", "main"),
            5002: make_mock_session(5002, "Family Camp", "family"),
        }

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2025], session_types=["main", "ag"])

        # Only person 1001 in main session should be counted
        assert result.years[0].total_enrolled == 1

    @pytest.mark.asyncio
    async def test_cancelled_count_is_final_status_not_status_history(self, mock_repository: MagicMock) -> None:
        """Decision 10 (#3207): Trends counts campers whose FINAL status is cancelled,
        matching Overview. Status-history transitions are not the source any more."""
        from api.services.historical_service import HistoricalService

        sessions = {5001: make_mock_session(5001, "Session 1")}
        enrolled = [make_mock_attendee(1001, 5001)]
        cancelled = [make_mock_attendee(2001 + i, 5001) for i in range(5)]
        _route_attendees(mock_repository, {2025: enrolled}, {2025: cancelled})
        mock_repository.fetch_persons = AsyncMock(return_value={1001: make_mock_person(1001, "M")})
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)
        # A status history that disagrees must not move the number.
        mock_repository.fetch_status_transitions = AsyncMock(return_value=[make_mock_transition(3001, 5001)])

        result = await HistoricalService(mock_repository).calculate_historical_trends(years=[2025])

        year_metric = result.years[0]
        assert year_metric.total_cancelled == 5
        # cancellation_rate = 5 / (1 + 5) = 83.33%
        assert abs(year_metric.cancellation_rate - 83.33) < 0.01

    @pytest.mark.asyncio
    async def test_cancelled_reads_the_cancelled_status_only_like_overview(self, mock_repository: MagicMock) -> None:
        """Overview's Total Cancelled fetches status "cancelled" alone (withdrawn and
        dismissed are not in it), so Trends asks the repository for the same."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_sessions = AsyncMock(return_value={5001: make_mock_session(5001, "Session 1")})
        _route_attendees(mock_repository, {2025: []}, {2025: [make_mock_attendee(7, 5001)]})

        await HistoricalService(mock_repository).calculate_historical_trends(years=[2025])

        statuses = [c.args[1] if len(c.args) > 1 else c.kwargs.get("status_filter") for c in _calls(mock_repository)]
        assert "cancelled" in statuses
        assert not any(isinstance(s, list) for s in statuses)

    @pytest.mark.asyncio
    async def test_cancellation_count_dedupes_by_person_not_rows(self, mock_repository: MagicMock) -> None:
        """A camper cancelled out of two sessions in a year counts once (#2434 grain)."""
        from api.services.historical_service import HistoricalService

        sessions = {5001: make_mock_session(5001, "Session 1"), 5002: make_mock_session(5002, "Session 2")}
        cancelled = [make_mock_attendee(3001, 5001), make_mock_attendee(3001, 5002, "Session 2")]
        _route_attendees(mock_repository, {2025: [make_mock_attendee(1001, 5001)]}, {2025: cancelled})
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        result = await HistoricalService(mock_repository).calculate_historical_trends(years=[2025])

        assert result.years[0].total_cancelled == 1

    @pytest.mark.asyncio
    async def test_cancellation_count_scoped_to_session_types(self, mock_repository: MagicMock) -> None:
        """Cancellations outside the requested session_types are excluded (#2434 scope)."""
        from api.services.historical_service import HistoricalService

        sessions = {
            5001: make_mock_session(5001, "Session 1", "main"),
            5002: make_mock_session(5002, "Family Camp 1", "family"),
        }
        cancelled = [make_mock_attendee(3001, 5001), make_mock_attendee(3002, 5002, "Family Camp 1", "family")]
        _route_attendees(mock_repository, {2025: [make_mock_attendee(1001, 5001)]}, {2025: cancelled})
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        result = await HistoricalService(mock_repository).calculate_historical_trends(
            years=[2025], session_types=["main"]
        )

        assert result.years[0].total_cancelled == 1


# ============================================================================
# TestHistoricalServiceBasic - Core functionality tests
# ============================================================================


class TestHistoricalServiceBasic:
    """Test basic HistoricalService functionality."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_response_shape(self, mock_repository: MagicMock) -> None:
        """Test that response has correct shape."""
        from api.services.historical_service import HistoricalService

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2023, 2024, 2025])

        assert hasattr(result, "years")
        assert len(result.years) == 3

        for year_metric in result.years:
            assert hasattr(year_metric, "year")
            assert hasattr(year_metric, "total_enrolled")
            assert hasattr(year_metric, "by_gender")
            assert hasattr(year_metric, "new_vs_returning")
            assert hasattr(year_metric, "total_cancelled")

    @pytest.mark.asyncio
    async def test_total_enrollment_per_year(self, mock_repository: MagicMock) -> None:
        """Test that total enrollment is computed per year."""
        from api.services.historical_service import HistoricalService

        attendees_2024 = [make_mock_attendee(i, 5001) for i in range(1001, 1011)]  # 10
        attendees_2025 = [make_mock_attendee(i, 5001) for i in range(1001, 1016)]  # 15
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1001, 1011)}
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1001, 1016)}
        sessions_both = {5001: make_mock_session(5001, "Session 1")}

        async def mock_fetch_attendees(year: int, status_filter: Any = None) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        async def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions_both)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024, 2025])

        assert len(result.years) == 2
        year_dict = {y.year: y for y in result.years}
        assert year_dict[2024].total_enrolled == 10
        assert year_dict[2025].total_enrolled == 15


# ============================================================================
# TestHistoricalServiceBreakdowns - Breakdown calculations
# ============================================================================


class TestHistoricalServiceBreakdowns:
    """Test breakdown calculations."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_gender_breakdown(self, mock_repository: MagicMock) -> None:
        """Test gender breakdown per year."""
        from api.services.historical_service import HistoricalService

        # 6 M, 4 F
        attendees = [make_mock_attendee(i, 5001) for i in range(1001, 1011)]
        persons = {}
        for i in range(1001, 1007):
            persons[i] = make_mock_person(i, "M")
        for i in range(1007, 1011):
            persons[i] = make_mock_person(i, "F")
        sessions = {5001: make_mock_session(5001, "Session 1")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        gender_dict = {g.gender: g for g in year_metric.by_gender}

        assert gender_dict["M"].count == 6
        assert abs(gender_dict["M"].percentage - 60.0) < 0.001
        assert gender_dict["F"].count == 4
        assert abs(gender_dict["F"].percentage - 40.0) < 0.001

    @pytest.mark.asyncio
    async def test_new_vs_returning(self, mock_repository: MagicMock) -> None:
        """Test new vs returning breakdown."""
        from api.services.historical_service import HistoricalService

        # 3 new (years_at_camp=1), 7 returning (years_at_camp > 1)
        attendees = [make_mock_attendee(i, 5001) for i in range(1001, 1011)]
        persons = {}
        for i in range(1001, 1004):
            persons[i] = make_mock_person(i, "M", years_at_camp=1)
        for i in range(1004, 1011):
            persons[i] = make_mock_person(i, "M", years_at_camp=2)
        sessions = {5001: make_mock_session(5001, "Session 1")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        assert year_metric.new_vs_returning.new_count == 3
        assert year_metric.new_vs_returning.returning_count == 7
        assert abs(year_metric.new_vs_returning.new_percentage - 30.0) < 0.001
        assert abs(year_metric.new_vs_returning.returning_percentage - 70.0) < 0.001

    @pytest.mark.asyncio
    async def test_by_first_year_field_removed(self, mock_repository: MagicMock) -> None:
        """by_first_year field should not exist on YearMetrics (dead field removed)."""
        from api.services.historical_service import HistoricalService

        attendees = [make_mock_attendee(1001, 5001)]
        persons = {1001: make_mock_person(1001, "M")}
        sessions = {5001: make_mock_session(5001, "Session 1")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        assert not hasattr(year_metric, "by_first_year")


# ============================================================================
# TestHistoricalServiceFiltering - Session type filtering
# ============================================================================


class TestHistoricalServiceFiltering:
    """Test session type filtering via attendees."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_filters_attendees_by_session_type(self, mock_repository: MagicMock) -> None:
        """Test that attendees are filtered by session type."""
        from api.services.historical_service import HistoricalService

        attendees = [
            make_mock_attendee(1001, 5001, "Session 1", "main"),
            make_mock_attendee(1002, 5002, "Family Camp", "family"),
            make_mock_attendee(1003, 5003, "Quest", "quest"),
        ]
        persons = {
            1001: make_mock_person(1001, "M"),
            1002: make_mock_person(1002, "F"),
            1003: make_mock_person(1003, "M"),
        }
        sessions = {
            5001: make_mock_session(5001, "Session 1", "main"),
            5002: make_mock_session(5002, "Family Camp", "family"),
            5003: make_mock_session(5003, "Quest", "quest"),
        }

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024], session_types=["main", "ag"])

        # Only person 1001 in "main" session
        assert result.years[0].total_enrolled == 1


# ============================================================================
# TestHistoricalServiceEdgeCases - Edge cases
# ============================================================================


class TestHistoricalServiceEdgeCases:
    """Test edge cases."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_empty_year(self, mock_repository: MagicMock) -> None:
        """Test handling of empty year."""
        from api.services.historical_service import HistoricalService

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        assert year_metric.total_enrolled == 0
        assert len(year_metric.by_gender) == 0
        assert year_metric.new_vs_returning.new_count == 0
        assert year_metric.new_vs_returning.returning_count == 0

    @pytest.mark.asyncio
    async def test_default_years_from_season_id(
        self, mock_repository: MagicMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test default years derived from CAMPMINDER_SEASON_ID env var."""
        from api.services.historical_service import HistoricalService

        monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2026")

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends()

        assert len(result.years) == 5
        years = [y.year for y in result.years]
        assert years == [2022, 2023, 2024, 2025, 2026]

    @pytest.mark.asyncio
    async def test_default_years_fallback_without_season_id(
        self, mock_repository: MagicMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test default years fall back to current year when CAMPMINDER_SEASON_ID is not set."""
        from datetime import datetime

        from api.services.historical_service import HistoricalService

        monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends()

        current_year = datetime.now().year
        assert len(result.years) == 5
        years = [y.year for y in result.years]
        assert years == list(range(current_year - 4, current_year + 1))

    @pytest.mark.asyncio
    async def test_attendee_without_person_record_excluded(self, mock_repository: MagicMock) -> None:
        """Attendees whose person_id is not in persons dict should still be counted
        (person_id dedup happens, but missing person records just get Unknown gender)."""
        from api.services.historical_service import HistoricalService

        attendees = [
            make_mock_attendee(1001, 5001),
            make_mock_attendee(1002, 5001),  # No person record
        ]
        persons = {
            1001: make_mock_person(1001, "M"),
            # 1002 missing from persons
        }
        sessions = {5001: make_mock_session(5001, "Session 1")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2025])

        # Both person IDs should be counted
        assert result.years[0].total_enrolled == 2


# ============================================================================
# TestHistoricalServiceSessionFiltering - Session cm_id filtering across years
# ============================================================================


class TestHistoricalServiceSessionFiltering:
    """Test session_cm_id filtering with name-matching across years."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_session_cm_id_accepted(self, mock_repository: MagicMock) -> None:
        """Test that session_cm_id parameter is accepted by the service."""
        from api.services.historical_service import HistoricalService

        sessions = {1001: make_mock_session(1001, "Session 2", "main")}
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(
            years=[2024],
            session_cm_id=1001,
        )

        assert result is not None
        assert len(result.years) == 1

    @pytest.mark.asyncio
    async def test_session_filtering_by_name_match(self, mock_repository: MagicMock) -> None:
        """Test filtering by session name across years.

        When session_cm_id is provided for a session named "Session 2" in 2025,
        historical years should filter to sessions with the same name.
        """
        from api.services.historical_service import HistoricalService

        sessions_2024 = {
            2001: make_mock_session(2001, "Session 1", "main"),
            2002: make_mock_session(2002, "Session 2", "main"),
        }
        sessions_2025 = {
            3001: make_mock_session(3001, "Session 1", "main"),
            3002: make_mock_session(3002, "Session 2", "main"),
        }

        # 2024: person 1001 in Session 1, person 1002+1003 in Session 2
        attendees_2024 = [
            make_mock_attendee(1001, 2001, "Session 1"),
            make_mock_attendee(1002, 2002, "Session 2"),
            make_mock_attendee(1003, 2002, "Session 2"),
        ]
        # 2025: person 1004 in Session 1, person 1005+1006+1007 in Session 2
        attendees_2025 = [
            make_mock_attendee(1004, 3001, "Session 1"),
            make_mock_attendee(1005, 3002, "Session 2"),
            make_mock_attendee(1006, 3002, "Session 2"),
            make_mock_attendee(1007, 3002, "Session 2"),
        ]

        persons_2024 = {i: make_mock_person(i, "M") for i in [1001, 1002, 1003]}
        persons_2025 = {i: make_mock_person(i, "M") for i in [1004, 1005, 1006, 1007]}

        async def mock_fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
            return sessions_2024 if year == 2024 else sessions_2025

        async def mock_fetch_attendees(year: int, status_filter: Any = None) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        async def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(
            years=[2024, 2025],
            session_cm_id=3002,  # "Session 2" in 2025
        )

        year_dict = {y.year: y for y in result.years}
        # 2024: only Session 2 campers (persons 1002, 1003) = 2
        assert year_dict[2024].total_enrolled == 2
        # 2025: only Session 2 campers (persons 1005, 1006, 1007) = 3
        assert year_dict[2025].total_enrolled == 3

    @pytest.mark.asyncio
    async def test_no_session_filter_returns_all(self, mock_repository: MagicMock) -> None:
        """Test that omitting session_cm_id returns all campers."""
        from api.services.historical_service import HistoricalService

        attendees = [
            make_mock_attendee(1001, 5001, "Session 1"),
            make_mock_attendee(1002, 5002, "Session 2"),
        ]
        persons = {
            1001: make_mock_person(1001, "M"),
            1002: make_mock_person(1002, "F"),
        }
        sessions = {
            5001: make_mock_session(5001, "Session 1"),
            5002: make_mock_session(5002, "Session 2"),
        }

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value=sessions)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        assert result.years[0].total_enrolled == 2

    @pytest.mark.asyncio
    async def test_session_not_found_returns_empty(self, mock_repository: MagicMock) -> None:
        """Test that filtering to non-existent session returns empty data."""
        from api.services.historical_service import HistoricalService

        sessions_2024 = {2001: make_mock_session(2001, "Session 1", "main")}
        sessions_2025 = {
            3001: make_mock_session(3001, "Session 1", "main"),
            3002: make_mock_session(3002, "Session 2", "main"),
        }

        attendees_2024 = [make_mock_attendee(1001, 2001, "Session 1")]
        attendees_2025 = [make_mock_attendee(1002, 3002, "Session 2")]

        persons_2024 = {1001: make_mock_person(1001, "M")}
        persons_2025 = {1002: make_mock_person(1002, "F")}

        async def mock_fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
            return sessions_2024 if year == 2024 else sessions_2025

        async def mock_fetch_attendees(year: int, status_filter: Any = None) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        async def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(
            years=[2024, 2025],
            session_cm_id=3002,  # "Session 2" only exists in 2025
        )

        year_dict = {y.year: y for y in result.years}
        # 2024 has no "Session 2" so should be empty
        assert year_dict[2024].total_enrolled == 0
        # 2025 has Session 2 with 1 camper
        assert year_dict[2025].total_enrolled == 1


# ============================================================================
# TestCancellationDataCoverage - every year is measured now (decision 10). The
# final status exists for every season, so a year is uncovered only when the
# cancelled fetch itself failed (#2443: never report a failure as a measured 0).
# ============================================================================


class TestCancellationDataCoverage:
    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        return _make_repo_with_defaults()

    @pytest.mark.asyncio
    async def test_a_year_with_no_status_history_still_counts_its_cancellations(
        self, mock_repository: MagicMock
    ) -> None:
        """Status history starts in 2026; 2022's cancellations still read from final status."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_sessions = AsyncMock(return_value={5001: make_mock_session(5001, "Session 1")})
        _route_attendees(
            mock_repository,
            {2022: [make_mock_attendee(1, 5001)], 2026: [make_mock_attendee(1, 5001)]},
            {2022: [make_mock_attendee(2, 5001), make_mock_attendee(3, 5001)], 2026: [make_mock_attendee(4, 5001)]},
        )
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await HistoricalService(mock_repository).calculate_historical_trends(years=[2022, 2026])

        by_year = {y.year: y for y in result.years}
        assert by_year[2022].total_cancelled == 2
        assert by_year[2022].has_cancellation_data is True
        assert by_year[2026].total_cancelled == 1
        assert by_year[2026].has_cancellation_data is True

    @pytest.mark.asyncio
    async def test_coverage_false_when_the_cancelled_fetch_fails(self, mock_repository: MagicMock) -> None:
        """A failed fetch must not be reported as a confidently-measured zero."""
        from api.services.historical_service import HistoricalService

        enrolled = [make_mock_attendee(1, 5001)]

        async def fetch_attendees(year: int, status_filter: Any = None, **_: Any) -> list[Any]:
            if status_filter == "cancelled":
                raise RuntimeError("PocketBase unavailable")
            return enrolled

        mock_repository.fetch_sessions = AsyncMock(return_value={5001: make_mock_session(5001, "Session 1")})
        mock_repository.fetch_attendees = AsyncMock(side_effect=fetch_attendees)

        result = await HistoricalService(mock_repository).calculate_historical_trends(years=[2025])

        year_metric = result.years[0]
        assert year_metric.has_cancellation_data is False
        assert year_metric.total_cancelled == 0
        assert year_metric.total_enrolled == 1


# ============================================================================
# Scope through the one session resolver (#3208 rows 9 and 12)
# ============================================================================


def _year_repo(
    sessions_by_year: dict[int, dict[int, Any]],
    attendees_by_year: dict[int, list[Any]],
    cancelled_by_year: dict[int, list[Any]] | None = None,
) -> MagicMock:
    """Repo whose per-year data is keyed by the requested year; cancelled = final status."""
    repo = _make_repo_with_defaults()
    all_persons = {i: make_mock_person(i, "M") for i in range(1, 400)}

    async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
        sessions = sessions_by_year.get(year, {})
        if session_types is None:
            return sessions
        return {k: v for k, v in sessions.items() if v.session_type in session_types}

    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    _route_attendees(repo, attendees_by_year, cancelled_by_year or {})
    repo.fetch_persons = AsyncMock(return_value=all_persons)
    return repo


class TestHistoricalSessionResolver:
    @pytest.mark.asyncio
    async def test_renamed_session_matched_via_alias(self) -> None:
        """2026 "Taste of Camp 1" must read its 2025 predecessor "Taste of Camp" (new cm_id)."""
        from api.services.historical_service import HistoricalService

        repo = _year_repo(
            {
                2025: {
                    1000103: make_mock_session(1000103, "Taste of Camp"),
                    1000101: make_mock_session(1000101, "Session 1"),
                },
                2026: {1000802: make_mock_session(1000802, "Taste of Camp 1")},
            },
            {
                2025: [
                    make_mock_attendee(1, 1000103, "Taste of Camp"),
                    make_mock_attendee(2, 1000103, "Taste of Camp"),
                    make_mock_attendee(3, 1000101, "Session 1"),
                ],
                2026: [make_mock_attendee(4, 1000802, "Taste of Camp 1")],
            },
        )

        result = await HistoricalService(repo).calculate_historical_trends(
            years=[2025, 2026], session_types=["main"], session_cm_id=1000802
        )

        assert {y.year: y.total_enrolled for y in result.years} == {2025: 2, 2026: 1}

    @pytest.mark.asyncio
    async def test_renamed_session_cancellations_follow_the_alias(self) -> None:
        from api.services.historical_service import HistoricalService

        repo = _year_repo(
            {
                2025: {
                    1000103: make_mock_session(1000103, "Taste of Camp"),
                    1000101: make_mock_session(1000101, "Session 1"),
                },
                2026: {1000802: make_mock_session(1000802, "Taste of Camp 1")},
            },
            {2025: [make_mock_attendee(1, 1000103, "Taste of Camp")], 2026: []},
            {2025: [make_mock_attendee(10, 1000103, "Taste of Camp"), make_mock_attendee(11, 1000101)]},
        )

        result = await HistoricalService(repo).calculate_historical_trends(
            years=[2025, 2026], session_types=["main"], session_cm_id=1000802
        )

        assert {y.year: y.total_cancelled for y in result.years} == {2025: 1, 2026: 0}

    @pytest.mark.asyncio
    async def test_single_session_includes_its_ag_cabins(self) -> None:
        from api.services.historical_service import HistoricalService

        repo = _year_repo(
            {
                2025: {
                    5001: make_mock_session(5001, "Session 4"),
                    5002: make_mock_session(5002, "Session 3"),
                    5101: make_mock_session(5101, "AG 4", "ag", parent_id=5001),
                }
            },
            {
                2025: [
                    make_mock_attendee(1, 5001, "Session 4"),
                    make_mock_attendee(2, 5101, "AG 4", "ag"),
                    make_mock_attendee(3, 5002, "Session 3"),
                ]
            },
        )

        result = await HistoricalService(repo).calculate_historical_trends(
            years=[2025], session_types=["main", "ag"], session_cm_id=5001
        )

        assert result.years[0].total_enrolled == 2

    @pytest.mark.asyncio
    async def test_offseason_teen_sessions_excluded_by_summer_window(self) -> None:
        """Trends Teens: Aug->May Teen Interns and the Feb L.A. Trip are not summer."""
        from api.services.historical_service import HistoricalService

        repo = _year_repo(
            {
                2018: {
                    1: make_mock_session(1, "Session 1", "main", start_date="2018-06-20", end_date="2018-08-10"),
                    2: make_mock_session(2, "SCIT", "scit", start_date="2018-06-22", end_date="2018-08-01"),
                    3: make_mock_session(3, "Teen Interns", "tli", start_date="2018-08-20", end_date="2019-05-20"),
                    4: make_mock_session(4, "Teen L.A. Trip", "tli", start_date="2018-02-10", end_date="2018-02-14"),
                }
            },
            {
                2018: [
                    make_mock_attendee(10, 2, "SCIT", "scit"),
                    make_mock_attendee(11, 3, "Teen Interns", "tli"),
                    make_mock_attendee(12, 4, "Teen L.A. Trip", "tli"),
                ]
            },
        )

        result = await HistoricalService(repo).calculate_historical_trends(years=[2018], session_types=["scit", "tli"])

        assert result.years[0].total_enrolled == 1

    @pytest.mark.asyncio
    async def test_family_adult_and_bmitzvah_never_enter_summer_trends(self) -> None:
        """Pin (#2435/#2455): Family Camp, adult and B*Mitzvah/Hebrew change no summer number."""
        from api.services.historical_service import HistoricalService

        sessions = {
            1: make_mock_session(1, "Session 1"),
            2: make_mock_session(2, "Family Camp", "family"),
            3: make_mock_session(3, "Adult Weekend", "adult"),
            4: make_mock_session(4, "B'nai Mitzvah", "bmitzvah"),
            5: make_mock_session(5, "Hebrew", "hebrew"),
        }
        summer_only = [make_mock_attendee(1, 1, "Session 1")]
        extras = [
            make_mock_attendee(2, 2, "Family Camp", "family"),
            make_mock_attendee(3, 3, "Adult Weekend", "adult"),
            make_mock_attendee(4, 4, "B'nai Mitzvah", "bmitzvah"),
            make_mock_attendee(5, 5, "Hebrew", "hebrew"),
        ]
        cancelled = [make_mock_attendee(2, 2, "Family Camp", "family"), make_mock_attendee(1, 1)]

        for kwargs in ({}, {"session_types": ["main", "family", "adult"]}, {"session_cm_id": 2}):
            clean = _year_repo({2025: sessions}, {2025: summer_only}, {2025: [make_mock_attendee(1, 1)]})
            dirty = _year_repo({2025: sessions}, {2025: summer_only + extras}, {2025: cancelled})
            a = await HistoricalService(clean).calculate_historical_trends(years=[2025], **kwargs)
            b = await HistoricalService(dirty).calculate_historical_trends(years=[2025], **kwargs)
            assert a.years[0].total_enrolled == b.years[0].total_enrolled, kwargs
            assert a.years[0].total_cancelled == b.years[0].total_cancelled, kwargs

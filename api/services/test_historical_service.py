"""Tests for HistoricalService - TDD tests written first.

These tests define the expected behavior of the HistoricalService.
Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.metrics_repository import MetricsRepository


def make_mock_camper_history(
    person_id: int,
    gender: str,
    years_at_camp: int = 1,
    first_year_attended: int | None = None,
) -> MagicMock:
    """Create a mock camper_history record."""
    record = MagicMock()
    record.person_id = person_id
    record.gender = gender
    record.years_at_camp = years_at_camp
    record.first_year_attended = first_year_attended
    return record


# ============================================================================
# TestHistoricalServiceBasic - Core functionality tests
# ============================================================================


class TestHistoricalServiceBasic:
    """Test basic HistoricalService functionality."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        repo.fetch_camper_history = AsyncMock(return_value=[])
        return repo

    @pytest.mark.asyncio
    async def test_response_shape(self, mock_repository: MagicMock) -> None:
        """Test that response has correct shape."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_camper_history = AsyncMock(return_value=[])

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2023, 2024, 2025])

        # Should have years list
        assert hasattr(result, "years")
        assert len(result.years) == 3

        # Each year should have expected fields
        for year_metric in result.years:
            assert hasattr(year_metric, "year")
            assert hasattr(year_metric, "total_enrolled")
            assert hasattr(year_metric, "by_gender")
            assert hasattr(year_metric, "new_vs_returning")
            assert hasattr(year_metric, "by_first_year")

    @pytest.mark.asyncio
    async def test_total_enrollment_per_year(self, mock_repository: MagicMock) -> None:
        """Test that total enrollment is computed per year."""
        from api.services.historical_service import HistoricalService

        history_2024 = [make_mock_camper_history(i, "M") for i in range(1, 11)]  # 10 campers
        history_2025 = [make_mock_camper_history(i, "M") for i in range(1, 16)]  # 15 campers

        def mock_fetch_history(
            year: int,
            session_types: list[str] | None = None,
            session_name: str | None = None,
        ) -> list[Any]:
            return history_2024 if year == 2024 else history_2025

        mock_repository.fetch_camper_history = AsyncMock(side_effect=mock_fetch_history)

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
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_gender_breakdown(self, mock_repository: MagicMock) -> None:
        """Test gender breakdown per year."""
        from api.services.historical_service import HistoricalService

        # 6 M, 4 F
        history_2024 = [
            *[make_mock_camper_history(i, "M") for i in range(1, 7)],
            *[make_mock_camper_history(i, "F") for i in range(7, 11)],
        ]

        mock_repository.fetch_camper_history = AsyncMock(return_value=history_2024)

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
        history_2024 = [
            *[make_mock_camper_history(i, "M", years_at_camp=1) for i in range(1, 4)],
            *[make_mock_camper_history(i, "M", years_at_camp=2) for i in range(4, 11)],
        ]

        mock_repository.fetch_camper_history = AsyncMock(return_value=history_2024)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        assert year_metric.new_vs_returning.new_count == 3
        assert year_metric.new_vs_returning.returning_count == 7
        assert abs(year_metric.new_vs_returning.new_percentage - 30.0) < 0.001
        assert abs(year_metric.new_vs_returning.returning_percentage - 70.0) < 0.001

    @pytest.mark.asyncio
    async def test_by_first_year_breakdown(self, mock_repository: MagicMock) -> None:
        """Test first year attended breakdown."""
        from api.services.historical_service import HistoricalService

        # Different first years
        history_2024 = [
            *[make_mock_camper_history(i, "M", first_year_attended=2020) for i in range(1, 4)],
            *[make_mock_camper_history(i, "M", first_year_attended=2022) for i in range(4, 8)],
            *[make_mock_camper_history(i, "M", first_year_attended=2024) for i in range(8, 11)],
        ]

        mock_repository.fetch_camper_history = AsyncMock(return_value=history_2024)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        first_year_dict = {fy.first_year: fy for fy in year_metric.by_first_year}

        assert first_year_dict[2020].count == 3
        assert first_year_dict[2022].count == 4
        assert first_year_dict[2024].count == 3


# ============================================================================
# TestHistoricalServiceFiltering - Session type filtering
# ============================================================================


class TestHistoricalServiceFiltering:
    """Test session type filtering."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_passes_session_types_to_repository(self, mock_repository: MagicMock) -> None:
        """Test that session_types are passed to repository."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_camper_history = AsyncMock(return_value=[])

        service = HistoricalService(mock_repository)
        await service.calculate_historical_trends(
            years=[2024],
            session_types=["main", "ag"],
        )

        # Verify repository was called with session_types (session_name=None when no session filter)
        mock_repository.fetch_camper_history.assert_called_with(2024, session_types=["main", "ag"], session_name=None)


# ============================================================================
# TestHistoricalServiceEdgeCases - Edge cases
# ============================================================================


class TestHistoricalServiceEdgeCases:
    """Test edge cases."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_empty_year(self, mock_repository: MagicMock) -> None:
        """Test handling of empty year."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_camper_history = AsyncMock(return_value=[])

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        assert year_metric.total_enrolled == 0
        assert len(year_metric.by_gender) == 0
        assert year_metric.new_vs_returning.new_count == 0
        assert year_metric.new_vs_returning.returning_count == 0

    @pytest.mark.asyncio
    async def test_missing_first_year_excluded(self, mock_repository: MagicMock) -> None:
        """Test that records with missing first_year_attended are excluded from that breakdown."""
        from api.services.historical_service import HistoricalService

        # Some with first_year_attended, some without
        history_2024 = [
            make_mock_camper_history(1, "M", first_year_attended=2022),
            make_mock_camper_history(2, "M", first_year_attended=2022),
            make_mock_camper_history(3, "M", first_year_attended=None),  # Missing
        ]

        mock_repository.fetch_camper_history = AsyncMock(return_value=history_2024)

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends(years=[2024])

        year_metric = result.years[0]
        # Total should include all 3
        assert year_metric.total_enrolled == 3
        # by_first_year should only have 2 (excludes None)
        assert len(year_metric.by_first_year) == 1
        assert year_metric.by_first_year[0].count == 2

    @pytest.mark.asyncio
    async def test_default_years(self, mock_repository: MagicMock) -> None:
        """Test default years when none provided."""
        from api.services.historical_service import HistoricalService

        mock_repository.fetch_camper_history = AsyncMock(return_value=[])

        service = HistoricalService(mock_repository)
        result = await service.calculate_historical_trends()

        # Default should be 5 years from 2025: 2021, 2022, 2023, 2024, 2025
        assert len(result.years) == 5
        years = [y.year for y in result.years]
        assert years == [2021, 2022, 2023, 2024, 2025]


# ============================================================================
# TestHistoricalServiceSessionFiltering - Session name filtering across years
# ============================================================================


def make_mock_camper_history_with_session(
    person_id: int,
    gender: str,
    session_name: str,
    years_at_camp: int = 1,
    first_year_attended: int | None = None,
) -> MagicMock:
    """Create a mock camper_history record with session_name."""
    record = MagicMock()
    record.person_id = person_id
    record.gender = gender
    record.session_name = session_name
    record.years_at_camp = years_at_camp
    record.first_year_attended = first_year_attended
    return record


def make_mock_session(
    cm_id: int,
    name: str,
    session_type: str = "main",
    parent_id: int | None = None,
) -> MagicMock:
    """Create a mock session record."""
    session = MagicMock()
    session.cm_id = cm_id
    session.name = name
    session.session_type = session_type
    session.parent_id = parent_id
    return session


class TestHistoricalServiceSessionFiltering:
    """Test session_cm_id filtering with name-matching across years."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        repo.fetch_camper_history = AsyncMock(return_value=[])
        repo.fetch_sessions = AsyncMock(return_value={})
        return repo

    @pytest.mark.asyncio
    async def test_session_cm_id_accepted(self, mock_repository: MagicMock) -> None:
        """Test that session_cm_id parameter is accepted by the service."""
        from api.services.historical_service import HistoricalService

        # Setup session with name "Session 2"
        mock_repository.fetch_sessions = AsyncMock(
            return_value={
                1001: make_mock_session(1001, "Session 2", "main"),
            }
        )
        mock_repository.fetch_camper_history = AsyncMock(return_value=[])

        service = HistoricalService(mock_repository)

        # Should not raise - parameter should be accepted
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
        historical years (2024, 2023) should also filter to sessions named "Session 2"
        even if they have different cm_ids.
        """
        from api.services.historical_service import HistoricalService

        # Sessions for different years (same name, different cm_ids)
        sessions_2024 = {
            2001: make_mock_session(2001, "Session 1", "main"),
            2002: make_mock_session(2002, "Session 2", "main"),  # Match by name
        }
        sessions_2025 = {
            3001: make_mock_session(3001, "Session 1", "main"),
            3002: make_mock_session(3002, "Session 2", "main"),  # Selected session
        }

        # Camper history for 2024 - 5 in Session 1, 3 in Session 2
        history_2024 = [
            *[make_mock_camper_history_with_session(i, "M", "Session 1") for i in range(1, 6)],
            *[make_mock_camper_history_with_session(i, "M", "Session 2") for i in range(6, 9)],
        ]
        # Camper history for 2025 - 4 in Session 1, 6 in Session 2
        history_2025 = [
            *[make_mock_camper_history_with_session(i, "M", "Session 1") for i in range(1, 5)],
            *[make_mock_camper_history_with_session(i, "M", "Session 2") for i in range(5, 11)],
        ]

        def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MagicMock]:
            return sessions_2024 if year == 2024 else sessions_2025

        def mock_fetch_history(
            year: int, session_types: list[str] | None = None, session_name: str | None = None
        ) -> list[MagicMock]:
            data = history_2024 if year == 2024 else history_2025
            # Simulate filtering by session_name
            if session_name:
                return [r for r in data if r.session_name == session_name]
            return data

        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_camper_history = AsyncMock(side_effect=mock_fetch_history)

        service = HistoricalService(mock_repository)

        # Filter to session_cm_id=3002 (Session 2 in 2025)
        result = await service.calculate_historical_trends(
            years=[2024, 2025],
            session_cm_id=3002,
        )

        # Both years should be filtered to "Session 2" only
        year_dict = {y.year: y for y in result.years}

        # 2024 should show only Session 2 campers (3)
        assert year_dict[2024].total_enrolled == 3

        # 2025 should show only Session 2 campers (6)
        assert year_dict[2025].total_enrolled == 6

    @pytest.mark.asyncio
    async def test_no_session_filter_returns_all(self, mock_repository: MagicMock) -> None:
        """Test that omitting session_cm_id returns all campers."""
        from api.services.historical_service import HistoricalService

        # 10 campers across multiple sessions
        history_2024 = [
            *[make_mock_camper_history_with_session(i, "M", "Session 1") for i in range(1, 6)],
            *[make_mock_camper_history_with_session(i, "M", "Session 2") for i in range(6, 11)],
        ]

        mock_repository.fetch_camper_history = AsyncMock(return_value=history_2024)

        service = HistoricalService(mock_repository)

        # No session filter
        result = await service.calculate_historical_trends(years=[2024])

        # Should include all 10 campers
        assert result.years[0].total_enrolled == 10

    @pytest.mark.asyncio
    async def test_session_not_found_returns_empty(self, mock_repository: MagicMock) -> None:
        """Test that filtering to non-existent session returns empty data."""
        from api.services.historical_service import HistoricalService

        # Session exists only in 2025, not in 2024
        sessions_2024 = {
            2001: make_mock_session(2001, "Session 1", "main"),
        }
        sessions_2025 = {
            3001: make_mock_session(3001, "Session 1", "main"),
            3002: make_mock_session(3002, "Session 2", "main"),  # Only in 2025
        }

        history_2024 = [make_mock_camper_history_with_session(i, "M", "Session 1") for i in range(1, 6)]
        history_2025 = [make_mock_camper_history_with_session(i, "M", "Session 2") for i in range(1, 4)]

        def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MagicMock]:
            return sessions_2024 if year == 2024 else sessions_2025

        def mock_fetch_history(
            year: int, session_types: list[str] | None = None, session_name: str | None = None
        ) -> list[MagicMock]:
            data = history_2024 if year == 2024 else history_2025
            if session_name:
                return [r for r in data if r.session_name == session_name]
            return data

        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)
        mock_repository.fetch_camper_history = AsyncMock(side_effect=mock_fetch_history)

        service = HistoricalService(mock_repository)

        # Filter to Session 2 (only exists in 2025)
        result = await service.calculate_historical_trends(
            years=[2024, 2025],
            session_cm_id=3002,
        )

        year_dict = {y.year: y for y in result.years}

        # 2024 should be empty (Session 2 doesn't exist in 2024)
        assert year_dict[2024].total_enrolled == 0

        # 2025 should have 3 campers
        assert year_dict[2025].total_enrolled == 3

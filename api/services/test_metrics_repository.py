"""Tests for MetricsRepository - written first (TDD).

These tests define the expected behavior for the data access layer that
isolates PocketBase interactions for testability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest


@dataclass
class MockRecord:
    """Mock PocketBase record for testing."""

    id: str
    cm_id: int
    person_id: int | None = None
    year: int | None = None
    gender: str | None = None
    grade: int | None = None
    session_type: str | None = None
    status: str | None = None
    is_active: int | None = None
    status_id: int | None = None
    expand: dict[str, Any] | None = None


class TestMetricsRepositoryFetchAttendees:
    """Tests for fetch_attendees method."""

    @pytest.mark.asyncio
    async def test_fetch_attendees_with_year_filter(self) -> None:
        """fetch_attendees filters by year correctly."""
        from api.services.metrics_repository import MetricsRepository

        # Mock PocketBase client
        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = [
            MockRecord(id="1", cm_id=100, person_id=1, year=2025),
            MockRecord(id="2", cm_id=101, person_id=2, year=2025),
        ]

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_attendees(2025)

        # Verify correct filter was used
        mock_pb.collection.assert_called_with("attendees")
        call_args = mock_collection.get_full_list.call_args
        assert "filter" in call_args.kwargs.get("query_params", {})
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "year = 2025" in filter_str
        assert "is_active = 1" in filter_str
        assert "status_id = 2" in filter_str

        # Verify results
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_fetch_attendees_with_status_filter(self) -> None:
        """fetch_attendees filters by status correctly."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees(2025, status_filter="waitlisted")

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert 'status = "waitlisted"' in filter_str
        assert "year = 2025" in filter_str

    @pytest.mark.asyncio
    async def test_fetch_attendees_with_multiple_statuses(self) -> None:
        """fetch_attendees handles multiple status filter correctly."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees(2025, status_filter=["enrolled", "waitlisted"])

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert 'status = "enrolled"' in filter_str
        assert 'status = "waitlisted"' in filter_str
        assert "||" in filter_str

    @pytest.mark.asyncio
    async def test_fetch_attendees_includes_session_expand(self) -> None:
        """fetch_attendees includes session expansion."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees(2025)

        call_args = mock_collection.get_full_list.call_args
        assert "expand" in call_args.kwargs.get("query_params", {})
        assert call_args.kwargs["query_params"]["expand"] == "session"


class TestMetricsRepositoryFetchPersons:
    """Tests for fetch_persons method."""

    @pytest.mark.asyncio
    async def test_fetch_persons_returns_dict_by_cm_id(self) -> None:
        """fetch_persons returns dict indexed by cm_id."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = [
            MockRecord(id="1", cm_id=100, person_id=100, gender="M"),
            MockRecord(id="2", cm_id=200, person_id=200, gender="F"),
        ]

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_persons(2025)

        # Verify dict structure
        assert isinstance(result, dict)
        assert 100 in result
        assert 200 in result
        assert result[100].gender == "M"
        assert result[200].gender == "F"

    @pytest.mark.asyncio
    async def test_fetch_persons_uses_int_keys(self) -> None:
        """fetch_persons uses int keys, not float."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        # Simulate PocketBase returning float-like values
        record = MockRecord(id="1", cm_id=100, person_id=100)
        mock_collection.get_full_list.return_value = [record]

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_persons(2025)

        # Keys should be int
        for key in result:
            assert isinstance(key, int)

    @pytest.mark.asyncio
    async def test_fetch_persons_filters_by_year(self) -> None:
        """fetch_persons filters by year."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_persons(2025)

        mock_pb.collection.assert_called_with("persons")
        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "year = 2025" in filter_str


class TestMetricsRepositoryFetchSessions:
    """Tests for fetch_sessions method."""

    @pytest.mark.asyncio
    async def test_fetch_sessions_returns_dict_by_cm_id(self) -> None:
        """fetch_sessions returns dict indexed by cm_id."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = [
            MockRecord(id="1", cm_id=1000, person_id=None, session_type="main"),
            MockRecord(id="2", cm_id=2000, person_id=None, session_type="embedded"),
        ]

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_sessions(2025)

        assert isinstance(result, dict)
        assert 1000 in result
        assert 2000 in result
        assert result[1000].session_type == "main"

    @pytest.mark.asyncio
    async def test_fetch_sessions_with_type_filter(self) -> None:
        """fetch_sessions filters by session types."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_sessions(2025, session_types=["main", "embedded"])

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "year = 2025" in filter_str
        assert 'session_type = "main"' in filter_str
        assert 'session_type = "embedded"' in filter_str

    @pytest.mark.asyncio
    async def test_fetch_sessions_uses_camp_sessions_collection(self) -> None:
        """fetch_sessions uses camp_sessions collection."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_sessions(2025)

        mock_pb.collection.assert_called_with("camp_sessions")


class TestMetricsRepositoryFetchCamperHistory:
    """Tests for fetch_camper_history method."""

    @pytest.mark.asyncio
    async def test_fetch_camper_history_filters_by_year(self) -> None:
        """fetch_camper_history filters by year."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_camper_history(2025)

        mock_pb.collection.assert_called_with("camper_history")
        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "year = 2025" in filter_str

    @pytest.mark.asyncio
    async def test_fetch_camper_history_returns_list(self) -> None:
        """fetch_camper_history returns list of records."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = [
            MockRecord(id="1", cm_id=1, person_id=100),
            MockRecord(id="2", cm_id=2, person_id=200),
        ]

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_camper_history(2025)

        assert isinstance(result, list)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_fetch_camper_history_handles_collection_error(self) -> None:
        """fetch_camper_history returns empty list on error."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.side_effect = Exception("Collection not found")

        repo = MetricsRepository(mock_pb)
        result = await repo.fetch_camper_history(2025)

        # Should return empty list, not raise
        assert result == []


class TestMetricsRepositoryFetchSummerHistory:
    """Tests for fetch_summer_enrollment_history method."""

    @pytest.mark.asyncio
    async def test_fetch_summer_history_empty_person_ids(self) -> None:
        """fetch_summer_enrollment_history returns empty for no person_ids."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        repo = MetricsRepository(mock_pb)

        result = await repo.fetch_summer_enrollment_history(set(), 2025)

        assert result == []
        # Should not call PocketBase at all
        mock_pb.collection.assert_not_called()

    @pytest.mark.asyncio
    async def test_fetch_summer_history_batches_large_sets(self) -> None:
        """fetch_summer_enrollment_history batches queries for large sets."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        # Create 150 person IDs - should be split into 2 batches
        person_ids = set(range(1, 151))
        await repo.fetch_summer_enrollment_history(person_ids, 2025)

        # Should have called get_full_list twice (batches of 100)
        assert mock_collection.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_fetch_summer_history_includes_session_expand(self) -> None:
        """fetch_summer_enrollment_history includes session expand."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_summer_enrollment_history({1, 2, 3}, 2025)

        call_args = mock_collection.get_full_list.call_args
        assert call_args.kwargs["query_params"]["expand"] == "session"


class TestMetricsRepositoryBuildHistoryByPerson:
    """Tests for build_history_by_person method."""

    def test_build_history_by_person_indexes_correctly(self) -> None:
        """build_history_by_person indexes records by person_id."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        repo = MetricsRepository(mock_pb)

        records = [
            MockRecord(id="1", cm_id=1, person_id=100),
            MockRecord(id="2", cm_id=2, person_id=200),
            MockRecord(id="3", cm_id=3, person_id=100),  # Duplicate person
        ]

        result = repo.build_history_by_person(records)

        # Should have 2 keys (100 and 200)
        assert len(result) == 2
        assert 100 in result
        assert 200 in result
        # Last record for person 100 should be stored
        assert result[100].cm_id == 3

    def test_build_history_by_person_skips_none_person_id(self) -> None:
        """build_history_by_person skips records with None person_id."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        repo = MetricsRepository(mock_pb)

        records = [
            MockRecord(id="1", cm_id=1, person_id=100),
            MockRecord(id="2", cm_id=2, person_id=None),  # Should be skipped
        ]

        result = repo.build_history_by_person(records)

        assert len(result) == 1
        assert 100 in result
        assert None not in result

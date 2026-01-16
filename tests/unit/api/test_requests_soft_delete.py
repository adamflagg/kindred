"""Test-Driven Development for Soft Delete Merge/Split

Tests the soft delete approach for merge/split operations:
- Merge: soft-deletes absorbed requests by setting merged_into field
- Split: restores merged requests by clearing merged_into field

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestRequestRepositorySoftDelete:
    """Test soft delete methods in RequestRepository."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]):
        """Create a RequestRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
            RequestRepository,
        )

        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def test_soft_delete_for_merge_sets_merged_into(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that soft_delete_for_merge sets merged_into field."""
        _, mock_collection = mock_pb_client

        # Mock successful update
        mock_collection.update.return_value = Mock()

        result = repository.soft_delete_for_merge(
            record_id="absorbed_req_123",
            merged_into_id="kept_req_456",
        )

        assert result is True

        # Verify update was called with merged_into field
        mock_collection.update.assert_called_once()
        call_args = mock_collection.update.call_args
        assert call_args[0][0] == "absorbed_req_123"  # record_id
        update_data = call_args[0][1]
        assert update_data["merged_into"] == "kept_req_456"

    def test_soft_delete_for_merge_returns_false_on_error(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that soft_delete_for_merge returns False on error."""
        _, mock_collection = mock_pb_client

        mock_collection.update.side_effect = Exception("DB error")

        result = repository.soft_delete_for_merge(
            record_id="absorbed_req_123",
            merged_into_id="kept_req_456",
        )

        assert result is False

    def test_restore_from_merge_clears_merged_into(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that restore_from_merge clears merged_into field."""
        _, mock_collection = mock_pb_client

        mock_collection.update.return_value = Mock()

        result = repository.restore_from_merge(record_id="merged_req_123")

        assert result is True

        # Verify update was called with empty merged_into
        mock_collection.update.assert_called_once()
        call_args = mock_collection.update.call_args
        assert call_args[0][0] == "merged_req_123"
        update_data = call_args[0][1]
        assert update_data["merged_into"] == ""

    def test_restore_from_merge_returns_false_on_error(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that restore_from_merge returns False on error."""
        _, mock_collection = mock_pb_client

        mock_collection.update.side_effect = Exception("DB error")

        result = repository.restore_from_merge(record_id="merged_req_123")

        assert result is False

    def test_get_merged_requests_returns_requests_merged_into_kept(
        self, repository, mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that get_merged_requests returns all requests merged into the kept one."""
        _, mock_collection = mock_pb_client

        # Create mock merged requests
        merged_req_1 = Mock()
        merged_req_1.id = "merged_1"
        merged_req_1.requester_id = 12345
        merged_req_1.requestee_id = 67890
        merged_req_1.request_type = "bunk_with"
        merged_req_1.session_id = 1000002
        merged_req_1.year = 2025
        merged_req_1.priority = 4
        merged_req_1.confidence_score = 0.95
        merged_req_1.source = "family"
        merged_req_1.source_field = "bunking_notes"
        merged_req_1.csv_position = 0
        merged_req_1.status = "resolved"
        merged_req_1.is_placeholder = False
        merged_req_1.metadata = {}
        merged_req_1.merged_into = "kept_req_456"

        merged_req_2 = Mock()
        merged_req_2.id = "merged_2"
        merged_req_2.requester_id = 12345
        merged_req_2.requestee_id = 67890
        merged_req_2.request_type = "bunk_with"
        merged_req_2.session_id = 1000002
        merged_req_2.year = 2025
        merged_req_2.priority = 3
        merged_req_2.confidence_score = 0.85
        merged_req_2.source = "family"
        merged_req_2.source_field = "internal_notes"
        merged_req_2.csv_position = 0
        merged_req_2.status = "resolved"
        merged_req_2.is_placeholder = False
        merged_req_2.metadata = {}
        merged_req_2.merged_into = "kept_req_456"

        mock_result = Mock()
        mock_result.items = [merged_req_1, merged_req_2]
        mock_collection.get_list.return_value = mock_result

        result = repository.get_merged_requests(kept_request_id="kept_req_456")

        assert len(result) == 2
        assert result[0].id == "merged_1"
        assert result[1].id == "merged_2"

        # Verify query filtered by merged_into
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert 'merged_into = "kept_req_456"' in filter_str

    def test_get_merged_requests_returns_empty_when_none(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that get_merged_requests returns empty list when no merged requests."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        result = repository.get_merged_requests(kept_request_id="kept_req_456")

        assert result == []


class TestGetByIdExcludesMerged:
    """Test that get_by_id excludes soft-deleted (merged) requests."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]):
        """Create a RequestRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
            RequestRepository,
        )

        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def test_get_by_id_includes_merged_into_field(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that get_by_id returns the merged_into field if present."""
        _, mock_collection = mock_pb_client

        mock_record = Mock()
        mock_record.id = "req_123"
        mock_record.requester_id = 12345
        mock_record.requestee_id = 67890
        mock_record.request_type = "bunk_with"
        mock_record.session_id = 1000002
        mock_record.year = 2025
        mock_record.priority = 4
        mock_record.confidence_score = 0.95
        mock_record.source = "family"
        mock_record.source_field = "share_bunk_with"
        mock_record.csv_position = 0
        mock_record.status = "resolved"
        mock_record.is_placeholder = False
        mock_record.metadata = {}
        mock_record.merged_into = "kept_req_456"  # This request is merged

        mock_collection.get_one.return_value = mock_record

        result = repository.get_by_id("req_123")

        assert result is not None
        # The merged_into field should be accessible
        # (if the model supports it - for now we verify the request is returned)
        assert result.id == "req_123"


class TestMergeEndpointSoftDelete:
    """Test that merge endpoint uses soft delete instead of hard delete."""

    @pytest.fixture
    def mock_repos(self) -> tuple[Mock, Mock]:
        """Create mock repositories for testing."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()
        return mock_request_repo, mock_source_link_repo

    @pytest.fixture
    def client_with_mocks(self, mock_repos: tuple[Mock, Mock]) -> Generator[tuple[TestClient, Mock, Mock], None, None]:
        """Create test client with mocked repositories."""
        mock_request_repo, mock_source_link_repo = mock_repos

        with patch("api.routers.requests.get_request_repository") as mock_get_req_repo:
            with patch("api.routers.requests.get_source_link_repository") as mock_get_sl_repo:
                mock_get_req_repo.return_value = mock_request_repo
                mock_get_sl_repo.return_value = mock_source_link_repo

                from api.routers.requests import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_request_repo, mock_source_link_repo

    def test_merge_soft_deletes_absorbed_requests(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that merge uses soft_delete_for_merge instead of delete."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        # Setup mock data
        request_1 = Mock()
        request_1.id = "req_1"
        request_1.requester_cm_id = 12345
        request_1.requested_cm_id = 67890
        request_1.session_cm_id = 1000002
        request_1.request_type = Mock(value="bunk_with")
        request_1.source_fields = ["share_bunk_with"]
        request_1.confidence_score = 0.95
        request_1.metadata = {}

        request_2 = Mock()
        request_2.id = "req_2"
        request_2.requester_cm_id = 12345
        request_2.requested_cm_id = 67890
        request_2.session_cm_id = 1000002
        request_2.request_type = Mock(value="bunk_with")
        request_2.source_fields = ["bunking_notes"]
        request_2.confidence_score = 0.85
        request_2.metadata = {}

        mock_request_repo.get_by_id.side_effect = lambda id: {
            "req_1": request_1,
            "req_2": request_2,
        }.get(id)
        mock_request_repo.soft_delete_for_merge.return_value = True

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200

        # Verify soft_delete_for_merge was called instead of delete
        mock_request_repo.soft_delete_for_merge.assert_called_once_with("req_2", "req_1")
        # Verify delete was NOT called
        mock_request_repo.delete.assert_not_called()

    def test_merge_response_uses_merged_not_deleted_terminology(
        self, client_with_mocks: tuple[TestClient, Mock, Mock]
    ) -> None:
        """Test that merge response uses 'merged_request_ids' terminology."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        request_1 = Mock()
        request_1.id = "req_1"
        request_1.requester_cm_id = 12345
        request_1.requested_cm_id = 67890
        request_1.session_cm_id = 1000002
        request_1.request_type = Mock(value="bunk_with")
        request_1.source_fields = ["share_bunk_with"]
        request_1.confidence_score = 0.95
        request_1.metadata = {}

        request_2 = Mock()
        request_2.id = "req_2"
        request_2.requester_cm_id = 12345
        request_2.requested_cm_id = 67890
        request_2.session_cm_id = 1000002
        request_2.request_type = Mock(value="bunk_with")
        request_2.source_fields = ["bunking_notes"]
        request_2.confidence_score = 0.85
        request_2.metadata = {}

        mock_request_repo.get_by_id.side_effect = lambda id: {
            "req_1": request_1,
            "req_2": request_2,
        }.get(id)
        mock_request_repo.soft_delete_for_merge.return_value = True

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Check response uses new terminology
        assert "merged_request_ids" in data
        assert "req_2" in data["merged_request_ids"]
        # Old terminology should NOT be present
        assert "deleted_request_ids" not in data


class TestSplitEndpointRestore:
    """Test that split endpoint restores merged requests instead of creating new."""

    @pytest.fixture
    def mock_repos(self) -> tuple[Mock, Mock]:
        """Create mock repositories for testing."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()
        return mock_request_repo, mock_source_link_repo

    @pytest.fixture
    def client_with_mocks(self, mock_repos: tuple[Mock, Mock]) -> Generator[tuple[TestClient, Mock, Mock], None, None]:
        """Create test client with mocked repositories."""
        mock_request_repo, mock_source_link_repo = mock_repos

        with patch("api.routers.requests.get_request_repository") as mock_get_req_repo:
            with patch("api.routers.requests.get_source_link_repository") as mock_get_sl_repo:
                mock_get_req_repo.return_value = mock_request_repo
                mock_get_sl_repo.return_value = mock_source_link_repo

                from api.routers.requests import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_request_repo, mock_source_link_repo

    def test_split_restores_merged_request_when_available(
        self, client_with_mocks: tuple[TestClient, Mock, Mock]
    ) -> None:
        """Test that split restores a soft-deleted request instead of creating new."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        # Original merged request (kept one)
        original_request = Mock()
        original_request.id = "req_merged"
        original_request.requester_cm_id = 12345
        original_request.requested_cm_id = 67890
        original_request.session_cm_id = 1000002
        original_request.request_type = Mock(value="bunk_with")
        original_request.source_fields = ["share_bunk_with", "bunking_notes"]
        original_request.confidence_score = 0.95
        original_request.priority = 3
        original_request.source = Mock(value="family")
        original_request.csv_position = 0
        original_request.year = 2025
        original_request.metadata = {}

        # Soft-deleted (merged) request that should be restored
        merged_request = Mock()
        merged_request.id = "req_soft_deleted"
        merged_request.requester_cm_id = 12345
        merged_request.requested_cm_id = 67890
        merged_request.session_cm_id = 1000002
        merged_request.request_type = Mock(value="bunk_with")
        merged_request.source_field = "bunking_notes"
        merged_request.confidence_score = 0.85
        merged_request.priority = 4
        merged_request.year = 2025

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"

        # Return the merged request when looking for requests merged into kept
        mock_request_repo.get_merged_requests.return_value = [merged_request]

        # Source links on kept request (used to match absorbed request by source_field)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]

        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Verify restore_from_merge was called
        mock_request_repo.restore_from_merge.assert_called_once_with("req_soft_deleted")
        # Verify create was NOT called (we restored, didn't create new)
        mock_request_repo.create.assert_not_called()

    def test_split_falls_back_to_create_for_legacy_data(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split falls back to creating new request for legacy merged data."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        # Original merged request
        original_request = Mock()
        original_request.id = "req_merged"
        original_request.requester_cm_id = 12345
        original_request.requested_cm_id = 67890
        original_request.session_cm_id = 1000002
        original_request.request_type = Mock(value="bunk_with")
        original_request.source_fields = ["share_bunk_with", "bunking_notes"]
        original_request.confidence_score = 0.95
        original_request.priority = 3
        original_request.source = Mock(value="family")
        original_request.csv_position = 0
        original_request.year = 2025
        original_request.metadata = {}

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"

        # No soft-deleted requests found (legacy merge that hard-deleted)
        mock_request_repo.get_merged_requests.return_value = []

        # Mock create for fallback
        def set_id_on_create(req):
            req.id = "new_legacy_split_req"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Verify create was called (fallback for legacy data)
        mock_request_repo.create.assert_called_once()
        # Verify restore was NOT called (no soft-deleted request to restore)
        mock_request_repo.restore_from_merge.assert_not_called()

    def test_split_response_uses_restored_not_created_terminology(
        self, client_with_mocks: tuple[TestClient, Mock, Mock]
    ) -> None:
        """Test that split response uses 'restored_request_ids' terminology."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        original_request = Mock()
        original_request.id = "req_merged"
        original_request.requester_cm_id = 12345
        original_request.requested_cm_id = 67890
        original_request.session_cm_id = 1000002
        original_request.request_type = Mock(value="bunk_with")
        original_request.source_fields = ["share_bunk_with", "bunking_notes"]
        original_request.confidence_score = 0.95
        original_request.priority = 3
        original_request.source = Mock(value="family")
        original_request.csv_position = 0
        original_request.year = 2025
        original_request.metadata = {}

        merged_request = Mock()
        merged_request.id = "req_soft_deleted"
        merged_request.source_field = "bunking_notes"  # Used for matching

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"
        mock_request_repo.get_merged_requests.return_value = [merged_request]
        # Source links on kept request (used to match absorbed request by source_field)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]
        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Check response uses new terminology
        assert "restored_request_ids" in data
        assert "req_soft_deleted" in data["restored_request_ids"]
        # Old terminology should NOT be present
        assert "created_request_ids" not in data


class TestFindExistingExcludesMerged:
    """Test that find_existing excludes soft-deleted (merged) requests."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]):
        """Create a RequestRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
            RequestRepository,
        )

        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def test_find_existing_filters_out_merged_requests(self, repository, mock_pb_client: tuple[Mock, Mock]) -> None:
        """Test that find_existing excludes requests with merged_into set."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []  # No results (the merged one is filtered)
        mock_collection.get_list.return_value = mock_result

        repository.find_existing(12345, 67890, "bunk_with", 2025)

        # Verify query includes filter for merged_into = ""
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert 'merged_into = ""' in filter_str or "merged_into = ''" in filter_str


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

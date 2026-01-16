"""Test-Driven Development for Merge API Endpoint

Tests the /api/requests/merge endpoint that combines multiple bunk_requests
into a single merged request.

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestMergeEndpointValidation:
    """Test request validation for merge endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create a test client with mocked dependencies."""
        from api.routers.requests import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_merge_requires_at_least_two_requests(self, client: TestClient) -> None:
        """Test that merge fails with fewer than 2 requests."""
        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["single_id"],
                "keep_target_from": "single_id",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 422  # Validation error
        # FastAPI returns validation errors as a list
        error_detail = str(response.json()["detail"]).lower()
        assert "at least 2" in error_detail

    def test_merge_requires_valid_keep_target_from(self, client: TestClient) -> None:
        """Test that keep_target_from must be one of the request_ids."""
        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["id_1", "id_2"],
                "keep_target_from": "not_in_list",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 422
        assert "keep_target_from" in response.json()["detail"].lower()

    def test_merge_requires_valid_request_type(self, client: TestClient) -> None:
        """Test that final_type must be a valid RequestType."""
        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["id_1", "id_2"],
                "keep_target_from": "id_1",
                "final_type": "invalid_type",
            },
        )

        assert response.status_code == 422


class TestMergeEndpointSuccess:
    """Test successful merge operations."""

    @pytest.fixture
    def mock_repos(self):
        """Create mock repositories for testing."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()
        return mock_request_repo, mock_source_link_repo

    @pytest.fixture
    def client_with_mocks(self, mock_repos):
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

    def test_merge_combines_source_links(self, client_with_mocks) -> None:
        """Test that merge transfers all source links to kept request."""
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

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200

        # Verify source links were transferred
        mock_source_link_repo.transfer_all_sources.assert_called_once_with(
            from_request_id="req_2",
            to_request_id="req_1",
        )

    def test_merge_combines_source_fields(self, client_with_mocks) -> None:
        """Test that merge combines source_fields arrays."""
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

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200

        # Check update was called with combined source_fields
        mock_request_repo.update_for_merge.assert_called_once()
        call_kwargs = mock_request_repo.update_for_merge.call_args.kwargs
        source_fields = call_kwargs.get("source_fields", [])
        assert "share_bunk_with" in source_fields
        assert "bunking_notes" in source_fields

    def test_merge_preserves_highest_confidence(self, client_with_mocks) -> None:
        """Test that merge keeps the highest confidence score."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        request_1 = Mock()
        request_1.id = "req_1"
        request_1.requester_cm_id = 12345
        request_1.requested_cm_id = 67890
        request_1.session_cm_id = 1000002
        request_1.request_type = Mock(value="bunk_with")
        request_1.source_fields = ["share_bunk_with"]
        request_1.confidence_score = 0.75  # Lower
        request_1.metadata = {}

        request_2 = Mock()
        request_2.id = "req_2"
        request_2.requester_cm_id = 12345
        request_2.requested_cm_id = 67890
        request_2.session_cm_id = 1000002
        request_2.request_type = Mock(value="bunk_with")
        request_2.source_fields = ["bunking_notes"]
        request_2.confidence_score = 0.98  # Higher
        request_2.metadata = {}

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200

        # Check confidence was set to max
        call_kwargs = mock_request_repo.update_for_merge.call_args.kwargs
        assert call_kwargs.get("confidence_score") == 0.98

    def test_merge_deletes_merged_requests(self, client_with_mocks) -> None:
        """Test that merged requests are deleted after merge."""
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

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200

        # Verify req_2 was deleted (req_1 is the kept one)
        mock_request_repo.delete.assert_called_once_with("req_2")

    def test_merge_returns_merged_request_id(self, client_with_mocks) -> None:
        """Test that merge returns the ID of the merged request."""
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

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 200
        assert response.json()["merged_request_id"] == "req_1"


class TestMergeEndpointErrors:
    """Test error handling for merge endpoint."""

    @pytest.fixture
    def mock_repos(self):
        """Create mock repositories for testing."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()
        return mock_request_repo, mock_source_link_repo

    @pytest.fixture
    def client_with_mocks(self, mock_repos):
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

    def test_merge_fails_if_request_not_found(self, client_with_mocks) -> None:
        """Test that merge fails if one of the requests doesn't exist."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        mock_request_repo.get_by_id.return_value = None  # Request not found

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_merge_fails_for_different_requesters(self, client_with_mocks) -> None:
        """Test that merge fails if requests have different requesters."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        request_1 = Mock()
        request_1.id = "req_1"
        request_1.requester_cm_id = 12345
        request_1.session_cm_id = 1000002
        request_1.request_type = Mock(value="bunk_with")

        request_2 = Mock()
        request_2.id = "req_2"
        request_2.requester_cm_id = 99999  # Different requester
        request_2.session_cm_id = 1000002
        request_2.request_type = Mock(value="bunk_with")

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 400
        assert "same requester" in response.json()["detail"].lower()

    def test_merge_fails_for_different_sessions(self, client_with_mocks) -> None:
        """Test that merge fails if requests have different sessions."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        request_1 = Mock()
        request_1.id = "req_1"
        request_1.requester_cm_id = 12345
        request_1.session_cm_id = 1000002
        request_1.request_type = Mock(value="bunk_with")

        request_2 = Mock()
        request_2.id = "req_2"
        request_2.requester_cm_id = 12345
        request_2.session_cm_id = 1000003  # Different session
        request_2.request_type = Mock(value="bunk_with")

        mock_request_repo.get_by_id.side_effect = lambda id: {"req_1": request_1, "req_2": request_2}.get(id)

        response = client.post(
            "/api/requests/merge",
            json={
                "request_ids": ["req_1", "req_2"],
                "keep_target_from": "req_1",
                "final_type": "bunk_with",
            },
        )

        assert response.status_code == 400
        assert "same session" in response.json()["detail"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

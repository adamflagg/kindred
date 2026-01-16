"""Test-Driven Development for Split API Endpoint

Tests the /api/requests/split endpoint that splits a merged bunk_request
into separate requests.

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


class TestSplitEndpointValidation:
    """Test request validation for split endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create a test client with mocked dependencies."""
        from api.routers.requests import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_split_requires_at_least_one_source(self, client: TestClient) -> None:
        """Test that split fails with empty split_sources."""
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_123",
                "split_sources": [],
            },
        )

        assert response.status_code == 422  # Validation error
        error_detail = str(response.json()["detail"]).lower()
        assert "at least" in error_detail or "empty" in error_detail

    def test_split_requires_valid_request_type(self, client: TestClient) -> None:
        """Test that new_type must be a valid RequestType."""
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_123",
                "split_sources": [
                    {
                        "original_request_id": "orig_456",
                        "new_type": "invalid_type",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 422


class TestSplitEndpointSuccess:
    """Test successful split operations."""

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

    def test_split_creates_new_request(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split creates a new request for the split source."""
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

        # Mock the create to set an ID
        def set_id_on_create(req):
            req.id = "new_split_req"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have created a new request
        mock_request_repo.create.assert_called_once()

    def test_split_transfers_source_link(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split transfers source link from original to new request."""
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

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"

        def set_id_on_create(req):
            req.id = "new_split_req"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have removed old source link
        mock_source_link_repo.remove_source_link.assert_called_with(
            bunk_request_id="req_merged",
            original_request_id="orig_123",
        )

        # Should have added new source link
        mock_source_link_repo.add_source_link.assert_called()

    def test_split_updates_original_source_fields(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split updates the original request's source_fields."""
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

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"

        def set_id_on_create(req):
            req.id = "new_split_req"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have updated source_fields (removed bunking_notes)
        mock_request_repo.update_source_fields.assert_called_once()
        call_args = mock_request_repo.update_source_fields.call_args
        updated_fields = call_args[1]["source_fields"] if call_args[1] else call_args[0][1]
        assert "bunking_notes" not in updated_fields
        assert "share_bunk_with" in updated_fields

    def test_split_returns_created_request_ids(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split returns the IDs of created requests."""
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

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 2

        def set_id_on_create(req):
            req.id = "new_split_req_1"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_merged",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "created_request_ids" in data
        assert "new_split_req_1" in data["created_request_ids"]


class TestSplitEndpointErrors:
    """Test error handling for split endpoint."""

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

    def test_split_fails_if_request_not_found(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails if the request doesn't exist."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        mock_request_repo.get_by_id.return_value = None

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "nonexistent",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_split_fails_if_single_source_request(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails if request has only one source."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        original_request = Mock()
        original_request.id = "req_single"
        original_request.source_fields = ["share_bunk_with"]

        mock_request_repo.get_by_id.return_value = original_request
        mock_source_link_repo.count_sources_for_request.return_value = 1

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "req_single",
                "split_sources": [
                    {
                        "original_request_id": "orig_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "single" in response.json()["detail"].lower() or "cannot split" in response.json()["detail"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

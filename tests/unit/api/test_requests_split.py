"""Test-Driven Development for Split API Endpoint

Tests the /api/requests/split endpoint that splits a merged bunk_request
into separate requests.

Updated: Now uses absorbed request IDs directly (soft-deleted bunk_requests)
instead of original_bunk_request IDs from source links.
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
                        "original_request_id": "absorbed_456",
                        "new_type": "invalid_type",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 422


class TestSplitEndpointSuccess:
    """Test successful split operations.

    Note: The new implementation uses absorbed request IDs directly.
    The split endpoint now expects `original_request_id` to be a soft-deleted
    bunk_request ID (absorbed request), not an original_bunk_request ID.
    """

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

    def test_split_restores_absorbed_request(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split restores absorbed request by clearing merged_into."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        # The kept (surviving) request
        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.metadata = {"merged_from": ["absorbed_request_id"]}

        # The absorbed request (soft-deleted via merged_into)
        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]
        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "absorbed_request_id",  # Now uses absorbed request ID
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have restored the absorbed request
        mock_request_repo.restore_from_merge.assert_called_once_with("absorbed_request_id")

    def test_split_updates_source_fields(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split updates the kept request's source_fields."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.metadata = {"merged_from": ["absorbed_request_id"]}

        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]
        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "absorbed_request_id",
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have updated source_fields (removed BunkingNotes Notes)
        mock_request_repo.update_source_fields.assert_called_once()
        call_args = mock_request_repo.update_source_fields.call_args
        updated_fields = call_args[1]["source_fields"] if call_args[1] else call_args[0][1]
        assert "BunkingNotes Notes" not in updated_fields
        assert "Share Bunk With" in updated_fields

    def test_split_returns_restored_request_ids(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split returns the IDs of restored requests."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.metadata = {"merged_from": ["absorbed_1", "absorbed_2"]}

        absorbed_1 = Mock()
        absorbed_1.id = "absorbed_1"
        absorbed_1.source_field = "BunkingNotes Notes"

        absorbed_2 = Mock()
        absorbed_2.id = "absorbed_2"
        absorbed_2.source_field = "Internal Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_1, absorbed_2]
        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {"original_request_id": "absorbed_1", "new_type": "bunk_with", "new_target_id": None},
                    {"original_request_id": "absorbed_2", "new_type": "bunk_with", "new_target_id": None},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "restored_request_ids" in data
        assert "absorbed_1" in data["restored_request_ids"]
        assert "absorbed_2" in data["restored_request_ids"]


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
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        mock_request_repo.get_by_id.return_value = None

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "nonexistent",
                "split_sources": [
                    {
                        "original_request_id": "absorbed_123",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_split_fails_if_no_merged_requests(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails if request has no merged requests."""
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "single_request"
        kept_request.source_fields = ["Share Bunk With"]

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = []  # No absorbed requests

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "single_request",
                "split_sources": [
                    {
                        "original_request_id": "some_id",
                        "new_type": "age_preference",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "no merged requests" in response.json()["detail"].lower()

    def test_split_fails_if_absorbed_request_not_found(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails if the absorbed request ID is not in merged list."""
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]

        absorbed_request = Mock()
        absorbed_request.id = "absorbed_1"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "wrong_absorbed_id",  # Not in merged requests
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "not a merged request" in response.json()["detail"].lower()


class TestSplitEndpointPrimaryValidation:
    """Test that split endpoint rejects attempts to split the kept request itself.

    The kept request (the one we're splitting from) cannot be split off -
    only absorbed requests can be restored.
    """

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

    def test_split_rejects_kept_request_id(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails when trying to split off the kept request itself."""
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]

        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]

        # Try to split the KEPT request itself (the "primary")
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "kept_request_id",  # Same as the request_id!
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "primary" in response.json()["detail"].lower()

    def test_split_allows_absorbed_request(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split succeeds when splitting absorbed request."""
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.metadata = {"merged_from": ["absorbed_request_id"]}

        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]
        mock_request_repo.restore_from_merge.return_value = True

        # Split the absorbed request - should succeed
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "absorbed_request_id",  # Valid absorbed request
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200


class TestSplitEndpointMergedFromUpdate:
    """Test that split updates the merged_from metadata."""

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

    def test_split_updates_merged_from_metadata(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split removes restored request IDs from merged_from."""
        client, mock_request_repo, _mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes", "Internal Notes"]
        kept_request.metadata = {"merged_from": ["absorbed_1", "absorbed_2"]}

        absorbed_1 = Mock()
        absorbed_1.id = "absorbed_1"
        absorbed_1.source_field = "BunkingNotes Notes"

        absorbed_2 = Mock()
        absorbed_2.id = "absorbed_2"
        absorbed_2.source_field = "Internal Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_request_repo.get_merged_requests.return_value = [absorbed_1, absorbed_2]
        mock_request_repo.restore_from_merge.return_value = True

        # Split only one of the absorbed requests
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {"original_request_id": "absorbed_1", "new_type": "bunk_with", "new_target_id": None},
                ],
            },
        )

        assert response.status_code == 200

        # Should have updated merged_from to only contain absorbed_2
        mock_request_repo.update_merged_from.assert_called_once()
        call_args = mock_request_repo.update_merged_from.call_args
        updated_merged_from = call_args[0][1] if len(call_args[0]) > 1 else call_args[1].get("merged_from", [])
        assert "absorbed_1" not in updated_merged_from
        assert "absorbed_2" in updated_merged_from


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

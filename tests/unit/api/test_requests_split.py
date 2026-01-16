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
        # No soft-deleted requests to restore (legacy path)
        mock_request_repo.get_merged_requests.return_value = []

        # Source links - orig_123 is NOT primary (allows split)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_primary", "source_field": "share_bunk_with", "is_primary": True},
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]

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

        # Should have created a new request (legacy fallback)
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
        # No soft-deleted requests to restore (legacy path)
        mock_request_repo.get_merged_requests.return_value = []

        # Source links - orig_123 is NOT primary (allows split)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_primary", "source_field": "share_bunk_with", "is_primary": True},
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]

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
        # No soft-deleted requests to restore (legacy path)
        mock_request_repo.get_merged_requests.return_value = []

        # Source links - orig_123 is NOT primary (allows split)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_primary", "source_field": "share_bunk_with", "is_primary": True},
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]

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

    def test_split_returns_restored_request_ids(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split returns the IDs of restored/created requests."""
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
        # No soft-deleted requests to restore (legacy path)
        mock_request_repo.get_merged_requests.return_value = []

        # Source links - orig_123 is NOT primary (allows split)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {"original_request_id": "orig_primary", "source_field": "share_bunk_with", "is_primary": True},
            {"original_request_id": "orig_123", "source_field": "bunking_notes", "is_primary": False},
        ]

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
        assert "restored_request_ids" in data
        assert "new_split_req_1" in data["restored_request_ids"]


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


class TestSplitEndpointSourceFieldMatching:
    """Test split endpoint matches absorbed requests by source_field.

    TDD: When splitting a merged request, the split endpoint needs to find
    the absorbed request by matching source_field between:
    - The absorbed request's source_field (e.g., 'BunkingNotes Notes')
    - The source links on the kept request

    Bug being fixed: Source links are transferred to the kept request during
    merge, so looking up sources on the absorbed request returns empty.
    The fix is to match by source_field instead.
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

    def test_split_restores_absorbed_request_by_source_field_match(
        self, client_with_mocks: tuple[TestClient, Mock, Mock]
    ) -> None:
        """Test that split finds absorbed request via source_field matching.

        Scenario:
        - kept_request has source_fields: ['Share Bunk With', 'BunkingNotes Notes']
        - absorbed_request has source_field: 'BunkingNotes Notes' and merged_into: kept_request
        - kept_request's source links include one with source_field='BunkingNotes Notes'
        - Split should match the absorbed request by source_field and restore it
        """
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        # The kept merged request
        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.requester_cm_id = 12345
        kept_request.requested_cm_id = 67890
        kept_request.session_cm_id = 1000002
        kept_request.request_type = Mock(value="bunk_with")
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.confidence_score = 0.95
        kept_request.priority = 3
        kept_request.source = Mock(value="family")
        kept_request.csv_position = 0
        kept_request.year = 2025
        kept_request.metadata = {"merged_from": ["absorbed_request_id"]}

        # The absorbed request (soft-deleted, source_field still populated)
        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"  # Key field for matching
        absorbed_request.merged_into = "kept_request_id"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_source_link_repo.count_sources_for_request.return_value = 2

        # Return the absorbed request from get_merged_requests
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]

        # Source links on the kept request (these include the transferred link)
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {
                "original_request_id": "orig_share_bunk",
                "source_field": "Share Bunk With",
                "is_primary": True,
            },
            {
                "original_request_id": "orig_bunking_notes",
                "source_field": "BunkingNotes Notes",  # Matches absorbed_request.source_field
                "is_primary": False,
            },
        ]

        mock_source_link_repo.get_source_field_for_link.return_value = "BunkingNotes Notes"
        mock_request_repo.restore_from_merge.return_value = True

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "orig_bunking_notes",  # The one from BunkingNotes Notes
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should have found the absorbed request via source_field matching
        # and restored it instead of creating a new one
        mock_request_repo.restore_from_merge.assert_called_once_with("absorbed_request_id")

        # Should NOT have created a new request (fallback path)
        mock_request_repo.create.assert_not_called()

        # Should have transferred source link back to restored request
        mock_source_link_repo.remove_source_link.assert_called_with(
            bunk_request_id="kept_request_id",
            original_request_id="orig_bunking_notes",
        )
        mock_source_link_repo.add_source_link.assert_called_with(
            bunk_request_id="absorbed_request_id",
            original_request_id="orig_bunking_notes",
            is_primary=True,
        )

    def test_split_falls_back_to_create_when_no_source_field_match(
        self, client_with_mocks: tuple[TestClient, Mock, Mock]
    ) -> None:
        """Test that split creates new request when no absorbed request matches.

        If no absorbed request has a matching source_field (legacy data or
        data corruption), the split should fall back to creating a new request.
        """
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.requester_cm_id = 12345
        kept_request.requested_cm_id = 67890
        kept_request.session_cm_id = 1000002
        kept_request.request_type = Mock(value="bunk_with")
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.confidence_score = 0.95
        kept_request.priority = 3
        kept_request.source = Mock(value="family")
        kept_request.csv_position = 0
        kept_request.year = 2025
        kept_request.metadata = {}

        # Absorbed request with DIFFERENT source_field (won't match)
        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "Internal Notes"  # Different field
        absorbed_request.merged_into = "kept_request_id"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]

        # Source link for the one being split
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {
                "original_request_id": "orig_bunking_notes",
                "source_field": "BunkingNotes Notes",  # No absorbed request has this
                "is_primary": False,
            },
        ]
        mock_source_link_repo.get_source_field_for_link.return_value = "BunkingNotes Notes"

        # Mock create to set ID
        def set_id_on_create(req):
            req.id = "new_created_id"
            return True

        mock_request_repo.create.side_effect = set_id_on_create

        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "orig_bunking_notes",
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200

        # Should NOT have tried to restore (no match found)
        mock_request_repo.restore_from_merge.assert_not_called()

        # Should have created a new request (fallback)
        mock_request_repo.create.assert_called_once()


class TestSplitEndpointPrimarySourceValidation:
    """Test that split endpoint rejects attempts to split primary source.

    TDD: The primary source must remain with the original request.
    Users should only be able to split off non-primary sources.
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

    def test_split_rejects_primary_source(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split fails when trying to split off the primary source."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.requester_cm_id = 12345
        kept_request.requested_cm_id = 67890
        kept_request.session_cm_id = 1000002
        kept_request.request_type = Mock(value="bunk_with")
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.confidence_score = 0.95
        kept_request.priority = 3
        kept_request.source = Mock(value="family")
        kept_request.csv_position = 0
        kept_request.year = 2025
        kept_request.metadata = {}

        mock_request_repo.get_by_id.return_value = kept_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_request_repo.get_merged_requests.return_value = []  # No merged requests needed for validation

        # Source links - one is primary
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {
                "original_request_id": "orig_primary",
                "source_field": "Share Bunk With",
                "is_primary": True,
            },
            {
                "original_request_id": "orig_secondary",
                "source_field": "BunkingNotes Notes",
                "is_primary": False,
            },
        ]

        # Try to split the PRIMARY source - should be rejected BEFORE processing
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "orig_primary",  # This is the primary!
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "primary" in response.json()["detail"].lower()

    def test_split_allows_non_primary_source(self, client_with_mocks: tuple[TestClient, Mock, Mock]) -> None:
        """Test that split succeeds when splitting non-primary source."""
        client, mock_request_repo, mock_source_link_repo = client_with_mocks

        kept_request = Mock()
        kept_request.id = "kept_request_id"
        kept_request.requester_cm_id = 12345
        kept_request.requested_cm_id = 67890
        kept_request.session_cm_id = 1000002
        kept_request.request_type = Mock(value="bunk_with")
        kept_request.source_fields = ["Share Bunk With", "BunkingNotes Notes"]
        kept_request.confidence_score = 0.95
        kept_request.priority = 3
        kept_request.source = Mock(value="family")
        kept_request.csv_position = 0
        kept_request.year = 2025
        kept_request.metadata = {}

        absorbed_request = Mock()
        absorbed_request.id = "absorbed_request_id"
        absorbed_request.source_field = "BunkingNotes Notes"

        mock_request_repo.get_by_id.return_value = kept_request
        mock_source_link_repo.count_sources_for_request.return_value = 2
        mock_request_repo.get_merged_requests.return_value = [absorbed_request]

        # Source links - one is primary
        mock_source_link_repo.get_source_links_with_fields.return_value = [
            {
                "original_request_id": "orig_primary",
                "source_field": "Share Bunk With",
                "is_primary": True,
            },
            {
                "original_request_id": "orig_secondary",
                "source_field": "BunkingNotes Notes",
                "is_primary": False,
            },
        ]

        mock_source_link_repo.get_source_field_for_link.return_value = "BunkingNotes Notes"
        mock_request_repo.restore_from_merge.return_value = True

        # Split the NON-PRIMARY source - should succeed
        response = client.post(
            "/api/requests/split",
            json={
                "request_id": "kept_request_id",
                "split_sources": [
                    {
                        "original_request_id": "orig_secondary",  # This is NOT primary
                        "new_type": "bunk_with",
                        "new_target_id": None,
                    }
                ],
            },
        )

        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

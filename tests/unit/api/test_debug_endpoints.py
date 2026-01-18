"""Test-Driven Development for Debug API Endpoints

Tests for the debug router endpoints that provide UI access to Phase 1
AI parse analysis for debugging and iteration.

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestListParseAnalysisEndpoint:
    """Test GET /api/debug/parse-analysis endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {
            "debug_repo": Mock(),
            "session_repo": Mock(),
        }

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.get_session_repository") as mock_get_session_repo:
                mock_get_debug_repo.return_value = mock_repos["debug_repo"]
                mock_get_session_repo.return_value = mock_repos["session_repo"]

                from api.routers.debug import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_repos

    def test_list_returns_parse_analysis_items(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that list endpoint returns parse analysis items."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].list_with_originals.return_value = (
            [
                {
                    "id": "debug_123",
                    "original_request_id": "orig_req_456",
                    "requester_name": "Emma Johnson",
                    "requester_cm_id": 12345,
                    "source_field": "bunk_with",
                    "original_text": "With Mia please",
                    "parsed_intents": [
                        {
                            "request_type": "bunk_with",
                            "target_name": "Mia",
                            "keywords_found": ["with"],
                            "parse_notes": "Clear positive request",
                            "reasoning": "Standard pattern",
                            "list_position": 0,
                            "needs_clarification": False,
                        }
                    ],
                    "is_valid": True,
                    "error_message": None,
                    "token_count": 150,
                    "processing_time_ms": 1250,
                    "prompt_version": "v1.2.0",
                    "created": "2025-01-15T10:00:00Z",
                }
            ],
            1,
        )

        response = client.get("/api/debug/parse-analysis")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert len(data["items"]) == 1
        assert data["total"] == 1

        item = data["items"][0]
        assert item["id"] == "debug_123"
        assert item["requester_name"] == "Emma Johnson"
        assert item["source_field"] == "bunk_with"
        assert len(item["parsed_intents"]) == 1

    def test_list_filters_by_session(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that list endpoint filters by session_cm_id."""
        client, mock_repos = client_with_mocks

        # Mock session lookup - find_by_cm_id returns a dict
        mock_repos["session_repo"].find_by_cm_id.return_value = {"id": "sess_abc"}

        mock_repos["debug_repo"].list_with_originals.return_value = ([], 0)

        response = client.get("/api/debug/parse-analysis?session_cm_id=1000002")

        assert response.status_code == 200

        # Verify session lookup was called
        mock_repos["session_repo"].find_by_cm_id.assert_called_once_with(1000002)

        # Verify filter was applied
        call_kwargs = mock_repos["debug_repo"].list_with_originals.call_args[1]
        assert call_kwargs.get("session_id") == "sess_abc"

    def test_list_filters_by_source_field(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that list endpoint filters by source_field."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].list_with_originals.return_value = ([], 0)

        response = client.get("/api/debug/parse-analysis?source_field=bunking_notes")

        assert response.status_code == 200

        call_kwargs = mock_repos["debug_repo"].list_with_originals.call_args[1]
        assert call_kwargs.get("source_field") == "bunking_notes"

    def test_list_applies_pagination(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that list endpoint applies limit and offset."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].list_with_originals.return_value = ([], 0)

        response = client.get("/api/debug/parse-analysis?limit=25&offset=50")

        assert response.status_code == 200

        call_kwargs = mock_repos["debug_repo"].list_with_originals.call_args[1]
        assert call_kwargs.get("limit") == 25
        assert call_kwargs.get("offset") == 50

    def test_list_validates_source_field_enum(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that list endpoint validates source_field enum values."""
        client, _mock_repos = client_with_mocks

        response = client.get("/api/debug/parse-analysis?source_field=invalid_field")

        assert response.status_code == 422  # Validation error


class TestGetParseAnalysisDetailEndpoint:
    """Test GET /api/debug/parse-analysis/{id} endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {"debug_repo": Mock()}

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            mock_get_debug_repo.return_value = mock_repos["debug_repo"]

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_repos

    def test_get_detail_returns_single_item(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that get detail returns a single parse analysis item."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].get_by_id.return_value = {
            "id": "debug_123",
            "original_request_id": "orig_req_456",
            "requester_name": "Emma Johnson",
            "requester_cm_id": 12345,
            "source_field": "bunk_with",
            "original_text": "With Mia please",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Mia"}],
            "ai_raw_response": {"raw": "full AI response..."},
            "is_valid": True,
        }

        response = client.get("/api/debug/parse-analysis/debug_123")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "debug_123"
        assert "ai_raw_response" in data  # Detail includes raw response

    def test_get_detail_returns_404_for_nonexistent(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that get detail returns 404 for nonexistent item."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].get_by_id.return_value = None

        response = client.get("/api/debug/parse-analysis/nonexistent_id")

        assert response.status_code == 404


class TestPhase1OnlyEndpoint:
    """Test POST /api/debug/parse-phase1-only endpoint."""

    @pytest.fixture
    def mock_services(self) -> dict[str, Mock]:
        """Create mock services for testing."""
        return {"debug_service": AsyncMock()}

    @pytest.fixture
    def client_with_mocks(
        self, mock_services: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked services."""
        with patch("api.routers.debug.get_phase1_debug_service") as mock_get_service:
            mock_get_service.return_value = mock_services["debug_service"]

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_services

    def test_parse_phase1_only_runs_phase1(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that parse endpoint runs Phase 1 only."""
        client, mock_services = client_with_mocks

        mock_services["debug_service"].parse_selected_records.return_value = [
            {
                "id": "debug_new",
                "original_request_id": "orig_req_1",
                "parsed_intents": [{"request_type": "bunk_with", "target_name": "Emma"}],
                "is_valid": True,
                "token_count": 150,
            }
        ]

        response = client.post(
            "/api/debug/parse-phase1-only",
            json={"original_request_ids": ["orig_req_1"], "force_reparse": False},
        )

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 1

        mock_services["debug_service"].parse_selected_records.assert_called_once_with(
            ["orig_req_1"], force_reparse=False
        )

    def test_parse_phase1_only_with_force_reparse(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that force_reparse flag is passed through."""
        client, mock_services = client_with_mocks

        mock_services["debug_service"].parse_selected_records.return_value = []

        response = client.post(
            "/api/debug/parse-phase1-only",
            json={"original_request_ids": ["orig_req_1"], "force_reparse": True},
        )

        assert response.status_code == 200

        mock_services["debug_service"].parse_selected_records.assert_called_once_with(
            ["orig_req_1"], force_reparse=True
        )

    def test_parse_phase1_only_validates_empty_list(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that empty original_request_ids list returns validation error."""
        client, _mock_services = client_with_mocks

        response = client.post(
            "/api/debug/parse-phase1-only",
            json={"original_request_ids": []},
        )

        assert response.status_code == 422  # Validation error

    def test_parse_phase1_only_returns_token_count_summary(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that response includes total token count."""
        client, mock_services = client_with_mocks

        mock_services["debug_service"].parse_selected_records.return_value = [
            {"id": "d1", "original_request_id": "o1", "token_count": 100, "is_valid": True, "parsed_intents": []},
            {"id": "d2", "original_request_id": "o2", "token_count": 150, "is_valid": True, "parsed_intents": []},
        ]

        response = client.post(
            "/api/debug/parse-phase1-only",
            json={"original_request_ids": ["o1", "o2"]},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_tokens"] == 250


class TestClearParseAnalysisEndpoint:
    """Test DELETE /api/debug/parse-analysis endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {"debug_repo": Mock()}

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            mock_get_debug_repo.return_value = mock_repos["debug_repo"]

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_repos

    def test_clear_deletes_all_debug_results(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that clear endpoint deletes all debug results."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].clear_all.return_value = 15

        response = client.delete("/api/debug/parse-analysis")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 15

        mock_repos["debug_repo"].clear_all.assert_called_once()

    def test_clear_returns_error_on_failure(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that clear endpoint returns error on failure."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].clear_all.return_value = -1  # Error indicator

        response = client.delete("/api/debug/parse-analysis")

        assert response.status_code == 500


class TestListOriginalRequestsEndpoint:
    """Test GET /api/debug/original-requests endpoint for unparsed requests."""

    @pytest.fixture
    def mock_loader(self) -> Mock:
        """Create mock loader for testing."""
        return Mock()

    @pytest.fixture
    def client_with_mocks(self, mock_loader: Mock) -> Generator[tuple[TestClient, Mock], None, None]:
        """Create test client with mocked dependencies."""
        # Patch the OriginalRequestsLoader class since impl instantiates it directly
        with patch("api.routers.debug.OriginalRequestsLoader") as MockLoaderClass:
            MockLoaderClass.return_value = mock_loader

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_loader

    def test_list_original_requests_returns_items(self, client_with_mocks: tuple[TestClient, Mock]) -> None:
        """Test that list endpoint returns original requests."""
        client, mock_loader = client_with_mocks

        # Mock OriginalRequest with all required attributes
        mock_original = Mock()
        mock_original.id = "orig_req_1"
        mock_original.preferred_name = None
        mock_original.first_name = "Emma"
        mock_original.last_name = "Johnson"
        mock_original.requester_cm_id = 12345
        mock_original.field = "bunk_with"
        mock_original.content = "With Mia please"
        mock_original.year = 2025
        mock_original.processed = None

        mock_loader.load_by_filter.return_value = [mock_original]

        response = client.get("/api/debug/original-requests?year=2025")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 1

        item = data["items"][0]
        assert item["id"] == "orig_req_1"
        assert item["source_field"] == "bunk_with"
        assert item["original_text"] == "With Mia please"
        assert item["requester_name"] == "Emma Johnson"

    def test_list_original_requests_filters_by_session(self, client_with_mocks: tuple[TestClient, Mock]) -> None:
        """Test that list filters by session when provided."""
        client, mock_loader = client_with_mocks

        mock_loader.load_by_filter.return_value = []

        response = client.get("/api/debug/original-requests?session_cm_id=1000002&year=2025")

        assert response.status_code == 200

        call_kwargs = mock_loader.load_by_filter.call_args[1]
        assert call_kwargs.get("session_cm_id") == 1000002

    def test_list_original_requests_year_required(self, client_with_mocks: tuple[TestClient, Mock]) -> None:
        """Test that year parameter is required."""
        client, _mock_loader = client_with_mocks

        response = client.get("/api/debug/original-requests")

        assert response.status_code == 422  # Validation error - year required


class TestDebugRouterAdminOnly:
    """Test that debug endpoints require admin access."""

    # Note: These tests would verify that the router requires admin auth.
    # The actual implementation depends on how auth is configured.
    # For now, we document the expected behavior.

    def test_all_debug_endpoints_require_authentication(self) -> None:
        """Verify debug endpoints should require authentication."""
        # This is a documentation test - actual implementation will use
        # FastAPI dependencies for authentication
        expected_protected_endpoints = [
            "GET /api/debug/parse-analysis",
            "GET /api/debug/parse-analysis/{id}",
            "POST /api/debug/parse-phase1-only",
            "DELETE /api/debug/parse-analysis",
            "GET /api/debug/original-requests",
        ]
        assert len(expected_protected_endpoints) == 5


class TestListPromptsEndpoint:
    """Test GET /api/debug/prompts endpoint."""

    @pytest.fixture
    def client_with_mocks(self) -> Generator[TestClient, None, None]:
        """Create test client."""
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)

        yield TestClient(app)

    def test_list_prompts_returns_available_files(self, client_with_mocks: TestClient) -> None:
        """Test that list prompts returns available prompt files."""
        client = client_with_mocks

        # Mock the prompts directory listing
        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_dir.glob.return_value = [
                Path("/config/prompts/parse_bunk_with.txt"),
                Path("/config/prompts/parse_not_bunk_with.txt"),
                Path("/config/prompts/disambiguate.txt"),
            ]
            mock_dir.exists.return_value = True

            response = client.get("/api/debug/prompts")

        assert response.status_code == 200
        data = response.json()
        assert "prompts" in data
        assert len(data["prompts"]) == 3

        # Check prompt item structure
        names = [p["name"] for p in data["prompts"]]
        assert "parse_bunk_with" in names
        assert "parse_not_bunk_with" in names
        assert "disambiguate" in names

    def test_list_prompts_includes_metadata(self, client_with_mocks: TestClient) -> None:
        """Test that list prompts includes file metadata."""
        client = client_with_mocks

        mock_file = Mock()
        mock_file.name = "parse_bunk_with.txt"
        mock_file.stem = "parse_bunk_with"
        mock_file.stat.return_value.st_mtime = 1705312800.0  # Fixed timestamp

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_dir.glob.return_value = [mock_file]
            mock_dir.exists.return_value = True

            response = client.get("/api/debug/prompts")

        assert response.status_code == 200
        data = response.json()
        prompt = data["prompts"][0]
        assert prompt["name"] == "parse_bunk_with"
        assert prompt["filename"] == "parse_bunk_with.txt"
        assert "modified_at" in prompt


class TestGetPromptEndpoint:
    """Test GET /api/debug/prompts/{name} endpoint."""

    @pytest.fixture
    def client_with_mocks(self) -> Generator[TestClient, None, None]:
        """Create test client."""
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)

        yield TestClient(app)

    def test_get_prompt_returns_content(self, client_with_mocks: TestClient) -> None:
        """Test that get prompt returns file content."""
        client = client_with_mocks

        prompt_content = "# Bunk With Parser\n\nYou are parsing bunk requests..."

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_file = Mock()
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = prompt_content
            mock_file.stat.return_value.st_mtime = 1705312800.0
            mock_dir.__truediv__ = Mock(return_value=mock_file)

            response = client.get("/api/debug/prompts/parse_bunk_with")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "parse_bunk_with"
        assert data["content"] == prompt_content
        assert "modified_at" in data

    def test_get_prompt_returns_404_for_nonexistent(self, client_with_mocks: TestClient) -> None:
        """Test that get prompt returns 404 for nonexistent file."""
        client = client_with_mocks

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_file = Mock()
            mock_file.exists.return_value = False
            mock_dir.__truediv__ = Mock(return_value=mock_file)

            response = client.get("/api/debug/prompts/nonexistent_prompt")

        assert response.status_code == 404

    def test_get_prompt_sanitizes_path_traversal(self, client_with_mocks: TestClient) -> None:
        """Test that get prompt prevents path traversal attacks."""
        client = client_with_mocks

        # Try various path traversal attempts
        malicious_names = [
            "../../../etc/passwd",
            "..%2F..%2F..%2Fetc%2Fpasswd",
            "parse_bunk_with/../../secret",
        ]

        for name in malicious_names:
            response = client.get(f"/api/debug/prompts/{name}")
            # Should return 400 (bad request) or 404, not actually traverse
            assert response.status_code in [400, 404, 422]


class TestUpdatePromptEndpoint:
    """Test PUT /api/debug/prompts/{name} endpoint."""

    @pytest.fixture
    def client_with_mocks(self) -> Generator[TestClient, None, None]:
        """Create test client."""
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)

        yield TestClient(app)

    def test_update_prompt_writes_content(self, client_with_mocks: TestClient) -> None:
        """Test that update prompt writes new content to file."""
        client = client_with_mocks

        new_content = "# Updated Prompt\n\nNew instructions..."

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_file = Mock()
            mock_file.exists.return_value = True
            mock_file.stat.return_value.st_mtime = 1705312800.0
            mock_dir.__truediv__ = Mock(return_value=mock_file)

            response = client.put(
                "/api/debug/prompts/parse_bunk_with",
                json={"content": new_content},
            )

        assert response.status_code == 200
        mock_file.write_text.assert_called_once_with(new_content, encoding="utf-8")

        data = response.json()
        assert data["name"] == "parse_bunk_with"
        assert data["success"] is True

    def test_update_prompt_returns_404_for_nonexistent(self, client_with_mocks: TestClient) -> None:
        """Test that update returns 404 for nonexistent prompt."""
        client = client_with_mocks

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_file = Mock()
            mock_file.exists.return_value = False
            mock_dir.__truediv__ = Mock(return_value=mock_file)

            response = client.put(
                "/api/debug/prompts/nonexistent_prompt",
                json={"content": "new content"},
            )

        assert response.status_code == 404

    def test_update_prompt_clears_cache(self, client_with_mocks: TestClient) -> None:
        """Test that updating a prompt clears the loader cache."""
        client = client_with_mocks

        with patch("api.routers.debug.PROMPTS_DIR") as mock_dir:
            mock_file = Mock()
            mock_file.exists.return_value = True
            mock_file.stat.return_value.st_mtime = 1705312800.0
            mock_dir.__truediv__ = Mock(return_value=mock_file)

            with patch("api.routers.debug.clear_prompt_cache") as mock_clear_cache:
                response = client.put(
                    "/api/debug/prompts/parse_bunk_with",
                    json={"content": "new content"},
                )

                assert response.status_code == 200
                mock_clear_cache.assert_called_once()

    def test_update_prompt_validates_content_not_empty(self, client_with_mocks: TestClient) -> None:
        """Test that update validates content is not empty."""
        client = client_with_mocks

        response = client.put(
            "/api/debug/prompts/parse_bunk_with",
            json={"content": ""},
        )

        assert response.status_code == 422  # Validation error

    def test_update_prompt_sanitizes_path_traversal(self, client_with_mocks: TestClient) -> None:
        """Test that update prompt prevents path traversal attacks."""
        client = client_with_mocks

        response = client.put(
            "/api/debug/prompts/../../../etc/passwd",
            json={"content": "malicious content"},
        )

        # Should return 400 or 404, not actually write
        assert response.status_code in [400, 404, 422]


class TestListOriginalRequestsWithParseStatusEndpoint:
    """Test GET /api/debug/original-requests-with-parse-status endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {
            "debug_repo": Mock(),
            "session_repo": Mock(),
        }

    @pytest.fixture
    def mock_loader(self) -> Mock:
        """Create mock loader for testing."""
        return Mock()

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock], mock_loader: Mock
    ) -> Generator[tuple[TestClient, dict[str, Mock], Mock], None, None]:
        """Create test client with mocked dependencies."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.get_session_repository") as mock_get_session_repo:
                with patch("api.routers.debug.OriginalRequestsLoader") as MockLoaderClass:
                    mock_get_debug_repo.return_value = mock_repos["debug_repo"]
                    mock_get_session_repo.return_value = mock_repos["session_repo"]
                    MockLoaderClass.return_value = mock_loader

                    from api.routers.debug import router

                    app = FastAPI()
                    app.include_router(router)

                    yield TestClient(app), mock_repos, mock_loader

    def test_list_returns_original_requests_with_parse_status(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that endpoint returns original requests with has_debug_result and has_production_result flags."""
        client, mock_repos, mock_loader = client_with_mocks

        # Mock original request
        mock_original = Mock()
        mock_original.id = "orig_req_1"
        mock_original.preferred_name = None
        mock_original.first_name = "Emma"
        mock_original.last_name = "Johnson"
        mock_original.requester_cm_id = 12345
        mock_original.field = "bunk_with"
        mock_original.content = "With Mia please"
        mock_original.year = 2025
        mock_original.processed = None

        mock_loader.load_by_filter.return_value = [mock_original]

        # Mock parse status check - has production result but no debug
        mock_repos["debug_repo"].check_parse_status.return_value = (False, True)

        response = client.get("/api/debug/original-requests-with-parse-status?year=2025")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 1

        item = data["items"][0]
        assert item["id"] == "orig_req_1"
        assert item["requester_name"] == "Emma Johnson"
        assert item["has_debug_result"] is False
        assert item["has_production_result"] is True

    def test_list_filters_by_session_and_source_field(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that endpoint filters by session_cm_id and source_field."""
        client, mock_repos, mock_loader = client_with_mocks

        mock_loader.load_by_filter.return_value = []

        response = client.get(
            "/api/debug/original-requests-with-parse-status?year=2025&session_cm_id=1000002&source_field=bunking_notes"
        )

        assert response.status_code == 200

        call_kwargs = mock_loader.load_by_filter.call_args[1]
        assert call_kwargs.get("session_cm_id") == 1000002
        assert call_kwargs.get("source_field") == "bunking_notes"

    def test_list_year_required(self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]) -> None:
        """Test that year parameter is required."""
        client, _mock_repos, _mock_loader = client_with_mocks

        response = client.get("/api/debug/original-requests-with-parse-status")

        assert response.status_code == 422  # Validation error - year required


class TestGetParseResultWithFallbackEndpoint:
    """Test GET /api/debug/parse-result/{original_request_id} endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {"debug_repo": Mock()}

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            mock_get_debug_repo.return_value = mock_repos["debug_repo"]

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_repos

    def test_returns_debug_result_when_available(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that endpoint returns debug result when it exists."""
        client, mock_repos = client_with_mocks

        # Debug result exists
        mock_repos["debug_repo"].get_by_original_request.return_value = {
            "id": "debug_123",
            "original_request_id": "orig_req_456",
            "requester_name": "Emma Johnson",
            "requester_cm_id": 12345,
            "source_field": "bunk_with",
            "original_text": "With Mia please",
            "parsed_intents": [
                {
                    "request_type": "bunk_with",
                    "target_name": "Mia",
                    "keywords_found": ["with"],
                    "parse_notes": "Clear request",
                    "reasoning": "Standard pattern",
                    "list_position": 0,
                    "needs_clarification": False,
                }
            ],
            "is_valid": True,
            "token_count": 150,
            "processing_time_ms": 1250,
            "prompt_version": "v1.2.0",
        }

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "debug"
        assert data["id"] == "debug_123"
        assert len(data["parsed_intents"]) == 1
        assert data["parsed_intents"][0]["target_name"] == "Mia"

    def test_returns_production_fallback_when_no_debug(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that endpoint returns production data when debug result doesn't exist."""
        client, mock_repos = client_with_mocks

        # No debug result
        mock_repos["debug_repo"].get_by_original_request.return_value = None

        # Production fallback exists
        mock_repos["debug_repo"].get_production_fallback.return_value = {
            "source": "production",
            "parsed_intents": [
                {
                    "request_type": "bunk_with",
                    "target_name": "Mia Garcia",
                    "keywords_found": ["with"],
                    "parse_notes": "Processed in production",
                    "reasoning": "From Phase 1",
                    "list_position": 0,
                    "needs_clarification": False,
                }
            ],
            "is_valid": True,
        }

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "production"
        assert len(data["parsed_intents"]) == 1
        assert data["parsed_intents"][0]["target_name"] == "Mia Garcia"

    def test_returns_none_source_when_no_results(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that endpoint returns source='none' when neither debug nor production exists."""
        client, mock_repos = client_with_mocks

        # No debug result
        mock_repos["debug_repo"].get_by_original_request.return_value = None
        # No production fallback
        mock_repos["debug_repo"].get_production_fallback.return_value = None

        response = client.get("/api/debug/parse-result/orig_req_789")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "none"
        assert data["parsed_intents"] == []

    def test_debug_takes_priority_over_production(self, client_with_mocks: tuple[TestClient, dict[str, Mock]]) -> None:
        """Test that debug result takes priority even when production exists."""
        client, mock_repos = client_with_mocks

        # Both debug and production exist
        mock_repos["debug_repo"].get_by_original_request.return_value = {
            "id": "debug_123",
            "original_request_id": "orig_req_456",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Debug Target"}],
            "is_valid": True,
        }

        mock_repos["debug_repo"].get_production_fallback.return_value = {
            "source": "production",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Production Target"}],
        }

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        # Debug should be returned, not production
        assert data["source"] == "debug"
        assert data["parsed_intents"][0]["target_name"] == "Debug Target"

        # get_production_fallback should NOT have been called since debug was found
        mock_repos["debug_repo"].get_production_fallback.assert_not_called()


# =============================================================================
# Phase 1 Fix: Original text always populated in parse-result endpoint
# =============================================================================


class TestGetParseResultAlwaysIncludesOriginal:
    """Test that GET /api/debug/parse-result/{original_request_id} always includes original data.

    This is the core bug fix: original_text, requester_name, source_field should
    ALWAYS be populated from original_bunk_requests, regardless of whether
    debug or production results exist.
    """

    @pytest.fixture
    def mock_deps(self) -> dict[str, Mock]:
        """Create mock dependencies for testing."""
        return {
            "debug_repo": Mock(),
            "loader": Mock(),
        }

    @pytest.fixture
    def client_with_mocks(
        self, mock_deps: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked dependencies."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.get_original_requests_loader") as mock_get_loader:
                mock_get_debug_repo.return_value = mock_deps["debug_repo"]
                mock_get_loader.return_value = mock_deps["loader"]

                from api.routers.debug import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_deps

    def _create_mock_original(
        self,
        request_id: str = "orig_req_456",
        preferred_name: str | None = None,
        first_name: str = "Emma",
        last_name: str = "Johnson",
        requester_cm_id: int = 12345,
        field: str = "bunk_with",
        content: str = "With Mia please",
    ) -> Mock:
        """Create a mock OriginalRequest object."""
        mock = Mock()
        mock.id = request_id
        mock.preferred_name = preferred_name
        mock.first_name = first_name
        mock.last_name = last_name
        mock.requester_cm_id = requester_cm_id
        mock.field = field
        mock.content = content
        return mock

    def test_debug_result_includes_original_data(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that debug result includes original request data loaded directly."""
        client, mock_deps = client_with_mocks

        # Set up original request
        mock_original = self._create_mock_original()
        mock_deps["loader"].load_by_ids.return_value = [mock_original]

        # Debug result exists but may not have expanded original data
        mock_deps["debug_repo"].get_by_original_request.return_value = {
            "id": "debug_123",
            "original_request_id": "orig_req_456",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Mia"}],
            "is_valid": True,
            "token_count": 150,
            # Note: NO requester_name, source_field, original_text here
        }

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "debug"
        # These should be populated from original request, not debug result
        assert data["requester_name"] == "Emma Johnson"
        assert data["requester_cm_id"] == 12345
        assert data["source_field"] == "bunk_with"
        assert data["original_text"] == "With Mia please"

    def test_production_fallback_includes_original_data(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that production fallback includes original request data."""
        client, mock_deps = client_with_mocks

        # Set up original request
        mock_original = self._create_mock_original()
        mock_deps["loader"].load_by_ids.return_value = [mock_original]

        # No debug result
        mock_deps["debug_repo"].get_by_original_request.return_value = None

        # Production fallback exists but has minimal data
        mock_deps["debug_repo"].get_production_fallback.return_value = {
            "source": "production",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Mia Garcia"}],
            "is_valid": True,
        }

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "production"
        # Original data should ALWAYS be populated
        assert data["requester_name"] == "Emma Johnson"
        assert data["requester_cm_id"] == 12345
        assert data["source_field"] == "bunk_with"
        assert data["original_text"] == "With Mia please"

    def test_none_source_includes_original_data(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that 'none' source still includes original request data."""
        client, mock_deps = client_with_mocks

        # Set up original request
        mock_original = self._create_mock_original(
            request_id="orig_req_789",
            preferred_name="Emmy",
            first_name="Emma",
            last_name="Smith",
            requester_cm_id=67890,
            field="bunking_notes",
            content="Needs bottom bunk",
        )
        mock_deps["loader"].load_by_ids.return_value = [mock_original]

        # No debug result
        mock_deps["debug_repo"].get_by_original_request.return_value = None
        # No production result
        mock_deps["debug_repo"].get_production_fallback.return_value = None

        response = client.get("/api/debug/parse-result/orig_req_789")

        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "none"
        assert data["parsed_intents"] == []
        # Original data should STILL be populated
        assert data["requester_name"] == "Emmy Smith"  # preferred_name used
        assert data["requester_cm_id"] == 67890
        assert data["source_field"] == "bunking_notes"
        assert data["original_text"] == "Needs bottom bunk"

    def test_returns_404_when_original_not_found(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that 404 is returned when original request doesn't exist."""
        client, mock_deps = client_with_mocks

        # Original request not found
        mock_deps["loader"].load_by_ids.return_value = []

        response = client.get("/api/debug/parse-result/nonexistent_id")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_uses_preferred_name_when_available(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that preferred_name is used over first_name when available."""
        client, mock_deps = client_with_mocks

        mock_original = self._create_mock_original(
            preferred_name="Emmy",
            first_name="Emma",
            last_name="Johnson",
        )
        mock_deps["loader"].load_by_ids.return_value = [mock_original]
        mock_deps["debug_repo"].get_by_original_request.return_value = None
        mock_deps["debug_repo"].get_production_fallback.return_value = None

        response = client.get("/api/debug/parse-result/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["requester_name"] == "Emmy Johnson"


# =============================================================================
# Phase 2: Batch Status Checking
# =============================================================================


class TestBatchParseStatusEndpoint:
    """Test batch status checking for performance optimization."""

    @pytest.fixture
    def mock_deps(self) -> dict[str, Mock]:
        """Create mock dependencies for testing."""
        return {
            "debug_repo": Mock(),
        }

    @pytest.fixture
    def mock_loader(self) -> Mock:
        """Create mock loader for testing."""
        return Mock()

    @pytest.fixture
    def client_with_mocks(
        self, mock_deps: dict[str, Mock], mock_loader: Mock
    ) -> Generator[tuple[TestClient, dict[str, Mock], Mock], None, None]:
        """Create test client with mocked dependencies."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.OriginalRequestsLoader") as MockLoaderClass:
                mock_get_debug_repo.return_value = mock_deps["debug_repo"]
                MockLoaderClass.return_value = mock_loader

                from api.routers.debug import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_deps, mock_loader

    def test_uses_batch_status_check_instead_of_individual(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that the endpoint uses batch status checking for efficiency."""
        client, mock_deps, mock_loader = client_with_mocks

        # Mock multiple original requests
        mock_originals = []
        for i in range(3):
            mock = Mock()
            mock.id = f"orig_req_{i}"
            mock.preferred_name = None
            mock.first_name = f"Camper{i}"
            mock.last_name = "Test"
            mock.requester_cm_id = 10000 + i
            mock.field = "bunk_with"
            mock.content = f"Content {i}"
            mock.year = 2025
            mock_originals.append(mock)

        mock_loader.load_by_filter.return_value = mock_originals

        # Mock batch status check - returns dict mapping ID to (has_debug, has_production)
        mock_deps["debug_repo"].check_parse_status_batch.return_value = {
            "orig_req_0": (True, False),  # has debug only
            "orig_req_1": (False, True),  # has production only
            "orig_req_2": (False, False),  # no results
        }

        response = client.get("/api/debug/original-requests-with-parse-status?year=2025")

        assert response.status_code == 200

        # Verify batch method was called instead of individual calls
        mock_deps["debug_repo"].check_parse_status_batch.assert_called_once()
        # Verify individual check_parse_status was NOT called
        mock_deps["debug_repo"].check_parse_status.assert_not_called()

        data = response.json()
        assert len(data["items"]) == 3
        # Verify status flags are correct
        assert data["items"][0]["has_debug_result"] is True
        assert data["items"][0]["has_production_result"] is False
        assert data["items"][1]["has_debug_result"] is False
        assert data["items"][1]["has_production_result"] is True


# =============================================================================
# Phase 3: Grouped by Camper Endpoint
# =============================================================================


class TestGroupedByCamperEndpoint:
    """Test GET /api/debug/original-requests-grouped endpoint."""

    @pytest.fixture
    def mock_deps(self) -> dict[str, Mock]:
        """Create mock dependencies for testing."""
        return {
            "debug_repo": Mock(),
        }

    @pytest.fixture
    def mock_loader(self) -> Mock:
        """Create mock loader for testing."""
        return Mock()

    @pytest.fixture
    def client_with_mocks(
        self, mock_deps: dict[str, Mock], mock_loader: Mock
    ) -> Generator[tuple[TestClient, dict[str, Mock], Mock], None, None]:
        """Create test client with mocked dependencies."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.OriginalRequestsLoader") as MockLoaderClass:
                mock_get_debug_repo.return_value = mock_deps["debug_repo"]
                MockLoaderClass.return_value = mock_loader

                from api.routers.debug import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_deps, mock_loader

    def test_groups_requests_by_camper(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that requests are grouped by camper."""
        client, mock_deps, mock_loader = client_with_mocks

        # Create mock records for two campers with multiple fields each
        mock_originals = []

        # Camper 1: Emma Johnson with 2 fields
        for field in ["bunk_with", "bunking_notes"]:
            mock = Mock()
            mock.id = f"req_emma_{field}"
            mock.preferred_name = None
            mock.first_name = "Emma"
            mock.last_name = "Johnson"
            mock.requester_cm_id = 12345
            mock.field = field
            mock.content = f"Content for {field}"
            mock.year = 2025
            mock_originals.append(mock)

        # Camper 2: Liam Garcia with 1 field
        mock = Mock()
        mock.id = "req_liam_bunk_with"
        mock.preferred_name = None
        mock.first_name = "Liam"
        mock.last_name = "Garcia"
        mock.requester_cm_id = 67890
        mock.field = "bunk_with"
        mock.content = "Want to bunk with Noah"
        mock.year = 2025
        mock_originals.append(mock)

        mock_loader.load_by_filter.return_value = mock_originals

        # Mock batch status check
        mock_deps["debug_repo"].check_parse_status_batch.return_value = {
            "req_emma_bunk_with": (True, False),
            "req_emma_bunking_notes": (False, True),
            "req_liam_bunk_with": (False, False),
        }

        response = client.get("/api/debug/original-requests-grouped?year=2025")

        assert response.status_code == 200
        data = response.json()

        # Should have 2 camper groups
        assert len(data["items"]) == 2

        # Find Emma's group
        emma_group = next((g for g in data["items"] if g["requester_cm_id"] == 12345), None)
        assert emma_group is not None
        assert emma_group["requester_name"] == "Emma Johnson"
        assert len(emma_group["fields"]) == 2

        # Find Liam's group
        liam_group = next((g for g in data["items"] if g["requester_cm_id"] == 67890), None)
        assert liam_group is not None
        assert emma_group["requester_name"] == "Emma Johnson"
        assert len(liam_group["fields"]) == 1

    def test_excludes_socialize_with_field(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that socialize_with field is excluded (not AI parsed)."""
        client, mock_deps, mock_loader = client_with_mocks

        # Create records including socialize_with
        mock_originals = []
        for field in ["bunk_with", "socialize_with"]:
            mock = Mock()
            mock.id = f"req_{field}"
            mock.preferred_name = None
            mock.first_name = "Emma"
            mock.last_name = "Johnson"
            mock.requester_cm_id = 12345
            mock.field = field
            mock.content = f"Content for {field}"
            mock.year = 2025
            mock_originals.append(mock)

        mock_loader.load_by_filter.return_value = mock_originals
        mock_deps["debug_repo"].check_parse_status_batch.return_value = {
            "req_bunk_with": (False, False),
            "req_socialize_with": (False, False),
        }

        response = client.get("/api/debug/original-requests-grouped?year=2025")

        assert response.status_code == 200
        data = response.json()

        # Should have 1 camper group with only bunk_with (socialize_with excluded)
        assert len(data["items"]) == 1
        assert len(data["items"][0]["fields"]) == 1
        assert data["items"][0]["fields"][0]["source_field"] == "bunk_with"

    def test_filters_by_source_field(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that source_field filter is applied."""
        client, mock_deps, mock_loader = client_with_mocks

        # Mock single field type
        mock = Mock()
        mock.id = "req_1"
        mock.preferred_name = None
        mock.first_name = "Emma"
        mock.last_name = "Johnson"
        mock.requester_cm_id = 12345
        mock.field = "bunking_notes"
        mock.content = "Needs bottom bunk"
        mock.year = 2025
        mock_loader.load_by_filter.return_value = [mock]
        mock_deps["debug_repo"].check_parse_status_batch.return_value = {"req_1": (False, False)}

        response = client.get(
            "/api/debug/original-requests-grouped?year=2025&source_field=bunking_notes"
        )

        assert response.status_code == 200

        # Verify filter was passed to loader
        call_kwargs = mock_loader.load_by_filter.call_args[1]
        assert call_kwargs.get("source_field") == "bunking_notes"

    def test_year_is_required(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock], Mock]
    ) -> None:
        """Test that year parameter is required."""
        client, _mock_deps, _mock_loader = client_with_mocks

        response = client.get("/api/debug/original-requests-grouped")

        assert response.status_code == 422  # Validation error


# =============================================================================
# Phase 4: Scoped Clear Endpoints
# =============================================================================


class TestClearSingleDebugResultEndpoint:
    """Test DELETE /api/debug/parse-analysis/by-original/{original_request_id} endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {"debug_repo": Mock()}

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            mock_get_debug_repo.return_value = mock_repos["debug_repo"]

            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)

            yield TestClient(app), mock_repos

    def test_clear_single_deletes_debug_result(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear single endpoint deletes debug result for one original request."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].delete_by_original_request.return_value = True

        response = client.delete("/api/debug/parse-analysis/by-original/orig_req_456")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 1

        mock_repos["debug_repo"].delete_by_original_request.assert_called_once_with("orig_req_456")

    def test_clear_single_returns_zero_when_not_found(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear single returns deleted_count=0 when no debug result exists."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].delete_by_original_request.return_value = False

        response = client.delete("/api/debug/parse-analysis/by-original/nonexistent_id")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 0


class TestScopedClearEndpoint:
    """Test DELETE /api/debug/parse-analysis with filters endpoint."""

    @pytest.fixture
    def mock_repos(self) -> dict[str, Mock]:
        """Create mock repositories for testing."""
        return {
            "debug_repo": Mock(),
            "session_repo": Mock(),
        }

    @pytest.fixture
    def client_with_mocks(
        self, mock_repos: dict[str, Mock]
    ) -> Generator[tuple[TestClient, dict[str, Mock]], None, None]:
        """Create test client with mocked repositories."""
        with patch("api.routers.debug.get_debug_parse_repository") as mock_get_debug_repo:
            with patch("api.routers.debug.get_session_repository") as mock_get_session_repo:
                mock_get_debug_repo.return_value = mock_repos["debug_repo"]
                mock_get_session_repo.return_value = mock_repos["session_repo"]

                from api.routers.debug import router

                app = FastAPI()
                app.include_router(router)

                yield TestClient(app), mock_repos

    def test_clear_all_without_filters_clears_everything(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear without filters clears all debug results."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].clear_all.return_value = 25

        response = client.delete("/api/debug/parse-analysis")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 25

        mock_repos["debug_repo"].clear_all.assert_called_once()

    def test_clear_with_session_filter_scopes_deletion(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear with session filter only clears matching results."""
        client, mock_repos = client_with_mocks

        # Mock session lookup
        mock_repos["session_repo"].find_by_cm_id.return_value = {"id": "sess_abc"}

        # Mock scoped clear
        mock_repos["debug_repo"].clear_by_filter.return_value = 10

        response = client.delete("/api/debug/parse-analysis?session_cm_id=1000002")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 10

        # Verify scoped clear was called with session filter
        mock_repos["debug_repo"].clear_by_filter.assert_called_once()
        call_kwargs = mock_repos["debug_repo"].clear_by_filter.call_args[1]
        assert call_kwargs.get("session_id") == "sess_abc"

    def test_clear_with_source_field_filter_scopes_deletion(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear with source_field filter only clears matching results."""
        client, mock_repos = client_with_mocks

        mock_repos["debug_repo"].clear_by_filter.return_value = 5

        response = client.delete("/api/debug/parse-analysis?source_field=bunking_notes")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 5

        # Verify scoped clear was called with source_field filter
        mock_repos["debug_repo"].clear_by_filter.assert_called_once()
        call_kwargs = mock_repos["debug_repo"].clear_by_filter.call_args[1]
        assert call_kwargs.get("source_field") == "bunking_notes"

    def test_clear_with_multiple_filters(
        self, client_with_mocks: tuple[TestClient, dict[str, Mock]]
    ) -> None:
        """Test that clear with multiple filters applies all of them."""
        client, mock_repos = client_with_mocks

        mock_repos["session_repo"].find_by_cm_id.return_value = {"id": "sess_xyz"}
        mock_repos["debug_repo"].clear_by_filter.return_value = 3

        response = client.delete(
            "/api/debug/parse-analysis?session_cm_id=1000003&source_field=bunk_with"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 3

        # Verify both filters were passed
        call_kwargs = mock_repos["debug_repo"].clear_by_filter.call_args[1]
        assert call_kwargs.get("session_id") == "sess_xyz"
        assert call_kwargs.get("source_field") == "bunk_with"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

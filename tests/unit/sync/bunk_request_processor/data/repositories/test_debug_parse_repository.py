"""Test-Driven Development for Debug Parse Repository

Tests for the debug_parse_repository that stores Phase 1 AI parsing results
in a separate debug collection for analysis and iteration.

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any
from unittest.mock import Mock

import pytest

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
        DebugParseRepository,
    )

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestDebugParseRepositorySaveResult:
    """Test saving Phase 1 debug results."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]) -> "DebugParseRepository":
        """Create a DebugParseRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
            DebugParseRepository,
        )

        mock_client, _ = mock_pb_client
        return DebugParseRepository(mock_client)

    def test_save_result_creates_record_with_all_fields(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that save_result creates a record with all required fields."""
        _, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="debug_123")

        result_data = {
            "original_request_id": "orig_req_456",
            "session_id": "sess_789",
            "parsed_intents": [
                {
                    "request_type": "bunk_with",
                    "target_name": "Emma Johnson",
                    "keywords_found": ["with"],
                    "parse_notes": "Clear positive request",
                    "reasoning": "Standard bunk_with pattern",
                    "list_position": 0,
                    "needs_clarification": False,
                }
            ],
            "ai_raw_response": {"raw": "model output..."},
            "token_count": 150,
            "prompt_version": "v1.2.0",
            "processing_time_ms": 1250,
            "is_valid": True,
            "error_message": None,
        }

        result = repository.save_result(result_data)

        assert result == "debug_123"
        mock_collection.create.assert_called_once()
        create_args = mock_collection.create.call_args[0][0]

        assert create_args["original_request"] == "orig_req_456"
        assert create_args["session"] == "sess_789"
        assert create_args["parsed_intents"] == result_data["parsed_intents"]
        assert create_args["ai_raw_response"] == {"raw": "model output..."}
        assert create_args["token_count"] == 150
        assert create_args["prompt_version"] == "v1.2.0"
        assert create_args["processing_time_ms"] == 1250
        assert create_args["is_valid"] is True

    def test_save_result_handles_empty_session(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that save_result handles None session gracefully."""
        _, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="debug_124")

        result_data: dict[str, Any] = {
            "original_request_id": "orig_req_456",
            "session_id": None,  # No session filter
            "parsed_intents": [],
            "is_valid": True,
        }

        result = repository.save_result(result_data)

        assert result == "debug_124"
        create_args = mock_collection.create.call_args[0][0]
        assert create_args.get("session", "") == ""

    def test_save_result_stores_error_for_failed_parse(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that save_result stores error message for failed parses."""
        _, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="debug_125")

        result_data = {
            "original_request_id": "orig_req_456",
            "parsed_intents": [],
            "is_valid": False,
            "error_message": "AI parsing failed: rate limit exceeded",
        }

        repository.save_result(result_data)

        create_args = mock_collection.create.call_args[0][0]
        assert create_args["is_valid"] is False
        assert create_args["error_message"] == "AI parsing failed: rate limit exceeded"

    def test_save_result_returns_none_on_error(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that save_result returns None on database error."""
        _, mock_collection = mock_pb_client
        mock_collection.create.side_effect = Exception("DB connection failed")

        result_data = {
            "original_request_id": "orig_req_456",
            "parsed_intents": [],
            "is_valid": True,
        }

        result = repository.save_result(result_data)

        assert result is None


class TestDebugParseRepositoryGetByOriginalRequest:
    """Test fetching cached debug results by original request."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]) -> "DebugParseRepository":
        """Create a DebugParseRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
            DebugParseRepository,
        )

        mock_client, _ = mock_pb_client
        return DebugParseRepository(mock_client)

    def test_get_by_original_request_returns_cached_result(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that get_by_original_request returns cached debug result."""
        _, mock_collection = mock_pb_client

        mock_record = Mock()
        mock_record.id = "debug_123"
        mock_record.original_request = "orig_req_456"
        mock_record.parsed_intents = [{"request_type": "bunk_with", "target_name": "Emma"}]
        mock_record.is_valid = True
        mock_record.error_message = None
        mock_record.token_count = 150
        mock_record.processing_time_ms = 1250
        mock_record.prompt_version = "v1.2.0"
        mock_record.created = "2025-01-15T10:00:00Z"

        mock_result = Mock()
        mock_result.items = [mock_record]
        mock_collection.get_list.return_value = mock_result

        result = repository.get_by_original_request("orig_req_456")

        assert result is not None
        assert result["id"] == "debug_123"
        assert result["original_request_id"] == "orig_req_456"
        assert result["parsed_intents"] == [{"request_type": "bunk_with", "target_name": "Emma"}]

        # Verify filter query
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert 'original_request = "orig_req_456"' in filter_str

    def test_get_by_original_request_returns_none_when_not_found(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that get_by_original_request returns None when no cached result."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        result = repository.get_by_original_request("nonexistent_id")

        assert result is None

    def test_get_by_original_request_returns_most_recent(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that get_by_original_request returns the most recent result."""
        _, mock_collection = mock_pb_client

        mock_record_old = Mock()
        mock_record_old.id = "debug_old"
        mock_record_old.created = "2025-01-14T10:00:00Z"

        mock_record_new = Mock()
        mock_record_new.id = "debug_new"
        mock_record_new.original_request = "orig_req_456"
        mock_record_new.parsed_intents = []
        mock_record_new.is_valid = True
        mock_record_new.error_message = None
        mock_record_new.token_count = 100
        mock_record_new.processing_time_ms = 900
        mock_record_new.prompt_version = "v1.3.0"
        mock_record_new.created = "2025-01-15T10:00:00Z"

        # Most recent should be first (sorted by -created)
        mock_result = Mock()
        mock_result.items = [mock_record_new]
        mock_collection.get_list.return_value = mock_result

        result = repository.get_by_original_request("orig_req_456")

        assert result is not None
        assert result["id"] == "debug_new"

        # Verify sort order
        call_args = mock_collection.get_list.call_args
        assert call_args[1]["query_params"]["sort"] == "-created"


class TestDebugParseRepositoryListWithOriginals:
    """Test listing debug results with original request data."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]) -> "DebugParseRepository":
        """Create a DebugParseRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
            DebugParseRepository,
        )

        mock_client, _ = mock_pb_client
        return DebugParseRepository(mock_client)

    def test_list_with_originals_expands_relations(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that list_with_originals expands original_request and person."""
        _, mock_collection = mock_pb_client

        # Mock original request with person expand
        mock_person = Mock()
        mock_person.cm_id = 12345
        mock_person.first_name = "Emma"
        mock_person.last_name = "Johnson"
        mock_person.preferred_name = "Em"

        mock_original = Mock()
        mock_original.id = "orig_req_456"
        mock_original.field = "bunk_with"
        mock_original.content = "With Mia please"
        mock_original.expand = {"requester": mock_person}

        mock_debug = Mock()
        mock_debug.id = "debug_123"
        mock_debug.original_request = "orig_req_456"
        mock_debug.parsed_intents = [{"request_type": "bunk_with", "target_name": "Mia"}]
        mock_debug.is_valid = True
        mock_debug.error_message = None
        mock_debug.token_count = 150
        mock_debug.processing_time_ms = 1250
        mock_debug.prompt_version = "v1.2.0"
        mock_debug.created = "2025-01-15T10:00:00Z"
        mock_debug.expand = {"original_request": mock_original}

        mock_result = Mock()
        mock_result.items = [mock_debug]
        mock_result.total_items = 1
        mock_collection.get_list.return_value = mock_result

        results, total = repository.list_with_originals(limit=50, offset=0)

        assert len(results) == 1
        assert total == 1

        result = results[0]
        assert result["id"] == "debug_123"
        assert result["requester_name"] == "Em Johnson"  # Uses preferred_name
        assert result["requester_cm_id"] == 12345
        assert result["source_field"] == "bunk_with"
        assert result["original_text"] == "With Mia please"

        # Verify expand parameter
        call_args = mock_collection.get_list.call_args
        expand_str = call_args[1]["query_params"]["expand"]
        assert "original_request" in expand_str
        assert "original_request.requester" in expand_str

    def test_list_with_originals_filters_by_session(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that list_with_originals filters by session when provided."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_result.total_items = 0
        mock_collection.get_list.return_value = mock_result

        repository.list_with_originals(session_id="sess_789", limit=50, offset=0)

        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert 'session = "sess_789"' in filter_str

    def test_list_with_originals_filters_by_source_field(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that list_with_originals filters by source field when provided."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_result.total_items = 0
        mock_collection.get_list.return_value = mock_result

        repository.list_with_originals(source_field="bunking_notes", limit=50, offset=0)

        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert 'original_request.field = "bunking_notes"' in filter_str

    def test_list_with_originals_applies_pagination(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that list_with_originals applies limit and offset."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_result.total_items = 100
        mock_collection.get_list.return_value = mock_result

        repository.list_with_originals(limit=25, offset=50)

        call_args = mock_collection.get_list.call_args
        # PocketBase uses page/perPage, offset needs to be converted
        assert call_args[1]["query_params"]["perPage"] == 25


class TestDebugParseRepositoryClearAll:
    """Test clearing all debug results."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]) -> "DebugParseRepository":
        """Create a DebugParseRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
            DebugParseRepository,
        )

        mock_client, _ = mock_pb_client
        return DebugParseRepository(mock_client)

    def test_clear_all_deletes_all_records(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that clear_all deletes all debug records."""
        _, mock_collection = mock_pb_client

        # First batch of records to delete
        mock_record_1 = Mock()
        mock_record_1.id = "debug_1"
        mock_record_2 = Mock()
        mock_record_2.id = "debug_2"

        # First call returns records, second call returns empty (all deleted)
        mock_result_with_items = Mock()
        mock_result_with_items.items = [mock_record_1, mock_record_2]

        mock_result_empty = Mock()
        mock_result_empty.items = []

        mock_collection.get_list.side_effect = [mock_result_with_items, mock_result_empty]

        result = repository.clear_all()

        assert result == 2  # Two records deleted

        # Verify delete was called for each record
        assert mock_collection.delete.call_count == 2
        mock_collection.delete.assert_any_call("debug_1")
        mock_collection.delete.assert_any_call("debug_2")

    def test_clear_all_returns_zero_when_empty(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that clear_all returns 0 when no records exist."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        result = repository.clear_all()

        assert result == 0
        mock_collection.delete.assert_not_called()

    def test_clear_all_returns_negative_on_error(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that clear_all returns -1 on error."""
        _, mock_collection = mock_pb_client

        mock_collection.get_list.side_effect = Exception("DB error")

        result = repository.clear_all()

        assert result == -1


class TestDebugParseRepositoryDeleteByOriginalRequest:
    """Test deleting debug results by original request."""

    @pytest.fixture
    def mock_pb_client(self) -> tuple[Mock, Mock]:
        """Create a mock PocketBase client."""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client: tuple[Mock, Mock]) -> "DebugParseRepository":
        """Create a DebugParseRepository with mocked client."""
        from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
            DebugParseRepository,
        )

        mock_client, _ = mock_pb_client
        return DebugParseRepository(mock_client)

    def test_delete_by_original_request_removes_cached_result(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that delete_by_original_request removes cached debug result."""
        _, mock_collection = mock_pb_client

        mock_record = Mock()
        mock_record.id = "debug_123"

        mock_result = Mock()
        mock_result.items = [mock_record]
        mock_collection.get_list.return_value = mock_result

        result = repository.delete_by_original_request("orig_req_456")

        assert result is True
        mock_collection.delete.assert_called_once_with("debug_123")

    def test_delete_by_original_request_returns_false_when_not_found(
        self, repository: "DebugParseRepository", mock_pb_client: tuple[Mock, Mock]
    ) -> None:
        """Test that delete_by_original_request returns False when no result."""
        _, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        result = repository.delete_by_original_request("nonexistent_id")

        assert result is False
        mock_collection.delete.assert_not_called()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""Test-Driven Development for Phase1 Debug Service

Tests for the phase1_debug_service that wraps Phase1ParseService for isolated
debugging of AI intent parsing without running the full 3-phase pipeline.

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestPhase1DebugServiceParseSelectedRecords:
    """Test parsing selected original_bunk_requests records in debug mode."""

    @pytest.fixture
    def mock_dependencies(self) -> dict[str, Mock]:
        """Create mock dependencies for the debug service."""
        mock_debug_repo = Mock()
        mock_original_requests_loader = Mock()
        mock_phase1_service = AsyncMock()

        return {
            "debug_repo": mock_debug_repo,
            "original_requests_loader": mock_original_requests_loader,
            "phase1_service": mock_phase1_service,
        }

    @pytest.fixture
    def debug_service(self, mock_dependencies: dict[str, Mock]):
        """Create a Phase1DebugService with mocked dependencies."""
        from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
            Phase1DebugService,
        )

        return Phase1DebugService(
            debug_repo=mock_dependencies["debug_repo"],
            original_requests_loader=mock_dependencies["original_requests_loader"],
            phase1_service=mock_dependencies["phase1_service"],
        )

    @pytest.mark.asyncio
    async def test_parse_selected_records_loads_and_parses(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test that parse_selected_records loads records and runs Phase 1."""
        # Mock no cached result (returns None, not a Mock)
        mock_dependencies["debug_repo"].get_by_original_request.return_value = None

        # Mock original request data
        mock_original_1 = Mock()
        mock_original_1.id = "orig_req_1"
        mock_original_1.content = "With Emma please"
        mock_original_1.field = "bunk_with"
        mock_original_1.year = 2025
        mock_original_1.expand = {
            "requester": Mock(
                cm_id=12345,
                first_name="Liam",
                last_name="Garcia",
                preferred_name=None,
                grade=5,
            )
        }

        mock_dependencies["original_requests_loader"].load_by_ids.return_value = [mock_original_1]
        mock_dependencies["original_requests_loader"].get_session_for_person.return_value = 1000002

        # Mock Phase 1 parse result
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )

        mock_parse_result = ParseResult(
            parsed_requests=[
                ParsedRequest(
                    raw_text="With Emma please",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Emma",
                    age_preference=None,
                    source_field="bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.95,
                    csv_position=0,
                    metadata={"keywords_found": ["with"]},
                )
            ],
            is_valid=True,
            metadata={"token_count": 150, "processing_time_ms": 1250},
        )
        mock_dependencies["phase1_service"].batch_parse.return_value = [mock_parse_result]

        # Mock save result
        mock_dependencies["debug_repo"].save_result.return_value = "debug_123"

        results = await debug_service.parse_selected_records(["orig_req_1"])

        assert len(results) == 1
        assert results[0]["original_request_id"] == "orig_req_1"
        assert results[0]["is_valid"] is True
        assert len(results[0]["parsed_intents"]) == 1

        # Verify Phase 1 was called
        mock_dependencies["phase1_service"].batch_parse.assert_called_once()

        # Verify result was saved
        mock_dependencies["debug_repo"].save_result.assert_called_once()

    @pytest.mark.asyncio
    async def test_parse_selected_records_skips_cached_when_not_force(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test that cached results are returned when force_reparse=False."""
        # Mock cached result exists
        cached_result = {
            "id": "debug_cached",
            "original_request_id": "orig_req_1",
            "parsed_intents": [{"request_type": "bunk_with", "target_name": "Emma"}],
            "is_valid": True,
        }
        mock_dependencies["debug_repo"].get_by_original_request.return_value = cached_result

        results = await debug_service.parse_selected_records(["orig_req_1"], force_reparse=False)

        assert len(results) == 1
        assert results[0] == cached_result

        # Verify Phase 1 was NOT called (used cache)
        mock_dependencies["phase1_service"].batch_parse.assert_not_called()
        mock_dependencies["original_requests_loader"].load_by_ids.assert_not_called()

    @pytest.mark.asyncio
    async def test_parse_selected_records_reparses_when_force(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test that records are reparsed when force_reparse=True."""
        # Mock cached result exists
        mock_dependencies["debug_repo"].get_by_original_request.return_value = {
            "id": "debug_old",
            "original_request_id": "orig_req_1",
            "is_valid": True,
        }

        # Mock original request
        mock_original = Mock()
        mock_original.id = "orig_req_1"
        mock_original.content = "With Emma please"
        mock_original.field = "bunk_with"
        mock_original.expand = {
            "requester": Mock(cm_id=12345, first_name="Liam", last_name="Garcia", preferred_name=None, grade=5)
        }
        mock_dependencies["original_requests_loader"].load_by_ids.return_value = [mock_original]

        # Mock new parse result
        from bunking.sync.bunk_request_processor.core.models import ParseResult

        mock_dependencies["phase1_service"].batch_parse.return_value = [
            ParseResult(parsed_requests=[], is_valid=True, metadata={"token_count": 100})
        ]
        mock_dependencies["debug_repo"].save_result.return_value = "debug_new"

        # Delete old cached result before saving new
        mock_dependencies["debug_repo"].delete_by_original_request.return_value = True

        await debug_service.parse_selected_records(["orig_req_1"], force_reparse=True)

        # Verify old cache was deleted
        mock_dependencies["debug_repo"].delete_by_original_request.assert_called_once_with("orig_req_1")

        # Verify Phase 1 was called
        mock_dependencies["phase1_service"].batch_parse.assert_called_once()

    @pytest.mark.asyncio
    async def test_parse_selected_records_handles_mixed_cached_and_new(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test handling mix of cached and new records."""

        # First record has cache, second doesn't
        def get_cached(orig_id):
            if orig_id == "orig_req_1":
                return {
                    "id": "debug_cached",
                    "original_request_id": "orig_req_1",
                    "is_valid": True,
                    "parsed_intents": [],
                }
            return None

        mock_dependencies["debug_repo"].get_by_original_request.side_effect = get_cached

        # Only second record needs loading
        mock_original_2 = Mock()
        mock_original_2.id = "orig_req_2"
        mock_original_2.content = "Not with Jake"
        mock_original_2.field = "not_bunk_with"
        mock_original_2.expand = {
            "requester": Mock(cm_id=67890, first_name="Olivia", last_name="Chen", preferred_name=None, grade=6)
        }
        mock_dependencies["original_requests_loader"].load_by_ids.return_value = [mock_original_2]

        from bunking.sync.bunk_request_processor.core.models import ParseResult

        mock_dependencies["phase1_service"].batch_parse.return_value = [
            ParseResult(parsed_requests=[], is_valid=True, metadata={})
        ]
        mock_dependencies["debug_repo"].save_result.return_value = "debug_new"

        results = await debug_service.parse_selected_records(["orig_req_1", "orig_req_2"], force_reparse=False)

        assert len(results) == 2

        # Verify only uncached record was loaded
        mock_dependencies["original_requests_loader"].load_by_ids.assert_called_once_with(["orig_req_2"])

    @pytest.mark.asyncio
    async def test_parse_selected_records_returns_empty_for_empty_input(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test that empty input returns empty results."""
        results = await debug_service.parse_selected_records([])

        assert results == []
        mock_dependencies["phase1_service"].batch_parse.assert_not_called()


class TestPhase1DebugServiceParseByFilter:
    """Test parsing original_bunk_requests by filter criteria."""

    @pytest.fixture
    def mock_dependencies(self) -> dict[str, Mock]:
        """Create mock dependencies for the debug service."""
        mock_debug_repo = Mock()
        mock_original_requests_loader = Mock()
        mock_phase1_service = AsyncMock()

        return {
            "debug_repo": mock_debug_repo,
            "original_requests_loader": mock_original_requests_loader,
            "phase1_service": mock_phase1_service,
        }

    @pytest.fixture
    def debug_service(self, mock_dependencies: dict[str, Mock]):
        """Create a Phase1DebugService with mocked dependencies."""
        from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
            Phase1DebugService,
        )

        return Phase1DebugService(
            debug_repo=mock_dependencies["debug_repo"],
            original_requests_loader=mock_dependencies["original_requests_loader"],
            phase1_service=mock_dependencies["phase1_service"],
        )

    @pytest.mark.asyncio
    async def test_parse_by_filter_filters_by_session(self, debug_service, mock_dependencies: dict[str, Mock]) -> None:
        """Test that parse_by_filter applies session filter."""
        mock_dependencies["original_requests_loader"].load_by_filter.return_value = []
        mock_dependencies["debug_repo"].get_by_original_request.return_value = None

        await debug_service.parse_by_filter(session_cm_id=1000002, limit=50)

        mock_dependencies["original_requests_loader"].load_by_filter.assert_called_once()
        call_kwargs = mock_dependencies["original_requests_loader"].load_by_filter.call_args[1]
        assert call_kwargs.get("session_cm_id") == 1000002

    @pytest.mark.asyncio
    async def test_parse_by_filter_filters_by_source_field(
        self, debug_service, mock_dependencies: dict[str, Mock]
    ) -> None:
        """Test that parse_by_filter applies source field filter."""
        mock_dependencies["original_requests_loader"].load_by_filter.return_value = []
        mock_dependencies["debug_repo"].get_by_original_request.return_value = None

        await debug_service.parse_by_filter(source_field="bunking_notes", limit=50)

        mock_dependencies["original_requests_loader"].load_by_filter.assert_called_once()
        call_kwargs = mock_dependencies["original_requests_loader"].load_by_filter.call_args[1]
        assert call_kwargs.get("source_field") == "bunking_notes"

    @pytest.mark.asyncio
    async def test_parse_by_filter_respects_limit(self, debug_service, mock_dependencies: dict[str, Mock]) -> None:
        """Test that parse_by_filter respects the limit parameter."""
        mock_dependencies["original_requests_loader"].load_by_filter.return_value = []
        mock_dependencies["debug_repo"].get_by_original_request.return_value = None

        await debug_service.parse_by_filter(limit=25)

        call_kwargs = mock_dependencies["original_requests_loader"].load_by_filter.call_args[1]
        assert call_kwargs.get("limit") == 25


class TestPhase1DebugServiceConvertToParseRequest:
    """Test conversion of original_bunk_requests to ParseRequest format."""

    @pytest.fixture
    def mock_dependencies(self) -> dict[str, Mock]:
        """Create mock dependencies for the debug service."""
        return {
            "debug_repo": Mock(),
            "original_requests_loader": Mock(),
            "phase1_service": AsyncMock(),
        }

    @pytest.fixture
    def debug_service(self, mock_dependencies: dict[str, Mock]):
        """Create a Phase1DebugService with mocked dependencies."""
        from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
            Phase1DebugService,
        )

        return Phase1DebugService(
            debug_repo=mock_dependencies["debug_repo"],
            original_requests_loader=mock_dependencies["original_requests_loader"],
            phase1_service=mock_dependencies["phase1_service"],
        )

    def test_convert_extracts_requester_info(self, debug_service) -> None:
        """Test that conversion extracts requester name and cm_id."""
        mock_original = Mock()
        mock_original.id = "orig_req_1"
        mock_original.content = "With Emma"
        mock_original.field = "bunk_with"
        mock_original.year = 2025
        mock_original.expand = {
            "requester": Mock(
                cm_id=12345,
                first_name="Liam",
                last_name="Garcia",
                preferred_name="Li",
                grade=5,
            )
        }

        # Access internal method for testing
        parse_request = debug_service._convert_to_parse_request(
            mock_original, session_cm_id=1000002, session_name="Session 2"
        )

        assert parse_request.requester_name == "Li Garcia"  # Uses preferred_name
        assert parse_request.requester_cm_id == 12345
        assert parse_request.request_text == "With Emma"
        assert parse_request.field_name == "bunk_with"

    def test_convert_uses_first_name_when_no_preferred(self, debug_service) -> None:
        """Test that first_name is used when preferred_name is None."""
        mock_original = Mock()
        mock_original.id = "orig_req_1"
        mock_original.content = "Not with Jake"
        mock_original.field = "not_bunk_with"
        mock_original.year = 2025
        mock_original.expand = {
            "requester": Mock(
                cm_id=12345,
                first_name="Liam",
                last_name="Garcia",
                preferred_name=None,
                grade=5,
            )
        }

        parse_request = debug_service._convert_to_parse_request(
            mock_original, session_cm_id=1000002, session_name="Session 2"
        )

        assert parse_request.requester_name == "Liam Garcia"


class TestPhase1DebugServiceFormatResults:
    """Test formatting of Phase 1 results for API response."""

    @pytest.fixture
    def mock_dependencies(self) -> dict[str, Mock]:
        """Create mock dependencies for the debug service."""
        return {
            "debug_repo": Mock(),
            "original_requests_loader": Mock(),
            "phase1_service": AsyncMock(),
        }

    @pytest.fixture
    def debug_service(self, mock_dependencies: dict[str, Mock]):
        """Create a Phase1DebugService with mocked dependencies."""
        from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
            Phase1DebugService,
        )

        return Phase1DebugService(
            debug_repo=mock_dependencies["debug_repo"],
            original_requests_loader=mock_dependencies["original_requests_loader"],
            phase1_service=mock_dependencies["phase1_service"],
        )

    def test_format_results_includes_all_intent_fields(self, debug_service) -> None:
        """Test that formatted results include all required intent fields."""
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )

        parse_result = ParseResult(
            parsed_requests=[
                ParsedRequest(
                    raw_text="With Emma and Mia",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Emma",
                    age_preference=None,
                    source_field="bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.95,
                    csv_position=0,
                    metadata={
                        "keywords_found": ["with"],
                        "parse_notes": "First in list",
                        "reasoning": "Clear request pattern",
                        "needs_clarification": False,
                    },
                ),
                ParsedRequest(
                    raw_text="With Emma and Mia",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Mia",
                    age_preference=None,
                    source_field="bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.90,
                    csv_position=1,
                    metadata={
                        "keywords_found": ["and"],
                        "parse_notes": "Second in list",
                        "reasoning": "Continuation pattern",
                        "needs_clarification": False,
                    },
                ),
            ],
            is_valid=True,
            metadata={"token_count": 200, "processing_time_ms": 1500},
        )

        formatted = debug_service._format_parse_result(parse_result, original_request_id="orig_req_1")

        assert formatted["original_request_id"] == "orig_req_1"
        assert formatted["is_valid"] is True
        assert formatted["token_count"] == 200
        assert formatted["processing_time_ms"] == 1500
        assert len(formatted["parsed_intents"]) == 2

        intent_0 = formatted["parsed_intents"][0]
        assert intent_0["request_type"] == "bunk_with"
        assert intent_0["target_name"] == "Emma"
        assert intent_0["list_position"] == 0

        intent_1 = formatted["parsed_intents"][1]
        assert intent_1["target_name"] == "Mia"
        assert intent_1["list_position"] == 1

    def test_format_results_handles_failed_parse(self, debug_service) -> None:
        """Test that failed parse results are formatted correctly."""
        from bunking.sync.bunk_request_processor.core.models import ParseResult

        parse_result = ParseResult(
            parsed_requests=[],
            is_valid=False,
            metadata={"failure_reason": "AI timeout", "token_count": 0},
        )

        formatted = debug_service._format_parse_result(parse_result, original_request_id="orig_req_1")

        assert formatted["is_valid"] is False
        assert formatted["error_message"] == "AI timeout"
        assert formatted["parsed_intents"] == []


class TestPhase1DebugServiceGetPromptVersion:
    """Test prompt version tracking for debug results."""

    @pytest.fixture
    def mock_dependencies(self) -> dict[str, Mock]:
        """Create mock dependencies for the debug service."""
        return {
            "debug_repo": Mock(),
            "original_requests_loader": Mock(),
            "phase1_service": AsyncMock(),
        }

    @pytest.fixture
    def debug_service(self, mock_dependencies: dict[str, Mock]):
        """Create a Phase1DebugService with mocked dependencies."""
        from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
            Phase1DebugService,
        )

        return Phase1DebugService(
            debug_repo=mock_dependencies["debug_repo"],
            original_requests_loader=mock_dependencies["original_requests_loader"],
            phase1_service=mock_dependencies["phase1_service"],
            prompt_version="v1.2.0",
        )

    def test_prompt_version_included_in_results(self, debug_service) -> None:
        """Test that prompt version is included in formatted results."""
        from bunking.sync.bunk_request_processor.core.models import ParseResult

        parse_result = ParseResult(
            parsed_requests=[],
            is_valid=True,
            metadata={},
        )

        formatted = debug_service._format_parse_result(parse_result, original_request_id="orig_req_1")

        assert formatted["prompt_version"] == "v1.2.0"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

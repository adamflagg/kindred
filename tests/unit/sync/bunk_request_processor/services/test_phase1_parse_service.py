"""Tests for Phase1ParseService

These tests verify:
1. Initialization with AI provider and context builder
2. Batch parsing returns ParseResults
3. Context is properly built and passed to AI
4. Error handling for AI failures
5. Statistics tracking"""

from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.phase1_parse_service import (
    Phase1ParseService,
)


def _create_parse_request(
    request_text: str = "I want to bunk with Sarah Smith",
    field_name: str = "share_bunk_with",
    requester_name: str = "John Doe",
    requester_cm_id: int = 12345,
    requester_grade: str = "3",
    session_cm_id: int = 1000002,
    session_name: str = "Session 2",
    year: int = 2025,
) -> ParseRequest:
    """Helper to create ParseRequest objects"""
    return ParseRequest(
        request_text=request_text,
        field_name=field_name,
        requester_name=requester_name,
        requester_cm_id=requester_cm_id,
        requester_grade=requester_grade,
        session_cm_id=session_cm_id,
        session_name=session_name,
        year=year,
        row_data={"share_bunk_with": request_text},
    )


def _create_parsed_request(
    target_name: str = "Sarah Smith",
    request_type: RequestType = RequestType.BUNK_WITH,
    confidence: float = 0.9,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="bunk_request_form",
        confidence=confidence,
        csv_position=0,
        metadata={},
    )


def _create_parse_result(
    parsed_requests: list[ParsedRequest] | None = None,
    is_valid: bool = True,
    needs_historical: bool = False,
) -> ParseResult:
    """Helper to create ParseResult objects"""
    if parsed_requests is None:
        parsed_requests = [_create_parsed_request()]
    return ParseResult(
        parsed_requests=parsed_requests,
        is_valid=is_valid,
        needs_historical_context=needs_historical,
        metadata={},
    )


class TestPhase1ParseServiceInit:
    """Tests for service initialization"""

    def test_init_with_ai_provider_and_context_builder(self):
        """Service requires AI provider and context builder"""
        ai_provider = Mock()
        context_builder = Mock()

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
        )

        assert service.ai_service is ai_provider
        assert service.context_builder is context_builder
        assert service.batch_processor is not None

    def test_init_with_optional_batch_processor(self):
        """Service accepts optional batch processor"""
        ai_provider = Mock()
        context_builder = Mock()
        batch_processor = Mock()

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        assert service.batch_processor is batch_processor

    def test_init_creates_default_batch_processor(self):
        """Service creates BatchProcessor if not provided"""
        ai_provider = Mock()
        context_builder = Mock()

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
        )

        # Should create a BatchProcessor automatically
        from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor

        assert isinstance(service.batch_processor, BatchProcessor)

    def test_init_stats_are_zero(self):
        """Statistics are initialized to zero"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        stats = service.get_stats()
        assert stats["total_parsed"] == 0
        assert stats["successful_parses"] == 0
        assert stats["failed_parses"] == 0
        assert stats["needs_historical"] == 0


class TestPhase1ParseServiceBatchParse:
    """Tests for batch_parse method"""

    @pytest.mark.asyncio
    async def test_batch_parse_returns_parse_results(self):
        """batch_parse returns list of ParseResult"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = Mock()
        expected_result = _create_parse_result()
        # batch_parse_requests is async - use AsyncMock for the method
        batch_processor.batch_parse_requests = AsyncMock(return_value=[expected_result])
        batch_processor.get_statistics = Mock(return_value={})

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        requests = [_create_parse_request()]
        results = await service.batch_parse(requests)

        assert len(results) == 1
        assert results[0] is expected_result

    @pytest.mark.asyncio
    async def test_batch_parse_handles_empty_input(self):
        """batch_parse returns empty list for empty input"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        results = await service.batch_parse([])

        assert results == []

    @pytest.mark.asyncio
    async def test_batch_parse_builds_context_for_each_request(self):
        """Context builder is called for each request - V1: context dict with requester_name, grade, session"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = Mock()
        batch_processor.batch_parse_requests = AsyncMock(return_value=[_create_parse_result()])
        batch_processor.get_statistics = Mock(return_value={})

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        request = _create_parse_request(
            requester_name="John Doe",
            requester_cm_id=12345,
            requester_grade="3",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )
        await service.batch_parse([request])

        # Verify context builder was called with correct parameters
        context_builder.build_parse_only_context.assert_called_once()
        call_kwargs = context_builder.build_parse_only_context.call_args
        assert call_kwargs.kwargs["requester_name"] == "John Doe"
        assert call_kwargs.kwargs["requester_cm_id"] == 12345
        assert call_kwargs.kwargs["requester_grade"] == "3"
        assert call_kwargs.kwargs["session_cm_id"] == 1000002

    @pytest.mark.asyncio
    async def test_batch_parse_extracts_multiple_names(self):
        """batch_parse can extract multiple names from a single field"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = Mock()
        # AI returns multiple parsed requests from one input
        result_with_multiple = ParseResult(
            parsed_requests=[
                _create_parsed_request("Sarah Smith"),
                _create_parsed_request("Jane Doe"),
            ],
            is_valid=True,
        )
        batch_processor.batch_parse_requests = AsyncMock(return_value=[result_with_multiple])
        batch_processor.get_statistics = Mock(return_value={})

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        request = _create_parse_request(request_text="I want to bunk with Sarah Smith and Jane Doe")
        results = await service.batch_parse([request])

        assert len(results) == 1
        assert len(results[0].parsed_requests) == 2
        assert results[0].parsed_requests[0].target_name == "Sarah Smith"
        assert results[0].parsed_requests[1].target_name == "Jane Doe"


class TestPhase1ParseServiceErrorHandling:
    """Tests for error handling - V1: except block lines 1135-1138"""

    @pytest.mark.asyncio
    async def test_handles_ai_provider_error_gracefully(self):
        """Service catches AI errors and returns failed results"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = AsyncMock()
        batch_processor.batch_parse_requests.side_effect = Exception("AI API Error")

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        requests = [_create_parse_request()]
        results = await service.batch_parse(requests)

        # Should return failed results, not raise exception
        assert len(results) == 1
        assert results[0].is_valid is False
        assert "AI API Error" in results[0].metadata.get("failure_reason", "")

    @pytest.mark.asyncio
    async def test_tracks_ai_failures_in_stats(self):
        """Failed parses increment failed_parses counter - V1: self.stats['ai_failures']"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = AsyncMock()
        batch_processor.batch_parse_requests.side_effect = Exception("AI Error")

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        await service.batch_parse([_create_parse_request()])

        stats = service.get_stats()
        assert stats["failed_parses"] == 1
        assert stats["successful_parses"] == 0


class TestPhase1ParseServiceStatistics:
    """Tests for statistics tracking"""

    @pytest.mark.asyncio
    async def test_get_stats_returns_parse_counts(self):
        """get_stats returns counts for all phases"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_parse_only_context.return_value = Mock()

        batch_processor = Mock()
        batch_processor.batch_parse_requests = AsyncMock(
            return_value=[
                _create_parse_result(is_valid=True),
                _create_parse_result(is_valid=True, needs_historical=True),
            ]
        )
        batch_processor.get_statistics = Mock(return_value={})

        service = Phase1ParseService(
            ai_service=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        await service.batch_parse([_create_parse_request(), _create_parse_request()])

        stats = service.get_stats()
        assert stats["total_parsed"] == 2
        assert stats["successful_parses"] == 2
        assert stats["needs_historical"] == 1

    def test_reset_stats_clears_counters(self):
        """reset_stats zeros all counters"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        # Manually set stats
        service._stats["total_parsed"] = 10
        service._stats["successful_parses"] = 8
        service._stats["failed_parses"] = 2
        service._stats["needs_historical"] = 3

        service.reset_stats()

        stats = service.get_stats()
        assert stats["total_parsed"] == 0
        assert stats["successful_parses"] == 0
        assert stats["failed_parses"] == 0
        assert stats["needs_historical"] == 0

    def test_get_stats_returns_copy(self):
        """get_stats returns a copy, not the internal dict"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        stats = service.get_stats()
        stats["total_parsed"] = 999

        # Internal stats should be unchanged
        assert service.get_stats()["total_parsed"] == 0


class TestPhase1FailureTracking:
    """Tests for first_failure_reason tracking in stats"""

    def test_first_failure_reason_captured(self):
        """first_failure_reason is set from the first failed ParseResult"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        result = ParseResult(
            parsed_requests=[],
            needs_historical_context=False,
            is_valid=False,
            parse_request=_create_parse_request(),
            metadata={"failure_reason": "some error"},
        )

        service._update_stats([result])

        assert service.get_stats()["first_failure_reason"] == "some error"

    def test_first_failure_reason_not_overwritten_by_later_failures(self):
        """first_failure_reason retains the first failure, not subsequent ones"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        result1 = ParseResult(
            parsed_requests=[],
            needs_historical_context=False,
            is_valid=False,
            parse_request=_create_parse_request(),
            metadata={"failure_reason": "first error"},
        )
        result2 = ParseResult(
            parsed_requests=[],
            needs_historical_context=False,
            is_valid=False,
            parse_request=_create_parse_request(),
            metadata={"failure_reason": "second error"},
        )

        service._update_stats([result1, result2])

        assert service.get_stats()["first_failure_reason"] == "first error"

    def test_first_failure_reason_none_when_all_succeed(self):
        """first_failure_reason is None when all results are successful"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        result = ParseResult(
            parsed_requests=[
                ParsedRequest(
                    raw_text="I want to bunk with Sarah",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah",
                    age_preference=None,
                    source_field="bunk_request_form",
                    confidence=0.9,
                    csv_position=0,
                    metadata={},
                )
            ],
            needs_historical_context=False,
            is_valid=True,
            parse_request=_create_parse_request(),
            metadata={},
        )

        service._update_stats([result])

        assert service.get_stats()["first_failure_reason"] is None

    def test_reset_stats_clears_first_failure_reason(self):
        """reset_stats sets first_failure_reason back to None"""
        service = Phase1ParseService(
            ai_service=Mock(),
            context_builder=Mock(),
        )

        # Simulate a failure being recorded
        result = ParseResult(
            parsed_requests=[],
            needs_historical_context=False,
            is_valid=False,
            parse_request=_create_parse_request(),
            metadata={"failure_reason": "some error"},
        )
        service._update_stats([result])
        assert service.get_stats()["first_failure_reason"] == "some error"

        service.reset_stats()

        assert service.get_stats()["first_failure_reason"] is None


class TestAgeDirectionPhase1Conversion:
    """#1401 regression guard at the Phase 1 conversion boundary.

    Exercises OpenAIProvider._convert_parse_response with prose-realistic AI responses
    to lock down the contract: AI's age_direction maps directly to ParsedRequest.age_preference,
    target_name on age_preference is salvaged (not silently re-mapped), and undirected
    requests pass through as age_preference=None for downstream PENDING handling.

    Sibling of TestOpenAIProviderAgeDirectionConversion in test_sdk_ai_provider.py —
    placed at this layer so accidental refactors that route around the provider's
    handling still get caught.
    """

    def _convert_single(self, ai_response):
        """Helper: run a single-request AIParseResponse through OpenAIProvider._convert_parse_response."""
        from unittest.mock import patch

        from bunking.sync.bunk_request_processor.integration.ai_service import (
            AIRequestContext,
        )
        from bunking.sync.bunk_request_processor.integration.openai_provider import (
            OpenAIProvider,
        )

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        context = AIRequestContext(
            requester_name="Test User",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "share_bunk_with",
                "csv_source_field": "share_bunk_with",
            },
        )
        result = provider._convert_parse_response(ai_response, "input text", context)
        assert len(result.requests) == 1, "helper assumes single-request response"
        return result.requests[0]

    def test_older_prose_maps_to_age_preference_older(self):
        from bunking.sync.bunk_request_processor.core.models import AgePreference
        from bunking.sync.bunk_request_processor.integration.ai_schemas import (
            AIBunkRequestItem,
            AIParseResponse,
        )

        ai_response = AIParseResponse(
            requests=[AIBunkRequestItem(request_type="age_preference", age_direction="older")]
        )
        parsed = self._convert_single(ai_response)
        assert parsed.request_type == RequestType.AGE_PREFERENCE
        assert parsed.age_preference == AgePreference.OLDER
        assert parsed.target_name is None

    def test_younger_prose_maps_to_age_preference_younger(self):
        from bunking.sync.bunk_request_processor.core.models import AgePreference
        from bunking.sync.bunk_request_processor.integration.ai_schemas import (
            AIBunkRequestItem,
            AIParseResponse,
        )

        ai_response = AIParseResponse(
            requests=[AIBunkRequestItem(request_type="age_preference", age_direction="younger")]
        )
        parsed = self._convert_single(ai_response)
        assert parsed.request_type == RequestType.AGE_PREFERENCE
        assert parsed.age_preference == AgePreference.YOUNGER
        assert parsed.target_name is None

    def test_undirected_prose_maps_to_age_preference_none(self):
        from bunking.sync.bunk_request_processor.integration.ai_schemas import (
            AIBunkRequestItem,
            AIParseResponse,
        )

        ai_response = AIParseResponse(requests=[AIBunkRequestItem(request_type="age_preference", age_direction=None)])
        parsed = self._convert_single(ai_response)
        assert parsed.request_type == RequestType.AGE_PREFERENCE
        assert parsed.age_preference is None
        assert parsed.target_name is None

    def test_drift_target_name_on_age_pref_does_not_silently_remap(self):
        """Critical regression: AI emits old-shape target_name='older' on age_preference.

        Must NOT be silently re-mapped to AgePreference.OLDER (the old age_pref_map
        behavior). Salvaged as undirected so staff catch the AI drift downstream.
        """
        from bunking.sync.bunk_request_processor.integration.ai_schemas import (
            AIBunkRequestItem,
            AIParseResponse,
        )

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="age_preference",
                    target_name="older",
                    age_direction=None,
                )
            ]
        )
        parsed = self._convert_single(ai_response)
        assert parsed.age_preference is None, (
            "drift target_name must not be re-mapped to AgePreference — this was the "
            "bug class age_direction was introduced to eliminate"
        )
        assert parsed.target_name is None

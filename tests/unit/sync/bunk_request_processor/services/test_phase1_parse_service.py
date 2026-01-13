"""Tests for Phase1ParseService

These tests verify:
1. Initialization with AI provider and context builder
2. Batch parsing returns ParseResults
3. Context is properly built and passed to AI
4. Error handling for AI failures
5. Statistics tracking"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestSource,
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
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,  # FAMILY = share_bunk_with field
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

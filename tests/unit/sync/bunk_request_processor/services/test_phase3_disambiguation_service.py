"""Tests for Phase3DisambiguationService

Tests cover:
1. Initialization with required and optional components
2. Core disambiguation functionality
3. Context building with candidates
4. Result handling (success, no match, still ambiguous)
5. Confidence scoring integration
6. Statistics tracking"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_service import AIRequestContext
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.services.phase3_disambiguation_service import (
    DisambiguationCase,
    Phase3DisambiguationService,
)


def _create_mock_context(
    requester_name: str = "Test Requester",
    requester_cm_id: int = 11111,
    session_cm_id: int = 1000002,
    year: int = 2025,
) -> AIRequestContext:
    """Helper to create AIRequestContext objects for testing"""
    return AIRequestContext(
        requester_name=requester_name,
        requester_cm_id=requester_cm_id,
        session_cm_id=session_cm_id,
        year=year,
        additional_context={},
    )


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
    grade: str = "5",
) -> Person:
    """Helper to create Person objects"""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=int(grade) if grade else None,
    )


def _create_parse_request(
    request_text: str = "I want to bunk with Sarah Smith",
    requester_cm_id: int = 11111,
    requester_name: str = "Test Requester",
    requester_grade: str = "5",
    field_name: str = "share_bunk_with",
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
        row_data={field_name: request_text},
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
        source=RequestSource.FAMILY,
        confidence=confidence,
        csv_position=0,
        metadata={},
    )


def _create_parse_result(
    parsed_requests: list[ParsedRequest] | None = None,
    is_valid: bool = True,
    parse_request: ParseRequest | None = None,
) -> ParseResult:
    """Helper to create ParseResult objects"""
    if parsed_requests is None:
        parsed_requests = [_create_parsed_request()]
    if parse_request is None:
        parse_request = _create_parse_request()
    return ParseResult(
        parsed_requests=parsed_requests,
        is_valid=is_valid,
        parse_request=parse_request,
    )


def _create_resolution_result(
    person: Person | None = None,
    confidence: float = 0.0,
    method: str = "unknown",
    candidates: list[Person] | None = None,
    metadata: dict[str, Any] | None = None,
) -> ResolutionResult:
    """Helper to create ResolutionResult objects"""
    return ResolutionResult(
        person=person,
        confidence=confidence,
        method=method,
        candidates=candidates if candidates is not None else [],
        metadata=metadata if metadata is not None else {},
    )


def _create_ambiguous_resolution(
    candidates: list[Person] | None = None,
) -> ResolutionResult:
    """Helper to create an ambiguous resolution result"""
    if candidates is None:
        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Smith"),
        ]
    return _create_resolution_result(
        person=None,
        confidence=0.5,
        method="ambiguous",
        candidates=candidates,
    )


class TestPhase3DisambiguationServiceInit:
    """Tests for Phase3DisambiguationService initialization"""

    def test_init_requires_ai_provider(self):
        """Service requires ai_provider"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )
        assert service.ai_provider == ai_provider

    def test_init_requires_context_builder(self):
        """Service requires context_builder"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )
        assert service.context_builder == context_builder

    def test_init_with_optional_spread_filter(self):
        """Service accepts optional spread_filter"""
        ai_provider = Mock()
        context_builder = Mock()
        spread_filter = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            spread_filter=spread_filter,
        )
        assert service.spread_filter == spread_filter

    def test_init_creates_default_batch_processor(self):
        """Service creates batch processor if not provided"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )
        assert service.batch_processor is not None

    def test_init_stats_are_zero(self):
        """Stats should start at zero"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )
        stats = service.get_stats()
        assert stats["total_processed"] == 0
        assert stats["successfully_disambiguated"] == 0
        assert stats["still_ambiguous"] == 0
        assert stats["failed"] == 0
        assert stats["no_match"] == 0


class TestPhase3DisambiguationServiceBatchDisambiguate:
    """Tests for batch_disambiguate method"""

    @pytest.mark.asyncio
    async def test_batch_disambiguate_processes_ambiguous_cases_only(self):
        """batch_disambiguate only processes cases with ambiguous resolutions"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Create one resolved, one ambiguous
        resolved = _create_resolution_result(person=_create_person(), confidence=0.95)
        ambiguous = _create_ambiguous_resolution()

        parse_result1 = _create_parse_result()
        parse_result2 = _create_parse_result()

        cases = [
            (parse_result1, [resolved]),  # Not ambiguous
            (parse_result2, [ambiguous]),  # Ambiguous
        ]

        await service.batch_disambiguate(cases)

        # Batch processor should only be called for ambiguous case
        batch_processor.batch_disambiguate.assert_called_once()

    @pytest.mark.asyncio
    async def test_batch_disambiguate_returns_original_if_no_ambiguous(self):
        """If no ambiguous cases, returns original input"""
        ai_provider = Mock()
        context_builder = Mock()
        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Only resolved results
        resolved = _create_resolution_result(person=_create_person(), confidence=0.95)
        parse_result = _create_parse_result()
        cases = [(parse_result, [resolved])]

        results = await service.batch_disambiguate(cases)

        assert results == cases

    @pytest.mark.asyncio
    async def test_disambiguate_calls_ai_with_candidates(self):
        """AI is called with candidate list for disambiguation"""
        ai_provider = Mock()
        context_builder = Mock()
        mock_context = _create_mock_context()
        mock_context.additional_context["candidates"] = [{"cm_id": 111}, {"cm_id": 222}]
        context_builder.build_disambiguation_context.return_value = mock_context

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [
            _create_person(cm_id=111),
            _create_person(cm_id=222),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        await service.batch_disambiguate([(parse_result, [ambiguous])])

        # Context builder should be called with candidates
        context_builder.build_disambiguation_context.assert_called_once()
        call_kwargs = context_builder.build_disambiguation_context.call_args[1]
        assert "candidates" in call_kwargs
        assert len(call_kwargs["candidates"]) <= 10  # Top 10

    @pytest.mark.asyncio
    async def test_batch_disambiguate_passes_context_objects_not_dicts(self):
        """Phase 3 must pass AIRequestContext objects to batch processor, not dicts."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        ambiguous = _create_ambiguous_resolution()
        parse_result = _create_parse_result()

        cases = [
            (parse_result, [ambiguous]),
        ]

        await service.batch_disambiguate(cases)

        # Verify batch_processor was called
        batch_processor.batch_disambiguate.assert_called_once()
        call_kwargs = batch_processor.batch_disambiguate.call_args
        disambiguation_requests = call_kwargs.kwargs.get(
            "disambiguation_requests", call_kwargs.args[0] if call_kwargs.args else []
        )

        # Each request tuple must be (ParsedRequest, AIRequestContext) — NOT dict
        for parsed_req, context in disambiguation_requests:
            assert isinstance(parsed_req, ParsedRequest), f"Expected ParsedRequest, got {type(parsed_req)}"
            assert isinstance(context, AIRequestContext), (
                f"Expected AIRequestContext, got {type(context)}. Phase 3 should not convert context to dict."
            )

    @pytest.mark.asyncio
    async def test_batch_disambiguate_handles_empty_input(self):
        """batch_disambiguate handles empty input gracefully"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )

        results = await service.batch_disambiguate([])

        assert results == []


class TestPhase3DisambiguationServiceResultHandling:
    """Tests for disambiguation result handling"""

    @pytest.mark.asyncio
    async def test_successfully_disambiguated_marked_resolved(self):
        """Successfully disambiguated cases are marked resolved"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        selected_person = _create_person(cm_id=111)

        # AI returns a result selecting person 111
        ai_result = Mock()
        ai_result.selected_person_id = 111
        ai_result.confidence = 0.85
        ai_result.reason = "Best match based on context"

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [
            selected_person,
            _create_person(cm_id=222),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        assert resolution_list[0].is_resolved
        assert resolution_list[0].person is not None
        assert resolution_list[0].person.cm_id == 111
        assert resolution_list[0].method == "ai_disambiguation"

    @pytest.mark.asyncio
    async def test_still_ambiguous_after_ai_marked(self):
        """Cases where AI returns no selection are marked as no_match"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI returns no selection (no person selected, no explicit no_match)
        ai_result = Mock()
        ai_result.selected_person_id = None
        ai_result.no_match = False
        ai_result.reason = "Could not distinguish between candidates"

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        ambiguous = _create_ambiguous_resolution()
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        # AI tried but couldn't select — marked as no_match (original resolution kept)
        assert resolution_list[0].is_ambiguous
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata.get("disambiguation_status") == "no_match"

    @pytest.mark.asyncio
    async def test_no_match_from_ai_handled(self):
        """AI explicitly saying no match is handled"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI returns no_match
        ai_result = Mock()
        ai_result.selected_person_id = None
        ai_result.no_match = True
        ai_result.reason = "None of the candidates match the request"

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        ambiguous = _create_ambiguous_resolution()
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata.get("disambiguation_status") == "no_match"


class TestPhase3DisambiguationServiceContextBuilding:
    """Tests for context building"""

    @pytest.mark.asyncio
    async def test_builds_context_with_top_10_candidates(self):
        """Context is built with at most 10 candidates"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Create 7 candidates
        candidates = [_create_person(cm_id=100 + i) for i in range(7)]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        await service.batch_disambiguate([(parse_result, [ambiguous])])

        # Context builder should receive all 7 candidates (under cap of 10)
        call_kwargs = context_builder.build_disambiguation_context.call_args[1]
        assert len(call_kwargs["candidates"]) == 7

    @pytest.mark.asyncio
    async def test_context_includes_requester_info(self):
        """Context includes requester information"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        parse_request = _create_parse_request(
            requester_cm_id=99999,
            requester_name="John Doe",
            requester_grade="4",
        )
        ambiguous = _create_ambiguous_resolution()
        parse_result = _create_parse_result(parse_request=parse_request)

        await service.batch_disambiguate([(parse_result, [ambiguous])])

        # Verify context builder was called with requester info as separate kwargs
        call_kwargs = context_builder.build_disambiguation_context.call_args[1]
        assert call_kwargs["requester_cm_id"] == 99999
        assert call_kwargs["requester_name"] == "John Doe"
        # Note: grade is passed via row_data, not as a direct kwarg


class TestPhase3DisambiguationServiceConfidencePassthrough:
    """Tests that AI confidence passes through without formula rescoring."""

    @pytest.mark.asyncio
    async def test_ai_confidence_preserved(self):
        """AI-reported confidence is used directly without rescoring."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        selected_person = _create_person(cm_id=111)

        ai_result = Mock()
        ai_result.selected_person_id = 111
        ai_result.confidence = 0.85
        ai_result.reason = "Best match"

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [selected_person, _create_person(cm_id=222)]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        # Should use AI confidence (0.85 or 0.8 default)
        assert resolution_list[0].confidence in [0.85, 0.8]


class TestPhase3DisambiguationServiceStatistics:
    """Tests for statistics tracking"""

    @pytest.mark.asyncio
    async def test_get_stats_returns_disambiguation_breakdown(self):
        """get_stats returns counts for disambiguation outcomes"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        ai_result = Mock()
        ai_result.selected_person_id = 111
        ai_result.confidence = 0.85

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [_create_person(cm_id=111), _create_person(cm_id=222)]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        await service.batch_disambiguate([(parse_result, [ambiguous])])

        stats = service.get_stats()
        assert "total_processed" in stats
        assert "successfully_disambiguated" in stats
        assert "still_ambiguous" in stats
        assert "no_match" in stats
        assert "failed" in stats

    @pytest.mark.asyncio
    async def test_stats_track_success_vs_failed(self):
        """Stats distinguish successful vs failed disambiguation"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # First result: success
        success_result = Mock()
        success_result.selected_person_id = 111
        success_result.confidence = 0.85

        # Second result: still ambiguous (AI couldn't decide)
        # Note: Implementation counts this as "failed" since no disambiguated_result is created
        ambiguous_result = Mock()
        ambiguous_result.selected_person_id = None
        ambiguous_result.no_match = False
        ambiguous_result.reason = "Could not decide"

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[success_result, ambiguous_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [_create_person(cm_id=111), _create_person(cm_id=222)]

        # Two separate cases, each with one ambiguous resolution
        parse_result1 = _create_parse_result()
        parse_result2 = _create_parse_result()
        ambiguous1 = _create_ambiguous_resolution(candidates=candidates)
        ambiguous2 = _create_ambiguous_resolution(candidates=candidates)

        await service.batch_disambiguate(
            [
                (parse_result1, [ambiguous1]),
                (parse_result2, [ambiguous2]),
            ]
        )

        stats = service.get_stats()
        assert stats["successfully_disambiguated"] == 1
        # When AI returns no selected_person_id and no_match=False, it's counted as "failed"
        # because no disambiguated_result is created
        assert stats["failed"] == 1

    def test_reset_stats_clears_counters(self):
        """reset_stats sets all counters to zero"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )

        # Manually set some stats
        service._stats["total_processed"] = 10
        service._stats["successfully_disambiguated"] = 5

        service.reset_stats()

        stats = service.get_stats()
        assert stats["total_processed"] == 0
        assert stats["successfully_disambiguated"] == 0

    def test_get_stats_returns_copy(self):
        """get_stats returns a copy, not a reference"""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )

        stats1 = service.get_stats()
        stats1["total_processed"] = 999

        stats2 = service.get_stats()
        assert stats2["total_processed"] == 0


class TestPhase3Eligibility:
    """Tests for Phase 3 eligibility — which ResolutionResults enter the disambiguation loop."""

    def test_single_candidate_is_eligible(self):
        """Single-candidate unresolved result should be in disambiguation_indices (not just 2+ candidates)."""
        single_candidate = _create_resolution_result(
            person=None,
            confidence=0.5,
            method="single_match",
            candidates=[_create_person(cm_id=111)],
        )
        parse_result = _create_parse_result()
        case = DisambiguationCase(parse_result, [single_candidate])

        assert 0 in case.disambiguation_indices, (
            "Single-candidate unresolved result should enter Phase 3 (not just 2+ candidate cases)"
        )

    def test_zero_candidates_not_eligible(self):
        """Zero-candidate result should NOT be in disambiguation_indices."""
        no_candidates = _create_resolution_result(
            person=None,
            confidence=0.0,
            method="no_match",
            candidates=[],
        )
        parse_result = _create_parse_result()
        case = DisambiguationCase(parse_result, [no_candidates])

        assert 0 not in case.disambiguation_indices, (
            "Zero-candidate result has nothing to disambiguate, should not enter Phase 3"
        )

    def test_resolved_not_eligible(self):
        """Resolved result (person is not None) should NOT be in disambiguation_indices."""
        resolved = _create_resolution_result(
            person=_create_person(cm_id=111),
            confidence=0.95,
            method="exact_match",
            candidates=[_create_person(cm_id=111)],
        )
        parse_result = _create_parse_result()
        case = DisambiguationCase(parse_result, [resolved])

        assert 0 not in case.disambiguation_indices, "Already-resolved result should not be re-disambiguated in Phase 3"


class TestDisambiguationCase:
    """Tests for DisambiguationCase helper class"""

    def test_identifies_ambiguous_resolutions(self):
        """DisambiguationCase identifies which resolutions are ambiguous"""
        resolved = _create_resolution_result(person=_create_person(), confidence=0.95)
        ambiguous = _create_ambiguous_resolution()

        parse_result = _create_parse_result(parsed_requests=[_create_parsed_request(), _create_parsed_request()])

        case = DisambiguationCase(parse_result, [resolved, ambiguous])

        assert case.has_disambiguation_candidates
        assert len(case.disambiguation_indices) == 1
        assert 1 in case.disambiguation_indices  # Second resolution is ambiguous

    def test_no_ambiguous_when_all_resolved(self):
        """DisambiguationCase correctly identifies no ambiguous when all resolved"""
        resolved = _create_resolution_result(person=_create_person(), confidence=0.95)

        parse_result = _create_parse_result()

        case = DisambiguationCase(parse_result, [resolved])

        assert not case.has_disambiguation_candidates
        assert len(case.disambiguation_indices) == 0


class TestPhase3ReturnTypeUnwrapping:
    """Tests that Phase 3 correctly unwraps ParsedResponse objects from the AI provider.

    The AI provider's disambiguate() method returns ParsedResponse (not AIDisambiguationResponse).
    The selected person ID is in result.requests[0].metadata["target_person_id"], not
    result.selected_person_id. These tests verify the unwrapping logic.
    """

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_with_target_person_id(self):
        """ParsedResponse with target_person_id in metadata is correctly unwrapped to a successful disambiguation."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        selected_person = _create_person(cm_id=111, first_name="Sarah", last_name="Smith")

        # Real ParsedResponse as returned by the AI provider
        ai_result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.9,
                    csv_position=0,
                    metadata={"target_person_id": 111},
                )
            ],
            confidence=0.9,
            metadata={},
        )

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [selected_person, _create_person(cm_id=222, first_name="Sarah", last_name="Jones")]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        assert resolution_list[0].is_resolved, "ParsedResponse with target_person_id should resolve successfully"
        assert resolution_list[0].person is not None
        assert resolution_list[0].person.cm_id == 111
        assert resolution_list[0].method == "ai_disambiguation"

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_no_match(self):
        """ParsedResponse without target_person_id in metadata results in no_match."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # ParsedResponse with no target_person_id — AI couldn't select anyone
        ai_result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.5,
                    csv_position=0,
                    metadata={},  # No target_person_id
                )
            ],
            confidence=0.5,
            metadata={},
        )

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata.get("disambiguation_status") == "no_match"

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_unknown_person_id(self):
        """ParsedResponse with target_person_id not in candidates results in no_match."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI selects person 999 which is NOT in the candidate list
        ai_result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.85,
                    csv_position=0,
                    metadata={"target_person_id": 999},  # Not in candidates
                )
            ],
            confidence=0.85,
            metadata={},
        )

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[ai_result])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        parse_result = _create_parse_result()

        results = await service.batch_disambiguate([(parse_result, [ambiguous])])

        _, resolution_list = results[0]
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata.get("disambiguation_status") == "no_match"

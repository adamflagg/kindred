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
        source_field="bunk_with",
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


def _create_ranked_ai_response(
    target_name: str = "Sarah Smith",
    ranked: list[tuple[int, float]] | None = None,
    no_match: bool = False,
    no_match_reason: str = "",
    confidence: float = 0.85,
) -> Any:
    """Create a ParsedResponse as if returned by openai_provider.disambiguate().

    `ranked` is a list of (person_id, confidence) pairs that will be serialized
    into metadata["ranked_selections"]. If `no_match` is True, writes no_match
    metadata instead.
    """
    from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

    metadata: dict[str, Any] = {}
    if ranked:
        metadata["ranked_selections"] = [{"person_id": pid, "confidence": c, "reasoning": ""} for pid, c in ranked]
        metadata["target_person_id"] = ranked[0][0]
    if no_match:
        metadata["no_match"] = True
        metadata["no_match_reason"] = no_match_reason

    return ParsedResponse(
        requests=[
            ParsedRequest(
                raw_text=f"bunk with {target_name}",
                request_type=RequestType.BUNK_WITH,
                target_name=target_name,
                age_preference=None,
                source_field="bunk_with",
                confidence=confidence,
                csv_position=0,
                metadata=metadata,
            )
        ],
        confidence=confidence,
        metadata={},
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

        # AI returns a ranked_selections result picking person 111
        ai_result = _create_ranked_ai_response(ranked=[(111, 0.85)], confidence=0.85)

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
        """Cases where AI returns no selection are marked as invalid_ai_output"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI returns ParsedResponse with no ranked_selections and no no_match
        ai_result = _create_ranked_ai_response()

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
        # AI tried but returned invalid/no output — marked as invalid_ai_output (original resolution kept)
        assert resolution_list[0].is_ambiguous
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata.get("disambiguation_status") == "invalid_ai_output"

    @pytest.mark.asyncio
    async def test_no_match_from_ai_handled(self):
        """AI explicitly saying no match is handled"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI returns no_match in ParsedResponse metadata
        ai_result = _create_ranked_ai_response(
            no_match=True, no_match_reason="None of the candidates match the request"
        )

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
        """AI-reported confidence flows through the reranker into the final resolution."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        selected_person = _create_person(cm_id=111)

        ai_result = _create_ranked_ai_response(ranked=[(111, 0.85)], confidence=0.85)

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
        # Final confidence is the reranker output: min(ai_confidence, max(0.3, jw_score)).
        # Verify the resolution carries the AI confidence through metadata.
        assert resolution_list[0].metadata is not None
        assert resolution_list[0].metadata["ai_confidence"] == pytest.approx(0.85)


class TestPhase3DisambiguationServiceStatistics:
    """Tests for statistics tracking"""

    @pytest.mark.asyncio
    async def test_get_stats_returns_disambiguation_breakdown(self):
        """get_stats returns counts for disambiguation outcomes"""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        ai_result = _create_ranked_ai_response(ranked=[(111, 0.85)], confidence=0.85)

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

        # First result: success via ranked_selections
        success_result = _create_ranked_ai_response(ranked=[(111, 0.85)], confidence=0.85)

        # Second result: AI returned no ranked_selections and no no_match — invalid_ai_output
        ambiguous_result = _create_ranked_ai_response()

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
        # When AI returns no ranked_selections and no_match=False, it's counted as "invalid_ai_output"
        assert stats["invalid_ai_output"] == 1
        assert stats["failed"] == 0

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
    Canonical path post #944: ranked_selections in result.requests[0].metadata.
    """

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_with_ranked_selections(self):
        """ParsedResponse with ranked_selections in metadata is resolved via reranker path."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        selected_person = _create_person(cm_id=111, first_name="Sarah", last_name="Smith")

        ai_result = _create_ranked_ai_response(
            target_name="Sarah Smith",
            ranked=[(111, 0.9), (222, 0.3)],
            confidence=0.9,
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
        assert resolution_list[0].is_resolved, "ParsedResponse with ranked_selections should resolve successfully"
        assert resolution_list[0].person is not None
        assert resolution_list[0].person.cm_id == 111
        assert resolution_list[0].method == "ai_disambiguation"

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_no_match(self):
        """ParsedResponse without target_person_id in metadata results in invalid_ai_output."""
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
                    source_field="bunk_with",
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
        assert resolution_list[0].metadata.get("disambiguation_status") == "invalid_ai_output"

    @pytest.mark.asyncio
    async def test_unwraps_parsed_response_unknown_person_id(self):
        """ParsedResponse with ranked_selections whose ids aren't in candidates → rejected by reranker (no_match)."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # AI ranks person 999 — NOT in the candidate list. Reranker rejects it.
        ai_result = _create_ranked_ai_response(
            target_name="Sarah Smith",
            ranked=[(999, 0.85)],
            confidence=0.85,
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


class TestPhase3InvalidAIOutput:
    """Tests for the invalid_ai_output status — AI returned unparseable/no-selection output."""

    @pytest.mark.asyncio
    async def test_catch_all_path_sets_invalid_ai_output_status(self):
        """When AI returns no ranked_selections and no no_match flag, status is invalid_ai_output."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # ParsedResponse with empty metadata — no ranked_selections, no no_match
        ai_result = _create_ranked_ai_response()

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
        assert resolution_list[0].metadata.get("disambiguation_status") == "invalid_ai_output", (
            "Catch-all path (no selection, no no_match flag) should be 'invalid_ai_output', not 'no_match'"
        )

    def test_init_stats_include_invalid_ai_output(self):
        """Stats dict should have an 'invalid_ai_output' key initialized to 0."""
        ai_provider = Mock()
        context_builder = Mock()
        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
        )
        stats = service.get_stats()
        assert "invalid_ai_output" in stats, "get_stats() must contain 'invalid_ai_output' key"


class TestSetMetaHelper:
    """Tests for the _set_meta helper that wraps disambiguation_metadata.setdefault."""

    def _make_service(self) -> Phase3DisambiguationService:
        return Phase3DisambiguationService(
            ai_provider=Mock(),
            context_builder=Mock(),
        )

    def _make_case(self) -> DisambiguationCase:
        parse_result = _create_parse_result()
        ambiguous = _create_ambiguous_resolution()
        return DisambiguationCase(parse_result, [ambiguous])

    def test_set_meta_returns_default_dict_when_key_absent(self):
        """_set_meta inserts the default when key is absent and returns it."""
        service = self._make_service()
        case = self._make_case()
        result = service._set_meta(case, "status", dict[int, str]())
        assert result == {}
        assert "status" in case.disambiguation_metadata

    def test_set_meta_returns_existing_value_when_key_present(self):
        """_set_meta returns existing value without overwriting."""
        service = self._make_service()
        case = self._make_case()
        case.disambiguation_metadata["status"] = {0: "success"}
        result = service._set_meta(case, "status", dict[int, str]())
        assert result == {0: "success"}

    def test_set_meta_allows_mutation_of_returned_value(self):
        """Callers can mutate the returned object (dict or list in place)."""
        service = self._make_service()
        case = self._make_case()
        service._set_meta(case, "errors", dict[int, str]())[42] = "boom"
        assert case.disambiguation_metadata["errors"][42] == "boom"

    def test_set_meta_different_keys_are_independent(self):
        """Different keys inserted via _set_meta do not collide."""
        service = self._make_service()
        case = self._make_case()
        service._set_meta(case, "status", dict[int, str]())[0] = "success"
        service._set_meta(case, "reasons", dict[int, str]())[0] = "good reason"
        assert case.disambiguation_metadata["status"] == {0: "success"}
        assert case.disambiguation_metadata["reasons"] == {0: "good reason"}


class TestTryRerankerPath:
    """Tests for the _try_reranker_path helper.

    This covers the ParsedResponse-only paths: JW re-ranker consumption of
    ranked_selections, and metadata-level AI no_match. Returns True only when
    the path has fully handled the case (success or no_match recorded).
    """

    def _make_service(self) -> Phase3DisambiguationService:
        return Phase3DisambiguationService(
            ai_provider=Mock(),
            context_builder=Mock(),
        )

    def _make_case(self) -> tuple[DisambiguationCase, ResolutionResult]:
        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        case = DisambiguationCase(_create_parse_result(), [ambiguous])
        return case, ambiguous

    def test_returns_false_for_non_parsed_response(self):
        """Non-ParsedResponse results are not handled by the re-ranker path."""
        service = self._make_service()
        case, resolution = self._make_case()
        assert service._try_reranker_path(case, 0, resolution, object()) is False

    def test_returns_false_for_parsed_response_without_signals(self):
        """ParsedResponse without ranked_selections or no_match does not short-circuit."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        case, resolution = self._make_case()
        result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.8,
                    csv_position=0,
                    metadata={"target_person_id": 111},
                )
            ],
            confidence=0.8,
            metadata={},
        )
        assert service._try_reranker_path(case, 0, resolution, result) is False

    def test_handles_no_match_metadata(self):
        """ParsedResponse metadata no_match=True records no_match status and returns True."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        case, resolution = self._make_case()
        result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.5,
                    csv_position=0,
                    metadata={"no_match": True, "no_match_reason": "none fit"},
                )
            ],
            confidence=0.5,
            metadata={},
        )
        handled = service._try_reranker_path(case, 0, resolution, result)
        assert handled is True
        assert case.disambiguation_metadata["status"][0] == "no_match"
        assert case.disambiguation_metadata["reasons"][0] == "none fit"

    def test_handles_ranked_selections_success(self):
        """Valid ranked_selections populate disambiguated_results and mark success."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        case, resolution = self._make_case()
        # Candidate 111 has last_name "Smith" — matches target "Sarah Smith" via JW.
        result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.9,
                    csv_position=0,
                    metadata={
                        "ranked_selections": [
                            {"person_id": 111, "confidence": 0.95},
                            {"person_id": 222, "confidence": 0.4},
                        ],
                    },
                )
            ],
            confidence=0.9,
            metadata={},
        )
        # Ensure resolution has target_name so re-ranker can score
        resolution.target_name = "Sarah Smith"
        handled = service._try_reranker_path(case, 0, resolution, result)
        assert handled is True
        disambig = case.disambiguated_results[0]
        assert disambig is not None
        assert disambig.person is not None
        assert disambig.method == "ai_disambiguation"
        assert case.disambiguation_metadata["status"][0] == "success"

    def test_handles_ranked_selections_all_rejected(self):
        """When re-ranker rejects all candidates (JW too low), records no_match and returns True."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        # Target "Zzzzz Qqqqq" won't match either candidate's last name.
        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        ambiguous.target_name = "Zzzzz Qqqqq"
        case = DisambiguationCase(_create_parse_result(), [ambiguous])
        result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Zzzzz Qqqqq",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Zzzzz Qqqqq",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.9,
                    csv_position=0,
                    metadata={
                        "ranked_selections": [
                            {"person_id": 111, "confidence": 0.95},
                            {"person_id": 222, "confidence": 0.4},
                        ],
                        "no_match": False,
                    },
                )
            ],
            confidence=0.9,
            metadata={},
        )
        handled = service._try_reranker_path(case, 0, ambiguous, result)
        assert handled is True
        assert case.disambiguation_metadata["status"][0] == "no_match"
        assert case.disambiguated_results[0] is None


class TestRecordInvalidAiOutput:
    """Tests for the _record_invalid_ai_output helper.

    Called when _try_reranker_path returns False — no ranked_selections and no no_match
    metadata in the AI result. Records invalid_ai_output status on the case.
    """

    def _make_service(self) -> Phase3DisambiguationService:
        return Phase3DisambiguationService(
            ai_provider=Mock(),
            context_builder=Mock(),
        )

    def _make_case(self) -> tuple[DisambiguationCase, ResolutionResult]:
        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        case = DisambiguationCase(_create_parse_result(), [ambiguous])
        return case, ambiguous

    def test_records_invalid_ai_output_status(self):
        """_record_invalid_ai_output writes invalid_ai_output status and reason."""
        service = self._make_service()
        case, resolution = self._make_case()
        service._record_invalid_ai_output(case, 0, resolution, object())
        assert case.disambiguation_metadata["status"][0] == "invalid_ai_output"
        assert case.disambiguation_metadata["reasons"][0] == "No suitable match"


class TestPhase3StatsMatchTrace:
    """Regression tests for issue #942: Phase 3 stats must mirror trace's result field.

    Acceptance criteria:
    - Sum of (disambiguated + still_ambiguous + no_match + invalid_ai_output + failed)
      equals the count of Phase 3 trace rows with ran=true.
    - Reranker-resolved cases are counted in successfully_disambiguated.

    The trace's result is computed per-intent in the orchestrator as:
      - "resolved" if rr.is_resolved
      - "not_needed" if ran_phase3 is False
      - Otherwise rr.metadata.get("disambiguation_status", "still_ambiguous")

    A trace row has ran=true for every intent in a ParseResult that had any
    unresolved intent. Therefore stats must count ALL intents in cases that
    entered Phase 3, not just those in disambiguation_indices.
    """

    @pytest.mark.asyncio
    async def test_reranker_resolved_case_counted_in_successfully_disambiguated(self):
        """A reranker-resolved case (ParsedResponse with ranked_selections) must
        increment successfully_disambiguated."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # ParsedResponse with ranked_selections — the reranker path will consume this
        # and successfully pick a candidate because the target name matches.
        ai_result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.9,
                    csv_position=0,
                    metadata={
                        "ranked_selections": [
                            {"person_id": 111, "confidence": 0.95},
                            {"person_id": 222, "confidence": 0.4},
                        ],
                    },
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

        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=candidates)
        ambiguous.target_name = "Sarah Smith"
        parse_result = _create_parse_result()

        await service.batch_disambiguate([(parse_result, [ambiguous])])

        stats = service.get_stats()
        assert stats["successfully_disambiguated"] == 1, (
            f"Reranker-resolved case should count as successfully_disambiguated, got stats: {stats}"
        )

    @pytest.mark.asyncio
    async def test_stats_sum_equals_trace_ran_rows(self):
        """Sum of all outcome stats must equal the count of trace rows with ran=true.

        Simulates the orchestrator's trace computation: every intent in a
        ParseResult that entered Phase 3 has ran=True in the trace. The stats
        must mirror that — counting every intent, including Phase 2 wins in
        the same ParseResult.
        """
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # Reranker-resolved result for the one ambiguous intent in the mixed case.
        reranker_success = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.9,
                    csv_position=0,
                    metadata={
                        "ranked_selections": [
                            {"person_id": 111, "confidence": 0.95},
                        ],
                    },
                )
            ],
            confidence=0.9,
            metadata={},
        )

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[reranker_success])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Mixed ParseResult: one Phase-2-resolved intent, one ambiguous intent
        # that will be resolved via the reranker path.
        resolved_candidate = _create_person(cm_id=111, first_name="Sarah", last_name="Smith")
        ambiguous = _create_ambiguous_resolution(
            candidates=[
                resolved_candidate,
                _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
            ]
        )
        ambiguous.target_name = "Sarah Smith"

        phase2_resolved = _create_resolution_result(
            person=_create_person(cm_id=333, first_name="Liam", last_name="Garcia"),
            confidence=0.95,
            method="exact",
        )

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request(target_name="Liam Garcia"),
                _create_parsed_request(target_name="Sarah Smith"),
            ]
        )

        await service.batch_disambiguate([(parse_result, [phase2_resolved, ambiguous])])

        stats = service.get_stats()

        # Per orchestrator: every intent in a ParseResult with any unresolved
        # has ran=True. So both intents here should be ran=True → total 2.
        expected_ran_count = 2
        stats_sum = (
            stats["successfully_disambiguated"]
            + stats["still_ambiguous"]
            + stats["no_match"]
            + stats["invalid_ai_output"]
            + stats["failed"]
        )
        assert stats_sum == expected_ran_count, (
            f"Stats sum ({stats_sum}) must equal count of trace ran=True rows ({expected_ran_count}). Stats: {stats}"
        )

        # Both intents end up resolved (Phase 2 win + reranker win).
        assert stats["successfully_disambiguated"] == 2, (
            f"Both intents are resolved (Phase 2 win + reranker win), "
            f"expected successfully_disambiguated=2, got stats: {stats}"
        )

    @pytest.mark.asyncio
    async def test_batch_processor_exception_increments_failed_and_preserves_sum(self):
        """When batch_processor.batch_disambiguate raises, every intent in every
        case that entered Phase 3 must be classified as `failed`, and the sum of
        outcome buckets must still equal the count of trace rows with ran=True.

        Regression pin for the exception path — guards against future refactors
        that might reorder `_build_final_results` / `_update_stats` or drop the
        per-case error propagation in the except block.
        """
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(side_effect=RuntimeError("AI provider down"))

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Two ambiguous ParseResults, each with one ambiguous intent.
        candidates_a = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        candidates_b = [
            _create_person(cm_id=333, first_name="Liam", last_name="Garcia"),
            _create_person(cm_id=444, first_name="Liam", last_name="Chen"),
        ]
        ambiguous_a = _create_ambiguous_resolution(candidates=candidates_a)
        ambiguous_b = _create_ambiguous_resolution(candidates=candidates_b)
        parse_result_a = _create_parse_result()
        parse_result_b = _create_parse_result()

        await service.batch_disambiguate(
            [
                (parse_result_a, [ambiguous_a]),
                (parse_result_b, [ambiguous_b]),
            ]
        )

        stats = service.get_stats()

        # Orchestrator trace: every intent in each ParseResult that entered
        # Phase 3 has ran=True. Two ParseResults × one intent each = 2.
        expected_ran_count = 2
        stats_sum = (
            stats["successfully_disambiguated"]
            + stats["still_ambiguous"]
            + stats["no_match"]
            + stats["invalid_ai_output"]
            + stats["failed"]
        )
        assert stats_sum == expected_ran_count, (
            f"Stats sum ({stats_sum}) must equal count of trace ran=True rows ({expected_ran_count}). Stats: {stats}"
        )
        assert stats["failed"] == 2, (
            f"Both intents should be classified as failed when the AI call raises, got stats: {stats}"
        )

    @pytest.mark.asyncio
    async def test_no_candidate_parse_result_counted_in_stats(self):
        """A ParseResult whose only unresolved intent has zero candidates must
        still be counted in `_stats`.

        The orchestrator records ran=True for every intent in any ParseResult
        with any unresolved intent (via `needs_phase3`, which doesn't check
        candidates). If the service silently drops no-candidate ParseResults,
        the stats sum undercounts vs. the trace.
        """
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        batch_processor = Mock()
        # No candidates anywhere -> batch_processor should not be called, but
        # AsyncMock keeps it safe if the implementation changes.
        batch_processor.batch_disambiguate = AsyncMock(return_value=[])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # A ParseResult with one unresolved intent and zero candidates
        # (e.g. name not found in CampMinder at all).
        no_candidate_rr = _create_resolution_result(
            person=None,
            confidence=0.0,
            method="no_match",
            candidates=[],
        )
        parse_result = _create_parse_result()

        await service.batch_disambiguate([(parse_result, [no_candidate_rr])])

        stats = service.get_stats()

        # Orchestrator trace: the single intent has ran=True.
        expected_ran_count = 1
        stats_sum = (
            stats["successfully_disambiguated"]
            + stats["still_ambiguous"]
            + stats["no_match"]
            + stats["invalid_ai_output"]
            + stats["failed"]
        )
        assert stats_sum == expected_ran_count, (
            f"Stats sum ({stats_sum}) must equal count of trace ran=True rows "
            f"({expected_ran_count}). {expected_ran_count} rows in trace but only "
            f"{stats_sum} in stats. Stats: {stats}"
        )

    @pytest.mark.asyncio
    async def test_no_candidate_mixed_with_ambiguous_case_all_counted(self):
        """With a mix of no-candidate ParseResults and ambiguous ParseResults,
        stats sum must still equal the count of trace rows with ran=True.
        """
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # Reranker success for the one ambiguous case the batch processor sees.
        reranker_success = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="bunk_with",
                    confidence=0.9,
                    csv_position=0,
                    metadata={
                        "ranked_selections": [
                            {"person_id": 111, "confidence": 0.95},
                        ],
                    },
                )
            ],
            confidence=0.9,
            metadata={},
        )

        batch_processor = Mock()
        batch_processor.batch_disambiguate = AsyncMock(return_value=[reranker_success])

        service = Phase3DisambiguationService(
            ai_provider=ai_provider,
            context_builder=context_builder,
            batch_processor=batch_processor,
        )

        # Case 1: no candidates (unresolved, nothing to disambiguate).
        no_candidate_rr = _create_resolution_result(
            person=None,
            confidence=0.0,
            method="no_match",
            candidates=[],
        )
        parse_result_nc = _create_parse_result()

        # Case 2: an ambiguous case the reranker will resolve.
        ambiguous_candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]
        ambiguous = _create_ambiguous_resolution(candidates=ambiguous_candidates)
        ambiguous.target_name = "Sarah Smith"
        parse_result_amb = _create_parse_result()

        await service.batch_disambiguate(
            [
                (parse_result_nc, [no_candidate_rr]),
                (parse_result_amb, [ambiguous]),
            ]
        )

        stats = service.get_stats()

        # Two intents total; both have ran=True in the trace.
        expected_ran_count = 2
        stats_sum = (
            stats["successfully_disambiguated"]
            + stats["still_ambiguous"]
            + stats["no_match"]
            + stats["invalid_ai_output"]
            + stats["failed"]
        )
        assert stats_sum == expected_ran_count, (
            f"Stats sum ({stats_sum}) must equal count of trace ran=True rows ({expected_ran_count}). Stats: {stats}"
        )
        # Reranker success on the ambiguous case.
        assert stats["successfully_disambiguated"] == 1, stats
        # No-candidate intent should land in no_match (nothing to match against).
        assert stats["no_match"] == 1, stats

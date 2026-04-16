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
        """Cases where AI returns no selection are marked as invalid_ai_output"""
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

        # Second result: AI returned no selection and no no_match flag — invalid_ai_output
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
        # When AI returns no selected_person_id and no_match=False, it's counted as "invalid_ai_output"
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
        assert resolution_list[0].metadata.get("disambiguation_status") == "invalid_ai_output"

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


class TestPhase3InvalidAIOutput:
    """Tests for the invalid_ai_output status — AI returned unparseable/no-selection output."""

    @pytest.mark.asyncio
    async def test_catch_all_path_sets_invalid_ai_output_status(self):
        """When AI returns no selected_person_id and no no_match flag, status is invalid_ai_output."""
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context.return_value = _create_mock_context()

        # Legacy Mock path: no person selected, no explicit no_match — the catch-all else branch
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


class TestExtractAiResultFields:
    """Tests for the _extract_ai_result_fields helper.

    Unwraps various AI result shapes into a canonical (selected_person_id,
    ai_confidence, ai_reason) triple. ParsedResponse reads metadata from
    result.requests[0].metadata; legacy objects read attributes directly.
    """

    def _make_service(self) -> Phase3DisambiguationService:
        return Phase3DisambiguationService(
            ai_provider=Mock(),
            context_builder=Mock(),
        )

    def test_extract_from_parsed_response_with_target_person_id(self):
        """ParsedResponse with target_person_id in metadata yields that id, response confidence, and reason."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        result = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="Sarah Smith",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Sarah Smith",
                    age_preference=None,
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
                    confidence=0.92,
                    csv_position=0,
                    metadata={"target_person_id": 111, "reason": "last-name match"},
                )
            ],
            confidence=0.92,
            metadata={},
        )
        selected_id, ai_confidence, ai_reason = service._extract_ai_result_fields(result)
        assert selected_id == 111
        assert ai_confidence == 0.92
        assert ai_reason == "last-name match"

    def test_extract_from_parsed_response_with_empty_requests(self):
        """ParsedResponse with no requests yields (None, response.confidence, None)."""
        from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

        service = self._make_service()
        result = ParsedResponse(requests=[], confidence=0.5, metadata={})
        selected_id, ai_confidence, ai_reason = service._extract_ai_result_fields(result)
        assert selected_id is None
        assert ai_confidence == 0.5
        assert ai_reason is None

    def test_extract_from_legacy_response_reads_attributes(self):
        """Legacy AIDisambiguationResponse (has selected_person_id attribute) is read directly."""
        service = self._make_service()
        legacy = Mock(spec=["selected_person_id", "confidence", "reason"])
        legacy.selected_person_id = 222
        legacy.confidence = 0.77
        legacy.reason = "legacy pick"
        selected_id, ai_confidence, ai_reason = service._extract_ai_result_fields(legacy)
        assert selected_id == 222
        assert ai_confidence == 0.77
        assert ai_reason == "legacy pick"

    def test_extract_from_unknown_type_returns_defaults(self):
        """An unknown result type yields default (None, 0.8, None)."""
        service = self._make_service()
        selected_id, ai_confidence, ai_reason = service._extract_ai_result_fields(object())
        assert selected_id is None
        assert ai_confidence == 0.8
        assert ai_reason is None


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
        """Legacy / non-ParsedResponse results are not handled by the re-ranker path."""
        service = self._make_service()
        case, resolution = self._make_case()
        legacy = Mock(spec=["selected_person_id"])
        legacy.selected_person_id = 111
        assert service._try_reranker_path(case, 0, resolution, legacy) is False

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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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


class TestApplyLegacySelection:
    """Tests for the _apply_legacy_selection helper.

    Validates the selected_person_id candidate match (success/no_match) and
    the legacy `no_match` attribute / invalid_ai_output fallbacks.
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

    def test_success_when_selected_id_matches_candidate(self):
        """selected_person_id matching a candidate records success + ResolutionResult."""
        service = self._make_service()
        case, resolution = self._make_case()
        result = Mock()  # Not used for successful matches
        service._apply_legacy_selection(case, 0, resolution, result, 111, 0.88, "good match")
        disambig = case.disambiguated_results[0]
        assert disambig is not None
        assert disambig.person is not None
        assert disambig.person.cm_id == 111
        assert disambig.confidence == 0.88
        assert disambig.method == "ai_disambiguation"
        assert disambig.metadata is not None
        assert disambig.metadata["disambiguation_reason"] == "good match"
        assert case.disambiguation_metadata["status"][0] == "success"

    def test_no_match_when_selected_id_not_in_candidates(self):
        """selected_person_id absent from candidates records no_match + selected_ids."""
        service = self._make_service()
        case, resolution = self._make_case()
        result = Mock()
        service._apply_legacy_selection(case, 0, resolution, result, 999, 0.5, None)
        assert case.disambiguation_metadata["status"][0] == "no_match"
        assert case.disambiguation_metadata["selected_ids"][0] == 999

    def test_legacy_no_match_attribute_records_no_match(self):
        """When selected_id is None but result.no_match is truthy, records no_match."""
        service = self._make_service()
        case, resolution = self._make_case()
        result = Mock(spec=["no_match", "reason"])
        result.no_match = True
        result.reason = "legacy no match"
        service._apply_legacy_selection(case, 0, resolution, result, None, 0.8, None)
        assert case.disambiguation_metadata["status"][0] == "no_match"
        assert case.disambiguation_metadata["reasons"][0] == "legacy no match"

    def test_invalid_ai_output_when_no_selection_and_no_no_match(self):
        """No selection and no legacy no_match flag yields invalid_ai_output status."""
        service = self._make_service()
        case, resolution = self._make_case()
        # Use an object without a no_match attribute to test the invalid_ai_output branch.
        result = object()
        service._apply_legacy_selection(case, 0, resolution, result, None, 0.8, "some reason")
        assert case.disambiguation_metadata["status"][0] == "invalid_ai_output"
        assert case.disambiguation_metadata["reasons"][0] == "some reason"


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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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
                    source_field="share_bunk_with",
                    source=RequestSource.FAMILY,
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

"""Tests for Phase2ResolutionService

Tests cover:
1. Initialization with resolution pipeline and optional components
2. Core batch resolution functionality
3. Session filtering (same session, cross-session decline)
4. Historical request handling
5. Age preference handling (no name resolution needed)
6. NetworkX enhancement for ambiguous cases
7. Metadata preservation
8. Statistics tracking"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    Phase2ResolutionService,
    ResolutionCase,
)


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
    grade: int | None = 5,
) -> Person:
    """Helper to create Person objects"""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
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
    target_name: str | None = "Sarah Smith",
    request_type: RequestType = RequestType.BUNK_WITH,
    confidence: float = 0.9,
    age_preference: AgePreference | None = None,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}" if target_name else "older campers",
        request_type=request_type,
        target_name=target_name,
        age_preference=age_preference,
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


class TestPhase2ResolutionServiceInit:
    """Tests for Phase2ResolutionService initialization"""

    def test_init_with_resolution_pipeline(self):
        """Service requires resolution_pipeline"""
        pipeline = Mock()
        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        assert service.resolution_pipeline == pipeline

    def test_init_with_optional_networkx_analyzer(self):
        """Service accepts optional networkx_analyzer"""
        pipeline = Mock()
        analyzer = Mock()
        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=analyzer,
        )
        assert service.networkx_analyzer == analyzer

    def test_init_with_optional_confidence_scorer(self):
        """Service accepts optional confidence_scorer"""
        pipeline = Mock()
        scorer = Mock()
        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            confidence_scorer=scorer,
        )
        assert service.confidence_scorer == scorer

    def test_init_stats_are_zero(self):
        """Stats should start at zero"""
        pipeline = Mock()
        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        stats = service.get_stats()
        assert stats["total_processed"] == 0
        assert stats["high_confidence_resolved"] == 0
        assert stats["low_confidence_resolved"] == 0
        assert stats["ambiguous"] == 0
        assert stats["failed"] == 0
        assert stats["age_preferences"] == 0


class TestPhase2ResolutionServiceBatchResolve:
    """Tests for batch_resolve method"""

    @pytest.mark.asyncio
    async def test_batch_resolve_returns_tuples(self):
        """batch_resolve returns list of (ParseResult, List[ResolutionResult]) tuples"""
        pipeline = Mock()
        resolved_person = _create_person()
        pipeline.batch_resolve = Mock(
            return_value=[_create_resolution_result(person=resolved_person, confidence=0.95, method="exact")]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parse_results = [_create_parse_result()]

        results = await service.batch_resolve(parse_results)

        assert len(results) == 1
        assert isinstance(results[0], tuple)
        assert results[0][0] == parse_results[0]
        assert isinstance(results[0][1], list)

    @pytest.mark.asyncio
    async def test_batch_resolve_handles_empty_input(self):
        """batch_resolve handles empty input gracefully"""
        pipeline = Mock()
        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        results = await service.batch_resolve([])

        assert results == []
        pipeline.batch_resolve.assert_not_called()

    @pytest.mark.asyncio
    async def test_exact_match_same_session_returns_high_confidence(self):
        """V1: Exact match same session returns 0.95 confidence"""
        pipeline = Mock()
        resolved_person = _create_person()
        # Pipeline returns resolved result
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=resolved_person,
                    confidence=0.95,
                    method="exact_full_name_same_session",
                )
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parse_result = _create_parse_result()

        results = await service.batch_resolve([parse_result])

        assert len(results) == 1
        _, resolutions = results[0]
        assert len(resolutions) == 1
        assert resolutions[0].confidence >= 0.85  # High confidence threshold

    @pytest.mark.asyncio
    async def test_resolve_marks_ambiguous_for_phase3(self):
        """Ambiguous results should be marked for Phase 3"""
        pipeline = Mock()
        candidate1 = _create_person(cm_id=111, first_name="Sarah", last_name="Smith")
        candidate2 = _create_person(cm_id=222, first_name="Sarah", last_name="Smith")
        # Pipeline returns ambiguous result (no person, multiple candidates)
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=None,
                    confidence=0.5,
                    method="ambiguous",
                    candidates=[candidate1, candidate2],
                )
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        results = await service.batch_resolve([_create_parse_result()])

        _, resolutions = results[0]
        assert resolutions[0].is_ambiguous


class TestPhase2ResolutionServiceSessionFiltering:
    """"""

    @pytest.mark.asyncio
    async def test_same_session_match_accepted(self):
        """V1: Same session requests should be accepted"""
        pipeline = Mock()
        resolved_person = _create_person()
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=resolved_person,
                    confidence=0.95,
                    method="exact_same_session",
                )
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        # Requester and target in same session
        parse_request = _create_parse_request(session_cm_id=1000002)
        parse_result = _create_parse_result(parse_request=parse_request)

        results = await service.batch_resolve([parse_result])

        _, resolutions = results[0]
        assert resolutions[0].is_resolved
        assert resolutions[0].confidence >= 0.85

    @pytest.mark.asyncio
    async def test_calls_pipeline_with_correct_parameters(self):
        """Verifies pipeline is called with (name, requester_cm_id, session_cm_id, year)"""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[_create_resolution_result()])

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parse_request = _create_parse_request(
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )
        parsed_request = _create_parsed_request(target_name="Sarah Smith")
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )

        await service.batch_resolve([parse_result])

        pipeline.batch_resolve.assert_called_once()
        call_args = pipeline.batch_resolve.call_args[0][0]
        assert len(call_args) == 1
        name, requester_id, session_id, year = call_args[0]
        assert name == "Sarah Smith"
        assert requester_id == 11111
        assert session_id == 1000002
        assert year == 2025


class TestPhase2ResolutionServiceAgePreferences:
    """Tests for age preference handling - no name resolution needed"""

    @pytest.mark.asyncio
    async def test_age_preference_resolved_locally(self):
        """V1: Age preferences don't need name resolution"""
        pipeline = Mock()
        # Should not be called for age preferences
        pipeline.batch_resolve = Mock(return_value=[])

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parsed_request = _create_parsed_request(
            target_name=None,
            request_type=RequestType.AGE_PREFERENCE,
            age_preference=AgePreference.OLDER,
        )
        parse_result = _create_parse_result(parsed_requests=[parsed_request])

        results = await service.batch_resolve([parse_result])

        # Pipeline should not be called for age preferences
        # (or called with empty list for this case)
        _, resolutions = results[0]
        assert len(resolutions) == 1
        assert resolutions[0].method == "age_preference"

    @pytest.mark.asyncio
    async def test_age_preference_confidence_100(self):
        """V1: Age preferences have confidence 1.0"""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parsed_request = _create_parsed_request(
            target_name=None,
            request_type=RequestType.AGE_PREFERENCE,
            age_preference=AgePreference.YOUNGER,
        )
        parse_result = _create_parse_result(parsed_requests=[parsed_request])

        results = await service.batch_resolve([parse_result])

        _, resolutions = results[0]
        assert resolutions[0].confidence == 1.0


class TestPhase2ResolutionServiceNetworkX:
    """Tests for NetworkX enhancement of ambiguous cases"""

    @pytest.mark.asyncio
    async def test_networkx_enhancement_for_ambiguous_cases(self):
        """NetworkX analyzer enhances ambiguous results"""
        pipeline = Mock()
        candidate1 = _create_person(cm_id=111)
        candidate2 = _create_person(cm_id=222)
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=None,
                    confidence=0.5,
                    candidates=[candidate1, candidate2],
                )
            ]
        )

        # NetworkX returns enhanced result with winner
        networkx_analyzer = Mock()
        enhanced_result = _create_resolution_result(
            person=candidate1,
            confidence=0.85,
            method="networkx_enhanced",
        )
        networkx_analyzer.enhance_resolution = AsyncMock(return_value=enhanced_result)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        results = await service.batch_resolve([_create_parse_result()])

        networkx_analyzer.enhance_resolution.assert_called_once()
        _, resolutions = results[0]
        assert resolutions[0].is_resolved
        assert resolutions[0].method == "networkx_enhanced"

    @pytest.mark.asyncio
    async def test_networkx_skipped_when_not_configured(self):
        """NetworkX enhancement skipped when analyzer not provided"""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=None,
                    confidence=0.5,
                    candidates=[_create_person(cm_id=111), _create_person(cm_id=222)],
                )
            ]
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=None,  # Not configured
        )

        results = await service.batch_resolve([_create_parse_result()])

        _, resolutions = results[0]
        # Should still be ambiguous without NetworkX
        assert resolutions[0].is_ambiguous


class TestPhase2ResolutionServiceConfidenceScoring:
    """Tests for confidence scoring integration"""

    @pytest.mark.asyncio
    async def test_confidence_scorer_applied_to_resolved_results(self):
        """Confidence scorer is applied to resolved results"""
        pipeline = Mock()
        resolved_person = _create_person()
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=resolved_person,
                    confidence=0.9,  # Original confidence
                    method="exact",
                )
            ]
        )

        scorer = Mock()
        scorer.score_resolution = Mock(return_value=0.95)  # Scored confidence

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            confidence_scorer=scorer,
        )

        results = await service.batch_resolve([_create_parse_result()])

        scorer.score_resolution.assert_called_once()
        _, resolutions = results[0]
        assert resolutions[0].confidence == 0.95


class TestPhase2ResolutionServiceMetadata:
    """Tests for metadata preservation"""

    @pytest.mark.asyncio
    async def test_metadata_contains_method(self):
        """Resolution result contains method used"""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=_create_person(),
                    confidence=0.95,
                    method="exact_full_name",
                )
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        results = await service.batch_resolve([_create_parse_result()])

        _, resolutions = results[0]
        assert resolutions[0].method == "exact_full_name"


class TestPhase2ResolutionServiceStatistics:
    """Tests for statistics tracking"""

    @pytest.mark.asyncio
    async def test_get_stats_returns_resolution_breakdown(self):
        """get_stats returns counts for resolution types"""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(
            return_value=[
                _create_resolution_result(
                    person=_create_person(),
                    confidence=0.95,
                    method="exact",
                )
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        await service.batch_resolve([_create_parse_result()])

        stats = service.get_stats()
        assert "total_processed" in stats
        assert "high_confidence_resolved" in stats
        assert "low_confidence_resolved" in stats
        assert "ambiguous" in stats
        assert stats["high_confidence_resolved"] >= 1

    @pytest.mark.asyncio
    async def test_stats_track_high_vs_low_confidence(self):
        """Stats distinguish high (>=0.85) from low (<0.85) confidence"""
        pipeline = Mock()
        # First call: high confidence
        # Second call: low confidence
        pipeline.batch_resolve = Mock(
            side_effect=[
                [_create_resolution_result(person=_create_person(), confidence=0.95)],
                [_create_resolution_result(person=_create_person(), confidence=0.70)],
            ]
        )

        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        await service.batch_resolve([_create_parse_result()])
        await service.batch_resolve([_create_parse_result()])

        stats = service.get_stats()
        assert stats["high_confidence_resolved"] == 1
        assert stats["low_confidence_resolved"] == 1

    def test_reset_stats_clears_counters(self):
        """reset_stats sets all counters to zero"""
        pipeline = Mock()
        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        # Manually set some stats
        service._stats["total_processed"] = 10
        service._stats["high_confidence_resolved"] = 5

        service.reset_stats()

        stats = service.get_stats()
        assert stats["total_processed"] == 0
        assert stats["high_confidence_resolved"] == 0

    def test_get_stats_returns_copy(self):
        """get_stats returns a copy, not a reference"""
        pipeline = Mock()
        service = Phase2ResolutionService(resolution_pipeline=pipeline)

        stats1 = service.get_stats()
        stats1["total_processed"] = 999

        stats2 = service.get_stats()
        assert stats2["total_processed"] == 0


class TestLastYearBunkmatesPlaceholder:
    """"""

    def test_last_year_bunkmates_placeholder_not_resolved(self):
        """
            if parsed_request.target_name == "LAST_YEAR_BUNKMATES":
                # This will be expanded elsewhere, just return placeholder with high confidence
                return None, 1.0

        The placeholder is a marker that gets expanded to individual bunk_with requests
        for each returning bunkmate elsewhere. Resolution should NOT try to resolve
        the literal string "LAST_YEAR_BUNKMATES" against the person database.
        """
        parsed_placeholder = _create_parsed_request(
            target_name="LAST_YEAR_BUNKMATES",
            request_type=RequestType.BUNK_WITH,
        )
        parse_result = _create_parse_result(parsed_requests=[parsed_placeholder])

        case = ResolutionCase(parse_result)

        # LAST_YEAR_BUNKMATES should NOT need resolution - it's a placeholder
        assert not case.needs_resolution, (
            "LAST_YEAR_BUNKMATES placeholder should NOT be sent to resolution pipeline. "
            "Monolith returns (None, 1.0) immediately for this placeholder."
        )
        assert len(case.requests_needing_resolution) == 0

    @pytest.mark.asyncio
    async def test_last_year_bunkmates_returns_high_confidence(self):
        """
        The monolith returns (None, 1.0) for this placeholder because it will be
        expanded elsewhere. We should return a resolution result with confidence 1.0
        and method 'placeholder' or similar.
        """
        pipeline = Mock()
        # Pipeline should NOT be called for placeholders
        pipeline.batch_resolve = Mock(return_value=[])

        service = Phase2ResolutionService(resolution_pipeline=pipeline)
        parsed_placeholder = _create_parsed_request(
            target_name="LAST_YEAR_BUNKMATES",
            request_type=RequestType.BUNK_WITH,
        )
        parse_result = _create_parse_result(parsed_requests=[parsed_placeholder])

        results = await service.batch_resolve([parse_result])

        # Should get a result tuple back
        assert len(results) == 1
        _, resolutions = results[0]
        assert len(resolutions) == 1
        # Confidence should be 1.0 (placeholder will be expanded elsewhere)
        assert resolutions[0].confidence == 1.0
        # Method should indicate this is a placeholder
        assert "placeholder" in resolutions[0].method.lower()


class TestResolutionCase:
    """Tests for ResolutionCase helper class"""

    def test_identifies_requests_needing_resolution(self):
        """ResolutionCase identifies which requests need name resolution"""
        parsed_with_name = _create_parsed_request(target_name="Sarah Smith")
        parsed_age_pref = _create_parsed_request(
            target_name=None,
            request_type=RequestType.AGE_PREFERENCE,
            age_preference=AgePreference.OLDER,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_with_name, parsed_age_pref])

        case = ResolutionCase(parse_result)

        assert case.needs_resolution
        assert len(case.requests_needing_resolution) == 1
        # Should be the first request (index 0) that needs resolution
        assert case.requests_needing_resolution[0][0] == 0
        assert case.requests_needing_resolution[0][1] == parsed_with_name

    def test_age_preference_does_not_need_resolution(self):
        """Age preferences don't need name resolution"""
        parsed_age_pref = _create_parsed_request(
            target_name=None,
            request_type=RequestType.AGE_PREFERENCE,
            age_preference=AgePreference.OLDER,  # Any valid preference works for this test
        )
        parse_result = _create_parse_result(parsed_requests=[parsed_age_pref])

        case = ResolutionCase(parse_result)

        assert not case.needs_resolution
        assert len(case.requests_needing_resolution) == 0


class TestStaffNameFiltering:
    """Tests for staff name filtering in Phase2ResolutionService

    V1 Equivalent: resolve_parsed_requests_locally() lines 2167-2171
    Staff names detected from notes should be filtered out before resolution.
    """

    @pytest.mark.asyncio
    async def test_staff_name_filter_skips_staff_targets(self):
        """Requests targeting detected staff names should be skipped."""
        pipeline = Mock()

        # Create a mock resolution for the non-staff camper
        camper_resolution = ResolutionResult(
            person=_create_person(),
            confidence=0.9,
            method="exact",
        )
        pipeline.batch_resolve = Mock(return_value=[camper_resolution])

        # Create filter that returns True for "Jordan"
        def staff_filter(name):
            return name == "Jordan"

        service = Phase2ResolutionService(resolution_pipeline=pipeline, staff_name_filter=staff_filter)

        # Request targeting a staff name
        parsed_staff = _create_parsed_request(target_name="Jordan")
        # Request targeting a camper
        parsed_camper = _create_parsed_request(target_name="Sarah Smith")

        parse_result = _create_parse_result(parsed_requests=[parsed_staff, parsed_camper])

        results = await service.batch_resolve([parse_result])

        assert len(results) == 1
        _, resolutions = results[0]
        assert len(resolutions) == 2

        # Staff target should be marked as filtered
        staff_resolution = resolutions[0]
        assert staff_resolution.method == "staff_filtered"
        assert staff_resolution.confidence == 0.0
        assert not staff_resolution.is_resolved

        # Camper target should have been processed by pipeline
        # (pipeline.batch_resolve was called)
        pipeline.batch_resolve.assert_called()
        # And the camper should have the resolved result
        camper_result = resolutions[1]
        assert camper_result.is_resolved
        assert camper_result.method == "exact"

    @pytest.mark.asyncio
    async def test_staff_filter_none_processes_all(self):
        """When staff_name_filter is None, all requests are processed."""
        pipeline = Mock()
        # Return a real resolution result (not Mock) to avoid attribute issues
        resolution = ResolutionResult(
            person=_create_person(),
            confidence=0.9,
            method="exact",
        )
        pipeline.batch_resolve = Mock(return_value=[resolution])

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            staff_name_filter=None,  # No filter
        )

        parsed = _create_parsed_request(target_name="Jordan")
        parse_result = _create_parse_result(parsed_requests=[parsed])

        await service.batch_resolve([parse_result])

        # Should have processed the request through pipeline
        pipeline.batch_resolve.assert_called()

    @pytest.mark.asyncio
    async def test_staff_filter_stats_tracked(self):
        """Staff filtered requests should be tracked in stats."""
        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        def staff_filter(name):
            return name in ["Mom", "Jordan", "Dad"]

        service = Phase2ResolutionService(resolution_pipeline=pipeline, staff_name_filter=staff_filter)

        # Two staff names
        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request(target_name="Mom"),
                _create_parsed_request(target_name="Jordan"),
            ]
        )

        await service.batch_resolve([parse_result])

        # Stats should track filtered count
        assert service.get_stats().get("staff_filtered", 0) == 2


class TestAICandidateScoringMonolithParity:
    """
    The modular version at phase2_resolution_service.py:772-781 currently has:
    - ✅ Grade proximity scoring
    - ❌ Missing: Session matching (+0.3 same, -0.1 different)
    - ❌ Missing: Age proximity fallback when grades unavailable

    These tests verify those features work correctly.
    """

    def _create_service_with_person_repo(
        self, persons: list[Person] | None = None
    ) -> tuple[Phase2ResolutionService, Mock]:
        """Create a Phase2ResolutionService with a mock person repository."""
        pipeline = Mock()
        person_repo = Mock()

        if persons:
            # Setup find_by_cm_id to return persons from list
            person_map = {p.cm_id: p for p in persons}
            person_repo.find_by_cm_id = Mock(side_effect=lambda cm_id: person_map.get(cm_id))
        else:
            person_repo.find_by_cm_id = Mock(return_value=None)

        # Create service with person_repository
        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )
        return service, person_repo

    def _create_parsed_request_with_candidates(
        self,
        target_name: str = "Jake Smith",
        candidate_ids: list[int] | None = None,
    ) -> ParsedRequest:
        """Create a ParsedRequest with AI-provided candidate IDs."""
        return ParsedRequest(
            raw_text=f"bunk with {target_name}",
            request_type=RequestType.BUNK_WITH,
            target_name=target_name,
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.8,
            csv_position=0,
            metadata={"target_person_ids": candidate_ids or []},
        )

    # --- Session Matching Tests ---

    def test_session_matching_boosts_same_session_candidate(self):
        """Session matching: Same session candidate should get +0.3 boost.

            if self.attendees_cache[candidate_cm_id] == requester_session:
                score += 0.3

        When two candidates have equal grades, the one in the same session
        should win due to +0.3 session boost.
        """
        # Two candidates with same grade
        candidate1 = _create_person(cm_id=111, first_name="Jake", last_name="Smith", grade=5)
        candidate2 = _create_person(cm_id=222, first_name="Jake", last_name="Smithson", grade=5)

        service, person_repo = self._create_service_with_person_repo([candidate1, candidate2])

        # Setup attendee repository to show candidate1 is in same session (1000002)
        attendee_repo = Mock()
        session_map = {111: 1000002, 222: 1000003}  # 111 same session, 222 different
        attendee_repo.get_session_for_person = Mock(side_effect=lambda cm_id, year: session_map.get(cm_id))
        service.attendee_repository = attendee_repo

        parsed = self._create_parsed_request_with_candidates(target_name="Jake Smith", candidate_ids=[111, 222])

        result, _ = service._try_ai_candidate_resolution(
            parsed_request=parsed,
            requester_cm_id=99999,
            requester_grade="5",
            session_cm_id=1000002,  # Requester is in session 1000002
            year=2025,
        )

        assert result is not None, "Should resolve with session matching"
        assert result.is_resolved
        assert result.person is not None, "Resolved result should have a person"
        # Candidate 111 should win because same session (+0.3)
        assert result.person.cm_id == 111, (
            "Same-session candidate (111) should be selected over different-session candidate (222). "
            "V1 parity: session match gives +0.3 boost (monolith line 1865)."
        )

    def test_session_matching_penalizes_different_session(self):
        """Session matching: Different session candidate should get -0.1 penalty.

            else:
                score -= 0.1  # Different session is negative signal

        When a candidate is in a different session, they should get a penalty.
        """
        # One candidate with slightly better grade but different session
        candidate_diff_session = _create_person(cm_id=111, first_name="Jake", last_name="Smith", grade=5)
        # Another candidate with slightly worse grade but same session
        candidate_same_session = _create_person(cm_id=222, first_name="Jake", last_name="Smithson", grade=6)

        service, person_repo = self._create_service_with_person_repo([candidate_diff_session, candidate_same_session])

        # Setup attendee repository
        attendee_repo = Mock()
        session_map = {111: 1000003, 222: 1000002}  # 111 different session, 222 same
        attendee_repo.get_session_for_person = Mock(side_effect=lambda cm_id, year: session_map.get(cm_id))
        service.attendee_repository = attendee_repo

        parsed = self._create_parsed_request_with_candidates(target_name="Jake Smith", candidate_ids=[111, 222])

        result, _ = service._try_ai_candidate_resolution(
            parsed_request=parsed,
            requester_cm_id=99999,
            requester_grade="5",  # Same as candidate 111
            session_cm_id=1000002,  # Requester is in session 1000002
            year=2025,
        )

        assert result is not None, "Should resolve"
        assert result.person is not None, "Resolved result should have a person"
        # Candidate 222 should win because same session (+0.3) despite 1 grade diff (-0.1)
        # Net: 222 has +0.2 advantage from session vs 111's -0.1 penalty
        assert result.person.cm_id == 222, (
            "Same-session candidate (222) should beat different-session candidate (111) "
            "even with 1 grade difference. Session boost (+0.3 vs -0.1) outweighs "
            "grade penalty. V1 parity: monolith lines 1862-1867."
        )

    # --- Age Fallback Tests ---

    def test_age_fallback_when_grades_unavailable(self):
        """Age fallback: When grades are unavailable, use birth dates for proximity.

            # Age proximity (if grade not available)
            if not (candidate_grade and requester_grade):
                # ... calculate age difference ...
                if age_diff_years <= 1:
                    score += 0.15

        When neither requester nor candidate has grade info, age proximity
        should be used as fallback.
        """
        from datetime import datetime

        # Two candidates without grades but with birth dates
        # Candidate 111: 1 year older than requester
        candidate_close_age = _create_person(cm_id=111, first_name="Jake", last_name="Smith", grade=None)
        candidate_close_age.birth_date = datetime(2014, 6, 15)

        # Candidate 222: 4 years older than requester
        candidate_far_age = _create_person(cm_id=222, first_name="Jake", last_name="Smithson", grade=None)
        candidate_far_age.birth_date = datetime(2011, 6, 15)

        service, person_repo = self._create_service_with_person_repo([candidate_close_age, candidate_far_age])

        # Setup person repo to also return requester's birth date
        requester = _create_person(cm_id=99999, first_name="Test", last_name="Requester", grade=None)
        requester.birth_date = datetime(2015, 3, 10)  # Close to candidate_close_age

        def find_by_cm_id(cm_id):
            person_map = {
                111: candidate_close_age,
                222: candidate_far_age,
                99999: requester,
            }
            return person_map.get(cm_id)

        person_repo.find_by_cm_id = Mock(side_effect=find_by_cm_id)

        parsed = self._create_parsed_request_with_candidates(target_name="Jake Smith", candidate_ids=[111, 222])

        result, _ = service._try_ai_candidate_resolution(
            parsed_request=parsed,
            requester_cm_id=99999,
            requester_grade=None,  # No grade available
            session_cm_id=1000002,
            year=2025,
        )

        assert result is not None, "Should resolve using age fallback"
        assert result.is_resolved
        assert result.person is not None, "Resolved result should have a person"
        # Candidate 111 should win because closer age (+0.15) vs far age (-0.15)
        assert result.person.cm_id == 111, (
            "Close-age candidate (111, ~1 year diff) should be selected over "
            "far-age candidate (222, ~4 year diff). V1 parity: age fallback "
            "gives +0.15 for ≤1 year, -0.15 for >3 years (monolith lines 1880-1894)."
        )

    def test_age_fallback_penalty_for_large_age_gap(self):
        """Age fallback: Large age gap (>3 years) should get -0.15 penalty.

        elif age_diff_years > 3:
            score -= 0.15
        """
        from datetime import datetime

        # Two candidates: one with no grade, one with grade
        # Candidate without grade but far age should lose to one with grade
        candidate_no_grade = _create_person(cm_id=111, first_name="Jake", last_name="Smith", grade=None)
        candidate_no_grade.birth_date = datetime(2010, 6, 15)  # 5+ years older

        candidate_with_grade = _create_person(cm_id=222, first_name="Jake", last_name="Smithson", grade=5)
        candidate_with_grade.birth_date = None

        service, person_repo = self._create_service_with_person_repo([candidate_no_grade, candidate_with_grade])

        # Setup requester with birth date
        requester = _create_person(cm_id=99999, first_name="Test", last_name="Requester", grade=None)
        requester.birth_date = datetime(2015, 3, 10)

        def find_by_cm_id(cm_id):
            person_map = {
                111: candidate_no_grade,
                222: candidate_with_grade,
                99999: requester,
            }
            return person_map.get(cm_id)

        person_repo.find_by_cm_id = Mock(side_effect=find_by_cm_id)

        parsed = self._create_parsed_request_with_candidates(target_name="Jake Smith", candidate_ids=[111, 222])

        result, _ = service._try_ai_candidate_resolution(
            parsed_request=parsed,
            requester_cm_id=99999,
            requester_grade="5",  # Has grade, matches candidate 222
            session_cm_id=1000002,
            year=2025,
        )

        assert result is not None, "Should resolve"
        assert result.person is not None, "Resolved result should have a person"
        # Candidate 222 should win: has matching grade (+0.3)
        # Candidate 111 has large age gap penalty (-0.15) and no grade boost
        assert result.person.cm_id == 222, (
            "Candidate with matching grade (222) should beat candidate with "
            "large age gap (111, >3 years). Grade match gives +0.3, "
            "large age gap gives -0.15. V1 parity: monolith lines 1891-1892."
        )

    def test_combined_session_grade_age_scoring(self):
        """Combined scoring: Session + grade + age should all contribute.

        All three factors should combine to produce the final score.
        """
        from datetime import datetime

        # Candidate 1: Different session, same grade, close age
        c1 = _create_person(cm_id=111, first_name="Jake", last_name="A", grade=5)
        c1.birth_date = datetime(2015, 3, 10)

        # Candidate 2: Same session, different grade, far age
        c2 = _create_person(cm_id=222, first_name="Jake", last_name="B", grade=7)
        c2.birth_date = datetime(2011, 6, 15)

        # Candidate 3: Same session, same grade, any age (should win)
        c3 = _create_person(cm_id=333, first_name="Jake", last_name="C", grade=5)
        c3.birth_date = datetime(2015, 1, 1)

        service, person_repo = self._create_service_with_person_repo([c1, c2, c3])

        # Setup attendee repository
        attendee_repo = Mock()
        session_map = {111: 1000003, 222: 1000002, 333: 1000002}
        attendee_repo.get_session_for_person = Mock(side_effect=lambda cm_id, year: session_map.get(cm_id))
        service.attendee_repository = attendee_repo

        # Requester info
        requester = _create_person(cm_id=99999, first_name="Test", last_name="Requester", grade=5)
        requester.birth_date = datetime(2015, 3, 10)

        def find_by_cm_id(cm_id):
            return {111: c1, 222: c2, 333: c3, 99999: requester}.get(cm_id)

        person_repo.find_by_cm_id = Mock(side_effect=find_by_cm_id)

        parsed = self._create_parsed_request_with_candidates(target_name="Jake", candidate_ids=[111, 222, 333])

        result, _ = service._try_ai_candidate_resolution(
            parsed_request=parsed,
            requester_cm_id=99999,
            requester_grade="5",
            session_cm_id=1000002,
            year=2025,
        )

        assert result is not None, "Should resolve"
        assert result.person is not None, "Resolved result should have a person"
        # Candidate 333 should win: same session (+0.3) + same grade (+0.2)
        # C1: different session (-0.1) + same grade (+0.2) = +0.1
        # C2: same session (+0.3) + 2 grades diff (-0.2) = +0.1
        # C3: same session (+0.3) + same grade (+0.2) = +0.5
        assert result.person.cm_id == 333, (
            "Candidate with best combined score (333: same session + same grade) "
            "should win. V1 parity: all factors combine per monolith _score_candidate."
        )


class TestValidateNameMatch:
    """Tests for _validate_name_match method.

    The modular version currently has these gaps:
    1. Missing token subset matching (e.g., "John Smith" → "John Michael Smith")
    2. No middle name/initial handling
    3. No nickname matching for single names

    These tests verify those features work correctly.
    """

    def _create_service(self):
        """Create a Phase2ResolutionService for testing."""
        pipeline = Mock()
        return Phase2ResolutionService(resolution_pipeline=pipeline)

    def _create_mock_person(
        self,
        first_name: str = "John",
        last_name: str = "Smith",
        preferred_name: str = "",
    ) -> Mock:
        """Create a mock person with name attributes."""
        person = Mock()
        person.first_name = first_name
        person.last_name = last_name
        person.preferred_name = preferred_name
        return person

    # --- Existing basic tests (should pass) ---

    def test_exact_full_name_match(self):
        """Exact full name match should return True."""
        service = self._create_service()
        person = self._create_mock_person(first_name="Sarah", last_name="Smith")

        assert service._validate_name_match("Sarah Smith", person) is True

    def test_first_name_only_match(self):
        """First name only should match."""
        service = self._create_service()
        person = self._create_mock_person(first_name="Sarah", last_name="Smith")

        assert service._validate_name_match("Sarah", person) is True

    def test_preferred_name_match(self):
        """Preferred name should match."""
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Elizabeth",
            last_name="Jones",
            preferred_name="Liz",
        )

        assert service._validate_name_match("Liz Jones", person) is True

    # --- GAP 1: Token subset matching ---

    def test_token_subset_match_target_is_subset(self):
        """GAP 1: Token subset matching.

            target_tokens = set(target_full_name.split())
            db_tokens = set(db_full_name.split())
            if target_tokens.issubset(db_tokens):
                return True

        "John Smith" should match "John Michael Smith" because
        {"john", "smith"} ⊆ {"john", "michael", "smith"}
        """
        service = self._create_service()
        # Person has middle name in database
        person = self._create_mock_person(
            first_name="John Michael",  # DB has "John Michael"
            last_name="Smith",
        )

        # Target is subset (no middle name)
        result = service._validate_name_match("John Smith", person)

        assert result is True, (
            "Token subset matching not implemented. "
            "'John Smith' should match 'John Michael Smith' because "
            "{'john', 'smith'} ⊆ {'john', 'michael', 'smith'}. "
            "See monolith lines 2916-2921."
        )

    def test_token_subset_with_preferred_name(self):
        """GAP 1: Token subset with preferred name.

        if db_preferred_full_name:
            db_preferred_tokens = set(db_preferred_full_name.split())
            if target_tokens.issubset(db_preferred_tokens):
                return True
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Elizabeth Ann",
            last_name="Johnson",
            preferred_name="Beth Ann",  # Preferred has middle name
        )

        # Target uses preferred without middle
        result = service._validate_name_match("Beth Johnson", person)

        assert result is True, (
            "Token subset matching with preferred name not implemented. "
            "'Beth Johnson' should match 'Beth Ann Johnson' via preferred_name. "
            "See monolith lines 2924-2928."
        )

    # --- GAP 2: Middle name/initial handling ---

    def test_middle_name_prefix_match(self):
        """GAP 2: Middle name prefix matching.

            # Check if the combined first/middle from target matches start of DB first name
            if first_name_lower.startswith(first_middle_combined):
                return True

        "Olivia Thompson" should match "Olivia Jane Thompson"
        when last names match and DB first name starts with target first.
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Olivia Jane",  # DB has middle name
            last_name="Thompson",
        )

        # Target without middle name
        result = service._validate_name_match("Olivia Thompson", person)

        assert result is True, (
            "Middle name prefix matching not implemented. "
            "'Olivia Thompson' should match 'Olivia Jane Thompson' "
            "because last names match and 'diletta jane'.startswith('diletta'). "
            "See monolith lines 2946-2949."
        )

    def test_target_includes_db_first_name(self):
        """GAP 2: Target includes DB first name.

            # Check if DB first name is a prefix of target first/middle
            if first_middle_combined.startswith(first_name_lower):
                return True

        "Olivia Jane Thompson" should match "Olivia Thompson" in DB
        when target has MORE name parts than DB.
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Olivia",  # DB has just first name
            last_name="Thompson",
        )

        # Target WITH middle name
        result = service._validate_name_match("Olivia Jane Thompson", person)

        assert result is True, (
            "Target includes DB first name matching not implemented. "
            "'Olivia Jane Thompson' should match 'Olivia Thompson' "
            "because 'diletta jane'.startswith('diletta'). "
            "See monolith lines 2951-2954."
        )

    # --- GAP 3: Nickname matching for single names ---

    def test_single_name_nickname_match(self):
        """GAP 3: Single name nickname matching.

            # Check against first name with nicknames
            if self._names_match_with_nicknames(target_single, first_name.split()[0]):
                return True

        "Mike" should match a person with first_name="Michael"
        via nickname group matching.
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Michael",
            last_name="Johnson",
        )

        # Single name that is a nickname
        result = service._validate_name_match("Mike", person)

        assert result is True, (
            "Single name nickname matching not implemented. "
            "'Mike' should match 'Michael' via nickname groups. "
            "See monolith lines 2982-2985."
        )

    def test_single_name_nickname_with_preferred_name(self):
        """GAP 3: Single name nickname with preferred name.

            # Check against preferred name with nicknames
            if preferred_name and self._names_match_with_nicknames(
                target_single, preferred_name.split()[0]
            ):
                return True

        "Liz" should match a person with preferred_name="Elizabeth"
        via nickname group matching.
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Beth",  # Different first name
            last_name="Smith",
            preferred_name="Elizabeth",  # But preferred matches nickname
        )

        # Liz is a nickname for Elizabeth
        result = service._validate_name_match("Liz", person)

        assert result is True, (
            "Single name nickname with preferred name not implemented. "
            "'Liz' should match preferred_name='Elizabeth' via nickname groups. "
            "See monolith lines 2987-2990."
        )

    def test_nickname_with_last_name_anchor(self):
        """GAP 3 + GAP 2: Nickname match when last names match.

            # Check with nicknames for the first name part
            if self._names_match_with_nicknames(first_middle_parts[0], first_name.split()[0]):
                return True

        "Mike Johnson" should match "Michael Johnson" because
        last names match AND first name is a nickname variant.
        """
        service = self._create_service()
        person = self._create_mock_person(
            first_name="Michael",
            last_name="Johnson",
        )

        # Nickname + matching last name
        result = service._validate_name_match("Mike Johnson", person)

        assert result is True, (
            "Nickname with last name anchor not implemented. "
            "'Mike Johnson' should match 'Michael Johnson' because "
            "last names match and 'mike' is a nickname for 'michael'. "
            "See monolith lines 2956-2959."
        )

    def test_non_matching_names_return_false(self):
        """Non-matching names should return False (sanity check)."""
        service = self._create_service()
        person = self._create_mock_person(first_name="Sarah", last_name="Smith")

        assert service._validate_name_match("John Doe", person) is False

    def test_empty_target_returns_false(self):
        """Empty target name should return False."""
        service = self._create_service()
        person = self._create_mock_person()

        assert service._validate_name_match("", person) is False
        assert service._validate_name_match(None, person) is False

    def test_none_person_returns_false(self):
        """None person should return False."""
        service = self._create_service()

        assert service._validate_name_match("John Smith", None) is False

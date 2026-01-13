"""Tests for AI candidate resolution parity with monolith.

1. AI Candidate ID Processing (target_person_ids)
     scores each candidate and picks the best one if score > 0.5

2. AI ID Validation / Hallucination Detection (target_cm_id)
     validates it exists in the cache and that the name matches. If not, it's a
     hallucination and falls through to regular resolution.

3. AI Confidence Boost (+0.15)
     confidence is boosted by 0.15 (capped at 1.0)

These three gaps are tracked in MONOLITH_PARITY_TRACKER.md:
- Line 69: resolve_target_name_with_confidence REMAINING GAPS"""

from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.confidence.confidence_scorer import (
    ConfidenceScorer,
)
from bunking.sync.bunk_request_processor.core.models import (
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
)

# =============================================================================
# Helper Functions
# =============================================================================


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
    grade: int = 5,
    city: str | None = None,
    state: str | None = None,
) -> Person:
    """Helper to create Person objects"""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
        city=city,
        state=state,
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
    metadata: dict[str, Any] | None = None,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}" if target_name else "older campers",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=confidence,
        csv_position=0,
        metadata=metadata if metadata is not None else {},
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


# =============================================================================
# Gap 1: AI Candidate ID Processing (target_person_ids)
# =============================================================================


class TestAICandidateIDProcessing:
    """Tests for AI-provided candidate ID list processing.

    - When metadata contains 'target_person_ids' (a list of candidate CM IDs from AI)
    - Score each candidate using _score_candidate()
    - Pick the best match if score > 0.5
    - Return with moderate confidence (capped at 0.75)

    Current modular gap:
    - openai_provider.py extracts 'target_person_id' (singular) into metadata
    - Nothing in phase2_resolution_service uses this value
    - Multi-candidate disambiguation from AI is completely ignored
    """

    @pytest.mark.asyncio
    async def test_ai_candidate_ids_used_for_disambiguation(self):
        """When AI provides target_person_ids list, the service should use it
        to disambiguate instead of falling back to full resolution.

            if parsed_request.metadata and parsed_request.metadata.get('target_person_ids'):
                candidate_ids = parsed_request.metadata['target_person_ids']
                # ... score each candidate and pick best ...
        """
        # Setup: Two candidates in person cache
        candidate1 = _create_person(cm_id=111, first_name="Sarah", last_name="Smith", grade=5)
        candidate2 = _create_person(cm_id=222, first_name="Sarah", last_name="Smith", grade=8)

        # AI provided both as candidates (from context it received)
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_ids": [111, 222],  # AI narrowed down to these two
            },
        )

        # Pipeline should NOT be called when we have AI candidates
        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        # Person repository for candidate lookup
        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(
            side_effect=lambda cm_id: {
                111: candidate1,
                222: candidate2,
            }.get(cm_id)
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=_create_parse_request(requester_cm_id=11111, requester_grade="5"),
        )

        results = await service.batch_resolve([parse_result])

        # Should resolve using AI candidates, not full pipeline
        _, resolutions = results[0]
        assert len(resolutions) == 1
        assert resolutions[0].is_resolved, (
            "Should resolve using AI-provided candidate IDs. Monolith uses target_person_ids to pick best match."
        )
        # Should pick the candidate with closer grade (candidate1: grade 5)
        assert resolutions[0].person is not None
        assert resolutions[0].person.cm_id == 111, (
            "Should pick candidate with closer grade to requester. "
            "Requester grade 5, candidate1 grade 5, candidate2 grade 8."
        )

        assert resolutions[0].confidence <= 0.75, (
            "Confidence should be capped at 0.75 for AI candidate disambiguation. "
            "Monolith line 1714: return best_match, min(0.75, best_score)"
        )

    @pytest.mark.asyncio
    async def test_ai_candidate_ids_accepts_dict_format(self):
        """AI sometimes returns candidates as dicts with campminder_id field."""
        candidate = _create_person(cm_id=12345, first_name="Sarah", last_name="Smith")

        # AI returned candidate as dict (can happen with some prompts)
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_ids": [
                    {"campminder_id": 12345, "name": "Sarah Smith"},  # Dict format
                ]
            },
        )

        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=candidate)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        results = await service.batch_resolve([parse_result])

        _, resolutions = results[0]
        assert resolutions[0].is_resolved
        assert resolutions[0].person is not None
        assert resolutions[0].person.cm_id == 12345, (
            "Should extract cm_id from dict format. Monolith line 1692: cm_id = candidate.get('campminder_id')"
        )

    @pytest.mark.asyncio
    async def test_ai_candidate_ids_no_valid_candidates_falls_through(self):
        """When AI provides candidate IDs but none are valid (not in cache or low score),
        should fall through to regular resolution.

            else:
                # Couldn't disambiguate - needs manual review
                return None, 0.0
        """
        # AI provided IDs that don't exist in our cache
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_ids": [99999, 88888],  # Non-existent IDs
            },
        )

        pipeline = Mock()
        # Pipeline will be called as fallback
        fallback_person = _create_person(cm_id=12345)
        pipeline.batch_resolve = Mock(
            return_value=[_create_resolution_result(person=fallback_person, confidence=0.9, method="exact")]
        )

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=None)  # IDs not in cache

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        await service.batch_resolve([parse_result])

        # Should fall through to pipeline resolution
        pipeline.batch_resolve.assert_called()


# =============================================================================
# Gap 2: AI ID Validation / Hallucination Detection
# =============================================================================


class TestAIIDValidation:
    """Tests for AI-provided single ID validation and hallucination detection.

    - When ParsedRequest has target_cm_id (AI provided an exact ID)
    - Validate the ID exists in person_cache
    - Validate the name matches using _validate_name_match()
    - If validation fails, log as hallucination and fall through
    - If validation passes, return with high confidence (0.95)

    Current modular gap:
    - No validation of AI-provided IDs
    - No hallucination detection
    - No logging of AI mismatches
    """

    @pytest.mark.asyncio
    async def test_ai_provided_id_validated_and_used(self):
        """When AI provides a valid target_cm_id that matches the name,
        use it directly with high confidence.

            if parsed_request.target_cm_id in self.person_cache:
                person = self.person_cache[parsed_request.target_cm_id]
                if self._validate_name_match(parsed_request.target_name, person):
                    return parsed_request.target_cm_id, 0.95
        """
        ai_provided_person = _create_person(
            cm_id=12345,
            first_name="Sarah",
            last_name="Smith",
        )

        # AI provided the ID in metadata
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_id": 12345,  # AI resolved this
                "match_certainty": "exact",
            },
        )

        parsed_request.target_cm_id = 12345  # type: ignore[attr-defined]

        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])  # Should not be called

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=ai_provided_person)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        results = await service.batch_resolve([parse_result])

        _, resolutions = results[0]
        assert resolutions[0].is_resolved
        assert resolutions[0].person is not None
        assert resolutions[0].person.cm_id == 12345, (
            "Should use AI-provided ID when validated. Monolith returns the ID directly at line 1727."
        )
        # High confidence for validated AI match
        assert resolutions[0].confidence >= 0.95, (
            "Validated AI match should have high confidence (0.95). "
            "Monolith line 1727: return parsed_request.target_cm_id, 0.95"
        )

    @pytest.mark.asyncio
    async def test_ai_hallucination_detected_when_name_mismatch(self):
        """When AI provides an ID but the name doesn't match the person,
        detect as hallucination and fall through to regular resolution.

            # AI provided wrong person - this is a hallucination
            logger.error(f"AI hallucination detected: ...")
            # Fall through to regular resolution
        """
        # AI says "Sarah Smith" is ID 12345, but that ID is "Bob Jones"
        wrong_person = _create_person(
            cm_id=12345,
            first_name="Bob",
            last_name="Jones",
        )

        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",  # AI parsed this name
            metadata={
                "target_person_id": 12345,  # But matched to wrong person
                "match_certainty": "exact",
            },
        )
        parsed_request.target_cm_id = 12345  # type: ignore[attr-defined]

        pipeline = Mock()
        # Should fall through to pipeline after detecting hallucination
        correct_person = _create_person(cm_id=67890, first_name="Sarah", last_name="Smith")
        pipeline.batch_resolve = Mock(
            return_value=[_create_resolution_result(person=correct_person, confidence=0.9, method="exact")]
        )

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=wrong_person)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        await service.batch_resolve([parse_result])

        # Should fall through to pipeline resolution after hallucination detected
        (
            pipeline.batch_resolve.assert_called(),
            ("Should fall through to pipeline after detecting AI hallucination. Monolith falls through at line 1751."),
        )

        # Stats should track the hallucination
        stats = service.get_stats()
        assert stats.get("ai_hallucinations_detected", 0) >= 1, "Should track AI hallucinations in statistics"

    @pytest.mark.asyncio
    async def test_ai_id_not_in_cache_falls_through(self):
        """When AI provides an ID that doesn't exist in our person cache,
        should fall through to regular resolution with a warning.

            else:
                logger.warning(f"AI provided person ID {id} not found in person cache")
        """
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_id": 99999,  # Non-existent ID
            },
        )
        parsed_request.target_cm_id = 99999  # type: ignore[attr-defined]

        pipeline = Mock()
        resolved_person = _create_person(cm_id=12345, first_name="Sarah", last_name="Smith")
        pipeline.batch_resolve = Mock(
            return_value=[_create_resolution_result(person=resolved_person, confidence=0.9, method="exact")]
        )

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=None)  # ID not found

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        await service.batch_resolve([parse_result])

        # Should fall through to pipeline
        pipeline.batch_resolve.assert_called()


# =============================================================================
# Gap 3: AI Confidence Boost (+0.15)
# =============================================================================


class TestAIConfidenceBoost:
    """Tests for AI confidence boost (+0.15).

        # Boost confidence if AI provided a valid person ID
        if ai_provided_id and target_cm_id:
            confidence = min(1.0, confidence + 0.15)  # Boost by 15%

    Current modular gap:
    - No boost applied in confidence_scorer
    - AI-validated matches have lower confidence than they should
    """

    def test_ai_provided_id_boosts_confidence(self):
        """When AI provided a person ID that was validated, confidence
        should be boosted by 0.15 (capped at 1.0).
        """
        person_repo = Mock()
        requester = _create_person(cm_id=1001, first_name="Alice", last_name="Requester", grade=5)
        person_repo.find_by_cm_id = Mock(return_value=requester)

        scorer = ConfidenceScorer(
            config={},
            attendee_repo=None,
            person_repo=person_repo,
        )

        target = _create_person(cm_id=2001, first_name="Sarah", last_name="Smith", grade=5)

        # Create parsed request WITHOUT ai_provided_person_id flag (baseline)
        parsed_request_no_ai = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={},  # No AI flag
        )

        # Create parsed request WITH ai_provided_person_id flag
        parsed_request_with_ai = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "ai_provided_person_id": True,  # AI validated this match
            },
        )

        resolution_result = _create_resolution_result(
            person=target,
            confidence=0.80,
            method="exact_match",
        )

        # Score WITHOUT AI flag (baseline)
        baseline_confidence = scorer.score_resolution(
            parsed_request=parsed_request_no_ai,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Score WITH AI flag
        ai_confidence = scorer.score_resolution(
            parsed_request=parsed_request_with_ai,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # AI confidence should be boosted by 0.15 compared to baseline
        expected_boost = 0.15
        actual_boost = ai_confidence - baseline_confidence
        assert abs(actual_boost - expected_boost) < 0.01, (
            f"AI-provided ID should boost confidence by 0.15. "
            f"Baseline: {baseline_confidence:.3f}, AI: {ai_confidence:.3f}, "
            f"Actual boost: {actual_boost:.3f}, Expected: {expected_boost}. "
            f"Monolith line 1847: confidence = min(1.0, confidence + 0.15)"
        )

    def test_ai_boost_capped_at_1_0(self):
        """Confidence boost should be capped at 1.0."""
        person_repo = Mock()
        requester = _create_person(cm_id=1001, first_name="Alice", last_name="Requester")
        person_repo.find_by_cm_id = Mock(return_value=requester)

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = _create_person(cm_id=2001, first_name="Sarah", last_name="Smith")

        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "ai_provided_person_id": True,
            },
        )

        resolution_result = _create_resolution_result(
            person=target,
            confidence=0.95,  # High base confidence
            method="exact_match",
        )

        final_confidence = scorer.score_resolution(
            parsed_request=parsed_request,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Should be capped at 1.0
        assert final_confidence <= 1.0, (
            f"Confidence should be capped at 1.0. Got: {final_confidence}. "
            f"Monolith line 1847: min(1.0, confidence + 0.15)"
        )

    def test_no_boost_without_ai_flag(self):
        """Without ai_provided_person_id flag, no boost should be applied."""
        person_repo = Mock()
        requester = _create_person(cm_id=1001, first_name="Alice", last_name="Requester")
        person_repo.find_by_cm_id = Mock(return_value=requester)

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = _create_person(cm_id=2001, first_name="Sarah", last_name="Smith")

        # NO ai_provided_person_id flag
        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={},  # Empty - no AI flag
        )

        resolution_result = _create_resolution_result(
            person=target,
            confidence=0.80,
            method="exact_match",
        )

        final_confidence = scorer.score_resolution(
            parsed_request=parsed_request,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Should NOT be boosted
        assert final_confidence < 0.95, (
            f"Without AI flag, confidence should NOT be boosted. Base: 0.80, Got: {final_confidence}"
        )

    def test_no_boost_when_unresolved(self):
        """Even with AI flag, no boost when target wasn't resolved.

        Both conditions must be true for boost.
        """
        scorer = ConfidenceScorer(config={})

        # Create parsed request WITHOUT AI flag (baseline for unresolved)
        parsed_request_no_ai = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={},
        )

        # Create parsed request WITH AI flag
        parsed_request_with_ai = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "ai_provided_person_id": True,
            },
        )

        # Unresolved - no person
        resolution_result = _create_resolution_result(
            person=None,
            confidence=0.0,
            method="failed",
        )

        # Score WITHOUT AI flag
        baseline_confidence = scorer.score_resolution(
            parsed_request=parsed_request_no_ai,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Score WITH AI flag
        ai_confidence = scorer.score_resolution(
            parsed_request=parsed_request_with_ai,
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Should NOT be boosted (no target resolved)
        # Both scores should be the same - no boost for unresolved
        assert abs(ai_confidence - baseline_confidence) < 0.01, (
            f"Unresolved requests should NOT get AI boost. "
            f"Baseline: {baseline_confidence:.3f}, AI: {ai_confidence:.3f}, "
            f"Difference: {abs(ai_confidence - baseline_confidence):.3f}"
        )


# =============================================================================
# Integration: All Three Gaps Working Together
# =============================================================================


class TestAIResolutionIntegration:
    """Integration tests verifying all three AI resolution features work together."""

    @pytest.mark.asyncio
    async def test_full_ai_resolution_flow(self):
        """Test the complete flow:
        1. AI provides candidate IDs
        2. Service picks best candidate (grade-based scoring)
        3. Result has ai_provided_person_id flag for confidence boost

        Note: AI-resolved requests are resolved BEFORE batch resolution,
        so they get their confidence directly from the AI resolution,
        not from the confidence_scorer. The ai_provided_person_id flag
        in metadata enables the boost when scoring happens later.
        """
        candidate1 = _create_person(cm_id=111, first_name="Sarah", last_name="Smith", grade=5)
        candidate2 = _create_person(cm_id=222, first_name="Sarah", last_name="Smith", grade=8)

        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_ids": [111, 222],
            },
        )

        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(
            side_effect=lambda cm_id: {
                111: candidate1,
                222: candidate2,
            }.get(cm_id)
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=_create_parse_request(requester_cm_id=11111, requester_grade="5"),
        )

        results = await service.batch_resolve([parse_result])

        _, resolutions = results[0]
        # Should be resolved via AI candidates
        assert resolutions[0].is_resolved, "Should resolve using AI candidate IDs"
        # Should pick candidate with matching grade (candidate1, grade 5)
        assert resolutions[0].person is not None
        assert resolutions[0].person.cm_id == 111, "Should pick candidate1 (grade 5) for requester grade 5"
        # Should have AI flag for confidence boost
        assert resolutions[0].metadata is not None
        assert resolutions[0].metadata.get("ai_provided_person_id"), (
            "Resolution should have ai_provided_person_id flag for confidence boost"
        )

        assert resolutions[0].confidence <= 0.75, (
            f"AI candidate confidence should be capped at 0.75, got {resolutions[0].confidence}"
        )
        # Pipeline should NOT have been called (AI resolved before batch)
        pipeline.batch_resolve.assert_not_called()

    @pytest.mark.asyncio
    async def test_stats_track_ai_resolution_metrics(self):
        """Service should track AI-specific resolution metrics."""
        candidate = _create_person(cm_id=111, first_name="Sarah", last_name="Smith")

        parsed_request = _create_parsed_request(
            target_name="Sarah Smith",
            metadata={
                "target_person_ids": [111],
            },
        )

        pipeline = Mock()
        pipeline.batch_resolve = Mock(return_value=[])

        person_repo = Mock()
        person_repo.find_by_cm_id = Mock(return_value=candidate)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
        )

        parse_result = _create_parse_result(parsed_requests=[parsed_request])
        await service.batch_resolve([parse_result])

        stats = service.get_stats()
        # Should track AI-related resolutions
        assert "ai_candidate_resolved" in stats or "ai_resolved" in stats, "Stats should track AI-assisted resolutions"

"""Tests for ConfidenceScorer grade and age proximity calculation.

These tests verify that grade_proximity and age_proximity signals are
correctly populated when building confidence signals from resolution results."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.confidence.confidence_scorer import (
    ConfidenceScorer,
)
from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def make_parsed_request(target_name: str = "Bob Jones") -> ParsedRequest:
    """Create a minimal ParsedRequest for testing."""
    return ParsedRequest(
        raw_text=target_name,
        request_type=RequestType.BUNK_WITH,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


class TestGradeProximityCalculation:
    """Test grade_proximity signal is correctly calculated."""

    def test_grade_proximity_both_have_grades(self):
        """When both requester and target have grades, calculate abs difference."""
        # Create mock person repository
        person_repo = Mock()
        requester = Person(
            cm_id=1001,
            first_name="Alice",
            last_name="Smith",
            grade=5,
        )
        person_repo.find_by_cm_id.return_value = requester

        # Create scorer with person_repo
        scorer = ConfidenceScorer(
            config={},
            attendee_repo=None,
            person_repo=person_repo,
        )

        # Create target person (grade 7)
        target = Person(
            cm_id=2001,
            first_name="Bob",
            last_name="Jones",
            grade=7,
        )

        # Create resolution result with target
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        # Build signals
        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Grade proximity should be abs(5 - 7) = 2
        assert signals.grade_proximity == 2

    def test_grade_proximity_same_grade(self):
        """When both have same grade, proximity should be 0."""
        person_repo = Mock()
        requester = Person(cm_id=1001, first_name="Alice", last_name="Smith", grade=6)
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones", grade=6)
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        assert signals.grade_proximity == 0

    def test_grade_proximity_requester_missing_grade(self):
        """When requester has no grade, proximity should remain 999."""
        person_repo = Mock()
        requester = Person(cm_id=1001, first_name="Alice", last_name="Smith", grade=None)
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones", grade=6)
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        assert signals.grade_proximity == 999

    def test_grade_proximity_target_missing_grade(self):
        """When target has no grade, proximity should remain 999."""
        person_repo = Mock()
        requester = Person(cm_id=1001, first_name="Alice", last_name="Smith", grade=5)
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones", grade=None)
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        assert signals.grade_proximity == 999


class TestAgeProximityCalculation:
    """Test age_proximity signal is correctly calculated."""

    def test_age_proximity_both_have_birthdates(self):
        """When both have birth dates, calculate age difference in years."""
        person_repo = Mock()
        # Alice born Jan 2015 (will be ~10 years old)
        requester = Person(
            cm_id=1001,
            first_name="Alice",
            last_name="Smith",
            birth_date=datetime(2015, 1, 15),
        )
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        # Bob born Jan 2013 (will be ~12 years old, 2 years older)
        target = Person(
            cm_id=2001,
            first_name="Bob",
            last_name="Jones",
            birth_date=datetime(2013, 1, 15),
        )
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Age difference should be approximately 2 years
        assert 1.9 <= signals.age_proximity <= 2.1

    def test_age_proximity_same_age(self):
        """When both have same birth date, proximity should be 0."""
        person_repo = Mock()
        birth_date = datetime(2014, 6, 15)
        requester = Person(
            cm_id=1001,
            first_name="Alice",
            last_name="Smith",
            birth_date=birth_date,
        )
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = Person(
            cm_id=2001,
            first_name="Bob",
            last_name="Jones",
            birth_date=birth_date,
        )
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        assert signals.age_proximity == 0.0

    def test_age_proximity_requester_missing_birthdate(self):
        """When requester has no birth date, proximity should remain 999.0."""
        person_repo = Mock()
        requester = Person(
            cm_id=1001,
            first_name="Alice",
            last_name="Smith",
            birth_date=None,
        )
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        target = Person(
            cm_id=2001,
            first_name="Bob",
            last_name="Jones",
            birth_date=datetime(2014, 6, 15),
        )
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        assert signals.age_proximity == 999.0

    def test_age_proximity_no_person_repo(self):
        """When no person_repo provided, proximity should remain 999.0."""
        scorer = ConfidenceScorer(config={}, person_repo=None)

        target = Person(
            cm_id=2001,
            first_name="Bob",
            last_name="Jones",
            birth_date=datetime(2014, 6, 15),
            grade=6,
        )
        resolution_result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request(),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # Without person_repo, can't look up requester, so defaults remain
        assert signals.grade_proximity == 999
        assert signals.age_proximity == 999.0


class TestUnresolvedRequests:
    """Test proximity signals for unresolved requests."""

    def test_unresolved_request_keeps_defaults(self):
        """When resolution has no person, proximity signals stay at defaults."""
        person_repo = Mock()
        requester = Person(
            cm_id=1001,
            first_name="Alice",
            last_name="Smith",
            grade=5,
            birth_date=datetime(2014, 6, 15),
        )
        person_repo.find_by_cm_id.return_value = requester

        scorer = ConfidenceScorer(config={}, person_repo=person_repo)

        # Unresolved - no person in result
        resolution_result = ResolutionResult(
            person=None,
            confidence=0.0,
            method="none",
        )

        signals = scorer._build_signals_from_resolution(
            parsed_request=make_parsed_request("Unknown Person"),
            resolution_result=resolution_result,
            requester_cm_id=1001,
            year=2025,
        )

        # No target person, so can't calculate proximity
        assert signals.grade_proximity == 999
        assert signals.age_proximity == 999.0


class TestLastScoreFactors:
    """Tests for confidence_factors breakdown tracking."""

    def test_bunk_with_populates_factors(self):
        """score_resolution for BUNK_WITH populates last_score_factors with breakdown."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        parsed_req = ParsedRequest(
            raw_text="Bob Jones",
            request_type=RequestType.BUNK_WITH,
            target_name="Bob Jones",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones")
        resolution_result = ResolutionResult(person=target, confidence=0.95, method="exact_match")

        scorer.score_resolution(parsed_req, resolution_result, requester_cm_id=1001, year=2026)

        factors = scorer.last_score_factors
        assert factors["formula"] == "bunk_with"
        assert "name_score" in factors
        assert "ai_score" in factors
        assert "context_score" in factors
        assert "weights" in factors
        assert "weighted_total" in factors
        assert isinstance(factors["weighted_total"], float)

    def test_not_bunk_with_populates_factors(self):
        """score_resolution for NOT_BUNK_WITH populates last_score_factors."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        parsed_req = ParsedRequest(
            raw_text="Bob Jones",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Bob Jones",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones")
        resolution_result = ResolutionResult(person=target, confidence=0.95, method="exact_match")

        scorer.score_resolution(parsed_req, resolution_result, requester_cm_id=1001, year=2026)

        factors = scorer.last_score_factors
        assert factors["formula"] == "not_bunk_with"
        assert "name_score" in factors
        assert "ai_score" in factors
        assert "context_score" in factors

    def test_age_preference_populates_factors(self):
        """score_parsed_request for AGE_PREFERENCE populates last_score_factors."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        parsed_req = ParsedRequest(
            raw_text="older kids",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=None,
            source_field="socialize_with",
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )

        scorer.score_parsed_request(parsed_req)

        factors = scorer.last_score_factors
        assert factors["formula"] == "age_preference"
        assert factors["ai_parse_confidence"] == 1.0

    def test_second_call_overwrites_factors(self):
        """Calling score_resolution twice replaces previous factors."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        bunk_req = ParsedRequest(
            raw_text="Bob",
            request_type=RequestType.BUNK_WITH,
            target_name="Bob",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )
        not_bunk_req = ParsedRequest(
            raw_text="Bob",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Bob",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        target = Person(cm_id=2001, first_name="Bob", last_name="Jones")
        res = ResolutionResult(person=target, confidence=0.95, method="exact_match")

        scorer.score_resolution(bunk_req, res, 1001, 2026)
        assert scorer.last_score_factors["formula"] == "bunk_with"

        scorer.score_resolution(not_bunk_req, res, 1001, 2026)
        assert scorer.last_score_factors["formula"] == "not_bunk_with"

    def test_last_score_factors_returns_copy(self):
        """last_score_factors returns a copy, not a reference to internal state."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        parsed_req = ParsedRequest(
            raw_text="Bob",
            request_type=RequestType.BUNK_WITH,
            target_name="Bob",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )
        target = Person(cm_id=2001, first_name="Bob", last_name="Jones")
        res = ResolutionResult(person=target, confidence=0.95, method="exact_match")

        scorer.score_resolution(parsed_req, res, 1001, 2026)
        factors1 = scorer.last_score_factors
        factors2 = scorer.last_score_factors
        assert factors1 is not factors2


class TestConfidenceFactorsOnMetadata:
    """Tests that confidence_factors are captured on result metadata immediately after scoring.

    This prevents the staleness bug where reading scorer.last_score_factors later
    in a batch loop gives every request the same (wrong) factors from the last scored request.
    """

    def test_phase2_style_capture_preserves_per_request_factors(self):
        """Scoring two requests and capturing factors immediately gives each its own breakdown."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        req_bunk = ParsedRequest(
            raw_text="Alice Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Alice Smith",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )
        req_not_bunk = ParsedRequest(
            raw_text="Bob Jones",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Bob Jones",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.90,
            csv_position=1,
            metadata={},
        )

        target_a = Person(cm_id=2001, first_name="Alice", last_name="Smith")
        result_a = ResolutionResult(person=target_a, confidence=0.95, method="exact_match")

        target_b = Person(cm_id=2002, first_name="Bob", last_name="Jones")
        result_b = ResolutionResult(person=target_b, confidence=0.90, method="fuzzy_match")

        # Score first request and capture immediately (simulating the fix)
        scorer.score_resolution(req_bunk, result_a, requester_cm_id=1001, year=2026)
        assert result_a.metadata is not None
        result_a.metadata["confidence_factors"] = scorer.last_score_factors

        # Score second request and capture immediately
        scorer.score_resolution(req_not_bunk, result_b, requester_cm_id=1001, year=2026)
        assert result_b.metadata is not None
        result_b.metadata["confidence_factors"] = scorer.last_score_factors

        # Each result has its OWN factors, not the last-scored request's
        assert result_a.metadata["confidence_factors"]["formula"] == "bunk_with"
        assert result_b.metadata["confidence_factors"]["formula"] == "not_bunk_with"

        # Without immediate capture, both would have "not_bunk_with" (the last scored)
        assert scorer.last_score_factors["formula"] == "not_bunk_with"

    def test_stale_read_gives_wrong_factors(self):
        """Demonstrates the bug: reading last_score_factors after all scoring gives wrong results."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        req_bunk = ParsedRequest(
            raw_text="Alice Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Alice Smith",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )
        req_not_bunk = ParsedRequest(
            raw_text="Bob Jones",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Bob Jones",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.90,
            csv_position=1,
            metadata={},
        )

        target_a = Person(cm_id=2001, first_name="Alice", last_name="Smith")
        result_a = ResolutionResult(person=target_a, confidence=0.95, method="exact_match")

        target_b = Person(cm_id=2002, first_name="Bob", last_name="Jones")
        result_b = ResolutionResult(person=target_b, confidence=0.90, method="fuzzy_match")

        # Score both FIRST (like Phase 2 does), then read factors LATER (like the bug)
        scorer.score_resolution(req_bunk, result_a, requester_cm_id=1001, year=2026)
        scorer.score_resolution(req_not_bunk, result_b, requester_cm_id=1001, year=2026)

        # Reading now gives the LAST scored request's factors for both — this is the bug
        stale_factors = scorer.last_score_factors
        assert stale_factors["formula"] == "not_bunk_with"  # Always the last one
        assert stale_factors["formula"] != "bunk_with"  # First request's factors are lost

    def test_ai_boost_updates_weighted_total(self):
        """When ai_boost is applied, weighted_total reflects the boosted score."""
        scorer = ConfidenceScorer(config={}, attendee_repo=None, person_repo=None)

        parsed_req = ParsedRequest(
            raw_text="Alice Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Alice Smith",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={"ai_provided_person_id": True},
        )

        target = Person(cm_id=2001, first_name="Alice", last_name="Smith")
        result = ResolutionResult(
            person=target,
            confidence=0.95,
            method="exact_match",
        )

        returned_score = scorer.score_resolution(parsed_req, result, requester_cm_id=1001, year=2026)
        factors = scorer.last_score_factors

        # weighted_total must match the actual returned score (including ai_boost)
        assert factors["weighted_total"] == round(returned_score, 4)
        assert "ai_boost" in factors

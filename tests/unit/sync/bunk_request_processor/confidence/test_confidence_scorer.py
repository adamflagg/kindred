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

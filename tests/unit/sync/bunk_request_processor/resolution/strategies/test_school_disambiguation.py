"""Test-Driven Development for SchoolDisambiguationStrategy

Tests the school-based disambiguation strategy."""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.school_disambiguation import (
    SchoolDisambiguationStrategy,
)


class TestSchoolDisambiguationStrategy:
    """Test the SchoolDisambiguationStrategy name resolution"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        # Set default return values
        mock_person_repo.find_by_name.return_value = []
        mock_person_repo.find_by_cm_id.return_value = None
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a SchoolDisambiguationStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        return SchoolDisambiguationStrategy(person_repo, attendee_repo)

    def test_school_name_normalization(self, strategy):
        """Test school name normalization with abbreviations."""
        # Common abbreviations
        assert strategy._normalize_school_name("Lincoln Middle School") == "lincoln ms"
        assert strategy._normalize_school_name("Lincoln MS") == "lincoln ms"
        assert strategy._normalize_school_name("P.S. 123") == "ps 123"
        assert strategy._normalize_school_name("Public School 123") == "ps 123"
        assert strategy._normalize_school_name("Washington Elementary School") == "washington es"
        assert strategy._normalize_school_name("Washington ES") == "washington es"
        assert strategy._normalize_school_name("Roosevelt High School") == "roosevelt hs"
        assert strategy._normalize_school_name("Saint Mary's Academy") == "st marys acad"
        assert strategy._normalize_school_name("St. Mary's Academy") == "st marys acad"

    def test_schools_match(self, strategy):
        """Test school matching logic with abbreviation normalization and location.

        Matching rules:
        - School name: Fuzzy (normalized abbreviations + containment)
        - City: Case-insensitive exact match
        - State: Case-insensitive exact match
        """
        # Abbreviation matches
        assert strategy._schools_match("Lincoln Middle School", "Lincoln MS")
        assert strategy._schools_match("P.S. 123", "PS 123")
        assert strategy._schools_match("Washington Elementary", "Washington Elementary School")
        assert strategy._schools_match("Roosevelt High School", "Roosevelt HS")
        assert strategy._schools_match("Saint Mary's Academy", "St. Mary's Acad")

        # Contained matches
        assert strategy._schools_match("Lincoln", "Lincoln Middle School")
        assert strategy._schools_match("Roosevelt High", "Roosevelt")

        # Non-matches (different names)
        assert not strategy._schools_match("Lincoln", "Washington")
        assert not strategy._schools_match("PS 123", "PS 456")

        # With location matching - same school, same city/state
        assert strategy._schools_match(
            candidate_school="Lincoln Elementary",
            requester_school="Lincoln Elementary",
            candidate_city="Oakland",
            requester_city="Oakland",
            candidate_state="CA",
            requester_state="CA",
        )

        # With location matching - same school, different city/state
        assert not strategy._schools_match(
            candidate_school="Lincoln Elementary",
            requester_school="Lincoln Elementary",
            candidate_city="Denver",
            requester_city="Oakland",
            candidate_state="CO",
            requester_state="CA",
        )

        # Missing location on one side - falls back to school-only
        assert strategy._schools_match(
            candidate_school="Lincoln Elementary",
            requester_school="Lincoln Elementary",
            candidate_city=None,
            requester_city="Oakland",
            candidate_state=None,
            requester_state="CA",
        )

    def test_single_candidate(self, strategy, mock_repositories):
        """Test when only one candidate exists"""
        person_repo, _ = mock_repositories

        # Single candidate
        person = Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS")
        person_repo.find_by_name.return_value = [person]

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.90
        assert result.metadata["match_type"] == "single_exact_match"

    def test_same_school_disambiguation(self, strategy, mock_repositories):
        """Test successful disambiguation using same school"""
        person_repo, _ = mock_repositories

        # Multiple candidates with different grades
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS", grade=8),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Washington MS", grade=7),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester from Lincoln with same grade as candidate 12345
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school="Lincoln Middle School", grade=8)
        person_repo.find_by_cm_id.return_value = requester

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.85
        assert result.metadata["match_type"] == "same_school_same_grade"

    def test_multiple_same_school_ambiguous(self, strategy, mock_repositories):
        """Test when multiple candidates from same school with equidistant grades"""
        person_repo, _ = mock_repositories

        # Multiple candidates from same school, both same distance from requester
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS", grade=7),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Lincoln MS", grade=5),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester from Lincoln in grade 6 (equidistant from both)
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school="Lincoln Middle School", grade=6)
        person_repo.find_by_cm_id.return_value = requester

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        # Should remain ambiguous when grades are equidistant
        assert not result.is_resolved
        assert result.is_ambiguous
        assert len(result.candidates) == 2
        assert result.confidence == 0.5
        assert result.metadata["ambiguity_reason"] == "multiple_same_school_matches"

    def test_grade_disambiguation(self, strategy, mock_repositories):
        """Test disambiguation using grade level"""
        person_repo, _ = mock_repositories

        # Multiple candidates from same school, different grades
        # Only grade 8 is within 1 grade of requester (grade 7)
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS", grade=8),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Lincoln MS", grade=5),
            Person(cm_id=11111, first_name="John", last_name="Smith", school="Lincoln MS", grade=4),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester in grade 7 (only close to grade 8)
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school="Lincoln Middle School", grade=7)
        person_repo.find_by_cm_id.return_value = requester

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345  # Grade 8, only one within 1 grade
        assert result.confidence == 0.70  # Actual value from implementation
        assert result.metadata["match_type"] == "same_school_close_grade"
        assert result.metadata["grade_diff"] == 1

    def test_exact_grade_match(self, strategy, mock_repositories):
        """Test exact grade match preference"""
        person_repo, _ = mock_repositories

        # Multiple candidates, one with exact grade match
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS", grade=8),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Lincoln MS", grade=7),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester in grade 7
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school="Lincoln MS", grade=7)
        person_repo.find_by_cm_id.return_value = requester

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 67890  # Exact grade match
        assert result.confidence == 0.85
        assert result.metadata["match_type"] == "same_school_same_grade"

    def test_no_requester_school(self, strategy, mock_repositories):
        """Test when requester has no school info"""
        person_repo, _ = mock_repositories

        # Multiple candidates
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS"),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Washington MS"),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester without school
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school=None)
        person_repo.find_by_cm_id.return_value = requester

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.is_ambiguous
        assert result.confidence == 0.0  # Actual value from implementation
        assert result.metadata["ambiguity_reason"] == "no_requester_school"

    def test_session_fallback(self, strategy, mock_repositories):
        """Test session-based disambiguation when school doesn't match.

        Note: This strategy is school-based. If requester's school doesn't
        match any candidates, it returns no_same_school_matches.
        Session fallback is handled by the resolution pipeline, not this strategy.
        """
        person_repo, attendee_repo = mock_repositories

        # Candidates from different schools with grades
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln MS", grade=8),
            Person(cm_id=67890, first_name="John", last_name="Smith", school="Washington MS", grade=8),
        ]
        person_repo.find_by_name.return_value = candidates

        # Requester from different school (doesn't match either candidate)
        requester = Person(cm_id=99999, first_name="Jane", last_name="Doe", school="Roosevelt MS")
        person_repo.find_by_cm_id.return_value = requester

        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002, 67890: 1000003}

        result = strategy.resolve("John Smith", requester_cm_id=99999, session_cm_id=1000002, year=2025)

        # No school match, so strategy returns ambiguous (not session-based match)
        assert not result.is_resolved
        assert result.is_ambiguous
        assert result.metadata["ambiguity_reason"] == "no_same_school_matches"

    def test_no_matches_found(self, strategy, mock_repositories):
        """Test when no candidates found"""
        person_repo, _ = mock_repositories
        person_repo.find_by_name.return_value = []

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.metadata["reason"] == "no_matches"

    def test_insufficient_name_parts(self, strategy):
        """Test with single name"""
        result = strategy.resolve("John", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.metadata["reason"] == "incomplete_name"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

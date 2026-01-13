"""Test fuzzy match strategy with relationship analyzer integration.

Tests that fuzzy matching properly uses relationship analysis to boost confidence."""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.analysis import RelationshipAnalyzer, RelationshipContext
from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.fuzzy_match import FuzzyMatchStrategy


class TestFuzzyMatchWithRelationships:
    """Test FuzzyMatchStrategy with RelationshipAnalyzer integration"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        # Set defaults
        mock_attendee_repo.get_by_person_and_year.return_value = None
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        mock_person_repo.find_by_normalized_name.return_value = []
        mock_person_repo.find_by_first_name.return_value = []
        mock_person_repo.find_by_first_and_parent_surname.return_value = []
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def mock_relationship_analyzer(self):
        """Create mock relationship analyzer"""
        return Mock(spec=RelationshipAnalyzer)

    @pytest.fixture
    def strategy(self, mock_repositories, mock_relationship_analyzer):
        """Create strategy with relationship analyzer"""
        person_repo, attendee_repo = mock_repositories
        return FuzzyMatchStrategy(person_repo, attendee_repo, mock_relationship_analyzer)

    def test_confidence_boost_with_relationship(self, strategy, mock_repositories, mock_relationship_analyzer):
        """Test that relationships boost confidence in fuzzy matches"""
        person_repo, attendee_repo = mock_repositories

        # Set up a nickname match scenario
        michael = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        person_repo.find_by_name.side_effect = lambda first, last, year=None: (
            [michael] if first == "Michael" and last == "Smith" else []
        )

        # Mock session verification
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        # Mock relationship analysis - they're siblings
        mock_context = Mock(spec=RelationshipContext)
        mock_relationship_analyzer.analyze_relationships.return_value = mock_context
        mock_relationship_analyzer.get_confidence_boost.return_value = 0.25  # Sibling boost

        # Resolve "Mike Smith" with requester who is Michael's sibling
        result = strategy.resolve(name="Mike Smith", requester_cm_id=99999, session_cm_id=1000002, year=2024)

        # Should match Michael with boosted confidence
        assert result.is_resolved
        assert result.person.cm_id == 12345
        # Base nickname confidence (0.85) + sibling boost (0.25) = 1.1, capped at 0.95
        assert result.confidence == 0.95
        assert result.metadata["match_type"] == "nickname"

        # Verify relationship analyzer was called
        mock_relationship_analyzer.analyze_relationships.assert_called_once()
        mock_relationship_analyzer.get_confidence_boost.assert_called_once()

    def test_disambiguation_with_relationships(self, strategy, mock_repositories, mock_relationship_analyzer):
        """Test disambiguating multiple matches using relationships"""
        person_repo, attendee_repo = mock_repositories

        # Two people with same name
        john1 = Person(cm_id=100, first_name="John", last_name="Smith")
        john2 = Person(cm_id=200, first_name="John", last_name="Smith")

        # find_by_name returns empty (no direct nickname matches)
        person_repo.find_by_name.return_value = []

        # Normalized search returns both
        person_repo.find_by_normalized_name.return_value = [john1, john2]

        # Both in same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {100: 1000002, 200: 1000002}

        # Mock relationship analysis
        mock_context = Mock(spec=RelationshipContext)
        mock_relationship_analyzer.analyze_relationships.return_value = mock_context

        # John1 is a classmate (0.10 boost), John2 has no relationship (0.0 boost)
        def mock_boost(context, cm_id):
            return 0.10 if cm_id == 100 else 0.0

        mock_relationship_analyzer.get_confidence_boost.side_effect = mock_boost
        mock_relationship_analyzer.describe_relationship.return_value = "Direct relationship: classmate"

        # Resolve
        result = strategy.resolve(name="John Smith", requester_cm_id=99999, session_cm_id=1000002, year=2024)

        # Should pick John1 due to relationship
        assert result.is_resolved
        assert result.person.cm_id == 100
        assert result.confidence == pytest.approx(0.80, rel=1e-3)  # 0.70 base + 0.10 classmate boost
        assert result.metadata["relationship_boost"] == 0.10
        assert "classmate" in result.metadata["relationship_info"]

    def test_no_relationship_analyzer_fallback(self, mock_repositories):
        """Test that strategy works without relationship analyzer"""
        person_repo, attendee_repo = mock_repositories

        # Create strategy without relationship analyzer
        strategy = FuzzyMatchStrategy(person_repo, attendee_repo, relationship_analyzer=None)

        # Set up a nickname match
        michael = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        person_repo.find_by_name.side_effect = lambda first, last, year=None: (
            [michael] if first == "Michael" and last == "Smith" else []
        )

        # Mock session verification
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        # Resolve
        result = strategy.resolve(name="Mike Smith", requester_cm_id=99999, session_cm_id=1000002, year=2024)

        # Should still work but without relationship boost
        assert result.is_resolved
        assert result.person is not None
        assert result.person.cm_id == 12345
        assert result.confidence == 0.85  # Just base nickname confidence

    def test_relationship_boost_caps_at_95(self, strategy, mock_repositories, mock_relationship_analyzer):
        """Test that confidence is capped at 0.95 even with high relationship boost"""
        person_repo, attendee_repo = mock_repositories

        # High confidence spelling variation match
        sarah = Person(cm_id=12345, first_name="Sarah", last_name="Johnson")
        person_repo.find_by_name.side_effect = lambda first, last, year=None: (
            [sarah] if first == "Sarah" and last == "Johnson" else []
        )

        # Same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        # Mock very high relationship boost
        mock_context = Mock(spec=RelationshipContext)
        mock_relationship_analyzer.analyze_relationships.return_value = mock_context
        mock_relationship_analyzer.get_confidence_boost.return_value = 0.30  # Max possible boost

        # Resolve Sara -> Sarah (spelling variation)
        result = strategy.resolve(name="Sara Johnson", requester_cm_id=99999, session_cm_id=1000002, year=2024)

        # Should cap at 0.95
        assert result.is_resolved
        assert result.confidence == 0.95  # Capped, not 1.15

    def test_no_boost_for_different_session(self, strategy, mock_repositories, mock_relationship_analyzer):
        """Test that relationship boost only applies within same session"""
        person_repo, attendee_repo = mock_repositories

        # Nickname match
        michael = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        person_repo.find_by_name.side_effect = lambda first, last, year=None: (
            [michael] if first == "Michael" and last == "Smith" else []
        )

        # Different session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 9999999}  # Different

        # Mock relationship analyzer to return 0 boost (should still be called)
        mock_context = Mock(spec=RelationshipContext)
        mock_relationship_analyzer.analyze_relationships.return_value = mock_context
        mock_relationship_analyzer.get_confidence_boost.return_value = 0.0  # No boost

        # Resolve
        result = strategy.resolve(name="Mike Smith", requester_cm_id=99999, session_cm_id=1000002, year=2024)

        # Should match but with reduced confidence for different session
        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.75  # 0.85 base - 0.10 for different session, no relationship boost

        # Relationship analyzer should have been called (we always check relationships when session is provided)
        mock_relationship_analyzer.analyze_relationships.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

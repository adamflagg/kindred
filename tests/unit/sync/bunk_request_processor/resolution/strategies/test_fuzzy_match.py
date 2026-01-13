"""Test-Driven Development for FuzzyMatchStrategy

Tests the fuzzy name matching resolution strategy."""

import json
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.fuzzy_match import FuzzyMatchStrategy


class TestFuzzyMatchStrategy:
    """Test the FuzzyMatchStrategy implementation"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a FuzzyMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        # Mock attendee repo to return None by default
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        # Mock person repo searches to return empty by default
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_first_name.return_value = []
        # Mock parent surname search to return empty by default
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        return FuzzyMatchStrategy(person_repo, attendee_repo)

    def test_nickname_match(self, strategy, mock_repositories):
        """Test matching nicknames to full names"""
        person_repo, _ = mock_repositories

        # Mike should match Michael
        michael = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        # Set up mock to handle multiple calls
        person_repo.find_by_name.return_value = []  # Default to empty

        # Mock to return Michael when searching for "Michael Smith"
        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "michael" and last.lower() == "smith":
                return [michael]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        result = strategy.resolve("Mike Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == pytest.approx(0.80)  # 0.85 base - 0.05 for no session info
        assert result.method == "fuzzy_match"
        assert result.metadata["match_type"] == "nickname"

    def test_spelling_variation(self, strategy, mock_repositories):
        """Test matching common spelling variations"""
        person_repo, _ = mock_repositories

        # Sara should match Sarah
        sarah = Person(cm_id=12345, first_name="Sarah", last_name="Johnson")

        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "sarah" and last.lower() == "johnson":
                return [sarah]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        result = strategy.resolve("Sara Johnson", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == pytest.approx(0.80)  # 0.85 base - 0.05 for no session info
        assert result.metadata["match_type"] == "nickname"  # Sara/Sarah is in nickname groups

    def test_single_name_fuzzy(self, strategy, mock_repositories):
        """Test fuzzy matching on first name only"""
        person_repo, attendee_repo = mock_repositories

        # Search for "Mike" (no last name)
        person_repo.find_by_name.return_value = []

        # Mock candidates that will be found by first name
        michael1 = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        michael2 = Person(cm_id=67890, first_name="Michael", last_name="Johnson")

        # Mock normalized search to return empty (no direct "Mike" matches)
        person_repo.find_by_normalized_name.return_value = []

        # Mock find_by_first_name to return Michaels when searching for "Michael"
        def first_name_search_side_effect(name, year=None):
            if name.lower() == "michael":
                return [michael1, michael2]
            return []

        person_repo.find_by_first_name.side_effect = first_name_search_side_effect

        # Requester in same session as michael1
        attendee_repo.get_by_person_and_year.return_value = {
            "person_cm_id": 11111,
            "session_cm_id": 1000002,
            "year": 2025,
        }
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,  # Same session
            67890: 1000003,  # Different session
        }

        # Pass session context since repository mocks don't chain well
        result = strategy.resolve("Mike", requester_cm_id=11111, session_cm_id=1000002, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345  # Chose same session match
        # Session disambiguation gives 0.85 confidence (same session boost)
        assert result.confidence == 0.85
        assert result.metadata["match_type"] == "session_disambiguated"

    def test_no_fuzzy_match_found(self, strategy, mock_repositories):
        """Test when no fuzzy match is found"""
        person_repo, _ = mock_repositories

        # No matches for any variation
        person_repo.find_by_name.return_value = []
        person_repo.find_by_normalized_name.return_value = []

        result = strategy.resolve("Totally Unknown Name", requester_cm_id=67890, year=2025)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.method == "fuzzy_match"

    def test_multiple_nickname_matches(self, strategy, mock_repositories):
        """Test when nickname matches multiple people"""
        person_repo, _ = mock_repositories

        # Multiple Michaels
        michael1 = Person(cm_id=12345, first_name="Michael", last_name="Smith")
        michael2 = Person(cm_id=67890, first_name="Michael", last_name="Smith")

        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "michael" and last.lower() == "smith":
                return [michael1, michael2]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        result = strategy.resolve("Mike Smith", requester_cm_id=11111, year=2025)

        assert not result.is_resolved
        assert result.is_ambiguous
        assert len(result.candidates) == 2
        assert result.metadata["ambiguity_reason"] == "multiple_nickname_matches"

    def test_preferred_name_matching(self, strategy, mock_repositories):
        """Test matching against preferred names"""
        person_repo, _ = mock_repositories

        # Person prefers to be called by nickname
        person = Person(cm_id=12345, first_name="Robert", last_name="Smith", preferred_name="Bobby")

        # No exact match but find by normalized includes preferred
        person_repo.find_by_name.return_value = []
        person_repo.find_by_normalized_name.return_value = [person]

        result = strategy.resolve("Bobby Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.75  # Normalized match without session info
        assert result.metadata["match_type"] == "preferred_name"

    def test_case_and_punctuation_normalization(self, strategy, mock_repositories):
        """Test normalization of case and punctuation"""
        person_repo, _ = mock_repositories

        # Database has O'Brien
        person = Person(cm_id=12345, first_name="John", last_name="O'Brien")

        person_repo.find_by_name.return_value = []
        person_repo.find_by_normalized_name.return_value = [person]

        # Test various normalizations
        for name in ["john obrien", "JOHN OBRIEN", "John OBrien"]:
            result = strategy.resolve(name, requester_cm_id=67890, year=2025)
            assert result.is_resolved
            assert result.person.cm_id == 12345

    def test_confidence_levels(self, strategy, mock_repositories):
        """Test different confidence levels for fuzzy matches"""
        person_repo, attendee_repo = mock_repositories

        # Setup person
        person = Person(cm_id=12345, first_name="Michael", last_name="Smith")

        # Mock to return Michael when searching for "Michael Smith"
        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "michael" and last.lower() == "smith":
                return [person]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        # Set up bulk session lookup
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002  # Same session
        }

        result = strategy.resolve("Mike Smith", requester_cm_id=67890, session_cm_id=1000002, year=2025)
        assert result.confidence == 0.85  # Nickname match with session verification

        # Without session match
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000003  # Different session
        }
        # Reset the side effect for the second test
        person_repo.find_by_name.side_effect = find_by_name_side_effect

        result = strategy.resolve("Mike Smith", requester_cm_id=67890, session_cm_id=1000001, year=2025)
        assert result.confidence == 0.75  # Lower without session match


class TestFuzzyMatchParentSurname:
    """Test parent surname matching in FuzzyMatchStrategy"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a FuzzyMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_name.return_value = []
        person_repo.find_by_first_name.return_value = []
        # Default to empty - tests will override as needed
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        return FuzzyMatchStrategy(person_repo, attendee_repo)

    def test_fuzzy_match_via_parent_surname(self, strategy, mock_repositories):
        """Test matching when request uses parent's last name.

        Example: "Emma Smith" matches camper "Emma Johnson" whose parent is "John Smith"
        """
        person_repo, _ = mock_repositories

        # Camper has different last name but parent has the searched surname
        # parent_names must be JSON string with "first"/"last" keys
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        person_repo.find_by_name.return_value = []
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_first_and_parent_surname.return_value = [person]

        result = strategy.resolve("Emma Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.person.last_name == "Johnson"
        assert result.confidence <= 0.90  # Slightly lower for parent surname match
        assert result.metadata.get("match_type") == "parent_surname"

    def test_fuzzy_match_parent_surname_with_nickname(self, strategy, mock_repositories):
        """Test matching nickname + parent surname.

        Example: "Mike Smith" matches camper "Michael Johnson" whose parent is "Smith"
        """
        person_repo, _ = mock_repositories

        # Michael with parent surname Smith
        # parent_names must be JSON string with "first"/"last" keys
        person = Person(
            cm_id=12345,
            first_name="Michael",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        # All normal fuzzy searches return nothing
        person_repo.find_by_name.return_value = []
        person_repo.find_by_normalized_name.return_value = []
        # Parent surname search finds Michael when using nickname variations
        person_repo.find_by_first_and_parent_surname.return_value = [person]

        result = strategy.resolve("Mike Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata.get("match_type") == "parent_surname"

    def test_parent_surname_with_context_method(self, strategy, mock_repositories):
        """Test parent surname matching with resolve_with_context method"""
        person_repo, _ = mock_repositories

        # Pre-loaded candidate with parent surname
        # parent_names must be JSON string with "first"/"last" keys
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        person_repo.find_by_name.return_value = []

        result = strategy.resolve_with_context(
            "Emma Smith", requester_cm_id=67890, session_cm_id=1000002, year=2025, candidates=[person], attendee_info={}
        )

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata.get("match_type") == "parent_surname"

    def test_parent_surname_lower_priority_than_direct(self, strategy, mock_repositories):
        """Test that direct matches are preferred over parent surname matches.

        Uses "Mike" -> "Michael" nickname variation since "Emma" has no nickname variations.
        """
        person_repo, _ = mock_repositories

        # Direct match person - "Michael Smith" found when searching for "Mike Smith"
        direct_person = Person(cm_id=11111, first_name="Michael", last_name="Smith")

        # Fuzzy nickname search finds direct match via nickname variation lookup
        # ("Mike" -> "Michael" is a known nickname variation)
        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "michael" and last.lower() == "smith":
                return [direct_person]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect
        person_repo.find_by_normalized_name.return_value = []

        result = strategy.resolve("Mike Smith", requester_cm_id=67890, year=2025)

        # Should match Michael Smith via nickname, not fall through to parent surname
        assert result.is_resolved
        assert result.person.cm_id == 11111  # Direct match via nickname
        assert result.metadata.get("match_type") == "nickname"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

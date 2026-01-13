"""Test-Driven Development for PhoneticMatchStrategy

Tests the phonetic matching strategy including Soundex and Metaphone algorithms."""

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
from bunking.sync.bunk_request_processor.resolution.strategies.phonetic_match import PhoneticMatchStrategy


class TestPhoneticMatchStrategy:
    """Test the PhoneticMatchStrategy name resolution"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        # Set default return values
        mock_person_repo.get_all_for_phonetic_matching.return_value = []
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a PhoneticMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        return PhoneticMatchStrategy(person_repo, attendee_repo)

    def test_soundex_algorithm(self, strategy):
        """Test Soundex code generation"""
        test_cases = [
            ("Smith", "S530"),
            ("Smythe", "S530"),  # Same as Smith
            ("Johnson", "J525"),
            ("Jonson", "J525"),  # Same as Johnson
            ("Robert", "R163"),
            ("Rupert", "R163"),  # Same as Robert
            ("Jackson", "J250"),
            ("Jacksun", "J250"),  # Same as Jackson
            ("", "0000"),
            ("A", "A000"),
        ]

        for name, expected in test_cases:
            assert strategy._soundex(name) == expected

    def test_metaphone_algorithm(self, strategy):
        """Test Metaphone code generation"""
        test_cases = [
            ("Smith", "SMIT"),
            ("Schmidt", "SKMIDT"),
            ("Philip", "FILIP"),
            ("Phillip", "FILIP"),  # Same as Philip
            ("Knight", "NIT"),  # KN -> N
            ("Night", "NIT"),  # Same as Knight
            ("Wright", "RIT"),  # WR -> R
            ("Thompson", "TOMPSON"),
            ("", ""),
        ]

        for name, expected in test_cases:
            assert strategy._metaphone(name) == expected

    def test_single_soundex_match(self, strategy, mock_repositories):
        """Test successful resolution with single Soundex match"""
        person_repo, attendee_repo = mock_repositories

        # Create test persons - Smith/Smythe should match
        all_persons = [
            Person(cm_id=12345, first_name="John", last_name="Smythe"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
            Person(cm_id=11111, first_name="Bob", last_name="Wilson"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Test resolution
        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.person.last_name == "Smythe"
        assert result.confidence == pytest.approx(0.65)  # Base 0.70 - 0.05 for no session
        assert result.metadata["match_type"] == "soundex"
        assert result.metadata["algorithm"] == "soundex"

    def test_multiple_soundex_matches(self, strategy, mock_repositories):
        """Test handling of multiple Soundex matches"""
        person_repo, _ = mock_repositories

        # Create multiple people with same Soundex
        all_persons = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
            Person(cm_id=11111, first_name="John", last_name="Smithe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.is_ambiguous
        assert len(result.candidates) == 3
        assert result.confidence == 0.4
        assert result.metadata["ambiguity_reason"] == "multiple_soundex_matches"

    def test_metaphone_fallback(self, strategy, mock_repositories):
        """Test Metaphone used when Soundex fails"""
        person_repo, _ = mock_repositories

        # Catherine/Katherine have different Soundex (C365/K365) but same Metaphone
        all_persons = [
            Person(cm_id=12345, first_name="Katherine", last_name="Johnson"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        result = strategy.resolve("Catherine Johnson", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Katherine"
        assert result.confidence == pytest.approx(0.60)  # Base 0.65 - 0.05 (no session info)
        assert result.metadata["match_type"] == "metaphone"
        assert result.metadata["algorithm"] == "metaphone"

    def test_session_disambiguation(self, strategy, mock_repositories):
        """Test using session to disambiguate multiple matches"""
        person_repo, attendee_repo = mock_repositories

        # Multiple matches
        all_persons = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Mock session info - only one in same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,
            67890: 1000003,  # Different session
        }

        result = strategy.resolve("John Smith", requester_cm_id=99999, session_cm_id=1000002, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.75
        assert result.metadata["match_type"] == "soundex_with_session"
        assert result.metadata["session_match"] == "exact"

    def test_confidence_boost_same_session(self, strategy, mock_repositories):
        """Test confidence boost when match is in same session"""
        person_repo, attendee_repo = mock_repositories

        all_persons = [Person(cm_id=12345, first_name="John", last_name="Smythe")]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        result = strategy.resolve("John Smith", requester_cm_id=99999, session_cm_id=1000002, year=2025)

        assert result.confidence == pytest.approx(0.75)  # Base 0.70 + 0.05 boost

    def test_confidence_reduction_different_session(self, strategy, mock_repositories):
        """Test confidence reduction when match is in different session"""
        person_repo, attendee_repo = mock_repositories

        all_persons = [Person(cm_id=12345, first_name="John", last_name="Smythe")]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Different session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000003}

        result = strategy.resolve("John Smith", requester_cm_id=99999, session_cm_id=1000002, year=2025)

        assert result.confidence == pytest.approx(0.50)  # Base 0.70 - 0.20 penalty

    def test_empty_name(self, strategy):
        """Test handling of empty names"""
        result = strategy.resolve("", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.metadata["reason"] == "empty_name"

    def test_single_name_no_match(self, strategy, mock_repositories):
        """Test single name returns no match"""
        person_repo, _ = mock_repositories
        person_repo.get_all_for_phonetic_matching.return_value = []

        result = strategy.resolve("John", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.metadata["reason"] == "no_phonetic_match"

    def test_no_phonetic_matches(self, strategy, mock_repositories):
        """Test when no phonetic matches found"""
        person_repo, _ = mock_repositories

        # No matching names
        all_persons = [
            Person(cm_id=12345, first_name="Alice", last_name="Johnson"),
            Person(cm_id=67890, first_name="Bob", last_name="Wilson"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        result = strategy.resolve("John Smith", requester_cm_id=99999)

        assert not result.is_resolved
        assert result.confidence == 0.0
        assert result.metadata["reason"] == "no_phonetic_match"

    def test_complex_name_matching(self, strategy, mock_repositories):
        """Test matching with complex names"""
        person_repo, _ = mock_repositories

        # Names with special patterns
        all_persons = [
            Person(cm_id=12345, first_name="Gnat", last_name="Wright"),  # GN->N, WR->R
            Person(cm_id=67890, first_name="Knight", last_name="Phisher"),  # KN->N, PH->F
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Should match "Gnat Wright" -> "Nat Right"
        result = strategy.resolve("Nat Right", requester_cm_id=99999)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata["algorithm"] == "metaphone"


class TestPhoneticMatchNicknameIntegration:
    """Test nickname matching integration in PhoneticMatchStrategy.

    These tests verify that the phonetic strategy also checks nickname groups
    `self._names_match_with_nicknames(target_first, first_name)`
    """

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        mock_person_repo.get_all_for_phonetic_matching.return_value = []
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a PhoneticMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        return PhoneticMatchStrategy(person_repo, attendee_repo)

    def test_nickname_match_mike_michael(self, strategy, mock_repositories):
        """Test that 'Mike Smith' matches 'Michael Smith' via nickname groups.

        The phonetic matching includes nickname group lookup via
        _names_match_with_nicknames() to match 'Mike' = 'Michael'.

        This test verifies nickname integration is working.
        """
        person_repo, _ = mock_repositories

        # Person has formal name "Michael Smith"
        all_persons = [
            Person(cm_id=12345, first_name="Michael", last_name="Smith"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Search for "Mike Smith" - should find "Michael Smith" via nickname
        result = strategy.resolve("Mike Smith", requester_cm_id=99999)

        assert result.is_resolved, "Should resolve 'Mike Smith' to 'Michael Smith' via nickname"
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Michael"
        assert (
            "nickname" in result.metadata.get("match_type", "").lower()
            or result.metadata.get("algorithm") == "nickname"
        )

    def test_nickname_match_kate_katherine(self, strategy, mock_repositories):
        """Test that 'Kate Johnson' matches 'Katherine Johnson' via nickname groups."""
        person_repo, _ = mock_repositories

        all_persons = [
            Person(cm_id=12345, first_name="Katherine", last_name="Johnson"),
            Person(cm_id=67890, first_name="Bob", last_name="Wilson"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Search for "Kate Johnson"
        result = strategy.resolve("Kate Johnson", requester_cm_id=99999)

        assert result.is_resolved, "Should resolve 'Kate Johnson' to 'Katherine Johnson'"
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Katherine"

    def test_nickname_match_bob_robert(self, strategy, mock_repositories):
        """Test that 'Bob Wilson' matches 'Robert Wilson' via nickname groups."""
        person_repo, _ = mock_repositories

        all_persons = [
            Person(cm_id=12345, first_name="Robert", last_name="Wilson"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        result = strategy.resolve("Bob Wilson", requester_cm_id=99999)

        assert result.is_resolved, "Should resolve 'Bob Wilson' to 'Robert Wilson'"
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Robert"

    def test_nickname_match_reverse_direction(self, strategy, mock_repositories):
        """Test nickname matching works in reverse (formal name -> nickname)."""
        person_repo, _ = mock_repositories

        # Person registered as "Mike" (nickname)
        all_persons = [
            Person(cm_id=12345, first_name="Mike", last_name="Smith"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Search for "Michael Smith" - should find "Mike Smith"
        result = strategy.resolve("Michael Smith", requester_cm_id=99999)

        assert result.is_resolved, "Should resolve 'Michael Smith' to 'Mike Smith'"
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Mike"

    def test_nickname_match_with_session_disambiguation(self, strategy, mock_repositories):
        """Test nickname matching respects session disambiguation."""
        person_repo, attendee_repo = mock_repositories

        # Two Michaels in different sessions
        all_persons = [
            Person(cm_id=12345, first_name="Michael", last_name="Smith"),
            Person(cm_id=67890, first_name="Michael", last_name="Smith"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Mock session info - only one in same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,
            67890: 1000003,  # Different session
        }

        result = strategy.resolve("Mike Smith", requester_cm_id=99999, session_cm_id=1000002, year=2025)

        assert result.is_resolved, "Should resolve to Michael in same session"
        assert result.person.cm_id == 12345

    def test_nickname_no_match_different_last_name(self, strategy, mock_repositories):
        """Test that nickname matching still requires last name match."""
        person_repo, _ = mock_repositories

        all_persons = [
            Person(cm_id=12345, first_name="Michael", last_name="Johnson"),  # Different last name
            Person(cm_id=67890, first_name="Jane", last_name="Smith"),
        ]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Search for "Mike Smith" - should NOT find "Michael Johnson"
        result = strategy.resolve("Mike Smith", requester_cm_id=99999)

        # Should not resolve because last names don't match
        assert not result.is_resolved or result.person.last_name == "Smith"


class TestPhoneticMatchParentSurname:
    """Test parent surname phonetic matching in PhoneticMatchStrategy"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a PhoneticMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        person_repo.get_all_for_phonetic_matching.return_value = []
        return PhoneticMatchStrategy(person_repo, attendee_repo)

    def test_phonetic_match_via_parent_surname(self, strategy, mock_repositories):
        """Test phonetic matching against parent surnames.

        Example: "Emma Smidt" → matches camper Emma Johnson whose parent is "Smith"
        because "Smidt" sounds like "Smith" (phonetic match).
        """
        person_repo, _ = mock_repositories

        # Camper with different last name but parent has phonetically similar surname
        # parent_names must be JSON string with "first"/"last" keys
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        # Phonetic search returns the person
        person_repo.get_all_for_phonetic_matching.return_value = [person]

        # "Smidt" sounds like "Smith"
        result = strategy.resolve("Emma Smidt", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.person.last_name == "Johnson"
        assert result.metadata.get("match_type") == "parent_surname_phonetic"

    def test_phonetic_match_parent_surname_with_nickname(self, strategy, mock_repositories):
        """Test phonetic parent surname matching with nickname.

        Example: "Mike Smythe" matches camper "Michael Johnson" whose parent is "Smith"
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

        person_repo.get_all_for_phonetic_matching.return_value = [person]

        # "Mike" is nickname for Michael, "Smythe" sounds like "Smith"
        result = strategy.resolve("Mike Smythe", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata.get("match_type") == "parent_surname_phonetic"

    def test_parent_surname_phonetic_with_context(self, strategy, mock_repositories):
        """Test parent surname phonetic matching with resolve_with_context"""
        person_repo, _ = mock_repositories

        # Pre-loaded candidate with parent surname
        # parent_names must be JSON string with "first"/"last" keys
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        result = strategy.resolve_with_context(
            "Emma Smidt",  # Phonetically similar to Smith
            requester_cm_id=67890,
            session_cm_id=1000002,
            year=2025,
            candidates=[person],
            attendee_info={},
        )

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata.get("match_type") == "parent_surname_phonetic"

    def test_parent_surname_lower_confidence_than_direct(self, strategy, mock_repositories):
        """Test that parent surname phonetic matches have lower confidence"""
        person_repo, _ = mock_repositories

        # Direct phonetic match
        direct_person = Person(cm_id=11111, first_name="Emma", last_name="Smidt")

        # Parent surname match
        # parent_names must be JSON string with "first"/"last" keys
        parent_person = Person(
            cm_id=22222,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smidt", "relationship": "Father"}]),
        )

        # Test direct phonetic match
        person_repo.get_all_for_phonetic_matching.return_value = [direct_person]
        direct_result = strategy.resolve("Emma Smidt", requester_cm_id=67890, year=2025)

        # Test parent surname phonetic match
        person_repo.get_all_for_phonetic_matching.return_value = [parent_person]
        parent_result = strategy.resolve("Emma Smidt", requester_cm_id=67890, year=2025)

        # Direct match should have higher or equal confidence
        if direct_result.is_resolved and parent_result.is_resolved:
            assert direct_result.confidence >= parent_result.confidence


class TestPhoneticMatchCacheEfficiency:
    """Test cache efficiency in PhoneticMatchStrategy.

    The resolve() method tries multiple phonetic algorithms (Soundex, Metaphone,
    nickname, parent surname) but should only fetch the person list ONCE.
    """

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create a PhoneticMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        person_repo.get_all_for_phonetic_matching.return_value = []
        return PhoneticMatchStrategy(person_repo, attendee_repo)

    def test_get_all_persons_called_once_per_resolve(self, strategy, mock_repositories):
        """Test that get_all_for_phonetic_matching is called exactly once per resolve().

        Previously, each sub-method (_try_soundex_match, _try_metaphone_match,
        _try_nickname_match, _try_parent_surname_phonetic_match) independently
        called get_all_for_phonetic_matching(), resulting in 4 calls per resolve().

        This test verifies the optimization that fetches the person list once
        and reuses it across all phonetic matching algorithms.
        """
        person_repo, _ = mock_repositories

        # No matches - this will try all 4 phonetic methods
        person_repo.get_all_for_phonetic_matching.return_value = []

        # Call resolve - should try Soundex, Metaphone, nickname, parent surname
        strategy.resolve("John Smith", requester_cm_id=99999, year=2025)

        # Should be called exactly ONCE, not 4 times
        assert person_repo.get_all_for_phonetic_matching.call_count == 1

    def test_get_all_persons_called_once_even_with_matches(self, strategy, mock_repositories):
        """Test that even when matches are found, we only fetch persons once.

        When Soundex finds a match, we should NOT have already fetched persons
        4 times during earlier algorithm attempts.
        """
        person_repo, _ = mock_repositories

        # Create a match that will be found by Soundex
        all_persons = [Person(cm_id=12345, first_name="John", last_name="Smythe")]
        person_repo.get_all_for_phonetic_matching.return_value = all_persons

        # Call resolve - should find match via Soundex and return early
        result = strategy.resolve("John Smith", requester_cm_id=99999, year=2025)

        # Verify we found the match
        assert result.is_resolved
        assert result.person.cm_id == 12345

        # Should still be called exactly once (cached for potential later algorithms)
        assert person_repo.get_all_for_phonetic_matching.call_count == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

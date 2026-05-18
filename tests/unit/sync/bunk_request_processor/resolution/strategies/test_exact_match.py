"""Test-Driven Development for ExactMatchStrategy

Tests the exact name matching resolution strategy."""

import json
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.exact_match import ExactMatchStrategy


class TestExactMatchStrategy:
    """Test the ExactMatchStrategy implementation"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create an ExactMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        # Mock attendee repo to return None by default (no session found)
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        # Mock parent surname search to return empty by default
        # Set name_cache to None so it falls through to DB method
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        # Mock for fallback parent surname matching via DB scan
        person_repo.get_all_for_phonetic_matching.return_value = []
        return ExactMatchStrategy(person_repo, attendee_repo)

    def test_exact_full_name_match(self, strategy, mock_repositories):
        """Test exact match on full name"""
        person_repo, _ = mock_repositories

        # Mock repository to return one person
        person = Person(cm_id=12345, first_name="John", last_name="Smith", birth_date=datetime(2010, 5, 15))
        person_repo.find_by_name.return_value = [person]

        # Test resolution
        result = strategy.resolve("John Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.90  # Lower confidence without session info
        assert result.method == "exact_match"
        assert result.metadata.get("no_session_info") is True

        # Verify repository was called correctly with year
        person_repo.find_by_name.assert_called_once_with("John", "Smith", year=2025)

    def test_exact_match_case_insensitive(self, strategy, mock_repositories):
        """Test that matching is case insensitive"""
        person_repo, _ = mock_repositories

        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person]

        # Test with different case
        result = strategy.resolve("JOHN SMITH", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345

        # Verify normalized call with year
        person_repo.find_by_name.assert_called_once_with("John", "Smith", year=2025)

    def test_no_match_found(self, strategy, mock_repositories):
        """Test when no exact match is found"""
        person_repo, _ = mock_repositories

        person_repo.find_by_name.return_value = []

        result = strategy.resolve("Unknown Person", requester_cm_id=67890, year=2025)

        assert not result.is_resolved
        assert result.person is None
        assert result.confidence == 0.0
        assert result.method == "exact_match"

    def test_multiple_matches_in_different_sessions(self, strategy, mock_repositories):
        """Test when multiple people have same name in different sessions"""
        person_repo, attendee_repo = mock_repositories

        # Two people with same name
        person1 = Person(cm_id=12345, first_name="John", last_name="Smith")
        person2 = Person(cm_id=67890, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person1, person2]

        # Mock session lookups
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,  # Session 1
            67890: 1000003,  # Session 2
        }

        # Requester is in session 1
        attendee_repo.get_by_person_and_year.return_value = {
            "person_cm_id": 11111,
            "session_cm_id": 1000002,
            "year": 2025,
        }

        # Test resolution
        result = strategy.resolve("John Smith", requester_cm_id=11111, year=2025)

        # Should resolve to person in same session
        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.95
        assert result.metadata["session_match"] == "exact"

    def test_multiple_matches_same_session(self, strategy, mock_repositories):
        """Test when multiple people have same name in same session"""
        person_repo, attendee_repo = mock_repositories

        # Two people with same name
        person1 = Person(cm_id=12345, first_name="John", last_name="Smith")
        person2 = Person(cm_id=67890, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person1, person2]

        # Both in same session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002, 67890: 1000002}

        # Requester also in session
        attendee_repo.get_by_person_and_year.return_value = {
            "person_cm_id": 11111,
            "session_cm_id": 1000002,
            "year": 2025,
        }

        # Test resolution
        result = strategy.resolve("John Smith", requester_cm_id=11111, year=2025)

        # Should be ambiguous
        assert not result.is_resolved
        assert result.is_ambiguous
        assert len(result.candidates) == 2
        assert result.confidence == 0.5
        assert result.metadata["ambiguity_reason"] == "multiple_same_session_matches"

    def test_single_name_match(self, strategy, mock_repositories):
        """Test matching on first name only"""
        person_repo, _ = mock_repositories

        # Mock no full name match
        person_repo.find_by_name.return_value = []

        # Test with single name
        result = strategy.resolve("John", requester_cm_id=67890, year=2025)

        # Exact match doesn't handle partial names
        assert not result.is_resolved
        assert result.confidence == 0.0

    def test_match_with_session_context(self, strategy, mock_repositories):
        """Test resolution with explicit session context"""
        person_repo, attendee_repo = mock_repositories

        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person]

        # Mock person is in the provided session
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        # Test with explicit session
        result = strategy.resolve("John Smith", requester_cm_id=67890, session_cm_id=1000002, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata["session_match"] == "exact"

    def test_match_confidence_levels(self, strategy, mock_repositories):
        """Test different confidence levels based on match quality"""
        person_repo, attendee_repo = mock_repositories

        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person]

        # No session info available
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}

        result = strategy.resolve("John Smith", requester_cm_id=67890, year=2025)

        # Lower confidence without session verification
        assert result.is_resolved
        assert result.confidence == 0.90  # Slightly lower without session match

    def test_handles_missing_year(self, strategy, mock_repositories):
        """Test strategy handles missing year parameter"""
        person_repo, _ = mock_repositories

        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        person_repo.find_by_name.return_value = [person]

        # Test without year
        result = strategy.resolve("John Smith", requester_cm_id=67890)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        # Lower confidence without year context
        assert result.confidence == 0.90

    def test_multi_match_disambiguation_uses_session_cm_ids(self, strategy):
        """Multi-match disambiguation should check session_cm_ids, not just session_cm_id."""
        target_a = Person(cm_id=2000001, first_name="Erez", last_name="Costello")
        target_b = Person(cm_id=2000002, first_name="Erez", last_name="Costello")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},
            2000001: {
                "session_cm_id": 1000020,
                "session_cm_ids": [1000020, 1000010],
            },
            2000002: {
                "session_cm_id": 1000030,
                "session_cm_ids": [1000030],
            },
        }

        result = strategy.resolve(
            name="Erez Costello",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target_a, target_b],
            attendee_info=attendee_info,
        )

        assert result.confidence == 0.95
        assert result.person.cm_id == 2000001
        assert result.metadata.get("session_match") == "exact"


class TestExactMatchParentSurname:
    """Test parent surname matching in ExactMatchStrategy"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        """Create an ExactMatchStrategy with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        # Default to empty - tests will override as needed
        person_repo.find_by_name.return_value = []
        # Set name_cache to None so it falls through to DB method
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        # Mock for fallback parent surname matching via DB scan
        person_repo.get_all_for_phonetic_matching.return_value = []
        return ExactMatchStrategy(person_repo, attendee_repo)

    def test_exact_match_via_parent_surname(self, strategy, mock_repositories):
        """Test matching when request uses parent's last name instead of camper's.

        Example: "Emma Smith" matches camper "Emma Johnson" whose parent is "John Smith"
        """
        person_repo, _ = mock_repositories

        # Camper has different last name but parent has the searched surname
        # parent_names must be JSON string with "first"/"last" keys (not "first_name"/"last_name")
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        # First search finds no direct match
        person_repo.find_by_name.return_value = []
        # DB scan returns this person so parent surname matching can find them
        person_repo.get_all_for_phonetic_matching.return_value = [person]

        result = strategy.resolve("Emma Smith", requester_cm_id=67890, year=2025)

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.person.first_name == "Emma"
        assert result.person.last_name == "Johnson"
        # Slightly lower confidence for parent surname match
        assert result.confidence <= 0.90
        assert result.metadata.get("match_type") == "parent_surname"

    def test_parent_surname_match_lower_confidence_than_direct(self, strategy, mock_repositories):
        """Test that parent surname matches have lower confidence than direct matches"""
        person_repo, attendee_repo = mock_repositories

        # Direct match person
        direct_person = Person(cm_id=11111, first_name="Emma", last_name="Smith")

        # Parent surname match person
        parent_person = Person(
            cm_id=22222,
            first_name="Emma",
            last_name="Johnson",
            parent_names=json.dumps([{"first": "John", "last": "Smith", "relationship": "Father"}]),
        )

        # Test direct match first
        person_repo.find_by_name.return_value = [direct_person]
        direct_result = strategy.resolve("Emma Smith", requester_cm_id=67890, year=2025)

        # Test parent surname match
        person_repo.find_by_name.return_value = []  # No direct match
        person_repo.get_all_for_phonetic_matching.return_value = [parent_person]
        parent_result = strategy.resolve("Emma Smith", requester_cm_id=67890, year=2025)

        # Direct match should have higher or equal confidence
        assert direct_result.confidence >= parent_result.confidence

    def test_parent_surname_no_match_when_first_name_differs(self, strategy, mock_repositories):
        """Test that parent surname doesn't match if first name is different"""
        person_repo, _ = mock_repositories

        # Mock returns empty - no matching camper with first name "Emma"
        person_repo.find_by_name.return_value = []
        # parent surname search returns this person but first name won't match
        person_repo.find_by_first_and_parent_surname.return_value = []

        result = strategy.resolve("Emma Smith", requester_cm_id=67890, year=2025)

        assert not result.is_resolved
        assert result.person is None

    def test_parent_surname_with_context_method(self, strategy, mock_repositories):
        """Test parent surname matching with resolve method"""
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

        result = strategy.resolve(
            "Emma Smith", requester_cm_id=67890, session_cm_id=1000002, year=2025, candidates=[person], attendee_info={}
        )

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.metadata.get("match_type") == "parent_surname"


class TestExactMatchPreferredName:
    """Test preferred_name matching in ExactMatchStrategy."""

    @pytest.fixture
    def mock_repositories(self):
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        person_repo, attendee_repo = mock_repositories
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        person_repo.get_all_for_phonetic_matching.return_value = []
        return ExactMatchStrategy(person_repo, attendee_repo)

    def test_resolve_matches_preferred_name(self, strategy):
        """preferred_name should match when first_name doesn't."""
        candidates = [
            Person(cm_id=100, first_name="Nicholas", last_name="Garcia", preferred_name="Nick"),
        ]
        result = strategy.resolve("Nick Garcia", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100

    def test_resolve_preferred_name_none_safe(self, strategy):
        """Candidates with preferred_name=None should not crash."""
        candidates = [
            Person(cm_id=100, first_name="Nicholas", last_name="Garcia", preferred_name=None),
        ]
        result = strategy.resolve("Nick Garcia", requester_cm_id=999, candidates=candidates)
        assert not result.is_resolved  # "Nick" != "Nicholas", no preferred_name

    def test_resolve_first_name_still_works(self, strategy):
        """Standard first_name matching still works alongside preferred_name."""
        candidates = [
            Person(cm_id=100, first_name="Nicholas", last_name="Garcia", preferred_name="Nick"),
        ]
        result = strategy.resolve("Nicholas Garcia", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100

    def test_resolve_preferred_name_case_insensitive(self, strategy):
        """preferred_name matching should be case-insensitive via title()."""
        candidates = [
            Person(cm_id=100, first_name="Elizabeth", last_name="Chen", preferred_name="liz"),
        ]
        result = strategy.resolve("Liz Chen", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100

    def test_resolve_preferred_name_with_empty_string(self, strategy):
        """Empty string preferred_name should not match anything."""
        candidates = [
            Person(cm_id=100, first_name="Nicholas", last_name="Garcia", preferred_name=""),
        ]
        result = strategy.resolve("Nick Garcia", requester_cm_id=999, candidates=candidates)
        assert not result.is_resolved


class TestResolveWithContextSessionHandling:
    """Tests for resolve: unknown vs different session distinction."""

    @pytest.fixture
    def mock_repositories(self):
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_by_person_and_year.return_value = None
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        mock_person_repo.name_cache = None
        mock_person_repo.find_by_first_and_parent_surname.return_value = []
        mock_person_repo.get_all_for_phonetic_matching.return_value = []
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def strategy(self, mock_repositories):
        person_repo, attendee_repo = mock_repositories
        return ExactMatchStrategy(person_repo, attendee_repo)

    def test_target_not_in_attendee_info_returns_unknown(self, strategy):
        """Target absent from enrolled-only attendee_info → confidence 0.90, session_match='unknown'."""
        target = Person(cm_id=1234568, first_name="Emma", last_name="Johnson")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},  # requester present
            # 1234568 NOT present — cancelled target absent from enrolled-only map
        }

        result = strategy.resolve(
            name="Emma Johnson",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=attendee_info,
        )

        assert result.is_resolved
        assert result.confidence == 0.90
        assert result.metadata.get("session_match") == "unknown"
        assert result.person.cm_id == 1234568

    def test_target_in_same_session_returns_exact(self, strategy):
        """Target in same session → confidence 0.95, session_match='exact' (unchanged)."""
        target = Person(cm_id=1234567, first_name="Ivy", last_name="Smith")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},
            1234567: {"session_cm_id": 1000010},  # same session
        }

        result = strategy.resolve(
            name="Ivy Smith",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=attendee_info,
        )

        assert result.confidence == 0.95
        assert result.metadata.get("session_match") == "exact"

    def test_target_in_different_session_returns_different(self, strategy):
        """Target in different session → confidence 0.85, session_match='different' (unchanged)."""
        target = Person(cm_id=1234567, first_name="Ivy", last_name="Smith")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},
            1234567: {"session_cm_id": 1000020},  # different session
        }

        result = strategy.resolve(
            name="Ivy Smith",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=attendee_info,
        )

        assert result.confidence == 0.85
        assert result.metadata.get("session_match") == "different"

    def test_duplicate_person_records_deduplicated_by_cm_id(self, strategy):
        """Multiple person records with same cm_id → treated as single match."""
        # Emily Shapiro has 8 person records (one per year attended), all cm_id=11444631
        target1 = Person(cm_id=11444631, first_name="Emily", last_name="Shapiro")
        target2 = Person(cm_id=11444631, first_name="Emily", last_name="Shapiro")
        target3 = Person(cm_id=11444631, first_name="Emily", last_name="Shapiro")
        attendee_info = {
            1000001: {"session_cm_id": 1235405},
            11444631: {"session_cm_id": 1235405, "session_cm_ids": [1235405]},
        }

        result = strategy.resolve(
            name="Emily Shapiro",
            requester_cm_id=1000001,
            session_cm_id=1235405,
            year=2026,
            candidates=[target1, target2, target3],
            attendee_info=attendee_info,
        )

        # Should be single match (0.95), not multiple-match ambiguous (0.50)
        assert result.confidence == 0.95
        assert result.metadata.get("session_match") == "exact"
        assert result.person.cm_id == 11444631

    def test_multi_session_target_matches_any_session(self, strategy):
        """Target enrolled in multiple sessions → matches if requester's session is ANY of them."""
        target = Person(cm_id=1234567, first_name="Erez", last_name="Costello")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},
            1234567: {
                "session_cm_id": 1000020,  # primary is different session
                "session_cm_ids": [1000020, 1000010],  # but also enrolled in requester's session
            },
        }

        result = strategy.resolve(
            name="Erez Costello",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=attendee_info,
        )

        assert result.confidence == 0.95
        assert result.metadata.get("session_match") == "exact"

    def test_multi_session_target_no_overlap_returns_different(self, strategy):
        """Target in multiple sessions but none match requester → still 'different'."""
        target = Person(cm_id=1234567, first_name="Erez", last_name="Costello")
        attendee_info = {
            1000001: {"session_cm_id": 1000010},
            1234567: {
                "session_cm_id": 1000020,
                "session_cm_ids": [1000020, 1000030],  # neither matches 1000010
            },
        }

        result = strategy.resolve(
            name="Erez Costello",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=attendee_info,
        )

        assert result.confidence == 0.85
        assert result.metadata.get("session_match") == "different"

    def test_no_attendee_info_at_all_unchanged(self, strategy):
        """No attendee_info provided → confidence 0.90 (existing behavior)."""
        target = Person(cm_id=1234567, first_name="Ivy", last_name="Smith")

        result = strategy.resolve(
            name="Ivy Smith",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=[target],
            attendee_info=None,
        )

        assert result.confidence == 0.90


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

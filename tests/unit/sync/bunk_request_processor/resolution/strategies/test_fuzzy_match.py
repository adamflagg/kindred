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


class TestFuzzyMatchJaroWinklerFirstName:
    """Test Jaro-Winkler first name fallback in FuzzyMatchStrategy."""

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
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_first_name.return_value = []
        person_repo.find_by_name.return_value = []
        person_repo.find_by_first_and_parent_surname.return_value = []
        person_repo.get_all_for_phonetic_matching.return_value = []
        return FuzzyMatchStrategy(person_repo, attendee_repo)

    def test_jaro_winkler_first_name_charlie_charlotte(self, strategy):
        """JW catches close first-name variants not in nickname dict."""
        candidates = [Person(cm_id=100, first_name="Charlotte", last_name="Garcia")]
        result = strategy.resolve_with_context("Charlie Garcia", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100
        assert result.metadata.get("match_type") == "jaro_winkler_first_name"

    def test_jaro_winkler_first_name_zoey_zoe(self, strategy):
        """Zoey/Zoe should match via JW."""
        candidates = [Person(cm_id=100, first_name="Zoe", last_name="Chen")]
        result = strategy.resolve_with_context("Zoey Chen", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100

    def test_jaro_winkler_rejects_short_dissimilar(self, strategy):
        """Short dissimilar names should not match."""
        candidates = [Person(cm_id=100, first_name="May", last_name="Garcia")]
        result = strategy.resolve_with_context("Max Garcia", requester_cm_id=999, candidates=candidates)
        assert not result.is_resolved

    def test_jaro_winkler_checks_preferred_name(self, strategy):
        """JW should also match against preferred_name."""
        candidates = [Person(cm_id=100, first_name="Charlotte", last_name="Garcia", preferred_name="Charli")]
        result = strategy.resolve_with_context("Charlie Garcia", requester_cm_id=999, candidates=candidates)
        assert result.is_resolved
        assert result.person.cm_id == 100

    def test_jaro_winkler_requires_last_name_match(self, strategy):
        """JW first name match requires last name to also match."""
        candidates = [Person(cm_id=100, first_name="Charlotte", last_name="Johnson")]
        result = strategy.resolve_with_context("Charlie Garcia", requester_cm_id=999, candidates=candidates)
        assert not result.is_resolved

    def test_jaro_winkler_multiple_matches_ambiguous(self, strategy):
        """Multiple JW matches should return ambiguous result."""
        candidates = [
            Person(cm_id=100, first_name="Charlotte", last_name="Garcia"),
            Person(cm_id=200, first_name="Charlene", last_name="Garcia"),
        ]
        result = strategy.resolve_with_context("Charlie Garcia", requester_cm_id=999, candidates=candidates)
        assert result.is_ambiguous
        assert len(result.candidates) == 2


class TestJaroWinklerFullPoolFallback:
    """Tests for JW strategy falling back to all_persons when candidates are empty."""

    @pytest.fixture
    def strategy_with_repos(self):
        """Create strategy with mocked repos."""
        person_repo = Mock()
        attendee_repo = Mock()
        attendee_repo.get_by_person_and_year.return_value = None
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_first_name.return_value = []
        person_repo.find_by_name.return_value = []
        person_repo.name_cache = None
        person_repo.find_by_first_and_parent_surname.return_value = []
        return FuzzyMatchStrategy(person_repo, attendee_repo), person_repo, attendee_repo

    def test_misspelled_last_name_resolves_via_full_pool(self, strategy_with_repos):
        """'Olivia Jonson' resolves to 'Olivia Johnson' via JW on all_persons fallback."""
        strategy, person_repo, _ = strategy_with_repos

        target = Person(cm_id=1000002, first_name="Olivia", last_name="Johnson")
        all_persons = [
            target,
            Person(cm_id=1000099, first_name="Other", last_name="Person"),
        ]

        result = strategy.resolve_with_context(
            name="Olivia Jonson",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=None,  # empty — simulates no exact-match candidates
            all_persons=all_persons,
        )

        assert result.is_resolved
        assert result.person.cm_id == 1000002
        assert result.metadata.get("match_type") == "jaro_winkler_full_pool"

    def test_misspelled_last_name_below_threshold_does_not_resolve(self, strategy_with_repos):
        """Very different last name below JW 0.90 threshold does not match."""
        strategy, _, _ = strategy_with_repos

        target = Person(cm_id=1000002, first_name="Olivia", last_name="Completely-Different")
        all_persons = [target]

        result = strategy.resolve_with_context(
            name="Olivia Jonson",
            requester_cm_id=1000001,
            session_cm_id=1000010,
            year=2026,
            candidates=None,
            all_persons=all_persons,
        )

        assert not result.is_resolved

    def test_candidates_present_uses_candidates_not_all_persons(self, strategy_with_repos):
        """When candidates list is non-empty, JW uses candidates, not all_persons."""
        strategy, _, _ = strategy_with_repos

        candidate = Person(cm_id=1000002, first_name="Olivia", last_name="Johnson")
        other_person = Person(cm_id=1000003, first_name="Olivia", last_name="Jonson-Match")

        result = strategy.resolve_with_context(
            name="Olivia Johnson",  # exact match on candidate
            requester_cm_id=1000001,
            year=2026,
            candidates=[candidate],
            all_persons=[other_person],  # this should NOT be used
        )

        # Verify candidates are preferred — match should come from candidate pool
        if result.is_resolved:
            assert result.person.cm_id == candidate.cm_id
            assert result.metadata.get("match_type") != "jaro_winkler_full_pool"

    def test_both_empty_returns_unresolved(self, strategy_with_repos):
        """Empty candidates AND empty all_persons → unresolved, no crash."""
        strategy, _, _ = strategy_with_repos

        result = strategy.resolve_with_context(
            name="Olivia Jonson",
            requester_cm_id=1000001,
            year=2026,
            candidates=None,
            all_persons=None,
        )

        assert not result.is_resolved

    def test_self_reference_excluded_in_full_pool(self, strategy_with_repos):
        """Requester's own cm_id is excluded from matches even in full pool."""
        strategy, _, _ = strategy_with_repos

        self_person = Person(cm_id=1000001, first_name="Olivia", last_name="Johnson")
        all_persons = [self_person]

        result = strategy.resolve_with_context(
            name="Olivia Jonson",
            requester_cm_id=1000001,
            year=2026,
            candidates=None,
            all_persons=all_persons,
        )

        assert not result.is_resolved


class TestFuzzyMatchDefaultOverrideMechanism:
    """Verify that FuzzyMatchStrategy._default_same_session_boost=0.0 overrides
    BaseMatchStrategy._default_same_session_boost=0.05 when config is empty."""

    @pytest.fixture
    def strategy_with_empty_config(self):
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_by_person_and_year.return_value = None
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        mock_person_repo.find_by_normalized_name.return_value = []
        mock_person_repo.find_by_first_name.return_value = []
        mock_person_repo.name_cache = {}
        mock_person_repo.find_by_first_and_parent_surname.return_value = []
        return FuzzyMatchStrategy(mock_person_repo, mock_attendee_repo, config={})

    def test_same_session_no_boost_with_empty_config(self, strategy_with_empty_config):
        """FuzzyMatchStrategy with empty config gives no boost for same session.

        FuzzyMatchStrategy._default_same_session_boost = 0.0 overrides the base
        class default of 0.05, so same-session matches get no boost.
        """
        strategy = strategy_with_empty_config
        result = strategy._apply_session_adjustment_simple(
            base_confidence=0.75,
            person_session=1001,
            requester_session=1001,  # same session
        )
        # No boost: 0.75 + 0.0 = 0.75 (not 0.80 which would be base default + 0.05)
        assert result == pytest.approx(0.75)

    def test_base_class_would_give_boost_with_empty_config(self):
        """Confirm BaseMatchStrategy with empty config DOES give the 0.05 boost.

        This demonstrates the override mechanism is working: FuzzyMatchStrategy
        suppresses what BaseMatchStrategy would otherwise provide.
        """
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            BaseMatchStrategy,
        )

        class ConcreteBase(BaseMatchStrategy):
            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult(confidence=0.0, method=self.name)

        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        base = ConcreteBase(mock_person_repo, mock_attendee_repo, config={})
        result = base._apply_session_adjustment_simple(
            base_confidence=0.75,
            person_session=1001,
            requester_session=1001,
        )
        # Base class default boost is 0.05 → 0.75 + 0.05 = 0.80
        assert result == pytest.approx(0.80)


class TestNormalizedSearchMergeFallback:
    """Component 2: _try_normalized_search single-name fallback merges matches
    across the original first name and nickname variants instead of breaking on
    the first matching variant.

    Bug pattern: searching "Katherine" with no full-name candidates falls into
    the variant loop. Original behavior: iterates `find_nickname_variations`
    only (skipping the original) and breaks on the first variant with any
    match. If year-filtering narrows that variant to one wrong-session person,
    the resolver silently picks that wrong person.

    Fix: merge matches across [original, *variants], dedup by cm_id, then let
    `_disambiguate_with_session` pick the unique same-session candidate.
    """

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
        person_repo.find_by_normalized_name.return_value = []
        person_repo.find_by_first_name.return_value = []
        person_repo.find_by_name.return_value = []
        return FuzzyMatchStrategy(person_repository=person_repo, attendee_repository=attendee_repo)

    def test_merge_original_with_variants_session_disambiguates_winner(self, strategy, mock_repositories):
        """Pool has 1 same-session Katherine, 8 other-session Katherines, 1 Kate (variant),
        3 Kits (variant). Merge produces 13 candidates; session disambiguation picks the
        unique same-session Katherine at session_match base (0.85)."""
        person_repo, attendee_repo = mock_repositories
        same_session_katherine = Person(cm_id=100, first_name="Katherine", last_name="Smith")
        other_katherines = [Person(cm_id=100 + i, first_name="Katherine", last_name=f"Other{i}") for i in range(1, 9)]
        kate = Person(cm_id=200, first_name="Kate", last_name="Chen")
        kits = [Person(cm_id=300 + i, first_name="Kit", last_name=f"K{i}") for i in range(3)]

        def first_name_search(name, year=None):
            n = name.lower()
            if n == "katherine":
                return [same_session_katherine, *other_katherines]
            if n == "kate":
                return [kate]
            if n == "kit":
                return kits
            return []

        person_repo.find_by_first_name.side_effect = first_name_search

        attendee_sessions = {100: 1001}
        for k in other_katherines:
            attendee_sessions[k.cm_id] = 2001
        attendee_sessions[200] = 3001  # Kate — different session
        for k in kits:
            attendee_sessions[k.cm_id] = 2001
        attendee_repo.bulk_get_sessions_for_persons.side_effect = lambda cm_ids, year: {
            cm_id: attendee_sessions.get(cm_id) for cm_id in cm_ids
        }

        result = strategy.resolve("Katherine", requester_cm_id=999, session_cm_id=1001, year=2026)

        assert result.is_resolved, (
            f"expected resolved; got is_resolved={result.is_resolved}, candidates={len(result.candidates or [])}"
        )
        assert result.person.cm_id == 100, (
            f"expected Katherine Smith (cm_id=100); got cm_id={result.person.cm_id} "
            f"(name={result.person.first_name} {result.person.last_name})"
        )
        assert result.confidence == 0.85
        assert result.metadata.get("sub_method") == "first_name_merged", (
            f"expected sub_method='first_name_merged'; got {result.metadata.get('sub_method')!r}"
        )

    def test_merge_filters_self_reference(self, strategy, mock_repositories):
        """The requester is filtered out of merged matches even if they share the searched name."""
        person_repo, attendee_repo = mock_repositories
        requester = Person(cm_id=999, first_name="Katherine", last_name="Requester")
        other = Person(cm_id=100, first_name="Katherine", last_name="Smith")
        person_repo.find_by_first_name.side_effect = lambda name, year=None: (
            [requester, other] if name.lower() == "katherine" else []
        )
        attendee_repo.bulk_get_sessions_for_persons.side_effect = lambda cm_ids, year: {cm_id: 1001 for cm_id in cm_ids}
        result = strategy.resolve("Katherine", requester_cm_id=999, session_cm_id=1001, year=2026)
        if result.is_resolved:
            assert result.person.cm_id != 999, "requester was not filtered from candidates"

    def test_merge_falls_through_to_variants_when_original_empty(self, strategy, mock_repositories):
        """When the original first name finds 0 matches, variants must still be tried."""
        person_repo, attendee_repo = mock_repositories
        kate = Person(cm_id=200, first_name="Kate", last_name="Chen")
        person_repo.find_by_first_name.side_effect = lambda name, year=None: [kate] if name.lower() == "kate" else []
        attendee_repo.bulk_get_sessions_for_persons.side_effect = lambda cm_ids, year: {cm_id: 1001 for cm_id in cm_ids}
        result = strategy.resolve("Katherine", requester_cm_id=999, session_cm_id=1001, year=2026)
        assert result.is_resolved, "variants must still be tried when original returns empty"
        assert result.person.cm_id == 200

    def test_merge_two_same_session_candidates_returns_ambiguous(self, strategy, mock_repositories):
        """Two same-session Katherines: disambiguation can't pick a unique winner, returns
        ambiguous at 0.5 for staff review. Documented behavior of _disambiguate_with_session."""
        person_repo, attendee_repo = mock_repositories
        katherines = [
            Person(cm_id=100, first_name="Katherine", last_name="Smith"),
            Person(cm_id=101, first_name="Katherine", last_name="Jones"),
        ]
        person_repo.find_by_first_name.side_effect = lambda name, year=None: (
            katherines if name.lower() == "katherine" else []
        )
        attendee_repo.bulk_get_sessions_for_persons.side_effect = lambda cm_ids, year: {cm_id: 1001 for cm_id in cm_ids}
        result = strategy.resolve("Katherine", requester_cm_id=999, session_cm_id=1001, year=2026)
        assert not result.is_resolved
        assert len(result.candidates or []) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

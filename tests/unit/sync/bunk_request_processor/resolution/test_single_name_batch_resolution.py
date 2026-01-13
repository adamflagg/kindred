"""Test single-name batch resolution bug fix.

When batch_resolve() is called with single-name requests (e.g., "Johnny"),
the pipeline pre-loads candidates with an empty list [] instead of None.

Strategies must check `if not candidates:` instead of `if candidates is None:`
to properly fall back to DB queries for single names.

- Modular `ResolutionPipeline.batch_resolve()` (line 165) checks `len(name_parts) >= 2`
- Single names get empty list `[]`
- FuzzyMatch/PhoneticMatch/SchoolDisambiguation check `if candidates is None:`
- Should check `if not candidates:` to fall back to resolve()"""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.fuzzy_match import FuzzyMatchStrategy
from bunking.sync.bunk_request_processor.resolution.strategies.phonetic_match import PhoneticMatchStrategy
from bunking.sync.bunk_request_processor.resolution.strategies.school_disambiguation import SchoolDisambiguationStrategy


class TestSingleNameBatchResolution:
    """Test that resolve_with_context falls back to resolve() when candidates is empty list."""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories."""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        # Default return values
        mock_person_repo.find_by_name.return_value = []
        mock_person_repo.find_by_normalized_name.return_value = []
        mock_person_repo.find_by_first_name.return_value = []
        mock_person_repo.find_by_first_and_parent_surname.return_value = []
        mock_person_repo.get_all_for_phonetic_matching.return_value = []
        mock_attendee_repo.get_by_person_and_year.return_value = None
        mock_attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        return mock_person_repo, mock_attendee_repo

    def test_fuzzy_match_falls_back_with_empty_candidates(self, mock_repositories):
        """FuzzyMatchStrategy.resolve_with_context should fall back to resolve()
        when candidates is an empty list [], not just when None.

        This is the bug case: batch_resolve gives [] for single names,
        but resolve_with_context checks `if candidates is None:` which is False for [].
        """
        person_repo, attendee_repo = mock_repositories

        # Setup: DB has Michael, and "Mike" should resolve via nickname
        michael = Person(cm_id=12345, first_name="Michael", last_name="Smith")

        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "michael" and last.lower() == "smith":
                return [michael]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        # Create mock for normalized name search (used for first-name-only)
        def normalized_search_side_effect(name, year=None):
            if name.lower() == "michael":
                return [michael]
            return []

        person_repo.find_by_normalized_name.side_effect = normalized_search_side_effect

        # Mock find_by_first_name for nickname variations (Mike -> Michael)
        def find_by_first_name_side_effect(name, year=None):
            if name.lower() == "michael":
                return [michael]
            return []

        person_repo.find_by_first_name.side_effect = find_by_first_name_side_effect

        strategy = FuzzyMatchStrategy(person_repo, attendee_repo)

        # Call resolve_with_context with empty candidates list []
        # This simulates what happens when batch_resolve() is called with single name "Mike"
        result = strategy.resolve_with_context(
            name="Mike",  # Single name
            requester_cm_id=67890,
            session_cm_id=1000002,
            year=2025,
            candidates=[],  # Empty list, NOT None - this is the bug case
            attendee_info={},
        )

        # Should fall back to resolve() and find Michael via nickname
        # BUG: Currently returns confidence 0.0 because it doesn't fall back
        assert result.is_resolved or result.is_ambiguous, (
            "resolve_with_context should fall back to resolve() when candidates=[] "
            "and attempt to resolve via nickname/fuzzy matching"
        )

    def test_phonetic_match_falls_back_with_empty_candidates(self, mock_repositories):
        """PhoneticMatchStrategy.resolve_with_context uses all_persons fallback
        when candidates is an empty list [].

        Note: Implementation now uses all_persons parameter instead of calling resolve().
        """
        person_repo, attendee_repo = mock_repositories

        # Setup: DB has "Smith", and "Smyth" should resolve via phonetic match
        # Return Person objects, not dicts (as the real repo would)
        smith = Person(cm_id=12345, first_name="John", last_name="Smith")
        person_repo.get_all_for_phonetic_matching.return_value = [smith]
        attendee_repo.bulk_get_sessions_for_persons.return_value = {12345: 1000002}

        strategy = PhoneticMatchStrategy(person_repo, attendee_repo)

        # Call resolve_with_context with empty candidates list []
        # Pass all_persons as the fallback pool (replaces resolve() fallback)
        result = strategy.resolve_with_context(
            name="John Smyth",  # Phonetically similar to Smith
            requester_cm_id=67890,
            session_cm_id=1000002,
            year=2025,
            candidates=[],  # Empty list triggers all_persons fallback
            attendee_info={},
            all_persons=[smith],  # Fallback pool for phonetic matching
        )

        # Should use all_persons fallback and find Smith via phonetic matching
        assert result.is_resolved or result.is_ambiguous, (
            "resolve_with_context should use all_persons fallback when candidates=[] and attempt phonetic matching"
        )

    def test_school_disambiguation_falls_back_with_empty_candidates(self, mock_repositories):
        """SchoolDisambiguationStrategy.resolve_with_context uses all_persons fallback
        when candidates is an empty list [].

        Note: Implementation now uses all_persons parameter instead of calling resolve().
        """
        person_repo, attendee_repo = mock_repositories

        # Setup: Two Johns, one at same school as requester
        john1 = Person(cm_id=12345, first_name="John", last_name="Smith", school="Lincoln Elementary")
        john2 = Person(cm_id=67891, first_name="John", last_name="Smith", school="Washington Elementary")

        def find_by_name_side_effect(first, last, year=None):
            if first.lower() == "john" and last.lower() == "smith":
                return [john1, john2]
            return []

        person_repo.find_by_name.side_effect = find_by_name_side_effect

        # Requester is at Lincoln Elementary - must be a proper Person object
        requester = Person(cm_id=11111, first_name="Alice", last_name="Jones", school="Lincoln Elementary")

        # Return the requester when finding by cm_id
        def find_by_cm_id_side_effect(cm_id):
            if cm_id == 11111:
                return requester
            return None

        person_repo.find_by_cm_id.side_effect = find_by_cm_id_side_effect

        strategy = SchoolDisambiguationStrategy(person_repo, attendee_repo)

        # Call resolve_with_context with empty candidates list []
        # Pass all_persons as the fallback pool (replaces resolve() fallback)
        result = strategy.resolve_with_context(
            name="John Smith",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
            candidates=[],  # Empty list triggers all_persons fallback
            attendee_info={},
            all_persons=[john1, john2],  # Fallback pool for school disambiguation
        )

        # Should use all_persons fallback and try school disambiguation
        # Note: Resolution may find john1 (same school) or be ambiguous
        assert result.is_resolved or result.is_ambiguous, (
            "resolve_with_context should use all_persons fallback when candidates=[] and attempt school disambiguation"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

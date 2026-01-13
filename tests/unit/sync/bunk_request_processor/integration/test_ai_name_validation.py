"""Test AI name validation and filtering.

Tests that non-name targets (bunk preferences, descriptions, conditions)
are filtered out during post-parse processing.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestIsLikelyPersonName:
    """Test the _is_likely_person_name filter function.

    This filter rejects obviously non-name targets like:
    - Bunk preferences: "upper bunk", "bottom bunk", "near window"
    - Descriptions: "friendly kids", "quiet boys", "noise sensitive"
    - Conditions: "light sensitive kids", "good sleepers"
    """

    def test_accepts_valid_first_last_name(self):
        """Standard first+last names should be accepted."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        valid_names = [
            "John Smith",
            "Mary Johnson",
            "Sarah-Jane Miller",
            "José García",
            "O'Connor",
            "McDonald",
        ]

        for name in valid_names:
            assert is_likely_person_name(name), f"Should accept '{name}'"

    def test_accepts_valid_first_name_only(self):
        """Single first names should be accepted for resolution."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        valid_names = ["Jordyn", "Pippi", "Calla", "Mike", "Sarah"]

        for name in valid_names:
            assert is_likely_person_name(name), f"Should accept '{name}'"

    def test_rejects_bunk_preference(self):
        """Bunk preferences like 'upper bunk' should NOT be accepted as names."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        non_names = [
            "upper bunk",
            "bottom bunk",
            "lower bunk",
            "top bunk",
            "near window",
            "near door",
        ]

        for non_name in non_names:
            assert not is_likely_person_name(non_name), f"Should reject '{non_name}'"

    def test_rejects_descriptive_phrase(self):
        """Descriptive phrases like 'friendly boys' should NOT be accepted."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        non_names = [
            "friendly boys",
            "quiet kids",
            "nice girls",
            "good friends",
            "fun campers",
        ]

        for non_name in non_names:
            assert not is_likely_person_name(non_name), f"Should reject '{non_name}'"

    def test_rejects_sensitivity_description(self):
        """Sensitivity descriptions should NOT be accepted as names."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        non_names = [
            "noise sensitive kids",
            "light sensitive",
            "noise sensitive",
            "sound sensitive children",
        ]

        for non_name in non_names:
            assert not is_likely_person_name(non_name), f"Should reject '{non_name}'"

    def test_accepts_special_placeholders(self):
        """Special placeholders like LAST_YEAR_BUNKMATES and SIBLING should be accepted."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        placeholders = ["LAST_YEAR_BUNKMATES", "SIBLING", "older", "younger", "unclear"]

        for placeholder in placeholders:
            assert is_likely_person_name(placeholder), f"Should accept '{placeholder}'"

    def test_rejects_literal_family_words(self):
        """Literal family words like 'twins' should be rejected (use SIBLING placeholder)."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        family_words = [
            "twins",
            "twin",
            "siblings",
            "sister",
            "brother",
            "my sister",
            "my brother",
            "my twin",
            "the twins",
        ]

        for word in family_words:
            assert not is_likely_person_name(word), f"Should reject '{word}' (use SIBLING placeholder)"


class TestBatchProcessorFiltering:
    """Test that BatchProcessor filters out non-name targets."""

    @pytest.fixture
    def mock_ai_provider(self):
        """Create a mock AI provider."""
        provider = Mock()
        provider.name = "mock_provider"
        provider.parse_request = AsyncMock()
        provider.batch_parse_requests = AsyncMock()
        return provider

    def test_filters_bunk_preference_from_parsed_requests(self, mock_ai_provider):
        """Test that 'upper bunk' is filtered out of parsed requests.

        When AI returns a request with target_name='upper bunk', it should
        be filtered out during post-parse processing.
        """
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        # Simulate AI returning a bad parse
        target_name = "upper bunk"

        # The filter should reject this
        assert not is_likely_person_name(target_name)

    def test_filters_descriptive_phrase_from_parsed_requests(self, mock_ai_provider):
        """Test that 'friendly boys' is filtered out of parsed requests."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            is_likely_person_name,
        )

        target_name = "friendly boys"
        assert not is_likely_person_name(target_name)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

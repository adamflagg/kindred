"""Tests for name normalization function.

TDD Red Phase: These tests define expected behavior for normalize_name().
The function should:
1. Lowercase the name
2. Strip leading/trailing whitespace
3. Collapse multiple spaces into single spaces
4. Remove punctuation: . , ' " ( )"""

from __future__ import annotations


class TestNormalizeName:
    """Test normalize_name parity with monolith."""

    def test_basic_lowercase(self):
        """Should convert to lowercase."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("John Smith") == "john smith"
        assert normalize_name("MARY JONES") == "mary jones"
        assert normalize_name("MiXeD CaSe") == "mixed case"

    def test_strip_whitespace(self):
        """Should strip leading and trailing whitespace."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("  John Smith  ") == "john smith"
        assert normalize_name("\t Mary Jones \n") == "mary jones"

    def test_collapse_whitespace(self):
        """Should collapse multiple spaces into single space."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        # Multiple internal spaces should collapse to one
        assert normalize_name("John    Smith") == "john smith"
        assert normalize_name("Mary   Jane   Jones") == "mary jane jones"
        # Tabs and newlines should also collapse
        assert normalize_name("John\t\tSmith") == "john smith"

    def test_remove_period(self):
        """Should remove periods."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("Dr. John Smith") == "dr john smith"
        assert normalize_name("John Smith Jr.") == "john smith jr"
        assert normalize_name("J. Robert Smith") == "j robert smith"

    def test_remove_comma(self):
        """Should remove commas."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("Smith, John") == "smith john"
        assert normalize_name("John, Jr") == "john jr"

    def test_remove_apostrophe(self):
        """Should remove apostrophes."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("O'Brien") == "obrien"
        assert normalize_name("Mary O'Connor") == "mary oconnor"

    def test_remove_quotes(self):
        """Should remove double quotes."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name('John "Johnny" Smith') == "john johnny smith"
        assert normalize_name('"Nickname" LastName') == "nickname lastname"

    def test_remove_parentheses(self):
        """Should remove parentheses."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("John (Johnny) Smith") == "john johnny smith"
        assert normalize_name("Mary (prefers May)") == "mary prefers may"

    def test_combined_normalization(self):
        """Should handle multiple normalizations at once."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        # Real-world example with multiple issues
        result = normalize_name("  Dr. John  O'Brien  (Johnny)  ")
        assert result == "dr john obrien johnny"

        # Another complex example
        result = normalize_name('Smith, Mary "Mae" Jr.')
        assert result == "smith mary mae jr"

    def test_empty_string(self):
        """Should handle empty string."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("") == ""

    def test_only_whitespace(self):
        """Should handle whitespace-only string."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("   ") == ""
        assert normalize_name("\t\n") == ""

    def test_hyphen_preserved(self):
        """Hyphens should be preserved."""
        from bunking.sync.bunk_request_processor.shared.name_utils import normalize_name

        assert normalize_name("Mary-Jane Smith") == "mary-jane smith"
        assert normalize_name("Anne-Marie O'Sullivan") == "anne-marie osullivan"

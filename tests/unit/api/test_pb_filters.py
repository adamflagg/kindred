"""Tests for PocketBase filter escape utility."""

from api.utils.pb_filters import pb_escape


class TestPbEscape:
    def test_plain_string_unchanged(self):
        assert pb_escape("Springfield") == "Springfield"

    def test_empty_string(self):
        assert pb_escape("") == ""

    def test_escapes_double_quotes(self):
        assert pb_escape('say "hello"') == 'say \\"hello\\"'

    def test_escapes_single_quotes(self):
        assert pb_escape("it's") == "it\\'s"

    def test_escapes_backslashes(self):
        assert pb_escape("path\\to") == "path\\\\to"

    def test_escapes_backslash_before_quotes(self):
        """Backslash must be escaped first to avoid double-escaping."""
        assert pb_escape('a\\"b') == 'a\\\\\\"b'

    def test_injection_attempt_neutralized(self):
        malicious = '" || id != "'
        result = pb_escape(malicious)
        assert '"' not in result or result.count('\\"') == result.count('"')
        assert "||" in result  # The operator is just text, not dangerous when quoted

    def test_unicode_preserved(self):
        assert pb_escape("Zürich") == "Zürich"
        assert pb_escape("São Paulo") == "São Paulo"

    def test_newlines_and_tabs(self):
        assert pb_escape("line1\nline2") == "line1\nline2"

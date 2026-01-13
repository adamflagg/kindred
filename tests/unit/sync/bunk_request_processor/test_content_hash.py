"""Tests for per-field content hash utility.

TDD Red Phase: These tests define the expected behavior for content hashing
used to detect changes in individual bunk request fields."""

from __future__ import annotations


class TestContentHash:
    """Test content hash calculation for change detection."""

    def test_hash_returns_consistent_value_for_same_content(self):
        """Same content should always produce the same hash."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        content = "Johnny and Sarah"
        hash1 = calculate_content_hash(content)
        hash2 = calculate_content_hash(content)

        assert hash1 == hash2
        assert isinstance(hash1, str)
        assert len(hash1) == 32  # MD5 hex digest length

    def test_hash_differs_for_different_content(self):
        """Different content should produce different hashes."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        hash1 = calculate_content_hash("Johnny")
        hash2 = calculate_content_hash("Johnny and Sarah")

        assert hash1 != hash2

    def test_hash_handles_empty_string(self):
        """Empty string should produce a valid hash."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        hash_value = calculate_content_hash("")

        assert isinstance(hash_value, str)
        assert len(hash_value) == 32

    def test_hash_handles_none_as_empty(self):
        """None should be treated as empty string."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        hash_none = calculate_content_hash(None)
        hash_empty = calculate_content_hash("")

        assert hash_none == hash_empty

    def test_hash_is_case_sensitive(self):
        """Hash should be case-sensitive (preserve exact content)."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        hash_lower = calculate_content_hash("johnny")
        hash_upper = calculate_content_hash("Johnny")

        assert hash_lower != hash_upper

    def test_hash_preserves_whitespace_differences(self):
        """Whitespace differences should produce different hashes."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        hash1 = calculate_content_hash("Johnny and Sarah")
        hash2 = calculate_content_hash("Johnny  and  Sarah")

        assert hash1 != hash2

    def test_hash_handles_unicode(self):
        """Unicode content should be hashed correctly."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
        )

        content = "Señor García wants to bunk with José"
        hash_value = calculate_content_hash(content)

        assert isinstance(hash_value, str)
        assert len(hash_value) == 32


class TestContentChanged:
    """Test content change detection helper."""

    def test_content_changed_returns_true_when_different(self):
        """Should return True when content has changed."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
            content_changed,
        )

        old_hash = calculate_content_hash("Johnny")
        new_content = "Johnny and Sarah"

        assert content_changed(new_content, old_hash) is True

    def test_content_changed_returns_false_when_same(self):
        """Should return False when content is unchanged."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
            content_changed,
        )

        content = "Johnny and Sarah"
        stored_hash = calculate_content_hash(content)

        assert content_changed(content, stored_hash) is False

    def test_content_changed_with_no_stored_hash(self):
        """Should return True when no previous hash exists (new record)."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            content_changed,
        )

        assert content_changed("Johnny", None) is True
        assert content_changed("Johnny", "") is True

    def test_content_changed_empty_to_populated(self):
        """Should detect change from empty to populated."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
            content_changed,
        )

        empty_hash = calculate_content_hash("")
        new_content = "Johnny"

        assert content_changed(new_content, empty_hash) is True

    def test_content_changed_populated_to_empty(self):
        """Should detect change from populated to empty."""
        from bunking.sync.bunk_request_processor.utils.content_hash import (
            calculate_content_hash,
            content_changed,
        )

        populated_hash = calculate_content_hash("Johnny")
        new_content = ""

        assert content_changed(new_content, populated_hash) is True

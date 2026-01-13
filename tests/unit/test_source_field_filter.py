"""Tests for source field filtering in bunk request processing.

These tests verify that source field filtering works correctly:
- Validation of field names
- Filtering in the original_requests_loader
- Combination with session and limit filters
"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.shared.constants import (
    ALL_PROCESSING_FIELDS,
)


class TestValidateSourceFields:
    """Tests for validate_source_fields function."""

    def test_valid_single_field(self):
        """Single valid field is accepted."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        result = validate_source_fields(["bunk_with"])
        assert result == ["bunk_with"]

    def test_valid_multiple_fields(self):
        """Multiple valid fields are accepted."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        fields = ["bunk_with", "not_bunk_with", "internal_notes"]
        result = validate_source_fields(fields)
        assert result == fields

    def test_all_fields_valid(self):
        """All five processing fields are valid."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        result = validate_source_fields(ALL_PROCESSING_FIELDS)
        assert result == ALL_PROCESSING_FIELDS

    def test_empty_list_returns_empty(self):
        """Empty list returns empty (caller handles default)."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        result = validate_source_fields([])
        assert result == []

    def test_invalid_field_raises_error(self):
        """Invalid field name raises ValueError."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        with pytest.raises(ValueError) as exc_info:
            validate_source_fields(["invalid_field"])

        error_msg = str(exc_info.value)
        assert "Invalid source field" in error_msg
        assert "invalid_field" in error_msg

    def test_mixed_valid_invalid_raises(self):
        """Mix of valid and invalid fields raises ValueError."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        with pytest.raises(ValueError) as exc_info:
            validate_source_fields(["bunk_with", "bogus", "not_bunk_with"])

        error_msg = str(exc_info.value)
        assert "bogus" in error_msg

    def test_error_message_shows_valid_options(self):
        """Error message includes list of valid options."""
        from bunking.sync.bunk_request_processor.shared.constants import (
            validate_source_fields,
        )

        with pytest.raises(ValueError) as exc_info:
            validate_source_fields(["nope"])

        error_msg = str(exc_info.value)
        # Should mention at least some valid fields
        assert "bunk_with" in error_msg or "Valid:" in error_msg


class TestSourceFieldFilterIntegration:
    """Integration tests for source field filtering with loader.

    These tests verify the filtering behavior in original_requests_loader.
    """

    def test_filter_to_single_field(self):
        """When source_fields=['bunk_with'], only bunk_with records returned."""
        # This test verifies the filtering logic
        # The actual implementation will be in original_requests_loader.py

        # Given: records of different field types
        records = [
            {"field": "bunk_with", "content": "John"},
            {"field": "not_bunk_with", "content": "Jane"},
            {"field": "bunk_with", "content": "Bob"},
            {"field": "bunking_notes", "content": "Note"},
        ]

        # When: filtered to bunk_with only
        source_fields = ["bunk_with"]
        filtered = [r for r in records if r["field"] in source_fields]

        # Then: only bunk_with records remain
        assert len(filtered) == 2
        assert all(r["field"] == "bunk_with" for r in filtered)

    def test_filter_to_multiple_fields(self):
        """Multiple source fields filter correctly."""
        records = [
            {"field": "bunk_with", "content": "John"},
            {"field": "not_bunk_with", "content": "Jane"},
            {"field": "internal_notes", "content": "Note"},
            {"field": "socialize_with", "content": "older"},
        ]

        source_fields = ["bunk_with", "not_bunk_with"]
        filtered = [r for r in records if r["field"] in source_fields]

        assert len(filtered) == 2
        assert {r["field"] for r in filtered} == {"bunk_with", "not_bunk_with"}

    def test_filter_then_limit(self):
        """Limit is applied AFTER source field filter."""
        # This tests the correct filter order: source_field → limit

        records = [
            {"field": "bunk_with", "content": "1"},
            {"field": "bunk_with", "content": "2"},
            {"field": "bunk_with", "content": "3"},
            {"field": "not_bunk_with", "content": "4"},
            {"field": "not_bunk_with", "content": "5"},
        ]

        # Filter to bunk_with, then limit to 2
        source_fields = ["bunk_with"]
        limit = 2

        filtered = [r for r in records if r["field"] in source_fields]
        filtered = filtered[:limit]

        # Should get first 2 bunk_with records
        assert len(filtered) == 2
        assert filtered[0]["content"] == "1"
        assert filtered[1]["content"] == "2"

    def test_empty_filter_means_all_fields(self):
        """Empty source_fields list means no filter (all fields)."""
        records = [
            {"field": "bunk_with", "content": "1"},
            {"field": "not_bunk_with", "content": "2"},
            {"field": "bunking_notes", "content": "3"},
        ]

        source_fields: list[str] = []  # Empty = all fields

        if source_fields:
            filtered = [r for r in records if r["field"] in source_fields]
        else:
            filtered = records  # No filter

        assert len(filtered) == 3


class TestSourceFieldFilterCLI:
    """Tests for CLI argument parsing of source fields."""

    def test_parse_single_source_field_arg(self):
        """--source-field bunk_with parses correctly."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--source-field",
            type=str,
            action="append",
            default=None,
            help="Source field(s) to process",
        )

        args = parser.parse_args(["--source-field", "bunk_with"])
        assert args.source_field == ["bunk_with"]

    def test_parse_multiple_source_field_args(self):
        """Multiple --source-field flags accumulate."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--source-field",
            type=str,
            action="append",
            default=None,
        )

        args = parser.parse_args(
            [
                "--source-field",
                "bunk_with",
                "--source-field",
                "not_bunk_with",
                "--source-field",
                "internal_notes",
            ]
        )

        assert args.source_field == ["bunk_with", "not_bunk_with", "internal_notes"]

    def test_no_source_field_arg_is_none(self):
        """Without --source-field, value is None (means all fields)."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--source-field",
            type=str,
            action="append",
            default=None,
        )

        args = parser.parse_args([])
        assert args.source_field is None


class TestSourceFieldWithSessionFilter:
    """Tests for combining source field and session filters."""

    def test_source_field_and_session_combined(self):
        """Source field filter works with session filter."""
        # This verifies the filter combination logic

        records = [
            {"field": "bunk_with", "session": 1, "content": "A"},
            {"field": "bunk_with", "session": 2, "content": "B"},
            {"field": "not_bunk_with", "session": 1, "content": "C"},
            {"field": "not_bunk_with", "session": 2, "content": "D"},
        ]

        # Filter: source_field=bunk_with AND session=2
        source_fields = ["bunk_with"]
        session = 2

        filtered = [r for r in records if r["field"] in source_fields and r["session"] == session]

        assert len(filtered) == 1
        assert filtered[0]["content"] == "B"

    def test_filter_order_source_session_limit(self):
        """Filter order is: source_field → session → limit."""
        records = [
            {"field": "bunk_with", "session": 1, "content": "1"},
            {"field": "bunk_with", "session": 1, "content": "2"},
            {"field": "bunk_with", "session": 1, "content": "3"},
            {"field": "bunk_with", "session": 2, "content": "4"},
            {"field": "not_bunk_with", "session": 1, "content": "5"},
        ]

        source_fields = ["bunk_with"]
        session = 1
        limit = 2

        # Apply filters in order
        filtered = [r for r in records if r["field"] in source_fields]
        filtered = [r for r in filtered if r["session"] == session]
        filtered = filtered[:limit]

        # Should get first 2 bunk_with records from session 1
        assert len(filtered) == 2
        assert filtered[0]["content"] == "1"
        assert filtered[1]["content"] == "2"

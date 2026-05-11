"""Tests for the source_from_field helper.

Pins the 6→2 deterministic mapping from source_field values to "family" / "staff"
strings. This is the authoritative spec — every other consumer derives from this.
"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.core.models import source_from_field
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class TestSourceFromFieldMapping:
    """Pin every source_field → string classification."""

    @pytest.mark.parametrize(
        ("source_field_value", "expected_source"),
        [
            (SourceField.BUNK_REQUEST_FORM, "family"),
            (SourceField.SOCIALIZE_WITH, "family"),
            (SourceField.STAFF_NOT_BUNK_WITH, "staff"),
            (SourceField.BUNKING_NOTES, "staff"),
            (SourceField.INTERNAL_NOTES, "staff"),
            (SourceField.MANUAL, "staff"),
        ],
        ids=[
            "bunk_with→family",
            "socialize_with→family",
            "not_bunk_with→staff",
            "bunking_notes→staff",
            "internal_notes→staff",
            "manual→staff",
        ],
    )
    def test_source_from_field_classification(self, source_field_value: str, expected_source: str) -> None:
        """source_from_field returns the correct string for each SourceField."""
        assert source_from_field(source_field_value) == expected_source

    def test_source_from_field_unknown_raises(self) -> None:
        """source_from_field raises ValueError for unknown/invalid field names."""
        with pytest.raises(ValueError, match="unknown source_field"):
            source_from_field("unknown_field")

    def test_source_from_field_empty_raises(self) -> None:
        """source_from_field raises ValueError for empty string."""
        with pytest.raises(ValueError, match="unknown source_field"):
            source_from_field("")

    def test_source_from_field_returns_string(self) -> None:
        """source_from_field always returns a plain string, not an enum."""
        result = source_from_field(SourceField.BUNK_REQUEST_FORM)
        assert isinstance(result, str)
        assert result in ("family", "staff")

    def test_bunk_with_and_socialize_with_are_both_family(self) -> None:
        """The two parent-visible fields both map to "family"."""
        assert source_from_field(SourceField.BUNK_REQUEST_FORM) == "family"
        assert source_from_field(SourceField.SOCIALIZE_WITH) == "family"

    def test_all_notes_fields_are_staff(self) -> None:
        """All four staff-written channels map to "staff"."""
        assert source_from_field(SourceField.STAFF_NOT_BUNK_WITH) == "staff"
        assert source_from_field(SourceField.BUNKING_NOTES) == "staff"
        assert source_from_field(SourceField.INTERNAL_NOTES) == "staff"
        assert source_from_field(SourceField.MANUAL) == "staff"

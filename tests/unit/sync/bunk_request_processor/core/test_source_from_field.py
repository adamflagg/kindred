"""Tests for source_from_field helper — Stage 1 of issue #1142.

Pins the 5→2 deterministic mapping from source_field values to RequestSource.
Every classification is locked here so any future drift is caught immediately.
"""

import pytest

from bunking.sync.bunk_request_processor.core.models import RequestSource, source_from_field
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class TestSourceFromFieldMapping:
    """Pin every source_field → RequestSource classification."""

    @pytest.mark.parametrize(
        ("source_field_value", "expected_source"),
        [
            (SourceField.BUNK_WITH, RequestSource.FAMILY),
            (SourceField.SOCIALIZE_WITH, RequestSource.FAMILY),
            (SourceField.NOT_BUNK_WITH, RequestSource.STAFF),
            (SourceField.BUNKING_NOTES, RequestSource.STAFF),
            (SourceField.INTERNAL_NOTES, RequestSource.STAFF),
        ],
        ids=[
            "bunk_with→FAMILY",
            "socialize_with→FAMILY",
            "not_bunk_with→STAFF",
            "bunking_notes→STAFF",
            "internal_notes→STAFF",
        ],
    )
    def test_source_from_field_classification(self, source_field_value: str, expected_source: RequestSource) -> None:
        """source_from_field returns the correct RequestSource for each SourceField."""
        assert source_from_field(source_field_value) == expected_source

    def test_source_from_field_unknown_raises(self) -> None:
        """source_from_field raises ValueError for unknown/invalid field names."""
        with pytest.raises(ValueError, match="unknown source_field"):
            source_from_field("unknown_field")

    def test_source_from_field_empty_raises(self) -> None:
        """source_from_field raises ValueError for empty string."""
        with pytest.raises(ValueError, match="unknown source_field"):
            source_from_field("")

    def test_source_from_field_returns_enum_member(self) -> None:
        """source_from_field always returns a RequestSource enum member."""
        result = source_from_field(SourceField.BUNK_WITH)
        assert isinstance(result, RequestSource)

    def test_bunk_with_and_socialize_with_are_both_family(self) -> None:
        """The two parent-visible fields both map to FAMILY."""
        assert source_from_field(SourceField.BUNK_WITH) == RequestSource.FAMILY
        assert source_from_field(SourceField.SOCIALIZE_WITH) == RequestSource.FAMILY

    def test_all_notes_fields_are_staff(self) -> None:
        """All three staff-written fields map to STAFF."""
        assert source_from_field(SourceField.NOT_BUNK_WITH) == RequestSource.STAFF
        assert source_from_field(SourceField.BUNKING_NOTES) == RequestSource.STAFF
        assert source_from_field(SourceField.INTERNAL_NOTES) == RequestSource.STAFF

"""Tests for bunking.satisfaction.bucket."""

from __future__ import annotations

import pytest

from bunking.satisfaction.bucket import (
    COUNTED_BUCKETS,
    RequestBucket,
    classify_request,
)


class TestClassifyRequest:
    @pytest.mark.parametrize(
        ("source_field", "expected_bucket"),
        [
            ("bunk_with", RequestBucket.MATERIAL_PARENT),
            ("socialize_with", RequestBucket.IMMATERIAL_PARENT),
            ("not_bunk_with", RequestBucket.STAFF),
            ("bunking_notes", RequestBucket.STAFF),
            ("internal_notes", RequestBucket.STAFF),
        ],
    )
    def test_known_source_fields_map_to_buckets(self, source_field: str, expected_bucket: RequestBucket) -> None:
        assert classify_request(source_field) is expected_bucket

    @pytest.mark.parametrize("bad_input", ["", "garbage", "BUNK_WITH", "bunk-with", "Notes"])
    def test_unknown_source_field_raises_value_error(self, bad_input: str) -> None:
        with pytest.raises(ValueError, match="unknown source_field"):
            classify_request(bad_input)


class TestCountedBuckets:
    def test_includes_material_parent_and_staff(self) -> None:
        assert RequestBucket.MATERIAL_PARENT in COUNTED_BUCKETS
        assert RequestBucket.STAFF in COUNTED_BUCKETS

    def test_excludes_immaterial_parent(self) -> None:
        assert RequestBucket.IMMATERIAL_PARENT not in COUNTED_BUCKETS

    def test_is_frozenset(self) -> None:
        assert isinstance(COUNTED_BUCKETS, frozenset)


class TestIsMaterialParentRequest:
    """Tests for is_material_parent_request helper."""

    def _req(self, source_field: str | None):
        """Create a mock request with the given source_field."""
        from unittest.mock import Mock

        r = Mock()
        r.source_field = source_field
        r.id = "rec123abc"
        return r

    def test_bunk_with_is_material_parent(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("bunk_with")) is True

    def test_socialize_with_is_not_material_parent(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("socialize_with")) is False

    def test_not_bunk_with_is_not_material_parent(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("not_bunk_with")) is False

    def test_bunking_notes_is_not_material_parent(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("bunking_notes")) is False

    def test_internal_notes_is_not_material_parent(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("internal_notes")) is False

    def test_empty_source_field_returns_false(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req("")) is False

    def test_none_source_field_returns_false(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        assert is_material_parent_request(self._req(None)) is False

    def test_unknown_source_field_returns_false(self):
        from bunking.satisfaction.bucket import is_material_parent_request

        # Defensive: don't crash on data-hygiene regressions.
        assert is_material_parent_request(self._req("nonsense_value")) is False

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

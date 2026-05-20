"""Tests for bunking.satisfaction.bucket."""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from bunking.satisfaction.bucket import (
    COUNTED_BUCKETS,
    RequestBucket,
    classify_request,
    is_counted_request,
    is_material_parent_request,
)


def _mock_request(source_field: str | None) -> Mock:
    """Build a Mock request with the given source_field for predicate tests."""
    r = Mock()
    r.source_field = source_field
    r.id = "rec123abc"
    return r


class TestClassifyRequest:
    @pytest.mark.parametrize(
        ("source_field", "expected_bucket"),
        [
            ("bunk_request_form", RequestBucket.MATERIAL_PARENT),
            ("socialize_with", RequestBucket.IMMATERIAL_PARENT),
            ("staff_not_bunk_with", RequestBucket.STAFF),
            ("bunking_notes", RequestBucket.STAFF),
            ("internal_notes", RequestBucket.STAFF),
        ],
    )
    def test_known_source_fields_map_to_buckets(self, source_field: str, expected_bucket: RequestBucket) -> None:
        assert classify_request(source_field) is expected_bucket

    @pytest.mark.parametrize(
        "bad_input", ["", "garbage", "BUNK_WITH", "bunk-with", "Notes", "bunk_with", "not_bunk_with"]
    )
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

    def test_bunk_with_is_material_parent(self) -> None:
        assert is_material_parent_request(_mock_request("bunk_request_form")) is True

    def test_socialize_with_is_not_material_parent(self) -> None:
        assert is_material_parent_request(_mock_request("socialize_with")) is False

    def test_not_bunk_with_is_not_material_parent(self) -> None:
        assert is_material_parent_request(_mock_request("staff_not_bunk_with")) is False

    def test_bunking_notes_is_not_material_parent(self) -> None:
        assert is_material_parent_request(_mock_request("bunking_notes")) is False

    def test_internal_notes_is_not_material_parent(self) -> None:
        assert is_material_parent_request(_mock_request("internal_notes")) is False

    def test_empty_source_field_returns_false(self) -> None:
        assert is_material_parent_request(_mock_request("")) is False

    def test_none_source_field_returns_false(self) -> None:
        assert is_material_parent_request(_mock_request(None)) is False

    def test_unknown_source_field_returns_false(self) -> None:
        # Defensive: don't crash on data-hygiene regressions.
        assert is_material_parent_request(_mock_request("nonsense_value")) is False


class TestIsCountedRequest:
    """Tests for is_counted_request helper (MATERIAL_PARENT ∪ STAFF)."""

    @pytest.mark.parametrize(
        ("source_field", "expected"),
        [
            ("bunk_request_form", True),  # MATERIAL_PARENT — counted
            ("staff_not_bunk_with", True),  # STAFF — counted
            ("bunking_notes", True),  # STAFF — counted
            ("internal_notes", True),  # STAFF — counted
            ("socialize_with", False),  # IMMATERIAL_PARENT — NOT counted
        ],
    )
    def test_known_source_fields(self, source_field: str, expected: bool) -> None:
        assert is_counted_request(_mock_request(source_field)) is expected

    def test_none_source_field_returns_false(self) -> None:
        """Defensive: missing source_field treated as not-counted (mirrors is_material_parent_request)."""
        assert is_counted_request(_mock_request(None)) is False

    def test_empty_source_field_returns_false(self) -> None:
        assert is_counted_request(_mock_request("")) is False

    def test_unknown_source_field_returns_false(self) -> None:
        """Defensive: unknown source_field returns False without crashing."""
        assert is_counted_request(_mock_request("unknown_field_name")) is False


def test_classify_request_handles_renamed_source_fields() -> None:
    """After Phase 1 rename, the renamed strings must still classify correctly."""
    from bunking.satisfaction.bucket import RequestBucket, classify_request

    assert classify_request("bunk_request_form") == RequestBucket.MATERIAL_PARENT
    assert classify_request("staff_not_bunk_with") == RequestBucket.STAFF

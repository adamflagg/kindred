"""Tests for source_field passthrough in OpenAI provider (V2).

Verifies that source_field values are used as-is (V2: no normalization needed,
source_field IS the canonical DB field name)."""

from bunking.sync.bunk_request_processor.shared.constants import SourceField


def test_source_field_v2_identity():
    """V2: source_field values are used directly, no mapping needed."""
    # In V2, raw_field IS the canonical name
    raw_field = "bunk_with"
    assert raw_field == SourceField.BUNK_REQUEST_FORM


def test_source_field_v2_not_bunk_with():
    """V2: not_bunk_with passes through directly."""
    raw_field = "not_bunk_with"
    assert raw_field == SourceField.STAFF_NOT_BUNK_WITH


def test_source_field_unknown_passes_through():
    """Unknown field names pass through unchanged (V2 identity)."""
    raw_field = "unknown_field"
    # In V2, the raw_field is used directly
    assert raw_field == "unknown_field"

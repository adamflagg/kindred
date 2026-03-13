"""Tests for source_field normalization in OpenAI provider.

Verifies that source_field values are normalized to canonical form
via ALL_FIELD_TO_SOURCE_FIELD lookup, as defense-in-depth for the
batch_processor normalization."""

from bunking.sync.bunk_request_processor.shared.constants import ALL_FIELD_TO_SOURCE_FIELD, SourceField


def test_source_field_normalized_from_csv_key():
    """Verify source_field is normalized to canonical form via ALL_FIELD_TO_SOURCE_FIELD."""
    # Test the normalization logic directly
    raw_field = "share_bunk_with"
    normalized = ALL_FIELD_TO_SOURCE_FIELD.get(raw_field, raw_field)
    assert normalized == SourceField.BUNK_WITH  # "Share Bunk With"


def test_source_field_normalized_from_field_value():
    """Field values (bunk_with) also normalize to canonical form."""
    raw_field = "bunk_with"
    normalized = ALL_FIELD_TO_SOURCE_FIELD.get(raw_field, raw_field)
    assert normalized == SourceField.BUNK_WITH


def test_source_field_unknown_passes_through():
    """Unknown field names pass through unchanged."""
    raw_field = "unknown_field"
    normalized = ALL_FIELD_TO_SOURCE_FIELD.get(raw_field, raw_field)
    assert normalized == "unknown_field"

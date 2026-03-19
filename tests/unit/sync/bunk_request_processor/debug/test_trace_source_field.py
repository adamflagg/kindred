"""Test that source_field is passed through as-is in debug pipeline data (V2: identity)."""

from bunking.sync.bunk_request_processor.debug.trace_collector import _canonical_to_internal_field


def test_canonical_to_internal_bunk_with():
    """V2 field names pass through unchanged."""
    assert _canonical_to_internal_field("bunk_with") == "bunk_with"


def test_canonical_to_internal_not_bunk_with():
    assert _canonical_to_internal_field("not_bunk_with") == "not_bunk_with"


def test_canonical_to_internal_bunking_notes():
    assert _canonical_to_internal_field("bunking_notes") == "bunking_notes"


def test_canonical_to_internal_internal_notes():
    assert _canonical_to_internal_field("internal_notes") == "internal_notes"


def test_canonical_to_internal_socialize():
    assert _canonical_to_internal_field("socialize_with") == "socialize_with"


def test_unknown_passes_through():
    assert _canonical_to_internal_field("unknown_field") == "unknown_field"

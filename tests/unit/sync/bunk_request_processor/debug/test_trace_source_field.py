"""Test that source_field is normalized to internal names in debug pipeline data."""

from bunking.sync.bunk_request_processor.debug.trace_collector import _canonical_to_internal_field


def test_canonical_to_internal_bunk_with():
    assert _canonical_to_internal_field("Share Bunk With") == "bunk_with"


def test_canonical_to_internal_not_bunk_with():
    assert _canonical_to_internal_field("Do Not Share Bunk With") == "not_bunk_with"


def test_canonical_to_internal_bunking_notes():
    assert _canonical_to_internal_field("BunkingNotes Notes") == "bunking_notes"


def test_canonical_to_internal_internal_notes():
    assert _canonical_to_internal_field("Internal Bunk Notes") == "internal_notes"


def test_canonical_to_internal_socialize():
    assert _canonical_to_internal_field("RetParent-Socializewithbest") == "socialize_with"


def test_already_internal_passes_through():
    assert _canonical_to_internal_field("bunk_with") == "bunk_with"


def test_unknown_passes_through():
    assert _canonical_to_internal_field("unknown_field") == "unknown_field"

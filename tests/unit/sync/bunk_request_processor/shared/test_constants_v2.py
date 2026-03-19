"""Test that source field constants use V2 internal names.

Uses importlib to import the constants module directly, bypassing the
bunking package __init__.py which triggers a transitive import chain
that includes files not yet updated for V2 (Tasks 8-9).
"""

import importlib.util
import sys
from pathlib import Path

# Load the constants module directly to avoid transitive import breakage
_spec = importlib.util.spec_from_file_location(
    "constants_v2_under_test",
    Path(__file__).resolve().parents[5] / "bunking" / "sync" / "bunk_request_processor" / "shared" / "constants.py",
)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
sys.modules[_spec.name] = _mod  # type: ignore[union-attr]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

SourceField = _mod.SourceField
ALL_PROCESSING_FIELDS = _mod.ALL_PROCESSING_FIELDS
FIELDS_TO_CHECK = _mod.FIELDS_TO_CHECK
SOURCE_FIELD_TO_CONFIG_KEY = _mod.SOURCE_FIELD_TO_CONFIG_KEY


def test_source_field_values_are_v2():
    """SourceField constants must be V2 internal names, not V1 CSV headers."""
    assert SourceField.BUNK_WITH == "bunk_with"
    assert SourceField.NOT_BUNK_WITH == "not_bunk_with"
    assert SourceField.BUNKING_NOTES == "bunking_notes"
    assert SourceField.INTERNAL_NOTES == "internal_notes"
    assert SourceField.SOCIALIZE_WITH == "socialize_with"


def test_fields_to_check_is_v2_list():
    """FIELDS_TO_CHECK should be a flat list of V2 names."""
    assert isinstance(FIELDS_TO_CHECK, list)
    assert all(isinstance(f, str) for f in FIELDS_TO_CHECK)
    assert FIELDS_TO_CHECK == ["bunk_with", "not_bunk_with", "bunking_notes", "internal_notes", "socialize_with"]


def test_fields_to_check_matches_all_processing():
    """FIELDS_TO_CHECK should contain the same fields as ALL_PROCESSING_FIELDS."""
    assert set(FIELDS_TO_CHECK) == set(ALL_PROCESSING_FIELDS)


def test_source_field_to_config_key_uses_v2():
    """SOURCE_FIELD_TO_CONFIG_KEY should have V2 keys."""
    for key in SOURCE_FIELD_TO_CONFIG_KEY:
        assert "_" in key or key == "bunk_with", f"Key '{key}' doesn't look like V2"
    assert "bunk_with" in SOURCE_FIELD_TO_CONFIG_KEY
    assert "Share Bunk With" not in SOURCE_FIELD_TO_CONFIG_KEY


def test_no_v1_strings_in_source_field():
    """No V1 CampMinder CSV header strings should exist in SourceField."""
    v1_strings = {
        "Share Bunk With",
        "Do Not Share Bunk With",
        "BunkingNotes Notes",
        "Internal Bunk Notes",
        "RetParent-Socializewithbest",
    }
    source_field_values = {
        SourceField.BUNK_WITH,
        SourceField.NOT_BUNK_WITH,
        SourceField.BUNKING_NOTES,
        SourceField.INTERNAL_NOTES,
        SourceField.SOCIALIZE_WITH,
    }
    assert source_field_values.isdisjoint(v1_strings)


def test_deleted_v1_mappings():
    """V1 mapping dictionaries should no longer exist in the constants module."""
    assert not hasattr(_mod, "FIELD_TO_SOURCE_FIELD"), "FIELD_TO_SOURCE_FIELD should be deleted"
    assert not hasattr(_mod, "CSV_KEY_TO_SOURCE_FIELD"), "CSV_KEY_TO_SOURCE_FIELD should be deleted"
    assert not hasattr(_mod, "ALL_FIELD_TO_SOURCE_FIELD"), "ALL_FIELD_TO_SOURCE_FIELD should be deleted"

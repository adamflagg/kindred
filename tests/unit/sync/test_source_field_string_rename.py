"""Drift guard: SourceField string values must not collide with RequestType.

#1246 (closed via PR #1312) disambiguated Python attribute names. This test
pins the V2 wire format change that completes the cleanup — string values must
NOT equal any RequestType value.
"""

from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import (
    ALL_PROCESSING_FIELDS,
    AI_PROCESSING_FIELDS,
    SourceField,
)


def test_bunk_request_form_value() -> None:
    assert SourceField.BUNK_REQUEST_FORM == "bunk_request_form"


def test_staff_not_bunk_with_value() -> None:
    assert SourceField.STAFF_NOT_BUNK_WITH == "staff_not_bunk_with"


def test_no_source_field_collides_with_request_type() -> None:
    """No SourceField string value may equal a RequestType string value."""
    source_values = {
        SourceField.BUNK_REQUEST_FORM,
        SourceField.STAFF_NOT_BUNK_WITH,
        SourceField.BUNKING_NOTES,
        SourceField.INTERNAL_NOTES,
        SourceField.SOCIALIZE_WITH,
        SourceField.MANUAL,
    }
    request_type_values = {rt.value for rt in RequestType}
    overlap = source_values & request_type_values
    assert overlap == set(), f"SourceField/RequestType string collision: {overlap}"


def test_all_processing_fields_match_source_field_enum() -> None:
    """ALL_PROCESSING_FIELDS must use the canonical SourceField string values."""
    assert SourceField.BUNK_REQUEST_FORM in ALL_PROCESSING_FIELDS
    assert SourceField.STAFF_NOT_BUNK_WITH in ALL_PROCESSING_FIELDS
    assert "bunk_with" not in ALL_PROCESSING_FIELDS
    assert "not_bunk_with" not in ALL_PROCESSING_FIELDS


def test_ai_processing_fields_match_source_field_enum() -> None:
    assert SourceField.BUNK_REQUEST_FORM in AI_PROCESSING_FIELDS
    assert SourceField.STAFF_NOT_BUNK_WITH in AI_PROCESSING_FIELDS
    assert "bunk_with" not in AI_PROCESSING_FIELDS
    assert "not_bunk_with" not in AI_PROCESSING_FIELDS

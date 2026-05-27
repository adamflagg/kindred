"""Pin the unknown-source_field fallback in the deduplicator.

After #1142 Stage 4, `BunkRequest` has no `.source` attribute. The fallback
when `source_field` is empty/unknown must return the string "family" directly
(matches the historical read-path default).
"""

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.processing.deduplicator import _resolve_source


def _req(source_field: str) -> BunkRequest:
    return BunkRequest(
        requester_cm_id=1,
        requested_cm_id=2,
        request_type=RequestType.BUNK_WITH,
        session_cm_id=1000001,
        is_first_requested=True,
        confidence_score=0.9,
        source_field=source_field,
        csv_position=0,
        year=2026,
        status=RequestStatus.RESOLVED,
        metadata={},
    )


def test_resolve_source_known_field_family() -> None:
    assert _resolve_source(_req("bunk_request_form")) == "family"


def test_resolve_source_known_field_staff() -> None:
    assert _resolve_source(_req("staff_not_bunk_with")) == "staff"


def test_resolve_source_empty_field_falls_back_to_family() -> None:
    assert _resolve_source(_req("")) == "family"


def test_resolve_source_unknown_field_falls_back_to_family() -> None:
    assert _resolve_source(_req("garbage_value")) == "family"


def test_resolve_source_manual_field_returns_staff() -> None:
    """source_field='manual' is the admin-UI input channel — always staff-entered.

    Manually-created bunk requests (CreateRequestModal) write source_field='manual'
    as a marker. The 5-CSV-fields → 2-source projection must extend to recognize
    'manual' as the 6th canonical value, mapping to STAFF.
    """
    assert _resolve_source(_req("manual")) == "staff"

"""Pin the unknown-source_field fallback in the deduplicator.

After #1142 Stage 4, `BunkRequest` has no `.source` attribute. The fallback
when `source_field` is empty/unknown must return the string "family" directly
(matches the historical default at request_repository.py:565-567).
"""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.processing.deduplicator import _resolve_source


def _req(source_field: str, source: RequestSource = RequestSource.FAMILY) -> BunkRequest:
    return BunkRequest(
        requester_cm_id=1,
        requested_cm_id=2,
        request_type=RequestType.BUNK_WITH,
        session_cm_id=2025001,
        priority=4,
        confidence_score=0.9,
        source=source,  # still required pre-Stage-5; dropped in Task 6
        source_field=source_field,
        csv_position=0,
        year=2026,
        status=RequestStatus.RESOLVED,
        is_placeholder=False,
        metadata={},
    )


def test_resolve_source_known_field_family() -> None:
    # Even if in-memory source is STAFF, source_field='bunk_with' wins.
    assert _resolve_source(_req("bunk_with", source=RequestSource.STAFF)) == "family"


def test_resolve_source_known_field_staff() -> None:
    # Even if in-memory source is FAMILY, source_field='not_bunk_with' wins.
    assert _resolve_source(_req("not_bunk_with", source=RequestSource.FAMILY)) == "staff"


def test_resolve_source_empty_field_falls_back_to_family() -> None:
    # Unknown source_field must default to "family" regardless of in-memory source.
    assert _resolve_source(_req("", source=RequestSource.STAFF)) == "family"


def test_resolve_source_unknown_field_falls_back_to_family() -> None:
    assert _resolve_source(_req("garbage_value", source=RequestSource.STAFF)) == "family"

"""Pin write-path payload composition for bunk_requests.

Asserts that `RequestRepository._map_to_db()` does NOT include a `source` key
in the PocketBase payload — `source` is now derived from `source_field` at
read time and the column is being dropped (#1142 Stage 4).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
    RequestRepository,
)


def _make_request() -> BunkRequest:
    return BunkRequest(
        requester_cm_id=1001,
        requested_cm_id=1002,
        request_type=RequestType.BUNK_WITH,
        session_cm_id=2025001,
        priority=4,
        confidence_score=0.9,
        source_field="bunk_with",
        csv_position=0,
        year=2026,
        status=RequestStatus.RESOLVED,
        is_placeholder=False,
        metadata={},
    )


def test_map_to_db_omits_source_key() -> None:
    """Stage 4 of #1142: `source` is derived, never persisted."""
    repo = RequestRepository(MagicMock())

    payload = repo._map_to_db(_make_request())

    assert "source" not in payload, (
        f"Stage 4 violation: write payload still contains 'source' key: {sorted(payload.keys())}"
    )
    assert "source_field" in payload, "source_field must remain in payload"
    assert payload["source_field"] == "bunk_with"

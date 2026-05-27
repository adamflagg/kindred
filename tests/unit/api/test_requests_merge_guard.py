"""Router-level wiring tests for the NBW hard-separation merge guard.

The pure predicate (`would_downgrade_hard_separation`) is unit-tested in
tests/unit/bunking/satisfaction/test_request_registry.py. These tests assert
the ENDPOINT wiring: `merge_requests` calls the predicate and raises 400 when a
hard staff/manual not_bunk_with would be collapsed with a parent/notes
not_bunk_with for the same pair, while a safe two-parent NBW merge is NOT
blocked.

The endpoint is an `async def`; we drive it directly via `asyncio.run(...)`,
leaving the `user` param as its `Depends(...)` default (the guard never reads
`user`). Module-level repository factories are monkeypatched to return Mocks so
no PocketBase / network calls occur.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

import api.routers.requests as requests_router
from api.routers.requests import MergeRequestsRequest, merge_requests


def _nbw_record(
    record_id: str,
    source_field: str,
    *,
    requester_cm_id: int = 100,
    requested_cm_id: int = 200,
    session_cm_id: int = 1000002,
    year: int = 2025,
    confidence_score: float = 0.9,
) -> SimpleNamespace:
    """Fabricate a not_bunk_with bunk_request record with every field
    `merge_requests` reads."""
    return SimpleNamespace(
        id=record_id,
        requester_cm_id=requester_cm_id,
        requested_cm_id=requested_cm_id,
        session_cm_id=session_cm_id,
        year=year,
        request_type="not_bunk_with",
        source_field=source_field,
        source_fields=None,
        confidence_score=confidence_score,
        metadata={},
        parse_notes=None,
    )


def _patch_repos(monkeypatch: pytest.MonkeyPatch, records: dict[str, SimpleNamespace]) -> tuple[Mock, Mock]:
    """Monkeypatch the module-level repo factories; return (request_repo, source_link_repo) Mocks.

    `get_by_id` resolves from the `records` map. Downstream mutation methods are
    mocked generously so the negative test can run to completion.
    """
    request_repo = Mock()
    request_repo.get_by_id.side_effect = lambda rid: records.get(rid)
    request_repo.update_for_merge.return_value = None
    request_repo.soft_delete_for_merge.return_value = True

    source_link_repo = Mock()
    # ensure_source_link_exists() short-circuits to True when this is truthy,
    # so it never touches the global `pb`. A Mock() return value is truthy.
    source_link_repo.get_sources_for_request.return_value = ["existing-link"]
    source_link_repo.transfer_all_sources.return_value = None

    monkeypatch.setattr(requests_router, "get_request_repository", lambda: request_repo)
    monkeypatch.setattr(requests_router, "get_source_link_repository", lambda: source_link_repo)
    return request_repo, source_link_repo


_GUARD_MSG = "kept as separate rows to preserve the hard separation"


def test_merge_blocks_parent_plus_staff_nbw(monkeypatch: pytest.MonkeyPatch) -> None:
    """parent bunk_request_form NBW + staff_not_bunk_with NBW for the same pair
    must be refused at the guard with a 400 carrying the guard message."""
    records = {
        "r1": _nbw_record("r1", "bunk_request_form", confidence_score=0.95),
        "r2": _nbw_record("r2", "staff_not_bunk_with", confidence_score=0.80),
    }
    _patch_repos(monkeypatch, records)

    body = MergeRequestsRequest(
        request_ids=["r1", "r2"],
        keep_target_from="r1",
        final_type="not_bunk_with",
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(merge_requests(body))

    assert exc_info.value.status_code == 400
    assert _GUARD_MSG in exc_info.value.detail


def test_merge_allows_two_parent_nbw(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two parent bunk_request_form NBW records (both non-hard) must NOT trip the
    guard — a safe merge proceeds without the guard's 400."""
    records = {
        "r1": _nbw_record("r1", "bunk_request_form", confidence_score=0.95),
        "r2": _nbw_record("r2", "bunk_request_form", confidence_score=0.80),
    }
    _patch_repos(monkeypatch, records)

    body = MergeRequestsRequest(
        request_ids=["r1", "r2"],
        keep_target_from="r1",
        final_type="not_bunk_with",
    )

    # The guard must NOT fire for two non-hard parent NBW rows. If it (wrongly)
    # raised, the detail would carry _GUARD_MSG; surface that as a clear failure.
    try:
        result = asyncio.run(merge_requests(body))
    except HTTPException as exc:  # pragma: no cover - only on regression
        guard_fired = _GUARD_MSG in exc.detail
        pytest.fail(f"merge_requests raised HTTPException (guard_fired={guard_fired}): {exc.status_code} {exc.detail}")

    # Completed without the guard firing — that's the contract.
    assert result.merged_request_id == "r1"

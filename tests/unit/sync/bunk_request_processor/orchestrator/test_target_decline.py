"""Tests for Phase C target-decline sidecar.

Phase C runs after the main OBR pipeline. It sweeps existing bunk_requests
rows whose requestee is no longer attending (status_id != 2) or now sits
in a different session for the year, and declines them in place with the
canonical disposition_reason vocabulary used by the conflict detector
(`target_not_attending`, `session_mismatch`).

This is the requestee-side complement to:
  - orphan purge in Go bunk_requests CSV sync (handles requester-side cancel)
  - reconcile_request_lifecycle (marks OBRs unprocessed for moved requesters)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.sync.bunk_request_processor.orchestrator.target_decline import (
    TargetDeclineAction,
    apply_target_decline,
    compute_target_decline_actions,
)


class TestComputeTargetDeclineActions:
    """Pure-function logic: given current attendees state and BRs, what to decline."""

    def test_no_actions_when_all_requestees_active_and_in_correct_session(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 1002, "session_id": 100, "status": "pending"},
        ]
        active_session_by_cm_id = {1001: 100, 1002: 100}
        inactive_cm_ids: set[int] = set()

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids=inactive_cm_ids,
            active_session_by_cm_id=active_session_by_cm_id,
        )

        assert actions == []

    def test_declines_when_requestee_inactive(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
        ]
        active_session_by_cm_id: dict[int, int] = {}
        inactive_cm_ids = {1001}

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids=inactive_cm_ids,
            active_session_by_cm_id=active_session_by_cm_id,
        )

        assert actions == [TargetDeclineAction(bunk_request_id="br1", reason="target_not_attending")]

    def test_declines_when_requestee_active_but_in_different_session(self) -> None:
        bunk_requests = [
            # BR1 says session 100, but Liam Garcia (1001) is in session 200 now
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
        ]
        active_session_by_cm_id = {1001: 200}
        inactive_cm_ids: set[int] = set()

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids=inactive_cm_ids,
            active_session_by_cm_id=active_session_by_cm_id,
        )

        assert actions == [TargetDeclineAction(bunk_request_id="br1", reason="session_mismatch")]

    def test_skips_already_declined_rows(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "declined"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids={1001},
            active_session_by_cm_id={},
        )
        assert actions == []

    def test_skips_rows_with_no_requestee(self) -> None:
        # Age-preference and unresolved-name rows have no requestee_id
        bunk_requests: list[dict[str, Any]] = [
            {"id": "br1", "requestee_id": None, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 0, "session_id": 100, "status": "resolved"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids=set(),
            active_session_by_cm_id={},
        )
        assert actions == []

    def test_inactive_takes_precedence_over_session_mismatch(self) -> None:
        """If requestee is both inactive AND in a different session, prefer the
        not-attending reason (the more fundamental fact about their state)."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids={1001},
            active_session_by_cm_id={1001: 200},  # would also session-mismatch
        )
        assert actions == [TargetDeclineAction(bunk_request_id="br1", reason="target_not_attending")]

    def test_handles_unknown_requestee(self) -> None:
        """A requestee_id that's neither in inactive nor active sets is left alone.

        This can happen if the requestee is a placeholder (negative cm_id) or
        otherwise outside the year's attendees query."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 9999, "session_id": 100, "status": "resolved"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids={1001},
            active_session_by_cm_id={1002: 100},
        )
        assert actions == []

    def test_realistic_mixed_input(self) -> None:
        """Multiple BRs with mixed dispositions — emits one action per stale row."""
        bunk_requests = [
            # Olivia Chen (1001) cancelled — request to her gets declined
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            # Liam Garcia (1002) moved from 100 → 200 — request gets session-mismatched
            {"id": "br2", "requestee_id": 1002, "session_id": 100, "status": "pending"},
            # Emma Johnson (1003) is fine, still in session 100
            {"id": "br3", "requestee_id": 1003, "session_id": 100, "status": "resolved"},
            # Already-declined row left alone
            {"id": "br4", "requestee_id": 1001, "session_id": 100, "status": "declined"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            inactive_cm_ids={1001},
            active_session_by_cm_id={1002: 200, 1003: 100},
        )

        assert sorted((a.bunk_request_id, a.reason) for a in actions) == [
            ("br1", "target_not_attending"),
            ("br2", "session_mismatch"),
        ]


class TestApplyTargetDecline:
    """Integration-style: applies the actions through the request_repository."""

    def test_calls_pb_update_with_correct_payload(self) -> None:
        actions = [
            TargetDeclineAction(bunk_request_id="br1", reason="target_not_attending"),
            TargetDeclineAction(bunk_request_id="br2", reason="session_mismatch"),
        ]
        pb_client = MagicMock()
        pb_client.collection.return_value.update = MagicMock()

        result = apply_target_decline(pb_client, actions)

        assert result["declined_count"] == 2
        assert pb_client.collection.return_value.update.call_count == 2

        call_kwargs = [c.args for c in pb_client.collection.return_value.update.call_args_list]
        ids_seen = {c[0] for c in call_kwargs}
        payloads = {c[0]: c[1] for c in call_kwargs}

        assert ids_seen == {"br1", "br2"}
        assert payloads["br1"]["status"] == "declined"
        assert payloads["br1"]["disposition_reason"] == "target_not_attending"
        assert payloads["br2"]["status"] == "declined"
        assert payloads["br2"]["disposition_reason"] == "session_mismatch"

    def test_empty_actions_is_noop(self) -> None:
        pb_client = MagicMock()
        result = apply_target_decline(pb_client, [])

        assert result["declined_count"] == 0
        pb_client.collection.assert_not_called()

    def test_continues_after_individual_update_failure(self) -> None:
        """One row failing to update must not prevent the others from being processed."""
        actions = [
            TargetDeclineAction(bunk_request_id="br1", reason="target_not_attending"),
            TargetDeclineAction(bunk_request_id="br2", reason="session_mismatch"),
            TargetDeclineAction(bunk_request_id="br3", reason="target_not_attending"),
        ]
        pb_client = MagicMock()

        # Make the second update raise
        def update_side_effect(rec_id: str, _data: dict[str, Any]) -> None:
            if rec_id == "br2":
                raise RuntimeError("simulated PB error")

        pb_client.collection.return_value.update.side_effect = update_side_effect

        result = apply_target_decline(pb_client, actions)

        assert result["declined_count"] == 2
        assert result["error_count"] == 1
        assert pb_client.collection.return_value.update.call_count == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

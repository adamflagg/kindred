"""Tests for Phase C bidirectional enrollment reconciliation sidecar.

Phase C runs after the main OBR pipeline. It sweeps existing bunk_requests
rows in both directions:

  FORWARD (decline direction): non-declined BRs whose requestee is no longer
  attending or now sits in a different session → flip to declined with
  disposition_reason ∈ {target_not_attending, session_mismatch}.

  REVERSE (reopen direction): declined BRs whose disposition_reason ∈
  {target_not_attending, session_mismatch} AND whose target is now actively
  enrolled in the BR's session → flip to pending with
  disposition_reason="enrollment_change".

Other decline reasons (e.g., self_referential, requester_not_attending,
empty/manual-decline) are NOT eligible for reopen.

This is the requestee-side complement to:
  - orphan purge in Go bunk_requests CSV sync (handles requester-side cancel)
  - reconcile_request_lifecycle (marks OBRs unprocessed for moved requesters)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.sync.bunk_request_processor.orchestrator.target_enrollment_reconcile import (
    TargetReconcileAction,
    apply_target_reconcile,
    compute_target_reconcile_actions,
    run_target_reconcile_phase,
)

# ---------------------------------------------------------------------------
# Forward direction tests (decline) — mirrors existing test_target_decline.py
# ---------------------------------------------------------------------------


class TestComputeTargetReconcileActionsDeclineDirection:
    """Pure-function: forward direction emits decline actions (existing behavior)."""

    def test_no_actions_when_all_requestees_active_and_in_correct_session(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br2", "requestee_id": 1002, "session_id": 100, "status": "pending", "disposition_reason": ""},
        ]
        active_sessions_by_cm_id: dict[int, set[int]] = {1001: {100}, 1002: {100}}

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id=active_sessions_by_cm_id,
        )

        assert actions == []

    def test_declines_when_requestee_not_in_active_map(self) -> None:
        """A requestee with no active enrollment is absent from active_sessions_by_cm_id
        → target_not_attending."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )

        assert actions == [
            TargetReconcileAction(bunk_request_id="br1", action="decline", reason="target_not_attending")
        ]

    def test_declines_when_requestee_active_but_in_different_session(self) -> None:
        # Liam Garcia (1001) is in session 200 but BR says session 100
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {200}},
        )

        assert actions == [TargetReconcileAction(bunk_request_id="br1", action="decline", reason="session_mismatch")]

    def test_skips_rows_with_no_requestee(self) -> None:
        bunk_requests: list[dict[str, Any]] = [
            {"id": "br1", "requestee_id": None, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br2", "requestee_id": 0, "session_id": 100, "status": "resolved", "disposition_reason": ""},
        ]
        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )
        assert actions == []

    def test_skips_rows_with_unresolved_placeholder_id(self) -> None:
        """Negative MD5-hash requestee_ids (unresolved names) are not real cm_ids."""
        bunk_requests: list[dict[str, Any]] = [
            {"id": "br1", "requestee_id": -383633306, "session_id": 100, "status": "pending", "disposition_reason": ""},
            {"id": "br2", "requestee_id": -645220167, "session_id": 100, "status": "pending", "disposition_reason": ""},
        ]
        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )
        assert actions == []

    def test_multi_session_enrolled_keeps_brs_in_any_active_session(self) -> None:
        """Olivia Chen (1001) enrolled in both session 100 and 200 — both BRs kept."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br2", "requestee_id": 1001, "session_id": 200, "status": "resolved", "disposition_reason": ""},
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100, 200}},
        )

        assert actions == []

    def test_multi_session_enrolled_flags_only_non_matching_session(self) -> None:
        """Requestee enrolled in 100 and 200 — a BR for session 300 is mismatched."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br2", "requestee_id": 1001, "session_id": 300, "status": "resolved", "disposition_reason": ""},
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100, 200}},
        )

        assert actions == [TargetReconcileAction(bunk_request_id="br2", action="decline", reason="session_mismatch")]


# ---------------------------------------------------------------------------
# Reverse direction tests (reopen) — NEW bidirectional behavior
# ---------------------------------------------------------------------------


class TestComputeTargetReconcileActionsReopenDirection:
    """Pure-function: reverse direction emits reopen actions for eligible declines."""

    def test_reopens_target_not_attending_decline_when_target_now_enrolled(self) -> None:
        """Emma Johnson (1001) was not attending when BR was declined.
        She is now actively enrolled in BR's session 100 → reopen."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "target_not_attending",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}},
        )

        assert actions == [TargetReconcileAction(bunk_request_id="br1", action="reopen", reason="enrollment_change")]

    def test_reopens_session_mismatch_decline_when_target_now_in_correct_session(self) -> None:
        """Liam Garcia (1002) was in session 200 when BR for session 100 was declined.
        He is now actively enrolled in session 100 → reopen."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1002,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "session_mismatch",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1002: {100}},
        )

        assert actions == [TargetReconcileAction(bunk_request_id="br1", action="reopen", reason="enrollment_change")]

    def test_no_reopen_when_target_not_attending_and_still_not_enrolled(self) -> None:
        """Olivia Chen (1003) declined as target_not_attending and is still not enrolled
        → no action."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1003,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "target_not_attending",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )

        assert actions == []

    def test_no_reopen_for_ineligible_reason_self_referential(self) -> None:
        """A BR declined with disposition_reason=self_referential is not eligible
        for reopen even when the target is now enrolled."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "self_referential",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}},
        )

        assert actions == []

    def test_no_reopen_for_empty_disposition_reason_manual_decline(self) -> None:
        """A BR declined with an empty disposition_reason (manual UI decline) is not
        eligible for reopen — staff explicitly declined it."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}},
        )

        assert actions == []

    def test_no_reopen_for_none_disposition_reason(self) -> None:
        """None disposition_reason (missing field) treated as manual decline → no reopen."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": None,
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}},
        )

        assert actions == []

    def test_no_reopen_for_requester_not_attending_ineligible_reason(self) -> None:
        """requester_not_attending is another ineligible reason → stays declined."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "requester_not_attending",
            },
        ]

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}},
        )

        assert actions == []

    def test_non_declined_brs_are_not_reopen_candidates(self) -> None:
        """resolved and pending BRs are candidates for the decline direction only."""
        bunk_requests = [
            {
                "id": "br1",
                "requestee_id": 1001,
                "session_id": 100,
                "status": "resolved",
                "disposition_reason": "target_not_attending",
            },
            {
                "id": "br2",
                "requestee_id": 1002,
                "session_id": 100,
                "status": "pending",
                "disposition_reason": "session_mismatch",
            },
        ]

        # Even with the target enrolled, these are not declined → no reopen
        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100}, 1002: {100}},
        )

        # They may still produce decline actions if enrollment is stale,
        # but since both are enrolled in the correct session there should be
        # no actions of any kind.
        assert actions == []


# ---------------------------------------------------------------------------
# Bidirectional integration test
# ---------------------------------------------------------------------------


class TestComputeTargetReconcileActionsBidirectionalMix:
    """Integration-style: single pass on a mixed input set emits both action types."""

    def test_mixed_input_produces_both_declines_and_reopens(self) -> None:
        """
        Input:
          br1 (resolved) — requestee Olivia Chen (1001) not attending → decline
          br2 (resolved) — requestee Liam Garcia (1002) moved to session 200 → session_mismatch decline
          br3 (resolved) — requestee Emma Johnson (1003) still in session 100 → no action
          br4 (declined, target_not_attending) — requestee Riley Sam (1004) now enrolled in session 100 → reopen
          br5 (declined, session_mismatch) — requestee Samuel Johnson (1005) now in session 200 as BR expects → reopen
          br6 (declined, self_referential) — not eligible for reopen → no action
          br7 (declined, target_not_attending) — requestee still not enrolled → no action
        """
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br2", "requestee_id": 1002, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {"id": "br3", "requestee_id": 1003, "session_id": 100, "status": "resolved", "disposition_reason": ""},
            {
                "id": "br4",
                "requestee_id": 1004,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "target_not_attending",
            },
            {
                "id": "br5",
                "requestee_id": 1005,
                "session_id": 200,
                "status": "declined",
                "disposition_reason": "session_mismatch",
            },
            {
                "id": "br6",
                "requestee_id": 1006,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "self_referential",
            },
            {
                "id": "br7",
                "requestee_id": 1007,
                "session_id": 100,
                "status": "declined",
                "disposition_reason": "target_not_attending",
            },
        ]

        active_sessions_by_cm_id: dict[int, set[int]] = {
            # 1001 not present → target_not_attending decline for br1
            1002: {200},  # session mismatch for br2 (BR expects 100, enrolled in 200)
            1003: {100},  # br3 fine, no action
            1004: {100},  # br4: now enrolled in session 100 as BR expects → reopen
            1005: {200},  # br5: now enrolled in session 200 as BR expects → reopen
            1006: {100},  # br6: enrolled but ineligible reason → no action
            # 1007 not present → target still not attending, no reopen for br7
        }

        actions = compute_target_reconcile_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id=active_sessions_by_cm_id,
        )

        action_tuples = sorted((a.bunk_request_id, a.action, a.reason) for a in actions)
        assert action_tuples == [
            ("br1", "decline", "target_not_attending"),
            ("br2", "decline", "session_mismatch"),
            ("br4", "reopen", "enrollment_change"),
            ("br5", "reopen", "enrollment_change"),
        ]


# ---------------------------------------------------------------------------
# apply_target_reconcile tests
# ---------------------------------------------------------------------------


class TestApplyTargetReconcile:
    """Integration-style: applies both action types through the pb_client."""

    def test_calls_pb_update_with_correct_declined_payload(self) -> None:
        actions = [
            TargetReconcileAction(bunk_request_id="br1", action="decline", reason="target_not_attending"),
            TargetReconcileAction(bunk_request_id="br2", action="decline", reason="session_mismatch"),
        ]
        pb_client = MagicMock()
        pb_client.collection.return_value.update = MagicMock()

        result = apply_target_reconcile(pb_client, actions)

        assert result["declined_count"] == 2
        assert result["reopened_count"] == 0
        assert pb_client.collection.return_value.update.call_count == 2

        call_kwargs = [c.args for c in pb_client.collection.return_value.update.call_args_list]
        ids_seen = {c[0] for c in call_kwargs}
        payloads = {c[0]: c[1] for c in call_kwargs}

        assert ids_seen == {"br1", "br2"}
        assert payloads["br1"]["status"] == "declined"
        assert payloads["br1"]["disposition_reason"] == "target_not_attending"
        assert payloads["br2"]["status"] == "declined"
        assert payloads["br2"]["disposition_reason"] == "session_mismatch"

    def test_calls_pb_update_with_correct_reopen_payload(self) -> None:
        actions = [
            TargetReconcileAction(bunk_request_id="br1", action="reopen", reason="enrollment_change"),
        ]
        pb_client = MagicMock()
        pb_client.collection.return_value.update = MagicMock()

        result = apply_target_reconcile(pb_client, actions)

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 1
        assert pb_client.collection.return_value.update.call_count == 1

        call_args = pb_client.collection.return_value.update.call_args.args
        assert call_args[0] == "br1"
        assert call_args[1]["status"] == "pending"
        assert call_args[1]["disposition_reason"] == "enrollment_change"

    def test_empty_actions_is_noop(self) -> None:
        pb_client = MagicMock()
        result = apply_target_reconcile(pb_client, [])

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 0
        pb_client.collection.assert_not_called()

    def test_continues_after_individual_update_failure(self) -> None:
        """One row failing to update must not prevent the others from being processed."""
        actions = [
            TargetReconcileAction(bunk_request_id="br1", action="decline", reason="target_not_attending"),
            TargetReconcileAction(bunk_request_id="br2", action="reopen", reason="enrollment_change"),
            TargetReconcileAction(bunk_request_id="br3", action="decline", reason="session_mismatch"),
        ]
        pb_client = MagicMock()

        def update_side_effect(rec_id: str, _data: dict[str, Any]) -> None:
            if rec_id == "br2":
                raise RuntimeError("simulated PB error")

        pb_client.collection.return_value.update.side_effect = update_side_effect

        result = apply_target_reconcile(pb_client, actions)

        assert result["declined_count"] == 2
        assert result["reopened_count"] == 0
        assert result["error_count"] == 1
        assert pb_client.collection.return_value.update.call_count == 3

    def test_mixed_decline_and_reopen_in_one_pass(self) -> None:
        actions = [
            TargetReconcileAction(bunk_request_id="br1", action="decline", reason="target_not_attending"),
            TargetReconcileAction(bunk_request_id="br2", action="reopen", reason="enrollment_change"),
            TargetReconcileAction(bunk_request_id="br3", action="decline", reason="session_mismatch"),
            TargetReconcileAction(bunk_request_id="br4", action="reopen", reason="enrollment_change"),
        ]
        pb_client = MagicMock()
        pb_client.collection.return_value.update = MagicMock()

        result = apply_target_reconcile(pb_client, actions)

        assert result["declined_count"] == 2
        assert result["reopened_count"] == 2
        assert result["error_count"] == 0
        assert pb_client.collection.return_value.update.call_count == 4


# ---------------------------------------------------------------------------
# Helper builders
# ---------------------------------------------------------------------------


def _make_attendee(person_id: int, status_id: int, session_cm_id: int) -> MagicMock:
    """Build a MagicMock attendee record whose .expand.session.cm_id resolves."""
    a = MagicMock()
    a.person_id = person_id
    a.status_id = status_id
    session = MagicMock()
    session.cm_id = session_cm_id
    a.expand = {"session": session}
    return a


def _make_br(
    br_id: str,
    requestee_id: int | None,
    session_id: int,
    status: str = "resolved",
    disposition_reason: str = "",
) -> MagicMock:
    """Build a MagicMock bunk_requests record."""
    br = MagicMock()
    br.id = br_id
    br.requestee_id = requestee_id
    br.session_id = session_id
    br.status = status
    br.disposition_reason = disposition_reason
    return br


# ---------------------------------------------------------------------------
# run_target_reconcile_phase tests
# ---------------------------------------------------------------------------


class TestRunTargetReconcilePhase:
    """Integration: full classification + decision + application path.

    Covers multi-attendee-per-person scenarios and the reopen direction.
    """

    def test_multi_session_enrolled_person_with_one_cancelled_row_is_not_declined(self) -> None:
        """Production scenario: 4× enrolled + 1× cancelled. Phase C must NOT decline."""
        attendees = [
            _make_attendee(1001, status_id=2, session_cm_id=100),
            _make_attendee(1001, status_id=2, session_cm_id=200),
            _make_attendee(1001, status_id=2, session_cm_id=300),
            _make_attendee(1001, status_id=2, session_cm_id=400),
            _make_attendee(1001, status_id=32, session_cm_id=500),  # cancelled
        ]
        brs = [
            _make_br("br1", requestee_id=1001, session_id=100),
            _make_br("br2", requestee_id=1001, session_id=300),
        ]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 0
        pb_client.collection.return_value.update.assert_not_called()

    def test_session_mismatch_for_session_person_is_not_in(self) -> None:
        """Person enrolled in {100, 200}; BR for session 300 → session_mismatch."""
        attendees = [
            _make_attendee(1001, status_id=2, session_cm_id=100),
            _make_attendee(1001, status_id=2, session_cm_id=200),
        ]
        brs = [_make_br("br1", requestee_id=1001, session_id=300)]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 1
        assert result["reopened_count"] == 0
        pb_client.collection.return_value.update.assert_called_once_with(
            "br1", {"status": "declined", "disposition_reason": "session_mismatch"}
        )

    def test_fully_cancelled_person_gets_target_not_attending(self) -> None:
        """All status_id != 2 rows → person never enters active_sessions_by_cm_id."""
        attendees = [
            _make_attendee(1001, status_id=32, session_cm_id=100),
            _make_attendee(1001, status_id=32, session_cm_id=200),
        ]
        brs = [_make_br("br1", requestee_id=1001, session_id=100)]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 1
        assert result["reopened_count"] == 0
        pb_client.collection.return_value.update.assert_called_once_with(
            "br1", {"status": "declined", "disposition_reason": "target_not_attending"}
        )

    def test_attendees_fetch_failure_returns_error_without_writing(self) -> None:
        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = RuntimeError("PB down")

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 0
        assert result["error_count"] == 1
        pb_client.collection.return_value.update.assert_not_called()

    def test_reopen_declined_br_when_target_now_enrolled_in_correct_session(self) -> None:
        """Declined BR with target_not_attending; target now enrolled → reopen."""
        attendees = [
            _make_attendee(1001, status_id=2, session_cm_id=100),
        ]
        brs = [
            _make_br(
                "br1",
                requestee_id=1001,
                session_id=100,
                status="declined",
                disposition_reason="target_not_attending",
            )
        ]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 1
        pb_client.collection.return_value.update.assert_called_once_with(
            "br1", {"status": "pending", "disposition_reason": "enrollment_change"}
        )

    def test_no_reopen_for_ineligible_decline_reason_in_phase_runner(self) -> None:
        """self_referential decline is not eligible for reopen even if target enrolled."""
        attendees = [
            _make_attendee(1001, status_id=2, session_cm_id=100),
        ]
        brs = [
            _make_br(
                "br1",
                requestee_id=1001,
                session_id=100,
                status="declined",
                disposition_reason="self_referential",
            )
        ]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_reconcile_phase(pb_client, year=2025)

        assert result["declined_count"] == 0
        assert result["reopened_count"] == 0
        pb_client.collection.return_value.update.assert_not_called()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""Tests for Phase C target-decline sidecar.

Phase C runs after the main OBR pipeline. It sweeps existing bunk_requests
rows whose requestee is no longer attending or now sits in a different
session for the year, and declines them in place with the canonical
disposition_reason vocabulary used by the conflict detector
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
    run_target_decline_phase,
)


class TestComputeTargetDeclineActions:
    """Pure-function logic: given current attendees state and BRs, what to decline."""

    def test_no_actions_when_all_requestees_active_and_in_correct_session(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 1002, "session_id": 100, "status": "pending"},
        ]
        active_sessions_by_cm_id: dict[int, set[int]] = {1001: {100}, 1002: {100}}

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id=active_sessions_by_cm_id,
        )

        assert actions == []

    def test_declines_when_requestee_not_in_active_map(self) -> None:
        """A requestee with no active enrollment (cancelled/withdrawn/never-enrolled)
        is absent from active_sessions_by_cm_id → target_not_attending."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
        ]

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )

        assert actions == [TargetDeclineAction(bunk_request_id="br1", reason="target_not_attending")]

    def test_declines_when_requestee_active_but_in_different_session(self) -> None:
        bunk_requests = [
            # BR1 says session 100, but Liam Garcia (1001) is in session 200 now
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
        ]

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {200}},
        )

        assert actions == [TargetDeclineAction(bunk_request_id="br1", reason="session_mismatch")]

    def test_skips_already_declined_rows(self) -> None:
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "declined"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
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
            active_sessions_by_cm_id={},
        )
        assert actions == []

    def test_skips_rows_with_unresolved_placeholder_id(self) -> None:
        """Unresolved-name rows carry a negative MD5-hash requestee_id
        (see orchestrator.generate_unresolved_person_id). These are NOT real
        cm_ids and must never be declined as 'target_not_attending' — the
        target was never resolved to a real person, so no enrollment claim
        was ever made. Staff must review them via normal PENDING flow."""
        bunk_requests: list[dict[str, Any]] = [
            # Misspelling: parent typed "Riley Sam" but no such person; hash placeholder
            {"id": "br1", "requestee_id": -383633306, "session_id": 100, "status": "pending"},
            # Group reference: "the twins from last summer" — no individual identity
            {"id": "br2", "requestee_id": -645220167, "session_id": 100, "status": "pending"},
        ]
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={},
        )
        assert actions == []

    def test_multi_session_enrolled_keeps_brs_in_any_active_session(self) -> None:
        """Requestee Olivia Chen (1001) is enrolled in BOTH session 100 and 200
        (e.g. signed up for two different camp sessions in the same year).
        BRs targeting her in either session must be kept."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 1001, "session_id": 200, "status": "resolved"},
        ]

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100, 200}},
        )

        assert actions == []

    def test_multi_session_enrolled_flags_only_non_matching_session(self) -> None:
        """Requestee enrolled in 100 and 200 — a BR for session 300 is mismatched."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 1001, "session_id": 300, "status": "resolved"},
        ]

        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100, 200}},
        )

        assert actions == [TargetDeclineAction(bunk_request_id="br2", reason="session_mismatch")]

    def test_mixed_enrolled_and_cancelled_rows_keeps_active_only(self) -> None:
        """Requestee has 4× enrolled rows (sessions 100, 200, 300, 400) plus
        a cancelled row (session 500). The cancelled row must NOT cause her
        BRs to be declined as target_not_attending. This was the bug in the
        original implementation (person 8774023 in production data)."""
        bunk_requests = [
            {"id": "br1", "requestee_id": 1001, "session_id": 100, "status": "resolved"},
            {"id": "br2", "requestee_id": 1001, "session_id": 500, "status": "resolved"},
        ]

        # active_sessions_by_cm_id only contains the enrolled sessions; the
        # cancelled row is silently dropped at classification time.
        actions = compute_target_decline_actions(
            bunk_requests=bunk_requests,
            active_sessions_by_cm_id={1001: {100, 200, 300, 400}},
        )

        # br1 → kept (in active set), br2 → session_mismatch (500 not in set)
        assert actions == [TargetDeclineAction(bunk_request_id="br2", reason="session_mismatch")]

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
            active_sessions_by_cm_id={1002: {200}, 1003: {100}},
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

        def update_side_effect(rec_id: str, _data: dict[str, Any]) -> None:
            if rec_id == "br2":
                raise RuntimeError("simulated PB error")

        pb_client.collection.return_value.update.side_effect = update_side_effect

        result = apply_target_decline(pb_client, actions)

        assert result["declined_count"] == 2
        assert result["error_count"] == 1
        assert pb_client.collection.return_value.update.call_count == 3


def _make_attendee(person_id: int, status_id: int, session_cm_id: int) -> MagicMock:
    """Build a MagicMock attendee record whose .expand.session.cm_id resolves."""
    a = MagicMock()
    a.person_id = person_id
    a.status_id = status_id
    session = MagicMock()
    session.cm_id = session_cm_id
    a.expand = {"session": session}
    return a


def _make_br(br_id: str, requestee_id: int | None, session_id: int, status: str = "resolved") -> MagicMock:
    """Build a MagicMock bunk_requests record."""
    br = MagicMock()
    br.id = br_id
    br.requestee_id = requestee_id
    br.session_id = session_id
    br.status = status
    return br


class TestRunTargetDeclinePhase:
    """Integration: full classification + decision + application path.

    This catches multi-attendee-per-person scenarios that the pure-function
    tests don't reach (because they pre-construct the active_sessions map).
    """

    def test_multi_session_enrolled_person_with_one_cancelled_row_is_not_declined(self) -> None:
        """Production scenario from person 8774023: 4× enrolled + 1× cancelled.
        Phase C must NOT decline incoming BRs for them."""
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

        result = run_target_decline_phase(pb_client, year=2025)

        assert result == {"declined_count": 0, "error_count": 0}
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

        result = run_target_decline_phase(pb_client, year=2025)

        assert result == {"declined_count": 1, "error_count": 0}
        pb_client.collection.return_value.update.assert_called_once_with(
            "br1", {"status": "declined", "disposition_reason": "session_mismatch"}
        )

    def test_fully_cancelled_person_gets_target_not_attending(self) -> None:
        """All status_id != 2 rows → person never enters active_sessions_by_cm_id."""
        attendees = [
            _make_attendee(1001, status_id=32, session_cm_id=100),  # cancelled
            _make_attendee(1001, status_id=32, session_cm_id=200),  # cancelled
        ]
        brs = [_make_br("br1", requestee_id=1001, session_id=100)]

        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = [attendees, brs]

        result = run_target_decline_phase(pb_client, year=2025)

        assert result == {"declined_count": 1, "error_count": 0}
        pb_client.collection.return_value.update.assert_called_once_with(
            "br1", {"status": "declined", "disposition_reason": "target_not_attending"}
        )

    def test_attendees_fetch_failure_returns_error_without_writing(self) -> None:
        pb_client = MagicMock()
        pb_client.collection.return_value.get_full_list.side_effect = RuntimeError("PB down")

        result = run_target_decline_phase(pb_client, year=2025)

        assert result == {"declined_count": 0, "error_count": 1}
        pb_client.collection.return_value.update.assert_not_called()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

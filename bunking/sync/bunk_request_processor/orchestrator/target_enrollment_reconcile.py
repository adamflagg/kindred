"""Phase C: bidirectional enrollment reconciliation sidecar.

After the OBR-driven pipeline completes, sweep `bunk_requests` in both
directions:

  FORWARD (decline direction):
    Non-declined BRs whose `requestee_id` refers to a person who is no longer
    actively enrolled in the BR's session for the year → flip to declined with
    disposition_reason ∈ {target_not_attending, session_mismatch}.

  REVERSE (reopen direction):
    Declined BRs whose disposition_reason ∈ {target_not_attending,
    session_mismatch} AND whose target is now actively enrolled in the BR's
    session → flip to pending with disposition_reason="enrollment_change".
    Only these two reasons are eligible; other declines (self_referential,
    requester_not_attending, empty/manual-decline) stay declined.

Active enrollment is keyed per-session: a person can be enrolled in
multiple sessions in the same year, and a separate cancelled/withdrawn row
on another session does not invalidate their active enrollments. Phase C
treats only `status_id == 2` rows as authoritative for "where this person
currently is".

This is the requestee-side complement to:
  - the orphan purge in the Go bunk_requests CSV sync (deletes BRs/OBRs
    when the requester is no longer enrolled)
  - reconcile_request_lifecycle (marks OBRs unprocessed for moved
    requesters so process_requests rebuilds them)

Both halves running together close the gap where attendee state changes
silently leave stale `resolved` rows in `bunk_requests` between CSV uploads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from bunking.logging_config import get_logger

logger = get_logger(__name__)

# Decline reasons that are eligible for reopen when the target re-enrolls.
# Other reasons (self_referential, requester_not_attending, empty/manual) stay declined.
_REOPEN_ELIGIBLE_REASONS: frozenset[str] = frozenset({"target_not_attending", "session_mismatch"})


@dataclass(frozen=True)
class TargetReconcileAction:
    """A single bunk_requests row to update.

    action="decline": flip to declined with the given enrollment-state reason.
    action="reopen":  flip to pending with reason="enrollment_change".
    """

    bunk_request_id: str
    action: Literal["decline", "reopen"]
    reason: str  # decline: "target_not_attending" | "session_mismatch"; reopen: "enrollment_change"


def compute_target_reconcile_actions(
    bunk_requests: list[dict[str, Any]],
    active_sessions_by_cm_id: dict[int, set[int]],
) -> list[TargetReconcileAction]:
    """Pure-function decision: which BRs need to be declined or reopened and why.

    Args:
        bunk_requests: rows with at least `id`, `requestee_id`, `session_id`,
            `status`, and `disposition_reason` keys.
        active_sessions_by_cm_id: cm_id → set of session_cm_ids the person is
            actively enrolled in (status_id == 2). A person absent from this
            map has no active enrollment and is treated as not attending.

    Returns:
        One `TargetReconcileAction` per BR that should flip, combining both
        action types in a single pass. Already-declined rows with ineligible
        reasons are skipped. Rows with no `requestee_id` (placeholders, age
        preferences) or with a negative-hash placeholder `requestee_id`
        (unresolved-name rows from orchestrator.generate_unresolved_person_id)
        are skipped — those are not real cm_ids and never carried an enrollment
        claim.
    """
    actions: list[TargetReconcileAction] = []
    for br in bunk_requests:
        status = br.get("status")
        requestee = br.get("requestee_id")

        # Skip rows with no real requestee cm_id
        if not requestee or requestee < 0:
            continue

        active_sessions = active_sessions_by_cm_id.get(requestee)

        if status == "declined":
            # Reverse direction: only reopen declines caused by enrollment state
            disposition_reason = br.get("disposition_reason") or ""
            if disposition_reason not in _REOPEN_ELIGIBLE_REASONS:
                continue
            # Only reopen if target is now actively enrolled in the BR's session
            if active_sessions and br.get("session_id") in active_sessions:
                actions.append(
                    TargetReconcileAction(
                        bunk_request_id=br["id"],
                        action="reopen",
                        reason="enrollment_change",
                    )
                )
        else:
            # Forward direction: decline stale non-declined rows
            if not active_sessions:
                actions.append(
                    TargetReconcileAction(
                        bunk_request_id=br["id"],
                        action="decline",
                        reason="target_not_attending",
                    )
                )
                continue
            if br.get("session_id") not in active_sessions:
                actions.append(
                    TargetReconcileAction(
                        bunk_request_id=br["id"],
                        action="decline",
                        reason="session_mismatch",
                    )
                )

    return actions


def run_target_reconcile_phase(pb_client: Any, year: int) -> dict[str, int]:
    """End-to-end Phase C runner for use inside the orchestrator pipeline.

    Fetches the year's attendees and bunk_requests, computes which BRs should
    flip (in either direction), and applies the updates. Empty inputs ⇒ empty
    stats.

    Errors are caught and logged; this phase MUST NOT fail the surrounding
    pipeline (it's a sidecar that is usually empty).

    Returns stats dict: {"declined_count": int, "reopened_count": int, "error_count": int}
    """
    try:
        attendees = pb_client.collection("attendees").get_full_list(
            query_params={"filter": f"year = {year}", "expand": "session"},
        )
    except Exception as e:
        logger.warning(f"target_reconcile: failed to fetch attendees: {e}")
        return {"declined_count": 0, "reopened_count": 0, "error_count": 1}

    active_sessions_by_cm_id: dict[int, set[int]] = {}
    for a in attendees:
        person_id = getattr(a, "person_id", None)
        status_id = getattr(a, "status_id", None)
        if not person_id or status_id != 2:
            continue
        session_cm_id = _attendee_session_cm_id(a)
        if session_cm_id is None:
            continue
        active_sessions_by_cm_id.setdefault(int(person_id), set()).add(int(session_cm_id))

    try:
        brs = pb_client.collection("bunk_requests").get_full_list(
            query_params={"filter": f"year = {year}"},
        )
    except Exception as e:
        logger.warning(f"target_reconcile: failed to fetch bunk_requests: {e}")
        return {"declined_count": 0, "reopened_count": 0, "error_count": 1}

    br_dicts: list[dict[str, Any]] = [
        {
            "id": getattr(br, "id", None),
            "requestee_id": getattr(br, "requestee_id", None),
            "session_id": getattr(br, "session_id", None),
            "status": getattr(br, "status", None),
            "disposition_reason": getattr(br, "disposition_reason", None),
        }
        for br in brs
    ]

    actions = compute_target_reconcile_actions(
        bunk_requests=br_dicts,
        active_sessions_by_cm_id=active_sessions_by_cm_id,
    )
    if not actions:
        logger.debug(f"target_reconcile: no actions for year={year}")
        return {"declined_count": 0, "reopened_count": 0, "error_count": 0}

    decline_count = sum(1 for a in actions if a.action == "decline")
    reopen_count = sum(1 for a in actions if a.action == "reopen")
    logger.info(
        f"target_reconcile: {decline_count} to decline, {reopen_count} to reopen "
        f"(year={year}, active_targets={len(active_sessions_by_cm_id)})"
    )
    return apply_target_reconcile(pb_client, actions)


def _attendee_session_cm_id(attendee: Any) -> int | None:
    """Read the session.cm_id from an attendee record returned by PocketBase.

    Reads the expanded relation (`expand.session.cm_id`). Returns None if
    expand isn't available or the session has no cm_id — Phase C silently
    drops such rows rather than guessing, since attendees.session is a
    PocketBase relation ID (string) and cannot be substituted for cm_id.
    """
    expand = getattr(attendee, "expand", None)
    if expand is None:
        return None
    session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
    if session is None:
        return None
    cm_id = getattr(session, "cm_id", None)
    if cm_id is None:
        return None
    return int(cm_id)


def apply_target_reconcile(
    pb_client: Any,
    actions: list[TargetReconcileAction],
) -> dict[str, int]:
    """Apply each action by updating the corresponding bunk_requests row.

    A failure on one row is logged but does not stop the others. Phase C is
    a sidecar; it should never fail the surrounding pipeline.

    Args:
        pb_client: PocketBase client (or wrapper) with
            `.collection("bunk_requests").update(id, data)` available.
        actions: list returned by `compute_target_reconcile_actions`.

    Returns:
        Stats dict: {"declined_count": int, "reopened_count": int, "error_count": int}
    """
    stats = {"declined_count": 0, "reopened_count": 0, "error_count": 0}
    if not actions:
        return stats

    collection = pb_client.collection("bunk_requests")
    for action in actions:
        if action.action == "decline":
            payload: dict[str, str] = {
                "status": "declined",
                "disposition_reason": action.reason,
            }
            stat_key = "declined_count"
        else:
            payload = {
                "status": "pending",
                "disposition_reason": action.reason,
            }
            stat_key = "reopened_count"

        try:
            collection.update(action.bunk_request_id, payload)
            stats[stat_key] += 1
        except Exception as e:
            stats["error_count"] += 1
            logger.warning(
                f"target_reconcile: failed to update {action.bunk_request_id} "
                f"(action={action.action}, reason={action.reason}): {e}"
            )
    return stats

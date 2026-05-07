"""Phase C: target-decline sidecar.

After the OBR-driven pipeline completes, sweep `bunk_requests` for any
non-declined rows whose `requestee_id` refers to a person who is no longer
attending (status_id != 2) or now sits in a different session for the year,
and decline them in place using the canonical disposition_reason vocabulary
(`target_not_attending`, `session_mismatch`).

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
from typing import Any

from bunking.logging_config import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class TargetDeclineAction:
    """A single bunk_requests row to decline with a specific reason."""

    bunk_request_id: str
    reason: str  # "target_not_attending" or "session_mismatch"


def compute_target_decline_actions(
    bunk_requests: list[dict[str, Any]],
    inactive_cm_ids: set[int],
    active_session_by_cm_id: dict[int, int],
) -> list[TargetDeclineAction]:
    """Pure-function decision: which BRs need to be declined and why.

    Args:
        bunk_requests: rows with at least `id`, `requestee_id`, `session_id`,
            `status` keys.
        inactive_cm_ids: cm_ids of attendees whose status_id is not 2 in
            this year.
        active_session_by_cm_id: cm_id → current session_cm_id for attendees
            with status_id == 2.

    Returns:
        One `TargetDeclineAction` per BR that should flip to declined.
        Already-declined rows are skipped. Rows with no `requestee_id`
        (placeholders, age preferences) are skipped. Inactive takes
        precedence over session mismatch.
    """
    actions: list[TargetDeclineAction] = []
    for br in bunk_requests:
        if br.get("status") == "declined":
            continue
        requestee = br.get("requestee_id")
        if not requestee:
            continue
        if requestee in inactive_cm_ids:
            actions.append(TargetDeclineAction(bunk_request_id=br["id"], reason="target_not_attending"))
            continue
        if requestee in active_session_by_cm_id:
            current = active_session_by_cm_id[requestee]
            stored = br.get("session_id")
            if stored != current:
                actions.append(TargetDeclineAction(bunk_request_id=br["id"], reason="session_mismatch"))
    return actions


def run_target_decline_phase(pb_client: Any, year: int) -> dict[str, int]:
    """End-to-end Phase C runner for use inside the orchestrator pipeline.

    Fetches the year's attendees and bunk_requests, computes which BRs should
    flip to declined, and applies the updates. Empty inputs ⇒ empty stats.

    Errors are caught and logged; this phase MUST NOT fail the surrounding
    pipeline (it's a sidecar that is usually empty).

    Returns the same stats dict as `apply_target_decline`, plus an
    `error_count` if the top-level fetch fails.
    """
    try:
        attendees = pb_client.collection("attendees").get_full_list(
            query_params={"filter": f"year = {year}", "expand": "session"},
        )
    except Exception as e:
        logger.warning(f"target_decline: failed to fetch attendees: {e}")
        return {"declined_count": 0, "error_count": 1}

    inactive_cm_ids: set[int] = set()
    active_session_by_cm_id: dict[int, int] = {}
    for a in attendees:
        person_id = getattr(a, "person_id", None)
        status_id = getattr(a, "status_id", None)
        if not person_id:
            continue
        if status_id == 2:
            session_cm_id = _attendee_session_cm_id(a)
            if session_cm_id:
                active_session_by_cm_id[int(person_id)] = int(session_cm_id)
        else:
            inactive_cm_ids.add(int(person_id))

    try:
        brs = pb_client.collection("bunk_requests").get_full_list(
            query_params={"filter": f"year = {year}"},
        )
    except Exception as e:
        logger.warning(f"target_decline: failed to fetch bunk_requests: {e}")
        return {"declined_count": 0, "error_count": 1}

    br_dicts: list[dict[str, Any]] = [
        {
            "id": getattr(br, "id", None),
            "requestee_id": getattr(br, "requestee_id", None),
            "session_id": getattr(br, "session_id", None),
            "status": getattr(br, "status", None),
        }
        for br in brs
    ]

    actions = compute_target_decline_actions(
        bunk_requests=br_dicts,
        inactive_cm_ids=inactive_cm_ids,
        active_session_by_cm_id=active_session_by_cm_id,
    )
    if not actions:
        logger.debug(f"target_decline: no actions for year={year}")
        return {"declined_count": 0, "error_count": 0}

    logger.info(
        f"target_decline: declining {len(actions)} bunk_requests "
        f"(year={year}, inactive_targets={len(inactive_cm_ids)}, "
        f"moved_targets={len(active_session_by_cm_id)})"
    )
    return apply_target_decline(pb_client, actions)


def _attendee_session_cm_id(attendee: Any) -> int | None:
    """Read the session.cm_id from an attendee record returned by PocketBase.

    Handles both expanded relations (`expand.session.cm_id`) and raw
    `session_id` fallback. Returns None if neither is available.
    """
    expand = getattr(attendee, "expand", None)
    if expand is not None:
        session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        if session is not None:
            cm_id = getattr(session, "cm_id", None)
            if cm_id:
                return int(cm_id)
    direct = getattr(attendee, "session_id", None)
    if direct:
        return int(direct)
    return None


def apply_target_decline(
    pb_client: Any,
    actions: list[TargetDeclineAction],
) -> dict[str, int]:
    """Apply each action by updating the corresponding bunk_requests row.

    A failure on one row is logged but does not stop the others. Phase C is
    a sidecar; it should never fail the surrounding pipeline.

    Args:
        pb_client: PocketBase client (or wrapper) with
            `.collection("bunk_requests").update(id, data)` available.
        actions: list returned by `compute_target_decline_actions`.

    Returns:
        Stats dict: {"declined_count": int, "error_count": int}
    """
    stats = {"declined_count": 0, "error_count": 0}
    if not actions:
        return stats

    collection = pb_client.collection("bunk_requests")
    for action in actions:
        payload = {
            "status": "declined",
            "disposition_reason": action.reason,
        }
        try:
            collection.update(action.bunk_request_id, payload)
            stats["declined_count"] += 1
        except Exception as e:
            stats["error_count"] += 1
            logger.warning(f"target_decline: failed to update {action.bunk_request_id} (reason={action.reason}): {e}")
    return stats

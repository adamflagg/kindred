"""Queue membership (clean spec §6.2, §6.4; D21: the server decides queue membership, counts and
totals). One function says which Requests views a grid row belongs to; the grid carries the answer on
each row and Today counts the same answers, so a count and the list it opens never disagree.

A row can be in several views (an appeal that needs an offer; a held request whose session isn't
settled). Every predicate reads only what the row already carries.
"""

from __future__ import annotations

from typing import Final, get_args

from api.schemas.financial_aid_decisions import GridRowOut, QueueOut, RoundStatusOut
from api.services.financial_aid_cancellations import TODO_CANCEL_REASON
from api.services.financial_aid_intake_types import (
    FLAG_DUPLICATE_SURVIVOR_WITHDRAWN,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
)

QUEUES: Final[tuple[QueueOut, ...]] = get_args(QueueOut)
# The words a round's state shows as (§6.1: "how the stage names map for display is slice 1's call"). One map on the
# server (D21), so the editor's "Stage →" and every screen say the same thing (plan review I5).
ROUND_STATUS_LABELS: Final[dict[RoundStatusOut, str]] = {
    "held": "On hold",
    "not_decided": "Not decided",
    "needs_offer": "Needs an offer",
    "pending_approval": "Pending approval",
    "refused": "Refused by finance",
    "posted": "Posted",
    "not_rebuilt": "Not rebuilt for that date",
}
# The states a request or a payer share is in while Not reconciled (D59): not yet confirmed by the
# ledger, or disagreeing with it. A row is off the view once ConfirmationOut.reconciled.
UNRECONCILED: Final = frozenset({"awaiting_sync", "short", "over", "not_in_campminder"})


def _waiting_on_family(row: GridRowOut) -> bool:
    """§6.2: posted rounds not yet ticked Accepted. A clawed-back round, or a cancelled request's, waits on no one."""
    return row.cancellation is None and any(
        r.status == "posted" and not r.accepted and not r.clawed_back for r in row.rounds
    )


def row_queues(row: GridRowOut) -> list[QueueOut]:
    """The views `row` belongs to, in the views' order (QUEUES)."""
    hold_codes = {issue.code for issue in row.holds}
    member: dict[QueueOut, bool] = {
        "needs_offer": any(r.status == "needs_offer" for r in row.rounds),
        "holds": bool(row.holds),
        "pending_approval": any(r.status == "pending_approval" for r in row.rounds),
        "waiting_on_family": _waiting_on_family(row),
        "appeals": any(r.round == 2 and r.ask is not None for r in row.rounds),
        "not_reconciled": row.confirmation is not None and not row.confirmation.reconciled,
        "to_reverse": bool(row.to_reverse),
        "session_not_settled": row.request_status == STATUS_UNMATCHED,
        "duplicates": row.request_status == STATUS_DUPLICATE_PENDING or FLAG_DUPLICATE_SURVIVOR_WITHDRAWN in hold_codes,
        "cancel_reason": any(todo.code == TODO_CANCEL_REASON for todo in row.todos or []),
    }
    return [queue for queue in QUEUES if member[queue]]

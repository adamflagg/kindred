"""Queue membership (clean spec §6.2, §6.4; D21: the server decides queue membership, counts and
totals). One function says which Requests views a grid row belongs to; the grid carries the answer on
each row and Today counts the same answers, so a count and the list it opens never disagree.

A row can be in several views (an appeal that needs an offer; a held request whose session isn't
settled). Every predicate reads only what the row already carries.
"""

from __future__ import annotations

from typing import Final, get_args

from api.schemas.financial_aid_decisions import GridRowOut, QueueOut, RoundOut, RoundStatusOut, UntickedReasonOut
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
# ledger, or disagreeing with it. A row is off direction (a) once ConfirmationOut.reconciled; direction (b) is
# GridRowOut.unticked (D162).
UNRECONCILED: Final = frozenset({"awaiting_sync", "short", "over", "not_in_campminder"})


# D162: Not reconciled's direction (b) reasons, in the words Today's breakdown shows (D21: one map, on the server).
UNTICKED_LABELS: Final[dict[UntickedReasonOut, str]] = {
    "awaiting_tick": "awaiting tonight's tick",
    "withheld": "withheld: priced since the posting",
    "short_posting": "short posting",
    "shares_short": "payer shares not covering",
    "family_level": "family-level money",
    "not_decided": "not decided yet",
    "undone": "un-ticked by hand",
}


def offer_rounds(row: GridRowOut) -> list[RoundOut]:
    """The rounds Needs an offer holds (§6.2): decided, not posted, and with no money in CampMinder the tick passed
    over. A round CampMinder holds money for is Not reconciled's only (D162, Q1): it has money in CampMinder, and
    leaving it in Needs an offer invites posting the family twice."""
    unticked = {u.round for u in row.unticked or []}
    return [r for r in row.rounds if r.status == "needs_offer" and r.round not in unticked]


def _waiting_on_family(row: GridRowOut) -> bool:
    """§6.2: posted rounds not yet ticked Accepted. A clawed-back round waits on no one, nor does a request on
    To reverse (cancelled, or withdrawn with its aid live): that one is To reverse's (Decision 10)."""
    return (
        row.cancellation is None
        and not row.to_reverse
        and any(r.status == "posted" and not r.accepted and not r.clawed_back for r in row.rounds)
    )


def row_queues(row: GridRowOut) -> list[QueueOut]:
    """The views `row` belongs to, in the views' order (QUEUES)."""
    hold_codes = {issue.code for issue in row.holds}
    member: dict[QueueOut, bool] = {
        "needs_offer": bool(offer_rounds(row)),
        "holds": bool(row.holds),
        "pending_approval": any(r.status == "pending_approval" for r in row.rounds),
        "waiting_on_family": _waiting_on_family(row),
        "appeals": any(r.round == 2 and r.ask is not None for r in row.rounds),
        # D162: both directions. (a) posted rounds the ledger hasn't confirmed, or disagrees with; (b) money CampMinder
        # holds for a round with no Posted tick.
        "not_reconciled": (row.confirmation is not None and not row.confirmation.reconciled) or bool(row.unticked),
        "to_reverse": bool(row.to_reverse),
        "session_not_settled": row.request_status == STATUS_UNMATCHED,
        "duplicates": row.request_status == STATUS_DUPLICATE_PENDING or FLAG_DUPLICATE_SURVIVOR_WITHDRAWN in hold_codes,
        "cancel_reason": any(todo.code == TODO_CANCEL_REASON for todo in row.todos or []),
    }
    return [queue for queue in QUEUES if member[queue]]

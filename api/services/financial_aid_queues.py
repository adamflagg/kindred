"""Queue membership (clean spec §6.2, §6.4; D21: the server decides queue membership, counts and
totals). One function says which Requests views a grid row belongs to; the grid carries the answer on
each row and Today counts the same answers, so a count and the list it opens never disagree.

A row can be in several views (an appeal that needs an offer; a held request whose session isn't
settled). Every predicate reads only what the row already carries.
"""

from __future__ import annotations

from typing import Final, get_args

from api.schemas.financial_aid_decisions import (
    GridRowOut,
    QueueOut,
    RoundOut,
    RoundStatusOut,
    RowStageOut,
    UntickedReasonOut,
)
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
# The two Stage words that are no round's state (the grid's Stage column; row_stage). Beside ROUND_STATUS_LABELS so the
# screens keep no words of their own.
STAGE_ACCEPTED_WORDS: Final = "Accepted"
STAGE_CANCELLED_WORDS: Final = "Cancelled"
# The states a request or a payer share is in while Not reconciled (D59): a sync has run and CampMinder disagrees
# with the lock. A hand tick awaiting tonight's sync is none of them (V1, owner 10-03): it waits on the family, CM ✓
# "pending". A row is off direction (a) once ConfirmationOut.reconciled; direction (b) is GridRowOut.unticked (D162).
UNRECONCILED: Final = frozenset({"short", "over", "not_in_campminder"})


# D162: Not reconciled's direction (b) reasons, as pills (owner 10-03, verbatim). One map on the server (D21): the
# grid's chip (UntickedMoneyOut.label) and Today's breakdown both read it.
UNTICKED_LABELS: Final[dict[UntickedReasonOut, str]] = {
    "withheld": "Changed after posting",
    "short_posting": "Short in CM",
    "shares_short": "Payers short",
    "family_level": "Money to place",
    "on_hold": "On hold",
    "awaiting_approval": "Awaiting approval",
    "finance_declined": "Finance declined",
    "not_decided": "Not decided",
    "undone": "Unmarked by hand",
    "decided_zero": "Decided $0",
}


def offer_rounds(row: GridRowOut) -> list[RoundOut]:
    """The rounds Needs an offer holds (§6.2): decided, not posted, and with no money in CampMinder for them. A round
    CampMinder holds money for is out (D162, Q1): Not reconciled's when the tick passed over it, waiting on the family
    when it covers the round in full and tonight's tick posts it (C1, `cm_pending`). Leaving either in Needs an offer
    invites posting the family twice."""
    unticked = {u.round for u in row.unticked or []}
    return [r for r in row.rounds if r.status == "needs_offer" and not r.cm_pending and r.round not in unticked]


def _waiting_on_family(row: GridRowOut) -> bool:
    """§6.2: posted rounds not yet ticked Accepted, and a round CampMinder covers in full that tonight's tick posts
    (C1, `cm_pending`: it waits on the family at once). A clawed-back round waits on no one, nor does a request on
    To reverse (cancelled, or withdrawn with its aid live): that one is To reverse's (Decision 10)."""
    return (
        row.cancellation is None
        and not row.to_reverse
        and any((r.status == "posted" or r.cm_pending) and not r.accepted and not r.clawed_back for r in row.rounds)
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
    }
    return [queue for queue in QUEUES if member[queue]]


def row_stage(row: GridRowOut) -> RowStageOut | None:
    """The request's Stage column, from its latest round (the screens read this, never derive it): Cancelled, else
    "R{n} · {words}". An accepted round reads Accepted, whether posted or still pending (C1, `cm_pending`). A C1 round
    (CampMinder covers it in full, tonight's tick posts it) reads Posted though its status is still needs_offer. None
    when the row has no rounds. A past read has no cm_pending, so it reads the status alone."""
    if row.cancellation is not None:
        return RowStageOut(round=None, code="cancelled", label=STAGE_CANCELLED_WORDS)
    if not row.rounds:
        return None
    latest = max(row.rounds, key=lambda r: r.round)
    if (latest.status == "posted" or latest.cm_pending) and latest.accepted:
        code, words = "accepted", STAGE_ACCEPTED_WORDS
    elif latest.cm_pending and latest.status == "needs_offer":
        code, words = "posted", ROUND_STATUS_LABELS["posted"]
    else:
        code, words = latest.status, ROUND_STATUS_LABELS[latest.status]
    return RowStageOut(round=latest.round, code=code, label=f"R{latest.round} · {words}")

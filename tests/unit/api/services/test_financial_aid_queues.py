"""Queue membership (clean spec §6.2; D21: the server decides queue membership): which Requests views
a grid row belongs to. Today's counts (§6.4) count the same memberships, so a count and its list
never disagree. Fictional only."""

from __future__ import annotations

from datetime import date
from typing import Any, get_args

import pytest

from api.schemas.financial_aid_decisions import (
    CancellationOut,
    ConfirmationOut,
    GridRowOut,
    RoundOut,
    RoundStatusOut,
    ShareConfirmationOut,
    TodoOut,
)
from api.schemas.financial_aid_intake import IssueOut
from api.services.financial_aid_queues import QUEUES, ROUND_STATUS_LABELS, row_queues


def _round(n: int, status: str, **over: Any) -> RoundOut:
    base: dict[str, Any] = {
        "round": n,
        "status": status,
        "ask": None,
        "asked_on": None,
        "decided": None,
        "posted": None,
        "posted_on": None,
        "accepted": False,
        "pending_approval": None,
        "would_change_by": None,
        "counts_toward_budget": True,
        "rules_version": 1,
    }
    return RoundOut(**{**base, **over})


def _row(*rounds: RoundOut, **over: Any) -> GridRowOut:
    base: dict[str, Any] = {
        "request_id": "reqemma00000001",
        "household_cm_id": 1000001,
        "family_name": "The Johnson Family",
        "person_cm_id": 1000011,
        "camper_name": "Emma Johnson",
        "session_cm_id": 1000101,
        "session_name": "Session 2",
        "program_key": "summer",
        "pool": "camp",
        "request_status": "active",
        "tier": 2,
        "cost": 2000.0,
        "rounds": list(rounds),
        "total_decided": None,
        "total_posted": None,
        "holds": [],
        "released_holds": [],
        "notes": [],
    }
    return GridRowOut(**{**base, **over})


def _confirmation(status: str, shares: list[ShareConfirmationOut] | None = None) -> ConfirmationOut:
    # Confirmation.reconciled's rule: V1 (owner 10-03) reads a hand tick awaiting tonight's sync as reconciled for now.
    ok = ("confirmed", "awaiting_sync")
    reconciled = status == "reversed" or (status in ok and all(s.status in ok for s in shares or []))
    return ConfirmationOut(
        status=status,
        locked=1500.0,
        in_campminder=1290.0,
        gap=-210.0,
        on=None,
        reconciled=reconciled,
        family_unplaced=0.0,
        shares=shares or [],
    )


def test_a_round_decided_and_not_posted_needs_an_offer() -> None:
    assert row_queues(_row(_round(1, "needs_offer", decided=1500.0))) == ["needs_offer"]


def test_a_held_request_is_in_holds() -> None:
    row = _row(_round(1, "held"), holds=[IssueOut(code="household_income_conflict", severity="hold", message="x")])
    assert row_queues(row) == ["holds"]


def test_a_round_3_awaiting_finance_is_pending_approval_not_needs_an_offer() -> None:
    """D79: it joins Needs an offer only once finance approves."""
    row = _row(
        _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
        _round(3, "pending_approval", pending_approval=900.0),
    )
    assert row_queues(row) == ["pending_approval"]


def test_a_posted_round_not_yet_accepted_is_waiting_on_the_family() -> None:
    row = _row(_round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)))
    assert row_queues(row) == ["waiting_on_family"]


def test_a_request_withdrawn_on_a_cancelled_enrollment_is_to_reverse_and_waits_on_no_one() -> None:
    """Its `cancellation` is None (only live requests carry one), but To reverse is the cancelled request's view."""
    row = _row(
        _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)),
        request_status="withdrawn",
        cancellation=None,
        to_reverse=True,
    )
    assert row_queues(row) == ["to_reverse"]


def test_a_clawed_back_round_waits_on_no_one() -> None:
    row = _row(_round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9), clawed_back=True))
    assert row_queues(row) == []


def test_a_round_2_ask_is_an_appeal() -> None:
    row = _row(
        _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
        _round(2, "needs_offer", ask=400.0, decided=300.0),
    )
    assert row_queues(row) == ["needs_offer", "appeals"]


@pytest.mark.parametrize("status", ["short", "over", "not_in_campminder"])
def test_a_posted_round_the_ledger_hasnt_confirmed_is_not_reconciled(status: str) -> None:
    row = _row(
        _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
        confirmation=_confirmation(status),
    )
    assert row_queues(row) == ["not_reconciled"]


@pytest.mark.parametrize("status", ["confirmed", "reversed", "awaiting_sync"])
def test_confirmed_or_reversed_is_reconciled(status: str) -> None:
    """V1 (owner 10-03): a hand tick awaiting tonight's sync is no exception until a sync has run and failed it."""
    row = _row(
        _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
        confirmation=_confirmation(status),
    )
    assert row_queues(row) == []


def test_a_confirmed_request_with_a_payer_share_short_is_still_not_reconciled() -> None:
    """A row whose confirmation says not reconciled (here a payer share short, D59) is in Not reconciled.
    The helper sets `reconciled` itself; the share rule proper is tested with Confirmation."""
    shares = [
        ShareConfirmationOut(household_cm_id=1000001, expected=750.0, in_campminder=750.0, status="confirmed"),
        ShareConfirmationOut(household_cm_id=1000002, expected=750.0, in_campminder=0.0, status="not_in_campminder"),
    ]
    row = _row(
        _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
        confirmation=_confirmation("confirmed", shares),
    )
    assert row_queues(row) == ["not_reconciled"]


def test_cancelled_with_aid_live_is_to_reverse_and_asks_for_a_reason() -> None:
    row = _row(
        _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)),
        request_status="active",
        cancellation=CancellationOut(by="campminder", on=date(2031, 5, 2), reason=None, note=""),
        to_reverse=True,
        todos=[TodoOut(code="cancel_reason_missing", message="Cancelled: give a reason")],
    )
    assert row_queues(row) == ["to_reverse", "cancel_reason"]


def test_an_unmatched_session_is_session_not_settled() -> None:
    assert row_queues(_row(request_status="unmatched_session")) == ["session_not_settled"]


def test_a_pending_duplicate_and_a_revived_one_are_duplicates() -> None:
    assert row_queues(_row(request_status="duplicate_pending")) == ["duplicates"]
    revived = _row(
        _round(1, "held"),
        holds=[IssueOut(code="duplicate_survivor_withdrawn", severity="hold", message="x")],
    )
    assert row_queues(revived) == ["holds", "duplicates"]


def test_a_withdrawn_request_with_nothing_posted_is_in_no_queue() -> None:
    assert row_queues(_row(request_status="withdrawn")) == []


def test_queues_come_back_in_the_one_fixed_order() -> None:
    row = _row(
        _round(1, "needs_offer", decided=1500.0),
        _round(2, "held", ask=400.0),
        request_status="unmatched_session",
        holds=[IssueOut(code="placeholder_income", severity="hold", message="x")],
    )
    out = row_queues(row)
    assert out == ["needs_offer", "holds", "appeals", "session_not_settled"]
    assert out == [q for q in QUEUES if q in out]


def test_every_round_state_has_one_display_label() -> None:
    """Plan review I5 (D21): the stage words come from the server, one map, so no screen keeps its own."""
    assert set(ROUND_STATUS_LABELS) == set(get_args(RoundStatusOut))
    assert ROUND_STATUS_LABELS["needs_offer"] == "Needs an offer"
    assert ROUND_STATUS_LABELS["pending_approval"] == "Pending approval"

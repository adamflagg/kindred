"""One place splits a request's money across its payer shares (D81; ⚠39, owner ruling 2026-10-01): the Requests
grid's split rows and the household page's share table read the same whole dollars. Fictional only: the Johnson
household (1000001) applied for Emma; the Garcia household (1000002) pays half."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from api.schemas.financial_aid_decisions import GridRowOut, RoundOut
from api.services.financial_aid_share_split import grid_shares, payers, split
from tests.unit.api.services.decisions_fakes import share_row

JOHNSON, GARCIA = 1000001, 1000002
EMMA = "reqemma00000001"
HALVES = (share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "50"))


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


def _row(**over: Any) -> GridRowOut:
    base: dict[str, Any] = {
        "request_id": EMMA,
        "household_cm_id": JOHNSON,
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
        "rounds": [_round(1, "needs_offer", decided=1500.0)],
        "total_decided": 1500.0,
        "total_posted": None,
        "holds": [],
        "released_holds": [],
        "notes": [],
    }
    return GridRowOut(**{**base, **over})


def test_a_split_round_posts_each_payer_its_move_and_the_parts_add_up() -> None:
    """Decision 3. R1 posted 1,501 and R2 decided 301, split 50/50: Johnson (the applicant takes the odd dollar)
    goes from 751 to 901, Garcia from 750 to 901, so the round posts 150 and 151. Splitting the round alone
    (151 and 150) would leave each household's CampMinder total a dollar off what reconciliation expects."""
    row = _row(
        rounds=[_round(1, "posted", decided=1501.0, posted=1501.0), _round(2, "needs_offer", decided=301.0)],
        total_decided=1802.0,
        total_posted=1501.0,
    )
    out = grid_shares(row, HALVES, {JOHNSON: "The Johnson Family"})
    assert [(s.household_cm_id, s.family_name, s.share_pct, s.decided, s.posted, s.needs_offer) for s in out] == [
        (JOHNSON, "The Johnson Family", 50.0, 901.0, 751.0, 150.0),
        (GARCIA, "Household 1000002", 50.0, 901.0, 750.0, 151.0),
    ]
    assert sum(s.needs_offer or 0 for s in out) == 301.0


def test_a_first_offer_splits_the_whole_decided_amount() -> None:
    out = grid_shares(_row(), HALVES, {})
    assert [(s.decided, s.posted, s.needs_offer) for s in out] == [(750.0, None, 750.0), (750.0, None, 750.0)]


def test_one_payer_has_no_split_rows() -> None:
    assert grid_shares(_row(), payers(EMMA, JOHNSON, ()), {}) == []


def test_a_request_with_no_share_row_is_its_applicants_whole() -> None:
    (only,) = payers(EMMA, JOHNSON, ())
    assert (only.household_cm_id, only.share_pct) == (JOHNSON, Decimal(100))


def test_shares_that_dont_add_up_show_their_payers_with_no_dollars() -> None:
    short = (share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "40"))
    out = grid_shares(_row(), short, {})
    assert [(s.household_cm_id, s.decided, s.needs_offer) for s in out] == [(JOHNSON, None, None), (GARCIA, None, None)]


def test_nothing_needs_an_offer_once_every_decided_round_is_posted() -> None:
    row = _row(rounds=[_round(1, "posted", decided=1500.0, posted=1500.0)], total_posted=1500.0)
    assert [s.needs_offer for s in grid_shares(row, HALVES, {})] == [None, None]


def test_a_held_request_has_payers_and_no_dollars() -> None:
    row = _row(rounds=[_round(1, "held")], total_decided=None)
    assert [(s.decided, s.posted, s.needs_offer) for s in grid_shares(row, HALVES, {})] == [(None, None, None)] * 2


def test_split_is_empty_with_no_total() -> None:
    assert split(None, HALVES, JOHNSON) == {}


def test_a_zero_dollar_round_still_needs_its_offer_at_zero() -> None:
    """D74: $0 is a real zero. A Round 2 decided at $0 still needs its offer, so each payer's part reads $0, not
    "nothing there" (None)."""
    row = _row(
        rounds=[_round(1, "posted", decided=1500.0, posted=1500.0), _round(2, "needs_offer", decided=0.0)],
        total_posted=1500.0,
    )
    assert [s.needs_offer for s in grid_shares(row, HALVES, {})] == [0.0, 0.0]


def test_a_clawed_back_round_moves_each_payer_to_the_posted_split() -> None:
    """Decision 3, re-ruled: a payer's move is measured from the POSTED total, which leaves a clawed-back round
    out (reconciliation does the same). R1 (1,001) was clawed back, R2 posted 1,501, R3 needs an offer at 301:
    the payers go from 1,501 split (751/750) to 1,802 split (901/901), so the round posts 150 and 151."""
    row = _row(
        rounds=[
            _round(1, "posted", decided=1001.0, posted=1001.0, clawed_back=True),
            _round(2, "posted", decided=1501.0, posted=1501.0),
            _round(3, "needs_offer", decided=301.0),
        ],
        total_decided=2803.0,
        total_posted=1501.0,
    )
    out = grid_shares(row, HALVES, {})
    assert [s.needs_offer for s in out] == [150.0, 151.0]

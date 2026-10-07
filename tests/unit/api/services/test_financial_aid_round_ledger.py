"""How much of each posted round CampMinder's live net confirms (owner ruling ⚠10, 2026-10-02). Fictional only:
households 1000001 (applicant) and 1000002; one request, "emma"."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_reconciliation import CampLine, round_ledger
from bunking.financial_aid.decisions import PricedRequest, RoundLedger, RoundState
from tests.unit.api.services.decisions_fakes import share_row
from tests.unit.api.services.test_financial_aid_reconciliation import line
from tests.unit.bunking.financial_aid.test_decision_budget import priced, view

ZERO = Decimal(0)
MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)
MAR9 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)  # the last ledger sync, unless a test says otherwise
APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
AFTER_APR1_SYNC = APR1 + timedelta(hours=12)


def _state(n: int, amount: str, at: datetime, source: str = "tick") -> RoundState:
    return RoundState(
        round=n,
        posted=True,
        locked_amount=Decimal(amount),
        locked_at=at,
        posted_on=at.date(),
        lock_source=source,
    )


def _two(r1: str = "1500", r2: str = "500") -> PricedRequest:
    return priced("emma", 1000001, view(1, "posted", locked=r1), view(2, "posted", locked=r2))


STATES = {1: _state(1, "1500", MAR8), 2: _state(2, "500", MAR8 + timedelta(hours=1))}


def _ledger(
    lines: list[CampLine],
    *,
    states: dict[int, RoundState] = STATES,
    synced: datetime | None = AFTER_APR1_SYNC,
    request: PricedRequest | None = None,
    shares: tuple[PayerShareRecord, ...] = (),
) -> dict[int, RoundLedger]:
    return round_ledger(request or _two(), states, lines, shares, 1000001, synced_at=synced)


def test_round_1_confirmed_and_round_2_ticked_before_the_sync_leaves_only_round_2_unconfirmed() -> None:
    states = {1: _state(1, "1500", MAR8), 2: _state(2, "500", MAR9 + timedelta(hours=1))}
    assert _ledger([line(1, "1500", posted=MAR8)], states=states, synced=MAR9) == {
        1: RoundLedger(ZERO, False),
        2: RoundLedger(Decimal(500), True),
    }


def test_a_short_repost_leaves_round_2_short_only() -> None:
    reposted = [line(1, "1500", posted=MAR8, reversed_at=APR1), line(2, "1800", posted=APR1)]
    assert _ledger(reposted) == {1: RoundLedger(ZERO, False), 2: RoundLedger(Decimal(200), False)}


def test_separate_lines_per_round_give_the_same_answer_as_reverse_and_repost() -> None:
    separate_short = [line(1, "1500", posted=MAR8), line(2, "300", posted=APR1)]
    reposted_short = [line(1, "1500", posted=MAR8, reversed_at=APR1), line(2, "1800", posted=APR1)]
    separate_full = [line(1, "1500", posted=MAR8), line(2, "500", posted=APR1)]
    reposted_full = [line(1, "1500", posted=MAR8, reversed_at=APR1), line(2, "2000", posted=APR1)]
    assert (
        _ledger(separate_short)
        == _ledger(reposted_short)
        == {
            1: RoundLedger(ZERO, False),
            2: RoundLedger(Decimal(200), False),
        }
    )
    assert (
        _ledger(separate_full) == _ledger(reposted_full) == {1: RoundLedger(ZERO, False), 2: RoundLedger(ZERO, False)}
    )


def test_over_confirms_nothing_extra() -> None:
    assert _ledger([line(1, "2600", posted=MAR8)]) == {1: RoundLedger(ZERO, False), 2: RoundLedger(ZERO, False)}


def test_a_zero_lock_is_confirmed_and_a_negative_net_fills_nothing() -> None:
    zero = priced("emma", 1000001, view(1, "posted", locked="0"))
    assert _ledger([], request=zero, states={1: _state(1, "0", MAR8)}) == {1: RoundLedger(ZERO, False)}
    assert _ledger([line(1, "-300", posted=MAR8)]) == {
        1: RoundLedger(Decimal(1500), False),
        2: RoundLedger(Decimal(500), False),
    }


def test_a_clawed_back_round_and_an_unposted_round_have_no_entry() -> None:
    clawed = priced("emma", 1000001, replace(view(1, "posted", locked="1500"), clawed_back=True))
    assert _ledger([], request=clawed) == {}
    unposted = priced("emma", 1000001, view(1, "needs_offer", decided="1500"))
    assert _ledger([], request=unposted) == {}


def test_a_tick_from_the_ledger_or_a_placement_never_awaits_the_sync() -> None:
    for source in ("ledger", "placement"):
        states = {1: _state(1, "1500", MAR8), 2: _state(2, "500", APR1, source)}
        assert _ledger([line(1, "1500", posted=MAR8)], states=states, synced=MAR9)[2].awaiting is False


SPLIT = (share_row("emma", 1000001, "50"), share_row("emma", 1000002, "50"))


def test_an_uneven_split_posted_as_each_payers_move_confirms_every_round() -> None:
    """Decision 5: Round 1 $1,501 splits 751 (applicant) / 750; the $1,802 total splits 901 / 901, so Round 2's moves
    are 150 / 151. Each household posted exactly its move: nothing is unconfirmed (a per-round split would leave $1)."""
    request = _two("1501", "301")
    lines = [
        line(1, "751", posted=MAR8),
        line(2, "150", posted=APR1),
        line(3, "750", household=1000002, posted=MAR8),
        line(4, "151", household=1000002, posted=APR1),
    ]
    assert _ledger(lines, request=request, shares=SPLIT) == {1: RoundLedger(ZERO, False), 2: RoundLedger(ZERO, False)}


def test_one_payers_excess_never_covers_anothers_gap() -> None:
    request = _two("1501", "301")
    lines = [line(1, "751", posted=MAR8), line(3, "1000", household=1000002, posted=MAR8)]
    assert _ledger(lines, request=request, shares=SPLIT) == {
        1: RoundLedger(ZERO, False),
        2: RoundLedger(Decimal(150), False),
    }


def test_shares_not_adding_to_100_are_read_as_one_payer() -> None:
    broken = (share_row("emma", 1000001, "60"), share_row("emma", 1000002, "30"))
    lines = [line(1, "1500", posted=MAR8), line(2, "500", household=1000002, posted=APR1)]
    assert _ledger(lines, shares=broken) == {1: RoundLedger(ZERO, False), 2: RoundLedger(ZERO, False)}


def test_a_round_outside_the_budget_still_takes_its_part_of_the_net() -> None:
    """CampMinder's net doesn't know which round counts toward the budget: the $900 outside round fills first, so
    the in-budget $500 round is the unconfirmed one."""
    request = priced("emma", 1000001, view(1, "posted", locked="900", counts=False), view(2, "posted", locked="500"))
    assert _ledger([line(1, "900", posted=MAR8)], request=request) == {
        1: RoundLedger(ZERO, False),
        2: RoundLedger(Decimal(500), False),
    }


def _fund(locked: str = "3600", extra: str = "1600") -> PricedRequest:
    fund = replace(view(1, "posted", locked=locked, counts=False, extra=extra), extra_outside=True)
    return priced("emma", 1000001, fund)


def test_a_posted_fund_round_is_confirmed_by_camp_lines_netting_its_camp_award() -> None:
    """Owner 10-06: a $3,600 fund round is a $2,000 camp award plus $1,600 from the fund. CampMinder's camp-aid lines
    confirm the camp award only (the fund's own line is not camp aid), so $2,000 of camp lines leave nothing unconfirmed."""
    states = {1: _state(1, "3600", MAR8)}
    assert _ledger([line(1, "2000")], states=states, request=_fund()) == {1: RoundLedger(ZERO, False)}


def test_a_posted_fund_round_with_short_camp_lines_is_unconfirmed_by_the_camp_shortfall_only() -> None:
    """$2,000 camp award, camp lines net $1,500: $500 unconfirmed, not $2,100 (the remainder is never camp aid)."""
    states = {1: _state(1, "3600", MAR8)}
    assert _ledger([line(1, "1500")], states=states, request=_fund()) == {1: RoundLedger(Decimal(500), False)}

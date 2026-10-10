"""The capped ask (owner rulings A1–A5, 2026-10-09): one function for every Statistics Asked figure. All rounds is
Development's need capped at the session cost; a round chip is that round's ask, at most the cost less the awards
posted before it. Fictional only."""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.reports.facts import capped_ask, is_capped, need
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

THREE_ROUNDS = req(
    "reqemma00000001",
    rnd(1, ask="3000", posted="1200"),
    rnd(2, ask="1500", posted="1000"),
    rnd(3, ask="2000"),
    cost="4000",
)


def test_all_rounds_is_need_capped_at_the_cost() -> None:
    assert need(THREE_ROUNDS) == capped_ask(THREE_ROUNDS, None) == Decimal(4000)
    assert is_capped(THREE_ROUNDS)


def test_each_round_counts_at_most_the_cost_less_the_awards_posted_before_it() -> None:
    assert [capped_ask(THREE_ROUNDS, n) for n in (1, 2, 3)] == [Decimal(3000), Decimal(1500), Decimal(1800)]


def test_a_round_with_no_ask_has_no_capped_ask_and_one_past_the_cost_counts_zero() -> None:
    covered = req("reqemma00000001", rnd(1, ask="4000", posted="4000"), rnd(2, ask="500"), cost="4000")
    assert capped_ask(covered, 2) == Decimal(0)
    assert capped_ask(req("reqemma00000001", rnd(1, posted="100")), 1) is None


def test_with_no_priced_cost_the_ask_counts_as_typed() -> None:
    unpriced = req("reqemma00000001", rnd(1, ask="3000", posted="1200"), rnd(2, ask="9000"))
    assert capped_ask(unpriced, 2) == Decimal(9000)
    assert capped_ask(unpriced, None) == need(unpriced) == Decimal(10200)


def test_in_budget_leaves_out_a_round_an_outside_funder_pays_in_full() -> None:
    outside = req("reqemma00000001", rnd(1, ask="2000", posted="1500"), rnd(2, ask="3000", outside_budget=True))
    assert capped_ask(outside, None, in_budget=True) == Decimal(2000)
    assert capped_ask(outside, 2, in_budget=True) is None
    assert capped_ask(outside, None) == Decimal(4500)

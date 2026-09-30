"""A clawed-back round counts nowhere (campership sub-project 10b; spec §5.3; D54): its money came
back when CampMinder's reversal posted. Fictional throughout (the fixture's Camp pool: Round 1
allocated 340,000)."""

from dataclasses import replace
from decimal import Decimal

from bunking.financial_aid.decisions.budget import Count, season_budget
from tests.unit.bunking.financial_aid.test_decision_budget import RULES, pool_of, priced, view


def test_a_clawed_back_round_leaves_posted_and_accepted_and_its_money_returns_to_remaining() -> None:
    back = replace(view(1, "posted", locked="1800", accepted=True), clawed_back=True)
    kept = view(1, "posted", locked="1500", accepted=True)
    budget = season_budget([priced("emma", 1, back), priced("liam", 2, kept)], RULES, outside_grants={})
    r1 = pool_of(budget, "camp_pool").rounds[1]
    assert (r1.posted, r1.accepted, r1.needs_offer) == (Decimal(1500), Decimal(1500), Decimal(0))
    assert r1.remaining == Decimal("338500.00")
    assert (budget.strip[1].posted, budget.strip[1].accepted) == (Count(1, 1), Count(1, 1))


def test_a_clawed_back_discretionary_round_leaves_the_outside_budget_line_too() -> None:
    back = replace(view(1, "posted", locked="1800", counts=False, extra="300"), clawed_back=True)
    budget = season_budget([priced("emma", 1, back)], RULES, outside_grants={})
    assert pool_of(budget, "camp_pool").below.outside_budget == Decimal(0)

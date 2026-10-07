"""A clawed-back round counts nowhere (campership sub-project 10b; spec §5.3; D54): its money came
back when CampMinder's reversal posted. Fictional throughout (the fixture's Camp pool:
allocated 400,000)."""

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
    assert pool_of(budget, "camp_pool").total.remaining == Decimal("398500.00")
    assert (budget.strip[1].posted, budget.strip[1].accepted) == (Count(1, 1), Count(1, 1))


def test_a_clawed_back_discretionary_round_leaves_the_outside_budget_line_too() -> None:
    back = replace(view(1, "posted", locked="1800", counts=False, extra="300"), clawed_back=True)
    budget = season_budget([priced("emma", 1, back)], RULES, outside_grants={})
    assert pool_of(budget, "camp_pool").below.outside_budget == Decimal(0)


def test_a_clawed_back_round_adds_no_forward_demand() -> None:
    """A declined offer is not unmet ask: nothing of a clawed-back request is demand."""
    r1 = replace(view(1, "posted", ask="2000", locked="1450", accepted=True), clawed_back=True)
    r2 = replace(view(2, "posted", ask="500", locked="400", accepted=True), clawed_back=True)
    budget = season_budget(
        [priced("emma", 1, r1), priced("liam", 2, r1), priced("ava", 3, r1, r2)], RULES, outside_grants={}
    )
    demand = pool_of(budget, "camp_pool").demand
    assert (demand.round1_unmet, demand.round2_asks, demand.round2_asked, demand.round2_computed) == (
        Decimal(0),
        Count(),
        Decimal(0),
        Decimal(0),
    )


def test_a_clawed_back_round_1_leaves_a_live_unposted_round_2_ask_in_demand() -> None:
    r1 = replace(view(1, "posted", ask="2000", locked="1450", accepted=True), clawed_back=True)
    r2 = view(2, "needs_offer", ask="500", decided="400")
    demand = pool_of(season_budget([priced("emma", 1, r1, r2)], RULES, outside_grants={}), "camp_pool").demand
    assert (demand.round2_asks, demand.round2_asked, demand.round2_computed) == (
        Count(1, 1),
        Decimal(500),
        Decimal(400),
    )

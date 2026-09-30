"""Locked rounds (sub-project 10a; D43, D52). A round posted in CampMinder keeps the amount it
locked at, and every later round builds on that amount, whatever the rules or inputs say now.

The fixture's default request: tier 2, cost 4,000. Round 1 = 75% of cost = 3,000. Round 2's cap =
90% of cost (3,600) less Round 1. Fictional rules throughout.
"""

from decimal import Decimal

from bunking.financial_aid.calculator import calculate
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever

APPEAL = {"appeal_amount": "99999"}
ROUND3 = {"round2_decided": True, "round3_amount": "400", "round3_statement_of_need": True}


def test_a_request_with_nothing_locked_prices_as_before() -> None:
    result = calculate(app(), req(**APPEAL), fictional_rules())
    assert (result.r1, result.r2, result.r2_bound) == (Decimal(3000), Decimal(600), "cap")


def test_round_2_builds_on_round_1_as_it_was_locked() -> None:
    result = calculate(app(), req(**APPEAL, r1_locked="2900"), fictional_rules())
    assert (result.r1, result.r1_bound) == (Decimal(2900), "locked")
    assert result.r2 == Decimal(700)
    assert result.step("r1_locked").inputs["worked_out"] == Decimal(3000)


def test_a_locked_round_1_keeps_its_amount_when_the_table_changes() -> None:
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.2.r1_pct", "80")
    result = calculate(app(), req(r1_locked="3000"), rules)
    assert result.r1 == Decimal(3000)
    assert result.step("r1_locked").inputs["worked_out"] == Decimal(3200)


def test_round_3_and_the_total_follow_the_locked_rounds() -> None:
    result = calculate(app(), req(**APPEAL, **ROUND3, r1_locked="3000", r2_locked="500"), fictional_rules())
    assert (result.r2, result.r2_bound) == (Decimal(500), "locked")
    assert result.r3 == Decimal(400)
    assert result.total == Decimal(3900)


def test_the_total_aid_cap_never_cuts_a_locked_round() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": True})
    result = calculate(app(), req(**APPEAL, **ROUND3, r1_locked="3000", r2_locked="600"), rules)
    assert result.r2 == Decimal(600)
    assert result.r3 == Decimal(0)  # the cap's room (3,200 - 3,000 - 600) is gone, so Round 3 is cut


def test_a_locked_round_3_is_never_cut_by_the_total_cap() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": True})
    result = calculate(app(), req(**APPEAL, **ROUND3, r1_locked="3000", r2_locked="600", r3_locked="400"), rules)
    assert (result.r3, result.r3_bound) == (Decimal(400), "locked")


def test_a_locked_decision_round_already_holds_its_discretionary_money() -> None:
    # Round 2 posted at its full amount: 600 worked out plus 250 discretionary = 850.
    rules = with_lever(fictional_rules(), "awards.decision_types.discretionary.round", 2)
    request = req(**APPEAL, decision_type="discretionary", discretionary_amount="250", r1_locked="3000")
    before = calculate(app(), request, rules)
    assert before.total == Decimal(3850)
    after = calculate(app(), request.model_copy(update={"r2_locked": Decimal(600) + Decimal(250)}), rules)
    assert after.total == Decimal(3850)
    assert (after.top_up, after.discretionary) == (Decimal(0), Decimal(0))
    assert "award_above_cost" not in {i.code for i in after.issues}
    assert after.step("discretionary_locked").inputs["included_in_locked"] == Decimal(250)


def test_a_locked_decision_round_already_holds_its_top_up() -> None:
    request = req(**APPEAL, decision_type="appeal_top_up", r1_locked="3000")
    before = calculate(app(), request, fictional_rules())
    assert before.total == Decimal(3850)
    after = calculate(app(), request.model_copy(update={"r2_locked": Decimal(850)}), fictional_rules())
    assert (after.total, after.top_up) == (Decimal(3850), Decimal(0))
    assert "award_above_cost" not in {i.code for i in after.issues}
    assert after.step("top_up_locked").inputs["included_in_locked"] == Decimal(250)

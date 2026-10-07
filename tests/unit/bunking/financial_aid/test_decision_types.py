"""Named decision types: the full-cost program with its extra, a fixed top-up, discretionary."""

from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers

TIER_3 = {"prior_year_gross": "100000", "current_year_gross": "100000"}


def _full_cost(rules: AidRules | None = None, **request: Any) -> CalcResult:
    fields = {"ask": "5000", "decision_type": "full_cost_program", **request}
    return calculate(app(**TIER_3), req(**fields), rules or fictional_rules())


def test_full_cost_lands_the_total_at_cost_plus_the_extra() -> None:
    result = _full_cost()
    assert (result.r1, result.r1_bound, result.top_up, result.total) == (
        Decimal(4000),
        "full_cost",
        Decimal(50),
        Decimal(4050),
    )
    assert result.step("top_up").label == "Top-up: Full-cost program"


def test_when_the_ask_binds_the_top_up_covers_the_rest() -> None:
    result = _full_cost(ask="3000")
    assert (result.r1, result.r1_bound, result.top_up, result.total) == (
        Decimal(3000),
        "ask",
        Decimal(1050),
        Decimal(4050),
    )


def test_a_grant_is_netted_out_of_a_full_cost_award() -> None:
    result = _full_cost(grants_applicable=[{"amount": "1000", "state": "committed"}])
    assert (result.r1, result.top_up, result.total) == (Decimal(3000), Decimal(50), Decimal(3050))


def test_the_extra_is_a_lever() -> None:
    # Ruling P4: extra_amount must move to a non-zero value the pre-implementation engine
    # cannot reproduce. "0" / 4000 passes even before Round 3/top-up exists (top_up defaulted
    # to 0 and full_cost R1 already lands at cost), so it would prove nothing.
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.extra_amount", "20")
    assert _full_cost(rules).total == Decimal(4020)


def test_a_full_cost_award_takes_no_appeal() -> None:
    result = _full_cost(appeal_amount="500")
    assert (result.r2, result.r2_bound, result.total) == (Decimal(0), "not_allowed", Decimal(4050))
    assert "appeal_not_allowed" in result.issue_codes()


def test_allowing_an_appeal_on_full_cost_shows_why_it_was_barred() -> None:
    # 75% of 4,000 = 3,000 is below the 4,000 already given: the cap is negative.
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.allows_appeal", True)
    result = _full_cost(rules, appeal_amount="500")
    assert (result.r2_cap, result.r2) == (Decimal(-1000), Decimal(0))
    assert "r2_cap_negative" in result.issue_codes()


def test_an_eligible_round_3_reduces_the_full_cost_top_up_instead_of_stacking() -> None:
    # With allows_appeal=True and a small, eligible Round 3, the top-up must absorb
    # the Round 3 amount rather than being computed against r1/r2 alone -- otherwise
    # the total overshoots cost - grants + extra by however much Round 3 paid.
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.allows_appeal", True)
    result = _full_cost(rules, round3_amount="20", round2_decided=True, round3_statement_of_need=True)
    assert (result.r1, result.r2, result.r3, result.top_up, result.total) == (
        Decimal(4000),
        None,
        Decimal(20),
        Decimal(30),
        Decimal(4050),
    )


def test_a_full_cost_award_takes_no_round_3_bonus() -> None:
    # A full-cost award that disallows an appeal must disallow Round 3 too, or the total
    # can exceed cost + extra with status "ok" -- exactly the appeal_not_allowed pattern.
    result = _full_cost(round3_amount="500", round2_decided=True, round3_statement_of_need=True)
    assert (result.r3, result.r3_bound, result.total) == (Decimal(0), "not_allowed", Decimal(4050))
    assert "round3_not_allowed" in result.issue_codes()


def test_full_cost_with_an_unknown_cost_needs_input() -> None:
    result = _full_cost(session_cm_id=1000999)
    assert (result.status, result.total) == ("needs_input", None)
    assert "cost_unknown" in result.issue_codes()


def test_a_fixed_top_up_adds_its_amount() -> None:
    request = req(decision_type="appeal_top_up", appeal_amount="400")
    result = calculate(app(), request, fictional_rules())
    assert (result.r2, result.top_up, result.total) == (Decimal(400), Decimal(250), Decimal(3650))
    rules = with_lever(fictional_rules(), "awards.decision_types.appeal_top_up.amount", "125")
    assert calculate(app(), request, rules).total == Decimal(3525)


def test_a_decision_type_kind_is_a_lever() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "awards.decision_types.appeal_top_up.kind": "discretionary",
            "awards.decision_types.appeal_top_up.amount": None,
        },
    )
    result = calculate(app(), req(decision_type="appeal_top_up", appeal_amount="400"), rules)
    assert (result.top_up, result.total) == (Decimal(0), Decimal(3400))


def test_a_discretionary_decision_takes_the_typed_amount() -> None:
    result = calculate(app(), req(decision_type="discretionary", discretionary_amount="175"), fictional_rules())
    assert (result.top_up, result.discretionary, result.total) == (Decimal(0), Decimal(175), Decimal(3175))


# --- the income ceiling stops all of the camp's own money (spec section 2 item 21) -----------

ABOVE_CEILING = {"prior_year_gross": "230000", "current_year_gross": "230000"}


def _above_ceiling(rules: AidRules | None = None, **request: Any) -> CalcResult:
    rules = with_lever(rules or fictional_rules(), "tiers.income_ceiling", "220000")
    return calculate(app(**ABOVE_CEILING), req(**request), rules)


def test_above_the_ceiling_a_named_top_up_pays_nothing() -> None:
    result = _above_ceiling(decision_type="appeal_top_up", appeal_amount="400")
    assert (result.r2, result.top_up, result.total) == (Decimal(0), Decimal(0), Decimal(0))
    assert result.step("top_up").bound == "income_ceiling"


def test_above_the_ceiling_a_full_cost_decision_does_not_pay_the_whole_cost() -> None:
    # Before the fix Round 1 was forced to 0 and the top-up then paid cost + extra in full.
    result = _above_ceiling(ask="5000", decision_type="full_cost_program")
    assert (result.r1, result.top_up, result.total) == (Decimal(0), Decimal(0), Decimal(0))


def test_above_the_ceiling_discretionary_money_is_withheld_and_flagged() -> None:
    result = _above_ceiling(decision_type="discretionary", discretionary_amount="500")
    assert (result.discretionary, result.total) == (Decimal(0), Decimal(0))
    assert ("above_income_ceiling", "warn") in {(i.code, i.severity) for i in result.issues}
    assert result.step("discretionary").inputs["withheld"] == Decimal(500)


def test_a_ceiling_exempt_decision_type_still_pays_above_the_ceiling() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "awards.decision_types.appeal_top_up.ceiling_exempt": True,
            "awards.decision_types.discretionary.ceiling_exempt": True,
        },
    )
    top_up = _above_ceiling(rules, decision_type="appeal_top_up")
    assert (top_up.r1, top_up.top_up, top_up.total) == (Decimal(0), Decimal(250), Decimal(250))
    typed = _above_ceiling(rules, decision_type="discretionary", discretionary_amount="500")
    assert (typed.discretionary, typed.total) == (Decimal(500), Decimal(500))
    assert "above_income_ceiling" not in typed.issue_codes()


def test_below_the_ceiling_discretionary_money_is_paid_as_before() -> None:
    rules = with_lever(fictional_rules(), "tiers.income_ceiling", "220000")
    result = calculate(app(), req(decision_type="discretionary", discretionary_amount="175"), rules)
    assert (result.discretionary, result.total) == (Decimal(175), Decimal(3175))


FUND = {
    "label": "Named full-cost fund",
    "kind": "full_cost_after_aid",
    "round": 1,
    "allows_appeal": False,
    "counts_toward_budget": False,
}


def _fund_rules(**levers: object) -> AidRules:
    rules = with_lever(fictional_rules(), "awards.decision_types.named_full_cost_fund", FUND)
    return with_levers(rules, {"cost.tuition.1000102": "3600", **levers})


def test_the_fund_pays_what_the_camp_award_leaves_of_the_cost() -> None:
    """§9.9: a $2,000 camp award on a $3,600 session, with no grant, leaves $1,600 for the fund."""
    result = calculate(app(), req(ask="2000", decision_type="named_full_cost_fund"), _fund_rules())
    assert (result.r1, result.top_up, result.total) == (Decimal(2000), Decimal(1600), Decimal(3600))


def test_an_outside_grant_on_the_request_reduces_the_fund() -> None:
    """Owner 10-06 (a): the fund pays cost − camp award − outside grants. Tier 2 is 75% of $3,600 = $2,700, less the
    $500 grant (dollar offset) = $2,200, so the $2,000 ask binds Round 1; the fund pays $3,600 − $2,000 − $500 = $1,100.
    The camp award plus the grant plus the fund is exactly the cost."""
    grant = [{"amount": "500", "state": "committed"}]
    result = calculate(
        app(), req(ask="2000", decision_type="named_full_cost_fund", grants_applicable=grant), _fund_rules()
    )
    assert (result.r1, result.top_up, result.total) == (Decimal(2000), Decimal(1100), Decimal(3100))
    assert result.step("top_up").note == "Pays what the camp award and outside grants leave of the cost"


def test_grants_that_already_cover_the_cost_leave_the_fund_nothing() -> None:
    """Owner 10-06 (a), never below $0: a $3,600 grant covers the $3,600 session; Round 1 still pays the $100 minimum
    (minimum_when_fully_covered), and $3,600 − $100 − $3,600 = −$100 floors at $0."""
    grant = [{"amount": "3600", "state": "committed"}]
    result = calculate(
        app(), req(ask="2000", decision_type="named_full_cost_fund", grants_applicable=grant), _fund_rules()
    )
    assert (result.r1, result.top_up, result.total) == (Decimal(100), Decimal(0), Decimal(100))


def test_the_fund_never_pays_below_zero() -> None:
    rules = _fund_rules(**{"award_tables.camp.tiers.2.r1_pct": "100"})
    result = calculate(app(), req(ask="4000", decision_type="named_full_cost_fund"), rules)
    assert (result.r1, result.top_up) == (Decimal(3600), Decimal(0))


def test_the_fund_adds_no_extra_amount() -> None:
    """No $75-style extra: the schema refuses one on any kind but full_cost."""
    with pytest.raises(ValidationError, match="only a full_cost decision type has extra_amount"):
        with_lever(fictional_rules(), "awards.decision_types.named_full_cost_fund", FUND | {"extra_amount": "75"})

"""Round 1 through calculate(): table, minimum, ask cap, grants, full cost, ceiling, unknowns."""

from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers

TIER_3 = {"prior_year_gross": "100000", "current_year_gross": "100000"}
TIER_5 = {"prior_year_gross": "170000", "current_year_gross": "170000"}
TIER_6 = {"prior_year_gross": "250000", "current_year_gross": "250000"}


def _calc(rules: AidRules | None = None, application: ApplicationInputs | None = None, **request: Any) -> CalcResult:
    return calculate(application or app(), req(**request), rules or fictional_rules())


def _grant(amount: str) -> dict[str, str]:
    return {"amount": amount, "state": "committed"}


def test_round_1_is_the_table_percentage_of_cost() -> None:
    result = _calc()  # tier 2: 75% of 4,000
    assert (result.status, result.r1_potential, result.r1, result.r1_bound) == (
        "ok",
        Decimal(3000),
        Decimal(3000),
        "table",
    )
    assert (result.income_tier, result.final_tier, result.cost, result.total) == (2, 2, Decimal(4000), Decimal(3000))


def test_the_trace_runs_in_calculation_order() -> None:
    assert [s.key for s in _calc().trace] == [
        "weighted_income",
        "income_adjustments",
        "adjusted_income",
        "income_tier",
        "equity_shift",
        "final_tier",
        "cost",
        "grants",
        "r1_pct",
        "r1_potential",
        "r1",
        "total",
    ]


def test_the_ask_caps_round_1() -> None:
    result = _calc(ask="1200")
    assert (result.r1, result.r1_bound, result.r1_potential) == (Decimal(1200), "ask", Decimal(3000))


def test_an_ask_of_zero_is_zero_not_the_minimum() -> None:
    # (Review Focus) The ask cap applies after the minimum.
    result = _calc(application=app(**TIER_6), session_cm_id=1000101, ask="0")
    assert (result.r1_potential, result.r1) == (Decimal(100), Decimal(0))


def test_the_ask_cap_is_a_lever() -> None:
    assert _calc(with_lever(fictional_rules(), "awards.ask_cap", False), ask="1200").r1 == Decimal(3000)


def test_the_minimum_binds_where_the_table_gives_less() -> None:
    # Tier 6: 2% of 2,000 is 40, below the 100 minimum.
    result = _calc(application=app(**TIER_6), session_cm_id=1000101)
    assert (result.r1_potential, result.r1, result.r1_bound) == (Decimal(100), Decimal(100), "minimum")
    rules = with_lever(fictional_rules(), "awards.minimum", "150")
    assert _calc(rules, application=app(**TIER_6), session_cm_id=1000101).r1 == Decimal(150)


def test_round_1_rounds_half_up_at_point_five() -> None:
    # Tier 5: 15% of 4,030 = 604.5 -> 605. Banker's rounding would under-award $1.
    result = _calc(application=app(**TIER_5), cost_override={"amount": "4030", "reason": "discount"})
    assert (result.r1_potential, result.r1) == (Decimal("604.5"), Decimal(605))


def test_income_rounding_decides_the_tier_and_so_the_award() -> None:
    result = _calc(application=app(prior_year_gross="79999", current_year_gross="80004"))
    assert (result.adjusted_income, result.income_tier, result.r1) == (Decimal(80001), 3, Decimal(2200))


def test_a_program_with_no_round_1_table_gets_only_the_minimum() -> None:
    rules = with_lever(fictional_rules(), "programs.summer.r1_table", None)
    result = _calc(rules)
    assert (result.r1, result.r1_bound) == (Decimal(100), "minimum")
    assert _calc(program_key="adult_weekend", session_cm_id=1000401).r1 == Decimal(100)


def test_no_table_and_no_minimum_without_one_is_zero() -> None:
    rules = with_lever(fictional_rules(), "awards.minimum_without_table", False)
    result = _calc(rules, program_key="adult_weekend", session_cm_id=1000401)
    assert (result.r1, result.r1_bound) == (Decimal(0), "no_table")


def test_an_unknown_cost_pays_the_minimum_and_says_so() -> None:
    result = _calc(session_cm_id=1000999)
    assert (result.status, result.r1, result.r1_bound, result.cost) == ("ok", Decimal(100), "minimum", None)
    assert ("cost_unknown", "warn") in {(i.code, i.severity) for i in result.issues}


def test_an_unknown_cost_without_the_minimum_needs_input() -> None:
    rules = with_lever(fictional_rules(), "awards.minimum_when_cost_unknown", False)
    result = _calc(rules, session_cm_id=1000999)
    assert (result.status, result.r1, result.total) == ("needs_input", None, None)


def test_above_the_income_ceiling_there_is_no_award() -> None:
    rules = with_lever(fictional_rules(), "tiers.income_ceiling", "220000")
    above = _calc(rules, application=app(prior_year_gross="230000", current_year_gross="230000"))
    assert (above.r1, above.r1_bound, above.total) == (Decimal(0), "income_ceiling", Decimal(0))
    below = _calc(rules, application=app(prior_year_gross="210000", current_year_gross="210000"))
    assert (below.r1, below.r1_bound) == (Decimal(100), "minimum")


def test_an_unknown_program_is_an_error_not_a_zero() -> None:
    result = _calc(program_key="space_camp")
    assert (result.status, result.r1, result.total) == ("error", None, None)
    assert result.issue_codes() == {"unknown_program"}


def test_a_closed_program_is_an_error() -> None:
    assert _calc(program_key="other", session_cm_id=None).issue_codes() == {"program_closed"}
    rules = with_lever(fictional_rules(), "programs.summer.open_to_aid", False)
    assert _calc(rules).status == "error"


def test_an_income_below_the_first_band_is_an_error() -> None:
    rules = with_levers(
        fictional_rules(), {"income.per_dependent_reduction": "3000", "income.floor_applies_after": "deductions"}
    )
    result = _calc(rules, application=app(prior_year_gross="10000", current_year_gross="10000", dependents=4))
    assert (result.status, result.adjusted_income, result.income_tier) == ("error", Decimal(-2000), None)
    assert "income_below_first_band" in result.issue_codes()


def test_an_unknown_decision_type_is_an_error() -> None:
    assert _calc(decision_type="lottery").issue_codes() == {"unknown_decision_type"}


# --- grants in Round 1 ----------------------------------------------------------------


def test_a_grant_offsets_round_1_dollar_for_dollar() -> None:
    rules = with_lever(fictional_rules(), "grants.offset_mode", "dollar")
    result = _calc(rules, grants_applicable=[_grant("1000")])
    assert (result.grants_offset, result.r1_potential, result.r1) == (Decimal(1000), Decimal(2000), Decimal(2000))


def test_a_grant_can_reduce_the_cost_basis_instead() -> None:
    rules = with_lever(fictional_rules(), "grants.offset_mode", "reduce_cost_basis")
    assert _calc(rules, grants_applicable=[_grant("1000")]).r1 == Decimal(2250)  # 75% of 3,000


def test_a_grant_larger_than_the_cost_never_goes_negative() -> None:
    # (Review Focus) 75% of max(4,000 - 5,000, 0) = 0.
    rules = with_lever(fictional_rules(), "grants.offset_mode", "reduce_cost_basis")
    assert _calc(rules, grants_applicable=[_grant("5000")]).r1 == Decimal(100)
    rules = with_lever(rules, "grants.minimum_after_grants", False)
    assert _calc(rules, grants_applicable=[_grant("5000")]).r1 == Decimal(0)


@pytest.mark.parametrize(
    ("after_grants", "grant", "r1", "bound"),
    [(True, "500", 100, "minimum"), (False, "500", 0, "grants_cover"), (False, "30", 70, "minimum")],
)
def test_minimum_after_grants(after_grants: bool, grant: str, r1: int, bound: str) -> None:
    # Tier 6 at 2,000: the table gives 40. True (2026): the minimum is paid on top of the grant.
    # False: aid + grant together reach the minimum.
    rules = with_lever(fictional_rules(), "grants.minimum_after_grants", after_grants)
    result = _calc(rules, application=app(**TIER_6), session_cm_id=1000101, grants_applicable=[_grant(grant)])
    assert (result.r1, result.r1_bound) == (Decimal(r1), bound)


def test_grants_offset_only_the_listed_programs() -> None:
    request: dict[str, Any] = {
        "program_key": "bmitzvah",
        "session_cm_id": 1000301,
        "grants_applicable": [_grant("1000")],
    }
    assert _calc(**request).r1 == Decimal(2250)
    rules = with_lever(fictional_rules(), "grants.offset_programs", ["summer", "quest", "bmitzvah"])
    assert _calc(rules, **request).r1 == Decimal(1250)


def test_when_the_ask_binds_a_grant_changes_nothing() -> None:
    assert _calc(ask="1500", grants_applicable=[_grant("1000")]).r1 == Decimal(1500)


# --- decision types, incentives, discretionary ----------------------------------------


def test_a_full_cost_decision_prices_round_1_at_the_whole_cost_less_grants() -> None:
    result = _calc(application=app(**TIER_3), ask="5000", decision_type="full_cost_program")
    assert (result.r1_potential, result.r1, result.r1_bound) == (Decimal(4000), Decimal(4000), "full_cost")
    with_grant = _calc(
        application=app(**TIER_3), ask="5000", decision_type="full_cost_program", grants_applicable=[_grant("1000")]
    )
    assert with_grant.r1 == Decimal(3000)


@pytest.mark.parametrize(("mode", "r1"), [("ignore", 3000), ("reduce_cost", 2625), ("reduce_award", 2500)])
def test_an_incentive_meets_aid_as_the_season_says(mode: str, r1: int) -> None:
    rules = with_lever(fictional_rules(), "grants.incentives.new_family.mode", mode)
    assert _calc(rules, incentives=[{"key": "new_family", "amount": "500"}]).r1 == Decimal(r1)


def test_discretionary_money_adds_to_the_total() -> None:
    result = _calc(discretionary_amount="175")
    assert (result.r1, result.discretionary, result.total) == (Decimal(3000), Decimal(175), Decimal(3175))


def test_each_request_has_its_own_final_tier() -> None:
    household = app(**TIER_3)
    first = _calc(application=household, equity_answers={"bipoc": "Yes"})
    second = _calc(application=household, person_cm_id=1000003)
    assert (first.final_tier, first.r1, second.final_tier, second.r1) == (2, Decimal(3000), 3, Decimal(2200))


def test_family_camp_is_a_household_request_priced_by_headcount() -> None:
    result = _calc(
        person_cm_id=None,
        program_key="family_camp",
        session_cm_id=1000201,
        headcount={"standard": 3, "infants": 1},
    )
    assert (result.cost, result.r1) == (Decimal(2100), Decimal(1575))  # 75% of 2,100


# --- controller rulings: missing income, malformed rules drafts -----------------------


def test_missing_income_needs_input_and_is_never_priced_as_tier_1() -> None:
    # Ruling (Task 6): no income figure at all is not the same as an income of 0.
    result = _calc(application=app(prior_year_gross=None, current_year_gross=None))
    assert (result.status, result.income_tier, result.r1, result.total) == ("needs_input", None, None, None)
    assert ("income_missing", "needs_input") in {(i.code, i.severity) for i in result.issues}


@pytest.mark.parametrize(
    ("levers", "application"),
    [
        # C1 repro 1: an AGI basis with only gross reported priced AGI at 0 -> tier 1, status ok.
        ({"income.basis": "agi"}, {"prior_year_gross": "100000", "current_year_gross": "100000"}),
        # C1 repro 2: a blend with the current year missing blended it as 0.
        ({}, {"prior_year_gross": "100000", "current_year_gross": None}),
        # C1 repro 3: an override choosing an absent figure.
        (
            {},
            {"prior_year_gross": None, "current_year_gross": "100000", "income_override": {"mode": "prior_year_only"}},
        ),
    ],
)
def test_a_needed_income_figure_that_is_absent_needs_input(levers: dict[str, Any], application: dict[str, Any]) -> None:
    rules = with_levers(fictional_rules(), levers)
    result = _calc(rules, application=app(**application))
    assert (result.status, result.adjusted_income, result.income_tier, result.r1, result.total) == (
        "needs_input",
        None,
        None,
        None,
        None,
    )
    assert ("income_missing", "needs_input") in {(i.code, i.severity) for i in result.issues}


def test_a_reported_zero_income_is_priced_not_missing() -> None:
    result = _calc(application=app(prior_year_gross="0", current_year_gross="0"))
    assert (result.status, result.income_tier, result.r1) == ("ok", 1, Decimal(3600))  # 90% of 4,000
    assert "income_missing" not in result.issue_codes()


def test_a_program_naming_a_missing_table_is_a_rules_error_not_a_crash() -> None:
    # Ruling P2: scenarios feed rules drafts, which may be half-edited.
    rules = with_lever(fictional_rules(), "programs.summer.r1_table", "no_such_table")
    result = _calc(rules)
    assert (result.status, result.r1, result.total) == ("error", None, None)
    assert result.issue_codes() == {"rules_error"}
    assert "no_such_table" in next(i.message for i in result.issues if i.code == "rules_error")


def test_a_table_missing_the_final_tier_is_a_rules_error() -> None:
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers", {"1": {"r1_pct": "90", "total_pct": "97"}})
    result = _calc(rules)  # tier 2, which the table no longer has
    assert (result.status, result.r1, result.total) == ("error", None, None)
    message = next(i.message for i in result.issues if i.code == "rules_error")
    assert "camp" in message
    assert "tier 2" in message

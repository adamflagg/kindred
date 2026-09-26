"""Round 2 (appeal) with its cap, Round 3 eligibility and limits, and the total-aid cap."""

from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever

TIER_5 = {"prior_year_gross": "170000", "current_year_gross": "170000"}
TIER_6 = {"prior_year_gross": "250000", "current_year_gross": "250000"}
ELIGIBLE_R3: dict[str, Any] = {"round2_decided": True, "round3_statement_of_need": True}


def _calc(rules: AidRules | None = None, application: ApplicationInputs | None = None, **request: Any) -> CalcResult:
    return calculate(application or app(), req(**request), rules or fictional_rules())


def _grant(amount: str) -> dict[str, str]:
    return {"amount": amount, "state": "committed"}


# --- Round 2 --------------------------------------------------------------------------


def test_without_an_appeal_there_is_no_round_2() -> None:
    result = _calc()
    assert (result.r2, result.r2_cap) == (None, None)
    assert "r2" not in {s.key for s in result.trace}


@pytest.mark.parametrize(("appeal", "r2", "bound"), [("1000", 600, "cap"), ("400", 400, "appeal")])
def test_round_2_is_the_appeal_up_to_the_cap(appeal: str, r2: int, bound: str) -> None:
    # Tier 2: 90% of 4,000 = 3,600, less Round 1's 3,000 = a 600 cap.
    result = _calc(appeal_amount=appeal)
    assert (result.r2_cap, result.r2, result.r2_bound) == (Decimal(600), Decimal(r2), bound)
    assert result.total == Decimal(3000 + r2)


@pytest.mark.parametrize(("subtract", "r2"), [(False, 1600), (True, 600)])
def test_the_round_2_cap_and_grants(subtract: bool, r2: int) -> None:
    # A 1,000 grant brings Round 1 to 2,000. 2026 ignored grants in the cap, so a capped
    # appeal handed the offset back: 3,600 - 2,000 = 1,600.
    rules = with_lever(fictional_rules(), "round2.cap_subtracts_grants", subtract)
    assert _calc(rules, grants_applicable=[_grant("1000")], appeal_amount="2000").r2 == Decimal(r2)


@pytest.mark.parametrize(("capped", "r2", "bound"), [(False, 600, "cap"), (True, 200, "original_ask")])
def test_the_appeal_can_be_capped_by_the_original_ask(capped: bool, r2: int, bound: str) -> None:
    rules = with_lever(fictional_rules(), "round2.cap_by_original_ask", capped)
    result = _calc(rules, ask="3200", appeal_amount="1000")
    assert (result.r1, result.r2, result.r2_bound) == (Decimal(3000), Decimal(r2), bound)


def test_a_negative_cap_gives_zero_and_a_warning_never_a_negative_award() -> None:
    # Tier 6 at 500: Round 1 is the 100 minimum, but 12% of 500 is 60, so the cap is -40.
    result = _calc(application=app(**TIER_6), cost_override={"amount": "500", "reason": "discount"}, appeal_amount="50")
    assert (result.r1, result.r2_cap, result.r2) == (Decimal(100), Decimal(-40), Decimal(0))
    assert "r2_cap_negative" in result.issue_codes()


def test_no_round_2_table_means_round_2_is_zero() -> None:
    # Exercises "round2.program_tables": which Round 2 table each program's appeals use.
    rules = with_lever(fictional_rules(), "round2.program_tables.summer", None)
    result = _calc(rules, appeal_amount="500")
    assert (result.r2, result.r2_bound) == (Decimal(0), "no_table")
    school = _calc(
        program_key="family_school",
        session_cm_id=1000501,
        cost_override={"amount": "1000", "reason": "missing_catalog"},
        appeal_amount="300",
    )
    assert (school.r2, school.r2_bound) == (Decimal(0), "no_table")


def test_a_program_with_only_a_round_2_table_can_still_appeal() -> None:
    # Adult weekend: no Round 1 table (the minimum, 100) but a Round 2 table: 90% of 900 - 100 = 710.
    result = _calc(program_key="adult_weekend", session_cm_id=1000401, appeal_amount="500")
    assert (result.r1, result.r2_cap, result.r2) == (Decimal(100), Decimal(710), Decimal(500))


def test_an_appeal_with_an_unknown_cost_needs_input() -> None:
    result = _calc(session_cm_id=1000999, appeal_amount="500")
    assert (result.status, result.r1, result.r2) == ("needs_input", Decimal(100), None)
    assert result.total is None


def test_round_2_rounds_half_up() -> None:
    # Tier 5 at 4,015: Round 1 = round(602.25) = 602; cap = 30% x 4,015 - 602 = 602.5 -> 603.
    result = _calc(
        application=app(**TIER_5), cost_override={"amount": "4015", "reason": "discount"}, appeal_amount="1000"
    )
    assert (result.r1, result.r2_cap, result.r2) == (Decimal(602), Decimal("602.5"), Decimal(603))


def test_a_malformed_round_2_table_is_a_rules_error() -> None:
    # Ruling P2 applies to Round 2 too: a rules draft naming a table that is not there
    # gives a graceful rules_error, never an uncaught exception.
    rules = with_lever(fictional_rules(), "round2.program_tables.summer", "gold")
    result = _calc(rules, appeal_amount="500")
    assert result.status == "error"
    assert "rules_error" in result.issue_codes()
    assert (result.r2, result.total) == (None, None)


def test_the_round_2_cap_reads_the_round_2_table() -> None:
    # Round 2's percentages live in `round2`, apart from Round 1's, so staff can set them after
    # Round 1 results without re-opening Round 1. Tier 2: 95% of 4,000 - 3,000 = 800.
    rules = with_lever(fictional_rules(), "round2.tables.camp.tiers.2.total_pct", "95")
    result = _calc(rules, appeal_amount="2000")
    assert (result.r1, result.r2_cap, result.r2) == (Decimal(3000), Decimal(800), Decimal(800))


def test_a_program_missing_from_the_round_2_routing_is_a_rules_error() -> None:
    rules = fictional_rules()
    routing = {k: v for k, v in rules.round2.program_tables.items() if k != "summer"}
    rules = rules.model_copy(update={"round2": rules.round2.model_copy(update={"program_tables": routing})})
    result = _calc(rules, appeal_amount="500")
    assert result.status == "error"
    assert "rules_error" in result.issue_codes()


# --- a grant recorded before the appeal is decided counts in it (owner ruling S5) ---------

R1_DECIDED = "2031-03-01T12:00:00Z"
BETWEEN = "2031-04-01T12:00:00Z"
R2_DECIDED = "2031-05-01T12:00:00Z"
AFTER = "2031-06-01T12:00:00Z"


def _appeal_with_grant(rules: AidRules, recorded_at: str, amount: str = "300", **request: Any) -> CalcResult:
    # Tier 2 at 4,000: Round 1 is 3,000 and the Round 2 cap 90% x 4,000 - 3,000 = 600. The
    # grant arrives after the Round 1 decision, so Round 1 (already offered) leaves it out.
    fields = {
        "appeal_amount": "2000",
        "r1_decided_at": R1_DECIDED,
        "r2_decided_at": R2_DECIDED,
        "grants_applicable": [{"amount": amount, "state": "committed", "recorded_at": recorded_at}],
        **request,
    }
    return _calc(rules, **fields)


_SUBTRACTS = with_lever(fictional_rules(), "round2.cap_subtracts_grants", True)


def test_a_grant_recorded_before_the_appeal_is_decided_reduces_round_2() -> None:
    result = _appeal_with_grant(_SUBTRACTS, BETWEEN)
    assert (result.r1, result.grants_offset, result.r2_cap, result.r2) == (
        Decimal(3000),
        Decimal(0),
        Decimal(300),
        Decimal(300),
    )
    assert result.step("r2_cap").inputs["grants_since_round1"] == Decimal(300)


def test_a_grant_recorded_while_the_appeal_is_still_open_counts_too() -> None:
    assert _appeal_with_grant(_SUBTRACTS, BETWEEN, r2_decided_at=None).r2 == Decimal(300)


def test_a_grant_recorded_after_the_appeal_is_decided_leaves_round_2_alone() -> None:
    assert _appeal_with_grant(_SUBTRACTS, AFTER).r2 == Decimal(600)


def test_when_the_cap_ignores_grants_a_grant_before_the_appeal_changes_nothing() -> None:
    # 2026's quirk (round2.cap_subtracts_grants false): no grant reduces the appeal cap.
    assert _appeal_with_grant(fictional_rules(), BETWEEN).r2 == Decimal(600)


def test_the_total_cap_counts_a_grant_recorded_before_the_appeal_is_decided() -> None:
    # 80% of 4,000 = 3,200, less the 300 grant, is below Round 1's 3,000: no room for Round 2.
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": True})
    assert (_appeal_with_grant(rules, BETWEEN).r2, _appeal_with_grant(rules, AFTER).r2) == (Decimal(0), Decimal(200))


def test_the_above_cost_check_counts_a_grant_known_before_the_appeal_offer() -> None:
    # Round 2 lands the award at cost (100% table); a grant known before the appeal was
    # decided then takes it above cost, which holds. One recorded after is accepted.
    rules = with_lever(fictional_rules(), "round2.tables.camp.tiers.2.total_pct", "100")
    before = _appeal_with_grant(rules, BETWEEN, appeal_amount="1000")
    assert before.total == Decimal(4000)
    assert "award_above_cost" in before.issue_codes()
    assert "award_above_cost" not in _appeal_with_grant(rules, AFTER, appeal_amount="1000").issue_codes()


def test_an_appeal_that_adds_nothing_does_not_move_the_offer_for_the_above_cost_check() -> None:
    # Round 1 (3,000) was offered, then a 1,500 grant arrived: above cost, but after the offer,
    # which is accepted. An appeal decided later that pays nothing is not a new offer, so the
    # grant must not hold the award. Only an appeal that adds money moves the offer date.
    result = _appeal_with_grant(fictional_rules(), BETWEEN, amount="1500", appeal_amount="0")
    assert result.r2 == Decimal(0)
    assert "award_above_cost" not in result.issue_codes()


def test_a_barred_full_cost_appeal_keeps_the_round_1_offer_and_its_award() -> None:
    # A full-cost decision takes no appeal. A grant after the Round 1 offer neither holds the
    # award nor shrinks the full-cost top-up already offered (no clawback).
    rules = with_lever(fictional_rules(), "grants.late_grant_policy", "ignore")
    offered = _calc(rules, ask="5000", decision_type="full_cost_program")
    result = _appeal_with_grant(rules, BETWEEN, ask="5000", decision_type="full_cost_program", appeal_amount="500")
    assert (result.r2_bound, result.total) == ("not_allowed", offered.total)
    assert "award_above_cost" not in result.issue_codes()


# --- the total-aid cap ----------------------------------------------------------------

_CAP_80 = {"pct_of_cost": "80", "include_grants": True}


def test_the_total_cap_trims_round_2() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", _CAP_80)
    result = _calc(rules, appeal_amount="1000")
    assert (result.r2, result.r2_bound, result.total) == (Decimal(200), "total_cap", Decimal(3200))


@pytest.mark.parametrize(("include_grants", "r2"), [(True, 200), (False, 1000)])
def test_the_total_cap_can_count_grants(include_grants: bool, r2: int) -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": include_grants})
    assert _calc(rules, grants_applicable=[_grant("1000")], appeal_amount="1000").r2 == Decimal(r2)


def test_the_total_cap_trims_round_3_after_round_2() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", _CAP_80)
    result = _calc(rules, round3_amount="1000", **ELIGIBLE_R3)
    assert (result.r3, result.r3_bound) == (Decimal(200), "total_cap")


def test_a_total_cap_trim_of_round_2_shows_in_the_trace() -> None:
    # I4 (final review): staff read the trace directly, so the r2 step must carry the
    # trimmed value the result carries, and the total_cap step must show before/after.
    rules = with_lever(fictional_rules(), "round2.total_cap", _CAP_80)
    result = _calc(rules, appeal_amount="1000")
    step = result.step("r2")
    assert (step.value, step.bound) == (result.r2, result.r2_bound) == (Decimal(200), "total_cap")
    assert step.inputs["before_total_cap"] == Decimal(600)  # the Round 2 cap: 90% of 4,000 - 3,000
    cap = result.step("total_cap")
    assert (cap.inputs["r2_before"], cap.inputs["r2_after"]) == (Decimal(600), Decimal(200))


def test_a_total_cap_trim_of_round_3_shows_in_the_trace() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", _CAP_80)
    result = _calc(rules, round3_amount="1000", **ELIGIBLE_R3)
    step = result.step("r3")
    assert (step.value, step.bound) == (result.r3, result.r3_bound) == (Decimal(200), "total_cap")
    cap = result.step("total_cap")
    assert (cap.inputs["r3_before"], cap.inputs["r3_after"]) == (Decimal(1000), Decimal(200))


def test_an_untrimmed_round_keeps_its_own_trace_step() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "100", "include_grants": True})
    result = _calc(rules, appeal_amount="400")
    assert (result.step("r2").value, result.step("r2").bound) == (Decimal(400), "appeal")
    cap = result.step("total_cap")
    assert cap.inputs["r2_before"] == cap.inputs["r2_after"] == Decimal(400)


def test_the_total_cap_with_an_unknown_cost_needs_input() -> None:
    # The total cap silently skipped its own computation when cost was unknown, dropping
    # the cost_unknown signal instead of surfacing it like Round 2 and Round 3 do.
    rules = with_lever(fictional_rules(), "round2.total_cap", _CAP_80)
    result = _calc(rules, session_cm_id=1000999, round3_amount="1000", **ELIGIBLE_R3)
    assert (result.status, result.total) == ("needs_input", None)
    assert "cost_unknown" in result.issue_codes()


# --- Round 3 --------------------------------------------------------------------------


def test_round_3_for_an_eligible_request() -> None:
    result = _calc(round3_amount="1000", **ELIGIBLE_R3)
    assert (result.r3, result.r3_bound, result.total) == (Decimal(1000), "request", Decimal(4000))


def test_round_3_needs_a_statement_of_need() -> None:
    result = _calc(round3_amount="1000", round2_decided=True)
    assert (result.r3, result.r3_bound) == (Decimal(0), "not_eligible")
    assert "round3_not_eligible" in result.issue_codes()
    rules = with_lever(fictional_rules(), "round3.require_statement_of_need", False)
    assert _calc(rules, round3_amount="1000", round2_decided=True).r3 == Decimal(1000)


def test_round_3_needs_a_round_2_decision() -> None:
    assert _calc(round3_amount="1000", round3_statement_of_need=True).r3 == Decimal(0)
    rules = with_lever(fictional_rules(), "round3.require_round2", False)
    assert _calc(rules, round3_amount="1000", round3_statement_of_need=True).r3 == Decimal(1000)


def test_round_3_max_amount() -> None:
    rules = with_lever(fictional_rules(), "round3.max_amount", "1500")
    result = _calc(rules, round3_amount="2000", **ELIGIBLE_R3)
    assert (result.r3, result.r3_bound) == (Decimal(1500), "max_amount")


def test_round_3_share_of_cost_limit() -> None:
    # 100% of 4,000, less Round 1 (3,000) and Round 2 (600), leaves 400.
    rules = with_lever(fictional_rules(), "round3.max_total_pct_of_cost", "100")
    result = _calc(rules, appeal_amount="1000", round3_amount="1000", **ELIGIBLE_R3)
    assert (result.r2, result.r3, result.r3_bound) == (Decimal(600), Decimal(400), "cap")


def test_round_3_with_an_unknown_cost_needs_input() -> None:
    rules = with_lever(fictional_rules(), "round3.max_total_pct_of_cost", "100")
    result = _calc(rules, session_cm_id=1000999, round3_amount="1000", **ELIGIBLE_R3)
    assert (result.status, result.r3, result.total) == ("needs_input", None, None)


def test_the_full_trace_order() -> None:
    rules = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "100", "include_grants": True})
    keys = [s.key for s in _calc(rules, appeal_amount="400", round3_amount="100", **ELIGIBLE_R3).trace]
    assert keys[keys.index("r1") :] == ["r1", "r2_cap", "r2", "r3", "total_cap", "total"]

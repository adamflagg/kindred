"""A grid row's round says whether it counts toward the budget the way the budget strip does (scan of #3039): a named
full-cost fund round's camp award counts (owner 10-06), so the Requests filters that match on row membership must pass
the family under "counting toward the budget"."""

from decimal import Decimal

from api.schemas.financial_aid_decisions import RoundOut
from api.services.financial_aid_decisions_service import grid_row
from api.services.financial_aid_intake_types import RequestRecord
from bunking.financial_aid.calculator.inputs import RequestInputs
from bunking.financial_aid.decisions import RoundState
from bunking.financial_aid.decisions.holds import HoldState
from bunking.financial_aid.decisions.pricing import price_request
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, req, with_lever
from tests.unit.bunking.financial_aid.test_decision_pricing import item
from tests.unit.bunking.financial_aid.test_decision_types import _fund_rules

RECORD = RequestRecord(
    id="req-emma",
    year=2031,
    application_id="app-1",
    household_cm_id=1000001,
    person_cm_id=2000001,
    session_cm_id=1000102,
    program_key="camp",
    program_option_text="",
    program_option_key="",
    session_resolution="matched",
    ask=2000.0,
    headcount_non_infant=1,
    headcount_infant=0,
    headcount_source="application",
    status="open",
    duplicate_of="",
)


def _row_round(rules: AidRules, round_states: dict[int, RoundState], request: RequestInputs) -> RoundOut:
    priced = price_request(item(request=request, rounds=round_states, r1_ask=Decimal(2000)), rules)
    return grid_row(RECORD, priced, {}, {}, {}, {}, HoldState()).rounds[0]


def test_a_named_full_cost_fund_round_counts_toward_the_budget() -> None:
    keyed = {1: RoundState(round=1, discretionary_type="named_full_cost_fund")}
    row_round = _row_round(_fund_rules(), keyed, req(ask="2000", decision_type="named_full_cost_fund"))
    assert row_round.counts_toward_budget is True


def test_a_wholly_outside_round_does_not_count_toward_the_budget() -> None:
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.counts_toward_budget", False)
    keyed = {1: RoundState(round=1, discretionary_type="full_cost_program")}
    row_round = _row_round(rules, keyed, req(ask="2000", decision_type="full_cost_program"))
    assert row_round.counts_toward_budget is False

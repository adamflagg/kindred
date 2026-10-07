"""A grid row's round says whether it counts toward the budget the way the budget strip does (scan of #3039): a named
full-cost fund round's camp award counts (owner 10-06), so the Requests filters that match on row membership must pass
the family under "counting toward the budget"."""

from dataclasses import replace
from decimal import Decimal

import pytest

from api.schemas.financial_aid_decisions import RoundOut
from api.services.financial_aid_decisions_service import grid_row
from api.services.financial_aid_intake_types import RequestRecord
from bunking.financial_aid.calculator.inputs import RequestInputs
from bunking.financial_aid.decisions import RoundState
from bunking.financial_aid.decisions.holds import HoldState
from bunking.financial_aid.decisions.pricing import price_request
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _service
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
    labels = {k: t.label for k, t in rules.awards.decision_types.items()}
    return grid_row(RECORD, priced, {}, {}, {}, {}, HoldState(), type_labels=labels).rounds[0]


def test_a_named_full_cost_fund_round_counts_toward_the_budget() -> None:
    keyed = {1: RoundState(round=1, discretionary_type="named_full_cost_fund")}
    row_round = _row_round(_fund_rules(), keyed, req(ask="2000", decision_type="named_full_cost_fund"))
    assert row_round.counts_toward_budget is True


def test_a_wholly_outside_round_does_not_count_toward_the_budget() -> None:
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.counts_toward_budget", False)
    keyed = {1: RoundState(round=1, discretionary_type="full_cost_program")}
    row_round = _row_round(rules, keyed, req(ask="2000", decision_type="full_cost_program"))
    assert row_round.counts_toward_budget is False


def test_a_split_round_reports_its_outside_part_and_names_the_fund() -> None:
    """§12.2: $2,000 camp award + the fund's $1,600 on a $3,600 session (test_decision_types.py's fund)."""
    keyed = {1: RoundState(round=1, discretionary_type="named_full_cost_fund")}
    row_round = _row_round(_fund_rules(), keyed, req(ask="2000", decision_type="named_full_cost_fund"))
    assert (row_round.decided, row_round.outside_budget, row_round.outside_label) == (
        3600.0,
        1600.0,
        "Named full-cost fund",
    )


def test_a_wholly_outside_round_reports_all_of_it() -> None:
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.counts_toward_budget", False)
    keyed = {1: RoundState(round=1, discretionary_type="full_cost_program")}
    row_round = _row_round(rules, keyed, req(ask="2000", decision_type="full_cost_program"))
    assert row_round.outside_budget == row_round.decided
    assert row_round.outside_label == "Full-cost program"


def test_a_counting_round_reports_nothing_outside() -> None:
    row_round = _row_round(fictional_rules(), {}, req(ask="2000"))
    assert (row_round.outside_budget, row_round.outside_label) == (None, None)


def test_a_clawed_back_outside_round_reports_nothing() -> None:
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.counts_toward_budget", False)
    posted = RoundState(
        round=1,
        posted=True,
        locked_amount=Decimal(4050),
        discretionary_type="full_cost_program",
        snapshot={"counts_toward_budget": False, "decision_type": "full_cost_program", "decision_round": 1},
    )
    priced = price_request(
        item(request=req(ask="2000", decision_type="full_cost_program"), rounds={1: posted}, r1_ask=Decimal(2000)),
        rules,
    )
    priced = replace(priced, rounds=(replace(priced.rounds[0], clawed_back=True),))
    row_round = grid_row(
        RECORD, priced, {}, {}, {}, {}, HoldState(), type_labels={"full_cost_program": "Full-cost program"}
    ).rounds[0]
    assert (row_round.outside_budget, row_round.outside_label) == (None, None)


def test_the_key_stands_in_when_the_rules_lost_the_type() -> None:
    rules = with_lever(fictional_rules(), "awards.decision_types.full_cost_program.counts_toward_budget", False)
    keyed = {1: RoundState(round=1, discretionary_type="full_cost_program")}
    priced = price_request(
        item(request=req(ask="2000", decision_type="full_cost_program"), rounds=keyed, r1_ask=Decimal(2000)), rules
    )
    row_round = grid_row(RECORD, priced, {}, {}, {}, {}, HoldState(), type_labels={}).rounds[0]
    assert row_round.outside_label == "full_cost_program"


@pytest.mark.asyncio
async def test_the_services_row_names_the_fund_from_the_seasons_rules() -> None:
    """row_of hands the season's rules labels to the row, so the tag reads the rules' words, not the key."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    base = await service.season(YEAR)
    outside_round = replace(
        base.priced[EMMA].rounds[0],
        status="needs_offer",
        decided=Decimal(2000),
        counts_toward_budget=False,
        extra=Decimal(2000),
        decision_type="full_cost_program",
    )
    season = replace(base, priced={**base.priced, EMMA: replace(base.priced[EMMA], rounds=(outside_round,))})
    row = service.row_of(season, ({}, {}), EMMA)
    assert (row.rounds[0].outside_budget, row.rounds[0].outside_label) == (2000.0, "Full-cost program")

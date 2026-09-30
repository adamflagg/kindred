"""A request's rounds priced now (sub-project 10a). Fictional rules and inputs throughout.

The fixture's default request: tier 2, cost 4,000, asking 4,000. Round 1 = 3,000, and Round 2's cap
is 3,600 less Round 1. Round 3 needs a Round 2 ask and a statement of need; its maximum is 1,500."""

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from bunking.financial_aid.calculator import CalcIssue, GrantInput
from bunking.financial_aid.decisions import RoundState
from bunking.financial_aid.decisions.pricing import RequestToPrice, lock_snapshot, price_request
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers

RULES = fictional_rules()
T0 = datetime(2031, 3, 9, 17, 0, tzinfo=UTC)
POSTED_R1 = RoundState(
    round=1,
    posted=True,
    locked_amount=Decimal(3000),
    locked_at=T0,
    snapshot={"pool": "camp_pool", "counts_toward_budget": True},
)
APPEAL = RoundState(round=2, ask=Decimal(99999))
ROUND3 = RoundState(
    round=3, ask=Decimal(900), statement_of_need="A job was lost", award=Decimal(400), approval="pending"
)


def item(**overrides: Any) -> RequestToPrice:
    fields: dict[str, Any] = {
        "request_id": "req-emma",
        "household_cm_id": 1000001,
        "live": True,
        "application": app(),
        "request": req(),
        "blocked": "",
        "issues": (),
        "rounds": {},
        "r1_ask": Decimal(4000),
    }
    return RequestToPrice(**{**fields, **overrides})


def test_a_new_request_needs_its_round_1_offer() -> None:
    priced = price_request(item(), RULES)
    assert [v.round for v in priced.rounds] == [1]
    r1 = priced.view(1)
    assert r1 is not None
    assert (r1.status, r1.decided, r1.ask, r1.pool, r1.counts_toward_budget) == (
        "needs_offer",
        Decimal(3000),
        Decimal(4000),
        "camp_pool",
        True,
    )


def test_an_appeal_ask_prices_round_2() -> None:
    r2 = price_request(item(rounds={1: POSTED_R1, 2: APPEAL}), RULES).view(2)
    assert r2 is not None
    assert (r2.status, r2.ask, r2.decided) == ("needs_offer", Decimal(99999), Decimal(600))


def test_a_posted_round_1_shows_would_change_by_and_round_2_builds_on_the_lock() -> None:
    rules = with_lever(RULES, "award_tables.camp.tiers.2.r1_pct", "80")
    priced = price_request(item(rounds={1: POSTED_R1, 2: APPEAL}), rules)
    r1, r2 = priced.view(1), priced.view(2)
    assert r1 is not None
    assert r2 is not None
    assert (r1.status, r1.locked, r1.would_change_by) == ("posted", Decimal(3000), Decimal(200))
    assert r2.decided == Decimal(600)  # 3,600 less the locked 3,000, not less the 3,200 it would be now


def test_a_posted_round_with_nothing_changed_has_no_would_change_by() -> None:
    r1 = price_request(item(rounds={1: POSTED_R1}), RULES).view(1)
    assert r1 is not None
    assert r1.would_change_by is None


def test_round_1_s_decision_time_is_this_requests_own_lock() -> None:
    priced = price_request(item(rounds={1: POSTED_R1}), RULES)
    assert priced.inputs is not None
    assert priced.inputs.r1_decided_at == T0


def test_a_hold_stops_the_offer_until_it_is_released() -> None:
    hold = CalcIssue(code="placeholder_income", severity="hold", message="Placeholder income")
    held = price_request(item(issues=(hold,)), RULES)
    r1 = held.view(1)
    assert r1 is not None
    assert r1.status == "held"
    assert [h.code for h in held.holds] == ["placeholder_income"]
    released = price_request(item(issues=(hold,), released_holds=frozenset({"placeholder_income"})), RULES).view(1)
    assert released is not None
    assert released.status == "needs_offer"


def test_a_request_the_calculator_cannot_price_is_held_with_the_reason() -> None:
    priced = price_request(item(application=app(prior_year_gross=None, current_year_gross=None)), RULES)
    r1 = priced.view(1)
    assert r1 is not None
    assert (r1.status, r1.decided) == ("held", None)
    assert "income_missing" in {h.code for h in priced.holds}


def test_a_season_with_no_approved_rules_holds_every_request() -> None:
    priced = price_request(item(), None)
    r1 = priced.view(1)
    assert r1 is not None
    assert r1.status == "held"
    assert [h.code for h in priced.holds] == ["no_approved_rules"]


def test_a_request_intake_could_not_convert_is_held_with_intakes_reason() -> None:
    priced = price_request(item(request=None, blocked="the session is unmatched"), RULES)
    r1 = priced.view(1)
    assert r1 is not None
    assert r1.status == "held"
    assert [(h.code, h.message) for h in priced.holds] == [("not_priceable", "the session is unmatched")]


def test_a_round_3_amount_above_the_limit_is_pending_approval_at_its_keyed_amount() -> None:
    rounds: dict[int, RoundState] = {1: POSTED_R1, 2: APPEAL, 3: ROUND3}
    r3 = price_request(item(rounds=rounds), RULES).view(3)
    assert r3 is not None
    assert (r3.status, r3.pending) == ("pending_approval", Decimal(400))
    approved = price_request(item(rounds={**rounds, 3: replace(ROUND3, approval="approved")}), RULES).view(3)
    assert approved is not None
    assert (approved.status, approved.decided) == ("needs_offer", Decimal(400))
    refused = price_request(item(rounds={**rounds, 3: replace(ROUND3, approval="refused")}), RULES).view(3)
    assert refused is not None
    assert (refused.status, refused.decided) == ("refused", None)


def test_a_round_3_ask_with_no_amount_yet_is_not_decided() -> None:
    asked = RoundState(round=3, ask=Decimal(500), statement_of_need="A job was lost")
    r3 = price_request(item(rounds={1: POSTED_R1, 2: APPEAL, 3: asked}), RULES).view(3)
    assert r3 is not None
    assert (r3.status, r3.decided) == ("not_decided", None)


def test_discretionary_money_joins_its_decision_types_round() -> None:
    state = RoundState(round=3, discretionary=Decimal(250), discretionary_type="discretionary")
    priced = price_request(item(rounds={3: state}), RULES)
    r1, r3 = priced.view(1), priced.view(3)
    assert r1 is not None
    assert r3 is not None
    assert (r1.decided, r3.decided, r3.counts_toward_budget) == (Decimal(3000), Decimal(250), True)


def test_a_decision_types_round_and_budget_flag_are_rules_settings() -> None:
    rules = with_levers(
        RULES,
        {
            "awards.decision_types.discretionary.round": 2,
            "awards.decision_types.discretionary.counts_toward_budget": False,
        },
    )
    state = RoundState(round=2, discretionary=Decimal(250), discretionary_type="discretionary")
    r2 = price_request(item(rounds={2: state}), rules).view(2)
    assert r2 is not None
    assert (r2.decided, r2.counts_toward_budget) == (Decimal(250), False)


def test_outside_grants_reach_the_calculator_and_incentives_never_do() -> None:
    priced = price_request(item(grants=(GrantInput(amount=Decimal(500), state="committed"),)), RULES)
    r1 = priced.view(1)
    assert r1 is not None
    assert r1.decided == Decimal(2500)
    assert priced.inputs is not None
    assert priced.inputs.incentives == []


def test_a_family_camp_grant_counts_toward_never_above_cost_on_the_family_camp_request() -> None:
    # Family camp: 2 people x 600 = 1,200; Round 1 = 75% = 900. Grants don't offset family camp in
    # this season, but a grant known at the offer still counts toward never-above-cost.
    family = req(
        person_cm_id=None, session_cm_id=1000201, program_key="family_camp", headcount={"standard": 2}, ask="1200"
    )
    alone = price_request(item(request=family), RULES).view(1)
    assert alone is not None
    assert alone.status == "needs_offer"
    granted = price_request(item(request=family, grants=(GrantInput(amount=Decimal(500), state="committed"),)), RULES)
    assert "award_above_cost" in {h.code for h in granted.holds}


def test_a_withdrawn_request_keeps_its_posted_round_in_its_locked_pool() -> None:
    posted = replace(POSTED_R1, snapshot={"pool": "bmitzvah_pool", "counts_toward_budget": True})
    priced = price_request(item(live=False, request=None, blocked="withdrawn", rounds={1: posted, 2: APPEAL}), RULES)
    assert [(v.round, v.status, v.pool, v.locked) for v in priced.rounds] == [
        (1, "posted", "bmitzvah_pool", Decimal(3000))
    ]
    assert priced.holds == ()


def test_the_lock_snapshot_carries_the_receipt_and_where_it_counts() -> None:
    snapshot = lock_snapshot(price_request(item(), RULES), 1, rules_version=3)
    assert (snapshot["decided"], snapshot["pool"], snapshot["rules_version"], snapshot["program_key"]) == (
        "3000",
        "camp_pool",
        3,
        "summer",
    )
    assert snapshot["counts_toward_budget"] is True
    assert snapshot["result"]["r1"] == "3000"

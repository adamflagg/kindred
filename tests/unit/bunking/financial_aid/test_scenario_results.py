"""A scenario's results from the priced season (sub-project 9b; spec §7.4, §5.3). Real SP10a pricing over
fictional rules: session 1000102 costs 4,000 and the camp table gives tier 2 75%, so a 60,000 family's Round 1 is
3,000, and a 250,000 family (tier 6, 2% = 80) gets the 100 minimum. Round 1's allocation is 440,000 (camp 340,000
after its reserves, weekends 75,000, b'mitzvah 25,000)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

from bunking.financial_aid.decisions import PricedRequest, RequestToPrice, RoundState, price_request, season_budget
from bunking.financial_aid.scenarios import ScenarioResults, TierRow, round1_by_request, scenario_results, up_down
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req

RULES = fictional_rules()


def _priced(request_id: str, household: int, income: int, **fields: Any) -> PricedRequest:
    item = RequestToPrice(
        request_id=request_id,
        household_cm_id=household,
        live=True,
        application=app(household_cm_id=household, prior_year_gross=str(income), current_year_gross=str(income)),
        request=req(),
        blocked="",
        issues=(),
        rounds={},
        r1_ask=Decimal(4000),
    )
    return price_request(replace(item, **fields), RULES)


def _season() -> list[PricedRequest]:
    return [
        _priced("req-a", 1000001, 60000),
        _priced("req-b", 1000002, 250000),
        _priced("req-c", 1000003, 60000, request=None, blocked="the session is unmatched"),
    ]


def _results(priced: list[PricedRequest]) -> ScenarioResults:
    return scenario_results(priced, season_budget(priced, RULES, outside_grants={}))


def test_round1_and_its_remaining_are_the_budgets_own_figures() -> None:
    results = _results(_season())
    assert (results.round1, results.round2, results.round3) == (Decimal(3100), Decimal(0), Decimal(0))
    assert (results.round1_allocated, results.round1_remaining) == (Decimal("440000.00"), Decimal("436900.00"))
    assert results.remaining == Decimal("496900.00")
    assert (results.requests, results.families) == (3, 3)


def test_round1_unmet_is_reported_below_the_line_and_never_subtracted() -> None:
    results = _results(_season())
    # 4,000 asked: 1,000 unmet on req-a, 3,900 on req-b, and all 4,000 of the held req-c (§5.9).
    assert results.round1_unmet == Decimal(8900)
    pools = {p.pool: p for p in results.pools}
    assert (pools["camp_pool"].round1_unmet, pools[""].round1_unmet) == (Decimal(4900), Decimal(4000))
    assert results.round1_remaining == Decimal("436900.00")  # unchanged by it


def test_the_minimum_the_tiers_and_what_is_held() -> None:
    results = _results(_season())
    assert results.at_minimum == 1
    assert results.by_tier == [
        TierRow(tier=2, requests=1, families=1, round1=Decimal(3000)),
        TierRow(tier=6, requests=1, families=1, round1=Decimal(100)),
    ]
    assert (results.held, results.held_asked) == (1, Decimal(4000))


def test_each_pool_has_its_round1_and_its_remaining() -> None:
    pools = {p.pool: p for p in _results(_season()).pools}
    camp = pools["camp_pool"]
    assert (camp.label, camp.round1, camp.round1_allocated) == ("Camp", Decimal(3100), Decimal("340000.00"))
    assert camp.round1_remaining == Decimal("336900.00")
    assert pools["weekend_pool"].round1 == Decimal(0)


def test_a_posted_round1_counts_at_its_lock_and_never_at_the_minimum() -> None:
    posted = RoundState(
        round=1,
        posted=True,
        locked_amount=Decimal(2500),
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )
    priced = [
        _priced("req-a", 1000001, 60000, rounds={1: posted}),
        _priced("req-b", 1000002, 250000, rounds={1: posted}),
    ]
    results = _results(priced)
    assert results.round1 == Decimal(5000)
    assert results.at_minimum == 0
    assert round1_by_request(priced) == {"req-a": Decimal(2500), "req-b": Decimal(2500)}


def test_round1_by_request_leaves_held_requests_out() -> None:
    assert round1_by_request(_season()) == {"req-a": Decimal(3000), "req-b": Decimal(100)}


def test_up_and_down_count_only_requests_priced_on_both_sides() -> None:
    reference = {"req-a": Decimal(3000), "req-b": Decimal(100)}
    other = {"req-a": Decimal(3100), "req-b": Decimal(100), "req-c": Decimal(5)}
    assert up_down(reference, other) == (1, 0)
    assert up_down(other, reference) == (0, 1)


def test_results_round_trip_through_json() -> None:
    results = _results(_season())
    assert ScenarioResults.model_validate(results.model_dump(mode="json")) == results


def test_a_tier_row_stored_before_sp9c_still_loads() -> None:
    stored = {"tier": 2, "requests": 1, "families": 1, "round1": "3000"}
    assert TierRow.model_validate(stored) == TierRow(tier=2, requests=1, families=1, round1=Decimal(3000), asked=None)


def _posted(amount: str, *, counts: bool = True) -> RoundState:
    return RoundState(
        round=1,
        posted=True,
        locked_amount=Decimal(amount),
        snapshot={"pool": "camp_pool", "counts_toward_budget": counts},
    )


def test_the_tier_rows_and_what_is_in_no_tier_add_up_to_round1() -> None:
    """Final review 2: the tiers count Round 1 money exactly as the budget does. A clawed-back round and a round of a
    type outside the budget count in no tier (nor in Round 1); a withdrawn request's posted round counts in Round 1
    but has no tier today, so it is `not_in_tiers`."""
    clawed = _priced("req-b", 1000002, 250000, rounds={1: _posted("2500")})
    clawed = replace(clawed, rounds=(replace(clawed.rounds[0], clawed_back=True),))
    priced = [
        _priced("req-a", 1000001, 60000),  # tier 2, needs an offer: 3,000
        clawed,
        _priced("req-c", 1000003, 60000, rounds={1: _posted("2000", counts=False)}),  # outside the budget
        _priced("req-d", 1000004, 60000, live=False, rounds={1: _posted("1200")}),  # withdrawn after its post
    ]
    results = _results(priced)
    assert results.round1 == Decimal(4200)
    assert results.by_tier == [TierRow(tier=2, requests=1, families=1, round1=Decimal(3000))]
    assert results.not_in_tiers == Decimal(1200)
    assert sum((t.round1 for t in results.by_tier), Decimal(0)) + results.not_in_tiers == results.round1


def test_results_stored_before_not_in_tiers_still_load() -> None:
    stored = _results(_season()).model_dump(mode="json")
    del stored["not_in_tiers"]
    assert ScenarioResults.model_validate(stored).not_in_tiers == Decimal(0)

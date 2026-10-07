"""A scenario's results from the priced season (sub-project 9b; spec §7.4, §5.3). Real SP10a pricing over
fictional rules: session 1000102 costs 4,000 and the camp table gives tier 2 75%, so a 60,000 family's Round 1 is
3,000, and a 250,000 family (tier 6, 2% = 80) gets the 100 minimum. The pools' Allocated is 500,000 (camp 400,000,
weekends 75,000, b'mitzvah 25,000), with no reserves held back (§8.2)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

from bunking.financial_aid.calculator import CalcIssue
from bunking.financial_aid.decisions import PricedRequest, RequestToPrice, RoundState, price_request, season_budget
from bunking.financial_aid.scenarios import (
    Round2TierRow,
    ScenarioResults,
    TableTierRow,
    TierRow,
    committee_view,
    round1_by_request,
    scenario_results,
    up_down,
)
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_levers

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
    return scenario_results(priced, season_budget(priced, RULES, outside_grants={}), document=RULES)


def test_round1_and_its_remaining_are_the_budgets_own_figures() -> None:
    results = _results(_season())
    assert (results.round1, results.round2, results.round3) == (Decimal(3100), Decimal(0), Decimal(0))
    assert (results.round1_allocated, results.round1_remaining) == (Decimal("500000.00"), Decimal("496900.00"))
    assert results.remaining == Decimal("496900.00")
    assert (results.requests, results.families) == (3, 3)


def test_round1_unmet_is_reported_below_the_line_and_never_subtracted() -> None:
    results = _results(_season())
    # 4,000 asked: 1,000 unmet on req-a, 3,900 on req-b, and all 4,000 of the held req-c (§5.9).
    assert results.round1_unmet == Decimal(8900)
    pools = {p.pool: p for p in results.pools}
    assert (pools["camp_pool"].round1_unmet, pools[""].round1_unmet) == (Decimal(4900), Decimal(4000))
    assert results.round1_remaining == Decimal("496900.00")  # unchanged by it


def test_the_minimum_the_tiers_and_what_is_held() -> None:
    results = _results(_season())
    assert results.at_minimum == 1
    assert results.by_tier == [
        TierRow(tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000)),
        TierRow(tier=6, requests=1, families=1, round1=Decimal(100), asked=Decimal(4000)),
    ]
    assert (results.held, results.held_asked) == (1, Decimal(4000))


def test_each_pool_has_its_round1_and_its_remaining() -> None:
    pools = {p.pool: p for p in _results(_season()).pools}
    camp = pools["camp_pool"]
    assert (camp.label, camp.round1, camp.round1_allocated) == ("Camp", Decimal(3100), Decimal("400000.00"))
    assert camp.round1_remaining == Decimal("396900.00")
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
    assert results.by_tier == [TierRow(tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000))]
    assert results.not_in_tiers == Decimal(1200)
    assert sum((t.round1 for t in results.by_tier), Decimal(0)) + results.not_in_tiers == results.round1


def test_results_stored_before_not_in_tiers_still_load() -> None:
    stored = _results(_season()).model_dump(mode="json")
    del stored["not_in_tiers"]
    assert ScenarioResults.model_validate(stored).not_in_tiers == Decimal(0)


# --- SP9c: the committee's rows (RPT-17, RPT-32) ---------------------------------------------------------------


def _teen(request_id: str, household: int) -> PricedRequest:
    """A teen request: session 1000104 costs 5,000 and the teen table overrides tier 2 to 70%, so Round 1 is 3,500."""
    return _priced(request_id, household, 60000, request=req(session_cm_id=1000104, program_key="teen"))


def _appeal(ask: str) -> RoundState:
    return RoundState(round=2, ask=Decimal(ask))


def test_tier_rows_carry_the_round1_asks_of_the_requests_they_count() -> None:
    results = _results(_season())
    assert [(t.tier, t.asked) for t in results.by_tier] == [(2, Decimal(4000)), (6, Decimal(4000))]
    assert results.committee_rows is True


def test_round1_splits_by_the_award_table_each_program_uses() -> None:
    results = _results([*_season(), _teen("req-t", 1000004)])
    assert results.by_table == [
        TableTierRow(table="camp", tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000)),
        TableTierRow(table="camp", tier=6, requests=1, families=1, round1=Decimal(100), asked=Decimal(4000)),
        TableTierRow(table="teen", tier=2, requests=1, families=1, round1=Decimal(3500), asked=Decimal(4000)),
    ]
    # All (by_tier) is every table's rows together.
    assert results.by_tier[0] == TierRow(tier=2, requests=2, families=2, round1=Decimal(6500), asked=Decimal(8000))


def test_the_table_is_read_from_the_priced_document() -> None:
    priced = [_teen("req-t", 1000004)]
    moved = RULES.model_copy(
        update={"programs": {**RULES.programs, "teen": RULES.programs["teen"].model_copy(update={"r1_table": "camp"})}}
    )
    results = scenario_results(priced, season_budget(priced, RULES, outside_grants={}), document=moved)
    assert [(row.table, row.tier) for row in results.by_table] == [("camp", 2)]


def test_round2_by_tier_counts_appeals_their_asks_and_the_round2_the_budget_counts() -> None:
    # req-a (tier 2) appeals 1,000: the camp Round 2 cap is 90% of 4,000 = 3,600 less its 3,000 Round 1, so 600.
    # req-h (tier 2) appeals 500 but is held by a check: an appeal, never priced.
    held = _priced(
        "req-h",
        1000005,
        60000,
        rounds={2: _appeal("500")},
        issues=(CalcIssue(code="placeholder_income", severity="hold", message="Check the income", step="quality"),),
    )
    priced = [_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")}), held]
    results = _results(priced)
    assert results.by_tier == [
        TierRow(
            tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000), held=1, held_asked=Decimal(4000)
        )
    ]
    assert results.round2_by_tier == [
        Round2TierRow(
            table="camp",
            tier=2,
            appeals=2,
            asked=Decimal(1500),
            priced=1,
            priced_asked=Decimal(1000),
            round2=Decimal(600),
            held_asked=Decimal(500),  # req-h's appeal: in `asked`, never in `priced_asked`
        )
    ]
    assert results.round2 == Decimal(600)
    assert results.round2_not_in_tiers == Decimal(0)
    assert (results.round2_allocated, results.round2_remaining) == (None, None)


def _held_by_a_check(request_id: str, household: int, **fields: Any) -> PricedRequest:
    check = CalcIssue(code="placeholder_income", severity="hold", message="Check the income", step="quality")
    return _priced(request_id, household, 60000, issues=(check,), **fields)


def _posted2(round1: str, round2: str, ask: str) -> dict[int, RoundState]:
    lock = {"pool": "camp_pool", "counts_toward_budget": True}
    return {
        1: RoundState(round=1, posted=True, locked_amount=Decimal(round1), snapshot=lock),
        2: RoundState(round=2, ask=Decimal(ask), posted=True, locked_amount=Decimal(round2), snapshot=lock),
    }


def test_a_request_held_by_a_check_has_a_tier_but_stays_out_of_the_round1_rows_and_their_asks() -> None:
    results = _results([_priced("req-a", 1000001, 60000), _held_by_a_check("req-h", 1000005)])
    assert results.by_tier == [
        TierRow(
            tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000), held=1, held_asked=Decimal(4000)
        )
    ]
    assert (results.by_table[0].held, results.by_table[0].held_asked) == (1, Decimal(4000))


def test_held_asks_are_counted_apart_per_tier_and_leave_every_ratio_figure_alone() -> None:
    plain = _results([_priced("req-a", 1000001, 60000)])
    with_held = _results(
        [_priced("req-a", 1000001, 60000), _held_by_a_check("req-h", 1000005), _held_by_a_check("req-i", 1000006)]
    )
    [row] = with_held.by_tier
    assert (row.held, row.held_asked) == (2, Decimal(8000))
    # what the ratios divide: unchanged by the held requests
    [before] = plain.by_tier
    assert (row.requests, row.families, row.round1, row.asked, row.no_ask) == (
        before.requests,
        before.families,
        before.round1,
        before.asked,
        before.no_ask,
    )
    assert with_held.held_asked == Decimal(8000)  # the budget's below-the-line total agrees with the tier rows
    assert sum(r.held_asked for r in with_held.by_table) == row.held_asked


def test_a_held_appeal_is_counted_apart_and_the_priced_figures_stay_like_for_like() -> None:
    held = _held_by_a_check("req-h", 1000005, rounds={2: _appeal("500")})
    [row] = _results([_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")}), held]).round2_by_tier
    assert (row.appeals, row.asked, row.held_asked) == (2, Decimal(1500), Decimal(500))
    assert (row.priced, row.priced_asked, row.round2) == (1, Decimal(1000), Decimal(600))
    [none_held] = _results([_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")})]).round2_by_tier
    assert none_held.held_asked == Decimal(0)


def test_rows_stored_before_held_asks_still_load_with_zero() -> None:
    assert TierRow.model_validate({"tier": 2, "requests": 1, "families": 1, "round1": "1"}).held_asked == 0
    stored = {"table": "camp", "tier": 2, "appeals": 1, "asked": "5", "priced": 1, "priced_asked": "5", "round2": "3"}
    assert Round2TierRow.model_validate(stored).held_asked == 0


def test_round2_rows_and_what_is_in_no_tier_add_up_to_round2() -> None:
    # req-a appeals live (Round 2 = 600); req-w withdrew after its Round 1 and Round 2 were posted (2,500 and 400).
    withdrawn = _priced("req-w", 1000006, 60000, live=False, rounds=_posted2("2500", "400", "700"))
    results = _results([_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")}), withdrawn])
    assert (results.round2, results.round2_not_in_tiers) == (Decimal(1000), Decimal(400))
    assert sum((row.round2 for row in results.round2_by_tier), Decimal(0)) + results.round2_not_in_tiers == (
        results.round2
    )
    assert [row.appeals for row in results.round2_by_tier] == [1]  # a withdrawn request's appeal is no appeal


def test_a_clawed_back_appeal_is_no_appeal_as_in_the_budget() -> None:
    clawed = _priced("req-c", 1000007, 60000, rounds=_posted2("3000", "600", "1000"))
    clawed = replace(clawed, rounds=tuple(replace(view, clawed_back=True) for view in clawed.rounds))
    priced = [_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")}), clawed]
    results = _results(priced)
    budget = season_budget(priced, RULES, outside_grants={})
    assert sum(row.appeals for row in results.round2_by_tier) == budget.total.demand.round2_asks.requests == 1
    assert sum((row.asked for row in results.round2_by_tier), Decimal(0)) == budget.total.demand.round2_asked


def test_by_table_sums_to_by_tier_in_every_tier() -> None:
    results = _results([*_season(), _teen("req-t", 1000004), _held_by_a_check("req-h", 1000005)])
    for tier in results.by_tier:
        rows = [row for row in results.by_table if row.tier == tier.tier]
        assert sum(row.requests for row in rows) == tier.requests
        assert sum(row.held for row in rows) == tier.held
        assert sum((row.round1 for row in rows), Decimal(0)) == tier.round1
        assert sum((row.asked for row in rows), Decimal(0)) == tier.asked


def test_a_request_with_no_round2_ask_is_not_an_appeal() -> None:
    assert _results(_season()).round2_by_tier == []


def test_results_stored_by_sp9b_still_load_and_say_they_have_no_committee_rows() -> None:
    stored = _results(_season()).model_dump(mode="json")
    for key in ("by_table", "round2_by_tier", "round2_not_in_tiers", "round2_allocated", "round2_remaining"):
        del stored[key]
    del stored["committee_rows"]
    for row in stored["by_tier"]:
        del row["asked"]
    loaded = ScenarioResults.model_validate(stored)
    assert (loaded.committee_rows, loaded.by_table, loaded.round2_by_tier) == (False, [], [])
    assert loaded.by_tier[0].asked is None


# --- SP9c final review ---------------------------------------------------------------------------------------------


def test_results_written_by_a_newer_build_still_load() -> None:
    """A later rollback reads rows a newer build stored: a key this build doesn't know is ignored, never refused."""
    results = _results([*_season(), _priced("req-a2", 1000008, 60000, rounds={2: _appeal("1000")})])
    stored = results.model_dump(mode="json")
    stored["a_later_figure"] = "1"
    stored["by_tier"][0]["a_later_count"] = 2
    stored["by_table"][0]["a_later_count"] = 2
    stored["round2_by_tier"][0]["a_later_count"] = 2
    stored["pools"][0]["a_later_figure"] = "1"
    assert ScenarioResults.model_validate(stored) == results


def test_a_counted_request_with_no_ask_is_counted_apart_and_out_of_the_asks() -> None:
    # req-n is tier 2 and needs an offer of 3,000, but has no Round 1 ask: its Round 1 counts, its ask can't.
    results = _results([_priced("req-a", 1000001, 60000), _priced("req-n", 1000009, 60000, r1_ask=None)])
    assert results.by_tier == [
        TierRow(
            tier=2,
            requests=2,
            families=2,
            round1=Decimal(6000),
            asked=Decimal(4000),
            no_ask=1,
            no_ask_round1=Decimal(3000),
        )
    ]
    assert (results.by_table[0].no_ask, results.by_table[0].no_ask_round1) == (1, Decimal(3000))
    every = committee_view(results, RULES).round1_by_tier[-1]
    assert (every.table, every.requests, every.round1, every.no_ask) == (None, 2, Decimal(6000), 1)
    # Like for like: the ask-based figures read only the request with an ask.
    assert (every.average_ask, every.pct_of_ask) == (Decimal("4000.00"), Decimal("75.0"))
    assert every.average_round1 == Decimal("3000.00")  # Round 1 over every request the row counts


def test_round2_rows_split_by_the_round2_table_not_the_award_table() -> None:
    # teen's award table stays teen; its appeals move to the camp Round 2 table.
    moved = with_levers(RULES, {"round2.program_tables.teen": "camp"})
    teen = _priced(
        "req-t", 1000004, 60000, request=req(session_cm_id=1000104, program_key="teen"), rounds={2: _appeal("500")}
    )
    results = scenario_results([teen], season_budget([teen], RULES, outside_grants={}), document=moved)
    assert [(row.table, row.tier) for row in results.by_table] == [("teen", 2)]
    assert [(row.table, row.tier, row.appeals) for row in results.round2_by_tier] == [("camp", 2, 1)]


def test_round1_remaining_is_the_pools_allocation_less_every_round1_dollar() -> None:
    """§8.2 (owner 10-06, open item 2 accepted): no reserves, so Round 1 may draw on the pool's whole share."""
    results = _results(_season())
    pools = {p.pool: p for p in results.pools}
    camp = pools["camp_pool"]
    assert (camp.round1_allocated, camp.round1_remaining) == (Decimal("400000.00"), Decimal("396900.00"))
    assert (results.round1_allocated, results.round1_remaining) == (Decimal("500000.00"), Decimal("496900.00"))


def test_round1_remaining_takes_off_round1_dollars_only_while_remaining_takes_off_every_round() -> None:
    """Regression guard. §8.2 (owner 10-06, open item 2 accepted): Round 1 remaining is the pool's Allocated less
    Round 1's money alone; Round 2's committed money comes off Remaining, never off Round 1 remaining."""
    # req-a's Round 1 is 3,000 and its 1,000 appeal is capped at 600 (90% of 4,000, less 3,000).
    results = _results([_priced("req-a", 1000001, 60000, rounds={2: _appeal("1000")})])
    camp = {p.pool: p for p in results.pools}["camp_pool"]
    assert (camp.round1_remaining, camp.remaining) == (Decimal("397000.00"), Decimal("396400.00"))
    assert (results.round1_remaining, results.remaining) == (Decimal("497000.00"), Decimal("496400.00"))


def test_round2_has_no_allocation_so_its_figures_are_null() -> None:
    results = _results(_season())
    assert (results.round2_allocated, results.round2_remaining) == (None, None)


def test_a_result_stored_with_round2_figures_still_loads_and_keeps_them() -> None:
    """Regression guard. Kept options keep their figures as recorded (ScenarioResults is extra="ignore")."""
    stored = _results(_season()).model_dump(mode="json") | {
        "round2_allocated": "40000.00",
        "round2_remaining": "39400.00",
    }
    loaded = ScenarioResults.model_validate(stored)
    assert loaded.round2_allocated == Decimal("40000.00")

"""What the committee compares (sub-project 9c; spec §9.7 RPT-17, RPT-18, RPT-32). Pure, over fictional rules: the
camp table gives tier 2 75% and tier 3 55%, the teen table overrides tier 2 to 70%, and the family table inherits
camp; Round 2's camp cap is 90% at tier 2 and 75% at tier 3. The total budget is 500,000."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from bunking.financial_aid.decisions import PricedRequest, RequestToPrice, RoundState, price_request
from bunking.financial_aid.scenarios import (
    CRITERIA_BUT,
    CRITERIA_SECTIONS,
    Round2CompareRow,
    Round2TierRow,
    TableTierRow,
    TierCompareRow,
    TierRow,
    budget_unset,
    committee_view,
    has_last_seasons_criteria,
    last_seasons_criteria,
    posted_season,
    round2_compare,
    tier_compare,
    uses_budget_placeholder,
)
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_levers

RULES = fictional_rules()


def _row(table: str, tier: int, requests: int, round1: str, asked: str) -> TableTierRow:
    return TableTierRow(
        table=table, tier=tier, requests=requests, families=requests, round1=Decimal(round1), asked=Decimal(asked)
    )


def test_fee_percent_is_the_options_own_table_cell_with_inheritance_applied() -> None:
    by_table = [
        _row("camp", 2, 1, "3000", "4000"),
        _row("family", 3, 1, "330", "600"),
        _row("teen", 2, 1, "3500", "4000"),
    ]
    rows = tier_compare([], by_table, RULES)
    assert [(r.table, r.tier, r.fee_pct) for r in rows] == [
        ("camp", 2, Decimal(75)),
        ("family", 3, Decimal(55)),  # family inherits camp
        ("teen", 2, Decimal(70)),  # teen overrides tier 2
    ]
    moved = with_levers(RULES, {"award_tables.camp.tiers.2.r1_pct": "80"})
    assert tier_compare([], by_table[:1], moved)[0].fee_pct == Decimal(80)


def test_percent_of_ask_and_the_averages_per_tier_then_all() -> None:
    by_tier = [TierRow(tier=2, requests=2, families=2, round1=Decimal(6500), asked=Decimal(8000))]
    by_table = [_row("camp", 2, 1, "3000", "4000"), _row("teen", 2, 1, "3500", "4000")]
    rows = tier_compare(by_tier, by_table, RULES)
    assert rows[-1] == TierCompareRow(
        table=None,
        tier=2,
        requests=2,
        families=2,
        asked=Decimal(8000),
        average_ask=Decimal("4000.00"),
        fee_pct=None,  # All has no single fee %: each table has its own
        pct_of_ask=Decimal("81.3"),  # 6,500 / 8,000 = 81.25%
        round1=Decimal(6500),
        average_round1=Decimal("3250.00"),
        held=0,
    )
    assert (rows[0].pct_of_ask, rows[1].pct_of_ask) == (Decimal("75.0"), Decimal("87.5"))


def test_held_asks_ride_the_compare_rows_and_the_ratios_are_unchanged() -> None:
    by_tier = [
        TierRow(
            tier=2, requests=2, families=2, round1=Decimal(6500), asked=Decimal(8000), held=2, held_asked=Decimal(900)
        )
    ]
    by_table = [
        TableTierRow(
            table="camp",
            tier=2,
            requests=2,
            families=2,
            round1=Decimal(6500),
            asked=Decimal(8000),
            held=2,
            held_asked=Decimal(900),
        )
    ]
    rows = tier_compare(by_tier, by_table, RULES)
    assert [(r.held, r.held_asked) for r in rows] == [(2, Decimal(900)), (2, Decimal(900))]
    assert all(
        (r.asked, r.average_ask, r.pct_of_ask) == (Decimal(8000), Decimal("4000.00"), Decimal("81.3")) for r in rows
    )
    round2 = [
        Round2TierRow(
            table=t,
            tier=3,
            appeals=2,
            asked=Decimal(1500),
            priced=1,
            priced_asked=Decimal(1000),
            round2=Decimal(600),
            held_asked=Decimal(held),
        )
        for t, held in (("camp", 500), ("teen", 120))
    ]
    compared = round2_compare(round2, RULES)
    assert [r.held_asked for r in compared] == [Decimal(500), Decimal(120), Decimal(620)]  # All sums the tables
    assert compared[0].pct_of_ask == Decimal("60.0")  # still round2 / priced_asked


def test_a_row_with_nothing_asked_has_no_percent_never_zero() -> None:
    [row] = tier_compare([], [_row("camp", 2, 1, "100", "0")], RULES)
    assert (row.pct_of_ask, row.average_ask) == (None, Decimal("0.00"))


def test_round2_max_percent_is_the_options_cap_and_all_sums_the_tables() -> None:
    rows = [
        Round2TierRow(
            table="camp",
            tier=3,
            appeals=2,
            asked=Decimal(1500),
            priced=1,
            priced_asked=Decimal(1000),
            round2=Decimal(600),
        ),
        Round2TierRow(
            table="teen",
            tier=3,
            appeals=1,
            asked=Decimal(800),
            priced=1,
            priced_asked=Decimal(800),
            round2=Decimal(400),
        ),
    ]
    compared = round2_compare(rows, with_levers(RULES, {"round2.tables.teen.overrides": {"3": {"total_pct": "80"}}}))
    assert [(r.table, r.max_pct, r.pct_of_ask) for r in compared] == [
        ("camp", Decimal(75), Decimal("60.0")),
        ("teen", Decimal(80), Decimal("50.0")),
        (None, None, Decimal("55.6")),  # 1,000 of the 1,800 asked on the appeals priced
    ]
    assert compared[-1] == Round2CompareRow(
        table=None,
        tier=3,
        appeals=3,
        asked=Decimal(2300),
        max_pct=None,
        priced=2,
        priced_asked=Decimal(1800),
        round2=Decimal(1000),
        average_round2=Decimal("500.00"),
        pct_of_ask=Decimal("55.6"),
    )


def test_the_committee_view_reads_round1_against_the_documents_total_budget() -> None:
    posted = posted_season([], {}, RULES)
    figures = replace(posted, round1=Decimal(283000))
    view = committee_view(figures, RULES)
    assert (view.budget_total, view.round1_pct_of_budget) == (Decimal(500000), Decimal("56.6"))
    assert (view.not_in_tiers, view.round2_not_in_tiers) == (Decimal(0), Decimal(0))
    assert committee_view(figures, None).round1_pct_of_budget is None  # no rules, no %


# --- last season, posted ----------------------------------------------------------------------------------------


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


def _lock(
    round_: int, amount: str, *, tier: int | None = None, at: datetime | None = None, **snapshot: Any
) -> RoundState:
    recorded: dict[str, Any] = {"pool": "camp_pool", "counts_toward_budget": True, **snapshot}
    if tier is not None:
        recorded["result"] = {"final_tier": tier}
    return RoundState(round=round_, posted=True, locked_amount=Decimal(amount), locked_at=at, snapshot=recorded)


def test_last_season_counts_posted_money_by_the_tier_its_lock_recorded() -> None:
    # req-a is tier 2 now, but its lock recorded tier 3: posted money stays where it was posted (D43).
    rounds = {
        "req-a": {1: _lock(1, "2200", tier=3), 2: _lock(2, "500")},
        "req-b": {1: _lock(1, "3000")},  # no tier at the lock: its own tier now (2)
    }
    a = _priced("req-a", 1000001, 60000, rounds={**rounds["req-a"], 2: replace(rounds["req-a"][2], ask=Decimal(900))})
    b = _priced("req-b", 1000002, 60000, rounds=rounds["req-b"])
    c = _priced("req-c", 1000003, 60000)  # needs an offer: not posted, so not last season's money
    posted = posted_season([a, b, c], rounds, RULES)
    assert posted.loaded
    assert (posted.round1, posted.round2) == (Decimal(5200), Decimal(500))
    assert posted.by_tier == (
        TierRow(tier=2, requests=1, families=1, round1=Decimal(3000), asked=Decimal(4000)),
        TierRow(tier=3, requests=1, families=1, round1=Decimal(2200), asked=Decimal(4000)),
    )
    assert posted.round2_by_tier == (
        Round2TierRow(
            table="camp",
            tier=3,
            appeals=1,
            asked=Decimal(900),
            priced=1,
            priced_asked=Decimal(900),
            round2=Decimal(500),
        ),
    )


def test_last_seasons_withdrawn_posted_money_is_in_no_tier_and_the_rows_add_up() -> None:
    # req-w withdrew after its Round 1 (1,800) and Round 2 (250) were posted: the option columns' rule, not_in_tiers.
    first, last = datetime(2026, 3, 9, 17, tzinfo=UTC), datetime(2026, 4, 20, 17, tzinfo=UTC)
    rounds = {
        "req-a": {1: _lock(1, "3000", at=first)},
        "req-w": {1: _lock(1, "1800", tier=2, at=first), 2: _lock(2, "250", tier=2, at=last)},
    }
    a = _priced("req-a", 1000001, 60000, rounds=rounds["req-a"])
    w = _priced(
        "req-w",
        1000002,
        60000,
        live=False,
        rounds={**rounds["req-w"], 2: replace(rounds["req-w"][2], ask=Decimal(400))},
    )
    posted = posted_season([a, w], rounds, RULES)
    assert (posted.round1, posted.not_in_tiers, posted.round2, posted.round2_not_in_tiers) == (
        Decimal(4800),
        Decimal(1800),
        Decimal(250),
        Decimal(250),
    )
    assert sum((row.round1 for row in posted.by_tier), Decimal(0)) + posted.not_in_tiers == posted.round1
    assert sum((row.round2 for row in posted.round2_by_tier), Decimal(0)) + posted.round2_not_in_tiers == posted.round2
    assert posted.as_of == last
    view = committee_view(posted, RULES)
    assert (view.not_in_tiers, view.round2_not_in_tiers) == (Decimal(1800), Decimal(250))


def test_a_clawed_back_or_outside_the_budget_round_is_not_last_seasons_money() -> None:
    clawed = _priced("req-a", 1000001, 60000, rounds={1: _lock(1, "2500")})
    clawed = replace(clawed, rounds=(replace(clawed.rounds[0], clawed_back=True),))
    outside = _priced("req-b", 1000002, 60000, rounds={1: _lock(1, "2000", counts_toward_budget=False)})
    posted = posted_season([clawed, outside], {}, RULES)
    assert (posted.round1, posted.by_tier, posted.loaded) == (Decimal(0), (), False)


def test_a_season_with_nothing_posted_is_not_loaded() -> None:
    posted = posted_season([_priced("req-a", 1000001, 60000)], {}, RULES)
    assert not posted.loaded
    assert (posted.round1, posted.by_tier, posted.by_table, posted.round2_by_tier) == (Decimal(0), (), (), ())


def test_last_seasons_posted_round1_with_no_ask_is_counted_apart_and_out_of_the_asks() -> None:
    rounds = {"req-a": {1: _lock(1, "3000", tier=2)}, "req-n": {1: _lock(1, "2000", tier=2)}}
    a = _priced("req-a", 1000001, 60000, rounds=rounds["req-a"])
    n = _priced("req-n", 1000002, 60000, rounds=rounds["req-n"], r1_ask=None)
    posted = posted_season([a, n], rounds, RULES)
    assert posted.by_tier == (
        TierRow(
            tier=2,
            requests=2,
            families=2,
            round1=Decimal(5000),
            asked=Decimal(4000),
            no_ask=1,
            no_ask_round1=Decimal(2000),
        ),
    )
    every = committee_view(posted, RULES).round1_by_tier[-1]
    assert (every.no_ask, every.average_ask, every.pct_of_ask) == (1, Decimal("4000.00"), Decimal("75.0"))
    assert every.average_round1 == Decimal("2500.00")


# --- last season's rules on this season's applications (RPT-18) ----------------------------------------------------


def test_last_seasons_criteria_come_in_and_this_seasons_routing_grants_and_budget_lines_stay() -> None:
    this_season = with_levers(
        RULES,
        {
            "budget.total": "650000",
            "cost.tuition.1000102": "4200",
            "grants.minimum_capped_at_share": True,
            "programs.quest.r1_table": "teen",
            "round2.program_tables.quest": "teen",
        },
    )
    last_season = with_levers(
        RULES,
        {
            "year": 2030,
            "award_tables.camp.tiers.2.r1_pct": "80",
            "awards.minimum": "150",
            "awards.decision_types.discretionary.label": "Last season's line",
            "grants.offset_mode": "reduce_cost_basis",
            "round2.tables.camp.tiers.2.total_pct": "95",
            "round3.max_amount": "1200",
        },
    )
    merged = last_seasons_criteria(this_season, last_season)
    # Last season's criteria: tables, the minimum, Round 2's caps, Round 3's settings.
    assert merged.award_tables == last_season.award_tables
    assert (merged.awards.minimum, merged.round3) == (Decimal(150), last_season.round3)
    assert merged.round2.tables == last_season.round2.tables
    # This season's: the year, programs (each program's table), Round 2's routing, grants whole, the decision
    # types, cost and budget.
    assert merged.year == 2031
    assert (merged.programs, merged.round2.program_tables) == (this_season.programs, this_season.round2.program_tables)
    assert (merged.grants, merged.awards.decision_types) == (this_season.grants, this_season.awards.decision_types)
    assert (merged.budget.total, merged.cost) == (Decimal(650000), this_season.cost)
    assert set(CRITERIA_SECTIONS) == {"income", "tiers", "equity", "award_tables", "round3"}
    assert dict(CRITERIA_BUT) == {"round2": "program_tables", "awards": "decision_types"}


def _no_budget(document: Any) -> Any:
    raw = document.model_dump(mode="json")
    raw["budget"] = {**raw["budget"], "total": "0", "pools": {}, "reserves": {}}
    return type(document).model_validate(raw)


def test_a_season_with_no_budget_takes_last_seasons_budget_as_a_starting_baseline() -> None:
    last_season = with_levers(RULES, {"year": 2030, "budget.total": "400000"})
    blank = _no_budget(RULES)
    assert budget_unset(blank)
    assert uses_budget_placeholder(blank, last_season)
    assert last_seasons_criteria(blank, last_season).budget == last_season.budget
    # a total alone is still a budget: only a zero total with no pools counts as unset
    assert not budget_unset(with_levers(blank, {"budget.total": "1"}))
    assert not budget_unset(RULES)
    # a budget this season set stays exactly as it was
    assert not uses_budget_placeholder(RULES, last_season)
    assert last_seasons_criteria(RULES, last_season).budget == RULES.budget
    # both unset: nothing to borrow
    assert not uses_budget_placeholder(blank, _no_budget(last_season))


def test_a_document_has_last_seasons_criteria_whatever_else_moved() -> None:
    last_season = with_levers(RULES, {"year": 2030, "award_tables.camp.tiers.2.r1_pct": "80", "awards.minimum": "150"})
    merged = last_seasons_criteria(RULES, last_season)
    assert has_last_seasons_criteria(merged, last_season)
    # This season's own settings (the budget, a program's Round 2 table, a budget line) can move after the start.
    moved = with_levers(
        merged,
        {
            "budget.total": "450000",
            "round2.program_tables.quest": "teen",
            "awards.decision_types.discretionary.label": "A new line",
        },
    )
    assert has_last_seasons_criteria(moved, last_season)
    # A criterion that moved is no longer last season's.
    assert not has_last_seasons_criteria(with_levers(merged, {"awards.minimum": "175"}), last_season)
    assert not has_last_seasons_criteria(with_levers(merged, {"award_tables.camp.tiers.2.r1_pct": "75"}), last_season)
    assert not has_last_seasons_criteria(RULES, last_season)


def test_a_full_cost_after_aid_round_keeps_its_camp_award_in_last_seasons_money() -> None:
    """Owner 10-06 (spec §9.9): the fund's camp award counts toward the budget as usual, so it is last season's posted
    money; only the fund's remainder (`extra`) is not, exactly as the budget splits it (budget.counted_part)."""
    fund = _priced("req-f", 1000001, 60000, rounds={1: _lock(1, "3600", counts_toward_budget=False)})
    fund = replace(fund, rounds=(replace(fund.rounds[0], extra=Decimal(1600), extra_outside=True),))
    posted = posted_season([fund], {}, RULES)
    assert posted.round1 == Decimal(2000)
    assert [row.round1 for row in posted.by_tier] == [Decimal(2000)]


def test_a_grant_reduced_fund_round_still_keeps_its_whole_camp_award_in_last_seasons_money() -> None:
    """Owner 10-06 (a): a $500 grant took the fund to $1,100, so the round locked $3,100. Last season's money is still
    the $2,000 camp award; the grant reduced only the remainder."""
    fund = _priced("req-g", 1000001, 60000, rounds={1: _lock(1, "3100", counts_toward_budget=False)})
    fund = replace(fund, rounds=(replace(fund.rounds[0], extra=Decimal(1100), extra_outside=True),))
    assert posted_season([fund], {}, RULES).round1 == Decimal(2000)

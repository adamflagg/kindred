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
    committee_view,
    last_seasons_criteria,
    posted_season,
    round2_compare,
    tier_compare,
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

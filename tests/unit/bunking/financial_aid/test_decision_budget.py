"""Rounds & budget's figures (sub-project 10a; D44, D53, D54, D79, D82). Fictional throughout.

The fixture's budget: 500,000; Camp 80% (reserves: Round 2 10%, Round 3 5%), Weekends 15%, B'mitzvah 5%."""

from dataclasses import replace
from decimal import Decimal

from bunking.financial_aid.decisions import PricedRequest, RoundLedger, RoundStatus, RoundView
from bunking.financial_aid.decisions.budget import (
    NO_POOL,
    Cell,
    Count,
    PoolBudget,
    SeasonBudget,
    allocations,
    season_budget,
)
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, with_lever, with_levers

ZERO = Decimal(0)
RULES = fictional_rules()


def _d(value: str | None) -> Decimal | None:
    return Decimal(value) if value is not None else None


def view(
    n: int,
    status: RoundStatus,
    *,
    ask: str | None = None,
    decided: str | None = None,
    locked: str | None = None,
    accepted: bool = False,
    pending: str | None = None,
    counts: bool = True,
    extra: str | None = None,
    pool: str | None = "camp_pool",
) -> RoundView:
    return RoundView(
        round=n,
        status=status,
        ask=_d(ask),
        decided=_d(decided) if decided is not None else _d(locked),
        locked=_d(locked),
        accepted=accepted,
        pending=_d(pending),
        would_change_by=None,
        counts_toward_budget=counts,
        # A non-counting view with no stated extra is all decision-type money (a bare discretionary round).
        extra=Decimal(extra) if extra is not None else (ZERO if counts else (_d(decided) or _d(locked) or ZERO)),
        pool=pool,
    )


def priced(request_id: str, household: int, *views: RoundView, live: bool = True) -> PricedRequest:
    return PricedRequest(
        request_id=request_id,
        household_cm_id=household,
        live=live,
        program_key="summer",
        pool=views[0].pool if views else None,
        rounds=views,
        holds=(),
        notes=(),
        application=app(),
        inputs=None,
        result=None,
    )


def pool_of(budget: SeasonBudget, key: str) -> PoolBudget:
    return next(p for p in budget.pools if p.pool == key)


def test_rounds_2_and_3_get_their_reserves_and_round_1_the_rest() -> None:
    assert allocations(RULES) == {
        "camp_pool": {1: Decimal("340000.00"), 2: Decimal("40000.00"), 3: Decimal("20000.00")},
        "weekend_pool": {1: Decimal("75000.00"), 2: Decimal("0.00"), 3: Decimal("0.00")},
        "bmitzvah_pool": {1: Decimal("25000.00"), 2: Decimal("0.00"), 3: Decimal("0.00")},
    }


def test_the_late_round_1_reserve_stays_inside_round_1() -> None:
    rules = with_lever(RULES, "budget.reserves", {"weekend_pool": {"r1_late": "20", "r2": "10"}})
    assert allocations(rules)["weekend_pool"] == {1: Decimal("67500.00"), 2: Decimal("7500.00"), 3: Decimal("0.00")}
    assert allocations(rules)["camp_pool"][1] == Decimal("400000.00")


def test_a_pool_set_as_an_amount_and_the_season_total_are_rules_settings() -> None:
    rules = with_levers(
        RULES,
        {"budget.total": "600000", "budget.pools.camp_pool.share_pct": None, "budget.pools.camp_pool.amount": "410000"},
    )
    assert allocations(rules)["camp_pool"] == {1: Decimal("348500.00"), 2: Decimal("41000.00"), 3: Decimal("20500.00")}
    assert allocations(rules)["weekend_pool"][1] == Decimal("90000.00")


def test_remaining_is_allocated_less_posted_needs_an_offer_and_pending_approval() -> None:
    budget = season_budget(
        [
            priced("req-a", 1, view(1, "posted", locked="1800", accepted=True)),
            priced("req-b", 2, view(1, "needs_offer", decided="1450")),
            priced("req-c", 3, view(1, "posted", locked="2000"), view(3, "pending_approval", pending="500")),
        ],
        RULES,
        outside_grants={},
    )
    camp = pool_of(budget, "camp_pool")
    r1, r3 = camp.rounds[1], camp.rounds[3]
    assert (r1.allocated, r1.posted, r1.accepted, r1.needs_offer) == (
        Decimal("340000.00"),
        Decimal(3800),
        Decimal(1800),
        Decimal(1450),
    )
    assert r1.remaining == Decimal("334750.00")  # Accepted is shown, never subtracted
    assert (r3.pending_approval, r3.remaining) == (Decimal(500), Decimal("19500.00"))
    assert camp.total.remaining == Decimal("394250.00")


def test_a_held_round_sits_below_the_line_with_its_ask() -> None:
    budget = season_budget([priced("req-d", 4, view(1, "held", ask="2000"))], RULES, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.below.held, camp.below.held_asked) == (Count(1, 1), Decimal(2000))
    assert camp.rounds[1].needs_offer == 0
    assert camp.rounds[1].remaining == Decimal("340000.00")
    assert budget.strip[1].held == Count(1, 1)


def test_posted_money_of_a_request_no_longer_live_still_counts() -> None:
    withdrawn = priced("req-e", 5, view(1, "posted", locked="1000", pool="bmitzvah_pool"), live=False)
    assert pool_of(season_budget([withdrawn], RULES, outside_grants={}), "bmitzvah_pool").rounds[1].posted == 1000


def test_money_outside_the_camps_budget_is_below_the_line() -> None:
    request = priced("req-f", 6, view(1, "posted", locked="3000"), view(3, "needs_offer", decided="250", counts=False))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].needs_offer, camp.below.outside_budget) == (Decimal(0), Decimal(250))


def test_outside_grants_are_below_the_line_by_pool() -> None:
    budget = season_budget(
        [priced("req-a", 1, view(1, "posted", locked="1800"))],
        RULES,
        outside_grants={"req-a": Decimal(500)},
        outside_grants_off_requests=Decimal(750),
    )
    assert pool_of(budget, "camp_pool").below.outside_grants == Decimal(500)
    assert budget.total.below.outside_grants == Decimal(500)
    assert budget.outside_grants_off_requests == Decimal(750)


def test_forward_demand_is_round_2_asks_so_far_and_round_1_unmet_not_yet_appealed() -> None:
    budget = season_budget(
        [
            # Round 1 ask 2,000, Round 1 1,450, no appeal yet: 550 unmet (spec §5.9's example).
            priced("req-e", 1, view(1, "posted", ask="2000", locked="1450")),
            priced(
                "req-f",
                2,
                view(1, "posted", ask="4000", locked="3000"),
                view(2, "needs_offer", ask="700", decided="600"),
            ),
            priced("req-g", 3, view(1, "posted", ask="4000", locked="3000"), view(2, "held", ask="900")),
            priced("req-h", 4, view(1, "held", ask="1200")),
            priced("req-i", 5, view(1, "posted", ask="4000", locked="1000"), live=False),
        ],
        RULES,
        outside_grants={},
    )
    demand = pool_of(budget, "camp_pool").demand
    assert (demand.round2_asks, demand.round2_asked, demand.round2_computed) == (
        Count(2, 2),
        Decimal(1600),
        Decimal(600),
    )
    assert demand.round1_unmet == Decimal(1750)  # 550 + the held request's 1,200; not the withdrawn one
    assert budget.total.demand.round1_unmet == Decimal(1750)


def test_counts_say_families_and_requests() -> None:
    budget = season_budget(
        [
            priced("req-emma", 1, view(1, "needs_offer", decided="1000")),
            priced("req-liam", 1, view(1, "needs_offer", decided="900")),
        ],
        RULES,
        outside_grants={},
    )
    assert budget.strip[1].needs_offer == Count(families=1, requests=2)


def test_money_on_a_program_with_no_pool_counts_in_the_total_only() -> None:
    budget = season_budget(
        [priced("req-j", 7, view(1, "needs_offer", decided="400", pool=None))], RULES, outside_grants={}
    )
    nowhere = pool_of(budget, NO_POOL)
    assert (nowhere.label, nowhere.rounds[1].allocated, nowhere.rounds[1].remaining) == ("No pool", None, None)
    assert budget.total.rounds[1].needs_offer == Decimal(400)
    assert budget.total.total.remaining == Decimal("499600.00")


def test_with_no_approved_rules_posted_money_still_counts_and_nothing_is_allocated() -> None:
    budget = season_budget([priced("req-a", 1, view(1, "posted", locked="1800"))], None, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[1].allocated, camp.rounds[1].posted, camp.rounds[1].remaining) == (None, Decimal(1800), None)
    assert budget.total.total.remaining is None


def test_a_non_counting_type_moves_its_whole_round_outside_the_budget() -> None:
    """Owner ruling 2026-09-30: only grant money is not coming out of the camp's budget, so a type with
    counts_toward_budget false takes base and extra below the line and never lowers Remaining."""
    request = priced(
        "req-k",
        8,
        view(1, "posted", locked="3000"),
        view(3, "needs_offer", decided="650", counts=False, extra="250"),
    )
    budget = season_budget([request], RULES, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[3].needs_offer, camp.below.outside_budget) == (ZERO, Decimal(650))
    assert camp.rounds[3].remaining == Decimal("20000.00")
    assert budget.strip[3].needs_offer == Count(0, 0)


def test_a_posted_non_counting_round_is_wholly_outside_and_not_posted() -> None:
    request = priced(
        "req-l", 9, view(1, "posted", locked="3000"), view(2, "posted", locked="850", counts=False, extra="250")
    )
    budget = season_budget([request], RULES, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[2].posted, camp.below.outside_budget, camp.below.outside_budget_posted) == (
        ZERO,
        Decimal(850),
        Decimal(850),
    )
    assert budget.strip[2].posted == Count(0, 0)


def test_a_non_counting_round_with_no_extra_is_still_wholly_outside_the_budget() -> None:
    """The whole round leaves, whatever the top-up: a non-counting type with extra at zero is not a base round."""
    request = priced("req-p", 13, view(3, "needs_offer", decided="400", counts=False, extra="0"))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].needs_offer, camp.below.outside_budget, camp.rounds[3].remaining) == (
        ZERO,
        Decimal(400),
        Decimal("20000.00"),
    )


def test_a_clawed_back_non_counting_round_counts_nowhere() -> None:
    clawed = replace(view(2, "posted", locked="850", counts=False, extra="250"), clawed_back=True)
    request = priced("req-q", 14, clawed)
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[2].posted, camp.below.outside_budget, camp.below.outside_budget_posted) == (ZERO, ZERO, ZERO)


def test_a_non_counting_round_pending_approval_sits_below_the_line_and_never_lowers_remaining() -> None:
    """Designed contract changed by owner ruling 2026-09-30: the whole round of a non-counting type is
    below the line, pending approval included. D79's subtraction still applies to COUNTING types."""
    request = priced(
        "req-m", 10, view(1, "posted", locked="3000"), view(3, "pending_approval", pending="500", counts=False)
    )
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].pending_approval, camp.below.outside_budget, camp.below.outside_budget_posted) == (
        ZERO,
        Decimal(500),
        ZERO,
    )
    assert camp.rounds[3].remaining == Decimal("20000.00")


def test_a_counting_round_pending_approval_is_still_subtracted() -> None:
    request = priced("req-m2", 15, view(1, "posted", locked="3000"), view(3, "pending_approval", pending="500"))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].pending_approval, camp.rounds[3].remaining) == (Decimal(500), Decimal("19500.00"))


def test_a_non_counting_round_adds_no_forward_demand() -> None:
    r2 = priced(
        "req-d2", 16, view(1, "posted", locked="3000"), view(2, "needs_offer", ask="900", decided="850", counts=False)
    )
    r1 = priced("req-d1", 17, view(1, "needs_offer", ask="2000", decided="1500", counts=False))
    demand = pool_of(season_budget([r2, r1], RULES, outside_grants={}), "camp_pool").demand
    assert (demand.round2_computed, demand.round1_unmet) == (ZERO, ZERO)


def test_round_1_unmet_never_goes_negative() -> None:
    budget = season_budget(
        [
            priced("req-n", 11, view(1, "posted", ask="1000", locked="1500")),
            priced("req-o", 12, view(1, "posted", ask="2000", locked="1500")),
        ],
        RULES,
        outside_grants={},
    )
    assert pool_of(budget, "camp_pool").demand.round1_unmet == Decimal(500)


def test_round_1_s_allocation_is_the_rounded_remainder_and_never_below_zero() -> None:
    # 100.01 with 50% + 50% reserves: each reserve rounds up to 50.01, leaving Round 1 no cent.
    rules = with_levers(
        RULES,
        {
            "budget.pools.camp_pool": {"label": "Camp", "amount": "100.01"},
            "budget.reserves.camp_pool": {"r2": "50", "r3": "50"},
        },
    )
    assert allocations(rules)["camp_pool"] == {1: ZERO, 2: Decimal("50.01"), 3: Decimal("50.01")}


def test_posted_money_outside_the_budget_is_shown_as_its_own_posted_figure() -> None:
    request = priced("req-f", 6, view(1, "posted", locked="3000", counts=False))
    request = replace(request, rounds=(replace(request.rounds[0], extra=Decimal(3000)),))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.below.outside_budget, camp.below.outside_budget_posted) == (Decimal(3000), Decimal(3000))


def test_a_past_reads_unrebuilt_round_lists_the_pool_it_sits_in() -> None:
    """3c-1: a not_rebuilt round's status is unknown, so it tallies nothing; but live lists the pool a
    held round sits in, so the past lists the pool of every round it can't rebuild (all figures 0)."""
    budget = season_budget([priced("r1", 1, view(1, "not_rebuilt", ask="4000", pool=None))], RULES, outside_grants={})
    nowhere = pool_of(budget, NO_POOL)
    assert (nowhere.total.posted, nowhere.total.accepted) == (ZERO, ZERO)
    assert [p.pool for p in budget.pools][-1] == NO_POOL


def test_a_request_left_out_of_demand_adds_no_round_2_ask_and_keeps_its_money() -> None:
    """Lead relay 2026-10-02 (owner ⚠ approved): forward demand leaves out a request CampMinder cancelled. Only
    demand: its posted money still counts (that is D54's job), and `live` is not read differently."""
    appeal = priced("e", 1000001, view(1, "posted", locked="1500"), view(2, "needs_offer", ask="900", decided="400"))
    kept = season_budget([appeal], RULES, outside_grants={})
    left = season_budget([appeal], RULES, outside_grants={}, not_demand=frozenset({"e"}))
    assert (kept.total.demand.round2_asks, kept.total.demand.round2_asked) == (Count(1, 1), Decimal(900))
    assert (left.total.demand.round2_asks, left.total.demand.round2_asked) == (Count(0, 0), ZERO)
    assert left.total.total.posted == kept.total.total.posted == Decimal(1500)
    assert left.total.total.needs_offer == kept.total.total.needs_offer == Decimal(400)


def _cell(budget: SeasonBudget, pool: str, n: int) -> Cell:
    holder = budget.total if pool == "*" else pool_of(budget, pool)
    return holder.rounds[n]


def test_unconfirmed_posted_sits_in_each_rounds_locked_pool_and_in_the_totals() -> None:
    """⚠10: per pool × round, using each round's locked pool."""
    emma = priced(
        "e",
        1000001,
        view(1, "posted", locked="1500", pool="camp_pool"),
        view(2, "posted", locked="500", pool="weekend_pool"),
    )
    ledger = {"e": {1: RoundLedger(ZERO, False), 2: RoundLedger(Decimal(500), True)}}
    budget = season_budget([emma], RULES, outside_grants={}, ledger=ledger)
    assert (_cell(budget, "camp_pool", 1).unconfirmed, _cell(budget, "camp_pool", 1).unconfirmed_count) == (
        ZERO,
        Count(0, 0),
    )
    assert (_cell(budget, "weekend_pool", 2).unconfirmed, _cell(budget, "weekend_pool", 2).unconfirmed_count) == (
        Decimal(500),
        Count(1, 1),
    )
    assert (budget.total.rounds[2].unconfirmed, budget.total.total.unconfirmed) == (Decimal(500), Decimal(500))
    assert budget.total.total.unconfirmed_count == Count(1, 1)
    assert (budget.strip[2].awaiting_sync, budget.strip[2].not_reconciled) == (Count(1, 1), Count(0, 0))


def test_the_strips_two_counts_split_each_rounds_unconfirmed_count() -> None:
    """Decision 3: awaiting sync + not reconciled = the round's amber count, request for request."""
    rows = [
        priced("a", 1000001, view(1, "posted", locked="1500")),
        priced("b", 1000002, view(1, "posted", locked="1500")),
        priced("c", 1000003, view(1, "posted", locked="1500")),
    ]
    ledger = {
        "a": {1: RoundLedger(Decimal(1500), True)},
        "b": {1: RoundLedger(Decimal(210), False)},
        "c": {1: RoundLedger(ZERO, True)},  # ticked after the sync, but CampMinder already holds it: confirmed
    }
    budget = season_budget(rows, RULES, outside_grants={}, ledger=ledger)
    awaiting, unreconciled = budget.strip[1].awaiting_sync, budget.strip[1].not_reconciled
    amber = budget.total.rounds[1].unconfirmed_count
    assert (awaiting, unreconciled) == (Count(1, 1), Count(1, 1))
    assert awaiting is not None
    assert unreconciled is not None
    assert amber is not None
    assert awaiting.requests + unreconciled.requests == amber.requests
    assert budget.total.rounds[1].unconfirmed == Decimal(1710)


def test_a_round_outside_the_budget_or_clawed_back_has_no_unconfirmed_part() -> None:
    outside = priced("o", 1000001, view(1, "posted", locked="900", counts=False))
    clawed = priced("c", 1000002, replace(view(1, "posted", locked="1500"), clawed_back=True))
    ledger = {"o": {1: RoundLedger(Decimal(900), False)}, "c": {1: RoundLedger(Decimal(1500), False)}}
    budget = season_budget([outside, clawed], RULES, outside_grants={}, ledger=ledger)
    assert (budget.total.total.unconfirmed, budget.strip[1].not_reconciled) == (ZERO, Count(0, 0))


def test_with_no_ledger_read_the_figures_are_not_computed() -> None:
    budget = season_budget([priced("e", 1000001, view(1, "posted", locked="1500"))], RULES, outside_grants={})
    assert (budget.total.rounds[1].unconfirmed, budget.total.total.unconfirmed_count) == (None, None)
    assert (budget.strip[1].awaiting_sync, budget.strip[1].not_reconciled) == (None, None)

"""Rounds & budget's figures (sub-project 10a; D44, D53, D54, D79, D82). Fictional throughout.

The fixture's budget: 500,000; Camp 80%, Weekends 15%, B'mitzvah 5% (the fixture's reserves are ignored: §8.2, nothing reads them)."""

from dataclasses import replace
from decimal import Decimal

from bunking.financial_aid.decisions import PricedRequest, RoundLedger, RoundStatus, RoundView
from bunking.financial_aid.decisions.budget import (
    NO_POOL,
    Count,
    PoolBudget,
    PoolCell,
    RoundCell,
    SeasonBudget,
    allocations,
    season_budget,
)
from bunking.financial_aid.decisions.pricing import posted_view
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


def test_a_pool_set_as_an_amount_and_the_season_total_are_rules_settings() -> None:
    rules = with_levers(
        RULES,
        {"budget.total": "600000", "budget.pools.camp_pool.share_pct": None, "budget.pools.camp_pool.amount": "410000"},
    )
    assert allocations(rules)["camp_pool"] == Decimal("410000.00")
    assert allocations(rules)["weekend_pool"] == Decimal("90000.00")


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
    assert (r1.posted, r1.accepted, r1.needs_offer) == (Decimal(3800), Decimal(1800), Decimal(1450))
    assert r3.pending_approval == Decimal(500)
    assert camp.total.remaining == Decimal("394250.00")


def test_a_held_round_sits_below_the_line_with_its_ask() -> None:
    budget = season_budget([priced("req-d", 4, view(1, "held", ask="2000"))], RULES, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.below.held, camp.below.held_asked) == (Count(1, 1), Decimal(2000))
    assert camp.rounds[1].needs_offer == 0
    assert camp.total.remaining == Decimal("400000.00")
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
    assert (nowhere.label, nowhere.total.allocated, nowhere.total.remaining) == ("No pool", None, None)
    assert budget.total.rounds[1].needs_offer == Decimal(400)
    assert budget.total.total.remaining == Decimal("499600.00")


def test_with_no_approved_rules_posted_money_still_counts_and_nothing_is_allocated() -> None:
    budget = season_budget([priced("req-a", 1, view(1, "posted", locked="1800"))], None, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.total.allocated, camp.rounds[1].posted, camp.total.remaining) == (None, Decimal(1800), None)
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
    assert camp.total.remaining == Decimal("397000.00")
    assert budget.strip[3].needs_offer == Count(1, 1)


def test_a_posted_non_counting_round_is_wholly_outside_but_still_a_posted_request() -> None:
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
    assert budget.strip[2].posted == Count(1, 1)


def test_a_wholly_outside_posted_round_counts_its_request_at_no_money() -> None:
    """A8 (owner 10-07): a count is the list its link opens; the money stays budget-only."""
    request = priced("req-m", 21, view(1, "posted", locked="3600", accepted=True, counts=False))
    budget = season_budget([request], RULES, outside_grants={})
    assert (budget.strip[1].posted, budget.strip[1].accepted) == (Count(1, 1), Count(1, 1))
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[1].posted, camp.rounds[1].accepted, camp.below.outside_budget) == (ZERO, ZERO, Decimal(3600))


def test_a_wholly_outside_round_needing_an_offer_is_in_the_count() -> None:
    request = priced("req-n", 22, view(1, "needs_offer", decided="3600", counts=False))
    budget = season_budget([request], RULES, outside_grants={})
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[1].needs_offer, camp.rounds[1].needs_offer_count) == (ZERO, Count(1, 1))
    assert budget.strip[1].needs_offer == Count(1, 1)


def test_a_wholly_outside_round_pending_approval_is_in_the_count() -> None:
    request = priced("req-o", 23, view(3, "pending_approval", pending="700", counts=False))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].pending_approval, camp.rounds[3].pending_approval_count) == (ZERO, Count(1, 1))


def test_a_posted_round_1_stays_counted_once_round_2_needs_an_offer() -> None:
    """Pin. A pin (owner 10-07 asked whether "Posted Round 1" is cumulative: it is). Passes before and after A8: a
    request whose Round 1 posted stays in Round 1's Posted count while its Round 2 needs an offer; F1 pins the link
    side."""
    request = priced(
        "req-r", 26, view(1, "posted", locked="1800", accepted=True), view(2, "needs_offer", decided="400")
    )
    budget = season_budget([request], RULES, outside_grants={})
    assert (budget.strip[1].posted, budget.strip[2].needs_offer) == (Count(1, 1), Count(1, 1))


def test_counting_an_outside_round_moves_no_money_figure() -> None:
    """Pin. Money stays budget-only: adding a wholly-outside posted request moves no figure."""
    inside = priced("req-p", 24, view(1, "posted", locked="1800", accepted=True))
    outside = priced("req-q", 25, view(1, "posted", locked="3600", accepted=True, counts=False))
    alone, both = (season_budget(r, RULES, outside_grants={}) for r in ([inside], [inside, outside]))
    a, b = pool_of(alone, "camp_pool"), pool_of(both, "camp_pool")
    assert (a.rounds[1].posted, a.total.remaining) == (b.rounds[1].posted, b.total.remaining)


def test_a_non_counting_round_with_no_extra_is_still_wholly_outside_the_budget() -> None:
    """The whole round leaves, whatever the top-up: a non-counting type with extra at zero is not a base round."""
    request = priced("req-p", 13, view(3, "needs_offer", decided="400", counts=False, extra="0"))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].needs_offer, camp.below.outside_budget, camp.total.remaining) == (
        ZERO,
        Decimal(400),
        Decimal("400000.00"),
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
    assert camp.total.remaining == Decimal("397000.00")


def test_a_counting_round_pending_approval_is_still_subtracted() -> None:
    request = priced("req-m2", 15, view(1, "posted", locked="3000"), view(3, "pending_approval", pending="500"))
    camp = pool_of(season_budget([request], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[3].pending_approval, camp.total.remaining) == (Decimal(500), Decimal("396500.00"))


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


def test_a_pool_given_as_an_amount_is_allocated_its_amount_to_the_cent() -> None:
    rules = with_levers(RULES, {"budget.pools.camp_pool": {"label": "Camp", "amount": "100.01"}})
    assert allocations(rules)["camp_pool"] == Decimal("100.01")


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


def _cell(budget: SeasonBudget, pool: str, n: int) -> RoundCell:
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


def test_a_request_unconfirmed_in_two_rounds_is_one_request_in_the_total_cell() -> None:
    emma = priced("e", 1000001, view(1, "posted", locked="1500"), view(2, "posted", locked="500"))
    ledger = {"e": {1: RoundLedger(Decimal(1500), False), 2: RoundLedger(Decimal(500), False)}}
    budget = season_budget([emma], RULES, outside_grants={}, ledger=ledger)
    assert budget.total.total.unconfirmed_count == Count(1, 1)
    assert budget.total.total.unconfirmed == Decimal(2000)


def test_each_cell_counts_who_needs_an_offer_and_who_waits_for_approval() -> None:
    rows = [
        priced("a", 1000001, view(1, "needs_offer", decided="1500"), view(2, "needs_offer", ask="900", decided="400")),
        priced("b", 1000001, view(1, "needs_offer", decided="1200")),  # a sibling: same family
        priced("c", 1000002, view(1, "posted", locked="1500"), view(3, "pending_approval", pending="650")),
    ]
    camp = pool_of(season_budget(rows, RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[1].needs_offer, camp.rounds[1].needs_offer_count) == (Decimal(2700), Count(1, 2))
    assert camp.rounds[2].needs_offer_count == Count(1, 1)
    assert (camp.rounds[3].pending_approval, camp.rounds[3].pending_approval_count) == (Decimal(650), Count(1, 1))
    assert camp.total.needs_offer_count == Count(1, 2)  # request "a" is counted once across its two rounds
    assert camp.total.pending_approval_count == Count(1, 1)


def _typed(round_view: RoundView, key: str) -> RoundView:
    return replace(round_view, decision_type=key)


SEASON = [
    priced("plain", 1000001, view(1, "posted", locked="1500"), view(2, "needs_offer", ask="900", decided="400")),
    priced(
        "topped",
        1000002,
        view(1, "posted", locked="1500"),
        _typed(view(2, "posted", locked="650", extra="250"), "appeal_top_up"),
    ),
    priced("disc", 1000003, _typed(view(3, "posted", locked="250", counts=False), "discretionary")),
    priced("pending", 1000004, _typed(view(3, "pending_approval", pending="300"), "discretionary")),
    priced("held", 1000005, view(1, "held", ask="2000")),
    # Counts nowhere (D54): its money was reversed, so no line, cell or total may carry it.
    priced("clawed", 1000006, replace(view(1, "posted", locked="1500"), clawed_back=True)),
    # A non-counting type's needs-an-offer round: wholly outside the budget, never in a posted or inside figure.
    priced("outside", 1000007, _typed(view(3, "needs_offer", decided="400", counts=False), "discretionary")),
]


def test_one_line_per_decision_type_in_the_rules_order_then_rounds_with_none() -> None:
    lines = season_budget(SEASON, RULES, outside_grants={}).total.decision_types
    assert [(t.key, t.label, t.counts_toward_budget) for t in lines] == [
        ("appeal_top_up", "Appeal top-up", True),
        ("discretionary", "Discretionary", True),
        ("discretionary", "Discretionary", False),
        (None, "No named decision type", True),
    ]
    top_up = lines[0]
    assert (top_up.amount, top_up.posted, top_up.own, top_up.requests) == (
        Decimal(650),
        Decimal(650),
        Decimal(250),
        Count(1, 1),
    )
    none = lines[3]  # plain's Round 1 (posted) and Round 2 (needs an offer), and topped's Round 1 (posted)
    assert (none.amount, none.posted, none.requests) == (Decimal(3400), Decimal(3000), Count(2, 2))
    assert none.own == ZERO  # no type, so no decision money of its own: the whole line is plain rounds


def test_the_lines_add_up_to_the_budgets_own_figures() -> None:
    """Main spec §12.1: every decision row is counted, in or out of the budget, so nothing goes missing."""
    budget = season_budget(SEASON, RULES, outside_grants={})
    for pool in (*budget.pools, budget.total):
        inside = [t for t in pool.decision_types if t.counts_toward_budget]
        outside = [t for t in pool.decision_types if not t.counts_toward_budget]
        total = pool.total
        assert sum((t.amount for t in inside), ZERO) == total.posted + total.needs_offer + total.pending_approval
        assert sum((t.posted for t in inside), ZERO) == total.posted
        assert sum((t.amount for t in outside), ZERO) == pool.below.outside_budget
        assert sum((t.posted for t in outside), ZERO) == pool.below.outside_budget_posted


def test_a_clawed_back_request_adds_nothing_and_an_outside_needs_offer_joins_its_types_outside_line() -> None:
    clawed = next(r for r in SEASON if r.request_id == "clawed")
    without = season_budget([r for r in SEASON if r is not clawed], RULES, outside_grants={})
    with_it = season_budget(SEASON, RULES, outside_grants={})
    assert with_it.total.decision_types == without.total.decision_types
    assert with_it.total.total == without.total.total
    outside = next(t for t in with_it.total.decision_types if t.key == "discretionary" and not t.counts_toward_budget)
    assert (outside.amount, outside.posted) == (Decimal(650), Decimal(250))  # the disc round's 250 plus 400 to offer


def test_a_type_the_rules_no_longer_name_keeps_its_line_and_key() -> None:
    """Decision 12: reachable through a real posted lock (posted_view reads the snapshot)."""
    from tests.unit.bunking.financial_aid.test_decision_pricing import RETIRED

    gone = priced("g", 1000001, posted_view(RETIRED, None, None, "camp_pool"))
    (line,) = season_budget([gone], RULES, outside_grants={}).total.decision_types
    assert (line.key, line.label, line.amount, line.own) == (
        "retired_program",
        "retired_program",
        Decimal(650),
        Decimal(250),
    )


def test_the_outside_grants_line_counts_the_requests_it_offsets() -> None:
    """Decision 13: "Outside grants offsetting awards (41 campers)"."""
    rows = [
        priced("a", 1000001, view(1, "needs_offer", decided="1500")),
        priced("b", 1000001, view(1, "needs_offer", decided="1200")),
        priced("c", 1000002, view(1, "needs_offer", decided="900")),
    ]
    below = season_budget(
        rows, RULES, outside_grants={"a": Decimal(400), "b": Decimal(0), "c": Decimal(250)}
    ).total.below
    assert (below.outside_grants, below.outside_grants_requests) == (Decimal(650), Count(2, 2))


def test_forward_demand_counts_unmet_round_1_and_splits_out_the_held() -> None:
    rows = [
        priced("short", 1000001, view(1, "posted", ask="2000", locked="1500")),  # 500 unmet
        priced("met", 1000002, view(1, "posted", ask="1500", locked="1500")),  # nothing unmet: not counted
        priced("held1", 1000003, view(1, "held", ask="1800")),
        priced("appeal", 1000004, view(1, "posted", locked="1500"), view(2, "needs_offer", ask="900", decided="400")),
        priced("held2", 1000005, view(1, "posted", locked="1500"), view(2, "held", ask="700")),
    ]
    demand = season_budget(rows, RULES, outside_grants={}).total.demand
    assert (demand.round1_unmet, demand.round1_unmet_requests) == (Decimal(2300), Count(2, 2))
    assert (demand.round1_held, demand.round1_held_asked) == (Count(1, 1), Decimal(1800))
    assert (demand.round2_asks, demand.round2_asked) == (Count(2, 2), Decimal(1600))  # unchanged: held included
    assert (demand.round2_held, demand.round2_held_asked) == (Count(1, 1), Decimal(700))


def test_a_held_round_1_with_no_ask_is_no_demand_but_still_lists_its_pool() -> None:
    """Decision 7: the held count is requests whose part is above $0, so a $0 ask is neither counted nor added."""
    budget = season_budget(
        [priced("zero", 1000001, view(1, "held", ask="0", pool="other_pool"))], RULES, outside_grants={}
    )
    demand = pool_of(budget, "other_pool").demand
    assert (demand.round1_held, demand.round1_held_asked) == (Count(), ZERO)
    assert (demand.round1_unmet, demand.round1_unmet_requests) == (ZERO, Count())


def test_a_pool_reached_only_by_demand_is_still_listed_as_before() -> None:
    """The refactor keeps which pools are listed: a pool no money reaches, but a $0 appeal does, still shows (the old
    per-figure dicts created its key)."""
    appeal = priced("a", 1000001, view(2, "not_decided", ask="0", pool="other_pool"))
    budget = season_budget([appeal], RULES, outside_grants={})
    assert pool_of(budget, "other_pool").demand.round2_asks == Count(1, 1)


def test_each_pool_is_allocated_the_total_times_its_share_to_the_cent() -> None:
    """§5.3 note 1 (owner 10-06: the round plan dropped): one allocation per pool, no rounds, no reserves."""
    assert allocations(RULES) == {
        "camp_pool": Decimal("400000.00"),
        "weekend_pool": Decimal("75000.00"),
        "bmitzvah_pool": Decimal("25000.00"),
    }


def test_allocation_golden_cases_match_the_frontend_preview_to_the_cent() -> None:
    """Pinned on both sides (planModel.test.ts carries the same two, Task 35), so the server's Decimal and Edit Plan…'s
    integer preview can never drift apart: 4.2% of $1,111,000 is exactly $46,662.00, and 50% of $100.01 is $50.005,
    which rounds half up to $50.01, never to banker's $50.00."""
    split = {"budget.pools.bmitzvah_pool.share_pct": "0"}
    golden = with_levers(
        RULES,
        split
        | {
            "budget.total": "1111000",
            "budget.pools.camp_pool.share_pct": "4.2",
            "budget.pools.weekend_pool.share_pct": "95.8",
        },
    )
    assert (allocations(golden)["camp_pool"], allocations(golden)["weekend_pool"]) == (
        Decimal("46662.00"),
        Decimal("1064338.00"),
    )
    half = with_levers(
        RULES,
        split
        | {
            "budget.total": "100.01",
            "budget.pools.camp_pool.share_pct": "50",
            "budget.pools.weekend_pool.share_pct": "50",
        },
    )
    assert allocations(half)["camp_pool"] == Decimal("50.01")


def test_reserves_move_no_allocation() -> None:
    """§8.2: reserves are read nowhere; the pool keeps its whole share."""
    rules = with_lever(RULES, "budget.reserves", {"weekend_pool": {"r1_late": "20", "r2": "10"}})
    assert allocations(rules) == allocations(RULES)


def test_a_round_has_no_allocation_and_says_what_it_committed() -> None:
    """§8.1: Remaining per pool, never per round. Committed = Posted + Needs an offer + Pending approval (note 12)."""
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
    assert isinstance(r1, RoundCell)
    assert not isinstance(r1, PoolCell)
    assert not hasattr(r1, "allocated")
    assert not hasattr(r1, "remaining")
    assert (r1.committed, r3.committed) == (Decimal(5250), Decimal(500))
    assert (camp.total.allocated, camp.total.committed, camp.total.remaining) == (
        Decimal("400000.00"),
        Decimal(5750),
        Decimal("394250.00"),
    )


def test_each_pool_carries_its_share_and_no_pool_and_the_total_carry_none() -> None:
    budget = season_budget(
        [priced("req-j", 7, view(1, "needs_offer", decided="400", pool=None))], RULES, outside_grants={}
    )
    assert [(p.pool, p.share_pct) for p in budget.pools] == [
        ("camp_pool", Decimal(80)),
        ("weekend_pool", Decimal(15)),
        ("bmitzvah_pool", Decimal(5)),
        (NO_POOL, None),
    ]
    assert budget.total.share_pct is None


def test_the_totals_allocation_is_the_sum_of_the_pools_and_its_remaining_the_sum_of_theirs() -> None:
    """§5.3 note 6: the total's Remaining is the sum of the pools', less any money in No pool (it spends the total only)."""
    budget = season_budget(
        [
            priced("req-a", 1, view(1, "posted", locked="1800")),
            priced("req-j", 7, view(1, "needs_offer", decided="400", pool=None)),
        ],
        RULES,
        outside_grants={},
    )
    total = budget.total.total
    assert total.allocated == Decimal("500000.00")
    assert total.remaining == Decimal("497800.00")
    assert total.remaining == sum(
        (p.total.remaining for p in budget.pools if p.total.remaining is not None), Decimal(0)
    ) - Decimal(400)


def test_a_fund_round_keeps_its_camp_award_in_the_budget_and_puts_only_the_remainder_below_the_line() -> None:
    """§9.9 (owner 10-06): the camp award counts toward the budget as usual; only the fund's remainder doesn't."""
    fund = replace(
        view(1, "needs_offer", decided="3600", counts=False, extra="1600"),
        extra_outside=True,
        decision_type="named_full_cost_fund",
    )
    camp = pool_of(season_budget([priced("req-f", 21, fund)], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[1].needs_offer, camp.below.outside_budget) == (Decimal(2000), Decimal(1600))
    assert camp.total.remaining == Decimal("398000.00")
    lines = {(t.key, t.counts_toward_budget): t for t in camp.decision_types}
    assert lines[(None, True)].amount == Decimal(2000)
    assert lines[("named_full_cost_fund", False)].amount == Decimal(1600)


def test_a_posted_fund_round_splits_the_same_way() -> None:
    fund = replace(view(1, "posted", locked="3600", counts=False, extra="1600"), extra_outside=True)
    camp = pool_of(season_budget([priced("req-g", 22, fund)], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[1].posted, camp.below.outside_budget, camp.below.outside_budget_posted) == (
        Decimal(2000),
        Decimal(1600),
        Decimal(1600),
    )


def test_a_fund_round_reduced_by_an_outside_grant_puts_only_its_smaller_remainder_below_the_line() -> None:
    """Owner 10-06 (a): the engine already took the $500 grant off the fund ($3,600 − $2,000 − $500 = $1,100), so the
    round's amount is $3,100 and its `extra` $1,100. The budget counts the $2,000 camp award, puts the $1,100 below the
    line, and keeps the $500 grant on its own line: no dollar counted twice."""
    fund = replace(
        view(1, "needs_offer", decided="3100", counts=False, extra="1100"),
        extra_outside=True,
        decision_type="named_full_cost_fund",
    )
    budget = season_budget([priced("req-h", 23, fund)], RULES, outside_grants={"req-h": Decimal(500)})
    camp = pool_of(budget, "camp_pool")
    assert (camp.rounds[1].needs_offer, camp.below.outside_budget, camp.below.outside_grants) == (
        Decimal(2000),
        Decimal(1100),
        Decimal(500),
    )
    assert camp.total.remaining == Decimal("398000.00")
    lines = {(t.key, t.counts_toward_budget): t for t in camp.decision_types}
    assert lines[("named_full_cost_fund", False)].amount == Decimal(1100)


def test_a_fund_round_pending_approval_binds_only_its_camp_award() -> None:
    """Regression guard (T17 review Minor 3): pending approval splits like needs an offer (D79 binds counting money)."""
    fund = replace(
        view(1, "pending_approval", pending="3600", counts=False, extra="1600"),
        extra_outside=True,
        decision_type="named_full_cost_fund",
    )
    camp = pool_of(season_budget([priced("req-j", 25, fund)], RULES, outside_grants={}), "camp_pool")
    assert (camp.rounds[1].pending_approval, camp.below.outside_budget) == (Decimal(2000), Decimal(1600))


def test_a_posted_fund_round_with_a_camp_part_ledger_shows_no_unconfirmed_beyond_the_camp_part() -> None:
    """Regression guard. A posted $3,600 fund round is a $2,000 camp award plus a $1,600 remainder. round_ledger
    reconciles the camp part only, so with $1,500 of camp lines it reads $500 unconfirmed ($2,000 − $1,500). The
    budget books that $500 in the camp pool, never the remainder's $1,600: unconfirmed is $500, not $2,100."""
    fund = replace(view(1, "posted", locked="3600", counts=False, extra="1600"), extra_outside=True)
    ledger = {"req-i": {1: RoundLedger(Decimal(500), False)}}
    camp = pool_of(season_budget([priced("req-i", 24, fund)], RULES, outside_grants={}, ledger=ledger), "camp_pool")
    assert camp.rounds[1].posted == Decimal(2000)
    assert camp.rounds[1].unconfirmed == Decimal(500)

"""A request's rounds as of a past date (3c-1). Fictional throughout.

3c-1 prices nothing on a past date: posted rounds come from their locks, exactly as live reads them
(including the decision type's own money, `extra`), and every other round a live request had is
`not_rebuilt`."""

from datetime import UTC, datetime
from decimal import Decimal

from bunking.financial_aid.decisions import (
    BUDGET_GAPS,
    GRID_GAPS,
    MANUAL_HOLD,
    PAST_DATE_GAPS,
    REMAINING_GAPS,
    HoldState,
    ManualHold,
    RequestToPrice,
    RoundState,
    price_as_of,
    price_request,
)
from bunking.financial_aid.decisions.budget import Count, season_budget
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever

RULES = fictional_rules()
T0 = datetime(2031, 3, 9, 17, 0, tzinfo=UTC)
POSTED = RoundState(
    round=1,
    posted=True,
    locked_amount=Decimal(3000),
    locked_at=T0,
    snapshot={"pool": "bmitzvah_pool", "counts_toward_budget": True},
    accepted=True,
    accepted_at=T0,
)
APPEAL = RoundState(round=2, ask=Decimal(400))


def test_a_posted_round_keeps_its_lock_its_pool_and_its_accepted_tick() -> None:
    priced = price_as_of("req-emma", 1000001, {1: POSTED}, RULES, live=True, r1_ask=Decimal(4000))
    (r1,) = priced.rounds
    assert (r1.status, r1.locked, r1.decided, r1.accepted, r1.pool, r1.ask) == (
        "posted",
        Decimal(3000),
        Decimal(3000),
        True,
        "bmitzvah_pool",
        Decimal(4000),
    )
    assert (priced.holds, priced.inputs, priced.result) == ((), None, None)


def test_an_unposted_round_of_a_live_request_is_not_rebuilt() -> None:
    priced = price_as_of("req-emma", 1000001, {1: POSTED, 2: APPEAL}, RULES, live=True, r1_ask=None)
    r2 = priced.view(2)
    assert r2 is not None
    assert (r2.status, r2.ask, r2.decided, r2.pending) == ("not_rebuilt", Decimal(400), None, None)


def test_a_request_not_live_then_shows_only_its_posted_rounds() -> None:
    priced = price_as_of("req-emma", 1000001, {1: POSTED, 2: APPEAL}, RULES, live=False, r1_ask=None)
    assert [v.round for v in priced.rounds] == [1]


def test_the_manual_hold_as_it_stood_is_listed() -> None:
    hold = HoldState(
        manual=ManualHold(reason="Waiting on the tax return", placed_at=T0, placed_by="registrar@example.com")
    )
    priced = price_as_of("req-emma", 1000001, {}, RULES, live=True, r1_ask=None, hold=hold)
    assert [(h.code, h.message) for h in priced.holds] == [(MANUAL_HOLD, "Waiting on the tax return")]


def test_a_posted_round_with_money_outside_the_budget_counts_as_live_does() -> None:
    """Review focus 4: the same events give the same Posted and outside-budget money, live and past."""
    rules = with_lever(RULES, "awards.decision_types.discretionary.counts_toward_budget", False)
    round3 = RoundState(
        round=3,
        discretionary=Decimal(250),
        discretionary_type="discretionary",
        posted=True,
        locked_amount=Decimal(650),
        locked_at=T0,
        snapshot={
            "pool": "camp_pool",
            "counts_toward_budget": False,
            "decision_round": 3,
            "top_up": "0",
            "discretionary": "250",
        },
    )
    live = price_request(
        RequestToPrice(
            request_id="req-emma",
            household_cm_id=1000001,
            live=True,
            application=app(),
            request=req(),
            blocked="",
            issues=(),
            rounds={3: round3},
            r1_ask=Decimal(4000),
        ),
        rules,
    )
    past = price_as_of("req-emma", 1000001, {3: round3}, rules, live=True, r1_ask=Decimal(4000))
    for priced in (live, past):
        camp = next(p for p in season_budget([priced], rules, outside_grants={}).pools if p.pool == "camp_pool")
        assert (camp.rounds[3].posted, camp.below.outside_budget_posted) == (Decimal(400), Decimal(250))


def test_the_budget_counts_what_was_posted_and_nothing_it_cannot_rebuild() -> None:
    priced = [
        price_as_of("req-emma", 1000001, {1: POSTED}, RULES, live=True, r1_ask=Decimal(4000)),
        price_as_of("req-liam", 1000002, {2: APPEAL}, RULES, live=True, r1_ask=None),
    ]
    budget = season_budget(priced, RULES, outside_grants={})
    tmb = next(p for p in budget.pools if p.pool == "bmitzvah_pool")
    assert (tmb.rounds[1].posted, tmb.rounds[1].accepted) == (Decimal(3000), Decimal(3000))
    assert (budget.total.total.needs_offer, budget.total.below.held) == (Decimal(0), Count())
    assert (budget.total.demand.round2_asks, budget.total.demand.round2_asked) == (Count(1, 1), Decimal(400))
    assert budget.strip[1].posted == Count(1, 1)


def test_every_figure_a_read_leaves_empty_has_its_reason() -> None:
    for figure in (*GRID_GAPS, *BUDGET_GAPS, *REMAINING_GAPS, "request_history", "rules_history"):
        assert PAST_DATE_GAPS[figure].strip(), figure

"""Decisions service (sub-project 10a): the season priced and its reads (Task 6), and each round's
asks, amounts and ticks (Task 7). Fictional only; every write runs the real 4a helper over a fake
batch. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, decision_event
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from bunking.financial_aid.decisions import DecisionEvent
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"


def _service(
    store: FakeDecisionsStore, rules: FakeRules | None = None, register: Sequence[RegisterRow] = ()
) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: T0)


def _event(store: FakeDecisionsStore, request_id: str, n: int, kind: Any, **fields: Any) -> None:
    store.events.append(
        DecisionEvent(id=f"ev{len(store.events):013d}", request_id=request_id, round=n, kind=kind, created=T0, **fields)
    )


def _posted(store: FakeDecisionsStore, request_id: str, n: int, amount: str) -> None:
    _event(
        store,
        request_id,
        n,
        "post",
        amount=Decimal(amount),
        effective_on=date(2027, 3, 9),
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )


# --- the repository ---------------------------------------------------------------------------


def _record(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "dec000000000001",
        "request": EMMA,
        "round": 2,
        "event": "ask",
        "amount": 400,
        "effective_on": "2027-03-20 00:00:00.000Z",
        "statement_of_need": "",
        "decision_type": "",
        "needs_approval": False,
        "lock_source": "",
        "rules_version": 0,
        "snapshot": None,
        "note": "Family emailed Mar 20",
        "actor": ACTOR,
        "created": "2027-03-21 17:00:00.000Z",
    }
    return SimpleNamespace(**{**base, **fields})


def test_a_record_becomes_an_event() -> None:
    event = decision_event(_record())
    assert (event.kind, event.round, event.amount, event.effective_on) == ("ask", 2, Decimal(400), date(2027, 3, 20))
    assert (event.rules_version, event.snapshot, event.note) == (None, None, "Family emailed Mar 20")


def test_an_event_that_carries_no_amount_reads_none_not_the_zero_pocketbase_stores() -> None:
    assert decision_event(_record(event="accept", amount=0)).amount is None


def test_a_snapshot_stored_as_json_text_comes_back_as_a_dict() -> None:
    assert decision_event(_record(event="post", snapshot='{"pool": "camp_pool"}')).snapshot == {"pool": "camp_pool"}


def test_an_unknown_event_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown event"):
        decision_event(_record(event="offer"))


@pytest.mark.asyncio
async def test_events_are_read_by_season_in_recorded_order() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidDecisionsRepository(pb).fetch_decision_events(YEAR)
    pb.collection.assert_called_with("aid_decisions")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query == {"filter": f"year = {YEAR}", "sort": "created,id"}


@pytest.mark.asyncio
async def test_a_requests_events_are_read_only_by_a_well_formed_record_id() -> None:
    with pytest.raises(ValueError, match="record id"):
        await FinancialAidDecisionsRepository(MagicMock()).fetch_request_events('x" || year > 0 || "')


# --- the reads (Task 6) ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_grid_prices_every_request_with_its_names_and_rounds() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    out = await _service(store).grid(YEAR)
    assert out.rules_version == 1
    (row,) = out.rows
    assert (row.family_name, row.camper_name, row.session_name, row.pool, row.tier, row.cost) == (
        "Family 1000001",
        "Camper 1000011",
        "Session 2",
        "camp_pool",
        2,
        2000.0,
    )
    (r1,) = row.rounds
    assert (r1.round, r1.status, r1.ask, r1.decided, r1.posted) == (1, "needs_offer", 4000.0, 1500.0, None)
    assert (row.total_decided, row.total_posted) == (1500.0, None)


@pytest.mark.asyncio
async def test_a_posted_round_shows_its_lock_and_the_day_it_was_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    (row,) = (await _service(store).grid(YEAR)).rows
    (r1,) = row.rounds
    assert (r1.status, r1.posted, r1.posted_on, r1.rules_version) == ("posted", 1500.0, date(2027, 3, 9), 1)
    assert (row.total_decided, row.total_posted) == (1500.0, 1500.0)


@pytest.mark.asyncio
async def test_the_budget_and_the_remaining_line_count_posted_and_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    service = _service(store)
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.allocated, r1.posted, r1.needs_offer, r1.remaining) == (340000.0, 1500.0, 1500.0, 337000.0)
    strip = next(s for s in budget.strip if s.round == 1)
    assert (strip.needs_offer.requests, strip.posted.requests) == (1, 1)
    remaining = await service.remaining(YEAR)
    assert [(p.pool, p.remaining) for p in remaining.pools] == [
        ("camp_pool", 397000.0),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert remaining.total == 497000.0


@pytest.mark.asyncio
async def test_a_withdrawn_request_keeps_its_posted_money_in_the_budget() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    budget = await _service(store).budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.posted, r1.needs_offer) == (1500.0, 0.0)


@pytest.mark.asyncio
async def test_with_no_approved_rules_every_live_request_is_held_and_nothing_is_allocated() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store, FakeRules(None))
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert [h.code for h in row.holds] == ["no_approved_rules"]
    remaining = await service.remaining(YEAR)
    assert (remaining.pools, remaining.total) == ([], None)


@pytest.mark.asyncio
async def test_a_request_with_an_unmatched_session_is_held_with_intakes_reasons() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert {"unmatched_session", "not_priceable"} <= {h.code for h in row.holds}


@pytest.mark.asyncio
async def test_outside_grants_reach_the_calculator_and_sit_below_the_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store, register=[grant_row(EMMA, "500"), grant_row(EMMA, "750", on_request=False)])
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].decided == 1000.0
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    assert (camp.below.outside_grants, budget.outside_grants_off_requests) == (500.0, 750.0)


@pytest.mark.asyncio
async def test_an_incentive_line_never_reaches_the_calculator() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    (row,) = (await _service(store, register=[grant_row(EMMA, "500", funder_type="incentive")]).grid(YEAR)).rows
    assert row.rounds[0].decided == 1500.0

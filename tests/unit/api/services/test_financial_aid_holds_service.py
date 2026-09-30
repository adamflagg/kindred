"""Hold release and manual holds (follow-up 3b): the records, the season read (Task 3), and the
writes (Task 4). Fictional only; every write runs the real 4a helper over a fake batch.

Figures (see decisions_fakes): Session 2 costs 2,000. Emma's family (60,000) gets Round 1 = 1,500.
Liam's family reports 500, so the placeholder_income check holds his request."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, hold_event
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from bunking.financial_aid.decisions import MANUAL_HOLD, DecisionEvent, HoldEvent, HoldEventKind
from tests.unit.api.services.decisions_fakes import ACTOR, T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
NOTE = "Called the family: the income is right"
WAITING = "Waiting on the family's tax return"


def _service(store: FakeDecisionsStore, rules: FakeRules | None = None) -> FinancialAidDecisionsService:
    async def rows(year: int) -> list[Any]:
        return []

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: T0)


def _held_liam(store: FakeDecisionsStore) -> None:
    seed_request(store, LIAM, household=1000002, person=1000021, income=500.0)  # a placeholder income holds


def _hold(
    store: FakeDecisionsStore, request_id: str, kind: HoldEventKind, code: str = "placeholder_income", note: str = NOTE
) -> None:
    """A hold event recorded directly, as if an earlier write had made it."""
    store.hold_events.append(
        HoldEvent(
            id=f"hev{len(store.hold_events):012d}",
            request_id=request_id,
            kind=kind,
            code=code,
            created=T0,
            note=note,
            actor=ACTOR,
        )
    )


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


def _half_shares(store: FakeDecisionsStore) -> None:
    """The request's only payer share at 50%: payer_shares_incomplete holds it."""
    store.shares[-1] = replace(store.shares[-1], share_pct=Decimal(50))


# --- the records --------------------------------------------------------------------------------


def _record(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "hev000000000001",
        "request": LIAM,
        "event": "release",
        "code": "placeholder_income",
        "note": NOTE,
        "actor": ACTOR,
        "fact": '{"message": "Placeholder income"}',
        "created": "2027-12-01 17:00:00.000Z",
    }
    return SimpleNamespace(**{**base, **fields})


def test_a_hold_record_becomes_an_event() -> None:
    event = hold_event(_record())
    assert (event.request_id, event.kind, event.code, event.note, event.actor) == (
        LIAM,
        "release",
        "placeholder_income",
        NOTE,
        ACTOR,
    )
    assert event.created.isoformat() == "2027-12-01T17:00:00+00:00"
    assert event.fact == {"message": "Placeholder income"}  # stored as JSON text, read back as a dict
    assert hold_event(_record(event="place", fact=None)).fact is None


def test_an_unknown_hold_event_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown event"):
        hold_event(_record(event="snooze"))


@pytest.mark.asyncio
async def test_hold_events_are_read_by_season_in_recorded_order() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidDecisionsRepository(pb).fetch_hold_events(YEAR)
    pb.collection.assert_called_with("aid_hold_events")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query == {"filter": f"year = {YEAR}", "sort": "created,id"}


@pytest.mark.asyncio
async def test_a_requests_hold_events_are_read_only_by_a_well_formed_record_id() -> None:
    with pytest.raises(ValueError, match="record id"):
        await FinancialAidDecisionsRepository(MagicMock()).fetch_request_hold_events('x" || year > 0 || "')


# --- the season read (Task 3) --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_unreleased_hold_holds_the_round_and_lists_nothing_released() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert "placeholder_income" in {h.code for h in row.holds}
    assert row.released_holds == []


@pytest.mark.asyncio
async def test_a_released_hold_is_priced_and_listed_on_its_grid_row() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    _hold(store, LIAM, "release")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert (row.rounds[0].status, row.holds) == ("needs_offer", [])
    assert row.rounds[0].decided is not None
    assert [(r.code, r.note, r.released_by, r.released_at) for r in row.released_holds] == [
        ("placeholder_income", NOTE, ACTOR, T0)
    ]


@pytest.mark.asyncio
async def test_releasing_moves_the_round_from_below_the_line_into_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    service = _service(store)
    before = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    r1 = next(c for c in before.rounds if c.round == 1)
    assert (r1.needs_offer, before.below.held.requests, before.below.held_asked) == (0.0, 1, 4000.0)
    _hold(store, LIAM, "release")
    (row,) = (await service.grid(YEAR)).rows
    decided = row.rounds[0].decided
    assert decided is not None
    after = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    r1 = next(c for c in after.rounds if c.round == 1)
    assert (r1.needs_offer, after.below.held.requests) == (decided, 0)
    assert r1.remaining == pytest.approx(340000.0 - decided)


@pytest.mark.asyncio
async def test_a_manual_hold_holds_the_round_with_its_reason() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _hold(store, EMMA, "place", MANUAL_HOLD, note=WAITING)
    service = _service(store)
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert [(h.code, h.severity, h.message) for h in row.holds] == [(MANUAL_HOLD, "hold", WAITING)]
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    assert (next(c for c in camp.rounds if c.round == 1).needs_offer, camp.below.held.requests) == (0.0, 1)


@pytest.mark.asyncio
async def test_a_released_hold_that_clears_only_when_fixed_is_neither_applied_nor_listed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _half_shares(store)
    _hold(store, EMMA, "release", "payer_shares_incomplete")  # written directly: the service refuses it
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert "payer_shares_incomplete" in {h.code for h in row.holds}
    assert row.released_holds == []


@pytest.mark.asyncio
async def test_a_release_written_for_a_needs_input_code_is_neither_applied_nor_listed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.applications[-1] = replace(store.applications[-1], answers={})  # no income reported: income_missing
    _hold(store, EMMA, "release", "income_missing")  # written directly: a release cannot lift it
    (row,) = (await _service(store).grid(YEAR)).rows
    assert "income_missing" in {h.code for h in row.holds}
    assert row.released_holds == []


@pytest.mark.asyncio
async def test_a_release_for_a_code_the_request_does_not_show_is_not_listed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _hold(store, EMMA, "release", "placeholder_income")  # nothing fires it for this request
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.holds == []
    assert row.released_holds == []

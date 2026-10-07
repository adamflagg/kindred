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

from api.schemas import financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import HoldReleaseIn, ManualHoldIn, PostedIn, PostedRow
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, hold_event
from api.services.financial_aid_decisions_service import (
    DecisionNotFoundError,
    DecisionRefusedError,
    FinancialAidDecisionsService,
)
from bunking.financial_aid.decisions import MANUAL_HOLD, DecisionEvent, HoldEvent, HoldEventKind
from tests.unit.api.services.decisions_fakes import ACTOR, T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The writes refuse a date after today; the fixtures' dates sit in the fictional 2027 season."""
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


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
    assert query["filter"] == f"year = {YEAR}"
    assert query["sort"] == "created,id"
    assert "fact" not in query["fields"].split(","), "the season read never loads the release facts"
    assert {"request", "event", "code", "note", "actor", "created"} <= set(query["fields"].split(","))


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
    assert before.below.held is not None
    assert (r1.needs_offer, before.below.held.requests, before.below.held_asked) == (0.0, 1, 4000.0)
    _hold(store, LIAM, "release")
    (row,) = (await service.grid(YEAR)).rows
    decided = row.rounds[0].decided
    assert decided is not None
    after = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    r1 = next(c for c in after.rounds if c.round == 1)
    assert after.below.held is not None
    assert (r1.needs_offer, after.below.held.requests) == (decided, 0)
    # §8.1: Remaining is per pool: 400,000 less what the released request now needs.
    assert after.total.remaining == pytest.approx(400000.0 - decided)


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
    assert camp.below.held is not None
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
async def test_a_standing_release_for_a_hold_code_that_does_not_fire_now_is_still_listed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _hold(store, EMMA, "release", "placeholder_income")  # nothing fires it for this request now
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.holds == []
    assert [r.code for r in row.released_holds] == ["placeholder_income"]  # decision 3: it stands until put back


# --- the writes (Task 4) -------------------------------------------------------------------------


def _release(code: str = "placeholder_income", *, released: bool = True, note: str = NOTE) -> HoldReleaseIn:
    return HoldReleaseIn(code=code, released=released, note=note)


def _manual(*, held: bool = True, note: str = WAITING) -> ManualHoldIn:
    return ManualHoldIn(held=held, note=note)


@pytest.mark.asyncio
async def test_releasing_a_hold_is_one_logged_operation_and_lets_the_round_be_ticked() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    service = _service(store)
    out = await service.set_hold_release(LIAM, _release(), ACTOR)
    assert (out.written, out.unchanged) == (1, 0)
    event = store.hold_events[-1]
    assert (event.kind, event.code, event.note, event.actor) == ("release", "placeholder_income", NOTE, ACTOR)
    assert event.fact is not None  # what it was released against (Decision 3)
    assert (event.fact["step"], event.fact["application"]["household_cm_id"]) == ("quality", 1000002)
    assert "placeholder" in event.fact["message"].lower()
    (log,) = store.log
    assert (log["entity"], log["entity_id"], log["action"], log["reason"], log["operation_id"]) == (
        "aid_hold_events",
        f"{LIAM}:placeholder_income",
        "release",
        NOTE,
        out.operation_id,
    )
    assert "fact" not in log["after"]  # the row keeps the fact; the log keeps what changed
    (row,) = (await service.grid(YEAR)).rows
    decided = row.rounds[0].decided
    assert row.rounds[0].status == "needs_offer"
    assert decided is not None
    tick = PostedIn(
        rows=[PostedRow(request_id=LIAM, round=1, amount=Decimal(str(decided)))], posted_on=date(2027, 12, 3)
    )
    assert (await service.tick_posted(YEAR, tick, ACTOR)).written == 1


@pytest.mark.asyncio
async def test_resending_a_release_writes_nothing() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    service = _service(store)
    await service.set_hold_release(LIAM, _release(), ACTOR)
    again = await service.set_hold_release(LIAM, _release(note="Clicked twice"), ACTOR)
    assert (again.written, again.unchanged, again.operation_id) == (0, 1, "")
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_only_a_hold_the_request_shows_now_can_be_released() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)  # priced, nothing holds it
    with pytest.raises(DecisionRefusedError, match="not on hold for 'placeholder_income'"):
        await _service(store).set_hold_release(EMMA, _release(), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_hold_that_clears_only_when_fixed_cannot_be_released() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _half_shares(store)
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match="set the payer shares to add up to 100%"):
        await service.set_hold_release(EMMA, _release("payer_shares_incomplete"), ACTOR)
    _hold(store, EMMA, "release", "payer_shares_incomplete")  # an old row written some other way
    with pytest.raises(DecisionRefusedError, match="set the payer shares"):  # still 422, never a no-op
        await service.set_hold_release(EMMA, _release("payer_shares_incomplete"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_request_that_cannot_be_priced_is_told_why_instead_of_released() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.applications[-1] = replace(store.applications[-1], answers={})  # no income: the calculator needs input
    with pytest.raises(DecisionRefusedError, match="can't be priced"):
        await _service(store).set_hold_release(EMMA, _release("income_missing"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_code_that_is_never_a_hold_cannot_be_released_even_with_an_old_row() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _hold(store, EMMA, "release", "cost_unknown")  # an old row for a code that is never a hold
    with pytest.raises(DecisionRefusedError, match="can't be priced"):
        await _service(store).set_hold_release(EMMA, _release("cost_unknown"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_refusing_a_never_a_hold_code_allows_that_it_may_be_only_a_note() -> None:
    """cost_unknown is a warn when the rules price an unknown cost at the minimum award
    (calculator/engine.py), so the refusal must not claim the request can't be priced outright."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(DecisionRefusedError, match="only a note"):
        await _service(store).set_hold_release(EMMA, _release("cost_unknown"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_unreleasing_puts_the_hold_back() -> None:
    store = FakeDecisionsStore()
    _held_liam(store)
    service = _service(store)
    await service.set_hold_release(LIAM, _release(), ACTOR)
    out = await service.set_hold_release(LIAM, _release(released=False, note="Income still unconfirmed"), ACTOR)
    assert out.written == 1
    assert store.log[-1]["action"] == "unrelease"
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[0].status, row.released_holds) == ("held", [])
    again = await service.set_hold_release(LIAM, _release(released=False, note="again"), ACTOR)
    assert (again.written, again.unchanged) == (0, 1)


@pytest.mark.asyncio
async def test_a_manual_hold_holds_an_offer_until_it_is_lifted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    assert (await service.set_manual_hold(EMMA, _manual(), ACTOR)).written == 1
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[0].status, [(h.code, h.message) for h in row.holds]) == ("held", [(MANUAL_HOLD, WAITING)])
    assert (await service.set_manual_hold(EMMA, _manual(), ACTOR)).written == 0  # the same reason again
    assert (await service.set_manual_hold(EMMA, _manual(note="Waiting on the school letter"), ACTOR)).written == 1
    (row,) = (await service.grid(YEAR)).rows
    assert [h.message for h in row.holds] == ["Waiting on the school letter"]
    assert (await service.set_manual_hold(EMMA, _manual(held=False, note="Letter arrived"), ACTOR)).written == 1
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[0].status, row.holds) == ("needs_offer", [])
    assert (await service.set_manual_hold(EMMA, _manual(held=False, note="again"), ACTOR)).written == 0
    assert [entry["action"] for entry in store.log] == ["place", "place", "lift"]
    assert {entry["entity_id"] for entry in store.log} == {f"{EMMA}:{MANUAL_HOLD}"}


@pytest.mark.asyncio
async def test_the_manual_hold_is_lifted_not_released() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_manual_hold(EMMA, _manual(), ACTOR)
    with pytest.raises(DecisionRefusedError, match="lift the manual hold instead"):
        await service.set_hold_release(EMMA, _release(MANUAL_HOLD), ACTOR)


@pytest.mark.asyncio
async def test_a_manual_hold_leaves_posted_rounds_alone_and_stops_the_next_tick() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    service = _service(store)
    await service.set_manual_hold(EMMA, _manual(), ACTOR)
    (row,) = (await service.grid(YEAR)).rows
    assert [(r.round, r.status) for r in row.rounds] == [(1, "posted"), (2, "held")]
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    assert next(c for c in camp.rounds if c.round == 1).posted == 1500.0
    tick = PostedIn(rows=[PostedRow(request_id=EMMA, round=2, amount=Decimal(300))], posted_on=date(2027, 4, 2))
    with pytest.raises(DecisionRefusedError, match=f"{EMMA}: Round 2 is on hold"):
        await service.tick_posted(YEAR, tick, ACTOR)


@pytest.mark.asyncio
async def test_a_request_that_is_not_live_takes_no_hold_change() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    with pytest.raises(DecisionRefusedError, match="withdrawn request's holds can't change"):
        await _service(store).set_manual_hold(EMMA, _manual(), ACTOR)


@pytest.mark.asyncio
async def test_an_unknown_request_is_not_found() -> None:
    with pytest.raises(DecisionNotFoundError):
        await _service(FakeDecisionsStore()).set_hold_release(EMMA, _release(), ACTOR)


@pytest.mark.asyncio
async def test_a_round_1_release_also_covers_the_same_check_on_the_round_2_appeal() -> None:
    """D2: a release is per request and check, not per round, so it stands for the appeal."""
    store = FakeDecisionsStore()
    _held_liam(store)
    _hold(store, LIAM, "release")
    _posted(store, LIAM, 1, "1500")
    _event(store, LIAM, 2, "ask", amount=Decimal(400))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert [(r.round, r.status) for r in row.rounds] == [(1, "posted"), (2, "needs_offer")]
    assert [r.code for r in row.released_holds] == ["placeholder_income"]


@pytest.mark.asyncio
async def test_a_withdrawn_request_lists_no_released_holds() -> None:
    store = FakeDecisionsStore()
    seed_request(store, LIAM, household=1000002, person=1000021, income=500.0, status="withdrawn")
    _hold(store, LIAM, "release")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.released_holds == []


@pytest.mark.asyncio
async def test_a_request_that_is_not_live_ignores_a_manual_hold() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    _hold(store, EMMA, "place", MANUAL_HOLD, note=WAITING)
    (row,) = (await _service(store).grid(YEAR)).rows
    assert [(r.round, r.status) for r in row.rounds] == [(1, "posted")]
    assert row.holds == []

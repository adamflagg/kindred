"""2026's reproduced rounds are read-only (D67: "read-only and labelled"). The load writes them with lock_source
"reproduced"; no person may undo, accept, unaccept, or decide anything new on a request that carries them. Fictional
only (decisions_fakes)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import AcceptedIn, AskIn, Round3AmountIn, RoundRef, UnpostIn
from api.services.financial_aid_decisions_service import DecisionRefusedError
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.decisions.rounds import FROM_CAMPMINDER, REPRODUCED
from tests.unit.api.services.decisions_fakes import ACTOR, EMMA, T0, FakeDecisionsStore, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _service

READ_ONLY = "reproduced from the repaired sheet"


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


def _reproduced(store: FakeDecisionsStore, n: int = 1, *, accepted: bool = False, source: str = REPRODUCED) -> None:
    seed_request(store, EMMA)
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}",
            request_id=EMMA,
            round=n,
            kind="post",
            created=T0,
            amount=Decimal(1500),
            lock_source=source,
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
            actor="system:2026-sheet-load",
        )
    )
    if accepted:
        store.events.append(
            DecisionEvent(id=f"ev{len(store.events):013d}", request_id=EMMA, round=n, kind="accept", created=T0)
        )


@pytest.mark.asyncio
async def test_a_reproduced_round_cannot_be_undone() -> None:
    store = FakeDecisionsStore()
    _reproduced(store)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await _service(store).undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="x"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
@pytest.mark.parametrize("accepted", [True, False])
async def test_a_reproduced_rounds_accepted_tick_cannot_change(accepted: bool) -> None:
    store = FakeDecisionsStore()
    _reproduced(store, accepted=not accepted)
    body = AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=accepted)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await _service(store).tick_accepted(YEAR, body, ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_nothing_new_is_decided_on_a_request_with_reproduced_rounds() -> None:
    store = FakeDecisionsStore()
    _reproduced(store)
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await service.key_ask(EMMA, AskIn(round=2, amount=Decimal(400), asked_on=date(2027, 4, 1)), ACTOR)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(300)), ACTOR, can_approve=True)
    assert store.operations == []


@pytest.mark.asyncio
async def test_the_season_still_reads_a_reproduced_round_as_posted() -> None:
    store = FakeDecisionsStore()
    _reproduced(store)
    (row,) = (await _service(store).grid(YEAR)).rows
    assert (row.rounds[0].status, row.rounds[0].posted, row.rounds[0].lock_source) == ("posted", 1500.0, REPRODUCED)


@pytest.mark.asyncio
async def test_a_campminder_only_round_is_read_only_too() -> None:
    # The load's "CampMinder only" Round 1 (owner, 10-07): a request the sheet has no row for. Same D67 guards.
    store = FakeDecisionsStore()
    _reproduced(store, source=FROM_CAMPMINDER)
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await service.undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="x"), ACTOR)
    body = AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await service.tick_accepted(YEAR, body, ACTOR)
    with pytest.raises(DecisionRefusedError, match=READ_ONLY):
        await service.key_ask(EMMA, AskIn(round=2, amount=Decimal(400), asked_on=date(2027, 4, 1)), ACTOR)
    assert store.operations == []

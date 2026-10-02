"""Rounds & budget's Posted not yet confirmed, through the read (owner ruling ⚠10). Fictional only; figures: a
tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.schemas.financial_aid_decisions import BudgetResponse, CountOut, RoundCellOut, UnconfirmedOut
from bunking.financial_aid.decisions import BUDGET_GAPS, DecisionEvent, RoundLedger
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, log_seeded, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _posted, _service

NIGHT_AFTER = T0 + timedelta(hours=16)


def _post_at(store: FakeDecisionsStore, n: int, amount: str, at: datetime) -> None:
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}",
            request_id=EMMA,
            round=n,
            kind="post",
            created=at,
            amount=Decimal(amount),
            effective_on=at.date(),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )


def _camp(out: BudgetResponse, n: int) -> RoundCellOut:
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    return next(c for c in camp.rounds if c.round == n)


@pytest.mark.asyncio
async def test_round_1_confirmed_and_round_2_ticked_after_the_sync_reads_round_2_awaiting() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    store.synced_at = NIGHT_AFTER
    _post_at(store, 2, "500", NIGHT_AFTER + timedelta(hours=1))
    out = await _service(store).budget(YEAR)
    assert _camp(out, 1).unconfirmed == UnconfirmedOut(count=0, families=0, amount=0.0)
    assert _camp(out, 2).unconfirmed == UnconfirmedOut(count=1, families=1, amount=500.0)
    strip = next(s for s in out.strip if s.round == 2)
    assert (strip.awaiting_sync, strip.not_reconciled) == (
        CountOut(families=1, requests=1),
        CountOut(families=0, requests=0),
    )
    assert out.total.total.unconfirmed == UnconfirmedOut(count=1, families=1, amount=500.0)


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_nothing_is_computed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    out = await _service(store).budget(YEAR)
    assert _camp(out, 1).unconfirmed is None
    assert next(s for s in out.strip if s.round == 1).awaiting_sync is None


@pytest.mark.asyncio
async def test_a_past_date_leaves_the_ledger_figures_empty_and_names_them() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    _post_at(store, 1, "1500", T0 - timedelta(days=5))  # the service's clock is T0 (Mar 9): Mar 8 is a past date
    out = await _service(store).budget(YEAR, as_of=date(2027, 3, 8))
    assert _camp(out, 1).unconfirmed is None
    strip = next(s for s in out.strip if s.round == 1)
    assert (strip.awaiting_sync, strip.not_reconciled) == (None, None)
    named = [g.figure for g in out.not_rebuilt]
    assert {"unconfirmed", "awaiting_sync", "not_reconciled"} <= set(named)
    assert set(BUDGET_GAPS) == {"cancellation", "unconfirmed", "awaiting_sync", "not_reconciled"}


@pytest.mark.asyncio
async def test_remaining_and_the_scenarios_build_no_ledger_figures(monkeypatch: pytest.MonkeyPatch) -> None:
    """Decision 14: only the Rounds & budget read pays for round_ledger."""
    calls: list[str] = []
    real = decisions_service.round_ledger  # type: ignore[attr-defined]

    def counted(*args: object, **kwargs: object) -> object:
        calls.append("x")
        return real(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(decisions_service, "round_ledger", counted)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.remaining(YEAR)
    service.budget_of(await service.season(YEAR))
    assert calls == []
    await service.budget(YEAR)
    assert calls == ["x"]


@pytest.mark.asyncio
async def test_a_closed_requests_posted_round_reads_its_closed_lines_in_the_ledger() -> None:
    """A withdrawn request's posted money is confirmed (or not) against its closed lines, never its live ones."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    store.synced_at = NIGHT_AFTER
    service = _service(store)
    ledgers = service._round_ledgers(await service.season(YEAR))
    assert ledgers is not None
    assert ledgers[EMMA] == {1: RoundLedger(Decimal(0), False)}
    bare = FakeDecisionsStore()  # the same withdrawn request with no line: the whole lock is unconfirmed
    seed_request(bare, EMMA, status="withdrawn")
    _posted(bare, EMMA, 1, "1500")
    bare.synced_at = NIGHT_AFTER
    service = _service(bare)
    assert (service._round_ledgers(await service.season(YEAR)) or {})[EMMA] == {1: RoundLedger(Decimal(1500), False)}

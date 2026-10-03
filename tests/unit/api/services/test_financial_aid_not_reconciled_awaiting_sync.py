"""V1 (owner, 10-03; extends D162's C1): a round ticked Posted BY HAND whose CampMinder confirmation is outstanding only
because tonight's sync hasn't run (`awaiting_sync`: locked after the last successful sync, not by the ledger or a
placement) is no Not reconciled exception. It stays in Waiting on the family, its round reads CM ✓ "pending" with the
approved line, and it shows in Not reconciled only once a sync has run and failed to confirm it (short, over,
not_in_campminder). The same holds for payer shares reading awaiting_sync. `confirmation.status` itself stays
"awaiting_sync" (the CM ✓ pill reads it). Fictional only: Emma Johnson (request EMMA, person 1000011, household
1000001); Session 2 prices a $60,000 family's Round 1 at $1,500."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.schemas.financial_aid_decisions import GridRowOut
from api.services.financial_aid_today import build_today
from bunking.financial_aid.decisions import DecisionEvent
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, seed_line, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _service
from tests.unit.api.services.test_financial_aid_today import _inputs, _line

PENDING = "Ticked today; tonight's sync checks it."
NIGHT_AFTER = T0 + timedelta(hours=16)  # the ledger sync after the Mar 9 tick


def _tick(store: FakeDecisionsStore, n: int, amount: str, *, at: Any = T0, source: str = "tick") -> None:
    """A Posted tick on Emma's Round n, recorded at `at` by `source` (a person's "tick", the "ledger", a "placement")."""
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}",
            request_id=EMMA,
            round=n,
            kind="post",
            created=at,
            amount=Decimal(amount),
            effective_on=date(2027, 3, 9),
            lock_source=source,
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )


def _ask(store: FakeDecisionsStore, n: int, amount: str) -> None:
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}", request_id=EMMA, round=n, kind="ask", created=T0, amount=Decimal(amount)
        )
    )


async def _emma(store: FakeDecisionsStore) -> GridRowOut:
    return next(r for r in (await _service(store).grid(YEAR)).rows if r.request_id == EMMA)


def _not_reconciled(row: GridRowOut) -> tuple[int, list[tuple[str, int]]]:
    line = _line(build_today(_inputs([row]), casework=True, finance=False).casework, "not_reconciled")
    return line.items, [(r.code, r.items) for r in line.reasons]


@pytest.mark.asyncio
async def test_a_hand_tick_made_today_with_nothing_in_campminder_is_pending_not_an_exception() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    row = await _emma(store)
    assert row.confirmation is not None
    assert row.confirmation.status == "awaiting_sync"  # the CM ✓ pill's word, unchanged
    assert row.confirmation.reconciled is True  # off Not reconciled until a sync has run
    assert row.queues == ["waiting_on_family"]
    r1 = row.rounds[0]
    assert (r1.status, r1.cm_pending, r1.cm_pending_message) == ("posted", True, PENDING)
    assert _not_reconciled(row) == (0, [])


@pytest.mark.asyncio
async def test_a_hand_tick_with_its_money_in_campminder_before_the_sync_is_pending_too() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    row = await _emma(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.queues) == ("awaiting_sync", ["waiting_on_family"])
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (True, PENDING)


@pytest.mark.asyncio
async def test_after_a_sync_that_finds_nothing_it_is_not_reconciled_as_not_in_campminder() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    store.synced_at = NIGHT_AFTER
    row = await _emma(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.reconciled) == ("not_in_campminder", False)
    assert row.queues == ["waiting_on_family", "not_reconciled"]
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)
    assert _not_reconciled(row) == (1, [("not_in_campminder", 1)])


@pytest.mark.asyncio
async def test_a_hand_tick_the_sync_confirms_shows_neither() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    store.synced_at = NIGHT_AFTER
    row = await _emma(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.reconciled) == ("confirmed", True)
    assert row.queues == ["waiting_on_family"]
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)
    assert _not_reconciled(row) == (0, [])


@pytest.mark.parametrize("source", ["ledger", "placement"])
@pytest.mark.asyncio
async def test_a_ledger_or_placement_tick_is_never_pending(source: str) -> None:
    """Locks made from money already in CampMinder never wait for the sync (FROM_THE_LEDGER), so never read pending:
    with nothing in CampMinder they read not_in_campminder, an exception, at once."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500", source=source)
    row = await _emma(store)
    assert row.confirmation is not None
    assert row.confirmation.status == "not_in_campminder"
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)
    assert "not_reconciled" in (row.queues or [])


@pytest.mark.asyncio
async def test_only_the_round_whose_tick_awaits_the_sync_is_pending() -> None:
    """Round 1 was ticked by hand and confirmed by last night's sync; Round 2 was ticked by hand after it."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    _ask(store, 2, "400")
    seed_line(store, 9001, "1500", posted=T0)
    store.synced_at = NIGHT_AFTER
    _tick(store, 2, "300", at=NIGHT_AFTER + timedelta(hours=2))
    row = await _emma(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.reconciled) == ("awaiting_sync", True)
    assert [(r.round, r.status, r.cm_pending) for r in row.rounds[:2]] == [(1, "posted", False), (2, "posted", True)]
    assert [r.cm_pending_message for r in row.rounds[:2]] == [None, PENDING]
    assert "not_reconciled" not in (row.queues or [])


@pytest.mark.asyncio
async def test_payer_shares_awaiting_the_sync_are_not_an_exception_either() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    _tick(store, 1, "1500")
    seed_line(store, 9001, "900", posted=T0)  # the applicant's share is in; the other payer's isn't yet
    row = await _emma(store)
    assert row.confirmation is not None
    assert [s.status for s in row.confirmation.shares] == ["awaiting_sync", "awaiting_sync"]
    assert row.confirmation.reconciled is True
    assert row.queues == ["waiting_on_family"]
    assert _not_reconciled(row) == (0, [])
    store.synced_at = NIGHT_AFTER  # the sync runs: the other payer's share is missing
    after = await _emma(store)
    assert after.confirmation is not None
    assert after.confirmation.reconciled is False
    assert "not_reconciled" in (after.queues or [])
    assert (after.rounds[0].cm_pending, after.rounds[0].cm_pending_message) == (False, None)


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_nothing_is_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.services.financial_aid_decisions_service as decisions_service

    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    row = await _emma(store)
    assert row.confirmation is None
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)

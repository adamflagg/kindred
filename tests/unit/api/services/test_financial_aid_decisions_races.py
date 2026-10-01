"""A Posted tick whose rules-section locks went stale (campership G6). The tick commits its rounds and its
locks in one batch; when the rules record moved on since the locks were read, PocketBase refuses the whole
batch (412), so no round is posted and no section locked. A person's tick is refused for a reload; the
ledger's own tick (system:ledger) re-derives once. Every write runs the real 4a helper over the fake batch.
Fictional only."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.constants.collections import AID_DECISIONS, AID_RULES
from api.services.financial_aid_decisions_service import DecisionRefusedError
from bunking.financial_aid.change_log import AidWriteConflictError
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    RULES_ID,
    FakeDecisionsStore,
    FakeRules,
    approved,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _service, _tick

MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    """A tick refuses a date after today; the fixtures' dates sit in the fictional 2027 season."""
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


@pytest.mark.asyncio
async def test_a_tick_whose_locks_went_stale_posts_nothing_and_locks_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.rules_revision[RULES_ID] = 1  # finance approved a section after the tick read the rules (revision 0)
    with pytest.raises(AidWriteConflictError, match="reload and try again"):
        await _service(store, FakeRules(approved())).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert (store.events, store.log, store.rules_writes) == ([], [], [])
    assert store.rules_revision == {RULES_ID: 1}


@pytest.mark.asyncio
async def test_a_tick_that_reads_the_current_revision_posts_and_locks() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.rules_revision[RULES_ID] = 1
    rules = FakeRules(approved())
    rules.revision_reads = [1]
    out = await _service(store, rules).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert out.written == 1
    assert store.rules_revision[RULES_ID] == 1 + len(store.rules_writes)


@pytest.mark.asyncio
async def test_the_ledger_tick_rederives_once_after_a_conflict_and_posts_each_round_once() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", posted=MAR8)
    store.rules_revision[RULES_ID] = 1
    rules = FakeRules(approved())
    rules.revision_reads = [0, 1]  # the first run read before finance's save, the re-run after it
    out = await _service(store, rules).ledger_ticks(YEAR)
    assert out.ticked == 1
    assert len(rules.lock_calls) == 2  # the re-run read the rules again
    assert len(store.operations) == 2  # two attempts, one committed
    assert [(e.kind, e.round) for e in store.events] == [("post", 1)]
    assert len({row["operation_id"] for row in store.log}) == 1


@pytest.mark.asyncio
async def test_the_ledger_tick_gives_up_after_a_second_conflict_and_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", posted=MAR8)
    store.rules_revision[RULES_ID] = 2
    rules = FakeRules(approved())
    rules.revision_reads = [0, 1]  # both reads went stale
    with pytest.raises(DecisionRefusedError, match="next ledger sync"):
        await _service(store, rules).ledger_ticks(YEAR)
    assert (store.events, store.log, len(rules.lock_calls)) == ([], [], 2)


@pytest.mark.asyncio
async def test_a_person_s_tick_is_never_retried() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.rules_revision[RULES_ID] = 1
    rules = FakeRules(approved())
    with pytest.raises(AidWriteConflictError):
        await _service(store, rules).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert len(rules.lock_calls) == 1


@pytest.mark.asyncio
async def test_the_ledger_tick_sends_its_guarded_locks_first() -> None:
    """March's bulk tick may commit in chunks; only the first can then be refused whole. The guarded rules
    locks lead, so a conflict always comes back as a clean refusal, never a partial commit."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", posted=MAR8)
    await _service(store, FakeRules(approved())).ledger_ticks(YEAR)
    [operation] = store.operations
    collections = [write.collection for write in operation]
    assert collections[0] == AID_RULES  # at least one lock: with none, the ordering below holds vacuously
    assert collections == [AID_RULES] * (len(collections) - 1) + [AID_DECISIONS]

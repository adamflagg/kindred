"""Keep either request of a possible-duplicate pair, from either card (owner 2026-10-05)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from api.services.financial_aid_casework_service import CaseworkValidationError, FinancialAidCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import RequestRecord
from bunking.financial_aid.decisions.rounds import DecisionEvent
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"
OTHER_PARENT = 1000009


async def pair() -> tuple[FakeAidStore, FinancialAidCaseworkService, RequestRecord, RequestRecord]:
    """An active request and a duplicate_pending one for the same camper and session."""
    store = seeded_store()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 2 (All-Gender Cabin)", summer_ask=700.0))
    await FinancialAidIntakeService(store).build(YEAR)
    active = store.request_for(person=1000011, program="summer")
    extra = store.request_for(person=1000015, program="summer")
    pending = replace(
        extra,
        person_cm_id=1000011,
        household_cm_id=OTHER_PARENT,
        session_cm_id=active.session_cm_id,
        status="duplicate_pending",
        duplicate_of=active.id,
    )
    store.requests[pending.id] = pending
    # Intake gives a share only to a live request: a duplicate_pending one has none.
    store.payer_shares = {k: v for k, v in store.payer_shares.items() if v.request_id != pending.id}
    store.operations.clear()
    store.change_log.clear()
    return store, FinancialAidCaseworkService(store), active, pending


def posted(store: FakeAidStore, request_id: str, round_: int = 1) -> None:
    store.decision_events.append(
        DecisionEvent(
            id=f"evt{len(store.decision_events):012d}",
            request_id=request_id,
            round=round_,
            kind="post",
            created=datetime(2027, 3, 9, tzinfo=UTC),
        )
    )


@pytest.mark.asyncio
async def test_keeping_the_pending_request_swaps_the_pair_in_one_operation() -> None:
    store, casework, active, pending = await pair()
    out = await casework.mark_duplicate(active.id, pending.id, "Keep the second parent's.", ACTOR)
    assert (out.id, out.status, out.duplicate_of) == (active.id, "duplicate", pending.id)
    kept = store.requests[pending.id]
    assert (kept.status, kept.duplicate_of) == ("active", "")
    assert (store.requests[active.id].status, store.requests[active.id].duplicate_of) == ("duplicate", pending.id)
    assert len(store.operations) == 1
    assert store.operations[0]["require_reason"] is True
    by_entity = {r["entity_id"]: r for r in store.change_log if r["entity"] == "aid_requests"}
    assert {r["action"] for r in by_entity.values()} == {"keep_duplicate"}
    assert by_entity[active.id]["after"] == {"status": "duplicate", "duplicate_of": pending.id}
    assert by_entity[pending.id]["after"] == {"status": "active", "duplicate_of": ""}
    assert {r["operation_id"] for r in store.change_log} == {store.change_log[0]["operation_id"]}
    assert {r["reason"] for r in store.change_log} == {"Keep the second parent's."}


@pytest.mark.asyncio
async def test_the_demotion_is_written_before_the_promotion() -> None:
    # PocketBase's partial unique index allows one active request per camper and session.
    store, casework, active, pending = await pair()
    await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    order = [w.record_id for w in store.operations[0]["writes"] if w.collection == "aid_requests"]
    assert order == [active.id, pending.id]


@pytest.mark.asyncio
async def test_the_kept_request_gets_its_default_share_when_it_has_none() -> None:
    store, casework, active, pending = await pair()
    assert not [s for s in store.payer_shares.values() if s.request_id == pending.id]
    out = await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    (share,) = [s for s in store.payer_shares.values() if s.request_id == pending.id]
    assert (share.household_cm_id, str(share.share_pct), share.source) == (OTHER_PARENT, "100", "intake_default")
    assert out.id == active.id
    assert any(r["entity"] == "aid_payer_shares" for r in store.change_log)


@pytest.mark.asyncio
async def test_a_kept_request_that_already_has_shares_gets_no_second_default() -> None:
    store, casework, active, pending = await pair()
    template = next(s for s in store.payer_shares.values() if s.request_id == active.id)
    store.payer_shares["keep00000000001"] = replace(
        template, id="keep00000000001", request_id=pending.id, household_cm_id=OTHER_PARENT
    )
    before = len(store.payer_shares)
    await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert len(store.payer_shares) == before


@pytest.mark.asyncio
async def test_an_active_request_with_a_posted_round_cannot_be_swapped_away() -> None:
    store, casework, active, pending = await pair()
    posted(store, active.id, 2)
    with pytest.raises(CaseworkValidationError, match="Round 2 is posted: keep this request, or undo Posted first"):
        await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert (store.operations, store.change_log) == ([], [])
    assert store.requests[active.id].status == "active"


@pytest.mark.asyncio
async def test_a_round_posted_then_undone_does_not_block_the_swap() -> None:
    store, casework, active, pending = await pair()
    posted(store, active.id)
    store.decision_events.append(
        replace(
            store.decision_events[0], id="evt999999999999", kind="unpost", created=datetime(2027, 3, 10, tzinfo=UTC)
        )
    )
    out = await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert out.status == "duplicate"


@pytest.mark.asyncio
async def test_a_pending_survivor_of_some_other_request_is_refused() -> None:
    store, casework, active, pending = await pair()
    store.requests[pending.id] = replace(pending, duplicate_of="someoneelse0001")
    with pytest.raises(CaseworkValidationError, match="the request kept must be active"):
        await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["duplicate", "withdrawn", "unmatched_session"])
async def test_a_decided_or_closed_survivor_is_refused(status: str) -> None:
    store, casework, active, pending = await pair()
    store.requests[pending.id] = replace(pending, status=status)
    with pytest.raises(CaseworkValidationError):
        await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_other_camper_other_season_or_other_session_is_refused() -> None:
    store, casework, active, pending = await pair()
    for other in (
        replace(pending, person_cm_id=1000021),
        replace(pending, year=YEAR - 1),
        replace(pending, session_cm_id=1000105),
    ):
        store.requests[pending.id] = other
        with pytest.raises(CaseworkValidationError):
            await casework.mark_duplicate(active.id, pending.id, "r", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_swap_needs_a_reason() -> None:
    store, casework, active, pending = await pair()
    with pytest.raises(CaseworkValidationError, match="reason"):
        await casework.mark_duplicate(active.id, pending.id, "  ", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_marking_the_pending_one_a_duplicate_still_works_and_writes_no_share() -> None:
    store, casework, active, pending = await pair()
    out = await casework.mark_duplicate(pending.id, active.id, "r", ACTOR)
    assert (out.status, out.duplicate_of) == ("duplicate", active.id)
    assert [r["action"] for r in store.change_log] == ["mark_duplicate"]


def test_the_router_builds_its_casework_service_on_a_store_that_reads_decisions() -> None:
    # The swap reads a request's Posted ticks; a store without that read fails only at request time.
    from api.routers import financial_aid

    assert callable(getattr(financial_aid._casework()._store, "fetch_request_events", None))

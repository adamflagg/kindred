"""Cancellations in the decisions reads (Task 3) and the cancel write (Task 4), campership sub-project
10b-2 (spec §5.3, §5.6, §6.2, §6.3; D54, D101, D141). Fictional only; every write runs the real 4a
helper over a fake batch. Figures: a tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import get_args
from unittest.mock import MagicMock

import pytest

from api.schemas.financial_aid_decisions import BudgetResponse, CancelReasonOut, GridRowOut, RoundCellOut
from api.services.financial_aid_cancellations import CANCEL_REASONS, CancelEvent, EnrollmentState
from api.services.financial_aid_decisions_repository import (
    FinancialAidDecisionsRepository,
    cancel_event,
    enrollment_state,
)
from bunking.financial_aid.decisions import PAST_DATE_GAPS
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    grant_row,
    log_seeded,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _posted, _service

MAY2 = date(2027, 5, 2)
NIGHT_AFTER = T0 + timedelta(hours=16)


def _enrol(store: FakeDecisionsStore, status: int, *, session: int = 1000101, on: date | None = MAY2) -> None:
    store.enrollments.append(EnrollmentState(1000011, 1000001, session, status, on))


def _cancel_in_kindred(store: FakeDecisionsStore, request_id: str = EMMA) -> None:
    store.cancel_events.append(
        CancelEvent("can000000000001", request_id, "cancel", T0, reason="not_known", in_kindred=True, actor=ACTOR)
    )


async def _row(store: FakeDecisionsStore) -> GridRowOut:
    return next(r for r in (await _service(store).grid(YEAR)).rows if r.request_id == EMMA)


async def _round1_counts(store: FakeDecisionsStore) -> tuple[int, int]:
    """Round 1's (Held, Needs an offer) request counts on the strip."""
    strip = next(s for s in (await _service(store).budget(YEAR)).strip if s.round == 1)
    assert strip.held is not None
    assert strip.needs_offer is not None
    return strip.held.requests, strip.needs_offer.requests


def _camp_r1(budget: BudgetResponse) -> RoundCellOut:
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    return next(c for c in camp.rounds if c.round == 1)


# --- the repository ---------------------------------------------------------------------------------


def test_a_record_becomes_a_cancel_event() -> None:
    record = SimpleNamespace(
        id="can000000000001",
        request=EMMA,
        event="cancel",
        reason="did_not_want_to_appeal",
        in_kindred=True,
        note="",
        actor=ACTOR,
        created="2027-03-09 17:00:00.000Z",
    )
    event = cancel_event(record)
    assert (event.kind, event.reason, event.in_kindred, event.created) == (
        "cancel",
        "did_not_want_to_appeal",
        True,
        datetime(2027, 3, 9, 17, 0, tzinfo=UTC),
    )
    assert cancel_event(SimpleNamespace(**{**vars(record), "event": "reopen", "reason": ""})).reason is None
    with pytest.raises(ValueError, match="unknown event"):
        cancel_event(SimpleNamespace(**{**vars(record), "event": "withdraw"}))


def test_an_attendee_record_becomes_an_enrollment_state() -> None:
    record = SimpleNamespace(
        person_id=1000011,
        status_id=32,
        enrollment_date="2027-05-02 19:00:00.000Z",
        expand={"person": SimpleNamespace(household_id=1000001), "session": SimpleNamespace(cm_id=1000101)},
    )
    assert enrollment_state(record) == EnrollmentState(1000011, 1000001, 1000101, 32, MAY2)


@pytest.mark.asyncio
async def test_the_reads_filter_by_season_and_only_the_three_statuses_that_matter() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    repo = FinancialAidDecisionsRepository(pb)
    await repo.fetch_cancellations(YEAR)
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert (pb.collection.call_args.args, query) == (
        ("aid_cancellations",),
        {"filter": f"year = {YEAR}", "sort": "created,id"},
    )
    pb.collection.return_value.get_full_list.reset_mock()
    await repo.fetch_enrollment_states(YEAR, {1000011, 1000012}, {1000001})
    filters = [c.kwargs["query_params"]["filter"] for c in pb.collection.return_value.get_full_list.call_args_list]
    statuses = f"year = {YEAR} && (status_id = 2 || status_id = 32 || status_id = 256)"
    assert filters == [
        f"{statuses} && (person_id = 1000011 || person_id = 1000012)",
        f"{statuses} && (person.household_id = 1000001)",
    ]
    pb.collection.return_value.get_full_list.reset_mock()
    await repo.fetch_enrollment_states(YEAR, set(), set())
    assert pb.collection.return_value.get_full_list.call_args_list == []  # nobody named: nothing read
    with pytest.raises(ValueError, match="record id"):
        await repo.fetch_request_cancellations('x" || year > 0 || "')


def test_the_response_and_the_pure_layer_hold_the_same_nine_reasons() -> None:
    assert get_args(CancelReasonOut) == CANCEL_REASONS


# --- the reads (Task 3) -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_camper_cancelled_in_campminder_before_the_offer_counts_nowhere_and_asks_for_a_reason() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")  # intake re-resolved it after the cancel
    assert await _round1_counts(store) == (1, 0)  # before: Held, below the line
    _enrol(store, 32)
    assert await _round1_counts(store) == (0, 0)
    row = await _row(store)
    assert row.cancellation is not None
    assert (row.cancellation.by, row.cancellation.on, row.cancellation.reason) == ("campminder", MAY2, None)
    assert row.todos is not None
    assert [(t.code, t.message) for t in row.todos] == [("cancel_reason_missing", "Cancelled: give a reason")]
    assert (row.rounds, row.to_reverse, row.holds) == ([], False, [])


@pytest.mark.asyncio
async def test_a_camper_who_switched_sessions_is_not_cancelled() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _enrol(store, 32, session=1000104)
    _enrol(store, 2, session=1000101)
    row = await _row(store)
    assert (row.cancellation, row.todos, row.rounds[0].status) == (None, [], "needs_offer")


@pytest.mark.asyncio
async def test_a_cancelled_request_with_posted_aid_still_live_sits_in_to_reverse_until_the_reversal_posts() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    _enrol(store, 32)
    store.synced_at = NIGHT_AFTER
    row = await _row(store)
    assert (row.to_reverse, row.rounds[0].status, row.total_posted) == (True, "posted", 1500.0)
    assert _camp_r1(await _service(store).budget(YEAR)).posted == 1500.0
    store.camp_lines[0] = replace(
        store.camp_lines[0], is_reversed=True, reversal_date=datetime(2027, 5, 2, 20, 0, tzinfo=UTC)
    )
    row = await _row(store)
    assert row.to_reverse is False
    assert row.confirmation is not None
    assert row.confirmation.status == "reversed"
    assert _camp_r1(await _service(store).budget(YEAR)).posted == 0.0


@pytest.mark.asyncio
async def test_to_reverse_takes_unticked_live_aid_and_a_kindred_cancellation_too() -> None:
    """Decision 15 as ruled (wide): ticked or not, cancelled in Kindred or CampMinder."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")  # in CampMinder, never ticked
    _cancel_in_kindred(store)
    row = await _row(store)
    assert (row.to_reverse, row.rounds, row.confirmation) == (True, [], None)


@pytest.mark.asyncio
async def test_the_season_reads_only_the_registrations_its_requests_name() -> None:
    """Never every attendee of the season: the live and withdrawn requests' campers, and the households
    of household-level requests."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, "reqliam00000001", household=1000002, person=1000021, status="withdrawn")
    seed_request(store, "reqolivia000001", household=1000003, person=1000031, status="duplicate")
    seed_request(store, "reqfamily000001", household=1000004, person=0)
    await _service(store).grid(YEAR)
    assert store.enrollment_reads == [(frozenset({1000011, 1000021}), frozenset({1000004}))]


@pytest.mark.asyncio
async def test_a_withdrawn_request_with_posted_aid_live_on_a_cancelled_enrollment_is_to_reverse() -> None:
    """Decision 15 (plan review): D54's forgotten reversal. Withdrawn, so it takes no cancellation and no
    to-do; the camper still enrolled means nothing to reverse."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    _enrol(store, 2)
    assert (await _row(store)).to_reverse is False
    store.enrollments.clear()
    _enrol(store, 32)
    row = await _row(store)
    assert (row.to_reverse, row.cancellation, row.todos, row.total_posted) == (True, None, [], 1500.0)


@pytest.mark.asyncio
async def test_a_withdrawn_request_takes_no_cancellation_and_no_to_do() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _enrol(store, 32)
    row = await _row(store)
    assert (row.cancellation, row.todos) == (None, [])


@pytest.mark.asyncio
async def test_a_cancelled_request_keeps_its_program_and_pool_and_its_outside_grant_stays_in_that_pool() -> None:
    """Decision 19: not live, but still the camp pool's (never No pool), and so is its outside grant."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _cancel_in_kindred(store)
    service = _service(store, register=[grant_row(EMMA, "500")])
    row = next(r for r in (await service.grid(YEAR)).rows if r.request_id == EMMA)
    assert (row.program_key, row.pool) == ("summer", "camp_pool")
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    assert camp.below.outside_grants == 500.0
    assert [p.pool for p in budget.pools if p.pool == ""] == []


@pytest.mark.asyncio
async def test_a_season_before_2027_counts_the_cancellation_but_asks_for_no_reason() -> None:
    """Clean spec §5.6: cancel reasons exist from 2027. 2026's cancelled requests still leave Needs an
    offer, and carry no to-do."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.requests[EMMA] = replace(store.requests[EMMA], year=2026)
    store.applications = [replace(a, year=2026) for a in store.applications]
    store.shares = [replace(s, year=2026) for s in store.shares]
    _enrol(store, 32)
    row = next(r for r in (await _service(store).grid(2026)).rows if r.request_id == EMMA)
    assert row.cancellation is not None
    assert (row.rounds, row.todos) == ([], [])


@pytest.mark.asyncio
async def test_a_past_read_names_the_cancellation_fields_it_leaves_empty() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    _enrol(store, 32)
    out = await _service(store).grid(YEAR, as_of=date(2027, 3, 1))
    row = next(r for r in out.rows if r.request_id == EMMA)
    assert (row.cancellation, row.to_reverse, row.todos) == (None, None, None)
    named = {g.figure: g.reason for g in out.not_rebuilt}
    assert {f: named[f] for f in ("cancellation", "to_reverse", "todos")} == {
        f: PAST_DATE_GAPS[f] for f in ("cancellation", "to_reverse", "todos")
    }

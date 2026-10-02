"""Cancellations in the decisions reads (Task 3) and the cancel write (Task 4), campership sub-project
10b-2 (spec §5.3, §5.6, §6.2, §6.3; D54, D101, D141). Fictional only; every write runs the real 4a
helper over a fake batch. Figures: a tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import get_args
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from api.schemas import financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    AskIn,
    AsOfAxis,
    BudgetResponse,
    CancellationIn,
    CancelReasonOut,
    GridRowOut,
    PostedIn,
    PostedRow,
    Round3AmountIn,
    RoundCellOut,
    RoundRef,
)
from api.services.financial_aid_cancellations import CANCEL_REASONS, TODO_CANCEL_REASON, CancelEvent, EnrollmentState
from api.services.financial_aid_decisions_repository import (
    FinancialAidDecisionsRepository,
    cancel_event,
    enrollment_state,
)
from api.services.financial_aid_decisions_service import (
    DecisionNotFoundError,
    DecisionRefusedError,
    FinancialAidDecisionsService,
)
from bunking.financial_aid.decisions import GRID_GAPS, PAST_DATE_GAPS, DecisionEvent
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
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _event, _posted, _service

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
    assert sorted(filters) == sorted(  # the chunks are read concurrently, so in no fixed order
        [
            f"{statuses} && (person_id = 1000011 || person_id = 1000012)",
            f"{statuses} && (person.household_id = 1000001)",
        ]
    )
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
async def test_a_past_row_fills_included_and_the_to_dos_as_of_the_day_and_names_to_reverse_by_the_ledger() -> None:
    """A past row carries its cancellation as of the day (Decision 11), so Included and the to-do ("Cancelled: give
    a reason") are rebuilt from it. To reverse reads the ledger, which a past date doesn't, so it stays empty with
    its own reason."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    _enrol(store, 32, on=date(2027, 3, 5))
    out = await _service(store).grid(YEAR, as_of=date(2027, 3, 8))
    row = next(r for r in out.rows if r.request_id == EMMA)
    assert row.cancellation is not None
    assert (row.included, row.to_reverse) == (False, None)
    assert [t.code for t in row.todos or []] == [TODO_CANCEL_REASON]
    assert row.todos == (await _row(store)).todos  # the same to-do today's row carries
    named = {g.figure: g.reason for g in out.not_rebuilt}
    assert "included" not in named
    assert "todos" not in named
    assert not {"included", "todos"} & set(GRID_GAPS)
    assert {f: named[f] for f in ("cancellation", "to_reverse")} == {
        f: PAST_DATE_GAPS[f] for f in ("cancellation", "to_reverse")
    }
    assert "ledger" in PAST_DATE_GAPS["to_reverse"]
    assert PAST_DATE_GAPS["to_reverse"] != PAST_DATE_GAPS["cancellation"]


@pytest.mark.asyncio
async def test_a_past_row_of_an_uncancelled_request_is_included_with_no_to_do() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    row = next(r for r in (await _service(store).grid(YEAR, as_of=date(2027, 3, 8))).rows if r.request_id == EMMA)
    assert (row.included, row.todos) == (True, [])


@pytest.mark.asyncio
async def test_a_past_budget_names_the_cancellation_gap_its_round_2_asks_carry() -> None:
    """D21 and the owner ruling of 2026-10-02 (⚠, relayed by the lead): a past budget leaves out of Round 2 asks
    so far a request CampMinder had cancelled by then, as today's read does, and still names the cancellation gap
    (a registration whose status changed after the day can't be seen)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    early = T0 - timedelta(days=5)
    snapshot = {"pool": "camp_pool", "counts_toward_budget": True}
    store.events += [
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=early,
            amount=Decimal(1500),
            effective_on=date(2027, 3, 4),
            lock_source="tick",
            rules_version=1,
            snapshot=snapshot,
        ),
        DecisionEvent(
            id="ev0000000000002",
            request_id=EMMA,
            round=2,
            kind="ask",
            created=early,
            amount=Decimal(900),
            effective_on=date(2027, 3, 4),
        ),
    ]
    _enrol(store, 32, on=date(2027, 3, 5))
    service = _service(store)
    live = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    out = await service.budget(YEAR, as_of=date(2027, 3, 8))
    past = next(p for p in out.pools if p.pool == "camp_pool")
    assert live.demand.round2_asked == 0
    assert past.demand.round2_asked == 0  # owner ruling 2026-10-02: every cancellation leaves Round 2 asks so far
    named = {g.figure: g.reason for g in out.not_rebuilt}
    assert named.get("cancellation") == PAST_DATE_GAPS["cancellation"]


@pytest.mark.asyncio
@pytest.mark.parametrize("axis", ["campminder", "recorded"])
async def test_a_past_read_before_a_kindred_cancellation_still_shows_the_unposted_rounds(axis: AsOfAxis) -> None:
    """Decision 21: a Kindred cancellation applies from when it was recorded, on both as-of axes."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, T0 - timedelta(days=30))
    _cancel_in_kindred(store)  # recorded Mar 9
    service = _service(store)
    before = next(r for r in (await service.grid(YEAR, as_of=date(2027, 3, 8), as_of_axis=axis)).rows)
    after = next(r for r in (await service.grid(YEAR, as_of=date(2027, 3, 10), as_of_axis=axis)).rows)
    assert ([r.round for r in before.rounds], after.rounds) == ([1], [])


@pytest.mark.asyncio
async def test_a_cancelled_request_whose_household_line_stays_unplaced_is_not_to_reverse() -> None:
    """Two campers in one family: a household-level line can't tell them apart, so it waits in To place.
    Cancelling one camper's request neither makes it To reverse nor moves the family's To place amount."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    _posted(store, LIAM, 1, "1500")  # so Liam's row carries its confirmation, and with it the family's To place
    seed_line(store, 9001, "1500", person=0)
    store.synced_at = NIGHT_AFTER

    async def liam_to_place() -> float | None:
        row = next(r for r in (await _service(store).grid(YEAR)).rows if r.request_id == LIAM)
        return row.confirmation.family_unplaced if row.confirmation is not None else None

    before = await liam_to_place()
    assert before == 1500.0
    _cancel_in_kindred(store)
    row = await _row(store)
    assert (row.cancellation is not None, row.to_reverse) == (True, False)
    assert await liam_to_place() == before


# --- the write (Task 4) -----------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The write bodies refuse a date after today; the fixtures' dates sit in the fictional 2027 season."""
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


async def _figures(service: FinancialAidDecisionsService) -> tuple[float | None, ...]:
    """The camp pool's Round 1 Needs an offer and Remaining, Round 3 Pending approval, Round 1 unmet
    ask (forward demand), and the Remaining line."""
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    r1, r3 = (next(c for c in camp.rounds if c.round == n) for n in (1, 3))
    line = next(p for p in (await service.remaining(YEAR)).pools if p.pool == "camp_pool")
    return r1.needs_offer, r1.remaining, r3.pending_approval, camp.demand.round1_unmet, line.remaining


def test_d141s_body_rules() -> None:
    for reason in CANCEL_REASONS:
        if reason != "another_reason":
            CancellationIn(cancelled=True, reason=reason)  # no note needed
    CancellationIn(cancelled=True, reason="another_reason", note="Moved away")
    CancellationIn(cancelled=False, note="The family found the money")
    for bad in (
        {"cancelled": True},
        {"cancelled": True, "reason": "another_reason"},
        {"cancelled": True, "reason": "another_reason", "note": "   "},
        {"cancelled": False},
        {"cancelled": False, "reason": "not_known", "note": "x"},
        {"cancelled": True, "reason": "moved"},
    ):
        with pytest.raises(ValidationError):
            CancellationIn.model_validate(bad)


@pytest.mark.asyncio
async def test_the_registrar_cancels_in_kindred_with_a_reason_and_can_reopen() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    # A Round 3 amount above the registrar's limit, waiting for finance (D79).
    _event(store, EMMA, 3, "ask", amount=Decimal(900), effective_on=date(2027, 3, 1), statement_of_need="Job loss")
    _event(store, EMMA, 3, "award", amount=Decimal(900), needs_approval=True)
    service = _service(store)
    before = await _figures(service)
    assert before == (1500.0, 338500.0, 900.0, 2500.0, 397600.0)
    out = await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="aid_not_enough"), ACTOR)
    assert (out.written, out.unchanged) == (1, 0)
    assert store.cancel_events[-1].in_kindred is True
    assert store.log[-1]["reason"] == "declined: aid not enough / financial constraints"
    row = await _row(store)
    assert row.cancellation is not None
    assert (row.cancellation.by, row.cancellation.on, row.cancellation.reason) == (
        "kindred",
        date(2027, 3, 9),
        "aid_not_enough",
    )
    assert (row.todos, row.rounds) == ([], [])  # not live: its decided Round 1 left Needs an offer
    # Decision 14: Needs an offer 1,500 -> 0 (Round 1's Remaining rises by 1,500), Pending approval 900 -> 0,
    # forward demand 2,500 -> 0, and the Remaining line rises by both.
    assert await _figures(service) == (0.0, 340000.0, 0.0, 0.0, 400000.0)
    again = await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="aid_not_enough"), ACTOR)
    assert (again.written, again.unchanged, len(store.operations)) == (0, 1, 1)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="schedule"), ACTOR)  # the latest wins
    row = await _row(store)
    assert row.cancellation is not None
    assert (store.log[-1]["reason"], row.cancellation.reason) == ("schedule", "schedule")
    await service.set_cancellation(EMMA, CancellationIn(cancelled=False, note="The family found the money"), ACTOR)
    row = await _row(store)
    assert (row.cancellation, row.rounds[0].status) == (None, "needs_offer")
    assert await _figures(service) == before


@pytest.mark.asyncio
async def test_a_campminder_cancellation_with_a_pending_round3_ask_drops_the_same_figures() -> None:
    """Controller ruling (Task 3 review): the harness's figures also move when CampMinder, not Kindred,
    cancels an active request that keeps its session (status 32, no enrolled row)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _event(store, EMMA, 3, "ask", amount=Decimal(900), effective_on=date(2027, 3, 1), statement_of_need="Job loss")
    _event(store, EMMA, 3, "award", amount=Decimal(900), needs_approval=True)
    service = _service(store)
    assert await _figures(service) == (1500.0, 338500.0, 900.0, 2500.0, 397600.0)
    _enrol(store, 32)
    assert await _figures(service) == (0.0, 340000.0, 0.0, 0.0, 400000.0)


@pytest.mark.asyncio
async def test_a_reason_for_a_campminder_cancellation_clears_the_to_do_and_only_campminder_reopens_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _enrol(store, 32, on=date(2027, 3, 1))  # before the fake clock: the reason answers this cancellation
    service = _service(store)
    body = CancellationIn(cancelled=True, reason="another_reason", note="Moved away")
    await service.set_cancellation(EMMA, body, ACTOR)
    assert store.cancel_events[-1].in_kindred is False
    assert store.log[-1]["reason"] == "another reason: Moved away"
    row = await _row(store)
    assert row.cancellation is not None
    assert (row.cancellation.by, row.cancellation.reason, row.cancellation.note) == (
        "campminder",
        "another_reason",
        "Moved away",
    )
    assert row.todos == []
    writes = len(store.operations)
    with pytest.raises(DecisionRefusedError, match="CampMinder"):
        await service.set_cancellation(EMMA, CancellationIn(cancelled=False, note="A mistake"), ACTOR)
    assert len(store.operations) == writes


@pytest.mark.asyncio
async def test_a_familys_kindred_decline_survives_a_campminder_cancel_a_reason_edit_and_a_re_enrolment() -> None:
    """Final review: the reason edited after CampMinder also cancelled keeps the Kindred cancellation, so
    the camper re-enrolling in CampMinder leaves the request cancelled, not back in Needs an offer."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _enrol(store, 2)
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="aid_not_enough"), ACTOR)
    store.enrollments.clear()
    _enrol(store, 32)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    assert store.cancel_events[-1].in_kindred is True
    store.enrollments.clear()
    _enrol(store, 2)
    row = await _row(store)
    assert row.cancellation is not None
    assert (row.cancellation.by, row.cancellation.reason, row.rounds) == ("kindred", "schedule", [])


@pytest.mark.asyncio
async def test_a_reason_stands_when_campminder_re_dates_the_cancellation() -> None:
    """Owner 2026-10-01: a recorded reason answers the request's one cancellation; CampMinder moving the
    cancellation's date later neither drops the reason nor brings the to-do back."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _enrol(store, 32, on=date(2027, 3, 1))
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    store.enrollments.clear()
    _enrol(store, 32, on=date(2027, 3, 20))
    row = await _row(store)
    assert row.cancellation is not None
    assert (row.cancellation.reason, row.todos) == ("schedule", [])
    out = await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    assert (out.written, out.unchanged) == (0, 1)


@pytest.mark.asyncio
async def test_the_ledger_never_ticks_a_cancelled_request_and_its_live_aid_is_to_reverse() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")  # full cover for the decided 1,500 (D146): it would tick if live
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="not_known"), ACTOR)
    assert (await service.ledger_ticks(YEAR)).ticked == 0
    row = await _row(store)
    assert (row.to_reverse, row.notes) == (True, [])


@pytest.mark.asyncio
async def test_reopening_a_request_that_is_not_cancelled_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    out = await _service(store).set_cancellation(EMMA, CancellationIn(cancelled=False, note="Checking"), ACTOR)
    assert (out.written, out.unchanged, store.operations) == (0, 1, [])


@pytest.mark.asyncio
async def test_only_a_live_request_can_be_cancelled_and_an_unknown_one_is_not_found() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match="withdrawn"):
        await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="not_known"), ACTOR)
    with pytest.raises(DecisionNotFoundError):
        await service.set_cancellation("reqnone00000001", CancellationIn(cancelled=True, reason="not_known"), ACTOR)


@pytest.mark.asyncio
async def test_a_request_cancelled_in_kindred_takes_no_asks_amounts_or_ticks_until_reopened() -> None:
    """Decision 14 (plan review): reopen it first. Nothing is written on a refusal."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    service = _service(store)
    for request_id in (EMMA, LIAM):
        await service.set_cancellation(request_id, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    writes = len(store.operations)
    tick = PostedIn(rows=[PostedRow(request_id=EMMA, round=1, amount=Decimal(1500))])
    ask = AskIn(round=3, amount=Decimal(900), asked_on=date(2027, 3, 1), statement_of_need="Job loss")
    with pytest.raises(DecisionRefusedError, match="Cancelled in Kindred: reopen it first"):
        await service.key_ask(EMMA, ask, ACTOR)
    with pytest.raises(DecisionRefusedError, match="Cancelled in Kindred: reopen it first"):
        await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(900)), ACTOR, can_approve=True)
    with pytest.raises(DecisionRefusedError, match="Cancelled in Kindred: reopen it first"):
        await service.tick_posted(YEAR, tick, ACTOR)
    with pytest.raises(DecisionRefusedError, match="Cancelled in Kindred: reopen it first"):
        await service.tick_accepted(YEAR, AcceptedIn(rows=[RoundRef(request_id=LIAM, round=1)], accepted=True), ACTOR)
    assert len(store.operations) == writes
    await service.set_cancellation(EMMA, CancellationIn(cancelled=False, note="The family found the money"), ACTOR)
    assert (await service.tick_posted(YEAR, tick, ACTOR)).written == 1


def _refused_by_kindred_cancel() -> str:
    return "Cancelled in Kindred: reopen it first"


@pytest.mark.asyncio
async def test_each_decision_write_path_refuses_a_kindred_cancelled_request_on_its_own() -> None:
    def fresh() -> tuple[FakeDecisionsStore, FinancialAidDecisionsService]:
        store = FakeDecisionsStore()
        seed_request(store, EMMA)
        _event(store, EMMA, 3, "ask", amount=Decimal(900), effective_on=date(2027, 3, 1), statement_of_need="x")
        _event(store, EMMA, 3, "award", amount=Decimal(900), needs_approval=True)
        _cancel_in_kindred(store)
        return store, _service(store)

    tick = PostedIn(rows=[PostedRow(request_id=EMMA, round=1, amount=Decimal(1500))])
    calls = {
        "key_ask": lambda s: s.key_ask(EMMA, AskIn(round=2, amount=Decimal(900), asked_on=date(2027, 3, 1)), ACTOR),
        "key_round3_amount": lambda s: s.key_round3_amount(
            EMMA, Round3AmountIn(amount=Decimal(100)), ACTOR, can_approve=True
        ),
        "decide_round3": lambda s: s.decide_round3(EMMA, schemas.Round3ApprovalIn(approve=True, note="ok"), ACTOR),
        "tick_posted": lambda s: s.tick_posted(YEAR, tick, ACTOR),
        "tick_accepted": lambda s: s.tick_accepted(
            YEAR, AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True), ACTOR
        ),
    }
    for name, call in calls.items():
        store, service = fresh()
        if name == "tick_accepted":
            _posted(store, EMMA, 1, "1500")
        with pytest.raises(DecisionRefusedError, match=_refused_by_kindred_cancel()):
            await call(service)
        assert store.operations == [], name


@pytest.mark.asyncio
async def test_undoing_a_tick_and_unaccepting_stay_open_on_a_kindred_cancelled_request() -> None:
    store = FakeDecisionsStore()
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    _event(store, LIAM, 1, "accept")
    service = _service(store)
    await service.set_cancellation(LIAM, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    out = await service.tick_accepted(
        YEAR, AcceptedIn(rows=[RoundRef(request_id=LIAM, round=1)], accepted=False), ACTOR
    )
    assert out.written == 1
    out = await service.undo_posted(YEAR, schemas.UnpostIn(request_id=LIAM, round=1, reason="Mistaken tick"), ACTOR)
    assert out.written == 1


@pytest.mark.asyncio
async def test_a_kindred_cancellation_campminder_has_overtaken_no_longer_says_reopen_it_first() -> None:
    """Cancelled in Kindred, then CampMinder cancels too: the grid says campminder, and reopening is
    refused, so keying must not tell staff to reopen. The ask is keyed; the Accepted tick gets the
    ordinary refusal for a round never posted."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="schedule"), ACTOR)
    _enrol(store, 32)
    ask = AskIn(round=3, amount=Decimal(900), asked_on=date(2027, 3, 1), statement_of_need="Job loss")
    assert (await service.key_ask(EMMA, ask, ACTOR)).written == 1
    acc = AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True)
    with pytest.raises(DecisionRefusedError) as refused:
        await service.tick_accepted(YEAR, acc, ACTOR)
    assert str(refused.value) == f"{EMMA}: Round 1 is not posted"


@pytest.mark.asyncio
async def test_the_accepted_tick_reads_only_the_registrations_of_the_requests_it_ticks() -> None:
    """A one-row Accepted tick reads that request's camper, never every aid camper of the season."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    out = await _service(store).tick_accepted(
        YEAR, AcceptedIn(rows=[RoundRef(request_id=LIAM, round=1)], accepted=True), ACTOR
    )
    assert out.written == 1
    assert store.enrollment_reads == [(frozenset({1000021}), frozenset())]


def _appeal(store: FakeDecisionsStore) -> None:
    """Emma: Round 1 posted Mar 4, a Round 2 ask of 900 the same day."""
    log_seeded(store, T0 - timedelta(days=30))
    early = T0 - timedelta(days=5)
    store.events += [
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=early,
            amount=Decimal(1500),
            effective_on=date(2027, 3, 4),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        ),
        DecisionEvent(
            id="ev0000000000002",
            request_id=EMMA,
            round=2,
            kind="ask",
            created=early,
            amount=Decimal(900),
            effective_on=date(2027, 3, 4),
        ),
    ]


async def _asked(store: FakeDecisionsStore, as_of: date | None = None) -> float | None:
    out = await _service(store).budget(YEAR, as_of=as_of)
    return next(p for p in out.pools if p.pool == "camp_pool").demand.round2_asked


@pytest.mark.asyncio
async def test_round_2_asks_so_far_counts_an_active_request_and_leaves_out_both_cancellations() -> None:
    active = FakeDecisionsStore()
    seed_request(active, EMMA)
    _appeal(active)
    assert await _asked(active) == 900.0
    assert await _asked(active, date(2027, 3, 8)) == 900.0
    by_campminder = FakeDecisionsStore()
    seed_request(by_campminder, EMMA)
    _appeal(by_campminder)
    _enrol(by_campminder, 32, on=date(2027, 3, 5))
    assert await _asked(by_campminder) == 0.0  # live already left it out (10b-2 Decision 14): pinned, not new
    assert await _asked(by_campminder, date(2027, 3, 8)) == 0.0  # the ruling: the past read now agrees
    in_kindred = FakeDecisionsStore()
    seed_request(in_kindred, EMMA)
    _appeal(in_kindred)
    _cancel_in_kindred(in_kindred)
    assert await _asked(in_kindred) == 0.0


@pytest.mark.asyncio
async def test_a_campminder_cancellation_after_the_day_still_counts_that_days_round_2_ask() -> None:
    """3c-2's rule: CampMinder's cancel counts as of the date by its earliest cancel date on or before the day."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    _enrol(store, 32, on=date(2027, 3, 10))
    assert await _asked(store, date(2027, 3, 8)) == 900.0
    assert await _asked(store) == 0.0


@pytest.mark.asyncio
async def test_live_is_unchanged_for_every_other_reader() -> None:
    """The ruling narrows forward demand only. `live` feeds hold release, reconciliation, the scenario snapshot and
    pricing Decision 13: a CampMinder-cancelled request stays not live on today's read and, on a past date where
    the cancellation gap reaches it, stays priced live then, exactly as before."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    _enrol(store, 32, on=date(2027, 3, 5))
    service = _service(store)
    today = await service.season(YEAR)
    past = await service.past_season(YEAR, date(2027, 3, 8), "campminder")
    assert (today.priced[EMMA].live, EMMA in today.cancelled_in_campminder) == (False, True)
    assert (past.priced[EMMA].live, past.gapped[EMMA], EMMA in past.cancelled_in_campminder) == (
        True,
        "cancellation",
        True,
    )


def test_the_cancellation_gap_says_round_2_asks_leave_the_request_out() -> None:
    assert "Round 2 asks so far" in PAST_DATE_GAPS["cancellation"]


@pytest.mark.asyncio
async def test_a_past_grid_row_carries_the_cancellation_round_2_asks_left_out() -> None:
    """Decision 11 (lead ruling, plan review option (b)): ⚠6(b)'s Appeals list reads the row's `cancellation`, so a
    past row carries the one the figure used: CampMinder's by the day (earliest cancel date on or before it) first,
    else Kindred's as recorded by then."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    _enrol(store, 32, on=date(2027, 3, 5))
    service = _service(store)
    then = next(r for r in (await service.grid(YEAR, as_of=date(2027, 3, 8))).rows if r.request_id == EMMA)
    assert then.cancellation is not None
    assert (then.cancellation.by, then.cancellation.on) == ("campminder", date(2027, 3, 5))
    earlier = next(r for r in (await service.grid(YEAR, as_of=date(2027, 3, 4))).rows if r.request_id == EMMA)
    assert earlier.cancellation is None  # not cancelled yet on Mar 4


@pytest.mark.asyncio
async def test_a_past_grid_row_carries_a_kindred_cancellation_recorded_by_then() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    store.cancel_events.append(
        CancelEvent(
            "can000000000002", EMMA, "cancel", T0 - timedelta(days=2), reason="schedule", in_kindred=True, actor=ACTOR
        )
    )
    row = next(r for r in (await _service(store).grid(YEAR, as_of=date(2027, 3, 8))).rows if r.request_id == EMMA)
    assert row.cancellation is not None
    assert (row.cancellation.by, row.cancellation.on, row.cancellation.reason) == (
        "kindred",
        date(2027, 3, 7),
        "schedule",
    )
    assert await _asked(store, date(2027, 3, 8)) == 0.0  # and the figure leaves it out too (not live then)


@pytest.mark.asyncio
async def test_a_past_row_with_two_cancelled_registrations_shows_the_latest_date_on_or_before_the_day() -> None:
    """Lead ruling: a past read and today's agree (enrollment_cancelled shows the latest cancel date)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    _enrol(store, 32, on=date(2027, 3, 5))
    _enrol(store, 32, on=date(2027, 3, 7))
    service = _service(store)
    then = next(r for r in (await service.grid(YEAR, as_of=date(2027, 3, 8))).rows if r.request_id == EMMA)
    now = next(r for r in (await service.grid(YEAR)).rows if r.request_id == EMMA)
    assert then.cancellation is not None
    assert now.cancellation is not None
    assert then.cancellation.on == now.cancellation.on == date(2027, 3, 7)


@pytest.mark.asyncio
async def test_a_past_row_never_shows_a_cancel_date_after_the_day() -> None:
    """An undated cancelled registration counts as cancelled by the day; one dated after it adds no date."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _appeal(store)
    _enrol(store, 32, on=None)
    _enrol(store, 32, on=date(2027, 3, 20))
    row = next(r for r in (await _service(store).grid(YEAR, as_of=date(2027, 3, 8))).rows if r.request_id == EMMA)
    assert row.cancellation is not None
    assert row.cancellation.by == "campminder"
    assert row.cancellation.on is None

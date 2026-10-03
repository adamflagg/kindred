"""A past date priced from the change log and the grant placement log (campership 3c-2). Fictional
only; figures as in decisions_fakes: Session 2 costs 2,000, so a tier-2 family (60,000) gets Round 1 =
1,500, and an outside grant of 500 on the request brings it to 1,000."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_APPLICATIONS, AID_GRANTS, AID_REQUESTS
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, _applications_as_of
from api.services.financial_aid_grant_placements import PlacementRecord, grant_key, placement_json
from api.services.financial_aid_grants_register import Placement, RegisterRow
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY, EquityAnswers
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import BUDGET_GAPS, GRID_GAPS, REMAINING_GAPS, DecisionEvent
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    log_seeded,
    log_update,
    seed_line,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA, LIAM = "reqemma00000001", "reqliam00000001"
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
MAR_9 = date(2027, 3, 9)


def _day(month: int, day: int) -> datetime:
    return datetime(2027, month, day, 18, 0, tzinfo=UTC)


def _service(store: FakeDecisionsStore, register: Sequence[RegisterRow] = ()) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    return FinancialAidDecisionsService(store, FakeRules(approved()), rows, clock=lambda: NOW)


def _two_families(*, equity: EquityAnswers | None = UNKNOWN_EQUITY) -> FakeDecisionsStore:
    """Emma (household 1000001) and Liam (1000002), both tier 2 in Session 2, logged on Feb 1 with the
    equity answers intake recorded (None: before intake recorded any)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    for request_id, request in store.requests.items():
        store.requests[request_id] = replace(request, equity=equity)
    log_seeded(store, SEEDED)
    return store


def _placed(store: FakeDecisionsStore, row: RegisterRow, at: datetime) -> None:
    """One grant placement logged at `at`, as live pricing logs it."""
    store.grant_placements.append(
        PlacementRecord(
            id=f"gpl{len(store.grant_placements):012d}",
            grant=grant_key(row),
            household_cm_id=row.household_cm_id,
            event="place",
            placement=placement_json(row),
            created=at,
        )
    )


def _row(out: Any, request_id: str) -> Any:
    return next(row for row in out.rows if row.request_id == request_id)


def _pool(out: Any, key: str) -> Any:
    return next(p for p in out.pools if p.pool == key)


def test_an_application_replays_to_the_instant_and_one_with_no_create_row_is_unreplayable() -> None:
    store = _two_families()
    app_id = store.requests[EMMA].application_id
    log_update(
        store,
        AID_APPLICATIONS,
        app_id,
        {"answers": {"total_gross_income": 60000.0}},
        {"answers": {"total_gross_income": 500.0}},
        _day(3, 20),
    )
    app_log = [r for r in store.change_log if r.entity == AID_APPLICATIONS]
    then, bad = _applications_as_of(app_log, _day(3, 9), store.applications)
    assert (then[app_id].answers["total_gross_income"], bad) == (60000.0, frozenset())
    later, _ = _applications_as_of(app_log, _day(3, 21), store.applications)
    assert later[app_id].answers["total_gross_income"] == 500.0
    missing, bad = _applications_as_of([r for r in app_log if r.entity_id != app_id], _day(3, 9), store.applications)
    assert (app_id in missing, bad) == (False, frozenset({app_id}))


@pytest.mark.asyncio
async def test_a_past_date_prices_the_answers_as_they_stood_then() -> None:
    """Review Focus 5: the family's income changed after the date; the date prices the income it had."""
    store = _two_families()
    app_id = store.requests[EMMA].application_id
    log_update(
        store,
        AID_APPLICATIONS,
        app_id,
        {"answers": {"total_gross_income": 60000.0, "expected_gross_income": 60000.0}},
        {"answers": {"total_gross_income": 500.0, "expected_gross_income": 500.0}},
        _day(3, 20),
    )
    service = _service(store)
    grid = await service.grid(YEAR, as_of=MAR_9)
    emma = _row(grid, EMMA)
    assert (emma.rounds[0].status, emma.rounds[0].decided, emma.tier) == ("needs_offer", 1500.0, 2)
    assert [g.figure for g in grid.not_rebuilt] == list(GRID_GAPS)
    budget = await service.budget(YEAR, as_of=MAR_9)
    camp = _pool(budget, "camp_pool")
    assert (camp.total.needs_offer, camp.total.remaining, budget.outside_grants_off_requests) == (3000.0, 397000.0, 0.0)
    assert [g.figure for g in budget.not_rebuilt] == list(BUDGET_GAPS)
    remaining = await service.remaining(YEAR, as_of=MAR_9)
    assert (remaining.total, [g.figure for g in remaining.not_rebuilt]) == (497000.0, list(REMAINING_GAPS))


@pytest.mark.asyncio
async def test_the_equity_answers_intake_had_recorded_by_then_price_the_date() -> None:
    store = _two_families()
    was = {"equity": {"bipoc": None, "gender_identity": "", "pronouns": ""}}
    now = {"equity": {"bipoc": True, "gender_identity": "", "pronouns": ""}}
    log_update(store, AID_REQUESTS, EMMA, was, now, _day(3, 20))
    store.requests[EMMA] = replace(
        store.requests[EMMA], equity=EquityAnswers(bipoc=True, gender_identity="", pronouns="")
    )
    service = _service(store)
    then = _row(await service.grid(YEAR, as_of=MAR_9), EMMA)
    later = _row(await service.grid(YEAR, as_of=date(2027, 3, 25)), EMMA)
    assert (then.tier, then.rounds[0].decided) == (2, 1500.0)
    assert (later.tier, later.rounds[0].decided) == (1, 1800.0)


@pytest.mark.asyncio
async def test_a_camper_with_no_recorded_equity_answers_then_is_named_and_only_that_pool_left_empty() -> None:
    store = _two_families(equity=None)
    service = _service(store)
    grid = await service.grid(YEAR, as_of=MAR_9)
    emma = _row(grid, EMMA)
    assert (emma.rounds[0].status, emma.rounds[0].ask, emma.tier, emma.notes) == ("not_rebuilt", 4000.0, None, None)
    gap = next(g for g in grid.not_rebuilt if g.figure == "equity_not_recorded")
    assert gap.requests == [EMMA, LIAM]
    remaining = await service.remaining(YEAR, as_of=MAR_9)
    assert [(p.pool, p.remaining) for p in remaining.pools] == [
        ("camp_pool", None),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert remaining.total is None
    assert [g.figure for g in remaining.not_rebuilt] == [*REMAINING_GAPS, "equity_not_recorded"]
    assert all(g.requests == [] for g in remaining.not_rebuilt)  # D75: never the requests on this line


@pytest.mark.asyncio
async def test_a_family_with_a_grant_whose_placement_was_not_logged_by_then_is_named_and_its_pool_left_empty() -> None:
    """Review Focus 5 and owner ruling 2026-09-30: exact per-request figures, only the pool totals the
    grant touches empty, never today's placement."""
    store = _two_families()
    line = replace(grant_row(EMMA, "500"), recorded_at=_day(3, 1))
    service = _service(store, register=[line])
    grid = await service.grid(YEAR, as_of=MAR_9)
    emma, liam = _row(grid, EMMA), _row(grid, LIAM)
    assert (emma.rounds[0].status, emma.rounds[0].decided, emma.tier, emma.cost) == ("not_rebuilt", None, 2, 2000.0)
    assert (liam.rounds[0].status, liam.rounds[0].decided) == ("needs_offer", 1500.0)
    gap = next(g for g in grid.not_rebuilt if g.figure == "grant_placement")
    assert gap.requests == [EMMA]
    budget = await service.budget(YEAR, as_of=MAR_9)
    camp, weekend = _pool(budget, "camp_pool"), _pool(budget, "weekend_pool")
    assert (camp.total.needs_offer, camp.total.remaining, camp.below.outside_grants) == (None, None, None)
    assert (weekend.total.remaining, budget.outside_grants_off_requests) == (75000.0, None)
    assert store.grant_placements == []  # a past read logs nothing


@pytest.mark.asyncio
async def test_a_grant_is_priced_where_the_log_had_it_then_not_where_it_sits_today() -> None:
    store = _two_families()
    on_emma = replace(grant_row(EMMA, "500"), recorded_at=_day(2, 10))
    on_liam = replace(grant_row(LIAM, "500"), recorded_at=_day(2, 10))
    _placed(store, on_emma, _day(3, 1))
    _placed(store, on_liam, _day(3, 20))  # moved after the date
    service = _service(store, register=[on_liam])
    grid = await service.grid(YEAR, as_of=MAR_9)
    assert (_row(grid, EMMA).rounds[0].decided, _row(grid, LIAM).rounds[0].decided) == (1000.0, 1500.0)
    assert [g.figure for g in grid.not_rebuilt] == list(GRID_GAPS)
    camp = _pool(await service.budget(YEAR, as_of=MAR_9), "camp_pool")
    assert (camp.total.needs_offer, camp.below.outside_grants) == (2500.0, 500.0)


@pytest.mark.asyncio
async def test_a_commitment_withdrawn_since_whose_placement_was_never_logged_names_its_family() -> None:
    store = _two_families()
    store.change_log.append(
        LogRow(
            id="log900000000001",
            entity=AID_GRANTS,
            entity_id="grt000000000001",
            before=None,
            after={"household_cm_id": 1000002, "person_cm_id": 1000021, "status": "open"},
            created=_day(3, 1),
        )
    )
    grid = await _service(store).grid(YEAR, as_of=MAR_9)
    gap = next(g for g in grid.not_rebuilt if g.figure == "grant_placement")
    assert gap.requests == [LIAM]


@pytest.mark.asyncio
async def test_on_the_campminder_axis_a_grant_line_reversed_by_the_day_counts_nowhere() -> None:
    """The line's reversal is CampMinder-dated March 5 but reached Kindred after the date."""
    store = _two_families()
    live = replace(grant_row(EMMA, "500"), recorded_at=_day(2, 10))
    _placed(store, live, _day(3, 1))
    reversed_ = replace(live, is_reversed=True, reversal_date="2027-03-05", counts=False, requests=())
    service = _service(store, register=[reversed_])
    default = _row(await service.grid(YEAR, as_of=MAR_9), EMMA)
    recorded = _row(await service.grid(YEAR, as_of=MAR_9, as_of_axis="recorded"), EMMA)
    assert (default.rounds[0].decided, recorded.rounds[0].decided) == (1500.0, 1000.0)


@pytest.mark.asyncio
async def test_a_request_whose_application_history_cannot_be_replayed_is_named() -> None:
    store = _two_families()
    app_id = store.requests[EMMA].application_id
    store.change_log = [r for r in store.change_log if r.entity_id != app_id]
    grid = await _service(store).grid(YEAR, as_of=MAR_9)
    gap = next(g for g in grid.not_rebuilt if g.figure == "application_history")
    assert (gap.requests, _row(grid, EMMA).rounds[0].status, _row(grid, LIAM).rounds[0].status) == (
        [EMMA],
        "not_rebuilt",
        "needs_offer",
    )


@pytest.mark.asyncio
async def test_today_or_later_is_still_the_live_read_and_logs_its_placement() -> None:
    store = _two_families()
    await _service(store, register=[grant_row(EMMA, "500")]).grid(YEAR, as_of=NOW.date() + timedelta(days=1))
    assert [p.grant for p in store.grant_placements] == ["ledger:9001"]


@pytest.mark.asyncio
async def test_remaining_stays_empty_in_every_pool_while_some_posted_money_cant_be_replayed() -> None:
    """SP10b-1 empties Posted everywhere when a posted request's payer shares can't be replayed, and
    Remaining subtracts Posted."""
    store = _two_families()
    store.shares.append(share_row(LIAM, 1000004, "0"))  # exists now, never logged
    store.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=LIAM,
            round=1,
            kind="post",
            created=_day(3, 5),
            amount=Decimal(1500),
            effective_on=date(2027, 3, 5),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    seed_line(store, 9001, "1500", household=1000002, person=1000021, posted=_day(3, 5))
    remaining = await _service(store).remaining(YEAR, as_of=MAR_9)
    assert [p.remaining for p in remaining.pools] == [None, None, None]
    assert remaining.total is None


@pytest.mark.asyncio
async def test_a_past_date_shows_the_ledger_note_live_showed_then() -> None:
    """D81's Note reads the ledger's dated lines, so a past date shows it exactly as live did then: CampMinder
    held 1,500 for Emma's family on March 5, and nothing was ticked."""
    store = _two_families()
    seed_line(store, 9001, "1500", posted=_day(3, 5))
    service = _service(store)
    live, past = _row(await service.grid(YEAR), EMMA), _row(await service.grid(YEAR, as_of=MAR_9), EMMA)
    note = "CampMinder shows $1,500 for this family; not yet marked posted"
    assert [n.message for n in past.notes or []] == [n.message for n in live.notes or []]
    assert note in [n.message for n in past.notes or []]
    before = _row(await service.grid(YEAR, as_of=date(2027, 3, 4)), EMMA)
    assert note not in [n.message for n in before.notes or []]


@pytest.mark.asyncio
async def test_a_request_deleted_since_empties_every_pool_and_the_total_and_is_named() -> None:
    """A request deleted after the date can't be priced then, so no pool's Needs an offer or Remaining may read
    as exact while leaving it out."""
    store = _two_families()
    del store.requests[LIAM]
    store.change_log = [r for r in store.change_log if r.entity_id != LIAM]
    log_update(store, AID_REQUESTS, LIAM, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create row
    store.change_log.append(
        LogRow(
            id="log900000000002",
            entity=AID_REQUESTS,
            entity_id=LIAM,
            before={"ask": 3500.0},
            after=None,
            created=_day(3, 25),
        )
    )
    service = _service(store)
    budget = await service.budget(YEAR, as_of=MAR_9)
    camp = _pool(budget, "camp_pool")
    assert (camp.total.needs_offer, camp.total.remaining, budget.total.total.remaining) == (None, None, None)
    remaining = await service.remaining(YEAR, as_of=MAR_9)
    assert [p.remaining for p in remaining.pools] == [None, None, None]
    assert remaining.total is None
    assert "request_deleted" in [g.figure for g in budget.not_rebuilt]


@pytest.mark.asyncio
async def test_a_cancelled_request_in_a_household_with_an_unlogged_grant_empties_its_pools_outside_grants() -> None:
    """Decision 19 counts a cancelled request's outside grants in its pool, so the unlogged grant must not
    read as 0 there."""
    store = _two_families()
    store.cancel_events.append(
        CancelEvent("can000000000002", EMMA, "cancel", _day(3, 2), reason="schedule", in_kindred=True)
    )
    line = replace(grant_row(EMMA, "500"), recorded_at=_day(3, 1))
    service = _service(store, register=[line])
    grid = await service.grid(YEAR, as_of=MAR_9)
    gap = next(g for g in grid.not_rebuilt if g.figure == "grant_placement")
    assert gap.requests == [EMMA]
    budget = await service.budget(YEAR, as_of=MAR_9)
    camp = _pool(budget, "camp_pool")
    assert (camp.below.outside_grants, camp.total.remaining) == (None, None)
    assert budget.outside_grants_off_requests is None


@pytest.mark.asyncio
async def test_a_row_whose_posted_money_is_unknown_loses_its_notes_and_the_gap_says_so() -> None:
    store = _two_families()
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged
    store.events.append(
        DecisionEvent(
            id="ev0000000000002",
            request_id=EMMA,
            round=1,
            kind="post",
            created=_day(3, 5),
            amount=Decimal(1500),
            effective_on=date(2027, 3, 5),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    seed_line(store, 9001, "1500", person=0, posted=_day(3, 5))
    grid = await _service(store).grid(YEAR, as_of=MAR_9)
    emma, liam = _row(grid, EMMA), _row(grid, LIAM)
    assert (emma.total_posted, emma.notes) == (None, None)
    assert liam.notes  # the ask-above-cost note stands where nothing is unknown
    gap = next(g for g in grid.not_rebuilt if g.figure == "posted")
    assert "Note" in gap.reason


@pytest.mark.asyncio
async def test_a_request_campminder_cancelled_after_the_date_is_priced_as_live_then() -> None:
    """Final review I1, re-reviewed: the spec changed (build lead, 2026-10-01). A cancelled registration's
    enrollment_date is CampMinder's date for its current status, so a request CampMinder cancelled after the
    date was live then and is priced exactly; nothing is masked."""
    store = _two_families()
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, date(2027, 3, 20)))
    service = _service(store)
    grid = await service.grid(YEAR, as_of=MAR_9)
    assert (_row(grid, EMMA).rounds[0].status, _row(grid, EMMA).rounds[0].decided) == ("needs_offer", 1500.0)
    assert next(g for g in grid.not_rebuilt if g.figure == "cancellation").requests == []
    camp = _pool(await service.budget(YEAR, as_of=MAR_9), "camp_pool")
    assert (camp.total.needs_offer, camp.total.remaining) == (3000.0, 397000.0)


async def _assert_emma_masked(store: FakeDecisionsStore) -> None:
    """Emma's registration reads cancelled by Mar 9: her row keeps 3c-1's figures, only her pool is left
    empty, and the gap names her and the case a past read can't see (its status changed since)."""
    service = _service(store)
    grid = await service.grid(YEAR, as_of=MAR_9)
    emma, liam = _row(grid, EMMA), _row(grid, LIAM)
    assert (emma.rounds[0].status, emma.rounds[0].ask, emma.rounds[0].decided, emma.total_decided) == (
        "not_rebuilt",
        4000.0,
        None,
        None,
    )
    assert (liam.rounds[0].status, liam.rounds[0].decided) == ("needs_offer", 1500.0)
    assert [g.figure for g in grid.not_rebuilt] == list(GRID_GAPS)
    gap = next(g for g in grid.not_rebuilt if g.figure == "cancellation")
    assert gap.requests == [EMMA]
    assert "re-enrolled" in gap.reason
    budget = await service.budget(YEAR, as_of=MAR_9)
    camp = _pool(budget, "camp_pool")
    assert (camp.total.needs_offer, camp.total.remaining, _pool(budget, "weekend_pool").total.remaining) == (
        None,
        None,
        75000.0,
    )
    assert next(g for g in budget.not_rebuilt if g.figure == "cancellation").requests == [EMMA]
    remaining = await service.remaining(YEAR, as_of=MAR_9)
    assert [(p.pool, p.remaining) for p in remaining.pools] == [
        ("camp_pool", None),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert [g.figure for g in remaining.not_rebuilt] == list(REMAINING_GAPS)
    assert all(g.requests == [] for g in remaining.not_rebuilt)  # D75


@pytest.mark.asyncio
async def test_a_request_campminder_cancelled_on_the_day_is_not_priced_as_live_then() -> None:
    store = _two_families()
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, MAR_9))
    await _assert_emma_masked(store)


@pytest.mark.asyncio
async def test_the_earliest_cancelled_registration_dates_the_cancellation() -> None:
    """Live on Mar 9 already saw the Mar 5 cancellation, so the later one doesn't move it past the date."""
    store = _two_families()
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, date(2027, 3, 5)))
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 256, date(2027, 3, 20)))
    await _assert_emma_masked(store)


@pytest.mark.asyncio
async def test_a_cancelled_registration_with_no_date_is_not_priced_as_live_then() -> None:
    store = _two_families()
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, None))
    await _assert_emma_masked(store)


@pytest.mark.asyncio
async def test_a_grant_whose_key_two_register_rows_share_is_named_and_its_pool_left_empty_then() -> None:
    """Final review I2: aid_postings' grain is (transaction, amount, year), so two register rows can share
    one log key. The log can't say which one it placed, so neither is placed then."""
    store = _two_families()
    line = replace(grant_row(EMMA, "500"), recorded_at=_day(2, 10))
    _placed(store, line, _day(3, 1))
    service = _service(store, register=[line, replace(line, amount=Decimal("250.00"))])
    grid = await service.grid(YEAR, as_of=MAR_9)
    gap = next(g for g in grid.not_rebuilt if g.figure == "grant_placement")
    assert gap.requests == [EMMA]
    assert (_row(grid, EMMA).rounds[0].status, _row(grid, LIAM).rounds[0].decided) == ("not_rebuilt", 1500.0)


@pytest.mark.asyncio
async def test_a_gap_request_with_no_pool_leaves_the_other_pools_priced() -> None:
    """Final review M1: the budget puts a request with no pool in No pool, so only No pool (and the total)
    is left empty, not every pool."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000999)  # a session no program covers; no equity recorded either
    seed_request(store, LIAM, household=1000002, person=1000021)
    store.requests[LIAM] = replace(store.requests[LIAM], equity=UNKNOWN_EQUITY)
    log_seeded(store, SEEDED)
    remaining = await _service(store).remaining(YEAR, as_of=MAR_9)
    assert [(p.pool, p.remaining) for p in remaining.pools] == [
        ("camp_pool", 398500.0),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert remaining.total is None


@pytest.mark.asyncio
async def test_a_split_row_whose_posted_money_is_unknown_hides_each_payers_posted_and_needs_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.requests[EMMA] = replace(store.requests[EMMA], equity=UNKNOWN_EQUITY)
    store.shares = [share_row(EMMA, 1000001, "50"), share_row(EMMA, 1000002, "50")]
    log_seeded(store, SEEDED)
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged
    store.events.append(
        DecisionEvent(
            id="ev0000000000002",
            request_id=EMMA,
            round=1,
            kind="post",
            created=_day(3, 5),
            amount=Decimal(1500),
            effective_on=date(2027, 3, 5),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    seed_line(store, 9001, "1500", person=0, posted=_day(3, 5))
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
    assert row.total_posted is None
    assert row.payer_count == 2
    assert [(s.posted, s.needs_offer) for s in row.payer_shares] == [(None, None), (None, None)]
    assert [s.decided for s in row.payer_shares] == [750.0, 750.0]

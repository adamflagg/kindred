"""The CampMinder ledger in the decisions reads (Task 5) and the automatic tick (Task 6), campership
sub-project 10b (spec §5.1, §5.3; D54, D59, D78, D81). Fictional only; every write runs the real 4a
helper over a fake batch. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500, and
the Camp pool's Round 1 is allocated 340,000 of a 500,000 budget (see decisions_fakes)."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.constants.collections import AID_PAYER_SHARES
from api.schemas.financial_aid_decisions import GridRowOut, PostedIn, PostedRow, UnpostIn
from api.services.financial_aid_decisions_repository import (
    FinancialAidDecisionsRepository,
    camp_line,
    line_placement,
)
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import Placement, RegisterRow
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_delete,
    log_seeded,
    log_update,
    seed_line,
    seed_override,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _posted, _service

APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
NIGHT_AFTER = T0 + timedelta(hours=16)  # the ledger sync after the Mar 9 tick
NOTE = "in_campminder_not_ticked"


async def _row(store: FakeDecisionsStore, request_id: str = EMMA) -> GridRowOut:
    rows = (await _service(store).grid(YEAR)).rows
    return next(r for r in rows if r.request_id == request_id)


def _notes(row: GridRowOut) -> list[str]:
    return [n.message for n in row.notes or [] if n.code == NOTE]


# --- the repository ---------------------------------------------------------------------------------


def test_a_camp_aid_record_becomes_a_line_in_aid_dollars() -> None:
    record = SimpleNamespace(
        transaction_cm_id=9001,
        household_cm_id=1000001,
        person_cm_id=1000011,
        amount=-1800,
        post_date="2027-03-09 17:00:00.000Z",
        is_reversed=True,
        reversal_date="2027-06-01 17:00:00.000Z",
        attributed_person_cm_id=1000011,
        attributed_session_cm_id=1000101,
        program_family="summer",
    )
    line = camp_line(record)
    assert (line.amount, line.post_date, line.reversal_date, line.is_reversed) == (
        Decimal(1800),
        datetime(2027, 3, 9, 17, 0, tzinfo=UTC),
        datetime(2027, 6, 1, 17, 0, tzinfo=UTC),
        True,
    )
    assert camp_line(SimpleNamespace(**{**vars(record), "reversal_date": ""})).reversal_date is None


def test_only_an_override_naming_a_person_or_a_session_places_a_line() -> None:
    reclassify = SimpleNamespace(
        transaction_cm_id=9001, attributed_person_cm_id=0, attributed_session_cm_id=0, program_family=""
    )
    assert line_placement(reclassify) is None
    staff = SimpleNamespace(
        transaction_cm_id=9001, attributed_person_cm_id=1000012, attributed_session_cm_id=0, program_family="summer"
    )
    assert line_placement(staff) == Placement(9001, 1000012, 0, "summer")


@pytest.mark.asyncio
async def test_camp_aid_lines_are_read_live_and_reversed_by_their_funder_type() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidDecisionsRepository(pb).fetch_camp_lines(YEAR)
    pb.collection.assert_called_with("aid_postings")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["filter"] == f"year = {YEAR} && funder_type = 'camp'"
    assert query["sort"] == "transaction_cm_id,id"
    assert set(query["fields"].split(",")) == {
        "transaction_cm_id",
        "household_cm_id",
        "person_cm_id",
        "amount",
        "post_date",
        "is_reversed",
        "reversal_date",
        "attributed_person_cm_id",
        "attributed_session_cm_id",
        "program_family",
    }


def _run(trigger: str, year: int, ended: str) -> SimpleNamespace:
    return SimpleNamespace(trigger=trigger, year=year, ended=ended)


async def _last_sync(runs: list[SimpleNamespace], season: int = YEAR) -> tuple[datetime | None, MagicMock]:
    pb = MagicMock()
    pb.collection.return_value.get_list.return_value = SimpleNamespace(items=runs)
    return await FinancialAidDecisionsRepository(pb).fetch_last_ledger_sync(season), pb


@pytest.mark.asyncio
async def test_the_last_ledger_sync_reads_the_seasons_window_of_successful_aid_postings_runs() -> None:
    found, pb = await _last_sync([_run("daily", YEAR, "2027-03-10 09:00:00.000Z")])
    assert found == datetime(2027, 3, 10, 9, 0, tzinfo=UTC)
    pb.collection.assert_called_with("sync_runs")
    call = pb.collection.return_value.get_list.call_args
    assert call.args[:2] == (1, 100)
    query = call.kwargs["query_params"]
    assert query["filter"] == (
        f'service = "aid_postings" && status = "success" && year >= {YEAR - 1} && year <= {YEAR + 1}'
    )
    assert query["sort"] == "-started,-id"
    assert set(query["fields"].split(",")) == {"ended", "trigger", "year"}
    assert (await _last_sync([]))[0] is None


@pytest.mark.asyncio
async def test_a_scheduled_run_recorded_as_season_n_counts_for_season_n_plus_1() -> None:
    """Go records the nightly window run (seasons N-1..N+1) with year = the configured season N."""
    found, _ = await _last_sync([_run("daily", YEAR, "2027-03-10 09:00:00.000Z")], season=YEAR + 1)
    assert found == datetime(2027, 3, 10, 9, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_a_manual_run_recorded_as_the_prior_season_does_not_count() -> None:
    older = _run("daily", YEAR, "2027-03-09 09:00:00.000Z")
    newest_manual = _run("manual", YEAR - 1, "2027-03-11 09:00:00.000Z")
    found, _ = await _last_sync([newest_manual, older])
    assert found == datetime(2027, 3, 9, 9, 0, tzinfo=UTC)  # the manual run is skipped, the scheduled one counts
    assert (await _last_sync([newest_manual]))[0] is None


@pytest.mark.asyncio
async def test_a_manual_run_recorded_as_the_season_counts_for_it() -> None:
    found, _ = await _last_sync([_run("manual", YEAR, "2027-03-11 09:00:00.000Z")])
    assert found == datetime(2027, 3, 11, 9, 0, tzinfo=UTC)


# --- the reads (Task 5) -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_tick_awaits_tonights_sync_then_the_ledger_confirms_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    before = await _row(store)
    assert before.confirmation is not None
    assert before.confirmation.status == "awaiting_sync"
    assert before.rounds[0].lock_source == "tick"
    store.synced_at = NIGHT_AFTER
    after = await _row(store)
    assert after.confirmation is not None
    assert (after.confirmation.status, after.confirmation.on, after.confirmation.reconciled) == (
        "confirmed",
        date(2027, 3, 9),
        True,
    )


@pytest.mark.asyncio
async def test_campminder_short_of_the_lock_reads_short_and_not_reconciled() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1300", posted=T0)
    store.synced_at = NIGHT_AFTER
    c = (await _row(store)).confirmation
    assert c is not None
    assert (c.status, c.locked, c.in_campminder, c.gap, c.reconciled) == ("short", 1500.0, 1300.0, -200.0, False)


@pytest.mark.asyncio
async def test_a_request_with_nothing_posted_has_no_confirmation() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    assert (await _row(store)).confirmation is None


@pytest.mark.asyncio
async def test_a_reversal_returns_the_money_to_remaining_and_reads_reversed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    store.synced_at = JUN1 + timedelta(hours=12)
    service = _service(store)
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.posted, r1.needs_offer, r1.remaining) == (0.0, 0.0, 340000.0)
    assert (await service.remaining(YEAR)).total == 500000.0
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.on) == ("reversed", date(2027, 6, 1))
    assert (row.total_posted, row.rounds[0].clawed_back, row.rounds[0].posted) == (None, True, 1500.0)


@pytest.mark.asyncio
async def test_an_appeals_reverse_and_repost_keeps_the_money_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=APR1)
    seed_line(store, 9002, "1500", posted=APR1)
    store.synced_at = APR1 + timedelta(hours=12)
    camp = next(p for p in (await _service(store).budget(YEAR)).pools if p.pool == "camp_pool")
    assert next(c for c in camp.rounds if c.round == 1).posted == 1500.0
    c = (await _row(store)).confirmation
    assert c is not None
    assert (c.status, c.on) == ("confirmed", date(2027, 4, 1))


@pytest.mark.asyncio
async def test_each_payer_share_confirms_against_its_own_household() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "600", household=1000004)  # the other home's share, naming Emma
    store.synced_at = NIGHT_AFTER
    c = (await _row(store)).confirmation
    assert c is not None
    assert (c.status, c.in_campminder) == ("short", 600.0)
    assert [(s.household_cm_id, s.expected, s.status) for s in c.shares] == [
        (1000001, 900.0, "not_in_campminder"),
        (1000004, 600.0, "confirmed"),
    ]


@pytest.mark.asyncio
async def test_a_family_level_line_notes_both_requests() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "3000", person=0)
    rows = (await _service(store).grid(YEAR)).rows
    assert [_notes(r) for r in rows] == [["CampMinder shows $3,000 for this family; not yet ticked"]] * 2
    assert all(r.confirmation is None for r in rows)


@pytest.mark.asyncio
async def test_money_on_a_held_request_raises_the_note() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_line(store, 9001, "1500")
    assert _notes(await _row(store)) == ["CampMinder shows $1,500 for this family; not yet ticked"]


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_there_is_no_confirmation_and_no_note(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SP10b Decision 9: a season before ticks began shows neither (here 2027 plays that season)."""
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1300", posted=T0)
    seed_request(store, LIAM, household=1000002, person=1000021, session=0, status="unmatched_session")
    seed_line(store, 9002, "1500", household=1000002, person=1000021)
    store.synced_at = NIGHT_AFTER
    rows = (await _service(store).grid(YEAR)).rows
    assert [r.confirmation for r in rows] == [None, None]
    assert [_notes(r) for r in rows] == [[], []]


@pytest.mark.asyncio
async def test_a_past_date_before_the_reversal_still_counts_the_posted_money() -> None:
    """3c's as-of reads (named dependency): Posted on a past date subtracts only what was reversed by then."""
    if not hasattr(FinancialAidDecisionsService, "past_season"):
        pytest.skip("3c (the as-of reads) is not on this branch")
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, datetime(2027, 2, 1, 18, 0, tzinfo=UTC))  # the shares are logged, so they replay
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)

    async def no_grants(year: int) -> list[RegisterRow]:
        return []

    july = datetime(2027, 7, 1, 18, 0, tzinfo=UTC)  # 3c reads any date from today on as live
    service = FinancialAidDecisionsService(store, FakeRules(approved()), no_grants, clock=lambda: july)
    for day, posted in ((date(2027, 5, 1), 1500.0), (date(2027, 6, 2), 0.0)):
        budget = await service.budget(YEAR, as_of=day)
        camp = next(p for p in budget.pools if p.pool == "camp_pool")
        assert next(c for c in camp.rounds if c.round == 1).posted == posted, day


# --- the season's own sync (fix round 1, Important 2) -----------------------------------------------


@pytest.mark.asyncio
async def test_the_season_read_asks_for_its_own_seasons_ledger_sync() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    asked: list[int] = []
    fetch = store.fetch_last_ledger_sync

    async def spy(year: int) -> datetime | None:
        asked.append(year)
        return await fetch(year)

    store.fetch_last_ledger_sync = spy  # type: ignore[method-assign]
    await _row(store)
    assert asked == [YEAR]


# --- the past read is exact or empty (fix round 1, Important 1) ------------------------------------

SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
JUL1 = datetime(2027, 7, 1, 18, 0, tzinfo=UTC)


def _past_service(store: FakeDecisionsStore) -> FinancialAidDecisionsService:
    async def no_grants(year: int) -> list[RegisterRow]:
        return []

    return FinancialAidDecisionsService(store, FakeRules(approved()), no_grants, clock=lambda: JUL1)


async def _r1_posted(store: FakeDecisionsStore, day: date) -> float | None:
    budget = await _past_service(store).budget(YEAR, as_of=day)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    return next(c for c in camp.rounds if c.round == 1).posted


def _emma_posted(store: FakeDecisionsStore) -> None:
    seed_request(store, EMMA)
    log_seeded(store, SEEDED)
    _posted(store, EMMA, 1, "1500")


@pytest.mark.asyncio
async def test_case_a_family_level_money_reposted_after_the_date_does_not_hold_the_clawback() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=datetime(2027, 6, 15, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 5)) == 0.0
    assert await _r1_posted(store, date(2027, 6, 20)) == 1500.0  # by then the family-level repost is live


@pytest.mark.asyncio
async def test_case_b_family_level_money_live_on_the_date_holds_the_clawback() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=T0, reversed_at=datetime(2027, 6, 3, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 2)) == 1500.0
    assert await _r1_posted(store, date(2027, 6, 4)) == 0.0


@pytest.mark.asyncio
async def test_payer_shares_are_replayed_to_the_date_not_read_as_they_are_now() -> None:
    """A co-payer's family-level money holds the clawback while that household held a share; the share
    was deleted on Jun 10, so today's shares would wrongly release it on Jun 5."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    log_seeded(store, SEEDED)
    key = f"{EMMA}:1000004"
    body = {
        "year": YEAR,
        "request": EMMA,
        "household_cm_id": 1000004,
        "share_pct": "40",
        "source": "staff",
        "actor": "registrar@example.com",
        "note": "",
    }
    day10 = datetime(2027, 6, 10, 18, 0, tzinfo=UTC)
    log_update(store, AID_PAYER_SHARES, f"{EMMA}:1000001", {"share_pct": "60"}, {"share_pct": "100"}, day10)
    log_delete(store, AID_PAYER_SHARES, key, body, day10)
    store.shares = [share_row(EMMA, 1000001, "100")]
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "500", household=1000004, person=0, posted=datetime(2027, 3, 20, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 5)) == 1500.0
    assert await _r1_posted(store, date(2027, 6, 12)) == 0.0


@pytest.mark.asyncio
async def test_a_placement_made_after_the_date_does_not_place_the_line_on_it() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", person=0, posted=T0, reversed_at=JUN1)  # the household's: placed by staff later
    seed_override(store, 9001, 1000011, datetime(2027, 6, 10, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 5)) == 1500.0
    assert await _r1_posted(store, date(2027, 6, 12)) == 0.0


@pytest.mark.asyncio
async def test_shares_that_cannot_be_replayed_leave_that_requests_posted_money_empty() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    log_seeded(store, SEEDED)
    store.shares.append(share_row(EMMA, 1000004, "0"))  # exists now, never logged
    _posted(store, EMMA, 1, "1500")
    _posted(store, LIAM, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    service = _past_service(store)
    grid = await service.grid(YEAR, as_of=date(2027, 6, 5))
    rows = {r.request_id: r for r in grid.rows}
    assert (rows[EMMA].total_posted, rows[EMMA].rounds[0].posted) == (None, None)
    assert rows[LIAM].total_posted == 1500.0
    gap = next(g for g in grid.not_rebuilt if g.figure == "payer_shares_history")
    assert gap.requests == [EMMA]
    assert "today" in gap.reason  # names the undated reclassification and attribution
    budget = await service.budget(YEAR, as_of=date(2027, 6, 5))
    assert budget.total.total.posted is None
    assert budget.total.total.accepted is None
    assert "payer_shares_history" in [g.figure for g in budget.not_rebuilt]


@pytest.mark.asyncio
async def test_placements_that_cannot_be_replayed_are_named_and_empty_only_their_households() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    log_seeded(store, SEEDED)
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged
    _posted(store, EMMA, 1, "1500")
    _posted(store, LIAM, 1, "1500")
    seed_line(store, 9001, "1500", person=0, posted=T0)
    grid = await _past_service(store).grid(YEAR, as_of=date(2027, 6, 5))
    rows = {r.request_id: r for r in grid.rows}
    assert (rows[EMMA].total_posted, rows[LIAM].total_posted) == (None, 1500.0)
    gap = next(g for g in grid.not_rebuilt if g.figure == "line_placements_history")
    assert gap.requests == [EMMA]
    assert "today" in gap.reason


@pytest.mark.asyncio
async def test_a_past_read_with_no_ledger_lines_names_no_ledger_gap() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    grid = await _past_service(store).grid(YEAR, as_of=date(2027, 6, 5))
    assert {"payer_shares_history", "line_placements_history"}.isdisjoint(g.figure for g in grid.not_rebuilt)


# --- service-level ledger paths (fix round 1) -------------------------------------------------------


@pytest.mark.asyncio
async def test_a_withdrawn_requests_posted_money_is_clawed_back_through_its_closed_lines() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    store.synced_at = JUN1 + timedelta(hours=12)
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.on) == ("reversed", date(2027, 6, 1))
    assert (row.total_posted, row.rounds[0].clawed_back) == (None, True)


@pytest.mark.asyncio
async def test_live_family_level_money_on_a_d26_household_blocks_the_clawback() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=JUN1)  # reposted on the household: may be the appeal
    store.synced_at = JUN1 + timedelta(hours=12)
    row = await _row(store)
    assert (row.total_posted, row.rounds[0].clawed_back) == (1500.0, False)
    assert row.confirmation is not None
    assert row.confirmation.status != "reversed"
    assert row.confirmation.family_unplaced == 1500.0


@pytest.mark.asyncio
async def test_a_payer_share_households_family_level_money_blocks_the_clawback() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "600", household=1000004, person=0, posted=JUN1)
    store.synced_at = JUN1 + timedelta(hours=12)
    row = await _row(store)
    assert (row.total_posted, row.rounds[0].clawed_back) == (1500.0, False)


@pytest.mark.asyncio
async def test_a_bad_placements_line_person_and_a_bad_shares_household_empty_the_requests_they_reach() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_request(store, "reqava000000001", household=1000003, person=1000031)
    store.shares.append(share_row(LIAM, 1000004, "0"))  # Liam's request also has a co-payer household
    log_seeded(store, SEEDED)
    store.shares.append(share_row(EMMA, 1000004, "0"))  # exists now, never logged
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged
    for rid in (EMMA, LIAM, "reqava000000001"):
        _posted(store, rid, 1, "1500")
    # the unreplayable placement's line belongs to another home, posted to Ava's camper
    seed_line(store, 9001, "1500", household=1000009, person=1000031, posted=T0)
    grid = await _past_service(store).grid(YEAR, as_of=date(2027, 6, 5))
    rows = {r.request_id: r for r in grid.rows}
    assert rows["reqava000000001"].total_posted is None  # the line's own person
    shares_gap = next(g for g in grid.not_rebuilt if g.figure == "payer_shares_history")
    assert shares_gap.requests == [EMMA, LIAM]  # Liam holds a share of the same unreplayable household
    assert rows[LIAM].total_posted is None


@pytest.mark.asyncio
async def test_emptied_budget_figures_are_named_only_when_they_are_emptied() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0)
    clean = await _past_service(store).budget(YEAR, as_of=date(2027, 6, 5))
    assert {"posted", "accepted", "outside_budget_posted"}.isdisjoint(g.figure for g in clean.not_rebuilt)
    store.shares.append(share_row(EMMA, 1000004, "0"))  # exists now, never logged
    emptied = await _past_service(store).budget(YEAR, as_of=date(2027, 6, 5))
    named = {g.figure: g.reason for g in emptied.not_rebuilt}
    for figure in ("posted", "accepted", "outside_budget_posted"):
        assert "history" in named[figure], figure
    assert emptied.total.below.outside_budget_posted is None
    assert all(row.posted is None and row.accepted is None for row in emptied.strip)


@pytest.mark.asyncio
async def test_a_clean_past_read_with_ledger_lines_names_that_classification_is_todays() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0)
    for read in (
        (await _past_service(store).grid(YEAR, as_of=date(2027, 6, 5))).not_rebuilt,
        (await _past_service(store).budget(YEAR, as_of=date(2027, 6, 5))).not_rebuilt,
    ):
        gap = next(g for g in read if g.figure == "ledger_classification")
        assert "today" in gap.reason
    empty = FakeDecisionsStore()
    _emma_posted(empty)
    grid = await _past_service(empty).grid(YEAR, as_of=date(2027, 6, 5))
    assert "ledger_classification" not in [g.figure for g in grid.not_rebuilt]


@pytest.mark.asyncio
async def test_each_current_read_completes_before_its_change_log_read_starts() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0)
    order: list[str] = []
    fetch_shares, fetch_overrides, fetch_log = (
        store.fetch_payer_shares,
        store.fetch_line_overrides,
        store.fetch_change_log,
    )

    async def slow(name: str, fetch: Any, *args: Any) -> Any:
        order.append(f"{name}-start")
        for _ in range(5):
            await asyncio.sleep(0)  # a slow read: a concurrent log read would start meanwhile
        found = await fetch(*args)
        order.append(f"{name}-done")
        return found

    async def shares(*args: Any, **kwargs: Any) -> Any:
        return await slow("shares", fetch_shares, *args)

    async def overrides(*args: Any, **kwargs: Any) -> Any:
        return await slow("overrides", fetch_overrides, *args)

    async def log(year: int, entity: str) -> Any:
        if entity in ("aid_payer_shares", "aid_attribution_overrides"):
            order.append(f"log-{entity}")
        return await fetch_log(year, entity)

    store.fetch_payer_shares = shares  # type: ignore[method-assign]
    store.fetch_line_overrides = overrides  # type: ignore[method-assign]
    store.fetch_change_log = log  # type: ignore[method-assign]
    await _past_service(store).grid(YEAR, as_of=date(2027, 6, 5))
    assert order.index("shares-done") < order.index("log-aid_payer_shares")
    assert order.index("overrides-done") < order.index("log-aid_attribution_overrides")


# --- the automatic tick (Task 6) ---------------------------------------------------------------------

MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)
R1_SECTIONS = ("award_tables", "awards", "cost", "equity", "grants", "income", "programs", "tiers")


@pytest.mark.asyncio
async def test_the_ledger_ticks_what_the_registrar_forgot_at_the_decided_amount_as_one_logged_operation() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1400", posted=MAR8)  # a typo: the offer was 1,500
    rules = FakeRules(approved())
    out = await _service(store, rules).ledger_ticks(YEAR)
    assert (out.ticked, out.total_locked, out.sections_not_locked, out.skipped) == (1, 1500.0, [], "")
    post = store.events[-1]
    assert (post.kind, post.round, post.amount, post.lock_source, post.effective_on) == (
        "post",
        1,
        Decimal(1500),
        "ledger",
        date(2027, 3, 8),
    )
    assert post.note == "Ticked by the ledger sync: CampMinder shows $1,400 on this request"
    assert post.snapshot is not None
    assert post.snapshot["pool"] == "camp_pool"
    assert {row["actor"] for row in store.log} == {"system:ledger"}
    assert len(store.operations) == 1
    assert len({row["operation_id"] for row in store.log}) == 1
    assert rules.lock_calls == [(YEAR, 1, R1_SECTIONS)]
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.gap) == ("short", -100.0)
    assert row.rounds[0].lock_source == "ledger"
    # The sync re-runs the same night: nothing new is beyond the lock, so nothing is written.
    again = await _service(store, rules).ledger_ticks(YEAR)
    assert (again.ticked, again.operation_id) == (0, "")
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_a_family_level_line_never_ticks() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "3000", person=0)
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 0
    assert store.operations == []


@pytest.mark.asyncio
async def test_the_ledger_never_ticks_a_held_request() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_line(store, 9001, "1500")
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 0
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_payer_shares_posting_ticks_the_whole_round() -> None:
    """D81: the first share's posting ticks the round and locks its full decided amount; the other
    share reads "not in CampMinder" until its household posts."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    seed_line(store, 9001, "600", household=1000004)
    out = await _service(store).ledger_ticks(YEAR)
    assert (out.ticked, out.total_locked) == (1, 1500.0)
    c = (await _row(store)).confirmation
    assert c is not None
    assert [(s.household_cm_id, s.status) for s in c.shares] == [
        (1000001, "not_in_campminder"),
        (1000004, "confirmed"),
    ]


@pytest.mark.asyncio
async def test_a_round_a_person_unticked_is_left_for_a_person() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    assert (await service.ledger_ticks(YEAR)).ticked == 1
    await service.undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="Ticked the wrong family"), ACTOR)
    assert (await service.ledger_ticks(YEAR)).ticked == 0
    row = await _row(store)
    assert row.rounds[0].status == "needs_offer"
    assert _notes(row) == ["CampMinder shows $1,500 for this family; not yet ticked"]


@pytest.mark.asyncio
async def test_the_registrars_own_tick_still_locks_as_before() -> None:
    """The row builder is now shared: a person's tick writes lock_source "tick" and no note."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    body = PostedIn(rows=[PostedRow(request_id=EMMA, round=1, amount=Decimal(1500))])
    await _service(store).tick_posted(YEAR, body, ACTOR)
    post = store.events[-1]
    assert (post.lock_source, post.note, post.effective_on) == ("tick", "", date(2027, 3, 9))


@pytest.mark.asyncio
async def test_a_season_before_ticks_began_is_never_ticked() -> None:
    store = FakeDecisionsStore()
    out = await _service(store).ledger_ticks(2026)
    assert (out.ticked, out.skipped) == (0, "2026 predates Posted ticks (the first ticked season is 2027)")
    assert store.operations == []


@pytest.mark.asyncio
async def test_with_no_approved_rules_the_ledger_ticks_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    out = await _service(store, FakeRules(None)).ledger_ticks(YEAR)
    assert (out.ticked, out.skipped) == (0, "2027's pricing rules are not approved yet")
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_failed_write_is_a_refusal_the_caller_can_map_not_a_bare_error() -> None:
    from api.services.financial_aid_decisions_service import DecisionRefusedError
    from bunking.pocketbase_batch import BatchTransportError

    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")

    async def boom(*args: Any, **kwargs: Any) -> None:
        raise BatchTransportError("connection dropped")

    store.commit = boom  # type: ignore[method-assign,assignment]
    with pytest.raises(DecisionRefusedError, match="could not be written"):
        await _service(store).ledger_ticks(YEAR)

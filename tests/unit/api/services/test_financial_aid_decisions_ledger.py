"""The CampMinder ledger in the decisions reads (Task 5) and the automatic tick (Task 6), campership
sub-project 10b (spec §5.1, §5.3; D54, D59, D78, D81). Fictional only; every write runs the real 4a
helper over a fake batch. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500, and
the Camp pool's Round 1 is allocated 340,000 of a 500,000 budget (see decisions_fakes)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.constants.collections import AID_PAYER_SHARES
from api.schemas.financial_aid_decisions import AsOfAxis, GridRowOut, PostedIn, PostedRow, UnpostIn
from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_decisions_repository import (
    FinancialAidDecisionsRepository,
    camp_line,
    line_placement,
)
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import Placement, RegisterRow
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY
from api.services.financial_aid_reconciliation import confirmation
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
from tests.unit.api.services.test_financial_aid_reconciliation import POSTED_R1, R1

APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
NIGHT_AFTER = T0 + timedelta(hours=16)  # the ledger sync after the Mar 9 tick
NOTE = "in_campminder_not_ticked"


def _cancelled(store: FakeDecisionsStore, request_id: str = EMMA) -> None:
    """Cancel the request in Kindred: D54's clawback applies only to a cancelled or closed request (owner ruling,
    option B), so the clawback mechanics these tests pin are read on a cancelled one."""
    store.cancel_events.append(
        CancelEvent("can000000000001", request_id, "cancel", T0, reason="not_known", in_kindred=True, actor=ACTOR)
    )


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
        effective_source_key="camp fa",
    )
    line = camp_line(record)
    assert line.description_key == "camp fa"  # the source classification the line joins to (Development's rebuilt ages)
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
        "effective_source_key",
    }


def _run(trigger: str, year: int, started: str) -> SimpleNamespace:
    return SimpleNamespace(trigger=trigger, year=year, started=started)


async def _last_sync(
    runs: list[SimpleNamespace],
    season: int = YEAR,
    transactions: list[SimpleNamespace] | None = None,
) -> tuple[datetime | None, MagicMock]:
    """`runs` are the aid_postings runs; the transactions sync's runs are the same unless given."""
    by_service = {"aid_postings": runs, "financial_transactions": runs if transactions is None else transactions}

    def get_list(page: int, per_page: int, query_params: dict[str, Any]) -> SimpleNamespace:
        service = query_params["filter"].split('"')[1]
        return SimpleNamespace(items=by_service[service])

    pb = MagicMock()
    pb.collection.return_value.get_list.side_effect = get_list
    return await FinancialAidDecisionsRepository(pb).fetch_last_ledger_sync(season), pb


@pytest.mark.asyncio
async def test_the_last_ledger_sync_reads_the_seasons_window_of_successful_runs_of_both_syncs() -> None:
    found, pb = await _last_sync([_run("daily", YEAR, "2027-03-10 09:00:00.000Z")])
    assert found == datetime(2027, 3, 10, 9, 0, tzinfo=UTC)
    pb.collection.assert_called_with("sync_runs")
    calls = pb.collection.return_value.get_list.call_args_list
    assert sorted(c.kwargs["query_params"]["filter"] for c in calls) == sorted(
        f'service = "{service}" && status = "success" && year >= {YEAR - 1} && year <= {YEAR + 1}'
        for service in ("aid_postings", "financial_transactions")
    )
    for call in calls:
        assert call.args[:2] == (1, 100)
        assert call.kwargs["query_params"]["sort"] == "-started,-id"
        assert set(call.kwargs["query_params"]["fields"].split(",")) == {"started", "trigger", "year"}
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


@pytest.mark.asyncio
async def test_a_failed_transactions_sync_keeps_a_tick_awaiting_though_the_ledger_rebuilt() -> None:
    """F2: aid_postings rebuilds from the financial_transactions mirror, so after a failed transactions
    run it rebuilt from stale rows. The sync time is the older of the two starts, so a tick made after
    the last good transactions run still awaits rather than reading "not in CampMinder"."""
    ledger_run = [_run("daily", YEAR, "2027-03-10 10:10:00.000Z")]
    last_good_transactions = [_run("daily", YEAR, "2027-03-08 10:00:00.000Z")]  # Mar 9's run failed
    synced, _ = await _last_sync(ledger_run, transactions=last_good_transactions)
    assert synced == datetime(2027, 3, 8, 10, 0, tzinfo=UTC)
    tick = replace(POSTED_R1[1], locked_at=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    c = confirmation(R1, {1: tick}, [], (), 1000001, synced_at=synced)
    assert c is not None
    assert c.status == "awaiting_sync"
    assert (await _last_sync(ledger_run, transactions=[]))[0] is None  # no transactions run at all: awaiting


@pytest.mark.asyncio
async def test_both_syncs_succeeding_after_the_tick_end_the_wait() -> None:
    ledger_run = [_run("daily", YEAR, "2027-03-10 10:10:00.000Z")]
    transactions = [_run("daily", YEAR, "2027-03-10 10:00:00.000Z")]
    synced, _ = await _last_sync(ledger_run, transactions=transactions)
    assert synced == datetime(2027, 3, 10, 10, 0, tzinfo=UTC)
    tick = replace(POSTED_R1[1], locked_at=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    c = confirmation(R1, {1: tick}, [], (), 1000001, synced_at=synced)
    assert c is not None
    assert c.status == "not_in_campminder"  # the wait is over: the ledger read it and found nothing


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
    _cancelled(store)
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
    assert [_notes(r) for r in rows] == [["CampMinder shows $3,000 for this family; not yet marked posted"]] * 2
    assert all(r.confirmation is None for r in rows)


@pytest.mark.asyncio
async def test_money_on_a_held_request_raises_the_note() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_line(store, 9001, "1500")
    assert _notes(await _row(store)) == ["CampMinder shows $1,500 for this family; not yet marked posted"]


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
    _cancelled(store)
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


async def _r1_posted(store: FakeDecisionsStore, day: date, axis: AsOfAxis = "campminder") -> float | None:
    budget = await _past_service(store).budget(YEAR, as_of=day, as_of_axis=axis)
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
    _cancelled(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=datetime(2027, 6, 15, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 5)) == 0.0
    assert await _r1_posted(store, date(2027, 6, 20)) == 1500.0  # by then the family-level repost is live


@pytest.mark.asyncio
async def test_case_b_family_level_money_live_on_the_date_holds_the_clawback() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    _cancelled(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    # Posted on the reversal's day, so it may be the repost (final review: only money posted on or after
    # the reversal blocks); itself reversed Jun 3.
    seed_line(store, 9002, "1500", person=0, posted=JUN1, reversed_at=datetime(2027, 6, 3, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 2)) == 1500.0
    assert await _r1_posted(store, date(2027, 6, 4)) == 0.0


@pytest.mark.asyncio
async def test_payer_shares_are_replayed_to_the_date_not_read_as_they_are_now() -> None:
    """A co-payer's family-level money holds the clawback while that household held a share; the share
    was deleted on Jun 10, so today's shares would wrongly release it on Jun 5."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _cancelled(store)
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
    seed_line(store, 9002, "500", household=1000004, person=0, posted=datetime(2027, 6, 2, 18, 0, tzinfo=UTC))
    assert await _r1_posted(store, date(2027, 6, 5)) == 1500.0
    assert await _r1_posted(store, date(2027, 6, 12)) == 0.0


@pytest.mark.asyncio
async def test_a_placement_made_after_the_date_does_not_place_the_line_on_it() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    _cancelled(store)
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
    # The undated reclassification and attribution are named once, by their own gap (final review).
    assert "ledger_classification" in [g.figure for g in grid.not_rebuilt]
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
    assert "ledger_classification" in [g.figure for g in grid.not_rebuilt]  # named once, by its own gap


def test_a_split_override_that_cannot_be_replayed_names_the_people_in_its_parts() -> None:
    """A split override has attributed_person_cm_id 0; the campers it paid must still be unknown (never estimated)."""
    from api.services.financial_aid_reconciliation import LineOverride, SplitPart

    split = (SplitPart(1000011, 0, "", Decimal(500)), SplitPart(1000021, 0, "", Decimal(1000)))
    now = [LineOverride("ovr1", 9001, 0, 0, "", split)]  # exists now, never logged
    _, _, transactions, people = decisions_service._placements_as_of(now, [], datetime(2027, 6, 5, tzinfo=UTC))
    assert transactions == {9001}
    assert people == {1000011, 1000021}


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
async def test_an_unknown_posted_part_empties_the_type_lines_whole_not_just_their_amounts() -> None:
    """A placement CampMinder's history can't replay empties posted money without gapping the pool, so the
    pool's type lines are priced: their own and requests figures must go with their posted and amount."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.requests[EMMA] = replace(store.requests[EMMA], equity=UNKNOWN_EQUITY)  # intake had recorded it: no gap
    log_seeded(store, SEEDED)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0)
    clean = await _past_service(store).budget(YEAR, as_of=date(2027, 6, 5))
    assert [t.own for t in clean.total.decision_types] == [0.0]  # priced, so there is a figure to empty
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged
    out = await _past_service(store).budget(YEAR, as_of=date(2027, 6, 5))
    assert "posted" in {g.figure for g in out.not_rebuilt}
    lines = [t for pool in (*out.pools, out.total) for t in pool.decision_types]
    assert lines
    assert all(t.posted is None and t.amount is None and t.own is None and t.requests is None for t in lines)


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
    seed_line(store, 9001, "1600", posted=MAR8)  # an over-posting: the offer was 1,500 (D146: full cover ticks)
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
    assert post.note == "The ledger sync checked Posted: CampMinder shows $1,600 on this request"
    assert post.snapshot is not None
    assert post.snapshot["pool"] == "camp_pool"
    assert {row["actor"] for row in store.log} == {"system:ledger"}
    assert len(store.operations) == 1
    assert len({row["operation_id"] for row in store.log}) == 1
    assert rules.lock_calls == [(YEAR, 1, R1_SECTIONS)]
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.gap) == ("over", 100.0)
    assert row.rounds[0].lock_source == "ledger"
    # The sync re-runs the same night: Round 1 is posted and no later round is decided, so the $100
    # over the lock ticks nothing and nothing is written.
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
async def test_a_payer_share_round_ticks_once_the_shares_posted_cover_it() -> None:
    """D81 / D146: the round ticks once the shares posted cover its decided amount in full; a first share
    alone waits for the registrar. Each share then confirms against its own household."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    seed_line(store, 9001, "600", household=1000004)
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 0
    seed_line(store, 9002, "900", household=1000001)
    out = await _service(store).ledger_ticks(YEAR)
    assert (out.ticked, out.total_locked) == (1, 1500.0)
    c = (await _row(store)).confirmation
    assert c is not None
    assert [(s.household_cm_id, s.status) for s in c.shares] == [
        (1000001, "confirmed"),
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
    assert _notes(row) == ["CampMinder shows $1,500 for this family; not yet marked posted"]


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
    assert (out.ticked, out.skipped) == (0, "2026 predates the ledger checking Posted, which starts in 2027")
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
    with pytest.raises(DecisionRefusedError, match="may not have been written"):
        await _service(store).ledger_ticks(YEAR)


# --- final review fixes ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_ledger_tick_commits_the_rules_locks_first_and_may_chunk() -> None:
    """March's bulk import can outgrow one batch: the sections lock in the first chunk, before any tick."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    seen: list[tuple[list[str], bool]] = []
    commit = store.commit

    async def spy(writes: Any, **kwargs: Any) -> Any:
        seen.append(([w.collection for w in writes], kwargs.get("allow_chunking", False)))
        return await commit(writes, **kwargs)

    store.commit = spy  # type: ignore[method-assign]
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 1
    ((collections, chunking),) = seen
    assert chunking is True
    locks = collections.index("aid_decisions")
    assert locks == len(R1_SECTIONS)
    assert set(collections[:locks]) == {"aid_rules"}


@pytest.mark.asyncio
async def test_a_partially_committed_tick_is_not_a_refusal() -> None:
    """Some of it is saved: the codebase contract is the global 500, not a 422 (change_log.py)."""
    from bunking.financial_aid.change_log import AidOperationPartiallyCommittedError

    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")

    async def partial(*args: Any, **kwargs: Any) -> None:
        raise AidOperationPartiallyCommittedError(operation_id="op1", committed=8, total=9, detail="chunk 2 failed")

    store.commit = partial  # type: ignore[method-assign,assignment]
    with pytest.raises(AidOperationPartiallyCommittedError):
        await _service(store).ledger_ticks(YEAR)


@pytest.mark.asyncio
async def test_family_level_money_posted_before_the_reversal_does_not_block_the_clawback() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _cancelled(store)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "900", person=0, posted=T0)  # a sibling's or the family's older money
    store.synced_at = JUN1 + timedelta(hours=12)
    row = await _row(store)
    assert (row.total_posted, row.rounds[0].clawed_back) == (None, True)
    assert row.confirmation is not None
    assert row.confirmation.status == "reversed"


# --- owner rulings 2026-09-30 ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_decided_still_counts_a_clawed_back_round_while_posted_and_remaining_drop_it() -> None:
    """Ruling A: a declined offer was still decided, so Decided keeps a clawed-back round; Posted and
    Remaining drop it."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _cancelled(store)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    store.synced_at = JUN1 + timedelta(hours=12)
    row = await _row(store)
    assert (row.rounds[0].clawed_back, row.total_decided, row.total_posted) == (True, 1500.0, None)
    assert (await _service(store).remaining(YEAR)).total == 500000.0


JUN10 = datetime(2027, 6, 10, 18, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_a_line_posted_before_the_date_but_first_synced_after_it_counts_on_the_default_axis_only() -> None:
    """Ruling C: CampMinder posted the family-level repost Jun 1, but Kindred first synced it Jun 10. On
    Jun 5 the default (campminder) axis counts it, and it holds the clawback (it may be the appeal's
    repost); the recorded axis had not seen it, so Kindred showed the money clawed back then."""
    store = FakeDecisionsStore()
    _emma_posted(store)
    _cancelled(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=JUN1, recorded=JUN10)
    day = date(2027, 6, 5)
    assert await _r1_posted(store, day) == 1500.0
    assert await _r1_posted(store, day, "recorded") == 0.0
    assert await _r1_posted(store, date(2027, 6, 12), "recorded") == 1500.0  # synced by then


@pytest.mark.asyncio
async def test_a_reversal_claws_back_on_the_recorded_axis_only_once_kindred_had_recorded_it() -> None:
    """Ruling C, reversal timing: CampMinder reversed it Jun 1; the sync that wrote the reversal ran
    Jun 10. The row's last write stands in for when Kindred recorded the reversal."""
    store = FakeDecisionsStore()
    _emma_posted(store)
    _cancelled(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1, rewritten=JUN10)
    day = date(2027, 6, 5)
    assert await _r1_posted(store, day) == 0.0
    assert await _r1_posted(store, day, "recorded") == 1500.0
    assert await _r1_posted(store, date(2027, 6, 12), "recorded") == 0.0


@pytest.mark.asyncio
async def test_the_grid_marks_the_clawback_by_the_axis_it_cut_on() -> None:
    store = FakeDecisionsStore()
    _emma_posted(store)
    _cancelled(store)
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1, rewritten=JUN10)
    service = _past_service(store)
    cases: tuple[tuple[AsOfAxis, bool, float | None], ...] = (("campminder", True, None), ("recorded", False, 1500.0))
    for axis, clawed, posted in cases:
        (row,) = (await service.grid(YEAR, as_of=date(2027, 6, 5), as_of_axis=axis)).rows
        assert (row.rounds[0].clawed_back, row.total_posted) == (clawed, posted), axis


def test_a_line_carries_when_kindred_recorded_and_last_wrote_it() -> None:
    record = SimpleNamespace(
        transaction_cm_id=9001,
        household_cm_id=1000001,
        person_cm_id=1000011,
        amount=-1500,
        post_date="2027-03-09 17:00:00.000Z",
        is_reversed=False,
        reversal_date="",
        created="2027-03-10 09:00:00.000Z",
        updated="2027-06-10 09:00:00.000Z",
    )
    line = camp_line(record)
    assert (line.recorded_at, line.updated_at) == (
        datetime(2027, 3, 10, 9, 0, tzinfo=UTC),
        datetime(2027, 6, 10, 9, 0, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_the_repository_reads_recorded_times_only_when_asked() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    repo = FinancialAidDecisionsRepository(pb)
    await repo.fetch_camp_lines(YEAR, recorded_times=True)
    stamped = set(pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]["fields"].split(","))
    await repo.fetch_camp_lines(YEAR)
    plain = set(pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]["fields"].split(","))
    assert stamped - plain == {"created", "updated"}


@pytest.mark.asyncio
async def test_only_a_past_read_asks_for_the_lines_recorded_times() -> None:
    """Fix round 1: the live read leaves created and updated unread; the past read asks for them."""
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", posted=T0)
    service = _past_service(store)
    await service.grid(YEAR)
    assert store.camp_line_reads == [False]
    store.camp_line_reads.clear()
    await service.grid(YEAR, as_of=date(2027, 6, 5))
    assert store.camp_line_reads == [True]


# --- a generic camp-aid ("<camp> FA") line: outside money until reclassified (owner ruling D121) -----------------
# The ledger reads only funder_type = 'camp' lines (after reclassification), whatever a line's source
# name says. A generic camp-aid line not yet reclassified is camp aid to this read; a staff
# reclassification to outside takes it out of the camp ledger and into the grants register.


@pytest.mark.asyncio
async def test_an_unreclassified_generic_camp_aid_line_paying_full_cost_reads_over_the_prompt_to_reclassify() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "2000", posted=T0)  # full cost: 500 beyond the decided 1,500
    store.synced_at = NIGHT_AFTER
    c = (await _row(store)).confirmation
    assert c is not None
    assert (c.status, c.locked, c.in_campminder, c.gap, c.reconciled) == ("over", 1500.0, 2000.0, 500.0, False)


@pytest.mark.asyncio
async def test_a_line_reclassified_outside_never_counts_toward_posted_or_the_confirmation() -> None:
    # Reclassified outside (funder_type 'outside'), the line is not among the camp lines the ledger
    # reads (FinancialAidDecisionsRepository.fetch_camp_lines filters funder_type = 'camp'), so the
    # request's Posted is its decided money alone and CampMinder holds none of it for the camp ledger.
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    store.camp_lines = []
    store.synced_at = NIGHT_AFTER
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.in_campminder) == ("not_in_campminder", 0.0)
    assert row.total_posted == 1500.0
    assert _notes(row) == []


@pytest.mark.asyncio
async def test_a_past_read_keeps_its_ledger_as_placed_that_day_and_still_reconciles_nothing() -> None:
    """Slice 3 ask 1: Money > Ledger reads Kindred's placements as of the day (D151). The ledger is kept on its own
    field; the season's `ledger` stays empty on a past read, so nothing a past read shows moves."""
    store = FakeDecisionsStore()
    _emma_posted(store)
    seed_line(store, 9001, "1500", person=0, posted=T0)  # the household's: a person places it on Jun 10
    seed_override(store, 9001, 1000011, datetime(2027, 6, 10, 18, 0, tzinfo=UTC))
    service = _past_service(store)
    early = await service.past_season(YEAR, date(2027, 6, 5))
    later = await service.past_season(YEAR, date(2027, 6, 12))
    assert early.past_ledger is not None
    assert later.past_ledger is not None
    assert [line.transaction_cm_id for line in early.past_ledger.family_lines([1000001])] == [9001]
    assert [line.transaction_cm_id for line in later.past_ledger.lines(EMMA)] == [9001]
    assert later.ledger.read is False
    assert (await service.season(YEAR)).past_ledger is None

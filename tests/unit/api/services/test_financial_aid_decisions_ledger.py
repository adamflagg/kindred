"""The CampMinder ledger in the decisions reads (Task 5) and the automatic tick (Task 6), campership
sub-project 10b (spec §5.1, §5.3; D54, D59, D78, D81). Fictional only; every write runs the real 4a
helper over a fake batch. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500, and
the Camp pool's Round 1 is allocated 340,000 of a 500,000 budget (see decisions_fakes)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.schemas.financial_aid_decisions import GridRowOut
from api.services.financial_aid_decisions_repository import (
    FinancialAidDecisionsRepository,
    camp_line,
    line_placement,
)
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import Placement, RegisterRow
from tests.unit.api.services.decisions_fakes import (
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    seed_line,
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
    assert query == {"filter": f"year = {YEAR} && funder_type = 'camp'", "sort": "transaction_cm_id,id"}


@pytest.mark.asyncio
async def test_the_last_ledger_sync_is_the_newest_successful_aid_postings_run() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_list.return_value = SimpleNamespace(
        items=[SimpleNamespace(ended="2027-03-10 09:00:00.000Z")]
    )
    repo = FinancialAidDecisionsRepository(pb)
    assert await repo.fetch_last_ledger_sync() == datetime(2027, 3, 10, 9, 0, tzinfo=UTC)
    pb.collection.assert_called_with("sync_runs")
    call = pb.collection.return_value.get_list.call_args
    assert call.args == (1, 1)
    assert call.kwargs["query_params"]["filter"] == 'service = "aid_postings" && status = "success"'
    assert call.kwargs["query_params"]["sort"] == "-started,-id"
    pb.collection.return_value.get_list.return_value = SimpleNamespace(items=[])
    assert await repo.fetch_last_ledger_sync() is None


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

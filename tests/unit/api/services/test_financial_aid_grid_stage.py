"""The grid row carries its Stage from the server (`GridRowOut.stage`), so the Requests grid and the household page
read one source. A C1 round (CampMinder covers it in full, tonight's tick posts it) reads "R1 · Posted", though its
status is still needs_offer. Fictional only: Emma Johnson (EMMA), Liam Garcia (LIAM)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.schemas.financial_aid_decisions import GridRowOut
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_cancellations import _cancel_in_kindred
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _event, _posted, _service
from tests.unit.api.services.test_financial_aid_not_reconciled_awaiting_sync import _emma as _emma_row
from tests.unit.api.services.test_financial_aid_not_reconciled_awaiting_sync import _tick
from tests.unit.api.services.test_financial_aid_not_reconciled_both_ways import _accept, _rows


def _stage(row: GridRowOut) -> tuple[str, int | None, str] | None:
    return (row.stage.code, row.stage.round, row.stage.label) if row.stage is not None else None


@pytest.mark.asyncio
async def test_a_c1_round_reads_posted_and_waits_on_the_family() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    row = (await _rows(store))[EMMA]
    assert (row.rounds[0].status, row.rounds[0].cm_pending) == ("needs_offer", True)  # the premise
    assert row.queues == ["waiting_on_family"]
    assert _stage(row) == ("posted", 1, "R1 · Posted")


@pytest.mark.asyncio
async def test_a_c1_round_ticked_accepted_reads_accepted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    await _service(store).tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)
    assert _stage((await _rows(store))[EMMA]) == ("accepted", 1, "R1 · Accepted")


@pytest.mark.asyncio
async def test_after_the_overnight_tick_the_round_is_posted_and_still_reads_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    await _service(store).ledger_ticks(YEAR)
    row = (await _rows(store))[EMMA]
    assert row.rounds[0].status == "posted"
    assert _stage(row) == ("posted", 1, "R1 · Posted")


@pytest.mark.asyncio
async def test_a_plain_needs_an_offer_row_reads_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    assert _stage((await _rows(store))[EMMA]) == ("needs_offer", 1, "R1 · Needs an offer")


@pytest.mark.asyncio
async def test_a_short_posting_is_not_pending_so_it_reads_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    row = (await _rows(store))[EMMA]
    assert row.queues == ["not_reconciled"]
    assert _stage(row) == ("needs_offer", 1, "R1 · Needs an offer")


@pytest.mark.asyncio
async def test_a_held_row_reads_on_hold() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    assert _stage((await _rows(store))[EMMA]) == ("held", 1, "R1 · On hold")


@pytest.mark.asyncio
async def test_a_two_round_row_reads_its_latest_round() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    row = (await _rows(store))[EMMA]
    assert [r.round for r in row.rounds] == [1, 2]
    assert _stage(row) == ("needs_offer", 2, "R2 · Needs an offer")


@pytest.mark.asyncio
async def test_a_cancelled_row_reads_cancelled_with_no_round() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _cancel_in_kindred(store)
    row = (await _rows(store))[EMMA]
    assert row.cancellation is not None
    assert _stage(row) == ("cancelled", None, "Cancelled")


@pytest.mark.asyncio
async def test_a_hand_ticked_round_awaiting_the_sync_reads_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _tick(store, 1, "1500")
    row = await _emma_row(store)
    assert (row.rounds[0].status, row.rounds[0].cm_pending) == ("posted", True)  # V1
    assert _stage(row) == ("posted", 1, "R1 · Posted")


@pytest.mark.asyncio
async def test_an_accepted_posted_round_reads_accepted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 1, "accept")
    assert _stage((await _rows(store))[EMMA]) == ("accepted", 1, "R1 · Accepted")


@pytest.mark.asyncio
async def test_the_household_page_card_carries_the_grids_stage() -> None:
    from tests.unit.api.services.test_financial_aid_household_page import GARCIA, _family, _page_service

    store = _family()
    seed_line(store, 9001, "1500", household=GARCIA, person=1000021)  # covers Liam's Round 1 in full: C1
    page = await _page_service(store).read(YEAR, GARCIA)
    grid = {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}
    liam = next(card.row for card in page.requests if card.row.request_id == LIAM)
    assert _stage(liam) == ("posted", 1, "R1 · Posted")
    for card in page.requests:
        assert card.row.stage == grid[card.row.request_id].stage


@pytest.mark.asyncio
async def test_a_past_read_reads_the_stage_from_the_status_alone() -> None:
    """cm_pending is not rebuilt on a past read (None), so a C1 round reads its status. `stage` is no GRID_GAPS
    figure: it is computed only from the status, accepted and cancellation that a past read already carries."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    log_seeded(store, T0 - timedelta(days=36))

    async def register(year: int) -> Sequence[RegisterRow]:
        return ()

    later = FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0 + timedelta(days=30))
    out = await later.grid(YEAR, as_of=date(2027, 3, 9))
    (row,) = out.rows
    assert row.rounds[0].cm_pending is None
    assert _stage(row) == ("needs_offer", 1, "R1 · Needs an offer")
    assert "stage" not in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_a_c1_fixture_reads_needs_an_offer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    assert _stage((await _rows(store))[EMMA]) == ("needs_offer", 1, "R1 · Needs an offer")

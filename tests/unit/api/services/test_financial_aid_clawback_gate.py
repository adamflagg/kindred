"""Owner ruling (2026-10-02, option B): D54's clawback applies only to a cancelled or closed (withdrawn,
duplicate) request. A LIVE request whose CampMinder money was fully reversed stays in Posted and reads
unconfirmed on every round. One gate (`clawback_eligible`) serves the live read, the past-date read and
To place. Fictional only; figures: a tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from api.schemas.financial_aid_decisions import BudgetResponse, GridRowOut, RoundCellOut, UnconfirmedOut
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_to_place import reclaw
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
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _posted, _service
from tests.unit.api.services.test_financial_aid_decisions_unconfirmed import _post_at
from tests.unit.api.services.test_financial_aid_today import _Drafts, _Grants, _grants, _Ledger, _line
from tests.unit.api.services.test_financial_aid_today import _service as _today

JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
AFTER = JUN1 + timedelta(hours=12)
JUL1 = datetime(2027, 7, 1, 18, 0, tzinfo=UTC)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)


def _reversed_emma(store: FakeDecisionsStore, *, status: str = "active") -> None:
    """Emma's Round 1 posted, and CampMinder reversed the whole line on Jun 1 with no repost."""
    seed_request(store, EMMA, status=status)
    _posted(store, EMMA, 1, "1500")
    seed_line(store, 9001, "1500", posted=T0, reversed_at=JUN1)
    store.synced_at = AFTER


def _cancel_in_kindred(store: FakeDecisionsStore) -> None:
    store.cancel_events.append(
        CancelEvent("can000000000001", EMMA, "cancel", T0, reason="not_known", in_kindred=True, actor=ACTOR)
    )


def _cancel_in_campminder(store: FakeDecisionsStore) -> None:
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, date(2027, 5, 2)))


def _camp(out: BudgetResponse, n: int) -> RoundCellOut:
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    return next(c for c in camp.rounds if c.round == n)


async def _row(store: FakeDecisionsStore) -> GridRowOut:
    return next(r for r in (await _service(store).grid(YEAR)).rows if r.request_id == EMMA)


def _past_service(store: FakeDecisionsStore) -> FinancialAidDecisionsService:
    async def no_grants(year: int) -> list[RegisterRow]:
        return []

    return FinancialAidDecisionsService(store, FakeRules(approved()), no_grants, clock=lambda: JUL1)


# --- the live read -----------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_live_request_whose_money_was_fully_reversed_stays_posted_and_reads_unconfirmed() -> None:
    store = FakeDecisionsStore()
    _reversed_emma(store)
    _post_at(store, 2, "500", T0 + timedelta(days=1))
    service = _service(store)
    out = await service.budget(YEAR)
    assert (_camp(out, 1).posted, _camp(out, 2).posted) == (1500.0, 500.0)  # no money back in Remaining
    assert _camp(out, 1).unconfirmed == UnconfirmedOut(count=1, families=1, amount=1500.0)
    assert _camp(out, 2).unconfirmed == UnconfirmedOut(count=1, families=1, amount=500.0)
    row = await _row(store)
    assert (row.rounds[0].status, row.rounds[0].clawed_back) == ("posted", False)
    assert row.confirmation is not None
    assert row.confirmation.status != "reversed"
    total = (await service.remaining(YEAR)).total
    assert total is not None
    assert total < 500000.0


@pytest.mark.asyncio
@pytest.mark.parametrize("how", ["campminder", "kindred", "withdrawn", "duplicate"])
async def test_a_cancelled_or_closed_request_with_the_same_reversal_is_still_clawed_back(how: str) -> None:
    store = FakeDecisionsStore()
    _reversed_emma(store, status=how if how in ("withdrawn", "duplicate") else "active")
    if how == "campminder":
        _cancel_in_campminder(store)
    if how == "kindred":
        _cancel_in_kindred(store)
    service = _service(store)
    camp_r1 = _camp(await service.budget(YEAR), 1)
    assert (camp_r1.posted, camp_r1.remaining) == (0.0, 340000.0)
    assert (await service.remaining(YEAR)).total == 500000.0
    row = await _row(store)
    assert row.confirmation is not None
    assert (row.confirmation.status, row.rounds[0].clawed_back) == ("reversed", True)


# --- the past-date read ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_on_a_past_date_a_live_request_reversed_by_then_stays_posted_a_cancelled_one_is_clawed_back() -> None:
    live = FakeDecisionsStore()
    seed_request(live, EMMA)
    log_seeded(live, SEEDED)
    _posted(live, EMMA, 1, "1500")
    seed_line(live, 9001, "1500", posted=T0, reversed_at=JUN1)
    assert _camp(await _past_service(live).budget(YEAR, as_of=date(2027, 6, 5)), 1).posted == 1500.0
    cancelled = FakeDecisionsStore()
    seed_request(cancelled, EMMA)
    log_seeded(cancelled, SEEDED)
    _posted(cancelled, EMMA, 1, "1500")
    seed_line(cancelled, 9001, "1500", posted=T0, reversed_at=JUN1)
    _cancel_in_kindred(cancelled)
    assert _camp(await _past_service(cancelled).budget(YEAR, as_of=date(2027, 6, 5)), 1).posted == 0.0


# --- To place ----------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_to_place_re_prices_a_live_request_unclawed_and_a_cancelled_one_clawed_back() -> None:
    for how, clawed in (("live", False), ("cancelled", True)):
        store = FakeDecisionsStore()
        _reversed_emma(store)
        if how == "cancelled":
            _cancel_in_kindred(store)
        season = await _service(store).season(YEAR)
        (item,) = reclaw(season, season.ledger, [EMMA])
        assert [v.clawed_back for v in item.rounds if v.status == "posted"] == [clawed], how


# --- a withdrawn request with live camp aid is To reverse (owner ruling (a)), and agrees with the gate ----------


def _withdrawn_emma(store: FakeDecisionsStore, *, reversed_at: datetime | None = None, line: bool = True) -> None:
    """Emma's request withdrawn, her enrollment still live (status 2), Round 1 posted, and CampMinder holding her aid."""
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 2, None))
    if line:
        seed_line(store, 9001, "1500", posted=T0, reversed_at=reversed_at)
    store.synced_at = AFTER


@pytest.mark.asyncio
async def test_a_withdrawn_request_on_a_live_enrollment_with_live_camp_aid_is_to_reverse() -> None:
    store = FakeDecisionsStore()
    _withdrawn_emma(store)
    row = await _row(store)
    assert row.to_reverse is True
    assert row.cancellation is None
    assert "to_reverse" in (row.queues or [])
    assert "waiting_on_family" not in (row.queues or [])
    assert (row.rounds[0].status, row.rounds[0].clawed_back) == ("posted", False)  # live money: nothing clawed yet
    out = await _today(store, _Grants(_grants(year=YEAR)), _Drafts(None), _Ledger()).read(
        YEAR, casework=True, finance=False
    )
    assert _line(out.casework, "to_reverse").items == 1


@pytest.mark.asyncio
async def test_once_campminder_reverses_a_withdrawn_requests_money_it_leaves_to_reverse_and_reads_clawed_back() -> None:
    """Agrees with the clawback gate: a closed request is clawed back exactly when its money is no longer live."""
    store = FakeDecisionsStore()
    _withdrawn_emma(store, reversed_at=JUN1)
    row = await _row(store)
    assert row.to_reverse is False
    assert "to_reverse" not in (row.queues or [])
    assert (row.rounds[0].status, row.rounds[0].clawed_back) == ("posted", True)


@pytest.mark.asyncio
async def test_a_withdrawn_request_with_no_camp_aid_lines_is_not_to_reverse() -> None:
    store = FakeDecisionsStore()
    _withdrawn_emma(store, line=False)
    assert (await _row(store)).to_reverse is False

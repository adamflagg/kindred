"""A done season reads as history on every staff read (CLOSED-SEASONS-DONE; owner ruling NG-01, CSD-1..6): the grid,
the household page, Today and Form intake carry `season_done`, show nothing pending and offer nothing to do, and no
money figure moves. An open season reads exactly as before. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

import pytest

import api.schemas.financial_aid_decisions as decision_schemas
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_household_page import HouseholdPageService
from api.services.financial_aid_today import TodayService
from tests.unit.api.services import test_financial_aid_form_intake as intake_tests
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_household_page import (
    JOHNSON,
    _Casework,
    _family,
    _Grants,
    _History,
    _Ledger,
)
from tests.unit.api.services.test_financial_aid_today import _Drafts, _grants, _line
from tests.unit.api.services.test_financial_aid_today import _Grants as _TodayGrants
from tests.unit.api.services.test_financial_aid_today import _Ledger as _TodayLedger

EMMA, LIAM = "reqemma00000001", "reqliam00000001"


async def _done(year: int) -> bool:
    return True


async def _open(year: int) -> bool:
    return False


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decision_schemas, "today", lambda: date(2027, 12, 31))


async def _no_register(year: int) -> Sequence[RegisterRow]:
    return ()


def _decisions(store: FakeDecisionsStore, **kwargs: object) -> FinancialAidDecisionsService:
    return FinancialAidDecisionsService(
        store,
        FakeRules(approved()),
        _no_register,
        clock=lambda: T0,
        **kwargs,  # type: ignore[arg-type]
    )


def _two_requests() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    return store


# -- The Requests grid ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_done_seasons_grid_has_nothing_pending_and_says_so() -> None:
    store = _two_requests()
    out = await _decisions(store, season_done=_done).grid(YEAR)
    assert out.season_done is True
    assert {row.request_id for row in out.rows} == {EMMA, LIAM}
    for row in out.rows:
        assert row.queues == []
        assert row.holds == []
        assert row.stage is not None and (row.stage.code, row.stage.label) == ("closed", "Closed")


@pytest.mark.asyncio
async def test_a_done_seasons_grid_moves_no_figure() -> None:
    """The row count and every money figure equal the ungated build's (NOTES §5: no total moves)."""
    store = _two_requests()
    gated = await _decisions(store, season_done=_done).grid(YEAR)
    plain = await _decisions(store).grid(YEAR)
    assert len(gated.rows) == len(plain.rows)
    for closed, live in zip(gated.rows, plain.rows, strict=True):
        assert closed.request_id == live.request_id
        for name in ("request_status", "rounds", "included", "total_decided", "total_posted", "cost", "tier", "pool"):
            assert getattr(closed, name) == getattr(live, name), name


@pytest.mark.asyncio
async def test_an_open_seasons_grid_is_exactly_as_before() -> None:
    store = _two_requests()
    gated = await _decisions(store, season_done=_open).grid(YEAR)
    plain = await _decisions(store).grid(YEAR)
    assert gated.season_done is False
    assert gated.model_dump() == plain.model_dump()
    assert any(row.queues for row in gated.rows)  # the premise: an open season's rows are in views


# -- The household page --------------------------------------------------------------------------------------------


def _page(store: FakeDecisionsStore, **kwargs: object) -> HouseholdPageService:
    return HouseholdPageService(
        store=store,
        pricing=FakeRules(approved()),
        grants=_Grants(),
        casework=_Casework(store),
        ledger=_Ledger(),
        history=_History(),
        clock=lambda: T0,
        **kwargs,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_a_done_seasons_household_page_says_so_and_its_requests_read_closed() -> None:
    store = _family()
    page = await _page(store, season_done=_done).read(YEAR, JOHNSON)
    assert page.season_done is True
    assert page.requests
    for card in page.requests:
        assert card.row.queues == []
        assert card.row.stage is not None and card.row.stage.code == "closed"


@pytest.mark.asyncio
async def test_a_done_seasons_household_page_moves_no_money() -> None:
    store = _family()
    gated = await _page(store, season_done=_done).read(YEAR, JOHNSON)
    plain = await _page(store).read(YEAR, JOHNSON)
    assert gated.totals == plain.totals
    assert [h.money for h in gated.households] == [h.money for h in plain.households]


@pytest.mark.asyncio
async def test_an_open_seasons_household_page_is_exactly_as_before() -> None:
    store = _family()
    gated = await _page(store, season_done=_open).read(YEAR, JOHNSON)
    plain = await _page(store).read(YEAR, JOHNSON)
    assert gated.season_done is False
    assert gated.model_dump() == plain.model_dump()


# -- Today ---------------------------------------------------------------------------------------------------------


def _today(store: FakeDecisionsStore, **kwargs: object) -> TodayService:
    return TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_TodayGrants(_grants(year=YEAR)),
        ledger=_TodayLedger(needs_group=["camp_fund"]),
        clock=lambda: T0,
        **kwargs,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_a_done_seasons_today_has_nothing_waiting() -> None:
    """Every line is 0 and the bar counts no live request; the closed requests are counted, so they don't vanish
    (CSD-4)."""
    out = await _today(_two_requests(), season_done=_done).read(YEAR, casework=True, finance=True, view=True)
    assert out.season_done is True
    assert out.casework is not None and out.finance is not None
    assert [(line.key, line.items) for line in out.casework if line.items] == []
    assert [(line.key, line.items) for line in out.finance if line.items] == []
    stages = out.stages
    assert stages is not None
    assert (stages.needs_offer, stages.pending_approval, stages.waiting_on_family, stages.on_hold) == (0, 0, 0, 0)
    assert (stages.accepted, stages.live, stages.offered, stages.families) == (0, 0, 0, 0)
    assert stages.closed == 2
    assert stages.flags.model_dump() == dict.fromkeys(stages.flags.model_dump(), 0)


@pytest.mark.asyncio
async def test_an_open_seasons_today_is_exactly_as_before() -> None:
    gated = await _today(_two_requests(), season_done=_open).read(YEAR, casework=True, finance=True, view=True)
    plain = await _today(_two_requests()).read(YEAR, casework=True, finance=True, view=True)
    assert gated.season_done is False
    assert gated.model_dump() == plain.model_dump()
    assert _line(gated.casework, "needs_offer").items == 2  # the premise: an open season has work
    assert _line(gated.finance, "sources").items == 1
    assert gated.stages is not None and gated.stages.closed == 0


# -- Requests › Form intake ----------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_done_seasons_form_intake_needs_no_look_and_offers_no_addition() -> None:
    store = await intake_tests._d170_store()

    async def waiting(year: int) -> int:
        return 2

    plain = await FormIntakeService(store, grants_waiting=waiting).forms(YEAR)
    assert plain.counts.needs_look > 0 and any(r.can_add for r in plain.rows)  # the premise
    out = await FormIntakeService(store, grants_waiting=waiting, season_done=_done).forms(YEAR)
    assert out.season_done is True
    assert out.counts.needs_look == 0
    assert (out.counts.all, out.counts.registration_only) == (plain.counts.all, plain.counts.registration_only)
    assert out.grants_waiting_for_camper == 0
    for closed, live in zip(out.rows, plain.rows, strict=True):
        assert (closed.needs_look, closed.look_reasons, closed.can_add) == (False, [], False)
        # CampMinder's aid stays in its column at the same amounts.
        assert closed.campminder_aid == live.campminder_aid
    assert out.campminder_aid_on_no_request == plain.campminder_aid_on_no_request


@pytest.mark.asyncio
async def test_a_done_seasons_waiting_request_became_closed_on_form_intake() -> None:
    """CSD-1 on Form intake: a request still waiting with no round (Session unclear, Duplicate pending) became Closed;
    an active one still reads Active."""
    store = await intake_tests.intake(
        intake_tests.fa_row(intake_tests.OLIVIA, intake_tests.CHEN, summer="Session 2 or Taste 2", summer_ask=3000.0),
        attendees=intake_tests.enrolled(
            intake_tests.OLIVIA, intake_tests.CHEN, intake_tests.SESSION_2, intake_tests.TASTE_2
        ),
    )
    plain = await FormIntakeService(store).forms(YEAR)
    olivia = intake_tests.row(plain, intake_tests.CHEN, intake_tests.OLIVIA)
    assert [b.status for b in olivia.became] == ["session_unclear"]  # the premise
    out = await FormIntakeService(store, season_done=_done).forms(YEAR)
    assert [b.status for b in intake_tests.row(out, intake_tests.CHEN, intake_tests.OLIVIA).became] == ["closed"]


@pytest.mark.asyncio
async def test_a_done_seasons_form_intake_summary_and_aid_panel_offer_nothing() -> None:
    store = await intake_tests._d170_store()
    summary = await FormIntakeService(store, season_done=_done).summary(YEAR)
    assert summary.needs_look == 0
    assert summary.season_done is True
    plain = await FormIntakeService(store).aid_on_no_request(YEAR)
    aid = await FormIntakeService(store, season_done=_done).aid_on_no_request(YEAR)
    assert aid.season_done is True
    assert [line.can_add for line in aid.lines] == [False] * len(plain.lines)
    assert (aid.total, aid.families) == (plain.total, plain.families)


@pytest.mark.asyncio
async def test_an_open_seasons_form_intake_is_exactly_as_before() -> None:
    store = await intake_tests._d170_store()
    gated = await FormIntakeService(store, season_done=_open).forms(YEAR)
    plain = await FormIntakeService(store).forms(YEAR)
    assert gated.season_done is False
    assert gated.model_dump() == plain.model_dump()

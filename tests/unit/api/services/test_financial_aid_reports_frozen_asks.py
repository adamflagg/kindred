"""D155 (Reports back end, Task A6b): the received-by snapshot and every received-through figure use Round 1 asks as
they stood at the end of that day, through 3c-2's past read; when that can't be exact, the figure keeps asks as they
stand now and says so. Emma's Round 1 ask was 4,000 on the deadline (February 1) and is 5,000 since March 1; Liam's
is 2,000. The clock is April 1 2027. Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_REQUESTS
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_facts import frozen_round1_asks
from api.services.financial_aid_reports_service import FinancialAidReportsService
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    log_update,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.reports_fakes import EARLY, EMMA, LIAM, FakeReportsStore, report_season
from tests.unit.bunking.financial_aid.fixtures import with_levers

pytestmark = pytest.mark.asyncio

NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
DEADLINE = date(2027, 2, 1)
CORRECTED = datetime(2027, 3, 1, 18, 0, tzinfo=UTC)  # after the deadline
RULES = with_levers(intake_rules(), {"milestones.application_deadline": "2027-02-01"})
OLD = "reqemma00000000"  # Emma's first answer, which an edit after the deadline replaced


async def _no_register(year: int) -> Sequence[RegisterRow]:
    return []


def _service(store: FakeDecisionsStore) -> FinancialAidReportsService:
    return FinancialAidReportsService(
        store, FakeRules(approved(RULES)), _no_register, FakeReportsStore(), clock=lambda: NOW
    )


def _emma_asks_more_after_the_deadline() -> FakeDecisionsStore:
    store = report_season()
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 5000.0}, CORRECTED)
    store.requests[EMMA] = replace(store.requests[EMMA], ask=5000.0)
    return store


def _camp(rows: Sequence[Any]) -> Any:
    return next(r for r in rows if r.year == YEAR and r.basis == "P" and r.pool == "camp_pool")


async def test_frozen_round1_asks_reads_each_kept_request_from_the_day() -> None:
    store = _emma_asks_more_after_the_deadline()
    decisions = FinancialAidDecisionsService(store, FakeRules(approved(RULES)), _no_register, clock=lambda: NOW)
    live = await decisions.season(YEAR)
    then = await decisions.past_season(YEAR, DEADLINE, "recorded")
    frozen = frozen_round1_asks(live, then, [], {EMMA, LIAM}, DEADLINE)
    assert (frozen.basis, frozen.reason) == ("as_of_cutoff", None)
    assert frozen.asks == {EMMA: Decimal(4000), LIAM: Decimal(2000)}


async def test_the_deadline_snapshot_freezes_round_1_asks_as_they_stood_that_day() -> None:
    out = await _service(_emma_asks_more_after_the_deadline()).committee(YEAR)
    camp = _camp(out.applications)
    assert camp.cutoff == DEADLINE
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked) == (2, 6000.0)  # Emma's 4,000 + Liam's 2,000, as on Feb 1
    assert camp.season_end.asked == 7000.0  # the season's end reads asks as they stand
    assert (camp.asks_basis, camp.asks_reason) == ("as_of_cutoff", None)


async def test_a_received_through_cut_freezes_round_1_asks_at_that_day() -> None:
    """S1 Q2: the freeze applies at any received-through date, on Statistics and Programs too."""
    service = _service(_emma_asks_more_after_the_deadline())
    every = await service.statistics(YEAR, table="camp", round_=1)
    assert every.asks is None
    assert every.total.asked == 7000.0
    cut = await service.statistics(YEAR, table="camp", round_=1, through=date(2027, 2, 15))
    assert cut.total.asked == 6000.0
    assert cut.asks is not None
    assert (cut.asks.day, cut.asks.basis, cut.asks.unrebuilt) == (date(2027, 2, 15), "as_of_cutoff", 0)
    by_session = await service.programs(YEAR, through_deadline=True)
    assert by_session.total.round1.requested == 6000.0
    assert by_session.asks is not None


async def test_an_answer_edited_after_the_cut_freezes_to_the_answer_that_stood() -> None:
    """An edit withdraws the old request and creates a new one (D72); the new one's received date is the old one's
    (edit_predecessors), and on the deadline the old one stood, with its own ask."""
    store = report_season()
    seed_request(store, OLD)  # Emma's first answer: 4,000, live on the deadline
    store.requests[EMMA] = replace(store.requests[EMMA], ask=5000.0)
    store.change_log = []
    log_seeded(store, EARLY)
    store.change_log = [  # Emma's new answer was created on March 1, when the first was withdrawn
        replace(row, created=CORRECTED) if row.entity == AID_REQUESTS and row.entity_id == EMMA else row
        for row in store.change_log
    ]
    log_update(store, AID_REQUESTS, OLD, {"status": "active"}, {"status": "withdrawn"}, CORRECTED)
    store.requests[OLD] = replace(store.requests[OLD], status="withdrawn")
    camp = _camp((await _service(store).committee(YEAR)).applications)
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked) == (2, 6000.0)
    assert camp.asks_basis == "as_of_cutoff"


async def test_asks_that_cant_be_rebuilt_fall_back_to_now_and_say_so(monkeypatch: pytest.MonkeyPatch) -> None:
    """D155: when any kept request's ask that day can't be rebuilt (3c-2 lists it in Season.unrebuilt), the whole
    figure keeps asks as they stand now, labelled; never a mix of the two."""
    service = _service(_emma_asks_more_after_the_deadline())
    real = service._decisions.past_season

    async def unreplayable(year: int, day: date, axis: Any = "campminder") -> Season:
        then = await real(year, day, axis)
        return replace(then, unrebuilt=then.unrebuilt | {EMMA})

    monkeypatch.setattr(service._decisions, "past_season", unreplayable)
    camp = _camp((await service.committee(YEAR)).applications)
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked) == (2, 7000.0)  # asks as they stand now
    assert camp.asks_basis == "now"
    assert camp.asks_reason is not None
    assert "can't be rebuilt" in camp.asks_reason
    cut = await service.statistics(YEAR, table="camp", round_=1, through=DEADLINE)
    assert cut.asks is not None
    assert (cut.asks.basis, cut.asks.unrebuilt, cut.total.asked) == ("now", 1, 7000.0)


async def test_a_cut_on_or_after_the_reads_own_day_needs_no_past_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """A received-through date of today or later is the live read itself (and a past read's own date likewise)."""
    service = _service(_emma_asks_more_after_the_deadline())

    async def never(*args: Any, **kwargs: Any) -> Season:
        raise AssertionError("no second read")

    monkeypatch.setattr(service._decisions, "past_season", never)
    out = await service.statistics(YEAR, table="camp", round_=1, through=date(2027, 4, 1))
    assert out.asks is not None
    assert (out.asks.basis, out.total.asked) == ("as_of_cutoff", 7000.0)

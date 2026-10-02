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
from api.schemas.financial_aid_reports import ProgramsResponse, StatisticsResponse
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_facts import FrozenAsks, frozen_round1_asks, with_frozen_asks
from api.services.financial_aid_reports_service import FinancialAidReportsService
from bunking.financial_aid.decisions.rounds import DecisionEvent
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
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

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


async def test_a_received_through_cut_filters_the_requests_and_reads_every_ask_as_it_stands_today() -> None:
    """Owner N1 (RULED 2026-10-02): the received-through control is a request filter on today's figures. Emma asked
    4,000 on the cut day and 5,000 since: Statistics and Programs read 5,000, so % of ask never divides a frozen
    small ask into a live award. Only the committee's at-cutoff snapshot row freezes asks."""
    service = _service(_emma_asks_more_after_the_deadline())
    every = await service.statistics(YEAR, table="camp", round_=1)
    assert every.total.asked == 7000.0
    cut = await service.statistics(YEAR, table="camp", round_=1, through=date(2027, 2, 15))
    assert (cut.total.apps, cut.total.asked, cut.total.live_asked) == (2, 7000.0, 7000.0)
    assert cut.total.pct_of_ask == pytest.approx(1500 / 7000 * 100, abs=0.05)
    assert cut.request_set is not None
    assert "asks" not in StatisticsResponse.model_fields
    by_session = await service.programs(YEAR, through_deadline=True)
    assert by_session.total.round1.requested == 7000.0
    assert "asks" not in ProgramsResponse.model_fields


async def test_a_received_through_percent_of_ask_divides_by_the_ask_as_it_stands_today() -> None:
    """Owner N1: Emma's lock is 1,500; her ask was 4,000 on the cut day and is 5,000 now. Frozen, the share was 37.5%;
    on today's ask it is 30%."""
    cut = await _service(_emma_asks_more_after_the_deadline()).statistics(
        YEAR, table="camp", round_=1, through=date(2027, 2, 15)
    )
    two = next(row for row in cut.rows if row.tier == 2)
    assert (two.amount, two.live_asked, two.pct_of_ask) == (1500.0, 5000.0, 30.0)


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


async def test_a_predecessor_withdrawn_by_the_cut_day_does_not_stand_for_the_frozen_ask() -> None:
    """A6b: the first answer was withdrawn before the deadline and the new one recorded after it, so nothing stood
    for the request on the day: its ask can't be rebuilt, and the figure says "now" rather than reuse the old ask."""
    store = report_season()
    seed_request(store, OLD)
    store.requests[EMMA] = replace(store.requests[EMMA], ask=5000.0)
    store.change_log = []
    log_seeded(store, EARLY)
    store.change_log = [
        replace(row, created=CORRECTED) if row.entity == AID_REQUESTS and row.entity_id == EMMA else row
        for row in store.change_log
    ]
    log_update(
        store, AID_REQUESTS, OLD, {"status": "active"}, {"status": "withdrawn"}, datetime(2027, 1, 25, tzinfo=UTC)
    )
    store.requests[OLD] = replace(store.requests[OLD], status="withdrawn")
    camp = _camp((await _service(store).committee(YEAR)).applications)
    assert camp.asks_basis == "now"
    assert camp.asks_reason is not None


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
    assert cut.total.asked == 7000.0


async def test_a_cut_on_or_after_the_reads_own_day_needs_no_past_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """A received-through date of today or later is the live read itself (and a past read's own date likewise)."""
    service = _service(_emma_asks_more_after_the_deadline())

    async def never(*args: Any, **kwargs: Any) -> Season:
        raise AssertionError("no second read")

    monkeypatch.setattr(service._decisions, "past_season", never)
    out = await service.statistics(YEAR, table="camp", round_=1, through=date(2027, 4, 1))
    assert out.total.asked == 7000.0


def test_freezing_asks_replaces_round_1_only_and_leaves_appeal_asks_out_of_the_snapshot() -> None:
    """Owner 49 (RULED 2026-10-02): the snapshot is Round 1 asks as they stood. with_frozen_asks never writes a Round
    2 or 3 ask, and the snapshot row (`_counted`) sums Round 1 asks alone, so an appeal never reaches it."""
    request = req(EMMA, rnd(1, ask="5000"), rnd(2, ask="900"))
    (frozen,) = with_frozen_asks([request], FrozenAsks(DEADLINE, "as_of_cutoff", asks={EMMA: Decimal(4000)}))
    assert frozen.asked((1,)) == Decimal(4000)
    assert frozen.asked((2,)) == Decimal(900)  # untouched: the snapshot row never reads it (committee `_counted`)


async def test_a_received_through_round_2_chip_shows_todays_appeal_ask_for_a_kept_request() -> None:
    """Owner 49 (RULED 2026-10-02): a received-through read filters today's figures, appeal chips included. A cut run
    in February has no appeals yet (no family has had its offer); a later run of the same cut shows what has happened
    since. Emma's Round 2 ask of 900 was keyed after the cut day and is her appeal ask today."""
    store = _emma_asks_more_after_the_deadline()
    store.events.append(
        DecisionEvent(
            id="ev0000000000009",
            request_id=EMMA,
            round=2,
            kind="ask",
            created=CORRECTED,
            amount=Decimal(900),
            effective_on=CORRECTED.date(),
        )
    )
    cut = await _service(store).statistics(YEAR, table="camp", round_=2, through=date(2027, 2, 15))
    assert (cut.total.apps, cut.total.asked) == (1, 900.0)

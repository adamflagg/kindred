"""The decisions reads as of a past date, from dated records (3c-1). Fictional only.

decisions_fakes figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500; Camp's Round 1
allocation is 340,000, its total 400,000. The clock is April 1 2027 (camp time). March 2027 is PST
(UTC-8): March 9 ends at 08:00 UTC on March 10."""

from __future__ import annotations

import asyncio
import gc
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_REQUESTS
from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, _requests_as_of, as_of_instant
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_plan import request_fields
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES, UNKNOWN_EQUITY, CorrectionRecord, EquityAnswers
from api.services.financial_aid_rules_service import RulesHistoryIncompleteError
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import (
    BUDGET_GAPS,
    GRID_GAPS,
    MANUAL_HOLD,
    PAST_DATE_GAPS,
    REMAINING_GAPS,
    DecisionEvent,
    HoldEvent,
)
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    log_update,
    seed_line,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.bunking.financial_aid.fixtures import with_lever

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
MAR_9 = date(2027, 3, 9)
LATE_ON_MAR_9 = datetime(2027, 3, 10, 7, 30, tzinfo=UTC)  # 11:30 pm PST, March 9
EARLY_ON_MAR_10 = datetime(2027, 3, 10, 8, 30, tzinfo=UTC)  # 12:30 am PST, March 10


def _day(month: int, day: int) -> datetime:
    return datetime(2027, month, day, 18, 0, tzinfo=UTC)


def _service(store: FakeDecisionsStore, rules: FakeRules | None = None) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return []

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: NOW)


def _seeded(*ids: str, equity: EquityAnswers | None = None) -> FakeDecisionsStore:
    """Requests logged on SEEDED; `equity` is the copy intake had recorded on each (None: none yet)."""
    store = FakeDecisionsStore()
    for n, request_id in enumerate(ids):
        seed_request(store, request_id, household=1000001 + n, person=1000011 + 10 * n)
        store.requests[request_id] = replace(store.requests[request_id], equity=equity)
    log_seeded(store, SEEDED)
    return store


def _at(store: FakeDecisionsStore, request_id: str, n: int, kind: Any, created: datetime, **fields: Any) -> None:
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}", request_id=request_id, round=n, kind=kind, created=created, **fields
        )
    )


def _post_at(store: FakeDecisionsStore, request_id: str, created: datetime, on: date = MAR_9) -> None:
    _at(
        store,
        request_id,
        1,
        "post",
        created,
        amount=Decimal(1500),
        effective_on=on,
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )


def test_an_as_of_date_is_the_last_instant_of_that_day_in_camp_time() -> None:
    assert as_of_instant(MAR_9) == datetime(2027, 3, 10, 8, 0, tzinfo=UTC) - timedelta(microseconds=1)


@pytest.mark.asyncio
async def test_a_past_date_shows_the_ticks_recorded_by_the_end_of_that_day_in_camp_time() -> None:
    store = _seeded(EMMA)
    _post_at(store, EMMA, LATE_ON_MAR_9)
    _at(store, EMMA, 1, "accept", EARLY_ON_MAR_10)
    service = _service(store)
    out = await service.grid(YEAR, as_of=MAR_9, as_of_axis="recorded")
    assert (out.as_of, out.as_of_axis) == (MAR_9, "recorded")
    (row,) = out.rows
    (r1,) = row.rounds
    assert (r1.status, r1.posted, r1.accepted, r1.posted_on) == ("posted", 1500.0, False, MAR_9)
    (next_day,) = (await service.grid(YEAR, as_of=date(2027, 3, 10))).rows
    assert next_day.rounds[0].accepted is True


@pytest.mark.asyncio
async def test_the_recorded_axis_cuts_on_when_kindred_recorded_a_tick_not_its_effective_date() -> None:
    """Decision 6, kept as the recorded axis (owner ruling 2026-09-30): CampMinder posted it March 5;
    staff keyed the tick March 12."""
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9, as_of_axis="recorded")).rows
    assert (row.rounds[0].status, row.total_posted) == ("not_rebuilt", None)


@pytest.mark.asyncio
async def test_a_tick_undone_after_the_date_still_shows_posted_on_it() -> None:
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 5))
    _at(store, EMMA, 1, "unpost", _day(3, 20), note="Ticked the wrong family")
    service = _service(store)
    (then,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    (later,) = (await service.grid(YEAR, as_of=date(2027, 3, 25))).rows
    assert (then.rounds[0].status, then.total_posted) == ("posted", 1500.0)
    assert (later.rounds[0].status, later.total_posted) == ("not_rebuilt", None)


@pytest.mark.asyncio
async def test_today_or_later_is_the_live_read() -> None:
    store = _seeded(EMMA)
    rules = FakeRules(approved())
    service = _service(store, rules)
    for day in (date(2027, 4, 1), date(2027, 5, 1)):
        out = await service.grid(YEAR, as_of=day)
        (row,) = out.rows
        assert (out.as_of, out.as_of_axis, out.not_rebuilt) == (None, None, [])
        assert (row.rounds[0].status, row.rounds[0].decided) == ("needs_offer", 1500.0)
    assert rules.as_of_calls == []


@pytest.mark.asyncio
async def test_a_request_created_after_the_date_is_not_on_it() -> None:
    store = _seeded(EMMA, LIAM)
    store.change_log = [replace(r, created=_day(3, 20)) if r.entity_id == LIAM else r for r in store.change_log]
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    assert [row.request_id for row in out.rows] == [EMMA]


@pytest.mark.asyncio
async def test_the_request_as_it_stood_gives_its_status_and_round_1_ask() -> None:
    store = _seeded(EMMA)
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 5))
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000001",
            year=YEAR,
            application_id=store.requests[EMMA].application_id,
            request_id=EMMA,
            field="ask",
            new_value="3000",
            original_value="3500",
            reason="Family emailed a lower ask",
            actor="registrar@example.com",
            created="2027-03-15 18:00:00.000Z",
        )
    )
    log_update(store, AID_REQUESTS, EMMA, {"status": "active"}, {"status": "withdrawn"}, _day(3, 20))
    service = _service(store)
    (mar_9,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    (mar_16,) = (await service.grid(YEAR, as_of=date(2027, 3, 16))).rows
    (mar_25,) = (await service.grid(YEAR, as_of=date(2027, 3, 25))).rows
    assert (mar_9.request_status, mar_9.rounds[0].ask) == ("active", 3500.0)
    assert (mar_16.request_status, mar_16.rounds[0].ask) == ("active", 3000.0)
    assert (mar_25.request_status, mar_25.rounds) == ("withdrawn", [])  # not live: posted rounds only


@pytest.mark.asyncio
async def test_released_and_manual_holds_are_as_they_stood() -> None:
    store = _seeded(EMMA)
    store.hold_events.extend(
        [
            HoldEvent(
                id="hev000000000001",
                request_id=EMMA,
                kind="release",
                code="placeholder_income",
                created=_day(3, 6),
                note="Tax return seen",
                actor="registrar@example.com",
            ),
            HoldEvent(
                id="hev000000000002",
                request_id=EMMA,
                kind="place",
                code=MANUAL_HOLD,
                created=_day(3, 5),
                note="Waiting on the school letter",
                actor="registrar@example.com",
            ),
            HoldEvent(
                id="hev000000000003",
                request_id=EMMA,
                kind="lift",
                code=MANUAL_HOLD,
                created=_day(3, 20),
                note="Letter arrived",
                actor="registrar@example.com",
            ),
        ]
    )
    service = _service(store)
    (then,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    (later,) = (await service.grid(YEAR, as_of=date(2027, 3, 25))).rows
    assert [r.code for r in then.released_holds] == ["placeholder_income"]
    assert [h.code for h in then.holds or []] == [MANUAL_HOLD]
    assert later.holds == []


@pytest.mark.asyncio
async def test_a_request_with_no_recorded_equity_answers_then_keeps_3c1s_figures_and_is_named() -> None:
    """3c-2: _seeded records no equity copy, as every date before intake's first 3c-2 run."""
    store = _seeded(EMMA)
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    (row,) = out.rows
    assert (row.rounds[0].status, row.rounds[0].decided, row.tier, row.cost, row.total_decided, row.notes) == (
        "not_rebuilt",
        None,
        None,
        None,
        None,
        None,
    )
    assert [(g.figure, g.reason, g.requests) for g in out.not_rebuilt] == [
        *[(f, PAST_DATE_GAPS[f], []) for f in GRID_GAPS],
        ("equity_not_recorded", PAST_DATE_GAPS["equity_not_recorded"], [EMMA]),
    ]
    assert row.queues is None
    assert "queues" in GRID_GAPS


@pytest.mark.asyncio
async def test_the_budget_on_a_past_date() -> None:
    store = _seeded(EMMA, LIAM)
    _post_at(store, LIAM, _day(3, 5), on=date(2027, 3, 5))
    _at(store, LIAM, 1, "accept", _day(3, 6))
    _post_at(store, EMMA, _day(3, 15), on=date(2027, 3, 15))
    _at(store, LIAM, 2, "ask", _day(3, 8), amount=Decimal(700), effective_on=date(2027, 3, 8))
    service = _service(store)
    out = await service.budget(YEAR, as_of=MAR_9)
    assert (out.as_of, out.rules_version, out.outside_grants_off_requests) == (MAR_9, 1, 0.0)
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.allocated, r1.posted, r1.accepted) == (340000.0, 1500.0, 1500.0)
    assert (r1.needs_offer, r1.pending_approval, r1.remaining) == (None, None, None)
    assert (camp.below.held, camp.below.outside_budget, camp.below.outside_budget_posted) == (None, None, 0.0)
    assert (camp.demand.round2_asks.requests, camp.demand.round2_asked) == (1, 700.0)  # type: ignore[union-attr]
    assert (camp.demand.round2_computed, camp.demand.round1_unmet) == (None, None)
    strip = next(s for s in out.strip if s.round == 1)
    assert strip.posted is not None
    assert (strip.posted.requests, strip.needs_offer, strip.held) == (1, None, None)
    assert [g.figure for g in out.not_rebuilt] == [*BUDGET_GAPS, "equity_not_recorded"]
    grid = await service.grid(YEAR, as_of=MAR_9)
    assert sum(row.total_posted or 0 for row in grid.rows) == camp.total.posted  # every total opens its rows


@pytest.mark.asyncio
async def test_with_no_rules_approved_by_then_nothing_is_allocated_and_posted_still_counts() -> None:
    store = _seeded(LIAM)
    _post_at(store, LIAM, _day(3, 5))
    rules = FakeRules(approved())
    rules.as_of_version = None
    out = await _service(store, rules).budget(YEAR, as_of=MAR_9)
    r1 = next(c for c in next(p for p in out.pools if p.pool == "camp_pool").rounds if c.round == 1)
    assert (out.rules_version, r1.allocated, r1.posted) == (None, None, 1500.0)
    assert rules.as_of_calls == [as_of_instant(MAR_9)]


@pytest.mark.asyncio
async def test_rules_whose_history_cannot_be_replayed_are_named_not_replaced() -> None:
    store = _seeded(EMMA)
    rules = FakeRules(approved())
    rules.as_of_version = RulesHistoryIncompleteError("aid_rules 2027:1")
    out = await _service(store, rules).budget(YEAR, as_of=MAR_9)
    assert out.rules_version is None
    assert "rules_history" in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_a_request_whose_history_cannot_be_replayed_shows_posted_rounds_only() -> None:
    store = _seeded(EMMA)
    store.change_log = [r for r in store.change_log if r.entity_id != EMMA]
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create
    _post_at(store, EMMA, _day(3, 5))
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    (row,) = out.rows
    assert (row.request_status, [v.status for v in row.rounds]) == (None, ["posted"])
    gap = next(g for g in out.not_rebuilt if g.figure == "request_history")
    assert gap.requests == [EMMA]


@pytest.mark.asyncio
async def test_the_remaining_line_on_a_past_date_empties_only_the_pool_a_gap_reaches() -> None:
    out = await _service(_seeded(EMMA)).remaining(YEAR, as_of=MAR_9)
    assert [(p.pool, p.remaining) for p in out.pools] == [
        ("camp_pool", None),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert (out.total, out.as_of, [g.figure for g in out.not_rebuilt]) == (
        None,
        MAR_9,
        [*REMAINING_GAPS, "equity_not_recorded"],
    )


@pytest.mark.asyncio
async def test_a_past_request_with_only_a_round_2_ask_lands_in_its_programs_pool_as_live_does() -> None:
    store = _seeded(EMMA)
    _at(store, EMMA, 2, "ask", _day(3, 8), amount=Decimal(700), effective_on=date(2027, 3, 8))
    service = _service(store)
    (live,) = (await service.grid(YEAR)).rows
    (past,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    assert (live.pool, past.pool) == ("camp_pool", "camp_pool")
    out = await service.budget(YEAR, as_of=MAR_9)
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    assert camp.demand.round2_asks is not None
    assert camp.demand.round2_asks.requests == 1
    assert "pool_unknown" not in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_a_past_request_whose_pool_cannot_be_resolved_is_named_pool_unknown() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000999)  # a session no program covers
    log_seeded(store, SEEDED)
    service = _service(store)
    (row,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    assert row.pool is None
    out = await service.budget(YEAR, as_of=MAR_9)
    gap = next(g for g in out.not_rebuilt if g.figure == "pool_unknown")
    assert (gap.requests, gap.reason) == ([EMMA], PAST_DATE_GAPS["pool_unknown"])
    assert "pool_unknown" in [g.figure for g in (await service.grid(YEAR, as_of=MAR_9)).not_rebuilt]


@pytest.mark.asyncio
async def test_a_create_row_without_the_headcount_keys_types_as_zero_zero_and_blank() -> None:
    """PocketBase defaults them to 0, 0 and "", so real create rows omit them."""
    store = _seeded(EMMA)
    store.change_log = [
        replace(
            r,
            after={
                k: v
                for k, v in (r.after or {}).items()
                if k not in ("headcount_non_infant", "headcount_infant", "headcount_source")
            },
        )
        if r.entity == AID_REQUESTS
        else r
        for r in store.change_log
    ]
    assert all("headcount_source" not in (r.after or {}) for r in store.change_log if r.entity == AID_REQUESTS)
    today = list(store.requests.values())
    rebuilt, unrebuilt, _ = _requests_as_of(await store.fetch_change_log(YEAR, AID_REQUESTS), NOW, today)
    request = rebuilt[EMMA]
    assert unrebuilt == frozenset()
    assert (request.headcount_non_infant, request.headcount_infant, request.headcount_source) == (0, 0, "")


@pytest.mark.asyncio
async def test_the_hold_history_is_folded_to_the_date_for_past_pricing() -> None:
    store = _seeded(EMMA)
    store.hold_events.append(
        HoldEvent(
            id="hev000000000009",
            request_id=EMMA,
            kind="place",
            code=MANUAL_HOLD,
            created=_day(3, 30),
            note="Later",
            actor="registrar@example.com",
        )
    )
    service = _service(store)
    (before,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    (after,) = (await service.grid(YEAR, as_of=date(2027, 3, 31))).rows
    assert before.holds == []
    assert [h.code for h in after.holds or []] == [MANUAL_HOLD]


@pytest.mark.asyncio
async def test_a_past_rows_program_key_is_the_live_rows() -> None:
    store = _seeded(EMMA)
    service = _service(store)
    (live,) = (await service.grid(YEAR)).rows
    (past,) = (await service.grid(YEAR, as_of=MAR_9)).rows
    assert live.program_key == "summer"
    assert past.program_key == live.program_key


GHOST = "reqghost0000001"


def _log_delete(store: FakeDecisionsStore, entity_id: str, at: datetime) -> None:
    store.change_log.append(
        LogRow(
            id=f"log9{len(store.change_log):011d}",
            entity=AID_REQUESTS,
            entity_id=entity_id,
            before={"ask": 3500.0},
            after=None,
            created=at,
        )
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("update_day", [1, 20])
async def test_a_request_deleted_since_whose_history_cannot_be_replayed_is_named_not_dropped(update_day: int) -> None:
    """No create row. Whether its update came before the date or after, and it was deleted after."""
    store = _seeded(EMMA)
    log_update(store, AID_REQUESTS, GHOST, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, update_day))
    _log_delete(store, GHOST, _day(3, 25))
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    assert [row.request_id for row in out.rows] == [EMMA]
    gap = next(g for g in out.not_rebuilt if g.figure == "request_deleted")
    assert (gap.requests, gap.reason) == ([GHOST], PAST_DATE_GAPS["request_deleted"])
    assert "request_history" not in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_a_request_deleted_by_the_date_provably_wasnt_there_and_names_no_gap() -> None:
    store = _seeded(EMMA)
    log_update(store, AID_REQUESTS, GHOST, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create row
    _log_delete(store, GHOST, _day(3, 2))
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    assert [row.request_id for row in out.rows] == [EMMA]
    assert "request_deleted" not in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_a_request_whose_create_row_is_missing_and_whose_rows_all_follow_the_date_is_unrebuilt() -> None:
    store = _seeded(EMMA)
    store.change_log = [r for r in store.change_log if r.entity_id != EMMA]
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 20))
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    (row,) = out.rows  # not silently "didn't exist then"
    assert row.request_status is None
    gap = next(g for g in out.not_rebuilt if g.figure == "request_history")
    assert gap.requests == [EMMA]


@pytest.mark.asyncio
async def test_an_unrebuilt_request_takes_no_pool_from_todays_session() -> None:
    store = _seeded(EMMA)
    store.change_log = [r for r in store.change_log if r.entity_id != EMMA]
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create
    _at(
        store,
        EMMA,
        1,
        "post",
        _day(3, 5),
        amount=Decimal(1500),
        effective_on=MAR_9,
        lock_source="tick",
        rules_version=1,
        snapshot={},
    )
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    (row,) = out.rows
    assert (row.rounds[0].status, row.pool) == ("posted", None)


@pytest.mark.asyncio
@pytest.mark.parametrize("history_incomplete", [False, True])
async def test_no_rules_by_the_date_names_no_pool_unknown(history_incomplete: bool) -> None:
    store = _seeded(EMMA)
    rules = FakeRules(approved())
    rules.as_of_version = RulesHistoryIncompleteError("aid_rules 2027:1") if history_incomplete else None
    out = await _service(store, rules).budget(YEAR, as_of=MAR_9)
    figures = [g.figure for g in out.not_rebuilt]
    assert "pool_unknown" not in figures
    assert ("rules_history" in figures) is history_incomplete


@pytest.mark.asyncio
async def test_the_requests_read_completes_before_the_change_log_read_starts() -> None:
    store = _seeded(EMMA)
    order: list[str] = []
    fetch_requests, fetch_log = store.fetch_requests, store.fetch_change_log

    async def requests(*args: Any, **kwargs: Any) -> Any:
        order.append("requests-start")
        for _ in range(5):
            await asyncio.sleep(0)  # a slow read: a concurrent log read would start meanwhile
        found = await fetch_requests(*args, **kwargs)
        order.append("requests-done")
        return found

    async def log(*args: Any, **kwargs: Any) -> Any:
        order.append("log-start")
        return await fetch_log(*args, **kwargs)

    store.fetch_requests = requests  # type: ignore[method-assign]
    store.fetch_change_log = log  # type: ignore[method-assign]
    await _service(store).grid(YEAR, as_of=MAR_9)
    assert order == ["requests-start", "requests-done", *["log-start"] * 4]  # requests, applications, shares, grants


@pytest.mark.asyncio
async def test_a_failed_read_leaves_no_unretrieved_rules_exception() -> None:
    store = _seeded(EMMA)
    rules = FakeRules(approved())
    rules.as_of_version = RuntimeError("rules store down")
    seen: list[dict[str, Any]] = []
    asyncio.get_running_loop().set_exception_handler(lambda _loop, context: seen.append(context))

    async def broken(*args: Any, **kwargs: Any) -> Any:
        raise ConnectionError("log store down")

    store.fetch_change_log = broken  # type: ignore[method-assign]
    try:
        await _service(store, rules).grid(YEAR, as_of=MAR_9)
    except ConnectionError:
        pass  # (no `pytest.raises`: its traceback would keep the rules task alive)
    else:
        raise AssertionError("the failed read should have raised")
    gc.collect()
    await asyncio.sleep(0)
    assert seen == []


@pytest.mark.asyncio
async def test_round_2_asks_are_named_only_when_an_unrebuilt_request_empties_them() -> None:
    store = _seeded(EMMA)
    service = _service(store)
    clean = [g.figure for g in (await service.budget(YEAR, as_of=MAR_9)).not_rebuilt]
    assert "round2_asks" not in clean
    assert "round2_asked" not in clean
    store.change_log = [r for r in store.change_log if r.entity_id != EMMA]
    log_update(store, AID_REQUESTS, EMMA, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create
    out = await service.budget(YEAR, as_of=MAR_9)
    named = [g.figure for g in out.not_rebuilt]
    assert "round2_asks" in named
    assert "round2_asked" in named
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    assert (camp.demand.round2_asks, camp.demand.round2_asked) == (None, None)


# appeal_refusal is not a named gap: a past row simply carries none (nothing is keyed into the past), while the
# live row says why an appeal can't be keyed.
_GAP_KEYS = {*GRID_GAPS, *BUDGET_GAPS, "appeal_refusal"}


def _without_gaps(value: Any) -> Any:
    """A response dumped with every figure a past read leaves empty removed, at any depth."""
    if isinstance(value, dict):
        return {k: _without_gaps(v) for k, v in value.items() if k not in _GAP_KEYS}
    if isinstance(value, list):
        return [_without_gaps(v) for v in value]
    return value


OLIVIA, NOAH, AVA, MIA = "reqolivia000001", "reqnoah00000001", "reqava000000001", "reqmia000000001"


def _changed(store: FakeDecisionsStore, request_id: str, at: datetime, **fields: Any) -> None:
    """One request update, made to the record and logged as 4a logs it (changed fields only)."""
    old = store.requests[request_id]
    new = replace(old, **fields)
    store.requests[request_id] = new
    was, now = request_fields(old), request_fields(new)
    log_update(store, AID_REQUESTS, request_id, {k: was[k] for k in fields}, {k: now[k] for k in fields}, at)


@pytest.mark.asyncio
async def test_a_past_read_of_yesterday_equals_the_live_read_field_by_field() -> None:
    """Yesterday recorded everything live prices with (the equity copy included), so the two reads agree
    field by field outside what every past read names (the ledger's confirmation, and CampMinder's
    cancellations): across posted and unposted rounds, a request no longer live, a
    Round 2 ask, posted money outside the budget, requests changed before the date, and a request
    cancelled in Kindred before the date (SP10b-2 Decision 21: priced not live on both reads)."""
    rules = FakeRules(
        approved(with_lever(intake_rules(), "awards.decision_types.discretionary.counts_toward_budget", False))
    )
    store = _seeded(EMMA, LIAM, OLIVIA, NOAH, AVA, MIA, equity=UNKNOWN_EQUITY)
    _post_at(store, EMMA, _day(3, 5), on=date(2027, 3, 5))
    _at(store, EMMA, 1, "accept", _day(3, 6))
    _post_at(store, LIAM, _day(3, 7), on=date(2027, 3, 7))
    # Withdrawn after its Round 1 posted and a manual hold was placed: live lists neither its program,
    # its pool nor its hold, only the posted round.
    _post_at(store, OLIVIA, _day(3, 5), on=date(2027, 3, 5))
    store.hold_events.append(
        HoldEvent(
            id="hev000000000001",
            request_id=OLIVIA,
            kind="place",
            code=MANUAL_HOLD,
            created=_day(3, 6),
            note="Waiting on the school letter",
            actor="registrar@example.com",
        )
    )
    _changed(store, OLIVIA, _day(3, 10), status="withdrawn")
    # The ledger path: Emma's money is live in CampMinder; the withdrawn request's was reversed on Mar 20.
    seed_line(store, 9001, "1500", posted=_day(3, 5))
    seed_line(store, 9002, "1500", household=1000003, person=1000031, posted=_day(3, 5), reversed_at=_day(3, 20))
    # A lowered ask logged before the date, and a Round 2 ask.
    _changed(store, NOAH, _day(3, 4), ask=3500.0)
    _at(store, NOAH, 2, "ask", _day(3, 8), amount=Decimal(700), effective_on=date(2027, 3, 8))
    # Moved to the B'mitzvah session, then a posted Round 3 whose discretionary money sits outside the budget.
    _changed(store, AVA, _day(3, 9), session_cm_id=1000301)
    _at(store, AVA, 3, "award", _day(3, 11), amount=Decimal(250), decision_type="discretionary")
    _at(
        store,
        AVA,
        3,
        "post",
        _day(3, 12),
        amount=Decimal(650),
        effective_on=date(2027, 3, 12),
        lock_source="tick",
        rules_version=1,
        snapshot={
            "pool": "bmitzvah_pool",
            "counts_toward_budget": False,
            "decision_round": 3,
            "top_up": "0",
            "discretionary": "250",
        },
    )
    # Cancelled in Kindred on Mar 13, after its Round 3 posted: both reads show only the posted round.
    store.cancel_events.append(
        CancelEvent("can000000000001", AVA, "cancel", _day(3, 13), reason="schedule", in_kindred=True)
    )
    # Waiting for approved rules: live resolves no program for it.
    _changed(store, MIA, _day(3, 3), flags=({"code": FLAG_AWAITING_RULES, "detail": {"sections": ["programs"]}},))
    service = _service(store, rules)
    yesterday = NOW.date() - timedelta(days=1)
    live_grid, past_grid = await service.grid(YEAR), await service.grid(YEAR, as_of=yesterday)
    assert past_grid.as_of == yesterday
    ignored = {"as_of", "as_of_axis", "not_rebuilt"}

    def strip(model: Any) -> Any:
        return _without_gaps({k: v for k, v in model.model_dump().items() if k not in ignored})

    past_rows = [_without_gaps(row) for row in past_grid.model_dump()["rows"]]
    live_rows = [_without_gaps(row) for row in live_grid.model_dump()["rows"]]
    assert past_rows == live_rows
    by_id = {row.request_id: row for row in live_grid.rows}
    # The scenario reaches what it names.
    rows = {row.request_id: row for row in past_grid.rows}
    assert (rows[OLIVIA].request_status, rows[OLIVIA].program_key, rows[OLIVIA].pool) == ("withdrawn", None, None)
    assert [r.status for r in rows[NOAH].rounds] == ["needs_offer", "needs_offer"]
    assert (rows[NOAH].rounds[0].ask, rows[AVA].pool, rows[MIA].program_key) == (3500.0, "bmitzvah_pool", None)
    assert [r.round for r in rows[AVA].rounds] == [3]  # not live as of the date: its unposted Round 1 is gone
    assert by_id[OLIVIA].holds == []
    assert (by_id[OLIVIA].rounds[0].clawed_back, rows[OLIVIA].rounds[0].clawed_back) == (True, True)  # the ledger path
    assert (by_id[EMMA].rounds[0].clawed_back, rows[EMMA].rounds[0].clawed_back) == (False, False)
    live_budget, past_budget_ = await service.budget(YEAR), await service.budget(YEAR, as_of=yesterday)
    assert strip(past_budget_) == strip(live_budget)
    assert past_budget_.total.below.outside_budget_posted == 650.0
    assert past_budget_.total.demand.round2_asked == 700.0
    # Only the request with no resolvable pool is named as pool_unknown; nothing else is swept in.
    pool_gaps = [g for g in past_budget_.not_rebuilt if g.figure == "pool_unknown"]
    assert [g.requests for g in pool_gaps] == [[MIA]]


# --- two as-of axes (owner ruling 2026-09-30): the default cuts a Posted tick on CampMinder's post day ---


@pytest.mark.asyncio
async def test_a_tick_keyed_after_the_date_counts_on_the_default_axis_from_its_campminder_post_day() -> None:
    """CampMinder posted it March 5; staff keyed the tick March 12. Money's ledger ?as_of cuts on the post
    day, so the default axis does too; the recorded axis still shows what Kindred had that day."""
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    service = _service(store)
    default = await service.grid(YEAR, as_of=MAR_9)
    (row,) = default.rows
    assert (default.as_of_axis, row.rounds[0].status, row.total_posted) == ("campminder", "posted", 1500.0)
    assert row.rounds[0].posted_on == date(2027, 3, 5)
    recorded = await service.grid(YEAR, as_of=MAR_9, as_of_axis="recorded")
    (then,) = recorded.rows
    assert (recorded.as_of_axis, then.rounds[0].status, then.total_posted) == ("recorded", "not_rebuilt", None)


@pytest.mark.asyncio
async def test_the_budget_counts_a_back_dated_tick_as_posted_on_the_default_axis_only() -> None:
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    service = _service(store)

    def posted(out: Any) -> tuple[float, int]:
        camp = next(p for p in out.pools if p.pool == "camp_pool")
        strip = next(s for s in out.strip if s.round == 1)
        return camp.total.posted, strip.posted.requests

    default = await service.budget(YEAR, as_of=MAR_9)
    recorded = await service.budget(YEAR, as_of=MAR_9, as_of_axis="recorded")
    assert (default.as_of_axis, posted(default)) == ("campminder", (1500.0, 1))
    assert (recorded.as_of_axis, posted(recorded)) == ("recorded", (0.0, 0))


@pytest.mark.asyncio
async def test_a_back_dated_tick_later_undone_does_not_count_on_the_default_axis() -> None:
    """The ruling: a tick a person later undid was a mistake, so a back-dated one never counts."""
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    _at(store, EMMA, 1, "unpost", _day(3, 14), note="Ticked the wrong family")
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
    assert (row.rounds[0].status, row.total_posted) == ("not_rebuilt", None)


@pytest.mark.asyncio
async def test_an_accept_keyed_after_the_date_stays_off_it_on_the_default_axis() -> None:
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    _at(store, EMMA, 1, "accept", _day(3, 13))
    out = await _service(store).budget(YEAR, as_of=MAR_9)
    r1 = next(c for c in next(p for p in out.pools if p.pool == "camp_pool").rounds if c.round == 1)
    assert (r1.posted, r1.accepted) == (1500.0, 0.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("axis", ["campminder", "recorded"])
async def test_every_past_read_echoes_the_axis_it_cut_on(axis: Any) -> None:
    service = _service(_seeded(EMMA))
    grid = await service.grid(YEAR, as_of=MAR_9, as_of_axis=axis)
    budget = await service.budget(YEAR, as_of=MAR_9, as_of_axis=axis)
    remaining = await service.remaining(YEAR, as_of=MAR_9, as_of_axis=axis)
    assert [out.as_of_axis for out in (grid, budget, remaining)] == [axis] * 3


@pytest.mark.asyncio
@pytest.mark.parametrize("axis", ["campminder", "recorded"])
async def test_a_live_read_names_no_axis_whichever_is_asked(axis: Any) -> None:
    service = _service(_seeded(EMMA))
    grid = await service.grid(YEAR, as_of_axis=axis)
    budget = await service.budget(YEAR, as_of=date(2027, 4, 1), as_of_axis=axis)
    remaining = await service.remaining(YEAR, as_of_axis=axis)
    assert [out.as_of_axis for out in (grid, budget, remaining)] == [None] * 3


@pytest.mark.asyncio
async def test_a_back_dated_tick_on_a_request_recorded_after_the_date_is_named_not_dropped() -> None:
    """Fix round 1: staff keyed the request March 12 and ticked it that day, CampMinder posted March 5.
    The request can't be shown on March 9, so its posting is named, never silently dropped (D75: the
    Remaining line names it without ids)."""
    store = _seeded(EMMA, LIAM)
    store.change_log = [replace(r, created=_day(3, 12)) if r.entity_id == LIAM else r for r in store.change_log]
    _post_at(store, LIAM, _day(3, 12), on=date(2027, 3, 5))
    service = _service(store)
    grid = await service.grid(YEAR, as_of=MAR_9)
    budget = await service.budget(YEAR, as_of=MAR_9)
    remaining = await service.remaining(YEAR, as_of=MAR_9)
    assert [row.request_id for row in grid.rows] == [EMMA]  # no invented row
    for out in (grid, budget):
        gap = next(g for g in out.not_rebuilt if g.figure == "posted_before_request")
        assert (gap.requests, gap.reason) == ([LIAM], PAST_DATE_GAPS["posted_before_request"])
    gap = next(g for g in remaining.not_rebuilt if g.figure == "posted_before_request")
    assert (gap.requests, gap.reason) == ([], PAST_DATE_GAPS["posted_before_request"])
    for read in (service.grid, service.budget, service.remaining):
        recorded = await read(YEAR, as_of=MAR_9, as_of_axis="recorded")
        assert "posted_before_request" not in [g.figure for g in recorded.not_rebuilt]


@pytest.mark.asyncio
async def test_a_past_dates_grid_names_a_payer_that_applied_for_nothing() -> None:
    """⚠39: the past-date grid names every paying household, one that applied for nothing included."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=1000001)
    store.shares = [share_row(EMMA, 1000001, "50"), share_row(EMMA, 1000002, "50")]
    log_seeded(store, SEEDED)
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
    assert row.payer_count == 2
    assert [(s.household_cm_id, s.family_name) for s in row.payer_shares] == [
        (1000001, "Family 1000001"),
        (1000002, "Family 1000002"),
    ]


@pytest.mark.asyncio
async def test_a_gapped_split_row_hides_each_payers_decided_and_needs_offer_with_its_own_total() -> None:
    """A row whose total decided is masked (here equity_not_recorded) must not leak it through its payers' parts."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=1000001, person=1000011)  # no equity recorded yet: a priced-figure gap
    store.shares = [share_row(EMMA, 1000001, "50"), share_row(EMMA, 1000002, "50")]
    log_seeded(store, SEEDED)
    _post_at(store, EMMA, LATE_ON_MAR_9)
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
    assert row.total_decided is None
    assert row.payer_count == 2
    assert [(s.decided, s.needs_offer) for s in row.payer_shares] == [(None, None), (None, None)]
    assert [s.posted for s in row.payer_shares] == [750.0, 750.0]  # the posted total is still known


@pytest.mark.asyncio
async def test_a_past_row_whose_payer_shares_cant_be_replayed_has_no_payer_count_and_no_split_rows() -> None:
    """One share replays; the other exists today with no log row. Counting the replayable one alone would read the
    request as paid by one household, so the count and the split are left out (None / [])."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=1000001)
    store.shares = [share_row(EMMA, 1000001, "50")]
    log_seeded(store, SEEDED)
    store.shares.append(share_row(EMMA, 1000002, "50"))  # exists today, never logged
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
    assert row.payer_count is None
    assert row.payer_shares == []

"""The decisions reads as of a past date, from dated records (3c-1). Fictional only.

decisions_fakes figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500; Camp's Round 1
allocation is 340,000, its total 400,000. The clock is April 1 2027 (camp time). March 2027 is PST
(UTC-8): March 9 ends at 08:00 UTC on March 10."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_REQUESTS
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, _requests_as_of, as_of_instant
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import CorrectionRecord
from api.services.financial_aid_rules_service import RulesHistoryIncompleteError
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import (
    BUDGET_GAPS,
    GRID_GAPS,
    MANUAL_HOLD,
    PAST_DATE_GAPS,
    DecisionEvent,
    HoldEvent,
)
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    log_update,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
MAR_9 = date(2027, 3, 9)
LATE_ON_MAR_9 = datetime(2027, 3, 10, 7, 30, tzinfo=UTC)  # 11:30 pm PST, March 9
EARLY_ON_MAR_10 = datetime(2027, 3, 10, 8, 30, tzinfo=UTC)  # 12:30 am PST, March 10


def _day(month: int, day: int) -> datetime:
    return datetime(2027, month, day, 18, 0, tzinfo=UTC)


def _service(
    store: FakeDecisionsStore, rules: FakeRules | None = None, register_calls: list[int] | None = None
) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        if register_calls is not None:
            register_calls.append(year)
        return []

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: NOW)


def _seeded(*ids: str) -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    for n, request_id in enumerate(ids):
        seed_request(store, request_id, household=1000001 + n, person=1000011 + 10 * n)
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
    out = await service.grid(YEAR, as_of=MAR_9)
    assert (out.as_of, out.as_of_axis) == (MAR_9, "recorded")
    (row,) = out.rows
    (r1,) = row.rounds
    assert (r1.status, r1.posted, r1.accepted, r1.posted_on) == ("posted", 1500.0, False, MAR_9)
    (next_day,) = (await service.grid(YEAR, as_of=date(2027, 3, 10))).rows
    assert next_day.rounds[0].accepted is True


@pytest.mark.asyncio
async def test_as_of_cuts_on_when_kindred_recorded_a_tick_not_its_effective_date() -> None:
    """Decision 6: CampMinder posted it March 5; Ben keyed the tick March 12."""
    store = _seeded(EMMA)
    _post_at(store, EMMA, _day(3, 12), on=date(2027, 3, 5))
    (row,) = (await _service(store).grid(YEAR, as_of=MAR_9)).rows
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
async def test_a_past_date_decides_nothing_else_and_names_what_it_left_empty() -> None:
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
    assert [(g.figure, g.reason) for g in out.not_rebuilt] == [(f, PAST_DATE_GAPS[f]) for f in GRID_GAPS]


@pytest.mark.asyncio
async def test_the_budget_on_a_past_date() -> None:
    store = _seeded(EMMA, LIAM)
    _post_at(store, LIAM, _day(3, 5), on=date(2027, 3, 5))
    _at(store, LIAM, 1, "accept", _day(3, 6))
    _post_at(store, EMMA, _day(3, 15), on=date(2027, 3, 15))
    _at(store, LIAM, 2, "ask", _day(3, 8), amount=Decimal(700), effective_on=date(2027, 3, 8))
    service = _service(store)
    out = await service.budget(YEAR, as_of=MAR_9)
    assert (out.as_of, out.rules_version, out.outside_grants_off_requests) == (MAR_9, 1, None)
    camp = next(p for p in out.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.allocated, r1.posted, r1.accepted) == (340000.0, 1500.0, 1500.0)
    assert (r1.needs_offer, r1.pending_approval, r1.remaining) == (None, None, None)
    assert (camp.below.held, camp.below.outside_budget, camp.below.outside_budget_posted) == (None, None, 0.0)
    assert (camp.demand.round2_asks.requests, camp.demand.round2_asked) == (1, 700.0)  # type: ignore[union-attr]
    assert (camp.demand.round2_computed, camp.demand.round1_unmet) == (None, None)
    strip = next(s for s in out.strip if s.round == 1)
    assert (strip.posted.requests, strip.needs_offer, strip.held) == (1, None, None)
    assert [g.figure for g in out.not_rebuilt] == list(BUDGET_GAPS)
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
async def test_the_remaining_line_on_a_past_date_names_its_pools_and_no_figure() -> None:
    out = await _service(_seeded(EMMA)).remaining(YEAR, as_of=MAR_9)
    assert [(p.pool, p.remaining) for p in out.pools] == [
        ("camp_pool", None),
        ("weekend_pool", None),
        ("bmitzvah_pool", None),
    ]
    assert (out.total, out.as_of, [g.figure for g in out.not_rebuilt]) == (None, MAR_9, ["remaining"])


@pytest.mark.asyncio
async def test_a_past_read_reads_only_dated_records(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _seeded(EMMA)

    async def refuse(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("3c-1's past read reads no answers, shares or equity")

    for name in ("fetch_applications", "fetch_payer_shares", "fetch_equity_answers"):
        monkeypatch.setattr(store, name, refuse)
    calls: list[int] = []
    service = _service(store, register_calls=calls)
    await service.grid(YEAR, as_of=MAR_9)
    await service.budget(YEAR, as_of=MAR_9)
    await service.remaining(YEAR, as_of=MAR_9)
    assert calls == []


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


@pytest.mark.asyncio
@pytest.mark.parametrize("deleted_by_then", [False, True])
async def test_a_request_deleted_since_whose_history_cannot_be_replayed_is_named_not_dropped(
    deleted_by_then: bool,
) -> None:
    store = _seeded(EMMA)
    log_update(store, AID_REQUESTS, GHOST, {"ask": 4000.0}, {"ask": 3500.0}, _day(3, 1))  # no create row
    if deleted_by_then:
        store.change_log.append(
            LogRow(
                id="log999999999999",
                entity=AID_REQUESTS,
                entity_id=GHOST,
                before={"ask": 3500.0},
                after=None,
                created=_day(3, 2),
            )
        )
    out = await _service(store).grid(YEAR, as_of=MAR_9)
    assert [row.request_id for row in out.rows] == [EMMA]
    gap = next(g for g in out.not_rebuilt if g.figure == "request_deleted")
    assert (gap.requests, gap.reason) == ([GHOST], PAST_DATE_GAPS["request_deleted"])
    assert "request_history" not in [g.figure for g in out.not_rebuilt]


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
async def test_the_requests_are_read_before_the_change_log_they_settle() -> None:
    store = _seeded(EMMA)
    order: list[str] = []
    fetch_requests, fetch_log = store.fetch_requests, store.fetch_change_log

    async def requests(*args: Any, **kwargs: Any) -> Any:
        order.append("requests")
        return await fetch_requests(*args, **kwargs)

    async def log(*args: Any, **kwargs: Any) -> Any:
        order.append("log")
        return await fetch_log(*args, **kwargs)

    store.fetch_requests = requests  # type: ignore[method-assign]
    store.fetch_change_log = log  # type: ignore[method-assign]
    await _service(store).grid(YEAR, as_of=MAR_9)
    assert order == ["requests", "log"]


# held_asked is the money of the `held` gap, and outside_grants_off_requests of `outside_grants`.
_GAP_KEYS = {*GRID_GAPS, *BUDGET_GAPS, "held_asked", "outside_grants_off_requests"}


def _without_gaps(value: Any) -> Any:
    """A response dumped with every figure a past read leaves empty removed, at any depth."""
    if isinstance(value, dict):
        return {k: _without_gaps(v) for k, v in value.items() if k not in _GAP_KEYS}
    if isinstance(value, list):
        return [_without_gaps(v) for v in value]
    return value


@pytest.mark.asyncio
async def test_a_past_read_of_yesterday_equals_the_live_read_outside_its_named_gaps() -> None:
    store = _seeded(EMMA, LIAM)
    _post_at(store, EMMA, _day(3, 5), on=date(2027, 3, 5))
    _at(store, EMMA, 1, "accept", _day(3, 6))
    _post_at(store, LIAM, _day(3, 7), on=date(2027, 3, 7))
    service = _service(store)
    yesterday = NOW.date() - timedelta(days=1)
    live_grid, past_grid = await service.grid(YEAR), await service.grid(YEAR, as_of=yesterday)
    ignored = {"as_of", "as_of_axis", "not_rebuilt"}

    def strip(model: Any) -> Any:
        return _without_gaps({k: v for k, v in model.model_dump().items() if k not in ignored})

    def rows(model: Any) -> Any:
        return [
            _without_gaps({k: v for k, v in row.items() if k != "request_status"}) for row in model.model_dump()["rows"]
        ]

    assert rows(past_grid) == rows(live_grid)
    live_budget, past_budget_ = await service.budget(YEAR), await service.budget(YEAR, as_of=yesterday)
    assert strip(past_budget_) == strip(live_budget)

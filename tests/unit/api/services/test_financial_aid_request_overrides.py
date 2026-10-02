"""Staff overrides on one request (D22; main spec §10.2): a cost override with its reason code, and the Include
override, each carried as an aid_application_corrections row like the income override, so it has a reason, a
history, a change-log row, and a past date replays it. Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY, CorrectionRecord
from api.services.financial_aid_request_overrides import (
    COST_OVERRIDE,
    EXCLUDED,
    INCLUDE_OVERRIDE,
    by_request,
    cost_override,
    encode_cost_override,
    exclusion,
    parse_cost_override,
)
from bunking.financial_aid.calculator import CostOverride
from tests.unit.api.services.decisions_fakes import ACTOR, FakeDecisionsStore, log_seeded, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _service

APP = f"app{1000001:012d}"  # seed_request's application id for the Johnson household


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


def _correction(field: str, value: str, created: str, *, request_id: str = EMMA, n: int = 1) -> CorrectionRecord:
    return CorrectionRecord(
        id=f"cor{n:012d}",
        year=YEAR,
        application_id=APP,
        request_id=request_id,
        field=field,
        new_value=value,
        original_value="",
        reason="Partial session agreed with the family",
        actor=ACTOR,
        created=created,
    )


def test_a_cost_override_round_trips_its_code_and_amount() -> None:
    value = encode_cost_override("discount", Decimal(3500))
    assert value == "discount:3500.00"
    assert parse_cost_override(value) == CostOverride(amount=Decimal("3500.00"), reason="discount")


@pytest.mark.parametrize("value", ["", "discount", ":100", "discount:abc", "discount:-5"])
def test_a_malformed_cost_override_is_no_override(value: str) -> None:
    assert parse_cost_override(value) is None


def test_the_newest_row_wins_and_an_empty_value_reverts() -> None:
    set_ = _correction(COST_OVERRIDE, "discount:3500.00", "2027-02-01 17:00:00.000Z", n=1)
    revert = _correction(COST_OVERRIDE, "", "2027-02-02 17:00:00.000Z", n=2)
    assert cost_override(EMMA, [set_, revert]) is None
    earlier_revert = _correction(COST_OVERRIDE, "", "2027-01-31 17:00:00.000Z", n=3)
    assert cost_override(EMMA, [earlier_revert, set_]) == CostOverride(amount=Decimal("3500.00"), reason="discount")


def test_an_exclusion_stands_until_it_is_reverted_and_never_reaches_another_request() -> None:
    out = _correction(INCLUDE_OVERRIDE, EXCLUDED, "2027-02-01 17:00:00.000Z", n=1)
    back = _correction(INCLUDE_OVERRIDE, "", "2027-02-03 17:00:00.000Z", n=2)
    assert exclusion(EMMA, [out]) == out
    assert exclusion(EMMA, [out, back]) is None
    assert exclusion(LIAM, [out]) is None
    assert by_request([out]) == ({}, {EMMA: out})


@pytest.mark.asyncio
async def test_the_grid_prices_a_request_at_its_cost_override() -> None:
    """Session 2's catalog price is 2,000; the override prices it at 3,500 (calculator/cost.py: an override wins)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.corrections.append(_correction(COST_OVERRIDE, "discount:3500.00", "2027-02-01 17:00:00.000Z"))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.cost == 3500.0


@pytest.mark.asyncio
async def test_a_past_date_prices_the_cost_override_only_from_its_day() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    # A past read prices only what intake had recorded the equity copy for.
    store.requests[EMMA] = replace(store.requests[EMMA], equity=UNKNOWN_EQUITY)
    log_seeded(store, datetime(2027, 1, 5, 17, 0, tzinfo=UTC))
    store.corrections.append(_correction(COST_OVERRIDE, "discount:3500.00", "2027-02-01 17:00:00.000Z"))
    before = (await _service(store).grid(YEAR, as_of=date(2027, 1, 20))).rows[0]
    after = (await _service(store).grid(YEAR, as_of=date(2027, 2, 10))).rows[0]
    assert (before.cost, after.cost) == (2000.0, 3500.0)


@pytest.mark.asyncio
async def test_a_row_shows_its_cost_override_with_the_code_note_and_who() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.corrections.append(_correction(COST_OVERRIDE, "discount:3500.00", "2027-02-01 17:00:00.000Z"))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.cost_override is not None
    assert (row.cost_override.amount, row.cost_override.reason_code, row.cost_override.actor) == (
        3500.0,
        "discount",
        ACTOR,
    )
    assert row.cost_override.note == "Partial session agreed with the family"


@pytest.mark.asyncio
async def test_an_excluded_row_is_not_included_until_it_is_put_back() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.corrections.append(_correction(INCLUDE_OVERRIDE, EXCLUDED, "2027-02-01 17:00:00.000Z", n=1))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert (row.included, row.include_override is not None) == (False, True)
    store.corrections.append(_correction(INCLUDE_OVERRIDE, "", "2027-02-02 17:00:00.000Z", n=2))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert (row.included, row.include_override) == (True, None)


@pytest.mark.asyncio
async def test_an_exclusion_moves_no_budget_figure() -> None:
    """Decision 5 (⚠): the Include override reaches the household band only, never pricing, Rounds & budget or the
    Remaining line."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    before = await _service(store).budget(YEAR)
    store.corrections.append(_correction(INCLUDE_OVERRIDE, EXCLUDED, "2027-02-01 17:00:00.000Z"))
    assert await _service(store).budget(YEAR) == before


@pytest.mark.asyncio
async def test_a_past_read_leaves_included_empty_and_names_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, datetime(2027, 1, 5, 17, 0, tzinfo=UTC))
    grid = await _service(store).grid(YEAR, as_of=date(2027, 3, 1))
    assert grid.rows[0].included is None
    assert "included" in [gap.figure for gap in grid.not_rebuilt]

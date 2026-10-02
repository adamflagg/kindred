"""Staff cost override on one request (D22; main spec §10.2), carried as an aid_application_corrections row like the
income override, so it has a reason, a history, a change-log row, and a past date replays it. There is no Include
override (owner ruling): Include is derived, live and not cancelled. Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

import api.schemas.financial_aid_decisions as schemas
import api.services.financial_aid_request_overrides as overrides_module
from api.schemas.financial_aid_decisions import CancellationIn, CostOverrideIn, GridRowOut
from api.services.financial_aid_decisions_service import (
    CANCELLED_IN_KINDRED,
    DecisionNotFoundError,
    DecisionRefusedError,
)
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY, CorrectionRecord
from api.services.financial_aid_request_overrides import (
    COST_OVERRIDE,
    by_request,
    cost_override,
    encode_cost_override,
    parse_cost_override,
)
from bunking.financial_aid.calculator import CostOverride
from tests.unit.api.services.decisions_fakes import ACTOR, FakeDecisionsStore, FakeRules, log_seeded, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _posted, _service

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


def test_there_is_no_include_override() -> None:
    """Owner ruling: Include is derived (live and not cancelled); staff have no override on it."""
    assert not hasattr(overrides_module, "INCLUDE_OVERRIDE")
    assert not hasattr(overrides_module, "EXCLUDED")
    assert not hasattr(overrides_module, "exclusion")
    assert "include_override" not in GridRowOut.model_fields
    assert not hasattr(_service(FakeDecisionsStore()), "set_include")
    legacy = _correction("include_override", "excluded", "2027-02-01 17:00:00.000Z", n=1)
    assert by_request([legacy]) == {}


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
async def test_a_legacy_include_override_row_excludes_nothing() -> None:
    """A correction row with field include_override already in the data is no longer read: the request stays included
    and no budget figure moves."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    before_budget = await _service(store).budget(YEAR)
    store.corrections.append(_correction("include_override", "excluded", "2027-02-01 17:00:00.000Z"))
    (emma, _liam) = sorted((await _service(store).grid(YEAR)).rows, key=lambda r: r.request_id != EMMA)
    assert emma.included is True
    assert "include_override" not in emma.model_dump()
    assert await _service(store).budget(YEAR) == before_budget


@pytest.mark.asyncio
async def test_a_past_read_leaves_included_empty_and_names_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, datetime(2027, 1, 5, 17, 0, tzinfo=UTC))
    grid = await _service(store).grid(YEAR, as_of=date(2027, 3, 1))
    assert grid.rows[0].included is None
    assert "included" in [gap.figure for gap in grid.not_rebuilt]


NOTE = "Partial session agreed with the family"
OVERRIDE = CostOverrideIn(amount=Decimal(3500), reason_code="discount", note=NOTE)


@pytest.mark.asyncio
async def test_a_cost_override_is_one_correction_row_with_its_log_line_and_the_grid_prices_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    out = await service.set_cost_override(EMMA, OVERRIDE, ACTOR)
    assert (out.written, out.unchanged) == (1, 0)
    assert out.operation_id
    (write,) = store.operations[-1]
    assert write.data is not None
    assert (write.collection, write.data["field"], write.data["new_value"], write.data["request"]) == (
        "aid_application_corrections",
        "cost_override",
        "discount:3500.00",
        EMMA,
    )
    (log,) = store.log
    assert (log["entity_id"], log["reason"], log["operation_id"]) == (f"{EMMA}:cost_override", NOTE, out.operation_id)
    (row,) = (await service.grid(YEAR)).rows
    assert row.cost == 3500.0


@pytest.mark.asyncio
async def test_retyping_the_standing_cost_override_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_cost_override(EMMA, OVERRIDE, ACTOR)
    writes = len(store.operations)
    again = await service.set_cost_override(EMMA, OVERRIDE, ACTOR)
    assert (again.written, again.unchanged, again.operation_id) == (0, 1, "")
    assert len(store.operations) == writes  # a no-op never reaches commit, so never change_row


@pytest.mark.asyncio
async def test_retyping_a_standing_override_with_a_new_note_writes_the_note() -> None:
    """The same value with a changed note is a real edit (the reason is the audit trail); identical value and note
    stay a no-op."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_cost_override(EMMA, OVERRIDE, ACTOR)
    rows = len(store.corrections)
    reworded = OVERRIDE.model_copy(update={"note": "A clearer reason for the same price"})
    assert (await service.set_cost_override(EMMA, reworded, ACTOR)).written == 1
    assert len(store.corrections) == rows + 1
    assert (await service.set_cost_override(EMMA, reworded, ACTOR)).written == 0
    assert len(store.corrections) == rows + 1


@pytest.mark.asyncio
async def test_a_reason_code_the_season_doesnt_list_is_refused_naming_its_codes() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    whim = CostOverrideIn(amount=Decimal(3500), reason_code="whim", note=NOTE)
    with pytest.raises(DecisionRefusedError, match=r"whim is not one of 2027's cost override reasons .*discount"):
        await _service(store).set_cost_override(EMMA, whim, ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_clearing_an_override_writes_a_revert_and_clearing_none_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    clear = CostOverrideIn(amount=None, note="Back to the catalog price")
    assert (await service.set_cost_override(EMMA, clear, ACTOR)).written == 0
    await service.set_cost_override(EMMA, OVERRIDE, ACTOR)
    assert (await service.set_cost_override(EMMA, clear, ACTOR)).written == 1
    (row,) = (await service.grid(YEAR)).rows
    assert (row.cost, row.cost_override) == (2000.0, None)


@pytest.mark.asyncio
async def test_a_cost_override_needs_approved_rules() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(DecisionRefusedError, match="not approved yet"):
        await _service(store, FakeRules(None)).set_cost_override(EMMA, OVERRIDE, ACTOR)


@pytest.mark.asyncio
async def test_a_cost_override_on_a_request_cancelled_in_kindred_is_refused_in_the_writes_words() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="medical"), ACTOR)
    with pytest.raises(DecisionRefusedError, match=CANCELLED_IN_KINDRED):
        await service.set_cost_override(EMMA, OVERRIDE, ACTOR)


@pytest.mark.asyncio
async def test_an_unknown_request_is_not_found() -> None:
    with pytest.raises(DecisionNotFoundError):
        await _service(FakeDecisionsStore()).set_cost_override("reqnone00000001", OVERRIDE, ACTOR)


@pytest.mark.parametrize(
    "body",
    [
        {"amount": "3500", "note": "x"},  # an amount needs its code (D22)
        {"amount": None, "reason_code": "discount", "note": "x"},  # clearing takes no code
        {"amount": "3500", "reason_code": "discount", "note": "  "},  # the note is required
        {"amount": "3500", "reason_code": "Discount", "note": "x"},  # a code is a key
    ],
)
def test_a_cost_override_body_is_validated(body: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        CostOverrideIn.model_validate(body)


@pytest.mark.asyncio
async def test_a_cost_override_on_a_request_with_a_posted_round_succeeds_but_warns() -> None:
    """It changes what the later rounds and "would change by" read, never the posted money; the response says so."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    out = await _service(store).set_cost_override(EMMA, OVERRIDE, ACTOR)
    assert out.written == 1
    assert out.warning is not None
    assert "posted" in out.warning
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.rounds[0].posted == 1500.0  # the posted money doesn't move


@pytest.mark.asyncio
async def test_a_cost_override_with_nothing_posted_carries_no_warning() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    out = await _service(store).set_cost_override(EMMA, OVERRIDE, ACTOR)
    assert out.warning is None

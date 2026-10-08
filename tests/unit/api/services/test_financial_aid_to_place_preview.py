"""Money > To place: the placement preview (campership slice 3, ask 8; §4.10; D12, D16, D146, D152). A typed Split…
or Place on another request is worked out by the plan the write runs, and writes nothing of its own (its pricing
records the grant placement log, as GET /to-place and Today do: Group 4 Q2). Fictional only. Session 2 (1000101)
gives a tier-2 family Round 1 = 1,500; Emma (1000011) and her brother (1000012) share household 1000001."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_GRANT_PLACEMENTS
from api.schemas.financial_aid_to_place import (
    PlaceLineIn,
    PlacePartIn,
    PlacePreviewIn,
    PlacePreviewOut,
    SuggestionOut,
)
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grant_placements import PLACEMENT_ACTOR
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_to_place import LeftLine
from api.services.financial_aid_to_place_service import ToPlaceService
from bunking.financial_aid.errors import FinancialAidError
from tests.unit.api.services.decisions_fakes import ACTOR, T0, FakeRules, approved, grant_row, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import LIAM
from tests.unit.api.services.test_financial_aid_to_place_changed_since import NOT_TICKED_9001, _correction, _not_ticked
from tests.unit.api.services.to_place_fakes import (
    EMMA,
    MAR8,
    FakeLabels,
    FakeToPlaceStore,
    one_line,
    to_place_service,
)


def _preview(*parts: tuple[str, str], note: str = "") -> PlacePreviewIn:
    return PlacePreviewIn(parts=[PlacePartIn(request_id=r, amount=Decimal(a)) for r, a in parts], note=note)


def _place(*parts: tuple[str, str], expected: float | None = None) -> PlaceLineIn:
    return PlaceLineIn(
        parts=[PlacePartIn(request_id=r, amount=Decimal(a)) for r, a in parts],
        expected_locked=Decimal(str(expected)) if expected is not None else None,
    )


def _siblings(amount: str = "3000") -> FakeToPlaceStore:
    """Emma and her brother each hold a Session 2 request; one family-level line of `amount` is posted Mar 8."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, amount, person=0, posted=MAR8)
    return store


def _ticks(rows: Sequence[Any]) -> list[tuple[str, int, float]]:
    return sorted((t.request_id, t.round, t.amount) for t in rows)


def test_the_preview_carries_exactly_the_suggestions_would_fields() -> None:
    """The frontend renders a typed placement's preview with Confirm's own words (SuggestionOut.would_*)."""
    would = {name for name in SuggestionOut.model_fields if name.startswith("would_")}
    assert would == {name for name in PlacePreviewOut.model_fields if name.startswith("would_")}
    assert would == {"would_tick", "would_lock", "would_leave", "would_not_tick"}


@pytest.mark.asyncio
async def test_a_typed_split_previews_what_it_ticks_and_locks_and_the_write_does_exactly_that() -> None:
    store = _siblings()
    service = to_place_service(store)
    preview = await service.preview(YEAR, 9001, _preview((EMMA, "1500"), (LIAM, "1500")), ACTOR)
    assert _ticks(preview.would_tick) == [(EMMA, 1, 1500.0), (LIAM, 1, 1500.0)]
    assert (preview.would_lock, preview.would_leave, preview.would_not_tick) == (3000.0, [], [])
    assert [(p.request_id, p.amount) for p in preview.parts] == [(EMMA, 1500.0), (LIAM, 1500.0)]
    assert store.operations == []
    placed = await service.place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1500"), expected=preview.would_lock), ACTOR)
    assert _ticks(placed.ticked) == _ticks(preview.would_tick)


@pytest.mark.asyncio
async def test_a_whole_line_short_of_the_round_previews_the_round_left_for_a_person() -> None:
    """D146: a round ticks only when CampMinder holds its full decided amount; the preview says why it won't."""
    store = one_line("1000")
    service = to_place_service(store)
    preview = await service.preview(YEAR, 9001, _preview((EMMA, "1000")), ACTOR)
    assert (preview.would_tick, preview.would_lock) == ([], 0.0)
    assert [(x.request_id, x.round, x.why) for x in preview.would_leave] == [
        (
            EMMA,
            1,
            "CampMinder holds $1,000 on this request; Round 1 needs $1,500: mark it posted by hand if that is right",
        )
    ]
    placed = await service.place(YEAR, 9001, _place((EMMA, "1000")), ACTOR)
    assert placed.left_to_tick == preview.would_leave


@pytest.mark.asyncio
async def test_a_withheld_tick_previews_as_the_write_withholds_it() -> None:
    """D16 option (a): the money is placed and only the tick is withheld. The preview locks 0 and names the round,
    and the write accepts that 0 as expected_locked, because both read the same plan."""
    store = one_line()
    _correction(store)
    service = to_place_service(store)
    preview = await service.preview(YEAR, 9001, _preview((EMMA, "1500")), ACTOR)
    assert (preview.would_tick, preview.would_lock) == ([], 0.0)
    assert _not_ticked(preview.would_not_tick) == [NOT_TICKED_9001]
    placed = await service.place(YEAR, 9001, _place((EMMA, "1500"), expected=preview.would_lock), ACTOR)
    assert _not_ticked(placed.not_ticked) == _not_ticked(preview.would_not_tick)


@pytest.mark.asyncio
async def test_a_preview_writes_nothing_not_even_the_end_of_a_leave() -> None:
    """The plan builds the placement's override and the end of the leave in memory; the preview drops both. No
    operation, log row, decision event, override or leave changes."""
    store = one_line()
    store.left[9001] = LeftLine(id="lft000000000001", transaction_cm_id=9001, note="Pays in June")
    events, log = list(store.events), list(store.log)
    service = to_place_service(store)
    preview = await service.preview(YEAR, 9001, _preview((EMMA, "1500"), note="Placed by the registrar"), ACTOR)
    assert _ticks(preview.would_tick) == [(EMMA, 1, 1500.0)]
    assert store.operations == []
    assert (store.events, store.log, store.override_rows) == (events, log, {})
    assert [line.transaction_cm_id for line in (await service.read(YEAR)).left] == [9001]


@pytest.mark.asyncio
async def test_a_previews_pricing_records_only_the_grant_placement_log() -> None:
    """Group 4 Q2: pricing the season logs where the register placed each grant, as system:grant-placement, strictly.
    The preview prices the season (so GET /to-place and Today's reads already do this too). With a register grant
    seeded, every write the preview makes is that log's, on aid_grant_placements, and nothing else; the to_place fakes
    price with no grants, which is why the other preview tests cannot see it."""
    store = one_line("1000")
    register = [replace(grant_row(EMMA, "500"), transaction_cm_id=9002)]
    events = list(store.events)

    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    service = ToPlaceService(
        FinancialAidDecisionsService(store, FakeRules(approved()), rows, clock=lambda: T0),
        store,
        labels=FakeLabels(),
        clock=lambda: T0,
    )
    await service.preview(YEAR, 9001, _preview((EMMA, "1000")), ACTOR)
    writes = [write for operation in store.operations for write in operation]
    assert writes  # not vacuous: the seeded grant's placement was logged
    assert {write.collection for write in writes} == {AID_GRANT_PLACEMENTS}
    assert all(write.data is not None and write.data["actor"] == PLACEMENT_ACTOR for write in writes)
    assert [row["actor"] for row in store.log] == [PLACEMENT_ACTOR] * len(writes)
    assert (store.override_rows, store.events) == ({}, events)
    operations = len(store.operations)
    await service.preview(YEAR, 9001, _preview((EMMA, "1000")), ACTOR)
    assert len(store.operations) == operations  # the log already holds it: a second preview writes nothing


@pytest.mark.parametrize(
    ("year", "txn", "parts"),
    [
        (YEAR, 9001, (("reqemma00000001", "1400"),)),  # short of the line
        (YEAR, 9001, (("reqnobody000001", "1500"),)),  # not a request this family holds
        (YEAR, 9999, (("reqemma00000001", "1500"),)),  # no such line (404)
        (2026, 9001, (("reqemma00000001", "1500"),)),  # before To place
    ],
)
@pytest.mark.asyncio
async def test_a_preview_refuses_with_the_writes_own_words(
    year: int, txn: int, parts: tuple[tuple[str, str], ...]
) -> None:
    store = one_line()
    service = to_place_service(store)
    with pytest.raises(FinancialAidError) as wrote:
        await service.place(year, txn, _place(*parts), ACTOR)
    with pytest.raises(FinancialAidError) as previewed:
        await service.preview(year, txn, _preview(*parts), ACTOR)
    assert (type(previewed.value), str(previewed.value)) == (type(wrote.value), str(wrote.value))
    assert store.operations == []

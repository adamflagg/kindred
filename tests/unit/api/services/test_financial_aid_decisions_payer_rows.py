"""The Requests grid's split rows (⚠39, owner ruling 2026-10-01): each row says how many households pay it, and
for a split request each payer's part, named, including a paying household that applied for nothing. Fictional
only. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500."""

from __future__ import annotations

from datetime import date

import pytest

import api.schemas.financial_aid_decisions as schemas
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _service

JOHNSON, GARCIA = 1000001, 1000002


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


@pytest.mark.asyncio
async def test_a_split_rows_payers_are_counted_and_named_even_one_that_applied_for_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON)
    store.shares = [share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "50")]
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.payer_count == 2
    assert [(s.household_cm_id, s.family_name) for s in row.payer_shares] == [
        (JOHNSON, "Family 1000001"),
        (GARCIA, "Family 1000002"),  # Garcia applied for nothing: the grid fetched its name
    ]
    assert [s.share_pct for s in row.payer_shares] == [50.0, 50.0]


@pytest.mark.asyncio
async def test_a_split_rows_parts_add_up_to_its_decided_amount() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON)
    store.shares = [share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "50")]
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.total_decided is not None
    assert sum(s.decided or 0 for s in row.payer_shares) == row.total_decided
    assert sum(s.needs_offer or 0 for s in row.payer_shares) == row.total_decided  # nothing posted yet


@pytest.mark.asyncio
async def test_a_one_payer_row_counts_one_and_lists_no_split() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON)  # a 100% share of its own
    (row,) = (await _service(store).grid(YEAR)).rows
    assert (row.payer_count, row.payer_shares) == (1, [])

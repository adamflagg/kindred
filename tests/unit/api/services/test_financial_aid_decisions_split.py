"""A split line in the decisions reads (campership SP11-rest; D12, D54, D59, D81): the season places
each part on its own request, a past read replays the split from aid_change_log, and the repository
reads it. Fictional only. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, line_override
from api.services.financial_aid_decisions_service import ROUND_SECTIONS, FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reconciliation import LedgerTick, SplitPart
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    seed_line,
    seed_request,
    seed_split,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _posted, _service

SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
MAR9 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
JUN10 = datetime(2027, 6, 10, 18, 0, tzinfo=UTC)
JUL1 = datetime(2027, 7, 1, 18, 0, tzinfo=UTC)
EMMA_PART = SplitPart(1000011, 1000101, "summer", Decimal(1500))
LIAM_PART = SplitPart(1000012, 1000101, "summer", Decimal(1500))


def _siblings_posted(store: FakeDecisionsStore) -> None:
    """Two siblings in one household, each with Round 1 ticked Posted at 1,500 on Mar 9."""
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    log_seeded(store, SEEDED)
    _posted(store, EMMA, 1, "1500")
    _posted(store, LIAM, 1, "1500")


@pytest.mark.asyncio
async def test_the_season_places_each_part_of_a_split_line_on_its_own_request() -> None:
    store = FakeDecisionsStore()
    _siblings_posted(store)
    store.synced_at = JUL1  # the ticks are older than the last sync: nothing awaits it
    seed_line(store, 9001, "3000", person=0, posted=MAR9)
    seed_split(store, 9001, (EMMA_PART, LIAM_PART), MAR9)
    rows = {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}
    for request_id in (EMMA, LIAM):
        confirmation = rows[request_id].confirmation
        assert confirmation is not None
        assert (confirmation.status, confirmation.in_campminder, confirmation.family_unplaced) == (
            "confirmed",
            1500.0,
            0.0,
        )


@pytest.mark.asyncio
async def test_without_the_split_the_same_line_waits_at_family_level() -> None:
    store = FakeDecisionsStore()
    _siblings_posted(store)
    store.synced_at = JUL1
    seed_line(store, 9001, "3000", person=0, posted=MAR9)
    rows = {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}
    confirmation = rows[EMMA].confirmation
    assert confirmation is not None
    assert (confirmation.status, confirmation.family_unplaced) == ("not_in_campminder", 3000.0)


async def _r1_posted(store: FakeDecisionsStore, day: date) -> float | None:
    async def no_grants(year: int) -> list[RegisterRow]:
        return []

    service = FinancialAidDecisionsService(store, FakeRules(approved()), no_grants, clock=lambda: JUL1)
    budget = await service.budget(YEAR, as_of=day)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    return next(c for c in camp.rounds if c.round == 1).posted


@pytest.mark.asyncio
async def test_a_split_made_after_the_date_does_not_place_the_line_on_it() -> None:
    """3c's as-of reads replay the split like any placement: CampMinder reversed the household's line on
    Jun 1, but only once the split put its parts on the two requests (Jun 10) does that claw both back."""
    store = FakeDecisionsStore()
    _siblings_posted(store)
    seed_line(store, 9001, "3000", person=0, posted=MAR9, reversed_at=JUN1)
    seed_split(store, 9001, (EMMA_PART, LIAM_PART), JUN10)
    assert await _r1_posted(store, date(2027, 6, 5)) == 3000.0
    assert await _r1_posted(store, date(2027, 6, 12)) == 0.0


def test_an_override_record_carries_its_split() -> None:
    record = SimpleNamespace(
        id="ovr000000009001",
        transaction_cm_id=9001,
        attributed_person_cm_id=0,
        attributed_session_cm_id=0,
        program_family="",
        split=[
            {"person_cm_id": 1000011, "session_cm_id": 1000101, "program_family": "summer", "amount": "1500"},
            {"person_cm_id": 1000012, "session_cm_id": 1000101, "program_family": "summer", "amount": "1500"},
        ],
    )
    override = line_override(record)
    assert override.split == (EMMA_PART, LIAM_PART)
    assert override.fields()["split"] == [EMMA_PART.fields(), LIAM_PART.fields()]
    plain = line_override(SimpleNamespace(**{**vars(record), "split": None, "attributed_person_cm_id": 1000011}))
    assert plain.split == ()
    assert "split" not in plain.fields()


@pytest.mark.asyncio
async def test_the_repository_reads_only_the_split_overrides_as_splits() -> None:
    split = SimpleNamespace(
        id="ovr000000009001",
        transaction_cm_id=9001,
        attributed_person_cm_id=0,
        attributed_session_cm_id=0,
        program_family="",
        split=[EMMA_PART.fields(), LIAM_PART.fields()],
    )
    whole = SimpleNamespace(
        id="ovr000000009002",
        transaction_cm_id=9002,
        attributed_person_cm_id=1000011,
        attributed_session_cm_id=1000101,
        program_family="summer",
        split=None,
    )
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [split, whole]
    assert await FinancialAidDecisionsRepository(pb).fetch_line_splits(YEAR) == {9001: (EMMA_PART, LIAM_PART)}


@pytest.mark.asyncio
async def test_tick_writes_lock_each_round_at_its_decided_amount_with_the_sections_it_reads() -> None:
    """The rows a tick from CampMinder's money writes (D78, D81): To place's placement and the ledger share them."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    season = await service.season(YEAR)
    tick = LedgerTick(EMMA, 1, Decimal(1500), date(2027, 3, 8), Decimal(1500))
    posts, locks, not_locked = await service.tick_writes(
        season, [tick], ACTOR, lock_source="placement", note=lambda t: f"placed {t.round}"
    )
    (post,) = posts
    assert post.data is not None
    assert {k: post.data[k] for k in ("event", "amount", "lock_source", "effective_on", "actor", "note")} == {
        "event": "post",
        "amount": Decimal(1500),
        "lock_source": "placement",
        "effective_on": date(2027, 3, 8),
        "actor": ACTOR,
        "note": "placed 1",
    }
    assert [w.entity_id for w in locks] == [f"{YEAR}:1:{section}" for section in sorted(ROUND_SECTIONS[1])]
    assert not_locked == []

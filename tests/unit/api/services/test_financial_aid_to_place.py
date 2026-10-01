"""Money › To place, the pure core (campership SP11-rest; clean spec §8.1; D12, D16, D26, D58, D62, D81).
The pool, its reasons and Kindred's suggestions with their evidence, over a season the decisions service
priced. Fictional only. Figures: Session 2 (1000101) gives a tier-2 family Round 1 = 1,500; River `n`
Ridge Quest (1000106) gives 100 (decisions_fakes). Emma (1000011) and Liam (1000012) are siblings in
household 1000001."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from api.services.financial_aid_decisions_service import Season
from api.services.financial_aid_reconciliation import SplitPart
from api.services.financial_aid_to_place import (
    MISMATCH_FLAG,
    LineDetail,
    Part,
    page_scope,
    proportional,
    simulate,
    to_place,
)
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    seed_line,
    seed_override,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _posted, _service

MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)
MAR9 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
EMMA_QUEST = "reqemmaq0000001"


async def _season(store: FakeDecisionsStore) -> Season:
    return await _service(store).season(YEAR)


def _siblings(store: FakeDecisionsStore) -> None:
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)


@pytest.mark.asyncio
async def test_a_summer_household_line_with_one_request_waits_with_that_request_suggested() -> None:
    """SP10b Decision 3: it never places itself, but it has only one place to go (D12: a suggestion)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    (item,) = to_place(await _season(store), {})
    assert (item.line.transaction_cm_id, item.unplaced, item.reason) == (9001, Decimal(1500), "several")
    assert [c.request_id for c in item.candidates] == [EMMA]
    assert item.suggestion is not None
    assert item.suggestion.parts == (Part(EMMA, Decimal(1500)),)
    assert [e.kind for e in item.suggestion.evidence] == ["amount", "only_request"]


@pytest.mark.asyncio
async def test_two_requests_needing_the_same_amount_get_no_suggestion() -> None:
    """Either sibling could take it and nothing tells them apart: Kindred never guesses (D12, D16)."""
    store = FakeDecisionsStore()
    _siblings(store)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    (item,) = to_place(await _season(store), {})
    assert [c.request_id for c in item.candidates] == [EMMA, LIAM]
    assert [c.still_due for c in item.candidates] == [Decimal(1500), Decimal(1500)]
    assert item.suggestion is None


@pytest.mark.asyncio
async def test_the_day_a_round_was_ticked_breaks_a_tie_on_the_amount() -> None:
    """Emma's Round 1 was ticked Posted on Mar 9 and nothing is in CampMinder for her yet; the family's
    line posted that day is hers (D12's "the date")."""
    store = FakeDecisionsStore()
    _siblings(store)
    _posted(store, EMMA, 1, "1500")  # ticked, effective Mar 9
    seed_line(store, 9001, "1500", person=0, posted=MAR9)
    (item,) = to_place(await _season(store), {})
    assert item.suggestion is not None
    assert item.suggestion.parts == (Part(EMMA, Decimal(1500)),)
    assert [e.kind for e in item.suggestion.evidence] == ["amount", "date"]


@pytest.mark.asyncio
async def test_a_line_for_the_whole_family_is_suggested_as_a_split_by_what_each_still_needs() -> None:
    store = FakeDecisionsStore()
    _siblings(store)
    seed_line(store, 9001, "3000", person=0, posted=MAR8)
    (item,) = to_place(await _season(store), {})
    assert item.suggestion is not None
    assert item.suggestion.parts == (Part(EMMA, Decimal(1500)), Part(LIAM, Decimal(1500)))
    assert [e.kind for e in item.suggestion.evidence] == ["amount"]


@pytest.mark.asyncio
async def test_a_line_that_matches_nothing_is_suggested_as_a_split_in_proportion_to_the_decided_amounts() -> None:
    """D12: a split proportional to the decided amounts, a locked round's at the amount it locked."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, EMMA_QUEST, session=1000106)  # Round 1 decided 100
    _posted(store, EMMA, 1, "1500")  # locked at 1,500
    seed_line(store, 9001, "1600", person=0, posted=MAR8)
    seed_line(store, 9002, "1400", person=0, posted=MAR8)  # a second line: no single line matches
    items = {i.line.transaction_cm_id: i for i in to_place(await _season(store), {})}
    suggestion = items[9002].suggestion
    assert suggestion is not None
    assert [e.kind for e in suggestion.evidence] == ["proportional"]
    assert suggestion.parts == (Part(EMMA, Decimal("1312.50")), Part(EMMA_QUEST, Decimal("87.50")))
    whole = items[9001].suggestion  # 1,500 + 100 = 1,600: together exactly what both still need
    assert whole is not None
    assert whole.parts == (Part(EMMA, Decimal(1500)), Part(EMMA_QUEST, Decimal(100)))


def test_a_proportional_split_is_exact_to_the_cent() -> None:
    parts = proportional(Decimal("1000.01"), [("a", Decimal(1)), ("b", Decimal(1)), ("c", Decimal(1))])
    assert parts == (Part("a", Decimal("333.34")), Part("b", Decimal("333.34")), Part("c", Decimal("333.33")))
    assert sum(p.amount for p in parts) == Decimal("1000.01")


@pytest.mark.asyncio
async def test_a_line_posted_to_a_camper_with_two_requests_is_suggested_on_the_one_it_matches() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, EMMA_QUEST, session=1000106)
    seed_line(store, 9001, "100", person=1000011, posted=MAR8)
    (item,) = to_place(await _season(store), {})
    assert item.suggestion is not None
    assert item.suggestion.parts == (Part(EMMA_QUEST, Decimal(100)),)
    assert [e.kind for e in item.suggestion.evidence] == ["amount", "person"]


@pytest.mark.asyncio
async def test_camp_aid_to_a_household_with_no_request_has_no_request_behind_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "700", household=1000009, person=0, posted=MAR8)
    (item,) = to_place(await _season(store), {})
    assert (item.reason, item.candidates, item.suggestion) == ("no_request", (), None)


@pytest.mark.asyncio
async def test_a_description_naming_another_program_is_its_own_reason() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    details = {9001: LineDetail(9001, "camp fa quest", (MISMATCH_FLAG,))}
    (item,) = to_place(await _season(store), details)
    assert item.reason == "program_mismatch"


@pytest.mark.asyncio
async def test_only_live_lines_no_request_takes_are_in_the_pool() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)  # Emma's only request takes it
    seed_line(store, 9002, "1500", person=0, posted=MAR8, reversed_at=JUN1)  # reversed: history only
    seed_line(store, 9003, "300", person=0, posted=MAR8)
    seed_override(store, 9004, 1000011, MAR9, session=1000101, family="summer")
    seed_line(store, 9004, "200", person=0, posted=MAR8)  # placed by a person
    assert [i.line.transaction_cm_id for i in to_place(await _season(store), {})] == [9003]


@pytest.mark.asyncio
async def test_the_page_scope_follows_the_money_both_ways() -> None:
    """D26: the household, every household holding a share of its requests, and the households whose
    requests it pays a share of. Not a sibling's other home with no share."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    store.shares.append(share_row(EMMA, 1000004, "40"))
    season = await _season(store)
    assert page_scope(1000001, season) == frozenset({1000001, 1000004})
    assert page_scope(1000004, season) == frozenset({1000001, 1000004})
    assert page_scope(1000002, season) == frozenset({1000002})


@pytest.mark.asyncio
async def test_simulate_shows_where_a_placement_or_a_split_would_land() -> None:
    store = FakeDecisionsStore()
    _siblings(store)
    seed_line(store, 9001, "3000", person=0, posted=MAR8)
    season = await _season(store)
    parts = (SplitPart(1000011, 1000101, "summer", Decimal(1000)), SplitPart(1000012, 1000101, "summer", Decimal(2000)))
    ledger = simulate(season, {}, {9001: parts})
    assert [ln.amount for ln in ledger.lines(EMMA)] == [Decimal(1000)]
    assert [ln.amount for ln in ledger.lines(LIAM)] == [Decimal(2000)]
    assert ledger.family_unplaced([1000001]) == 0
    assert season.ledger.family_unplaced([1000001]) == Decimal(3000)  # the season itself is untouched

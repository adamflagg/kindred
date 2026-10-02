"""A withheld round keeps its posting-day price (D152 follow-up; owner, B1 Q1 2026-10-02; Group 3a Q5; S1 Q1).

A placement whose round D16 withholds leaves it for a person. The overnight tick leaves it too, and a person's tick
locks the higher of its decided amount at the end of the posting day (3c-2's past pricing, where it rebuilds the
request exactly) and today's. Every other tick locks exactly what it locked before. Fictional only: Emma (person
1000011, household 1000001) holds a Session 2 request, which a $60,000 family prices at Round 1 = 1,500 (tier 2) and
a $100,000 family at 1,100 (tier 3). One camp-aid line, posted Mar 8 (camp time); today is Mar 9."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.services.financial_aid_decisions_service import as_of_instant
from api.services.financial_aid_reconciliation import LedgerTick
from api.services.financial_aid_to_place import SYNC_HISTORY, on_placed_money
from tests.unit.api.services.decisions_fakes import ACTOR, T0, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_to_place_changed_since import _place
from tests.unit.api.services.to_place_fakes import EMMA, MAR8, FakeToPlaceStore, one_line, to_place_service

SIBLING = "reqliam00000001"  # Emma's brother (person 1000012), same household
POSTED_ON = date(2027, 3, 8)


def _tick(request_id: str = EMMA, posted_on: date = POSTED_ON) -> LedgerTick:
    return LedgerTick(request_id, 1, Decimal(1500), posted_on, Decimal(1500))


@pytest.mark.asyncio
async def test_only_money_a_person_placed_is_the_placements_to_tick() -> None:
    """D152: a round on a line a person placed, whole or split, is the placement's (D16's check governs it wherever it
    ticks). One on a line CampMinder posted to the camper is the overnight tick's own, priced at the sync."""
    whole = one_line()
    await to_place_service(whole).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    split = FakeToPlaceStore()
    seed_request(split, EMMA)
    seed_request(split, SIBLING, person=1000012)
    seed_line(split, 9001, "3000", person=0, posted=MAR8)
    await to_place_service(split).place(YEAR, 9001, _place((EMMA, "1500"), (SIBLING, "1500")), ACTOR)
    posted = FakeToPlaceStore()
    seed_request(posted, EMMA)
    seed_line(posted, 9001, "1500", person=1000011, posted=MAR8)  # posted to Emma: Go places it, To place never sees it
    cases: tuple[tuple[FakeToPlaceStore, list[LedgerTick], list[LedgerTick]], ...] = (
        (whole, [_tick()], [_tick()]),
        (split, [_tick(), _tick(SIBLING)], [_tick(), _tick(SIBLING)]),
        (posted, [_tick()], []),
    )
    for store, ticks, expected in cases:
        season = await to_place_service(store)._decisions.season(YEAR)
        assert on_placed_money(season, ticks) == expected


@pytest.mark.asyncio
async def test_the_decisions_service_loads_d16s_inputs_once_from_the_earliest_posting_day() -> None:
    """The placement, the overnight tick and a person's tick read D16's inputs through one method: nothing for a tick
    dated today (nothing can be after it), else one read from the earliest posting day and the rules at each."""
    store = one_line()
    decisions = to_place_service(store)._decisions
    season = await decisions.season(YEAR)
    assert await decisions.since_inputs(season, [_tick(posted_on=date(2027, 3, 9))]) is None
    assert store.since_reads == []
    since = await decisions.since_inputs(season, [_tick(), _tick(posted_on=date(2027, 3, 5))])
    assert since is not None
    assert (since.now, since.history_from) == (T0, T0 - SYNC_HISTORY)
    assert store.since_reads == [as_of_instant(date(2027, 3, 5))]
    assert sorted(since.rules_at) == [date(2027, 3, 5), POSTED_ON]

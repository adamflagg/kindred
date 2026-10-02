"""A withheld round keeps its posting-day price (D152 follow-up; owner, B1 Q1 2026-10-02; Group 3a Q5; S1 Q1).

A placement whose round D16 withholds leaves it for a person. The overnight tick leaves it too, and a person's tick
locks the higher of its decided amount at the end of the posting day (3c-2's past pricing, where it rebuilds the
request exactly) and today's. Every other tick locks exactly what it locked before. Fictional only: Emma (person
1000011, household 1000001) holds a Session 2 request, which a $60,000 family prices at Round 1 = 1,500 (tier 2) and
a $100,000 family at 1,100 (tier 3). One camp-aid line, posted Mar 8 (camp time); today is Mar 9."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from api.constants.collections import AID_APPLICATIONS
from api.schemas.financial_aid_to_place import PlaceOut
from api.services.financial_aid_decisions_service import as_of_instant
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY
from api.services.financial_aid_reconciliation import LedgerTick
from api.services.financial_aid_to_place import SYNC_HISTORY, on_placed_money
from api.services.financial_aid_to_place_service import ToPlaceService
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeRules,
    log_seeded,
    log_update,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_to_place_changed_since import _place
from tests.unit.api.services.to_place_fakes import EMMA, MAR8, FakeToPlaceStore, one_line, to_place_service

SIBLING = "reqliam00000001"  # Emma's brother (person 1000012), same household
POSTED_ON = date(2027, 3, 8)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)  # intake logged the family
CHANGED = datetime(2027, 3, 9, 16, 0, tzinfo=UTC)  # after the end of Mar 8 (camp time), before now (T0)
LOW, HIGH = 60000.0, 100000.0  # Round 1 = 1,500 (tier 2) and 1,100 (tier 3)
OTHER = "reqliam00000021"  # another family's camper (person 1000021, household 1000002)


def _store(*, then: float, now: float, logged: bool = True, other: bool = False) -> FakeToPlaceStore:
    """Emma's family had income `then` when CampMinder posted Mar 8, and `now` since CHANGED. Intake logged the family
    on Feb 1 unless `logged` is False (then 3c-2 can't rebuild her request), so a past date replays it, and D16's check
    sees the change either way. `other`: another family, unchanged, with a line CampMinder posted to its camper."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA, income=then)
    if other:
        seed_request(store, OTHER, household=1000002, person=1000021)
        seed_line(store, 9002, "1500", household=1000002, person=1000021, posted=MAR8)
    for request_id, request in store.requests.items():
        store.requests[request_id] = replace(request, equity=UNKNOWN_EQUITY)  # intake recorded the answers
    if logged:
        log_seeded(store, SEEDED)
    i = next(i for i, a in enumerate(store.applications) if a.household_cm_id == 1000001)
    answers = {"total_gross_income": now, "expected_gross_income": now}
    before = {"answers": dict(store.applications[i].answers)}
    log_update(store, AID_APPLICATIONS, store.applications[i].id, before, {"answers": answers}, CHANGED)
    store.applications[i] = replace(store.applications[i], answers=answers)
    return store


async def _placed(
    store: FakeToPlaceStore, amount: str = "1500", rules: FakeRules | None = None
) -> tuple[ToPlaceService, PlaceOut]:
    """Emma's family-level line of `amount`, posted Mar 8, placed on her request today by a person."""
    seed_line(store, 9001, amount, person=0, posted=MAR8)
    service = to_place_service(store, rules)
    return service, await service.place(YEAR, 9001, _place((EMMA, amount)), ACTOR)


def _posts(store: FakeToPlaceStore) -> list[tuple[str, int, Decimal | None]]:
    return [(e.request_id, e.round, e.amount) for e in store.events if e.kind == "post"]


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


@pytest.mark.asyncio
async def test_kindred_rebuilds_the_posting_day_price_exactly() -> None:
    """The fixture's premise (a guard: passes on main; Task 2's and Task 3's REDs rest on it). On Mar 8 Emma's Round 1
    was decided 1,500 and 3c-2 rebuilds her request exactly then; today it is 1,100."""
    store = _store(then=LOW, now=HIGH)
    decisions = to_place_service(store)._decisions
    today = (await decisions.season(YEAR)).priced[EMMA].view(1)
    past = await decisions.past_season(YEAR, POSTED_ON)
    then = past.priced[EMMA].view(1)
    assert today is not None
    assert then is not None
    assert (then.status, then.decided, today.decided, EMMA in past.gapped) == (
        "needs_offer",
        Decimal(1500),
        Decimal(1100),
        False,
    )


@pytest.mark.asyncio
async def test_the_overnight_tick_leaves_a_withheld_round_for_a_person() -> None:
    """Review Focus 1; D152: the placement refused the automatic tick and asked a person, and the overnight tick is
    automatic too, so it leaves the round. On main it locked tonight's 1,100, under the 1,500 already offered."""
    store = _store(then=LOW, now=HIGH)
    service, placed = await _placed(store)
    assert [n.round for n in placed.not_ticked] == [1]  # the premise: the placement withheld it
    out = await service._decisions.ledger_ticks(YEAR)
    assert (out.ticked, _posts(store)) == (0, [])


@pytest.mark.asyncio
async def test_money_posted_to_the_camper_keeps_sync_time_pricing_overnight() -> None:
    """Review Focus 2 (a guard: passes on main too). D152, SP10b-1 Decision 2: money CampMinder posted to the camper
    never sat in To place; the overnight tick locks it at tonight's price whatever changed since its posting day."""
    store = _store(then=LOW, now=HIGH)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)
    out = await to_place_service(store)._decisions.ledger_ticks(YEAR)
    assert (out.ticked, _posts(store)) == (1, [(EMMA, 1, Decimal(1100))])

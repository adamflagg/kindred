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
from typing import Any

import pytest

from api.constants.collections import AID_APPLICATIONS, AID_DECISIONS
from api.schemas.financial_aid_decisions import ChangedRowOut, PostedIn, PostedRow
from api.schemas.financial_aid_to_place import PlaceOut
from api.services.financial_aid_decisions_service import DecisionChangedError, as_of_instant
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY
from api.services.financial_aid_reconciliation import LedgerTick
from api.services.financial_aid_to_place import SYNC_HISTORY, on_placed_money
from api.services.financial_aid_to_place_service import ToPlaceService
from bunking.financial_aid.decisions import DecisionEvent, lock_snapshot
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeRules,
    approved,
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


def _tick_in(*rows: tuple[str, str]) -> PostedIn:
    """A person's Round 1 tick of each (request, amount they confirmed)."""
    return PostedIn(rows=[PostedRow(request_id=r, round=1, amount=Decimal(a)) for r, a in rows])


def _post(store: FakeToPlaceStore, request_id: str = EMMA) -> dict[str, Any]:
    """The Posted row the last operation wrote for `request_id`."""
    (write,) = [
        w
        for w in store.operations[-1]
        if w.collection == AID_DECISIONS and w.data is not None and w.data["request"] == request_id
    ]
    assert write.data is not None
    return dict(write.data)


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


@pytest.mark.asyncio
async def test_a_person_ticks_a_withheld_round_at_its_posting_day_price() -> None:
    """Group 3a Q5, D152, S1 Q1: the award fell after CampMinder posted the offer. A person's tick locks what it was on
    the posting day, with that day's receipt and rules version, never tonight's lower amount, and the 409 for a
    stale amount names it. The tick stays dated today, and the rules sections lock as before."""
    store = _store(then=LOW, now=HIGH)
    service, placed = await _placed(store)
    assert [n.round for n in placed.not_ticked] == [1]
    decisions = service._decisions
    expected = lock_snapshot((await decisions.past_season(YEAR, POSTED_ON)).priced[EMMA], 1, 1)
    with pytest.raises(DecisionChangedError) as moved:
        await decisions.tick_posted(YEAR, _tick_in((EMMA, "1100")), ACTOR)
    assert moved.value.rows == [ChangedRowOut(request_id=EMMA, round=1, confirmed=1100.0, decided_now=1500.0)]
    out = await decisions.tick_posted(YEAR, _tick_in((EMMA, "1500")), ACTOR)
    post = _post(store)
    assert (out.written, out.total_locked) == (1, 1500.0)
    assert (post["amount"], post["rules_version"], post["lock_source"], post["effective_on"]) == (
        Decimal(1500),
        1,
        "tick",
        date(2027, 3, 9),
    )
    assert post["snapshot"] == expected
    assert (await decisions.ledger_ticks(YEAR)).ticked == 0  # posted: nothing left for the night


@pytest.mark.asyncio
async def test_a_person_ticks_money_posted_to_the_camper_at_todays_amount() -> None:
    """Review Focus 2 (a guard: passes on main). Money CampMinder posted to the camper is never withheld: a person's
    tick takes today's decided amount, exactly as before."""
    store = _store(then=LOW, now=HIGH)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)
    decisions = to_place_service(store)._decisions
    with pytest.raises(DecisionChangedError) as moved:
        await decisions.tick_posted(YEAR, _tick_in((EMMA, "1500")), ACTOR)
    assert moved.value.rows == [ChangedRowOut(request_id=EMMA, round=1, confirmed=1500.0, decided_now=1100.0)]
    await decisions.tick_posted(YEAR, _tick_in((EMMA, "1100")), ACTOR)
    assert _post(store)["amount"] == Decimal(1100)


@pytest.mark.asyncio
async def test_a_placed_round_the_money_does_not_cover_locks_todays_amount() -> None:
    """Review Focus 6 (a guard: passes on main). D146: 1,000 doesn't cover today's 1,100, so the placement ticked
    nothing and D16 withheld nothing; a person's tick locks today's amount, exactly as before."""
    store = _store(then=LOW, now=HIGH)
    service, placed = await _placed(store, "1000")
    assert placed.not_ticked == []
    out = await service._decisions.tick_posted(YEAR, _tick_in((EMMA, "1100")), ACTOR)
    assert (out.written, _post(store)["amount"]) == (1, Decimal(1100))


@pytest.mark.asyncio
async def test_when_the_award_rose_since_the_posting_day_a_person_locks_todays_higher_amount() -> None:
    """Review Focus 3, owner question 1's default (a guard: passes on main). On Mar 8 the round was 1,100; it is 1,500
    today, and CampMinder holds 1,500. The tick locks 1,500 with today's receipt: a posting-day lock of 1,100 would
    read $400 over and invite taking money back (S1 Q1: a later change never reduces it)."""
    store = _store(then=HIGH, now=LOW)
    service, placed = await _placed(store)
    assert [n.round for n in placed.not_ticked] == [1]
    expected = lock_snapshot((await service._decisions.season(YEAR)).priced[EMMA], 1, 1)
    await service._decisions.tick_posted(YEAR, _tick_in((EMMA, "1500")), ACTOR)
    assert (_post(store)["amount"], _post(store)["snapshot"]) == (Decimal(1500), expected)


@pytest.mark.asyncio
async def test_a_posting_day_kindred_cannot_rebuild_locks_todays_amount() -> None:
    """Review Focus 4, owner question 2's default (a guard: passes on main). Intake's log of the family is missing,
    so 3c-2 can't rebuild Mar 8 (request_history). The round still waited for a person; the tick locks today's."""
    store = _store(then=LOW, now=HIGH, logged=False)
    service, placed = await _placed(store)
    assert [n.round for n in placed.not_ticked] == [1]
    assert (await service._decisions.past_season(YEAR, POSTED_ON)).gapped.get(EMMA) == "request_history"
    await service._decisions.tick_posted(YEAR, _tick_in((EMMA, "1100")), ACTOR)
    assert _post(store)["amount"] == Decimal(1100)


@pytest.mark.asyncio
async def test_one_tick_moves_only_the_withheld_round() -> None:
    """Review Focus 5. One tick of Emma's withheld round and another family's ordinary one: Emma's locks her Mar 8
    1,500 with that day's receipt, the other locks today's 1,500 with today's, as one operation, and the rules
    sections lock once, on today's version, exactly as before."""
    rules = FakeRules(approved())
    store = _store(then=LOW, now=HIGH, other=True)
    service, placed = await _placed(store, rules=rules)
    assert [n.round for n in placed.not_ticked] == [1]
    decisions = service._decisions
    today = lock_snapshot((await decisions.season(YEAR)).priced[OTHER], 1, 1)
    then = lock_snapshot((await decisions.past_season(YEAR, POSTED_ON)).priced[EMMA], 1, 1)
    operations = len(store.operations)
    out = await decisions.tick_posted(YEAR, _tick_in((EMMA, "1500"), (OTHER, "1500")), ACTOR)
    assert (out.written, out.total_locked, len(store.operations)) == (2, 3000.0, operations + 1)
    assert (_post(store)["amount"], _post(store)["snapshot"]) == (Decimal(1500), then)
    assert (_post(store, OTHER)["amount"], _post(store, OTHER)["snapshot"]) == (Decimal(1500), today)
    sections = ("award_tables", "awards", "cost", "equity", "grants", "income", "programs", "tiers")
    assert rules.lock_calls == [(YEAR, 1, sections)]


@pytest.mark.asyncio
async def test_a_withheld_round_whose_amount_did_not_move_locks_exactly_as_before() -> None:
    """Review Focus 7 (a guard: passes on main). The family's income was re-keyed at the same figure: D16 still
    withholds the tick, but Mar 8 and today agree at 1,500, so the row is main's, receipt and version and all
    (equal pricings give equal receipts, so this pins the row, not the `<=`)."""
    store = _store(then=LOW, now=LOW)
    service, placed = await _placed(store)
    assert [n.round for n in placed.not_ticked] == [1]
    expected = lock_snapshot((await service._decisions.season(YEAR)).priced[EMMA], 1, 1)
    await service._decisions.tick_posted(YEAR, _tick_in((EMMA, "1500")), ACTOR)
    post = _post(store)
    assert (post["amount"], post["snapshot"], post["rules_version"]) == (Decimal(1500), expected, 1)


@pytest.mark.asyncio
async def test_a_posting_day_price_above_the_money_placed_still_locks_it() -> None:
    """D152 ("locks each round at its decided amount as of the posting date") and D151 (a short placement "ticks
    nothing ... the registrar ticks by hand if that is right", at the decided amount). Placed 1,200, posting-day 1,500,
    today 1,100: the money covers today's, so the round is withheld, and the tick locks 1,500 (reads short 300, not
    over). On main it locks 1,100 and reads over 100, which invites a clawback the camp rule forbids. RED on main:
    DecisionChangedError."""
    store = _store(then=LOW, now=HIGH)
    service, placed = await _placed(store, "1200")
    assert [n.round for n in placed.not_ticked] == [1]
    await service._decisions.tick_posted(YEAR, _tick_in((EMMA, "1500")), ACTOR)
    assert _post(store)["amount"] == Decimal(1500)


@pytest.mark.asyncio
async def test_two_withheld_rounds_of_one_request_lock_todays_amounts() -> None:
    """A consistency fallback (a guard: passes on main). Round 2 prices against Round 1's lock, so two rounds of one
    request withheld together can't take different prices: both lock today's, as on main. (The Round 2 fixture is
    unexecuted: if it can't be made tickable, say so in the task report and keep the Known limit.)"""
    store = _store(then=LOW, now=HIGH)
    store.events.append(
        DecisionEvent(
            id=f"ev{len(store.events):013d}", request_id=EMMA, round=2, kind="ask", created=T0, amount=Decimal(400)
        )
    )
    service, placed = await _placed(store, "3000")
    assert sorted(n.round for n in placed.not_ticked) == [1, 2]
    decisions = service._decisions
    today = (await decisions.season(YEAR)).priced[EMMA]
    r1, r2 = today.view(1), today.view(2)
    assert r1 is not None
    assert r2 is not None
    assert r1.decided == Decimal(1100)
    assert r2.decided is not None
    rows = PostedIn(
        rows=[
            PostedRow(request_id=EMMA, round=1, amount=r1.decided),
            PostedRow(request_id=EMMA, round=2, amount=r2.decided),
        ]
    )
    await decisions.tick_posted(YEAR, rows, ACTOR)
    assert {e.round: e.amount for e in store.events if e.kind == "post"} == {1: r1.decided, 2: r2.decided}

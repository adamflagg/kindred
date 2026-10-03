"""Requests › Not reconciled checks CampMinder in both directions (D162; Q1; app spec §5.1, §6.2, §6.4).

Direction (a), unchanged: posted rounds the ledger hasn't confirmed, or disagrees with. Direction (b), new: money
CampMinder holds for a round the overnight tick did not tick, each with its reason in a whole sentence. The reasons
come from the tick's own walk (`ledger_walk`), so the tick and its reasons can't disagree: `ledger_ticks` is the walk's
ticks. A round with a reason leaves Needs an offer (its money is in CampMinder; leaving it there invites posting the
family twice) and shows in Not reconciled only. Gated at FIRST_TICKED_SEASON. Fictional only: Emma Johnson (request
EMMA, person 1000011, household 1000001), her brother Liam (person 1000012); Session 2 prices a $60,000 family's
Round 1 at $1,500."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    GridRowOut,
    PostedIn,
    PostedRow,
    RoundRef,
    UnpostIn,
    UntickedMoneyOut,
)
from api.services.financial_aid_decisions_service import DecisionRefusedError
from api.services.financial_aid_march_file import MarchFileService
from api.services.financial_aid_queues import UNTICKED_LABELS, offer_rounds, row_queues
from api.services.financial_aid_reconciliation import (
    SeasonLedger,
    TickStop,
    ledger_ticks,
    ledger_walk,
    stop_text,
)
from api.services.financial_aid_today import TodayService, build_today
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    seed_line,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _event, _posted, _service
from tests.unit.api.services.test_financial_aid_reconciliation import TODAY, ledger_of, line
from tests.unit.api.services.test_financial_aid_today import (
    _Drafts,
    _Grants,
    _grants,
    _inputs,
    _Ledger,
    _round,
)
from tests.unit.api.services.test_financial_aid_today import _row as _today_row
from tests.unit.api.services.test_financial_aid_withheld_round_price import HIGH, LOW, _placed, _store
from tests.unit.api.services.to_place_fakes import to_place_service
from tests.unit.bunking.financial_aid.test_decision_budget import priced, view

NOTE = "in_campminder_not_ticked"

# The owner's approved texts (10-03), verbatim, with the fixture's dollars. Pill · sentence.
SHORT_TEXT = (
    "CampMinder shows $1,300 posted for Round 1, but the offer is $1,500. Check the posting in CampMinder, then click "
    "Mark posted."
)
SHARES_TEXT = (
    "The paying families have $600 of Round 1's $1,500 posted so far. This clears on its own once the rest is posted."
)
FAMILY_TEXT = (
    "CampMinder has $3,000 for this family that isn't attached to a request yet. Attach it in Money › To place, and "
    "this round clears."
)
HELD_TEXT = (
    "CampMinder already has $1,500 for this request, but Round 1 is on hold. This clears once the round is decided."
)
UNDONE_TEXT = (
    "Someone unmarked Round 1 as posted, so the overnight sync won't re-mark it. Click Mark posted once it's right."
)
PENDING_TEXT = "Posted in CampMinder ($1,500). Kindred marks it posted after tonight's sync."
WITHHELD_TEXT = (
    "Round 1 wasn't marked posted automatically: after it was posted in CampMinder on Mar 8, the application was "
    "changed (Mar 9). Check it against what the family was offered, then click Mark posted. That saves the higher of "
    "its amount on Mar 8 and today's."
)
PILLS = {
    "withheld": "Changed after posting",
    "short_posting": "Short in CM",
    "shares_short": "Payers short",
    "family_level": "Money to place",
    "on_hold": "On hold",
    "awaiting_approval": "Awaiting approval",
    "finance_declined": "Finance declined",
    "not_decided": "Not decided",
    "undone": "Unmarked by hand",
}


def _out(code: str, message: str, *, mark_posted: bool, n: int = 1) -> UntickedMoneyOut:
    return UntickedMoneyOut(round=n, code=code, message=message, mark_posted=mark_posted, label=PILLS[code])


async def _rows(store: FakeDecisionsStore) -> dict[str, GridRowOut]:
    return {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}


def _notes(row: GridRowOut) -> list[str]:
    return [n.message for n in row.notes or [] if n.code == NOTE]


# --- the walk: the tick and why it stopped, from one loop -------------------------------------------------


def test_a_short_posting_stops_the_walk_with_what_campminder_holds_of_the_round() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    walk = ledger_walk([needs], ledger_of("emma", line(1, "1590")), today=TODAY)
    assert walk.ticks == ()
    assert walk.stops == (TickStop("emma", 1, "short_posting", "needs_offer", Decimal(1590), Decimal(1800)),)


def test_a_split_requests_short_round_waits_for_the_payer_shares() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1500"))
    walk = ledger_walk([needs], ledger_of("emma", line(1, "600")), today=TODAY, split={"emma"})
    assert [(s.code, s.held) for s in walk.stops] == [("shares_short", Decimal(600))]


def test_family_level_money_stops_the_walk_at_the_first_unticked_round() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    walk = ledger_walk([needs], SeasonLedger(read=True), today=TODAY, family_unplaced={"emma": Decimal(1800)})
    assert walk.ticks == ()
    assert walk.stops == (TickStop("emma", 1, "family_level", "needs_offer", Decimal(1800), Decimal(1800)),)


def test_family_level_money_is_the_reason_over_a_short_placed_part() -> None:
    """Placing comes first: the family-level line may be the rest of the round, and placing it ticks what it covers."""
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    walk = ledger_walk([needs], ledger_of("emma", line(1, "900")), today=TODAY, family_unplaced={"emma": Decimal(900)})
    assert [(s.code, s.held) for s in walk.stops] == [("family_level", Decimal(900))]


@pytest.mark.parametrize(
    ("status", "code"),
    [
        ("held", "on_hold"),
        ("pending_approval", "awaiting_approval"),
        ("refused", "finance_declined"),
        ("not_decided", "not_decided"),
    ],
)
def test_money_for_a_round_not_decided_yet_stops_the_walk_until_it_is(status: str, code: str) -> None:
    """Owner 10-03: the pill names the round's state, so each state is its own code (Today keys its breakdown by code,
    and the grid's chip and Today's label read one map)."""
    rounds = (view(1, "posted", locked="1800"), view(2, status, ask="400"))  # type: ignore[arg-type]
    walk = ledger_walk([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "2100")), today=TODAY)
    assert walk.stops == (TickStop("emma", 2, code, status, Decimal(300), None),)  # type: ignore[arg-type]


@pytest.mark.parametrize("status", ["not_decided", "held"])
def test_an_over_posting_with_nothing_asked_for_the_next_round_is_no_stop(status: str) -> None:
    """H1: Round 1 locked $1,000 and CampMinder holds $1,200. Round 2 has no ask, so there is nothing to offer and the
    "clears once decided" row would never clear; direction (a) already reads the request as over."""
    rounds = (view(1, "posted", locked="1000"), view(2, status))  # type: ignore[arg-type]
    walk = ledger_walk([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "1200")), today=TODAY)
    assert (walk.ticks, walk.stops) == ((), ())


def test_a_round_a_person_unticked_stops_the_walk() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    walk = ledger_walk([needs], ledger_of("emma", line(1, "1800")), today=TODAY, undone={("emma", 1)})
    assert [(s.round, s.code) for s in walk.stops] == [(1, "undone")]


def test_no_money_beyond_the_locks_is_no_stop() -> None:
    """A round with nothing in CampMinder for it simply needs an offer, and a falling net is direction (a)'s."""
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert ledger_walk([needs], SeasonLedger(read=True), today=TODAY).stops == ()
    appeal = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "needs_offer", decided="300"))
    assert ledger_walk([appeal], ledger_of("emma", line(1, "1500")), today=TODAY).stops == ()
    gone = priced("emma", 1000001, view(1, "needs_offer", decided="1800"), live=False)
    assert ledger_walk([gone], ledger_of("emma", line(1, "1590")), today=TODAY).stops == ()


def test_the_walk_ticks_while_the_money_covers_then_names_where_it_stopped() -> None:
    rounds = (
        view(1, "posted", locked="1800"),
        view(2, "needs_offer", decided="300"),
        view(3, "needs_offer", decided="300"),
    )
    walk = ledger_walk(
        [priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "1800"), line(2, "400")), today=TODAY
    )
    assert [(t.round, t.amount) for t in walk.ticks] == [(2, Decimal(300))]
    assert walk.stops == (TickStop("emma", 3, "short_posting", "needs_offer", Decimal(100), Decimal(300)),)


def _parity_cases() -> list[tuple[Any, SeasonLedger, frozenset[tuple[str, int]]]]:
    later = (
        view(1, "posted", locked="1800"),
        view(2, "needs_offer", decided="300"),
        view(3, "needs_offer", decided="300"),
    )
    three = (
        view(1, "needs_offer", decided="1800"),
        view(2, "needs_offer", decided="300"),
        view(3, "needs_offer", decided="300"),
    )
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    zero = (view(1, "posted", locked="0"), view(2, "needs_offer", decided="800"))
    two = SeasonLedger(by_request={"emma": (line(1, "1800"),), "noah": (line(2, "900", household=1000002),)}, read=True)
    none: frozenset[tuple[str, int]] = frozenset()
    return [
        (needs, ledger_of("emma", line(1, "1801")), none),
        (needs, ledger_of("emma", line(1, "1590")), none),
        (needs, ledger_of("emma", line(1, "1800", posted=None)), none),
        (needs, ledger_of("emma", line(1, "1800")), frozenset({("emma", 1)})),
        (needs, SeasonLedger(unplaced_by_household={1000001: Decimal(1800)}, read=True), none),
        (priced("emma", 1000001, *zero), ledger_of("emma", line(1, "50")), none),
        (priced("emma", 1000001, *later), ledger_of("emma", line(1, "1800"), line(2, "400")), none),
        (priced("emma", 1000001, *later), ledger_of("emma", line(1, "1800"), line(2, "600")), none),
        (priced("emma", 1000001, *later), ledger_of("emma", line(1, "1800"), line(2, "200")), none),
        (priced("emma", 1000001, *three), ledger_of("emma", line(1, "5000")), frozenset({("emma", 2)})),
        (priced("emma", 1000001, view(1, "held", ask="2000")), ledger_of("emma", line(1, "1800")), none),
        ([needs, priced("noah", 1000002, view(1, "needs_offer", decided="900"))], two, none),
    ]


@pytest.mark.parametrize("case", range(12))
def test_ledger_ticks_is_exactly_the_walks_ticks(case: int) -> None:
    """The overnight tick's output is unchanged by the refactor: whatever the walk also reports, its ticks are
    ledger_ticks', in order, field for field."""
    requests, ledger, undone = _parity_cases()[case]
    requests = requests if isinstance(requests, list) else [requests]
    family = {"emma": Decimal(500)}  # reasons never change what ticks
    walk = ledger_walk(requests, ledger, today=TODAY, undone=undone, family_unplaced=family, split={"emma"})
    assert list(walk.ticks) == ledger_ticks(requests, ledger, today=TODAY, undone=undone)


def test_each_stop_reads_as_a_whole_sentence() -> None:
    """Owner 10-03, verbatim: $X is what CampMinder holds, $Y the round's decided amount, both through dollars()."""
    assert stop_text(TickStop("e", 1, "short_posting", "needs_offer", Decimal(1300), Decimal(1500))) == SHORT_TEXT
    assert stop_text(TickStop("e", 1, "shares_short", "needs_offer", Decimal(600), Decimal(1500))) == SHARES_TEXT
    assert stop_text(TickStop("e", 1, "family_level", "needs_offer", Decimal(3000), Decimal(1500))) == FAMILY_TEXT
    assert stop_text(TickStop("e", 1, "on_hold", "held", Decimal(1500), None)) == HELD_TEXT
    assert stop_text(TickStop("e", 1, "undone", "needs_offer", Decimal(1500), Decimal(1500))) == UNDONE_TEXT
    pending = TickStop("e", 3, "awaiting_approval", "pending_approval", Decimal("300.50"), None)
    assert stop_text(pending) == (
        "CampMinder already has $300.50 for this request, but Round 3 is waiting for finance's approval. "
        "This clears once the round is decided."
    )
    refused = TickStop("e", 3, "finance_declined", "refused", Decimal(300), None)
    assert stop_text(refused) == (
        "CampMinder already has $300 for this request, but Round 3 was declined by finance. "
        "This clears once the round is decided."
    )
    undecided = TickStop("e", 2, "not_decided", "not_decided", Decimal(250), None)
    assert stop_text(undecided) == (
        "CampMinder already has $250 for this request, but Round 2 hasn't been decided. "
        "This clears once the round is decided."
    )
    short2 = TickStop("e", 2, "short_posting", "needs_offer", Decimal(100), Decimal(300))
    assert stop_text(short2) == (
        "CampMinder shows $100 posted for Round 2, but the offer is $300. Check the posting in CampMinder, then click "
        "Mark posted."
    )


def test_the_pills_are_the_owners_words_one_per_code() -> None:
    """Owner 10-03: one server map (D21) for the grid's chip and Today's breakdown; tonight's tick is no reason."""
    assert UNTICKED_LABELS == PILLS
    from typing import get_args

    from api.schemas.financial_aid_decisions import UntickedReasonOut

    assert "awaiting_tick" not in get_args(UntickedReasonOut)


# --- the rows: Not reconciled (b), and out of Needs an offer (Q1) -----------------------------------------


@pytest.mark.asyncio
async def test_a_short_posting_is_not_reconciled_only_and_allows_mark_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    row = (await _rows(store))[EMMA]
    assert row.unticked == [_out("short_posting", SHORT_TEXT, mark_posted=True)]
    assert row.queues == ["not_reconciled"]


@pytest.mark.asyncio
async def test_family_level_money_puts_each_request_in_not_reconciled_with_no_mark_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "3000", person=0)
    rows = await _rows(store)
    for rid in (EMMA, LIAM):
        assert rows[rid].unticked == [_out("family_level", FAMILY_TEXT, mark_posted=False)]
        assert rows[rid].queues == ["not_reconciled"]


@pytest.mark.asyncio
async def test_a_round_a_person_unticked_is_not_reconciled_for_a_person_to_tick() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    assert (await service.ledger_ticks(YEAR)).ticked == 1
    await service.undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="Ticked the wrong family"), ACTOR)
    row = (await _rows(store))[EMMA]
    assert row.unticked == [_out("undone", UNDONE_TEXT, mark_posted=True)]
    assert row.queues == ["not_reconciled"]


@pytest.mark.asyncio
async def test_money_for_a_held_request_clears_when_decided_and_has_no_mark_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_line(store, 9001, "1500")
    row = (await _rows(store))[EMMA]
    assert row.unticked == [_out("on_hold", HELD_TEXT, mark_posted=False)]
    assert "not_reconciled" in (row.queues or [])
    assert "needs_offer" not in (row.queues or [])


@pytest.mark.asyncio
async def test_money_for_a_held_round_1_with_a_blank_ask_is_still_not_reconciled() -> None:
    """H1 is an over-posting with nothing asked for the NEXT round. Round 1 follows no posting, and a blank Round 1 ask
    is real (it stays blank, never 0): CampMinder's money for it still needs its row, or it shows nowhere."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session", ask=0)
    seed_line(store, 9001, "1500")
    row = (await _rows(store))[EMMA]
    assert (row.rounds[0].status, row.rounds[0].ask) == ("held", None)  # the premise
    assert row.unticked == [_out("on_hold", HELD_TEXT, mark_posted=False)]
    assert "not_reconciled" in (row.queues or [])


@pytest.mark.asyncio
async def test_a_split_requests_first_share_waits_for_the_rest() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    seed_line(store, 9001, "600", household=1000004)
    row = (await _rows(store))[EMMA]
    assert row.unticked == [_out("shares_short", SHARES_TEXT, mark_posted=True)]
    assert row.queues == ["not_reconciled"]


@pytest.mark.asyncio
async def test_money_in_full_is_waiting_on_the_family_pending_until_tonights_tick() -> None:
    """C1 (D162, owner 10-03): CampMinder covers Round 1 in full and nothing blocks the tick. That is no exception: the
    round waits on the family at once, its CampMinder cell reads pending until tonight's tick, and it is not Posted
    money until the tick."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    row = (await _rows(store))[EMMA]
    assert (row.unticked, row.queues) == ([], ["waiting_on_family"])
    r1 = row.rounds[0]
    assert (r1.status, r1.cm_pending, r1.cm_pending_message) == ("needs_offer", True, PENDING_TEXT)
    assert (r1.status_label, r1.posted, row.total_posted) == ("Posted", None, None)
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 1
    after = (await _rows(store))[EMMA]
    assert (after.unticked, after.queues) == ([], ["waiting_on_family"])  # ticked from the ledger: confirmed
    assert (after.rounds[0].status, after.rounds[0].cm_pending, after.rounds[0].cm_pending_message) == (
        "posted",
        False,
        None,
    )


@pytest.mark.asyncio
async def test_a_pending_round_is_no_posted_money_before_the_tick() -> None:
    """C1: the posted money figures follow the tick; Needs an offer's money keeps the round until then (C2)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    total = (await service.budget(YEAR)).total.total
    assert (total.posted, total.needs_offer) == (0.0, 1500.0)
    await service.ledger_ticks(YEAR)
    total = (await service.budget(YEAR)).total.total
    assert (total.posted, total.needs_offer) == (1500.0, 0.0)


@pytest.mark.asyncio
async def test_a_withheld_round_says_why_in_the_placements_own_words() -> None:
    """D152 as scoped: money a person placed, priced since the posting day. The placement left the round, the overnight
    tick leaves it, and Not reconciled says why with the same text To place showed."""
    store = _store(then=LOW, now=HIGH)
    service, placed = await _placed(store)
    assert [n.why for n in placed.not_ticked] == [WITHHELD_TEXT]  # the premise
    assert (await service._decisions.ledger_ticks(YEAR)).ticked == 0
    row = next(r for r in (await to_place_service(store)._decisions.grid(YEAR)).rows if r.request_id == EMMA)
    assert row.unticked == [_out("withheld", WITHHELD_TEXT, mark_posted=True)]
    assert row.queues == ["not_reconciled"]
    # C1: the pending path never hides a withheld round, though CampMinder covers it in full
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)


@pytest.mark.asyncio
async def test_nothing_in_campminder_leaves_the_row_in_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    row = (await _rows(store))[EMMA]
    assert (row.unticked, row.queues) == ([], ["needs_offer"])


@pytest.mark.asyncio
async def test_a_round_campminder_holds_nothing_for_stays_in_needs_an_offer_beside_one_that_ticks() -> None:
    """Per round, not per request: Round 1 is in CampMinder in full (pending tonight's tick, so waiting on the family);
    Round 2 has nothing there, so it still needs an offer, and Today's breakdown counts it under r2 only."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    base = await _service(store).season(YEAR)
    r1 = base.priced[EMMA].rounds[0]
    r2 = view(2, "needs_offer", decided="300")
    assert r1.status == "needs_offer"
    from dataclasses import replace

    season = replace(base, priced={**base.priced, EMMA: replace(base.priced[EMMA], rounds=(r1, r2))})
    service = _service(store)
    row = service.row_of(await service.with_unticked(season), ({}, {}), EMMA)
    assert row.unticked == []
    assert [r.cm_pending for r in row.rounds] == [True, False]
    assert row.queues == ["needs_offer", "waiting_on_family"]
    assert [r.round for r in offer_rounds(row)] == [2]


@pytest.mark.asyncio
async def test_every_row_carrying_the_note_has_a_reason_and_none_without_it() -> None:
    """D81 as amended: the Note's rows are exactly Not reconciled (b)'s, so the two never disagree."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    seed_request(store, "reqoliv00000001", household=1000003, person=1000031)
    seed_line(store, 9002, "1500", household=1000003, person=1000031)
    seed_request(store, "reqriley0000001", household=1000005, person=1000051)  # nothing in CampMinder
    seed_request(store, "reqsamu00000001", household=1000006, person=1000061)
    seed_request(store, "reqsamu00000002", household=1000006, person=1000062)
    seed_line(store, 9003, "3000", household=1000006, person=0)
    rows = await _rows(store)
    # C1 (owner 10-03): Olivia's round, in CampMinder in full, is pending tonight's tick rather than an exception; the
    # Note still marks it (its money is in CampMinder), so the Note's rows are (b)'s plus the pending ones.
    marked = {rid: bool(r.unticked) or any(x.cm_pending for x in r.rounds) for rid, r in rows.items()}
    assert {rid: bool(_notes(r)) for rid, r in rows.items()} == marked
    assert sum(bool(r.unticked) for r in rows.values()) == 3
    assert [rid for rid, r in rows.items() if any(x.cm_pending for x in r.rounds)] == ["reqoliv00000001"]


@pytest.mark.asyncio
async def test_the_one_note_row_with_no_reason_is_a_zero_round_1() -> None:
    """The named exception to the rule above, and only it. Owner 10-03: a $0 Round 1 comes only from a hand-typed $0
    (Round 1 is never calculated below the rules' minimum), so it gets no Not reconciled reason; the Note alone shows
    CampMinder's money. The walk stops at it (zero_round), which shown_stops leaves out of the (b) rows."""
    store = FakeDecisionsStore()
    service = _service(store, _zero_round_1(store))
    seed_request(store, "reqoliv00000001", household=1000003, person=1000031, income=60000.0)
    seed_line(store, 9002, "1300", household=1000003, person=1000031)  # a short posting beside it: Note and reason
    rows = {r.request_id: r for r in (await service.grid(YEAR)).rows}
    noted = {rid for rid, r in rows.items() if _notes(r)}
    assert noted == {EMMA, "reqoliv00000001"}
    without = {rid for rid in noted if not rows[rid].unticked and not any(x.cm_pending for x in rows[rid].rounds)}
    assert without == {EMMA}  # every other Note row still has its reason
    season = await service.season(YEAR)
    stops = ledger_walk([season.priced[EMMA]], season.ledger, today=TODAY).stops
    assert [(s.round, s.code) for s in stops] == [(1, "zero_round")]


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_nothing_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    row = (await _rows(store))[EMMA]
    assert (row.unticked, row.queues) == ([], ["needs_offer"])


@pytest.mark.asyncio
async def test_a_past_date_rebuilds_no_reason_as_it_rebuilds_no_view() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    out = await _service(store).grid(YEAR, as_of=date(2027, 3, 8))
    assert out.as_of == date(2027, 3, 8)  # a past read, not the live path
    (row,) = out.rows
    assert (row.unticked, row.queues) == (None, None)
    assert "unticked" in [g.figure for g in out.not_rebuilt]


@pytest.mark.asyncio
async def test_mark_posted_on_a_short_posting_moves_it_to_direction_a() -> None:
    """The hand tick still works for a short posting: it locks the decided amount, and the row then reads short
    against CampMinder (direction a) instead of unticked (direction b)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    body = PostedIn(rows=[PostedRow(request_id=EMMA, round=1, amount=Decimal(1500))])
    out = await _service(store).tick_posted(YEAR, body, ACTOR)
    assert out.written == 1
    store.synced_at = T0.replace(hour=23)
    row = (await _rows(store))[EMMA]
    assert row.unticked == []
    assert row.confirmation is not None
    assert (row.confirmation.status, row.queues) == ("short", ["waiting_on_family", "not_reconciled"])


# --- Today: the same rows, the same counts (D21) ----------------------------------------------------------


def _unticked_row(rid: str, household: int, code: str, *rounds: Any) -> GridRowOut:
    return _today_row(rid, household, *rounds, unticked=[_out(code, "x", mark_posted=False, n=rounds[-1].round)])


def test_todays_needs_an_offer_leaves_out_refused_rounds_and_not_reconciled_names_their_reasons() -> None:
    rows = [
        _today_row("reqemma00000001", 1000001, _round(1, "needs_offer", decided=1500.0)),
        _unticked_row("reqliam00000001", 1000002, "short_posting", _round(1, "needs_offer", decided=1500.0)),
        _unticked_row("reqoliv00000001", 1000003, "family_level", _round(1, "needs_offer", decided=1500.0)),
        _unticked_row(
            "reqriley0000001",
            1000004,
            "short_posting",
            _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
            _round(2, "needs_offer", decided=300.0),
        ),
    ]
    casework = build_today(_inputs(rows), casework=True, finance=False).casework
    assert casework is not None
    needs = next(line for line in casework if line.key == "needs_offer")
    assert (needs.families, needs.items) == (1, 1)
    assert [(r.code, r.items) for r in needs.reasons] == [("r1", 1)]
    unreconciled = next(line for line in casework if line.key == "not_reconciled")
    assert (unreconciled.families, unreconciled.items) == (3, 3)
    assert [(r.code, r.items, r.label) for r in unreconciled.reasons] == [
        ("short_posting", 2, UNTICKED_LABELS["short_posting"]),
        ("family_level", 1, UNTICKED_LABELS["family_level"]),
    ]
    assert unreconciled.largest_gap is None  # no Posted figure disagrees: (b) adds no gap (D150 unchanged)


def test_every_reason_has_a_label() -> None:
    from typing import get_args

    from api.schemas.financial_aid_decisions import UntickedReasonOut

    assert set(UNTICKED_LABELS) == set(get_args(UntickedReasonOut))


def test_the_schemas_reasons_are_the_walks_codes() -> None:
    """The schema's Literal mirrors the service's (its comment says a test pins them): one can't drift from the other."""
    from typing import get_args

    from api.schemas.financial_aid_decisions import UntickedReasonOut
    from api.services.financial_aid_reconciliation import MARK_POSTED, UntickedCode

    assert get_args(UntickedReasonOut) == get_args(UntickedCode)
    assert set(get_args(UntickedCode)) >= MARK_POSTED


def test_a_row_with_a_reason_is_out_of_needs_an_offer_even_on_its_own() -> None:
    row = _today_row("reqemma00000001", 1000001, _round(1, "needs_offer", decided=1500.0))
    with_reason = row.model_copy(update={"unticked": [_out("short_posting", "x", mark_posted=True)]})
    assert row_queues(with_reason) == ["not_reconciled"]
    assert offer_rounds(with_reason) == []


@pytest.mark.asyncio
async def test_today_reads_the_unticked_rows_from_the_live_season() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    seed_request(store, "reqoliv00000001", household=1000003, person=1000031)
    service = TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        clock=lambda: T0,
    )
    out = await service.read(YEAR, casework=True, finance=False)
    assert out.casework is not None
    lines = {line.key: line for line in out.casework}
    assert (lines["needs_offer"].items, lines["not_reconciled"].items) == (1, 1)
    assert [r.code for r in lines["not_reconciled"].reasons] == ["short_posting"]


# --- the household page: the grid's own row, reason and all -----------------------------------------------


@pytest.mark.asyncio
async def test_the_household_page_shows_the_grids_reason() -> None:
    from tests.unit.api.services.test_financial_aid_household_page import GARCIA, _family, _page_service

    store = _family()
    seed_line(store, 9001, "1300", household=GARCIA, person=1000021)  # on Liam's request, short of its $1,500
    page = await _page_service(store).read(YEAR, GARCIA)
    grid = {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}
    liam = next(card.row for card in page.requests if card.row.request_id == LIAM)
    assert [u.code for u in liam.unticked or []] == ["short_posting"]
    assert liam.unticked == grid[LIAM].unticked
    assert liam.queues == grid[LIAM].queues


# --- C1: Accepted on the same day, for a round CampMinder covers in full (owner 10-03) --------------------


def _accept(*keys: tuple[str, int], accepted: bool = True) -> AcceptedIn:
    return AcceptedIn(rows=[RoundRef(request_id=rid, round=n) for rid, n in keys], accepted=accepted)


@pytest.mark.asyncio
async def test_accepted_is_allowed_the_same_day_on_a_round_campminder_covers_in_full() -> None:
    """Owner GO (10-03): the family can accept before tonight's tick marks the round posted. Accepted then stands
    through the tick, and the row waits on no one."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    out = await service.tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)
    assert out.written == 1
    row = (await _rows(store))[EMMA]
    assert (row.rounds[0].accepted, row.rounds[0].cm_pending, row.queues) == (True, True, [])
    assert (await service.ledger_ticks(YEAR)).ticked == 1
    after = (await _rows(store))[EMMA]
    assert (after.rounds[0].status, after.rounds[0].accepted, after.queues) == ("posted", True, [])


@pytest.mark.asyncio
async def test_accepted_in_bulk_takes_every_round_campminder_covers_in_full() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_line(store, 9002, "1500", household=1000002, person=1000021)
    out = await _service(store).tick_accepted(YEAR, _accept((EMMA, 1), (LIAM, 1)), ACTOR)
    assert out.written == 2


@pytest.mark.asyncio
async def test_unaccepting_a_pending_round_puts_it_back_waiting_on_the_family() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    await service.tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)
    out = await service.tick_accepted(YEAR, _accept((EMMA, 1), accepted=False), ACTOR)
    assert out.written == 1
    row = (await _rows(store))[EMMA]
    assert (row.rounds[0].accepted, row.queues) == (False, ["waiting_on_family"])


@pytest.mark.asyncio
async def test_a_same_day_accepted_can_be_undone_after_the_round_stops_being_pending() -> None:
    """Accepted on a pending round, then CampMinder's money goes before tonight's tick: the round is back in Needs an
    offer still marked Accepted (an accepted edge). Un-accepting it is how staff clear that, so it is never refused
    as "not posted"."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    service = _service(store)
    await service.tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)
    store.camp_lines.clear()
    before = (await _rows(store))[EMMA].rounds[0]
    assert (before.status, before.accepted, before.cm_pending) == ("needs_offer", True, False)  # the premise
    out = await service.tick_accepted(YEAR, _accept((EMMA, 1), accepted=False), ACTOR)
    assert out.written == 1
    assert (await _rows(store))[EMMA].rounds[0].accepted is False


def _round3(store: FakeDecisionsStore, *, refused: bool) -> None:
    """Rounds 1 and 2 posted, and a Round 3 amount keyed above the registrar's limit: pending, or refused by finance.
    CampMinder holds all three."""
    _posted(store, EMMA, 1, "1500")
    _posted(store, EMMA, 2, "300")
    _event(store, EMMA, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    _event(store, EMMA, 3, "award", amount=Decimal(500), needs_approval=True)
    if refused:
        _event(store, EMMA, 3, "refuse")
    seed_line(store, 9001, "2300")


@pytest.mark.parametrize("case", ["nothing_in_campminder", "short", "held", "pending_approval", "refused"])
@pytest.mark.asyncio
async def test_accepted_is_still_refused_where_the_tick_would_not_post_the_round(case: str) -> None:
    """Owner GO (10-03): ONLY a round CampMinder covers in full with nothing blocking the tick. Single and bulk."""
    store = FakeDecisionsStore()
    n = 1
    if case == "held":
        seed_request(store, EMMA, session=0, status="unmatched_session")
    else:
        seed_request(store, EMMA)
    if case == "short":
        seed_line(store, 9001, "1300")
    elif case == "held":
        seed_line(store, 9001, "1500")
    elif case in ("pending_approval", "refused"):
        _round3(store, refused=case == "refused")
        n = 3
    service = _service(store)
    row = (await _rows(store))[EMMA]
    assert row.rounds[n - 1].status == {
        "held": "held",
        "pending_approval": "pending_approval",
        "refused": "refused",
    }.get(case, "needs_offer")  # the premise
    with pytest.raises(DecisionRefusedError, match=f"Round {n} is not posted"):
        await service.tick_accepted(YEAR, _accept((EMMA, n)), ACTOR)
    # bulk, beside a round it would take on its own: all or nothing
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_line(store, 9002, "1500", household=1000002, person=1000021)
    with pytest.raises(DecisionRefusedError, match=f"Round {n} is not posted"):
        await service.tick_accepted(YEAR, _accept((LIAM, 1), (EMMA, n)), ACTOR)
    assert not [e for e in store.events if e.kind == "accept"]


@pytest.mark.asyncio
async def test_accepted_on_a_withheld_round_is_refused() -> None:
    """A round D152 withholds is blocked from the tick, so it is no pending round and Accepted waits for its tick."""
    store = _store(then=LOW, now=HIGH)
    service, _ = await _placed(store)
    with pytest.raises(DecisionRefusedError, match="Round 1 is not posted"):
        await service._decisions.tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)


@pytest.mark.asyncio
async def test_accepted_before_the_first_ticked_season_still_needs_the_posted_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    with pytest.raises(DecisionRefusedError, match="Round 1 is not posted"):
        await _service(store).tick_accepted(YEAR, _accept((EMMA, 1)), ACTOR)


# --- H1, H3: the rows match what is real and what Mark posted accepts -------------------------------------


@pytest.mark.asyncio
async def test_an_over_posting_is_direction_a_only_with_no_round_2_row() -> None:
    """H1 repro: Round 1 locked $1,000, CampMinder holds $1,200, Round 2 has no ask. No "not decided" row that would
    never clear; direction (a) reads it as over, and Today counts it once."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1000")
    seed_line(store, 9001, "1200")
    store.synced_at = T0.replace(hour=23)
    row = (await _rows(store))[EMMA]
    assert row.unticked == []
    assert row.confirmation is not None
    assert (row.confirmation.status, row.queues) == ("over", ["waiting_on_family", "not_reconciled"])
    casework = build_today(_inputs([row]), casework=True, finance=False).casework
    assert casework is not None
    unreconciled = next(line for line in casework if line.key == "not_reconciled")
    assert [(r.code, r.items) for r in unreconciled.reasons] == [("over", 1)]


@pytest.mark.asyncio
async def test_mark_posted_is_offered_only_where_the_hand_tick_accepts_one_round() -> None:
    """H3: Round 1 is in CampMinder in full (pending) and Round 2 short. tick_posted refuses Round 2 alone while Round 1
    is unposted, so Round 2's row offers no Mark posted; once Round 1 is posted, it does, and the click goes through."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _event(store, EMMA, 2, "ask", amount=Decimal(400))  # recorded directly: decided $300
    seed_line(store, 9001, "1600")
    service = _service(store)
    row = (await _rows(store))[EMMA]
    assert [r.cm_pending for r in row.rounds[:2]] == [True, False]
    (r2,) = row.unticked or []
    assert (r2.round, r2.code, r2.mark_posted) == (2, "short_posting", False)
    with pytest.raises(DecisionRefusedError, match="tick Round 1 Posted before Round 2"):
        await service.tick_posted(
            YEAR, PostedIn(rows=[PostedRow(request_id=EMMA, round=2, amount=Decimal(300))]), ACTOR
        )
    assert (await service.ledger_ticks(YEAR)).ticked == 1  # tonight's tick posts Round 1
    (r2,) = (await _rows(store))[EMMA].unticked or []
    assert (r2.round, r2.code, r2.mark_posted) == (2, "short_posting", True)
    out = await service.tick_posted(
        YEAR, PostedIn(rows=[PostedRow(request_id=EMMA, round=2, amount=Decimal(300))]), ACTOR
    )
    assert out.written == 1


# --- C2: Rounds & budget's Needs an offer count is the grid's list (owner 10-03) --------------------------


def _three(store: FakeDecisionsStore) -> None:
    """Emma short in CampMinder (Not reconciled), Liam covered in full (pending), Olivia with nothing there."""
    seed_request(store, EMMA)
    seed_line(store, 9001, "1300")
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_line(store, 9002, "1500", household=1000002, person=1000021)
    seed_request(store, "reqoliv00000001", household=1000003, person=1000031)


@pytest.mark.asyncio
async def test_the_budgets_needs_an_offer_count_is_the_grids_list_and_its_money_is_unchanged() -> None:
    store = FakeDecisionsStore()
    _three(store)
    service = _service(store)
    listed = [r.request_id for r in (await service.grid(YEAR)).rows if "needs_offer" in (r.queues or [])]
    assert listed == ["reqoliv00000001"]
    out = await service.budget(YEAR)
    total = out.total.total
    assert total.needs_offer_count is not None  # set on a live read; narrows the type
    assert (total.needs_offer_count.families, total.needs_offer_count.requests) == (1, 1)
    assert total.needs_offer == 4500.0  # the money and Remaining don't change
    r1 = next(c for c in out.total.rounds if c.round == 1)
    assert r1.needs_offer_count is not None
    assert (r1.needs_offer_count.requests, r1.needs_offer) == (1, 4500.0)
    strip = next(c for c in out.strip if c.round == 1)
    assert strip.needs_offer is not None
    assert (strip.needs_offer.families, strip.needs_offer.requests) == (1, 1)
    pool = out.pools[0].total
    assert pool.needs_offer_count is not None
    assert (pool.needs_offer_count.requests, pool.needs_offer) == (1, 4500.0)


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_the_budget_counts_every_decided_unposted_round(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    _three(store)
    total = (await _service(store).budget(YEAR)).total.total
    assert total.needs_offer_count is not None
    assert (total.needs_offer_count.requests, total.needs_offer) == (3, 4500.0)


@pytest.mark.asyncio
async def test_todays_lines_read_a_pending_round_as_waiting_on_the_family() -> None:
    store = FakeDecisionsStore()
    _three(store)
    service = TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        clock=lambda: T0,
    )
    out = await service.read(YEAR, casework=True, finance=False)
    assert out.casework is not None
    lines = {line.key: line for line in out.casework}
    assert [(k, lines[k].items) for k in ("needs_offer", "waiting_on_family", "not_reconciled")] == [
        ("needs_offer", 1),
        ("waiting_on_family", 1),
        ("not_reconciled", 1),
    ]
    assert [(r.code, r.label) for r in lines["not_reconciled"].reasons] == [("short_posting", "Short in CM")]


# --- each payer share's Needs an offer money follows the same rule (owner 10-03) --------------------------


@pytest.mark.asyncio
async def test_a_split_rounds_shares_have_nothing_to_offer_once_campminder_holds_money_for_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    seed_line(store, 9001, "600", household=1000004)
    row = (await _rows(store))[EMMA]
    assert [(s.household_cm_id, s.needs_offer) for s in row.payer_shares] == [(1000001, None), (1000004, None)]


@pytest.mark.asyncio
async def test_a_split_round_with_nothing_in_campminder_keeps_each_shares_part() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    row = (await _rows(store))[EMMA]
    assert [(s.household_cm_id, s.needs_offer) for s in row.payer_shares] == [(1000001, 900.0), (1000004, 600.0)]


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_a_shares_part_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    seed_line(store, 9001, "600", household=1000004)
    row = (await _rows(store))[EMMA]
    assert [(s.household_cm_id, s.needs_offer) for s in row.payer_shares] == [(1000001, 900.0), (1000004, 600.0)]


# --- the March file sends no Round 1 CampMinder already holds money for (D162 Q1) ----------------------------


@pytest.mark.asyncio
async def test_the_march_file_leaves_out_a_round_1_campminder_holds_money_for() -> None:
    """Sending it again risks posting the family twice: a short posting (Not reconciled) and one covered in full
    (pending tonight's tick) are both left out; a Round 1 with nothing in CampMinder is sent."""
    store = FakeDecisionsStore()
    _three(store)
    store.camper_names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia"), 1000031: ("Olivia", "Chen")}
    out = await MarchFileService(_service(store), store).read(YEAR)
    assert [(r.request_id, r.total_award) for r in out.rows] == [("reqoliv00000001", 1500.0)]


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_the_march_file_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    _three(store)
    store.camper_names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia"), 1000031: ("Olivia", "Chen")}
    out = await MarchFileService(_service(store), store).read(YEAR)
    assert sorted(r.request_id for r in out.rows) == [EMMA, LIAM, "reqoliv00000001"]


# --- C1 on a later round: a pending round counts as locked (owner 10-03, option a) --------------------------
#
# Round 1 is posted ($1,500 locked) and CampMinder already holds a later round's full decided money with nothing
# blocking the tick. That round is C1 pending, so the money beyond the posted lock is exactly what tonight's tick will
# lock: the confirmation counts it as locked (the amount the ledger walk ticks), and the request is no exception. Only
# the live read from the first ticked season widens the lock; the walk stopping short (short_posting) widens nothing.


def _round2(store: FakeDecisionsStore, *, held: str) -> None:
    """Emma: Round 1 posted at $1,500 before last night's sync, Round 2 decided at $300 (asked $400), and CampMinder
    holding `held` on her request."""
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))  # recorded directly: decided $300
    seed_line(store, 9001, held)
    store.synced_at = T0.replace(hour=23)


def _today_service(store: FakeDecisionsStore) -> TodayService:
    return TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        clock=lambda: T0,
    )


async def _today_lines(store: FakeDecisionsStore) -> dict[str, Any]:
    out = await _today_service(store).read(YEAR, casework=True, finance=False)
    assert out.casework is not None
    return {line.key: line for line in out.casework}


@pytest.mark.asyncio
async def test_a_pending_round_2_counts_as_locked_so_the_request_is_not_over() -> None:
    """The F1 repro: Round 2's $300 is the only money beyond Round 1's lock, and tonight's tick posts it. The row reads
    CM ✓ pending on Round 2 and waits on the family; it is not over and not in Not reconciled."""
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    row = (await _rows(store))[EMMA]
    r2 = row.rounds[1]
    assert (r2.status, r2.decided, r2.cm_pending) == ("needs_offer", 300.0, True)  # the premise: C1 on Round 2
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.in_campminder, c.gap) == ("confirmed", True, 1800.0, 1800.0, 0.0)
    assert (row.unticked, row.queues) == ([], ["waiting_on_family", "appeals"])  # Round 2's ask: Appeals too
    assert row.stage is not None
    assert row.stage.label == "R2 · Posted"


@pytest.mark.asyncio
async def test_a_pending_round_2_is_left_out_of_todays_not_reconciled() -> None:
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    lines = await _today_lines(store)
    unreconciled = lines["not_reconciled"]
    assert (unreconciled.items, unreconciled.families) == (0, 0)
    assert "over" not in [r.code for r in unreconciled.reasons]
    assert unreconciled.largest_gap is None
    assert lines["waiting_on_family"].items == 1
    assert lines["needs_offer"].items == 0


@pytest.mark.asyncio
async def test_a_pending_round_2_stays_reconciled_once_tonights_tick_posts_it() -> None:
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    service = _service(store)
    assert (await service.ledger_ticks(YEAR)).ticked == 1
    row = (await _rows(store))[EMMA]
    assert [(r.status, r.cm_pending) for r in row.rounds[:2]] == [("posted", False), ("posted", False)]
    assert row.confirmation is not None
    assert (row.confirmation.status, row.confirmation.locked, row.confirmation.reconciled) == (
        "confirmed",
        1800.0,
        True,
    )
    assert "not_reconciled" not in (row.queues or [])


def _round3_pending(store: FakeDecisionsStore, *, held: str) -> None:
    """Emma: Rounds 1 and 2 posted ($1,500 and $300) before last night's sync, Round 3 decided at $100 (the session
    costs $2,000, so $1,900 in all stays under it), and CampMinder holding `held`."""
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))  # Round 3 needs a Round 2 decision
    _posted(store, EMMA, 2, "300")
    _event(store, EMMA, 3, "ask", amount=Decimal(100), statement_of_need="A parent lost their job")
    _event(store, EMMA, 3, "award", amount=Decimal(100))
    seed_line(store, 9001, held)
    store.synced_at = T0.replace(hour=23)


@pytest.mark.asyncio
async def test_a_pending_round_3_counts_as_locked_too() -> None:
    store = FakeDecisionsStore()
    _round3_pending(store, held="1900")
    row = (await _rows(store))[EMMA]
    r3 = row.rounds[2]
    assert (r3.status, r3.decided, r3.cm_pending) == ("needs_offer", 100.0, True)  # the premise: C1 on Round 3
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.gap) == ("confirmed", True, 1900.0, 0.0)
    assert (row.unticked, row.queues) == ([], ["waiting_on_family", "appeals"])
    assert row.stage is not None
    assert row.stage.label == "R3 · Posted"
    unreconciled = (await _today_lines(store))["not_reconciled"]
    assert (unreconciled.items, unreconciled.largest_gap) == (0, None)
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 1
    after = (await _rows(store))[EMMA]
    assert after.rounds[2].status == "posted"
    assert "not_reconciled" not in (after.queues or [])


@pytest.mark.asyncio
async def test_money_beyond_posted_and_pending_is_still_over_by_the_excess() -> None:
    """Regression: CampMinder holds $2,000 against Round 1's $1,500 posted and Round 2's $300 pending. Round 2 still
    reads pending, but the $200 beyond both is a real over-posting: Not reconciled, over by $200, not $500."""
    store = FakeDecisionsStore()
    _round2(store, held="2000")
    row = (await _rows(store))[EMMA]
    assert row.rounds[1].cm_pending is True  # the premise
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.gap) == ("over", False, 1800.0, 200.0)
    assert row.queues == ["waiting_on_family", "appeals", "not_reconciled"]
    unreconciled = (await _today_lines(store))["not_reconciled"]
    assert [(r.code, r.items) for r in unreconciled.reasons] == [("over", 1)]
    assert unreconciled.largest_gap == 200.0


@pytest.mark.asyncio
async def test_a_short_later_round_is_not_pending_and_the_lock_stays_the_posted_rounds() -> None:
    """CampMinder holds $1,700: less than Round 1 + Round 2. The walk stops at Round 2 (short_posting, #2996), so
    nothing is pending, and the confirmation reads against the posted Round 1 alone, as before."""
    store = FakeDecisionsStore()
    _round2(store, held="1700")
    row = (await _rows(store))[EMMA]
    assert row.rounds[1].cm_pending is False
    assert [(u.round, u.code) for u in row.unticked or []] == [(2, "short_posting")]
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.gap) == ("over", False, 1500.0, 200.0)
    assert row.queues == ["waiting_on_family", "appeals", "not_reconciled"]


@pytest.mark.asyncio
async def test_payer_shares_read_confirmed_against_the_widened_lock() -> None:
    """A 60/40 split: Round 1's $1,500 posted, Round 2's $300 pending. Each payer has posted its share of $1,800
    ($1,080 and $720), so each share is confirmed against the widened lock, not over against Round 1's."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40")]
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    seed_line(store, 9001, "1080")
    seed_line(store, 9002, "720", household=1000004)
    store.synced_at = T0.replace(hour=23)
    row = (await _rows(store))[EMMA]
    assert row.rounds[1].cm_pending is True  # the premise
    c = row.confirmation
    assert c is not None
    assert [(s.household_cm_id, s.expected, s.status) for s in c.shares] == [
        (1000001, 1080.0, "confirmed"),
        (1000004, 720.0, "confirmed"),
    ]
    assert (c.status, c.reconciled) == ("confirmed", True)
    assert row.queues == ["waiting_on_family", "appeals"]


@pytest.mark.asyncio
async def test_a_pending_round_widens_only_its_own_requests_lock() -> None:
    """Emma's Round 2 is pending; Liam's Round 1 is posted at $1,500 and CampMinder holds exactly that. Emma's $300
    widens Emma's lock alone: Liam stays confirmed against his own $1,500."""
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    seed_line(store, 9002, "1500", household=1000002, person=1000021)
    rows = await _rows(store)
    assert rows[EMMA].rounds[1].cm_pending is True  # the premise
    c = rows[LIAM].confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.gap) == ("confirmed", True, 1500.0, 0.0)


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_a_later_round_widens_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    row = (await _rows(store))[EMMA]
    assert (row.confirmation, row.rounds[1].cm_pending, row.unticked) == (None, False, [])
    assert row.queues == ["needs_offer", "waiting_on_family", "appeals"]


@pytest.mark.asyncio
async def test_the_budget_and_todays_counts_follow_a_pending_round_2() -> None:
    """Beside the pending Round 2 request: Liam short in CampMinder for Round 1 (Not reconciled, b) and Olivia with
    nothing there (Needs an offer). Today's Not reconciled counts Liam alone; Waiting on the family and Needs an offer
    are as before. Rounds & budget's Decision 3 tally reads the posted rounds' shortfall (round_ledger), which an
    over-posting never has, so its counts are 0 either way; its Needs an offer count is the grid's list."""
    store = FakeDecisionsStore()
    _round2(store, held="1800")
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_line(store, 9002, "1300", household=1000002, person=1000021)
    seed_request(store, "reqoliv00000001", household=1000003, person=1000031)
    lines = await _today_lines(store)
    assert [(k, lines[k].items) for k in ("needs_offer", "waiting_on_family", "not_reconciled")] == [
        ("needs_offer", 1),
        ("waiting_on_family", 1),
        ("not_reconciled", 1),
    ]
    assert [r.code for r in lines["not_reconciled"].reasons] == ["short_posting"]
    assert lines["not_reconciled"].largest_gap is None
    out = await _service(store).budget(YEAR)
    strip = {c.round: c for c in out.strip}
    assert strip[1].awaiting_sync is not None
    assert strip[1].not_reconciled is not None
    assert (strip[1].awaiting_sync.requests, strip[1].not_reconciled.requests) == (0, 0)
    assert strip[2].not_reconciled is not None
    assert strip[2].not_reconciled.requests == 0
    assert strip[1].needs_offer is not None
    assert strip[2].needs_offer is not None
    assert (strip[1].needs_offer.requests, strip[2].needs_offer.requests) == (1, 0)


# --- a $0 round never auto-ticks on money beyond the lock (owner 10-03, option i) ----------------------------
#
# Round 3 is decided at $0 (not eligible: no statement of need) beside Rounds 1 and 2 posted, and CampMinder holds more
# than the two posted rounds lock. That excess is no posting of a $0 round: the walk stops at it with no tick, so the
# round is no C1 pending round, tonight's tick posts nothing, and the request reads over through direction (a). A $0 round
# is ticked by hand (Mark posted) only. The stop is internal for now: it gets no Not reconciled (b) row until the owner
# words one.


def _round3_zero(store: FakeDecisionsStore, *, held: str) -> None:
    """Emma: Rounds 1 and 2 posted ($1,500 and $300) before last night's sync, and a Round 3 ask with no statement of
    need, so the calculator decides it at $0 (not eligible). CampMinder holds `held` on her request."""
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))  # Round 3 needs a Round 2 decision
    _posted(store, EMMA, 2, "300")
    _event(store, EMMA, 3, "ask", amount=Decimal(500))  # no statement of need: not eligible
    _event(store, EMMA, 3, "award", amount=Decimal(500))
    seed_line(store, 9001, held)
    store.synced_at = T0.replace(hour=23)


_ZERO_R3 = (view(1, "posted", locked="1500"), view(2, "posted", locked="300"), view(3, "needs_offer", decided="0"))


def test_the_walk_makes_no_tick_for_a_zero_round_on_money_beyond_the_lock() -> None:
    walk = ledger_walk([priced("emma", 1000001, *_ZERO_R3)], ledger_of("emma", line(1, "2000")), today=TODAY)
    assert walk.ticks == ()
    assert [(s.round, s.code, s.held, s.decided) for s in walk.stops] == [(3, "zero_round", Decimal(200), Decimal(0))]
    assert ledger_ticks([priced("emma", 1000001, *_ZERO_R3)], ledger_of("emma", line(1, "2000")), today=TODAY) == []


def test_the_walk_stops_at_a_zero_round_so_nothing_after_it_ticks() -> None:
    """Option i: a stop, not a skip. CampMinder covers Round 2 in full, but Round 1 ($0) is never ticked by the walk, and
    a later round is never ticked before the one before it."""
    rounds = (view(1, "needs_offer", decided="0"), view(2, "needs_offer", decided="300"))
    walk = ledger_walk([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "300")), today=TODAY)
    assert walk.ticks == ()
    assert [(s.round, s.code) for s in walk.stops] == [(1, "zero_round")]


def test_a_zero_round_1_on_money_in_campminder_makes_no_tick() -> None:
    walk = ledger_walk(
        [priced("emma", 1000001, view(1, "needs_offer", decided="0"))], ledger_of("emma", line(1, "500")), today=TODAY
    )
    assert walk.ticks == ()


def test_a_zero_round_with_nothing_beyond_the_lock_is_no_stop() -> None:
    """The $1,800 case: CampMinder holds exactly Rounds 1 and 2, so nothing is left for Round 3 and the walk ends there,
    as it did before."""
    walk = ledger_walk([priced("emma", 1000001, *_ZERO_R3)], ledger_of("emma", line(1, "1800")), today=TODAY)
    assert (walk.ticks, walk.stops) == ((), ())


def test_a_zero_round_someone_unmarked_still_reads_unmarked_by_hand() -> None:
    """Undone comes first: a $0 round a person un-ticked keeps its Unmarked by hand reason (a visible row with Mark
    posted), not the internal zero_round stop, which shows no row at all."""
    walk = ledger_walk(
        [priced("emma", 1000001, *_ZERO_R3)], ledger_of("emma", line(1, "2000")), today=TODAY, undone={("emma", 3)}
    )
    assert walk.ticks == ()
    assert [(s.round, s.code) for s in walk.stops] == [(3, "undone")]


def test_a_non_zero_round_on_an_over_posting_still_ticks_at_its_decided_amount() -> None:
    rounds = (*_ZERO_R3[:2], view(3, "needs_offer", decided="100"))
    walk = ledger_walk([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "2000")), today=TODAY)
    assert [(t.round, t.amount) for t in walk.ticks] == [(3, Decimal(100))]
    assert walk.stops == ()


@pytest.mark.parametrize("held", ["2000", "1800", "1500"])
def test_ledger_ticks_is_the_walks_ticks_beside_a_zero_round(held: str) -> None:
    for rounds in (_ZERO_R3, (view(1, "needs_offer", decided="0"), view(2, "needs_offer", decided="300"))):
        requests = [priced("emma", 1000001, *rounds)]
        walk = ledger_walk(
            requests, ledger_of("emma", line(1, held)), today=TODAY, family_unplaced={"emma": Decimal(500)}
        )
        assert list(walk.ticks) == ledger_ticks(requests, ledger_of("emma", line(1, held)), today=TODAY)


def test_the_zero_round_stop_gets_no_visible_reason_yet() -> None:
    """It awaits the owner's words: no pill, no sentence, no schema code."""
    from typing import get_args

    from api.schemas.financial_aid_decisions import UntickedReasonOut

    assert "zero_round" not in UNTICKED_LABELS
    assert "zero_round" not in get_args(UntickedReasonOut)


@pytest.mark.asyncio
async def test_a_zero_round_3_on_an_over_posting_is_not_pending_and_reads_over() -> None:
    """The repro: CampMinder holds $2,000 against Rounds 1 and 2's $1,800. Round 3 ($0) is not "Posted in CampMinder
    ($0)"; the $200 is an over-posting, in Not reconciled through direction (a), and tonight's tick posts nothing."""
    store = FakeDecisionsStore()
    _round3_zero(store, held="2000")
    row = (await _rows(store))[EMMA]
    r3 = row.rounds[2]
    assert (r3.status, r3.decided) == ("needs_offer", 0.0)  # the premise: Round 3 decided at $0
    assert (r3.cm_pending, r3.cm_pending_message) == (False, None)
    assert row.stage is not None
    assert row.stage.label != "R3 · Posted"
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.locked, c.in_campminder, c.gap) == ("over", False, 1800.0, 2000.0, 200.0)
    assert row.unticked == []
    assert "not_reconciled" in (row.queues or [])
    unreconciled = (await _today_lines(store))["not_reconciled"]
    assert [(r.code, r.items) for r in unreconciled.reasons] == [("over", 1)]
    assert (unreconciled.items, unreconciled.largest_gap) == (1, 200.0)
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match="Round 3 is not posted"):
        await service.tick_accepted(YEAR, _accept((EMMA, 3)), ACTOR)  # no pending round: Accepted waits for a tick
    assert (await service.ledger_ticks(YEAR)).ticked == 0
    after = (await _rows(store))[EMMA]
    assert after.rounds[2].status == "needs_offer"
    assert after.confirmation is not None
    assert (after.confirmation.status, after.confirmation.gap) == ("over", 200.0)


@pytest.mark.asyncio
async def test_a_zero_round_3_reads_as_it_did_where_campminder_holds_exactly_the_posted_rounds() -> None:
    """CampMinder holds $1,800, Rounds 1 and 2 exactly: Round 3 ($0) is not ticked, as before (pinned on main)."""
    store = FakeDecisionsStore()
    _round3_zero(store, held="1800")
    row = (await _rows(store))[EMMA]
    r3 = row.rounds[2]
    assert (r3.status, r3.decided, r3.cm_pending, r3.cm_pending_message) == ("needs_offer", 0.0, False, None)
    c = row.confirmation
    assert c is not None
    assert (c.status, c.reconciled, c.gap) == ("confirmed", True, 0.0)
    assert (row.unticked, row.queues) == ([], ["needs_offer", "waiting_on_family", "appeals"])
    assert [r.round for r in offer_rounds(row)] == [3]
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 0
    assert (await _rows(store))[EMMA].rounds[2].status == "needs_offer"


@pytest.mark.asyncio
async def test_the_zero_round_3_repro_offers_round_3_as_the_exact_case_does() -> None:
    """Once Round 3 is no pending round, it is a round needing an offer like the $1,800 case's, beside the over-posting."""
    store = FakeDecisionsStore()
    _round3_zero(store, held="2000")
    row = (await _rows(store))[EMMA]
    assert [r.round for r in offer_rounds(row)] == [3]
    assert row.queues == ["needs_offer", "waiting_on_family", "appeals", "not_reconciled"]


def _zero_round_1(store: FakeDecisionsStore) -> FakeRules:
    """Emma's family above the income ceiling, so Round 1 is decided at $0 (in practice only a hand-typed $0: Round 1 is
    never calculated below the rules' minimum), and CampMinder holding $500 on her request with nothing posted. Returns
    the rules that price it so."""
    from tests.unit.api.services.financial_aid_fakes import intake_rules
    from tests.unit.bunking.financial_aid.fixtures import with_lever

    seed_request(store, EMMA, income=900000.0)
    seed_line(store, 9001, "500")
    store.synced_at = T0.replace(hour=23)
    return FakeRules(approved(with_lever(intake_rules(), "tiers.income_ceiling", "100000")))


@pytest.mark.asyncio
async def test_a_zero_round_1_on_money_in_campminder_shows_only_through_the_note() -> None:
    """Owner 10-03 (option 2, internal only): the walk makes no tick and no pending round; the row has no Not reconciled
    reason and is not in Not reconciled; the D81 Note alone shows CampMinder's money."""
    store = FakeDecisionsStore()
    service = _service(store, _zero_round_1(store))
    season = await service.with_unticked(await service.season(YEAR))
    r1_view = season.priced[EMMA].rounds[0]
    assert (r1_view.status, r1_view.decided) == ("needs_offer", Decimal(0))  # the premise: Round 1 decided at $0
    assert dict(season.pending) == {}
    assert ledger_walk(season.priced.values(), season.ledger, today=TODAY).ticks == ()
    row = {r.request_id: r for r in (await service.grid(YEAR)).rows}[EMMA]
    assert (row.rounds[0].cm_pending, row.rounds[0].cm_pending_message) == (False, None)
    assert row.unticked == []
    assert "not_reconciled" not in (row.queues or [])
    assert _notes(row) == ["CampMinder shows $500 for this family; not yet ticked"]
    assert (await service.ledger_ticks(YEAR)).ticked == 0
    assert {r.request_id: r for r in (await service.grid(YEAR)).rows}[EMMA].rounds[0].status == "needs_offer"


@pytest.mark.asyncio
async def test_a_non_zero_round_3_on_an_over_posting_still_pends_at_its_decided_amount() -> None:
    """Round 3 decided at $100 and CampMinder holding $2,000: Round 3 pends (and ticks) at $100, and the request is over
    by the $100 beyond Rounds 1 to 3."""
    store = FakeDecisionsStore()
    _round3_pending(store, held="2000")
    row = (await _rows(store))[EMMA]
    r3 = row.rounds[2]
    assert (r3.cm_pending, r3.cm_pending_message) == (
        True,
        "Posted in CampMinder ($100). Kindred marks it posted after tonight's sync.",
    )
    c = row.confirmation
    assert c is not None
    assert (c.status, c.locked, c.gap) == ("over", 1900.0, 100.0)
    assert "not_reconciled" in (row.queues or [])
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 1
    assert (await _rows(store))[EMMA].rounds[2].status == "posted"


@pytest.mark.asyncio
async def test_a_zero_round_3_can_still_be_marked_posted_by_hand() -> None:
    store = FakeDecisionsStore()
    _round3_zero(store, held="2000")
    body = PostedIn(rows=[PostedRow(request_id=EMMA, round=3, amount=Decimal(0))])
    assert (await _service(store).tick_posted(YEAR, body, ACTOR)).written == 1
    assert (await _rows(store))[EMMA].rounds[2].status == "posted"


@pytest.mark.asyncio
async def test_before_the_first_ticked_season_a_zero_round_3_reads_as_before(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions_service, "FIRST_TICKED_SEASON", YEAR + 1)
    store = FakeDecisionsStore()
    _round3_zero(store, held="2000")
    row = (await _rows(store))[EMMA]
    assert (row.confirmation, row.rounds[2].cm_pending, row.unticked) == (None, False, [])

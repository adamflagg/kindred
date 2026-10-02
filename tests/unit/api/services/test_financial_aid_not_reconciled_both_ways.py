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
from api.schemas.financial_aid_decisions import GridRowOut, PostedIn, PostedRow, UnpostIn, UntickedMoneyOut
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
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, LIAM, _service
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

SHORT_TEXT = "CampMinder holds $1,300 of Round 1's $1,500, so the overnight tick left it. Check the posting, then use Mark posted."
SHARES_TEXT = (
    "The payer shares posted so far hold $600 of Round 1's $1,500. The round ticks once the shares cover it in full."
)
FAMILY_TEXT = (
    "CampMinder holds $3,000 for this family that is not on any request yet. Place it in Money › To place; placing it "
    "ticks the round it covers."
)
HELD_TEXT = "CampMinder holds $1,500 for this request, but Round 1 is on hold. This clears once the round is decided."
UNDONE_TEXT = (
    "Round 1 was un-ticked by hand, so the overnight tick leaves it for a person. Use Mark posted once it is right."
)
AWAITING_TEXT = "CampMinder holds Round 1's $1,500 in full. Tonight's ledger sync ticks it, or use Mark posted now."
WITHHELD_TEXT = (
    "Round 1 was not ticked automatically: after CampMinder posted it on Mar 8, the application was changed (Mar 9). "
    "The nightly ledger sync leaves it too: tick it by hand. That locks the higher of its decided amount on Mar 8 "
    "(where Kindred can rebuild that day) and today's. Check it against what the family was offered first."
)


def _out(code: str, message: str, *, mark_posted: bool, n: int = 1) -> UntickedMoneyOut:
    return UntickedMoneyOut(round=n, code=code, message=message, mark_posted=mark_posted)


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


@pytest.mark.parametrize("status", ["held", "pending_approval", "refused", "not_decided"])
def test_money_for_a_round_not_decided_yet_stops_the_walk_until_it_is(status: str) -> None:
    rounds = (view(1, "posted", locked="1800"), view(2, status, ask="400"))  # type: ignore[arg-type]
    walk = ledger_walk([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "2100")), today=TODAY)
    assert walk.stops == (TickStop("emma", 2, "not_decided", status, Decimal(300), None),)  # type: ignore[arg-type]


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
    assert stop_text(TickStop("e", 1, "short_posting", "needs_offer", Decimal(1300), Decimal(1500))) == SHORT_TEXT
    assert stop_text(TickStop("e", 1, "shares_short", "needs_offer", Decimal(600), Decimal(1500))) == SHARES_TEXT
    assert stop_text(TickStop("e", 1, "family_level", "needs_offer", Decimal(3000), Decimal(1500))) == FAMILY_TEXT
    assert stop_text(TickStop("e", 1, "not_decided", "held", Decimal(1500), None)) == HELD_TEXT
    assert stop_text(TickStop("e", 1, "undone", "needs_offer", Decimal(1500), Decimal(1500))) == UNDONE_TEXT
    pending = TickStop("e", 3, "not_decided", "pending_approval", Decimal("300.50"), None)
    assert stop_text(pending) == (
        "CampMinder holds $300.50 for this request, but Round 3 is pending finance's approval. "
        "This clears once the round is decided."
    )
    refused = TickStop("e", 3, "not_decided", "refused", Decimal(300), None)
    assert "but finance refused Round 3's amount." in stop_text(refused)
    undecided = TickStop("e", 2, "not_decided", "not_decided", Decimal(300), None)
    assert "but Round 2 is not decided yet." in stop_text(undecided)


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
    assert row.unticked == [_out("not_decided", HELD_TEXT, mark_posted=False)]
    assert "not_reconciled" in (row.queues or [])
    assert "needs_offer" not in (row.queues or [])


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
async def test_money_in_full_before_tonights_tick_is_not_reconciled_until_it_ticks() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500")
    row = (await _rows(store))[EMMA]
    assert row.unticked == [_out("awaiting_tick", AWAITING_TEXT, mark_posted=True)]
    assert row.queues == ["not_reconciled"]
    assert (await _service(store).ledger_ticks(YEAR)).ticked == 1
    after = (await _rows(store))[EMMA]
    assert (after.unticked, after.queues) == ([], ["waiting_on_family"])  # ticked from the ledger: confirmed


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


@pytest.mark.asyncio
async def test_nothing_in_campminder_leaves_the_row_in_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    row = (await _rows(store))[EMMA]
    assert (row.unticked, row.queues) == ([], ["needs_offer"])


@pytest.mark.asyncio
async def test_a_round_campminder_holds_nothing_for_stays_in_needs_an_offer_beside_one_that_ticks() -> None:
    """Per round, not per request: Round 1 is in CampMinder in full (awaiting tonight's tick); Round 2 has nothing
    there, so it still needs an offer, and Today's breakdown counts it under r2 only."""
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
    assert [(u.round, u.code) for u in row.unticked or []] == [(1, "awaiting_tick")]
    assert row.queues == ["needs_offer", "not_reconciled"]
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
    assert {rid: bool(_notes(r)) for rid, r in rows.items()} == {rid: bool(r.unticked) for rid, r in rows.items()}
    assert sum(bool(r.unticked) for r in rows.values()) == 4


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

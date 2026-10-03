"""Reconciliation with the CampMinder ledger (campership sub-project 10b; main spec §11; D12, D16,
D54, D59, D78, D81). Fictional throughout: households 10000xx, people 10000xx1, sessions 10001xx
(summer), 1000106 (Quest) and 1000201 (a Family Camp weekend)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal

from api.services.financial_aid_grants_register import Placement
from api.services.financial_aid_reconciliation import (
    CampLine,
    PlaceableRequest,
    build_ledger,
    camp_date,
    undone_rounds,
)
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.money import dollars

MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)  # 10 am Pacific (PST), Mar 8
MAR9 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)


def line(
    txn: int,
    amount: str,
    *,
    household: int = 1000001,
    person: int = 0,
    posted: datetime | None = MAR8,
    reversed_at: datetime | None = None,
    session: int = 0,
    family: str = "",
) -> CampLine:
    """One camp-aid line. Go's attribution names the posted person only when a session or family is given."""
    return CampLine(
        transaction_cm_id=txn,
        household_cm_id=household,
        person_cm_id=person,
        amount=Decimal(amount),
        post_date=posted,
        is_reversed=reversed_at is not None,
        reversal_date=reversed_at,
        attributed_person_cm_id=person if (session or family) else 0,
        attributed_session_cm_id=session,
        program_family=family,
    )


def request(
    rid: str,
    *,
    household: int = 1000001,
    person: int = 1000011,
    session: int = 1000101,
    family: str = "summer",
    status: str = "active",
    shares: Sequence[int] = (),
) -> PlaceableRequest:
    return PlaceableRequest(
        id=rid,
        household_cm_id=household,
        person_cm_id=person,
        session_cm_id=session,
        program_family=family,
        status=status,
        share_households=frozenset(shares or (household,)),
    )


def placed(
    lines: Sequence[CampLine],
    requests: Sequence[PlaceableRequest],
    placements: Mapping[int, Placement] | None = None,
) -> dict[int, str]:
    ledger = build_ledger(lines, placements or {}, requests, None)
    return {ln.transaction_cm_id: rid for rid, lns in ledger.by_request.items() for ln in lns}


# --- placement ----------------------------------------------------------------------------------


def test_a_line_on_a_camper_with_one_request_sits_on_that_request() -> None:
    assert placed([line(1, "1800", person=1000011)], [request("emma")]) == {1: "emma"}


def test_a_camper_with_several_requests_is_never_narrowed_by_campminders_attribution() -> None:
    """Go re-attributes nightly, so its choice is unstable (fix round 1, ruling 3): family level."""
    both = [request("emma"), request("emmaq", session=1000106, family="quest")]
    assert placed([line(1, "900", person=1000011, session=1000106, family="quest")], both) == {}
    assert placed([line(2, "900", person=1000011)], both) == {}
    same = [request("a"), request("b", session=1000102)]  # two requests in the same program
    assert placed([line(3, "900", person=1000011)], same) == {}


def test_a_line_go_attributed_to_another_program_is_not_placed_on_the_only_candidate() -> None:
    assert placed([line(1, "900", person=1000011, session=1000106, family="quest")], [request("emma")]) == {}
    adult = request("wk", person=1000019, session=1000201, family="adult_weekend")
    assert placed([line(2, "700", person=1000019, session=1000201, family="family_camp")], [adult]) == {}
    assert placed([line(3, "700", person=1000019, session=1000201, family="adult_weekend")], [adult]) == {3: "wk"}


def test_a_summer_household_line_stays_at_family_level_even_with_one_request() -> None:
    """Main spec §11 and D81: a line on a parent or the household waits for the registrar, whatever the count."""
    one = [request("emma")]
    two = [*one, request("samuel", person=1000012, session=1000102)]
    assert placed([line(1, "3000")], one) == {}
    assert placed([line(2, "1800", person=1000019)], one) == {}  # posted to a parent
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    assert placed([line(3, "700")], [*one, weekend]) == {}  # the household holds a summer request too
    assert placed([line(4, "700")], [weekend]) == {4: "fam"}  # its only request
    summer_tagged = line(5, "700", session=1000101, family="summer")
    assert placed([summer_tagged], [weekend]) == {}
    assert placed([summer_tagged], [*one, weekend]) == {}
    parent_summer = line(6, "700", person=1000019, session=1000101, family="summer")
    assert placed([parent_summer], [*one, weekend]) == {}
    assert placed([parent_summer], [weekend]) == {}
    ledger = build_ledger([line(1, "3000")], {}, two, None)
    assert ledger.by_request == {}
    assert ledger.unplaced_by_household == {1000001: Decimal(3000)}
    assert ledger.family_unplaced({1000001, 1000009}) == Decimal(3000)


def test_a_line_on_a_sibling_with_no_request_is_never_placed_on_another_sibling() -> None:
    assert placed([line(1, "500", person=1000012)], [request("emma")]) == {}


def test_a_payer_share_households_line_naming_the_camper_sits_on_their_request() -> None:
    noah = request("noah", household=1000003, person=1000031, shares=(1000003, 1000004))
    assert placed([line(1, "960", household=1000004, person=1000031)], [noah]) == {1: "noah"}
    assert placed([line(2, "960", household=1000004)], [noah]) == {}  # naming no one: family level


def test_a_parents_family_camp_line_sits_on_the_households_request() -> None:
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    assert placed([line(1, "700", person=1000019)], [weekend]) == {1: "fam"}


def test_a_staff_placement_decides() -> None:
    two = [request("emma"), request("samuel", person=1000012, session=1000102)]
    staff = {1: Placement(1, 1000012, 1000102, "summer")}
    assert placed([line(1, "1200")], two, staff) == {1: "samuel"}
    person_only = {4: Placement(4, 1000019, 0, "")}
    assert placed([line(4, "700", person=1000019)], [request("f", person=0, family="family_camp")], person_only) == {}
    parent = {2: Placement(2, 1000019, 1000201, "family_camp")}
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    assert placed([line(2, "700", person=1000019)], [*two, weekend], parent) == {2: "fam"}


def test_a_withdrawn_or_duplicate_request_takes_no_line() -> None:
    for status in ("withdrawn", "duplicate", "duplicate_pending"):
        assert placed([line(1, "1800", person=1000011)], [request("emma", status=status)]) == {}


def test_an_unmatched_request_still_takes_its_campers_line() -> None:
    """Intake makes a cancelled camper's request unmatched (session 0); its money must still reconcile."""
    lost = request("emma", session=0, family="", status="unmatched_session")
    assert placed([line(1, "1800", person=1000011)], [lost]) == {1: "emma"}


def test_a_reversed_line_is_placed_like_a_live_one_but_never_counts_as_unplaced_money() -> None:
    assert placed([line(1, "900", person=1000011, reversed_at=JUN1)], [request("a")]) == {1: "a"}
    ledger = build_ledger([line(2, "900", reversed_at=JUN1)], {}, [request("a"), request("b", person=1000012)], None)
    assert ledger.unplaced_by_household == {}


def test_a_staff_placement_is_honoured_when_the_named_person_has_their_own_request() -> None:
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    summer = request("emma")
    # (a) a camper with a summer request, placed on the household's Family Camp request
    for named in (Placement(1, 1000011, 1000201, ""), Placement(1, 1000011, 0, "family_camp")):
        assert placed([line(1, "700", person=1000011)], [summer, weekend], {1: named}) == {1: "fam"}
    # (b) a parent with an adult-weekend request of their own, placed on Family Camp
    adult = request("wk", person=1000019, session=1000202, family="adult_weekend")
    fc = {2: Placement(2, 1000019, 1000201, "family_camp")}
    assert placed([line(2, "700", person=1000019)], [adult, weekend], fc) == {2: "fam"}
    # and the placement still picks the person's own request when that is what it names
    own = {3: Placement(3, 1000019, 1000202, "")}
    assert placed([line(3, "700", person=1000019)], [adult, weekend], own) == {3: "wk"}


def test_a_session_placement_matches_the_persons_only_unmatched_request() -> None:
    lost = request("emma", session=0, family="", status="unmatched_session")
    old = {1: Placement(1, 1000011, 1000101, "summer")}
    assert placed([line(1, "1800", person=1000011)], [lost], old) == {1: "emma"}
    other = request("emmaq", session=1000106, family="quest")
    assert placed([line(1, "1800", person=1000011)], [lost, other], old) == {}  # not their only request


def test_a_family_camp_placement_beats_the_persons_lone_unmatched_request() -> None:
    lost = request("emma", session=0, family="", status="unmatched_session")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    staff = {1: Placement(1, 1000011, 1000201, "family_camp")}
    assert placed([line(1, "700", person=1000011)], [lost, weekend], staff) == {1: "fam"}


# --- small helpers -------------------------------------------------------------------------------


def test_a_line_is_live_now_or_as_of_an_instant() -> None:
    reversed_line = line(1, "900", posted=MAR8, reversed_at=JUN1)
    assert not reversed_line.live()
    assert reversed_line.live(MAR9)
    assert not reversed_line.live(JUN1)
    assert not line(2, "900", posted=MAR9).live(MAR8)
    assert reversed_line.reversed_by()
    assert not reversed_line.reversed_by(MAR9)


def test_camp_dates_are_pacific_and_dollars_are_exact() -> None:
    assert camp_date(datetime(2027, 3, 9, 5, 0, tzinfo=UTC)) == date(2027, 3, 8)  # 9 pm Pacific, Mar 8
    assert (dollars(Decimal(1800)), dollars(Decimal("1800.50"))) == ("$1,800", "$1,800.50")


# --- clawback (Task 2) ---------------------------------------------------------------------------

from dataclasses import replace

from api.services.financial_aid_reconciliation import apply_clawback, clawback_eligible
from bunking.financial_aid.decisions import RoundState
from tests.unit.bunking.financial_aid.test_decision_budget import priced, view

POSTED_R1 = {
    1: RoundState(
        round=1,
        posted=True,
        locked_amount=Decimal(1800),
        locked_at=MAR9,
        posted_on=date(2027, 3, 9),
        lock_source="tick",
    )
}
R1 = priced("emma", 1000001, view(1, "posted", locked="1800", accepted=True))


def test_a_reversal_with_nothing_left_live_claws_the_posted_rounds_back() -> None:
    out, day = apply_clawback(
        R1, POSTED_R1, [line(1, "1800", posted=MAR9, reversed_at=JUN1)], eligible=True, family_lines=[]
    )
    assert day == date(2027, 6, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_an_appeals_reverse_and_repost_is_not_a_clawback() -> None:
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1), line(2, "2100", posted=JUN1)]
    out, day = apply_clawback(R1, POSTED_R1, lines, eligible=True, family_lines=[])
    assert day is None
    assert out is R1


def test_a_line_reversed_before_the_round_was_posted_is_no_clawback() -> None:
    """A typo reversed on Mar 8, before the registrar's Mar 9 tick: that tick reads "not in CampMinder", not reversed."""
    lines = [line(1, "1700", posted=MAR8, reversed_at=datetime(2027, 3, 8, 20, 0, tzinfo=UTC))]
    assert apply_clawback(R1, POSTED_R1, lines, eligible=True, family_lines=[])[1] is None


def test_a_request_with_nothing_posted_or_nothing_placed_is_left_alone() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert apply_clawback(needs, {}, [line(1, "1800", reversed_at=JUN1)], eligible=True, family_lines=[]) == (
        needs,
        None,
    )
    assert apply_clawback(R1, POSTED_R1, [], eligible=True, family_lines=[]) == (R1, None)


def test_as_of_a_day_before_the_reversal_the_money_is_still_posted() -> None:
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    assert (
        apply_clawback(R1, POSTED_R1, lines, at=datetime(2027, 5, 1, tzinfo=UTC), eligible=True, family_lines=[])[1]
        is None
    )
    assert apply_clawback(R1, POSTED_R1, lines, at=datetime(2027, 6, 2, tzinfo=UTC), eligible=True, family_lines=[])[
        1
    ] == date(2027, 6, 1)


def test_a_ledger_lock_with_no_posted_day_uses_the_day_it_locked() -> None:
    rounds = {1: replace(POSTED_R1[1], posted_on=None)}
    assert apply_clawback(R1, rounds, [line(1, "1800", posted=MAR9, reversed_at=JUN1)], eligible=True, family_lines=[])[
        1
    ] == date(2027, 6, 1)


# --- a closed (withdrawn / duplicate) request that holds posted money (D54 + SP10a Decision 13) ---


def _closed_lines(
    lines: Sequence[CampLine], requests: Sequence[PlaceableRequest], posted: frozenset[str]
) -> tuple[dict[str, tuple[CampLine, ...]], dict[str, tuple[CampLine, ...]]]:
    ledger = build_ledger(lines, {}, requests, None, posted_request_ids=posted)
    return dict(ledger.by_request), dict(ledger.by_closed_request)


def test_a_withdrawn_requests_posted_money_is_clawed_back_when_campminder_reverses_it() -> None:
    withdrawn = request("r1", person=1000011, status="withdrawn")
    rev = line(1, "1800", person=1000011, posted=MAR9, reversed_at=JUN1, session=1000101, family="summer")
    ledger = build_ledger([rev], {}, [withdrawn], None, posted_request_ids=frozenset({"r1"}))
    out, day = apply_clawback(R1, POSTED_R1, ledger.closed_lines("r1"), eligible=True, family_lines=[])
    assert day == date(2027, 6, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_a_withdrawn_request_with_nothing_posted_never_takes_a_line() -> None:
    withdrawn = request("r1", person=1000011, status="withdrawn")
    rev = line(1, "1800", person=1000011, posted=MAR9, reversed_at=JUN1)
    assert _closed_lines([rev], [withdrawn], frozenset()) == ({}, {})


def test_a_line_that_fits_a_live_and_a_withdrawn_request_goes_to_the_live_one() -> None:
    live = request("live", person=1000011)
    withdrawn = request("old", person=1000011, status="withdrawn")
    by_request, closed = _closed_lines([line(1, "1800", person=1000011)], [live, withdrawn], frozenset({"old"}))
    assert list(by_request) == ["live"]
    assert closed == {}


def test_a_closed_requests_line_is_never_a_live_placement_and_leaves_no_family_money() -> None:
    withdrawn = request("r1", person=1000011, status="duplicate")
    ledger = build_ledger(
        [line(1, "1800", person=1000011)], {}, [withdrawn], None, posted_request_ids=frozenset({"r1"})
    )
    assert ledger.lines("r1") == ()  # what ticks and Needs an offer read
    assert ledger.by_request == {}
    assert ledger.family_unplaced([1000001]) == 0
    assert len(ledger.closed_lines("r1")) == 1


def test_two_closed_candidates_stay_unplaced() -> None:
    a = request("a", person=1000011, status="withdrawn")
    b = request("b", person=1000011, status="duplicate", session=1000102)
    assert _closed_lines([line(1, "1800", person=1000011)], [a, b], frozenset({"a", "b"})) == ({}, {})


# --- fix round 1 ---------------------------------------------------------------------------------


def test_several_live_candidates_never_fall_through_to_a_withdrawn_posted_request() -> None:
    """Probe 1: two live requests are ambiguity, not absence, so the second pass does not run."""
    live_a = request("a", person=1000011)
    live_b = request("b", person=1000011, session=1000102)
    old = request("old", person=1000011, status="withdrawn", session=1000103)
    ledger = build_ledger([line(1, "1800", person=1000011)], {}, [live_a, live_b, old], None, frozenset({"old"}))
    assert (ledger.by_request, ledger.by_closed_request) == ({}, {})
    assert ledger.family_unplaced([1000001]) == Decimal(1800)


def test_a_household_line_beside_several_live_requests_never_lands_on_a_withdrawn_family_camp_request() -> None:
    """Probe 2: the household holds live requests, so its line is ambiguous at family level."""
    a = request("a", person=1000011)
    b = request("b", person=1000012, session=1000102)
    old = request("old", person=0, status="withdrawn", session=1000201, family="family_camp")
    ledger = build_ledger([line(1, "1800")], {}, [a, b, old], None, frozenset({"old"}))
    assert (ledger.by_request, ledger.by_closed_request) == ({}, {})
    assert ledger.family_unplaced([1000001]) == Decimal(1800)


def test_a_siblings_live_request_does_not_block_a_withdrawn_campers_own_line() -> None:
    withdrawn = request("old", person=1000011, status="withdrawn")
    sibling = request("sib", person=1000012, session=1000102)
    ledger = build_ledger([line(1, "1800", person=1000011)], {}, [withdrawn, sibling], None, frozenset({"old"}))
    assert list(ledger.by_closed_request) == ["old"]


def test_family_level_money_on_the_request_s_households_holds_a_clawback_back() -> None:
    """An appeal's repost may sit unplaced on a parent: the money may still be held (D54)."""
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    assert apply_clawback(R1, POSTED_R1, lines, eligible=True, family_lines=[line(2, "2100", posted=JUN1)])[1] is None
    assert apply_clawback(R1, POSTED_R1, lines, eligible=True, family_lines=[])[1] == date(2027, 6, 1)


def test_the_first_posted_day_across_rounds_is_the_earliest() -> None:
    """A reversal between two rounds' posted days still follows the first posted day (min)."""
    two = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "posted", locked="300"))
    rounds = {1: POSTED_R1[1], 2: replace(POSTED_R1[1], round=2, posted_on=date(2027, 6, 15))}
    between = [line(1, "2100", posted=MAR9, reversed_at=JUN1)]  # after Round 1's day, before Round 2's
    assert apply_clawback(two, rounds, between, eligible=True, family_lines=[])[1] == date(2027, 6, 1)


# --- fix round 2 ---------------------------------------------------------------------------------


def test_a_staff_placement_on_a_withdrawn_session_lands_there_though_the_camper_has_a_live_request() -> None:
    old = request("old", person=1000011, status="withdrawn", session=1000101)
    live = request("live", person=1000011, session=1000102)
    pl = {1: Placement(transaction_cm_id=1, person_cm_id=1000011, session_cm_id=1000101, program_family="")}
    ledger = build_ledger([line(1, "1800", person=1000011)], pl, [old, live], None, frozenset({"old"}))
    assert list(ledger.by_closed_request) == ["old"]
    assert ledger.by_request == {}


def test_a_staff_family_camp_placement_lands_on_a_withdrawn_family_camp_request_beside_a_childs_live_one() -> None:
    old = request("old", person=0, status="withdrawn", session=1000201, family="family_camp")
    child = request("kid", person=1000011)
    pl = {1: Placement(transaction_cm_id=1, person_cm_id=0, session_cm_id=0, program_family="family_camp")}
    ledger = build_ledger([line(1, "1800")], pl, [old, child], None, frozenset({"old"}))
    assert list(ledger.by_closed_request) == ["old"]
    assert ledger.by_request == {}


def test_a_line_on_a_person_whose_own_request_is_withdrawn_goes_to_the_closed_request_beside_two_live_family_camps() -> (
    None
):
    """Decision 3 / D54: the person's own request is closed, so the closed pass takes the line; the
    household's Family Camp requests are never consulted for it."""
    old = request("old", person=1000011, status="withdrawn")
    fc_a = request("fa", person=0, session=1000201, family="family_camp")
    fc_b = request("fb", person=0, session=1000202, family="family_camp")
    ledger = build_ledger([line(1, "1800", person=1000011)], {}, [old, fc_a, fc_b], None, frozenset({"old"}))
    assert (ledger.by_request, list(ledger.by_closed_request)) == ({}, ["old"])
    assert ledger.family_unplaced([1000001]) == Decimal(0)


# --- confirmation and the Note (Task 3) -------------------------------------------------------------

from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_reconciliation import Confirmation, confirmation, ledger_note

SYNCED = datetime(2027, 3, 10, 9, 0, tzinfo=UTC)  # the night after the Mar 9 tick


def share(household: int, pct: str) -> PayerShareRecord:
    return PayerShareRecord(
        id=f"shr{household:012d}",
        year=2027,
        request_id="emma",
        household_cm_id=household,
        share_pct=Decimal(pct),
        source="staff",
        actor="registrar@example.com",
    )


def confirm(
    lines: Sequence[CampLine],
    *,
    shares: Sequence[PayerShareRecord] = (),
    synced: datetime | None = SYNCED,
    rounds: Mapping[int, RoundState] = POSTED_R1,
) -> Confirmation | None:
    return confirmation(R1, rounds, lines, shares, 1000001, synced_at=synced)


def test_a_tick_made_after_the_last_sync_awaits_tonights_sync() -> None:
    c = confirm([], synced=datetime(2027, 3, 9, 9, 0, tzinfo=UTC))
    assert c is not None
    assert (c.status, c.reconciled) == ("awaiting_sync", True)  # V1 (owner 10-03): no exception until a sync runs
    never = confirm([line(1, "1800", posted=MAR9)], synced=None)
    assert never is not None
    assert never.status == "awaiting_sync"


def test_the_ledgers_own_tick_never_waits_for_the_sync() -> None:
    rounds = {1: replace(POSTED_R1[1], lock_source="ledger", locked_at=datetime(2027, 3, 10, 10, 0, tzinfo=UTC))}
    c = confirm([line(1, "1800", posted=MAR9)], rounds=rounds)
    assert c is not None
    assert c.status == "confirmed"


def test_the_ledger_confirms_or_shows_short_over_or_not_in_campminder_by_net_total() -> None:
    confirmed = confirm([line(1, "1800", posted=MAR9)])
    assert confirmed is not None
    assert (confirmed.status, confirmed.on, confirmed.reconciled) == (
        "confirmed",
        date(2027, 3, 9),
        True,
    )
    short = confirm([line(1, "1590", posted=MAR9)])
    assert short is not None
    assert (short.status, short.in_campminder, short.gap) == ("short", Decimal(1590), Decimal(-210))
    over = confirm([line(1, "1800"), line(2, "300", posted=MAR9)])
    assert over is not None
    assert (over.status, over.gap) == ("over", Decimal(300))
    missing = confirm([])
    assert missing is not None
    assert (missing.status, missing.on) == ("not_in_campminder", None)


def test_posting_habit_does_not_matter_only_the_net() -> None:
    """Reverse-and-repost plus the +$300 on its own line reconcile like one line (main spec §11)."""
    lines = [line(1, "1500", posted=MAR8, reversed_at=MAR9), line(2, "1500", posted=MAR9), line(3, "300", posted=MAR9)]
    c = confirm(lines)
    assert c is not None
    assert (c.status, c.in_campminder) == ("confirmed", Decimal(1800))


def test_each_payer_share_is_confirmed_against_its_own_household() -> None:
    """The family total matches, but it was all posted to one parent: one share over, the other missing."""
    c = confirm([line(1, "1800", posted=MAR9)], shares=[share(1000001, "60"), share(1000004, "40")])
    assert c is not None
    assert c.status == "confirmed"
    assert not c.reconciled
    assert [(s.household_cm_id, s.expected, s.in_campminder, s.status) for s in c.shares] == [
        (1000001, Decimal(1080), Decimal(1800), "over"),
        (1000004, Decimal(720), Decimal(0), "not_in_campminder"),
    ]


def test_one_share_or_shares_not_adding_up_give_no_share_lines() -> None:
    one = confirm([line(1, "1800", posted=MAR9)], shares=[share(1000001, "100")])
    broken = confirm([line(1, "1800", posted=MAR9)], shares=[share(1000001, "60"), share(1000004, "30")])
    assert one is not None
    assert broken is not None
    assert one.shares == ()
    assert broken.shares == ()


def test_a_clawed_back_request_reads_reversed_and_a_request_with_nothing_posted_reads_nothing() -> None:
    back = priced("emma", 1000001, replace(view(1, "posted", locked="1800"), clawed_back=True))
    c = confirmation(back, POSTED_R1, [], (), 1000001, synced_at=SYNCED, reversed_on=date(2027, 6, 1))
    assert c is not None
    assert (c.status, c.on, c.locked, c.reconciled) == ("reversed", date(2027, 6, 1), Decimal(0), True)
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert confirmation(needs, {}, [], (), 1000001, synced_at=SYNCED) is None


def test_the_family_level_figure_travels_with_the_confirmation() -> None:
    c = confirmation(R1, POSTED_R1, [], (), 1000001, synced_at=SYNCED, family_unplaced=Decimal(1200))
    assert c is not None
    assert (c.status, c.family_unplaced) == ("not_in_campminder", Decimal(1200))


def test_money_in_campminder_on_an_unticked_row_raises_the_note() -> None:
    held = priced("emma", 1000001, view(1, "held", ask="2000"))
    note = ledger_note(held, [line(1, "1800", person=1000011)], Decimal(0))
    assert note is not None
    assert (note.code, note.severity) == ("in_campminder_not_ticked", "warn")
    assert note.message == "CampMinder shows $1,800 for this family; not yet ticked"


def test_an_unplaced_family_line_raises_the_note_on_each_unticked_request() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    note = ledger_note(needs, [], Decimal(3000))
    assert note is not None
    assert note.message == "CampMinder shows $3,000 for this family; not yet ticked"


def test_no_note_once_every_round_is_ticked_nothing_is_extra_or_the_request_is_not_live() -> None:
    assert ledger_note(R1, [line(1, "1800")], Decimal(500)) is None  # every round posted
    appeal = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "needs_offer", decided="300"))
    assert ledger_note(appeal, [line(1, "1800")], Decimal(0)) is None  # CampMinder holds only what is locked
    gone = priced("emma", 1000001, view(1, "needs_offer", decided="1800"), live=False)
    assert ledger_note(gone, [line(1, "1800")], Decimal(0)) is None


# --- Task 3 fix round 1 -----------------------------------------------------------------------------


def test_a_posted_zero_lock_with_nothing_in_campminder_is_a_real_confirmed_zero() -> None:
    zero = priced("emma", 1000001, view(1, "posted", locked="0"))
    c = confirmation(zero, POSTED_R1, [], (), 1000001, synced_at=SYNCED)
    assert c is not None
    assert (c.status, c.locked, c.reconciled) == ("confirmed", Decimal(0), True)


def test_a_zero_dollar_share_beside_a_matching_line_is_confirmed() -> None:
    one = priced("emma", 1000001, view(1, "posted", locked="1"))
    c = confirmation(
        one,
        POSTED_R1,
        [line(1, "1", posted=MAR9)],
        [share(1000001, "60"), share(1000004, "40")],
        1000001,
        synced_at=SYNCED,
    )
    assert c is not None
    assert [(s.household_cm_id, s.expected, s.status) for s in c.shares] == [
        (1000001, Decimal(1), "confirmed"),
        (1000004, Decimal(0), "confirmed"),
    ]
    assert c.reconciled


def test_a_lock_with_extra_money_confirms_against_the_lines_summed() -> None:
    with_extra = priced("emma", 1000001, view(1, "posted", locked="2100", extra="300"))
    lines = [line(1, "1800", posted=MAR9), line(2, "300", posted=MAR9)]
    c = confirmation(with_extra, POSTED_R1, lines, (), 1000001, synced_at=SYNCED)
    assert c is not None
    assert (c.status, c.locked, c.in_campminder) == ("confirmed", Decimal(2100), Decimal(2100))


def test_a_sub_dollar_gap_reads_short() -> None:
    c = confirm([line(1, "1799.50", posted=MAR9)])
    assert c is not None
    assert (c.status, c.gap) == ("short", Decimal("-0.50"))


def test_a_share_that_is_short_reads_short_and_holds_the_request_unreconciled() -> None:
    lines = [line(1, "1080", posted=MAR9), line(2, "500", household=1000004, posted=MAR9)]
    c = confirm(lines, shares=[share(1000001, "60"), share(1000004, "40")])
    assert c is not None
    assert [(s.household_cm_id, s.status) for s in c.shares] == [(1000001, "confirmed"), (1000004, "short")]
    assert not c.reconciled


def test_shares_await_the_sync_while_the_request_awaits_it() -> None:
    c = confirm([], shares=[share(1000001, "60"), share(1000004, "40")], synced=datetime(2027, 3, 9, 9, 0, tzinfo=UTC))
    assert c is not None
    assert c.status == "awaiting_sync"
    assert [s.status for s in c.shares] == ["awaiting_sync", "awaiting_sync"]


# --- the automatic tick (Task 4) ---------------------------------------------------------------------

from api.services.financial_aid_reconciliation import SeasonLedger, ledger_ticks

TODAY = date(2027, 3, 10)


def ledger_of(request_id: str, *lines: CampLine) -> SeasonLedger:
    return SeasonLedger(by_request={request_id: tuple(lines)}, read=True)


def test_money_beyond_the_locks_ticks_the_oldest_decided_round_at_its_decided_amount() -> None:
    """D78 / D146: an over-posting ($1,801 for $1,800) still locks the decided $1,800; the gap is the confirmation's."""
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    (tick,) = ledger_ticks([needs], ledger_of("emma", line(1, "1801", posted=MAR9)), today=TODAY)
    assert (tick.request_id, tick.round, tick.amount, tick.posted_on, tick.in_campminder) == (
        "emma",
        1,
        Decimal(1800),
        date(2027, 3, 9),
        Decimal(1801),
    )


def test_a_first_round_needs_the_full_decided_amount_in_campminder() -> None:
    """D146: a generic camp-aid ("<camp> FA") line can be an outside grant posted before the camp's award, so the first
    round no longer ticks on any excess: a $50 line, or a $1,590 typo, waits for the registrar."""
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert ledger_ticks([needs], ledger_of("emma", line(1, "50", posted=MAR9)), today=TODAY) == []
    assert ledger_ticks([needs], ledger_of("emma", line(1, "1590", posted=MAR9)), today=TODAY) == []
    (full,) = ledger_ticks([needs], ledger_of("emma", line(1, "1800", posted=MAR9)), today=TODAY)
    assert (full.round, full.amount, full.in_campminder) == (1, Decimal(1800), Decimal(1800))


def test_a_sliver_after_a_zero_dollar_posted_round_never_ticks_the_next_round() -> None:
    """Round 1 posted at $0 (a grant left nothing), Round 2 decided $800: a $50 line is no cover."""
    rounds = (view(1, "posted", locked="0"), view(2, "needs_offer", decided="800"))
    ticks = ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "50", posted=MAR9)), today=TODAY)
    assert ticks == []


def test_a_falling_net_a_held_round_or_a_pending_round_3_never_ticks() -> None:
    appeal = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "needs_offer", decided="300"))
    assert ledger_ticks([appeal], ledger_of("emma", line(1, "1500")), today=TODAY) == []
    held = priced("emma", 1000001, view(1, "held", ask="2000"))
    assert ledger_ticks([held], ledger_of("emma", line(1, "1800")), today=TODAY) == []
    pending = priced(
        "emma",
        1000001,
        view(1, "posted", locked="1800"),
        view(2, "posted", locked="300"),
        view(3, "pending_approval", pending="600"),
    )
    assert ledger_ticks([pending], ledger_of("emma", line(1, "2700")), today=TODAY) == []


def test_the_ledger_ticks_later_rounds_in_order_only_while_the_money_covers_them() -> None:
    rounds = (
        view(1, "posted", locked="1800"),
        view(2, "needs_offer", decided="300"),
        view(3, "needs_offer", decided="300"),
    )
    # Every round needs full cover (D146); with Round 1 posted, a sliver never ticks the next.
    sliver = ledger_ticks(
        [priced("emma", 1000001, *rounds)],
        ledger_of("emma", line(1, "1800"), line(2, "400", posted=MAR9)),
        today=TODAY,
    )
    assert [(t.round, t.amount) for t in sliver] == [(2, Decimal(300))]
    both = ledger_ticks(
        [priced("emma", 1000001, *rounds)],
        ledger_of("emma", line(1, "1800"), line(2, "600", posted=MAR9)),
        today=TODAY,
    )
    assert [(t.round, t.amount) for t in both] == [(2, Decimal(300)), (3, Decimal(300))]
    short = ledger_ticks(
        [priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "1800"), line(2, "200")), today=TODAY
    )
    assert short == []  # 2,000 does not cover Round 2's 2,100


def test_it_never_ticks_past_a_round_it_cannot_tick() -> None:
    rounds = (view(1, "held", ask="2000"), view(2, "needs_offer", decided="300"))
    assert ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "2300")), today=TODAY) == []


def test_a_request_that_is_not_live_or_a_round_a_person_unticked_is_never_ticked() -> None:
    gone = priced("emma", 1000001, view(1, "needs_offer", decided="1800"), live=False)
    assert ledger_ticks([gone], ledger_of("emma", line(1, "1800")), today=TODAY) == []
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert ledger_ticks([needs], ledger_of("emma", line(1, "1800")), today=TODAY, undone={("emma", 1)}) == []


def test_a_line_with_no_post_date_ticks_as_of_today_and_family_level_money_never_ticks() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    (tick,) = ledger_ticks([needs], ledger_of("emma", line(1, "1800", posted=None)), today=TODAY)
    assert tick.posted_on == TODAY
    family = SeasonLedger(unplaced_by_household={1000001: Decimal(1800)}, read=True)
    assert ledger_ticks([needs], family, today=TODAY) == []


def test_a_future_dated_line_ticks_as_of_today() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    future = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
    (tick,) = ledger_ticks([needs], ledger_of("emma", line(1, "1800", posted=future)), today=TODAY)
    assert tick.posted_on == TODAY


def test_the_tick_is_dated_the_latest_of_several_lines() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    (tick,) = ledger_ticks(
        [needs], ledger_of("emma", line(1, "1000", posted=MAR8), line(2, "800", posted=MAR9)), today=TODAY
    )
    assert tick.posted_on == date(2027, 3, 9)


def test_a_clawed_back_posted_round_is_never_reticked() -> None:
    clawed = replace(view(1, "posted", locked="1800"), clawed_back=True)
    rounds = (clawed, view(2, "needs_offer", decided="300"))
    ticks = ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "500")), today=TODAY)
    assert 1 not in [t.round for t in ticks]


def test_the_walk_stops_at_a_refused_round() -> None:
    rounds = (view(1, "refused"), view(2, "needs_offer", decided="300"))
    assert ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "900")), today=TODAY) == []


def test_the_walk_stops_at_a_not_decided_round() -> None:
    rounds = (view(1, "not_decided"), view(2, "needs_offer", decided="300"))
    assert ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "900")), today=TODAY) == []


def test_lines_on_a_closed_request_never_drive_a_tick() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    closed = SeasonLedger(by_closed_request={"emma": (line(1, "1800"),)}, read=True)
    assert ledger_ticks([needs], closed, today=TODAY) == []


def test_an_unticked_round_2_still_lets_round_1_tick_and_blocks_round_3() -> None:
    rounds = (
        view(1, "needs_offer", decided="1800"),
        view(2, "needs_offer", decided="300"),
        view(3, "needs_offer", decided="300"),
    )
    ticks = ledger_ticks(
        [priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "5000")), today=TODAY, undone={("emma", 2)}
    )
    assert [t.round for t in ticks] == [1]


def test_several_requests_tick_independently_in_one_call() -> None:
    a = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    b = priced("noah", 1000002, view(1, "needs_offer", decided="900"))
    ledger = SeasonLedger(
        by_request={"emma": (line(1, "1800"),), "noah": (line(2, "900", household=1000002),)}, read=True
    )
    assert [(t.request_id, t.amount) for t in ledger_ticks([a, b], ledger, today=TODAY)] == [
        ("emma", Decimal(1800)),
        ("noah", Decimal(900)),
    ]


# --- rounds a person un-ticked (Task 6) ---------------------------------------------------------------


def test_a_round_whose_latest_tick_event_is_an_undo_is_left_for_a_person() -> None:
    events = [
        DecisionEvent("e1", "emma", 1, "post", MAR8, amount=Decimal(1800)),
        DecisionEvent("e2", "emma", 1, "unpost", MAR9),
        DecisionEvent("e3", "liam", 1, "post", MAR8, amount=Decimal(1500)),
        DecisionEvent("e4", "liam", 1, "unpost", MAR9),
        DecisionEvent("e5", "liam", 1, "post", JUN1, amount=Decimal(1500)),
        DecisionEvent("e6", "noah", 2, "accept", JUN1),
    ]
    assert undone_rounds(events) == frozenset({("emma", 1)})


# --- final review fixes ------------------------------------------------------------------------------


def test_a_sliver_over_a_posted_round_never_ticks_a_later_round() -> None:
    """Probe: Round 1 is posted at 1,800, CampMinder holds 1,800.50 and Round 2 is decided at 300.
    Every round needs full cover (D146)."""
    req = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "needs_offer", decided="300"))
    assert ledger_ticks([req], ledger_of("emma", line(1, "1800.50")), today=TODAY) == []


def test_a_first_walks_sliver_never_ticks_the_next_round() -> None:
    """Round 1 ticks on full cover (1,850 >= 1,800 decided). That tick spends the money: Round 2
    then needs full cover (1,800 + 300 = 2,100 > 1,850) and does not tick."""
    rounds = (view(1, "needs_offer", decided="1800"), view(2, "needs_offer", decided="300"))
    ticks = ledger_ticks([priced("emma", 1000001, *rounds)], ledger_of("emma", line(1, "1850")), today=TODAY)
    assert [t.round for t in ticks] == [1]


def test_a_later_round_ticks_once_the_money_fully_covers_it() -> None:
    req = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "needs_offer", decided="300"))
    ticks = ledger_ticks([req], ledger_of("emma", line(1, "1800"), line(2, "300", posted=MAR9)), today=TODAY)
    assert [(t.round, t.amount, t.in_campminder) for t in ticks] == [(2, Decimal(300), Decimal(2100))]


def test_a_clawed_back_round_is_left_out_of_what_the_posted_rounds_lock() -> None:
    """Pins _locked's clawback exclusion: with Round 1's 1,800 clawed back nothing is locked, so 500
    in CampMinder is excess and ticks Round 2. Counting Round 1 would hold it (500 <= 1,800)."""
    clawed = replace(view(1, "posted", locked="1800"), clawed_back=True)
    req = priced("emma", 1000001, clawed, view(2, "needs_offer", decided="300"))
    ticks = ledger_ticks([req], ledger_of("emma", line(1, "500")), today=TODAY)
    assert [(t.round, t.amount) for t in ticks] == [(2, Decimal(300))]


def test_a_staff_placement_on_a_withdrawn_session_beats_the_campers_lone_unmatched_request() -> None:
    """Probe: the old request (session S) is withdrawn with a posted round and the new one is
    unmatched. Staff place the line on S: it lands on the old request, and nothing ticks."""
    old = request("old", person=1000011, session=1000101, status="withdrawn")
    new = request("new", person=1000011, session=0, family="", status="unmatched_session")
    staff = {1: Placement(1, 1000011, 1000101, "summer")}
    ledger = build_ledger([line(1, "1800", person=1000011, posted=MAR9)], staff, [old, new], None, frozenset({"old"}))
    assert ledger.by_request == {}
    assert [ln.transaction_cm_id for ln in ledger.closed_lines("old")] == [1]
    needs = priced("new", 1000001, view(1, "needs_offer", decided="1500"))
    assert ledger_ticks([needs], ledger, today=TODAY) == []


def test_a_session_placement_still_takes_the_lone_unmatched_request_when_no_closed_request_matches() -> None:
    old = request("old", person=1000011, session=1000102, status="withdrawn")  # another session
    new = request("new", person=1000011, session=0, family="", status="unmatched_session")
    staff = {1: Placement(1, 1000011, 1000101, "summer")}
    ledger = build_ledger([line(1, "1800", person=1000011)], staff, [old, new], None, frozenset({"old"}))
    assert (list(ledger.by_request), ledger.by_closed_request) == (["new"], {})


def test_a_siblings_older_family_level_money_does_not_block_a_clawback() -> None:
    """Probe: sibling A's two live requests keep A's March line at family level. Sibling B's Round 1
    line is reversed in June: money posted before that reversal cannot be its repost, so B is
    clawed back (final review ruling, narrowing D26's block)."""
    reqs = [
        request("a1", person=1000011, session=1000101),
        request("a2", person=1000011, session=1000102),
        request("emma", person=1000021, session=1000103),
    ]
    lines = [
        line(1, "900", person=1000011, posted=MAR8),
        line(2, "1800", person=1000021, posted=MAR9, reversed_at=JUN1),
    ]
    ledger = build_ledger(lines, {}, reqs, None, frozenset({"emma"}))
    assert ledger.family_unplaced({1000001}) == Decimal(900)
    out, day = apply_clawback(
        R1, POSTED_R1, ledger.lines("emma"), eligible=True, family_lines=ledger.family_lines({1000001})
    )
    assert day == date(2027, 6, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_family_level_money_posted_on_or_after_the_reversal_still_blocks_the_clawback() -> None:
    """A genuine repost follows its reversal: reversed on the camper, reposted on a parent (D54)."""
    reversed_line = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    same_day = [line(2, "1800", person=1000019, posted=JUN1)]
    later = [line(3, "1800", person=1000019, posted=datetime(2027, 6, 20, 18, 0, tzinfo=UTC))]
    for repost in (same_day, later):
        assert apply_clawback(R1, POSTED_R1, reversed_line, eligible=True, family_lines=repost) == (R1, None)


def test_the_family_level_block_is_read_as_of_the_date() -> None:
    reversed_line = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    repost = [line(2, "1800", person=1000019, posted=datetime(2027, 6, 20, 18, 0, tzinfo=UTC))]
    june10 = datetime(2027, 6, 10, tzinfo=UTC)  # after the reversal, before the repost
    assert apply_clawback(R1, POSTED_R1, reversed_line, at=june10, eligible=True, family_lines=repost)[1] == date(
        2027, 6, 1
    )


# --- the recorded as-of axis (owner ruling C, 2026-09-30; PR Decision 11) ---------------------------

from api.services.financial_aid_reconciliation import as_recorded

JUN5 = datetime(2027, 6, 5, 18, 0, tzinfo=UTC)
JUN10 = datetime(2027, 6, 10, 18, 0, tzinfo=UTC)


def _stamped(camp_line: CampLine, recorded: datetime | None, updated: datetime | None = None) -> CampLine:
    return replace(camp_line, recorded_at=recorded, updated_at=updated or recorded)


def test_a_line_kindred_first_recorded_after_the_cut_is_left_out_on_the_recorded_axis() -> None:
    kept = _stamped(line(1, "1500", posted=MAR8), MAR9)
    late = _stamped(line(2, "1500", posted=JUN1), JUN10)  # CampMinder posted it by the cut; Kindred had not seen it
    assert as_recorded([kept, late], JUN5) == [kept]


def test_a_line_with_no_recorded_time_cannot_be_placed_in_kindreds_time() -> None:
    assert as_recorded([_stamped(line(1, "1500", posted=MAR8), None)], JUN5) == []


def test_a_reversal_kindred_had_recorded_by_the_cut_stays_reversed() -> None:
    reversed_line = _stamped(line(1, "1500", posted=MAR8, reversed_at=JUN1), MAR9, datetime(2027, 6, 2, tzinfo=UTC))
    (out,) = as_recorded([reversed_line], JUN5)
    assert out == reversed_line
    assert not out.live(JUN5)


def test_a_reversal_kindred_recorded_after_the_cut_reads_as_still_live_then() -> None:
    """aid_postings keeps no time for the reversal itself, so the row's last write stands in for it
    (an upper bound): the line was live as Kindred had it on the cut."""
    reversed_line = _stamped(line(1, "1500", posted=MAR8, reversed_at=JUN1), MAR9, JUN10)
    (out,) = as_recorded([reversed_line], JUN5)
    assert (out.is_reversed, out.reversal_date, out.transaction_cm_id) == (False, None, 1)
    assert out.live(JUN5)
    assert as_recorded([reversed_line], datetime(2027, 6, 12, tzinfo=UTC)) == [reversed_line]


def test_a_reversal_with_no_updated_time_falls_back_to_when_the_line_was_recorded() -> None:
    reversed_line = replace(line(1, "1500", posted=MAR8, reversed_at=JUN1), recorded_at=JUN1, updated_at=None)
    assert as_recorded([reversed_line], JUN5) == [reversed_line]


def test_the_campminder_cut_still_applies_to_a_line_recorded_by_the_date() -> None:
    """A line Kindred had recorded that CampMinder dates after the cut is still not live then."""
    future = _stamped(line(1, "1500", posted=JUN10), JUN1)
    (out,) = as_recorded([future], JUN5)
    assert not out.live(JUN5)


def test_a_row_last_written_before_its_campminder_reversal_date_cuts_on_the_reversal_date() -> None:
    """Fix round 1: updated (May 1) earlier than reversal_date (Jun 1). Kindred had the reversal on
    record by the cut, so the CampMinder cut decides: live on May 15, reversed on Jun 5."""
    reversed_line = _stamped(line(1, "1500", posted=MAR8, reversed_at=JUN1), MAR9, datetime(2027, 5, 1, tzinfo=UTC))
    (may15,) = as_recorded([reversed_line], datetime(2027, 5, 15, 18, 0, tzinfo=UTC))
    assert may15.live(datetime(2027, 5, 15, 18, 0, tzinfo=UTC))
    (jun5,) = as_recorded([reversed_line], JUN5)
    assert jun5.reversed_by(JUN5)
    assert not jun5.live(JUN5)


# --- a Family Camp request could also own the line ------------------------------------------------

APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)


def test_a_line_go_left_between_two_programs_is_not_placed_on_the_campers_summer_request() -> None:
    """Go names the person but leaves the program empty (summer AND Family Camp): with a live household
    Family Camp request the line could equally be its, so it stays at family level (Decision 3)."""
    summer = request("emma")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    between = replace(line(1, "700", person=1000011), attributed_person_cm_id=1000011)
    ledger = build_ledger([between], {}, [summer, weekend], None)
    ticks = ledger_ticks([priced("emma", 1000001, view(1, "needs_offer", decided="1800"))], ledger, today=TODAY)
    assert (dict(ledger.by_request), ticks) == ({}, [])
    assert ledger.family_unplaced([1000001]) == Decimal(700)


def test_a_line_go_left_between_programs_still_places_on_the_only_candidate() -> None:
    summer = request("emma")
    between = replace(line(1, "700", person=1000011), attributed_person_cm_id=1000011)
    assert placed([between], [summer]) == {1: "emma"}


def test_a_withdrawn_campers_reversed_line_lands_on_the_closed_request_not_family_camp() -> None:
    summer = request("emma", status="withdrawn")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    rev = line(1, "1800", person=1000011, reversed_at=APR1)  # no other enrollment after the cancel: Go gives no program
    ledger = build_ledger([rev], {}, [summer, weekend], None, frozenset({"emma"}))
    assert ledger.closed_lines("emma") == (rev,)
    assert ledger.by_request == {}
    posted = priced("emma", 1000001, view(1, "posted", locked="1800", accepted=True))
    out, day = apply_clawback(posted, {}, ledger.closed_lines("emma"), eligible=True, family_lines=[])
    assert day == date(2027, 4, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_a_withdrawn_campers_live_line_does_not_tick_the_family_camp_round() -> None:
    summer = request("emma", status="withdrawn")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    ledger = build_ledger([line(1, "1800", person=1000011)], {}, [summer, weekend], None, frozenset({"emma"}))
    fam = priced("fam", 1000001, view(1, "needs_offer", decided="700"))
    assert ledger.by_request == {}
    assert ledger_ticks([fam], ledger, today=TODAY) == []


# --- a camper who leaves summer but stays in Family Camp ------------------------------------------
# After the cancel, Go re-tags her lines family_camp (her only active enrollment left).


def _left_summer_stayed_in_family_camp() -> tuple[CampLine, CampLine]:
    rev = line(1, "1800", person=1000011, session=1000201, family="family_camp", reversed_at=APR1)
    weekend_line = line(2, "700", person=1000011, session=1000201, family="family_camp", posted=MAR9)
    return rev, weekend_line


def test_a_camper_who_leaves_summer_but_stays_in_family_camp_has_her_summer_reversal_clawed_back() -> None:
    """D54: a reversal follows the person's closed request. Go's family_camp re-tag after the cancel is
    the instability the module warns about, so the closed pass ignores it on a reversed line."""
    rev, weekend_line = _left_summer_stayed_in_family_camp()
    summer = request("emma", status="withdrawn")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    ledger = build_ledger([rev, weekend_line], {}, [summer, weekend], None, frozenset({"emma"}))
    assert ledger.closed_lines("emma") == (rev,)
    posted = priced("emma", 1000001, view(1, "posted", locked="1800", accepted=True))
    out, day = apply_clawback(
        posted, {}, ledger.closed_lines("emma"), eligible=True, family_lines=ledger.family_lines([1000001])
    )
    assert day == date(2027, 4, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_a_camper_who_leaves_summer_keeps_her_live_family_camp_line_on_the_family_camp_request() -> None:
    """Her live family_camp line goes to the household's only live Family Camp request, and ticks it on
    full cover (D146)."""
    rev, weekend_line = _left_summer_stayed_in_family_camp()
    summer = request("emma", status="withdrawn")
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    ledger = build_ledger([rev, weekend_line], {}, [summer, weekend], None, frozenset({"emma"}))
    assert ledger.lines("fam") == (weekend_line,)
    assert ledger.family_unplaced([1000001]) == Decimal(0)
    fam = priced("fam", 1000001, view(1, "needs_offer", decided="700"))
    (tick,) = ledger_ticks([fam], ledger, today=TODAY)
    assert (tick.request_id, tick.round, tick.amount) == ("fam", 1, Decimal(700))


def test_a_camper_who_leaves_summer_with_two_live_family_camps_leaves_her_live_line_at_family_level() -> None:
    """Decision 3: never guess among several Family Camp requests. Her reversal still follows her own
    closed request."""
    rev, weekend_line = _left_summer_stayed_in_family_camp()
    summer = request("emma", status="withdrawn")
    fc_a = request("fa", person=0, session=1000201, family="family_camp")
    fc_b = request("fb", person=0, session=1000202, family="family_camp")
    ledger = build_ledger([rev, weekend_line], {}, [summer, fc_a, fc_b], None, frozenset({"emma"}))
    assert ledger.by_request == {}
    assert ledger.closed_lines("emma") == (rev,)
    assert ledger.family_lines([1000001]) == (weekend_line,)


def test_only_a_cancelled_or_closed_request_is_eligible_for_a_clawback() -> None:
    """Owner ruling 2026-10-02 (option B): a live or pending-duplicate request is never clawed back, a cancelled or closed one is."""
    assert [clawback_eligible(s, cancelled=False) for s in ("active", "unmatched_session")] == [False, False]
    assert [clawback_eligible(s, cancelled=False) for s in ("withdrawn", "duplicate", "duplicate_pending")] == [
        True,
        True,
        False,  # a pending duplicate is not confirmed: its money stays Posted until staff resolve it
    ]
    assert clawback_eligible("duplicate_pending", cancelled=True) is True
    assert [clawback_eligible(s, cancelled=True) for s in ("active", "unmatched_session")] == [True, True]
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    assert apply_clawback(R1, POSTED_R1, lines, eligible=False, family_lines=[]) == (R1, None)

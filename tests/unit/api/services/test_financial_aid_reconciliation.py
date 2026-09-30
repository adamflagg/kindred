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
    dollars,
)

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

from api.services.financial_aid_reconciliation import apply_clawback
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
        R1, POSTED_R1, [line(1, "1800", posted=MAR9, reversed_at=JUN1)], family_unplaced=Decimal(0)
    )
    assert day == date(2027, 6, 1)
    assert [v.clawed_back for v in out.rounds] == [True]


def test_an_appeals_reverse_and_repost_is_not_a_clawback() -> None:
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1), line(2, "2100", posted=JUN1)]
    out, day = apply_clawback(R1, POSTED_R1, lines, family_unplaced=Decimal(0))
    assert day is None
    assert out is R1


def test_a_line_reversed_before_the_round_was_posted_is_no_clawback() -> None:
    """A typo reversed on Mar 8, before the registrar's Mar 9 tick: that tick reads "not in CampMinder", not reversed."""
    lines = [line(1, "1700", posted=MAR8, reversed_at=datetime(2027, 3, 8, 20, 0, tzinfo=UTC))]
    assert apply_clawback(R1, POSTED_R1, lines, family_unplaced=Decimal(0))[1] is None


def test_a_request_with_nothing_posted_or_nothing_placed_is_left_alone() -> None:
    needs = priced("emma", 1000001, view(1, "needs_offer", decided="1800"))
    assert apply_clawback(needs, {}, [line(1, "1800", reversed_at=JUN1)], family_unplaced=Decimal(0)) == (needs, None)
    assert apply_clawback(R1, POSTED_R1, [], family_unplaced=Decimal(0)) == (R1, None)


def test_as_of_a_day_before_the_reversal_the_money_is_still_posted() -> None:
    lines = [line(1, "1800", posted=MAR9, reversed_at=JUN1)]
    assert (
        apply_clawback(R1, POSTED_R1, lines, at=datetime(2027, 5, 1, tzinfo=UTC), family_unplaced=Decimal(0))[1] is None
    )
    assert apply_clawback(R1, POSTED_R1, lines, at=datetime(2027, 6, 2, tzinfo=UTC), family_unplaced=Decimal(0))[
        1
    ] == date(2027, 6, 1)


def test_a_ledger_lock_with_no_posted_day_uses_the_day_it_locked() -> None:
    rounds = {1: replace(POSTED_R1[1], posted_on=None)}
    assert apply_clawback(R1, rounds, [line(1, "1800", posted=MAR9, reversed_at=JUN1)], family_unplaced=Decimal(0))[
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
    out, day = apply_clawback(R1, POSTED_R1, ledger.closed_lines("r1"), family_unplaced=Decimal(0))
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
    assert apply_clawback(R1, POSTED_R1, lines, family_unplaced=Decimal(2100))[1] is None
    assert apply_clawback(R1, POSTED_R1, lines, family_unplaced=Decimal(0))[1] == date(2027, 6, 1)


def test_the_first_posted_day_across_rounds_is_the_earliest() -> None:
    """A reversal between two rounds' posted days still follows the first posted day (min)."""
    two = priced("emma", 1000001, view(1, "posted", locked="1800"), view(2, "posted", locked="300"))
    rounds = {1: POSTED_R1[1], 2: replace(POSTED_R1[1], round=2, posted_on=date(2027, 6, 15))}
    between = [line(1, "2100", posted=MAR9, reversed_at=JUN1)]  # after Round 1's day, before Round 2's
    assert apply_clawback(two, rounds, between, family_unplaced=Decimal(0))[1] == date(2027, 6, 1)


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


def test_a_line_on_a_person_whose_own_request_is_withdrawn_stays_at_family_level_beside_two_live_family_camps() -> None:
    old = request("old", person=1000011, status="withdrawn")
    fc_a = request("fa", person=0, session=1000201, family="family_camp")
    fc_b = request("fb", person=0, session=1000202, family="family_camp")
    ledger = build_ledger([line(1, "1800", person=1000011)], {}, [old, fc_a, fc_b], None, frozenset({"old"}))
    assert (ledger.by_request, ledger.by_closed_request) == ({}, {})
    assert ledger.family_unplaced([1000001]) == Decimal(1800)

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
    """Main spec §11 and D81: a line on a parent or the household waits for Ben, whatever the count."""
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

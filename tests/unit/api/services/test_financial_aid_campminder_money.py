"""D170: CampMinder's camp aid on no request, by the 2026 loader's own family x session rule. Fictional throughout."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from api.services.financial_aid_campminder_money import _line_group, aid_on_no_request, campminder_money
from api.services.financial_aid_intake_types import AdditionRecord, RequestRecord
from api.services.financial_aid_reconciliation import CampLine
from bunking.financial_aid.decisions.budget import NO_POOL, TOTAL, OffRequestAid

SUMMER, WEEKEND, UNCLAIMED = 1000101, 1000201, 1000999
POOLS = {SUMMER: "camp_pool", WEEKEND: "weekend_pool"}


@dataclass(frozen=True)
class Req:
    id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    status: str = "active"


@dataclass(frozen=True)
class Link:
    household_cm_id: int
    family_key: str
    excluded: bool = False


def line(
    txn: int,
    household: int,
    amount: str,
    *,
    session: int = 0,
    person: int = 0,
    reversed_: bool = False,
    level: str = "",
) -> CampLine:
    return CampLine(
        transaction_cm_id=txn,
        household_cm_id=household,
        person_cm_id=person,
        amount=Decimal(amount),
        post_date=None,
        is_reversed=reversed_,
        reversal_date=None,
        attributed_person_cm_id=person,
        attributed_session_cm_id=session,
        attribution_level=level,
    )


def on_no_request(
    lines: list[CampLine], requests: list[Req], links: list[Link] | None = None
) -> dict[str, OffRequestAid]:
    return aid_on_no_request(lines, requests, links or [], POOLS.get)


def test_a_family_with_no_request_counts_in_its_sessions_pool_and_the_total() -> None:
    out = on_no_request([line(1, 1000001, "2258", session=SUMMER)], [])
    assert out["camp_pool"] == OffRequestAid(Decimal(2258), 1)
    assert out[TOTAL] == OffRequestAid(Decimal(2258), 1)


def test_money_on_a_session_the_family_asked_for_is_on_a_request() -> None:
    out = on_no_request([line(1, 1000001, "900", session=SUMMER)], [Req("r1", 1000001, 1000011, SUMMER)])
    assert out == {}


def test_a_request_of_any_status_takes_its_session() -> None:
    """A cancelled request still holds the family x session: that money is a clawback's, not the no-request line's."""
    out = on_no_request(
        [line(1, 1000001, "900", session=SUMMER)], [Req("r1", 1000001, 1000011, SUMMER, status="cancelled")]
    )
    assert out == {}


def test_a_siblings_money_on_a_session_no_request_names_counts() -> None:
    """The wrong-sibling case: the household asked for summer, CampMinder paid a weekend the household asked nothing for."""
    out = on_no_request(
        [line(1, 1000001, "1067", session=WEEKEND, person=1000012)], [Req("r1", 1000001, 1000011, SUMMER)]
    )
    assert out == {"weekend_pool": OffRequestAid(Decimal(1067), 1), TOTAL: OffRequestAid(Decimal(1067), 1)}


def test_a_linked_households_request_takes_the_money() -> None:
    """C3: CampMinder posted the family's aid under its other household id (aid_household_links)."""
    out = on_no_request(
        [line(1, 1000002, "5822", session=SUMMER)],
        [Req("r1", 1000001, 1000011, SUMMER)],
        [Link(1000001, "fam-a"), Link(1000002, "fam-a")],
    )
    assert out == {}


def test_an_excluded_link_joins_nothing() -> None:
    out = on_no_request(
        [line(1, 1000002, "5822", session=SUMMER)],
        [Req("r1", 1000001, 1000011, SUMMER)],
        [Link(1000001, "fam-a"), Link(1000002, "fam-a", excluded=True)],
    )
    assert out[TOTAL] == OffRequestAid(Decimal(5822), 1)


def test_a_request_with_no_session_takes_its_campers_money() -> None:
    """The loader gives a request intake couldn't match to a session the sheet's session; with no sheet, the camper's
    money is taken to be on it, as the loader posted it."""
    out = on_no_request(
        [line(1, 1000001, "7178", session=SUMMER, person=1000011)],
        [Req("r1", 1000001, 1000011, 0, status="unmatched_session")],
    )
    assert out == {}


def test_a_request_with_no_session_takes_household_money() -> None:
    out = on_no_request(
        [line(1, 1000001, "1160", session=SUMMER)], [Req("r1", 1000001, 1000011, 0, status="unmatched_session")]
    )
    assert out == {}


def test_a_request_with_no_session_leaves_a_siblings_money() -> None:
    out = on_no_request(
        [line(1, 1000001, "500", session=SUMMER, person=1000012)],
        [Req("r1", 1000001, 1000011, 0, status="unmatched_session")],
    )
    assert out[TOTAL] == OffRequestAid(Decimal(500), 1)


def test_reversed_money_is_not_counted() -> None:
    assert on_no_request([line(1, 1000001, "2258", session=SUMMER, reversed_=True)], []) == {}


def test_money_with_no_session_on_a_family_with_no_request_counts_in_the_total_only() -> None:
    out = on_no_request([line(1, 1000001, "350")], [])
    assert out == {TOTAL: OffRequestAid(Decimal(350), 1)}


def test_money_no_one_request_can_take_on_a_family_that_asked_is_not_counted() -> None:
    """The loader's "not placeable on one request": the family's requests carry the sheet's decision for it."""
    out = on_no_request(
        [line(1, 1000001, "323")], [Req("r1", 1000001, 1000011, SUMMER), Req("r2", 1000001, 1000012, WEEKEND)]
    )
    assert out == {}


def test_a_session_no_program_claims_sits_in_no_pool() -> None:
    out = on_no_request([line(1, 1000001, "108", session=UNCLAIMED)], [])
    assert out == {NO_POOL: OffRequestAid(Decimal(108), 1), TOTAL: OffRequestAid(Decimal(108), 1)}


def test_families_are_households_counted_once_per_scope() -> None:
    out = on_no_request(
        [
            line(1, 1000001, "100", session=SUMMER),
            line(2, 1000001, "50", session=WEEKEND),
            line(3, 1000003, "25", session=SUMMER),
        ],
        [],
    )
    assert out["camp_pool"] == OffRequestAid(Decimal(125), 2)
    assert out["weekend_pool"] == OffRequestAid(Decimal(50), 1)
    assert out[TOTAL] == OffRequestAid(Decimal(175), 2)


def test_the_loader_reads_the_same_split() -> None:
    """One computation: the 2026 loader's three-way split is this module's."""
    from scripts.financial_aid import load_2026_decisions as loader

    assert vars(loader)["campminder_money"] is campminder_money


# CS-2 loader guard: a session-less line Go placed only on a camper (level "person": one camper, several enrollments)
# waits for a pin instead of falling onto that camper's one request.
HH, CAMPER, LINKED_HH, TWR = 1000001, 1000011, 1000006, 1000301


def test_a_go_person_level_line_is_not_narrowed_to_the_campers_one_request() -> None:
    credit = line(1, HH, "250", person=CAMPER, level="person")
    requests = [Req("r1", HH, CAMPER, SUMMER)]
    assert _line_group(credit, requests) == (None, "unplaced")
    placed, _, unplaced = campminder_money([credit], requests)
    assert (placed, unplaced) == ({}, {HH: Decimal(250)})


def test_a_go_person_level_line_does_not_reach_a_linked_households_request() -> None:
    credit = line(1, HH, "250", person=CAMPER, level="person")
    requests = [Req("r1", LINKED_HH, CAMPER, SUMMER)]
    assert _line_group(credit, requests, [LINKED_HH]) == (None, "unplaced")


def test_a_pinned_person_level_line_takes_its_pinned_session() -> None:
    pinned = line(1, HH, "250", person=CAMPER, session=TWR, level="override")
    requests = [Req("r1", HH, CAMPER, SUMMER), Req("r2", HH, CAMPER, TWR)]
    assert _line_group(pinned, requests) == ((HH, TWR), "")


def test_a_pinned_line_on_a_session_with_no_request_is_no_request() -> None:
    pinned = line(1, HH, "250", person=CAMPER, session=TWR, level="override")
    assert _line_group(pinned, [Req("r1", HH, CAMPER, SUMMER)]) == ((HH, TWR), "no_request")


def test_a_staff_person_only_placement_still_takes_the_persons_one_request() -> None:
    staff = line(1, HH, "250", person=CAMPER, level="override")
    assert _line_group(staff, [Req("r1", HH, CAMPER, SUMMER)]) == ((HH, SUMMER), "")


def test_a_household_line_with_one_requested_session_is_still_that_sessions() -> None:
    household = line(1, HH, "250", level="none")
    assert _line_group(household, [Req("r1", HH, CAMPER, SUMMER)]) == ((HH, SUMMER), "")


def test_a_person_level_line_left_unplaced_on_a_family_that_asked_is_not_on_no_request() -> None:
    """D170 is unchanged: money no request can take on a family that asked is the sheet's to carry, not no-request."""
    credit = line(1, HH, "250", person=CAMPER, level="person")
    assert on_no_request([credit], [Req("r1", HH, CAMPER, SUMMER)]) == {}


def test_a_pinned_twr_line_with_no_twr_request_counts_on_no_request_in_its_pool() -> None:
    pools = {**POOLS, TWR: "twr_pool"}
    pinned = line(1, HH, "250", person=CAMPER, session=TWR, level="override")
    out = aid_on_no_request([pinned], [Req("r1", HH, CAMPER, SUMMER)], [], pools.get)
    assert out["twr_pool"] == OffRequestAid(Decimal(250), 1)
    assert out[TOTAL] == OffRequestAid(Decimal(250), 1)


# -- PR 3 (Q4-A): the same D170 money, one entry per live line, so Season's drill-in and Form intake agree -----------


def test_the_lines_on_no_request_name_their_family_x_session_and_sum_to_the_line() -> None:
    from api.services.financial_aid_campminder_money import aid_on_no_request_lines

    lines = [
        line(1, 1000001, "2258", session=SUMMER, person=1000011),
        line(2, 1000001, "100", session=SUMMER, person=1000012),  # a sibling's money joins the family x session
        line(3, 1000002, "350", session=WEEKEND),
        line(4, 1000003, "75"),  # no session can be told, on a family with no request: TOTAL only
        line(5, 1000004, "900", session=SUMMER),  # on the family's own request: not on the line
        line(6, 1000005, "40", session=SUMMER, reversed_=True),
    ]
    requests = [Req("r1", 1000004, 1000041, SUMMER)]
    found = aid_on_no_request_lines(lines, requests, [])
    assert [(a.line.transaction_cm_id, a.group) for a in found] == [
        (1, (1000001, SUMMER)),
        (2, (1000001, SUMMER)),
        (3, (1000002, WEEKEND)),
        (4, None),
    ]
    total = on_no_request(lines, requests)[TOTAL]
    assert total == OffRequestAid(sum((a.line.amount for a in found), Decimal(0)), 3)  # three households


# -- Follow-up A to PR 3: an added request staff removed (Remove…) no longer holds CampMinder's money -----------------
# Owner's standing rule: aid CampMinder posted always shows. After Add a Request… → Undo Posted → Remove…, the request's
# addition is retired and its request withdrawn; the money is on no request again, so it comes back to D170.


def _record(household: int, person: int, session: int, *, status: str, option_key: str) -> RequestRecord:
    return RequestRecord(
        id=f"req{household}{person}{session}",
        year=2027,
        application_id="app000000000001",
        household_cm_id=household,
        person_cm_id=person,
        session_cm_id=session,
        program_key="summer",
        program_option_text="",
        program_option_key=option_key,
        session_resolution="staff",
        ask=2258.0,
        headcount_non_infant=0,
        headcount_infant=0,
        headcount_source="",
        status=status,
        duplicate_of="",
    )


def _addition(household: int, person: int, session: int, *, retired: bool) -> AdditionRecord:
    return AdditionRecord(
        id=f"add{household}{person}{session}",
        year=2027,
        household_cm_id=household,
        person_cm_id=person,
        program_key="summer",
        session_cm_id=session,
        ask=2258.0,
        source="staff",
        reason="Assessed by phone",
        actor="registrar@example.com",
        retired_at="2027-03-01 18:00:00.000Z" if retired else "",
    )


def test_a_removed_added_request_holds_no_campminder_money() -> None:
    from api.services.financial_aid_campminder_money import aid_on_no_request_lines, holding_requests

    addition = _addition(1000001, 1000011, SUMMER, retired=True)
    removed = _record(1000001, 1000011, SUMMER, status="withdrawn", option_key=addition.option_key)
    money = [line(1, 1000001, "2258", session=SUMMER, person=1000011)]
    assert aid_on_no_request_lines(money, [removed], []) == []  # D170 reads every status: the request still holds it
    holding = holding_requests([removed], [addition])
    assert holding == []
    assert [a.line.transaction_cm_id for a in aid_on_no_request_lines(money, holding, [])] == [1]


def test_only_a_removed_addition_lets_go_of_the_money() -> None:
    from api.services.financial_aid_campminder_money import holding_requests

    live = _addition(1000001, 1000011, SUMMER, retired=False)
    added = _record(1000001, 1000011, SUMMER, status="active", option_key=live.option_key)
    # A form-made request the form no longer produces, and a form-made request cancelled: both keep holding it, as
    # D170 has always read them (a cancellation's money is a clawback's, not the no-request line's).
    edited = _record(1000002, 1000021, SUMMER, status="withdrawn", option_key="session 2")
    cancelled = _record(1000003, 1000031, SUMMER, status="active", option_key="session 2")
    # A removed addition that was added again: the live addition's request holds the money once more.
    again = _addition(1000004, 1000041, SUMMER, retired=False)
    retired_before = _addition(1000004, 1000041, SUMMER, retired=True)
    revived = _record(1000004, 1000041, SUMMER, status="active", option_key=again.option_key)
    # A removed addition whose request is somehow still live (not yet withdrawn) still holds it: only a withdrawn one
    # lets go.
    unwithdrawn_addition = _addition(1000005, 1000051, SUMMER, retired=True)
    unwithdrawn = _record(1000005, 1000051, SUMMER, status="active", option_key=unwithdrawn_addition.option_key)
    requests = [added, edited, cancelled, revived, unwithdrawn]
    assert holding_requests(requests, [live, retired_before, again, unwithdrawn_addition]) == requests

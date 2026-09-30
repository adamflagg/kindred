"""When a request was received, and the split by a date (D129, D138): the one definition Scenarios' request sets and
the Reports "received through" filter share. Fictional only."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.received import edit_predecessors, received_dates, split_by_received

CUTOFF = datetime(2027, 2, 2, 8, 0, tzinfo=UTC)  # the first instant after Feb 1, camp time (Pacific, PST)
JAN20 = datetime(2027, 1, 20, 18, 0, tzinfo=UTC)


def _row(entity_id: str, at: datetime, *, create: bool = True) -> LogRow:
    return LogRow(
        id=f"log{entity_id[3:]}",
        entity="aid_requests",
        entity_id=entity_id,
        before=None if create else {"ask": 100},
        after={"ask": 200},
        created=at,
    )


def test_received_is_the_earliest_create_row_and_never_guessed() -> None:
    log = [
        _row("reqemma00000001", JAN20),
        _row("reqemma00000001", datetime(2027, 1, 25, tzinfo=UTC), create=False),  # an update is not a receipt
        _row("reqliam00000001", datetime(2027, 1, 5, tzinfo=UTC), create=False),  # no create row at all
    ]
    assert received_dates(["reqliam00000001", "reqemma00000001"], log) == {
        "reqemma00000001": JAN20,
        "reqliam00000001": None,
    }


def test_requests_split_by_their_first_recorded_moment() -> None:
    received = {
        "reqemma00000001": JAN20,
        "reqliam00000001": datetime(2027, 2, 2, 7, 59, tzinfo=UTC),  # still Feb 1 in camp time
        "reqrile00000001": CUTOFF,
        "reqoliv00000001": None,
    }
    split = split_by_received(received, CUTOFF, live=received.keys())
    assert split.kept == frozenset({"reqemma00000001", "reqliam00000001"})
    assert (split.after, split.unknown) == (frozenset({"reqrile00000001"}), frozenset({"reqoliv00000001"}))


def test_only_live_requests_are_counted_as_left_out() -> None:
    received = {"reqemma00000001": JAN20, "reqrile00000001": CUTOFF, "reqoliv00000001": None}
    split = split_by_received(received, CUTOFF, live={"reqemma00000001"})
    assert (split.kept, split.after, split.unknown) == (frozenset({"reqemma00000001"}), frozenset(), frozenset())


def test_the_earliest_create_row_wins_whatever_order_the_log_holds_them_in() -> None:
    later, earlier = datetime(2027, 1, 25, tzinfo=UTC), JAN20
    log = [_row("reqemma00000001", later), _row("reqemma00000001", earlier)]
    assert received_dates(["reqemma00000001"], log) == {"reqemma00000001": earlier}


def test_a_live_request_missing_from_the_received_dates_is_unknown() -> None:
    split = split_by_received({"reqemma00000001": JAN20}, CUTOFF, live={"reqemma00000001", "reqliam00000001"})
    assert (split.kept, split.unknown) == (frozenset({"reqemma00000001"}), frozenset({"reqliam00000001"}))


@dataclass(frozen=True)
class _Request:
    id: str
    household_cm_id: int
    person_cm_id: int
    program_key: str
    status: str


def test_an_edited_answer_keeps_the_date_the_family_first_applied() -> None:
    """Intake withdraws a request whose answer the family edited and creates a new one (a new intake key: the option
    text changed). The live replacement was received when the first of them was."""
    original = _Request("reqemma00000001", 1000001, 1000011, "summer", "withdrawn")
    replacement = _Request("reqemma00000002", 1000001, 1000011, "summer", "active")
    sibling = _Request("reqliam00000001", 1000001, 1000012, "summer", "active")  # another camper: not a predecessor
    other_program = _Request("reqemma00000003", 1000001, 1000011, "weekend", "active")
    requests = [original, replacement, sibling, other_program]
    predecessors = edit_predecessors(requests)
    assert predecessors == {
        "reqemma00000002": frozenset({"reqemma00000001"}),
        "reqliam00000001": frozenset(),
        "reqemma00000003": frozenset(),
        "reqemma00000001": frozenset(),
    }
    log = [
        _row("reqemma00000001", JAN20),
        _row("reqemma00000002", datetime(2027, 2, 10, tzinfo=UTC)),
        _row("reqliam00000001", datetime(2027, 2, 11, tzinfo=UTC)),
        _row("reqemma00000003", datetime(2027, 2, 12, tzinfo=UTC)),
    ]
    received = received_dates([r.id for r in requests], log, predecessors=predecessors)
    assert received == {
        "reqemma00000001": JAN20,
        "reqemma00000002": JAN20,
        "reqliam00000001": datetime(2027, 2, 11, tzinfo=UTC),
        "reqemma00000003": datetime(2027, 2, 12, tzinfo=UTC),
    }


def test_a_replacement_whose_predecessor_has_no_create_row_keeps_its_own_date() -> None:
    received = received_dates(
        ["reqemma00000002"],
        [_row("reqemma00000002", JAN20)],
        predecessors={"reqemma00000002": frozenset({"reqemma00000001"})},
    )
    assert received == {"reqemma00000002": JAN20}

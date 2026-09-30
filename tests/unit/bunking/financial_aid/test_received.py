"""When a request was received, and the split by a date (D129, D138): the one definition Scenarios' request sets and
the Reports "received through" filter share. Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime

from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.received import received_dates, split_by_received

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

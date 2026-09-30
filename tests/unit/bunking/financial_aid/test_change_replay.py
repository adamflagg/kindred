"""Records rebuilt from aid_change_log (3c). The rows are built with 4a's own changed_fields, so the
replay is tested against exactly what the log holds. Fictional throughout."""

from datetime import UTC, datetime, timedelta
from itertools import pairwise
from typing import Any

from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_replay import LogRow, apply_change, replay

T0 = datetime(2027, 1, 10, 18, 0, tzinfo=UTC)


def _row(n: int, entity_id: str, before: dict[str, Any] | None, after: dict[str, Any] | None, hour: int) -> LogRow:
    return LogRow(
        id=f"log{n:012d}",
        entity="aid_requests",
        entity_id=entity_id,
        before=before,
        after=after,
        created=T0 + timedelta(hours=hour),
    )


def _history(entity_id: str, states: list[tuple[int, dict[str, Any]]]) -> list[LogRow]:
    """Log rows for successive states of one record, as 4a would write them."""
    rows = [_row(0, entity_id, None, states[0][1], states[0][0])]
    for n, ((_, previous), (hour, state)) in enumerate(pairwise(states), start=1):
        before, after = changed_fields(previous, state)
        rows.append(_row(n, entity_id, before, after, hour))
    return rows


S0 = {"status": "active", "ask": 4000, "answers": {"income": 60000, "kids": 2}, "flags": []}
S1 = {"status": "active", "ask": 3500, "answers": {"income": 58000, "kids": 2}, "flags": []}
S2 = {"status": "withdrawn", "ask": 3500, "answers": {"income": 58000}, "flags": [{"code": "x"}]}


def test_each_instant_rebuilds_the_record_as_it_stood() -> None:
    rows = _history("reqemma00000001", [(0, S0), (2, S1), (4, S2)])
    for hour, expected in ((0, S0), (1, S0), (2, S1), (3, S1), (4, S2), (9, S2)):
        replayed = replay(rows, as_of=T0 + timedelta(hours=hour))["reqemma00000001"]
        assert (replayed.state, replayed.complete) == (expected, True), hour
    assert replay(rows, as_of=T0 - timedelta(hours=1)) == {}


def test_a_nested_change_and_a_removed_key_replay_exactly() -> None:
    before, after = changed_fields(S1, S2)
    assert apply_change(S1, before, after) == S2


def test_a_delete_leaves_no_record() -> None:
    rows = [_row(0, "shr1", None, {"share_pct": 100}, 0), _row(1, "shr1", {"share_pct": 100}, None, 2)]
    assert replay(rows, as_of=T0 + timedelta(hours=1))["shr1"].state == {"share_pct": 100}
    assert replay(rows)["shr1"].state is None


def test_a_history_that_does_not_begin_with_its_create_is_incomplete() -> None:
    rows = _history("reqemma00000001", [(0, S0), (2, S1)])[1:]
    assert replay(rows)["reqemma00000001"].complete is False


def test_same_instant_rows_that_change_different_fields_apply_in_either_order() -> None:
    create = _row(0, "r1", None, {"a": 1, "b": 1}, 0)
    first, second = _row(1, "r1", {"a": 1}, {"a": 2}, 1), _row(2, "r1", {"b": 1}, {"b": 2}, 1)
    for rows in ([create, first, second], [create, second, first]):
        assert replay(rows)["r1"] == replay([create, first, second])["r1"]
        assert replay(rows)["r1"].state == {"a": 2, "b": 2}


def _swap(vacate_id: int, final_id: int) -> tuple[LogRow, LogRow]:
    """Intake's cycle-breaker: vacate (session 0), then the final session (102), in one batch. Both
    rows' `before` is the original record, so the order inside the instant is unknown. Rows sharing
    an instant replay in id order, so with the vacate's id the higher one, id order alone leaves
    session 0: only settling the clash gives 102."""
    return (
        _row(vacate_id, "r1", {"session": 101}, {"session": 0}, 1),
        _row(final_id, "r1", {"session": 101}, {"session": 102}, 1),
    )


def test_a_same_instant_clash_is_settled_by_the_next_row_that_logged_the_field() -> None:
    create = _row(0, "r1", None, {"session": 101, "status": "active"}, 0)
    later = _row(3, "r1", {"session": 102}, {"session": 103}, 5)
    for ids in ((2, 1), (1, 2)):  # (2, 1): the vacate replays last
        vacate, final = _swap(*ids)
        for pair in ([vacate, final], [final, vacate]):
            state = replay([create, *pair, later], as_of=T0 + timedelta(hours=2))["r1"]
            assert (state.state, state.complete) == ({"session": 102, "status": "active"}, True), ids


def test_a_same_instant_clash_with_nothing_after_is_settled_by_the_record_now() -> None:
    create = _row(0, "r1", None, {"session": 101}, 0)
    for ids in ((2, 1), (1, 2)):  # (2, 1): the vacate replays last
        replayed = replay([create, *_swap(*ids)], current={"r1": {"session": 102}})["r1"]
        assert (replayed.state, replayed.complete) == ({"session": 102}, True), ids


def test_a_same_instant_clash_nothing_settles_is_incomplete() -> None:
    create = _row(0, "r1", None, {"session": 101}, 0)
    rows = [
        create,
        _row(1, "r1", {"session": 101}, {"session": 0}, 1),
        _row(2, "r1", {"session": 101}, {"session": 102}, 1),
    ]
    assert replay(rows)["r1"].complete is False
    assert replay(rows, as_of=T0)["r1"].complete is True  # before the clash the record is known


def test_a_key_can_merge_rows_under_one_record() -> None:
    """aid_rules logs approvals as "year:version:section"; the version is "year:version"."""
    rows = [
        LogRow("a", "aid_rules", "2027:1", None, {"status": {"x": "draft", "y": "draft"}}, T0),
        LogRow(
            "b",
            "aid_rules",
            "2027:1:x",
            {"status": {"x": "draft"}},
            {"status": {"x": "approved"}},
            T0 + timedelta(hours=1),
        ),
    ]
    merged = replay(rows, key=lambda r: ":".join(r.entity_id.split(":")[:2]))
    assert merged["2027:1"].state == {"status": {"x": "approved", "y": "draft"}}


def test_a_clash_followed_by_a_same_instant_pair_settles_from_the_value_no_sibling_produced() -> None:
    """The next instant holds a chain 102 -> 103 -> 104 written in one batch; the value the clash
    left is the one `before` no sibling's `after` explains (102), whichever row sorts first."""
    create = _row(0, "r1", None, {"session": 101}, 0)
    vacate, final = _swap(2, 1)  # the vacate replays last: only settling gives 102
    step_a = _row(3, "r1", {"session": 102}, {"session": 103}, 3)
    step_b = _row(4, "r1", {"session": 103}, {"session": 104}, 3)
    for pair in ([vacate, final], [final, vacate]):
        for later in ([step_a, step_b], [step_b, step_a]):
            got = replay([create, *pair, *later], as_of=T0 + timedelta(hours=2))["r1"]
            assert (got.state, got.complete) == ({"session": 102}, True)
    # the ids decide the sort order, so also swap them
    swapped_a = _row(4, "r1", {"session": 102}, {"session": 103}, 3)
    swapped_b = _row(3, "r1", {"session": 103}, {"session": 104}, 3)
    got = replay([create, vacate, final, swapped_a, swapped_b], as_of=T0 + timedelta(hours=2))["r1"]
    assert (got.state, got.complete) == ({"session": 102}, True)


def test_a_clash_followed_by_a_pair_that_cannot_be_ordered_is_incomplete() -> None:
    create = _row(0, "r1", None, {"session": 101}, 0)
    vacate = _row(1, "r1", {"session": 101}, {"session": 0}, 1)
    final = _row(2, "r1", {"session": 101}, {"session": 102}, 1)
    there = _row(3, "r1", {"session": 102}, {"session": 103}, 3)
    back = _row(4, "r1", {"session": 103}, {"session": 102}, 3)
    assert replay([create, vacate, final, there, back], as_of=T0 + timedelta(hours=2))["r1"].complete is False


def test_a_dict_to_scalar_change_clashing_with_a_nested_edit_settles_in_either_order() -> None:
    create = _row(0, "r1", None, {"a": {"x": 1}}, 0)
    whole = _row(1, "r1", {"a": {"x": 1}}, {"a": 5}, 1)
    nested = _row(2, "r1", {"a": {"x": 1}}, {"a": {"x": 2}}, 1)
    swapped_whole = _row(2, "r1", {"a": {"x": 1}}, {"a": 5}, 1)
    swapped_nested = _row(1, "r1", {"a": {"x": 1}}, {"a": {"x": 2}}, 1)
    for rows in ([create, whole, nested], [create, swapped_nested, swapped_whole]):
        got = replay(rows, current={"r1": {"a": 5}})["r1"]
        assert (got.state, got.complete) == ({"a": 5}, True)

"""Season › History (D49, §7.6): aid_change_log grouped by operation. Fictional only."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import api.constants.collections as collections
from api.services.financial_aid_season_history import (
    ENTITY_KINDS,
    NOT_IN_HISTORY,
    HistoryFilter,
    Operation,
    entry_of,
    operation_out,
    operations,
    visible,
)

REG, FIN = "registrar@example.com", "finance@example.com"


def _rec(
    rid: str,
    entity: str,
    entity_id: str,
    op: str,
    *,
    actor: str = REG,
    action: str = "update",
    reason: str = "",
    at: str = "2027-03-09 17:00:00.000Z",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        entity=entity,
        entity_id=entity_id,
        action=action,
        actor=actor,
        reason=reason,
        operation_id=op,
        created=at,
    )


def _ops(*records: SimpleNamespace) -> list[Operation]:
    return operations(e for r in records if (e := entry_of(r)) is not None)


OP_A, OP_B, OP_R, OP_I, OP_S = ("a" * 15, "b" * 15, "r" * 15, "i" * 15, "s" * 15)


def test_one_line_per_operation_newest_first_with_its_counts() -> None:
    ops = _ops(
        _rec("l1", "aid_decisions", "reqemma00000001:1", OP_A, action="post", at="2027-03-09 17:00:00.000Z"),
        _rec(
            "l2",
            "aid_decisions",
            "reqliam00000001:1",
            OP_A,
            action="post",
            reason="March offers",
            at="2027-03-09 17:00:01.000Z",
        ),
        _rec("l3", "aid_hold_events", "reqemma00000001:h", OP_B, action="release", at="2027-03-10 17:00:00.000Z"),
    )
    assert [(o.operation_id, o.kind, len(o.entries)) for o in ops] == [(OP_B, "holds", 1), (OP_A, "offers", 2)]
    out = operation_out(ops[1])
    assert (out.rows, out.reason, out.actor) == (2, "March offers", REG)
    assert [(c.entity, c.action, c.rows) for c in out.counts] == [("aid_decisions", "post", 2)]
    assert out.at.isoformat() == "2027-03-09T17:00:01+00:00"


def test_a_rules_operation_names_its_versions_and_sections() -> None:
    (op,) = _ops(
        _rec("l1", "aid_rules", "2027:3:budget", OP_R, actor=FIN, action="approve"),
        _rec("l2", "aid_rules", "2027:3:award_tables", OP_R, actor=FIN, action="approve"),
    )
    out = operation_out(op)
    assert (out.kind, out.rules_versions, out.rules_sections) == ("rules", [3], ["award_tables", "budget"])


def test_intake_is_its_own_kind_and_scenario_rows_never_show() -> None:
    ops = _ops(
        _rec("l1", "aid_requests", "reqemma00000001", OP_I, actor="system:intake", action="create"),
        _rec("l2", "aid_scenario_trail", "t1", OP_S, actor=FIN, action="create"),
        _rec("l3", "aid_rules", "2027:4", OP_R, actor=FIN, action="save"),
        _rec("l4", "aid_scenario_options", "o1", OP_R, actor=FIN, action="update"),
    )
    assert [(o.operation_id, o.kind, len(o.entries)) for o in ops] == [(OP_R, "rules", 1), (OP_I, "intake", 1)]


def test_every_aid_collection_has_a_kind_or_is_left_out_on_purpose() -> None:
    """A new aid_* collection fails here until History classifies it (Decision 8)."""
    aid = {v for k, v in vars(collections).items() if k.startswith("AID_") and isinstance(v, str)} - {"aid_change_log"}
    assert aid, "no AID_* constants found"
    assert aid <= set(ENTITY_KINDS) | NOT_IN_HISTORY
    assert not set(ENTITY_KINDS) & NOT_IN_HISTORY


def test_rules_operations_are_left_out_without_rules() -> None:
    ops = _ops(
        _rec("l1", "aid_rules", "2027:3", OP_R, actor=FIN, action="save"),
        _rec("l2", "aid_session_capacity", "cap1", OP_B, actor=FIN, action="set_capacity"),
        _rec("l3", "aid_decisions", "reqemma00000001:1", OP_A, action="post"),
    )
    assert [o.operation_id for o in ops if visible(o, HistoryFilter())] == [OP_A]
    assert {o.operation_id for o in ops if visible(o, HistoryFilter(rules=True))} == {OP_R, OP_B, OP_A}


def test_the_filters_by_kind_person_day_and_text() -> None:
    ops = _ops(
        _rec(
            "l1",
            "aid_decisions",
            "reqemma00000001:1",
            OP_A,
            action="post",
            reason="March offers",
            at="2027-03-09 17:00:00.000Z",
        ),
        _rec(
            "l2",
            "aid_hold_events",
            "reqliam00000001:h",
            OP_B,
            actor=FIN,
            action="release",
            at="2027-03-12 07:30:00.000Z",
        ),
        _rec(
            "l3",
            "aid_requests",
            "reqolivia000001",
            OP_I,
            actor="system:intake",
            action="create",
            at="2027-03-08 17:00:00.000Z",
        ),
    )

    def shown(**kw: object) -> list[str]:
        return [o.operation_id for o in ops if visible(o, HistoryFilter(**kw))]  # type: ignore[arg-type]

    assert shown() == [OP_B, OP_A]  # intake hidden unless asked
    assert shown(include_intake=True) == [OP_B, OP_A, OP_I]
    assert shown(kinds=frozenset({"holds"})) == [OP_B]
    assert shown(actor=REG) == [OP_A]
    assert shown(text="march") == [OP_A]  # reason, case-insensitive
    assert shown(text="REQLIAM") == [OP_B]  # an entity id
    # 07:30 UTC on Mar 12 is still Mar 11 in camp time (Pacific).
    assert shown(since=date(2027, 3, 11), until=date(2027, 3, 11)) == [OP_B]
    assert shown(until=date(2027, 3, 10)) == [OP_A]


def test_a_row_with_no_created_time_has_no_place_in_the_order() -> None:
    assert entry_of(_rec("l1", "aid_decisions", "x", OP_A, at="")) is None

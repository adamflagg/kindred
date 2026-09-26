"""bunking.financial_aid.change_log.record_change -- the aid change history writer.

Fictional data only. Ids are the tests/CLAUDE.md generic range.
"""

import math
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.financial_aid.change_log import COLLECTION, record_change

REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS = REPO_ROOT / "pocketbase" / "pb_migrations"


def _call(pb: MagicMock, **overrides: object) -> None:
    kwargs: dict[str, object] = {
        "entity": "aid_decisions",
        "entity_id": "2027:1000001:1000002",
        "year": 2027,
        "action": "create",
        "before": None,
        "after": {"round": 1, "amount": Decimal("1250.50")},
        "actor": "finance-lead@example.com",
        "reason": "Round 1 batch",
    }
    kwargs.update(overrides)
    record_change(pb, **kwargs)  # type: ignore[arg-type]


def _body(pb: MagicMock) -> dict[str, object]:
    pb.collection.assert_called_once_with("aid_change_log")
    create = pb.collection.return_value.create
    create.assert_called_once()
    body: dict[str, object] = create.call_args.args[0]
    return body


def test_writes_one_row_to_aid_change_log() -> None:
    pb = MagicMock()
    _call(pb)
    assert COLLECTION == "aid_change_log"
    body = _body(pb)
    # A lone change is an operation of one (sub-project 4a).
    assert re.fullmatch(r"[a-z0-9]{15}", str(body.pop("operation_id")))
    assert body == {
        "entity": "aid_decisions",
        "entity_id": "2027:1000001:1000002",
        "year": 2027,
        "action": "create",
        "before": None,
        "after": {"round": 1, "amount": "1250.50"},
        "actor": "finance-lead@example.com",
        "reason": "Round 1 batch",
        "persona": "",
    }


def test_decimal_is_stored_exactly_as_its_string() -> None:
    """Money is Decimal (spec §8). A float would turn 0.1 + 0.2 into 0.30000000000000004;
    the SDK's JSON encoder would simply crash on a Decimal."""
    pb = MagicMock()
    # "update" (not the default "create") because this test exercises Decimal
    # encoding on both snapshot fields at once, and a non-null before is
    # otherwise rejected outright by the create/delete snapshot rule.
    _call(
        pb,
        action="update",
        before={"amount": Decimal("0.10")},
        after={"amount": Decimal("0.30"), "nested": [Decimal(5)]},
    )
    body = _body(pb)
    assert body["before"] == {"amount": "0.10"}
    assert body["after"] == {"amount": "0.30", "nested": ["5"]}


def test_dates_are_stored_as_iso_strings() -> None:
    pb = MagicMock()
    stamp = datetime(2027, 3, 1, 17, 30, tzinfo=UTC)
    _call(pb, after={"decided_on": date(2027, 3, 1), "posted_at": stamp})
    assert _body(pb)["after"] == {"decided_on": "2027-03-01", "posted_at": "2027-03-01T17:30:00+00:00"}


def test_nan_is_refused_not_stored() -> None:
    with pytest.raises(ValueError):
        _call(MagicMock(), after={"amount": math.nan})


@pytest.mark.parametrize("bad", [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity"), Decimal("sNaN")])
@pytest.mark.parametrize("field", ["before", "after"])
def test_non_finite_decimal_is_refused_not_stored(bad: Decimal, field: str) -> None:
    """`_json_default` turns every Decimal into str(value): NaN, Infinity and
    sNaN would otherwise be written as those literal strings. `allow_nan=False`
    only catches float, never Decimal, so this must be checked explicitly."""
    pb = MagicMock()
    kwargs: dict[str, object] = {"before": None, "after": None}
    kwargs[field] = {"amount": bad}
    if field == "before":
        # "update" (not the default "create") because a non-null before is
        # otherwise rejected outright by the create/delete snapshot rule,
        # which would mask the non-finite-Decimal check this test targets.
        kwargs["after"] = {"amount": Decimal(1)}
        kwargs["action"] = "update"
    with pytest.raises(ValueError):
        _call(pb, **kwargs)
    pb.collection.assert_not_called()


def test_an_unserialisable_value_is_refused_with_its_type() -> None:
    with pytest.raises(TypeError, match="set"):
        _call(MagicMock(), after={"tiers": {1, 2}})


@pytest.mark.parametrize(
    "after",
    [
        {"tiers": {1: "a", "1": "b"}},  # json.dumps would collapse these two keys
        {"rows": [{2: "x"}]},
        {3: "top level"},
    ],
)
def test_a_non_string_key_is_refused_before_it_can_be_coerced(after: dict[Any, Any]) -> None:
    pb = MagicMock()
    with pytest.raises(TypeError, match="key"):
        _call(pb, action="update", after=after)
    pb.collection.assert_not_called()


def test_delete_has_before_and_no_after() -> None:
    pb = MagicMock()
    _call(pb, action="delete", before={"stage": "offered"}, after=None)
    body = _body(pb)
    assert body["before"] == {"stage": "offered"}
    assert body["after"] is None


def test_a_change_with_neither_snapshot_is_refused() -> None:
    pb = MagicMock()
    with pytest.raises(ValueError, match="before or an after"):
        _call(pb, before=None, after=None)
    pb.collection.assert_not_called()


def test_a_create_with_a_before_snapshot_is_refused() -> None:
    pb = MagicMock()
    with pytest.raises(ValueError, match="create"):
        _call(pb, action="create", before={"stage": "draft"}, after={"stage": "offered"})
    pb.collection.assert_not_called()


def test_a_delete_with_an_after_snapshot_is_refused() -> None:
    pb = MagicMock()
    with pytest.raises(ValueError, match="delete"):
        _call(pb, action="delete", before={"stage": "offered"}, after={"stage": "closed"})
    pb.collection.assert_not_called()


def test_other_actions_may_carry_both_snapshots() -> None:
    pb = MagicMock()
    _call(pb, action="update", before={"stage": "draft"}, after={"stage": "offered"})
    body = _body(pb)
    assert body["before"] == {"stage": "draft"}
    assert body["after"] == {"stage": "offered"}


@pytest.mark.parametrize("field", ["entity", "entity_id", "action", "actor"])
def test_blank_required_text_is_refused(field: str) -> None:
    pb = MagicMock()
    with pytest.raises(ValueError, match=field):
        _call(pb, **{field: "   "})
    pb.collection.assert_not_called()


@pytest.mark.parametrize("year", [1999, 2101])
def test_year_out_of_range_is_refused(year: int) -> None:
    with pytest.raises(ValueError, match="year"):
        _call(MagicMock(), year=year)


@pytest.mark.parametrize("year", [True, 2027.0, "2027"])
def test_year_must_be_a_real_int(year: object) -> None:
    with pytest.raises(TypeError, match="year"):
        _call(MagicMock(), year=year)


def test_snapshot_must_be_a_dict() -> None:
    with pytest.raises(TypeError, match="after"):
        _call(MagicMock(), after=[1, 2])


def test_no_reason_is_stored_as_empty_text() -> None:
    pb = MagicMock()
    _call(pb, reason=None)
    assert _body(pb)["reason"] == ""


def test_a_failed_write_is_not_swallowed() -> None:
    """Spec §14.4: every write is recorded. The caller must know when it wasn't."""
    pb = MagicMock()
    pb.collection.return_value.create.side_effect = RuntimeError("PocketBase unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        _call(pb)


def test_every_key_written_is_a_field_of_the_migration() -> None:
    """PocketBase drops an unknown key from a create body without an error, so
    a renamed field would silently lose history. Pin the helper's keys to the
    migrations that create and extend the collection (located by name: renumber-safe)."""
    files = sorted(MIGRATIONS.glob("*_aid_change_log*.js"))
    # 1500000187 creates the collection; 1500000194 adds operation_id and persona.
    assert len(files) >= 2, files
    declared = {name for f in files for name in re.findall(r'name:\s*"([a-z_]+)"', f.read_text())}
    pb = MagicMock()
    _call(pb)
    missing = sorted(set(_body(pb)) - declared)
    assert missing == []

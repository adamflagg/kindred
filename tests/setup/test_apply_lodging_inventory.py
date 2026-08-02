"""Tests for scripts/dev/apply_lodging_inventory.py.

The boot loader is CREATE-IF-ABSENT, so it never touches a row that already
exists. That is deliberate — the registry is staff-editable and a full upsert
would undo confirmations and corrected coordinates on the next restart. The
consequence is that new columns land empty on every existing row, and something
else has to carry the inventory onto them. This script is that something, and
these tests pin what it is allowed to touch.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "apply_lodging_inventory.py"
_spec = importlib.util.spec_from_file_location("apply_lodging_inventory", _SCRIPT)
assert _spec is not None
assert _spec.loader is not None
apply_inv = importlib.util.module_from_spec(_spec)
# Registered before exec: @dataclass resolves annotations via
# sys.modules[cls.__module__], which is None for a module loaded straight from a
# spec, and the failure surfaces as an AttributeError during collection.
sys.modules[_spec.name] = apply_inv
_spec.loader.exec_module(apply_inv)


def _unit(code: str, **over: object) -> dict[str, Any]:
    base: dict[str, Any] = {
        "code": code,
        "name": code,
        "has_power": False,
        "has_heat": False,
        "max_beds": None,
        "has_ramp": "",
        "bathroom": "none",
        "bathroom_group": "",
        "is_container": False,
        "sleeps": None,
        "map_x": 0.5,
        "map_y": 0.5,
        "notes": "",
        "parent_unit": "",
    }
    base.update(over)
    return base


def test_plans_an_update_for_a_changed_amenity() -> None:
    want = [_unit("a", has_power=True, max_beds=4)]
    have = {"a": _unit("a")}

    plan = apply_inv.plan_updates(want, have)

    assert len(plan.updates) == 1
    assert plan.updates[0].code == "a"
    assert plan.updates[0].fields == {"has_power": True, "max_beds": 4}


def test_plans_nothing_when_the_database_already_matches() -> None:
    want = [_unit("a", has_power=True, max_beds=4)]
    have = {"a": _unit("a", has_power=True, max_beds=4)}

    assert apply_inv.plan_updates(want, have).updates == []


def test_a_unit_missing_from_the_database_is_left_to_the_boot_loader() -> None:
    """Creating rows is the loader's job. A script that also created them would
    be a second writer with different rules for the same table."""
    want = [_unit("brand-new", has_power=True)]

    plan = apply_inv.plan_updates(want, {})

    assert plan.updates == []
    assert plan.absent == ["brand-new"]


# The whole point of create-if-absent. If this script overwrote these it would
# reintroduce, on demand, exactly the clobbering the loader refuses to do.
@pytest.mark.parametrize(
    ("field", "db_value", "file_value"),
    [
        ("sleeps", 9, 4),
        ("map_x", 0.9, 0.5),
        ("is_confirmed", True, False),
    ],
)
def test_staff_owned_fields_are_never_updated(field: str, db_value: object, file_value: object) -> None:
    want = [_unit("a", **{field: file_value})]
    have = {"a": _unit("a", **{field: db_value})}

    assert apply_inv.plan_updates(want, have).updates == []


def test_structural_differences_are_reported_but_not_applied() -> None:
    """A changed bathroom or container flag is a real correction, but it is not
    an empty column being filled in — it overwrites a value someone may have set
    deliberately. Reported for a human, applied only on an explicit opt-in."""
    want = [_unit("a", bathroom="private", bathroom_group="", is_container=True)]
    have = {"a": _unit("a", bathroom="shared", bathroom_group="hall", is_container=False)}

    plan = apply_inv.plan_updates(want, have)

    assert plan.updates == []
    assert len(plan.structural) == 1
    assert plan.structural[0].code == "a"
    assert plan.structural[0].fields == {
        "bathroom": "private",
        "bathroom_group": "",
        "is_container": True,
    }


def test_structural_differences_become_updates_when_opted_in() -> None:
    want = [_unit("a", bathroom="private")]
    have = {"a": _unit("a", bathroom="shared")}

    plan = apply_inv.plan_updates(want, have, include_structural=True)

    assert plan.structural == []
    assert plan.updates[0].fields == {"bathroom": "private"}


def test_notes_are_filled_only_when_the_database_has_none() -> None:
    """Notes are free text a staff member may have written. Filling an empty one
    from the sheet adds information; overwriting a written one destroys it."""
    want = [_unit("a", notes="from the sheet"), _unit("b", notes="from the sheet")]
    have = {"a": _unit("a", notes=""), "b": _unit("b", notes="staff wrote this")}

    plan = apply_inv.plan_updates(want, have)
    by_code = {u.code: u.fields for u in plan.updates}

    assert by_code["a"] == {"notes": "from the sheet"}
    assert "b" not in by_code


def test_parent_unit_is_compared_as_a_code_not_a_record_id() -> None:
    """PocketBase stores parent_unit as a RELATION — a record id — while the
    registry file stores a unit code. Comparing them raw makes every parented
    unit look like it needs changing, and applying that would write a code into
    a relation field."""
    records = {
        "child": {"id": "rec_child", "code": "child", "parent_unit": "rec_parent"},
        "parent": {"id": "rec_parent", "code": "parent", "parent_unit": ""},
    }

    normalised = apply_inv.normalise_parents(records)

    assert normalised["child"]["parent_unit"] == "parent"
    assert normalised["parent"]["parent_unit"] == ""


def test_an_already_correct_parent_produces_no_change() -> None:
    records = apply_inv.normalise_parents(
        {
            "child": _unit("child", id="rec_child", parent_unit="rec_parent"),
            "parent": _unit("parent", id="rec_parent", parent_unit=""),
        }
    )
    want = [_unit("child", parent_unit="parent")]

    plan = apply_inv.plan_updates(want, records, include_structural=True)

    assert plan.updates == []


def test_an_unassessed_ramp_never_overwrites_an_assessed_one() -> None:
    """Empty has_ramp means NOT ASSESSED. Writing it over a real answer would
    erase an assessment and disguise it as one that never happened."""
    want = [_unit("a", has_ramp="")]
    have = {"a": _unit("a", has_ramp="yes")}

    assert apply_inv.plan_updates(want, have).updates == []


def test_a_null_max_beds_never_downgrades_a_known_value() -> None:
    """max_beds carries the same null-means-unknown contract as sleeps and
    has_ramp. Writing null over a real number replaces knowledge with a
    placeholder, and PocketBase stores it as 0 — which every consumer reads as
    "unknown", so the loss is silent."""
    want = [_unit("a", max_beds=None)]
    have = {"a": _unit("a", max_beds=14)}

    assert apply_inv.plan_updates(want, have).updates == []


def test_a_known_max_beds_still_updates() -> None:
    want = [_unit("a", max_beds=14)]
    have = {"a": _unit("a", max_beds=None)}

    assert apply_inv.plan_updates(want, have).updates[0].fields == {"max_beds": 14}


def test_an_unresolvable_parent_code_is_an_error_not_a_silent_detach() -> None:
    """Under --structural a parent code that names nothing would otherwise fall
    back to "", detaching the child from its container with no error — the
    opposite of what every other guard in this script does."""
    with pytest.raises(KeyError, match="ghost"):
        apply_inv.resolve_parent_id({"parent_unit": "ghost"}, {"real": "rec_real"})


def test_a_resolvable_parent_code_becomes_a_record_id() -> None:
    out = apply_inv.resolve_parent_id({"parent_unit": "real"}, {"real": "rec_real"})
    assert out["parent_unit"] == "rec_real"


def test_clearing_a_parent_deliberately_is_still_allowed() -> None:
    """An empty code means "no parent", which is a legitimate value — only an
    unresolvable non-empty code is an error."""
    out = apply_inv.resolve_parent_id({"parent_unit": ""}, {"real": "rec_real"})
    assert out["parent_unit"] == ""

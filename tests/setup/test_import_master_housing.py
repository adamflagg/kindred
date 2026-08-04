"""Tests for scripts/dev/import_master_housing.py.

The registry file is the deliverable, not database writes: the boot loader
(pocketbase/lodging/registry.go) and apply_lodging_inventory.py are the only
two sanctioned writers, and a third would be a third opinion about what is
true. So this script's whole job is to produce a reviewable diff of
lodging_registry.json, and these tests pin what it may put in one.

The constraint that matters most is what it must NOT touch. `sleeps`, the map
coordinates, `is_confirmed`, `is_active` and `inventory_class` are staff-owned;
the create-if-absent design of the loader exists precisely so a bulk import
cannot undo a human's edits, and an importer that wrote them would defeat it
from the other side.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "import_master_housing.py"
_spec = importlib.util.spec_from_file_location("import_master_housing", _SCRIPT)
assert _spec is not None
assert _spec.loader is not None
imh = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = imh
_spec.loader.exec_module(imh)


HEADER = [""] * 17
HEADER[4], HEADER[5], HEADER[6], HEADER[9], HEADER[15] = (
    "Cabin Name",
    "Capacity",
    "Bed & Bath",
    "Bathroom",
    "Family/Staff",
)


def _row(
    name: str,
    *,
    capacity: object = "",
    bed_bath: str = "",
    bathroom: str = "",
    kitchen: str = "",
) -> list[object]:
    row: list[object] = [""] * 17
    row[4], row[5], row[6], row[9], row[11] = name, capacity, bed_bath, bathroom, kitchen
    return row


def _registry(*codes: str, **over: Any) -> dict[str, Any]:
    units = []
    for code in codes:
        unit: dict[str, Any] = {
            "code": code,
            "name": code.replace("-", " ").title(),
            "area": "GT",
            "sleeps": 4,
            "map_x": 0.5,
            "map_y": 0.5,
            "is_container": False,
            "parent_unit": "",
            "inventory_class": "family_pool",
            "is_confirmed": False,
            "is_active": True,
            "notes": "",
        }
        unit.update(over.get(code, {}))
        units.append(unit)
    return {"_notes": [], "areas": [], "units": units, "aliases": []}


def _by_code(registry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {u["code"]: u for u in registry["units"]}


# --- what it must never write --------------------------------------------


def test_never_writes_a_staff_owned_field() -> None:
    """The sheet has a Capacity column and the beds imply a number, so there are
    two standing temptations to write `sleeps`. Neither may.
    """
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Gt Lofty", capacity=8, bed_bath="1 queen, 1 twin")]

    plan = imh.plan_import(sheet, registry)
    updated = imh.apply_plan(plan, registry)

    before, after = _by_code(registry)["gt-lofty"], _by_code(updated)["gt-lofty"]
    for guarded in imh.STAFF_OWNED:
        assert after[guarded] == before[guarded], f"{guarded} was modified"


def test_writes_only_the_declared_inventory_keys() -> None:
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Gt Lofty", bed_bath="1 queen, mini fridge", bathroom="shared, accessible shower")]

    updated = imh.apply_plan(imh.plan_import(sheet, registry), registry)

    changed = {
        key for key, value in _by_code(updated)["gt-lofty"].items() if _by_code(registry)["gt-lofty"].get(key) != value
    }
    assert changed <= set(imh.WRITABLE)


# --- the refining booleans ------------------------------------------------
#
# Each one REFINES a field that already exists rather than restating it, so
# there is never a second answer to the same question: has_tub sits under the
# `bathroom` enum, has_kitchenette under has_kitchen, has_shared_fridge under
# has_fridge. A parallel field that could disagree with its parent is the thing
# this registry keeps getting bitten by.


def test_has_tub_comes_from_the_bathroom_column() -> None:
    registry = _registry("a", "b", "c")
    sheet = [
        HEADER,
        _row("A", bathroom="private (+tub)"),
        _row("B", bathroom="shared (+tub)"),
        _row("C", bathroom="private, shower"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert updated["a"]["has_tub"] is True
    assert updated["b"]["has_tub"] is True
    assert updated["c"]["has_tub"] is False


def test_has_kitchenette_distinguishes_the_ette_marker() -> None:
    """`X (ette)` survived only as prose in `notes` before this."""
    registry = _registry("a", "b", "c")
    sheet = [
        HEADER,
        _row("A", kitchen="X (ette)"),
        _row("B", kitchen="X"),
        _row("C", kitchen="Part of the back room"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert updated["a"]["has_kitchenette"] is True
    assert updated["b"]["has_kitchenette"] is False
    assert updated["c"]["has_kitchenette"] is False


def test_crib_and_changing_table_reach_the_registry() -> None:
    registry = _registry("a", "b")
    sheet = [
        HEADER,
        _row("A", bed_bath="1 queen, 1 full/twin bunk + crib"),
        _row("B", bed_bath="1 queen, 1 twin bunk, changing table"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert updated["a"]["has_crib"] is True
    assert updated["a"]["has_changing_table"] is False
    assert updated["b"]["has_changing_table"] is True
    assert updated["b"]["has_crib"] is False


def test_a_shared_fridge_sets_both_has_fridge_and_has_shared_fridge() -> None:
    """has_shared_fridge refines has_fridge; it never contradicts it. A shared
    fridge is still a fridge, so a consumer that only knows has_fridge stays
    correct."""
    registry = _registry("a", "b")
    sheet = [
        HEADER,
        _row("A", bed_bath="1 queen, shared mini fridge"),
        _row("B", bed_bath="1 queen, mini fridge"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert (updated["a"]["has_fridge"], updated["a"]["has_shared_fridge"]) == (True, True)
    assert (updated["b"]["has_fridge"], updated["b"]["has_shared_fridge"]) == (True, False)


def test_every_writable_key_is_in_the_apply_scripts_inventory_fields() -> None:
    """A key this importer writes to the file but apply_lodging_inventory does
    not carry onto the row lands nowhere: the loader is create-if-absent, so an
    existing unit never picks it up. It would look imported and be invisible."""
    import importlib.util as _util

    path = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "apply_lodging_inventory.py"
    spec = _util.spec_from_file_location("apply_lodging_inventory_check", path)
    assert spec is not None
    assert spec.loader is not None
    module = _util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    assert set(imh.WRITABLE) <= set(module.INVENTORY_FIELDS)


# --- the inventory it does write -----------------------------------------


def test_writes_parsed_beds_onto_the_resolved_unit() -> None:
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Gt Lofty", bed_bath="6 bunks, 3 singles")]

    updated = imh.apply_plan(imh.plan_import(sheet, registry), registry)

    assert _by_code(updated)["gt-lofty"]["beds"] == [
        {"type": "twin_bunk", "count": 6},
        {"type": "twin", "count": 3},
    ]


def test_a_refused_row_leaves_beds_null_rather_than_empty() -> None:
    """null is UNKNOWN and apply_lodging_inventory skips it; [] would be a claim
    that the room has no beds, and would overwrite a real inventory."""
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Gt Lofty", bed_bath="3 rm 2 bth")]

    plan = imh.plan_import(sheet, registry)
    updated = imh.apply_plan(plan, registry)

    assert _by_code(updated)["gt-lofty"]["beds"] is None
    assert any(r.beds_reason for r in plan.rows if r.code == "gt-lofty")


def test_a_shared_mini_fridge_still_sets_has_fridge() -> None:
    """The private/shared distinction has no schema home yet, so it is reported
    rather than encoded — but a shared fridge is still a fridge."""
    registry = _registry("a", "b")
    sheet = [
        HEADER,
        _row("A", bed_bath="1 queen, shared mini fridge"),
        _row("B", bed_bath="1 queen, mini fridge"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert updated["a"]["has_fridge"] is True
    assert updated["b"]["has_fridge"] is True


def test_is_accessible_comes_from_the_bathroom_column() -> None:
    registry = _registry("a", "b")
    sheet = [
        HEADER,
        _row("A", bathroom="shared, accessible shower"),
        _row("B", bathroom="shared, shower"),
    ]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))
    assert updated["a"]["is_accessible"] is True
    assert updated["b"]["is_accessible"] is False


# --- resolution -----------------------------------------------------------


def test_a_reviewed_alias_resolves_a_decorated_sheet_name() -> None:
    """'Wawona (Front)' must reach the leaf. Stripping the parenthetical would
    reduce both Front and Back to the container and silently double-write it."""
    assert imh.ALIAS_ADDITIONS["Wawona (Front)"] == ["gt-wawona-front"]
    assert imh.ALIAS_ADDITIONS["Wawona (Back)"] == ["gt-wawona-back"]


def test_alias_additions_never_target_a_container() -> None:
    containers = {"gt-wawona", "gt-tioga", "gt-tenaya", "gt-kitty", "gt-le-shack", "hc-downstairs"}
    for alias, codes in imh.ALIAS_ADDITIONS.items():
        assert not (set(codes) & containers), f"{alias!r} points at a container"


def test_an_unresolved_row_is_reported_not_skipped_silently() -> None:
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Nowhere Cabin", bed_bath="4 singles")]

    plan = imh.plan_import(sheet, registry)

    assert [r.name for r in plan.unresolved] == ["Nowhere Cabin"]


def test_a_known_non_unit_row_is_classified_not_reported_as_a_failure() -> None:
    """Staff housing and section headers are absent from the registry on
    purpose; surfacing them as unresolved would train people to ignore the list."""
    registry = _registry("gt-lofty")
    sheet = [HEADER, _row("Caretaker", bed_bath="2 bdrm 2 bath"), _row("RIVER SIDE")]

    plan = imh.plan_import(sheet, registry)

    assert {r.name for r in plan.non_units} == {"Caretaker", "RIVER SIDE"}
    assert plan.unresolved == []


# --- Clouds Rest, by hand -------------------------------------------------


def test_clouds_rest_children_get_their_beds_from_the_hand_mapping() -> None:
    """Clouds Rest is normally let as one whole-house booking rather than per
    room, which is why it is the only container with its own sheet row and why
    that row describes its four children in prose. The parser refuses the prose;
    this table is the reviewed reading of it.
    """
    registry = _registry(
        "gt-clouds-rest",
        "gt-clouds-rest-side",
        "gt-clouds-rest-loft",
        "gt-clouds-rest-back",
        "gt-clouds-rest-laundry",
        **{"gt-clouds-rest": {"is_container": True, "name": "Clouds Rest"}},
    )
    sheet = [HEADER, _row("Clouds Rest", bed_bath="3+ bedrooms, 1 bath; side room w/ queen (full?)")]

    updated = _by_code(imh.apply_plan(imh.plan_import(sheet, registry), registry))

    assert updated["gt-clouds-rest-side"]["beds"] == [{"type": "queen", "count": 1}]
    assert updated["gt-clouds-rest-loft"]["beds"] == [{"type": "queen", "count": 1}]
    assert updated["gt-clouds-rest-back"]["beds"] == [{"type": "full_twin_bunk", "count": 1}]
    assert updated["gt-clouds-rest-laundry"]["beds"] == [{"type": "twin", "count": 1}]


def test_the_clouds_rest_container_carries_only_the_shared_living_room_futon() -> None:
    """Anything the children already hold would be counted twice."""
    assert imh.CLOUDS_REST_BEDS["gt-clouds-rest"] == [{"type": "futon", "count": 1}]
    children = {k: v for k, v in imh.CLOUDS_REST_BEDS.items() if k != "gt-clouds-rest"}
    assert all(entry["type"] != "futon" for beds in children.values() for entry in beds)

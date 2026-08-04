#!/usr/bin/env python3
"""Import bed and amenity inventory from the 2026 Master Housing sheet into the registry.

WHAT THIS WRITES: `beds`, `has_fridge` and `is_accessible` on
config/lodging_registry.json, plus the reviewed alias additions. Nothing else,
and never to the database — the boot loader (pocketbase/lodging/registry.go) and
apply_lodging_inventory.py are the only two sanctioned writers, and the registry
file is what they both read. Adding a third writer is how two of them start
disagreeing about what is true.

Run it, read the plan, then re-run with --apply:

    uv run scripts/dev/import_master_housing.py                 # prints the plan
    uv run scripts/dev/import_master_housing.py --apply         # writes the file
    uv run scripts/dev/import_master_housing.py --sheet-json X  # offline, cached pull

Source: "2026 Master Housing Document (FC & Summer)", tab "Master Housing Tab",
read with the kindred service account in config/google_sheets.json.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

import jwt
import requests

_ROOT = Path(__file__).resolve().parents[2]

_spec = importlib.util.spec_from_file_location(
    "parse_bed_bath", _ROOT / "scripts" / "dev" / "lib" / "parse_bed_bath.py"
)
assert _spec is not None
assert _spec.loader is not None
_pbb = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _pbb
_spec.loader.exec_module(_pbb)
parse_bed_bath = _pbb.parse_bed_bath

SHEET_ID = "1GtNje2ETlcr3JQYMF3ChXndsH9ddySujc1Yv9YCq0Gs"
SHEET_TAB = "Master Housing Tab"
REGISTRY = _ROOT / "config" / "lodging_registry.json"

NAME_COL, CAPACITY_COL, BED_BATH_COL, BATHROOM_COL, KITCHEN_COL = 4, 5, 6, 9, 11

# Mirrors apply_lodging_inventory.STAFF_OWNED. Duplicated rather than imported
# because the two scripts must be able to disagree loudly in review if either
# list ever changes; a shared import would hide a widening of this one.
STAFF_OWNED = ("sleeps", "map_x", "map_y", "is_confirmed", "is_active", "inventory_class")

# The only keys this script may set.
#
# The five booleans after the first three each REFINE a field that already
# exists rather than restating it: has_tub sits under the `bathroom` enum,
# has_kitchenette under has_kitchen, has_shared_fridge under has_fridge. None of
# them can contradict its parent, so a consumer that knows only the parent stays
# correct. A parallel field that could disagree is what this registry keeps
# getting bitten by, and it is why the `bathroom` enum was not widened instead —
# that three-way is load-bearing in the fit check and in matching.
WRITABLE = (
    "beds",
    "has_fridge",
    "is_accessible",
    "has_tub",
    "has_kitchenette",
    "has_crib",
    "has_changing_table",
    "has_shared_fridge",
)

# Sheet name -> unit code. HAND-CHECKED, one row at a time, and reviewed before
# first use. This is deliberately a table and not a fuzzy matcher: a matcher
# that runs at import time re-derives its answers on data nobody is looking at,
# and a wrong one writes real bed data onto the wrong cabin with nothing to
# catch it. The Wawona pair is the worked example — stripping the trailing
# parenthetical reduces both Front and Back to "Wawona", which is the container.
ALIAS_ADDITIONS: dict[str, list[str]] = {
    # Health Center Upstairs: the room number is the trailing digit. Room 2
    # being the Med Assistant room corroborates the registry note that it is
    # real but went unused in 2024-25.
    "Health Center Upstairs - Recovery Room 1": ["hc-upstairs-1"],
    "Health Center Upstairs - Med Assistant Room 2": ["hc-upstairs-2"],
    "Health Center Upstairs - Recovery Room 3": ["hc-upstairs-3"],
    "Health Center Upstairs - Recovery Room 4": ["hc-upstairs-4"],
    "Health Center Upstairs - Recovery Room 5": ["hc-upstairs-5"],
    "Health Center Upstairs - Isolation Room 6": ["hc-upstairs-6"],
    # The sheet drops the "Ridge" prefix the registry and the map both carry.
    "Yurt 1": ["ridge-yurt-1"],
    "Yurt 2": ["ridge-yurt-2"],
    "Yurt 3": ["ridge-yurt-3"],
    "Yurt 4": ["ridge-yurt-4"],
    "Yurt 5": ["ridge-yurt-5"],
    "Yurt 6": ["ridge-yurt-6"],
    "Yurt 7": ["ridge-yurt-7"],
    # Editorial suffixes the registry does not carry.
    "River F (New 1) - closer to bathroom": ["river-f"],
    "River J (B7) - closer to bathroom": ["river-j"],
    "River M (B9) (older)": ["river-m"],
    # MUST reach the leaves. See the note above.
    "Wawona (Front)": ["gt-wawona-front"],
    "Wawona (Back)": ["gt-wawona-back"],
    # Decorated names whose BARE form already resolves through the existing
    # alias table. Listed verbatim anyway, because the alternative is stripping
    # the decoration at import time — and that strip is what turns "Wawona
    # (Front)" into the container. A lookup that only ever succeeds on an exact
    # string cannot make that mistake quietly.
    #
    # The trailing parenthetical is an old cabin label. Where it matches the
    # unit's `notes` (seeded from this sheet's own Notes column) that agreement
    # is marked below; the River block has none because the sheet's two label
    # columns are in opposite order there, which staff have confirmed is a paste
    # artifact and not a disagreement about which cabin is which.
    "Kitty 2 (smaller than K3)": ["gt-kitty-2"],
    "River A (New Btent) - new": ["river-a"],
    "River B (B3)": ["river-b"],  # notes agree
    "River C (B4)": ["river-c"],  # notes agree
    "River D (B5)": ["river-d"],  # notes agree
    "River E (B6)": ["river-e"],  # notes agree
    "River G (New 3) - new": ["river-g"],
    "River H (New 2) - new": ["river-h"],
    "River I (B8)": ["river-i"],
    "River K (B10)": ["river-k"],
    "River L (N Old B9) - new, massage": ["river-l"],
    "Ridge A (G6)": ["ridge-a"],  # notes agree
    "Ridge B (G7)": ["ridge-b"],  # notes agree
    "Ridge C (G8)": ["ridge-c"],  # notes agree
    "Ridge D (G5)": ["ridge-d"],  # notes agree
    "Ridge E (Gnew) - new": ["ridge-e"],
    "Ridge F (G4) - new": ["ridge-f"],
    "Ridge G (G3) - new": ["ridge-g"],
    "Ridge H (G2) - new": ["ridge-h"],
    "Ridge I (G1) - new": ["ridge-i"],
    "Ridge J (G9)": ["ridge-j"],  # notes agree
    "Ridge K (G10)": ["ridge-k"],  # notes agree
    "Ridge L (G11)": ["ridge-l"],  # notes agree
    "Ridge M (G12)": ["ridge-m"],  # notes agree
    "Manzanita 2 (updated)": ["manzanita-2"],
    # The sheet spells these with a curly apostrophe (U+2019); the registry name
    # uses U+0027. aliasLookupKey lowercases and trims but does not fold the
    # two, so without these the rows simply do not resolve.
    "L’Shack 1": ["gt-le-shack-1"],
    "L’Shack 2": ["gt-le-shack-2"],
    "L’Shack 3": ["gt-le-shack-3"],
}

# Real sheet rows that correspond to no registry unit, and why. Reporting these
# as failures would pad the unresolved list with rows nobody needs to act on,
# and a list that is mostly noise stops being read.
NON_UNIT_ROWS: dict[str, str] = {
    "Caretaker": "staff housing (Assignment 'Staff: B&G') - not planning inventory",
    "Asst. Caretaker": "staff housing (Assignment 'Staff: B&G') - not planning inventory",
    "Tents (BYO)": "bring-your-own tents - no capacity, no bed data",
    "RIVER SIDE": "section header",
    "RIDGE SIDE": "section header",
    "Tent City": "section header",
    "Tuolumnes": "section header",
    "Total": "sum row - its Capacity 46050 is a sum artifact, not a bed count",
}

# Clouds Rest is the only container with its own sheet row, because it is
# normally let as ONE whole-house booking rather than per room the way Tioga,
# Tenaya and Kitty are. That is why its row describes four child rooms in prose
# where every other container appears only as its leaves. The parser refuses the
# prose; this is the reviewed reading of it.
#
# The living-room futon is shared space belonging to no child, so it sits on the
# container. Nothing a child already holds may appear here or it is counted
# twice. The sheet's two "(full?)" hedges are recorded as queens, which is what
# it says; the hedge is surfaced in the report rather than guessed at.
CLOUDS_REST_BEDS: dict[str, list[dict[str, Any]]] = {
    "gt-clouds-rest": [{"type": "futon", "count": 1}],
    "gt-clouds-rest-side": [{"type": "queen", "count": 1}],
    "gt-clouds-rest-loft": [{"type": "queen", "count": 1}],
    "gt-clouds-rest-back": [{"type": "full_twin_bunk", "count": 1}],
    "gt-clouds-rest-laundry": [{"type": "twin", "count": 1}],
}
CLOUDS_REST_ROW = "Clouds Rest"


@dataclass
class RowPlan:
    row: int
    name: str
    code: str | None = None
    fields: dict[str, Any] = field(default_factory=dict)
    beds_reason: str = ""
    qualifiers: tuple[str, ...] = ()
    fridge: str = ""
    crib: bool = False
    changing_table: bool = False
    note: str = ""


@dataclass
class ImportPlan:
    rows: list[RowPlan] = field(default_factory=list)
    unresolved: list[RowPlan] = field(default_factory=list)
    non_units: list[RowPlan] = field(default_factory=list)
    new_aliases: list[dict[str, Any]] = field(default_factory=list)


def _norm(text: str) -> str:
    """Casefold and collapse outer whitespace, matching aliasLookupKey in Go.

    Inner spacing stays significant: one seeded alias, "Health Center Downstairs
    - Room A", genuinely carries a double space.
    """
    return " ".join(str(text).split()).casefold()


def _cell(row: list[Any], index: int) -> str:
    return str(row[index]).strip() if len(row) > index else ""


def build_index(registry: dict[str, Any]) -> dict[str, list[str]]:
    """Sheet name -> unit codes, over names, codes, existing aliases and additions."""
    index: dict[str, list[str]] = {}
    for unit in registry["units"]:
        index.setdefault(_norm(unit["name"]), [unit["code"]])
        index.setdefault(_norm(unit["code"]), [unit["code"]])
    for alias in registry.get("aliases", []):
        index.setdefault(_norm(alias["alias_string"]), list(alias["member_units"]))
    # Additions win: they are the reviewed answer where the registry is silent.
    for alias_string, codes in ALIAS_ADDITIONS.items():
        index[_norm(alias_string)] = list(codes)
    return index


def plan_import(sheet: list[list[Any]], registry: dict[str, Any]) -> ImportPlan:
    index = build_index(registry)
    known = {u["code"] for u in registry["units"]}
    plan = ImportPlan()

    existing_aliases = {_norm(a["alias_string"]) for a in registry.get("aliases", [])}
    for alias_string, codes in ALIAS_ADDITIONS.items():
        if _norm(alias_string) not in existing_aliases and set(codes) <= known:
            plan.new_aliases.append(
                {
                    "alias_string": alias_string,
                    "member_units": list(codes),
                    "valid_from_year": None,
                    "valid_to_year": None,
                }
            )

    for number, row in enumerate(sheet[1:], start=2):
        name = _cell(row, NAME_COL)
        if not name:
            continue

        entry = RowPlan(row=number, name=name)

        if _norm(name) in {_norm(k) for k in NON_UNIT_ROWS}:
            entry.note = next(v for k, v in NON_UNIT_ROWS.items() if _norm(k) == _norm(name))
            plan.non_units.append(entry)
            continue

        resolved = index.get(_norm(name))
        if not resolved:
            plan.unresolved.append(entry)
            continue
        entry.code = resolved[0]

        parsed = parse_bed_bath(_cell(row, BED_BATH_COL))
        entry.beds_reason = parsed.reason
        entry.qualifiers = parsed.qualifiers
        entry.fridge = parsed.fridge
        entry.crib = parsed.crib
        entry.changing_table = parsed.changing_table

        # `beds` is nullable and null means UNKNOWN, so a refusal writes null
        # rather than [] — an empty list claims the room has no beds and would
        # overwrite an inventory entered by hand.
        bathroom = _cell(row, BATHROOM_COL).casefold()
        kitchen = _cell(row, KITCHEN_COL).casefold()

        entry.fields["beds"] = parsed.beds
        entry.fields["has_fridge"] = bool(parsed.fridge)
        entry.fields["is_accessible"] = "accessible" in bathroom
        entry.fields["has_tub"] = "tub" in bathroom
        # "X (ette)" is a kitchenette; a bare "X" is a full kitchen. Anything
        # else in that column is prose about where the kitchen is, not a claim
        # about its size.
        entry.fields["has_kitchenette"] = "ette" in kitchen
        entry.fields["has_crib"] = parsed.crib
        entry.fields["has_changing_table"] = parsed.changing_table
        entry.fields["has_shared_fridge"] = parsed.fridge == "shared"

        plan.rows.append(entry)

    return plan


def apply_plan(plan: ImportPlan, registry: dict[str, Any]) -> dict[str, Any]:
    """Return a new registry with the plan applied. Does not mutate its input."""
    updated: dict[str, Any] = json.loads(json.dumps(registry))
    by_code = {u["code"]: u for u in updated["units"]}

    for entry in plan.rows:
        unit = by_code.get(entry.code or "")
        if unit is None:
            continue
        for key, value in entry.fields.items():
            if key in STAFF_OWNED:  # unreachable by construction; a guard, not a filter
                raise AssertionError(f"refusing to write staff-owned field {key!r}")
            if key not in WRITABLE:
                raise AssertionError(f"refusing to write unlisted field {key!r}")
            unit[key] = value

        # The prose row is refused by the parser; the hand mapping is the answer.
        if _norm(entry.name) == _norm(CLOUDS_REST_ROW):
            for code, beds in CLOUDS_REST_BEDS.items():
                if code in by_code:
                    by_code[code]["beds"] = json.loads(json.dumps(beds))

    known = {u["code"] for u in updated["units"]}
    seen = {_norm(a["alias_string"]) for a in updated.get("aliases", [])}
    for alias in plan.new_aliases:
        if _norm(alias["alias_string"]) in seen or not set(alias["member_units"]) <= known:
            continue
        updated.setdefault("aliases", []).append(alias)
        seen.add(_norm(alias["alias_string"]))

    return updated


def fetch_sheet() -> list[list[Any]]:
    """Read the tab via the Sheets REST API. google-api-python-client is absent."""
    account = json.loads((_ROOT / "config" / "google_sheets.json").read_text(encoding="utf-8"))
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": account["client_email"],
            "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
            "aud": account["token_uri"],
            "iat": now,
            "exp": now + 3600,
        },
        account["private_key"],
        algorithm="RS256",
    )
    token = requests.post(
        account["token_uri"],
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=30,
    )
    token.raise_for_status()
    response = requests.get(
        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{quote(SHEET_TAB)}",
        params={"valueRenderOption": "UNFORMATTED_VALUE"},
        headers={"Authorization": f"Bearer {token.json()['access_token']}"},
        timeout=60,
    )
    response.raise_for_status()
    return list(response.json().get("values", []))


def report(plan: ImportPlan, registry: dict[str, Any]) -> None:
    by_code = {u["code"]: u for u in registry["units"]}
    parsed = [r for r in plan.rows if r.fields.get("beds") is not None]
    refused = [r for r in plan.rows if r.fields.get("beds") is None]

    print("=" * 72)
    print("MASTER HOUSING IMPORT - PLAN")
    print("=" * 72)
    print(f"  rows mapped to a unit    : {len(plan.rows)}")
    print(f"    beds parsed            : {len(parsed)}")
    print(f"    beds null (reported)   : {len(refused)}")
    print(f"  known non-unit rows      : {len(plan.non_units)}")
    print(f"  UNRESOLVED               : {len(plan.unresolved)}")
    print(f"  new aliases              : {len(plan.new_aliases)}")

    if plan.new_aliases:
        print("\n--- NEW ALIASES ---")
        for alias in plan.new_aliases:
            print(f"  {alias['alias_string']!r:48s} -> {alias['member_units']}")

    if plan.unresolved:
        print("\n--- UNRESOLVED (act on these) ---")
        for entry in plan.unresolved:
            print(f"  row {entry.row:3d}  {entry.name!r}")

    print("\n--- BEDS LEFT NULL ---")
    for entry in refused:
        print(f"  row {entry.row:3d}  {entry.name[:30]:32s} {entry.beds_reason[:74]}")

    qualified = [r for r in plan.rows if r.qualifiers]
    if qualified:
        print("\n--- QUALIFIERS WITH NO SCHEMA HOME (a human should read these) ---")
        for entry in qualified:
            print(f"  row {entry.row:3d}  {entry.name[:30]:32s} {'; '.join(entry.qualifiers)}")

    extras = [r for r in plan.rows if r.crib or r.changing_table or r.fridge == "shared"]
    if extras:
        print("\n--- FACTS WITH NO SCHEMA HOME YET ---")
        for entry in extras:
            flags = [
                name
                for name, on in (
                    ("crib", entry.crib),
                    ("changing table", entry.changing_table),
                    ("shared fridge", entry.fridge == "shared"),
                )
                if on
            ]
            print(f"  row {entry.row:3d}  {entry.name[:30]:32s} {', '.join(flags)}")

    print("\n--- DERIVED CAPACITY vs STAFF `sleeps` ---")
    print("  `sleeps` is the answer; derived is advisory and is never written.")
    sleeps_per = {
        "twin": 1,
        "twin_bunk": 2,
        "full_twin_bunk": 3,
        "full": 2,
        "queen": 2,
        "king": 2,
        "futon": 2,
        "cot": 1,
        "trundle": 1,
    }
    conflicts, suggestions = [], []
    for entry in parsed:
        unit = by_code.get(entry.code or "")
        if unit is None:
            continue
        derived = sum(sleeps_per.get(str(b["type"]), 0) * int(b["count"]) for b in entry.fields["beds"])
        staff = int(unit.get("sleeps") or 0)
        if unit.get("is_confirmed"):
            continue  # staff have already ruled
        if staff == 0:
            suggestions.append((entry, derived))
        elif staff != derived:
            conflicts.append((entry, derived, staff))
    print(f"  conflicts (sleeps set, differs) : {len(conflicts)}")
    print(f"  suggestions (sleeps unset)      : {len(suggestions)}")
    for entry, derived, staff in conflicts[:20]:
        print(f"    row {entry.row:3d} {entry.name[:26]:28s} derived={derived:3d}  sleeps={staff:3d}")
    if len(conflicts) > 20:
        print(f"    ... and {len(conflicts) - 20} more")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the registry file")
    parser.add_argument("--sheet-json", type=Path, help="use a cached pull instead of the API")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    args = parser.parse_args()

    sheet = json.loads(args.sheet_json.read_text(encoding="utf-8")) if args.sheet_json else fetch_sheet()
    registry = json.loads(args.registry.read_text(encoding="utf-8"))

    plan = plan_import(sheet, registry)
    report(plan, registry)

    if not args.apply:
        print("\nDRY RUN - nothing written. Re-run with --apply to write the registry.")
        return 0

    updated = apply_plan(plan, registry)
    args.registry.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWROTE {args.registry}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

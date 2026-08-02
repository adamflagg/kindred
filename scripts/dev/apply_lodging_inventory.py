#!/usr/bin/env python3
"""Carry the private lodging registry's inventory onto rows that already exist.

The boot loader (pocketbase/lodging/registry.go) is CREATE-IF-ABSENT: it creates
units it does not find and never touches ones it does. That is deliberate — the
registry is staff-editable in /manage/lodging, and a loader that rewrote every
field on boot would undo confirmations and corrected coordinates on the next
restart.

The consequence is that a new column lands EMPTY on every row that already
exists. The 2026 amenity columns are exactly that case: adding them to the
schema gives 93 units ten new false-everywhere flags. This script fills them in,
deliberately and once, rather than making the loader a second writer with
different rules.

It is dry-run by default and prints what it would change. Nothing is written
without --apply.

    scripts/dev/apply_lodging_inventory.py                    # show the plan
    scripts/dev/apply_lodging_inventory.py --apply            # fill amenities
    scripts/dev/apply_lodging_inventory.py --apply --structural   # + corrections

See docs/reference/lodging-registry.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

# Columns this script owns: they came from the inventory sheet and were empty
# (or absent) before it. Filling them adds information rather than replacing a
# judgement.
INVENTORY_FIELDS = (
    "has_power",
    "has_ac",
    "has_fridge",
    "is_accessible",
    "has_heat",
    "is_weatherized",
    "has_plumbing",
    "has_space_heater",
    "has_pack_play_space",
    "has_living_room",
    "has_kitchen",
    "has_lights",
    "max_beds",
)

# Real corrections, but each overwrites a value that may have been set on
# purpose, so they are reported for a human and applied only on --structural.
STRUCTURAL_FIELDS = ("bathroom", "bathroom_group", "is_container", "parent_unit")

# Never written by this script under any flag. These are the fields staff
# maintain, and overwriting them is precisely what create-if-absent exists to
# prevent.
STAFF_OWNED = ("sleeps", "map_x", "map_y", "is_confirmed", "is_active", "allocation_default")


@dataclass
class UnitUpdate:
    code: str
    fields: dict[str, Any]


@dataclass
class Plan:
    updates: list[UnitUpdate] = field(default_factory=list)
    structural: list[UnitUpdate] = field(default_factory=list)
    absent: list[str] = field(default_factory=list)


def _norm(value: Any) -> Any:
    """PocketBase stores an unset number as 0 and an unset bool as false, while
    the registry file uses null/absent for the same thing."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return value
    return value


def normalise_parents(records: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Rewrite each record's parent_unit from a PocketBase record id to a unit
    code, so it can be compared with the registry file.

    The database stores parent_unit as a relation — an id — while the file
    stores a code, by the same durable-key discipline that keeps the file
    portable across database rebuilds. Compared raw, every parented unit looks
    like it needs changing, and applying that would write a code into a
    relation field.
    """
    by_id = {r["id"]: r["code"] for r in records.values() if r.get("id")}
    out: dict[str, dict[str, Any]] = {}
    for code, rec in records.items():
        copy = dict(rec)
        parent = rec.get("parent_unit") or ""
        copy["parent_unit"] = by_id.get(parent, "") if parent else ""
        out[code] = copy
    return out


def plan_updates(
    want: list[dict[str, Any]], have: dict[str, dict[str, Any]], *, include_structural: bool = False
) -> Plan:
    """Diff the registry file against the database, one unit at a time.

    Creating rows is deliberately NOT this script's job — the boot loader does
    that, and a second creator with different rules is how two writers start
    disagreeing about the same table.
    """
    plan = Plan()

    for unit in want:
        code = unit["code"]
        current = have.get(code)
        if current is None:
            plan.absent.append(code)
            continue

        changes: dict[str, Any] = {}
        for name in INVENTORY_FIELDS:
            if name not in unit:
                continue
            new, old = _norm(unit.get(name)), _norm(current.get(name))
            if new != old:
                changes[name] = unit.get(name)

        # An empty has_ramp means NOT ASSESSED. Writing it over a real answer
        # would erase an assessment and make it look like one never happened.
        ramp = (unit.get("has_ramp") or "").strip()
        if ramp and ramp != (current.get("has_ramp") or ""):
            changes["has_ramp"] = ramp

        # Notes are free text someone may have written. Fill an empty one;
        # never replace a written one.
        note = (unit.get("notes") or "").strip()
        if note and not (current.get("notes") or "").strip():
            changes["notes"] = note

        structural: dict[str, Any] = {}
        for name in STRUCTURAL_FIELDS:
            if name not in unit:
                continue
            if _norm(unit.get(name)) != _norm(current.get(name)):
                structural[name] = unit.get(name)

        if include_structural:
            changes.update(structural)
            structural = {}

        if changes:
            plan.updates.append(UnitUpdate(code, changes))
        if structural:
            plan.structural.append(UnitUpdate(code, structural))

    return plan


# --------------------------------------------------------------- PocketBase


def _auth(base: str, identity: str, password: str) -> str:
    resp = requests.post(
        f"{base}/api/collections/_superusers/auth-with-password",
        json={"identity": identity, "password": password},
        timeout=30,
    )
    resp.raise_for_status()
    return str(resp.json()["token"])


def _fetch_units(base: str, token: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    page = 1
    while True:
        resp = requests.get(
            f"{base}/api/collections/lodging_units/records",
            params={"perPage": 200, "page": page},
            headers={"Authorization": token},
            timeout=60,
        )
        resp.raise_for_status()
        body = resp.json()
        for item in body["items"]:
            out[item["code"]] = item
        if page >= body["totalPages"]:
            break
        page += 1
    return out


def _patch(base: str, token: str, record_id: str, fields: dict[str, Any]) -> None:
    resp = requests.patch(
        f"{base}/api/collections/lodging_units/records/{record_id}",
        json=fields,
        headers={"Authorization": token},
        timeout=30,
    )
    resp.raise_for_status()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", default="config/lodging_registry.json")
    parser.add_argument("--url", default=os.environ.get("POCKETBASE_URL", "http://127.0.0.1:8090"))
    parser.add_argument("--identity", default=os.environ.get("PB_ADMIN_EMAIL", "admin@camp.local"))
    parser.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD", ""))
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument(
        "--structural",
        action="store_true",
        help="also apply bathroom/container/parent corrections, which OVERWRITE existing values",
    )
    args = parser.parse_args(argv)

    registry = Path(args.registry)
    if not registry.is_file():
        print(f"error: {registry} not found — the registry lives in kindred-local", file=sys.stderr)
        return 2
    units = json.loads(registry.read_text())["units"]

    if not args.password:
        print("error: set PB_ADMIN_PASSWORD (or pass --password)", file=sys.stderr)
        return 2

    token = _auth(args.url, args.identity, args.password)
    raw = _fetch_units(args.url, token)
    have = normalise_parents(raw)
    plan = plan_updates(units, have, include_structural=args.structural)

    print(f"registry: {len(units)} units    database: {len(have)} units")
    print(f"\n{len(plan.updates)} unit(s) to update:")
    for u in plan.updates:
        print(f"  {u.code:<28}{u.fields}")

    if plan.structural:
        print(f"\n{len(plan.structural)} STRUCTURAL difference(s) — NOT applied without --structural.")
        print("  These overwrite values that may have been set deliberately:")
        for u in plan.structural:
            print(f"  {u.code:<28}{u.fields}")

    if plan.absent:
        print(f"\n{len(plan.absent)} unit(s) in the file but not the database.")
        print("  The boot loader creates these; restart PocketBase rather than running this.")
        for code in plan.absent:
            print(f"  {code}")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return 0

    ids = {code: rec["id"] for code, rec in raw.items()}
    for u in plan.updates:
        fields = dict(u.fields)
        # Back the other way: a relation field takes a record id, not a code.
        if "parent_unit" in fields:
            fields["parent_unit"] = ids.get(fields["parent_unit"], "")
        _patch(args.url, token, ids[u.code], fields)
    print(f"\napplied {len(plan.updates)} update(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Carry the private lodging registry's inventory onto rows that already exist.

The boot loader (pocketbase/lodging/registry.go) is CREATE-IF-ABSENT: it creates
units it does not find and never touches ones it does. That is deliberate — the
registry is staff-editable in /manage/lodging, and a loader that rewrote every
field on boot would undo confirmations and corrected coordinates on the next
restart.

The consequence is that a new column lands EMPTY on every row that already
exists. The 2026 amenity columns are exactly that case: adding them to the
schema leaves the 93 pre-existing units with eight false-everywhere booleans, an
unset has_ramp and an unset max_beds. This script fills them in, deliberately
and once, rather than making the loader a second writer with different rules.

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
from datetime import datetime
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
    "beds",
    # Each refines a field above rather than restating it: has_tub under the
    # `bathroom` enum, has_kitchenette under has_kitchen, has_shared_fridge
    # under has_fridge. None can contradict its parent, so a consumer that reads
    # only the parent stays correct.
    "has_tub",
    "has_kitchenette",
    "has_crib",
    "has_changing_table",
    "has_shared_fridge",
)

# Real corrections, but each overwrites a value that may have been set on
# purpose, so they are reported for a human and applied only on --structural.
STRUCTURAL_FIELDS = ("bathroom", "bathroom_group", "is_container", "parent_unit")

# Fields where the file's null means UNKNOWN rather than a value to write. The
# booleans alongside them have no such state — absent means false, which is a
# real claim — so this applies only to the numbers and to `beds`.
#
# `beds` earns it the same way max_beds does: the Master Housing parser refuses
# rows that name rooms without naming beds ("3 rm 2 bth") or name a space whose
# beds are not listed ("guest room"), so an unparsed row arrives as null. That
# null is ignorance, not an empty room, and writing it would erase an inventory
# entered by hand through the admin form.
NULLABLE_FIELDS = ("max_beds", "beds")

# Never written by this script under any flag. These are the fields staff
# maintain, and overwriting them is precisely what create-if-absent exists to
# prevent.
STAFF_OWNED = ("sleeps", "map_x", "map_y", "is_confirmed", "is_active", "inventory_class")


@dataclass
class UnitUpdate:
    code: str
    fields: dict[str, Any]


@dataclass
class Plan:
    updates: list[UnitUpdate] = field(default_factory=list)
    structural: list[UnitUpdate] = field(default_factory=list)
    absent: list[str] = field(default_factory=list)
    # Rows where staff have confirmed the cabin and the file disagrees. Carried
    # with their withheld fields so the operator sees what the sheet wanted to
    # change, not merely that something was held back.
    skipped_confirmed: list[UnitUpdate] = field(default_factory=list)


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


def resolve_parent_id(fields: dict[str, Any], ids: dict[str, str]) -> dict[str, Any]:
    """Translate a parent_unit CODE back into the record id a relation needs.

    Raises rather than falling back to "": an unresolvable code would otherwise
    detach the child from its container with no error, which is the opposite of
    what every other guard here does. An EMPTY code is legitimate — it means the
    unit has no parent.

    `ids` comes from a year-filtered fetch, so a code resolves within one
    season. Without that filter this map holds N seasons and silently keeps
    whichever was fetched last.
    """
    out = dict(fields)
    code = out.get("parent_unit") or ""
    if not code:
        out["parent_unit"] = ""
        return out
    if code not in ids:
        raise KeyError(
            f"parent_unit {code!r} names no unit in the database; "
            "restart PocketBase so the boot loader creates it, or fix the registry"
        )
    out["parent_unit"] = ids[code]
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
            # max_beds carries the same null-means-unknown contract as sleeps
            # and has_ramp: PocketBase stores an unset number as 0, which every
            # consumer reads as "unknown". Writing null over a real number
            # replaces knowledge with a placeholder, silently.
            if name in NULLABLE_FIELDS and unit.get(name) is None:
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

        # STAFF_OWNED protects a fixed list of COLUMNS, and it cannot protect
        # the amenity booleans — writing those is this script's whole job. The
        # missing half is this per-ROW condition: staff own what they have
        # VERIFIED. Once someone stands in the cabin, finds the sheet wrong
        # ("no outlet in that room"), corrects it in /manage/lodging and
        # confirms, the database is more authoritative than the file and this
        # script has no way to know. A later --apply would revert it silently.
        #
        # Everything is computed first and withheld afterwards, so the report
        # can say exactly WHAT was withheld rather than just that a row was
        # skipped. A silent guard is the same bug wearing a different hat.
        #
        # `notes` is deliberately exempt: it is already fill-if-empty and never
        # replaces written text, so it cannot overwrite a human's words.
        #
        # --structural is guarded too. bathroom and bathroom_group are exactly
        # what a property walk corrects, and bathroom is the field families are
        # matched on. Being opt-in stops an ACCIDENTAL run; it does not tell the
        # operator which rows a human already ruled on. The skip is printed, so
        # a real file/database disagreement stays visible and gets fixed through
        # the admin UI — the right channel for a confirmed row.
        if current.get("is_confirmed"):
            withheld = {name: value for name, value in changes.items() if name != "notes"}
            withheld.update(structural)
            if withheld:
                plan.skipped_confirmed.append(UnitUpdate(code, withheld))
            changes = {name: value for name, value in changes.items() if name == "notes"}
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


def _fetch_units(base: str, token: str, year: int) -> dict[str, dict[str, Any]]:
    """Fetch one YEAR's units, keyed by code.

    The year filter is load-bearing, not a convenience. Keying on code alone
    across a multi-year table collapses every season into one entry with the
    last page fetched winning — which is how one year's parent id lands on
    another year's row.
    """
    out: dict[str, dict[str, Any]] = {}
    page = 1
    while True:
        params: dict[str, Any] = {"filter": f"year = {year}", "perPage": 200, "page": page}
        resp = requests.get(
            f"{base}/api/collections/lodging_units/records",
            params=params,
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
    # Compute default year: use CAMPMINDER_SEASON_ID if it's numeric, else fall back to calendar year
    season_id = os.getenv("CAMPMINDER_SEASON_ID", "")
    default_year = int(season_id) if season_id.isdigit() else datetime.now().year
    parser.add_argument(
        "--year",
        type=int,
        default=default_year,
        help="Season to apply against. Defaults to CAMPMINDER_SEASON_ID.",
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
    raw = _fetch_units(args.url, token, args.year)
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

    if plan.skipped_confirmed:
        print(f"\n{len(plan.skipped_confirmed)} CONFIRMED unit(s) left alone — staff have verified these.")
        print("  The file disagrees, but a confirmed row is the staff answer. Fix it in")
        print("  /manage/lodging if the database is the one that is wrong.")
        for u in plan.skipped_confirmed:
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
            fields = resolve_parent_id(fields, ids)
        _patch(args.url, token, ids[u.code], fields)
    print(f"\napplied {len(plan.updates)} update(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

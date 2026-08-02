#!/usr/bin/env python3
"""Diff a PocketBase database's lodging registry against the private registry file.

Used by scripts/dev/verify-lodging-seed.sh. Prints one line per difference to
stderr and exits 1 if any are found, 0 if the database reproduces the file
exactly.

This exists because the registry is private data (kindred-local), so the
verifier cannot hardcode what it expects to find without reproducing in a
public repo the strings the private file exists to keep out of it. Comparing
against the file is also stricter than the fixed counts it replaced: it catches
a dropped unit, a mangled coordinate and a short alias member set, none of
which a row count sees.

Usage: diff_lodging_registry.py <registry.json> <data.db>
"""

from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any


def _norm_num(value: object) -> float:
    """PocketBase stores an unset number as 0, never NULL, and the file uses
    null for the same thing, so both normalise to 0.0. Round because SQLite
    round-trips floats."""
    if not isinstance(value, (int, float)):
        return 0.0
    return round(float(value), 6)


def _diff_areas(doc: dict[str, Any], db: sqlite3.Connection) -> list[str]:
    diffs: list[str] = []
    want = {a["code"]: a for a in doc.get("areas", [])}
    got = {r["code"]: r for r in db.execute("SELECT code, name, map_x, map_y, sort_order FROM lodging_areas")}

    for code in sorted(set(want) - set(got)):
        diffs.append(f"area {code}: in file, missing from database")
    for code in sorted(set(got) - set(want)):
        diffs.append(f"area {code}: in database, missing from file")

    for code in sorted(set(want) & set(got)):
        w, g = want[code], got[code]
        if w["name"] != g["name"]:
            diffs.append(f"area {code}.name: file={w['name']!r} db={g['name']!r}")
        for field in ("map_x", "map_y", "sort_order"):
            if _norm_num(w.get(field)) != _norm_num(g[field]):
                diffs.append(f"area {code}.{field}: file={w.get(field)!r} db={g[field]!r}")
    return diffs


def _diff_units(doc: dict[str, Any], db: sqlite3.Connection) -> list[str]:
    diffs: list[str] = []
    want = {u["code"]: u for u in doc.get("units", [])}
    got = {
        r["code"]: r
        for r in db.execute(
            """
            SELECT u.code, u.name, a.code AS area_code, u.map_x, u.map_y, u.sleeps,
                   u.bathroom, u.bathroom_group, u.near_bathhouse, u.allocation_default,
                   u.is_container, u.notes, p.code AS parent_code,
                   u.has_power, u.has_ac, u.has_fridge, u.is_accessible, u.has_heat,
                   u.is_weatherized, u.has_plumbing, u.has_space_heater,
                   u.has_pack_play_space, u.has_living_room, u.has_kitchen, u.has_lights,
                   u.has_ramp, u.max_beds
              FROM lodging_units u
              JOIN lodging_areas a ON a.id = u.area
              LEFT JOIN lodging_units p ON p.id = u.parent_unit
            """
        )
    }

    for code in sorted(set(want) - set(got)):
        diffs.append(f"unit {code}: in file, missing from database")
    for code in sorted(set(got) - set(want)):
        diffs.append(f"unit {code}: in database, missing from file")

    for code in sorted(set(want) & set(got)):
        w, g = want[code], got[code]
        checks: list[tuple[str, object, object]] = [
            ("name", w["name"], g["name"]),
            ("area", w["area"], g["area_code"]),
            ("map_x", _norm_num(w.get("map_x")), _norm_num(g["map_x"])),
            ("map_y", _norm_num(w.get("map_y")), _norm_num(g["map_y"])),
            # 0 is UNKNOWN, which is what the file's null becomes on the way in.
            ("sleeps", _norm_num(w.get("sleeps")), _norm_num(g["sleeps"])),
            ("bathroom", w.get("bathroom") or "", g["bathroom"] or ""),
            ("bathroom_group", w.get("bathroom_group") or "", g["bathroom_group"] or ""),
            ("near_bathhouse", int(bool(w.get("near_bathhouse"))), int(g["near_bathhouse"] or 0)),
            ("allocation_default", w.get("allocation_default") or "", g["allocation_default"] or ""),
            ("is_container", int(bool(w.get("is_container"))), int(g["is_container"] or 0)),
            ("notes", w.get("notes") or "", g["notes"] or ""),
            ("parent_unit", w.get("parent_unit") or "", g["parent_code"] or ""),
            # has_ramp is a select whose EMPTY value means "not assessed", so it
            # is compared as a string. Everything else here is a plain bool.
            ("has_ramp", w.get("has_ramp") or "", g["has_ramp"] or ""),
            ("max_beds", _norm_num(w.get("max_beds")), _norm_num(g["max_beds"])),
        ]
        for field in (
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
        ):
            checks.append((field, int(bool(w.get(field))), int(g[field] or 0)))
        for field, file_value, db_value in checks:
            if file_value != db_value:
                diffs.append(f"unit {code}.{field}: file={file_value!r} db={db_value!r}")
    return diffs


def _diff_aliases(doc: dict[str, Any], db: sqlite3.Connection) -> list[str]:
    diffs: list[str] = []
    # An unbounded window is stored as 0, never NULL, and the unique index is
    # (alias_string, valid_from_year) — so that pair is the identity here too.
    want = {(a["alias_string"], int(a.get("valid_from_year") or 0)): a for a in doc.get("aliases", [])}
    got = {
        (r["alias_string"], int(r["valid_from_year"] or 0)): r
        for r in db.execute(
            """
            SELECT al.alias_string, al.valid_from_year, al.valid_to_year,
                   (SELECT group_concat(u.code)
                      FROM json_each(al.member_units) je
                      JOIN lodging_units u ON u.id = je.value) AS members
              FROM lodging_unit_aliases al
            """
        )
    }

    for key in sorted(set(want) - set(got)):
        diffs.append(f"alias {key}: in file, missing from database")
    for key in sorted(set(got) - set(want)):
        diffs.append(f"alias {key}: in database, missing from file")

    for key in sorted(set(want) & set(got)):
        w, g = want[key], got[key]
        if _norm_num(w.get("valid_to_year")) != _norm_num(g["valid_to_year"]):
            diffs.append(f"alias {key}.valid_to_year: file={w.get('valid_to_year')!r} db={g['valid_to_year']!r}")
        # json_each preserves the stored order, and member order is meaningful
        # only in that a merge must contain exactly the right rooms.
        want_members = sorted(w.get("member_units") or [])
        db_members = sorted((g["members"] or "").split(",")) if g["members"] else []
        if want_members != db_members:
            diffs.append(f"alias {key}.member_units: file={want_members} db={db_members}")
    return diffs


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} <registry.json> <data.db>", file=sys.stderr)
        return 2

    registry_path, db_path = argv[1], argv[2]
    with open(registry_path, encoding="utf-8") as handle:
        doc = json.load(handle)

    # Read-only: this runs against a throwaway database the harness has already
    # stopped, but opening it read-write would create a -wal beside it.
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        diffs = _diff_areas(doc, db) + _diff_units(doc, db) + _diff_aliases(doc, db)
    finally:
        db.close()

    if diffs:
        print(f"{len(diffs)} difference(s) between {registry_path} and the database:", file=sys.stderr)
        for diff in diffs:
            print(f"  {diff}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
"""Deterministic subset picker for the synthetic seed (issue #1623).

Reads the real DB and chooses a tiny, referentially-closed subset that satisfies
the requires_pb_db retention suites:

- For each year in TARGET_YEARS, pick SESSIONS_PER_YEAR summer sessions
  (session_type in SUMMER_SESSION_TYPES), lowest cm_id first (deterministic).
- For each year, pick up to PERSONS_PER_YEAR enrolled (status_id=2) campers in
  those sessions whose person has non-null gender + grade, lowest person_id first.
  Returners (stable low cm_ids) recur across years -> natural cross-year overlap
  for non-trivial retention transitions.
- Carry the transitive closure: the persons' households.

LOCAL ONLY: this reads the real DB; it never runs in CI. The builder uses the
returned id sets to prune a scratch copy.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

TARGET_YEARS: tuple[int, ...] = (2023, 2024, 2025, 2026)
SUMMER_SESSION_TYPES: tuple[str, ...] = ("main", "embedded", "ag")
SESSIONS_PER_YEAR = 2
PERSONS_PER_YEAR = 25


@dataclass
class Subset:
    session_pbids: set[str] = field(default_factory=set)
    person_pbids: set[str] = field(default_factory=set)
    person_cmids: set[int] = field(default_factory=set)
    household_cmids: set[int] = field(default_factory=set)


def _select_sessions(conn: sqlite3.Connection) -> set[str]:
    placeholders_t = ",".join("?" * len(SUMMER_SESSION_TYPES))
    placeholders_y = ",".join("?" * len(TARGET_YEARS))
    rows = conn.execute(
        f"SELECT id, year FROM camp_sessions "
        f"WHERE session_type IN ({placeholders_t}) AND year IN ({placeholders_y}) "
        f"ORDER BY year, cm_id",
        (*SUMMER_SESSION_TYPES, *TARGET_YEARS),
    ).fetchall()
    per_year: dict[int, int] = {}
    chosen: set[str] = set()
    for pbid, year in rows:
        if per_year.get(year, 0) >= SESSIONS_PER_YEAR:
            continue
        chosen.add(pbid)
        per_year[year] = per_year.get(year, 0) + 1
    return chosen


def select_subset(conn: sqlite3.Connection) -> Subset:
    subset = Subset()
    subset.session_pbids = _select_sessions(conn)
    if not subset.session_pbids:
        return subset

    placeholders_s = ",".join("?" * len(subset.session_pbids))
    rows = conn.execute(
        f"""
        SELECT cs.year, a.person, a.person_id, p.household_id
        FROM attendees a
        JOIN camp_sessions cs ON a.session = cs.id
        JOIN persons p ON a.person = p.id
        WHERE a.status_id = 2
          AND a.session IN ({placeholders_s})
          AND p.gender IS NOT NULL AND p.gender != ''
          AND p.grade IS NOT NULL
        ORDER BY cs.year, a.person_id, a.person
        """,
        tuple(subset.session_pbids),
    ).fetchall()

    per_year: dict[int, int] = {}
    for year, person_pb, person_cm, household_cm in rows:
        if per_year.get(year, 0) >= PERSONS_PER_YEAR:
            continue
        subset.person_pbids.add(person_pb)
        if person_cm is not None:
            subset.person_cmids.add(person_cm)
        if household_cm is not None:
            subset.household_cmids.add(household_cm)
        per_year[year] = per_year.get(year, 0) + 1

    return subset

"""Tests for scripts/setup/synthetic/select_subset.py — deterministic subset picker.

The selector reads the real DB and picks a tiny, referentially-closed subset that
satisfies the requires_pb_db retention tests: summer sessions in years 2023-2026,
enrolled (status_id=2) campers with non-null gender+grade, plus their households.

Tested here against a fabricated tiny "real" DB (no actual real data).
"""

import importlib
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def sel():
    return importlib.import_module("scripts.setup.synthetic.select_subset")


def _make_real_like_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("CREATE TABLE camp_sessions (id TEXT PRIMARY KEY, cm_id INT, year INT, session_type TEXT)")
    c.execute(
        "CREATE TABLE persons (id TEXT PRIMARY KEY, cm_id INT, household_id INT, gender TEXT, grade INT, year INT)"
    )
    c.execute(
        "CREATE TABLE attendees (id TEXT PRIMARY KEY, person TEXT, person_id INT, session TEXT, status_id INT, year INT)"
    )
    c.execute("CREATE TABLE households (id TEXT PRIMARY KEY, cm_id INT)")

    # Sessions: summer ones in each target year, a winter one, and an out-of-range year.
    sessions = [
        ("s23a", 2301, 2023, "main"),
        ("s23b", 2302, 2023, "embedded"),
        ("s23c", 2303, 2023, "ag"),
        ("s24a", 2401, 2024, "main"),
        ("s24b", 2402, 2024, "main"),
        ("s25a", 2501, 2025, "ag"),
        ("s25b", 2502, 2025, "main"),
        ("s26a", 2601, 2026, "embedded"),
        ("s26b", 2602, 2026, "main"),
        ("swin", 9901, 2024, "family"),  # non-summer -> excluded
        ("sold", 1701, 2017, "main"),  # out-of-range year -> excluded
    ]
    c.executemany("INSERT INTO camp_sessions VALUES (?,?,?,?)", sessions)

    # Persons: most valid; one missing gender, one missing grade.
    persons = []
    attendees = []
    households = [("h1", 9001), ("h2", 9002)]
    pid = 0
    for yr, sess in [(2023, "s23a"), (2024, "s24a"), (2025, "s25a"), (2026, "s26a")]:
        for i in range(40):
            pid += 1
            cm = 100000 + pid
            persons.append((f"p{pid}", cm, 9001 if i % 2 else 9002, "M" if i % 2 else "F", 5 + (i % 4), yr))
            attendees.append((f"a{pid}", f"p{pid}", cm, sess, 2, yr))
    # An enrolled person with no gender (excluded), and a not-enrolled person (excluded).
    persons.append(("pNoGender", 200001, 9001, "", 6, 2024))
    attendees.append(("aNoGender", "pNoGender", 200001, "s24a", 2, 2024))
    persons.append(("pNotEnrolled", 200002, 9001, "F", 7, 2024))
    attendees.append(("aNotEnrolled", "pNotEnrolled", 200002, "s24a", 5, 2024))  # status_id != 2

    c.executemany("INSERT INTO persons VALUES (?,?,?,?,?,?)", persons)
    c.executemany("INSERT INTO attendees VALUES (?,?,?,?,?,?)", attendees)
    c.executemany("INSERT INTO households VALUES (?,?)", households)
    conn.commit()
    conn.close()


def test_selects_only_summer_target_year_sessions(sel, tmp_path):
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    subset = sel.select_subset(conn)

    rows = conn.execute(
        f"SELECT year, session_type FROM camp_sessions WHERE id IN ({','.join('?' * len(subset.session_pbids))})",
        tuple(subset.session_pbids),
    ).fetchall()
    conn.close()
    assert rows, "should select at least one session"
    for year, stype in rows:
        assert year in sel.TARGET_YEARS
        assert stype in sel.SUMMER_SESSION_TYPES


def test_caps_sessions_per_year(sel, tmp_path):
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    subset = sel.select_subset(conn)
    counts: dict[int, int] = {}
    for (year,) in conn.execute(
        f"SELECT year FROM camp_sessions WHERE id IN ({','.join('?' * len(subset.session_pbids))})",
        tuple(subset.session_pbids),
    ):
        counts[year] = counts.get(year, 0) + 1
    conn.close()
    for year, n in counts.items():
        assert n <= sel.SESSIONS_PER_YEAR, f"year {year} has {n} sessions"


def test_excludes_persons_without_gender_or_not_enrolled(sel, tmp_path):
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    subset = sel.select_subset(conn)
    conn.close()
    assert 200001 not in subset.person_cmids  # missing gender
    assert 200002 not in subset.person_cmids  # not enrolled (status_id != 2)


def test_referential_closure(sel, tmp_path):
    """Every selected person must have an enrolled attendee into a selected session,
    and every selected person's household must be in the household set."""
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    subset = sel.select_subset(conn)

    # person closure: each person pbid resolves to a person whose attendee -> selected session
    for ppb in subset.person_pbids:
        row = conn.execute(
            "SELECT a.session FROM attendees a WHERE a.person = ? AND a.status_id = 2", (ppb,)
        ).fetchone()
        assert row is not None
        assert row[0] in subset.session_pbids

    # household closure
    for ppb in subset.person_pbids:
        (hh,) = conn.execute("SELECT household_id FROM persons WHERE id = ?", (ppb,)).fetchone()
        if hh is not None:
            assert hh in subset.household_cmids
    conn.close()


def test_each_target_year_represented(sel, tmp_path):
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    subset = sel.select_subset(conn)
    years = {
        row[0]
        for row in conn.execute(
            f"SELECT DISTINCT year FROM camp_sessions WHERE id IN ({','.join('?' * len(subset.session_pbids))})",
            tuple(subset.session_pbids),
        )
    }
    conn.close()
    assert set(sel.TARGET_YEARS) <= years, f"every target year must be present, got {years}"


def test_deterministic(sel, tmp_path):
    db = tmp_path / "real.db"
    _make_real_like_db(db)
    conn = sqlite3.connect(db)
    a = sel.select_subset(conn)
    b = sel.select_subset(conn)
    conn.close()
    assert a.session_pbids == b.session_pbids
    assert a.person_pbids == b.person_pbids
    assert a.household_cmids == b.household_cmids

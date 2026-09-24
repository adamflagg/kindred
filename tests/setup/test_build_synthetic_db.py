"""Tests for scripts/setup/synthetic/build_synthetic_db.py.

The builder is LOCAL ONLY (it reads the real DB), so most of these tests cover the
pure, importable helpers only — chiefly that the camp scrub/gate tokens are derived
from the gitignored branding config and that a missing/empty config fails LOUDLY
rather than silently scrubbing nothing (issue #1623, leak-gate hardening).

The lodging-table tests (issue #2792) cover discovery-by-prefix and the
DROP_LIST_TABLES exclusion as pure-helper tests; ``test_build_empties_all_lodging_tables_by_prefix``
additionally drives the real ``build()`` pipeline end to end against a small,
self-contained fixture DB written to ``tmp_path`` — never the real dev DB and never
the committed artifact — because the defect it guards against is in the pipeline's
orchestration (does the emptying step actually run, in the right place, for every
``lodging_*`` table), not in a single pure helper.

A fictional camp name ("Camp Wildwood" / "Wildwood") stands in for the real brand.
"""

import gzip
import importlib
import json
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def build_mod():
    return importlib.import_module("scripts.setup.synthetic.build_synthetic_db")


@pytest.fixture
def scan_leaks_mod():
    return importlib.import_module("scripts.setup.synthetic.scan_leaks")


def _write_branding(path: Path, data: dict[str, str]) -> Path:
    path.write_text(json.dumps(data))
    return path


def test_camp_scrub_config_derives_from_branding(build_mod, tmp_path):
    branding = _write_branding(
        tmp_path / "branding.local.json",
        {"camp_name": "Camp Wildwood", "camp_name_short": "Wildwood"},
    )
    replacements, gate_tokens = build_mod._camp_scrub_config(branding)
    # longest-first so "Camp Wildwood" scrubs before its substring "Wildwood"
    assert replacements[0][0] == "Camp Wildwood"
    assert dict(replacements) == {"Camp Wildwood": "Camp Kindred", "Wildwood": "Kindred"}
    assert set(gate_tokens) == {"Camp Wildwood", "Wildwood"}
    # the real brand is never hardcoded into the (public) builder module
    assert "Tawonga" not in Path(build_mod.__file__).read_text()


def test_camp_scrub_config_missing_branding_fails_loud(build_mod, tmp_path):
    with pytest.raises(FileNotFoundError):
        build_mod._camp_scrub_config(tmp_path / "does_not_exist.json")


def test_camp_scrub_config_empty_tokens_fails_loud(build_mod, tmp_path):
    branding = _write_branding(tmp_path / "branding.local.json", {"unrelated": "value"})
    with pytest.raises(ValueError):
        build_mod._camp_scrub_config(branding)


# ---------------------------------------------------------------------------
# lodging_* table handling (issue #2792)
# ---------------------------------------------------------------------------

# A table name that exists nowhere in the codebase's lodging_* list — stands in for
# a future lodging table added after this fix, which discovery-by-prefix must still
# catch without anyone updating a hardcoded list.
_INVENTED_LODGING_TABLE = "lodging_totally_new_for_test"


def test_lodging_tables_discovered_by_prefix(build_mod, tmp_path):
    """``_lodging_tables`` finds every lodging_* table by name prefix alone,
    including one that no code anywhere lists (a stand-in for a future table),
    and never a non-lodging table."""
    db = tmp_path / "scratch.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE lodging_units (id TEXT PRIMARY KEY, name TEXT)")
    conn.execute("CREATE TABLE lodging_write_ins (id TEXT PRIMARY KEY, note TEXT)")
    conn.execute(f"CREATE TABLE {_INVENTED_LODGING_TABLE} (id TEXT PRIMARY KEY, value TEXT)")
    conn.execute("CREATE TABLE persons (id TEXT PRIMARY KEY, first_name TEXT)")
    conn.execute("CREATE TABLE config (id TEXT PRIMARY KEY, key TEXT)")
    conn.commit()

    found = set(build_mod._lodging_tables(conn))
    conn.close()

    assert found == {"lodging_units", "lodging_write_ins", _INVENTED_LODGING_TABLE}


def test_drop_list_tables_excludes_lodging(scan_leaks_mod):
    """The lodging_* tables must stay OFF scan_leaks.DROP_LIST_TABLES — the builder
    empties them directly, and listing them here would gate the leak scan on zero
    rows even once #2773 starts fabricating fictional lodging rows on purpose."""
    lodging_in_drop_list = [t for t in scan_leaks_mod.DROP_LIST_TABLES if t.startswith("lodging_")]
    assert lodging_in_drop_list == []


def _make_lodging_fixture_db(path: Path) -> None:
    """A tiny, self-contained 'real DB' stand-in with just enough schema for
    build() to run end to end: one session, >=1000 persons/households/attendees
    (the builder refuses anything smaller), and several lodging_* tables with
    rows — including one this test invented that no code list mentions."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    cur.execute(
        "CREATE TABLE camp_sessions (id TEXT PRIMARY KEY, cm_id INTEGER, year INTEGER, session_type TEXT, name TEXT)"
    )
    cur.execute(
        "CREATE TABLE persons (id TEXT PRIMARY KEY, cm_id INTEGER, first_name TEXT, "
        "last_name TEXT, gender TEXT, grade INTEGER, household_id INTEGER)"
    )
    cur.execute("CREATE TABLE households (id TEXT PRIMARY KEY, cm_id INTEGER, greeting TEXT)")
    cur.execute(
        "CREATE TABLE attendees (id TEXT PRIMARY KEY, session TEXT, person TEXT, person_id INTEGER, status_id INTEGER)"
    )

    cur.execute("INSERT INTO camp_sessions VALUES ('s1', 1, 2025, 'main', 'Session Alpha')")
    for i in range(1000):
        pid, hid = f"p{i}", f"h{i}"
        cur.execute(
            "INSERT INTO persons VALUES (?, ?, 'Emma', 'Johnson', 'F', 3, ?)",
            (pid, i, i),
        )
        cur.execute("INSERT INTO households VALUES (?, ?, 'The Johnson Family')", (hid, i))
        cur.execute("INSERT INTO attendees VALUES (?, 's1', ?, ?, 2)", (f"a{i}", pid, i))

    # lodging_* tables with rows: two the codebase already knows about, plus one
    # invented only for this test.
    cur.execute("CREATE TABLE lodging_units (id TEXT PRIMARY KEY, name TEXT)")
    cur.execute("INSERT INTO lodging_units VALUES ('u1', 'a real cabin name')")
    cur.execute("CREATE TABLE lodging_write_ins (id TEXT PRIMARY KEY, note TEXT)")
    cur.execute("INSERT INTO lodging_write_ins VALUES ('w1', 'a real staff write-in')")
    cur.execute(f"CREATE TABLE {_INVENTED_LODGING_TABLE} (id TEXT PRIMARY KEY, value TEXT)")
    cur.execute(f"INSERT INTO {_INVENTED_LODGING_TABLE} VALUES ('x1', 'should never survive')")

    # a table the builder already handles (DROP_LIST_TABLES) — proves this fix
    # doesn't disturb the existing emptying behavior.
    cur.execute("CREATE TABLE financial_transactions (id TEXT PRIMARY KEY, amount NUMERIC)")
    cur.execute("INSERT INTO financial_transactions VALUES ('f1', 42)")

    conn.commit()
    conn.close()


def _read_gzipped_sqlite(gz_path: Path, dest: Path) -> sqlite3.Connection:
    with gzip.open(gz_path, "rb") as fin, open(dest, "wb") as fout:
        fout.write(fin.read())
    return sqlite3.connect(dest)


def test_build_empties_all_lodging_tables_by_prefix(build_mod, tmp_path):
    """The acceptance test for #2792: a builder run against a DB with rows in
    several lodging_* tables — including one added only for this test — produces
    an artifact with zero rows in every lodging_* table, while a table the builder
    already handles (financial_transactions, on DROP_LIST_TABLES) is still emptied
    and real data still flows through the rest of the pipeline (some persons
    survive pruning)."""
    real_db = tmp_path / "fake_real_data.db"
    _make_lodging_fixture_db(real_db)

    branding = _write_branding(
        tmp_path / "branding.local.json",
        {"camp_name": "Camp Wildwood", "camp_name_short": "Wildwood"},
    )
    out = tmp_path / "out" / "data.db.gz"

    rc = build_mod.build(real_db, out, branding)
    assert rc == 0, "build() should succeed against a well-formed fixture DB"

    scratch = tmp_path / "artifact.db"
    conn = _read_gzipped_sqlite(out, scratch)
    try:
        lodging_tables = build_mod._lodging_tables(conn)
        assert lodging_tables, "fixture must actually contain lodging_* tables for this test to mean anything"
        assert _INVENTED_LODGING_TABLE in lodging_tables

        for table in lodging_tables:
            (n,) = conn.execute(f"SELECT count(*) FROM [{table}]").fetchone()
            assert n == 0, f"{table} should be emptied by the builder but has {n} row(s)"

        # already-handled table: still emptied, unaffected by this change
        (n_financial,) = conn.execute("SELECT count(*) FROM financial_transactions").fetchone()
        assert n_financial == 0

        # sanity: the pipeline still does real work, not just a wholesale wipe
        (n_persons,) = conn.execute("SELECT count(*) FROM persons").fetchone()
        assert n_persons > 0
    finally:
        conn.close()

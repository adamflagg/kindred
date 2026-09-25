"""Tests for scripts/setup/synthetic/scan_leaks.py — the PII leak-proof gate.

The scanner is the crux of issue #1623: it must PROVE no real value survived into
the committed synthetic artifact. These tests plant deliberate leaks into a tiny
SQLite DB and assert the scanner flags each one, and that a clean DB passes.

No real DB and no running server — pure mockable unit tests (run in CI + pre-push).
"""

import importlib
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def scan_module():
    return importlib.import_module("scripts.setup.synthetic.scan_leaks")


def _make_db(path: Path, *, persons_rows: list[tuple[object, ...]], financial_rows: list[tuple[object, ...]]) -> None:
    """Build a minimal artifact-shaped SQLite DB."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute(
        "CREATE TABLE persons (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, "
        "primary_email TEXT, household_phone TEXT)"
    )
    cur.execute("CREATE TABLE financial_transactions (id TEXT PRIMARY KEY, amount NUMERIC)")
    cur.executemany(
        "INSERT INTO persons (id, first_name, last_name, primary_email, household_phone) VALUES (?, ?, ?, ?, ?)",
        persons_rows,
    )
    cur.executemany("INSERT INTO financial_transactions (id, amount) VALUES (?, ?)", financial_rows)
    conn.commit()
    conn.close()


# A fictional but distinctive "real" value used as a planted leak. NOT a real person.
PLANTED_REAL_NAME = "Zephyrina Quackenbush"


def test_flags_planted_real_name(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Zephyrina", "Quackenbush", "z.q@example.com", "555-0101")],
        financial_rows=[],
    )
    violations = scan_module.scan(str(db), denylist=[PLANTED_REAL_NAME], drop_list=["financial_transactions"])
    cats = {v.category for v in violations}
    assert "real_value_leak" in cats, f"expected a real_value_leak violation, got {violations}"


def test_flags_non_example_email_domain(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Emma", "Johnson", "emma.johnson@gmail.com", "555-0101")],
        financial_rows=[],
    )
    violations = scan_module.scan(str(db), denylist=[], drop_list=["financial_transactions"])
    cats = {v.category for v in violations}
    assert "bad_email_domain" in cats, f"expected bad_email_domain, got {violations}"


def test_flags_bad_phone_band(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Emma", "Johnson", "emma.johnson@example.com", "415-555-9999")],
        financial_rows=[],
    )
    violations = scan_module.scan(str(db), denylist=[], drop_list=["financial_transactions"])
    cats = {v.category for v in violations}
    assert "bad_phone" in cats, f"expected bad_phone, got {violations}"


def test_flags_nonempty_drop_list_table(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Emma", "Johnson", "emma.johnson@example.com", "555-0101")],
        financial_rows=[("f1", 1234.56)],
    )
    violations = scan_module.scan(str(db), denylist=[], drop_list=["financial_transactions"])
    cats = {v.category for v in violations}
    assert "nonempty_drop_table" in cats, f"expected nonempty_drop_table, got {violations}"
    assert any(v.table == "financial_transactions" for v in violations)


def test_clean_db_has_no_violations(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Emma", "Johnson", "emma.johnson@example.com", "555-0102")],
        financial_rows=[],
    )
    violations = scan_module.scan(str(db), denylist=[PLANTED_REAL_NAME], drop_list=["financial_transactions"])
    assert violations == [], f"clean DB should pass, got {violations}"


def _make_db_with_system_tables(path: Path, *, superusers_rows: list[tuple[object, ...]], params_value: str) -> None:
    """Build an artifact-shaped DB that also carries PB ``_``-prefixed system tables."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("CREATE TABLE persons (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT)")
    cur.execute("INSERT INTO persons VALUES ('p1', 'Emma', 'Johnson')")
    cur.execute("CREATE TABLE _superusers (id TEXT PRIMARY KEY, email TEXT)")
    cur.executemany("INSERT INTO _superusers (id, email) VALUES (?, ?)", superusers_rows)
    cur.execute("CREATE TABLE _params (id TEXT PRIMARY KEY, value TEXT)")
    cur.execute("INSERT INTO _params (id, value) VALUES ('p', ?)", (params_value,))
    conn.commit()
    conn.close()


def test_flags_nonempty_auth_system_table(tmp_path, scan_module):
    """A regression that leaves real superusers (emails/creds) in the artifact must
    be caught — even though _data_tables() skips _-prefixed tables."""
    db = tmp_path / "artifact.db"
    _make_db_with_system_tables(
        db,
        superusers_rows=[("s1", "admin@example.com")],
        params_value='{"meta": {"appName": "Kindred"}}',
    )
    violations = scan_module.scan(str(db), denylist=None, drop_list=[])
    cats = {v.category for v in violations}
    assert "nonempty_system_table" in cats, f"expected nonempty_system_table, got {violations}"
    assert any(v.table == "_superusers" for v in violations)


def test_flags_real_email_domain_in_params(tmp_path, scan_module):
    """_params carries the SMTP sender / app URL; a non-example.com email domain there
    is a leak the data-table scan would never see (system tables are excluded)."""
    db = tmp_path / "artifact.db"
    _make_db_with_system_tables(
        db,
        superusers_rows=[],
        params_value='{"meta": {"senderAddress": "office@realcamp.org"}}',
    )
    violations = scan_module.scan(str(db), denylist=None, drop_list=[])
    cats = {v.category for v in violations}
    assert "bad_email_domain" in cats, f"expected bad_email_domain in _params, got {violations}"
    assert any(v.table == "_params" for v in violations)


def test_flags_camp_token_in_params(tmp_path, scan_module):
    """A camp brand token surviving in _params settings is flagged when camp_tokens given."""
    db = tmp_path / "artifact.db"
    _make_db_with_system_tables(
        db,
        superusers_rows=[],
        params_value='{"meta": {"appName": "Wildwood"}}',
    )
    violations = scan_module.scan(str(db), denylist=None, drop_list=[], camp_tokens=["Wildwood"])
    cats = {v.category for v in violations}
    assert "camp_token" in cats, f"expected camp_token in _params, got {violations}"
    assert any(v.table == "_params" for v in violations)


def test_clean_system_tables_pass(tmp_path, scan_module):
    """Empty auth tables + a scrubbed _params (example.com sender, no camp token) pass."""
    db = tmp_path / "artifact.db"
    _make_db_with_system_tables(
        db,
        superusers_rows=[],
        params_value='{"meta": {"appName": "Kindred", "senderAddress": "support@example.com"}}',
    )
    violations = scan_module.scan(str(db), denylist=None, drop_list=[], camp_tokens=["Wildwood"])
    assert violations == [], f"clean system tables should pass, got {violations}"


def test_artifact_only_skips_denylist(tmp_path, scan_module):
    """--artifact-only mode (CI/pre-commit) has no real DB, so the denylist is empty;
    it must still catch shape + drop-list leaks but never crash on a missing denylist."""
    db = tmp_path / "artifact.db"
    _make_db(
        db,
        persons_rows=[("p1", "Zephyrina", "Quackenbush", "z.q@example.com", "555-0101")],
        financial_rows=[("f1", 99.0)],
    )
    # No denylist passed (artifact-only); the planted name is NOT flagged, but the
    # non-empty drop table still is.
    violations = scan_module.scan(str(db), denylist=None, drop_list=["financial_transactions"])
    cats = {v.category for v in violations}
    assert "real_value_leak" not in cats
    assert "nonempty_drop_table" in cats


# ---------------------------------------------------------------------------
# Jotform tables (kindred#2759, PR B of the adult-weekend Jotform plan)
# ---------------------------------------------------------------------------


def _make_db_with_jotform_tables(path: Path, *, rows: dict[str, list[tuple[object, ...]]]) -> None:
    """Build an artifact-shaped DB with the three Jotform tables. Answers can carry
    free-text names/medical/emergency-contact content synced with no PHI gate
    (kindred#2759's owner ruling), so a surviving row is a real PII leak."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("CREATE TABLE jotform_forms (id TEXT PRIMARY KEY, form_id TEXT)")
    cur.execute("CREATE TABLE jotform_submissions (id TEXT PRIMARY KEY, submission_id TEXT)")
    cur.execute("CREATE TABLE jotform_answers (id TEXT PRIMARY KEY, answer_text TEXT)")
    cur.executemany("INSERT INTO jotform_forms (id, form_id) VALUES (?, ?)", rows.get("jotform_forms", []))
    cur.executemany(
        "INSERT INTO jotform_submissions (id, submission_id) VALUES (?, ?)", rows.get("jotform_submissions", [])
    )
    cur.executemany("INSERT INTO jotform_answers (id, answer_text) VALUES (?, ?)", rows.get("jotform_answers", []))
    conn.commit()
    conn.close()


def test_flags_nonempty_jotform_tables_via_default_drop_list(tmp_path, scan_module):
    """kindred#2759: jotform_forms/jotform_submissions/jotform_answers must be on the
    module's REAL default DROP_LIST_TABLES. Unlike the other tests in this file, this
    one deliberately does NOT override ``drop_list`` -- it fails until the three
    tables are actually added to the default tuple, which is the point: the synthetic
    builder only calls ``scan_leaks.DROP_LIST_TABLES`` (the default), so an override
    here would prove nothing about the real committed-artifact gate."""
    db = tmp_path / "artifact.db"
    _make_db_with_jotform_tables(
        db,
        rows={
            "jotform_forms": [("f1", "12345")],
            "jotform_submissions": [("s1", "67890")],
            "jotform_answers": [("a1", "Emma Johnson")],
        },
    )
    violations = scan_module.scan(str(db), denylist=None)
    cats_by_table = {v.table: v.category for v in violations}
    for table in ("jotform_forms", "jotform_submissions", "jotform_answers"):
        assert cats_by_table.get(table) == "nonempty_drop_table", (
            f"expected {table} on the default DROP_LIST_TABLES, got {violations}"
        )


def test_clean_jotform_tables_pass(tmp_path, scan_module):
    """Empty Jotform tables (the normal committed-artifact state) must not trip the
    check, using the module's real defaults (no overrides)."""
    db = tmp_path / "artifact.db"
    _make_db_with_jotform_tables(db, rows={})
    violations = scan_module.scan(str(db), denylist=None)
    assert violations == [], f"clean jotform tables should pass, got {violations}"


def _make_db_with_lodging_table(path: Path, *, table_name: str, rows: list[tuple[object, ...]]) -> None:
    """Build an artifact-shaped DB with a ``lodging_*`` table. ``table_name`` may be a
    name invented only for the test — the check must be prefix-based, not a fixed list."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("CREATE TABLE persons (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT)")
    cur.execute("INSERT INTO persons VALUES ('p1', 'Emma', 'Johnson')")
    cur.execute(f"CREATE TABLE {table_name} (id TEXT PRIMARY KEY, note TEXT)")
    cur.executemany(f"INSERT INTO {table_name} (id, note) VALUES (?, ?)", rows)
    conn.commit()
    conn.close()


def test_flags_nonempty_lodging_table_by_prefix(tmp_path, scan_module):
    """Issue #2802: any ``lodging_*`` table holding a row must fail --artifact-only
    (denylist=None, empty drop_list) — even a table name that exists nowhere else in
    the codebase, proving the check matches by name prefix, not a fixed table list."""
    db = tmp_path / "artifact.db"
    _make_db_with_lodging_table(
        db,
        table_name="lodging_totally_invented_test_table",
        rows=[("l1", "cabin note")],
    )
    violations = scan_module.scan(str(db), denylist=None, drop_list=[])
    cats = {v.category for v in violations}
    assert "nonempty_lodging_table" in cats, f"expected nonempty_lodging_table, got {violations}"
    assert any(v.table == "lodging_totally_invented_test_table" for v in violations)


def test_clean_lodging_table_passes(tmp_path, scan_module):
    """An empty lodging_* table (e.g. the real lodging_units) must not trip the check.
    Uses the module's real DROP_LIST_TABLES/MUST_BE_EMPTY_SYSTEM defaults (no overrides)
    to also confirm the check is denylist- and drop-list-independent in the passing case."""
    db = tmp_path / "artifact.db"
    _make_db_with_lodging_table(
        db,
        table_name="lodging_units",
        rows=[],
    )
    violations = scan_module.scan(str(db))
    assert violations == [], f"clean lodging table should pass, got {violations}"


def _make_db_with_aid_table(path: Path, *, table_name: str, rows: list[tuple[object, ...]]) -> None:
    """An artifact-shaped DB with one ``aid_*`` table. ``table_name`` may be
    invented: the check must match by prefix, not a fixed list."""
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("CREATE TABLE persons (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT)")
    cur.execute("INSERT INTO persons VALUES ('p1', 'Emma', 'Johnson')")
    cur.execute(f"CREATE TABLE {table_name} (id TEXT PRIMARY KEY, note TEXT)")
    cur.executemany(f"INSERT INTO {table_name} (id, note) VALUES (?, ?)", rows)
    conn.commit()
    conn.close()


def test_flags_nonempty_aid_table_by_prefix(tmp_path, scan_module):
    """Campership SP2: any ``aid_*`` row in the artifact is a leak of family
    financial data. --artifact-only mode (no denylist, empty drop list) must
    still catch it, for a table name no code lists."""
    db = tmp_path / "artifact.db"
    _make_db_with_aid_table(db, table_name="aid_totally_invented_test_table", rows=[("a1", "award note")])
    violations = scan_module.scan(str(db), denylist=None, drop_list=[])
    cats = {v.category for v in violations}
    assert "nonempty_aid_table" in cats, f"expected nonempty_aid_table, got {violations}"
    assert any(v.table == "aid_totally_invented_test_table" for v in violations)


def test_clean_aid_table_passes(tmp_path, scan_module):
    db = tmp_path / "artifact.db"
    _make_db_with_aid_table(db, table_name="aid_change_log", rows=[])
    violations = scan_module.scan(str(db))
    assert violations == [], f"an empty aid table should pass, got {violations}"

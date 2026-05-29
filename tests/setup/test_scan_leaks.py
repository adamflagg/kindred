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

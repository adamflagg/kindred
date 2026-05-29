"""Tests for scripts/setup/synthetic/debrand.py — generic relabeling + token scrub.

De-branding strips camp-identifying language from the surviving subset:
- session/bunk/division/group/staff names -> generic ("Session N", "Cabin N", ...).
- a final token scrub replaces any residual brand token across ALL text columns.
"""

import importlib
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def debrand():
    return importlib.import_module("scripts.setup.synthetic.debrand")


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("CREATE TABLE camp_sessions (id TEXT PRIMARY KEY, name TEXT, description TEXT)")
    c.execute("CREATE TABLE bunks (id TEXT PRIMARY KEY, name TEXT)")
    c.execute("CREATE TABLE divisions (id TEXT PRIMARY KEY, name TEXT)")
    c.execute("CREATE TABLE config (id TEXT PRIMARY KEY, config_key TEXT, value TEXT)")
    c.execute("INSERT INTO camp_sessions VALUES ('s1', 'Tawonga Mountain Quest', 'Best of Camp Tawonga')")
    c.execute("INSERT INTO camp_sessions VALUES ('s2', 'Sierra Session', '')")
    c.execute("INSERT INTO bunks VALUES ('b1', 'Eagle Tawonga')")
    c.execute("INSERT INTO divisions VALUES ('d1', 'Tawonga Juniors')")
    c.execute("INSERT INTO config VALUES ('c1', 'welcome_text', 'Welcome to Camp Tawonga!')")
    conn.commit()
    conn.close()


def test_relabel_makes_names_generic(debrand, tmp_path):
    db = tmp_path / "x.db"
    _make_db(db)
    debrand.relabel_db(str(db))
    conn = sqlite3.connect(db)
    names = [r[0] for r in conn.execute("SELECT name FROM camp_sessions ORDER BY id")]
    bunk = conn.execute("SELECT name FROM bunks").fetchone()[0]
    div = conn.execute("SELECT name FROM divisions").fetchone()[0]
    conn.close()
    assert all("Tawonga" not in n for n in names), names
    assert names[0].startswith("Session")
    assert bunk.startswith("Cabin")
    assert div.startswith("Division")


def test_scrub_token_replaces_brand_everywhere(debrand, tmp_path):
    db = tmp_path / "x.db"
    _make_db(db)
    # longest-first so "Camp Tawonga" -> "Camp Kindred" before "Tawonga" -> "Kindred"
    debrand.scrub_tokens(str(db), [("Camp Tawonga", "Camp Kindred"), ("Tawonga", "Kindred")])
    conn = sqlite3.connect(db)
    val = conn.execute("SELECT value FROM config WHERE config_key='welcome_text'").fetchone()[0]
    # every text cell across every table must be brand-free
    leaked = []
    for (tbl,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        for row in conn.execute(f"SELECT * FROM [{tbl}]"):
            for v in row:
                if isinstance(v, str) and "Tawonga" in v:
                    leaked.append((tbl, v))
    conn.close()
    assert val == "Welcome to Camp Kindred!"
    assert leaked == [], f"brand token leaked: {leaked}"

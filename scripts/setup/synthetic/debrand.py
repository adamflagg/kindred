#!/usr/bin/env python3
"""De-branding for the synthetic seed (issue #1623).

Two passes:
1. ``relabel_db`` — rewrite camp-identifying NAME/description columns of the kept
   lookup tables to generic labels ("Session N", "Cabin N", "Division N", ...).
2. ``scrub_tokens`` — a final belt-and-suspenders sweep that replaces any residual
   brand token across EVERY text cell of EVERY table (data + system), so a token
   embedded somewhere the relabel pass didn't cover (config values, _params, etc.)
   cannot survive. The build-time leak scan is the proof this worked.
"""

import re
import sqlite3

# table -> (name_column, generic_prefix). description columns (if present) are blanked.
_RELABEL: dict[str, tuple[str, str]] = {
    "camp_sessions": ("name", "Session"),
    "session_groups": ("name", "Group"),
    "divisions": ("name", "Division"),
    "bunks": ("name", "Cabin"),
    "bunk_plans": ("name", "Cabin"),
    "staff_positions": ("name", "Position"),
    "staff_program_areas": ("name", "Area"),
    "staff_org_categories": ("name", "Org"),
    "person_tag_defs": ("name", "Tag"),
}

_DESCRIPTION_COLUMNS = ("description",)


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info([{table}])").fetchall()}


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def relabel_db(db_path: str) -> None:
    """Rewrite camp-identifying names to generic, sequential labels (in place)."""
    conn = sqlite3.connect(db_path)
    try:
        for table, (name_col, prefix) in _RELABEL.items():
            if not _table_exists(conn, table):
                continue
            cols = _columns(conn, table)
            if name_col not in cols:
                continue
            rows = conn.execute(f"SELECT rowid FROM [{table}] ORDER BY rowid").fetchall()
            for n, (rowid,) in enumerate(rows, start=1):
                conn.execute(f"UPDATE [{table}] SET [{name_col}] = ? WHERE rowid = ?", (f"{prefix} {n}", rowid))
            for desc_col in _DESCRIPTION_COLUMNS:
                if desc_col in cols:
                    conn.execute(f"UPDATE [{table}] SET [{desc_col}] = '' WHERE [{desc_col}] != ''")
        conn.commit()
    finally:
        conn.close()


def _text_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [
        r[1]
        for r in conn.execute(f"PRAGMA table_info([{table}])").fetchall()
        if str(r[2]).upper() in ("TEXT", "JSON", "") or "CHAR" in str(r[2]).upper()
    ]


def _all_tables(conn: sqlite3.Connection) -> list[str]:
    return [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]


def scrub_tokens(db_path: str, replacements: list[tuple[str, str]]) -> int:
    """Replace each (token, replacement) across every text cell of every table.

    Matching is CASE-INSENSITIVE: brand tokens hide in lowercase emails/URLs
    ("info@acme.org") and uppercase shouting, which a case-sensitive SQL REPLACE
    would silently miss. ``replacements`` should be ordered longest-token-first so
    a multi-word brand ("Camp Acme") is handled before its substring ("Acme").
    Returns the number of cells actually changed (no inflation from no-op matches).
    """
    patterns = [(re.compile(re.escape(token), re.IGNORECASE), repl) for token, repl in replacements]
    conn = sqlite3.connect(db_path)
    changed = 0
    try:
        for table in _all_tables(conn):
            cols = _text_columns(conn, table)
            if not cols:
                continue
            for col in cols:
                rows = conn.execute(f"SELECT rowid, [{col}] FROM [{table}] WHERE [{col}] IS NOT NULL").fetchall()
                for rowid, value in rows:
                    original = str(value)
                    scrubbed = original
                    for pat, repl in patterns:
                        scrubbed = pat.sub(repl, scrubbed)
                    if scrubbed != original:
                        conn.execute(f"UPDATE [{table}] SET [{col}] = ? WHERE rowid = ?", (scrubbed, rowid))
                        changed += 1
        conn.commit()
    finally:
        conn.close()
    return changed

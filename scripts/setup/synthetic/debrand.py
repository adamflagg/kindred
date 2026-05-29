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

from __future__ import annotations

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

    ``replacements`` should be ordered longest-token-first so "Camp Tawonga" is
    handled before the substring "Tawonga". Returns the number of cells changed.
    """
    conn = sqlite3.connect(db_path)
    changed = 0
    try:
        for table in _all_tables(conn):
            cols = _text_columns(conn, table)
            if not cols:
                continue
            # Build a single UPDATE with nested REPLACE() over all tokens per column.
            for col in cols:
                expr = f"[{col}]"
                for token, repl in replacements:
                    expr = f"REPLACE({expr}, ?, ?)"
                params: list[str] = []
                for token, repl in replacements:
                    params.extend([token, repl])
                like_clauses = " OR ".join(f"[{col}] LIKE ?" for _ in replacements)
                like_params = [f"%{token}%" for token, _ in replacements]
                cur = conn.execute(
                    f"UPDATE [{table}] SET [{col}] = {expr} WHERE [{col}] IS NOT NULL AND ({like_clauses})",
                    [*params, *like_params],
                )
                changed += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        conn.commit()
    finally:
        conn.close()
    return changed

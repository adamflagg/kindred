#!/usr/bin/env python3
"""Seed a clean dev PocketBase database with production data.

Injects application data rows from a prod DB copy into a dev DB that was
initialized by start_dev.sh. System/auth tables in the dev DB are never
touched — only data tables are copied via SQLite ATTACH + INSERT.

Usage:
    uv run python scripts/setup/seed_from_prod.py [--dev-db PATH] [--prod-db PATH] [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

# Tables to skip — system/auth tables that should stay as dev-initialized.
# Matches anything starting with '_', plus 'users' and 'sqlite_*'.
SKIP_PREFIXES = ("_", "sqlite_")
SKIP_EXACT = {"users"}


def _get_data_tables(conn: sqlite3.Connection) -> set[str]:
    """Get the set of data table names from a database (excludes system tables)."""
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    tables = set()
    for (name,) in rows:
        if any(name.startswith(p) for p in SKIP_PREFIXES):
            continue
        if name in SKIP_EXACT:
            continue
        tables.add(name)
    return tables


def _ensure_owned_by_current_user(db_path: str) -> None:
    """Chown the db (and -wal/-shm siblings) to the current user via sudo if needed.

    Prod copies pulled from the VPS are owned by the container's non-root uid
    (e.g. 65532), which leaves the file readable but not writable. The WAL
    checkpoint below needs write access, so reset ownership up front.
    """
    db = Path(db_path)
    targets = [db]
    for suffix in ("-wal", "-shm"):
        sibling = db.with_name(db.name + suffix)
        if sibling.exists():
            targets.append(sibling)

    uid = os.geteuid()
    gid = os.getegid()
    needs_chown = [str(t) for t in targets if t.stat().st_uid != uid or t.stat().st_gid != gid]
    if not needs_chown:
        return

    if not shutil.which("sudo"):
        print(f"ERROR: {db_path} is not owned by current user and 'sudo' is unavailable")
        sys.exit(1)

    print(f"Chowning {len(needs_chown)} prod db file(s) to {uid}:{gid} (sudo)")
    subprocess.run(["sudo", "chown", f"{uid}:{gid}", *needs_chown], check=True)


def _checkpoint_and_cleanup_wal(db_path: str) -> None:
    """WAL-checkpoint the database and remove leftover WAL/SHM files."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.close()

    db = Path(db_path)
    for suffix in ("-wal", "-shm"):
        f = db.with_name(db.name + suffix)
        if f.exists():
            f.unlink()
            print(f"Removed {f.name}")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def seed_from_prod(
    *,
    dev_db: str,
    prod_db: str,
    dry_run: bool = False,
    allow_skip: bool = False,
) -> dict[str, object]:
    """Inject prod data into a clean dev database.

    Args:
        dev_db: Path to the clean dev data.db (target).
        prod_db: Path to the prod data-prod.db (source).
        dry_run: If True, report what would change without modifying.
        allow_skip: If True, fall back to warn-and-continue when prod has
            tables dev doesn't (or vice versa). Default False fails fast —
            dropping a whole table's worth of rows is the silent-empty
            symptom that masked #1338, and a hard error makes the drift
            visible (#1339 ask #2).

    Returns:
        Summary dict with table names and row counts.
    """
    # Validate inputs
    if not Path(dev_db).is_file():
        print(f"ERROR: Dev database not found: {dev_db}")
        sys.exit(1)
    if not Path(prod_db).is_file():
        print(f"ERROR: Prod database not found: {prod_db}")
        sys.exit(1)

    # Reset ownership on prod copy (VPS dumps land owned by the container uid),
    # then WAL-checkpoint the prod DB. Both mutate prod, so skip in dry-run.
    if not dry_run:
        _ensure_owned_by_current_user(prod_db)
        _checkpoint_and_cleanup_wal(prod_db)

    # Discover data tables in both databases
    dev_conn = sqlite3.connect(dev_db)
    dev_tables = _get_data_tables(dev_conn)
    dev_conn.close()

    prod_conn = sqlite3.connect(prod_db)
    prod_tables = _get_data_tables(prod_conn)
    prod_conn.close()

    # Determine table sets
    common = sorted(dev_tables & prod_tables)
    prod_only = sorted(prod_tables - dev_tables)
    dev_only = sorted(dev_tables - prod_tables)

    if prod_only or dev_only:
        if prod_only:
            print(f"WARNING: Skipping {len(prod_only)} tables in prod but not dev: {', '.join(prod_only)}")
        if dev_only:
            print(f"WARNING: Skipping {len(dev_only)} tables in dev but not prod: {', '.join(dev_only)}")
        if not allow_skip:
            print(
                "\nERROR: schema drift detected between dev and prod. Dropping a "
                "whole table's worth of rows silently is the failure mode #1338 "
                "fixed at the query level; refusing to perpetuate it at the seed "
                "level. Re-run with --allow-skip if the drift is intentional."
            )
            sys.exit(1)

    summary: dict[str, object] = {}

    if dry_run:
        # Report what WOULD be copied by reading counts from prod
        tables_copied: dict[str, int] = {}
        prod_conn = sqlite3.connect(prod_db)
        for table in common:
            count: int = prod_conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
            tables_copied[table] = count
        prod_conn.close()

        summary["tables_copied"] = tables_copied
        if prod_only:
            summary["skipped_prod_only"] = prod_only
        if dev_only:
            summary["skipped_dev_only"] = dev_only

        print("DRY RUN — no changes made")
        _print_summary(summary, dry_run=True)
        return summary

    # Connect to dev DB, ATTACH prod DB, and copy data
    conn = sqlite3.connect(dev_db)
    cur = conn.cursor()

    try:
        # Disable FK checks during copy (prod data is already consistent)
        cur.execute("PRAGMA foreign_keys=OFF")

        # ATTACH prod database
        cur.execute("ATTACH DATABASE ? AS prod", (prod_db,))

        tables_copied = {}
        for table in common:
            cur.execute(f"DELETE FROM main.[{table}]")
            cur.execute(f"INSERT INTO main.[{table}] SELECT * FROM prod.[{table}]")
            count = cur.execute(f"SELECT COUNT(*) FROM main.[{table}]").fetchone()[0]
            tables_copied[table] = count

        conn.commit()

        cur.execute("DETACH DATABASE prod")
        cur.execute("PRAGMA foreign_keys=ON")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    summary["tables_copied"] = tables_copied
    if prod_only:
        summary["skipped_prod_only"] = prod_only
    if dev_only:
        summary["skipped_dev_only"] = dev_only

    _print_summary(summary)
    return summary


def _print_summary(summary: dict[str, object], *, dry_run: bool = False) -> None:
    """Print a summary of changes made (or would be made)."""
    prefix = "Would inject" if dry_run else "Injected"
    tables = summary.get("tables_copied", {})
    assert isinstance(tables, dict)
    total_rows = sum(tables.values())

    print(f"\n{'=' * 50}")
    print(f"  {prefix} prod data into dev database")
    print(f"{'=' * 50}")
    print(f"  Tables: {len(tables)}")
    print(f"  Total rows: {total_rows}")
    for table, count in sorted(tables.items()):
        print(f"    {table}: {count}")

    skipped_prod = summary.get("skipped_prod_only")
    if isinstance(skipped_prod, list) and skipped_prod:
        print(f"  Skipped (prod only): {', '.join(skipped_prod)}")
    skipped_dev = summary.get("skipped_dev_only")
    if isinstance(skipped_dev, list) and skipped_dev:
        print(f"  Skipped (dev only): {', '.join(skipped_dev)}")

    print(f"{'=' * 50}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a dev PocketBase database with production data.")
    parser.add_argument(
        "--dev-db",
        default=None,
        help="Path to dev data.db (default: pocketbase/pb_data/data.db)",
    )
    parser.add_argument(
        "--prod-db",
        default=None,
        help="Path to prod data-prod.db (default: pocketbase/pb_data/data-prod.db)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without modifying",
    )
    parser.add_argument(
        "--allow-skip",
        action="store_true",
        help="Continue (with warning) when dev/prod schemas drift instead of failing",
    )
    args = parser.parse_args()

    # Auto-detect project root
    project_root = Path(__file__).resolve().parent.parent.parent

    # Default paths
    dev_db = args.dev_db or str(project_root / "pocketbase" / "pb_data" / "data.db")
    prod_db = args.prod_db or str(project_root / "pocketbase" / "pb_data" / "data-prod.db")

    seed_from_prod(
        dev_db=dev_db,
        prod_db=prod_db,
        dry_run=args.dry_run,
        allow_skip=args.allow_skip,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

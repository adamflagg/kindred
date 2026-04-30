"""One-shot backfill for Stage 3a parent-paramount.

Removes the lingering effect of Stage 1's now-deleted sole-promotion logic by
resetting every `bunk_requests` row with source_field='socialize_with' and
priority != 1 to priority = 1. Idempotent.

Usage:
    cd /path/to/kindred && docker compose down
    uv run python scripts/parent_paramount_stage3a_backfill.py /path/to/pb_data/data.db

The script does not start or stop the docker stack itself — the operator must
ensure the SQLite file is not held by PocketBase before running.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def backfill(db_path: Path) -> dict[str, int]:
    """Run the backfill against the given SQLite file.

    Returns counts: scanned (socialize_with rows scanned), updated, skipped.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute(
            "SELECT id, priority FROM bunk_requests WHERE source_field = ?",
            ("socialize_with",),
        )
        rows = cursor.fetchall()
        scanned = len(rows)
        to_update = [row_id for row_id, priority in rows if priority != 1]
        skipped = scanned - len(to_update)
        if to_update:
            conn.executemany(
                "UPDATE bunk_requests SET priority = 1 WHERE id = ?",
                [(row_id,) for row_id in to_update],
            )
            conn.commit()
        return {"scanned": scanned, "updated": len(to_update), "skipped": skipped}
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 3a parent-paramount backfill")
    parser.add_argument("db_path", type=Path, help="Path to PocketBase SQLite file")
    args = parser.parse_args()
    # `is_file()` rejects a directory up-front; `exists()` would let it
    # through and fail later with an obscure sqlite3.connect error.
    if not args.db_path.is_file():
        print(f"Error: {args.db_path} is not a file", file=sys.stderr)
        return 1
    result = backfill(args.db_path)
    print(f"Scanned: {result['scanned']}")
    print(f"Updated: {result['updated']}")
    print(f"Skipped (already at priority 1): {result['skipped']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

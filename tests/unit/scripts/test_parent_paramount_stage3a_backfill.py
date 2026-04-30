"""Tests for the Stage 3a backfill script."""

import sqlite3
from pathlib import Path

from scripts.parent_paramount_stage3a_backfill import backfill


def _create_test_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE bunk_requests (id TEXT PRIMARY KEY, source_field TEXT, priority INTEGER)")
    conn.executemany(
        "INSERT INTO bunk_requests (id, source_field, priority) VALUES (?, ?, ?)",
        [
            ("a", "socialize_with", 4),  # to update
            ("b", "socialize_with", 1),  # already correct
            ("c", "bunk_with", 4),  # untouched (different source)
            ("d", "socialize_with", 3),  # to update
            ("e", "not_bunk_with", 2),  # untouched
        ],
    )
    conn.commit()
    conn.close()


def test_backfill_updates_only_socialize_with_wrong_priority(tmp_path):
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    result = backfill(db_path)
    assert result["scanned"] == 3  # 3 socialize_with rows scanned
    assert result["updated"] == 2  # rows a and d updated
    assert result["skipped"] == 1  # row b already at priority 1

    conn = sqlite3.connect(db_path)
    rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, source_field, priority FROM bunk_requests")}
    conn.close()
    assert rows["a"] == ("socialize_with", 1)
    assert rows["b"] == ("socialize_with", 1)
    assert rows["c"] == ("bunk_with", 4)  # untouched
    assert rows["d"] == ("socialize_with", 1)
    assert rows["e"] == ("not_bunk_with", 2)  # untouched


def test_backfill_idempotent(tmp_path):
    """scan-it 2026-04-30 #13: idempotency = a second run is a no-op AND row
    state is identical between runs (not just `updated == 0`). Pin both."""
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    first = backfill(db_path)

    def _snapshot() -> dict[str, tuple[str, int]]:
        conn = sqlite3.connect(db_path)
        rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, source_field, priority FROM bunk_requests")}
        conn.close()
        return rows

    after_first = _snapshot()
    second = backfill(db_path)
    after_second = _snapshot()

    assert second["updated"] == 0, "second run must be a no-op"
    assert second["scanned"] == first["scanned"], "scan count must be stable across runs (same rows in source)"
    assert second["skipped"] == first["scanned"], "every scanned row should now be skipped (already at priority 1)"
    assert after_first == after_second, (
        f"row state diverged between runs: first={after_first!r} second={after_second!r}"
    )

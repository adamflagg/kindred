"""Tests for the negative-id target-decline heal backfill."""

import sqlite3
from pathlib import Path

from scripts.target_decline_negative_id_backfill import backfill


def _create_test_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE bunk_requests (id TEXT PRIMARY KEY, requestee_id INTEGER, status TEXT, disposition_reason TEXT)"
    )
    conn.executemany(
        "INSERT INTO bunk_requests (id, requestee_id, status, disposition_reason) VALUES (?, ?, ?, ?)",
        [
            # to heal: negative requestee_id + declined + target_not_attending
            ("a", -383633306, "declined", "target_not_attending"),
            ("b", -645220167, "declined", "target_not_attending"),
            # untouched: real requestee_id, real decline (legitimately not attending)
            ("c", 1234567, "declined", "target_not_attending"),
            # untouched: negative requestee_id but different disposition (e.g., empty)
            ("d", -111111111, "declined", ""),
            # untouched: negative requestee_id but not declined (pending name resolution)
            ("e", -222222222, "pending", "needs_review"),
            # untouched: positive requestee_id, declined for session_mismatch
            ("f", 9999999, "declined", "session_mismatch"),
        ],
    )
    conn.commit()
    conn.close()


def _snapshot(db_path: Path) -> dict[str, tuple[int, str, str]]:
    conn = sqlite3.connect(db_path)
    rows = {
        r[0]: (r[1], r[2], r[3])
        for r in conn.execute("SELECT id, requestee_id, status, disposition_reason FROM bunk_requests")
    }
    conn.close()
    return rows


def test_backfill_heals_only_negative_id_target_not_attending(tmp_path):
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    result = backfill(db_path)

    assert result["scanned"] == 2, "two negative-id+declined+target_not_attending rows in fixture"
    assert result["updated"] == 2

    rows = _snapshot(db_path)
    # Healed rows: status → pending, disposition_reason → needs_review
    assert rows["a"] == (-383633306, "pending", "needs_review")
    assert rows["b"] == (-645220167, "pending", "needs_review")
    # Untouched
    assert rows["c"] == (1234567, "declined", "target_not_attending")
    assert rows["d"] == (-111111111, "declined", "")
    assert rows["e"] == (-222222222, "pending", "needs_review")
    assert rows["f"] == (9999999, "declined", "session_mismatch")


def test_backfill_idempotent(tmp_path):
    """Second run must be a no-op AND row state identical to first run."""
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    first = backfill(db_path)
    after_first = _snapshot(db_path)
    second = backfill(db_path)
    after_second = _snapshot(db_path)

    assert second["scanned"] == 0, "no rows match the heal criteria after first run"
    assert second["updated"] == 0, "second run must be a no-op"
    assert after_first == after_second, (
        f"row state diverged between runs: first={after_first!r} second={after_second!r}"
    )
    # Sanity: first run actually did the work
    assert first["updated"] == 2

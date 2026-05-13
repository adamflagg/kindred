"""Tests for the negative-id target-decline heal backfill."""

import sqlite3
import sys
from pathlib import Path

from scripts.target_decline_negative_id_backfill import backfill, main


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


def test_main_refuses_to_run_with_non_empty_wal(tmp_path, monkeypatch, capsys):
    """Operator-error guardrail: refuse to touch the DB if a non-empty -wal
    sidecar exists (PocketBase may still be active, or crashed mid-write).
    Forces operator to stop PB and checkpoint first."""
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    # Simulate a hot DB by creating a non-empty WAL sidecar
    wal_path = tmp_path / "test.db-wal"
    wal_path.write_bytes(b"\x00" * 32)

    monkeypatch.setattr(sys, "argv", ["target_decline_negative_id_backfill.py", str(db_path)])
    rc = main()
    assert rc == 1, f"main() must return non-zero when WAL is active; got {rc}"
    err = capsys.readouterr().err
    assert "wal" in err.lower(), f"stderr should mention WAL; got: {err!r}"

    # Critical: DB must be untouched — the bad rows still in the heal state
    snap = _snapshot(db_path)
    assert snap["a"] == (-383633306, "declined", "target_not_attending"), "DB must not be modified when WAL guard trips"


def test_main_runs_when_wal_empty_or_missing(tmp_path, monkeypatch, capsys):
    """Counterpart: empty or missing -wal is the normal post-stop state and must allow the run."""
    db_path = tmp_path / "test.db"
    _create_test_db(db_path)
    # No WAL file at all (or empty)
    monkeypatch.setattr(sys, "argv", ["target_decline_negative_id_backfill.py", str(db_path)])
    rc = main()
    assert rc == 0, f"main() must return 0 when WAL is empty/missing; got {rc}"
    out = capsys.readouterr().out
    assert "Updated:  2" in out


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

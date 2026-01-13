#!/usr/bin/env python3
"""Force SQLite WAL checkpoint to sync data to main database file."""

import os
import sqlite3

db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pocketbase/pb_data/data.db")

print(f"Forcing WAL checkpoint on: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Force a full checkpoint
    result = cursor.execute("PRAGMA wal_checkpoint(FULL)").fetchone()
    print(f"Checkpoint result: {result}")
    # Result is (busy, checkpointed_frames, total_frames)

    if result:
        busy, checkpointed, total = result
        if busy == 0:
            print(f"✓ Successfully checkpointed {checkpointed} frames out of {total}")
        else:
            print(f"⚠️  Database busy, partial checkpoint: {checkpointed}/{total} frames")

    conn.close()
    print("Checkpoint complete - your GUI should now show current data")

except Exception as e:
    print(f"Error: {e}")

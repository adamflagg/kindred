#!/usr/bin/env python3
"""
Force WAL checkpoint after running PocketBase migration.
This should be run after the spread_limited removal migration.
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

logger = logging.getLogger(__name__)


def force_wal_checkpoint() -> bool:
    """Force a WAL checkpoint on the PocketBase database"""

    db_path = Path(__file__).parent.parent / "pocketbase" / "pb_data" / "data.db"

    if not db_path.exists():
        logger.error(f"Database not found at {db_path}")
        return False

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Force checkpoint
        cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        result = cursor.fetchone()

        if result:
            logger.info(f"WAL checkpoint complete: {result[0]} pages checkpointed")

        conn.close()
        logger.info("Database checkpoint successful")
        return True

    except Exception as e:
        logger.error(f"Failed to checkpoint database: {e}")
        return False


if __name__ == "__main__":
    success = force_wal_checkpoint()
    sys.exit(0 if success else 1)

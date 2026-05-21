"""SQLite connection management for direct-SQL metrics queries.

Provides a read-only connection to PocketBase's SQLite database with
WAL mode for safe concurrent reads while PocketBase writes.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from bunking.logging_config import get_logger

logger = get_logger(__name__)

_connection: sqlite3.Connection | None = None


def _discover_db_path() -> str:
    """Discover the PocketBase SQLite database path.

    Search order:
    1. PB_DATA_DIR env var → {PB_DATA_DIR}/data.db
    2. Docker default → /pb_data/data.db
    3. Local dev → pocketbase/pb_data/data.db (relative to project root)
    """
    # 1. Explicit env var
    pb_data_dir = os.environ.get("PB_DATA_DIR")
    if pb_data_dir:
        path = Path(pb_data_dir) / "data.db"
        if path.exists():
            return str(path)
        logger.warning(f"PB_DATA_DIR set but {path} not found")

    # 2. Docker default
    docker_path = Path("/pb_data/data.db")
    if docker_path.exists():
        return str(docker_path)

    # 3. Local dev — walk up from this file to find project root
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "pocketbase" / "pb_data" / "data.db"
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        "Could not find PocketBase database. Set PB_DATA_DIR env var or ensure pocketbase/pb_data/data.db exists."
    )


def get_connection() -> sqlite3.Connection:
    """Get or create the singleton read-only SQLite connection."""
    global _connection
    if _connection is not None:
        return _connection

    db_path = _discover_db_path()
    logger.info(f"Opening read-only SQLite connection to {db_path}")
    conn = sqlite3.connect(
        f"file:{db_path}?mode=ro",
        uri=True,
        check_same_thread=False,
    )
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA query_only=ON")
    conn.row_factory = sqlite3.Row
    _connection = conn
    return _connection


def close_connection() -> None:
    """Close the singleton connection (call on app shutdown)."""
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None
        logger.info("Closed metrics SQLite connection")

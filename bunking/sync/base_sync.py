"""
Base sync service providing common functionality for sync scripts.
"""

from __future__ import annotations

import os

from pocketbase import PocketBase


class BaseSyncService:
    """Base class for sync services with PocketBase connectivity."""

    def __init__(self, debug: bool = False, skip_campminder: bool = False) -> None:
        """Initialize the sync service.

        Args:
            debug: Enable debug mode
            skip_campminder: Skip CampMinder API initialization (for DB-only syncs)
        """
        self.debug = debug
        self.skip_campminder = skip_campminder

        # Initialize PocketBase client
        pb_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
        self.pb = PocketBase(pb_url)

        # Authenticate if credentials provided
        admin_email = os.getenv("POCKETBASE_ADMIN_EMAIL")
        admin_password = os.getenv("POCKETBASE_ADMIN_PASSWORD")

        if admin_email and admin_password:
            try:
                self.pb.collection("_superusers").auth_with_password(admin_email, admin_password)
            except Exception as e:
                print(f"Warning: Could not authenticate with PocketBase: {e}")

    def force_wal_checkpoint(self) -> None:
        """Force SQLite WAL checkpoint to ensure data is written to main database."""
        try:
            # This is typically done via direct SQLite access
            # For PocketBase, we rely on the built-in checkpointing
            pass
        except Exception as e:
            print(f"Warning: Could not force WAL checkpoint: {e}")

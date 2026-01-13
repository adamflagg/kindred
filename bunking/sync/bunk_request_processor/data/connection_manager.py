"""
ConnectionManager - Centralized PocketBase connection management.

Provides a singleton pattern for shared connections and factory method
for isolated connections when needed (e.g., concurrent operations).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import PocketBaseWrapper
from pocketbase import PocketBase

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


@dataclass
class ConnectionConfig:
    """Configuration for PocketBase connections."""

    url: str = "http://127.0.0.1:8090"
    admin_email: str | None = None
    admin_password: str | None = None
    use_wrapper: bool = True

    @classmethod
    def from_env(cls) -> ConnectionConfig:
        """Load configuration from environment variables."""
        return cls(
            url=os.environ.get("POCKETBASE_URL", "http://127.0.0.1:8090"),
            admin_email=os.environ.get("POCKETBASE_ADMIN_EMAIL"),
            admin_password=os.environ.get("POCKETBASE_ADMIN_PASSWORD"),
            use_wrapper=os.environ.get("POCKETBASE_USE_WRAPPER", "true").lower() in ("true", "1", "yes"),
        )


class ConnectionManager:
    """
    Manages PocketBase connections with singleton pattern.

    Usage:
        # Get shared connection (singleton)
        manager = ConnectionManager.get_instance()
        client = manager.get_client()

        # Create isolated connection (for concurrent ops)
        isolated = manager.create_isolated_client()

        # Reset singleton (for testing)
        ConnectionManager.reset()
    """

    _instance: ConnectionManager | None = None
    _lock_initialized: bool = False

    def __init__(self, config: ConnectionConfig | None = None):
        """
        Initialize connection manager with config.

        Args:
            config: Connection configuration. Defaults to loading from environment.
        """
        self._config = config or ConnectionConfig.from_env()
        self._client: PocketBase | PocketBaseWrapper | None = None

    @classmethod
    def get_instance(cls, config: ConnectionConfig | None = None) -> ConnectionManager:
        """
        Get the singleton instance.

        Args:
            config: Optional config for first initialization only.

        Returns:
            The singleton ConnectionManager instance.
        """
        if cls._instance is None:
            cls._instance = cls(config)
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset the singleton instance. Used for testing."""
        cls._instance = None

    def get_client(self) -> PocketBase | PocketBaseWrapper:
        """
        Get the shared PocketBase client, creating if needed.

        Returns:
            PocketBase client, optionally wrapped with PocketBaseWrapper.
        """
        if self._client is None:
            self._client = self._create_client()
        return self._client

    def create_isolated_client(self) -> PocketBase | PocketBaseWrapper:
        """
        Create a new isolated client (not cached).

        Use for operations that need independent connections,
        such as concurrent operations.

        Returns:
            New PocketBase client instance.
        """
        return self._create_client()

    def _create_client(self) -> PocketBase | PocketBaseWrapper:
        """
        Create and authenticate a PocketBase client.

        Returns:
            Authenticated PocketBase client.
        """
        pb = PocketBase(self._config.url)

        # Authenticate if credentials provided
        if self._config.admin_email and self._config.admin_password:
            self._authenticate(pb)

        # Wrap if configured
        if self._config.use_wrapper:
            return PocketBaseWrapper(pb)

        return pb

    def _authenticate(self, pb: PocketBase) -> None:
        """
        Authenticate with PocketBase using admin credentials.

        Uses PocketBase 0.23+ _superusers collection auth.

        Args:
            pb: PocketBase client to authenticate.
        """
        admin_email = self._config.admin_email
        admin_password = self._config.admin_password

        if not admin_email or not admin_password:
            logger.warning("Admin credentials not provided, skipping authentication")
            return

        try:
            pb.collection("_superusers").auth_with_password(admin_email, admin_password)
            logger.debug("Authenticated via _superusers collection")
        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            raise

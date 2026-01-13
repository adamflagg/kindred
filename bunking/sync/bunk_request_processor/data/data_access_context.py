"""
DataAccessContext - Unified data access layer entry point.

Provides a context manager for scoped access to repositories and connections,
handling initialization and cleanup automatically.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from bunking.sync.bunk_request_processor.data.connection_manager import (
    ConnectionConfig,
    ConnectionManager,
)
from bunking.sync.bunk_request_processor.data.repository_factory import (
    RepositoryFactory,
)

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import (
        PocketBaseWrapper,
    )
    from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import (
        AttendeeRepository,
    )
    from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
        PersonRepository,
    )
    from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
        RequestRepository,
    )
    from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
        SessionRepository,
    )
    from pocketbase import PocketBase

logger = logging.getLogger(__name__)


class DataAccessContext:
    """
    Unified entry point for data access operations.

    Manages connection lifecycle, repository creation, and cleanup.
    Can be used as a context manager or manually via initialize_sync()/close().

    Usage as context manager:
        with DataAccessContext(year=2025) as ctx:
            persons = ctx.persons.find_by_name("John Doe")
            attendees = ctx.attendees.get_for_session(session_id)

    Usage with manual lifecycle:
        ctx = DataAccessContext(year=2025)
        ctx.initialize_sync()
        try:
            persons = ctx.persons.find_by_name("John Doe")
        finally:
            ctx.close()
    """

    def __init__(
        self,
        year: int,
        connection_config: ConnectionConfig | None = None,
        use_shared_connection: bool = True,
        cache_config: dict[str, Any] | None = None,
    ):
        """
        Initialize the data access context.

        Args:
            year: Current processing year.
            connection_config: Optional connection configuration.
            use_shared_connection: If True, uses singleton connection.
                                   If False, creates isolated connection.
            cache_config: Optional cache configuration.
        """
        self._year = year
        self._connection_config = connection_config
        self._use_shared_connection = use_shared_connection
        self._cache_config = cache_config

        self._pb_client: PocketBase | PocketBaseWrapper | None = None
        self._factory: RepositoryFactory | None = None
        self._closed = False

    def initialize_sync(self) -> None:
        """
        Initialize the context synchronously.

        Creates connection and repository factory.
        """
        logger.debug(f"Initializing DataAccessContext for year {self._year}")

        # Get or create connection
        conn_manager = ConnectionManager.get_instance(self._connection_config)

        if self._use_shared_connection:
            self._pb_client = conn_manager.get_client()
        else:
            self._pb_client = conn_manager.create_isolated_client()

        # Create and initialize factory
        self._factory = RepositoryFactory(
            self._pb_client,
            year=self._year,
            cache_config=self._cache_config,
        )
        self._factory.initialize()

        logger.debug("DataAccessContext initialization complete")

    def close(self) -> None:
        """
        Close the context and cleanup resources.

        Safe to call multiple times (idempotent).
        """
        if self._closed:
            return

        logger.debug("Closing DataAccessContext")

        if self._factory is not None:
            self._factory.cleanup()

        self._closed = True

    @property
    def pb_client(self) -> PocketBase | PocketBaseWrapper:
        """Get the underlying PocketBase client."""
        if self._pb_client is None:
            raise RuntimeError("DataAccessContext not initialized")
        return self._pb_client

    @property
    def persons(self) -> PersonRepository:
        """Get the PersonRepository."""
        if self._factory is None:
            raise RuntimeError("DataAccessContext not initialized")
        return self._factory.get_person_repository()

    @property
    def attendees(self) -> AttendeeRepository:
        """Get the AttendeeRepository."""
        if self._factory is None:
            raise RuntimeError("DataAccessContext not initialized")
        return self._factory.get_attendee_repository()

    @property
    def requests(self) -> RequestRepository:
        """Get the RequestRepository."""
        if self._factory is None:
            raise RuntimeError("DataAccessContext not initialized")
        return self._factory.get_request_repository()

    @property
    def sessions(self) -> SessionRepository:
        """Get the SessionRepository."""
        if self._factory is None:
            raise RuntimeError("DataAccessContext not initialized")
        return self._factory.get_session_repository()

    def __enter__(self) -> DataAccessContext:
        """Enter context manager."""
        self.initialize_sync()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        """Exit context manager."""
        self.close()

    async def __aenter__(self) -> DataAccessContext:
        """Enter async context manager."""
        self.initialize_sync()  # For now, same as sync
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        """Exit async context manager."""
        self.close()

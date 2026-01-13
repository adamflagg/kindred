"""
RepositoryFactory - Centralized repository instantiation.

Provides singleton instances of repositories with proper dependency injection,
ensuring all repositories share the same PocketBase client and caches.
"""

from __future__ import annotations

import logging
from typing import Any

from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
    TemporalNameCache,
)
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


class RepositoryFactory:
    """
    Factory for creating and caching repository instances.

    All repositories are created lazily and cached for reuse. The factory
    ensures all repositories share the same PocketBase client and caches.

    Usage:
        factory = RepositoryFactory(pb_client, year=2025)
        factory.initialize()  # Creates temporal cache

        persons = factory.get_person_repository()
        attendees = factory.get_attendee_repository()

        # Cleanup when done
        factory.cleanup()
    """

    def __init__(
        self,
        pb_client: PocketBase | PocketBaseWrapper,
        year: int,
        cache_config: dict[str, Any] | None = None,
    ):
        """
        Initialize the factory.

        Args:
            pb_client: PocketBase client (or wrapper).
            year: Current processing year.
            cache_config: Optional cache configuration.
        """
        self._pb_client = pb_client
        self._year = year
        self._cache_config = cache_config

        # Cached repository instances
        self._person_repository: PersonRepository | None = None
        self._attendee_repository: AttendeeRepository | None = None
        self._request_repository: RequestRepository | None = None
        self._session_repository: SessionRepository | None = None

        # Temporal name cache (requires initialize())
        self._temporal_cache: TemporalNameCache | None = None

    def initialize(self) -> None:
        """
        Initialize the factory by creating and populating caches.

        This must be called before using repositories that depend on
        the temporal name cache (e.g., PersonRepository).
        """
        logger.debug(f"Initializing RepositoryFactory for year {self._year}")

        # Create and initialize temporal name cache
        self._temporal_cache = TemporalNameCache(self._pb_client, self._year)
        self._temporal_cache.initialize()

        logger.debug("RepositoryFactory initialization complete")

    def get_person_repository(self) -> PersonRepository:
        """
        Get the PersonRepository singleton.

        Returns:
            PersonRepository instance.
        """
        if self._person_repository is None:
            # Suppress deprecation warning for factory-created instances
            PersonRepository._from_factory = True
            try:
                self._person_repository = PersonRepository(
                    self._pb_client,
                    cache=None,  # TODO: Add general cache if needed
                    name_cache=self._temporal_cache,
                )
            finally:
                PersonRepository._from_factory = False
        return self._person_repository

    def get_attendee_repository(self) -> AttendeeRepository:
        """
        Get the AttendeeRepository singleton.

        Returns:
            AttendeeRepository instance.
        """
        if self._attendee_repository is None:
            self._attendee_repository = AttendeeRepository(self._pb_client)
        return self._attendee_repository

    def get_request_repository(self) -> RequestRepository:
        """
        Get the RequestRepository singleton.

        Returns:
            RequestRepository instance.
        """
        if self._request_repository is None:
            self._request_repository = RequestRepository(self._pb_client)
        return self._request_repository

    def get_session_repository(self) -> SessionRepository:
        """
        Get the SessionRepository singleton.

        Returns:
            SessionRepository instance.
        """
        if self._session_repository is None:
            self._session_repository = SessionRepository(
                self._pb_client,
                cache=None,  # TODO: Add general cache if needed
            )
        return self._session_repository

    def cleanup(self) -> None:
        """
        Clean up all cached instances.

        Clears repository references so new instances will be created
        on next access.
        """
        logger.debug("Cleaning up RepositoryFactory")

        self._person_repository = None
        self._attendee_repository = None
        self._request_repository = None
        self._session_repository = None
        self._temporal_cache = None

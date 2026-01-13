"""
Tests for RepositoryFactory - centralized repository instantiation.

TDD: These tests define the expected behavior before implementation.
"""

from __future__ import annotations

from unittest.mock import Mock, patch

import pytest


class TestRepositoryFactory:
    """Tests for RepositoryFactory repository creation and caching."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client."""
        return Mock()

    def test_get_person_repository_returns_singleton(self, mock_pb_client):
        """get_person_repository should return the same instance on repeated calls."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        repo1 = factory.get_person_repository()
        repo2 = factory.get_person_repository()

        assert repo1 is repo2

    def test_get_attendee_repository_returns_singleton(self, mock_pb_client):
        """get_attendee_repository should return the same instance on repeated calls."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        repo1 = factory.get_attendee_repository()
        repo2 = factory.get_attendee_repository()

        assert repo1 is repo2

    def test_get_request_repository_returns_singleton(self, mock_pb_client):
        """get_request_repository should return the same instance on repeated calls."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        repo1 = factory.get_request_repository()
        repo2 = factory.get_request_repository()

        assert repo1 is repo2

    def test_get_session_repository_returns_singleton(self, mock_pb_client):
        """get_session_repository should return the same instance on repeated calls."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        repo1 = factory.get_session_repository()
        repo2 = factory.get_session_repository()

        assert repo1 is repo2

    @patch("bunking.sync.bunk_request_processor.data.repository_factory.TemporalNameCache")
    def test_initialize_creates_temporal_cache(self, mock_cache_class, mock_pb_client):
        """initialize should create TemporalNameCache and populate it."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        mock_cache = Mock()
        mock_cache_class.return_value = mock_cache

        factory = RepositoryFactory(mock_pb_client, year=2025)
        factory.initialize()

        # Should create cache with pb_client and year
        mock_cache_class.assert_called_once_with(mock_pb_client, 2025)
        # Should initialize the cache (method was renamed from populate to initialize)
        mock_cache.initialize.assert_called_once()

    @patch("bunking.sync.bunk_request_processor.data.repository_factory.TemporalNameCache")
    def test_initialize_passes_cache_to_person_repository(self, mock_cache_class, mock_pb_client):
        """initialize should pass temporal cache to PersonRepository."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        mock_cache = Mock()
        mock_cache_class.return_value = mock_cache

        factory = RepositoryFactory(mock_pb_client, year=2025)
        factory.initialize()
        person_repo = factory.get_person_repository()

        # PersonRepository should have the temporal cache
        assert person_repo.name_cache is mock_cache

    def test_cleanup_clears_repository_references(self, mock_pb_client):
        """cleanup should clear cached repository instances."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        # Create some repositories
        person_repo = factory.get_person_repository()
        attendee_repo = factory.get_attendee_repository()

        # Cleanup
        factory.cleanup()

        # After cleanup, new calls should return new instances
        new_person_repo = factory.get_person_repository()
        new_attendee_repo = factory.get_attendee_repository()

        assert new_person_repo is not person_repo
        assert new_attendee_repo is not attendee_repo

    def test_factory_accepts_optional_cache_config(self, mock_pb_client):
        """Factory should accept optional cache configuration."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        cache_config = {"max_size": 1000, "ttl": 300}
        factory = RepositoryFactory(mock_pb_client, year=2025, cache_config=cache_config)

        assert factory._cache_config == cache_config

    def test_repositories_receive_same_pb_client(self, mock_pb_client):
        """All repositories should receive the same PocketBase client."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(mock_pb_client, year=2025)

        person_repo = factory.get_person_repository()
        attendee_repo = factory.get_attendee_repository()
        request_repo = factory.get_request_repository()
        session_repo = factory.get_session_repository()

        # All should have the same pb client
        assert person_repo.pb is mock_pb_client
        assert attendee_repo.pb is mock_pb_client
        assert request_repo.pb is mock_pb_client
        assert session_repo.pb is mock_pb_client

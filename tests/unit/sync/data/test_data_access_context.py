"""
Tests for DataAccessContext - unified data access layer entry point.

TDD: These tests define the expected behavior before implementation.
"""

from __future__ import annotations

from unittest.mock import Mock, patch


class TestDataAccessContext:
    """Tests for DataAccessContext context manager and repository access."""

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_context_manager_initializes_and_cleans_up(self, mock_factory_class, mock_conn_class):
        """Context manager should initialize on enter and cleanup on exit."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory

        with DataAccessContext(year=2025) as ctx:
            # Should initialize factory
            mock_factory.initialize.assert_called_once()
            assert ctx is not None

        # Should cleanup factory on exit
        mock_factory.cleanup.assert_called_once()

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_persons_property_returns_repository(self, mock_factory_class, mock_conn_class):
        """persons property should return PersonRepository from factory."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_person_repo = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory
        mock_factory.get_person_repository.return_value = mock_person_repo

        with DataAccessContext(year=2025) as ctx:
            result = ctx.persons

        mock_factory.get_person_repository.assert_called_once()
        assert result is mock_person_repo

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_attendees_property_returns_repository(self, mock_factory_class, mock_conn_class):
        """attendees property should return AttendeeRepository from factory."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_attendee_repo = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory
        mock_factory.get_attendee_repository.return_value = mock_attendee_repo

        with DataAccessContext(year=2025) as ctx:
            result = ctx.attendees

        mock_factory.get_attendee_repository.assert_called_once()
        assert result is mock_attendee_repo

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_requests_property_returns_repository(self, mock_factory_class, mock_conn_class):
        """requests property should return RequestRepository from factory."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_request_repo = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory
        mock_factory.get_request_repository.return_value = mock_request_repo

        with DataAccessContext(year=2025) as ctx:
            result = ctx.requests

        mock_factory.get_request_repository.assert_called_once()
        assert result is mock_request_repo

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_sessions_property_returns_repository(self, mock_factory_class, mock_conn_class):
        """sessions property should return SessionRepository from factory."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_session_repo = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory
        mock_factory.get_session_repository.return_value = mock_session_repo

        with DataAccessContext(year=2025) as ctx:
            result = ctx.sessions

        mock_factory.get_session_repository.assert_called_once()
        assert result is mock_session_repo

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_shared_connection_uses_singleton(self, mock_factory_class, mock_conn_class):
        """With use_shared_connection=True, should use ConnectionManager singleton."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory

        with DataAccessContext(year=2025, use_shared_connection=True):
            pass

        # Should use get_instance, not create isolated
        mock_conn_class.get_instance.assert_called_once()
        mock_conn.get_client.assert_called_once()

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_isolated_connection_creates_new_client(self, mock_factory_class, mock_conn_class):
        """With use_shared_connection=False, should create isolated client."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_isolated_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.create_isolated_client.return_value = mock_isolated_client
        mock_factory_class.return_value = mock_factory

        with DataAccessContext(year=2025, use_shared_connection=False):
            pass

        # Should use create_isolated_client
        mock_conn.create_isolated_client.assert_called_once()

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_pb_client_property_returns_client(self, mock_factory_class, mock_conn_class):
        """pb_client property should return the PocketBase client."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory

        with DataAccessContext(year=2025) as ctx:
            result = ctx.pb_client

        assert result is mock_client

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_close_can_be_called_multiple_times(self, mock_factory_class, mock_conn_class):
        """close() should be idempotent and safe to call multiple times."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory

        ctx = DataAccessContext(year=2025)
        ctx.initialize_sync()

        # Should not raise on multiple closes
        ctx.close()
        ctx.close()

        # Cleanup should only be called once
        assert mock_factory.cleanup.call_count == 1

    @patch("bunking.sync.bunk_request_processor.data.data_access_context.ConnectionManager")
    @patch("bunking.sync.bunk_request_processor.data.data_access_context.RepositoryFactory")
    def test_initialize_sync_can_be_used_without_context_manager(self, mock_factory_class, mock_conn_class):
        """initialize_sync should allow manual initialization without with statement."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        mock_conn = Mock()
        mock_client = Mock()
        mock_factory = Mock()
        mock_conn_class.get_instance.return_value = mock_conn
        mock_conn.get_client.return_value = mock_client
        mock_factory_class.return_value = mock_factory

        ctx = DataAccessContext(year=2025)
        ctx.initialize_sync()

        mock_factory.initialize.assert_called_once()

        ctx.close()
        mock_factory.cleanup.assert_called_once()

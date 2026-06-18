"""
Tests for ConnectionManager - centralized PocketBase connection management.

TDD: These tests define the expected behavior before implementation.
"""

import logging
import time
from unittest.mock import Mock, patch

import pytest

from bunking.sync.bunk_request_processor.data.connection_manager import (
    ConnectionConfig,
    ConnectionManager,
)


class TestConnectionConfig:
    """Tests for ConnectionConfig dataclass."""

    def test_default_values(self):
        """ConnectionConfig should have sensible defaults."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
        )

        config = ConnectionConfig()

        assert config.url == "http://127.0.0.1:8090"
        assert config.admin_email is None
        assert config.admin_password is None
        assert config.use_wrapper is True

    def test_from_env_loads_environment_variables(self):
        """from_env should load configuration from environment."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
        )

        with patch.dict(
            "os.environ",
            {
                "POCKETBASE_URL": "http://custom:9090",
                "POCKETBASE_ADMIN_EMAIL": "test@example.com",
                "POCKETBASE_ADMIN_PASSWORD": "secret123",
            },
        ):
            config = ConnectionConfig.from_env()

        assert config.url == "http://custom:9090"
        assert config.admin_email == "test@example.com"
        assert config.admin_password == "secret123"

    def test_from_env_uses_defaults_when_env_missing(self):
        """from_env should use defaults when environment variables are not set."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
        )

        with patch.dict("os.environ", {}, clear=True):
            config = ConnectionConfig.from_env()

        assert config.url == "http://127.0.0.1:8090"
        assert config.admin_email is None
        assert config.admin_password is None


class TestConnectionManager:
    """Tests for ConnectionManager singleton and client creation."""

    @pytest.fixture(autouse=True)
    def reset_singleton(self):
        """Reset the singleton before each test."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        ConnectionManager.reset()
        yield
        ConnectionManager.reset()

    def test_singleton_returns_same_instance(self):
        """get_instance should return the same instance on repeated calls."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        instance1 = ConnectionManager.get_instance()
        instance2 = ConnectionManager.get_instance()

        assert instance1 is instance2

    def test_reset_clears_singleton(self):
        """reset should clear the singleton instance."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        instance1 = ConnectionManager.get_instance()
        ConnectionManager.reset()
        instance2 = ConnectionManager.get_instance()

        assert instance1 is not instance2

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_get_client_creates_pocketbase_instance(self, mock_pb_class):
        """get_client should create a PocketBase instance."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb

        config = ConnectionConfig(
            url="http://test:8090",
            admin_email="admin@test.com",
            admin_password="password",
            use_wrapper=False,  # Disable wrapper for simpler test
        )
        manager = ConnectionManager(config)
        client = manager.get_client()

        mock_pb_class.assert_called_once_with("http://test:8090")
        assert client is mock_pb

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_get_client_authenticates_when_credentials_provided(self, mock_pb_class):
        """get_client should authenticate if admin credentials are provided."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb

        config = ConnectionConfig(
            url="http://test:8090",
            admin_email="admin@test.com",
            admin_password="password",
            use_wrapper=False,
        )
        manager = ConnectionManager(config)
        manager.get_client()

        # Should try new auth method first
        mock_pb.collection.assert_called_with("_superusers")

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_get_client_returns_cached_client(self, mock_pb_class):
        """get_client should return the same client on repeated calls."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb

        config = ConnectionConfig(use_wrapper=False)
        manager = ConnectionManager(config)

        client1 = manager.get_client()
        client2 = manager.get_client()

        assert client1 is client2
        # Should only create one instance
        assert mock_pb_class.call_count == 1

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_create_isolated_client_returns_new_instance(self, mock_pb_class):
        """create_isolated_client should create a fresh client each time."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb1 = Mock()
        mock_pb2 = Mock()
        mock_pb_class.side_effect = [mock_pb1, mock_pb2]

        config = ConnectionConfig(use_wrapper=False)
        manager = ConnectionManager(config)

        client1 = manager.create_isolated_client()
        client2 = manager.create_isolated_client()

        assert client1 is not client2
        assert mock_pb_class.call_count == 2

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBaseWrapper")
    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_uses_pocketbase_wrapper_by_default(self, mock_pb_class, mock_wrapper_class):
        """get_client should wrap the client with PocketBaseWrapper by default."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_wrapper = Mock()
        mock_pb_class.return_value = mock_pb
        mock_wrapper_class.return_value = mock_wrapper

        config = ConnectionConfig(use_wrapper=True)  # Default
        manager = ConnectionManager(config)
        client = manager.get_client()

        mock_wrapper_class.assert_called_once_with(mock_pb)
        assert client is mock_wrapper

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_skips_auth_when_no_credentials(self, mock_pb_class):
        """get_client should skip authentication if no credentials provided."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb

        config = ConnectionConfig(
            admin_email=None,
            admin_password=None,
            use_wrapper=False,
        )
        manager = ConnectionManager(config)
        manager.get_client()

        # Should not attempt authentication
        mock_pb.collection.assert_not_called()
        mock_pb.admins.auth_with_password.assert_not_called()

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_raises_when_auth_fails(self, mock_pb_class):
        """get_client should raise if authentication fails (no fallback)."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionConfig,
            ConnectionManager,
        )

        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb
        # Auth method fails
        mock_pb.collection.return_value.auth_with_password.side_effect = Exception("Auth failed")

        config = ConnectionConfig(
            admin_email="admin@test.com",
            admin_password="password",
            use_wrapper=False,
        )
        manager = ConnectionManager(config)

        # Should raise exception - no fallback to legacy method
        with pytest.raises(Exception, match="Auth failed"):
            manager.get_client()


class TestConnectionManagerReauth:
    """Proactive token re-auth on the shared cached client (issue #1765)."""

    @pytest.fixture(autouse=True)
    def _reset_singleton(self):
        ConnectionManager.reset()
        yield
        ConnectionManager.reset()

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_reauth_when_token_stale(self, mock_pb_class):
        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb
        config = ConnectionConfig(
            admin_email="admin@test.com",
            admin_password="pw",
            use_wrapper=False,
        )
        mgr = ConnectionManager.get_instance(config)

        client = mgr.get_client()
        auth = mock_pb.collection.return_value.auth_with_password
        assert auth.call_count == 1  # authed once on creation

        mgr._authed_at = time.monotonic() - 100_000  # force staleness
        client_again = mgr.get_client()

        assert client_again is client  # same cached client, refreshed in place
        assert auth.call_count == 2  # re-authenticated
        assert mgr._authed_at is not None
        assert time.monotonic() - mgr._authed_at < 5  # timestamp advanced

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_no_reauth_when_token_fresh(self, mock_pb_class):
        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb
        config = ConnectionConfig(
            admin_email="admin@test.com",
            admin_password="pw",
            use_wrapper=False,
        )
        mgr = ConnectionManager.get_instance(config)

        mgr.get_client()
        mgr.get_client()  # still fresh -> no re-auth

        assert mock_pb.collection.return_value.auth_with_password.call_count == 1

    @patch("pocketbase.services.record_service.RecordService.auth_with_password")
    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_reauth_when_token_stale_with_wrapper(self, mock_pb_class, mock_record_svc_auth):
        """Production default use_wrapper=True: re-auth must refresh through the wrapper.

        The re-auth path differs from use_wrapper=False:
          - Initial auth: _authenticate(pb) calls pb.collection(...)  on the raw Mock pb,
            so auth_with_password is a plain Mock attribute (not RecordService's method).
          - Re-auth: _maybe_reauth() calls self._client.collection(...) on PocketBaseWrapper,
            which returns a real WrappedRecordService (inherits RecordService). Since
            RecordService defines auth_with_password, __getattr__ delegation is bypassed —
            the inherited method runs. We patch it at the class level to intercept the call.
        """
        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb
        config = ConnectionConfig(
            admin_email="admin@test.com",
            admin_password="pw",
            use_wrapper=True,
        )
        mgr = ConnectionManager.get_instance(config)

        client = mgr.get_client()  # PocketBaseWrapper wrapping mock_pb
        # Initial auth went through the raw mock — RecordService patch not involved
        assert mock_pb.collection.return_value.auth_with_password.call_count == 1
        assert mock_record_svc_auth.call_count == 0

        mgr._authed_at = time.monotonic() - 100_000  # force staleness
        client_again = mgr.get_client()

        assert client_again is client  # same cached wrapper, refreshed in place
        # Re-auth routed through WrappedRecordService (inherits RecordService)
        assert mock_record_svc_auth.call_count == 1
        assert time.monotonic() - mgr._authed_at < 5  # _authed_at advanced (re-auth succeeded)

    @patch("bunking.sync.bunk_request_processor.data.connection_manager.PocketBase")
    def test_reauth_failure_is_non_fatal(self, mock_pb_class, caplog):
        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb
        config = ConnectionConfig(
            admin_email="admin@test.com",
            admin_password="pw",
            use_wrapper=False,
        )
        mgr = ConnectionManager.get_instance(config)

        client = mgr.get_client()  # initial auth succeeds
        auth = mock_pb.collection.return_value.auth_with_password
        auth.side_effect = Exception("token refresh boom")
        mgr._authed_at = time.monotonic() - 100_000  # force staleness

        with caplog.at_level(
            logging.WARNING,
            logger="bunking.sync.bunk_request_processor.data.connection_manager",
        ):
            client_again = mgr.get_client()  # must NOT raise

        assert client_again is client
        assert any(
            record.levelno == logging.WARNING and "Re-authentication failed" in record.getMessage()
            for record in caplog.records
        )

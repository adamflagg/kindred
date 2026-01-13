# mypy: ignore-errors
# NOTE: This fixture file references solver_service_v2 which may not exist.
# Fixtures are optional and tests using them will be skipped if unavailable.
"""
Common test fixtures for API testing.
"""

import os
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_auth_middleware():
    """Mock the auth middleware to bypass authentication in tests"""
    with patch("bunking.auth_middleware_asgi.OIDCAuthMiddleware") as mock_middleware_class:
        # Make the middleware return the app unchanged
        def middleware_init(self, app, **kwargs):
            self.app = app
            self.auth_mode = kwargs.get("auth_mode", "bypass")
            self.admin_group = kwargs.get("admin_group", "")

        def middleware_call(self, scope, receive, send):
            # Just pass through to the app
            return self.app(scope, receive, send)

        mock_middleware_class.side_effect = lambda app, **kwargs: app
        yield mock_middleware_class


@pytest.fixture
def mock_pocketbase():
    """Mock PocketBase client"""
    with patch("pocketbase.Client") as mock_pb_class:
        mock_pb = Mock()
        mock_pb_class.return_value = mock_pb

        # Mock common methods
        mock_pb.collection.return_value.auth_with_password = Mock(return_value=True)
        mock_pb.collection.return_value.get_full_list = Mock(return_value=[])
        mock_pb.collection.return_value.get_list = Mock(return_value=Mock(items=[]))
        mock_pb.collection.return_value.get_one = Mock()
        mock_pb.collection.return_value.create = Mock()
        mock_pb.collection.return_value.update = Mock()
        mock_pb.collection.return_value.delete = Mock()

        yield mock_pb


@pytest.fixture
def test_client(mock_auth_middleware, mock_pocketbase):
    """Create test client with mocked dependencies"""
    # Set test environment
    os.environ["AUTH_MODE"] = "bypass"
    os.environ["SKIP_CAMPMINDER"] = "true"

    with (
        patch("solver_service_v2.pb", mock_pocketbase),
        patch("solver_service_v2.asyncio.to_thread", side_effect=lambda func, *args, **kwargs: func(*args, **kwargs)),
    ):
        # Import app after mocking
        from solver_service_v2 import app

        client = TestClient(app)
        yield client

    # Clean up environment
    os.environ.pop("AUTH_MODE", None)
    os.environ.pop("SKIP_CAMPMINDER", None)

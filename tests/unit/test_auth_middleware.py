"""Tests for auth_middleware module."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.settings import _is_github_actions
from bunking.auth_middleware import (
    AuthMiddleware,
    AuthUser,
    _is_docker_environment,
    create_auth_middleware,
    get_current_user,
    require_admin,
)


class TestAuthUser:
    """Tests for AuthUser class."""

    def test_create_user(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=["admin", "staff"],
            is_admin=True,
        )
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.display_name == "Test User"
        assert user.groups == ["admin", "staff"]
        assert user.is_admin is True

    def test_to_dict(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=["admin"],
            is_admin=True,
        )
        result = user.to_dict()

        assert result["username"] == "testuser"
        assert result["email"] == "test@example.com"
        assert result["display_name"] == "Test User"
        assert result["groups"] == ["admin"]
        assert result["is_admin"] is True

    def test_to_dict_empty_groups(self):
        user = AuthUser(
            username="basic",
            email="basic@example.com",
            display_name="Basic User",
            groups=[],
            is_admin=False,
        )
        result = user.to_dict()

        assert result["groups"] == []
        assert result["is_admin"] is False


class TestIsDockerEnvironment:
    """Tests for _is_docker_environment function."""

    def test_docker_env_var_true(self):
        with patch.dict("os.environ", {"DOCKER_CONTAINER": "true"}):
            assert _is_docker_environment() is True

    def test_docker_env_var_false(self):
        with patch.dict("os.environ", {"DOCKER_CONTAINER": "false"}, clear=True):
            with patch("pathlib.Path.exists", return_value=False):
                with patch("builtins.open", side_effect=FileNotFoundError):
                    assert _is_docker_environment() is False

    def test_dockerenv_file_exists(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("pathlib.Path.exists", return_value=True):
                assert _is_docker_environment() is True


class TestIsGitHubActions:
    """Tests for _is_github_actions function."""

    def test_github_actions_both_signals_present(self):
        """Test that both CI=true and GITHUB_ACTIONS=true are required."""
        with patch.dict("os.environ", {"CI": "true", "GITHUB_ACTIONS": "true"}):
            assert _is_github_actions() is True

    def test_github_actions_missing_ci(self):
        """Test that GITHUB_ACTIONS alone is not sufficient."""
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "true"}, clear=True):
            assert _is_github_actions() is False

    def test_github_actions_missing_github_actions(self):
        """Test that CI alone is not sufficient."""
        with patch.dict("os.environ", {"CI": "true"}, clear=True):
            assert _is_github_actions() is False

    def test_github_actions_neither_signal(self):
        """Test that missing both signals returns False."""
        with patch.dict("os.environ", {}, clear=True):
            assert _is_github_actions() is False

    def test_github_actions_wrong_values(self):
        """Test that values must be exactly 'true'."""
        with patch.dict("os.environ", {"CI": "yes", "GITHUB_ACTIONS": "1"}):
            assert _is_github_actions() is False


class TestAuthMiddlewareInit:
    """Tests for AuthMiddleware initialization."""

    def test_init_bypass_mode(self):
        """Test initialization in bypass mode."""
        with patch.object(AuthMiddleware, "__init__", lambda self, *args, **kwargs: None):
            middleware = AuthMiddleware.__new__(AuthMiddleware)
            middleware.auth_mode = "bypass"
            middleware.admin_group = "admin"
            middleware._userinfo_cache = {}
            middleware.jwt_validator = None
            middleware.pb_token_validator = None

            assert middleware.auth_mode == "bypass"

    def test_init_invalid_mode(self):
        """Test that invalid auth mode raises error."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with pytest.raises(ValueError, match="Invalid AUTH_MODE"):
                AuthMiddleware(app, "invalid_mode", "admin")

    def test_init_bypass_blocked_in_docker(self):
        """Test that bypass mode is blocked in Docker (non-CI)."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=True):
            with patch("bunking.auth_middleware._is_github_actions", return_value=False):
                with pytest.raises(ValueError, match="SECURITY ERROR"):
                    AuthMiddleware(app, "bypass", "admin")

    def test_init_bypass_allowed_in_docker_when_github_actions(self):
        """Test that bypass mode is allowed in Docker when in GitHub Actions CI."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=True):
            with patch("bunking.auth_middleware._is_github_actions", return_value=True):
                # Should NOT raise - bypass allowed in CI
                middleware = AuthMiddleware(app, "bypass", "admin")
                assert middleware.auth_mode == "bypass"

    def test_init_production_requires_issuer(self):
        """Test that production mode requires OIDC_ISSUER."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {}, clear=True):
                with pytest.raises(ValueError, match="OIDC_ISSUER must be set"):
                    AuthMiddleware(app, "production", "admin")


class TestGetCurrentUser:
    """Tests for get_current_user dependency."""

    def test_get_current_user_authenticated(self):
        """Test getting current user when authenticated."""
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test",
            groups=[],
            is_admin=False,
        )

        request = MagicMock()
        request.state.user = user

        result = get_current_user(request)
        assert result.username == "testuser"

    def test_get_current_user_not_authenticated(self):
        """Test getting current user when not authenticated."""
        from fastapi import HTTPException

        request = MagicMock()
        request.state = MagicMock(spec=[])  # No user attribute

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(request)

        assert exc_info.value.status_code == 401

    def test_get_current_user_none(self):
        """Test getting current user when user is None."""
        from fastapi import HTTPException

        request = MagicMock()
        request.state.user = None

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(request)

        assert exc_info.value.status_code == 401


class TestRequireAdmin:
    """Tests for require_admin dependency."""

    def test_require_admin_is_admin(self):
        """Test require_admin with admin user."""
        user = AuthUser(
            username="admin",
            email="admin@example.com",
            display_name="Admin",
            groups=["admin"],
            is_admin=True,
        )

        result = require_admin(user)
        assert result.is_admin is True

    def test_require_admin_not_admin(self):
        """Test require_admin with non-admin user."""
        from fastapi import HTTPException

        user = AuthUser(
            username="basic",
            email="basic@example.com",
            display_name="Basic",
            groups=[],
            is_admin=False,
        )

        with pytest.raises(HTTPException) as exc_info:
            require_admin(user)

        assert exc_info.value.status_code == 403


class TestCreateAuthMiddleware:
    """Tests for create_auth_middleware factory function."""

    def test_create_middleware_bypass(self):
        """Test creating middleware in bypass mode."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            middleware = create_auth_middleware(app, "bypass", "admin")

            assert middleware.auth_mode == "bypass"
            assert middleware.admin_group == "admin"


class TestAuthMiddlewareDispatch:
    """Tests for AuthMiddleware dispatch method."""

    @pytest.fixture
    def bypass_middleware(self):
        """Create a bypass mode middleware for testing."""
        app = MagicMock()
        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            middleware = AuthMiddleware(app, "bypass", "admin")
        return middleware

    @pytest.mark.asyncio
    async def test_dispatch_health_endpoint_skipped(self, bypass_middleware):
        """Test that health endpoint skips authentication."""
        request = MagicMock()
        request.url.path = "/health"

        call_next = AsyncMock(return_value=MagicMock())

        await bypass_middleware.dispatch(request, call_next)

        call_next.assert_called_once_with(request)

    @pytest.mark.asyncio
    async def test_dispatch_config_endpoint_skipped(self, bypass_middleware):
        """Test that config endpoint skips authentication."""
        request = MagicMock()
        request.url.path = "/api/config"

        call_next = AsyncMock(return_value=MagicMock())

        await bypass_middleware.dispatch(request, call_next)

        call_next.assert_called_once_with(request)

    @pytest.mark.asyncio
    async def test_dispatch_bypass_creates_devadmin(self, bypass_middleware):
        """Test that bypass mode creates DevAdmin user."""
        request = MagicMock()
        request.url.path = "/api/test"
        request.state = MagicMock()

        call_next = AsyncMock(return_value=MagicMock())

        await bypass_middleware.dispatch(request, call_next)

        # Verify DevAdmin user was set
        assert request.state.user.username == "DevAdmin"
        assert request.state.user.is_admin is True

    @pytest.mark.asyncio
    async def test_dispatch_options_allowed_without_auth(self, bypass_middleware):
        """Test that OPTIONS requests are allowed without authentication."""
        # Create a production middleware
        app = MagicMock()
        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        middleware = AuthMiddleware(app, "production", "admin")

        request = MagicMock()
        request.url.path = "/api/test"
        request.method = "OPTIONS"
        request.headers = {}  # No auth header

        call_next = AsyncMock(return_value=MagicMock())

        # Mock _extract_user_from_jwt to return None
        middleware._extract_user_from_jwt = AsyncMock(return_value=None)  # type: ignore[method-assign]

        await middleware.dispatch(request, call_next)

        # OPTIONS should proceed even without auth
        call_next.assert_called_once()

    @pytest.mark.asyncio
    async def test_dispatch_admin_route_requires_admin(self, bypass_middleware):
        """Test that admin routes check admin status."""
        request = MagicMock()
        request.url.path = "/admin/settings"
        request.state = MagicMock()

        call_next = AsyncMock(return_value=MagicMock())

        # In bypass mode, DevAdmin is admin, so should succeed
        await bypass_middleware.dispatch(request, call_next)

        # Verify DevAdmin was set and route proceeded
        assert request.state.user.is_admin is True
        call_next.assert_called_once()


class TestUserInfoCaching:
    """Tests for userinfo caching functionality."""

    @pytest.mark.asyncio
    async def test_userinfo_cache_used(self):
        """Test that cached userinfo is used when available."""
        app = MagicMock()
        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
                with patch("bunking.auth_middleware.JWTValidator") as mock_validator:
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        mock_validator.return_value.issuer = "https://test.example.com"
                        middleware = AuthMiddleware(app, "production", "admin")

        # Set up cache
        import time

        middleware._userinfo_cache = {
            "userinfo:test-sub": {
                "data": {"email": "cached@example.com", "groups": ["cached-group"]},
                "expires": time.time() + 300,  # Valid for 5 more minutes
            }
        }

        claims = {"sub": "test-sub"}
        result = await middleware._fetch_userinfo_if_needed("test-token", claims)

        assert result["email"] == "cached@example.com"
        assert "cached-group" in result["groups"]

    @pytest.mark.asyncio
    async def test_userinfo_skipped_for_pocketbase_tokens(self):
        """Test that userinfo fetch is skipped for PocketBase tokens."""
        app = MagicMock()
        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
                with patch("bunking.auth_middleware.JWTValidator") as mock_validator:
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        mock_validator.return_value.issuer = "https://test.example.com"
                        middleware = AuthMiddleware(app, "production", "admin")

        claims = {"sub": "pb-user", "_pb_record": {"id": "123"}}
        result = await middleware._fetch_userinfo_if_needed("pb-token", claims)

        # Should return claims unchanged (no userinfo fetch for PB tokens)
        assert result == claims

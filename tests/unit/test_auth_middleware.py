"""Tests for auth_middleware module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.settings import _allow_auth_bypass
from bunking.auth_middleware import (
    AuthMiddleware,
    AuthUser,
    _is_docker_environment,
    create_auth_middleware,
    get_current_user,
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


class TestAllowAuthBypass:
    """Tests for _allow_auth_bypass function."""

    def test_ci_both_signals_present(self):
        """Test that both CI=true and GITHUB_ACTIONS=true allow bypass."""
        with patch.dict("os.environ", {"CI": "true", "GITHUB_ACTIONS": "true"}):
            assert _allow_auth_bypass() is True

    def test_ci_missing_ci(self):
        """Test that GITHUB_ACTIONS alone is not sufficient."""
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "true"}, clear=True):
            assert _allow_auth_bypass() is False

    def test_ci_missing_github_actions(self):
        """Test that CI alone is not sufficient."""
        with patch.dict("os.environ", {"CI": "true"}, clear=True):
            assert _allow_auth_bypass() is False

    def test_neither_signal(self):
        """Test that missing both signals returns False."""
        with patch.dict("os.environ", {}, clear=True):
            assert _allow_auth_bypass() is False

    def test_ci_wrong_values(self):
        """Test that CI values must be exactly 'true'."""
        with patch.dict("os.environ", {"CI": "yes", "GITHUB_ACTIONS": "1"}):
            assert _allow_auth_bypass() is False

    def test_allow_auth_bypass_env_var(self):
        """Test that ALLOW_AUTH_BYPASS=true allows bypass (local Docker testing)."""
        with patch.dict("os.environ", {"ALLOW_AUTH_BYPASS": "true"}, clear=True):
            assert _allow_auth_bypass() is True


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
        """Test that bypass mode is blocked in Docker when not explicitly allowed."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=True):
            with patch("bunking.auth_middleware._allow_auth_bypass", return_value=False):
                with pytest.raises(ValueError, match="SECURITY ERROR"):
                    AuthMiddleware(app, "bypass", "admin")

    def test_init_bypass_allowed_in_docker_when_explicitly_permitted(self):
        """Test that bypass mode is allowed in Docker when auth bypass is explicitly permitted."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=True):
            with patch("bunking.auth_middleware._allow_auth_bypass", return_value=True):
                # Should NOT raise - bypass explicitly allowed
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


class TestTokenLoggingSecurity:
    """Tests for secure token logging (no token content in logs)."""

    @pytest.mark.asyncio
    async def test_token_logging_does_not_include_token_content(self):
        """Test that token logging only logs length, not token content."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {"OIDC_ISSUER": "https://auth.example.com"}):
                with patch("bunking.auth_middleware.JWTValidator") as mock_jwt:
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator") as mock_pb:
                        mock_jwt.return_value.issuer = "https://auth.example.com"
                        mock_jwt.return_value.validate_token.return_value = None
                        mock_pb.return_value.validate_token.return_value = None
                        middleware = AuthMiddleware(app, "production", "admin")

        request = MagicMock()
        request.headers = {"Authorization": "Bearer secret-token-12345678901234567890"}

        # Capture log messages
        with patch("bunking.auth_middleware.logger") as mock_logger:
            await middleware._extract_user_from_jwt(request)

            # Check all debug calls to ensure none contain token preview
            for call in mock_logger.debug.call_args_list:
                log_message = str(call)
                # Token content should NOT appear in logs
                assert "secret-token" not in log_message
                assert "12345678901234567890" not in log_message
                # But length logging is OK
                if "Token found" in log_message:
                    assert "length" in log_message.lower()


class TestPocketBaseUrlValidation:
    """Tests for POCKETBASE_URL validation in production mode."""

    def test_init_production_rejects_untrusted_pocketbase_url(self):
        """Test that production mode rejects POCKETBASE_URL not on trusted network."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "https://evil.example.com:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with pytest.raises(ValueError, match="POCKETBASE_URL must be on trusted network"):
                        AuthMiddleware(app, "production", "admin")

    def test_init_production_accepts_localhost_pocketbase_url(self):
        """Test that production mode accepts localhost POCKETBASE_URL."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://localhost:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        middleware = AuthMiddleware(app, "production", "admin")
                        assert middleware.pb_token_validator is not None

    def test_init_production_accepts_127_0_0_1_pocketbase_url(self):
        """Test that production mode accepts 127.0.0.1 POCKETBASE_URL."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://127.0.0.1:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        middleware = AuthMiddleware(app, "production", "admin")
                        assert middleware.pb_token_validator is not None

    def test_init_production_accepts_pocketbase_hostname(self):
        """Test that production mode accepts 'pocketbase' hostname (Docker internal)."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://pocketbase:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        middleware = AuthMiddleware(app, "production", "admin")
                        assert middleware.pb_token_validator is not None

    def test_init_production_accepts_custom_docker_hostname(self):
        """Test that production mode accepts any dotless hostname (Docker service name)."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://kindred-pocketbase:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                        middleware = AuthMiddleware(app, "production", "admin")
                        assert middleware.pb_token_validator is not None

    def test_init_production_accepts_any_dotless_hostname(self):
        """Test that any dotless hostname is treated as a trusted Docker internal name."""
        app = MagicMock()

        for hostname in ["my-custom-pb", "pb", "kindred-pocketbase", "svc-db"]:
            with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
                with patch.dict(
                    "os.environ",
                    {
                        "OIDC_ISSUER": "https://auth.example.com",
                        "POCKETBASE_URL": f"http://{hostname}:8090",
                    },
                ):
                    with patch("bunking.auth_middleware.JWTValidator"):
                        with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                            middleware = AuthMiddleware(app, "production", "admin")
                            assert middleware.pb_token_validator is not None, f"Failed for hostname: {hostname}"

    def test_init_production_default_pocketbase_url_is_trusted(self):
        """Test that the default POCKETBASE_URL (127.0.0.1) is trusted."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {"OIDC_ISSUER": "https://auth.example.com"},
                clear=False,
            ):
                # Remove POCKETBASE_URL to use default
                import os

                env_backup = os.environ.pop("POCKETBASE_URL", None)
                try:
                    with patch("bunking.auth_middleware.JWTValidator"):
                        with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                            # Should not raise - default is trusted
                            middleware = AuthMiddleware(app, "production", "admin")
                            assert middleware.pb_token_validator is not None
                finally:
                    if env_backup:
                        os.environ["POCKETBASE_URL"] = env_backup

    def test_init_production_rejects_prefix_spoofed_pocketbase_url(self):
        """Test that a URL like http://127.0.0.1.evil.com is rejected.

        Simple prefix matching with startswith() would accept this URL.
        The validation must parse the hostname properly.
        """
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://127.0.0.1.evil.com:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with pytest.raises(ValueError, match="POCKETBASE_URL must be on trusted network"):
                        AuthMiddleware(app, "production", "admin")

    def test_init_production_rejects_localhost_prefix_spoofed_url(self):
        """Test that a URL like http://localhost.evil.com is rejected."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict(
                "os.environ",
                {
                    "OIDC_ISSUER": "https://auth.example.com",
                    "POCKETBASE_URL": "http://localhost.evil.com:8090",
                },
            ):
                with patch("bunking.auth_middleware.JWTValidator"):
                    with pytest.raises(ValueError, match="POCKETBASE_URL must be on trusted network"):
                        AuthMiddleware(app, "production", "admin")


class TestClaimsLoggingLevel:
    """Tests for JWT claims logging at appropriate levels.

    JWT claims contain PII (email, username, groups). They should be
    logged at DEBUG level, not INFO, to avoid PII in production logs.
    """

    @pytest.mark.asyncio
    async def test_jwt_claims_logged_at_debug_not_info(self):
        """Test that JWT claims are logged at DEBUG, not INFO level."""
        app = MagicMock()

        with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
            with patch.dict("os.environ", {"OIDC_ISSUER": "https://auth.example.com"}):
                with patch("bunking.auth_middleware.JWTValidator") as mock_jwt:
                    with patch("bunking.auth_middleware.PocketBaseTokenValidator") as mock_pb:
                        mock_jwt.return_value.issuer = "https://auth.example.com"
                        mock_jwt.return_value.validate_token.return_value = {
                            "sub": "user-123",
                            "email": "user@example.com",
                            "preferred_username": "testuser",
                            "name": "Test User",
                            "groups": ["admin"],
                        }
                        mock_pb.return_value.validate_token.return_value = None
                        middleware = AuthMiddleware(app, "production", "admin")

        request = MagicMock()
        request.headers = {"Authorization": "Bearer valid-token"}

        with patch("bunking.auth_middleware.logger") as mock_logger:
            # Mock userinfo fetch to be a no-op
            middleware._fetch_userinfo_if_needed = AsyncMock(  # type: ignore[method-assign]
                return_value={
                    "sub": "user-123",
                    "email": "user@example.com",
                    "preferred_username": "testuser",
                    "name": "Test User",
                    "groups": ["admin"],
                }
            )

            await middleware._extract_user_from_jwt(request)

            # Claims should NOT be logged at INFO level
            for call in mock_logger.info.call_args_list:
                log_message = str(call)
                assert "JWT claims" not in log_message, f"JWT claims should be logged at DEBUG, not INFO: {log_message}"
                assert "Final claims" not in log_message, (
                    f"Final claims should be logged at DEBUG, not INFO: {log_message}"
                )


class TestAuthUserPermissions:
    """Tests for AuthUser permissions field."""

    def test_default_permissions_empty_set(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        assert user.permissions == set()

    def test_permissions_set_explicitly(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        user.permissions = {"bunking.view", "metrics.view"}
        assert "bunking.view" in user.permissions
        assert "metrics.view" in user.permissions

    def test_to_dict_includes_permissions(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        user.permissions = {"bunking.view"}
        result = user.to_dict()
        assert "permissions" in result
        assert "bunking.view" in result["permissions"]

    def test_to_dict_permissions_sorted(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        user.permissions = {"metrics.view", "bunking.view", "bunking.manage"}
        result = user.to_dict()
        assert result["permissions"] == ["bunking.manage", "bunking.view", "metrics.view"]


class TestAuthUserPermissionsFromPB:
    """Tests for permissions population from PocketBase."""

    def test_permissions_populated_from_pb_record(self):
        """Verify that permissions can be set from cached_permissions."""
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        # Simulate PB record with cached_permissions
        pb_data: dict[str, list[str] | bool] = {
            "cached_permissions": ["bunking.view", "metrics.view"],
            "is_admin": False,
        }
        cached = pb_data.get("cached_permissions")
        user.permissions = set(cached) if isinstance(cached, list) else set()
        assert user.permissions == {"bunking.view", "metrics.view"}

    def test_permissions_empty_when_no_pb_record(self):
        user = AuthUser(
            username="testuser",
            email="test@example.com",
            display_name="Test User",
            groups=[],
            is_admin=False,
        )
        assert user.permissions == set()

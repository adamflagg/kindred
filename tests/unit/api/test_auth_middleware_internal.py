"""Tests for internal endpoint auth bypass.

The /api/internal/ path prefix is used for service-to-service calls between
PocketBase (Go) and FastAPI. These endpoints must bypass auth because the
caller has no user context. External access is blocked by Caddy.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.auth_middleware import AuthMiddleware


@pytest.fixture
def production_middleware():
    """Create a production mode middleware for testing auth enforcement."""
    app = MagicMock()
    with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
        with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
            with patch("bunking.auth_middleware.JWTValidator"):
                with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                    middleware = AuthMiddleware(app, "production", "admin")
    return middleware


class TestInternalEndpointAuthBypass:
    """Tests for /api/internal/ auth bypass behavior."""

    @pytest.mark.asyncio
    async def test_internal_path_skips_auth(self, production_middleware):
        """Requests to /api/internal/* should bypass auth middleware."""
        request = MagicMock()
        request.url.path = "/api/internal/normalize-geographic"
        request.method = "POST"

        call_next = AsyncMock(return_value=MagicMock())

        await production_middleware.dispatch(request, call_next)

        # call_next must be called — auth was not blocking the request
        call_next.assert_called_once_with(request)

    @pytest.mark.asyncio
    async def test_internal_subpath_skips_auth(self, production_middleware):
        """Requests to nested /api/internal/ subpaths should also bypass auth."""
        request = MagicMock()
        request.url.path = "/api/internal/process-requests/run"
        request.method = "POST"

        call_next = AsyncMock(return_value=MagicMock())

        await production_middleware.dispatch(request, call_next)

        call_next.assert_called_once_with(request)

    @pytest.mark.asyncio
    async def test_non_internal_path_requires_auth(self, production_middleware):
        """Requests to non-internal paths must still enforce authentication."""
        request = MagicMock()
        request.url.path = "/api/scenarios"
        request.method = "GET"
        request.headers = {}  # No Authorization header

        call_next = AsyncMock(return_value=MagicMock())

        # Mock JWT extraction to return None (no valid token)
        production_middleware._extract_user_from_jwt = AsyncMock(return_value=None)

        response = await production_middleware.dispatch(request, call_next)

        # Without auth, should return 401, not pass to call_next
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_internal_prefix_not_confused_with_similar_paths(self, production_middleware):
        """Paths that start with /api/internal but lack the trailing slash are not bypassed."""
        # /api/internalize or similar should NOT get the bypass
        request = MagicMock()
        request.url.path = "/api/internalize"
        request.method = "GET"
        request.headers = {}  # No Authorization header

        call_next = AsyncMock(return_value=MagicMock())
        production_middleware._extract_user_from_jwt = AsyncMock(return_value=None)

        response = await production_middleware.dispatch(request, call_next)

        # This path should NOT bypass auth — must return 401
        assert response.status_code == 401

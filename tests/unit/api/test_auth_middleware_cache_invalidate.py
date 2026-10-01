"""The cache-invalidate endpoint must not be an unauthenticated public route.

`POST /api/metrics/cache/invalidate` used to sit on the auth middleware's skip
list while Caddy forwarded it to FastAPI, so anyone who could reach production
could clear every server cache and trigger a lodging cache warm. Service callers
(PocketBase) now use `/api/internal/metrics/cache/invalidate` (blocked at the
edge); the browser path is authenticated and gated on `bunking.manage`.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.auth_middleware import AuthMiddleware


@pytest.fixture
def production_middleware():
    app = MagicMock()
    with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
        with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
            with patch("bunking.auth_middleware.JWTValidator"):
                with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                    return AuthMiddleware(app, "production", "admin")


async def _dispatch(middleware, path: str, method: str = "POST"):
    request = MagicMock()
    request.url.path = path
    request.method = method
    request.headers = {}
    call_next = AsyncMock(return_value=MagicMock())
    middleware._extract_user_from_jwt = AsyncMock(return_value=None)
    response = await middleware.dispatch(request, call_next)
    return response, call_next


@pytest.mark.asyncio
async def test_public_invalidate_path_requires_auth(production_middleware):
    response, call_next = await _dispatch(production_middleware, "/api/metrics/cache/invalidate")
    assert response.status_code == 401
    call_next.assert_not_called()


@pytest.mark.asyncio
async def test_internal_invalidate_path_authenticates_like_other_internal_routes(production_middleware):
    _, call_next = await _dispatch(production_middleware, "/api/internal/metrics/cache/invalidate")
    call_next.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/health", "/solver/config"])
async def test_dead_skip_list_paths_are_not_public(production_middleware, path):
    """No route exists at these paths; a route added later must not be silently public."""
    response, call_next = await _dispatch(production_middleware, path, "GET")
    assert response.status_code == 401
    call_next.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/health", "/api/config"])
async def test_live_public_paths_stay_public(production_middleware, path):
    _, call_next = await _dispatch(production_middleware, path, "GET")
    call_next.assert_called_once()

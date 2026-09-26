"""AuthMiddleware applies the view-as persona after loading real permissions.

Never imports api.main (it poisons auth for the whole xdist run).
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers

from bunking.auth_middleware import AuthMiddleware, AuthUser
from bunking.rbac.dependencies import require_admin, require_permission

EMAIL = "riley@example.com"


@pytest.fixture
def production_middleware() -> AuthMiddleware:
    app = MagicMock()
    with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
        with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
            with patch("bunking.auth_middleware.JWTValidator"):
                with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                    return AuthMiddleware(app, "production", "admin")


def _seed_real_access(mw: AuthMiddleware, *, is_admin: bool, permissions: list[str]) -> None:
    """Real access arrives through the middleware's own 60 s cache, as in production."""
    mw._permissions_cache[f"perms:{EMAIL}"] = {
        "permissions": list(permissions),
        "is_admin": is_admin,
        "expires": time.time() + 60,
    }


async def _dispatch(mw: AuthMiddleware, headers: dict[str, str]) -> AuthUser:
    request = MagicMock()
    request.url.path = "/api/scenarios"
    request.method = "GET"
    request.headers = Headers(headers)
    request.state = MagicMock()
    mw._extract_user_from_jwt = AsyncMock(  # type: ignore[method-assign]
        return_value=AuthUser(username="riley", email=EMAIL, display_name="Riley Sam", groups=[], is_admin=False)
    )
    await mw.dispatch(request, AsyncMock(return_value=MagicMock()))
    user: AuthUser = request.state.user
    return user


@pytest.mark.asyncio
async def test_admin_persona_is_applied(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=["sheets.export"])
    user = await _dispatch(production_middleware, {"X-Kindred-View-As": "registration.manage,metrics.geo"})
    assert user.is_admin is False
    assert user.permissions == {"registration.manage", "metrics.geo"}


@pytest.mark.asyncio
async def test_header_name_is_case_insensitive(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=[])
    user = await _dispatch(production_middleware, {"x-kindred-view-as": "none"})
    assert user.is_admin is False
    assert user.permissions == set()


@pytest.mark.asyncio
async def test_non_admin_header_is_inert(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=False, permissions=["bunking.manage"])
    user = await _dispatch(production_middleware, {"X-Kindred-View-As": "users.manage"})
    assert user.is_admin is False
    assert user.permissions == {"bunking.manage"}


@pytest.mark.asyncio
async def test_no_header_leaves_admin_untouched(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=["sheets.export"])
    user = await _dispatch(production_middleware, {})
    assert user.is_admin is True
    assert user.permissions == {"sheets.export"}


@pytest.mark.asyncio
async def test_persona_never_pollutes_the_permissions_cache(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=["sheets.export"])
    await _dispatch(production_middleware, {"X-Kindred-View-As": "none"})
    after = await _dispatch(production_middleware, {})
    assert after.is_admin is True
    assert after.permissions == {"sheets.export"}
    cached = production_middleware._permissions_cache[f"perms:{EMAIL}"]
    assert cached["is_admin"] is True
    assert cached["permissions"] == ["sheets.export"]


@pytest.mark.asyncio
async def test_previewing_admin_is_refused_admin_routes(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=[])
    user = await _dispatch(production_middleware, {"X-Kindred-View-As": "bunking.manage"})
    with pytest.raises(HTTPException) as exc:
        require_admin(user)
    assert exc.value.status_code == 403
    assert require_permission("bunking.manage")(user) is user
    with pytest.raises(HTTPException) as exc:
        require_permission("metrics.financial")(user)
    assert exc.value.status_code == 403


# The persona is recorded beside the real person on every financial-aid write
# (campership spec §14.4), so the user object must say which persona applied.
# The email stays the real signed-in person's.


@pytest.mark.asyncio
async def test_an_applied_persona_is_named_on_the_user(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=[])
    user = await _dispatch(production_middleware, {"X-Kindred-View-As": " financial_aid.view, financial_aid.casework "})
    assert user.email == EMAIL
    assert user.view_as == "financial_aid.casework,financial_aid.view"


@pytest.mark.asyncio
async def test_the_empty_persona_is_named_none(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=True, permissions=[])
    user = await _dispatch(production_middleware, {"X-Kindred-View-As": "none"})
    assert user.view_as == "none"


@pytest.mark.asyncio
async def test_no_persona_applied_is_none(production_middleware: AuthMiddleware) -> None:
    _seed_real_access(production_middleware, is_admin=False, permissions=["bunking.manage"])
    ignored = await _dispatch(production_middleware, {"X-Kindred-View-As": "users.manage"})
    assert ignored.view_as is None
    _seed_real_access(production_middleware, is_admin=True, permissions=[])
    plain = await _dispatch(production_middleware, {})
    assert plain.view_as is None

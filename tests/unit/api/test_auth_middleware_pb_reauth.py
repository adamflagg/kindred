"""AuthMiddleware's cached PocketBase admin token must not outlive a rotation.

When the superuser's ``tokenKey`` changes (its password was re-set, or an admin
rotated it), every cached token dies. PocketBase answers a dead token as a
guest: the ``users`` lookup then comes back 401/403, or 200 with no items, and
the signed-in staff member silently gets no permissions at all.

Mocked at the HTTP boundary with ``httpx.MockTransport``. Never imports
api.main (it poisons auth for the whole xdist run).
"""

import time
from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from bunking.auth_middleware import AuthMiddleware, AuthUser

EMAIL = "riley@example.com"
AUTH_PATH = "/api/collections/_superusers/auth-with-password"
USERS_PATH = "/api/collections/users/records"
_RealAsyncClient = httpx.AsyncClient


@pytest.fixture
def production_middleware() -> AuthMiddleware:
    app = MagicMock()
    with patch("bunking.auth_middleware._is_docker_environment", return_value=False):
        with patch.dict("os.environ", {"OIDC_ISSUER": "https://test.example.com"}):
            with patch("bunking.auth_middleware.JWTValidator"):
                with patch("bunking.auth_middleware.PocketBaseTokenValidator"):
                    return AuthMiddleware(app, "production", "admin")


@pytest.fixture(autouse=True)
def _pb_env() -> Iterator[None]:
    with patch.dict(
        "os.environ",
        {
            "POCKETBASE_URL": "http://pocketbase:8090",
            "POCKETBASE_ADMIN_EMAIL": "admin@example.com",
            "POCKETBASE_ADMIN_PASSWORD": "fictional-password",
        },
    ):
        yield


class FakePocketBase:
    def __init__(self, users: Callable[[httpx.Request], httpx.Response], tokens: list[str] | None = None) -> None:
        self.users = users
        self.tokens = tokens or ["fresh-token"]
        self.auth_calls = 0
        self.user_lookups: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == AUTH_PATH:
            token = self.tokens[min(self.auth_calls, len(self.tokens) - 1)]
            self.auth_calls += 1
            return httpx.Response(200, json={"token": token, "record": {"id": "su0000000000001"}})
        if request.url.path == USERS_PATH:
            self.user_lookups.append(request)
            return self.users(request)
        return httpx.Response(404, json={})


def _install(fake: FakePocketBase) -> Any:
    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return _RealAsyncClient(*args, **kwargs)

    return patch.object(httpx, "AsyncClient", factory)


def _user_record(perms: list[str]) -> httpx.Response:
    return httpx.Response(
        200, json={"items": [{"id": "u000000000001", "cached_permissions": perms, "is_admin": False}]}
    )


def _user(email: str = EMAIL) -> AuthUser:
    return AuthUser(username="riley", email=email, display_name="Riley Sam", groups=[], is_admin=False)


def _seed_token(mw: AuthMiddleware, token: str = "dead-token") -> None:
    mw._pb_admin_token = token
    mw._pb_admin_token_expires = time.time() + 30


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403])
async def test_denied_lookup_drops_the_cached_token_and_retries_once(
    production_middleware: AuthMiddleware, status: int
) -> None:
    def users(request: httpx.Request) -> httpx.Response:
        if request.headers.get("Authorization") == "fresh-token":
            return _user_record(["bunking.manage"])
        return httpx.Response(status, json={"status": status, "message": "denied"})

    fake = FakePocketBase(users)
    _seed_token(production_middleware)
    user = _user()

    with _install(fake):
        await production_middleware._populate_user_permissions(user)

    assert user.permissions == {"bunking.manage"}
    assert fake.auth_calls == 1
    assert [r.headers.get("Authorization") for r in fake.user_lookups] == ["dead-token", "fresh-token"]
    assert production_middleware._pb_admin_token == "fresh-token"


@pytest.mark.asyncio
async def test_second_denial_does_not_loop(production_middleware: AuthMiddleware) -> None:
    fake = FakePocketBase(lambda request: httpx.Response(403, json={"status": 403, "message": "denied"}))
    _seed_token(production_middleware)
    user = _user()

    with _install(fake):
        await production_middleware._populate_user_permissions(user)

    assert user.permissions == set()
    assert fake.auth_calls == 1
    assert len(fake.user_lookups) == 2


@pytest.mark.asyncio
async def test_cached_token_lives_at_most_about_a_minute(production_middleware: AuthMiddleware) -> None:
    """The silent case: a dead token answers the users lookup 200-with-no-items, so nothing errors.

    The only defence is not trusting a cached token for long.
    """
    fake = FakePocketBase(lambda request: _user_record([]), tokens=["first-token", "second-token"])
    now = time.time()

    with _install(fake), patch("bunking.auth_middleware.time.time", return_value=now):
        assert await production_middleware._get_pb_admin_token() == "first-token"
    with _install(fake), patch("bunking.auth_middleware.time.time", return_value=now + 61):
        assert await production_middleware._get_pb_admin_token() == "second-token"

    assert fake.auth_calls == 2


@pytest.mark.asyncio
async def test_email_is_escaped_in_the_users_filter(production_middleware: AuthMiddleware) -> None:
    fake = FakePocketBase(lambda request: _user_record([]))
    user = _user(email='riley"||email!="@example.com')

    with _install(fake):
        await production_middleware._populate_user_permissions(user)

    assert len(fake.user_lookups) == 1
    assert fake.user_lookups[0].url.params["filter"] == 'email = "riley\\"||email!=\\"@example.com"'

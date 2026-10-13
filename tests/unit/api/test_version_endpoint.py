"""GET /api/version: the api image reports the version CD baked into it.

CD rebuilds only the images whose files changed, so each component reports its
own version and the frontend shows the newest. Any signed-in user may read it;
an anonymous request is refused.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthMiddleware, AuthUser


@pytest.fixture
def client():
    with patch.dict("os.environ", {"SKIP_PB_AUTH": "true"}):
        from api.main import create_app

        yield TestClient(create_app())


def test_returns_the_baked_version(client, monkeypatch):
    monkeypatch.setenv("KINDRED_VERSION", "v6.4.0-248-gc35904c")
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json() == {"api": "v6.4.0-248-gc35904c"}


@pytest.mark.parametrize("value", [None, ""])
def test_reads_dev_when_nothing_is_baked(client, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("KINDRED_VERSION", raising=False)
    else:
        monkeypatch.setenv("KINDRED_VERSION", value)
    assert client.get("/api/version").json() == {"api": "dev"}


@contextmanager
def _production_client(user: AuthUser | None) -> Iterator[TestClient]:
    """The app under production auth, with JWT extraction stubbed to `user`.

    Starlette builds the middleware stack on the first request, so the patches
    stay open until the caller is done with the client.
    """

    def production_middleware(app, _mode, admin_group):
        return AuthMiddleware(app, "production", admin_group)

    with (
        patch.dict("os.environ", {"SKIP_PB_AUTH": "true", "OIDC_ISSUER": "https://test.example.com"}),
        patch("bunking.auth_middleware._is_docker_environment", return_value=False),
        patch("bunking.auth_middleware.JWTValidator"),
        patch("bunking.auth_middleware.PocketBaseTokenValidator"),
        patch("api.main.create_auth_middleware", production_middleware),
        patch.object(AuthMiddleware, "_extract_user_from_jwt", AsyncMock(return_value=user)),
        patch.object(AuthMiddleware, "_populate_user_permissions", AsyncMock()),
    ):
        from api.main import create_app

        yield TestClient(create_app())


@pytest.mark.parametrize(
    ("user", "status"),
    [
        (None, 401),
        # Any signed-in user, no admin and no permissions.
        (AuthUser("emma", "emma.johnson@example.com", "Emma Johnson", [], is_admin=False), 200),
    ],
    ids=["anonymous-refused", "signed-in-allowed"],
)
def test_production_auth_gates_on_sign_in_only(monkeypatch, user, status):
    monkeypatch.setenv("KINDRED_VERSION", "v6.4.0-248-gc35904c")
    with _production_client(user) as client:
        response = client.get("/api/version")

    assert response.status_code == status
    if status == 200:
        assert response.json() == {"api": "v6.4.0-248-gc35904c"}
    else:
        assert "v6.4.0" not in response.text

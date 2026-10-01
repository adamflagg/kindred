"""Both cache-invalidate routes: internal (service) and browser (bunking.manage or registration.manage).

Lives under tests/unit/api/ so the conftest applies AUTH_MODE=bypass before
`api.main` builds its app (avoids xdist auth pollution).
"""

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.main import app
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission

INTERNAL = "/api/internal/metrics/cache/invalidate"
BROWSER = "/api/metrics/cache/invalidate"


def _user(*, admin: bool = False, permissions: set[str] | None = None) -> AuthUser:
    u = AuthUser("test_user", "test@example.com", "Test User", [], admin)
    u.permissions = permissions or set()
    return u


@pytest.fixture
def client() -> Iterator[TestClient]:
    with patch("api.routers.metrics.schedule_lodging_warm"):
        yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def test_internal_route_clears_caches_without_a_user(client: TestClient) -> None:
    with patch("api.routers.metrics.metrics_cache") as cache:
        cache.invalidate_all.return_value = 3
        r = client.post(INTERNAL)
    assert r.status_code == 200
    assert r.json() == {"cleared": 3}


def test_internal_route_scopes_by_sync_type(client: TestClient) -> None:
    with (
        patch("api.routers.metrics.sync_invalidates_lodging_cache", return_value=False) as scoped,
        patch("api.routers.metrics.lodging_cache") as lodging,
    ):
        r = client.post(INTERNAL, params={"sync_type": "bunk_assignments"})
    assert r.status_code == 200
    scoped.assert_called_once_with("bunk_assignments")
    lodging.invalidate_all.assert_not_called()


def test_browser_route_refuses_user_without_permission(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    with patch("api.routers.metrics.metrics_cache") as cache:
        r = client.post(BROWSER)
    assert r.status_code == 403
    cache.invalidate_all.assert_not_called()


def test_browser_route_allows_bunking_manage(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user(permissions={Permission.BUNKING_MANAGE})
    with patch("api.routers.metrics.metrics_cache") as cache:
        cache.invalidate_all.return_value = 1
        r = client.post(BROWSER)
    assert r.status_code == 200
    assert r.json() == {"cleared": 1}


def test_browser_route_allows_admin(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user(admin=True)
    r = client.post(BROWSER)
    assert r.status_code == 200


def test_browser_route_allows_registration_manage(client: TestClient) -> None:
    """Registrars save on ManageRegistrationPage and its callers clear this cache."""
    app.dependency_overrides[get_current_user] = lambda: _user(permissions={Permission.REGISTRATION_MANAGE})
    with patch("api.routers.metrics.metrics_cache") as cache:
        cache.invalidate_all.return_value = 2
        r = client.post(BROWSER)
    assert r.status_code == 200
    assert r.json() == {"cleared": 2}


def test_browser_route_refuses_unrelated_permission(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user(permissions={Permission.SHEETS_EXPORT})
    r = client.post(BROWSER)
    assert r.status_code == 403

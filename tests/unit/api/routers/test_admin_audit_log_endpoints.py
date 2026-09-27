"""Admin audit log endpoints: admin only, and a preview is not an admin (spec §6, §7).

Builds a bare FastAPI app rather than importing api.main -- importing api.main
from a test poisons auth for the whole xdist run."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from api.schemas.admin_audit_log import AuditLogActors, AuditLogPage
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.view_as import decide_view_as
from tests.unit.rbac.permission_personas import assert_persona_access

URL = "/api/admin/audit-log"


def _router() -> APIRouter:
    with patch("api.routers.admin_audit_log.pb", MagicMock()):
        from api.routers.admin_audit_log import router
    return router


def _client(user: AuthUser) -> TestClient:
    app = FastAPI()
    app.include_router(_router())
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


def _admin() -> AuthUser:
    return AuthUser(
        username="AlexRivera", email="alex.rivera@example.com", display_name="Alex Rivera", groups=[], is_admin=True
    )


def _admin_previewing(header: str) -> AuthUser:
    """What bunking/auth_middleware.py makes of an admin sending X-Kindred-View-As."""
    user = _admin()
    decision = decide_view_as(user.is_admin, user.permissions, header)
    assert decision.applied
    user.is_admin = decision.is_admin
    user.permissions = set(decision.permissions)
    return user


def _empty_page() -> AuditLogPage:
    return AuditLogPage(items=[], page=1, per_page=10, total=0)


def test_every_persona_is_refused() -> None:
    """none, exec without finance, registrar, finance, development: all 403."""
    with patch("api.routers.admin_audit_log.AdminAuditLogService") as service_cls:
        service_cls.return_value.list_page = AsyncMock(return_value=_empty_page())
        service_cls.return_value.list_actors = AsyncMock(return_value=AuditLogActors(actors=[]))
        assert_persona_access(_router(), "GET", URL, allowed=[])
        assert_persona_access(_router(), "GET", URL + "/actors", allowed=[])


def test_an_admin_is_let_through_and_a_previewing_admin_is_not() -> None:
    with patch("api.routers.admin_audit_log.AdminAuditLogService") as service_cls:
        service_cls.return_value.list_page = AsyncMock(return_value=_empty_page())
        service_cls.return_value.list_actors = AsyncMock(return_value=AuditLogActors(actors=[]))
        assert _client(_admin()).get(URL).status_code == 200
        assert _client(_admin()).get(URL + "/actors").status_code == 200
        for header in ("users.manage", "none"):
            assert _client(_admin_previewing(header)).get(URL).status_code == 403
            assert _client(_admin_previewing(header)).get(URL + "/actors").status_code == 403


def test_params_reach_the_service() -> None:
    with patch("api.routers.admin_audit_log.AdminAuditLogService") as service_cls:
        service_cls.return_value.list_page = AsyncMock(return_value=_empty_page())
        response = _client(_admin()).get(
            URL,
            params=[
                ("type", "access"),
                ("type", "roles"),
                ("actor", "alex.rivera@example.com"),
                ("q", "Cabin 14"),
                ("sign_ins", "true"),
                ("page", "2"),
                ("per_page", "25"),
            ],
        )
    assert response.status_code == 200
    service_cls.return_value.list_page.assert_awaited_once_with(
        types=["access", "roles"], actor="alex.rivera@example.com", q="Cabin 14", sign_ins=True, page=2, per_page=25
    )


def test_defaults_are_page_one_ten_rows_no_sign_ins() -> None:
    with patch("api.routers.admin_audit_log.AdminAuditLogService") as service_cls:
        service_cls.return_value.list_page = AsyncMock(return_value=_empty_page())
        assert _client(_admin()).get(URL).status_code == 200
    service_cls.return_value.list_page.assert_awaited_once_with(
        types=[], actor=None, q=None, sign_ins=False, page=1, per_page=10
    )


def test_bad_params_are_422() -> None:
    client = _client(_admin())
    with patch("api.routers.admin_audit_log.AdminAuditLogService"):
        assert client.get(URL, params={"per_page": 20}).status_code == 422
        assert client.get(URL, params={"page": 0}).status_code == 422
        assert client.get(URL, params={"type": "sign_in"}).status_code == 422  # sign-ins use the chip
        assert client.get(URL, params={"type": "bunking"}).status_code == 422

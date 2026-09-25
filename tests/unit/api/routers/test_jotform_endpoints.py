"""kindred#2759: every Jotform admin endpoint is bunking.manage-only, and the
service's two errors map to 404 / 422.

Builds a bare FastAPI app rather than importing api.main -- importing api.main
from a test poisons auth for the whole xdist run."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.jotform import JotformFormsResponse
from api.services.jotform_admin_service import JotformNotFoundError, JotformValidationError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission


def _user(*permissions: str) -> AuthUser:
    user = AuthUser(
        username="TestStaff", email="staff@example.com", display_name="Test Staff", groups=[], is_admin=False
    )
    user.permissions = set(permissions)
    return user


def _client(user: AuthUser) -> TestClient:
    with patch("api.routers.jotform.pb", MagicMock()):
        from api.routers.jotform import router
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_a_caller_without_bunking_manage_is_refused_everywhere() -> None:
    client = _client(_user())
    for method, url in [
        ("get", "/api/jotform/forms?year=2026"),
        ("put", "/api/jotform/forms/1000002?year=2026"),
        ("get", "/api/jotform/queue?year=2026"),
        ("post", "/api/jotform/submissions/6600000000000000001/link"),
        ("post", "/api/jotform/submissions/6600000000000000001/ignore"),
        ("post", "/api/jotform/submissions/6600000000000000001/unlink"),
    ]:
        response = client.request(method.upper(), url, json={"form_ref": "1", "person_cm_id": 1})
        assert response.status_code == 403, (method, url)


def test_forms_list_for_a_manager() -> None:
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.build_forms = AsyncMock(return_value=JotformFormsResponse(year=2026))
        response = _client(_user(Permission.BUNKING_MANAGE)).get("/api/jotform/forms", params={"year": 2026})
    assert response.status_code == 200
    assert response.json() == {"year": 2026, "rows": []}


def test_service_errors_map_to_404_and_422() -> None:
    client = _client(_user(Permission.BUNKING_MANAGE))
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.save_form = AsyncMock(side_effect=JotformValidationError("paste the ID"))
        bad = client.put("/api/jotform/forms/1000002", params={"year": 2026}, json={"form_ref": "x"})
        service_cls.return_value.link = AsyncMock(side_effect=JotformNotFoundError("no such submission"))
        missing = client.post("/api/jotform/submissions/6600000000000000009/link", json={"person_cm_id": 1000005})
    assert (bad.status_code, bad.json()["detail"]) == (422, "paste the ID")
    assert missing.status_code == 404


def test_a_vanity_form_link_is_a_422_that_says_where_the_id_is() -> None:
    # Owner ruling: the 2026 forms' public links carry no id -- say where to find it.
    repo = MagicMock()
    repo.fetch_adult_sessions = AsyncMock(return_value=[SimpleNamespace(cm_id=1000002, name="Women's Weekend")])
    repo.upsert_form = AsyncMock()
    with patch("api.routers.jotform.JotformRepository", return_value=repo):
        response = _client(_user(Permission.BUNKING_MANAGE)).put(
            "/api/jotform/forms/1000002",
            params={"year": 2026},
            json={"form_ref": "https://form.jotform.com/SomeCamp/Womens-Weekend-2026"},
        )
    assert response.status_code == 422
    assert "builder" in response.json()["detail"]
    assert "/build/" in response.json()["detail"]
    repo.upsert_form.assert_not_awaited()


def test_link_returns_204_and_passes_the_actor() -> None:
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.link = AsyncMock(return_value=None)
        response = _client(_user(Permission.BUNKING_MANAGE)).post(
            "/api/jotform/submissions/6600000000000000001/link", json={"person_cm_id": 1000005}
        )
    assert response.status_code == 204
    service_cls.return_value.link.assert_awaited_once_with("6600000000000000001", 1000005, "staff@example.com")


def test_the_write_in_link_is_bunking_manage_only() -> None:
    body = {"unit_id": "u_cedar", "occupant_name": "Pat Doe"}
    refused = _client(_user()).post("/api/jotform/submissions/6600000000000000001/write-in", json=body)
    assert refused.status_code == 403
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.link_write_in = AsyncMock(return_value=None)
        ok = _client(_user(Permission.BUNKING_MANAGE)).post(
            "/api/jotform/submissions/6600000000000000001/write-in", json=body
        )
    assert ok.status_code == 204
    service_cls.return_value.link_write_in.assert_awaited_once_with(
        "6600000000000000001", "u_cedar", "Pat Doe", "staff@example.com"
    )


def test_a_write_in_link_the_service_refuses_is_a_422() -> None:
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.link_write_in = AsyncMock(side_effect=JotformValidationError("not on this board"))
        response = _client(_user(Permission.BUNKING_MANAGE)).post(
            "/api/jotform/submissions/6600000000000000001/write-in",
            json={"unit_id": "u_cedar", "occupant_name": "Pat Doe"},
        )
    assert (response.status_code, response.json()["detail"]) == (422, "not on this board")

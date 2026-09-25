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


# --- The weekend Requests tab (kindred#2828 ruling 2026-09-25) ----------------


def test_the_weekend_queue_is_bunking_manage_only() -> None:
    response = _client(_user()).get(
        "/api/jotform/queue", params={"year": 2026, "session_cm_id": 1000002, "scenario": "scn_a"}
    )
    assert response.status_code == 403


def test_the_weekend_queue_passes_the_weekend_and_scenario_through() -> None:
    from api.schemas.jotform import JotformQueueResponse

    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.build_queue = AsyncMock(
            return_value=JotformQueueResponse(year=2026, session_cm_id=1000002, scenario="scn_a")
        )
        client = _client(_user(Permission.BUNKING_MANAGE))
        scoped = client.get("/api/jotform/queue", params={"year": 2026, "session_cm_id": 1000002, "scenario": "scn_a"})
        yearly = client.get("/api/jotform/queue", params={"year": 2026})
    assert (scoped.status_code, yearly.status_code) == (200, 200)
    assert scoped.json()["scenario"] == "scn_a"
    calls = service_cls.return_value.build_queue.await_args_list
    assert calls[0].args == (2026,)
    assert calls[0].kwargs == {"session_cm_id": 1000002, "scenario": "scn_a"}
    assert calls[1].kwargs == {"session_cm_id": None, "scenario": ""}


def test_a_refused_weekend_queue_maps_to_404_and_422() -> None:
    client = _client(_user(Permission.BUNKING_MANAGE))
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.build_queue = AsyncMock(side_effect=JotformNotFoundError("not this weekend's"))
        other = client.get("/api/jotform/queue", params={"year": 2026, "session_cm_id": 1000002, "scenario": "x"})
        service_cls.return_value.build_queue = AsyncMock(side_effect=JotformValidationError("name the weekend"))
        bare = client.get("/api/jotform/queue", params={"year": 2026, "scenario": "x"})
    assert (other.status_code, other.json()["detail"]) == (404, "not this weekend's")
    assert (bare.status_code, bare.json()["detail"]) == (422, "name the weekend")


# --- One filer, one decision (kindred#2839 follow-up) ---------------------------


def test_an_action_that_also_moved_the_filers_other_filings_names_them() -> None:
    from api.schemas.jotform import JotformActionResult, JotformSiblingFiling

    result = JotformActionResult(
        action="ignored",
        also=[
            JotformSiblingFiling(
                submission_id="6600000000000000002", submitted_name="Emma Johnson", submitted_at="2026-08-09 09:00:00"
            )
        ],
    )
    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.ignore = AsyncMock(return_value=result)
        response = _client(_user(Permission.BUNKING_MANAGE)).post("/api/jotform/submissions/6600000000000000001/ignore")
    assert response.status_code == 200
    assert response.json() == {
        "action": "ignored",
        "also": [
            {
                "submission_id": "6600000000000000002",
                "submitted_name": "Emma Johnson",
                "submitted_at": "2026-08-09 09:00:00",
            }
        ],
    }


def test_an_action_that_moved_only_the_clicked_filing_stays_a_204() -> None:
    from api.schemas.jotform import JotformActionResult

    with patch("api.routers.jotform.JotformAdminService") as service_cls:
        service_cls.return_value.unlink = AsyncMock(return_value=JotformActionResult(action="unlinked"))
        response = _client(_user(Permission.BUNKING_MANAGE)).post("/api/jotform/submissions/6600000000000000001/unlink")
    assert (response.status_code, response.content) == (204, b"")

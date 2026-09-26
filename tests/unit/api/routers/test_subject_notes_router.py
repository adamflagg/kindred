"""/api/subject-notes -- the HTTP contract over SubjectNoteService.

`bunking.manage` gates reading as well as writing (owner, 2026-09-25). The
check is not redundant with the collection rules: the API reaches PocketBase
with its own credentials. Fictional data throughout.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.subject_notes import SubjectNoteOut, SubjectNotesResponse, SubjectNoteWriteResponse
from api.services.subject_note_service import (
    NothingToPromoteError,
    PromotedNoteTooLongError,
    ScenarioNotFoundError,
    SubjectNoteScopeError,
)
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission

WRITE = {"subject_kind": "person", "subject_cm_id": 1000101, "session_cm_id": 1000001, "year": 2026, "body": "Hi"}
PROMOTE = {
    "subject_kind": "person",
    "subject_cm_id": 1000101,
    "session_cm_id": 1000001,
    "year": 2026,
    "scenario": "scnA",
}
ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/api/subject-notes?session_cm_id=1000001&year=2026", None),
    ("PUT", "/api/subject-notes", WRITE),
    ("POST", "/api/subject-notes/promote", PROMOTE),
]
NOTE = SubjectNoteOut(
    subject_kind="person",
    subject_cm_id=1000101,
    session_cm_id=1000001,
    scenario="",
    body="Hi",
    updated_by="Test Bunking Staff",
    updated="2026-09-25T12:00:00+00:00",
)


def _user(*, manage: bool) -> AuthUser:
    user = AuthUser(
        username="TestBunkingStaff",
        email="test@example.com",
        display_name="Test Bunking Staff",
        groups=[],
        is_admin=False,
    )
    user.permissions = {Permission.BUNKING_MANAGE} if manage else set()
    return user


def _client(service: MagicMock, *, manage: bool = True) -> TestClient:
    from api.routers.subject_notes import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _user(manage=manage)
    # Stopped by the autouse `_stop_patches` fixture below.
    patch("api.routers.subject_notes._service", return_value=service).start()
    return TestClient(app)


@pytest.fixture
def service() -> MagicMock:
    svc = MagicMock()
    svc.list_for_board = AsyncMock(return_value=[NOTE])
    svc.save = AsyncMock(return_value=SubjectNoteWriteResponse(note=NOTE, deleted=False))
    svc.promote = AsyncMock(return_value=SubjectNoteWriteResponse(note=NOTE, deleted=False))
    return svc


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


class TestRequiresBunkingManage:
    @pytest.mark.parametrize(("verb", "path", "body"), ENDPOINTS)
    def test_a_user_without_the_permission_is_refused(
        self, service: MagicMock, verb: str, path: str, body: dict[str, Any] | None
    ) -> None:
        response = _client(service, manage=False).request(verb, path, json=body)
        assert response.status_code == 403, f"{verb} {path} did not refuse a user without bunking.manage"
        assert Permission.BUNKING_MANAGE in response.json()["detail"]

    @pytest.mark.parametrize(("verb", "path", "body"), ENDPOINTS)
    def test_bunking_staff_are_allowed(
        self, service: MagicMock, verb: str, path: str, body: dict[str, Any] | None
    ) -> None:
        assert _client(service).request(verb, path, json=body).status_code == 200


class TestContract:
    def test_get_passes_the_board_scope_and_returns_notes(self, service: MagicMock) -> None:
        response = _client(service).get("/api/subject-notes?session_cm_id=1000001&year=2026&scenario=scnA")
        assert response.status_code == 200
        assert SubjectNotesResponse.model_validate(response.json()).notes == [NOTE]
        service.list_for_board.assert_awaited_once_with(session_cm_id=1000001, year=2026, scenario="scnA")

    def test_put_records_the_users_display_name(self, service: MagicMock) -> None:
        _client(service).put("/api/subject-notes", json=WRITE)
        assert service.save.await_args.kwargs["updated_by"] == "Test Bunking Staff"

    @pytest.mark.parametrize(
        ("error", "status"),
        [
            (SubjectNoteScopeError("wrong session"), 422),
            (PromotedNoteTooLongError("too long"), 422),
            (ScenarioNotFoundError("gone"), 404),
            (NothingToPromoteError("nothing"), 404),
        ],
    )
    def test_domain_errors_map_to_statuses(self, service: MagicMock, error: Exception, status: int) -> None:
        service.promote = AsyncMock(side_effect=error)
        response = _client(service).post("/api/subject-notes/promote", json=PROMOTE)
        assert response.status_code == status
        assert response.json()["detail"] == str(error)

    def test_a_scenario_with_filter_syntax_never_reaches_the_service(self, service: MagicMock) -> None:
        response = _client(service).get('/api/subject-notes?session_cm_id=1000001&year=2026&scenario=a"b')
        assert response.status_code == 422
        service.list_for_board.assert_not_awaited()


def test_the_app_registers_the_router() -> None:
    """FastAPI 0.141.1 wraps an included router's routes in objects with no
    `.path` -- read the registered paths back through the OpenAPI schema
    instead (controller ruling B2, 2026-09-25)."""
    from api.main import app

    paths = set(app.openapi()["paths"])
    assert "/api/subject-notes" in paths
    assert "/api/subject-notes/promote" in paths

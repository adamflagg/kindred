"""Staff-added request routes: permission, shapes, error mapping, and the rebuild after a write.

Builds a bare FastAPI app rather than importing api.main -- importing api.main from a test poisons auth for the
whole xdist run. Fictional ids only."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_intake import (
    AddedRequestOut,
    AdditionBulkResult,
    AdditionItemReport,
    AdditionOut,
    AnswerOut,
    RequestOut,
)
from api.services.financial_aid_casework_service import (
    AdditionItem,
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
)
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    assert_persona_access,
    assert_requires_permission,
    persona_user,
)

RID = "req000000000001"
AID = "add000000000001"
REQUEST = RequestOut(
    id=RID,
    household_cm_id=1000007,
    person_cm_id=1000071,
    session_cm_id=1000501,
    program_key="summer",
    program_option_text="Winter Retreat",
    session_resolution="staff",
    status="active",
    duplicate_of="",
    ask=AnswerOut(
        field="ask", synced="600.00", effective="600.00", corrected=False, changed_since_correction=False, history=[]
    ),
    headcount_non_infant=0,
    headcount_infant=0,
    headcount_source="",
    flags=[],
    origin="added",
)
ADDITION = AdditionOut(
    id=AID,
    year=2027,
    household_cm_id=1000007,
    person_cm_id=1000071,
    program_key="summer",
    session_cm_id=1000501,
    ask=600.0,
    source="staff",
    reason="Retreat",
    actor="staff@example.com",
    retired_at="",
    retired_by="",
    retire_reason="",
    request_id=RID,
)
ADDED = AddedRequestOut(addition=ADDITION, request=REQUEST)
ITEM = {"household_cm_id": 1000007, "person_cm_id": 1000071, "session_cm_id": 1000501, "ask": 600, "reason": "Retreat"}

ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "/api/financial-aid/requests/2027/additions", ITEM),
    (
        "POST",
        "/api/financial-aid/requests/2027/additions/bulk",
        {"reason": "sitting", "dry_run": True, "items": [ITEM]},
    ),
    ("POST", f"/api/financial-aid/requests/2027/additions/{AID}/retire", {"reason": "Entered in error"}),
]


def _bulk(*, dry_run: bool, written: bool) -> AdditionBulkResult:
    return AdditionBulkResult(
        year=2027,
        dry_run=dry_run,
        written=written,
        operation_id="op0000000000001" if written else None,
        items=[
            AdditionItemReport(
                index=0,
                household_cm_id=1000007,
                person_cm_id=1000071,
                session_cm_id=1000501,
                ask=600.0,
                program_key="summer",
                ok=True,
                error="",
                holder_id="",
                addition_id=AID if written else "",
                request_id=RID if written else "",
            )
        ],
    )


def _stub() -> MagicMock:
    stub = MagicMock()
    stub.add_request = AsyncMock(return_value=ADDED)
    stub.add_requests = AsyncMock(return_value=_bulk(dry_run=True, written=False))
    stub.retire_addition = AsyncMock(return_value=ADDED)
    return stub


@contextmanager
def _client(user: AuthUser, stub: MagicMock, rebuild: AsyncMock | None = None) -> Iterator[TestClient]:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    app.dependency_overrides[get_current_user] = lambda: user
    with (
        patch.object(financial_aid, "_casework", return_value=stub),
        patch.object(financial_aid, "_rebuild_intake", rebuild or AsyncMock(return_value=True)),
    ):
        yield TestClient(app)


@pytest.mark.parametrize(("method", "url", "body"), ROUTES)
def test_every_addition_route_needs_casework(method: str, url: str, body: Any) -> None:
    from api.routers import financial_aid

    with (
        patch.object(financial_aid, "_casework", return_value=_stub()),
        patch.object(financial_aid, "_rebuild_intake", AsyncMock(return_value=True)),
    ):
        assert_persona_access(
            financial_aid.router, method, url, allowed={PERSONA_REGISTRAR, PERSONA_FINANCE}, json=body
        )


def test_every_addition_handler_declares_casework() -> None:
    from api.routers import financial_aid as r

    for endpoint in (r.add_aid_request, r.add_aid_requests_bulk, r.retire_aid_request_addition):
        assert_requires_permission(endpoint, Permission.FINANCIAL_AID_CASEWORK)


def test_adding_one_reaches_the_service_with_the_callers_email_then_rebuilds_the_season() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub, rebuild) as client:
        response = client.post("/api/financial-aid/requests/2027/additions", json=ITEM)
    assert response.status_code == 201
    assert response.json()["request"]["origin"] == "added"
    stub.add_request.assert_awaited_once_with(
        2027, 1000007, 1000071, 1000501, 600.0, "Retreat", user.email, round1_campminder=None
    )
    rebuild.assert_awaited_once_with(2027)


def test_a_bulk_dry_run_reaches_the_service_and_rebuilds_nothing() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_FINANCE)
    body = {"reason": "sitting", "dry_run": True, "items": [ITEM, {**ITEM, "reason": ""}]}
    with _client(user, stub, rebuild) as client:
        response = client.post("/api/financial-aid/requests/2027/additions/bulk", json=body)
    assert response.status_code == 200
    stub.add_requests.assert_awaited_once_with(
        2027,
        [AdditionItem(1000007, 1000071, 1000501, 600.0, "Retreat"), AdditionItem(1000007, 1000071, 1000501, 600.0, "")],
        "sitting",
        user.email,
        dry_run=True,
    )
    rebuild.assert_not_awaited()


def test_a_written_bulk_rebuilds_the_season_and_a_refused_one_does_not() -> None:
    written, rebuild = _stub(), AsyncMock(return_value=True)
    written.add_requests = AsyncMock(return_value=_bulk(dry_run=False, written=True))
    body = {"reason": "sitting", "dry_run": False, "items": [ITEM]}
    with _client(persona_user(PERSONA_FINANCE), written, rebuild) as client:
        assert client.post("/api/financial-aid/requests/2027/additions/bulk", json=body).status_code == 200
    rebuild.assert_awaited_once_with(2027)

    refused, rebuild = _stub(), AsyncMock(return_value=True)
    refused.add_requests = AsyncMock(return_value=_bulk(dry_run=False, written=False))
    with _client(persona_user(PERSONA_FINANCE), refused, rebuild) as client:
        response = client.post("/api/financial-aid/requests/2027/additions/bulk", json=body)
    assert response.status_code == 422  # all or nothing: a refused item refuses the load, and the report says why
    assert response.json()["detail"]["items"][0]["ok"] is True
    rebuild.assert_not_awaited()


def test_retiring_reaches_the_service_then_rebuilds_the_season() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub, rebuild) as client:
        response = client.post(
            f"/api/financial-aid/requests/2027/additions/{AID}/retire", json={"reason": "Entered in error"}
        )
    assert response.status_code == 200
    stub.retire_addition.assert_awaited_once_with(2027, AID, "Entered in error", user.email)
    rebuild.assert_awaited_once_with(2027)


def test_addition_errors_map_to_404_409_and_422() -> None:
    stub = _stub()
    stub.add_request = AsyncMock(side_effect=DuplicateRequestError("req000000000009"))
    stub.retire_addition = AsyncMock(side_effect=CaseworkNotFoundError("no such added request"))
    with _client(persona_user(PERSONA_FINANCE), stub) as client:
        taken = client.post("/api/financial-aid/requests/2027/additions", json=ITEM)
        missing = client.post(f"/api/financial-aid/requests/2027/additions/{AID}/retire", json={"reason": "r"})
    stub.add_request = AsyncMock(side_effect=CaseworkValidationError("not enrolled"))
    with _client(persona_user(PERSONA_FINANCE), stub) as client:
        refused = client.post("/api/financial-aid/requests/2027/additions", json=ITEM)
        blank = client.post(f"/api/financial-aid/requests/2027/additions/{AID}/retire", json={"reason": ""})
    assert (taken.status_code, taken.json()["detail"]["holder_id"]) == (409, "req000000000009")
    assert missing.status_code == 404
    assert (refused.status_code, refused.json()["detail"]) == (422, "not enrolled")
    assert blank.status_code == 422


def test_a_bulk_load_is_bounded() -> None:
    with _client(persona_user(PERSONA_FINANCE), _stub()) as client:
        empty = client.post("/api/financial-aid/requests/2027/additions/bulk", json={"reason": "r", "items": []})
        no_reason = client.post("/api/financial-aid/requests/2027/additions/bulk", json={"reason": "", "items": [ITEM]})
    assert (empty.status_code, no_reason.status_code) == (422, 422)

"""POST /money/{year}/to-place/{transaction_cm_id}/preview (campership slice 3, ask 8): casework only, the body the
place route takes, and it never calls a write. Builds a bare FastAPI app (SP2's persona_client) rather than
importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_to_place import PartOut, PlacePreviewOut
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.auth_middleware import get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, PERSONAS, persona_client, persona_user

REQ = "reqemma00000001"
URL = "/api/financial-aid/money/2031/to-place/9001/preview"
BODY = {"parts": [{"request_id": REQ, "amount": "1500"}], "note": "Split by hand"}
PREVIEW = PlacePreviewOut(
    year=2031, transaction_cm_id=9001, parts=[PartOut(request_id=REQ, amount=1500.0)], would_lock=1500.0
)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.ToPlaceService").start().return_value
    service.preview = AsyncMock(return_value=PREVIEW)
    service.place = AsyncMock()
    service.place_lines = AsyncMock()
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _client(persona: str = PERSONA_REGISTRAR) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_only_casework_previews_a_placement(persona: str) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).post(URL, json=BODY).status_code == expected, persona


def test_view_alone_cannot_preview() -> None:
    """No persona holds view without casework, so the gate is checked on its own."""
    from api.routers.financial_aid import router

    _stub()
    user = persona_user(PERSONA_REGISTRAR)
    user.permissions = {Permission.FINANCIAL_AID_VIEW}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    assert TestClient(app, raise_server_exceptions=False).post(URL, json=BODY).status_code == 403


def test_the_route_previews_the_line_and_body_and_never_writes() -> None:
    service = _stub()
    response = _client().post(URL, json=BODY)
    assert response.status_code == 200
    assert response.json()["would_lock"] == 1500.0
    year, txn, body, actor = service.preview.call_args.args
    assert (year, txn, [p.request_id for p in body.parts], body.note) == (2031, 9001, [REQ], "Split by hand")
    assert actor == persona_user(PERSONA_REGISTRAR).email
    service.place.assert_not_awaited()
    service.place_lines.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (DecisionNotFoundError("no live camp-aid line 9001 in 2031"), 404),
        (DecisionRefusedError("the parts add up"), 422),
    ],
)
def test_a_refusal_maps_as_the_place_routes_do(error: Exception, status: int) -> None:
    service = _stub()
    service.preview = AsyncMock(side_effect=error)
    assert _client().post(URL, json=BODY).status_code == status


@pytest.mark.parametrize(
    "body",
    [
        {"parts": []},
        {"parts": [{"request_id": REQ, "amount": "0"}]},
        {"parts": [{"request_id": REQ, "amount": "10.005"}]},
        {"parts": [{"request_id": REQ, "amount": "10"}, {"request_id": REQ, "amount": "20"}]},
    ],
)
def test_a_malformed_preview_is_422(body: dict[str, Any]) -> None:
    _stub()
    assert _client().post(URL, json=body).status_code == 422

"""Grants endpoints (sub-project 6-core): the permission matrix over SP2's personas, and the
service-error mapping. Builds a bare FastAPI app (SP2's persona_client) rather than importing
api.main, which poisons auth for xdist. Task 2 adds the directory routes; Tasks 3, 6, 7 and 8
extend ROUTES and _stub."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid_grants import GrantorOut, GrantorsResponse, GrantsResponse, PlaceGrantsOut
from api.services.financial_aid_grants_service import GrantorKeyTakenError
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONAS,
    persona_client,
    persona_user,
)

VIEW, CASEWORK, RULES = Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_CASEWORK, Permission.FINANCIAL_AID_RULES

GRANTOR = GrantorOut(
    key="regional_fund",
    name="Regional Fund",
    aliases=[],
    full_coverage=False,
    covers_canteen="unknown",
    eligibility="",
    contacts="",
    descriptions=[],
)
GRANTOR_BODY = {"key": "regional_fund", "name": "Regional Fund", "note": "New grantor"}
SAVE_BODY = {"name": "Regional Fund", "note": "Finance review"}
PLACE_BODY = {"placements": [{"transaction_cm_id": 9001, "person_cm_id": 1001}]}

# (method, url, json body, permission required, success status)
ROUTES: list[tuple[str, str, dict[str, Any] | None, str, int]] = [
    ("GET", "/api/financial-aid/grantors", None, VIEW, 200),
    ("POST", "/api/financial-aid/grantors", GRANTOR_BODY, RULES, 201),
    ("PUT", "/api/financial-aid/grantors/regional_fund", SAVE_BODY, RULES, 200),
    ("GET", "/api/financial-aid/grants/2031", None, VIEW, 200),
    ("POST", "/api/financial-aid/grants/2031/placements", PLACE_BODY, CASEWORK, 200),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.GrantsService").start().return_value
    service.list_grantors = AsyncMock(return_value=GrantorsResponse(grantors=[GRANTOR]))
    service.create_grantor = AsyncMock(return_value=GRANTOR)
    service.save_grantor = AsyncMock(return_value=GRANTOR)
    service.read = AsyncMock(
        return_value=GrantsResponse(year=2031, grants=[], needs_camper=[], unmapped=[], waiting=[], expected=[])
    )
    service.place = AsyncMock(return_value=PlaceGrantsOut(year=2031, placed=1, unchanged=0, operation_id="o" * 15))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = ok if needs in PERSONAS[persona] else 403
    assert response.status_code == expected, (persona, method, url, response.text)


@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), ROUTES)
def test_a_summary_only_user_reaches_no_grants_route(
    method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    """D57: development sees aggregates only, never a family's grants or the directory."""
    _stub()
    assert _client(PERSONA_DEVELOPMENT).request(method, url, json=body).status_code == 403


def test_the_actor_is_the_callers_email() -> None:
    service = _stub()
    client = _client()
    client.post("/api/financial-aid/grantors", json=GRANTOR_BODY)
    client.put("/api/financial-aid/grantors/regional_fund", json=SAVE_BODY)
    client.post("/api/financial-aid/grants/2031/placements", json=PLACE_BODY)
    email = persona_user(PERSONA_FINANCE).email
    assert service.create_grantor.call_args.args[1] == email
    assert service.save_grantor.call_args.args[2] == email
    assert service.place.call_args.args[2] == email


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (FinancialAidNotFoundError("no grantor"), 404),
        (GrantorKeyTakenError("taken"), 409),
        (FinancialAidValidationError("bad"), 422),
    ],
)
def test_service_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.create_grantor = AsyncMock(side_effect=error)
    assert _client().post("/api/financial-aid/grantors", json=GRANTOR_BODY).status_code == status


def test_a_grantor_note_is_required() -> None:
    _stub()
    body = {k: v for k, v in GRANTOR_BODY.items() if k != "note"}
    assert _client().post("/api/financial-aid/grantors", json=body).status_code == 422


def test_a_year_out_of_range_is_422() -> None:
    _stub()
    assert _client().get("/api/financial-aid/grants/1999").status_code == 422

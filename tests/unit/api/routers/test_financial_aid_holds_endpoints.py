"""Hold endpoints (follow-up 3b): the permission matrix over SP2's personas, the caller as actor,
body validation, and the error mapping. Builds a bare FastAPI app (SP2's persona_client) rather
than importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.schemas.financial_aid_decisions import DecisionWriteOut, HoldReleaseIn, ManualHoldIn
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, PERSONAS, persona_client, persona_user

REQ = "reqemma00000001"
WRITE = DecisionWriteOut(year=2027, written=1, unchanged=0, operation_id="o" * 15)
RELEASE = {"code": "placeholder_income", "released": True, "note": "Called the family"}
MANUAL = {"held": True, "note": "Waiting on the family's tax return"}
ROUTES: list[tuple[str, dict[str, Any]]] = [
    (f"/api/financial-aid/requests/{REQ}/hold-release", RELEASE),
    (f"/api/financial-aid/requests/{REQ}/manual-hold", MANUAL),
]


def _client(persona: str = PERSONA_REGISTRAR) -> Any:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.set_hold_release = AsyncMock(return_value=WRITE)
    service.set_manual_hold = AsyncMock(return_value=WRITE)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("url", "body"), ROUTES)
def test_permission_matrix(persona: str, url: str, body: dict[str, Any]) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).post(url, json=body).status_code == expected, (persona, url)


def test_the_caller_is_the_actor_and_the_body_reaches_the_service() -> None:
    service = _stub()
    client = _client()
    client.post(ROUTES[0][0], json=RELEASE)
    client.post(ROUTES[1][0], json=MANUAL)
    email = persona_user(PERSONA_REGISTRAR).email
    assert service.set_hold_release.call_args.args == (REQ, HoldReleaseIn(**RELEASE), email)
    assert service.set_manual_hold.call_args.args == (REQ, ManualHoldIn(**MANUAL), email)


@pytest.mark.parametrize(
    ("url", "body"),
    [
        (ROUTES[0][0], {"code": "placeholder_income", "released": True}),
        (ROUTES[0][0], {"code": "placeholder_income", "released": True, "note": "   "}),
        (ROUTES[0][0], {"code": "Placeholder Income", "released": True, "note": "x"}),
        (ROUTES[1][0], {"held": True}),
        ("/api/financial-aid/requests/not-an-id/manual-hold", MANUAL),
    ],
)
def test_a_missing_note_a_malformed_code_or_request_id_is_422(url: str, body: dict[str, Any]) -> None:
    _stub()
    assert _client().post(url, json=body).status_code == 422


@pytest.mark.parametrize(
    ("error", "status"),
    [(DecisionNotFoundError("no such request"), 404), (DecisionRefusedError("not on hold"), 422)],
)
def test_service_refusals_map_to_404_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.set_hold_release = AsyncMock(side_effect=error)
    response = _client().post(ROUTES[0][0], json=RELEASE)
    # The detail proves the service's refusal was mapped: a missing route is also a 404, with "Not Found".
    assert (response.status_code, response.json()["detail"]) == (status, str(error))

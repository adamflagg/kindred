"""The cost-override and Include-override writes (D22; slice 1 reads 5-6): the permission matrix over SP2's personas,
the caller as actor, body validation, and the error mapping. Builds a bare FastAPI app (persona_client)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.schemas.financial_aid_decisions import CostOverrideIn, DecisionWriteOut, IncludeIn
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, PERSONAS, persona_client, persona_user

REQ = "reqemma00000001"
WRITE = DecisionWriteOut(year=2027, written=1, unchanged=0, operation_id="o" * 15)
COST = {"amount": "3500", "reason_code": "discount", "note": "Partial session agreed with the family"}
INCLUDE = {"included": False, "note": "Counted under a sibling's request"}
ROUTES: list[tuple[str, dict[str, Any]]] = [
    (f"/api/financial-aid/requests/{REQ}/cost-override", COST),
    (f"/api/financial-aid/requests/{REQ}/include", INCLUDE),
]


def _client(persona: str = PERSONA_REGISTRAR) -> Any:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.set_cost_override = AsyncMock(return_value=WRITE)
    service.set_include = AsyncMock(return_value=WRITE)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("url", "body"), ROUTES)
def test_the_overrides_are_casework(persona: str, url: str, body: dict[str, Any]) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).post(url, json=body).status_code == expected, (persona, url)


def test_the_caller_is_the_actor_and_the_body_reaches_the_service() -> None:
    service = _stub()
    client = _client()
    client.post(ROUTES[0][0], json=COST)
    client.post(ROUTES[1][0], json=INCLUDE)
    email = persona_user(PERSONA_REGISTRAR).email
    assert service.set_cost_override.call_args.args == (REQ, CostOverrideIn.model_validate(COST), email)
    assert service.set_include.call_args.args == (REQ, IncludeIn.model_validate(INCLUDE), email)


@pytest.mark.parametrize(
    ("error", "status"), [(DecisionNotFoundError("no such request"), 404), (DecisionRefusedError("no"), 422)]
)
def test_the_errors_map_like_the_other_request_writes(error: Exception, status: int) -> None:
    service = _stub()
    service.set_include = AsyncMock(side_effect=error)
    assert _client().post(ROUTES[1][0], json=INCLUDE).status_code == status


def test_an_amount_with_no_reason_code_is_422() -> None:
    _stub()
    assert _client().post(ROUTES[0][0], json={"amount": "3500", "note": "x"}).status_code == 422

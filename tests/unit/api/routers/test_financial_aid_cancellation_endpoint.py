"""POST /api/financial-aid/requests/{id}/cancellation (sub-project 10b-2; D101, D141): casework only,
the refusals' status codes, and D141's body rules. A bare FastAPI app (SP2's persona_client), never
api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid_decisions import CancellationIn, DecisionWriteOut
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

REQ = "reqemma00000001"
URL = f"/api/financial-aid/requests/{REQ}/cancellation"
BODY = {"cancelled": True, "reason": "medical"}
WRITE = DecisionWriteOut(year=2027, written=1, unchanged=0, operation_id="o" * 15)


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.set_cancellation = AsyncMock(return_value=WRITE)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_only_casework_cancels(persona: str) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).post(URL, json=BODY).status_code == expected


def test_the_caller_is_the_actor_and_the_body_reaches_the_service() -> None:
    service = _stub()
    _client(PERSONA_REGISTRAR).post(URL, json=BODY)
    assert service.set_cancellation.call_args.args == (
        REQ,
        CancellationIn(**BODY),
        persona_user(PERSONA_REGISTRAR).email,
    )


@pytest.mark.parametrize(
    ("error", "status"),
    [(DecisionNotFoundError("no such request"), 404), (DecisionRefusedError("CampMinder cancelled this"), 422)],
)
def test_refusals_map_to_404_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.set_cancellation = AsyncMock(side_effect=error)
    assert _client().post(URL, json=BODY).status_code == status


@pytest.mark.parametrize(
    "body",
    [
        {"cancelled": True},
        {"cancelled": True, "reason": "another_reason"},
        {"cancelled": False},
        {"cancelled": True, "reason": "moved"},
    ],
)
def test_a_body_breaking_d141s_rules_is_422(body: dict[str, Any]) -> None:
    _stub()
    assert _client().post(URL, json=body).status_code == 422

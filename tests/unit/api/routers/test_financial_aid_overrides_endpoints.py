"""The cost-override write (D22; slice 1 reads 5-6): the permission matrix over SP2's personas,
the caller as actor, body validation, and the error mapping. Builds a bare FastAPI app (persona_client)."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.schemas.financial_aid_decisions import CostOverrideIn, DecisionWriteOut
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, PERSONAS, persona_client, persona_user

REQ = "reqemma00000001"
WRITE = DecisionWriteOut(year=2027, written=1, unchanged=0, operation_id="o" * 15)
COST = {"amount": "3500", "reason_code": "discount", "note": "Partial session agreed with the family"}
ROUTES: list[tuple[str, dict[str, Any]]] = [
    (f"/api/financial-aid/requests/{REQ}/cost-override", COST),
]


def _client(persona: str = PERSONA_REGISTRAR) -> Any:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.set_cost_override = AsyncMock(return_value=WRITE)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("url", "body"), ROUTES)
def test_the_override_is_casework(persona: str, url: str, body: dict[str, Any]) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).post(url, json=body).status_code == expected, (persona, url)


def test_the_caller_is_the_actor_and_the_body_reaches_the_service() -> None:
    service = _stub()
    client = _client()
    client.post(ROUTES[0][0], json=COST)
    email = persona_user(PERSONA_REGISTRAR).email
    assert service.set_cost_override.call_args.args == (REQ, CostOverrideIn.model_validate(COST), email)


@pytest.mark.parametrize(
    ("error", "status"), [(DecisionNotFoundError("no such request"), 404), (DecisionRefusedError("no"), 422)]
)
@pytest.mark.parametrize(("url", "body"), ROUTES)
def test_the_errors_map_like_the_other_request_writes(
    url: str, body: dict[str, Any], error: Exception, status: int
) -> None:
    service = _stub()
    service.set_cost_override = AsyncMock(side_effect=error)
    assert _client().post(url, json=body).status_code == status


def test_a_headcount_with_no_approved_rules_takes_the_default_codes_and_its_code_reaches_the_service() -> None:
    """Decision 6: headcounts are keyed before the rules are approved, so the list falls back to the defaults."""
    from api.routers import financial_aid
    from api.services.financial_aid_casework_service import CaseworkValidationError
    from api.services.financial_aid_request_overrides import DEFAULT_REASON_CODES

    rules = MagicMock()
    rules.latest_approved = AsyncMock(return_value=None)
    patch.object(financial_aid, "_rules", return_value=rules).start()
    factory = patch.object(financial_aid, "FinancialAidCaseworkService").start()
    factory.return_value.set_headcount = AsyncMock(side_effect=CaseworkValidationError("stop here"))
    body = {"non_infant": 3, "infant": 1, "source": "declared", "reason": "r", "reason_code": "headcount"}
    assert _client().put(f"/api/financial-aid/requests/{REQ}/headcount", json=body).status_code == 422
    assert factory.return_value.set_headcount.call_args.kwargs["reason_code"] == "headcount"
    assert asyncio.run(factory.call_args.kwargs["reason_codes"](2027)) == DEFAULT_REASON_CODES


def test_an_amount_with_no_reason_code_is_422() -> None:
    _stub()
    assert _client().post(ROUTES[0][0], json={"amount": "3500", "note": "x"}).status_code == 422


def test_there_is_no_include_route() -> None:
    """Owner ruling: the Include override is removed; its route answers 404 or 405 for any caller."""
    _stub()
    status = _client().post(f"/api/financial-aid/requests/{REQ}/include", json={"included": False, "note": "x"})
    assert status.status_code in (404, 405)

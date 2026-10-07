"""Session capacity is dropped (owner ruling): no route, schema, service method or repository read is left.

The `aid_session_capacity` collection and its constant stay (no destructive migrations), so a past history row
still reads; nothing writes or serves it any more.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas import financial_aid_household_page, financial_aid_intake
from api.schemas.financial_aid_household_page import HouseholdRequestOut
from api.services import financial_aid_household_page as page_service
from api.services import financial_aid_intake_repository, financial_aid_intake_types
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_repository import FinancialAidRepository
from bunking.auth_middleware import AuthUser, get_current_user
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, persona_user


@pytest.mark.parametrize(
    ("method", "url"),
    [("GET", "/api/financial-aid/capacity/2027"), ("PUT", "/api/financial-aid/capacity/2027/1000101")],
)
def test_no_capacity_route_answers(method: str, url: str) -> None:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    user: AuthUser = persona_user(PERSONA_FINANCE)
    app.dependency_overrides[get_current_user] = lambda: user
    with patch.object(financial_aid, "_casework", return_value=MagicMock()):
        response = TestClient(app).request(method, url, json={"capacity": 120})
    assert response.status_code in (404, 405)


def test_the_router_registers_nothing_about_capacity() -> None:
    from api.routers import financial_aid

    assert [p for p in (getattr(r, "path", "") for r in financial_aid.router.routes) if "capacity" in p] == []


def test_the_intake_schemas_carry_no_capacity() -> None:
    assert [n for n in dir(financial_aid_intake) if n.startswith("Capacity")] == []


def test_the_household_page_carries_no_round_3_context() -> None:
    assert not hasattr(financial_aid_household_page, "Round3ContextOut")
    assert "round3_context" not in HouseholdRequestOut.model_fields


def test_no_service_or_repository_reads_or_writes_capacity() -> None:
    for owner in (FinancialAidCaseworkService, FinancialAidIntakeRepository, FinancialAidRepository):
        assert [n for n in dir(owner) if "capacit" in n or n == "fetch_session_counts"] == []
    assert not hasattr(financial_aid_intake_types, "CapacityRecord")
    assert not hasattr(financial_aid_intake_repository, "CapacityRecord")
    assert not hasattr(page_service, "round3_context")

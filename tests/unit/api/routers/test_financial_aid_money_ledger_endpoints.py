"""Money > Ledger's family read and its lines (campership slice 3, ask 1): the permission matrix (Money is view, D62),
the parameters each route passes, and the 422s. Builds a bare FastAPI app (SP2's persona_client)."""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid_money_ledger import MoneyLedgerLinesOut, MoneyLedgerOut
from api.services.financial_aid_money_ledger import LedgerFilters
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client

BASE = "/api/financial-aid/money/2031/ledger"
ROUTES = [BASE, f"{BASE}/lines?total=in_campminder_net"]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.MoneyLedgerService").start().return_value
    service.ledger = AsyncMock(return_value=MoneyLedgerOut(year=2031, rows=[], in_campminder_net=0, outside_grants=0))
    service.lines = AsyncMock(
        return_value=MoneyLedgerLinesOut(year=2031, total="in_campminder_net", amount=0, lines=[])
    )
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize("url", ROUTES)
def test_permission_matrix(persona: str, url: str) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_VIEW in PERSONAS[persona] else 403
    assert _client(persona).get(url).status_code == expected, (persona, url)


def test_the_routes_pass_the_day_the_axis_and_the_filters() -> None:
    service = _stub()
    client = _client()
    query = "as_of=2031-05-01&as_of_axis=recorded&source=other_outside&program=summer&level=household"
    response = client.get(f"{BASE}?{query}")
    assert response.status_code == 200, response.text
    assert service.ledger.call_args.args == (2031,)
    assert service.ledger.call_args.kwargs == {
        "as_of": date(2031, 5, 1),
        "axis": "recorded",
        "filters": LedgerFilters("other_outside", "summer", "household"),
    }
    response = client.get(f"{BASE}/lines?total=outside_grants")
    assert response.status_code == 200, response.text
    assert service.lines.call_args.args == (2031, "outside_grants")
    assert service.lines.call_args.kwargs == {"as_of": None, "axis": "campminder", "filters": LedgerFilters()}


@pytest.mark.parametrize(
    "url",
    [
        f"{BASE}?level=ambiguous",  # Go's level, not the Ledger's (D151)
        f"{BASE}?source=space_camp",
        f"{BASE}?program=unattributed",  # a reporting bucket, not a program
        f"{BASE}?as_of_axis=sideways",
        f"{BASE}/lines",  # a total is required
        f"{BASE}/lines?total=awarded",
        "/api/financial-aid/money/1999/ledger",
    ],
)
def test_an_unknown_value_is_422(url: str) -> None:
    _stub()
    assert _client().get(url).status_code == 422

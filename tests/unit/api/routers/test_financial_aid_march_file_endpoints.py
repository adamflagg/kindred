"""GET /decisions/{year}/march-file (campership slice 3, ask 6; S3-7: casework). Builds a bare FastAPI app (SP2's
persona_client) rather than importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_march_file import MarchFileOut
from bunking.auth_middleware import get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, PERSONAS, persona_client, persona_user

URL = "/api/financial-aid/decisions/2031/march-file"


def _stub() -> Any:
    service = patch("api.routers.financial_aid.MarchFileService").start().return_value
    service.read = AsyncMock(return_value=MarchFileOut(year=2031, rows=[]))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _client(persona: str = PERSONA_REGISTRAR) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_only_casework_downloads_the_march_file(persona: str) -> None:
    _stub()
    expected = 200 if Permission.FINANCIAL_AID_CASEWORK in PERSONAS[persona] else 403
    assert _client(persona).get(URL).status_code == expected, persona


def test_view_alone_cannot_download_it() -> None:
    """No persona holds view without casework, so the gate is checked on its own (S3-7: casework)."""
    from api.routers.financial_aid import router

    _stub()
    user = persona_user(PERSONA_REGISTRAR)
    user.permissions = {Permission.FINANCIAL_AID_VIEW}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    assert TestClient(app, raise_server_exceptions=False).get(URL).status_code == 403


def test_the_route_reads_the_season_asked_for() -> None:
    service = _stub()
    response = _client().get(URL)
    assert response.json() == {"year": 2031, "rows": [], "zero_left_out": 0}
    assert service.read.call_args.args == (2031,)


def test_the_route_sends_how_many_zero_round_1s_it_left_out() -> None:
    """Owner ruling E (10-06): the button says how many $0 Round 1 offers aren't in the file."""
    service = _stub()
    service.read = AsyncMock(return_value=MarchFileOut(year=2031, rows=[], zero_left_out=3))
    assert _client().get(URL).json()["zero_left_out"] == 3


def test_a_season_out_of_range_is_422() -> None:
    _stub()
    assert _client().get("/api/financial-aid/decisions/1999/march-file").status_code == 422

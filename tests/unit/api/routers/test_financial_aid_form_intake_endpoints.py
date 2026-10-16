"""PR 3's routes: Form intake's reads (view), Mark Reviewed (casework) and Add a Request…'s Round 1 field.

Builds a bare FastAPI app rather than importing api.main (it poisons auth for the whole xdist run). Fictional ids."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_form_intake import (
    AidOnNoRequestResponse,
    FormIntakeCountsOut,
    FormIntakeResponse,
    FormIntakeSummaryOut,
    UnlistedResponse,
)
from api.services.financial_aid_casework_service import CaseworkValidationError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.api.routers.test_financial_aid_request_additions_endpoints import ADDED, AID, ITEM, _stub
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    assert_requires_permission,
    persona_user,
)

COUNTS = FormIntakeCountsOut(needs_look=1, registration_only=0, all=2)


def _intake_stub() -> MagicMock:
    stub = MagicMock()
    stub.forms = AsyncMock(
        return_value=FormIntakeResponse(
            year=2027, rows=[], counts=COUNTS, sessions=[], grants_waiting_for_camper=0, campminder_aid_on_no_request=0
        )
    )
    stub.summary = AsyncMock(return_value=FormIntakeSummaryOut(year=2027, needs_look=1, registration_only=0, all=2))
    stub.aid_on_no_request = AsyncMock(
        return_value=AidOnNoRequestResponse(year=2026, total=0, families=0, lines=[], sessions=[])
    )
    stub.unlisted = AsyncMock(return_value=UnlistedResponse(year=2027, rows=[], sessions=[]))
    return stub


@contextmanager
def _client(user: AuthUser, casework: MagicMock | None = None, intake: MagicMock | None = None) -> Iterator[TestClient]:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    app.dependency_overrides[get_current_user] = lambda: user
    with (
        patch.object(financial_aid, "_casework", return_value=casework or _stub()),
        patch.object(financial_aid, "_form_intake", return_value=intake or _intake_stub()),
        patch.object(financial_aid, "_rebuild_intake", AsyncMock(return_value=True)),
    ):
        yield TestClient(app)


def test_the_reads_need_view_and_the_review_needs_casework() -> None:
    from api.routers import financial_aid as r

    for endpoint in (r.get_form_intake, r.get_form_intake_summary, r.get_aid_on_no_request, r.get_unlisted_campers):
        assert_requires_permission(endpoint, Permission.FINANCIAL_AID_VIEW)
    assert_requires_permission(r.review_aid_request_addition, Permission.FINANCIAL_AID_CASEWORK)


def test_the_reads_reach_the_service() -> None:
    intake = _intake_stub()
    with _client(persona_user(PERSONA_REGISTRAR), intake=intake) as client:
        assert client.get("/api/financial-aid/intake/2027/forms").json()["counts"]["needs_look"] == 1
        assert client.get("/api/financial-aid/intake/2027/summary").json()["needs_look"] == 1
        assert client.get("/api/financial-aid/intake/2026/aid-on-no-request").status_code == 200
        assert client.get("/api/financial-aid/intake/2027/unlisted", params={"q": "Sofia"}).status_code == 200
    intake.forms.assert_awaited_once_with(2027)
    intake.summary.assert_awaited_once_with(2027)
    intake.aid_on_no_request.assert_awaited_once_with(2026)
    intake.unlisted.assert_awaited_once_with(2027, "Sofia")


def test_add_carries_the_round_1_campminder_amount_to_the_service() -> None:
    casework = _stub()
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, casework) as client:
        response = client.post("/api/financial-aid/requests/2027/additions", json={**ITEM, "round1_campminder": 2258})
    assert response.status_code == 201
    casework.add_request.assert_awaited_once_with(
        2027, 1000007, 1000071, 1000501, 600.0, "Retreat", user.email, round1_campminder=2258.0
    )


@pytest.mark.parametrize("amount", [0, -5])
def test_a_round_1_amount_must_be_above_zero(amount: Any) -> None:
    with _client(persona_user(PERSONA_REGISTRAR)) as client:
        response = client.post("/api/financial-aid/requests/2027/additions", json={**ITEM, "round1_campminder": amount})
    assert response.status_code == 422


def test_mark_reviewed_reaches_the_service_and_maps_a_refusal() -> None:
    casework = _stub()
    casework.review_addition = AsyncMock(return_value=ADDED)
    user = persona_user(PERSONA_FINANCE)
    with _client(user, casework) as client:
        ok = client.post(f"/api/financial-aid/requests/2027/additions/{AID}/review")
    assert ok.status_code == 200
    casework.review_addition.assert_awaited_once_with(2027, AID, user.email)
    casework.review_addition = AsyncMock(
        side_effect=CaseworkValidationError("only a request made from a registration ask is reviewed")
    )
    with _client(user, casework) as client:
        refused = client.post(f"/api/financial-aid/requests/2027/additions/{AID}/review")
    assert refused.status_code == 422

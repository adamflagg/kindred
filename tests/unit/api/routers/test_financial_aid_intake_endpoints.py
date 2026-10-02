"""Campership intake endpoints: permission matrix and error mapping (spec 14.3).

Builds a bare FastAPI app rather than importing api.main -- importing api.main
from a test poisons auth for the whole xdist run."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_intake import (
    AnswerOut,
    ApplicationDetailResponse,
    ApplicationListResponse,
    CapacityListOut,
    CapacityOut,
    CorrectionOut,
    RequestOut,
    RequestQueueResponse,
)
from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
)
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_payer_shares import ShareSpec
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    assert_persona_access,
    assert_requires_permission,
    persona_user,
)

RID = "req000000000001"
ANSWER = AnswerOut(
    field="ask", synced="1.00", effective="1.00", corrected=False, changed_since_correction=False, history=[]
)
REQUEST = RequestOut(
    id=RID,
    household_cm_id=1000001,
    person_cm_id=1000011,
    session_cm_id=1000101,
    program_key="summer",
    program_option_text="Session 2",
    session_resolution="staff",
    status="active",
    duplicate_of="",
    ask=ANSWER,
    headcount_non_infant=0,
    headcount_infant=0,
    headcount_source="",
    flags=[],
)

ROUTES: list[tuple[str, str, dict[str, Any] | None, str]] = [
    ("GET", "/api/financial-aid/capacity/2027", None, "view"),
    ("GET", "/api/financial-aid/applications?year=2027", None, "view"),
    ("GET", "/api/financial-aid/applications/2027/1000001", None, "view"),
    ("GET", "/api/financial-aid/requests?year=2027&status=unmatched_session", None, "view"),
    (
        "POST",
        "/api/financial-aid/applications/2027/1000001/corrections",
        {"field": "total_gross_income", "new_value": "1", "reason": "r"},
        "casework",
    ),
    ("POST", f"/api/financial-aid/requests/{RID}/session", {"session_cm_id": 1000101, "reason": "r"}, "casework"),
    (
        "POST",
        f"/api/financial-aid/requests/{RID}/duplicate",
        {"duplicate_of": "req000000000002", "reason": "r"},
        "casework",
    ),
    (
        "PUT",
        f"/api/financial-aid/requests/{RID}/headcount",
        {"non_infant": 3, "infant": 1, "source": "declared", "reason": "r"},
        "casework",
    ),
    ("PUT", f"/api/financial-aid/requests/{RID}/payer-shares/1000009", {"share_pct": "40", "reason": "r"}, "casework"),
    (
        "PUT",
        f"/api/financial-aid/requests/{RID}/payer-shares",
        {
            "shares": [
                {"household_cm_id": 1000001, "share_pct": "50"},
                {"household_cm_id": 1000009, "share_pct": "50"},
            ],
            "reason": "r",
        },
        "casework",
    ),
    ("PUT", "/api/financial-aid/capacity/2027/1000101", {"capacity": 120}, "rules"),
]
ALLOWED = {
    "view": {PERSONA_REGISTRAR, PERSONA_FINANCE},
    "casework": {PERSONA_REGISTRAR, PERSONA_FINANCE},
    "rules": {PERSONA_FINANCE},
}


def _stub() -> MagicMock:
    stub = MagicMock()
    stub.capacities = AsyncMock(return_value=CapacityListOut(year=2027, sessions=[]))
    stub.list_applications = AsyncMock(return_value=ApplicationListResponse(year=2027, applications=[]))
    stub.application_detail = AsyncMock(
        return_value=ApplicationDetailResponse(
            year=2027,
            household_cm_id=1000001,
            status="active",
            member_person_cm_ids=[],
            answers=[],
            notes={},
            requests=[],
            flags=[],
        )
    )
    stub.list_requests = AsyncMock(
        return_value=RequestQueueResponse(year=2027, status="unmatched_session", requests=[])
    )
    stub.add_correction = AsyncMock(
        return_value=CorrectionOut(
            id="cor000000000001",
            field="total_gross_income",
            request_id="",
            new_value="1.00",
            original_value="0.00",
            reason="r",
            actor="staff@example.com",
            created="2027-01-01",
        )
    )
    stub.resolve_session = AsyncMock(return_value=REQUEST)
    stub.mark_duplicate = AsyncMock(return_value=REQUEST)
    stub.set_headcount = AsyncMock(return_value=REQUEST)
    stub.set_payer_shares = AsyncMock(return_value=REQUEST)
    stub.set_household_share = AsyncMock(return_value=REQUEST)
    stub.set_capacity = AsyncMock(
        return_value=CapacityOut(year=2027, session_cm_id=1000101, capacity=120, note="", actor="staff@example.com")
    )
    return stub


@contextmanager
def _client(user: AuthUser, stub: MagicMock) -> Iterator[TestClient]:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    app.dependency_overrides[get_current_user] = lambda: user
    with patch.object(financial_aid, "_casework", return_value=stub):
        yield TestClient(app)


@pytest.mark.parametrize(("method", "url", "body", "need"), ROUTES)
def test_every_route_lets_through_exactly_its_personas(method: str, url: str, body: Any, need: str) -> None:
    from api.routers import financial_aid

    with patch.object(financial_aid, "_casework", return_value=_stub()):
        assert_persona_access(financial_aid.router, method, url, allowed=ALLOWED[need], json=body)


def test_every_handler_declares_its_permission() -> None:
    from api.routers import financial_aid as r

    for endpoint, permission in (
        (r.list_aid_applications, Permission.FINANCIAL_AID_VIEW),
        (r.get_aid_application, Permission.FINANCIAL_AID_VIEW),
        (r.list_aid_requests, Permission.FINANCIAL_AID_VIEW),
        (r.add_aid_correction, Permission.FINANCIAL_AID_CASEWORK),
        (r.resolve_aid_request_session, Permission.FINANCIAL_AID_CASEWORK),
        (r.mark_aid_request_duplicate, Permission.FINANCIAL_AID_CASEWORK),
        (r.set_aid_request_headcount, Permission.FINANCIAL_AID_CASEWORK),
        (r.set_aid_request_payer_shares, Permission.FINANCIAL_AID_CASEWORK),
        (r.set_aid_request_household_share, Permission.FINANCIAL_AID_CASEWORK),
        (r.get_aid_session_capacities, Permission.FINANCIAL_AID_VIEW),
        (r.set_aid_session_capacity, Permission.FINANCIAL_AID_RULES),
    ):
        assert_requires_permission(endpoint, permission)


def test_payer_shares_reach_the_service_as_percentages_with_the_callers_email() -> None:
    stub = _stub()
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub) as client:
        response = client.put(
            f"/api/financial-aid/requests/{RID}/payer-shares",
            json={
                "shares": [
                    {"household_cm_id": 1000001, "share_pct": "60.0182"},
                    {"household_cm_id": 1000009, "share_pct": "39.9818"},
                ],
                "reason": "r",
            },
        )
        dollars = client.put(  # the whole-set route takes percentages only (owner ruling 2026-09-25)
            f"/api/financial-aid/requests/{RID}/payer-shares",
            json={"shares": [{"household_cm_id": 1000001, "share_amount": "300.00"}], "reason": "r"},
        )
    assert (response.status_code, dollars.status_code) == (200, 422)
    stub.set_payer_shares.assert_awaited_once_with(
        RID,
        [ShareSpec(1000001, Decimal("60.0182")), ShareSpec(1000009, Decimal("39.9818"))],
        "r",
        user.email,
    )


def test_one_households_share_is_a_percent_only_and_a_dollar_amount_is_ignored() -> None:
    # Owner ruling 2026-10-02: payer shares are percent only. The schema keeps pydantic's default
    # (extra fields ignored), so an old client's `amount` is dropped unread and the % applies;
    # an amount with no % is a missing share_pct, a 422.
    stub = _stub()
    user = persona_user(PERSONA_REGISTRAR)
    url = f"/api/financial-aid/requests/{RID}/payer-shares/1000009"
    with _client(user, stub) as client:
        both = client.put(url, json={"share_pct": "40", "amount": "880.00", "reason": "r"})
        amount_only = client.put(url, json={"amount": "880.00", "reason": "r"})
    assert (both.status_code, amount_only.status_code) == (200, 422)
    stub.set_household_share.assert_awaited_once_with(RID, 1000009, share_pct=Decimal(40), reason="r", actor=user.email)


def test_resolving_a_session_no_longer_remembers_anything() -> None:
    # Registration first (owner ruling 2026-09-27) removed session aliases. The schema ignores
    # unknown fields (pydantic's default), so an old client's remember_alias is dropped unread.
    stub = _stub()
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub) as client:
        response = client.post(
            f"/api/financial-aid/requests/{RID}/session",
            json={"session_cm_id": 1000101, "reason": "r", "remember_alias": True},
        )
    assert response.status_code == 200
    stub.resolve_session.assert_awaited_once_with(RID, 1000101, "r", user.email)


def test_service_errors_map_to_404_409_and_422() -> None:
    stub = _stub()
    stub.application_detail = AsyncMock(side_effect=CaseworkNotFoundError("no application"))
    stub.resolve_session = AsyncMock(side_effect=DuplicateRequestError("req000000000009"))
    stub.mark_duplicate = AsyncMock(side_effect=CaseworkValidationError("not the same camper"))
    stub.add_correction = AsyncMock(side_effect=CorrectionError("expected a whole number"))
    with _client(persona_user(PERSONA_FINANCE), stub) as client:
        missing = client.get("/api/financial-aid/applications/2027/1000099")
        taken = client.post(
            f"/api/financial-aid/requests/{RID}/session", json={"session_cm_id": 1000101, "reason": "r"}
        )
        bad = client.post(
            f"/api/financial-aid/requests/{RID}/duplicate", json={"duplicate_of": "req000000000002", "reason": "r"}
        )
        malformed = client.post(
            "/api/financial-aid/applications/2027/1000001/corrections",
            json={"field": "num_children", "new_value": "³", "reason": "r"},
        )
    assert missing.status_code == 404
    assert (taken.status_code, taken.json()["detail"]["holder_id"]) == (409, "req000000000009")
    assert (bad.status_code, bad.json()["detail"]) == (422, "not the same camper")
    assert (malformed.status_code, malformed.json()["detail"]) == (422, "expected a whole number")


def test_the_queue_can_narrow_to_requests_waiting_for_approved_rules() -> None:
    stub = _stub()
    with _client(persona_user(PERSONA_REGISTRAR), stub) as client:
        ok = client.get("/api/financial-aid/requests?year=2027&status=active&flag=awaiting_approved_rules")
        bad = client.get("/api/financial-aid/requests?year=2027&status=active&flag=everything")
    assert (ok.status_code, bad.status_code) == (200, 422)
    stub.list_requests.assert_awaited_once_with(2027, "active", "awaiting_approved_rules")


def test_an_unknown_queue_status_is_rejected_before_the_service() -> None:
    stub = _stub()
    with _client(persona_user(PERSONA_FINANCE), stub) as client:
        response = client.get("/api/financial-aid/requests?year=2027&status=everything")
    assert response.status_code == 422
    stub.list_requests.assert_not_awaited()

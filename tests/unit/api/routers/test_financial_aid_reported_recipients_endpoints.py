"""Reports › Development's "as reported" recipients routes (owner ruling 2026-10-16, CS-AGES25): the permission
matrix (finance's typed-history permission), what each route passes to its service, and how refusals map. A bare
FastAPI app (persona_client); never imports api.main. Fictional only."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from api.services.financial_aid_reported_recipients_service import ReportedRecipientNotFoundError
from fastapi.testclient import TestClient

from api.schemas.financial_aid_reports import ReportedRecipientsLoadOut, ReportedRecipientsResponse
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.change_log import AidWriteConflictError
from bunking.financial_aid.reports.recipients import ReportedRecipient
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client, persona_user

RULES = Permission.FINANCIAL_AID_RULES
BASE = "/api/financial-aid/reports"
RECIPIENT = {
    "year": 2025,
    "person_cm_id": 1000011,
    "household_cm_id": 1000001,
    "program": "summer",
    "source": "outside",
    "funder": "Regional Camp Fund",
    "amount": "1200.00",
    "sheet_tab": "Grants",
    "sheet_row": 4,
    "match": "household_birthdate",
}


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.ReportedRecipientsService").start().return_value
    service.listed = AsyncMock(return_value=ReportedRecipientsResponse(year=2025, recipients=[]))
    service.load = AsyncMock(return_value=ReportedRecipientsLoadOut(created=1, updated=0, unchanged=0, dry_run=False))
    service.delete = AsyncMock(return_value=None)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_recipients_routes_are_finances_like_typed_history(persona: str) -> None:
    _stub()
    allowed = RULES in PERSONAS[persona]
    client = _client(persona)
    read = client.get(f"{BASE}/2025/reported-recipients")
    load = client.post(f"{BASE}/reported-recipients/bulk", json={"recipients": [RECIPIENT]})
    delete = client.delete(f"{BASE}/reported-recipients/rrc000000000001", params={"reason": "wrong camper"})
    assert read.status_code == (200 if allowed else 403), persona
    assert load.status_code == (200 if allowed else 403), persona
    assert delete.status_code == (204 if allowed else 403), persona


def test_a_load_reaches_the_service_as_recipients_with_the_caller_and_the_dry_run() -> None:
    service = _stub()
    response = _client().post(f"{BASE}/reported-recipients/bulk", json={"recipients": [RECIPIENT], "dry_run": True})
    assert response.json() == {"created": 1, "updated": 0, "unchanged": 0, "dry_run": False}
    [recipients] = service.load.call_args.args
    assert recipients == [
        ReportedRecipient(
            year=2025,
            person_cm_id=1000011,
            household_cm_id=1000001,
            program="summer",
            source="outside",
            funder="Regional Camp Fund",
            amount=Decimal("1200.00"),
            sheet_tab="Grants",
            sheet_row=4,
            match="household_birthdate",
        )
    ]
    assert service.load.call_args.kwargs == {"actor": persona_user(PERSONA_FINANCE).email, "dry_run": True}


@pytest.mark.parametrize(
    "body",
    [
        {"recipients": []},
        {"recipients": [{**RECIPIENT, "source": "scholarship"}]},
        {"recipients": [{**RECIPIENT, "program": "quest"}]},
        {"recipients": [{**RECIPIENT, "match": "name"}]},
        {"recipients": [{**RECIPIENT, "amount": "1.234"}]},
        {"recipients": [{**RECIPIENT, "person_cm_id": 0}]},
        {"recipients": [{**RECIPIENT, "first_name": "Emma"}]},  # names never travel: extra fields are refused
        {"recipients": [RECIPIENT] * 1001},
    ],
)
def test_a_malformed_load_is_422_before_the_service(body: dict[str, Any]) -> None:
    service = _stub()
    assert _client().post(f"{BASE}/reported-recipients/bulk", json=body).status_code == 422
    service.load.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ReportsRefusedError("recipient 1: 1000099 has no registration in 2025"), 422),
        (AidWriteConflictError(collection="aid_reported_recipients", record_id="rrc1"), 409),
    ],
)
def test_load_refusals_map(error: Exception, status: int) -> None:
    service = _stub()
    service.load.side_effect = error
    response = _client().post(f"{BASE}/reported-recipients/bulk", json={"recipients": [RECIPIENT]})
    assert response.status_code == status
    if status == 422:
        assert "1000099" in response.json()["detail"]


def test_the_list_is_one_seasons_and_a_delete_needs_a_reason() -> None:
    service = _stub()
    assert _client().get(f"{BASE}/2025/reported-recipients").json() == {"year": 2025, "recipients": []}
    assert service.listed.call_args.args == (2025,)
    url = f"{BASE}/reported-recipients/rrc000000000001"
    assert _client().delete(url).status_code == 422
    assert _client().delete(url, params={"reason": "matched the wrong camper"}).status_code == 204
    assert service.delete.call_args.args == ("rrc000000000001",)
    assert service.delete.call_args.kwargs == {
        "reason": "matched the wrong camper",
        "actor": persona_user(PERSONA_FINANCE).email,
    }
    service.delete.side_effect = ReportedRecipientNotFoundError("no such recipient")
    assert _client().delete(url, params={"reason": "again"}).status_code == 404

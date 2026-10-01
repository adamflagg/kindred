"""Campership rules endpoints (the rules loader): the permission matrix over SP2's personas,
body validation that must stop before the service, and the service-error mapping. Builds a
bare FastAPI app (SP2's persona_client) rather than importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services.financial_aid_rules_service import (
    NotLatestVersionError,
    PricingVersionInUseError,
    RulesNotFoundError,
    RulesVersion,
    SectionChangedError,
    VersionExistsError,
)
from bunking.financial_aid.change_log import AidWriteConflictError
from bunking.financial_aid.rules import ValidationIssue, ValidationReport
from bunking.financial_aid.rules.lifecycle import LockedSectionError, SectionHasErrorsError, initial_status
from bunking.rbac.permissions import Permission
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client, persona_user

RULES = Permission.FINANCIAL_AID_RULES

VERSION = RulesVersion(
    record_id="rec000000000001",
    year=2031,
    version=1,
    document=fictional_rules(),
    section_status=initial_status(),
    parent_year=None,
    parent_version=None,
)
WARNED = ValidationReport(
    issues=[
        ValidationIssue(
            section="programs",
            code="no_sessions_to_check",
            severity="warning",
            path="programs",
            message="No sessions are synced for 2031",
        )
    ]
)
DOC_BODY = {"document": fictional_rules_json()}
APPROVE_BODY = {
    "sections": ["programs", "cost"],
    "note": "Finance, Oct 7 meeting",
    "fingerprints": {"programs": "a" * 64, "cost": "b" * 64},
}

ROUTES: list[tuple[str, str, dict[str, Any] | None, int]] = [
    ("GET", "/api/financial-aid/rules/2031", None, 200),
    ("POST", "/api/financial-aid/rules/2031/validate", DOC_BODY, 200),
    ("POST", "/api/financial-aid/rules/2031/versions", DOC_BODY, 201),
    ("POST", "/api/financial-aid/rules/2032/start-from-last-year", None, 201),
    ("PUT", "/api/financial-aid/rules/2031/versions/1", DOC_BODY, 200),
    ("POST", "/api/financial-aid/rules/2031/versions/1/approve", APPROVE_BODY, 200),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidRulesService").start().return_value
    service.load = AsyncMock(return_value=VERSION)
    service.validate_document = AsyncMock(return_value=WARNED)
    service.bootstrap = AsyncMock(return_value=VERSION)
    service.start_from_last_year = AsyncMock(return_value=(VERSION, WARNED))
    service.save = AsyncMock(return_value=(VERSION, WARNED))
    service.approve_sections = AsyncMock(return_value=(VERSION, WARNED))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "ok"), ROUTES)
def test_permission_matrix(persona: str, method: str, url: str, body: dict[str, Any] | None, ok: int) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = ok if RULES in PERSONAS[persona] else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_the_actor_is_the_callers_email() -> None:
    service = _stub()
    client = _client()
    client.post("/api/financial-aid/rules/2031/versions", json=DOC_BODY)
    client.post("/api/financial-aid/rules/2032/start-from-last-year")
    client.put("/api/financial-aid/rules/2031/versions/1", json=DOC_BODY)
    client.post("/api/financial-aid/rules/2031/versions/1/approve", json=APPROVE_BODY)
    email = persona_user(PERSONA_FINANCE).email
    for mock in (service.bootstrap, service.start_from_last_year, service.save, service.approve_sections):
        assert mock.await_args.kwargs["actor"] == email


def test_approve_passes_the_sections_in_order_and_the_note() -> None:
    service = _stub()
    _client().post("/api/financial-aid/rules/2031/versions/1/approve", json=APPROVE_BODY)
    call = service.approve_sections.await_args
    assert call.args == (2031, 1, ["programs", "cost"])
    assert call.kwargs["note"] == "Finance, Oct 7 meeting"
    assert call.kwargs["fingerprints"] == {"programs": "a" * 64, "cost": "b" * 64}


@pytest.mark.parametrize(
    "body",
    [
        {"sections": ["programs"], "note": "   "},  # D39: an approval names the approving body
        {"sections": ["programs"]},
        {"sections": [], "note": "Finance"},
        {"sections": ["canteen"], "note": "Finance"},  # not a section
        {"sections": ["programs"], "note": "Finance"},  # no fingerprints
        {"sections": ["programs", "cost"], "note": "Finance", "fingerprints": {"programs": "a"}},  # cost missing
        {"sections": ["programs"], "note": "Finance", "fingerprints": {"programs": "a", "cost": "b"}},  # cost extra
    ],
)
def test_a_bad_approval_is_422_and_never_reaches_the_service(body: dict[str, Any]) -> None:
    service = _stub()
    response = _client().post("/api/financial-aid/rules/2031/versions/1/approve", json=body)
    assert response.status_code == 422
    service.approve_sections.assert_not_called()


@pytest.mark.parametrize(
    ("method", "url", "call"),
    [
        ("POST", "/api/financial-aid/rules/2030/versions", "bootstrap"),
        ("PUT", "/api/financial-aid/rules/2030/versions/1", "save"),
        ("POST", "/api/financial-aid/rules/2030/validate", "validate_document"),
    ],
)
def test_a_document_for_another_year_is_422_before_the_service(method: str, url: str, call: str) -> None:
    service = _stub()
    response = _client().request(method, url, json=DOC_BODY)  # the document says 2031
    assert response.status_code == 422
    assert "2031" in response.json()["detail"]
    getattr(service, call).assert_not_called()


def test_a_document_that_is_not_a_rules_document_is_422() -> None:
    service = _stub()
    broken = fictional_rules_json()
    del broken["income"]
    response = _client().post("/api/financial-aid/rules/2031/versions", json={"document": broken})
    assert response.status_code == 422
    service.bootstrap.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (RulesNotFoundError("No aid rules for 2031 version 9"), 404),
        (VersionExistsError("2032 already has aid rules"), 409),
        (NotLatestVersionError("Version 1 of 2031 is not the latest"), 409),
        (PricingVersionInUseError("Version 1 of 2031 prices the season"), 409),
        (AidWriteConflictError(collection="aid_rules", record_id="rul000000000001"), 409),
        (SectionHasErrorsError("budget has 1 validation error(s)"), 422),
        (LockedSectionError(["income"]), 422),
    ],
)
def test_service_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.approve_sections = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/rules/2031/versions/1/approve", json=APPROVE_BODY)
    assert (response.status_code, response.json()["detail"]) == (status, str(error))


def test_bootstrapping_a_season_that_already_has_rules_is_409() -> None:
    service = _stub()
    error = VersionExistsError("2031 already has aid rules; save over the latest version instead")
    service.bootstrap = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/rules/2031/versions", json=DOC_BODY)
    assert (response.status_code, response.json()["detail"]) == (409, str(error))


def test_the_validation_report_comes_back_with_the_version() -> None:
    _stub()
    body = _client().post("/api/financial-aid/rules/2031/versions/1/approve", json=APPROVE_BODY).json()
    assert (body["year"], body["version"]) == (2031, 1)
    assert body["section_status"]["programs"]["state"] == "draft"
    assert [i["code"] for i in body["report"]["issues"]] == ["no_sessions_to_check"]


def test_get_passes_the_version_asked_for() -> None:
    service = _stub()
    _client().get("/api/financial-aid/rules/2031", params={"version": 3})
    assert service.load.await_args.args == (2031, 3)


def test_an_approval_of_a_section_changed_since_it_was_opened_is_409_naming_it() -> None:
    service = _stub()
    message = "Someone else saved programs since you opened it; reload to see their change"
    service.approve_sections = AsyncMock(side_effect=SectionChangedError(["programs"], message))
    response = _client().post("/api/financial-aid/rules/2031/versions/1/approve", json=APPROVE_BODY)
    assert (response.status_code, response.json()["detail"]) == (409, message)

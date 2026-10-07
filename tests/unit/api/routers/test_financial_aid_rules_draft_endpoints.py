"""SP9a's rules routes: the draft read, the section editor's save, a new version, and D76's approved read.
Permission matrix over SP2's personas, body validation before the service, and the error mapping. A bare
FastAPI app (persona_client), never api.main (it poisons auth for xdist)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services.financial_aid_rules_service import (
    BUDGET_TOTAL_LOCKED,
    ApprovedRules,
    ApprovedSection,
    BudgetTotalLockedError,
    DraftSection,
    NotLatestVersionError,
    RulesDraft,
    RulesNotFoundError,
    RulesVersion,
    SectionChangedError,
    SectionInvalidError,
    SectionSaveResult,
    section_fingerprint,
)
from bunking.financial_aid.change_diff import FieldChange
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.financial_aid.rules import ValidationReport
from bunking.financial_aid.rules.lifecycle import SectionStatus, initial_status
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.rbac.permissions import Permission
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

VERSION = RulesVersion(
    record_id="rec000000000001",
    year=2031,
    version=2,
    document=fictional_rules(),
    section_status=initial_status(),
    parent_year=2031,
    parent_version=1,
)
DRAFT = RulesDraft(
    version=VERSION,
    approved_version=1,
    report=ValidationReport(),
    sections=tuple(
        DraftSection(
            name,
            VERSION.section_status[name],
            (FieldChange(("minimum",), "changed", Decimal(100), Decimal(150)),) if name == "awards" else (),
            section_fingerprint(VERSION.document, name),
        )
        for name in SECTION_NAMES
    ),
)
APPROVED = ApprovedRules(
    year=2031, version=1, sections=tuple(ApprovedSection(name, SectionStatus(), None, None) for name in SECTION_NAMES)
)
AWARDS = fictional_rules_json()["awards"] | {"minimum": "150"}
SAVE_BODY = {"base_version": 2, "content": AWARDS, "expected_fingerprint": "f" * 64}

ROUTES: list[tuple[str, str, dict[str, Any] | None, int, str]] = [
    ("GET", "/api/financial-aid/rules/2031/draft", None, 200, Permission.FINANCIAL_AID_RULES),
    ("PUT", "/api/financial-aid/rules/2031/sections/awards", SAVE_BODY, 200, Permission.FINANCIAL_AID_RULES),
    (
        "POST",
        "/api/financial-aid/rules/2031/versions/2/new-version",
        {"unlock": ["round2"]},
        201,
        Permission.FINANCIAL_AID_RULES,
    ),
    ("GET", "/api/financial-aid/rules/2031/approved", None, 200, Permission.FINANCIAL_AID_VIEW),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidRulesService").start().return_value
    service.load = AsyncMock(return_value=VERSION)
    service.save_section = AsyncMock(return_value=SectionSaveResult(VERSION, ValidationReport(), 1))
    service.draft_view = AsyncMock(return_value=DRAFT)
    service.new_version = AsyncMock(return_value=VERSION)
    service.validate_document = AsyncMock(return_value=ValidationReport())
    service.approved_view = AsyncMock(return_value=APPROVED)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "ok", "needs"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, ok: int, needs: str
) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = ok if needs in PERSONAS[persona] else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_the_registrar_reads_the_approved_rules_but_not_the_draft() -> None:
    _stub()
    client = _client(PERSONA_REGISTRAR)
    assert client.get("/api/financial-aid/rules/2031/approved").status_code == 200
    assert client.get("/api/financial-aid/rules/2031/draft").status_code == 403


def test_a_section_save_sends_the_section_and_its_raw_content_and_reports_the_branch() -> None:
    service = _stub()
    body = _client().put("/api/financial-aid/rules/2031/sections/awards", json=SAVE_BODY).json()
    call = service.save_section.await_args
    assert call.args == (2031, 2, "awards", SAVE_BODY["content"])
    assert call.kwargs["actor"] == persona_user(PERSONA_FINANCE).email
    assert call.kwargs["expected_fingerprint"] == "f" * 64
    service.load.assert_not_called()  # the service loads the draft itself, so a save in between is never reverted
    assert body["branched_from"] == 1
    awards = next(s for s in body["sections"] if s["section"] == "awards")
    assert awards["changes"] == [{"path": ["minimum"], "kind": "changed", "before": "100", "after": "150"}]


def test_section_content_that_does_not_parse_is_422() -> None:
    service = _stub()
    service.save_section = AsyncMock(
        side_effect=SectionInvalidError("awards is not a valid section: awards.minimum: x")
    )
    bad = SAVE_BODY | {"content": fictional_rules_json()["awards"] | {"minimum": "-5"}}
    response = _client().put("/api/financial-aid/rules/2031/sections/awards", json=bad)
    assert response.status_code == 422
    assert "awards.minimum" in response.json()["detail"]


def test_an_unknown_section_is_422() -> None:
    service = _stub()
    response = _client().put("/api/financial-aid/rules/2031/sections/canteen", json=SAVE_BODY)
    assert response.status_code == 422
    service.save_section.assert_not_called()


def test_a_stale_editor_is_409() -> None:
    service = _stub()
    service.save_section = AsyncMock(side_effect=NotLatestVersionError("Version 2 of 2031 is not the rules draft"))
    assert _client().put("/api/financial-aid/rules/2031/sections/awards", json=SAVE_BODY).status_code == 409


def test_a_section_save_that_lost_a_race_is_409() -> None:
    service = _stub()
    service.save_section = AsyncMock(side_effect=AidWriteConflictError(collection="aid_rules", record_id="r" * 15))
    response = _client().put("/api/financial-aid/rules/2031/sections/awards", json=SAVE_BODY)
    assert (response.status_code, response.json()["detail"]) == (409, CONFLICT_MESSAGE)


def test_a_new_version_names_the_sections_it_unlocks() -> None:
    service = _stub()
    response = _client().post("/api/financial-aid/rules/2031/versions/2/new-version", json={"unlock": ["round2"]})
    assert response.status_code == 201
    call = service.new_version.await_args
    assert call.args == (2031, 2)
    assert list(call.kwargs["unlock"]) == ["round2"]
    assert call.kwargs["actor"] == persona_user(PERSONA_FINANCE).email


def test_the_approved_read_passes_a_receipts_version_and_404s_without_approved_rules() -> None:
    service = _stub()
    _client().get("/api/financial-aid/rules/2031/approved", params={"version": 3})
    assert service.approved_view.await_args.args == (2031, 3)
    service.approved_view = AsyncMock(side_effect=RulesNotFoundError("2031 has no approved rules yet"))
    assert _client().get("/api/financial-aid/rules/2031/approved").status_code == 404


def test_a_section_save_without_its_opening_fingerprint_is_422() -> None:
    service = _stub()
    body = {"base_version": 2, "content": AWARDS}
    assert _client().put("/api/financial-aid/rules/2031/sections/awards", json=body).status_code == 422
    service.save_section.assert_not_called()


def test_a_section_changed_since_it_was_opened_is_409_naming_it() -> None:
    service = _stub()
    message = "Someone else saved awards since you opened it; reload to see their change"
    service.save_section = AsyncMock(side_effect=SectionChangedError(["awards"], message))
    response = _client().put("/api/financial-aid/rules/2031/sections/awards", json=SAVE_BODY)
    assert (response.status_code, response.json()["detail"]) == (409, {"message": message, "sections": ["awards"]})


def test_the_draft_read_gives_each_section_its_fingerprint() -> None:
    _stub()
    body = _client().get("/api/financial-aid/rules/2031/draft").json()
    assert all(len(s["fingerprint"]) == 64 for s in body["sections"])


def test_the_draft_read_says_whether_the_budget_total_is_locked() -> None:
    service = _stub()
    assert _client().get("/api/financial-aid/rules/2031/draft").json()["budget_total_locked"] is False
    service.draft_view = AsyncMock(return_value=replace(DRAFT, budget_total_locked=True))
    assert _client().get("/api/financial-aid/rules/2031/draft").json()["budget_total_locked"] is True


def test_a_locked_budget_total_is_422_in_the_lock_words() -> None:
    service = _stub()
    service.save_section = AsyncMock(side_effect=BudgetTotalLockedError(BUDGET_TOTAL_LOCKED))
    body = SAVE_BODY | {"content": fictional_rules().budget.model_dump(mode="json") | {"total": "520000"}}
    response = _client().put("/api/financial-aid/rules/2031/sections/budget", json=body)
    assert (response.status_code, response.json()["detail"]) == (422, BUDGET_TOTAL_LOCKED)

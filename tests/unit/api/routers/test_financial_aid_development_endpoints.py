"""Reports › Development's route (Reports back end, Part B; clean spec §9.4; D65, D66, D90; main spec §14.3): view or
summary, and the containment test the Reports slice owns (formerly SP8's): development's response models carry
aggregates only, never a field that could name or identify a family, a camper or a request. A bare FastAPI app
(persona_client); never imports api.main."""

from __future__ import annotations

import re
from typing import Any, get_args
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from api.schemas.financial_aid_reports import DevelopmentResponse
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_DEVELOPMENT, PERSONAS, persona_client

URL = "/api/financial-aid/reports/2027/development"
# A family-level field: an id, a name, a household, a person, a camper or a request (D66: "no names, no ids").
# Counts ("campers", "families") and a ZIP (D90) are aggregates, not identities.
FAMILY_LEVEL = re.compile(r"household|person|camper_|request|family_name|_cm_id|\bid\b|email|address|postal|birth")


def _client(persona: str) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_development_is_for_view_or_summary(persona: str) -> None:
    """D65: Camperships opens with view OR summary; a summary-only user lands on Development."""
    service = patch("api.routers.financial_aid.FinancialAidDevelopmentService").start().return_value
    service.development = AsyncMock(side_effect=ReportsRefusedError("stub"))  # any non-403 proves the gate let it in
    held = set(PERSONAS[persona])
    expected = 422 if {Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_SUMMARY} & held else 403
    assert _client(persona).get(URL).status_code == expected, persona


def walk_models(model: type[BaseModel], seen: set[type[BaseModel]]) -> set[type[BaseModel]]:
    """Every pydantic model reachable from `model`'s fields, itself included."""
    if model in seen:
        return seen
    seen.add(model)
    for info in model.model_fields.values():
        stack: list[Any] = [info.annotation]
        while stack:
            annotation = stack.pop()
            if isinstance(annotation, type) and issubclass(annotation, BaseModel):
                walk_models(annotation, seen)
            else:  # list[X], X | None, Literal[...]: walk the arguments
                stack.extend(get_args(annotation))
    return seen


def test_developments_response_carries_no_family_level_field() -> None:
    """Main spec §14.3 (owned by the Reports slice, §12.3 item 5): every model development reads, walked to the
    leaves. `source_key` names a funding source (D88), never a family."""
    offenders = [
        f"{model.__name__}.{name}"
        for model in walk_models(DevelopmentResponse, set())
        for name in model.model_fields
        if FAMILY_LEVEL.search(name)
    ]
    assert offenders == []


def test_a_summary_only_user_reaches_no_other_report() -> None:
    """D65: the summary permission reads Development only (and the Remaining line, D48)."""
    patch("api.routers.financial_aid.FinancialAidReportsService").start()
    client = _client(PERSONA_DEVELOPMENT)
    for url in (
        "/api/financial-aid/reports/2027/statistics",
        "/api/financial-aid/reports/2027/programs",
        "/api/financial-aid/reports/2027/committee",
        "/api/financial-aid/reports/reported-history",
    ):
        assert client.get(url).status_code == 403, url

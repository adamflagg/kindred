"""Reports › Development's ZIP, dated columns and Funding sources routes (Reports back end, Part C; clean spec §9.4;
D65, D88, D90, D100): who reaches each, what the edits pass on, and the containment walk over their models. A bare
FastAPI app (persona_client); never imports api.main."""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid_reports import (
    DatedColumn,
    FundingSourceIn,
    FundingSourcesResponse,
    ReportColumnsResponse,
    ZipResponse,
)
from api.services.financial_aid_development_service import FunderNotFoundError, FundingSourceNotFoundError
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.api.routers.test_financial_aid_development_endpoints import FAMILY_LEVEL, walk_models
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

VIEW, SUMMARY = Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_SUMMARY
SOURCE_URL = "/api/financial-aid/reports/2027/funding-sources/src000000000001"


def _client(persona: str = PERSONA_DEVELOPMENT) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDevelopmentService").start().return_value
    for name in (
        "zip_codes",
        "report_columns",
        "save_report_columns",
        "funding_sources",
        "save_funding_source",
        "save_funder",
    ):
        setattr(service, name, AsyncMock(side_effect=ReportsRefusedError("stub")))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize(
    ("method", "url", "body"),
    [
        ("GET", "/api/financial-aid/reports/2027/development/zip", None),
        ("GET", "/api/financial-aid/reports/development/columns", None),
        ("PUT", "/api/financial-aid/reports/development/columns", {"columns": []}),
        ("GET", "/api/financial-aid/reports/2027/funding-sources", None),
    ],
)
@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_developments_other_screens_are_for_view_or_summary(persona: str, method: str, url: str, body: Any) -> None:
    """D65 (summary reaches Development and what it opens: ZIP, D90; Funding sources' list, D100)."""
    service = _stub()
    service.report_columns = AsyncMock(
        side_effect=None, return_value=ReportColumnsResponse(report="development", columns=[])
    )
    service.funding_sources = AsyncMock(
        side_effect=None, return_value=FundingSourcesResponse(year=2027, groups=[], sources=[])
    )
    expected = {VIEW, SUMMARY} & set(PERSONAS[persona])
    status = _client(persona).request(method, url, json=body).status_code
    assert (status != 403) == bool(expected), (persona, status)


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_development_and_finance_edit_a_funding_source_and_the_registrar_cannot(persona: str) -> None:
    """D100: "Development and finance may edit the group and the incentive flag; the registrar may not"."""
    _stub()
    held = set(PERSONAS[persona])
    allowed = {Permission.FINANCIAL_AID_FUNDING_SOURCES, Permission.FINANCIAL_AID_RULES} & held
    status = _client(persona).put(SOURCE_URL, json={"group": "camp_pool", "incentive": True}).status_code
    assert (status != 403) == bool(allowed), (persona, status)
    if persona == PERSONA_REGISTRAR:
        assert status == 403


FUNDER_URL = "/api/financial-aid/reports/2027/funding-sources/funders/regional_fund"


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_a_funder_row_is_edited_by_whoever_edits_a_funding_source(persona: str) -> None:
    _stub()
    allowed = {Permission.FINANCIAL_AID_FUNDING_SOURCES, Permission.FINANCIAL_AID_RULES} & set(PERSONAS[persona])
    status = _client(persona).put(FUNDER_URL, json={"group": "camp_pool", "incentive": True}).status_code
    assert (status != 403) == bool(allowed), (persona, status)


def test_a_funder_edit_reaches_the_service_and_maps_not_found_to_404() -> None:
    service = _stub()
    _client(PERSONA_DEVELOPMENT).put(FUNDER_URL, json={"group": None, "incentive": True, "note": "why"})
    assert service.save_funder.call_args.args == (
        2027,
        "regional_fund",
        FundingSourceIn(group=None, incentive=True, note="why"),
    )
    assert service.save_funder.call_args.kwargs == {"actor": persona_user(PERSONA_DEVELOPMENT).email}
    service.save_funder = AsyncMock(side_effect=FunderNotFoundError("none"))
    assert _client(PERSONA_FINANCE).put(FUNDER_URL, json={"group": None, "incentive": False}).status_code == 404


def test_an_edit_reaches_the_service_with_the_caller_and_maps_its_refusals() -> None:
    service = _stub()
    _client(PERSONA_DEVELOPMENT).put(SOURCE_URL, json={"group": "camp_pool", "incentive": True, "note": "why"})
    assert service.save_funding_source.call_args.args == (
        2027,
        "src000000000001",
        FundingSourceIn(group="camp_pool", incentive=True, note="why"),
    )
    assert service.save_funding_source.call_args.kwargs == {"actor": persona_user(PERSONA_DEVELOPMENT).email}
    service.save_funding_source = AsyncMock(side_effect=FundingSourceNotFoundError("none"))
    assert _client(PERSONA_FINANCE).put(SOURCE_URL, json={"group": None, "incentive": False}).status_code == 404
    assert _client(PERSONA_FINANCE).put(SOURCE_URL, json={"incentive": False, "extra": 1}).status_code == 422


def test_saved_columns_reach_the_service() -> None:
    service = _stub()
    _client().put(
        "/api/financial-aid/reports/development/columns", json={"columns": [{"season": 2027, "as_of": "2027-04-12"}]}
    )
    assert service.save_report_columns.call_args.args == ([DatedColumn(season=2027, as_of=date(2027, 4, 12))],)


@pytest.mark.parametrize("model", [ZipResponse, FundingSourcesResponse, ReportColumnsResponse])
def test_no_part_c_response_carries_a_family_level_field(model: Any) -> None:
    """Main spec §14.3: a ZIP row is a small group, never a family's row (D90); a source holds no family data."""
    offenders = [
        f"{m.__name__}.{name}"
        for m in walk_models(model, set())
        for name in m.model_fields
        if FAMILY_LEVEL.search(name)
    ]
    assert offenders == []

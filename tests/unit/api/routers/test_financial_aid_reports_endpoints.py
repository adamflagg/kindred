"""Reports' routes (Reports back end, Part A; clean spec §9.1–§9.3, §9.7; D65): the permission matrix over SP2's
personas, what each route passes to its service, and how refusals map. A bare FastAPI app (persona_client); never
imports api.main."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, get_args
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from api.schemas.financial_aid_reports import (
    CancelledRowOut,
    CommitteeResponse,
    ProgramsResponse,
    ReportedHistoryResponse,
    ReportedLoadOut,
    StatisticsResponse,
)
from api.services.financial_aid_reports_repository import ReportedFigureTakenError
from api.services.financial_aid_reports_service import ReportedFigureNotFoundError, ReportsRefusedError
from bunking.financial_aid.change_log import AidWriteConflictError
from bunking.financial_aid.reports.history import ReportedFigure
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client, persona_user

VIEW, RULES = Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_RULES
FIGURE = {"year": 2025, "metric": "budget", "at": "season_end", "as_of": "2025-10-10", "value": "500000.00"}


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidReportsService").start().return_value
    for name in ("statistics", "programs", "committee", "reported_history", "delete_reported"):
        setattr(service, name, AsyncMock(return_value=None))
    service.load_reported = AsyncMock(return_value=ReportedLoadOut(created=1, updated=0, unchanged=0))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


READS = [
    "/api/financial-aid/reports/2027/statistics",
    "/api/financial-aid/reports/2027/programs",
    "/api/financial-aid/reports/2027/committee",
]


@pytest.mark.parametrize("url", READS)
@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_finance_reads_need_view_never_summary_alone(persona: str, url: str) -> None:
    """D65: a summary-only user sees Reports › Development only."""
    service = _stub()
    for name in ("statistics", "programs", "committee"):
        getattr(service, name).side_effect = ReportsRefusedError("stub")  # any non-403 proves the gate let it in
    expected = 422 if VIEW in PERSONAS[persona] else 403
    assert _client(persona).get(url).status_code == expected, persona


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_typed_history_is_finances_to_load(persona: str) -> None:
    _stub()
    expected = 200 if RULES in PERSONAS[persona] else 403
    response = _client(persona).post("/api/financial-aid/reports/reported-history/bulk", json={"figures": [FIGURE]})
    assert response.status_code == expected, persona


def test_statistics_passes_its_chips_basis_and_controls() -> None:
    service = _stub()
    service.statistics.side_effect = ReportsRefusedError("stub")
    _client().get(
        "/api/financial-aid/reports/2027/statistics",
        params={"table": "camp", "round": "all", "basis": "posted_and_decided", "received_through": "2027-02-01"},
    )
    assert service.statistics.call_args.args == (2027,)
    assert service.statistics.call_args.kwargs == {
        "table": "camp",
        "round_": None,
        "basis": "posted_and_decided",
        "through_deadline": False,
        "through": date(2027, 2, 1),
        "as_of": None,
        "axis": "campminder",
    }


def test_statistics_defaults_to_all_tables_round_1_posted() -> None:
    service = _stub()
    service.statistics.side_effect = ReportsRefusedError("stub")
    _client().get("/api/financial-aid/reports/2027/statistics")
    kwargs = service.statistics.call_args.kwargs
    assert (kwargs["table"], kwargs["round_"], kwargs["basis"]) == (None, 1, "posted")


def test_a_load_reaches_the_service_as_figures_with_the_caller() -> None:
    service = _stub()
    response = _client().post("/api/financial-aid/reports/reported-history/bulk", json={"figures": [FIGURE]})
    assert response.json() == {"created": 1, "updated": 0, "unchanged": 0}
    [figures] = service.load_reported.call_args.args
    assert figures == [
        ReportedFigure(2025, "finance", "budget", "", 0, 0, "season_end", date(2025, 10, 10), Decimal("500000.00"))
    ]
    assert service.load_reported.call_args.kwargs == {"actor": persona_user(PERSONA_FINANCE).email}


@pytest.mark.parametrize(
    "body",
    [
        {"figures": []},
        {"figures": [{**FIGURE, "value": "-1"}]},
        {"figures": [{**FIGURE, "value": "1.234"}]},
        {"figures": [{**FIGURE, "surprise": 1}]},
    ],
)
def test_a_malformed_load_is_422_before_the_service(body: dict[str, Any]) -> None:
    service = _stub()
    assert _client().post("/api/financial-aid/reports/reported-history/bulk", json=body).status_code == 422
    service.load_reported.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ReportsRefusedError("bad figure"), 422),
        (ReportedFigureTakenError("same moment"), 409),
        (AidWriteConflictError(collection="aid_requests", record_id="rec1"), 409),
    ],
)
def test_load_refusals_map(error: Exception, status: int) -> None:
    service = _stub()
    service.load_reported = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/reports/reported-history/bulk", json={"figures": [FIGURE]})
    assert response.status_code == status


def test_a_delete_needs_a_reason_and_an_unknown_figure_is_404() -> None:
    service = _stub()
    url = "/api/financial-aid/reports/reported-history/rph000000000001"
    assert _client().delete(url).status_code == 422
    assert _client().delete(url, params={"reason": "wrong as-of date"}).status_code == 204
    assert service.delete_reported.call_args.kwargs == {
        "reason": "wrong as-of date",
        "actor": persona_user(PERSONA_FINANCE).email,
    }
    service.delete_reported.side_effect = ReportedFigureNotFoundError("no such figure")
    assert _client().delete(url, params={"reason": "again"}).status_code == 404


def _field_names(model: type[BaseModel], seen: set[type[BaseModel]]) -> set[str]:
    names: set[str] = set()
    for field in model.model_fields.values():
        for inner in _models_in(field.annotation):
            if inner not in seen:
                seen.add(inner)
                names |= set(inner.model_fields) | _field_names(inner, seen)
    return names | set(model.model_fields)


def _models_in(annotation: Any) -> list[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    return [m for arg in get_args(annotation) for m in _models_in(arg)]


@pytest.mark.parametrize("model", [StatisticsResponse, ProgramsResponse, CommitteeResponse])
def test_no_internal_standing_field_reaches_a_response(model: type[BaseModel]) -> None:
    """A request's standing (live / cancelled / closed) is Reports' internal; `included` is the Include override
    (owner item 53), which Reports never read. Neither is a response field (`live_asked` is a figure, not a flag)."""
    assert not {"standing", "included", "live"} & _field_names(model, set())


def test_rpt22_rows_say_they_are_per_reason_pool_and_round() -> None:
    """A person who cancelled in two rounds is two rows' worth of `requests`: the frontend must not sum them."""
    description = CancelledRowOut.model_fields["requests"].description or ""
    assert "never sum" in description.lower()


def test_a_refused_read_is_a_422_and_an_unknown_round_chip_never_reaches_the_service() -> None:
    service = _stub()
    assert _client().get("/api/financial-aid/reports/2027/statistics", params={"round": "4"}).status_code == 422
    assert _client().get("/api/financial-aid/reports/2027/statistics", params={"basis": "x"}).status_code == 422
    service.statistics.assert_not_called()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_reading_and_deleting_typed_history_are_rules_only(persona: str) -> None:
    """The exact status, not just "not 403": a read that let the person in but then failed would be a 500."""
    service = _stub()
    service.reported_history = AsyncMock(return_value=ReportedHistoryResponse(figures=[]))
    allowed = RULES in PERSONAS[persona]
    reason = {"reason": "wrong as-of date"}
    url = "/api/financial-aid/reports/reported-history"
    read = _client(persona).get(url)
    delete = _client(persona).delete(f"{url}/rph000000000001", params=reason)
    assert read.status_code == (200 if allowed else 403), persona
    assert delete.status_code == (204 if allowed else 403), persona

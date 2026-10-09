"""The requests behind a Reports count, over HTTP (slice 4 asks 1 and 8; D20, D65): the permission matrix over
SP2's personas, what each route passes to its service, and 422s before the service. A bare FastAPI app
(persona_client); never imports api.main."""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid_reports import ReportRequestIdsOut
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client

VIEW = Permission.FINANCIAL_AID_VIEW
STATS = "/api/financial-aid/reports/2027/statistics/requests"
PROGRAMS = "/api/financial-aid/reports/2027/programs/requests"
OUT = ReportRequestIdsOut(
    year=2027,
    as_of=None,
    as_of_axis=None,
    figures_on=date(2027, 4, 1),
    request_set=None,
    request_ids=["reqemma00000001"],
)


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidReportsService").start().return_value
    service.statistics_request_ids = AsyncMock(return_value=OUT)
    service.programs_request_ids = AsyncMock(return_value=OUT)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize(
    ("url", "params"),
    [
        (STATS, {"part": "total", "count": "apps"}),
        (PROGRAMS, {"part": "total", "block": "1", "count": "apps"}),
    ],
)
@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_requests_behind_a_count_need_view_never_summary_alone(
    persona: str, url: str, params: dict[str, str]
) -> None:
    """D65: development's summary never sees a request. The exact status, so a 500 can't pass for "let in"."""
    service = _stub()
    service.statistics_request_ids.side_effect = ReportsRefusedError("stub")
    service.programs_request_ids.side_effect = ReportsRefusedError("stub")
    expected = 422 if VIEW in PERSONAS[persona] else 403
    assert _client(persona).get(url, params=params).status_code == expected, persona


def test_statistics_requests_pass_the_reads_parameters_and_the_selector() -> None:
    service = _stub()
    response = _client().get(
        STATS,
        params={
            "part": "tier",
            "tier": "2",
            "count": "awarded",
            "table": "camp",
            "round": "all",
            "basis": "posted_and_decided",
            "received_through": "2027-02-01",
            "as_of": "2027-03-20",
        },
    )
    assert response.status_code == 200
    assert response.json()["request_ids"] == ["reqemma00000001"]
    assert service.statistics_request_ids.call_args.args == (2027,)
    assert service.statistics_request_ids.call_args.kwargs == {
        "part": "tier",
        "table": "camp",
        "round_": None,
        "basis": "posted_and_decided",
        "through_deadline": False,
        "through": date(2027, 2, 1),
        "as_of": date(2027, 3, 20),
        "axis": "campminder",
        "tier": 2,
        "count": "awarded",
        "reason": None,
        "pool": None,
        "posted_round": None,
        "outcome_row": None,
        "outcome": None,
        "appeals_count": None,
    }


def test_an_rpt_9_link_reaches_the_service() -> None:
    service = _stub()
    response = _client().get(STATS, params={"part": "tier_appeals", "tier": "2", "appeals_count": "appeals"})
    assert response.status_code == 200
    kwargs = service.statistics_request_ids.call_args.kwargs
    assert (kwargs["part"], kwargs["tier"], kwargs["appeals_count"]) == ("tier_appeals", 2, "appeals")
    assert _client().get(STATS, params={"part": "tier_appeals", "appeals_count": "nonsense"}).status_code == 422


def test_an_rpt_23_waiting_link_reaches_the_service() -> None:
    """Ask 8."""
    service = _stub()
    response = _client().get(
        STATS, params={"part": "outcome", "outcome_row": "pool", "pool": "camp_pool", "outcome": "waiting"}
    )
    assert response.status_code == 200
    kwargs = service.statistics_request_ids.call_args.kwargs
    assert (kwargs["part"], kwargs["outcome_row"], kwargs["pool"], kwargs["outcome"]) == (
        "outcome",
        "pool",
        "camp_pool",
        "waiting",
    )


def test_programs_requests_pass_the_reads_parameters_and_the_selector() -> None:
    service = _stub()
    response = _client().get(
        PROGRAMS,
        params={
            "part": "session",
            "pool": "camp_pool",
            "session": "0",
            "block": "2",
            "count": "asks",
            "through_round1_deadline": "true",
        },
    )
    assert response.status_code == 200
    assert service.programs_request_ids.call_args.kwargs == {
        "part": "session",
        "block": 2,
        "count": "asks",
        "pool": "camp_pool",
        "session": 0,
        "through_deadline": True,
        "through": None,
        "as_of": None,
        "axis": "campminder",
    }


@pytest.mark.parametrize(
    ("url", "params"),
    [
        (STATS, {}),  # no part
        (STATS, {"part": "rows", "count": "apps"}),
        (STATS, {"part": "total", "count": "money"}),
        (STATS, {"part": "tier", "tier": "0", "count": "apps"}),
        (STATS, {"part": "cancelled", "reason": "medical", "posted_round": "4"}),
        (STATS, {"part": "outcome", "outcome_row": "reconciliation", "outcome": "waiting"}),
        (PROGRAMS, {"part": "total", "block": "4", "count": "apps"}),
        (PROGRAMS, {"part": "total", "count": "apps"}),  # no block
        (PROGRAMS, {"part": "session", "session": "-1", "block": "1", "count": "apps"}),
    ],
)
def test_a_malformed_selector_is_422_before_the_service(url: str, params: dict[str, str]) -> None:
    service = _stub()
    assert _client().get(url, params=params).status_code == 422
    service.statistics_request_ids.assert_not_called()
    service.programs_request_ids.assert_not_called()


def test_a_refused_selector_is_a_422_with_its_sentence() -> None:
    service = _stub()
    service.statistics_request_ids.side_effect = ReportsRefusedError("Choose a count")
    response = _client().get(STATS, params={"part": "total"})
    assert (response.status_code, response.json()["detail"]) == (422, "Choose a count")


def test_the_ids_response_carries_no_internal_standing_field() -> None:
    """As Reports' other reads: `live`, `standing` and `included` never reach a response."""
    assert not {"standing", "included", "live"} & set(ReportRequestIdsOut.model_fields)

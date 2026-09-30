"""Decisions endpoints (sub-project 10a): the permission matrix over SP2's personas, the error
mapping, who may approve their own Round 3 amount, and the naming guard (spec §5.6). Builds a bare
FastAPI app (SP2's persona_client) rather than importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import api.schemas.financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import (
    BelowTheLineOut,
    BudgetResponse,
    CellOut,
    ChangedRowOut,
    CountOut,
    DecisionWriteOut,
    ForwardDemandOut,
    PoolBudgetOut,
    RemainingResponse,
    RequestsGridResponse,
)
from api.services.financial_aid_decisions_service import (
    DecisionChangedError,
    DecisionNotFoundError,
    DecisionRefusedError,
)
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

VIEW, CASEWORK, RULES, SUMMARY = (
    Permission.FINANCIAL_AID_VIEW,
    Permission.FINANCIAL_AID_CASEWORK,
    Permission.FINANCIAL_AID_RULES,
    Permission.FINANCIAL_AID_SUMMARY,
)
REQ = "reqemma00000001"
WRITE = DecisionWriteOut(year=2031, written=1, unchanged=0, operation_id="o" * 15)
_ZERO_CELL = CellOut(allocated=None, posted=0, accepted=0, needs_offer=0, pending_approval=0, remaining=None)
_TOTAL = PoolBudgetOut(
    pool="*",
    label="Total",
    rounds=[],
    total=_ZERO_CELL,
    below=BelowTheLineOut(held=CountOut(families=0, requests=0), held_asked=0, outside_grants=0, outside_budget=0),
    demand=ForwardDemandOut(
        round2_asks=CountOut(families=0, requests=0), round2_asked=0, round2_computed=0, round1_unmet=0
    ),
)

# (method, url, json body, any of these permissions, success status)
ROUTES: list[tuple[str, str, dict[str, Any] | None, tuple[str, ...], int]] = [
    ("GET", "/api/financial-aid/decisions/2031/grid", None, (VIEW,), 200),
    ("GET", "/api/financial-aid/decisions/2031/budget", None, (VIEW,), 200),
    ("GET", "/api/financial-aid/decisions/2031/remaining", None, (VIEW, SUMMARY), 200),
    (
        "POST",
        f"/api/financial-aid/requests/{REQ}/asks",
        {"round": 2, "amount": "400", "asked_on": "2031-03-20"},
        (CASEWORK,),
        200,
    ),
    ("POST", f"/api/financial-aid/requests/{REQ}/round3-amount", {"amount": "300"}, (CASEWORK,), 200),
    (
        "POST",
        f"/api/financial-aid/requests/{REQ}/discretionary",
        {"decision_type": "discretionary", "amount": "250", "note": "Hardship fund"},
        (RULES,),
        200,
    ),
    (
        "POST",
        f"/api/financial-aid/requests/{REQ}/round3-approval",
        {"approve": True, "note": "Finance, Jun 2"},
        (RULES,),
        200,
    ),
    (
        "POST",
        "/api/financial-aid/decisions/2031/posted",
        {"rows": [{"request_id": REQ, "round": 1, "amount": "1500"}]},
        (CASEWORK,),
        200,
    ),
    (
        "POST",
        "/api/financial-aid/decisions/2031/unposted",
        {"request_id": REQ, "round": 1, "reason": "Ticked the wrong family"},
        (CASEWORK,),
        200,
    ),
    (
        "POST",
        "/api/financial-aid/decisions/2031/accepted",
        {"rows": [{"request_id": REQ, "round": 1}], "accepted": True},
        (CASEWORK,),
        200,
    ),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.grid = AsyncMock(return_value=RequestsGridResponse(year=2031, rules_version=1, rows=[]))
    service.budget = AsyncMock(
        return_value=BudgetResponse(
            year=2031, rules_version=1, pools=[], total=_TOTAL, strip=[], outside_grants_off_requests=0
        )
    )
    service.remaining = AsyncMock(return_value=RemainingResponse(year=2031, pools=[], total=None))
    for name in (
        "key_ask",
        "key_round3_amount",
        "key_discretionary",
        "decide_round3",
        "tick_posted",
        "undo_posted",
        "tick_accepted",
    ):
        setattr(service, name, AsyncMock(return_value=WRITE))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The writes refuse a date after today; the routes' dates sit in the fictional 2031 season."""
    monkeypatch.setattr(schemas, "today", lambda: date(2031, 12, 31))


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: tuple[str, ...], ok: int
) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = ok if set(needs) & set(PERSONAS[persona]) else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_a_summary_only_user_reaches_only_the_remaining_line() -> None:
    """D65, D75: development sees the Remaining line's aggregates and no family-level decision."""
    _stub()
    client = _client(PERSONA_DEVELOPMENT)
    for method, url, body, needs, ok in ROUTES:
        expected = ok if SUMMARY in needs else 403
        assert client.request(method, url, json=body).status_code == expected, url


def test_the_actor_is_the_callers_email() -> None:
    service = _stub()
    _client().post("/api/financial-aid/decisions/2031/posted", json=ROUTES[7][2])
    assert service.tick_posted.call_args.args[2] == persona_user(PERSONA_FINANCE).email


@pytest.mark.parametrize(("persona", "can_approve"), [(PERSONA_FINANCE, True), (PERSONA_REGISTRAR, False)])
def test_only_finance_approves_its_own_round_3_amount(persona: str, can_approve: bool) -> None:
    service = _stub()
    _client(persona).post(f"/api/financial-aid/requests/{REQ}/round3-amount", json={"amount": "900"})
    assert service.key_round3_amount.call_args.kwargs["can_approve"] is can_approve


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (DecisionNotFoundError("no such request"), 404),
        (DecisionChangedError([ChangedRowOut(request_id=REQ, round=1, confirmed=1400.0, decided_now=1500.0)]), 409),
        (DecisionRefusedError("on hold"), 422),
    ],
)
def test_service_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.tick_posted = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/decisions/2031/posted", json=ROUTES[7][2])
    assert response.status_code == status
    if status == 409:
        assert response.json()["detail"]["rows"] == [
            {"request_id": REQ, "round": 1, "confirmed": 1400.0, "decided_now": 1500.0}
        ]


def test_a_round_3_ask_without_its_statement_of_need_is_422() -> None:
    _stub()
    body = {"round": 3, "amount": "500", "asked_on": "2031-06-01"}
    assert _client().post(f"/api/financial-aid/requests/{REQ}/asks", json=body).status_code == 422


def test_a_request_id_that_is_not_a_record_id_is_422() -> None:
    _stub()
    body = {"round": 2, "amount": "400", "asked_on": "2031-03-20"}
    assert _client().post("/api/financial-aid/requests/not-an-id/asks", json=body).status_code == 422


def test_a_year_out_of_range_is_422() -> None:
    _stub()
    assert _client().get("/api/financial-aid/decisions/1999/grid").status_code == 422


def test_no_decisions_field_is_named_awarded_or_total_awards_granted() -> None:
    """Spec §5.6's naming guard: posted money is "posted" here. "Awarded" is finance's report label
    for it (D80), and "Total Awards Granted" is development's all-money figure (D87); neither is this."""
    models = [
        m
        for m in vars(schemas).values()
        if isinstance(m, type) and issubclass(m, BaseModel) and m.__module__ == schemas.__name__
    ]
    assert len(models) >= 10
    for model in models:
        for name, info in model.model_fields.items():
            text = f"{name} {info.description or ''} {info.title or ''}".lower()
            assert "awarded" not in text, (model.__name__, name)
            assert "awards granted" not in text, (model.__name__, name)


def test_a_posted_day_after_today_is_422() -> None:
    service = _stub()
    body = {"rows": [{"request_id": REQ, "round": 1, "amount": "1500"}], "posted_on": "2032-01-01"}
    assert _client().post("/api/financial-aid/decisions/2031/posted", json=body).status_code == 422
    service.tick_posted.assert_not_called()

"""POST /api/internal/financial-aid/ledger-ticks -- the Go aid-ledger sync's trigger (sub-project 10b, D78)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import internal
from api.schemas.financial_aid_decisions import LedgerTicksOut
from bunking.financial_aid.change_log import AidOperationPartiallyCommittedError
from bunking.financial_aid.errors import FinancialAidError


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(internal.router)
    return TestClient(app)


def test_the_trigger_ticks_the_named_season_and_returns_what_it_did() -> None:
    out = LedgerTicksOut(year=2027, ticked=3, operation_id="o" * 15, total_locked=4500.0)
    with patch.object(internal, "FinancialAidDecisionsService") as service_cls:
        service_cls.return_value.ledger_ticks = AsyncMock(return_value=out)
        response = _client().post("/api/internal/financial-aid/ledger-ticks", json={"year": 2027})
    assert response.status_code == 200
    assert (response.json()["ticked"], response.json()["total_locked"]) == (3, 4500.0)
    service_cls.return_value.ledger_ticks.assert_awaited_once_with(2027)


def test_an_out_of_range_year_is_rejected() -> None:
    assert _client().post("/api/internal/financial-aid/ledger-ticks", json={"year": 1999}).status_code == 422


def test_a_refused_tick_is_a_mapped_error_never_a_bare_500() -> None:
    with patch.object(internal, "FinancialAidDecisionsService") as service_cls:
        service_cls.return_value.ledger_ticks = AsyncMock(side_effect=FinancialAidError("rules are not approved"))
        response = _client().post("/api/internal/financial-aid/ledger-ticks", json={"year": 2027})
    assert response.status_code == 422
    assert response.json()["detail"] == "rules are not approved"


def test_a_partially_committed_tick_is_not_mapped_to_a_refusal() -> None:
    """Part of it is saved: it reaches the global 500 handler, never a 422 (change_log.py's contract)."""
    partial = AidOperationPartiallyCommittedError(operation_id="op1", committed=8, total=9, detail="chunk 2 failed")
    with patch.object(internal, "FinancialAidDecisionsService") as service_cls:
        service_cls.return_value.ledger_ticks = AsyncMock(side_effect=partial)
        with pytest.raises(AidOperationPartiallyCommittedError):
            _client().post("/api/internal/financial-aid/ledger-ticks", json={"year": 2027})

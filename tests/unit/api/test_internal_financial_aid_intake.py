"""POST /api/internal/financial-aid/intake -- the Go FA sync's trigger."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import internal
from api.services.financial_aid_intake_service import IntakeReport


def test_the_trigger_builds_the_named_season_and_returns_the_report() -> None:
    report = IntakeReport(2027, 2, 2, 0, 3, 0, 1, 0, 1, 1)
    with patch.object(internal, "FinancialAidIntakeService") as service_cls:
        service_cls.return_value.build = AsyncMock(return_value=report)
        app = FastAPI()
        app.include_router(internal.router)
        response = TestClient(app).post("/api/internal/financial-aid/intake", json={"year": 2027})
    assert response.status_code == 200
    assert response.json()["requests_created"] == 3
    service_cls.return_value.build.assert_awaited_once_with(2027)


def test_an_out_of_range_year_is_rejected() -> None:
    app = FastAPI()
    app.include_router(internal.router)
    assert TestClient(app).post("/api/internal/financial-aid/intake", json={"year": 1999}).status_code == 422

"""GET /solver/run/{id} surfaces Stream B diagnostics from the in-memory run dict (#1638)."""

from typing import Any
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user


def _admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _client() -> TestClient:
    from api.routers import solver

    app = FastAPI()
    app.include_router(solver.router)
    app.dependency_overrides[get_current_user] = _admin_user
    return TestClient(app)


def test_get_solver_run_includes_diagnostics_when_present() -> None:
    run_id = "run-x1"
    run: dict[str, Any] = {
        "id": run_id,
        "status": "failed",
        "results": None,
        "error_message": "Solver failed to find a solution",
        "infeasibility_cause": "The parent_paramount constraint is causing infeasibility",
        "localization": {
            "approach": "singleton",
            "candidate_count": 2,
            "campers": [{"cm_id": 1000001, "name": "Emma Johnson", "grade": 5, "gender": "F"}],
            "notes": "x",
        },
        "impossibility_report": {"total_impossible": 0, "affected_campers": 0, "flat": []},
    }
    with patch.dict("api.routers.solver.solver_runs", {run_id: run}, clear=False):
        resp = _client().get(f"/api/solver/run/{run_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["infeasibility_cause"] == run["infeasibility_cause"]
    assert body["localization"]["campers"][0]["name"] == "Emma Johnson"
    assert body["impossibility_report"]["total_impossible"] == 0


def test_get_solver_run_diagnostics_default_none() -> None:
    run_id = "run-x2"
    run: dict[str, Any] = {"id": run_id, "status": "completed", "results": {"stats": {}}, "error_message": None}
    with patch.dict("api.routers.solver.solver_runs", {run_id: run}, clear=False):
        resp = _client().get(f"/api/solver/run/{run_id}")
    body = resp.json()
    assert body["infeasibility_cause"] is None
    assert body["localization"] is None
    assert body["impossibility_report"] is None

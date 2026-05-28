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


def test_get_solver_run_includes_overflow_used() -> None:
    """#2 (scan): the in-memory branch must surface overflow_used so the
    frontend overflow toast fires. Without it the response omits the key and the
    client's `?? 0` fallback silently swallows every overflowed run."""
    run_id = "run-of-1"
    run: dict[str, Any] = {
        "id": run_id,
        "status": "completed",
        "results": {"stats": {}},
        "error_message": None,
        "overflow_used": 2,
    }
    with patch.dict("api.routers.solver.solver_runs", {run_id: run}, clear=False):
        resp = _client().get(f"/api/solver/run/{run_id}")
    assert resp.status_code == 200
    assert resp.json()["overflow_used"] == 2


def test_get_solver_run_overflow_used_defaults_zero() -> None:
    """A clean 12-cap run has no overflow_used key in the in-memory dict; the
    response must default it to 0, not omit it."""
    run_id = "run-of-2"
    run: dict[str, Any] = {"id": run_id, "status": "completed", "results": {"stats": {}}, "error_message": None}
    with patch.dict("api.routers.solver.solver_runs", {run_id: run}, clear=False):
        resp = _client().get(f"/api/solver/run/{run_id}")
    assert resp.json()["overflow_used"] == 0


def test_get_solver_run_pb_fallback_includes_overflow_used() -> None:
    """The PocketBase-fetch fallback persists overflow_used as a column, so the
    response must surface it (defaulting to 0 when absent) to match the
    in-memory branch."""
    run_id = "run-pb-of"

    class _PbRun:
        id = run_id
        status = "completed"
        results = '{"stats": {}}'
        error_message = None
        overflow_used = 3

    with (
        patch.dict("api.routers.solver.solver_runs", {}, clear=True),
        patch("api.routers.solver.pb") as mock_pb,
    ):
        mock_pb.collection.return_value.get_one.return_value = _PbRun()
        resp = _client().get(f"/api/solver/run/{run_id}")
    assert resp.status_code == 200
    assert resp.json()["overflow_used"] == 3


def test_get_solver_run_pb_fallback_includes_diagnostics_keys() -> None:
    """The PocketBase-fetch fallback returns the same diagnostics keys (as None)
    as the in-memory path, so the response shape is uniform across storage paths (#1656)."""
    run_id = "run-pb-1"

    class _PbRun:
        id = run_id
        status = "completed"
        results = '{"stats": {}}'
        error_message = None

    # Empty solver_runs forces the run_id-not-found PocketBase fallback branch.
    with (
        patch.dict("api.routers.solver.solver_runs", {}, clear=True),
        patch("api.routers.solver.pb") as mock_pb,
    ):
        mock_pb.collection.return_value.get_one.return_value = _PbRun()
        resp = _client().get(f"/api/solver/run/{run_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["infeasibility_cause"] is None
    assert body["localization"] is None
    assert body["impossibility_report"] is None

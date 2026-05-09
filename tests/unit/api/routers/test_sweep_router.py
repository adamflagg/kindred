"""Endpoint-level tests for /api/solver/run-sweep.

Covers:
- In-flight guard: a sweep targeting the same session/scenario as an existing
  pending/running run gets 409 (mirrors /solver/run behavior).
- Exception surfacing: PocketBase upstream errors are mapped via pb_error_to_http
  (404 stays 404, 5xx becomes 502, etc.) — they are NOT downgraded to 400 with
  raw exception text. Unexpected exceptions bubble to the global handler (500).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS


def _mock_admin_user() -> AuthUser:
    user = AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )
    user.permissions = set(ALL_PERMISSIONS)
    return user


@contextmanager
def _sweep_client(
    solver_runs_state: dict[str, Any] | None = None,
    snapshot_side_effect: Any = None,
    scenario_get_one_side_effect: Any = None,
) -> Iterator[TestClient]:
    """TestClient with patched dependencies for /api/solver/run-sweep.

    snapshot_side_effect: if set, snapshot_session_input raises this on call.
    scenario_get_one_side_effect: if set, pb.collection("saved_scenarios").get_one raises this.
    """
    from api.routers.solver import router

    if solver_runs_state is None:
        solver_runs_state = {}

    mock_pb = MagicMock()
    if scenario_get_one_side_effect is not None:
        mock_pb.collection.return_value.get_one.side_effect = scenario_get_one_side_effect
    else:
        scenario_record = MagicMock()
        scenario_record.session_cm_id = 5001
        scenario_record.year = 2026
        scenario_record.name = "test-scenario"
        mock_pb.collection.return_value.get_one.return_value = scenario_record

    snapshot_mock = AsyncMock()
    if snapshot_side_effect is not None:
        snapshot_mock.side_effect = snapshot_side_effect
    else:
        snapshot_mock.return_value = MagicMock()

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.solver.solver_runs", solver_runs_state),
        patch("api.routers.solver.pb", mock_pb),
        patch("api.routers.solver.snapshot_session_input", snapshot_mock),
        # Prevent the asyncio.create_task background sweep from actually running
        patch("api.routers.solver.run_sweep", AsyncMock()),
    ):
        yield TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Fix #5: in-flight guard
# ---------------------------------------------------------------------------


class TestSweepInflightGuard:
    def test_409_when_session_has_pending_run(self) -> None:
        existing_run_id = "existing-pending"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 1001,
                "status": "pending",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 1001, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 1001"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_409_when_session_has_running_run(self) -> None:
        existing_run_id = "existing-running"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 2002,
                "status": "running",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 2002, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"

    def test_202_when_only_completed_run_exists(self) -> None:
        """Completed runs must NOT block a new sweep (mirrors /solver/run)."""
        solver_runs_state: dict[str, Any] = {
            "old-run": {
                "id": "old-run",
                "session_cm_id": 3003,
                "status": "completed",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 3003, "year": 2026},
            )

        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.text}"

    def test_202_when_running_run_for_different_session(self) -> None:
        solver_runs_state: dict[str, Any] = {
            "other-run": {
                "id": "other-run",
                "session_cm_id": 9999,  # different session
                "status": "running",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 4004, "year": 2026},
            )

        assert resp.status_code == 202

    def test_409_when_scenario_run_inflight_for_same_scenario(self) -> None:
        """Scenario sweep must reject if same scenario already in flight."""
        existing_run_id = "scenario-pending"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 5001,
                "status": "running",
                "scenario": "scen-target",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-target"},
            )

        assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Fix #4: exceptions are not masked as 400 with raw text
# ---------------------------------------------------------------------------


class TestSweepExceptionHandling:
    def test_pb_404_on_scenario_lookup_returns_404_not_400(self) -> None:
        not_found = ClientResponseError(url="...", status=404, data={})

        with _sweep_client(scenario_get_one_side_effect=not_found) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "missing-scen"},
            )

        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        # Detail must be safe/generic — not raw exception text.
        body = resp.json()
        assert body["detail"] == "Resource not found"

    def test_pb_5xx_on_snapshot_returns_502_not_400(self) -> None:
        upstream_error = ClientResponseError(url="...", status=503, data={})

        with _sweep_client(snapshot_side_effect=upstream_error) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 7007, "year": 2026},
            )

        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["detail"] == "Upstream service error"

    def test_unexpected_exception_on_snapshot_bubbles_to_global_500(self) -> None:
        """A non-PB exception during snapshot must reach the global handler
        and become a generic 500 — not a 400 leaking the error text."""
        with _sweep_client(snapshot_side_effect=RuntimeError("internal kaboom")) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 8008, "year": 2026},
            )

        assert resp.status_code == 500, f"Expected 500, got {resp.status_code}: {resp.text}"
        body = resp.json()
        # Generic message — must NOT contain the raw exception text.
        assert "kaboom" not in body.get("detail", "").lower()

    def test_unexpected_exception_on_scenario_lookup_bubbles_to_global_500(self) -> None:
        with _sweep_client(scenario_get_one_side_effect=RuntimeError("internal boom")) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-x"},
            )

        assert resp.status_code == 500
        body = resp.json()
        assert "boom" not in body.get("detail", "").lower()


@pytest.fixture(autouse=True)
def _stub_sweep_registry() -> Iterator[None]:
    """Default no-op patch for sweep_registry to avoid leaking entries
    across tests. We don't need to assert on registration in these tests."""
    with patch("api.routers.solver.sweep_registry") as reg:
        reg.register = MagicMock()
        reg.cancel = MagicMock()
        reg.release = MagicMock()
        yield


# ---------------------------------------------------------------------------
# Pre-creation lock + cleanup on snapshot failure
# ---------------------------------------------------------------------------


class TestSweepPreCreationLock:
    """Closes the TOCTOU race between guard check and registration.

    Pre-creating solver_runs entries (and registering with sweep_registry)
    before the snapshot await ensures a second concurrent request hits the
    in-flight guard. On snapshot failure, the pre-created entries and
    registry entry must be cleaned up so the slot isn't permanently locked.
    """

    def test_pre_created_entries_include_scenario_field(self) -> None:
        """Pre-created sweep children must carry `scenario` so the scenario
        guard fires while children are still pending (before run_solver_task_v2
        sets it post-completion)."""
        solver_runs_state: dict[str, Any] = {}

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-target"},
            )

        assert resp.status_code == 202, resp.text
        # Every pre-created entry tied to the new sweep must carry the scenario_id.
        sweep_entries = [r for r in solver_runs_state.values() if r.get("config", {}).get("sweep_id")]
        assert sweep_entries, "expected pre-created sweep child entries"
        for entry in sweep_entries:
            assert entry.get("scenario") == "scen-target", (
                f"pre-created sweep child must include scenario_id; got {entry}"
            )

    def test_snapshot_failure_releases_registry_and_clears_entries(self) -> None:
        """If snapshot raises after pre-creation, both the registry slot and the
        pre-created solver_runs entries must be cleaned up — otherwise the
        target session/scenario is permanently locked."""
        solver_runs_state: dict[str, Any] = {}
        upstream_error = ClientResponseError(url="...", status=503, data={})

        with patch("api.routers.solver.sweep_registry") as reg:
            reg.register = MagicMock()
            reg.release = MagicMock()
            reg.cancel = MagicMock()
            with _sweep_client(solver_runs_state, snapshot_side_effect=upstream_error) as client:
                resp = client.post(
                    "/api/solver/run-sweep",
                    json={"session_cm_id": 7007, "year": 2026},
                )

            assert resp.status_code == 502, resp.text
            # Registry must have been registered (pre-snapshot lock) and then released.
            assert reg.register.called, "expected sweep_registry.register before snapshot"
            assert reg.release.called, "expected sweep_registry.release on snapshot failure"
            # No orphan solver_runs entries remain.
            sweep_entries = [r for r in solver_runs_state.values() if r.get("config", {}).get("sweep_id")]
            assert sweep_entries == [], f"expected pre-created entries cleaned up on failure; got {sweep_entries}"

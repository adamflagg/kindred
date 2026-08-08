"""Single-flight serialization tests for /api/solver/run and /api/solver/run-multi-session.

Guards against concurrent duplicate solves for the same session_cm_id.

Decision from issue #1178:
  - Reject a second run if any solver_runs[*]['status'] is 'pending' or 'running'
    for the SAME session_cm_id.
  - Return HTTP 409 with JSON body:
      {"detail": "Solver already running for session X", "in_progress_run_id": "..."}
  - A run for a DIFFERENT session must succeed (per-session lock, not global).
  - Multi-session endpoint (/api/solver/run-multi-session) applies the same
    per-session check for each child session it would dispatch.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


def _make_app(router: Any) -> FastAPI:
    """Minimal FastAPI app with global exception handler and patched solver_runs."""
    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user
    return app


@contextmanager
def _solver_client(solver_runs_state: dict[str, Any]) -> Iterator[TestClient]:
    """Return a TestClient for the solver router with patched solver_runs."""
    from api.routers.solver import router

    app = _make_app(router)
    with (
        patch("api.routers.solver.solver_runs", solver_runs_state),
        # Prevent real background tasks from executing
        patch("api.routers.solver.run_solver_task_v2"),
    ):
        # Phase 2 cabin-capacity cleanup: solver.py no longer imports
        # ConfigLoader (the only consumer was the cabin_capacity.standard
        # read for pre-validate, which now uses the DEFAULT_BUNK_CAPACITY
        # constant). The previous patch.object("ConfigLoader") and the
        # mock_cfg.get_int(60) assertion are obsolete.
        yield TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# /api/solver/run — single-flight guard
# ---------------------------------------------------------------------------


class TestRunSolverSingleFlight:
    """POST /api/solver/run rejects duplicate in-progress runs for the same session."""

    def test_409_when_pending_run_exists_for_same_session(self) -> None:
        """Returns 409 when a 'pending' run already exists for the same session_cm_id."""
        existing_run_id = "existing-run-abc"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 1001,
                "status": "pending",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 1001, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        # HTTPException with a dict detail produces {"detail": {...}}
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 1001"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_409_when_running_run_exists_for_same_session(self) -> None:
        """Returns 409 when a 'running' run already exists for the same session_cm_id."""
        existing_run_id = "existing-run-xyz"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 2002,
                "status": "running",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 2002, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        # HTTPException with a dict detail produces {"detail": {...}}
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 2002"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_200_when_completed_run_exists_for_same_session(self) -> None:
        """Returns 200 (success) when only a 'completed' run exists for the same session_cm_id.

        A completed run must NOT block new runs.
        """
        existing_run_id = "old-completed-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 3003,
                "status": "completed",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 3003, "year": 2026},
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_200_when_failed_run_exists_for_same_session(self) -> None:
        """Returns 200 (success) when only a 'failed' run exists for the same session_cm_id.

        A failed run must NOT block new runs.
        """
        existing_run_id = "old-failed-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 4004,
                "status": "failed",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 4004, "year": 2026},
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_200_when_running_run_exists_for_different_session(self) -> None:
        """Returns 200 (success) when a running run exists for a DIFFERENT session_cm_id.

        The lock is per-session, not global — concurrent solves for different
        sessions are valid.
        """
        existing_run_id = "other-session-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 9999,  # Different session
                "status": "running",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 5005, "year": 2026},  # Different session
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_200_when_no_existing_runs(self) -> None:
        """Returns 200 (success) when no runs exist at all (empty solver_runs)."""
        solver_runs_state: dict[str, Any] = {}

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 6006, "year": 2026},
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_409_response_shape(self) -> None:
        """409 response body has exactly the fields: detail, in_progress_run_id."""
        existing_run_id = "shape-check-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 7007,
                "status": "pending",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 7007, "year": 2026},
            )

        assert resp.status_code == 409
        body = resp.json()
        # HTTPException with a dict detail produces {"detail": {...}}
        assert "detail" in body
        detail = body["detail"]
        # Both required keys must be present in the inner detail object
        assert "detail" in detail
        assert "in_progress_run_id" in detail
        assert detail["in_progress_run_id"] == existing_run_id


# ---------------------------------------------------------------------------
# /api/solver/run-multi-session — single-flight guard per child session
# ---------------------------------------------------------------------------


def _make_child_session(cm_id: int, name: str) -> MagicMock:
    """Create a mock PocketBase child session record."""
    session = MagicMock()
    session.cm_id = cm_id
    session.name = name
    session.sex_eligible = "all"
    return session


@contextmanager
def _multi_session_client(solver_runs_state: dict[str, Any], child_sessions: list[MagicMock]) -> Iterator[TestClient]:
    """Return a TestClient for the solver router's multi-session endpoint."""
    from api.routers.solver import router

    mock_pb = MagicMock()
    mock_pb.collection.return_value.get_full_list.return_value = child_sessions

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.solver.solver_runs", solver_runs_state),
        patch("api.routers.solver.pb", mock_pb),
        patch("api.routers.solver.run_solver_task_v2"),
    ):
        # Phase 2 cabin-capacity cleanup: solver.py no longer imports
        # ConfigLoader; the previous patch.object("ConfigLoader") is obsolete.
        yield TestClient(app, raise_server_exceptions=False)


class TestRunMultiSessionSolverSingleFlight:
    """POST /api/solver/run-multi-session rejects child sessions with in-progress runs."""

    def test_409_when_child_session_has_pending_run(self) -> None:
        """Returns 409 when one of the child sessions already has a pending run."""
        existing_run_id = "multi-pending-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 101,
                "status": "pending",
            }
        }
        child_sessions = [_make_child_session(101, "Session A"), _make_child_session(102, "Session B")]

        with _multi_session_client(solver_runs_state, child_sessions) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 100, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        # HTTPException with a dict detail produces {"detail": {...}}
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 101"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_409_when_child_session_has_running_run(self) -> None:
        """Returns 409 when one of the child sessions already has a running run."""
        existing_run_id = "multi-running-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 202,
                "status": "running",
            }
        }
        child_sessions = [_make_child_session(201, "Session X"), _make_child_session(202, "Session Y")]

        with _multi_session_client(solver_runs_state, child_sessions) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 200, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        # HTTPException with a dict detail produces {"detail": {...}}
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 202"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_200_when_only_completed_run_exists_for_child_session(self) -> None:
        """Returns 200 when only a completed run exists for the child session."""
        existing_run_id = "multi-completed-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 301,
                "status": "completed",
            }
        }
        child_sessions = [_make_child_session(301, "Session Done")]

        with _multi_session_client(solver_runs_state, child_sessions) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 300, "year": 2026},
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_200_when_running_run_exists_for_unrelated_session(self) -> None:
        """Returns 200 when a running run exists for an unrelated session (not a child)."""
        existing_run_id = "unrelated-running-run"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 9999,  # Not a child of parent 400
                "status": "running",
            }
        }
        child_sessions = [_make_child_session(401, "Child Session A"), _make_child_session(402, "Child Session B")]

        with _multi_session_client(solver_runs_state, child_sessions) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 400, "year": 2026},
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Cross-path guard tests: scenario run vs. /api/solver/run
# ---------------------------------------------------------------------------
#
# Bug: scenarios.py wrote the solver_runs entry with key "session_id" instead
# of "session_cm_id".  The guard in solver.py reads "session_cm_id", so a
# running scenario solve was invisible to it.
#
# Test A: In-progress scenario run must block /api/solver/run for same session.
# Test B: In-progress scenario run must block a SECOND scenario run for same session.


@contextmanager
def _scenario_client(solver_runs_state: dict[str, Any]) -> Iterator[TestClient]:
    """Return a TestClient for the scenarios router with patched solver_runs and pb."""
    from api.routers.scenarios import router

    mock_pb = MagicMock()
    mock_scenario = MagicMock()
    # session_cm_id is read via the expanded `session` relation (kindred#2021)
    # -- saved_scenarios has never had a session_cm_id column, so a bare
    # `.session_cm_id` attribute on this mock (as a real PocketBase Record
    # would never have it set to anything meaningful) would silently mask
    # the single-flight guard this test exists to pin.
    mock_scenario.expand = {"session": MagicMock(cm_id=5001)}
    mock_scenario.year = 2026
    mock_pb.collection.return_value.get_one.return_value = mock_scenario

    app = _make_app(router)
    with (
        patch("api.routers.scenarios.solver_runs", solver_runs_state),
        patch("api.routers.scenarios.pb", mock_pb),
        patch("api.routers.scenarios.run_solver_task_v2"),
    ):
        yield TestClient(app, raise_server_exceptions=False)


class TestScenarioSolverSingleFlight:
    """Cross-path and scenario-vs-scenario single-flight guard tests.

    These verify the two guard gaps identified post-PR #1189:
    1. scenario run key "session_id" was invisible to /api/solver/run guard (uses "session_cm_id")
    2. /api/scenarios/{id}/solve had no guard against duplicate scenario runs
    """

    # ------------------------------------------------------------------
    # Test A: in-progress scenario run must block /api/solver/run
    # ------------------------------------------------------------------

    def test_a_scenario_endpoint_writes_session_cm_id_key(self) -> None:
        """POST /api/scenarios/{id}/solve must write "session_cm_id" (not "session_id") to solver_runs.

        Root cause of the guard gap: scenarios.py wrote solver_runs entries with
        key "session_id" instead of "session_cm_id".  The guard in solver.py reads
        "session_cm_id", so a running scenario solve was invisible to it.
        This test verifies the write uses the correct unified key after the fix.
        """
        shared_solver_runs: dict[str, Any] = {}

        with _scenario_client(shared_solver_runs) as client:
            resp = client.post("/api/scenarios/test-scenario-uuid/solve")

        assert resp.status_code == 200, f"Expected 200 on first call: {resp.status_code}: {resp.text}"
        # After a successful solve kick-off, exactly one entry must be in solver_runs
        assert len(shared_solver_runs) == 1, f"Expected 1 entry in solver_runs, got {len(shared_solver_runs)}"
        run_entry = next(iter(shared_solver_runs.values()))
        # The critical assertion: key must be "session_cm_id", not "session_id"
        assert "session_cm_id" in run_entry, (
            f"solver_runs entry must use key 'session_cm_id'. Got keys: {list(run_entry.keys())}"
        )
        assert "session_id" not in run_entry, (
            f"solver_runs entry must NOT use the old 'session_id' key. Got keys: {list(run_entry.keys())}"
        )
        assert run_entry["session_cm_id"] == 5001  # matches mock_scenario.session_cm_id

    def test_a_scenario_run_blocks_solver_run_for_same_session(self) -> None:
        """POST /api/solver/run must return 409 when a scenario run is in-progress for the same session.

        Root cause: scenarios.py wrote solver_runs entries with key "session_id"
        (not "session_cm_id"), so the guard in solver.py could not see them.
        After the fix, the key is "session_cm_id" and the guard fires correctly.
        """
        scenario_run_id = "scenario-run-in-progress"
        # Scenario run stored with the correct "session_cm_id" key (after fix)
        solver_runs_state: dict[str, Any] = {
            scenario_run_id: {
                "id": scenario_run_id,
                "session_cm_id": 5001,
                "status": "running",
                "scenario": "some-scenario-uuid",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 5001, "year": 2026},
            )

        assert resp.status_code == 409, (
            f"Expected 409 — scenario run should block solver/run. Got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 5001"
        assert detail["in_progress_run_id"] == scenario_run_id

    def test_a_scenario_run_does_not_block_solver_run_for_different_session(self) -> None:
        """POST /api/solver/run must succeed when the in-progress scenario run is for a different session."""
        scenario_run_id = "scenario-run-other-session"
        solver_runs_state: dict[str, Any] = {
            scenario_run_id: {
                "id": scenario_run_id,
                "session_cm_id": 9999,  # different session
                "status": "running",
                "scenario": "some-scenario-uuid",
            }
        }

        with _solver_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": 5001, "year": 2026},
            )

        assert resp.status_code == 200, (
            f"Expected 200 — different session should not be blocked. Got {resp.status_code}: {resp.text}"
        )

    # ------------------------------------------------------------------
    # Test B: scenario endpoint must block duplicate scenario runs
    # ------------------------------------------------------------------

    def test_b_scenario_run_blocks_second_scenario_run_for_same_session(self) -> None:
        """POST /api/scenarios/{id}/solve must return 409 when a run is already in-progress for the same session.

        The scenario endpoint had no single-flight guard at all prior to the fix.
        """
        existing_scenario_run_id = "existing-scenario-run"
        solver_runs_state: dict[str, Any] = {
            existing_scenario_run_id: {
                "id": existing_scenario_run_id,
                "session_cm_id": 5001,  # same session as mock_scenario.session_cm_id
                "status": "running",
                "scenario": "other-scenario-uuid",
            }
        }

        with _scenario_client(solver_runs_state) as client:
            resp = client.post("/api/scenarios/new-scenario-uuid/solve")

        assert resp.status_code == 409, (
            f"Expected 409 — scenario endpoint must guard against duplicate runs. Got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 5001"
        assert detail["in_progress_run_id"] == existing_scenario_run_id

    def test_b_scenario_run_allowed_when_no_in_progress_run_for_session(self) -> None:
        """POST /api/scenarios/{id}/solve must succeed when no run is in-progress for the session."""
        solver_runs_state: dict[str, Any] = {}

        with _scenario_client(solver_runs_state) as client:
            resp = client.post("/api/scenarios/new-scenario-uuid/solve")

        assert resp.status_code == 200, (
            f"Expected 200 — no existing run should allow the scenario solve. Got {resp.status_code}: {resp.text}"
        )

"""Endpoint-level tests for /api/solver/run-sweep.

Covers:
- In-flight guard: a sweep targeting the same session/scenario as an existing
  pending/running run gets 409 (mirrors /solver/run behavior).
- Exception surfacing: PocketBase upstream errors are mapped via pb_error_to_http
  (404 stays 404, 5xx becomes 502, etc.) — they are NOT downgraded to 400 with
  raw exception text. Unexpected exceptions bubble to the global handler (500).
"""

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
        # Use a real-shape mock: PB saved_scenarios records have a `session`
        # FK string and `expand['session'].cm_id` — they have NO top-level
        # `session_cm_id` attribute. Tests that pre-stamp session_cm_id on
        # the record mask the production bug fixed in solver.py.
        mock_pb.collection.return_value.get_one.side_effect = _scenario_get_one_with_expand_gating(
            cm_id=1000001, year=2026
        )

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
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client


# ---------------------------------------------------------------------------
# Fix #5: in-flight guard
# ---------------------------------------------------------------------------


class TestSweepInflightGuard:
    def test_409_when_session_has_pending_run(self) -> None:
        existing_run_id = "existing-pending"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 1000001,
                "status": "pending",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 1000001, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"
        body = resp.json()
        detail = body["detail"]
        assert detail["detail"] == "Solver already running for session 1000001"
        assert detail["in_progress_run_id"] == existing_run_id

    def test_409_when_session_has_running_run(self) -> None:
        existing_run_id = "existing-running"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 1000002,
                "status": "running",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 1000002, "year": 2026},
            )

        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"

    def test_202_when_only_completed_run_exists(self) -> None:
        """Completed runs must NOT block a new sweep (mirrors /solver/run)."""
        solver_runs_state: dict[str, Any] = {
            "old-run": {
                "id": "old-run",
                "session_cm_id": 1000003,
                "status": "completed",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 1000003, "year": 2026},
            )

        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.text}"

    def test_202_when_running_run_for_different_session(self) -> None:
        solver_runs_state: dict[str, Any] = {
            "other-run": {
                "id": "other-run",
                "session_cm_id": 1999999,  # different session
                "status": "running",
            }
        }

        with _sweep_client(solver_runs_state) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"session_cm_id": 1000004, "year": 2026},
            )

        assert resp.status_code == 202

    def test_409_when_scenario_run_inflight_for_same_scenario(self) -> None:
        """Scenario sweep must reject if same scenario already in flight."""
        existing_run_id = "scenario-pending"
        solver_runs_state: dict[str, Any] = {
            existing_run_id: {
                "id": existing_run_id,
                "session_cm_id": 1000001,
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
                json={"session_cm_id": 1000007, "year": 2026},
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
                json={"session_cm_id": 1000008, "year": 2026},
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
                    json={"session_cm_id": 1000007, "year": 2026},
                )

            assert resp.status_code == 502, resp.text
            # Registry must have been registered (pre-snapshot lock) and then released.
            assert reg.register.called, "expected sweep_registry.register before snapshot"
            assert reg.release.called, "expected sweep_registry.release on snapshot failure"
            # No orphan solver_runs entries remain.
            sweep_entries = [r for r in solver_runs_state.values() if r.get("config", {}).get("sweep_id")]
            assert sweep_entries == [], f"expected pre-created entries cleaned up on failure; got {sweep_entries}"


# ---------------------------------------------------------------------------
# Fix #4 / #9: malformed scenario record (missing session_cm_id or year)
# must surface as a 422 — not as a sweep that silently fails downstream
# because session_cm_id=0 slips past the in-flight guard.
# ---------------------------------------------------------------------------


@contextmanager
def _sweep_client_with_scenario(scenario_record: Any) -> Iterator[TestClient]:
    """Variant of _sweep_client that returns a custom scenario_record from
    pb.collection("saved_scenarios").get_one — for malformed-record tests."""
    from api.routers.solver import router

    mock_pb = MagicMock()
    mock_pb.collection.return_value.get_one.return_value = scenario_record
    snapshot_mock = AsyncMock()
    snapshot_mock.return_value = MagicMock()

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.solver.solver_runs", {}),
        patch("api.routers.solver.pb", mock_pb),
        patch("api.routers.solver.snapshot_session_input", snapshot_mock),
        patch("api.routers.solver.run_sweep", AsyncMock()),
    ):
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client


def _scenario_record(
    *,
    cm_id: int | None = 1000001,
    year: int = 2026,
    include_expand: bool = True,
) -> Any:
    """Construct a real `pocketbase.models.record.Record` shaped like a
    saved_scenarios row returned with `{"expand": "session"}`. Tests can
    set `cm_id=None` to omit the expanded session relation entirely
    (simulates a record fetched without expand or with a broken FK)."""
    from pocketbase.models.record import Record

    data: dict[str, Any] = {
        "id": "scen-test",
        "name": "scenario-test",
        "description": "",
        "session": "session_pb_id_xyz",
        "is_active": True,
        "year": year,
        "metadata": {},
    }
    if include_expand and cm_id is not None:
        data["expand"] = {
            "session": {
                "id": "session_pb_id_xyz",
                "cm_id": cm_id,
                "name": "Session 1",
                "year": year,
            },
        }
    return Record(data)


class TestSweepMalformedScenarioRecord:
    """A saved_scenarios row missing the expanded session relation or with a
    zero year would otherwise produce session_cm_id=0/year=0 — which the
    in-flight guard can never match against a real run. The handler must
    reject these up-front with 422."""

    def test_422_when_scenario_record_missing_session_expand(self) -> None:
        """Record fetched without expand (or with a broken session FK) has
        no expand['session'].cm_id → session_cm_id resolves to 0 → 422."""
        scenario = _scenario_record(cm_id=None, year=2026, include_expand=False)

        with _sweep_client_with_scenario(scenario) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-broken"},
            )

        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_422_when_scenario_record_year_is_zero(self) -> None:
        scenario = _scenario_record(cm_id=1000001, year=0)

        with _sweep_client_with_scenario(scenario) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-broken"},
            )

        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_422_when_expanded_session_cm_id_is_zero(self) -> None:
        """Explicit zero on the expanded relation must also be rejected."""
        scenario = _scenario_record(cm_id=0, year=2026)

        with _sweep_client_with_scenario(scenario) as client:
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-zero"},
            )

        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Real-shape regression: PocketBase Record exposes `session` as the relation
# FK string, NOT as `session_cm_id`. The cm_id only lives under
# `expand['session'].cm_id` and is only present when get_one is called with
# {"expand": "session"}. Without that, every scenario sweep returns 422 in
# production despite passing MagicMock-based tests that pre-stamp
# `record.session_cm_id` directly.
# ---------------------------------------------------------------------------


def _scenario_get_one_with_expand_gating(
    *,
    cm_id: int,
    year: int,
    scenario_id: str = "scen-real",
) -> Any:
    """get_one side_effect that mimics real PocketBase behavior: the expanded
    session record (with `cm_id`) only appears when the caller passes
    {"expand": "session"} as the second arg to get_one. Without expand, the
    record exposes only `session` (FK string) — the same shape the real PB
    Python client produces.
    """
    from pocketbase.models.record import Record

    def side_effect(*args: Any, **kwargs: Any) -> Record:
        params = args[1] if len(args) >= 2 else kwargs.get("query_params", {})
        data: dict[str, Any] = {
            "id": scenario_id,
            "name": "scenario-real-shape",
            "description": "",
            "session": "session_pb_id_xyz",
            "is_active": True,
            "year": year,
            "metadata": {},
        }
        if isinstance(params, dict) and params.get("expand") == "session":
            data["expand"] = {
                "session": {
                    "id": "session_pb_id_xyz",
                    "cm_id": cm_id,
                    "name": "Session 1",
                    "year": year,
                },
            }
        return Record(data)

    return side_effect


@contextmanager
def _sweep_client_with_real_scenario_pb(
    *,
    cm_id: int,
    year: int,
    solver_runs_state: dict[str, Any] | None = None,
) -> Iterator[tuple[TestClient, AsyncMock]]:
    """Variant of _sweep_client where pb.collection('saved_scenarios').get_one
    is wired to the expand-gating side_effect. Yields (client, snapshot_mock)
    so tests can assert what session_cm_id was actually resolved and passed
    to snapshot_session_input."""
    from api.routers.solver import router

    if solver_runs_state is None:
        solver_runs_state = {}

    mock_pb = MagicMock()
    mock_pb.collection.return_value.get_one.side_effect = _scenario_get_one_with_expand_gating(cm_id=cm_id, year=year)

    snapshot_mock = AsyncMock()
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
        patch("api.routers.solver.run_sweep", AsyncMock()),
    ):
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client, snapshot_mock


class TestSweepScenarioRecordRealShape:
    """Regression guard: scenario sweeps must read session_cm_id via
    expand['session'].cm_id, not via getattr(record, 'session_cm_id', 0).

    Real PB saved_scenarios records have a `session` relation FK and no
    `session_cm_id` field (per migration 1500000021). Without {"expand":
    "session"} on get_one, getattr returns 0 and the round-3 422 guard
    fires unconditionally on every scenario sweep in production.
    """

    def test_scenario_sweep_succeeds_with_real_shaped_record(self) -> None:
        with _sweep_client_with_real_scenario_pb(cm_id=1000001, year=2026) as (client, snapshot_mock):
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-real"},
            )

        assert resp.status_code == 202, (
            f"scenario sweep must succeed against a real-shaped PB record; got {resp.status_code}: {resp.text}"
        )
        # Resolved cm_id must come from expand['session'].cm_id, not from
        # the missing top-level session_cm_id attribute.
        assert snapshot_mock.await_count == 1
        await_args = snapshot_mock.await_args
        assert await_args is not None
        assert await_args.kwargs["session_cm_id"] == 1000001
        assert await_args.kwargs["year"] == 2026

    def test_scenario_sweep_persists_resolved_cm_id_on_pre_created_runs(self) -> None:
        """Pre-created solver_runs entries must carry the resolved cm_id, not 0."""
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client_with_real_scenario_pb(cm_id=1000002, year=2026, solver_runs_state=solver_runs_state) as (
            client,
            _,
        ):
            resp = client.post(
                "/api/solver/run-sweep",
                json={"scenario_id": "scen-real"},
            )
            assert resp.status_code == 202, resp.text

        sweep_entries = [r for r in solver_runs_state.values() if r.get("config", {}).get("sweep_id")]
        assert sweep_entries, "expected pre-created sweep entries"
        for entry in sweep_entries:
            assert entry["session_cm_id"] == 1000002, (
                f"pre-created entry must carry resolved cm_id from expand, got {entry}"
            )

"""POST /api/solver/run-sweep pre-creates PocketBase solver_runs rows.

Server-side rows let the frontend show the "sweep in progress" banner across
page refreshes (the previous client-only state was wiped on remount).

The rows are written with status='pending' and details.sweep_id BEFORE the
background orchestration task starts — so a refresh moments after kickoff,
when no child has completed yet, still finds rows to derive in-flight state
from.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

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


def _make_app(router: Any) -> FastAPI:
    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user
    return app


@contextmanager
def _sweep_client(
    solver_runs_state: dict[str, Any],
    snapshot_side_effect: Exception | None = None,
) -> Iterator[tuple[TestClient, MagicMock]]:
    """TestClient + the patched pb mock, with all background side-effects stubbed."""
    from api.routers.solver import router

    app = _make_app(router)
    mock_pb = MagicMock()
    # collection().create() returns a record with an id, mirroring the real SDK
    mock_pb.collection.return_value.create.return_value = MagicMock(id="pb_record_x")
    mock_pb.collection.return_value.update.return_value = MagicMock(id="pb_record_x")

    snapshot_mock = AsyncMock()
    if snapshot_side_effect is not None:
        snapshot_mock.side_effect = snapshot_side_effect
    else:
        snapshot_mock.return_value = {"frozen": True}

    with (
        patch("api.routers.solver.solver_runs", solver_runs_state),
        patch("api.routers.solver.pb", mock_pb),
        patch("api.routers.solver.snapshot_session_input", snapshot_mock),
        # Stub the orchestration coroutine so no child runs actually launch
        patch("api.routers.solver.run_sweep", new=AsyncMock()),
    ):
        yield TestClient(app, raise_server_exceptions=False), mock_pb


def _pb_create_payloads(mock_pb: MagicMock) -> list[dict[str, Any]]:
    """Return each kwarg/positional payload passed to pb.collection(...).create."""
    create_calls = mock_pb.collection.return_value.create.call_args_list
    payloads: list[dict[str, Any]] = []
    for call in create_calls:
        # SDK signature: collection.create(data) — first positional or `data` kwarg
        if call.args:
            payloads.append(call.args[0])
        elif "data" in call.kwargs:
            payloads.append(call.kwargs["data"])
    return payloads


class TestRunSweepPreCreatesPbRows:
    """Each sweep child gets a PB row written at /run-sweep time."""

    def test_creates_one_pending_row_per_time_budget(self) -> None:
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(solver_runs_state) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60, 180],
                    "label": "test-sweep",
                },
            )

        assert resp.status_code == 202, resp.text
        # Three children = three solver_runs rows
        payloads = _pb_create_payloads(mock_pb)
        solver_run_payloads = [p for p in payloads if p.get("status") == "pending"]
        assert len(solver_run_payloads) == 3, f"Expected 3 pending rows, saw {len(solver_run_payloads)}: {payloads}"

    def test_each_row_has_sweep_id_in_details(self) -> None:
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(solver_runs_state) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60],
                    "label": "test-sweep",
                },
            )

        assert resp.status_code == 202, resp.text
        payloads = _pb_create_payloads(mock_pb)
        pending = [p for p in payloads if p.get("status") == "pending"]
        sweep_id_in_response = resp.json()["sweep_id"]
        assert len(pending) == 2, f"expected 2 pre-created rows, got {len(pending)}"
        for payload in pending:
            details_raw = payload.get("details")
            assert details_raw is not None, f"row missing details: {payload}"
            details = json.loads(details_raw) if isinstance(details_raw, str) else details_raw
            assert details.get("sweep_id") == sweep_id_in_response, (
                f"row sweep_id mismatch: {details.get('sweep_id')} vs {sweep_id_in_response}"
            )

    def test_each_row_has_run_id_matching_response(self) -> None:
        """Pre-created PB rows carry the same run_id values returned in the response,
        so child UPDATE-by-run_id later can find them."""
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(solver_runs_state) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60],
                },
            )

        assert resp.status_code == 202, resp.text
        run_ids_in_response = set(resp.json()["run_ids"])
        payloads = _pb_create_payloads(mock_pb)
        pending = [p for p in payloads if p.get("status") == "pending"]
        run_ids_in_pb = {p.get("run_id") for p in pending}
        assert run_ids_in_pb == run_ids_in_response, (
            f"PB row run_ids {run_ids_in_pb} != response run_ids {run_ids_in_response}"
        )

    def test_each_row_records_time_budget(self) -> None:
        """details.time_limit_seconds matches the requested budget for that child."""
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(solver_runs_state) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60, 180],
                },
            )

        assert resp.status_code == 202, resp.text
        payloads = _pb_create_payloads(mock_pb)
        pending = [p for p in payloads if p.get("status") == "pending"]
        budgets_seen = []
        for payload in pending:
            details_raw = payload.get("details")
            assert details_raw is not None
            details = json.loads(details_raw) if isinstance(details_raw, str) else details_raw
            budgets_seen.append(details.get("time_limit_seconds"))
        assert sorted(budgets_seen) == [30, 60, 180], f"budgets seen: {budgets_seen}"

    def test_rollback_deletes_pre_created_rows_on_snapshot_failure(self) -> None:
        """If snapshot_session_input raises, the pre-created PB rows are deleted
        so they don't linger as ghost pending rows in the UI."""
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(
            solver_runs_state,
            snapshot_side_effect=RuntimeError("snapshot blew up"),
        ) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60],
                },
            )

        # The error propagates to the global handler as 500
        assert resp.status_code == 500, resp.text
        # Two creates happened (pre-create), then both must be deleted
        payloads = _pb_create_payloads(mock_pb)
        pending = [p for p in payloads if p.get("status") == "pending"]
        assert len(pending) == 2, f"expected 2 pre-creates, got {len(pending)}"
        delete_calls = mock_pb.collection.return_value.delete.call_args_list
        assert len(delete_calls) == 2, (
            f"expected 2 deletes after snapshot failure, got {len(delete_calls)}: {delete_calls}"
        )

    def test_each_row_has_year(self) -> None:
        """Each pre-created PB row must include year (required by schema)."""
        solver_runs_state: dict[str, Any] = {}
        with _sweep_client(solver_runs_state) as (client, mock_pb):
            resp = client.post(
                "/api/solver/run-sweep",
                json={
                    "session_cm_id": 1000001,
                    "year": 2026,
                    "time_budgets": [30, 60],
                    "label": "test-sweep",
                },
            )

        assert resp.status_code == 202, resp.text
        payloads = _pb_create_payloads(mock_pb)
        pending = [p for p in payloads if p.get("status") == "pending"]
        assert len(pending) == 2, f"expected 2 pre-created rows, got {len(pending)}: {payloads}"
        for payload in pending:
            assert "year" in payload, f"year must be present in pre-created PB row: {payload}"
            assert payload["year"] == 2026, f"year must equal request.year=2026: {payload}"

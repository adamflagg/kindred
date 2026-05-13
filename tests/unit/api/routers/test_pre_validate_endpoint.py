"""Shape tests for POST /api/solver/pre-validate.

After the Stream 6 refactor, the endpoint must:
  - Include a top-level ``impossibility_report`` field with keys:
    total_impossible, affected_campers, by_reason, flat, clusters
  - Remove ``statistics.unsatisfiable_requests``
  - Preserve valid / errors / warnings / statistics / session_breakdown /
    related_sessions in the response

Auth override pattern mirrors test_satisfaction_router.py:
- Build a minimal FastAPI app with just the solver router.
- Override get_current_user with an admin user.
- Patch module-level deps so no real PB or network calls occur.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.models_v2 import DirectSolverInput


def _admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _empty_solver_input() -> DirectSolverInput:
    """Minimal DirectSolverInput with no persons, bunks, or requests."""
    return DirectSolverInput(persons=[], requests=[], bunks=[])


@dataclass
class _FakeReport:
    """Minimal stand-in for ImpossibilityReport."""

    total_impossible: int = 0
    affected_campers: int = 0
    by_reason: dict[str, object] = field(default_factory=dict)
    flat: list[object] = field(default_factory=list)
    clusters: list[object] = field(default_factory=list)


def _make_session_ctx(session_cm_id: int = 1000001, year: int = 2026) -> MagicMock:
    ctx = MagicMock()
    ctx.session_cm_id = session_cm_id
    ctx.year = year
    ctx.session_relation_filter = f"session.cm_id = {session_cm_id}"
    ctx.session_id_filter = f"session_cm_id = {session_cm_id}"
    ctx.related_session_ids = [session_cm_id]
    return ctx


def _mock_pb() -> MagicMock:
    """Minimal mock of the PocketBase client that returns empty lists."""
    mock = MagicMock()
    mock.collection.return_value.get_full_list.return_value = []
    return mock


@pytest.fixture
def client() -> TestClient:
    from api.routers import solver

    app = FastAPI()
    app.include_router(solver.router)
    app.dependency_overrides[get_current_user] = _admin_user
    return TestClient(app)


_PAYLOAD = {"session_cm_id": 1000001, "year": 2026}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def _apply_standard_mocks(
    mock_build_ctx: AsyncMock,
    mock_fetch: AsyncMock,
    mock_prepare: MagicMock,
    mock_validate: MagicMock,
    mock_config: MagicMock,
    report: _FakeReport | None = None,
) -> None:
    """Set return values on the standard set of mocks."""
    mock_build_ctx.return_value = _make_session_ctx()
    mock_fetch.return_value = ([], [], [], [], [])
    mock_prepare.return_value = _empty_solver_input()
    mock_validate.return_value = report or _FakeReport()
    mock_config.get_instance.return_value = MagicMock()


def test_response_includes_impossibility_report(client: TestClient) -> None:
    """Response must contain top-level ``impossibility_report`` key."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "impossibility_report" in body, "missing impossibility_report field"
    ir = body["impossibility_report"]
    assert "total_impossible" in ir
    assert "affected_campers" in ir
    assert "by_reason" in ir
    assert "flat" in ir
    assert "clusters" in ir


def test_statistics_does_not_include_unsatisfiable_requests(client: TestClient) -> None:
    """``statistics.unsatisfiable_requests`` must not be present in the response."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "statistics" in body
    assert "unsatisfiable_requests" not in body["statistics"], (
        "statistics.unsatisfiable_requests must be removed; use impossibility_report instead"
    )


def test_standard_fields_preserved(client: TestClient) -> None:
    """valid / errors / warnings / statistics / session_breakdown / related_sessions must still be present."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    for key in ("valid", "errors", "warnings", "statistics", "session_breakdown", "related_sessions"):
        assert key in body, f"missing required field: {key}"

    stats = body["statistics"]
    for key in (
        "total_campers",
        "total_bunks",
        "total_capacity",
        "total_requests",
        "campers_with_requests",
        "campers_without_requests",
    ):
        assert key in stats, f"missing statistics.{key}"


def test_affected_campers_warning_generated(client: TestClient) -> None:
    """When affected_campers > 0, a warning must appear in ``warnings``."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(
            mock_build_ctx,
            mock_fetch,
            mock_prepare,
            mock_validate,
            mock_config,
            report=_FakeReport(total_impossible=3, affected_campers=3),
        )
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["warnings"]) > 0, "expected at least one warning for affected_campers > 0"
    assert any("3" in w for w in body["warnings"]), "warning should mention the affected camper count"

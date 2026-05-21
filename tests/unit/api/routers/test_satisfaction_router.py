"""Integration tests for GET /api/satisfaction.

Auth override pattern mirrors test_bunk_graph_satisfaction_fields.py:
- Build a minimal FastAPI app with just the satisfaction router.
- Override get_current_user with an admin user (is_admin=True bypasses all
  require_permission checks, since the checker short-circuits on is_admin).
- Patch module-level deps (build_session_context, session_satisfaction) so
  no real PB or network calls occur.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import RequestBucket


def _admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _empty_camper(cm_id: int) -> CamperSatisfaction:
    return CamperSatisfaction(
        person_cm_id=cm_id,
        per_request=[],
        counted_totals={
            RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=0, total=0),
            RequestBucket.STAFF: BucketCount(satisfied=0, total=0),
        },
        immaterial=BucketCount(satisfied=0, total=0),
        flags=SatisfactionFlags(
            parent_min_one_violation=False,
            staff_unsatisfied_alert=False,
            has_any_counted_request=False,
        ),
    )


@pytest.fixture
def client() -> TestClient:
    from api.routers import satisfaction

    app = FastAPI()
    app.include_router(satisfaction.router)
    app.dependency_overrides[get_current_user] = _admin_user
    return TestClient(app)


@patch("api.routers.satisfaction.session_satisfaction")
@patch("api.routers.satisfaction.build_session_context", new_callable=AsyncMock)
def test_endpoint_widens_to_related_sessions(
    mock_build_ctx: AsyncMock,
    mock_session_sat: MagicMock,
    client: TestClient,
) -> None:
    """SessionContext.related_session_ids is forwarded to session_satisfaction."""
    ctx = MagicMock()
    ctx.related_session_ids = [999, 998]
    mock_build_ctx.return_value = ctx

    mock_session_sat.return_value = SatisfactionResponse(
        campers={1: _empty_camper(1)},
        session_cm_id=999,
        year=2026,
        scenario_id=None,
    )

    response = client.get("/api/satisfaction?session=999&year=2026")
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["session_cm_id"] == 999
    assert "campers" in body

    # Verify session_satisfaction was called with the WIDENED id list
    mock_session_sat.assert_called_once()
    call_kwargs = mock_session_sat.call_args.kwargs
    assert call_kwargs["session_cm_ids"] == [999, 998]
    assert call_kwargs["year"] == 2026
    assert call_kwargs["scenario_id"] is None


@patch("api.routers.satisfaction.session_satisfaction")
@patch("api.routers.satisfaction.build_session_context", new_callable=AsyncMock)
def test_endpoint_passes_scenario_through(
    mock_build_ctx: AsyncMock,
    mock_session_sat: MagicMock,
    client: TestClient,
) -> None:
    """scenario query param is forwarded to session_satisfaction as scenario_id."""
    ctx = MagicMock()
    ctx.related_session_ids = [999]
    mock_build_ctx.return_value = ctx

    mock_session_sat.return_value = SatisfactionResponse(
        campers={},
        session_cm_id=999,
        year=2026,
        scenario_id="abc123def456789",
    )

    response = client.get("/api/satisfaction?session=999&year=2026&scenario=abc123def456789")
    assert response.status_code == 200, response.text

    mock_session_sat.assert_called_once()
    call_kwargs = mock_session_sat.call_args.kwargs
    assert call_kwargs["scenario_id"] == "abc123def456789"


@patch("api.routers.satisfaction.session_satisfaction")
@patch("api.routers.satisfaction.build_session_context", new_callable=AsyncMock)
def test_endpoint_no_scenario_passes_none(
    mock_build_ctx: AsyncMock,
    mock_session_sat: MagicMock,
    client: TestClient,
) -> None:
    """Omitting scenario query param results in scenario_id=None."""
    ctx = MagicMock()
    ctx.related_session_ids = [42]
    mock_build_ctx.return_value = ctx

    mock_session_sat.return_value = SatisfactionResponse(
        campers={},
        session_cm_id=42,
        year=2025,
        scenario_id=None,
    )

    response = client.get("/api/satisfaction?session=42&year=2025")
    assert response.status_code == 200, response.text

    mock_session_sat.assert_called_once()
    call_kwargs = mock_session_sat.call_args.kwargs
    assert call_kwargs["scenario_id"] is None


# ---------------------------------------------------------------------------
# Input validation tests (Task 19)
# ---------------------------------------------------------------------------


def test_session_zero_rejected(client: TestClient) -> None:
    r = client.get("/api/satisfaction?session=0&year=2026")
    assert r.status_code == 422


def test_session_negative_rejected(client: TestClient) -> None:
    r = client.get("/api/satisfaction?session=-5&year=2026")
    assert r.status_code == 422


def test_year_below_range_rejected(client: TestClient) -> None:
    r = client.get("/api/satisfaction?session=5&year=1900")
    assert r.status_code == 422


def test_scenario_id_format_rejected(client: TestClient) -> None:
    r = client.get("/api/satisfaction?session=5&year=2026&scenario=not-real")
    assert r.status_code == 422


@patch("api.routers.satisfaction.session_satisfaction")
@patch("api.routers.satisfaction.build_session_context", new_callable=AsyncMock)
def test_scenario_id_valid_format_accepted(
    mock_build_ctx: AsyncMock,
    mock_session_sat: MagicMock,
    client: TestClient,
) -> None:
    """A real-shaped 15-char alphanumeric scenario id should pass validation."""
    ctx = MagicMock()
    ctx.related_session_ids = [5]
    mock_build_ctx.return_value = ctx
    mock_session_sat.return_value = SatisfactionResponse(
        campers={},
        session_cm_id=5,
        year=2026,
        scenario_id="abc123def456789",
    )

    r = client.get("/api/satisfaction?session=5&year=2026&scenario=abc123def456789")
    assert r.status_code != 422

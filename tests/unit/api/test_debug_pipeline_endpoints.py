"""Tests for pipeline debug read endpoints.

Tests GET pipeline-runs, pipeline-runs/{run_id}/summary,
pipeline-traces/{trace_id}, pipeline-traces/by-camper/{cm_id},
and POST pipeline-runs/{run_id}/pin.
"""

from __future__ import annotations

import sys
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user


def _override_auth(app: FastAPI) -> None:
    """Override auth dependency to provide an admin user for testing."""

    def _mock_admin_user() -> AuthUser:
        return AuthUser(
            username="TestAdmin",
            email="test@example.com",
            display_name="Test Admin",
            groups=["admin"],
            is_admin=True,
        )

    app.dependency_overrides[get_current_user] = _mock_admin_user


def _make_mock_pb_record(**kwargs: Any) -> MagicMock:
    """Create a mock PB record with attribute access."""
    record = MagicMock()
    for k, v in kwargs.items():
        setattr(record, k, v)
    return record


def _make_pb_run_record(
    record_id: str = "rec_run_1",
    run_id: str = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    year: int = 2025,
    session: str = "1",
    source_fields: list[str] | None = None,
    limit_param: int = 0,
    force: bool = False,
    trace_count: int = 5,
    status_breakdown: dict[str, Any] | None = None,
    pinned: bool = False,
    created: str = "2025-06-15T10:00:00Z",
) -> MagicMock:
    return _make_mock_pb_record(
        id=record_id,
        run_id=run_id,
        year=year,
        session=session,
        source_fields=source_fields or ["bunk_with"],
        limit_param=limit_param,
        force=force,
        trace_count=trace_count,
        status_breakdown=status_breakdown or {"resolved": 3, "pending": 1, "declined": 1, "skipped": 0},
        pinned=pinned,
        created=created,
    )


def _make_pb_summary_record(
    record_id: str = "rec_sum_1",
    run_id: str = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    trace: str = "rec_trace_1",
    original_request: str = "rec_orig_1",
    requester_cm_id: int = 12345,
    requester_name: str = "Emma Johnson",
    target_name: str = "Liam Garcia",
    source_field: str = "bunk_with",
    final_status: str = "RESOLVED",
    final_confidence: float = 0.95,
    resolution_method: str = "exact_match",
    disposition_reason: str = "exact_match",
    is_reciprocal: bool = False,
) -> MagicMock:
    return _make_mock_pb_record(
        id=record_id,
        run_id=run_id,
        trace=trace,
        original_request=original_request,
        bunk_request="",
        requester_cm_id=requester_cm_id,
        requester_name=requester_name,
        target_name=target_name,
        source_field=source_field,
        session_cm_id=1000001,
        request_type="BUNK_WITH",
        final_status=final_status,
        final_confidence=final_confidence,
        resolution_method=resolution_method,
        phase3_triggered=False,
        ai_reasoning_summary="",
        pre_p1_action="parsed",
        year=2025,
        disposition_reason=disposition_reason,
        is_reciprocal=is_reciprocal,
    )


def _make_pb_trace_record(
    record_id: str = "rec_trace_1",
    run_id: str = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    requester_cm_id: int = 12345,
    trace_data: dict[str, Any] | None = None,
) -> MagicMock:
    return _make_mock_pb_record(
        id=record_id,
        run_id=run_id,
        original_request="rec_orig_1",
        requester_cm_id=requester_cm_id,
        year=2025,
        session_cm_id=1000001,
        source_field="bunk_with",
        trace_data=trace_data or {"pre_phase1": {"action": "parsed"}},
        pinned=False,
        schema_version=1,
        created="2025-06-15T10:00:00Z",
    )


@pytest.fixture
def mock_pb() -> MagicMock:
    """Create a mock PocketBase client."""
    return MagicMock()


@pytest.fixture
def client_with_mock_pb(mock_pb: MagicMock) -> Generator[tuple[TestClient, MagicMock], None, None]:
    """Create test client with mocked PB client.

    Patches the pb module-level variable in the debug router so all
    endpoints use the mock. Endpoints are synchronous so no async patching needed.
    """
    with patch("api.routers.debug.pb", mock_pb):
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)
        _override_auth(app)

        yield TestClient(app), mock_pb


class TestListPipelineRuns:
    """Test GET /api/debug/pipeline-runs endpoint."""

    def test_returns_runs_list(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        run_record = _make_pb_run_record()
        mock_pb.collection.return_value.get_full_list.return_value = [run_record]

        response = client.get("/api/debug/pipeline-runs")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert data["total"] == 1
        assert data["items"][0]["run_id"] == "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
        assert data["items"][0]["year"] == 2025
        assert data["items"][0]["trace_count"] == 5

    def test_returns_empty_list(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        mock_pb.collection.return_value.get_full_list.return_value = []

        response = client.get("/api/debug/pipeline-runs")

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0


class TestPinPipelineRun:
    """Test POST /api/debug/pipeline-runs/{run_id}/pin endpoint."""

    def test_toggles_pin_status(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        run_record = _make_pb_run_record(pinned=False)
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_full_list.return_value = [run_record]
        mock_collection.update.return_value = _make_mock_pb_record(pinned=True)

        response = client.post("/api/debug/pipeline-runs/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/pin")

        assert response.status_code == 200
        data = response.json()
        assert data["run_id"] == "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
        assert data["pinned"] is True


class TestGetPipelineRunSummary:
    """Test GET /api/debug/pipeline-runs/{run_id}/summary endpoint."""

    def test_returns_summary_list(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        summary_record = _make_pb_summary_record()
        mock_collection = mock_pb.collection.return_value
        result_list = MagicMock()
        result_list.items = [summary_record]
        result_list.total_items = 1
        result_list.page = 1
        result_list.per_page = 50
        mock_collection.get_list.return_value = result_list

        response = client.get("/api/debug/pipeline-runs/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["requester_name"] == "Emma Johnson"
        assert data["items"][0]["final_status"] == "RESOLVED"

    def test_supports_filter_params(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        result_list = MagicMock()
        result_list.items = []
        result_list.total_items = 0
        result_list.page = 1
        result_list.per_page = 50
        mock_collection.get_list.return_value = result_list

        response = client.get(
            "/api/debug/pipeline-runs/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/summary",
            params={"final_status": "RESOLVED", "page": 1, "per_page": 20},
        )

        assert response.status_code == 200


class TestGetPipelineTrace:
    """Test GET /api/debug/pipeline-traces/{trace_id} endpoint."""

    def test_returns_full_trace(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        trace_record = _make_pb_trace_record()
        mock_pb.collection.return_value.get_one.return_value = trace_record

        response = client.get("/api/debug/pipeline-traces/rec_trace_1")

        assert response.status_code == 200
        data = response.json()
        assert "trace" in data
        assert data["trace"]["id"] == "rec_trace_1"
        assert data["trace"]["trace_data"]["pre_phase1"]["action"] == "parsed"

    def test_not_found_returns_404(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        from pocketbase.errors import ClientResponseError

        mock_pb.collection.return_value.get_one.side_effect = ClientResponseError(url="", status=404, data={})

        response = client.get("/api/debug/pipeline-traces/nonexistent")

        assert response.status_code == 404


class TestGetTracesByCamper:
    """Test GET /api/debug/pipeline-traces/by-camper/{cm_id} endpoint."""

    def test_returns_traces_for_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        trace_record = _make_pb_trace_record(requester_cm_id=12345)
        mock_pb.collection.return_value.get_full_list.return_value = [trace_record]

        response = client.get("/api/debug/pipeline-traces/by-camper/12345")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["requester_cm_id"] == 12345

    def test_returns_empty_for_unknown_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = client_with_mock_pb

        mock_pb.collection.return_value.get_full_list.return_value = []

        response = client.get("/api/debug/pipeline-traces/by-camper/99999")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

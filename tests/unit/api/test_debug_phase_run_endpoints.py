"""Tests for pipeline debug execution endpoints.

Tests POST run-phase2, run-phase3, run-from-phase/{phase}, and run-full-trace.
These use PhaseRunner with mocked orchestrator dependencies.
"""

import sys
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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


def _make_trace_record_with_data() -> MagicMock:
    """Create a trace record with realistic trace_data."""
    return _make_mock_pb_record(
        id="rec_trace_1",
        run_id="abc123",
        original_request="rec_orig_1",
        requester_cm_id=12345,
        year=2025,
        session_cm_id=1000001,
        source_field="bunk_request_form",
        trace_data={
            "pre_phase1": {
                "action": "parsed",
                "original_text": "bunk with Emma Johnson",
                "field_path": "bunk_with",
            },
            "phase1_parse": {
                "ran": True,
                "parsed_intents": [{"target_name": "Emma Johnson", "request_type": "BUNK_WITH", "confidence": 0.95}],
                "is_valid": True,
            },
            "phase2_resolution": [
                {
                    "target_name": "Emma Johnson",
                    "final_result": {
                        "person_cm_id": 67890,
                        "person_name": "Emma Johnson",
                        "confidence": 0.95,
                        "method": "exact_match",
                        "is_resolved": True,
                        "is_ambiguous": False,
                    },
                }
            ],
        },
        pinned=False,
        created="2025-06-15T10:00:00Z",
    )


@pytest.fixture
def mock_pb() -> MagicMock:
    """Create a mock PocketBase client."""
    return MagicMock()


@pytest.fixture
def mock_phase_runner() -> MagicMock:
    """Create a mock PhaseRunner."""
    runner = MagicMock()
    runner.run_phase2 = AsyncMock(return_value=[])
    runner.run_phase3 = AsyncMock(return_value=[])
    runner.run_from_phase = AsyncMock(return_value={"dry_run": True, "phase2_results": [], "phase3_results": []})
    runner.run_full_trace = AsyncMock(
        return_value={"dry_run": True, "phase1_results": [], "phase2_results": [], "phase3_results": []}
    )
    return runner


@pytest.fixture
def client_with_mocks(
    mock_pb: MagicMock, mock_phase_runner: MagicMock
) -> Generator[tuple[TestClient, MagicMock, MagicMock]]:
    """Create test client with mocked PB client and PhaseRunner."""
    with patch("api.routers.debug.pb", mock_pb):
        with patch("api.routers.debug._create_phase_runner", return_value=mock_phase_runner):
            from api.routers.debug import router

            app = FastAPI()
            app.include_router(router)
            _override_auth(app)

            yield TestClient(app), mock_pb, mock_phase_runner


class TestRunPhase2Endpoint:
    """Test POST /api/debug/run-phase2 endpoint."""

    def test_accepts_trace_id(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        # Set up PB to return a trace record
        mock_pb.collection.return_value.get_one.return_value = _make_trace_record_with_data()

        response = client.post(
            "/api/debug/run-phase2",
            json={"trace_id": "rec_trace_1", "year": 2025, "session_cm_ids": [1000001]},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["phase"] == "phase2"
        assert data["dry_run"] is True

    def test_returns_error_on_missing_trace(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        from pocketbase.errors import ClientResponseError

        mock_pb.collection.return_value.get_one.side_effect = ClientResponseError(url="", status=404)

        response = client.post(
            "/api/debug/run-phase2",
            json={"trace_id": "nonexistent", "year": 2025, "session_cm_ids": [1000001]},
        )

        assert response.status_code == 404


class TestRunPhase3Endpoint:
    """Test POST /api/debug/run-phase3 endpoint."""

    def test_accepts_trace_id(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        mock_pb.collection.return_value.get_one.return_value = _make_trace_record_with_data()

        response = client.post(
            "/api/debug/run-phase3",
            json={"trace_id": "rec_trace_1", "year": 2025, "session_cm_ids": [1000001]},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["phase"] == "phase3"
        assert data["dry_run"] is True


class TestRunFromPhaseEndpoint:
    """Test POST /api/debug/run-from-phase/{phase} endpoint."""

    @staticmethod
    def _setup_flush_mock(mock_pb: MagicMock) -> None:
        """Configure mock PB to return a trace record with string id after flush."""
        mock_flush_record = MagicMock()
        mock_flush_record.id = "pb_trace_from_phase"
        mock_pb.collection.return_value.get_list.return_value.items = [mock_flush_record]

    def test_run_from_phase2(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        mock_pb.collection.return_value.get_one.return_value = _make_trace_record_with_data()
        self._setup_flush_mock(mock_pb)

        response = client.post(
            "/api/debug/run-from-phase/phase2",
            json={
                "trace_id": "rec_trace_1",
                "year": 2025,
                "session_cm_ids": [1000001],
                "dry_run": True,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["phase"] == "phase2"
        assert data["dry_run"] is True
        assert data["trace_id"] is not None  # Now returns a trace_id

    def test_run_from_phase3(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        mock_pb.collection.return_value.get_one.return_value = _make_trace_record_with_data()
        self._setup_flush_mock(mock_pb)

        response = client.post(
            "/api/debug/run-from-phase/phase3",
            json={
                "trace_id": "rec_trace_1",
                "year": 2025,
                "session_cm_ids": [1000001],
                "dry_run": True,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["phase"] == "phase3"

    def test_invalid_phase_returns_400(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        response = client.post(
            "/api/debug/run-from-phase/phase99",
            json={
                "trace_id": "rec_trace_1",
                "year": 2025,
                "session_cm_ids": [1000001],
                "dry_run": True,
            },
        )

        assert response.status_code == 400

    def test_dry_run_default_true(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        mock_pb.collection.return_value.get_one.return_value = _make_trace_record_with_data()
        self._setup_flush_mock(mock_pb)

        response = client.post(
            "/api/debug/run-from-phase/phase2",
            json={
                "trace_id": "rec_trace_1",
                "year": 2025,
                "session_cm_ids": [1000001],
                # dry_run not specified — should default to True
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["dry_run"] is True


class TestRunFullTraceEndpoint:
    """Test POST /api/debug/run-full-trace endpoint."""

    def test_accepts_original_request_ids(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        response = client.post(
            "/api/debug/run-full-trace",
            json={
                "original_request_ids": ["rec_orig_1"],
                "year": 2025,
                "session_cm_ids": [1000001],
                "dry_run": True,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["phase"] == "full"
        assert data["dry_run"] is True

    def test_dry_run_false_supported(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        response = client.post(
            "/api/debug/run-full-trace",
            json={
                "original_request_ids": ["rec_orig_1"],
                "year": 2025,
                "session_cm_ids": [1000001],
                "dry_run": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["dry_run"] is False

    def test_requires_at_least_one_request_id(self, client_with_mocks: tuple[TestClient, MagicMock, MagicMock]) -> None:
        client, mock_pb, mock_runner = client_with_mocks

        response = client.post(
            "/api/debug/run-full-trace",
            json={
                "original_request_ids": [],
                "year": 2025,
                "session_cm_ids": [1000001],
            },
        )

        assert response.status_code == 422  # Validation error (min_length=1)

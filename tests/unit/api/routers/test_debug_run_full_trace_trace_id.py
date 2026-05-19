"""Tests for POST /api/debug/run-full-trace trace_id return and stop_at_phase.

Verifies that:
1. run-full-trace accepts stop_at_phase parameter
2. run-full-trace returns a trace_id when original records exist
3. run-full-trace returns trace_id=None when no records found
4. run-from-phase passes stop_at_phase through to PhaseRunner
"""

from __future__ import annotations

import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
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


def _make_mock_original_request(
    record_id: str = "rec_orig_1",
    requester_cm_id: int = 12345,
    first_name: str = "Emma",
    last_name: str = "Johnson",
    preferred_name: str | None = None,
    grade: int | None = 5,
    field: str = "bunk_with",
    content: str = "I want to bunk with Liam Garcia",
    year: int = 2025,
) -> MagicMock:
    """Create a mock OriginalRequest object."""
    record = MagicMock()
    record.id = record_id
    record.requester_cm_id = requester_cm_id
    record.first_name = first_name
    record.last_name = last_name
    record.preferred_name = preferred_name
    record.grade = grade
    record.field = field
    record.content = content
    record.year = year
    return record


@pytest.fixture
def mock_pb() -> MagicMock:
    """Create a mock PocketBase client."""
    return MagicMock()


@pytest.fixture
def client_with_mock_pb(mock_pb: MagicMock) -> Generator[tuple[TestClient, MagicMock]]:
    """Create test client with mocked PB client."""
    with patch("api.routers.debug.pb", mock_pb):
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)
        _override_auth(app)

        yield TestClient(app), mock_pb


class TestRunFullTraceTraceId:
    """Test POST /api/debug/run-full-trace returns trace_id."""

    def test_returns_trace_id_when_records_exist(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """run-full-trace should create trace records and return trace_id."""
        client, mock_pb = client_with_mock_pb

        orig_record = _make_mock_original_request()

        mock_runner = MagicMock()
        mock_runner.run_full_trace = AsyncMock(return_value={"dry_run": True, "phase1": {}})

        mock_trace_record = MagicMock()
        mock_trace_record.id = "pb_trace_rec_001"

        with (
            patch("api.routers.debug.OriginalRequestsLoader") as MockLoader,
            patch("api.routers.debug._create_phase_runner", return_value=mock_runner),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_ids.return_value = [orig_record]
            mock_loader.get_session_for_person.return_value = 1000001

            # Set up the trace collector mock
            mock_collector_instance = MagicMock()
            mock_collector_instance.run_id = "test_run_id_abc123"
            mock_collector_instance._traces = {"rec_orig_1": MagicMock()}
            mock_collector_instance.flush = AsyncMock(return_value="run_rec_id")
            MockTraceCollector.return_value = mock_collector_instance

            # Mock PB query for trace records after flush
            mock_pb.collection.return_value.get_list.return_value.items = [mock_trace_record]

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
        assert data["trace_id"] == "pb_trace_rec_001"

    def test_returns_null_trace_id_when_no_records(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """run-full-trace returns trace_id=None when no original records found."""
        client, mock_pb = client_with_mock_pb

        with (
            patch("api.routers.debug.OriginalRequestsLoader") as MockLoader,
            patch("api.routers.debug._create_phase_runner"),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_ids.return_value = []

            mock_collector_instance = MagicMock()
            mock_collector_instance._traces = {}
            MockTraceCollector.return_value = mock_collector_instance

            response = client.post(
                "/api/debug/run-full-trace",
                json={
                    "original_request_ids": ["nonexistent"],
                    "year": 2025,
                    "session_cm_ids": [1000001],
                    "dry_run": True,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["trace_id"] is None

    def test_accepts_stop_at_phase_parameter(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """run-full-trace should accept and pass stop_at_phase to PhaseRunner."""
        client, mock_pb = client_with_mock_pb

        orig_record = _make_mock_original_request()

        mock_runner = MagicMock()
        mock_runner.run_full_trace = AsyncMock(return_value={"dry_run": True, "phase1": {}})

        with (
            patch("api.routers.debug.OriginalRequestsLoader") as MockLoader,
            patch("api.routers.debug._create_phase_runner", return_value=mock_runner),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_ids.return_value = [orig_record]
            mock_loader.get_session_for_person.return_value = 1000001

            mock_collector_instance = MagicMock()
            mock_collector_instance.run_id = "test_run_id"
            mock_collector_instance._traces = {"rec_orig_1": MagicMock()}
            mock_collector_instance.flush = AsyncMock(return_value="run_rec_id")
            MockTraceCollector.return_value = mock_collector_instance

            mock_pb.collection.return_value.get_list.return_value.items = []

            response = client.post(
                "/api/debug/run-full-trace",
                json={
                    "original_request_ids": ["rec_orig_1"],
                    "year": 2025,
                    "session_cm_ids": [1000001],
                    "dry_run": True,
                    "stop_at_phase": "phase1",
                },
            )

        assert response.status_code == 200
        # Verify stop_at_phase was passed to runner.run_full_trace
        mock_runner.run_full_trace.assert_called_once()
        call_kwargs = mock_runner.run_full_trace.call_args
        assert call_kwargs.kwargs.get("stop_at_phase") == "phase1"

    def test_records_pre_phase1_traces(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """run-full-trace should call record_pre_phase1 for each original record."""
        client, mock_pb = client_with_mock_pb

        orig_record = _make_mock_original_request()

        mock_runner = MagicMock()
        mock_runner.run_full_trace = AsyncMock(return_value={"dry_run": True})

        with (
            patch("api.routers.debug.OriginalRequestsLoader") as MockLoader,
            patch("api.routers.debug._create_phase_runner", return_value=mock_runner),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_ids.return_value = [orig_record]
            mock_loader.get_session_for_person.return_value = 1000001

            mock_collector_instance = MagicMock()
            mock_collector_instance.run_id = "test_run_id"
            mock_collector_instance._traces = {"rec_orig_1": MagicMock()}
            mock_collector_instance.flush = AsyncMock(return_value="run_rec_id")
            MockTraceCollector.return_value = mock_collector_instance

            mock_pb.collection.return_value.get_list.return_value.items = []

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
        # Verify record_pre_phase1 was called
        mock_collector_instance.record_pre_phase1.assert_called_once()
        call_kwargs = mock_collector_instance.record_pre_phase1.call_args
        assert call_kwargs.kwargs["key"] == "rec_orig_1"
        assert call_kwargs.kwargs["original_text"] == "I want to bunk with Liam Garcia"
        assert call_kwargs.kwargs["requester_cm_id"] == 12345
        assert call_kwargs.kwargs["year"] == 2025
        assert call_kwargs.kwargs["session_cm_id"] == 1000001

    def test_flush_failure_does_not_crash(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """If flush fails, the endpoint should still return success with trace_id=None."""
        client, mock_pb = client_with_mock_pb

        orig_record = _make_mock_original_request()

        mock_runner = MagicMock()
        mock_runner.run_full_trace = AsyncMock(return_value={"dry_run": True})

        with (
            patch("api.routers.debug.OriginalRequestsLoader") as MockLoader,
            patch("api.routers.debug._create_phase_runner", return_value=mock_runner),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_ids.return_value = [orig_record]
            mock_loader.get_session_for_person.return_value = 1000001

            mock_collector_instance = MagicMock()
            mock_collector_instance.run_id = "test_run_id"
            mock_collector_instance._traces = {"rec_orig_1": MagicMock()}
            mock_collector_instance.flush = AsyncMock(side_effect=Exception("PB connection failed"))
            MockTraceCollector.return_value = mock_collector_instance

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
        assert data["trace_id"] is None


class TestRunFromPhaseStopAtPhase:
    """Test POST /api/debug/run-from-phase/{phase} passes stop_at_phase."""

    def test_passes_stop_at_phase_to_runner(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """run-from-phase should pass stop_at_phase to PhaseRunner.run_from_phase."""
        client, mock_pb = client_with_mock_pb

        mock_runner = MagicMock()
        mock_runner.run_from_phase = AsyncMock(return_value={"phase2": {}, "phase3": {}})

        # Mock _load_trace_record to return a record with trace_data and metadata
        mock_record = MagicMock()
        mock_record.trace_data = {
            "pre_phase1": {
                "action": "parsed",
                "original_text": "bunk with Emma",
                "requester_info": {"cm_id": 12345, "name": "Liam Garcia", "grade": "5"},
            },
            "phase1_parse": {"ran": True, "parsed_intents": []},
        }
        mock_record.requester_cm_id = 12345
        mock_record.year = 2025
        mock_record.session_cm_id = 1000001
        mock_record.source_field = "bunk_request_form"
        mock_record.original_request = "orig_req_123"

        # Mock the trace record returned after flush
        mock_trace_record = MagicMock()
        mock_trace_record.id = "pb_trace_rec_from_phase"

        with (
            patch("api.routers.debug._create_phase_runner", return_value=mock_runner),
            patch("api.routers.debug._load_trace_record", return_value=mock_record),
            patch("api.routers.debug.TraceCollector") as MockTraceCollector,
        ):
            mock_collector_instance = MagicMock()
            mock_collector_instance.run_id = "test_run_from_phase_id"
            mock_collector_instance.enabled = True
            mock_collector_instance.flush = AsyncMock(return_value="run_rec_id")
            MockTraceCollector.return_value = mock_collector_instance

            # Mock PB query for trace records after flush
            mock_pb.collection.return_value.get_list.return_value.items = [mock_trace_record]

            response = client.post(
                "/api/debug/run-from-phase/phase2",
                json={
                    "trace_id": "existing_trace_id",
                    "year": 2025,
                    "session_cm_ids": [1000001],
                    "dry_run": True,
                    "stop_at_phase": "phase2",
                },
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.json()}"
        data = response.json()
        assert data["success"] is True
        assert data["trace_id"] == "pb_trace_rec_from_phase"
        # Verify stop_at_phase was passed
        mock_runner.run_from_phase.assert_called_once()
        call_kwargs = mock_runner.run_from_phase.call_args
        assert call_kwargs.kwargs.get("stop_at_phase") == "phase2"
        # Verify pre_phase1 was recorded on the collector
        mock_collector_instance.record_pre_phase1.assert_called_once()

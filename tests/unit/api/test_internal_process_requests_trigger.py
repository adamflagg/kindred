"""
Tests for trigger field forwarding on /api/internal/process-requests.

Verifies that the `trigger` body field is accepted and forwarded to
`run_process_requests`, with a default of "manual" when omitted.

Lives under tests/unit/api/ so this dir's conftest applies AUTH_MODE=bypass
before `api.main` builds its app singleton (avoids xdist auth pollution).
"""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

# Minimal mock return value that satisfies the endpoint's result.get() accesses.
_MOCK_RESULT = {
    "success": True,
    "statistics": {
        "requests_created": 0,
        "phase2_ambiguous": 0,
        "phase1_failed": 0,
        "phase1_successful": 0,
        "phase1_first_error": None,
    },
    "already_processed": 0,
}


def test_trigger_defaults_to_manual():
    with patch(
        "api.routers.internal.run_process_requests",
        new=AsyncMock(return_value=_MOCK_RESULT),
    ) as m:
        r = client.post("/api/internal/process-requests", json={"year": 2026, "session": "all"})
        assert r.status_code == 200
        assert m.await_args is not None
        assert m.await_args.kwargs["trigger"] == "manual"


def test_trigger_upload_passes_through():
    with patch(
        "api.routers.internal.run_process_requests",
        new=AsyncMock(return_value=_MOCK_RESULT),
    ) as m:
        r = client.post(
            "/api/internal/process-requests",
            json={"year": 2026, "session": "all", "trigger": "upload"},
        )
        assert r.status_code == 200
        assert m.await_args is not None
        assert m.await_args.kwargs["trigger"] == "upload"


def test_invalid_trigger_rejected():
    """An out-of-range trigger fails fast at the API boundary (422).

    debug_pipeline_runs.trigger is a PocketBase select (upload|scheduled|manual);
    a value outside that set must be rejected before the processor runs so it can
    never reach (and silently break) run-record persistence.
    """
    with patch(
        "api.routers.internal.run_process_requests",
        new=AsyncMock(return_value=_MOCK_RESULT),
    ) as m:
        r = client.post(
            "/api/internal/process-requests",
            json={"year": 2026, "session": "all", "trigger": "bogus"},
        )
        assert r.status_code == 422
        assert m.await_count == 0  # rejected before the processor is invoked

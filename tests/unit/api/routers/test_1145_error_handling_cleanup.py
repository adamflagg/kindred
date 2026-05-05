"""#1145 — clean up remaining HTTPException(500, str(e)) leaks + duck-typing in debug.py.

This module covers the lower-priority items deferred from PR #1141:

  Item 1: Six `except Exception` blocks in api/routers/scenarios.py still
          raise `HTTPException(500, f"... {e!s}")`, leaking exception text
          to API consumers. CLAUDE.md says: never use HTTPException(500,
          str(e)); let the global handler return a generic 500 instead.

  Item 2: Two duck-typed handlers in api/routers/debug.py catch generic
          `Exception` and check `getattr(e, "status", 0) == 404`. This
          catches more than intended (any exception with a `status` attr)
          and is a maintenance trap. Fix: catch `ClientResponseError`
          explicitly and route non-404 PB errors via `pb_error_to_http`.
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

# ---------------------------------------------------------------------------
# Shared helpers (mirror the conventions used in test_pb_error_to_http_adoption.py)
# ---------------------------------------------------------------------------

SENSITIVE_MARKER = "sensitive-internal-detail-from-exception-XYZ"


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


def _make_pb_error(status: int = 404, data: Any = "pb body content") -> Any:
    from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

    return ClientResponseError(url="http://pb/test", status=status, data={"message": data})


def _make_app(router: Any) -> FastAPI:
    """Minimal FastAPI app mirroring main.py's global exception handler."""
    from fastapi import Request

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user
    return app


# ===========================================================================
# Item 1 — Sweep HTTPException(500, f"... {e!s}") leaks in scenarios.py
# ===========================================================================
#
# For each endpoint, raise a generic Exception (NOT a ClientResponseError, so
# the existing pb_error_to_http branch doesn't intercept) carrying a marker
# string and verify:
#   - response status is 500 with generic detail (delegated to global handler)
#   - response body does NOT contain the marker (no exception text leak)
# ---------------------------------------------------------------------------


def _generic_boom() -> Exception:
    """A non-PB Exception whose str() carries SENSITIVE_MARKER."""
    return RuntimeError(f"boom: {SENSITIVE_MARKER}")


class TestCreateScenarioGenericExceptionNoLeak:
    """POST /api/scenarios — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_generic_boom()),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios", json={"name": "x", "session_cm_id": 1, "year": 2025})
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios", json={"name": "x", "session_cm_id": 1, "year": 2025})
        assert SENSITIVE_MARKER not in resp.text


class TestListScenariosGenericExceptionNoLeak:
    """GET /api/scenarios — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        # list_scenarios calls build_session_context first
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_generic_boom()),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios?session_id=1&year=2025")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios?session_id=1&year=2025")
        assert SENSITIVE_MARKER not in resp.text


class TestEvaluateScoreGenericExceptionNoLeak:
    """GET /api/scenarios/score — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_generic_boom()),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios/score?session_id=1&year=2025")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios/score?session_id=1&year=2025")
        assert SENSITIVE_MARKER not in resp.text


class TestUpdateScenarioGenericExceptionNoLeak:
    """PUT /api/scenarios/{id} — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        mock_pb = MagicMock()
        # update_scenario calls pb.collection(SAVED_SCENARIOS).update(...) directly;
        # there is no get_one preflight, so only the update side-effect needs setup.
        mock_pb.collection.return_value.update.side_effect = _generic_boom()
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.put("/api/scenarios/abc", json={"name": "Updated"})
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.put("/api/scenarios/abc", json={"name": "Updated"})
        assert SENSITIVE_MARKER not in resp.text


class TestDeleteScenarioGenericExceptionNoLeak:
    """DELETE /api/scenarios/{id} — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        mock_pb = MagicMock()
        # get_one succeeds, but get_full_list (draft assignments lookup) raises non-PB error
        mock_pb.collection.return_value.get_one.return_value = MagicMock(id="abc", name="x")
        mock_pb.collection.return_value.get_full_list.side_effect = _generic_boom()
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.delete("/api/scenarios/abc")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.delete("/api/scenarios/abc")
        assert SENSITIVE_MARKER not in resp.text


class TestUpdateAssignmentGenericExceptionNoLeak:
    """PUT /api/scenarios/{id}/assignments — generic Exception must not leak via 500 detail."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_generic_boom()),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def _payload(self) -> dict[str, Any]:
        return {"person_id": 1, "bunk_id": 2, "session_cm_id": 3, "year": 2025}

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.put("/api/scenarios/abc/assignments", json=self._payload())
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.put("/api/scenarios/abc/assignments", json=self._payload())
        assert SENSITIVE_MARKER not in resp.text


# ===========================================================================
# Item 2 — Replace duck-typing in debug.py with explicit ClientResponseError
# ===========================================================================
#
# Two handlers currently catch `Exception` and check `getattr(e, "status", 0)`.
# Tests:
#   (a) PB 404 → 404 with the "Trace '<id>' not found" custom message
#       (this user-facing message is intentional; preserve it)
#   (b) PB 500 → 502 (mapped via pb_error_to_http; today this RAISES through
#       the global handler as 500 because non-404 PB errors fall through the
#       bare `raise`; after the fix it should be 502)
#   (c) Non-PB exception with a fake `.status = 404` attribute →
#       global handler 500. Today the duck-typing falsely converts this to
#       a 404 "Trace not found" response.
#   (d) PB 404 detail does not leak the raw PB body
# ---------------------------------------------------------------------------


class _FakeStatusError(Exception):
    """A non-ClientResponseError that nonetheless has a .status attribute.

    The current duck-typing pattern `getattr(e, 'status', 0) == 404` would
    falsely treat this as a "trace not found" 404 response. After the fix
    (explicit ClientResponseError catch), this should fall through and be
    handled as a generic 500 by the global handler.
    """

    def __init__(self, message: str = "fake-status-error", status: int = 404) -> None:
        super().__init__(message)
        self.status = status


class TestGetPipelineTracePbError:
    """GET /api/debug/pipeline-traces/{trace_id} — explicit ClientResponseError handling."""

    @staticmethod
    @contextmanager
    def _client_with_pb_side_effect(side_effect: Any) -> Iterator[TestClient]:
        from api.routers.debug import router

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = side_effect
        app = _make_app(router)
        with patch("api.routers.debug.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_pb_404(self) -> Iterator[TestClient]:
        with self._client_with_pb_side_effect(_make_pb_error(status=404)) as client:
            yield client

    @pytest.fixture
    def client_pb_500(self) -> Iterator[TestClient]:
        with self._client_with_pb_side_effect(_make_pb_error(status=500)) as client:
            yield client

    @pytest.fixture
    def client_fake_status(self) -> Iterator[TestClient]:
        with self._client_with_pb_side_effect(_FakeStatusError(status=404)) as client:
            yield client

    @pytest.fixture
    def client_pb_404_sensitive(self) -> Iterator[TestClient]:
        with self._client_with_pb_side_effect(
            _make_pb_error(status=404, data="sensitive PocketBase internals")
        ) as client:
            yield client

    def test_pb_404_returns_404_with_trace_id_message(self, client_pb_404: TestClient) -> None:
        resp = client_pb_404.get("/api/debug/pipeline-traces/missing-id")
        assert resp.status_code == 404
        # The custom user-friendly detail is preserved (not the generic pb_error_to_http one).
        assert "missing-id" in resp.text

    def test_pb_500_returns_502(self, client_pb_500: TestClient) -> None:
        resp = client_pb_500.get("/api/debug/pipeline-traces/any-id")
        # After fix: non-404 PB errors route via pb_error_to_http → 502.
        assert resp.status_code == 502

    def test_non_pb_exception_with_status_attr_falls_through(self, client_fake_status: TestClient) -> None:
        """Duck-typing trap: non-PB exception with .status=404 must NOT be treated as 404."""
        resp = client_fake_status.get("/api/debug/pipeline-traces/any-id")
        # After fix (explicit ClientResponseError), this falls to the global handler.
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_pb_404_detail_does_not_leak_pb_body(self, client_pb_404_sensitive: TestClient) -> None:
        resp = client_pb_404_sensitive.get("/api/debug/pipeline-traces/missing-id")
        body_lower = resp.text.lower()
        assert "sensitive" not in body_lower
        assert "pocketbase" not in body_lower


class TestLoadTraceRecordHelper:
    """_load_trace_record (used by the phase-debug endpoints) — same contract."""

    def test_pb_404_raises_404_http_exception(self) -> None:
        from fastapi import HTTPException

        from api.routers.debug import _load_trace_record

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = _make_pb_error(status=404)
        with patch("api.routers.debug.pb", mock_pb):
            with pytest.raises(HTTPException) as exc_info:
                _load_trace_record("missing-id")
        assert exc_info.value.status_code == 404
        assert "missing-id" in str(exc_info.value.detail)

    def test_pb_500_raises_502_http_exception(self) -> None:
        from fastapi import HTTPException

        from api.routers.debug import _load_trace_record

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = _make_pb_error(status=500)
        with patch("api.routers.debug.pb", mock_pb):
            with pytest.raises(HTTPException) as exc_info:
                _load_trace_record("any-id")
        assert exc_info.value.status_code == 502

    def test_non_pb_exception_with_status_attr_propagates(self) -> None:
        """Duck-typing trap: must re-raise the original, not coerce to a 404 HTTPException."""
        from api.routers.debug import _load_trace_record

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = _FakeStatusError(status=404)
        with patch("api.routers.debug.pb", mock_pb):
            with pytest.raises(_FakeStatusError):
                _load_trace_record("any-id")


# ===========================================================================
# Additional sweep — HTTPException(500, "<hardcoded>") sites NOT covered by
# the original PR scope. CLAUDE.md says: never use HTTPException(500, ...).
# Always let the global handler return a generic "Internal server error".
# ===========================================================================


class TestGetScenarioGenericExceptionNoLeak:
    """GET /api/scenarios/{id} — generic Exception must surface generic 500."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = _generic_boom()
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios/abc")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.get("/api/scenarios/abc")
        assert SENSITIVE_MARKER not in resp.text


class TestSolveScenarioGenericExceptionNoLeak:
    """POST /api/scenarios/{id}/solve — generic Exception must surface generic 500."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        mock_pb = MagicMock()
        # solve_scenario fetches the scenario first via get_one — make that explode.
        mock_pb.collection.return_value.get_one.side_effect = _generic_boom()
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios/abc/solve")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios/abc/solve")
        assert SENSITIVE_MARKER not in resp.text


class TestClearScenarioGenericExceptionNoLeak:
    """POST /api/scenarios/{id}/clear — generic Exception must surface generic 500."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.return_value = MagicMock(id="abc")
        mock_pb.collection.return_value.get_full_list.side_effect = _generic_boom()
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios/abc/clear", json={"year": 2025})
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_exception_text_leak(self, client: TestClient) -> None:
        resp = client.post("/api/scenarios/abc/clear", json={"year": 2025})
        assert SENSITIVE_MARKER not in resp.text


class TestClearParseAnalysisSentinelNoLeak:
    """DELETE /api/debug/parse-analysis — repository sentinel must surface generic 500.

    Unlike scenario endpoints, clear_parse_analysis triggers HTTPException(500) via
    a sentinel check (`if deleted_count < 0`) rather than an exception handler. Per
    CLAUDE.md the same rule applies: route through the global handler instead.
    """

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.debug import router

        mock_repo = MagicMock()
        mock_repo.clear_all.return_value = -1  # sentinel: failure
        app = _make_app(router)
        with patch("api.routers.debug.get_debug_parse_repository", return_value=mock_repo):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_500_with_generic_detail(self, client: TestClient) -> None:
        resp = client.delete("/api/debug/parse-analysis")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "Internal server error"}

    def test_no_sentinel_text_leak(self, client: TestClient) -> None:
        """The RuntimeError message must not surface in the response body."""
        resp = client.delete("/api/debug/parse-analysis")
        assert "error sentinel" not in resp.text
        assert "debug_repo" not in resp.text


# ===========================================================================
# Item 3 (companion) — evaluate_score must route ClientResponseError through
# pb_error_to_http (404 stays 404, PB 5xx → 502), like its sibling endpoints.
# ===========================================================================


class TestEvaluateScorePbErrorRouting:
    """GET /api/scenarios/score — PB errors map via pb_error_to_http, not generic 500."""

    @pytest.fixture
    def client_pb_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_make_pb_error(status=404)),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_pb_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=_make_pb_error(status=500)),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_pb_404: TestClient) -> None:
        resp = client_pb_404.get("/api/scenarios/score?session_id=1&year=2025")
        assert resp.status_code == 404

    def test_pb_500_returns_502(self, client_pb_500: TestClient) -> None:
        resp = client_pb_500.get("/api/scenarios/score?session_id=1&year=2025")
        assert resp.status_code == 502

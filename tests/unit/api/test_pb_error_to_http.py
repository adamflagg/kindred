"""#1121 — pb_error_to_http maps upstream PocketBase ClientResponseError status codes.

When PocketBase returns a 404 or 400, the API should propagate a matching
HTTP status, not flatten everything to 500. The existing global exception
handler was intentionally left catching ClientResponseError (see PR #1119),
but the status-code mapping was out of scope then.

This module tests:
  1. The pb_error_to_http() helper itself (unit).
  2. An integration smoke test verifying that pre_validate_solver returns 404
     when PocketBase returns 404 on the session lookup.

The current behaviour (before the fix) is 500 for all ClientResponseError
statuses because the global handler catches the re-raised exception.
"""

import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent
sys.path.insert(0, str(project_root))

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


def _make_client_response_error(status: int = 404, data: Any = "not found") -> Any:
    from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

    return ClientResponseError(url="http://pb/test", status=status, data={"message": data})


def _make_app_with_global_handler(router: Any) -> FastAPI:
    """Create a minimal FastAPI app that mirrors main.py's global exception handler."""
    from fastapi import Request

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user
    return app


# ---------------------------------------------------------------------------
# Unit tests: pb_error_to_http() helper
# ---------------------------------------------------------------------------


class TestPbErrorToHttp:
    """Unit tests for api.utils.pb_error.pb_error_to_http()."""

    def _call(self, status: int) -> Any:
        from api.utils.pb_error import pb_error_to_http

        return pb_error_to_http(_make_client_response_error(status))

    def test_404_maps_to_404(self) -> None:
        exc = self._call(404)
        assert exc.status_code == 404

    def test_400_maps_to_400(self) -> None:
        exc = self._call(400)
        assert exc.status_code == 400

    def test_401_maps_to_403(self) -> None:
        # 401 from PocketBase → 403 (auth failure, caller shouldn't retry with same creds)
        exc = self._call(401)
        assert exc.status_code == 403

    def test_403_maps_to_403(self) -> None:
        exc = self._call(403)
        assert exc.status_code == 403

    def test_500_maps_to_502(self) -> None:
        exc = self._call(500)
        assert exc.status_code == 502

    def test_503_maps_to_502(self) -> None:
        exc = self._call(503)
        assert exc.status_code == 502

    def test_detail_does_not_leak_pb_internals(self) -> None:
        from api.utils.pb_error import pb_error_to_http

        err = _make_client_response_error(404, data="sensitive PocketBase info")
        exc = pb_error_to_http(err)
        # Detail must be a generic string, not the raw PocketBase error payload
        assert "sensitive" not in str(exc.detail).lower()
        assert "PocketBase" not in str(exc.detail)

    def test_unexpected_status_emits_warning(self, caplog: pytest.LogCaptureFixture) -> None:
        """pb_error_to_http emits a WARNING for unexpected upstream statuses (e.g. 429)."""
        import logging

        from api.utils.pb_error import pb_error_to_http

        with caplog.at_level(logging.WARNING, logger="api.utils.pb_error"):
            exc = pb_error_to_http(_make_client_response_error(429))

        assert exc.status_code == 502
        assert any("429" in record.message for record in caplog.records), (
            f"Expected a warning mentioning '429' but got: {[r.message for r in caplog.records]}"
        )


# ---------------------------------------------------------------------------
# Integration smoke: pre_validate_solver maps 404 → 404
# ---------------------------------------------------------------------------


class TestPreValidateSolverMaps404:
    """pre_validate_solver must return 404 when PocketBase returns 404 on session lookup."""

    @pytest.fixture
    def client(self) -> Iterator[TestClient]:
        from api.routers.solver import router

        pb_error = _make_client_response_error(status=404)
        mock_pb = MagicMock()
        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.solver.build_session_context", side_effect=pb_error),
            patch("api.routers.solver.pb", mock_pb),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_returns_404_not_500(self, client: TestClient) -> None:
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        assert resp.status_code == 404, (
            f"Expected 404 when PocketBase returned 404, got {resp.status_code}. "
            "The ClientResponseError branch must map status codes via pb_error_to_http()."
        )

    def test_detail_is_safe(self, client: TestClient) -> None:
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)

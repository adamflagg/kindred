"""#1065 / #1099: Exception detail must NOT leak str(e) via HTTPException(500, str(e)).

The global exception handler in api/main.py returns {"detail": "Internal server error"}
and logs the full traceback server-side. Routers must NOT intercept unhandled exceptions
and return detail=str(e), which leaks internal messages (file paths, library errors, etc.)
to clients.

These tests assert that when a low-level dependency raises an unexpected exception:
  - The response status code is 500
  - The response body contains {"detail": "Internal server error"} (the global handler's
    safe message), NOT the raw exception message
  - i.e. the anti-pattern `raise HTTPException(status_code=500, detail=str(e))` is gone

Routers tested:
  - api/routers/social_graph.py  (get_session_social_graph, get_bunk_social_graph,
                                   update_camper_position)
  - api/routers/solver.py         (pre_validate_session, start_multi_session_solver,
                                   pre_validate_solver ClientResponseError branch)

Additional coverage:
  - HTTPException passthrough: routers with explicit `except HTTPException: raise` must
    preserve the original status code and detail, not swallow it into 500.
  - exc_info=True: logger.error calls in except blocks must include exc_info=True so that
    full tracebacks appear in server logs.
  - ClientResponseError no-leak: the ClientResponseError branch in pre_validate_solver
    must not surface PocketBase-internal details to the client.
"""

import sys
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

INTERNAL_ERROR_BODY = {"detail": "Internal server error"}
LEAKED_DETAIL_PATTERN = "simulated internal failure"


def _mock_admin_user() -> AuthUser:
    user = AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )
    # Set all permissions so require_permission deps pass (is_admin also bypasses checks)
    user.permissions = set(ALL_PERMISSIONS)
    return user


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
# social_graph.py — get_session_social_graph
# ---------------------------------------------------------------------------


class TestSessionSocialGraphNoLeakOnError:
    """get_session_social_graph must not leak str(e) when graph builder raises."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.social_graph import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        # get_list returns a result with items so the "has requests" check passes
        check_result = MagicMock()
        check_result.total_items = 1
        mock_pb.collection.return_value.get_list.return_value = check_result

        mock_cache = MagicMock()
        mock_cache.get_session_graph.return_value = None  # force builder path

        mock_builder = MagicMock()
        mock_builder.build_social_network.side_effect = boom

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.graph_cache", mock_cache),
            patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.get("/api/sessions/1001/social-graph", params={"year": 2025})
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.get("/api/sessions/1001/social-graph", params={"year": 2025})
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. "
            "Remove the 'raise HTTPException(500, str(e))' block and let the global handler catch it."
        )
        assert LEAKED_DETAIL_PATTERN not in body.get("detail", ""), "Raw exception message must not appear in response"


# ---------------------------------------------------------------------------
# social_graph.py — get_bunk_social_graph
# ---------------------------------------------------------------------------


class TestBunkSocialGraphNoLeakOnError:
    """get_bunk_social_graph must not leak str(e) when graph builder raises."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.social_graph import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        bunk_record = MagicMock()
        bunk_record.cm_id = 9001
        bunk_record.name = "Eagle Cabin"
        mock_pb.collection.return_value.get_first_list_item.return_value = bunk_record

        mock_cache = MagicMock()
        mock_cache.get_bunk_graph.return_value = None

        mock_builder = MagicMock()
        mock_builder.build_bunk_graph.side_effect = boom

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.graph_cache", mock_cache),
            patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.get("/api/bunks/9001/social-graph", params={"session_cm_id": 1001, "year": 2025})
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.get("/api/bunks/9001/social-graph", params={"session_cm_id": 1001, "year": 2025})
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. Remove the 'raise HTTPException(500, str(e))' block."
        )


# ---------------------------------------------------------------------------
# social_graph.py — update_camper_position
# ---------------------------------------------------------------------------


class TestUpdateCamperPositionNoLeakOnError:
    """update_camper_position must not leak raw exception message on error."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.social_graph import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        mock_cache = MagicMock()
        mock_cache.get_session_graph.return_value = None  # force build path

        mock_builder = MagicMock()
        # build_social_network succeeds but update_node_position raises
        mock_builder.build_social_network.return_value = MagicMock()
        mock_builder.update_node_position.side_effect = boom

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.graph_cache", mock_cache),
            patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.patch(
            "/api/sessions/1001/campers/101/position",
            json={"new_bunk_cm_id": 42},
        )
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.patch(
            "/api/sessions/1001/campers/101/position",
            json={"new_bunk_cm_id": 42},
        )
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. "
            "Remove the 'raise HTTPException(500, ...)' block and let global handler catch it."
        )
        # The old generic-message 500 ("Failed to update camper position") should also be gone
        assert "Failed to update" not in body.get("detail", "")


# ---------------------------------------------------------------------------
# solver.py — pre_validate_session
# ---------------------------------------------------------------------------


class TestPreValidateSessionNoLeakOnError:
    """pre_validate_session must not leak str(e) when an unexpected error occurs."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.solver import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        app = _make_app_with_global_handler(router)

        with patch("api.routers.solver.build_session_context", side_effect=boom):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. Remove the 'raise HTTPException(500, str(e))' block."
        )
        assert LEAKED_DETAIL_PATTERN not in body.get("detail", "")


# ---------------------------------------------------------------------------
# solver.py — start_multi_session_solver
# ---------------------------------------------------------------------------


class TestMultiSessionSolverNoLeakOnError:
    """start_multi_session_solver must not leak str(e) when an unexpected error occurs."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.solver import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        # Raise on the first PB call so we hit the outer except before any HTTPException
        mock_pb.collection.side_effect = boom

        app = _make_app_with_global_handler(router)

        with patch("api.routers.solver.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.post(
            "/api/solver/run-multi-session",
            # `scenario` is required (kindred#2467) — without it the endpoint
            # refuses with a 422 and never reaches the PB call this test raises on.
            json={"parent_session_cm_id": 2001, "year": 2025, "scenario": "scn_leak_probe"},
        )
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.post(
            "/api/solver/run-multi-session",
            # `scenario` is required (kindred#2467) — without it the endpoint
            # refuses with a 422 and never reaches the PB call this test raises on.
            json={"parent_session_cm_id": 2001, "year": 2025, "scenario": "scn_leak_probe"},
        )
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. Remove the 'raise HTTPException(500, str(e))' block."
        )
        assert LEAKED_DETAIL_PATTERN not in body.get("detail", "")


# ---------------------------------------------------------------------------
# Action 1: HTTPException passthrough — get_session_social_graph
# ---------------------------------------------------------------------------


class TestSessionSocialGraphHTTPExceptionPassthrough:
    """get_session_social_graph must re-raise HTTPException verbatim (not swallow into 500).

    Critically: HTTPException must NOT be logged as an error. The `except HTTPException: raise`
    guard before `except Exception` prevents spurious error-level log entries for normal 404s.
    """

    @pytest.fixture
    def client_and_logger(self) -> Generator[tuple[TestClient, MagicMock]]:
        from api.routers.social_graph import router

        # Inject a 404 HTTPException from within the graph builder
        not_found = HTTPException(status_code=404, detail="not found")

        mock_pb = MagicMock()
        check_result = MagicMock()
        check_result.total_items = 1
        mock_pb.collection.return_value.get_list.return_value = check_result

        mock_cache = MagicMock()
        mock_cache.get_session_graph.return_value = None

        mock_builder = MagicMock()
        mock_builder.build_social_network.side_effect = not_found

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.graph_cache", mock_cache),
            patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
            patch("api.routers.social_graph.logger") as mock_log,
        ):
            yield TestClient(app, raise_server_exceptions=False), mock_log

    def test_http_exception_preserves_404_status(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        client, _ = client_and_logger
        resp = client.get("/api/sessions/1001/social-graph", params={"year": 2025})
        assert resp.status_code == 404, (
            f"HTTPException(404) was swallowed. Got {resp.status_code}. "
            "Add `except HTTPException: raise` before `except Exception` in get_session_social_graph."
        )

    def test_http_exception_preserves_detail(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        client, _ = client_and_logger
        resp = client.get("/api/sessions/1001/social-graph", params={"year": 2025})
        body = resp.json()
        assert body.get("detail") == "not found", f"HTTPException detail was not preserved. Got: {body!r}"

    def test_http_exception_not_logged_as_error(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        """HTTPException must NOT trigger logger.error — it's a normal HTTP response, not an error."""
        client, mock_log = client_and_logger
        client.get("/api/sessions/1001/social-graph", params={"year": 2025})
        assert not mock_log.error.called, (
            "logger.error was called for an HTTPException — add `except HTTPException: raise` "
            "BEFORE `except Exception` to prevent logging normal HTTP errors as server errors."
        )


# ---------------------------------------------------------------------------
# Action 1: HTTPException passthrough — pre_validate_solver
# ---------------------------------------------------------------------------


class TestPreValidateSolverHTTPExceptionPassthrough:
    """pre_validate_solver must re-raise HTTPException verbatim (not swallow into 500).

    Critically: HTTPException must NOT be logged as an error.
    """

    @pytest.fixture
    def client_and_logger(self) -> Generator[tuple[TestClient, MagicMock]]:
        from api.routers.solver import router

        not_found = HTTPException(status_code=404, detail="not found")

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.solver.build_session_context", side_effect=not_found),
            patch("api.routers.solver.logger") as mock_log,
        ):
            yield TestClient(app, raise_server_exceptions=False), mock_log

    def test_http_exception_preserves_404_status(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        client, _ = client_and_logger
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        assert resp.status_code == 404, (
            f"HTTPException(404) was swallowed. Got {resp.status_code}. "
            "Add `except HTTPException: raise` before `except Exception` in pre_validate_solver."
        )

    def test_http_exception_preserves_detail(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        client, _ = client_and_logger
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        body = resp.json()
        assert body.get("detail") == "not found", f"HTTPException detail was not preserved. Got: {body!r}"

    def test_http_exception_not_logged_as_error(self, client_and_logger: tuple[TestClient, MagicMock]) -> None:
        """HTTPException must NOT trigger logger.error."""
        client, mock_log = client_and_logger
        client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        assert not mock_log.error.called, (
            "logger.error was called for an HTTPException — add `except HTTPException: raise` "
            "BEFORE `except Exception` in pre_validate_solver."
        )


# ---------------------------------------------------------------------------
# Action 2: exc_info=True assertion on get_session_social_graph
# ---------------------------------------------------------------------------


class TestSessionSocialGraphExcInfoLogged:
    """get_session_social_graph must call logger.error with exc_info=True on unexpected error."""

    def test_logger_error_called_with_exc_info(self) -> None:
        from api.routers.social_graph import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        check_result = MagicMock()
        check_result.total_items = 1
        mock_pb.collection.return_value.get_list.return_value = check_result

        mock_cache = MagicMock()
        mock_cache.get_session_graph.return_value = None

        mock_builder = MagicMock()
        mock_builder.build_social_network.side_effect = boom

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.graph_cache", mock_cache),
            patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
            patch("api.routers.social_graph.logger") as mock_log,
        ):
            client = TestClient(app, raise_server_exceptions=False)
            client.get("/api/sessions/1001/social-graph", params={"year": 2025})

        mock_log.error.assert_called_once()
        _, kwargs = mock_log.error.call_args
        assert kwargs.get("exc_info") is True, (
            f"logger.error was called without exc_info=True. kwargs={kwargs!r}. "
            "Full tracebacks must be logged server-side."
        )


# ---------------------------------------------------------------------------
# Action 3: ClientResponseError no-leak test for pre_validate_solver
# ---------------------------------------------------------------------------


def _make_client_response_error(
    status: int = 404,
    data: str = "sensitive PocketBase internal details",
) -> Any:
    """Build a pocketbase ClientResponseError with sensitive data for testing."""
    from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

    return ClientResponseError(url="http://pb/test", status=status, data={"message": data})


class TestPreValidateSolverClientResponseErrorNoLeak:
    """pre_validate_solver ClientResponseError branch must not surface PocketBase details to client.

    After #1121, ClientResponseError.status is mapped to an appropriate HTTPException
    rather than re-raised as-is (which would fall through to the global 500 handler).
    The important invariant — no PocketBase-internal details in the response body —
    is still enforced.
    """

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.solver import router

        pb_error = _make_client_response_error()

        mock_pb = MagicMock()
        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.solver.build_session_context", side_effect=pb_error),
            patch("api.routers.solver.pb", mock_pb),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_mapped_not_500(self, client: TestClient) -> None:
        # After #1121 a 404 from PocketBase maps to 404 at the API boundary.
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        assert resp.status_code == 404, (
            f"Expected 404 when PocketBase returned 404 (status mapped via pb_error_to_http), got {resp.status_code}"
        )

    def test_detail_does_not_leak_pb_data(self, client: TestClient) -> None:
        resp = client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})
        body = resp.json()
        detail = body.get("detail", "")
        assert "PocketBase error" not in detail, f"ClientResponseError leaked PocketBase label. Got: {body!r}"
        assert "sensitive PocketBase" not in detail, f"Leaked sensitive data. Got: {body!r}"

    def test_logger_error_called_with_exc_info(self) -> None:
        from api.routers.solver import router

        pb_error = _make_client_response_error()
        mock_pb = MagicMock()
        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.solver.build_session_context", side_effect=pb_error),
            patch("api.routers.solver.pb", mock_pb),
            patch("api.routers.solver.logger") as mock_log,
        ):
            test_client = TestClient(app, raise_server_exceptions=False)
            test_client.post("/api/solver/pre-validate", json={"session_cm_id": 1001, "year": 2025})

        mock_log.error.assert_called_once()
        _, kwargs = mock_log.error.call_args
        assert kwargs.get("exc_info") is True, (
            f"ClientResponseError branch: logger.error called without exc_info=True. kwargs={kwargs!r}"
        )

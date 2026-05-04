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
                                   get_person_ego_network, update_camper_position)
  - api/routers/solver.py         (pre_validate_session, start_multi_session_solver)
"""

from __future__ import annotations

import sys
from collections.abc import Generator
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
# social_graph.py — get_person_ego_network
# ---------------------------------------------------------------------------


class TestEgoNetworkNoLeakOnError:
    """get_person_ego_network must not leak str(e) when graph builder raises."""

    @pytest.fixture
    def client(self) -> Generator[TestClient]:
        from api.routers.social_graph import router

        boom = RuntimeError(LEAKED_DETAIL_PATTERN)

        mock_pb = MagicMock()
        mock_builder = MagicMock()
        mock_builder.build_session_graph.side_effect = boom

        app = _make_app_with_global_handler(router)

        with (
            patch("api.routers.social_graph.pb", mock_pb),
            patch("api.routers.social_graph.SocialGraphBuilder", return_value=mock_builder),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def test_status_is_500(self, client: TestClient) -> None:
        resp = client.get("/api/persons/101/ego-network", params={"session_cm_id": 1001})
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.get("/api/persons/101/ego-network", params={"session_cm_id": 1001})
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
            json={"parent_session_cm_id": 2001, "year": 2025},
        )
        assert resp.status_code == 500

    def test_detail_is_generic_not_str_e(self, client: TestClient) -> None:
        resp = client.post(
            "/api/solver/run-multi-session",
            json={"parent_session_cm_id": 2001, "year": 2025},
        )
        body = resp.json()
        assert body == INTERNAL_ERROR_BODY, (
            f"Router leaked raw exception detail. Got: {body!r}. Remove the 'raise HTTPException(500, str(e))' block."
        )
        assert LEAKED_DETAIL_PATTERN not in body.get("detail", "")

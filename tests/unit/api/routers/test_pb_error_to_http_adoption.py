"""#1137 — adopt pb_error_to_http at remaining ClientResponseError callsites.

PR #1135 introduced pb_error_to_http() and applied it to pre_validate_solver.
This module covers the remaining callsites that still used legacy patterns:

  - api/routers/scenarios.py  (create_scenario, get_scenario, update_scenario,
                                delete_scenario, update_scenario_assignment,
                                solve_scenario, clear_scenario)
  - api/routers/validation.py (validate_bunking)
  - api/services/data_fetcher.py (fetch_session_data_v2)

For each callsite the tests assert:
  1. PB 404 → HTTP 404 (not 400 and not 500)
  2. PB 500 → HTTP 502 (not 500)
  3. No raw PocketBase body content leaks into the response detail.
"""

import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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
# Shared helpers
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


def _make_pb_error(status: int = 404, data: Any = "sensitive PocketBase detail") -> Any:
    from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

    return ClientResponseError(url="http://pb/test", status=status, data={"message": data})


def _make_app(router: Any) -> FastAPI:
    """Minimal FastAPI app mirroring main.py global exception handler."""
    from fastapi import Request

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user
    return app


# ---------------------------------------------------------------------------
# scenarios.py — create_scenario  (POST /api/scenarios)
# ---------------------------------------------------------------------------


class TestCreateScenarioPbError:
    """create_scenario must map PB errors via pb_error_to_http, not flatten to 400/str(e)."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=pb_error),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=pb_error),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def _payload(self) -> dict[str, Any]:
        return {"name": "Test Scenario", "session_cm_id": 1001, "year": 2025}

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios", json=self._payload())
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.post("/api/scenarios", json=self._payload())
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios", json=self._payload())
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — get_scenario  (GET /api/scenarios/{id})
# ---------------------------------------------------------------------------


class TestGetScenarioPbError:
    """get_scenario must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.get("/api/scenarios/nonexistent-id")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.get("/api/scenarios/any-id")
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.get("/api/scenarios/nonexistent-id")
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — update_scenario  (PUT /api/scenarios/{id})
# ---------------------------------------------------------------------------


class TestUpdateScenarioPbError:
    """update_scenario must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.update.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.update.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.put("/api/scenarios/nonexistent-id", json={"name": "Updated"})
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.put("/api/scenarios/any-id", json={"name": "Updated"})
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.put("/api/scenarios/nonexistent-id", json={"name": "Updated"})
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — delete_scenario  (DELETE /api/scenarios/{id})
# ---------------------------------------------------------------------------


class TestDeleteScenarioPbError:
    """delete_scenario must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.delete("/api/scenarios/nonexistent-id")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.delete("/api/scenarios/any-id")
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.delete("/api/scenarios/nonexistent-id")
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — solve_scenario  (POST /api/scenarios/{id}/solve)
# ---------------------------------------------------------------------------


class TestSolveScenarioPbError:
    """solve_scenario must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios/nonexistent-id/solve")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.post("/api/scenarios/any-id/solve")
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios/nonexistent-id/solve")
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — clear_scenario  (POST /api/scenarios/{id}/clear)
# ---------------------------------------------------------------------------


class TestClearScenarioPbError:
    """clear_scenario must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.side_effect = pb_error
        app = _make_app(router)
        with patch("api.routers.scenarios.pb", mock_pb):
            yield TestClient(app, raise_server_exceptions=False)

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios/nonexistent-id/clear", json={"year": 2025})
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.post("/api/scenarios/any-id/clear", json={"year": 2025})
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/scenarios/nonexistent-id/clear", json={"year": 2025})
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — update_scenario_assignment  (PUT /api/scenarios/{id}/assignments)
# ---------------------------------------------------------------------------


class TestUpdateScenarioAssignmentPbError:
    """update_scenario_assignment outer handler must map PB errors via pb_error_to_http."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=404)
        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=pb_error),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.scenarios import router

        pb_error = _make_pb_error(status=500)
        app = _make_app(router)
        with (
            patch("api.routers.scenarios.build_session_context", side_effect=pb_error),
            patch("api.routers.scenarios.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def _payload(self) -> dict[str, Any]:
        return {
            "person_id": 1001,
            "bunk_id": 2001,
            "session_cm_id": 3001,
            "year": 2025,
        }

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.put("/api/scenarios/any-id/assignments", json=self._payload())
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.put("/api/scenarios/any-id/assignments", json=self._payload())
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.put("/api/scenarios/any-id/assignments", json=self._payload())
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# scenarios.py — explicit HTTPException(4xx) must NOT be logged at ERROR
# ---------------------------------------------------------------------------


class TestUpdateScenarioAssignmentHttpExceptionNotLogged:
    """Explicit raise HTTPException(404) inside update_scenario_assignment must propagate
    cleanly without being caught by the broad `except Exception` and logged at ERROR.

    Regression for #1150: removing the inner `except HTTPException: raise` would route
    the explicit 404 (person-not-found) through `logger.error(..., exc_info=True)`,
    polluting error dashboards with client-input cases.
    """

    @pytest.fixture
    def client_person_not_found(self) -> Iterator[TestClient]:
        """Patch build_session_context to succeed and pb.collection().get_full_list to
        return [] for the persons lookup, so the function explicitly raises HTTPException(404).
        """
        from api.routers.scenarios import router

        # Stub session context: just any object with the attrs the function uses.
        class _Ctx:
            session_pb_id = "session_pb"
            session_cm_id = 3001
            year = 2025

        # pb.collection(...).get_full_list returns [] for every collection, including persons.
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.return_value = []
        # get_one (saved scenario) returns a stub object so we get past that line.
        mock_pb.collection.return_value.get_one.return_value = MagicMock(id="any-id", session=None)

        app = _make_app(router)
        with (
            # build_session_context is async — must use AsyncMock so the await resolves
            # to _Ctx() rather than yielding a non-awaitable MagicMock.
            patch("api.routers.scenarios.build_session_context", new=AsyncMock(return_value=_Ctx())),
            patch("api.routers.scenarios.pb", mock_pb),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def _payload(self) -> dict[str, Any]:
        return {
            "person_id": 99999,  # not found
            "bunk_id": 2001,
            "session_cm_id": 3001,
            "year": 2025,
        }

    def test_returns_404(self, client_person_not_found: TestClient) -> None:
        resp = client_person_not_found.put("/api/scenarios/any-id/assignments", json=self._payload())
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_does_not_log_at_error(self, client_person_not_found: TestClient, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        with caplog.at_level(logging.ERROR, logger="api.routers.scenarios"):
            resp = client_person_not_found.put("/api/scenarios/any-id/assignments", json=self._payload())

        assert resp.status_code == 404
        error_records = [
            r for r in caplog.records if r.levelno >= logging.ERROR and "Error updating assignment" in r.getMessage()
        ]
        assert error_records == [], (
            "Explicit HTTPException(404) must not fall through to logger.error in the broad "
            f"`except Exception` handler. Got error records: {[r.getMessage() for r in error_records]}"
        )


# ---------------------------------------------------------------------------
# validation.py — validate_bunking  (POST /api/validate/bunking)
# ---------------------------------------------------------------------------


class TestValidateBunkingPbError:
    """validate_bunking must map PB errors via pb_error_to_http, not use str(e) detail."""

    @pytest.fixture
    def client_404(self) -> Iterator[TestClient]:
        from api.routers.validation import router

        pb_error = _make_pb_error(status=404)
        app = _make_app(router)
        with (
            patch("api.routers.validation.build_session_context", side_effect=pb_error),
            patch("api.routers.validation.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    @pytest.fixture
    def client_500(self) -> Iterator[TestClient]:
        from api.routers.validation import router

        pb_error = _make_pb_error(status=500)
        app = _make_app(router)
        with (
            patch("api.routers.validation.build_session_context", side_effect=pb_error),
            patch("api.routers.validation.pb", MagicMock()),
        ):
            yield TestClient(app, raise_server_exceptions=False)

    def _payload(self) -> dict[str, Any]:
        return {"session_cm_id": 1001, "year": 2025}

    def test_pb_404_returns_404(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/validate-bunking", json=self._payload())
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_pb_500_returns_502(self, client_500: TestClient) -> None:
        resp = client_500.post("/api/validate-bunking", json=self._payload())
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.json()}"

    def test_detail_does_not_leak_pb_body(self, client_404: TestClient) -> None:
        resp = client_404.post("/api/validate-bunking", json=self._payload())
        body = resp.json()
        assert "sensitive" not in str(body).lower()
        assert "PocketBase" not in str(body)


# ---------------------------------------------------------------------------
# data_fetcher.py — fetch_session_data_v2  (tested via solver endpoint)
# ---------------------------------------------------------------------------


class TestFetchSessionDataV2PbError:
    """fetch_session_data_v2 must map PB errors via pb_error_to_http.

    We test via the solver endpoint (start_solver) which calls fetch_session_data_v2
    indirectly through run_solver_task_v2. However, since run_solver_task_v2 runs
    as a background task, we test fetch_session_data_v2 directly as a unit test.
    """

    def test_pb_404_raises_404_http_exception(self) -> None:
        """When PB returns 404, fetch_session_data_v2 must raise HTTPException(404)."""
        import asyncio

        from api.services.data_fetcher import fetch_session_data_v2

        pb_error = _make_pb_error(status=404)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.side_effect = pb_error

        # We need to mock build_session_context too since it's called first
        mock_ctx = MagicMock()
        mock_ctx.year = 2025
        mock_ctx.session_relation_filter = "session = 'abc'"
        mock_ctx.session_id_filter = "session_cm_id = 1001"

        from fastapi import HTTPException

        with (
            patch("api.services.data_fetcher.build_session_context", return_value=mock_ctx),
            patch("api.services.data_fetcher.pb", mock_pb),
        ):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(fetch_session_data_v2(session_cm_id=1001, year=2025))
            assert exc_info.value.status_code == 404, f"Expected HTTPException(404), got {exc_info.value.status_code}"

    def test_pb_500_raises_502_http_exception(self) -> None:
        """When PB returns 500, fetch_session_data_v2 must raise HTTPException(502)."""
        import asyncio

        from api.services.data_fetcher import fetch_session_data_v2

        pb_error = _make_pb_error(status=500)
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.side_effect = pb_error

        mock_ctx = MagicMock()
        mock_ctx.year = 2025
        mock_ctx.session_relation_filter = "session = 'abc'"
        mock_ctx.session_id_filter = "session_cm_id = 1001"

        from fastapi import HTTPException

        with (
            patch("api.services.data_fetcher.build_session_context", return_value=mock_ctx),
            patch("api.services.data_fetcher.pb", mock_pb),
        ):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(fetch_session_data_v2(session_cm_id=1001, year=2025))
            assert exc_info.value.status_code == 502, f"Expected HTTPException(502), got {exc_info.value.status_code}"

    def test_detail_does_not_leak_pb_body(self) -> None:
        """HTTPException detail must not contain raw PB error body."""
        import asyncio

        from api.services.data_fetcher import fetch_session_data_v2

        pb_error = _make_pb_error(status=404, data="sensitive PocketBase internal schema info")
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.side_effect = pb_error

        mock_ctx = MagicMock()
        mock_ctx.year = 2025
        mock_ctx.session_relation_filter = "session = 'abc'"
        mock_ctx.session_id_filter = "session_cm_id = 1001"

        from fastapi import HTTPException

        with (
            patch("api.services.data_fetcher.build_session_context", return_value=mock_ctx),
            patch("api.services.data_fetcher.pb", mock_pb),
        ):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(fetch_session_data_v2(session_cm_id=1001, year=2025))
            detail = str(exc_info.value.detail)
            assert "sensitive" not in detail.lower()
            assert "PocketBase" not in detail
            assert "schema" not in detail.lower()

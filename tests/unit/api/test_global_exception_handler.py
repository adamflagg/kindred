"""Tests for global exception handler in api/main.py.

The global exception handler should:
- Catch unhandled exceptions and return a generic 500 response
- Log the full error details server-side
- NOT leak internal error messages (str(e)) to clients
"""

from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client with the app, skipping PB auth."""
    with patch.dict("os.environ", {"SKIP_PB_AUTH": "true"}):
        from api.main import create_app

        app = create_app()

        # Add a test route that raises an unhandled exception
        @app.get("/test/unhandled-error")
        async def unhandled_error():
            raise RuntimeError("Database connection pool exhausted")

        # Add a test route that raises an HTTPException (should pass through)
        @app.get("/test/http-error")
        async def http_error():
            raise HTTPException(status_code=404, detail="Session not found")

        # Add a test route that works normally
        @app.get("/test/ok")
        async def ok():
            return {"status": "ok"}

        yield TestClient(app, raise_server_exceptions=False)


class TestGlobalExceptionHandler:
    """Tests for the global unhandled exception handler."""

    def test_unhandled_exception_returns_generic_500(self, client):
        """Unhandled exceptions should return generic error, not str(e)."""
        response = client.get("/test/unhandled-error")
        assert response.status_code == 500
        body = response.json()
        assert body["detail"] == "Internal server error"
        # Must NOT leak the internal error message
        assert "Database connection pool" not in str(body)

    def test_http_exceptions_pass_through(self, client):
        """HTTPException responses should not be caught by the global handler."""
        response = client.get("/test/http-error")
        assert response.status_code == 404
        assert response.json()["detail"] == "Session not found"

    def test_normal_responses_unaffected(self, client):
        """Normal responses should not be affected by the handler."""
        response = client.get("/test/ok")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_unhandled_exception_logs_full_error(self, client):
        """The handler should log the full error details server-side."""
        with patch("api.main.logger") as mock_logger:
            client.get("/test/unhandled-error")
            mock_logger.error.assert_called_once()
            log_message = mock_logger.error.call_args[0][0]
            assert "Database connection pool exhausted" in log_message

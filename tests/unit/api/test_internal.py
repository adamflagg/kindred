"""Tests for internal service-to-service endpoints."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.main import create_app


@pytest.fixture
def app():
    return create_app()


class TestGeoNormalize:
    """Tests for POST /api/internal/geo-normalize."""

    @pytest.mark.asyncio
    async def test_normalize_cities(self, app):
        """Should normalize city values using fuzzy matching."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/internal/geo-normalize",
                json={
                    "category": "city",
                    "values": [
                        {"value": "San Francisco", "state": "CA", "country": "US"},
                    ],
                },
            )
            assert response.status_code == 200
            data = response.json()
            assert "San Francisco" in data
            assert "canonical" in data["San Francisco"]
            assert "confidence" in data["San Francisco"]

    @pytest.mark.asyncio
    async def test_normalize_empty_values(self, app):
        """Should return empty dict for empty values list."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/internal/geo-normalize",
                json={"category": "city", "values": []},
            )
            assert response.status_code == 200
            assert response.json() == {}

    @pytest.mark.asyncio
    async def test_normalize_invalid_category(self, app):
        """Should reject invalid category."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/internal/geo-normalize",
                json={"category": "invalid", "values": []},
            )
            assert response.status_code == 422


class TestProcessRequests:
    """Tests for POST /api/internal/process-requests."""

    @pytest.mark.asyncio
    async def test_process_requests_returns_stats(self, app):
        """Should call process_bunk_requests and return stats."""
        mock_result = {
            "success": True,
            "statistics": {"requests_created": 5, "phase2_ambiguous": 1},
            "already_processed": 10,
        }

        with patch("api.routers.internal.run_process_requests", new_callable=AsyncMock, return_value=mock_result):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/internal/process-requests",
                    json={"year": 2025, "session": "all"},
                )
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["created"] == 5
                assert data["skipped"] == 1
                assert data["already_processed"] == 10

    @pytest.mark.asyncio
    async def test_process_requests_defaults(self, app):
        """Should use sensible defaults for optional fields."""
        mock_result = {
            "success": True,
            "statistics": {"requests_created": 0, "phase2_ambiguous": 0},
            "already_processed": 0,
        }

        with patch(
            "api.routers.internal.run_process_requests", new_callable=AsyncMock, return_value=mock_result
        ) as mock_fn:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/internal/process-requests",
                    json={"year": 2025, "session": "all"},
                )
                assert response.status_code == 200
                # Verify defaults were passed
                call_kwargs = mock_fn.call_args[1]
                assert call_kwargs["clear_existing"] is False
                assert call_kwargs["source_fields"] is None
                assert call_kwargs["limit"] == 0

    @pytest.mark.asyncio
    async def test_process_requests_failure_returns_500(self, app):
        """Should return 500 with error details on failure."""
        with patch(
            "api.routers.internal.run_process_requests",
            new_callable=AsyncMock,
            side_effect=ValueError("PocketBase auth failed"),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/internal/process-requests",
                    json={"year": 2025, "session": "all"},
                )
                assert response.status_code == 500
                data = response.json()
                assert data["success"] is False
                assert "PocketBase auth failed" in data["error"]

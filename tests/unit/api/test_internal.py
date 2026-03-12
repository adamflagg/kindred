"""Tests for internal service-to-service endpoints."""

from __future__ import annotations

import os

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

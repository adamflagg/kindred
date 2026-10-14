"""Geo and session-availability endpoints reject non-summer session_types with 422.

Same contract as tests/unit/metrics/test_summer_session_types_validation.py: Family
Camp, adult and B*Mitzvah/Hebrew never fold into summer metrics (#2435).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

ENDPOINTS = [
    "/api/geo/gaps?category=city&year=2025",
    "/api/geo/canonicals?category=city&year=2025",
    "/api/geo/canonicals/Springfield/sources?category=city&year=2025",
    "/api/metrics/session-availability?year=2025",
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "bypass")
    monkeypatch.setenv("SKIP_PB_AUTH", "true")
    monkeypatch.setenv("METRICS_SQL_ENABLED", "false")
    service = MagicMock()
    for name in ("get_gaps", "search_canonicals", "get_sources", "calculate_availability"):
        setattr(service, name, AsyncMock(side_effect=RuntimeError("reached service")))
    with (
        patch("api.routers.geo.GeoService", return_value=service),
        patch("api.routers.session_availability.SessionAvailabilityService", return_value=service),
        patch("api.routers.session_availability._create_repository"),
    ):
        from api.main import create_app

        yield TestClient(create_app(), raise_server_exceptions=False)


@pytest.mark.parametrize("bad", ["family", "family,main", "adult", "bmitzvah"])
@pytest.mark.parametrize("url", ENDPOINTS)
def test_non_summer_types_rejected(client, url, bad):
    response = client.get(f"{url}&session_types={bad}")
    assert response.status_code == 422, (url, bad, response.text[:200])
    assert "main" in response.text


@pytest.mark.parametrize("good", ["main,embedded,ag,quest", "scit,tli", "main"])
@pytest.mark.parametrize("url", ENDPOINTS)
def test_summer_subsets_not_rejected(client, url, good):
    response = client.get(f"{url}&session_types={good}")
    assert response.status_code != 422, (url, good, response.text[:200])

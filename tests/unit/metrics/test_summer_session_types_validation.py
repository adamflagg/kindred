"""Summer metrics endpoints reject non-summer session_types with 422.

``?session_types=family`` used to return plausible Family Camp numbers on summer
pages. Every summer endpoint now validates against DISPLAY_SESSION_TYPES.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.services.metrics_cache import MetricsCache
from api.utils.validators import parse_summer_session_types

ENDPOINTS = [
    "/api/metrics/retention?base_year=2024&compare_year=2025",
    "/api/metrics/registration?year=2025",
    "/api/metrics/historical?years=2025",
    "/api/metrics/retention-trends?current_year=2025",
    "/api/metrics/waitlist?year=2025",
    "/api/metrics/cancellations?year=2025",
    "/api/metrics/drilldown?year=2025&breakdown_type=gender&breakdown_value=F",
    "/api/metrics/velocity?year=2025",
    "/api/metrics/forecast?year=2025",
    "/api/metrics/registration/day1?year=2025",
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "bypass")
    monkeypatch.setenv("SKIP_PB_AUTH", "true")
    monkeypatch.setenv("METRICS_SQL_ENABLED", "false")
    with (
        patch("api.routers.metrics.metrics_cache", MetricsCache(ttl_seconds=300, max_size=100)),
        patch("api.routers.metrics.schedule_aid_warm"),
    ):
        from api.main import create_app

        yield TestClient(create_app(), raise_server_exceptions=False)


@pytest.mark.parametrize("bad", ["family", "family,main", "adult", "bmitzvah", "main,hebrew"])
@pytest.mark.parametrize("url", ENDPOINTS)
def test_non_summer_types_rejected(client, url, bad):
    response = client.get(f"{url}&session_types={bad}")
    assert response.status_code == 422, (url, bad, response.text[:200])
    assert "main" in response.text
    assert "tli" in response.text


@pytest.mark.parametrize("good", ["main,embedded,ag,quest", "scit,tli"])
@pytest.mark.parametrize("url", ENDPOINTS)
def test_display_subsets_not_rejected(client, url, good):
    response = client.get(f"{url}&session_types={good}")
    assert response.status_code != 422, (url, good, response.text[:200])


def test_parser_strips_blanks_and_none():
    assert parse_summer_session_types(None) is None
    assert parse_summer_session_types("") is None
    assert parse_summer_session_types(" main, ,quest ,") == ["main", "quest"]
    assert parse_summer_session_types(" , ") is None

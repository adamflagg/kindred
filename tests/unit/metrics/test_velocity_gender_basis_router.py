"""The Velocity endpoint's gender picker (#2898 answer #78): `gender_basis=field|identity`, default field."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.velocity import VelocityCurve, VelocityResponse
from api.services.metrics_cache import MetricsCache


def _response(**kw: Any) -> VelocityResponse:
    return VelocityResponse(
        year=2026,
        season_start="2025-11-01",
        combined=VelocityCurve(year=2026, weekly=[]),
        by_session=[],
        prior_years=[],
        phase_markers=[],
        **kw,
    )


@pytest.fixture
def client_and_service(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "bypass")
    monkeypatch.setenv("SKIP_PB_AUTH", "true")
    monkeypatch.setenv("METRICS_SQL_ENABLED", "false")
    get_velocity = AsyncMock(side_effect=lambda **kw: _response(gender_basis=kw["gender_basis"]))
    with (
        patch("api.routers.metrics.metrics_cache", MetricsCache(ttl_seconds=300, max_size=100)),
        patch("api.routers.metrics.schedule_aid_warm"),
        patch("api.routers.metrics._create_repository"),
        patch("api.routers.metrics.VelocityService") as service_cls,
    ):
        service_cls.return_value.get_velocity = get_velocity
        from api.main import create_app

        yield TestClient(create_app(), raise_server_exceptions=False), get_velocity


def test_default_is_the_gender_field(client_and_service: Any) -> None:
    client, get_velocity = client_and_service
    response = client.get("/api/metrics/velocity?year=2026&split_by_gender=true")
    assert response.status_code == 200, response.text[:300]
    assert get_velocity.await_args.kwargs["gender_basis"] == "field"
    assert response.json()["gender_basis"] == "field"


def test_identity_is_passed_through_and_cached_apart(client_and_service: Any) -> None:
    client, get_velocity = client_and_service
    client.get("/api/metrics/velocity?year=2026&split_by_gender=true")
    response = client.get("/api/metrics/velocity?year=2026&split_by_gender=true&gender_basis=identity")
    assert response.status_code == 200, response.text[:300]
    assert get_velocity.await_count == 2  # not served from the Gender field's cache entry
    assert get_velocity.await_args.kwargs["gender_basis"] == "identity"
    assert response.json()["gender_basis"] == "identity"


def test_an_unknown_basis_is_rejected(client_and_service: Any) -> None:
    client, _ = client_and_service
    assert client.get("/api/metrics/velocity?year=2026&gender_basis=pronouns").status_code == 422

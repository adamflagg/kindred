"""Tests for metrics cache integration with endpoints.

Written FIRST (TDD). These tests verify that metrics endpoints use the
MetricsCache to avoid redundant computation:
- First request computes and caches
- Second identical request returns cached result (service not called again)
- Invalidation clears cache, next request recomputes
- Cache stats endpoint works
- Different params are cached separately
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services.metrics_cache import MetricsCache


@pytest.fixture
def fresh_cache():
    """Provide a fresh MetricsCache for each test."""
    return MetricsCache(ttl_seconds=300, max_size=100)


@pytest.fixture
def test_client(fresh_cache):
    """Create test client with mocked PB auth and injected cache."""
    os.environ["AUTH_MODE"] = "bypass"
    os.environ["SKIP_PB_AUTH"] = "true"

    with patch("api.dependencies.metrics_cache", fresh_cache):
        from api.main import create_app

        app = create_app()
        client = TestClient(app)
        yield client

    os.environ.pop("AUTH_MODE", None)
    os.environ.pop("SKIP_PB_AUTH", None)


# Minimal mock response that satisfies RetentionMetricsResponse schema
MOCK_RETENTION_RESPONSE = AsyncMock(
    return_value=AsyncMock(
        model_dump=lambda: {
            "base_year": 2025,
            "compare_year": 2026,
            "total_base": 100,
            "total_returned": 80,
            "retention_rate": 0.8,
        }
    )
)


class TestRetentionEndpointCaching:
    """Test that the retention endpoint uses the cache."""

    @pytest.mark.asyncio
    def test_second_request_uses_cache(self, test_client, fresh_cache):
        """Second identical request should hit cache, not recompute."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(
            return_value=_make_retention_response()
        )

        with patch("api.routers.metrics.RetentionService", return_value=mock_service):
            with patch("api.routers.metrics.MetricsRepository"):
                # First request - cache miss, calls service
                resp1 = test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2025, "compare_year": 2026},
                )
                assert resp1.status_code == 200

                # Second request - should use cache, NOT call service again
                resp2 = test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2025, "compare_year": 2026},
                )
                assert resp2.status_code == 200

                # Service should only be called once
                assert mock_service.calculate_retention.call_count == 1

                # Responses should be identical
                assert resp1.json() == resp2.json()

    @pytest.mark.asyncio
    def test_different_params_cache_separately(self, test_client, fresh_cache):
        """Different query params should result in separate cache entries."""
        call_count = 0

        async def track_calls(**kwargs):
            nonlocal call_count
            call_count += 1
            return _make_retention_response(
                base_year=kwargs.get("base_year", 2025),
                compare_year=kwargs.get("compare_year", 2026),
            )

        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(side_effect=track_calls)

        with patch("api.routers.metrics.RetentionService", return_value=mock_service):
            with patch("api.routers.metrics.MetricsRepository"):
                test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2025, "compare_year": 2026},
                )
                test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2024, "compare_year": 2025},
                )
                # Both should call service (different params)
                assert call_count == 2

    @pytest.mark.asyncio
    def test_cache_invalidation_forces_recompute(self, test_client, fresh_cache):
        """After invalidation, the same request should recompute."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(
            return_value=_make_retention_response()
        )

        with patch("api.routers.metrics.RetentionService", return_value=mock_service):
            with patch("api.routers.metrics.MetricsRepository"):
                # First request
                test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2025, "compare_year": 2026},
                )
                assert mock_service.calculate_retention.call_count == 1

                # Invalidate cache
                fresh_cache.invalidate_all()

                # Same request should recompute
                test_client.get(
                    "/api/metrics/retention",
                    params={"base_year": 2025, "compare_year": 2026},
                )
                assert mock_service.calculate_retention.call_count == 2


class TestRegistrationEndpointCaching:
    """Test that the registration endpoint uses the cache."""

    @pytest.mark.asyncio
    def test_second_request_uses_cache(self, test_client, fresh_cache):
        mock_service = AsyncMock()
        mock_service.calculate_registration = AsyncMock(
            return_value=_make_registration_response()
        )

        with patch("api.routers.metrics.RegistrationService", return_value=mock_service):
            with patch("api.routers.metrics.MetricsRepository"):
                resp1 = test_client.get(
                    "/api/metrics/registration",
                    params={"year": 2026},
                )
                assert resp1.status_code == 200

                resp2 = test_client.get(
                    "/api/metrics/registration",
                    params={"year": 2026},
                )
                assert resp2.status_code == 200

                assert mock_service.calculate_registration.call_count == 1


class TestCacheInvalidationEndpoint:
    """Test the POST /api/metrics/cache/invalidate endpoint."""

    def test_invalidation_endpoint_clears_cache(self, test_client, fresh_cache):
        """POST to invalidation endpoint should clear the cache."""
        # Populate cache
        fresh_cache.set("retention", {"data": True}, year=2026)
        fresh_cache.set("registration", {"data": True}, year=2026)
        assert fresh_cache.get_stats()["cache_size"] == 2

        resp = test_client.post("/api/metrics/cache/invalidate")
        assert resp.status_code == 200
        assert resp.json()["cleared"] == 2
        assert fresh_cache.get_stats()["cache_size"] == 0

    def test_invalidation_endpoint_returns_zero_when_empty(self, test_client, fresh_cache):
        resp = test_client.post("/api/metrics/cache/invalidate")
        assert resp.status_code == 200
        assert resp.json()["cleared"] == 0


class TestCacheStatsEndpoint:
    """Test the GET /api/metrics/cache/stats endpoint."""

    def test_stats_endpoint_returns_cache_stats(self, test_client, fresh_cache):
        fresh_cache.set("retention", {"data": True}, year=2026)
        fresh_cache.get("retention", year=2026)  # hit
        fresh_cache.get("missing", year=2026)  # miss

        resp = test_client.get("/api/metrics/cache/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["cache_size"] == 1
        assert data["hit_count"] == 1
        assert data["miss_count"] == 1


# ============================================================================
# Mock response helpers
# ============================================================================


def _make_retention_response(base_year: int = 2025, compare_year: int = 2026):
    """Create a minimal mock that acts like RetentionMetricsResponse."""
    from api.schemas.metrics import RetentionMetricsResponse

    return RetentionMetricsResponse(
        base_year=base_year,
        compare_year=compare_year,
        total_base=100,
        total_returned=80,
        retention_rate=0.8,
        by_gender=[],
        by_grade=[],
        by_session=[],
        by_years_at_camp=[],
        by_school=[],
        by_city=[],
        by_synagogue=[],
        by_prior_session=[],
        by_session_bunk=[],
        session_flow=[],
        by_summer_years=[],
        by_first_summer_year=[],
    )


def _make_registration_response(year: int = 2026):
    """Create a minimal mock that acts like RegistrationMetricsResponse."""
    from api.schemas.metrics import RegistrationMetricsResponse

    return RegistrationMetricsResponse(
        year=year,
        total_enrolled=200,
        by_gender=[],
        by_grade=[],
        by_session=[],
        by_years_at_camp=[],
        by_new_returning=[],
        by_session_length=[],
        by_school=[],
        by_city=[],
        by_synagogue=[],
    )

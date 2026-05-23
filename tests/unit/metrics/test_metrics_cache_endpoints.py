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
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services.metrics_cache import MetricsCache

if TYPE_CHECKING:
    from api.schemas.metrics import RegistrationMetricsResponse, RetentionMetricsResponse, RetentionTrendsResponse


@pytest.fixture
def fresh_cache():
    """Provide a fresh MetricsCache for each test."""
    return MetricsCache(ttl_seconds=300, max_size=100)


@pytest.fixture
def test_client(fresh_cache):
    """Create test client with injected cache.

    Patches metrics_cache at the router level (where it's imported via
    ``from ..dependencies import metrics_cache``). This ensures the
    endpoint functions see our fresh_cache instance.
    """
    os.environ["AUTH_MODE"] = "bypass"
    os.environ["SKIP_PB_AUTH"] = "true"
    os.environ["METRICS_SQL_ENABLED"] = "false"

    with patch("api.routers.metrics.metrics_cache", fresh_cache):
        from api.main import create_app

        app = create_app()
        client = TestClient(app)
        yield client

    os.environ.pop("AUTH_MODE", None)
    os.environ.pop("SKIP_PB_AUTH", None)
    os.environ.pop("METRICS_SQL_ENABLED", None)


class TestRetentionEndpointCaching:
    """Test that the retention endpoint uses the cache."""

    def test_second_request_uses_cache(self, test_client, fresh_cache):
        """Second identical request should hit cache, not recompute."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(return_value=_make_retention_response())

        with (
            patch("api.routers.metrics.RetentionService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            resp1 = test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026},
            )
            assert resp1.status_code == 200

            resp2 = test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026},
            )
            assert resp2.status_code == 200

            # Service should only be called once (second request used cache)
            assert mock_service.calculate_retention.call_count == 1
            assert resp1.json() == resp2.json()

    def test_different_params_cache_separately(self, test_client, fresh_cache):
        """Different query params should result in separate cache entries."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(
            side_effect=[
                _make_retention_response(base_year=2025, compare_year=2026),
                _make_retention_response(base_year=2024, compare_year=2025),
            ]
        )

        with (
            patch("api.routers.metrics.RetentionService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026},
            )
            test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2024, "compare_year": 2025},
            )
            # Both should call service (different params)
            assert mock_service.calculate_retention.call_count == 2

    def test_cache_invalidation_forces_recompute(self, test_client, fresh_cache):
        """After invalidation, the same request should recompute."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(return_value=_make_retention_response())

        with (
            patch("api.routers.metrics.RetentionService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
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

    def test_include_teen_pipeline_param_forwarded_to_service(self, test_client, fresh_cache):
        """Route must forward include_teen_pipeline=True to RetentionService.calculate_retention."""
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(return_value=_make_retention_response())

        with (
            patch("api.routers.metrics.RetentionService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            resp = test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026, "include_teen_pipeline": "true"},
            )
            assert resp.status_code == 200, resp.text

            # The service must have been called with include_teen_pipeline=True
            mock_service.calculate_retention.assert_called_once()
            call_kwargs = mock_service.calculate_retention.call_args.kwargs
            assert call_kwargs.get("include_teen_pipeline") is True, (
                f"Expected include_teen_pipeline=True in service call, got: {call_kwargs}"
            )

    def test_include_teen_pipeline_flag_off_caches_separately(self, test_client, fresh_cache):
        """include_teen_pipeline=True and =False must produce separate cache entries.

        Two requests with different flag values must each invoke the service once
        (not share a cache hit).
        """
        mock_service = AsyncMock()
        mock_service.calculate_retention = AsyncMock(
            side_effect=[
                _make_retention_response(base_year=2025, compare_year=2026),
                _make_retention_response(base_year=2025, compare_year=2026),
            ]
        )

        with (
            patch("api.routers.metrics.RetentionService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            # flag OFF (default)
            test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026, "include_teen_pipeline": "false"},
            )
            # flag ON — must NOT hit the flag-off cache entry
            test_client.get(
                "/api/metrics/retention",
                params={"base_year": 2025, "compare_year": 2026, "include_teen_pipeline": "true"},
            )
            assert mock_service.calculate_retention.call_count == 2, (
                "Both flag=true and flag=false must cache independently"
            )


class TestRegistrationEndpointCaching:
    """Test that the registration endpoint uses the cache."""

    def test_second_request_uses_cache(self, test_client, fresh_cache):
        mock_service = AsyncMock()
        mock_service.calculate_registration = AsyncMock(return_value=_make_registration_response())

        with (
            patch("api.routers.metrics.RegistrationService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
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

    def test_invalidation_endpoint_also_clears_geo_person_id_cache(self, test_client, fresh_cache):
        """The same /cache/invalidate endpoint must also clear the geo _PERSON_ID_CACHE.

        CampMinder sync changes attendee status_id, which feeds _fetch_active_person_pb_ids.
        The frontend fires POST /api/metrics/cache/invalidate after sync completion, so
        geo's person-id cache must hook into the same signal to avoid stale data.
        """
        from api.services.geo_service import _PERSON_ID_CACHE, clear_person_id_cache

        # Reset shared module-level cache so prior-test bleed can't skew the count.
        clear_person_id_cache()

        # Prime the geo cache with a stub entry (key shape: mode, year, types, cm_id, duration)
        _PERSON_ID_CACHE[("active", 2025, (), None, None)] = ({"p1", "p2"}, 9999999999.0)
        assert len(_PERSON_ID_CACHE) == 1

        resp = test_client.post("/api/metrics/cache/invalidate")
        assert resp.status_code == 200
        assert len(_PERSON_ID_CACHE) == 0


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


class TestRetentionTrendsEndpointCaching:
    """Test that the /retention-trends endpoint caches per include_teen_pipeline flag."""

    def test_retention_trends_caches_per_teen_flag(self, test_client, fresh_cache):
        """Two GETs differing only in include_teen_pipeline must produce two service calls.

        Flag=false and flag=true must NOT share a cache entry.
        """
        mock_service = AsyncMock()
        mock_service.calculate_retention_trends = AsyncMock(
            side_effect=[
                _make_retention_trends_response(),
                _make_retention_trends_response(),
            ]
        )

        with (
            patch("api.routers.metrics.RetentionTrendsService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            # flag OFF (default)
            resp1 = test_client.get(
                "/api/metrics/retention-trends",
                params={"current_year": 2026, "include_teen_pipeline": "false"},
            )
            assert resp1.status_code == 200, resp1.text

            # flag ON — must NOT hit the flag-off cache entry
            resp2 = test_client.get(
                "/api/metrics/retention-trends",
                params={"current_year": 2026, "include_teen_pipeline": "true"},
            )
            assert resp2.status_code == 200, resp2.text

            assert mock_service.calculate_retention_trends.call_count == 2, (
                "Both flag=true and flag=false must cache independently"
            )

    def test_retention_trends_forwards_teen_flag_to_service(self, test_client, fresh_cache):
        """Route must forward include_teen_pipeline=True to RetentionTrendsService."""
        mock_service = AsyncMock()
        mock_service.calculate_retention_trends = AsyncMock(return_value=_make_retention_trends_response())

        with (
            patch("api.routers.metrics.RetentionTrendsService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            resp = test_client.get(
                "/api/metrics/retention-trends",
                params={"current_year": 2026, "include_teen_pipeline": "true"},
            )
            assert resp.status_code == 200, resp.text

            mock_service.calculate_retention_trends.assert_called_once()
            call_kwargs = mock_service.calculate_retention_trends.call_args.kwargs
            assert call_kwargs.get("include_teen_pipeline") is True, (
                f"Expected include_teen_pipeline=True in service call, got: {call_kwargs}"
            )


class TestDrilldownEndpointTeenFlag:
    """Test that /drilldown already forwards include_teen_pipeline (no caching — not cached)."""

    def test_drilldown_forwards_teen_flag(self, test_client, fresh_cache):
        """GET /drilldown?...&include_teen_pipeline=true must call DrilldownService with True."""
        mock_service = AsyncMock()
        mock_service.get_attendees_for_breakdown = AsyncMock(return_value=[])

        with (
            patch("api.routers.metrics.DrilldownService", return_value=mock_service),
            patch("api.services.metrics_repository.MetricsRepository"),
        ):
            resp = test_client.get(
                "/api/metrics/drilldown",
                params={
                    "year": 2026,
                    "breakdown_type": "grade",
                    "breakdown_value": "10",
                    "compare_year": 2026,
                    "include_teen_pipeline": "true",
                },
            )
            assert resp.status_code == 200, resp.text

            mock_service.get_attendees_for_breakdown.assert_called_once()
            call_kwargs = mock_service.get_attendees_for_breakdown.call_args.kwargs
            assert call_kwargs.get("include_teen_pipeline") is True, (
                f"Expected include_teen_pipeline=True in drilldown service call, got: {call_kwargs}"
            )


# ============================================================================
# Mock response helpers
# ============================================================================


def _make_retention_response(
    base_year: int = 2025,
    compare_year: int = 2026,
) -> RetentionMetricsResponse:
    """Create a minimal RetentionMetricsResponse with required fields."""
    from api.schemas.metrics import RetentionMetricsResponse

    return RetentionMetricsResponse(
        base_year=base_year,
        compare_year=compare_year,
        base_year_total=100,
        compare_year_total=120,
        returned_count=80,
        overall_retention_rate=0.8,
        by_gender=[],
        by_grade=[],
        by_session=[],
        by_years_at_camp=[],
        aged_out_count=0,
    )


def _make_registration_response(year: int = 2026) -> RegistrationMetricsResponse:
    """Create a minimal RegistrationMetricsResponse with required fields."""
    from api.schemas.metrics import NewVsReturning, RegistrationMetricsResponse

    return RegistrationMetricsResponse(
        year=year,
        total_enrolled=200,
        total_waitlisted=10,
        total_cancelled=5,
        by_gender=[],
        by_grade=[],
        by_session=[],
        by_session_length=[],
        by_years_at_camp=[],
        new_vs_returning=NewVsReturning(
            new_count=50,
            returning_count=150,
            new_percentage=0.25,
            returning_percentage=0.75,
        ),
    )


def _make_retention_trends_response() -> RetentionTrendsResponse:
    """Create a minimal RetentionTrendsResponse with required fields."""
    from api.schemas.metrics import RetentionTrendsResponse

    return RetentionTrendsResponse(
        years=[],
        avg_retention_rate=0.8,
        trend_direction="stable",
        by_gender_grouped=[],
        by_grade_grouped=[],
        enrollment_by_year=[],
    )

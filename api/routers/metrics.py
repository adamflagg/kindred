"""
Metrics Router - Registration and retention metrics endpoints.

This router provides endpoints for analyzing historical registration data,
retention rates, and year-over-year comparisons.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, Query

from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import metrics_cache, pb
from ..schemas.forecast import ForecastResponse
from ..schemas.metrics import (
    CancellationMetricsResponse,
    ComparisonMetricsResponse,
    DrilldownAttendee,
    HistoricalTrendsResponse,
    RegistrationMetricsResponse,
    RetentionMetricsResponse,
    RetentionTrendsResponse,
    WaitlistMetricsResponse,
)
from ..schemas.velocity import VelocityResponse

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _create_repository() -> Any:
    """Create the appropriate metrics repository based on configuration.

    Uses direct SQLite by default (METRICS_SQL_ENABLED=true) for performance.
    Falls back to PocketBase HTTP API when disabled.
    """
    if os.environ.get("METRICS_SQL_ENABLED", "true").lower() == "true":
        from api.services.metrics_sql_repository import MetricsSQLRepository

        return MetricsSQLRepository()
    from api.services.metrics_repository import MetricsRepository

    return MetricsRepository(pb)


# ============================================================================
# Retention Endpoint
# ============================================================================


@router.get("/retention", response_model=RetentionMetricsResponse)
async def get_retention_metrics(
    base_year: int = Query(..., description="Base year (e.g., 2025)"),
    compare_year: int = Query(..., description="Comparison year (e.g., 2026)"),
    session_types: str | None = Query(
        None, description="Comma-separated session types to filter (e.g., 'main,embedded')"
    ),
    session_cm_id: int | None = Query(None, description="Filter to specific session by CampMinder ID"),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> RetentionMetricsResponse:
    """Get retention metrics comparing two years.

    Calculates what percentage of campers from base_year returned in compare_year,
    broken down by gender, grade, session, and years at camp.
    """
    from api.services.retention_service import RetentionService

    cache_params = {
        "base_year": base_year,
        "compare_year": compare_year,
        "session_types": session_types,
        "session_cm_id": session_cm_id,
    }
    cached: RetentionMetricsResponse | None = metrics_cache.get("retention", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = RetentionService(repository)
    result = await service.calculate_retention(
        base_year=base_year,
        compare_year=compare_year,
        session_types=type_filter,
        session_cm_id=session_cm_id,
    )
    metrics_cache.set("retention", result, **cache_params)
    return result


# ============================================================================
# Registration Endpoint
# ============================================================================


@router.get("/registration", response_model=RegistrationMetricsResponse)
async def get_registration_metrics(
    year: int = Query(..., description="Year to get registration metrics for"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    statuses: str | None = Query(
        "enrolled",
        description="Comma-separated statuses to include (default: enrolled). Options: enrolled, applied, waitlisted, left_early, cancelled, dismissed, inquiry, withdrawn, incomplete, unknown",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID. AG sessions with matching parent_id are included.",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> RegistrationMetricsResponse:
    """Get registration breakdown metrics for a specific year.

    Returns enrollment counts broken down by gender, grade, session,
    session length, years at camp, and new vs returning status.

    The statuses parameter controls which registration statuses are included
    in the enrollment counts and breakdowns. Multiple statuses can be combined
    for flexible dashboard views.
    """

    from api.services.registration_service import RegistrationService

    cache_params = {
        "year": year,
        "session_types": session_types,
        "statuses": statuses,
        "session_cm_id": session_cm_id,
    }
    cached: RegistrationMetricsResponse | None = metrics_cache.get("registration", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    status_filter = [s.strip() for s in (statuses or "enrolled").split(",")]
    repository = _create_repository()
    service = RegistrationService(repository)
    result = await service.calculate_registration(year, type_filter, status_filter, session_cm_id)
    metrics_cache.set("registration", result, **cache_params)
    return result


# ============================================================================
# Comparison Endpoint
# ============================================================================


@router.get("/comparison", response_model=ComparisonMetricsResponse)
async def get_comparison_metrics(
    year_a: int = Query(..., description="First year to compare"),
    year_b: int = Query(..., description="Second year to compare"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> ComparisonMetricsResponse:
    """Get year-over-year comparison metrics.

    Compares total enrollment, gender distribution, and grade distribution
    between two years. Filters to summer camp sessions by default.
    """
    from api.services.comparison_service import ComparisonService

    cache_params = {"year_a": year_a, "year_b": year_b, "session_types": session_types}
    cached: ComparisonMetricsResponse | None = metrics_cache.get("comparison", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = ComparisonService(repository)
    result = await service.calculate_comparison(
        year_a=year_a,
        year_b=year_b,
        session_types=type_filter,
    )
    metrics_cache.set("comparison", result, **cache_params)
    return result


# ============================================================================
# Historical Trends Endpoint
# ============================================================================


@router.get("/historical", response_model=HistoricalTrendsResponse)
async def get_historical_trends(
    years: str | None = Query(None, description="Comma-separated years (default: last 5 years from current year)"),
    session_types: str | None = Query("main,ag,embedded,quest", description="Comma-separated session types to filter"),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID. Uses name-matching across years.",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> HistoricalTrendsResponse:
    """Get historical trends across multiple years.

    Returns aggregated metrics for each year to enable line chart visualization.
    Default: last 5 years from current year (based on CAMPMINDER_SEASON_ID).

    When session_cm_id is provided, resolves to the session name and filters by name
    across years. CampMinder often reuses cm_ids year-over-year, but names can change
    (e.g., "Session 2a" → "Taste of Camp 2"), so name-matching handles both cases.
    """
    from api.services.historical_service import HistoricalService

    cache_params = {"years": years, "session_types": session_types, "session_cm_id": session_cm_id}
    cached: HistoricalTrendsResponse | None = metrics_cache.get("historical", **cache_params)
    if cached is not None:
        return cached

    year_list = [int(y.strip()) for y in years.split(",")] if years else None
    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = HistoricalService(repository)
    result = await service.calculate_historical_trends(
        years=year_list,
        session_types=type_filter,
        session_cm_id=session_cm_id,
    )
    metrics_cache.set("historical", result, **cache_params)
    return result


# ============================================================================
# Retention Trends Endpoint (3-Year View)
# ============================================================================


@router.get("/retention-trends", response_model=RetentionTrendsResponse)
async def get_retention_trends(
    current_year: int = Query(..., description="Current year (e.g., 2026)"),
    num_years: int = Query(3, description="Number of year-to-year transitions (default: 3)"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> RetentionTrendsResponse:
    """Get retention trends across multiple year transitions.

    Returns retention data for num_years year transitions. For example,
    with num_years=3 and current_year=2026:
    - 2023→2024 transition
    - 2024→2025 transition
    - 2025→2026 transition

    This enables line charts for overall retention and grouped bar charts
    for breakdown categories.
    """

    from api.services.retention_trends_service import RetentionTrendsService

    cache_params = {
        "current_year": current_year,
        "num_years": num_years,
        "session_types": session_types,
        "session_cm_id": session_cm_id,
    }
    cached: RetentionTrendsResponse | None = metrics_cache.get("retention_trends", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = RetentionTrendsService(repository)
    result = await service.calculate_retention_trends(
        current_year=current_year,
        num_years=num_years,
        session_types=type_filter,
        session_cm_id=session_cm_id,
    )
    metrics_cache.set("retention_trends", result, **cache_params)
    return result


# ============================================================================
# Waitlist Analysis Endpoint
# ============================================================================


@router.get("/waitlist", response_model=WaitlistMetricsResponse)
async def get_waitlist_metrics(
    year: int = Query(..., description="Year to analyze"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> WaitlistMetricsResponse:
    """Get waitlist analysis metrics.

    Returns four categories of waitlist data:
    - Currently waitlisted with no other enrolled sessions (highest priority)
    - Currently waitlisted but enrolled in other sessions
    - Previously waitlisted, now accepted (enrolled)
    - Previously waitlisted, declined (cancelled/withdrawn/dismissed)
    """

    from api.services.waitlist_service import WaitlistService

    cache_params = {"year": year, "session_types": session_types, "session_cm_id": session_cm_id}
    cached: WaitlistMetricsResponse | None = metrics_cache.get("waitlist", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = WaitlistService(repository)
    result = await service.calculate_waitlist(
        year=year,
        session_types=type_filter,
        session_cm_id=session_cm_id,
    )
    metrics_cache.set("waitlist", result, **cache_params)
    return result


# ============================================================================
# Cancellation Analysis Endpoint
# ============================================================================


@router.get("/cancellations", response_model=CancellationMetricsResponse)
async def get_cancellation_metrics(
    year: int = Query(..., description="Year to analyze"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> CancellationMetricsResponse:
    """Get cancellation analysis metrics.

    Returns cancellation data categorized by:
    - Was enrolled vs was waitlisted before cancelling
    - Has other sessions vs no other sessions remaining
    - Re-enrolled (cancelled then returned)
    """
    from api.services.cancellation_service import CancellationService

    cache_params = {"year": year, "session_types": session_types, "session_cm_id": session_cm_id}
    cached: CancellationMetricsResponse | None = metrics_cache.get("cancellations", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = CancellationService(repository)
    result = await service.calculate_cancellations(
        year=year,
        session_types=type_filter,
        session_cm_id=session_cm_id,
    )
    metrics_cache.set("cancellations", result, **cache_params)
    return result


# ============================================================================
# Drilldown Endpoint (Chart Click-Through)
# ============================================================================


@router.get("/drilldown", response_model=list[DrilldownAttendee])
async def get_drilldown_attendees(
    year: int = Query(..., description="Year to get attendees for"),
    breakdown_type: str = Query(
        ...,
        description="Type of breakdown: session, gender, grade, school, years_at_camp, status, "
        "waitlist_no_enrollment, waitlist_has_enrollment, waitlist_accepted, waitlist_declined",
    ),
    breakdown_value: str = Query(
        ...,
        description="The value to filter by (e.g., 'F' for gender, '5' for grade, '1000' for session cm_id)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Optional: Filter to specific session by CampMinder ID",
    ),
    session_types: str | None = Query(
        None,
        description="Comma-separated session types to filter (e.g., 'main,embedded,ag')",
    ),
    status_filter: str | None = Query(
        None,
        description="Comma-separated statuses to include (default: enrolled)",
    ),
    compare_year: int | None = Query(
        None,
        description="Compare year for retention drilldowns. When set, is_returning reflects "
        "whether camper returned to the compare year instead of years_at_camp > 1.",
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> list[DrilldownAttendee]:
    """Get attendee list for a specific breakdown value.

    Click a chart segment (e.g., "Grade 5" bar) to see all matching campers.
    Returns individual attendee records with person details for modal display.
    """
    from api.services.drilldown_service import DrilldownService

    session_types_list = session_types.split(",") if session_types else None
    status_list = status_filter.split(",") if status_filter else None

    repository = _create_repository()
    service = DrilldownService(repository)

    return await service.get_attendees_for_breakdown(
        year=year,
        breakdown_type=breakdown_type,
        breakdown_value=breakdown_value,
        session_cm_id=session_cm_id,
        session_types=session_types_list,
        status_filter=status_list,
        compare_year=compare_year,
    )


# ============================================================================
# Velocity Endpoint
# ============================================================================


@router.get("/velocity", response_model=VelocityResponse)
async def get_velocity(
    year: int = Query(..., description="Year to analyze"),
    compare_years: str | None = Query(None, description="Comma-separated prior years to overlay"),
    session_cm_id: int | None = Query(None, description="Filter to specific session"),
    session_types: str | None = Query("main,embedded,ag", description="Session types"),
    split_by_gender: bool = Query(False, description="Split enrollment by gender (M/F)"),
    metric: str = Query("enrollment", description="'enrollment' or 'cancellation'"),
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> VelocityResponse:
    """Get registration velocity curves with week-over-week data."""

    from api.services.velocity_service import VelocityService

    cache_params = {
        "year": year,
        "compare_years": compare_years,
        "session_cm_id": session_cm_id,
        "session_types": session_types,
        "split_by_gender": split_by_gender,
        "metric": metric,
    }
    cached: VelocityResponse | None = metrics_cache.get("velocity", **cache_params)
    if cached is not None:
        return cached

    compare_year_list = [int(y.strip()) for y in compare_years.split(",")] if compare_years else None
    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = VelocityService(repository)
    result = await service.get_velocity(
        year=year,
        session_cm_id=session_cm_id,
        compare_years=compare_year_list,
        session_types=type_filter,
        split_by_gender=split_by_gender,
        metric=metric,
    )
    metrics_cache.set("velocity", result, **cache_params)
    return result


# ============================================================================
# Forecast Endpoint
# ============================================================================


@router.get("/forecast/snapshot-dates")
async def get_forecast_snapshot_dates(
    year: int = Query(..., description="Year to get snapshot dates for"),
    user: AuthUser = Depends(require_permission(Permission.METRICS_FINANCIAL)),
) -> dict[str, list[str]]:
    """Return available enrollment snapshot dates for the forecast date picker."""
    repository = _create_repository()
    dates = await repository.fetch_available_snapshot_dates(year)
    return {"dates": dates}


@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast(
    year: int = Query(..., description="Year to forecast"),
    session_types: str | None = Query("main,embedded,ag,quest", description="Session types"),
    session_cm_id: int | None = Query(None, description="Filter to specific session"),
    snapshot_date: str | None = Query(None, description="Historical snapshot date (YYYY-MM-DD)"),
    user: AuthUser = Depends(require_permission(Permission.METRICS_FINANCIAL)),
) -> ForecastResponse:
    """Get registration forecast with budget goals, capacity, and revenue projections."""
    from api.services.forecast_service import ForecastService

    cache_params = {
        "year": year,
        "session_types": session_types,
        "session_cm_id": session_cm_id,
        "snapshot_date": snapshot_date,
    }
    cached: ForecastResponse | None = metrics_cache.get("forecast", **cache_params)
    if cached is not None:
        return cached

    type_filter = session_types.split(",") if session_types else None
    repository = _create_repository()
    service = ForecastService(repository)
    result = await service.calculate_forecast(
        year=year,
        session_types=type_filter,
        session_cm_id=session_cm_id,
        snapshot_date=snapshot_date,
    )
    metrics_cache.set("forecast", result, **cache_params)
    return result


# ============================================================================
# Cache Management Endpoints
# ============================================================================


@router.post("/cache/invalidate")
async def invalidate_metrics_cache(
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> dict[str, int]:
    """Invalidate all cached metrics responses.

    Called by frontend on sync completion (via invalidateSyncData) or manual cache clear.
    """
    cleared = metrics_cache.invalidate_all()
    return {"cleared": cleared}


@router.get("/cache/stats")
async def get_cache_stats(
    user: AuthUser = Depends(require_permission(Permission.METRICS_VIEW)),
) -> dict[str, int | float]:
    """Get metrics cache statistics (hit rate, size, etc.)."""
    return metrics_cache.get_stats()

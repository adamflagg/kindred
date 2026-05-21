"""
Geo Router - Geographic data management endpoints.

This router provides endpoints for:
- Viewing gaps in geographic data (missing coordinates)
- Searching canonical entries with source metadata
- Inspecting raw value sources for a canonical name
- Managing geo overrides (CRUD)
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from starlette.responses import Response

from api.constants.geo import GeoCategory
from api.utils.validators import check_duration_session_exclusive
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb
from ..schemas.geo import (
    ApproveRequest,
    BatchResolveResponse,
    CanonicalSearchResponse,
    GapsResponse,
    MergeRequest,
    MergeResponse,
    OverrideCreate,
    OverrideResponse,
    RejectRequest,
    RejectResponse,
    SourcesResponse,
)
from ..services.geo_service import GeoService

router = APIRouter(prefix="/api/geo", tags=["geo"])


def _get_service() -> GeoService:
    """Create a GeoService instance with the shared PocketBase client."""
    return GeoService(pb)


# ============================================================================
# Gaps Endpoint
# ============================================================================


@router.get("/gaps", response_model=GapsResponse)
async def get_gaps(
    category: GeoCategory = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)", ge=2000, le=2100),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    duration: Literal["1-week", "2-week", "3-week", "4-week+"] | None = Query(
        None, description="Filter by session duration category (1-week, 2-week, 3-week, 4-week+)"
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> GapsResponse:
    """Get three-tier gap classification for normalized values missing coordinates."""
    check_duration_session_exclusive(duration, session_cm_id)

    service = _get_service()
    types_list = session_types.split(",") if session_types else None
    return await service.get_gaps(category, year, active_only, types_list, session_cm_id, duration=duration)


# ============================================================================
# Canonical Search Endpoint
# ============================================================================


@router.get("/canonicals", response_model=CanonicalSearchResponse)
async def search_canonicals(
    category: GeoCategory = Query(..., description="Category: city, school, or congregation"),
    q: str = Query("", description="Search query (case-insensitive substring match). Empty returns in-use entries."),
    year: int = Query(..., description="Year scope (e.g. 2025)", ge=2000, le=2100),
    in_use: bool = Query(False, description="If true, only return entries with camper_count > 0"),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    duration: Literal["1-week", "2-week", "3-week", "4-week+"] | None = Query(
        None, description="Filter by session duration category (1-week, 2-week, 3-week, 4-week+)"
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> CanonicalSearchResponse:
    """Search canonical entries by name, city, or state."""
    check_duration_session_exclusive(duration, session_cm_id)

    service = _get_service()
    types_list = session_types.split(",") if session_types else None
    return await service.search_canonicals(
        category,
        q,
        year,
        in_use_only=in_use,
        active_only=active_only,
        session_types=types_list,
        session_cm_id=session_cm_id,
        duration=duration,
    )


# ============================================================================
# Source Inspection Endpoint
# ============================================================================


@router.get("/canonicals/{canonical_name}/sources", response_model=SourcesResponse)
async def get_sources(
    canonical_name: str,
    category: GeoCategory = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)", ge=2000, le=2100),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    duration: Literal["1-week", "2-week", "3-week", "4-week+"] | None = Query(
        None, description="Filter by session duration category (1-week, 2-week, 3-week, 4-week+)"
    ),
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> SourcesResponse:
    """Get raw value variants that map to a canonical name."""
    check_duration_session_exclusive(duration, session_cm_id)

    service = _get_service()
    types_list = session_types.split(",") if session_types else None
    return await service.get_sources(
        category,
        canonical_name,
        year,
        active_only,
        types_list,
        session_cm_id,
        duration=duration,
    )


# ============================================================================
# Batch Resolve Coords Endpoint
# ============================================================================


@router.post("/batch-resolve-coords", response_model=BatchResolveResponse)
async def batch_resolve_coords(
    category: GeoCategory = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)", ge=2000, le=2100),
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> BatchResolveResponse:
    """Batch auto-resolve coordinates for unambiguous canonical entries."""
    service = _get_service()
    result = await service.batch_resolve_coords(category, year)
    return BatchResolveResponse(**result)


# ============================================================================
# Override CRUD Endpoints
# ============================================================================


@router.get("/overrides", response_model=list[OverrideResponse])
async def list_overrides(
    category: GeoCategory = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)", ge=2000, le=2100),
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> list[OverrideResponse]:
    """List all geo overrides for a category and year."""
    service = _get_service()
    return await service.list_overrides(category, year)


@router.post("/overrides", response_model=OverrideResponse, status_code=201)
async def create_override(
    data: OverrideCreate,
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> OverrideResponse:
    """Create a new geo override."""
    service = _get_service()
    return await service.create_override(data)


@router.patch("/overrides/{override_id}", response_model=OverrideResponse)
async def update_override(
    override_id: str,
    data: dict[str, Any],
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> OverrideResponse:
    """Update an existing geo override."""
    service = _get_service()
    return await service.update_override(override_id, data)


@router.delete("/overrides/{override_id}", status_code=204)
async def delete_override(
    override_id: str,
    user: AuthUser = Depends(require_permission(Permission.METRICS_GEO)),
) -> Response:
    """Delete a geo override."""
    service = _get_service()
    await service.delete_override(override_id)
    return Response(status_code=204)


# ============================================================================
# Canonical Action Endpoints (Merge, Approve, Reject)
# ============================================================================


@router.post("/canonicals/{canonical_name}/merge")
async def merge_canonical(
    canonical_name: str,
    body: MergeRequest,
    _: None = Depends(require_permission(Permission.METRICS_GEO)),
    service: GeoService = Depends(_get_service),
) -> MergeResponse:
    """Merge one canonical into another, reassigning all mappings."""
    count = await service.merge_canonical(canonical_name, body.target, body.category, body.year)
    return MergeResponse(merged_count=count)


@router.post("/canonicals/{canonical_name}/approve")
async def approve_suggested(
    canonical_name: str,
    body: ApproveRequest,
    _: None = Depends(require_permission(Permission.METRICS_GEO)),
    service: GeoService = Depends(_get_service),
) -> dict[str, str]:
    """Approve a suggested canonical by creating a canonical override."""
    await service.approve_suggested(canonical_name, body.category, body.year, body.city, body.state, body.country)
    return {"status": "approved"}


@router.post("/canonicals/{canonical_name}/reject")
async def reject_suggested(
    canonical_name: str,
    body: RejectRequest,
    _: None = Depends(require_permission(Permission.METRICS_GEO)),
    service: GeoService = Depends(_get_service),
) -> RejectResponse:
    """Reject a suggested canonical by dissolving its cluster."""
    count = await service.reject_suggested(canonical_name, body.category, body.year)
    return RejectResponse(dissolved_count=count)

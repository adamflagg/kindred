"""
Geo Router - Geographic data management endpoints.

This router provides endpoints for:
- Viewing gaps in geographic data (missing coordinates)
- Searching canonical entries with source metadata
- Inspecting raw value sources for a canonical name
- Managing geo overrides (CRUD)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from starlette.responses import Response

from bunking.auth_middleware import AuthUser, get_current_user

from ..dependencies import pb
from ..schemas.geo import (
    CanonicalSearchResponse,
    GapsResponse,
    OverrideCreate,
    OverrideResponse,
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
    category: str = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)"),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    user: AuthUser = Depends(get_current_user),
) -> GapsResponse:
    """Get three-tier gap classification for normalized values missing coordinates."""
    service = _get_service()
    types_list = session_types.split(",") if session_types else None
    return await service.get_gaps(category, year, active_only, types_list, session_cm_id)


# ============================================================================
# Canonical Search Endpoint
# ============================================================================


@router.get("/canonicals", response_model=CanonicalSearchResponse)
async def search_canonicals(
    category: str = Query(..., description="Category: city, school, or congregation"),
    q: str = Query("", description="Search query (case-insensitive substring match). Empty returns in-use entries."),
    year: int = Query(..., description="Year scope (e.g. 2025)"),
    in_use: bool = Query(False, description="If true, only return entries with camper_count > 0"),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    user: AuthUser = Depends(get_current_user),
) -> CanonicalSearchResponse:
    """Search canonical entries by name, city, or state."""
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
    )


# ============================================================================
# Source Inspection Endpoint
# ============================================================================


@router.get("/canonicals/{canonical_name}/sources", response_model=SourcesResponse)
async def get_sources(
    canonical_name: str,
    category: str = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)"),
    active_only: bool = Query(False, description="Filter to active enrolled attendees only"),
    session_types: str | None = Query(None, description="Comma-separated session types (e.g. main,embedded,ag)"),
    session_cm_id: int | None = Query(None, description="Specific session CampMinder ID"),
    user: AuthUser = Depends(get_current_user),
) -> SourcesResponse:
    """Get raw value variants that map to a canonical name."""
    service = _get_service()
    types_list = session_types.split(",") if session_types else None
    return await service.get_sources(
        category,
        canonical_name,
        year,
        active_only,
        types_list,
        session_cm_id,
    )


# ============================================================================
# Override CRUD Endpoints
# ============================================================================


@router.get("/overrides", response_model=list[OverrideResponse])
async def list_overrides(
    category: str = Query(..., description="Category: city, school, or congregation"),
    year: int = Query(..., description="Year scope (e.g. 2025)"),
    user: AuthUser = Depends(get_current_user),
) -> list[OverrideResponse]:
    """List all geo overrides for a category and year."""
    service = _get_service()
    return await service.list_overrides(category, year)


@router.post("/overrides", response_model=OverrideResponse, status_code=201)
async def create_override(
    data: OverrideCreate,
    user: AuthUser = Depends(get_current_user),
) -> OverrideResponse:
    """Create a new geo override."""
    service = _get_service()
    return await service.create_override(data)


@router.patch("/overrides/{override_id}", response_model=OverrideResponse)
async def update_override(
    override_id: str,
    data: dict[str, Any],
    user: AuthUser = Depends(get_current_user),
) -> OverrideResponse:
    """Update an existing geo override."""
    service = _get_service()
    return await service.update_override(override_id, data)


@router.delete("/overrides/{override_id}", status_code=204)
async def delete_override(
    override_id: str,
    user: AuthUser = Depends(get_current_user),
) -> Response:
    """Delete a geo override."""
    service = _get_service()
    await service.delete_override(override_id)
    return Response(status_code=204)

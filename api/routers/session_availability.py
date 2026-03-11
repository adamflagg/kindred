"""Session availability router — availability matrix endpoint."""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from bunking.auth_middleware import AuthUser, get_current_user

from ..dependencies import pb
from ..schemas.session_availability import SessionAvailabilityResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/session-availability", response_model=SessionAvailabilityResponse)
async def get_session_availability(
    year: int = Query(..., description="Year to get availability for"),
    session_types: str | None = Query(
        "main,embedded,ag,quest",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID. AG sessions with matching parent_id are included.",
    ),
    duration: Literal["1-week", "2-week", "3-week", "4-week+"] | None = Query(
        None, description="Filter by session duration category (1-week, 2-week, 3-week, 4-week+)"
    ),
    user: AuthUser = Depends(get_current_user),
) -> SessionAvailabilityResponse:
    """Get session availability matrix.

    Returns per-session, per-gender enrollment counts, capacity,
    and availability status (open/limited/waitlist).
    """
    if duration is not None and session_cm_id is not None:
        raise HTTPException(status_code=422, detail="duration and session_cm_id are mutually exclusive")

    from api.services.metrics_repository import MetricsRepository
    from api.services.session_availability_service import SessionAvailabilityService

    try:
        type_filter = session_types.split(",") if session_types else None
        repository = MetricsRepository(pb)
        service = SessionAvailabilityService(repository)
        return await service.calculate_availability(
            year=year,
            session_types=type_filter,
            session_cm_id=session_cm_id,
            duration=duration,
        )
    except Exception as e:
        logger.error(f"Error calculating session availability: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error calculating session availability: {e!s}",
        )

"""Session availability router — availability matrix endpoint."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from api.services.metrics_repository import MetricsRepository
from api.services.session_availability_service import SessionAvailabilityService
from api.utils.validators import check_duration_session_exclusive
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.logging_config import get_logger

from ..dependencies import pb
from ..schemas.session_availability import SessionAvailabilityResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/session-availability", response_model=SessionAvailabilityResponse)
async def get_session_availability(
    year: int = Query(..., description="Year to get availability for", ge=2000, le=2100),
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
    check_duration_session_exclusive(duration, session_cm_id)

    type_filter = session_types.split(",") if session_types else None
    repository = MetricsRepository(pb)
    service = SessionAvailabilityService(repository)
    return await service.calculate_availability(
        year=year,
        session_types=type_filter,
        session_cm_id=session_cm_id,
        duration=duration,
    )

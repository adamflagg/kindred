"""Session availability router — availability matrix endpoint."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import pb
from ..schemas.session_availability import SessionAvailabilityResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/session-availability", response_model=SessionAvailabilityResponse)
async def get_session_availability(
    year: int = Query(..., description="Year to get availability for"),
) -> SessionAvailabilityResponse:
    """Get session availability matrix.

    Returns per-session, per-gender enrollment counts, capacity,
    and availability status (open/limited/waitlist).
    """
    from api.services.metrics_repository import MetricsRepository
    from api.services.session_availability_service import SessionAvailabilityService

    try:
        repository = MetricsRepository(pb)
        service = SessionAvailabilityService(repository)
        return await service.calculate_availability(year=year)
    except Exception as e:
        logger.error(f"Error calculating session availability: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error calculating session availability: {str(e)}",
        )

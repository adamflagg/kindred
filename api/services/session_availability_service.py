"""Session availability service — stub for TDD."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

from api.schemas.session_availability import SessionAvailabilityResponse


class SessionAvailabilityService:
    """Computes session availability matrix from enrollment/capacity data."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    def compute_status(
        self,
        enrolled: int,
        waitlisted: int,
        capacity: int | None,
        threshold_pct: int,
    ) -> str:
        """Compute availability status."""
        raise NotImplementedError

    async def calculate_availability(
        self,
        year: int,
    ) -> SessionAvailabilityResponse:
        """Calculate session availability matrix."""
        raise NotImplementedError

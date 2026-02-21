"""Forecast service - calculates per-session enrollment vs budget goals.

Stub for TDD: tests are written first, implementation follows.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository


class ForecastService:
    """Compute session enrollment forecasts with budget and revenue projections."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repo = repository

    async def calculate_forecast(
        self,
        year: int = 2026,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ):
        raise NotImplementedError("Implementation pending - TDD stub")

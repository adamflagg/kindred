"""Historical service - business logic for historical trends metrics.

This service moves business logic out of the historical endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    FirstYearBreakdown,
    GenderBreakdown,
    HistoricalTrendsResponse,
    NewVsReturning,
    YearMetrics,
)

from .breakdown_calculator import calculate_percentage

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


class HistoricalService:
    """Business logic for historical trends - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def calculate_historical_trends(
        self,
        years: list[int] | None = None,
        session_types: list[str] | None = None,
    ) -> HistoricalTrendsResponse:
        """Calculate historical trends across multiple years.

        Args:
            years: List of years to analyze. Default: last 5 years from 2025.
            session_types: Optional list of session types to filter.

        Returns:
            HistoricalTrendsResponse with trend data.
        """
        # Default years if not provided
        if years is None:
            current_year = 2025
            years = list(range(current_year - 4, current_year + 1))

        # Fetch camper history for all years in parallel
        history_futures = [self.repo.fetch_camper_history(y, session_types=session_types) for y in years]
        all_history = await asyncio.gather(*history_futures)

        # Compute metrics for each year
        year_metrics_list: list[YearMetrics] = []

        for year, history in zip(years, all_history, strict=True):
            year_metric = self._compute_year_metrics(year, history)
            year_metrics_list.append(year_metric)

        return HistoricalTrendsResponse(years=year_metrics_list)

    def _compute_year_metrics(self, year: int, history: list[Any]) -> YearMetrics:
        """Compute metrics for a single year.

        Args:
            year: The year.
            history: List of camper_history records.

        Returns:
            YearMetrics with all breakdowns.
        """
        total_enrolled = len(history)

        # Gender breakdown
        gender_counts: dict[str, int] = {}
        for record in history:
            gender = getattr(record, "gender", "Unknown") or "Unknown"
            gender_counts[gender] = gender_counts.get(gender, 0) + 1

        by_gender = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for g, c in sorted(gender_counts.items())
        ]

        # New vs returning
        new_count = sum(1 for record in history if getattr(record, "years_at_camp", 0) == 1)
        returning_count = total_enrolled - new_count

        new_vs_returning = NewVsReturning(
            new_count=new_count,
            returning_count=returning_count,
            new_percentage=calculate_percentage(new_count, total_enrolled),
            returning_percentage=calculate_percentage(returning_count, total_enrolled),
        )

        # First year breakdown
        first_year_counts: dict[int, int] = {}
        for record in history:
            first_year = getattr(record, "first_year_attended", None)
            if first_year:
                first_year_counts[first_year] = first_year_counts.get(first_year, 0) + 1

        by_first_year = [
            FirstYearBreakdown(
                first_year=fy,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for fy, c in sorted(first_year_counts.items())
        ]

        return YearMetrics(
            year=year,
            total_enrolled=total_enrolled,
            by_gender=by_gender,
            new_vs_returning=new_vs_returning,
            by_first_year=by_first_year,
        )

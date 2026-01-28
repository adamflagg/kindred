"""Comparison service - business logic for year-over-year comparison metrics.

This service moves business logic out of the comparison endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    ComparisonDelta,
    ComparisonMetricsResponse,
    GenderBreakdown,
    GradeBreakdown,
    YearSummary,
)

from .breakdown_calculator import calculate_percentage

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


class ComparisonService:
    """Business logic for year-over-year comparison - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def calculate_comparison(
        self,
        year_a: int,
        year_b: int,
        session_types: list[str] | None = None,
    ) -> ComparisonMetricsResponse:
        """Calculate year-over-year comparison metrics.

        Args:
            year_a: First year to compare.
            year_b: Second year to compare.
            session_types: Optional list of session types to filter.

        Returns:
            ComparisonMetricsResponse with comparison data.
        """
        # Fetch data for both years in parallel
        (
            attendees_a,
            attendees_b,
            persons_a,
            persons_b,
        ) = await asyncio.gather(
            self.repo.fetch_attendees(year_a),
            self.repo.fetch_attendees(year_b),
            self.repo.fetch_persons(year_a),
            self.repo.fetch_persons(year_b),
        )

        # Filter by session type if specified
        if session_types:
            attendees_a = self._filter_by_session_type(attendees_a, session_types)
            attendees_b = self._filter_by_session_type(attendees_b, session_types)

        # Get unique person IDs
        person_ids_a = {getattr(a, "person_id", None) for a in attendees_a if getattr(a, "person_id", None)}
        person_ids_b = {getattr(a, "person_id", None) for a in attendees_b if getattr(a, "person_id", None)}

        total_a = len(person_ids_a)
        total_b = len(person_ids_b)

        # Compute year summaries
        year_a_summary = self._compute_year_summary(year_a, person_ids_a, persons_a)
        year_b_summary = self._compute_year_summary(year_b, person_ids_b, persons_b)

        # Calculate delta
        total_change = total_b - total_a
        percentage_change = calculate_percentage(total_change, total_a) if total_a > 0 else 0.0

        return ComparisonMetricsResponse(
            year_a=year_a_summary,
            year_b=year_b_summary,
            delta=ComparisonDelta(
                total_change=total_change,
                percentage_change=percentage_change,
            ),
        )

    def _filter_by_session_type(
        self,
        attendees: list[Any],
        session_types: list[str],
    ) -> list[Any]:
        """Filter attendees by session type.

        Args:
            attendees: List of attendees.
            session_types: Session types to include.

        Returns:
            Filtered list of attendees.
        """
        filtered = []
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            session_type = getattr(session, "session_type", None) if session else None
            if session_type in session_types:
                filtered.append(a)
        return filtered

    def _compute_year_summary(
        self,
        year: int,
        person_ids: set[Any],
        persons: dict[int, Any],
    ) -> YearSummary:
        """Compute summary for a single year.

        Args:
            year: The year.
            person_ids: Set of person IDs.
            persons: Person lookup dictionary.

        Returns:
            YearSummary with breakdowns.
        """
        total = len(person_ids)

        # Gender breakdown
        gender_counts: dict[str, int] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            gender_counts[gender] = gender_counts.get(gender, 0) + 1

        by_gender = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for g, c in sorted(gender_counts.items())
        ]

        # Grade breakdown
        grade_counts: dict[int | None, int] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            grade_counts[grade] = grade_counts.get(grade, 0) + 1

        by_grade = [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for g, c in sorted(grade_counts.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        return YearSummary(
            year=year,
            total=total,
            by_gender=by_gender,
            by_grade=by_grade,
        )

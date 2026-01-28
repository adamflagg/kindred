"""Retention trends service - business logic for retention trends metrics.

This service moves business logic out of the retention-trends endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    GenderEnrollment,
    GradeEnrollment,
    RetentionByGender,
    RetentionByGrade,
    RetentionTrendsResponse,
    RetentionTrendYear,
    YearEnrollment,
)

from .breakdown_calculator import safe_rate

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


class RetentionTrendsService:
    """Business logic for retention trends - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def calculate_retention_trends(
        self,
        current_year: int,
        num_years: int = 3,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> RetentionTrendsResponse:
        """Calculate retention trends across multiple year transitions.

        Args:
            current_year: The current/most recent year.
            num_years: Number of years to include (default: 3).
            session_types: Optional list of session types to filter.
            session_cm_id: Optional specific session ID to filter.

        Returns:
            RetentionTrendsResponse with trend data.
        """
        # Build list of years to analyze
        years = list(range(current_year - num_years + 1, current_year + 1))

        # Fetch data for all years in parallel
        data_by_year = await self._fetch_all_years_data(years, session_types)

        # Apply filters to attendees
        for year in years:
            year_data = data_by_year[year]
            attendees = year_data["attendees"]

            # Filter by session type
            if session_types:
                attendees = self._filter_by_session_type(attendees, session_types)

            # Filter by specific session ID
            if session_cm_id is not None:
                attendees = self._filter_by_session_cm_id(attendees, session_cm_id)

            # Update attendees and compute person_ids
            year_data["attendees"] = attendees
            year_data["person_ids"] = {
                int(getattr(a, "person_id", 0))
                for a in attendees
                if getattr(a, "person_id", None)
            }

        # Calculate retention for each year transition
        retention_years = self._calculate_retention_transitions(years, data_by_year)

        # Calculate average retention rate
        rates = [y.retention_rate for y in retention_years]
        avg_rate = sum(rates) / len(rates) if rates else 0.0

        # Determine trend direction
        trend_direction = self._calculate_trend_direction(rates)

        # Compute enrollment_by_year
        enrollment_by_year = self._compute_enrollment_by_year(years, data_by_year)

        return RetentionTrendsResponse(
            years=retention_years,
            avg_retention_rate=avg_rate,
            trend_direction=trend_direction,
            enrollment_by_year=enrollment_by_year,
        )

    async def _fetch_all_years_data(
        self,
        years: list[int],
        session_types: list[str] | None,
    ) -> dict[int, dict[str, Any]]:
        """Fetch all data for the specified years.

        Args:
            years: List of years to fetch data for.
            session_types: Optional session types filter.

        Returns:
            Dictionary mapping year to data (attendees, persons, sessions).
        """
        # Build fetch tasks for all years
        fetch_tasks: list[Any] = []
        for year in years:
            fetch_tasks.append(self.repo.fetch_attendees(year))
            fetch_tasks.append(self.repo.fetch_persons(year))
            fetch_tasks.append(self.repo.fetch_sessions(year, session_types))

        results = await asyncio.gather(*fetch_tasks)

        # Unpack results
        data_by_year: dict[int, dict[str, Any]] = {}
        for i, year in enumerate(years):
            attendees: list[Any] = results[i * 3]
            persons: dict[int, Any] = results[i * 3 + 1]
            sessions: dict[int, Any] = results[i * 3 + 2]

            data_by_year[year] = {
                "attendees": attendees,
                "persons": persons,
                "sessions": sessions,
                "person_ids": set(),  # Will be populated after filtering
            }

        return data_by_year

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
            session = (
                expand.get("session")
                if isinstance(expand, dict)
                else getattr(expand, "session", None)
            )
            if session and getattr(session, "session_type", None) in session_types:
                filtered.append(a)
        return filtered

    def _filter_by_session_cm_id(
        self,
        attendees: list[Any],
        session_cm_id: int,
    ) -> list[Any]:
        """Filter attendees by specific session cm_id.

        Args:
            attendees: List of attendees.
            session_cm_id: Session cm_id to filter by.

        Returns:
            Filtered list of attendees.
        """
        filtered = []
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = (
                expand.get("session")
                if isinstance(expand, dict)
                else getattr(expand, "session", None)
            )
            if session and getattr(session, "cm_id", None) == session_cm_id:
                filtered.append(a)
        return filtered

    def _calculate_retention_transitions(
        self,
        years: list[int],
        data_by_year: dict[int, dict[str, Any]],
    ) -> list[RetentionTrendYear]:
        """Calculate retention for each year transition.

        Args:
            years: List of years.
            data_by_year: Data for each year.

        Returns:
            List of RetentionTrendYear objects.
        """
        retention_years: list[RetentionTrendYear] = []

        for i in range(len(years) - 1):
            base_year = years[i]
            compare_year = years[i + 1]

            base_data = data_by_year[base_year]
            compare_data = data_by_year[compare_year]

            base_person_ids = base_data["person_ids"]
            compare_person_ids = compare_data["person_ids"]
            persons_base = base_data["persons"]

            returned_ids = base_person_ids & compare_person_ids
            base_count = len(base_person_ids)
            returned_count = len(returned_ids)
            retention_rate = safe_rate(returned_count, base_count)

            # Compute breakdowns
            by_gender = self._compute_gender_breakdown(
                base_person_ids, returned_ids, persons_base
            )
            by_grade = self._compute_grade_breakdown(
                base_person_ids, returned_ids, persons_base
            )

            retention_years.append(
                RetentionTrendYear(
                    from_year=base_year,
                    to_year=compare_year,
                    retention_rate=retention_rate,
                    base_count=base_count,
                    returned_count=returned_count,
                    by_gender=by_gender,
                    by_grade=by_grade,
                )
            )

        return retention_years

    def _compute_gender_breakdown(
        self,
        base_person_ids: set[int],
        returned_ids: set[int],
        persons: dict[int, Any],
    ) -> list[RetentionByGender]:
        """Compute gender breakdown for retention.

        Args:
            base_person_ids: Person IDs in base year.
            returned_ids: Person IDs who returned.
            persons: Person lookup dictionary.

        Returns:
            List of RetentionByGender objects.
        """
        gender_stats: dict[str, dict[str, int]] = {}

        for pid in base_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            if gender not in gender_stats:
                gender_stats[gender] = {"base": 0, "returned": 0}
            gender_stats[gender]["base"] += 1
            if pid in returned_ids:
                gender_stats[gender]["returned"] += 1

        return [
            RetentionByGender(
                gender=g,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for g, stats in sorted(gender_stats.items())
        ]

    def _compute_grade_breakdown(
        self,
        base_person_ids: set[int],
        returned_ids: set[int],
        persons: dict[int, Any],
    ) -> list[RetentionByGrade]:
        """Compute grade breakdown for retention.

        Args:
            base_person_ids: Person IDs in base year.
            returned_ids: Person IDs who returned.
            persons: Person lookup dictionary.

        Returns:
            List of RetentionByGrade objects.
        """
        grade_stats: dict[int | None, dict[str, int]] = {}

        for pid in base_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            if grade not in grade_stats:
                grade_stats[grade] = {"base": 0, "returned": 0}
            grade_stats[grade]["base"] += 1
            if pid in returned_ids:
                grade_stats[grade]["returned"] += 1

        return [
            RetentionByGrade(
                grade=g,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for g, stats in sorted(
                grade_stats.items(), key=lambda x: (x[0] is None, x[0])
            )
        ]

    def _calculate_trend_direction(self, rates: list[float]) -> str:
        """Calculate trend direction from retention rates.

        Args:
            rates: List of retention rates per transition.

        Returns:
            Trend direction: 'improving', 'declining', or 'stable'.
        """
        if len(rates) < 2:
            return "stable"

        # Compare most recent rate to average of prior rates
        current = rates[-1]
        prior_avg = sum(rates[:-1]) / len(rates[:-1])
        threshold = 0.02  # 2% threshold for "stable"

        if current > prior_avg + threshold:
            return "improving"
        elif current < prior_avg - threshold:
            return "declining"
        else:
            return "stable"

    def _compute_enrollment_by_year(
        self,
        years: list[int],
        data_by_year: dict[int, dict[str, Any]],
    ) -> list[YearEnrollment]:
        """Compute enrollment data for each year.

        Args:
            years: List of years.
            data_by_year: Data for each year.

        Returns:
            List of YearEnrollment objects.
        """
        enrollment_by_year: list[YearEnrollment] = []

        for year in years:
            year_data = data_by_year[year]
            person_ids = year_data["person_ids"]
            persons = year_data["persons"]
            total = len(person_ids)

            # Gender breakdown
            gender_counts: dict[str, int] = {}
            for pid in person_ids:
                person = persons.get(pid)
                if not person:
                    continue
                gender = getattr(person, "gender", "Unknown") or "Unknown"
                gender_counts[gender] = gender_counts.get(gender, 0) + 1

            gender_breakdown = [
                GenderEnrollment(gender=g, count=c)
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

            grade_breakdown = [
                GradeEnrollment(grade=g, count=c)
                for g, c in sorted(
                    grade_counts.items(), key=lambda x: (x[0] is None, x[0])
                )
            ]

            enrollment_by_year.append(
                YearEnrollment(
                    year=year,
                    total=total,
                    by_gender=gender_breakdown,
                    by_grade=grade_breakdown,
                )
            )

        return enrollment_by_year

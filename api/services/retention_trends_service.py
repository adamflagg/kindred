"""Retention trends service - business logic for retention trends metrics.

This service moves business logic out of the retention-trends endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    CityEnrollment,
    FirstSummerYearEnrollment,
    GenderEnrollment,
    GradeEnrollment,
    RetentionByGender,
    RetentionByGrade,
    RetentionTrendsResponse,
    RetentionTrendYear,
    SchoolEnrollment,
    SummerYearsEnrollment,
    SynagogueEnrollment,
    YearEnrollment,
)
from api.utils.session_metrics import (
    SUMMER_TEEN_TYPES,
    compute_summer_metrics,
    filter_attendees_by_session,
    find_ag_sessions_for_parent,
    resolve_cohort_session_ids,
    resolve_duration_sessions,
)

from .breakdown_calculator import compute_breakdown, compute_registration_breakdown, safe_rate
from .extractors import (
    exclude_aged_out_persons,
    extract_city,
    extract_gender,
    extract_grade,
    extract_school,
    extract_synagogue,
)

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
        duration: str | None = None,
        include_teen_pipeline: bool = False,
    ) -> RetentionTrendsResponse:
        """Calculate retention trends across multiple year transitions.

        Args:
            current_year: The current/most recent year.
            num_years: Number of year-to-year transitions to include (default: 3).
            session_types: Optional list of session types to filter.
            session_cm_id: Optional specific session ID to filter.
            duration: Optional duration category (e.g., "1-week", "2-week") to filter
                sessions by length.
            include_teen_pipeline: When True, credit the grade-10 -> teen-program
                bridge (so grade-10 campers are kept in the base pool).  Only
                meaningful when the selected scope includes teen sessions; in a
                non-teen scope the flag is inert.

        Returns:
            RetentionTrendsResponse with trend data.
        """
        # Build list of years to analyze
        years = list(range(current_year - num_years, current_year + 1))

        # Determine whether the selected scope includes teen sessions so we know
        # whether include_teen_pipeline is meaningful (mirrors retention_service).
        scope_has_teens = session_types is None or any(t in SUMMER_TEEN_TYPES for t in session_types)
        effective_pipeline = include_teen_pipeline and scope_has_teens

        # Fetch data for all years in parallel
        data_by_year = await self._fetch_all_years_data(years)

        # Apply filters to attendees using cohort-id gating.
        # resolve_cohort_session_ids handles type membership AND the summer-window
        # gate for teen types (scit/tli), so off-season teen sessions are excluded.
        for year in years:
            year_data = data_by_year[year]
            attendees = year_data["attendees"]
            sessions = year_data["sessions"]

            # Resolve the cohort session IDs (summer-window-gated for teen types).
            cohort_ids = resolve_cohort_session_ids(sessions, session_types)

            # Further restrict to a specific session if requested, keeping the
            # session's AG children (separate cm_ids) so their campers aren't dropped.
            if session_cm_id is not None:
                selected_ids = {session_cm_id, *find_ag_sessions_for_parent(sessions, session_cm_id)}
                cohort_ids &= selected_ids

            # Intersect with duration filter when present.
            if duration:
                duration_session_ids = resolve_duration_sessions(sessions, duration)
                cohort_ids = cohort_ids & duration_session_ids

            attendees = filter_attendees_by_session(attendees, None, session_cm_ids=cohort_ids)

            # Update attendees and compute person_ids
            year_data["attendees"] = attendees
            year_data["person_ids"] = {
                int(getattr(a, "person_id", 0)) for a in attendees if getattr(a, "person_id", None)
            }

        # Calculate retention for each year transition
        retention_years = self._calculate_retention_transitions(
            years, data_by_year, effective_pipeline=effective_pipeline, scope_has_teens=scope_has_teens
        )

        # Calculate average retention rate
        rates = [y.retention_rate for y in retention_years]
        avg_rate = sum(rates) / len(rates) if rates else 0.0

        # Determine trend direction
        trend_direction = self._calculate_trend_direction(rates)

        # Fetch enrollment history for summer metrics (union of all person IDs)
        all_person_ids: set[int] = set()
        for year in years:
            all_person_ids |= data_by_year[year]["person_ids"]

        enrollment_history = await self.repo.fetch_summer_enrollment_history(all_person_ids, max_year=current_year)

        # Compute enrollment_by_year
        enrollment_by_year = self._compute_enrollment_by_year(years, data_by_year, enrollment_history)

        return RetentionTrendsResponse(
            years=retention_years,
            avg_retention_rate=avg_rate,
            trend_direction=trend_direction,
            enrollment_by_year=enrollment_by_year,
        )

    async def _fetch_all_years_data(
        self,
        years: list[int],
    ) -> dict[int, dict[str, Any]]:
        """Fetch all data for the specified years.

        Args:
            years: List of years to fetch data for.

        Returns:
            Dictionary mapping year to data (attendees, persons, sessions).
        """
        # Build fetch tasks for all years.
        # Always fetch ALL sessions (None = no type filter) so that
        # resolve_cohort_session_ids can derive the summer window from main
        # sessions even in a teen-only scope.  Type filtering is done later
        # via resolve_cohort_session_ids(sessions, session_types).
        fetch_tasks: list[Any] = []
        for year in years:
            fetch_tasks.append(self.repo.fetch_attendees(year))
            fetch_tasks.append(self.repo.fetch_persons(year))
            fetch_tasks.append(self.repo.fetch_sessions(year, None))

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

    def _calculate_retention_transitions(
        self,
        years: list[int],
        data_by_year: dict[int, dict[str, Any]],
        effective_pipeline: bool = False,
        scope_has_teens: bool = False,
    ) -> list[RetentionTrendYear]:
        """Calculate retention for each year transition.

        Args:
            years: List of years.
            data_by_year: Data for each year.
            effective_pipeline: Whether grade-10 -> teen bridge is credited for
                the headline base_count and returned_count.
            scope_has_teens: Whether the selected scope includes teen sessions.
                When True, by_grade always includes a grade-10 row (carve-out)
                even when effective_pipeline=False, so staff can see the
                pipeline even with the toggle off.

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

            # Exclude aged-out persons from retention base (not from enrollment).
            # Capture the pre-aged-out set for the grade carve-out (Task 3).
            pre_aged_out_base_ids = set(base_person_ids)
            pre_filter_count = len(base_person_ids)
            base_person_ids = exclude_aged_out_persons(base_person_ids, persons_base, effective_pipeline)
            aged_out_count = pre_filter_count - len(base_person_ids)

            returned_ids = base_person_ids & compare_person_ids
            base_count = len(base_person_ids)
            returned_count = len(returned_ids)
            retention_rate = safe_rate(returned_count, base_count)

            # by_grade carve-out: when the scope includes teen sessions, always show
            # grade-10 in the breakdown regardless of the headline flag, so staff can
            # see how many grade-10 campers are in the pipeline (mirrors retention_service).
            if scope_has_teens:
                base_for_grade = exclude_aged_out_persons(
                    pre_aged_out_base_ids, persons_base, include_teen_pipeline=True
                )
            else:
                base_for_grade = base_person_ids
            returned_for_grade = base_for_grade & compare_person_ids

            # Compute breakdowns
            by_gender = self._compute_gender_breakdown(base_person_ids, returned_ids, persons_base)
            by_grade = self._compute_grade_breakdown(base_for_grade, returned_for_grade, persons_base)

            retention_years.append(
                RetentionTrendYear(
                    from_year=base_year,
                    to_year=compare_year,
                    retention_rate=retention_rate,
                    base_count=base_count,
                    returned_count=returned_count,
                    by_gender=by_gender,
                    by_grade=by_grade,
                    aged_out_count=aged_out_count,
                )
            )

        return retention_years

    def _compute_gender_breakdown(
        self,
        base_person_ids: set[int],
        returned_ids: set[int],
        persons: dict[int, Any],
    ) -> list[RetentionByGender]:
        """Compute gender breakdown for retention."""
        stats = compute_breakdown(base_person_ids, returned_ids, persons, extract_gender)
        return [
            RetentionByGender(
                gender=g, base_count=s.base_count, returned_count=s.returned_count, retention_rate=s.retention_rate
            )
            for g, s in sorted(stats.items())
        ]

    def _compute_grade_breakdown(
        self,
        base_person_ids: set[int],
        returned_ids: set[int],
        persons: dict[int, Any],
    ) -> list[RetentionByGrade]:
        """Compute grade breakdown for retention."""
        stats = compute_breakdown(base_person_ids, returned_ids, persons, extract_grade)
        return [
            RetentionByGrade(
                grade=g, base_count=s.base_count, returned_count=s.returned_count, retention_rate=s.retention_rate
            )
            for g, s in sorted(stats.items(), key=lambda x: (x[0] is None, x[0]))
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
        enrollment_history: list[Any] | None = None,
    ) -> list[YearEnrollment]:
        """Compute enrollment data for each year.

        Args:
            years: List of years.
            data_by_year: Data for each year.
            enrollment_history: Optional enrollment history for summer metrics.

        Returns:
            List of YearEnrollment objects.
        """
        enrollment_by_year: list[YearEnrollment] = []

        for year in years:
            year_data = data_by_year[year]
            person_ids = year_data["person_ids"]
            persons = year_data["persons"]
            # Only count persons that exist in both attendees and persons tables
            # (attendees from excluded programs like family camps may lack person records)
            person_ids = person_ids & persons.keys()
            total = len(person_ids)

            # Demographic breakdowns using generic calculator
            gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender)
            gender_breakdown = [GenderEnrollment(gender=g, count=s.count) for g, s in sorted(gender_stats.items())]

            grade_stats = compute_registration_breakdown(person_ids, persons, extract_grade)
            grade_breakdown = [
                GradeEnrollment(grade=g, count=s.count)
                for g, s in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
            ]

            city_stats = compute_registration_breakdown(person_ids, persons, extract_city)
            city_breakdown = [
                CityEnrollment(city=c, count=s.count)
                for c, s in sorted(((k, v) for k, v in city_stats.items() if k), key=lambda x: -x[1].count)
            ]

            school_stats = compute_registration_breakdown(person_ids, persons, extract_school)
            school_breakdown = [
                SchoolEnrollment(school=s, count=st.count)
                for s, st in sorted(((k, v) for k, v in school_stats.items() if k), key=lambda x: -x[1].count)
            ]

            synagogue_stats = compute_registration_breakdown(person_ids, persons, extract_synagogue)
            synagogue_breakdown = [
                SynagogueEnrollment(synagogue=s, count=st.count)
                for s, st in sorted(((k, v) for k, v in synagogue_stats.items() if k), key=lambda x: -x[1].count)
            ]

            # Summer years + first summer year (from enrollment history)
            summer_years_breakdown: list[SummerYearsEnrollment] = []
            first_summer_year_breakdown: list[FirstSummerYearEnrollment] = []

            if enrollment_history:
                # Filter history to records up to this year for scoping
                history_up_to_year = [r for r in enrollment_history if getattr(r, "year", 0) <= year]
                summer_years_by_person, first_year_by_person = compute_summer_metrics(history_up_to_year, person_ids)

                # Aggregate summer years
                sy_counts: dict[int, int] = {}
                for pid in person_ids:
                    sy = summer_years_by_person.get(pid, 0)
                    if sy > 0:
                        sy_counts[sy] = sy_counts.get(sy, 0) + 1

                summer_years_breakdown = [
                    SummerYearsEnrollment(summer_years=sy, count=c) for sy, c in sorted(sy_counts.items())
                ]

                # Aggregate first summer year
                fsy_counts: dict[int, int] = {}
                for pid in person_ids:
                    fsy = first_year_by_person.get(pid)
                    if fsy is not None:
                        fsy_counts[fsy] = fsy_counts.get(fsy, 0) + 1

                first_summer_year_breakdown = [
                    FirstSummerYearEnrollment(first_summer_year=y, count=c) for y, c in sorted(fsy_counts.items())
                ]

            enrollment_by_year.append(
                YearEnrollment(
                    year=year,
                    total=total,
                    by_gender=gender_breakdown,
                    by_grade=grade_breakdown,
                    by_city=city_breakdown,
                    by_school=school_breakdown,
                    by_synagogue=synagogue_breakdown,
                    by_summer_years=summer_years_breakdown,
                    by_first_summer_year=first_summer_year_breakdown,
                )
            )

        return enrollment_by_year

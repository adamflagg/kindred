"""Retention trends service - business logic for retention trends metrics.

This service moves business logic out of the retention-trends endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import date, timedelta
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
    compute_first_summer_years,
    fetch_summer_windows,
    filter_attendees_by_session,
    resolve_scope_ids,
)
from bunking.gender_identity import NOT_GIVEN, identity_sort_key
from bunking.logging_config import get_logger

from .breakdown_calculator import compute_breakdown, compute_registration_breakdown, safe_rate
from .camp_calendar import get_camp_today
from .extractors import (
    count_binary_fallbacks,
    exclude_aged_out_persons,
    extract_city,
    extract_gender_identity,
    extract_grade,
    extract_school,
    extract_synagogue,
    summers_at_camp_by_person,
)
from .reconstruction import attendees_at_cutoff
from .same_point import live_same_point, registration_anchor

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = get_logger(__name__)


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
        same_point: bool = False,
        today: date | None = None,
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
            same_point: While ``current_year`` is live, give each transition its retention at the
                registration day that season has reached, counted in its own season (decision 7,
                #3207 PR 11 ruling #89). The response's ``prior_basis`` says whether it was live.
            today: Override for the camp today (tests). Only the same-point series uses it.

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

        # The picked session's name, from the newest year that has its cm_id, so a
        # renamed session is found in earlier years (#3208 row 9).
        reference_name: str | None = None
        if session_cm_id is not None:
            for year in reversed(years):
                picked = data_by_year[year]["sessions"].get(session_cm_id)
                if picked is not None:
                    reference_name = getattr(picked, "name", None)
                    break

        # Scope each year through the one session resolver: type membership, the
        # teen summer window, duration, and the picked session (matched by id, alias
        # or name, with its AG cabins).
        for year in years:
            year_data = data_by_year[year]
            attendees = year_data["attendees"]
            sessions = year_data["sessions"]

            cohort_ids = resolve_scope_ids(sessions, session_types, session_cm_id, duration, reference_name)
            year_data["cohort_ids"] = cohort_ids

            attendees = filter_attendees_by_session(attendees, None, session_cm_ids=cohort_ids)

            # Update attendees and compute person_ids
            year_data["attendees"] = attendees
            year_data["person_ids"] = {
                int(getattr(a, "person_id", 0)) for a in attendees if getattr(a, "person_id", None)
            }

        # Calculate retention for each year transition
        retention_years = self._calculate_retention_transitions(
            years,
            data_by_year,
            effective_pipeline=effective_pipeline,
            scope_has_teens=scope_has_teens,
            camp_year=(today if today is not None else get_camp_today()).year,
        )

        same_point_fields = await self._apply_same_point(years, data_by_year, retention_years, same_point, today)

        # Fetch enrollment history for summer metrics (union of all person IDs)
        all_person_ids: set[int] = set()
        for year in years:
            all_person_ids |= data_by_year[year]["person_ids"]

        enrollment_history = await self.repo.fetch_summer_enrollment_history(all_person_ids, max_year=current_year)

        # Compute enrollment_by_year
        history_years = {int(y) for r in enrollment_history if (y := getattr(r, "year", None))}
        summer_windows = await fetch_summer_windows(self.repo, history_years)
        enrollment_by_year = self._compute_enrollment_by_year(years, data_by_year, enrollment_history, summer_windows)

        return RetentionTrendsResponse(
            years=retention_years,
            enrollment_by_year=enrollment_by_year,
            **same_point_fields,
        )

    async def _apply_same_point(
        self,
        years: list[int],
        data_by_year: dict[int, dict[str, Any]],
        retention_years: list[RetentionTrendYear],
        same_point: bool,
        today: date | None,
    ) -> dict[str, Any]:
        """Set each transition's same_point_rate while the newest season is live (ruling #89).

        Every earlier transition is read at the same registration day of its own season: the base
        year's campers registered for to_year by then and not cancelled by then (decision 7, the rule
        Overview and Retention use). The live transition's own point is today's count. Returns the
        response's basis fields.
        """
        if not same_point:
            return {}
        live_year = years[-1]
        point = await live_same_point(self.repo, live_year, today)
        if point is None:
            return {"prior_basis": "final"}

        to_years = [t.to_year for t in retention_years]
        anchors = dict(zip(to_years, await asyncio.gather(*(self._fetch_anchor(y) for y in to_years)), strict=True))
        read_years = [y for y in to_years if y != live_year and anchors[y] is not None]
        dated_by_year = dict(
            zip(
                read_years,
                await asyncio.gather(*(self.repo.fetch_attendees_with_dates(y) for y in read_years)),
                strict=True,
            )
        )
        as_of_date: str | None = None
        for transition in retention_years:
            anchor = anchors[transition.to_year]
            if transition.to_year == live_year:
                transition.same_point_rate = transition.retention_rate
                if anchor is not None:
                    transition.same_point_as_of = (anchor + timedelta(days=point.day_offset)).isoformat()
                continue
            if anchor is None or transition.retention_rate is None:
                continue
            cutoff = anchor + timedelta(days=point.prior_offset)
            enrolled, _left = attendees_at_cutoff(list(dated_by_year[transition.to_year]), cutoff)
            scoped = filter_attendees_by_session(
                enrolled, None, session_cm_ids=data_by_year[transition.to_year]["cohort_ids"]
            )
            returned_by_then = {int(getattr(a, "person_id", 0)) for a in scoped if getattr(a, "person_id", None)}
            base_ids = data_by_year[transition.from_year]["retention_base_ids"]
            transition.same_point_rate = safe_rate(len(base_ids & returned_by_then), len(base_ids))
            transition.same_point_as_of = cutoff.isoformat()
            if transition.to_year == live_year - 1:
                as_of_date = transition.same_point_as_of

        return {
            "prior_basis": "same_point",
            "day_offset": point.day_offset,
            "prior_day_offset": point.prior_offset,
            "as_of_date": as_of_date,
        }

    async def _fetch_anchor(self, year: int) -> date | None:
        """A season's registration anchor; None when unset or unreadable."""
        try:
            return registration_anchor(await self.repo.fetch_registration_dates(year))
        except Exception:
            logger.warning("Failed to read the %d registration dates", year, exc_info=True)
            return None

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
        # resolve_scope_ids can derive the summer window from main
        # sessions even in a teen-only scope.  Type filtering is done later
        # via resolve_scope_ids(sessions, session_types, ...).
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
        camp_year: int | None = None,
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
            camp_year: The camp calendar's current year. A season from it on with nobody enrolled has
                not happened yet, so its 0 is "so far"; an earlier one with nobody did not run.

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
            # The headline base, kept for the same-point series (the same campers, read at an earlier day)
            base_data["retention_base_ids"] = base_person_ids

            returned_ids = base_person_ids & compare_person_ids
            base_count = len(base_person_ids)
            returned_count = len(returned_ids)
            # PM-4 A (owner, 2026-10-25): never a substituted 0. With no base there is nothing to retain, and a
            # past season nobody attended (2020) has no retention into it. A season still to come reads 0 so far.
            not_run = not compare_person_ids and (camp_year is None or compare_year < camp_year)
            no_rate = base_count == 0 or not_run
            retention_rate = None if no_rate else safe_rate(returned_count, base_count)

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
                    gender_fallback_count=count_binary_fallbacks(base_person_ids, persons_base),
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
        stats = compute_breakdown(base_person_ids, returned_ids, persons, extract_gender_identity, missing=NOT_GIVEN)
        return [
            RetentionByGender(
                gender=g, base_count=s.base_count, returned_count=s.returned_count, retention_rate=s.retention_rate
            )
            for g, s in sorted(stats.items(), key=lambda x: identity_sort_key(x[0]))
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

    def _compute_enrollment_by_year(
        self,
        years: list[int],
        data_by_year: dict[int, dict[str, Any]],
        enrollment_history: list[Any] | None = None,
        summer_windows: dict[int, tuple[str, str] | None] | None = None,
    ) -> list[YearEnrollment]:
        """Compute enrollment data for each year.

        Args:
            years: List of years.
            data_by_year: Data for each year.
            enrollment_history: Optional enrollment history, for First Summer Year.
            summer_windows: Each history year's summer window, so a teen-only
                history still has the window for its teen-only years.

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
            gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender_identity)
            gender_breakdown = [
                GenderEnrollment(gender=g, count=s.count)
                for g, s in sorted(gender_stats.items(), key=lambda x: identity_sort_key(x[0]))
            ]

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

            # Summers at Camp: each camper's Years At Camp in THIS year's persons rows
            # (decision 36), so every column reads the season it is labelled with.
            sy_counts = Counter(summers_at_camp_by_person(person_ids, persons).values())
            summer_years_breakdown = [
                SummerYearsEnrollment(summer_years=sy, count=c) for sy, c in sorted(sy_counts.items())
            ]

            # First Summer Year: a year, read from history up to this year (36b folds 2017 or earlier).
            first_summer_year_breakdown: list[FirstSummerYearEnrollment] = []
            if enrollment_history:
                history_up_to_year = [r for r in enrollment_history if getattr(r, "year", 0) <= year]
                first_year_by_person = compute_first_summer_years(
                    history_up_to_year, person_ids, summer_windows=summer_windows
                )

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
                    gender_fallback_count=count_binary_fallbacks(person_ids, persons),
                    by_grade=grade_breakdown,
                    by_city=city_breakdown,
                    by_school=school_breakdown,
                    by_synagogue=synagogue_breakdown,
                    by_summer_years=summer_years_breakdown,
                    by_first_summer_year=first_summer_year_breakdown,
                )
            )

        return enrollment_by_year

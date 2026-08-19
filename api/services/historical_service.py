"""Historical service - business logic for historical trends metrics.

This service computes multi-year enrollment trends using attendees+persons
(not camper_history) with person_id deduplication to avoid double-counting
campers enrolled in multiple sessions.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    GenderBreakdown,
    HistoricalTrendsResponse,
    NewVsReturning,
    YearMetrics,
)
from api.utils.session_metrics import (
    filter_attendees_by_session,
    find_ag_sessions_for_parent,
    resolve_duration_sessions,
)

from .breakdown_calculator import calculate_percentage, compute_registration_breakdown
from .extractors import extract_gender

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


class HistoricalService:
    """Business logic for historical trends - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repo = repository

    async def calculate_historical_trends(
        self,
        years: list[int] | None = None,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> HistoricalTrendsResponse:
        """Calculate historical trends across multiple years.

        Uses attendees+persons with person_id set deduplication (not camper_history).

        Args:
            years: List of years to analyze. Default: last 5 years from current year.
            session_types: Optional list of session types to filter.
            session_cm_id: Optional session CampMinder ID to filter by.
                When provided, filters to sessions with the same NAME across years.
            duration: Optional duration category (e.g., "1-week", "2-week") to filter
                sessions by length.

        Returns:
            HistoricalTrendsResponse with trend data.
        """
        if years is None:
            season_id = os.environ.get("CAMPMINDER_SEASON_ID", "")
            current_year = int(season_id) if season_id.isdigit() else datetime.now(tz=UTC).year
            years = list(range(current_year - 4, current_year + 1))

        # If session_cm_id provided, get the session name to filter by
        session_name: str | None = None
        if session_cm_id is not None:
            session_name = await self._get_session_name_for_filtering(session_cm_id, years, session_types)

        # Fetch attendees, persons, sessions, and cancellation transitions for all years in parallel
        attendee_futures = [self.repo.fetch_attendees(y) for y in years]
        person_futures = [self.repo.fetch_persons(y) for y in years]
        session_futures = [self.repo.fetch_sessions(y, session_types=session_types) for y in years]
        cancel_futures = [self._fetch_cancellation_transitions(y) for y in years]
        coverage_futures = [self._fetch_cancellation_data_coverage(y) for y in years]

        all_attendees = await asyncio.gather(*attendee_futures)
        all_persons = await asyncio.gather(*person_futures)
        all_sessions = await asyncio.gather(*session_futures)
        all_cancel_transitions = await asyncio.gather(*cancel_futures)
        all_coverage = await asyncio.gather(*coverage_futures)

        # Compute metrics for each year
        year_metrics_list: list[YearMetrics] = []

        for year, attendees, persons, sessions, cancel_transitions, has_cancellation_data in zip(
            years, all_attendees, all_persons, all_sessions, all_cancel_transitions, all_coverage, strict=True
        ):
            # Filter attendees by session type and/or session name
            filtered = self._filter_attendees(attendees, sessions, session_types, session_cm_id, session_name, duration)

            # Deduplicate by person_id
            person_ids = {pid for a in filtered if (pid := getattr(a, "person_id", None)) is not None}

            # Cancellations use the SAME scope (session_types/session_cm_id/duration) and the
            # same distinct-person grain as the enrolled denominator above -- see #2434, where
            # an unscoped, row-counted numerator inflated the rendered rate ~2.4x.
            #
            # cancel_transitions is None when the underlying fetch failed (see
            # _fetch_cancellation_transitions) -- that failure must not be reported as a
            # confidently-measured zero: fold it into has_cancellation_data so the count and
            # the coverage flag can never disagree about whether this year was actually
            # measured this call.
            cancellation_fetch_failed = cancel_transitions is None
            filtered_cancellations = self._filter_attendees(
                cancel_transitions or [], sessions, session_types, session_cm_id, session_name, duration
            )
            cancelled_person_ids = {
                pid for t in filtered_cancellations if (pid := getattr(t, "person_id", None)) is not None
            }
            cancel_count = len(cancelled_person_ids)
            year_has_cancellation_data = has_cancellation_data and not cancellation_fetch_failed

            year_metric = self._compute_year_metrics(
                year, person_ids, persons, cancel_count, year_has_cancellation_data
            )
            year_metrics_list.append(year_metric)

        return HistoricalTrendsResponse(years=year_metrics_list)

    def _filter_attendees(
        self,
        attendees: list[Any],
        sessions: dict[int, Any],
        session_types: list[str] | None,
        session_cm_id: int | None,
        session_name: str | None,
        duration: str | None = None,
    ) -> list[Any]:
        """Filter attendees by session type and optionally by session name.

        When session_name is provided (from session_cm_id lookup), we find the
        matching session cm_ids in this year's sessions and filter to those.
        """
        # Find target session cm_ids by name matching
        target_session_cm_id: int | None = None
        if session_name is not None:
            for sid, session in sessions.items():
                if getattr(session, "name", None) == session_name:
                    target_session_cm_id = sid
                    break
            if target_session_cm_id is None:
                # Session name not found in this year — no matching attendees
                return []

        ag_session_ids = find_ag_sessions_for_parent(sessions, target_session_cm_id or session_cm_id)
        duration_session_ids = resolve_duration_sessions(sessions, duration) if duration else None
        return filter_attendees_by_session(
            attendees,
            session_types,
            target_session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

    async def _get_session_name_for_filtering(
        self,
        session_cm_id: int,
        years: list[int],
        session_types: list[str] | None = None,
    ) -> str | None:
        """Look up the session name to use for filtering across years."""
        session_futures = [self.repo.fetch_sessions(year, session_types=session_types) for year in years]
        all_sessions = await asyncio.gather(*session_futures)

        for sessions_dict in all_sessions:
            if session_cm_id in sessions_dict:
                session = sessions_dict[session_cm_id]
                return getattr(session, "name", None)

        return None

    async def _fetch_cancellation_transitions(self, year: int) -> list[Any] | None:
        """Fetch raw cancellation status-transition rows for a year.

        Returns the unfiltered rows so the caller can scope them by
        session_type/session_cm_id/duration identically to the enrolled
        denominator (see calculate_historical_trends), and dedupe by
        person_id for the correct grain. No repository defines a
        pre-aggregated ``fetch_cancellation_count`` -- see #2434.

        Returns ``None`` (not ``[]``) on a repository failure, so the caller
        can distinguish "queried, zero rows" from "never queried" -- a fetch
        failure must not be reported as a confidently-measured zero
        cancellation count (see #2443's has_cancellation_data).
        """
        try:
            result: list[Any] = await self.repo.fetch_status_transitions(year, ["cancelled", "withdrawn", "dismissed"])
            return result
        except Exception:
            return None

    async def _fetch_cancellation_data_coverage(self, year: int) -> bool:
        """Whether attendee_status_history has ANY rows for this year.

        Not filtered by session_types, session_cm_id, duration, or status --
        coverage is a year-level fact, independent of the scoping applied to
        the enrolled/cancelled counts. Reuses the existing, already-defined
        ``fetch_status_history(year, old_status=None, new_statuses=None)``
        probe (both filters default) rather than adding a new repository
        method -- see #2443.
        """
        try:
            rows: list[Any] = await self.repo.fetch_status_history(year)
            return len(rows) > 0
        except Exception:
            return False

    def _compute_year_metrics(
        self,
        year: int,
        person_ids: set[int],
        persons: dict[int, Any],
        total_cancelled: int = 0,
        has_cancellation_data: bool = True,
    ) -> YearMetrics:
        """Compute metrics for a single year from deduplicated person IDs.

        Args:
            year: The year.
            person_ids: Set of unique person IDs (already deduplicated).
            persons: Dict mapping person cm_id to person record.
            total_cancelled: Number of cancellations for this year.

        Returns:
            YearMetrics with all breakdowns.
        """
        total_enrolled = len(person_ids)

        # Gender breakdown from persons table
        gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender)
        by_gender = [
            GenderBreakdown(gender=g, count=s.count, percentage=calculate_percentage(s.count, total_enrolled))
            for g, s in sorted(gender_stats.items())
        ]

        # New vs returning from persons.years_at_camp
        new_count = sum(1 for pid in person_ids if persons.get(pid) and getattr(persons[pid], "years_at_camp", 0) == 1)
        returning_count = total_enrolled - new_count

        new_vs_returning = NewVsReturning(
            new_count=new_count,
            returning_count=returning_count,
            new_percentage=calculate_percentage(new_count, total_enrolled),
            returning_percentage=calculate_percentage(returning_count, total_enrolled),
        )

        # Cancellation rate: cancelled / (enrolled + cancelled)
        denominator = total_enrolled + total_cancelled
        cancellation_rate = round((total_cancelled / denominator) * 100, 2) if denominator > 0 else 0.0

        return YearMetrics(
            year=year,
            total_enrolled=total_enrolled,
            by_gender=by_gender,
            new_vs_returning=new_vs_returning,
            total_cancelled=total_cancelled,
            cancellation_rate=cancellation_rate,
            has_cancellation_data=has_cancellation_data,
        )

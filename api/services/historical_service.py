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
    resolve_scope_ids,
)
from bunking.logging_config import get_logger

from .breakdown_calculator import calculate_percentage, compute_registration_breakdown
from .extractors import extract_gender, is_new_camper

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = get_logger(__name__)


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
                When provided, the same session is found in every year by cm_id, then
                by its alias group, then by name; a year with no match reads 0.
            duration: Optional duration category (e.g., "1-week", "2-week") to filter
                sessions by length.

        Returns:
            HistoricalTrendsResponse with trend data.
        """
        if years is None:
            season_id = os.environ.get("CAMPMINDER_SEASON_ID", "")
            current_year = int(season_id) if season_id.isdigit() else datetime.now(tz=UTC).year
            years = list(range(current_year - 4, current_year + 1))

        # Every year's sessions, with no type filter: the summer window that gates
        # teen programs comes from that year's `main` sessions, so main must be
        # present even when only teens are requested (#3208 row 12).
        all_sessions = await asyncio.gather(*[self.repo.fetch_sessions(y) for y in years])

        # The picked session's name, from the newest year that has its cm_id, so a
        # renamed session can be found in earlier years (#3208 row 9).
        reference_name: str | None = None
        if session_cm_id is not None:
            for sessions in reversed(all_sessions):
                if session_cm_id in sessions:
                    reference_name = getattr(sessions[session_cm_id], "name", None)
                    break

        # Fetch enrolled attendees, persons and final-status cancellations for all years in parallel
        attendee_futures = [self.repo.fetch_attendees(y) for y in years]
        person_futures = [self.repo.fetch_persons(y) for y in years]
        cancelled_futures = [self._fetch_cancelled_attendees(y) for y in years]

        all_attendees = await asyncio.gather(*attendee_futures)
        all_persons = await asyncio.gather(*person_futures)
        all_cancelled = await asyncio.gather(*cancelled_futures)

        # Compute metrics for each year
        year_metrics_list: list[YearMetrics] = []

        for year, attendees, persons, sessions, cancelled in zip(
            years, all_attendees, all_persons, all_sessions, all_cancelled, strict=True
        ):
            # One scope per year, through the shared resolver.
            scope_ids = resolve_scope_ids(sessions, session_types, session_cm_id, duration, reference_name)
            filtered = filter_attendees_by_session(attendees, None, session_cm_ids=scope_ids)

            # Deduplicate by person_id
            person_ids = {pid for a in filtered if (pid := getattr(a, "person_id", None)) is not None}

            # Cancelled = each camper's FINAL status is cancelled, for every year, the
            # same count as Overview's Total Cancelled (decision 10, #3207). Status
            # history only reaches back to 2026, so a history-based count read 0 for
            # every earlier season; the Cancellations tab keeps the history for "status
            # before cancelling" and Re-enrolled. Same scope and distinct-person grain
            # as the enrolled denominator (#2434).
            #
            # `cancelled` is None when the fetch failed: that year is flagged
            # unmeasured rather than shown as a confident zero (#2443).
            filtered_cancelled = filter_attendees_by_session(cancelled or [], None, session_cm_ids=scope_ids)
            cancelled_person_ids = {
                pid for a in filtered_cancelled if (pid := getattr(a, "person_id", None)) is not None
            }

            year_metric = self._compute_year_metrics(
                year, person_ids, persons, len(cancelled_person_ids), has_cancellation_data=cancelled is not None
            )
            year_metrics_list.append(year_metric)

        return HistoricalTrendsResponse(years=year_metrics_list)

    async def _fetch_cancelled_attendees(self, year: int) -> list[Any] | None:
        """Attendee records whose final status is ``cancelled`` (Overview's source).

        Returns ``None`` (not ``[]``) on a repository failure, so the caller can
        tell "queried, zero rows" from "never queried" (#2443).
        """
        try:
            result: list[Any] = await self.repo.fetch_attendees(year, "cancelled")
            return result
        except Exception:
            # The repository does not log its own failures; without this the year
            # reads "—" in Trends with no trace of why.
            logger.warning("Cancelled attendee fetch failed; year=%s shows as unmeasured", year, exc_info=True)
            return None

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
        new_count = sum(
            1 for pid in person_ids if persons.get(pid) and is_new_camper(getattr(persons[pid], "years_at_camp", None))
        )
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

"""
Metrics Router - Registration and retention metrics endpoints.

This router provides endpoints for analyzing historical registration data,
retention rates, and year-over-year comparisons.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import pb
from ..schemas.metrics import (
    ComparisonDelta,
    ComparisonMetricsResponse,
    FirstYearBreakdown,
    GenderBreakdown,
    GradeBreakdown,
    HistoricalTrendsResponse,
    NewVsReturning,
    RegistrationMetricsResponse,
    RetentionMetricsResponse,
    RetentionTrendsResponse,
    YearMetrics,
    YearSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


# ============================================================================
# Helper Functions
# ============================================================================


def get_session_length_category(start_date: str, end_date: str) -> str:
    """Calculate session length category from actual dates.

    Categories:
    - 1-week: 1-7 days
    - 2-week: 8-14 days
    - 3-week: 15-21 days
    - 4-week+: 22+ days
    - unknown: missing or invalid dates

    Args:
        start_date: Session start date (YYYY-MM-DD or with time/timezone)
        end_date: Session end date (YYYY-MM-DD or with time/timezone)

    Returns:
        Session length category string.
    """
    from datetime import datetime

    if not start_date or not end_date:
        return "unknown"

    try:
        # Parse dates - handle various formats
        # Strip time component if present (keep just YYYY-MM-DD)
        start_str = start_date.split(" ")[0].split("T")[0]
        end_str = end_date.split(" ")[0].split("T")[0]

        start = datetime.strptime(start_str, "%Y-%m-%d")
        end = datetime.strptime(end_str, "%Y-%m-%d")
        days = (end - start).days + 1  # Inclusive of both start and end

        if days <= 7:
            return "1-week"
        elif days <= 14:
            return "2-week"
        elif days <= 21:
            return "3-week"
        else:
            return "4-week+"
    except (ValueError, AttributeError):
        return "unknown"


async def fetch_attendees_for_year(year: int, status_filter: str | list[str] | None = None) -> list[Any]:
    """Fetch attendees for a given year with optional status filter.

    Args:
        year: The year to fetch attendees for.
        status_filter: Optional status filter. Can be:
                      - None: fetches active enrolled (is_active=1 AND status_id=2)
                      - str: single status (e.g., 'waitlisted', 'applied', 'cancelled')
                      - list[str]: multiple statuses (e.g., ['enrolled', 'waitlisted'])
                      Supports all 10 PB statuses: enrolled, applied, waitlisted,
                      left_early, cancelled, dismissed, inquiry, withdrawn,
                      incomplete, unknown.

    Returns:
        List of attendee records with session expansion.
    """
    if status_filter is None:
        # Default: active enrolled
        filter_str = f"year = {year} && is_active = 1 && status_id = 2"
    elif isinstance(status_filter, list):
        # Multiple statuses - build OR filter
        status_conditions = " || ".join(f'status = "{s}"' for s in status_filter)
        filter_str = f"year = {year} && ({status_conditions})"
    elif status_filter == "enrolled":
        # Enrolled uses the strict is_active + status_id filter
        filter_str = f"year = {year} && is_active = 1 && status_id = 2"
    else:
        # Single non-enrolled status - build status filter dynamically
        filter_str = f'year = {year} && status = "{status_filter}"'

    return await asyncio.to_thread(
        pb.collection("attendees").get_full_list,
        query_params={"filter": filter_str, "expand": "session"},
    )


async def fetch_persons_for_year(year: int) -> dict[int, Any]:
    """Fetch all persons for a given year and return as dict by cm_id.

    Returns a dict keyed by cm_id (CampMinder ID) with int keys for consistent
    lookup against attendees.person_id values.
    """
    persons = await asyncio.to_thread(
        pb.collection("persons").get_full_list,
        query_params={"filter": f"year = {year}"},
    )
    # Ensure int keys for consistent lookup (PocketBase may return float)
    return {int(getattr(p, "cm_id", 0)): p for p in persons}


async def fetch_sessions_for_year(year: int, session_types: list[str] | None = None) -> dict[int, Any]:
    """Fetch sessions for a given year and return as dict by cm_id.

    Args:
        year: The year to fetch sessions for.
        session_types: Optional list of session types to filter (e.g., ['main', 'embedded']).

    Returns:
        Dictionary mapping cm_id to session record.
    """
    filter_str = f"year = {year}"
    if session_types:
        type_filter = " || ".join(f'session_type = "{t}"' for t in session_types)
        filter_str = f"({filter_str}) && ({type_filter})"

    sessions = await asyncio.to_thread(
        pb.collection("camp_sessions").get_full_list,
        query_params={"filter": filter_str},
    )
    # Ensure int keys for consistent lookup (PocketBase may return float)
    return {int(getattr(s, "cm_id", 0)): s for s in sessions}


def calculate_percentage(count: int, total: int) -> float:
    """Calculate percentage, handling division by zero."""
    return (count / total * 100) if total > 0 else 0.0


def safe_rate(numerator: int, denominator: int) -> float:
    """Calculate rate, handling division by zero."""
    return numerator / denominator if denominator > 0 else 0.0


def merge_ag_into_parent_sessions(
    session_counts: dict[int, int],
    sessions: dict[int, Any],
) -> dict[int, int]:
    """Merge AG session counts into their parent main sessions.

    AG sessions have a parent_id field that points to their parent main session.
    This function combines AG session counts with their parent's counts so that
    only main and embedded session types appear in the output.

    Args:
        session_counts: Dictionary mapping session cm_id to count.
        sessions: Dictionary mapping session cm_id to session record.

    Returns:
        Dictionary with AG session counts merged into parent sessions.
        Only main and embedded sessions are included.
    """
    # Build AG -> parent mapping (ensure int keys for consistent lookup)
    ag_parent_map: dict[int, int] = {}
    for sid, session in sessions.items():
        if getattr(session, "session_type", None) == "ag":
            parent_id = getattr(session, "parent_id", None)
            if parent_id:
                ag_parent_map[int(sid)] = int(parent_id)

    # Merge AG counts into parent sessions
    merged_counts: dict[int, int] = {}
    for sid, count in session_counts.items():
        if sid in ag_parent_map:
            # This is an AG session - add to parent
            parent_id = ag_parent_map[sid]
            merged_counts[parent_id] = merged_counts.get(parent_id, 0) + count
        else:
            # Not an AG session - keep as is
            merged_counts[sid] = merged_counts.get(sid, 0) + count

    # Filter to only main and embedded sessions
    return {
        sid: count
        for sid, count in merged_counts.items()
        if sid in sessions and getattr(sessions.get(sid), "session_type", None) in ("main", "embedded")
    }


def merge_ag_into_parent_retention_stats(
    session_stats: dict[int, dict[str, int]],
    sessions: dict[int, Any],
) -> dict[int, dict[str, int]]:
    """Merge AG session retention stats into their parent main sessions.

    Similar to merge_ag_into_parent_sessions but for retention stats which have
    'base' and 'returned' sub-counts.

    Args:
        session_stats: Dictionary mapping session cm_id to {"base": n, "returned": m}.
        sessions: Dictionary mapping session cm_id to session record.

    Returns:
        Dictionary with AG session stats merged into parent sessions.
        Only main and embedded sessions are included.
    """
    # Build AG -> parent mapping (ensure int keys for consistent lookup)
    ag_parent_map: dict[int, int] = {}
    for sid, session in sessions.items():
        if getattr(session, "session_type", None) == "ag":
            parent_id = getattr(session, "parent_id", None)
            if parent_id:
                ag_parent_map[int(sid)] = int(parent_id)

    # Merge AG stats into parent sessions
    merged_stats: dict[int, dict[str, int]] = {}
    for sid, stats in session_stats.items():
        if sid in ag_parent_map:
            # This is an AG session - add to parent
            parent_id = ag_parent_map[sid]
            if parent_id not in merged_stats:
                merged_stats[parent_id] = {"base": 0, "returned": 0}
            merged_stats[parent_id]["base"] += stats["base"]
            merged_stats[parent_id]["returned"] += stats["returned"]
        else:
            # Not an AG session - keep as is
            if sid not in merged_stats:
                merged_stats[sid] = {"base": 0, "returned": 0}
            merged_stats[sid]["base"] += stats["base"]
            merged_stats[sid]["returned"] += stats["returned"]

    # Filter to only main and embedded sessions
    return {
        sid: stats
        for sid, stats in merged_stats.items()
        if sid in sessions and getattr(sessions.get(sid), "session_type", None) in ("main", "embedded")
    }


async def fetch_camper_history_for_year(year: int, session_types: list[str] | None = None) -> list[Any]:
    """Fetch camper_history records for a given year.

    Note: This function does NOT filter by status. Status filtering happens at
    the attendees level (for enrollment counts), not at the demographics level.
    Demographics should include everyone associated with summer sessions,
    regardless of their enrollment status.

    Args:
        year: The year to fetch records for.
        session_types: Optional list of session types to filter (e.g., ['main', 'embedded', 'ag']).
                      If provided, only records with matching session_types will be returned.

    Returns:
        List of camper_history records (already denormalized).
        Returns empty list if collection doesn't exist or query fails.
    """
    try:
        filter_str = f"year = {year}"

        records = await asyncio.to_thread(
            pb.collection("camper_history").get_full_list,
            query_params={"filter": filter_str},
        )

        # Filter by session_types if provided
        if session_types:
            filtered = []
            for record in records:
                record_types = getattr(record, "session_types", "") or ""
                # Check if any of the record's session types match the filter
                if record_types:
                    record_type_list = [t.strip() for t in record_types.split(",")]
                    if any(rt in session_types for rt in record_type_list):
                        filtered.append(record)
            return filtered

        return records
    except Exception as e:
        logger.warning(f"Could not fetch camper_history for year {year}: {e}")
        return []  # Return empty list - new breakdowns will just be empty


# ============================================================================
# Summer Enrollment History Helpers
# ============================================================================


async def fetch_summer_enrollment_history(
    person_ids: set[int],
    max_year: int,
) -> list[Any]:
    """Fetch ALL summer enrollments for given persons in a SINGLE batched query.

    This enables calculating:
    - Years of summer enrollment (count distinct years)
    - First summer year (min year)
    - Prior year sessions (filter to prior_year)

    Args:
        person_ids: Set of person_ids to fetch history for.
        max_year: Maximum year to include (typically the base year).

    Returns:
        List of attendee records with session expansion.
    """
    if not person_ids:
        return []

    # PocketBase doesn't support IN clauses - use OR chain for person_id matching
    # Batch queries to avoid overly long filter strings (max ~100 IDs per batch)
    BATCH_SIZE = 100
    sorted_ids = sorted(person_ids)
    all_results: list[Any] = []

    for i in range(0, len(sorted_ids), BATCH_SIZE):
        batch_ids = sorted_ids[i : i + BATCH_SIZE]
        person_filter = " || ".join(f"person_id = {pid}" for pid in batch_ids)
        filter_str = f"({person_filter}) && status_id = 2 && year <= {max_year}"

        batch_results = await asyncio.to_thread(
            pb.collection("attendees").get_full_list,
            query_params={"filter": filter_str, "expand": "session"},
        )
        all_results.extend(batch_results)

    return all_results


def compute_summer_metrics(
    enrollment_history: list[Any],
    person_ids: set[int],
    prior_year: int,
) -> tuple[dict[int, int], dict[int, int], dict[int, list[str]]]:
    """Compute summer enrollment metrics from batch-fetched history.

    Args:
        enrollment_history: List of attendee records with session expansion.
        person_ids: Set of person_ids in the base year.
        prior_year: Year before base year (for prior session analysis).

    Returns:
        Tuple of:
        - summer_years_by_person: person_id -> count of distinct summer years
        - first_year_by_person: person_id -> first summer enrollment year
        - prior_sessions_by_person: person_id -> list of prior year session names
    """
    # Group records by person_id
    by_person: dict[int, list[Any]] = {}
    for record in enrollment_history:
        pid = getattr(record, "person_id", None)
        if pid is None or pid not in person_ids:
            continue

        # Filter to summer session types (main, embedded, ag)
        expand = getattr(record, "expand", {}) or {}
        session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        if not session:
            continue

        session_type = getattr(session, "session_type", None)
        if session_type not in ("main", "embedded", "ag"):
            continue

        if pid not in by_person:
            by_person[pid] = []
        by_person[pid].append(record)

    # Compute aggregations
    summer_years_by_person: dict[int, int] = {}
    first_year_by_person: dict[int, int] = {}
    prior_sessions_by_person: dict[int, list[str]] = {}

    for pid, records in by_person.items():
        # Summer years: count distinct years
        years = {getattr(r, "year", 0) for r in records}
        summer_years_by_person[pid] = len(years)

        # First summer year: min year
        if years:
            first_year_by_person[pid] = min(years)

        # Prior year sessions
        prior_sessions = []
        for r in records:
            if getattr(r, "year", 0) == prior_year:
                expand = getattr(r, "expand", {}) or {}
                session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                if session:
                    session_name = getattr(session, "name", "")
                    if session_name:
                        prior_sessions.append(session_name)
        prior_sessions_by_person[pid] = prior_sessions

    return summer_years_by_person, first_year_by_person, prior_sessions_by_person


# ============================================================================
# Retention Endpoint
# ============================================================================


@router.get("/retention", response_model=RetentionMetricsResponse)
async def get_retention_metrics(
    base_year: int = Query(..., description="Base year (e.g., 2025)"),
    compare_year: int = Query(..., description="Comparison year (e.g., 2026)"),
    session_types: str | None = Query(
        None, description="Comma-separated session types to filter (e.g., 'main,embedded')"
    ),
    session_cm_id: int | None = Query(None, description="Filter to specific session by CampMinder ID"),
) -> RetentionMetricsResponse:
    """Get retention metrics comparing two years.

    Calculates what percentage of campers from base_year returned in compare_year,
    broken down by gender, grade, session, and years at camp.
    """
    from api.services.metrics_repository import MetricsRepository
    from api.services.retention_service import RetentionService

    try:
        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Use service layer for business logic
        repository = MetricsRepository(pb)
        service = RetentionService(repository)

        return await service.calculate_retention(
            base_year=base_year,
            compare_year=compare_year,
            session_types=type_filter,
            session_cm_id=session_cm_id,
        )

    except Exception as e:
        logger.error(f"Error calculating retention metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating retention metrics: {str(e)}")


# ============================================================================
# Registration Endpoint
# ============================================================================


@router.get("/registration", response_model=RegistrationMetricsResponse)
async def get_registration_metrics(
    year: int = Query(..., description="Year to get registration metrics for"),
    session_types: str | None = Query(
        "main,embedded,ag",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    statuses: str | None = Query(
        "enrolled",
        description="Comma-separated statuses to include (default: enrolled). Options: enrolled, applied, waitlisted, left_early, cancelled, dismissed, inquiry, withdrawn, incomplete, unknown",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID. AG sessions with matching parent_id are included.",
    ),
) -> RegistrationMetricsResponse:
    """Get registration breakdown metrics for a specific year.

    Returns enrollment counts broken down by gender, grade, session,
    session length, years at camp, and new vs returning status.

    The statuses parameter controls which registration statuses are included
    in the enrollment counts and breakdowns. Multiple statuses can be combined
    for flexible dashboard views.
    """
    from api.services.metrics_repository import MetricsRepository
    from api.services.registration_service import RegistrationService

    try:
        type_filter = session_types.split(",") if session_types else None
        status_filter = [s.strip() for s in (statuses or "enrolled").split(",")]

        repository = MetricsRepository(pb)
        service = RegistrationService(repository)
        return await service.calculate_registration(year, type_filter, status_filter, session_cm_id)

    except Exception as e:
        logger.error(f"Error calculating registration metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating registration metrics: {str(e)}")


# ============================================================================
# Comparison Endpoint
# ============================================================================


@router.get("/comparison", response_model=ComparisonMetricsResponse)
async def get_comparison_metrics(
    year_a: int = Query(..., description="First year to compare"),
    year_b: int = Query(..., description="Second year to compare"),
    session_types: str | None = Query(
        "main,embedded,ag",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
) -> ComparisonMetricsResponse:
    """Get year-over-year comparison metrics.

    Compares total enrollment, gender distribution, and grade distribution
    between two years. Filters to summer camp sessions by default.
    """
    try:
        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Fetch data in parallel
        (
            attendees_a,
            attendees_b,
            persons_a,
            persons_b,
        ) = await asyncio.gather(
            fetch_attendees_for_year(year_a),
            fetch_attendees_for_year(year_b),
            fetch_persons_for_year(year_a),
            fetch_persons_for_year(year_b),
        )

        # Filter attendees by session type if needed
        def filter_by_session_type(attendees: list[Any]) -> list[Any]:
            if not type_filter:
                return attendees
            filtered = []
            for a in attendees:
                expand = getattr(a, "expand", {}) or {}
                session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type in type_filter:
                    filtered.append(a)
            return filtered

        attendees_a = filter_by_session_type(attendees_a)
        attendees_b = filter_by_session_type(attendees_b)

        # Get unique person IDs
        person_ids_a = {getattr(a, "person_id", None) for a in attendees_a if getattr(a, "person_id", None)}
        person_ids_b = {getattr(a, "person_id", None) for a in attendees_b if getattr(a, "person_id", None)}

        total_a = len(person_ids_a)
        total_b = len(person_ids_b)

        # Gender breakdown for year A
        gender_counts_a: dict[str, int] = {}
        for pid in person_ids_a:
            person = persons_a.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            gender_counts_a[gender] = gender_counts_a.get(gender, 0) + 1

        by_gender_a = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total_a),
            )
            for g, c in sorted(gender_counts_a.items())
        ]

        # Gender breakdown for year B
        gender_counts_b: dict[str, int] = {}
        for pid in person_ids_b:
            person = persons_b.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            gender_counts_b[gender] = gender_counts_b.get(gender, 0) + 1

        by_gender_b = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total_b),
            )
            for g, c in sorted(gender_counts_b.items())
        ]

        # Grade breakdown for year A
        grade_counts_a: dict[int | None, int] = {}
        for pid in person_ids_a:
            person = persons_a.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            grade_counts_a[grade] = grade_counts_a.get(grade, 0) + 1

        by_grade_a = [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=calculate_percentage(c, total_a),
            )
            for g, c in sorted(grade_counts_a.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        # Grade breakdown for year B
        grade_counts_b: dict[int | None, int] = {}
        for pid in person_ids_b:
            person = persons_b.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            grade_counts_b[grade] = grade_counts_b.get(grade, 0) + 1

        by_grade_b = [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=calculate_percentage(c, total_b),
            )
            for g, c in sorted(grade_counts_b.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        # Delta calculation
        total_change = total_b - total_a
        percentage_change = calculate_percentage(total_change, total_a) if total_a > 0 else 0.0

        return ComparisonMetricsResponse(
            year_a=YearSummary(
                year=year_a,
                total=total_a,
                by_gender=by_gender_a,
                by_grade=by_grade_a,
            ),
            year_b=YearSummary(
                year=year_b,
                total=total_b,
                by_gender=by_gender_b,
                by_grade=by_grade_b,
            ),
            delta=ComparisonDelta(
                total_change=total_change,
                percentage_change=percentage_change,
            ),
        )

    except Exception as e:
        logger.error(f"Error calculating comparison metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating comparison metrics: {str(e)}")


# ============================================================================
# Historical Trends Endpoint
# ============================================================================


@router.get("/historical", response_model=HistoricalTrendsResponse)
async def get_historical_trends(
    years: str | None = Query(None, description="Comma-separated years (default: last 5 years from current year)"),
    session_types: str | None = Query("main,ag,embedded", description="Comma-separated session types to filter"),
) -> HistoricalTrendsResponse:
    """Get historical trends across multiple years.

    Returns aggregated metrics for each year to enable line chart visualization.
    Default: last 5 years (2021-2025).
    """
    try:
        # Parse years
        if years:
            year_list = [int(y.strip()) for y in years.split(",")]
        else:
            # Default: last 5 years from 2025
            current_year = 2025
            year_list = list(range(current_year - 4, current_year + 1))

        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Fetch camper_history for all years in parallel
        history_futures = [fetch_camper_history_for_year(y, session_types=type_filter) for y in year_list]
        all_history = await asyncio.gather(*history_futures)

        year_metrics_list: list[YearMetrics] = []

        for year, history in zip(year_list, all_history, strict=True):
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

            year_metrics_list.append(
                YearMetrics(
                    year=year,
                    total_enrolled=total_enrolled,
                    by_gender=by_gender,
                    new_vs_returning=new_vs_returning,
                    by_first_year=by_first_year,
                )
            )

        return HistoricalTrendsResponse(years=year_metrics_list)

    except Exception as e:
        logger.error(f"Error calculating historical trends: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating historical trends: {str(e)}")


# ============================================================================
# Retention Trends Endpoint (3-Year View)
# ============================================================================


@router.get("/retention-trends", response_model=RetentionTrendsResponse)
async def get_retention_trends(
    current_year: int = Query(..., description="Current year (e.g., 2026)"),
    num_years: int = Query(3, description="Number of years to include (default: 3)"),
    session_types: str | None = Query(
        "main,embedded,ag",
        description="Comma-separated session types to filter (default: summer camp sessions)",
    ),
    session_cm_id: int | None = Query(
        None,
        description="Filter to specific session by CampMinder ID",
    ),
) -> RetentionTrendsResponse:
    """Get retention trends across multiple year transitions.

    Returns retention data for num_years-1 year transitions. For example,
    with num_years=3 and current_year=2026:
    - 2024→2025 transition
    - 2025→2026 transition

    This enables line charts for overall retention and grouped bar charts
    for breakdown categories.
    """
    from api.services.metrics_repository import MetricsRepository
    from api.services.retention_trends_service import RetentionTrendsService

    try:
        type_filter = session_types.split(",") if session_types else None

        repository = MetricsRepository(pb)
        service = RetentionTrendsService(repository)
        return await service.calculate_retention_trends(
            current_year=current_year,
            num_years=num_years,
            session_types=type_filter,
            session_cm_id=session_cm_id,
        )

    except Exception as e:
        logger.error(f"Error calculating retention trends: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating retention trends: {str(e)}")

"""
Metrics Router - Registration and retention metrics endpoints.

This router provides endpoints for analyzing historical registration data,
retention rates, and year-over-year comparisons.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import pb
from ..schemas.metrics import (
    CityBreakdown,
    ComparisonDelta,
    ComparisonMetricsResponse,
    FirstSummerYearBreakdown,
    FirstYearBreakdown,
    GenderBreakdown,
    GenderByGradeBreakdown,
    GenderEnrollment,
    GradeBreakdown,
    GradeEnrollment,
    HistoricalTrendsResponse,
    NewVsReturning,
    RegistrationMetricsResponse,
    RetentionByCity,
    RetentionByFirstSummerYear,
    RetentionByFirstYear,
    RetentionByGender,
    RetentionByGrade,
    RetentionByPriorSession,
    RetentionBySchool,
    RetentionBySession,
    RetentionBySessionBunk,
    RetentionBySummerYears,
    RetentionBySynagogue,
    RetentionByYearsAtCamp,
    RetentionMetricsResponse,
    RetentionTrendsResponse,
    RetentionTrendYear,
    SchoolBreakdown,
    SessionBreakdown,
    SessionBunkBreakdown,
    SessionLengthBreakdown,
    SummerYearsBreakdown,
    SynagogueBreakdown,
    YearEnrollment,
    YearMetrics,
    YearsAtCampBreakdown,
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
    try:
        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Fetch data in parallel
        (
            attendees_base,
            attendees_compare,
            persons_base,
            sessions_base,
            camper_history_base,
        ) = await asyncio.gather(
            fetch_attendees_for_year(base_year),
            fetch_attendees_for_year(compare_year),
            fetch_persons_for_year(base_year),
            fetch_sessions_for_year(base_year, type_filter),
            fetch_camper_history_for_year(base_year, session_types=type_filter),
        )

        # Get unique person IDs for each year
        person_ids_base = set()
        attendee_sessions: dict[int, list[int]] = {}  # person_id -> list of session cm_ids
        for a in attendees_base:
            person_id = getattr(a, "person_id", None)
            if person_id is None:
                continue
            # If filtering by session type, check the session
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            attendee_session_cm_id = getattr(session, "cm_id", None) if session else None

            if type_filter and attendee_session_cm_id:
                session_type = getattr(session, "session_type", None)
                if session_type not in type_filter:
                    continue

            # If filtering by specific session, check the session cm_id
            if session_cm_id is not None and attendee_session_cm_id != session_cm_id:
                continue

            person_ids_base.add(person_id)
            if person_id not in attendee_sessions:
                attendee_sessions[person_id] = []
            if attendee_session_cm_id:
                attendee_sessions[person_id].append(attendee_session_cm_id)

        person_ids_compare = {getattr(a, "person_id", None) for a in attendees_compare if getattr(a, "person_id", None)}

        # Calculate returned campers
        returned_ids = person_ids_base & person_ids_compare

        # Overall metrics
        base_total = len(person_ids_base)
        compare_total = len(person_ids_compare)
        returned_count = len(returned_ids)
        overall_rate = safe_rate(returned_count, base_total)

        # Breakdowns by gender
        gender_stats: dict[str, dict[str, int]] = {}
        for pid in person_ids_base:
            person = persons_base.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            if gender not in gender_stats:
                gender_stats[gender] = {"base": 0, "returned": 0}
            gender_stats[gender]["base"] += 1
            if pid in returned_ids:
                gender_stats[gender]["returned"] += 1

        by_gender = [
            RetentionByGender(
                gender=g,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for g, stats in sorted(gender_stats.items())
        ]

        # Breakdowns by grade
        grade_stats: dict[int | None, dict[str, int]] = {}
        for pid in person_ids_base:
            person = persons_base.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            if grade not in grade_stats:
                grade_stats[grade] = {"base": 0, "returned": 0}
            grade_stats[grade]["base"] += 1
            if pid in returned_ids:
                grade_stats[grade]["returned"] += 1

        by_grade = [
            RetentionByGrade(
                grade=g,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for g, stats in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        # Breakdowns by session
        session_stats: dict[int, dict[str, int]] = {}
        for pid, session_ids in attendee_sessions.items():
            for sid in session_ids:
                if sid not in session_stats:
                    session_stats[sid] = {"base": 0, "returned": 0}
                session_stats[sid]["base"] += 1
                if pid in returned_ids:
                    session_stats[sid]["returned"] += 1

        # Merge AG session stats into parent main sessions
        merged_session_stats = merge_ag_into_parent_retention_stats(session_stats, sessions_base)

        by_session = [
            RetentionBySession(
                session_cm_id=sid,
                session_name=getattr(sessions_base.get(sid), "name", f"Session {sid}"),
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for sid, stats in sorted(merged_session_stats.items())
            if sid in sessions_base
        ]

        # Breakdowns by years at camp
        years_stats: dict[int, dict[str, int]] = {}
        for pid in person_ids_base:
            person = persons_base.get(pid)
            if not person:
                continue
            years = getattr(person, "years_at_camp", 0) or 0
            if years not in years_stats:
                years_stats[years] = {"base": 0, "returned": 0}
            years_stats[years]["base"] += 1
            if pid in returned_ids:
                years_stats[years]["returned"] += 1

        by_years_at_camp = [
            RetentionByYearsAtCamp(
                years=y,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for y, stats in sorted(years_stats.items())
        ]

        # Build person_id -> demographics map from camper_history
        history_by_person: dict[int, Any] = {}
        for record in camper_history_base:
            person_id = getattr(record, "person_id", None)
            if person_id is not None:
                history_by_person[person_id] = record

        # Breakdowns by school (using camper_history)
        school_stats: dict[str, dict[str, int]] = {}
        for pid in person_ids_base:
            history = history_by_person.get(pid)
            if not history:
                continue
            school = getattr(history, "school", "") or ""
            if not school:
                continue
            if school not in school_stats:
                school_stats[school] = {"base": 0, "returned": 0}
            school_stats[school]["base"] += 1
            if pid in returned_ids:
                school_stats[school]["returned"] += 1

        by_school = [
            RetentionBySchool(
                school=s,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for s, stats in sorted(school_stats.items(), key=lambda x: -x[1]["base"])
        ]

        # Breakdowns by city (using camper_history)
        city_stats: dict[str, dict[str, int]] = {}
        for pid in person_ids_base:
            history = history_by_person.get(pid)
            if not history:
                continue
            city = getattr(history, "city", "") or ""
            if not city:
                continue
            if city not in city_stats:
                city_stats[city] = {"base": 0, "returned": 0}
            city_stats[city]["base"] += 1
            if pid in returned_ids:
                city_stats[city]["returned"] += 1

        by_city = [
            RetentionByCity(
                city=c,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for c, stats in sorted(city_stats.items(), key=lambda x: -x[1]["base"])
        ]

        # Breakdowns by synagogue (using camper_history)
        synagogue_stats: dict[str, dict[str, int]] = {}
        for pid in person_ids_base:
            history = history_by_person.get(pid)
            if not history:
                continue
            synagogue = getattr(history, "synagogue", "") or ""
            if not synagogue:
                continue
            if synagogue not in synagogue_stats:
                synagogue_stats[synagogue] = {"base": 0, "returned": 0}
            synagogue_stats[synagogue]["base"] += 1
            if pid in returned_ids:
                synagogue_stats[synagogue]["returned"] += 1

        by_synagogue = [
            RetentionBySynagogue(
                synagogue=s,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for s, stats in sorted(synagogue_stats.items(), key=lambda x: -x[1]["base"])
        ]

        # Breakdowns by first year attended (using camper_history)
        first_year_stats: dict[int, dict[str, int]] = {}
        for pid in person_ids_base:
            history = history_by_person.get(pid)
            if not history:
                continue
            first_year = getattr(history, "first_year_attended", None)
            if first_year is None:
                continue
            if first_year not in first_year_stats:
                first_year_stats[first_year] = {"base": 0, "returned": 0}
            first_year_stats[first_year]["base"] += 1
            if pid in returned_ids:
                first_year_stats[first_year]["returned"] += 1

        by_first_year = [
            RetentionByFirstYear(
                first_year=fy,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for fy, stats in sorted(first_year_stats.items())
        ]

        # Breakdowns by session+bunk (using camper_history)
        session_bunk_stats: dict[tuple[str, str], dict[str, int]] = {}
        for pid in person_ids_base:
            history = history_by_person.get(pid)
            if not history:
                continue
            sessions_str = getattr(history, "sessions", "") or ""
            bunks_str = getattr(history, "bunks", "") or ""
            # Parse comma-separated values
            session_list = [s.strip() for s in sessions_str.split(",") if s.strip()]
            bunk_list = [b.strip() for b in bunks_str.split(",") if b.strip()]
            # Pair sessions and bunks (if lengths match, pair them)
            if len(session_list) == len(bunk_list):
                for sess, bunk in zip(session_list, bunk_list, strict=True):
                    key = (sess, bunk)
                    if key not in session_bunk_stats:
                        session_bunk_stats[key] = {"base": 0, "returned": 0}
                    session_bunk_stats[key]["base"] += 1
                    if pid in returned_ids:
                        session_bunk_stats[key]["returned"] += 1
            elif session_list and bunk_list:
                # Cross-product when lengths don't match
                for sess in session_list:
                    for bunk in bunk_list:
                        key = (sess, bunk)
                        if key not in session_bunk_stats:
                            session_bunk_stats[key] = {"base": 0, "returned": 0}
                        session_bunk_stats[key]["base"] += 1
                        if pid in returned_ids:
                            session_bunk_stats[key]["returned"] += 1

        by_session_bunk = [
            RetentionBySessionBunk(
                session=sess,
                bunk=bunk,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for (sess, bunk), stats in sorted(session_bunk_stats.items(), key=lambda x: -x[1]["base"])[:10]
        ]

        # ====================================================================
        # New breakdowns for retention tab redesign
        # ====================================================================

        # Fetch summer enrollment history for all base year persons
        enrollment_history = await fetch_summer_enrollment_history(person_ids_base, base_year)

        # Compute summer metrics from history
        prior_year = base_year - 1
        summer_years_by_person, first_year_by_person, prior_sessions_by_person = compute_summer_metrics(
            enrollment_history, person_ids_base, prior_year
        )

        # Breakdowns by summer years (calculated from attendees, not years_at_camp)
        summer_years_stats: dict[int, dict[str, int]] = {}
        for pid in person_ids_base:
            years_count = summer_years_by_person.get(pid, 0)
            if years_count not in summer_years_stats:
                summer_years_stats[years_count] = {"base": 0, "returned": 0}
            summer_years_stats[years_count]["base"] += 1
            if pid in returned_ids:
                summer_years_stats[years_count]["returned"] += 1

        by_summer_years = [
            RetentionBySummerYears(
                summer_years=y,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for y, stats in sorted(summer_years_stats.items())
        ]

        # Breakdowns by first summer year (cohort analysis)
        first_summer_year_stats: dict[int, dict[str, int]] = {}
        for pid in person_ids_base:
            first_year = first_year_by_person.get(pid)
            if first_year is None:
                continue
            if first_year not in first_summer_year_stats:
                first_summer_year_stats[first_year] = {"base": 0, "returned": 0}
            first_summer_year_stats[first_year]["base"] += 1
            if pid in returned_ids:
                first_summer_year_stats[first_year]["returned"] += 1

        by_first_summer_year = [
            RetentionByFirstSummerYear(
                first_summer_year=fy,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for fy, stats in sorted(first_summer_year_stats.items())
        ]

        # Breakdowns by prior year session
        prior_session_stats: dict[str, dict[str, int]] = {}
        for pid in person_ids_base:
            prior_sessions = prior_sessions_by_person.get(pid, [])
            for session_name in prior_sessions:
                if session_name not in prior_session_stats:
                    prior_session_stats[session_name] = {"base": 0, "returned": 0}
                prior_session_stats[session_name]["base"] += 1
                if pid in returned_ids:
                    prior_session_stats[session_name]["returned"] += 1

        by_prior_session = [
            RetentionByPriorSession(
                prior_session=sess,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for sess, stats in sorted(prior_session_stats.items(), key=lambda x: -x[1]["base"])
        ]

        return RetentionMetricsResponse(
            base_year=base_year,
            compare_year=compare_year,
            base_year_total=base_total,
            compare_year_total=compare_total,
            returned_count=returned_count,
            overall_retention_rate=overall_rate,
            by_gender=by_gender,
            by_grade=by_grade,
            by_session=by_session,
            by_years_at_camp=by_years_at_camp,
            # Demographic breakdowns (from camper_history)
            by_school=by_school,
            by_city=by_city,
            by_synagogue=by_synagogue,
            by_first_year=by_first_year,
            by_session_bunk=by_session_bunk,
            # New breakdowns for retention tab redesign
            by_summer_years=by_summer_years,
            by_first_summer_year=by_first_summer_year,
            by_prior_session=by_prior_session,
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
    try:
        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Parse statuses filter
        status_filter = [s.strip() for s in (statuses or "enrolled").split(",")]

        # Build session_cm_id filter including AG sessions with matching parent
        # AG sessions have parent_id pointing to their main session
        ag_session_ids: set[int] = set()
        if session_cm_id is not None:
            # Fetch all sessions to find AG sessions with matching parent
            all_sessions_list = await asyncio.to_thread(
                pb.collection("camp_sessions").get_full_list,
                query_params={"filter": f"year = {year}"},
            )
            for s in all_sessions_list:
                if getattr(s, "session_type", None) == "ag":
                    parent_id = getattr(s, "parent_id", None)
                    if parent_id == session_cm_id:
                        ag_session_ids.add(getattr(s, "cm_id", 0))

        # Filter attendees by session type and optionally by session_cm_id
        def filter_by_session(attendees: list[Any]) -> list[Any]:
            filtered = []
            for a in attendees:
                expand = getattr(a, "expand", {}) or {}
                session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                if not session:
                    continue

                session_type = getattr(session, "session_type", None)
                attendee_session_cm_id = getattr(session, "cm_id", None)

                # Apply session type filter
                if type_filter and session_type not in type_filter:
                    continue

                # Apply session_cm_id filter if specified
                if session_cm_id is not None:
                    # Include if matches directly or is an AG session with matching parent
                    if attendee_session_cm_id != session_cm_id and attendee_session_cm_id not in ag_session_ids:
                        continue

                filtered.append(a)
            return filtered

        # Fetch data in parallel - fetch all requested statuses dynamically
        # Also always fetch enrolled, waitlisted, cancelled for the sidebar totals
        # Build parallel fetch tasks
        results = await asyncio.gather(
            # Fetch all requested statuses in a single query
            fetch_attendees_for_year(year, status_filter),
            # Fetch enrolled/waitlisted/cancelled separately for totals
            fetch_attendees_for_year(year),  # enrolled (default)
            fetch_attendees_for_year(year, "waitlisted"),
            fetch_attendees_for_year(year, "cancelled"),
            fetch_persons_for_year(year),
            fetch_sessions_for_year(year, type_filter),
            fetch_camper_history_for_year(year, session_types=type_filter),  # For demographics
        )

        # Unpack results with explicit casts for mypy
        requested_attendees = cast(list[Any], results[0])
        enrolled_attendees = cast(list[Any], results[1])
        waitlisted_attendees = cast(list[Any], results[2])
        cancelled_attendees = cast(list[Any], results[3])
        persons = cast(dict[int, Any], results[4])
        sessions = cast(dict[int, Any], results[5])
        camper_history = cast(list[Any], results[6])

        # Apply session filter to all attendee lists
        combined_attendees = filter_by_session(requested_attendees)
        enrolled_attendees = filter_by_session(enrolled_attendees)
        waitlisted_attendees = filter_by_session(waitlisted_attendees)
        cancelled_attendees = filter_by_session(cancelled_attendees)

        # Get person IDs from combined attendees (deduplicated)
        # Filter ensures no None values, cast for type checker
        enrolled_person_ids: set[int] = {
            pid for a in combined_attendees if (pid := getattr(a, "person_id", None)) is not None
        }

        total_enrolled = len(enrolled_person_ids)
        total_waitlisted = len(waitlisted_attendees)
        total_cancelled = len(cancelled_attendees)

        # Gender breakdown
        gender_counts: dict[str, int] = {}
        for pid in enrolled_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            gender_counts[gender] = gender_counts.get(gender, 0) + 1

        by_gender = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for g, c in sorted(gender_counts.items())
        ]

        # Grade breakdown
        grade_counts: dict[int | None, int] = {}
        for pid in enrolled_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            grade_counts[grade] = grade_counts.get(grade, 0) + 1

        by_grade = [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for g, c in sorted(grade_counts.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        # Session breakdown (ensure int keys for consistent lookup)
        session_counts: dict[int, int] = {}
        for a in combined_attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            attendee_session_cm_id = getattr(session, "cm_id", None) if session else None
            if attendee_session_cm_id:
                sid_int = int(attendee_session_cm_id)
                session_counts[sid_int] = session_counts.get(sid_int, 0) + 1

        # Merge AG session counts into parent main sessions
        merged_session_counts = merge_ag_into_parent_sessions(session_counts, sessions)

        by_session = [
            SessionBreakdown(
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                count=c,
                capacity=None,  # Would need bunk_plans to calculate
                utilization=None,
            )
            for sid, c in sorted(merged_session_counts.items())
            if sid in sessions
        ]

        # Session length breakdown
        length_counts: dict[str, int] = {}
        for a in combined_attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if session:
                start_date = getattr(session, "start_date", "") or ""
                end_date = getattr(session, "end_date", "") or ""
                length = get_session_length_category(start_date, end_date)
                length_counts[length] = length_counts.get(length, 0) + 1

        by_session_length = [
            SessionLengthBreakdown(
                length_category=length,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for length, c in sorted(
                length_counts.items(),
                key=lambda x: {"1-week": 0, "2-week": 1, "3-week": 2, "4-week+": 3, "unknown": 4}.get(x[0], 5),
            )
        ]

        # Years at camp breakdown
        years_counts: dict[int, int] = {}
        for pid in enrolled_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            years = getattr(person, "years_at_camp", 0) or 0
            years_counts[years] = years_counts.get(years, 0) + 1

        by_years_at_camp = [
            YearsAtCampBreakdown(
                years=y,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for y, c in sorted(years_counts.items())
        ]

        # New vs returning
        new_count = sum(
            1 for pid in enrolled_person_ids if persons.get(pid) and getattr(persons[pid], "years_at_camp", 0) == 1
        )
        returning_count = total_enrolled - new_count

        new_vs_returning = NewVsReturning(
            new_count=new_count,
            returning_count=returning_count,
            new_percentage=calculate_percentage(new_count, total_enrolled),
            returning_percentage=calculate_percentage(returning_count, total_enrolled),
        )

        # New breakdowns from camper_history
        total_history = len(camper_history)

        # School breakdown (raw values - normalization can be added later)
        school_counts: dict[str, int] = {}
        for record in camper_history:
            school = getattr(record, "school", "") or ""
            if school:  # Only count non-empty schools
                school_counts[school] = school_counts.get(school, 0) + 1

        by_school = [
            SchoolBreakdown(
                school=s,
                count=c,
                percentage=calculate_percentage(c, total_history),
            )
            for s, c in sorted(school_counts.items(), key=lambda x: -x[1])[:20]  # Top 20
        ]

        # City breakdown
        city_counts: dict[str, int] = {}
        for record in camper_history:
            city = getattr(record, "city", "") or ""
            if city:  # Only count non-empty cities
                city_counts[city] = city_counts.get(city, 0) + 1

        by_city = [
            CityBreakdown(
                city=c,
                count=cnt,
                percentage=calculate_percentage(cnt, total_history),
            )
            for c, cnt in sorted(city_counts.items(), key=lambda x: -x[1])[:20]  # Top 20
        ]

        # Synagogue breakdown
        synagogue_counts: dict[str, int] = {}
        for record in camper_history:
            synagogue = getattr(record, "synagogue", "") or ""
            if synagogue:  # Only count non-empty synagogues
                synagogue_counts[synagogue] = synagogue_counts.get(synagogue, 0) + 1

        by_synagogue = [
            SynagogueBreakdown(
                synagogue=s,
                count=c,
                percentage=calculate_percentage(c, total_history),
            )
            for s, c in sorted(synagogue_counts.items(), key=lambda x: -x[1])[:20]  # Top 20
        ]

        # First year attended breakdown (for onramp analysis)
        first_year_counts: dict[int, int] = {}
        for record in camper_history:
            first_year = getattr(record, "first_year_attended", None)
            if first_year:
                first_year_counts[first_year] = first_year_counts.get(first_year, 0) + 1

        by_first_year = [
            FirstYearBreakdown(
                first_year=fy,
                count=c,
                percentage=calculate_percentage(c, total_history),
            )
            for fy, c in sorted(first_year_counts.items())
        ]

        # Session+Bunk breakdown (parse CSV fields from camper_history)
        session_bunk_counts: dict[tuple[str, str], int] = {}
        for record in camper_history:
            sessions_str = getattr(record, "sessions", "") or ""
            bunks_str = getattr(record, "bunks", "") or ""
            # Parse comma-separated values
            session_list = [s.strip() for s in sessions_str.split(",") if s.strip()]
            bunk_list = [b.strip() for b in bunks_str.split(",") if b.strip()]
            # Create combinations (if lengths match, pair them; otherwise cross-product)
            if len(session_list) == len(bunk_list):
                for sess, bunk in zip(session_list, bunk_list, strict=True):
                    key = (sess, bunk)
                    session_bunk_counts[key] = session_bunk_counts.get(key, 0) + 1
            elif session_list and bunk_list:
                # Cross-product when lengths don't match
                for sess in session_list:
                    for bunk in bunk_list:
                        key = (sess, bunk)
                        session_bunk_counts[key] = session_bunk_counts.get(key, 0) + 1

        by_session_bunk = [
            SessionBunkBreakdown(
                session=sess,
                bunk=bunk,
                count=c,
            )
            for (sess, bunk), c in sorted(session_bunk_counts.items(), key=lambda x: -x[1])[:10]  # Top 10
        ]

        # ====================================================================
        # New breakdowns for registration tab redesign
        # ====================================================================

        # Gender by grade breakdown (for stacked bar chart)
        gender_grade_stats: dict[int | None, dict[str, int]] = {}
        for pid in enrolled_person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            gender = getattr(person, "gender", "") or ""

            if grade not in gender_grade_stats:
                gender_grade_stats[grade] = {"M": 0, "F": 0, "other": 0}

            if gender == "M":
                gender_grade_stats[grade]["M"] += 1
            elif gender == "F":
                gender_grade_stats[grade]["F"] += 1
            else:
                gender_grade_stats[grade]["other"] += 1

        by_gender_grade = [
            GenderByGradeBreakdown(
                grade=g,
                male_count=stats["M"],
                female_count=stats["F"],
                other_count=stats["other"],
                total=stats["M"] + stats["F"] + stats["other"],
            )
            for g, stats in sorted(gender_grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        # Fetch summer enrollment history for all enrolled persons
        enrollment_history = await fetch_summer_enrollment_history(enrolled_person_ids, year)

        # Compute summer metrics from history
        summer_years_by_person, first_year_by_person, _ = compute_summer_metrics(
            enrollment_history, enrolled_person_ids, year - 1
        )

        # Summer years breakdown (calculated from actual enrollment history)
        summer_years_stats: dict[int, int] = {}
        for pid in enrolled_person_ids:
            years_count = summer_years_by_person.get(pid, 0)
            summer_years_stats[years_count] = summer_years_stats.get(years_count, 0) + 1

        by_summer_years = [
            SummerYearsBreakdown(
                summer_years=y,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for y, c in sorted(summer_years_stats.items())
        ]

        # First summer year breakdown (cohort analysis)
        first_summer_year_stats: dict[int, int] = {}
        for pid in enrolled_person_ids:
            first_year = first_year_by_person.get(pid)
            if first_year is not None:
                first_summer_year_stats[first_year] = first_summer_year_stats.get(first_year, 0) + 1

        by_first_summer_year = [
            FirstSummerYearBreakdown(
                first_summer_year=fy,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for fy, c in sorted(first_summer_year_stats.items())
        ]

        return RegistrationMetricsResponse(
            year=year,
            total_enrolled=total_enrolled,
            total_waitlisted=total_waitlisted,
            total_cancelled=total_cancelled,
            by_gender=by_gender,
            by_grade=by_grade,
            by_session=by_session,
            by_session_length=by_session_length,
            by_years_at_camp=by_years_at_camp,
            new_vs_returning=new_vs_returning,
            # New breakdowns from camper_history
            by_school=by_school,
            by_city=by_city,
            by_synagogue=by_synagogue,
            by_first_year=by_first_year,
            by_session_bunk=by_session_bunk,
            # New breakdowns for registration tab redesign
            by_gender_grade=by_gender_grade,
            by_summer_years=by_summer_years,
            by_first_summer_year=by_first_summer_year,
        )

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
    try:
        # Build list of years to analyze
        years = list(range(current_year - num_years + 1, current_year + 1))

        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Fetch attendees and persons for all years in parallel
        fetch_tasks: list[Coroutine[Any, Any, Any]] = []
        for year in years:
            fetch_tasks.append(fetch_attendees_for_year(year))
            fetch_tasks.append(fetch_persons_for_year(year))
            fetch_tasks.append(fetch_sessions_for_year(year, type_filter))

        results = await asyncio.gather(*fetch_tasks)

        # Unpack results: each year has (attendees, persons, sessions)
        data_by_year: dict[int, dict[str, Any]] = {}
        for i, year in enumerate(years):
            attendees: list[Any] = results[i * 3]
            persons: dict[int, Any] = results[i * 3 + 1]
            sessions: dict[int, Any] = results[i * 3 + 2]

            # Filter attendees by session type
            if type_filter:
                filtered = []
                for a in attendees:
                    expand = getattr(a, "expand", {}) or {}
                    session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                    if session and getattr(session, "session_type", None) in type_filter:
                        filtered.append(a)
                attendees = filtered

            # Filter by specific session if provided
            if session_cm_id is not None:
                filtered = []
                for a in attendees:
                    expand = getattr(a, "expand", {}) or {}
                    session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                    if session and getattr(session, "cm_id", None) == session_cm_id:
                        filtered.append(a)
                attendees = filtered

            data_by_year[year] = {
                "attendees": attendees,
                "persons": persons,
                "sessions": sessions,
                # Ensure int type for person_ids to match persons dict keys
                "person_ids": {int(getattr(a, "person_id", 0)) for a in attendees if getattr(a, "person_id", None)},
            }

        # Calculate retention for each year transition
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

            # Gender breakdown
            gender_stats: dict[str, dict[str, int]] = {}
            for pid in base_person_ids:
                person = persons_base.get(pid)
                if not person:
                    continue
                gender = getattr(person, "gender", "Unknown") or "Unknown"
                if gender not in gender_stats:
                    gender_stats[gender] = {"base": 0, "returned": 0}
                gender_stats[gender]["base"] += 1
                if pid in returned_ids:
                    gender_stats[gender]["returned"] += 1

            by_gender = [
                RetentionByGender(
                    gender=g,
                    base_count=stats["base"],
                    returned_count=stats["returned"],
                    retention_rate=safe_rate(stats["returned"], stats["base"]),
                )
                for g, stats in sorted(gender_stats.items())
            ]

            # Grade breakdown
            grade_stats: dict[int | None, dict[str, int]] = {}
            for pid in base_person_ids:
                person = persons_base.get(pid)
                if not person:
                    continue
                grade = getattr(person, "grade", None)
                if grade not in grade_stats:
                    grade_stats[grade] = {"base": 0, "returned": 0}
                grade_stats[grade]["base"] += 1
                if pid in returned_ids:
                    grade_stats[grade]["returned"] += 1

            by_grade = [
                RetentionByGrade(
                    grade=g,
                    base_count=stats["base"],
                    returned_count=stats["returned"],
                    retention_rate=safe_rate(stats["returned"], stats["base"]),
                )
                for g, stats in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
            ]

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

        # Calculate average retention rate
        rates = [y.retention_rate for y in retention_years]
        avg_rate = sum(rates) / len(rates) if rates else 0.0

        # Determine trend direction
        if len(rates) >= 2:
            # Compare most recent rate to average of prior rates
            current = rates[-1]
            prior_avg = sum(rates[:-1]) / len(rates[:-1]) if len(rates) > 1 else current
            threshold = 0.02  # 2% threshold for "stable"

            if current > prior_avg + threshold:
                trend_direction = "improving"
            elif current < prior_avg - threshold:
                trend_direction = "declining"
            else:
                trend_direction = "stable"
        else:
            trend_direction = "stable"

        # ====================================================================
        # Compute enrollment_by_year for 3-year comparison charts
        # ====================================================================
        enrollment_by_year: list[YearEnrollment] = []
        for year in years:
            year_data = data_by_year[year]
            person_ids = year_data["person_ids"]
            persons = year_data["persons"]
            total = len(person_ids)

            # Diagnostic logging for person lookup
            lookup_failures = sum(1 for pid in person_ids if persons.get(pid) is None)
            if lookup_failures > 0:
                # Sample some failed lookups to help diagnose
                failed_pids = [pid for pid in list(person_ids)[:10] if persons.get(pid) is None]
                persons_keys = list(persons.keys())[:10] if persons else []
                # Log types to detect int vs string mismatch
                failed_types = [type(pid).__name__ for pid in failed_pids[:3]]
                key_types = [type(k).__name__ for k in persons_keys[:3]]
                logger.warning(
                    f"Year {year}: {lookup_failures}/{total} person lookups failed. "
                    f"Failed person_ids (sample): {failed_pids}, types: {failed_types}. "
                    f"Persons dict keys (sample): {persons_keys}, types: {key_types}"
                )

            # Gender breakdown
            gender_counts: dict[str, int] = {}
            for pid in person_ids:
                person = persons.get(pid)
                if not person:
                    continue
                gender = getattr(person, "gender", "Unknown") or "Unknown"
                gender_counts[gender] = gender_counts.get(gender, 0) + 1

            gender_breakdown = [GenderEnrollment(gender=g, count=c) for g, c in sorted(gender_counts.items())]

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
                for g, c in sorted(grade_counts.items(), key=lambda x: (x[0] is None, x[0]))
            ]

            enrollment_by_year.append(
                YearEnrollment(
                    year=year,
                    total=total,
                    by_gender=gender_breakdown,
                    by_grade=grade_breakdown,
                )
            )

        return RetentionTrendsResponse(
            years=retention_years,
            avg_retention_rate=avg_rate,
            trend_direction=trend_direction,
            enrollment_by_year=enrollment_by_year,
        )

    except Exception as e:
        logger.error(f"Error calculating retention trends: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error calculating retention trends: {str(e)}")

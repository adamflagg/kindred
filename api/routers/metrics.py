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
    GenderBreakdown,
    GradeBreakdown,
    NewVsReturning,
    RegistrationMetricsResponse,
    RetentionByGender,
    RetentionByGrade,
    RetentionBySession,
    RetentionByYearsAtCamp,
    RetentionMetricsResponse,
    SessionBreakdown,
    SessionLengthBreakdown,
    YearsAtCampBreakdown,
    YearSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


# ============================================================================
# Helper Functions
# ============================================================================


def get_session_length_category(session_name: str, session_type: str) -> str:
    """Categorize session by length based on name and type.

    Categories:
    - 1-week: Taste of Camp sessions
    - 2-week: Embedded sessions (2a, 3a, etc.) and Session 4
    - 3-week: Main sessions 2 and 3
    """
    # Taste of Camp = 1-week
    if "Taste of Camp" in session_name:
        return "1-week"

    # Embedded sessions = 2-week
    if session_type == "embedded":
        return "2-week"

    # Session 4 = 2-week
    if session_name == "Session 4":
        return "2-week"

    # Session 2, 3 (main) = 3-week
    if session_name in ("Session 2", "Session 3") and session_type == "main":
        return "3-week"

    return "other"


async def fetch_attendees_for_year(year: int, status_filter: str | None = None) -> list[Any]:
    """Fetch attendees for a given year with optional status filter.

    Args:
        year: The year to fetch attendees for.
        status_filter: Optional status filter (e.g., 'enrolled', 'waitlisted').
                      If None, fetches active enrolled (is_active=1 AND status_id=2).

    Returns:
        List of attendee records with session expansion.
    """
    if status_filter == "waitlisted":
        filter_str = f'year = {year} && status = "waitlisted"'
    elif status_filter == "cancelled":
        filter_str = f'year = {year} && status = "cancelled"'
    else:
        # Default: active enrolled
        filter_str = f"year = {year} && is_active = 1 && status_id = 2"

    return await asyncio.to_thread(
        pb.collection("attendees").get_full_list,
        query_params={"filter": filter_str, "expand": "session"},
    )


async def fetch_persons_for_year(year: int) -> dict[int, Any]:
    """Fetch all persons for a given year and return as dict by cm_id."""
    persons = await asyncio.to_thread(
        pb.collection("persons").get_full_list,
        query_params={"filter": f"year = {year}"},
    )
    return {getattr(p, "cm_id", 0): p for p in persons}


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
    return {getattr(s, "cm_id", 0): s for s in sessions}


def calculate_percentage(count: int, total: int) -> float:
    """Calculate percentage, handling division by zero."""
    return (count / total * 100) if total > 0 else 0.0


def safe_rate(numerator: int, denominator: int) -> float:
    """Calculate rate, handling division by zero."""
    return numerator / denominator if denominator > 0 else 0.0


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
        ) = await asyncio.gather(
            fetch_attendees_for_year(base_year),
            fetch_attendees_for_year(compare_year),
            fetch_persons_for_year(base_year),
            fetch_sessions_for_year(base_year, type_filter),
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
            session_cm_id = getattr(session, "cm_id", None) if session else None

            if type_filter and session_cm_id:
                session_type = getattr(session, "session_type", None)
                if session_type not in type_filter:
                    continue

            person_ids_base.add(person_id)
            if person_id not in attendee_sessions:
                attendee_sessions[person_id] = []
            if session_cm_id:
                attendee_sessions[person_id].append(session_cm_id)

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

        by_session = [
            RetentionBySession(
                session_cm_id=sid,
                session_name=getattr(sessions_base.get(sid), "name", f"Session {sid}"),
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for sid, stats in sorted(session_stats.items())
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
        None, description="Comma-separated session types to filter (e.g., 'main,embedded')"
    ),
) -> RegistrationMetricsResponse:
    """Get registration breakdown metrics for a specific year.

    Returns enrollment counts broken down by gender, grade, session,
    session length, years at camp, and new vs returning status.
    """
    try:
        # Parse session types filter
        type_filter = session_types.split(",") if session_types else None

        # Fetch data in parallel
        (
            enrolled_attendees,
            waitlisted_attendees,
            cancelled_attendees,
            persons,
            sessions,
        ) = await asyncio.gather(
            fetch_attendees_for_year(year),
            fetch_attendees_for_year(year, "waitlisted"),
            fetch_attendees_for_year(year, "cancelled"),
            fetch_persons_for_year(year),
            fetch_sessions_for_year(year, type_filter),
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

        enrolled_attendees = filter_by_session_type(enrolled_attendees)

        # Get enrolled person IDs
        enrolled_person_ids = {
            getattr(a, "person_id", None) for a in enrolled_attendees if getattr(a, "person_id", None)
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

        # Session breakdown
        session_counts: dict[int, int] = {}
        for a in enrolled_attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            session_cm_id = getattr(session, "cm_id", None) if session else None
            if session_cm_id:
                session_counts[session_cm_id] = session_counts.get(session_cm_id, 0) + 1

        by_session = [
            SessionBreakdown(
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                count=c,
                capacity=None,  # Would need bunk_plans to calculate
                utilization=None,
            )
            for sid, c in sorted(session_counts.items())
            if sid in sessions
        ]

        # Session length breakdown
        length_counts: dict[str, int] = {}
        for a in enrolled_attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if session:
                session_name = getattr(session, "name", "")
                session_type = getattr(session, "session_type", "")
                length = get_session_length_category(session_name, session_type)
                length_counts[length] = length_counts.get(length, 0) + 1

        by_session_length = [
            SessionLengthBreakdown(
                length_category=length,
                count=c,
                percentage=calculate_percentage(c, total_enrolled),
            )
            for length, c in sorted(
                length_counts.items(),
                key=lambda x: {"1-week": 0, "2-week": 1, "3-week": 2, "other": 3}.get(x[0], 4),
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
) -> ComparisonMetricsResponse:
    """Get year-over-year comparison metrics.

    Compares total enrollment, gender distribution, and grade distribution
    between two years.
    """
    try:
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

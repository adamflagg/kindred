"""Registration service - business logic for registration metrics.

This service moves business logic out of the registration endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    CityBreakdown,
    FirstSummerYearBreakdown,
    FirstYearBreakdown,
    GenderBreakdown,
    GenderByGradeBreakdown,
    GradeBreakdown,
    NewVsReturning,
    RegistrationMetricsResponse,
    SchoolBreakdown,
    SessionBreakdown,
    SessionBunkBreakdown,
    SessionLengthBreakdown,
    SummerYearsBreakdown,
    SynagogueBreakdown,
    YearsAtCampBreakdown,
)
from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES, compute_summer_metrics

from .breakdown_calculator import calculate_percentage

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


def get_session_length_category(start_date: str, end_date: str) -> str:
    """Calculate session length category from actual dates.

    Categories:
    - 1-week: 1-7 days
    - 2-week: 8-14 days
    - 3-week: 15-21 days
    - 4-week+: 22+ days
    - unknown: missing or invalid dates
    """
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


class RegistrationService:
    """Business logic for registration metrics - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def calculate_registration(
        self,
        year: int,
        session_types: list[str] | None = None,
        status_filter: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> RegistrationMetricsResponse:
        """Calculate registration metrics for a year.

        Args:
            year: The year to get metrics for.
            session_types: Optional list of session types to filter.
            status_filter: Optional status filter (default: enrolled).
            session_cm_id: Optional specific session ID to filter.

        Returns:
            RegistrationMetricsResponse with all breakdown metrics.
        """
        import asyncio

        # Default status filter
        if status_filter is None:
            status_filter = ["enrolled"]

        # Fetch sessions first to find AG sessions with matching parent
        sessions = await self.repo.fetch_sessions(year, session_types)
        ag_session_ids = self._find_ag_sessions_for_parent(sessions, session_cm_id)

        # Fetch data in parallel
        (
            requested_attendees,
            enrolled_attendees,
            waitlisted_attendees,
            cancelled_attendees,
            persons,
            camper_history,
        ) = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_attendees(year),  # Default: enrolled
            self.repo.fetch_attendees(year, "waitlisted"),
            self.repo.fetch_attendees(year, "cancelled"),
            self.repo.fetch_persons(year),
            self.repo.fetch_camper_history(year, session_types=session_types),
        )

        # Filter attendees by session
        combined_attendees = self._filter_by_session(requested_attendees, session_types, session_cm_id, ag_session_ids)
        enrolled_attendees = self._filter_by_session(enrolled_attendees, session_types, session_cm_id, ag_session_ids)
        waitlisted_attendees = self._filter_by_session(
            waitlisted_attendees, session_types, session_cm_id, ag_session_ids
        )
        cancelled_attendees = self._filter_by_session(cancelled_attendees, session_types, session_cm_id, ag_session_ids)

        # Get unique person IDs (deduplicated)
        enrolled_person_ids = self._get_person_ids(combined_attendees)
        waitlisted_person_ids = self._get_person_ids(waitlisted_attendees)
        cancelled_person_ids = self._get_person_ids(cancelled_attendees)

        total_enrolled = len(enrolled_person_ids)
        total_waitlisted = len(waitlisted_person_ids)
        total_cancelled = len(cancelled_person_ids)

        # Compute breakdowns
        by_gender = self._compute_gender_breakdown(enrolled_person_ids, persons, total_enrolled)
        by_grade = self._compute_grade_breakdown(enrolled_person_ids, persons, total_enrolled)
        by_session = self._compute_session_breakdown(combined_attendees, sessions)
        by_session_length = self._compute_session_length_breakdown(combined_attendees, total_enrolled)
        by_years_at_camp = self._compute_years_at_camp_breakdown(enrolled_person_ids, persons, total_enrolled)
        new_vs_returning = self._compute_new_vs_returning(enrolled_person_ids, persons, total_enrolled)

        # Demographics from camper_history
        total_history = len(camper_history)
        by_school = self._compute_school_breakdown(camper_history, total_history)
        by_city = self._compute_city_breakdown(camper_history, total_history)
        by_synagogue = self._compute_synagogue_breakdown(camper_history, total_history)
        by_first_year = self._compute_first_year_breakdown(camper_history, total_history)
        by_session_bunk = self._compute_session_bunk_breakdown(camper_history)

        # Gender by grade cross-tabulation
        by_gender_grade = self._compute_gender_by_grade(enrolled_person_ids, persons)

        # Summer enrollment history metrics (uses shared utility)
        enrollment_history = await self.repo.fetch_summer_enrollment_history(enrolled_person_ids, year)
        summer_years_by_person, first_year_by_person = compute_summer_metrics(enrollment_history, enrolled_person_ids)
        by_summer_years = self._build_summer_years_breakdown(summer_years_by_person, total_enrolled)
        by_first_summer_year = self._build_first_summer_year_breakdown(first_year_by_person, total_enrolled)

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
            by_school=by_school,
            by_city=by_city,
            by_synagogue=by_synagogue,
            by_first_year=by_first_year,
            by_session_bunk=by_session_bunk,
            by_gender_grade=by_gender_grade,
            by_summer_years=by_summer_years,
            by_first_summer_year=by_first_summer_year,
        )

    def _find_ag_sessions_for_parent(self, sessions: dict[int, Any], session_cm_id: int | None) -> set[int]:
        """Find AG sessions that belong to a parent session.

        Args:
            sessions: Dictionary of sessions by cm_id.
            session_cm_id: The parent session cm_id to find AG children for.

        Returns:
            Set of AG session cm_ids that have the given parent.
        """
        if session_cm_id is None:
            return set()

        ag_session_ids: set[int] = set()
        for sid, session in sessions.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id == session_cm_id:
                    ag_session_ids.add(sid)
        return ag_session_ids

    def _filter_by_session(
        self,
        attendees: list[Any],
        session_types: list[str] | None,
        session_cm_id: int | None,
        ag_session_ids: set[int],
    ) -> list[Any]:
        """Filter attendees by session type and/or session cm_id.

        Args:
            attendees: List of attendee records.
            session_types: Session types to include.
            session_cm_id: Specific session to filter to.
            ag_session_ids: AG sessions that belong to the parent session.

        Returns:
            Filtered list of attendees.
        """
        filtered = []
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not session:
                continue

            session_type = getattr(session, "session_type", None)
            attendee_session_cm_id = getattr(session, "cm_id", None)

            # Apply session type filter
            if session_types and session_type not in session_types:
                continue

            # Apply session_cm_id filter if specified
            if session_cm_id is not None:
                # Include if matches directly or is an AG session with matching parent
                if attendee_session_cm_id != session_cm_id and attendee_session_cm_id not in ag_session_ids:
                    continue

            filtered.append(a)
        return filtered

    def _get_person_ids(self, attendees: list[Any]) -> set[int]:
        """Extract unique person IDs from attendees.

        Args:
            attendees: List of attendee records.

        Returns:
            Set of unique person IDs.
        """
        return {pid for a in attendees if (pid := getattr(a, "person_id", None)) is not None}

    def _compute_gender_breakdown(
        self, person_ids: set[int], persons: dict[int, Any], total: int
    ) -> list[GenderBreakdown]:
        """Compute gender breakdown."""
        gender_counts: dict[str, int] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            gender = getattr(person, "gender", "Unknown") or "Unknown"
            gender_counts[gender] = gender_counts.get(gender, 0) + 1

        return [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for g, c in sorted(gender_counts.items())
        ]

    def _compute_grade_breakdown(
        self, person_ids: set[int], persons: dict[int, Any], total: int
    ) -> list[GradeBreakdown]:
        """Compute grade breakdown."""
        grade_counts: dict[int | None, int] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            grade_counts[grade] = grade_counts.get(grade, 0) + 1

        return [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for g, c in sorted(grade_counts.items(), key=lambda x: (x[0] is None, x[0]))
        ]

    def _compute_session_breakdown(self, attendees: list[Any], sessions: dict[int, Any]) -> list[SessionBreakdown]:
        """Compute session breakdown with AG merging."""
        session_counts: dict[int, int] = {}
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            attendee_session_cm_id = getattr(session, "cm_id", None) if session else None
            if attendee_session_cm_id:
                sid_int = int(attendee_session_cm_id)
                session_counts[sid_int] = session_counts.get(sid_int, 0) + 1

        # Merge AG session counts into parent main sessions
        merged_counts = self._merge_ag_into_parent_sessions(session_counts, sessions)

        return [
            SessionBreakdown(
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                count=c,
                capacity=None,
                utilization=None,
            )
            for sid, c in sorted(merged_counts.items())
            if sid in sessions
        ]

    def _merge_ag_into_parent_sessions(
        self, session_counts: dict[int, int], sessions: dict[int, Any]
    ) -> dict[int, int]:
        """Merge AG session counts into their parent main sessions."""
        # Build AG -> parent mapping
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

        # Filter to summer program session types (main, embedded, ag, quest)
        return {
            sid: count
            for sid, count in merged_counts.items()
            if sid in sessions and getattr(sessions.get(sid), "session_type", None) in SUMMER_PROGRAM_SESSION_TYPES
        }

    def _compute_session_length_breakdown(self, attendees: list[Any], total: int) -> list[SessionLengthBreakdown]:
        """Compute session length breakdown."""
        length_counts: dict[str, int] = {}
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if session:
                start_date = getattr(session, "start_date", "") or ""
                end_date = getattr(session, "end_date", "") or ""
                length = get_session_length_category(start_date, end_date)
                length_counts[length] = length_counts.get(length, 0) + 1

        return [
            SessionLengthBreakdown(
                length_category=length,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for length, c in sorted(
                length_counts.items(),
                key=lambda x: {"1-week": 0, "2-week": 1, "3-week": 2, "4-week+": 3, "unknown": 4}.get(x[0], 5),
            )
        ]

    def _compute_years_at_camp_breakdown(
        self, person_ids: set[int], persons: dict[int, Any], total: int
    ) -> list[YearsAtCampBreakdown]:
        """Compute years at camp breakdown."""
        years_counts: dict[int, int] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            years = getattr(person, "years_at_camp", 0) or 0
            years_counts[years] = years_counts.get(years, 0) + 1

        return [
            YearsAtCampBreakdown(
                years=y,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for y, c in sorted(years_counts.items())
        ]

    def _compute_new_vs_returning(self, person_ids: set[int], persons: dict[int, Any], total: int) -> NewVsReturning:
        """Compute new vs returning breakdown."""
        new_count = sum(1 for pid in person_ids if persons.get(pid) and getattr(persons[pid], "years_at_camp", 0) == 1)
        returning_count = total - new_count

        return NewVsReturning(
            new_count=new_count,
            returning_count=returning_count,
            new_percentage=calculate_percentage(new_count, total),
            returning_percentage=calculate_percentage(returning_count, total),
        )

    def _compute_school_breakdown(self, camper_history: list[Any], total: int) -> list[SchoolBreakdown]:
        """Compute school breakdown (top 20)."""
        school_counts: dict[str, int] = {}
        for record in camper_history:
            school = getattr(record, "school", "") or ""
            if school:
                school_counts[school] = school_counts.get(school, 0) + 1

        return [
            SchoolBreakdown(
                school=s,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for s, c in sorted(school_counts.items(), key=lambda x: -x[1])[:20]
        ]

    def _compute_city_breakdown(self, camper_history: list[Any], total: int) -> list[CityBreakdown]:
        """Compute city breakdown (top 20)."""
        city_counts: dict[str, int] = {}
        for record in camper_history:
            city = getattr(record, "city", "") or ""
            if city:
                city_counts[city] = city_counts.get(city, 0) + 1

        return [
            CityBreakdown(
                city=c,
                count=cnt,
                percentage=calculate_percentage(cnt, total),
            )
            for c, cnt in sorted(city_counts.items(), key=lambda x: -x[1])[:20]
        ]

    def _compute_synagogue_breakdown(self, camper_history: list[Any], total: int) -> list[SynagogueBreakdown]:
        """Compute synagogue breakdown (top 20)."""
        synagogue_counts: dict[str, int] = {}
        for record in camper_history:
            synagogue = getattr(record, "synagogue", "") or ""
            if synagogue:
                synagogue_counts[synagogue] = synagogue_counts.get(synagogue, 0) + 1

        return [
            SynagogueBreakdown(
                synagogue=s,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for s, c in sorted(synagogue_counts.items(), key=lambda x: -x[1])[:20]
        ]

    def _compute_first_year_breakdown(self, camper_history: list[Any], total: int) -> list[FirstYearBreakdown]:
        """Compute first year attended breakdown."""
        first_year_counts: dict[int, int] = {}
        for record in camper_history:
            first_year = getattr(record, "first_year_attended", None)
            if first_year:
                first_year_counts[first_year] = first_year_counts.get(first_year, 0) + 1

        return [
            FirstYearBreakdown(
                first_year=fy,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for fy, c in sorted(first_year_counts.items())
        ]

    def _compute_session_bunk_breakdown(self, camper_history: list[Any]) -> list[SessionBunkBreakdown]:
        """Compute session+bunk breakdown (top 10)."""
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

        return [
            SessionBunkBreakdown(
                session=sess,
                bunk=bunk,
                count=c,
            )
            for (sess, bunk), c in sorted(session_bunk_counts.items(), key=lambda x: -x[1])[:10]
        ]

    def _compute_gender_by_grade(self, person_ids: set[int], persons: dict[int, Any]) -> list[GenderByGradeBreakdown]:
        """Compute gender by grade cross-tabulation."""
        gender_grade_stats: dict[int | None, dict[str, int]] = {}
        for pid in person_ids:
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

        return [
            GenderByGradeBreakdown(
                grade=g,
                male_count=stats["M"],
                female_count=stats["F"],
                other_count=stats["other"],
                total=stats["M"] + stats["F"] + stats["other"],
            )
            for g, stats in sorted(gender_grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

    def _build_summer_years_breakdown(
        self, summer_years_by_person: dict[int, int], total: int
    ) -> list[SummerYearsBreakdown]:
        """Build summer years breakdown from computed metrics."""
        summer_years_stats: dict[int, int] = {}
        for years_count in summer_years_by_person.values():
            summer_years_stats[years_count] = summer_years_stats.get(years_count, 0) + 1

        return [
            SummerYearsBreakdown(
                summer_years=y,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for y, c in sorted(summer_years_stats.items())
        ]

    def _build_first_summer_year_breakdown(
        self, first_year_by_person: dict[int, int], total: int
    ) -> list[FirstSummerYearBreakdown]:
        """Build first summer year breakdown from computed metrics."""
        first_summer_year_stats: dict[int, int] = {}
        for first_year in first_year_by_person.values():
            first_summer_year_stats[first_year] = first_summer_year_stats.get(first_year, 0) + 1

        return [
            FirstSummerYearBreakdown(
                first_summer_year=fy,
                count=c,
                percentage=calculate_percentage(c, total),
            )
            for fy, c in sorted(first_summer_year_stats.items())
        ]

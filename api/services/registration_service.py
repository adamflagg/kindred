"""Registration service - business logic for registration metrics.

This service moves business logic out of the registration endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, cast

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
    SessionInLengthCategory,
    SessionLengthBreakdown,
    SessionLengthBySessionBreakdown,
    SummerYearsBreakdown,
    SynagogueBreakdown,
    YearsAtCampBreakdown,
)
from api.utils.session_metrics import DISPLAY_SESSION_TYPES, compute_summer_metrics

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
        results = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_attendees(year),  # Default: enrolled
            self.repo.fetch_attendees(year, "waitlisted"),
            self.repo.fetch_attendees(year, "cancelled"),
            self.repo.fetch_persons(year),
            self.repo.fetch_camper_history(year, session_types=session_types),
            self.repo.fetch_bunk_plans(year),
            self.repo.fetch_capacity_config(),
        )
        # Type assertions for asyncio.gather results
        requested_attendees = cast(list[Any], results[0])
        enrolled_attendees = cast(list[Any], results[1])
        waitlisted_attendees = cast(list[Any], results[2])
        cancelled_attendees = cast(list[Any], results[3])
        persons = cast(dict[int, Any], results[4])
        camper_history = cast(list[Any], results[5])
        bunk_plans = cast(list[Any], results[6])
        default_capacity = cast(int, results[7])

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
        by_session = self._compute_session_breakdown(combined_attendees, sessions, bunk_plans, default_capacity)
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

        # Session length by session (stacked bar chart showing sessions per length category)
        by_session_length_by_session = self._compute_session_length_by_session(combined_attendees, sessions)

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
            by_session_length_by_session=by_session_length_by_session,
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

    def _compute_session_breakdown(
        self,
        attendees: list[Any],
        sessions: dict[int, Any],
        bunk_plans: list[Any] | None = None,
        default_capacity: int = 12,
    ) -> list[SessionBreakdown]:
        """Compute session breakdown with AG merging and capacity/utilization.

        Args:
            attendees: List of attendee records with session expand.
            sessions: Dictionary mapping cm_id to session record.
            bunk_plans: Optional list of bunk_plan records with bunk expand.
            default_capacity: Default capacity per bunk (default: 12).

        Returns:
            List of SessionBreakdown with count, capacity, and utilization.
        """
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

        # Calculate capacity per session
        capacity_by_session = (
            self._calculate_session_capacity(sessions, bunk_plans, default_capacity) if bunk_plans is not None else {}
        )

        return [
            SessionBreakdown(
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                count=c,
                capacity=capacity_by_session.get(sid),
                utilization=self._calculate_utilization(c, capacity_by_session.get(sid)),
            )
            for sid, c in sorted(merged_counts.items())
            if sid in sessions
        ]

    def _calculate_session_capacity(
        self,
        sessions: dict[int, Any],
        bunk_plans: list[Any],
        default_capacity: int,
    ) -> dict[int, int | None]:
        """Calculate capacity for each session from bunk_plans.

        Args:
            sessions: Dictionary mapping cm_id to session record.
            bunk_plans: List of bunk_plan records with bunk expand.
            default_capacity: Default capacity per bunk.

        Returns:
            Dictionary mapping session cm_id to total capacity.
        """
        # Build mapping: session PocketBase ID -> cm_id
        pb_to_cm: dict[str, int] = {}
        for cm_id, session in sessions.items():
            pb_id = getattr(session, "id", None)
            if pb_id:
                pb_to_cm[pb_id] = cm_id

        # Build AG -> parent mapping for capacity merging
        ag_parent_map: dict[int, int] = {}
        for sid, session in sessions.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id:
                    ag_parent_map[int(sid)] = int(parent_id)

        # Count bunk_plans per session (respecting AG bunk filtering for main sessions)
        bunk_counts: dict[int, int] = {}
        for bp in bunk_plans:
            session_pb_id = getattr(bp, "session", None)
            if not session_pb_id or session_pb_id not in pb_to_cm:
                continue

            cm_id = pb_to_cm[session_pb_id]
            session = sessions.get(cm_id)
            if not session:
                continue

            # Get bunk gender from expand
            is_ag_bunk = self._is_ag_bunk(bp)
            session_type = getattr(session, "session_type", None)

            # For main sessions, exclude AG bunks (they belong to AG session)
            # For embedded/ag sessions, include all bunks
            if session_type == "main" and is_ag_bunk:
                continue

            bunk_counts[cm_id] = bunk_counts.get(cm_id, 0) + 1

        # Merge AG capacity into parent sessions
        merged_capacity: dict[int, int | None] = {}
        for cm_id in sessions:
            session = sessions[cm_id]
            session_type = getattr(session, "session_type", None)

            # Skip AG sessions (their capacity merges into parent)
            if session_type == "ag" and cm_id in ag_parent_map:
                continue

            # Base capacity for this session
            bunk_count = bunk_counts.get(cm_id, 0)

            # Add AG capacity if this is a main session
            if session_type == "main":
                # Find AG sessions with this as parent and add their capacity
                for ag_cm_id, parent_cm_id in ag_parent_map.items():
                    if parent_cm_id == cm_id:
                        bunk_count += bunk_counts.get(ag_cm_id, 0)

            # Only set capacity if there are bunk_plans
            if bunk_count > 0:
                merged_capacity[cm_id] = bunk_count * default_capacity
            else:
                merged_capacity[cm_id] = None

        return merged_capacity

    def _is_ag_bunk(self, bunk_plan: Any) -> bool:
        """Check if a bunk_plan is for an AG bunk (gender='Mixed').

        Args:
            bunk_plan: Bunk plan record with bunk expand.

        Returns:
            True if the bunk is an AG bunk (Mixed gender).
        """
        expand = getattr(bunk_plan, "expand", {}) or {}
        bunk = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
        if not bunk:
            return False

        gender = getattr(bunk, "gender", "")
        if not gender:
            return False

        gender_lower = gender.lower()
        return gender_lower in ("mixed", "ag", "all-gender", "nb")

    def _calculate_utilization(self, count: int, capacity: int | None) -> float | None:
        """Calculate utilization percentage.

        Args:
            count: Number of enrolled campers.
            capacity: Session capacity.

        Returns:
            Utilization percentage, or None if capacity is None or 0.
        """
        if capacity is None or capacity == 0:
            return None
        return (count / capacity) * 100

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

        # Filter to display session types (main, embedded, ag - excludes quest)
        # Quest sessions count toward summer metrics but don't appear in session breakdowns
        return {
            sid: count
            for sid, count in merged_counts.items()
            if sid in sessions and getattr(sessions.get(sid), "session_type", None) in DISPLAY_SESSION_TYPES
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
        """Compute session+bunk breakdown (top 10).

        V2: Each record has single session_name and bunk_name (no comma parsing needed).
        """
        session_bunk_counts: dict[tuple[str, str], int] = {}
        for record in camper_history:
            # V2: Direct field access (single values per record)
            session = getattr(record, "session_name", "") or ""
            bunk = getattr(record, "bunk_name", "") or ""

            if session and bunk:
                key = (session, bunk)
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
        """Compute gender by grade cross-tabulation.

        Note: Only M/F tracked since CampMinder sex field only has these values.
        """
        gender_grade_stats: dict[int | None, dict[str, int]] = {}
        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = getattr(person, "grade", None)
            gender = getattr(person, "gender", "") or ""

            if grade not in gender_grade_stats:
                gender_grade_stats[grade] = {"M": 0, "F": 0}

            if gender == "M":
                gender_grade_stats[grade]["M"] += 1
            elif gender == "F":
                gender_grade_stats[grade]["F"] += 1
            # Non-M/F values are ignored since CampMinder sex field only has M/F

        return [
            GenderByGradeBreakdown(
                grade=g,
                male_count=stats["M"],
                female_count=stats["F"],
                total=stats["M"] + stats["F"],
            )
            for g, stats in sorted(gender_grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

    def _compute_session_length_by_session(
        self, attendees: list[Any], sessions: dict[int, Any]
    ) -> list[SessionLengthBySessionBreakdown]:
        """Compute session breakdown grouped by length category.

        AG sessions are merged into their parent main sessions.
        """
        # Step 1: Count attendees by session (same as _compute_session_breakdown)
        session_counts: dict[int, int] = {}
        for a in attendees:
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not session:
                continue
            session_cm_id = getattr(session, "cm_id", None)
            if session_cm_id:
                sid = int(session_cm_id)
                session_counts[sid] = session_counts.get(sid, 0) + 1

        # Step 2: Merge AG counts into parent sessions (reuse existing helper)
        merged_counts = self._merge_ag_into_parent_sessions(session_counts, sessions)

        # Step 3: Group by length category
        length_session_counts: dict[str, dict[int, int]] = {}
        for sid, count in merged_counts.items():
            session_obj = sessions.get(sid)
            if not session_obj:
                continue
            start_date = getattr(session_obj, "start_date", "") or ""
            end_date = getattr(session_obj, "end_date", "") or ""
            length = get_session_length_category(start_date, end_date)

            if length not in length_session_counts:
                length_session_counts[length] = {}
            length_session_counts[length][sid] = count

        # Step 4: Build result sorted by length category
        length_order = {"1-week": 0, "2-week": 1, "3-week": 2, "4-week+": 3, "unknown": 4}

        result = []
        for length, session_counts_for_length in sorted(
            length_session_counts.items(), key=lambda x: length_order.get(x[0], 5)
        ):
            session_list = []
            total = 0
            for sid, count in sorted(session_counts_for_length.items()):
                session_obj = sessions.get(sid)
                session_name = getattr(session_obj, "name", f"Session {sid}") if session_obj else f"Session {sid}"
                session_list.append(
                    SessionInLengthCategory(
                        session_name=session_name,
                        session_cm_id=sid,
                        count=count,
                    )
                )
                total += count

            if session_list:
                result.append(
                    SessionLengthBySessionBreakdown(
                        length_category=length,
                        sessions=session_list,
                        total=total,
                    )
                )

        return result

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

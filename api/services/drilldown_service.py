"""Drilldown service - business logic for chart drill-down functionality.

This service enables clicking a chart segment to show matching campers.
It reuses the same filtering logic as RegistrationService but returns
individual attendee records instead of aggregated counts.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from api.schemas.metrics import DrilldownAttendee, DrilldownSession
from api.services.registration_service import get_session_length_category
from api.utils.session_metrics import compute_summer_metrics

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

# Breakdown types that are person-level attributes (should be deduped).
# Session-based breakdowns (session, session_length) remain per-attendee.
PERSON_LEVEL_BREAKDOWNS = frozenset(
    {
        "gender",
        "grade",
        "years_at_camp",
        "returning_status",
        "school",
        "city",
        "synagogue",
        "status",
        "first_summer_year",
        "waitlist_no_enrollment",
        "waitlist_has_enrollment",
        "waitlist_accepted",
        "waitlist_declined",
    }
)

# Waitlist breakdown types that need separate fetching logic
WAITLIST_BREAKDOWNS = frozenset(
    {
        "waitlist_no_enrollment",
        "waitlist_has_enrollment",
        "waitlist_accepted",
        "waitlist_declined",
    }
)


class DrilldownService:
    """Business logic for drilldown - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def get_attendees_for_breakdown(
        self,
        year: int,
        breakdown_type: str,
        breakdown_value: str,
        session_cm_id: int | None = None,
        session_types: list[str] | None = None,
        status_filter: list[str] | None = None,
    ) -> list[DrilldownAttendee]:
        """Get attendees matching a specific breakdown criteria.

        Args:
            year: The year to get attendees for.
            breakdown_type: Type of breakdown (session, gender, grade, school, years_at_camp).
            breakdown_value: The value to filter by (e.g., "F" for gender, "5" for grade).
            session_cm_id: Optional specific session ID to filter.
            session_types: Optional list of session types to filter.
            status_filter: Optional status filter (default: enrolled).

        Returns:
            List of DrilldownAttendee records matching the criteria.
        """
        import asyncio

        # Default status filter
        if status_filter is None:
            status_filter = ["enrolled"]

        # Fetch sessions first to find AG sessions with matching parent
        sessions = await self.repo.fetch_sessions(year, session_types)
        ag_session_ids = self._find_ag_sessions_for_parent(sessions, session_cm_id)

        # Waitlist breakdown types need separate fetching logic
        if breakdown_type in WAITLIST_BREAKDOWNS:
            return await self._handle_waitlist_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                sessions=sessions,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
            )

        # Fetch data in parallel
        attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_persons(year),
        )

        # Filter by session type and/or session_cm_id
        filtered_attendees = self._filter_by_session(attendees, session_types, session_cm_id, ag_session_ids)

        # For first_summer_year breakdown, pre-compute first year for each person
        first_year_by_person: dict[int, int] = {}
        if breakdown_type == "first_summer_year":
            person_ids = {pid for a in filtered_attendees if (pid := getattr(a, "person_id", None)) is not None}
            if person_ids:
                enrollment_history = await self.repo.fetch_summer_enrollment_history(person_ids, year)
                _, first_year_by_person = compute_summer_metrics(enrollment_history, person_ids)

        # Filter by breakdown criteria
        filtered_attendees = self._filter_by_breakdown(
            filtered_attendees,
            persons,
            sessions,
            breakdown_type,
            breakdown_value,
            first_year_by_person,
        )

        # Deduplicate for person-level breakdowns
        person_attendee_groups: dict[int, list[Any]] | None = None
        if breakdown_type in PERSON_LEVEL_BREAKDOWNS:
            groups: dict[int, list[Any]] = {}
            for a in filtered_attendees:
                pid = getattr(a, "person_id", None)
                if pid is not None:
                    groups.setdefault(int(pid), []).append(a)
            filtered_attendees = [g[0] for g in groups.values()]
            person_attendee_groups = groups

        # Build response
        return self._build_response(filtered_attendees, persons, sessions, person_attendee_groups)

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

    def _filter_by_breakdown(
        self,
        attendees: list[Any],
        persons: dict[int, Any],
        sessions: dict[int, Any],
        breakdown_type: str,
        breakdown_value: str,
        first_year_by_person: dict[int, int] | None = None,
    ) -> list[Any]:
        """Filter attendees by the specific breakdown criteria.

        Args:
            attendees: List of attendee records.
            persons: Dictionary of persons by cm_id.
            sessions: Dictionary of sessions by cm_id.
            breakdown_type: Type of breakdown to filter by.
            breakdown_value: Value to match.
            first_year_by_person: Pre-computed first summer year by person_id
                (only populated for first_summer_year breakdown).

        Returns:
            Filtered list of attendees.
        """
        if first_year_by_person is None:
            first_year_by_person = {}
        filtered = []
        for a in attendees:
            person_id = getattr(a, "person_id", None)
            person = persons.get(person_id) if person_id else None

            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)

            if breakdown_type == "gender":
                if person and getattr(person, "gender", None) == breakdown_value:
                    filtered.append(a)

            elif breakdown_type == "grade":
                if breakdown_value == "null":
                    # Special case for null/unknown grade
                    if person and getattr(person, "grade", None) is None:
                        filtered.append(a)
                else:
                    try:
                        grade_int = int(breakdown_value)
                        if person and getattr(person, "grade", None) == grade_int:
                            filtered.append(a)
                    except ValueError:
                        pass

            elif breakdown_type == "session":
                attendee_session_cm_id = getattr(session, "cm_id", None) if session else None
                try:
                    target_session_id = int(breakdown_value)
                    # Also match AG sessions that have this as parent
                    ag_ids = self._find_ag_sessions_for_session(sessions, target_session_id)
                    if attendee_session_cm_id == target_session_id or attendee_session_cm_id in ag_ids:
                        filtered.append(a)
                except ValueError:
                    # Try matching by session name
                    session_name = getattr(session, "name", "") if session else ""
                    if session_name == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "school":
                if person:
                    normalized = getattr(person, "normalized_school", None)
                    if normalized and normalized == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "city":
                if person:
                    normalized = getattr(person, "normalized_city", None)
                    if normalized and normalized == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "synagogue":
                if person:
                    normalized = getattr(person, "normalized_congregation", None)
                    if normalized and normalized == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "years_at_camp":
                try:
                    years_int = int(breakdown_value)
                    if person and getattr(person, "years_at_camp", None) == years_int:
                        filtered.append(a)
                except ValueError:
                    pass

            elif breakdown_type == "status":
                if getattr(a, "status", None) == breakdown_value:
                    filtered.append(a)

            elif breakdown_type == "returning_status":
                if person:
                    years = getattr(person, "years_at_camp", 0)
                    if breakdown_value == "new":
                        if years == 1:
                            filtered.append(a)
                    elif breakdown_value == "returning":
                        if years != 1:
                            filtered.append(a)

            elif breakdown_type == "session_length":
                if session:
                    start_date = getattr(session, "start_date", "") or ""
                    end_date = getattr(session, "end_date", "") or ""
                    length_category = get_session_length_category(start_date, end_date)
                    if length_category == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "first_summer_year":
                pid = int(person_id) if person_id is not None else None
                if pid is not None:
                    first_year = first_year_by_person.get(pid)
                    if first_year is not None and str(first_year) == breakdown_value:
                        filtered.append(a)

        return filtered

    def _find_ag_sessions_for_session(self, sessions: dict[int, Any], session_cm_id: int) -> set[int]:
        """Find AG sessions that have the given session as parent.

        Args:
            sessions: Dictionary of sessions by cm_id.
            session_cm_id: The session cm_id to find AG children for.

        Returns:
            Set of AG session cm_ids.
        """
        ag_ids: set[int] = set()
        for sid, session in sessions.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id == session_cm_id:
                    ag_ids.add(sid)
        return ag_ids

    def _build_response(
        self,
        attendees: list[Any],
        persons: dict[int, Any],
        _sessions: dict[int, Any],
        person_attendee_groups: dict[int, list[Any]] | None = None,
    ) -> list[DrilldownAttendee]:
        """Build the response list from filtered attendees.

        Args:
            attendees: Filtered list of attendee records.
            persons: Dictionary of persons by cm_id.
            _sessions: Dictionary of sessions by cm_id.
            person_attendee_groups: If provided, maps person_id to all their
                attendee records (for building multi-session lists).

        Returns:
            List of DrilldownAttendee records.
        """
        result = []
        for a in attendees:
            person_id_raw = getattr(a, "person_id", None)
            if person_id_raw is None:
                continue
            person_id = int(person_id_raw)
            person = persons.get(person_id)
            if not person:
                continue

            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            session_name = str(getattr(session, "name", "Unknown"))

            years_at_camp = getattr(person, "years_at_camp", None)
            is_returning = years_at_camp is not None and years_at_camp > 1

            # Read city and state from discrete columns (address_city, address_state)
            city = getattr(person, "address_city", None) or None
            state = getattr(person, "address_state", None) or None

            # Build sessions list from all attendee records for this person
            sessions_list: list[DrilldownSession] = []
            if person_attendee_groups and person_id in person_attendee_groups:
                for group_a in person_attendee_groups[person_id]:
                    g_expand = getattr(group_a, "expand", {}) or {}
                    g_session = (
                        g_expand.get("session") if isinstance(g_expand, dict) else getattr(g_expand, "session", None)
                    )
                    if g_session:
                        sessions_list.append(
                            DrilldownSession(
                                session_name=str(getattr(g_session, "name", "Unknown")),
                                session_cm_id=int(getattr(g_session, "cm_id", 0)),
                            )
                        )
            else:
                sessions_list = [DrilldownSession(session_name=session_name, session_cm_id=session_cm_id)]

            result.append(
                DrilldownAttendee(
                    person_id=person_id,
                    first_name=getattr(person, "first_name", ""),
                    last_name=getattr(person, "last_name", ""),
                    preferred_name=getattr(person, "preferred_name", None),
                    grade=getattr(person, "grade", None),
                    gender=getattr(person, "gender", None),
                    age=getattr(person, "age", None),
                    school=getattr(person, "normalized_school", None) or getattr(person, "school", None),
                    city=getattr(person, "normalized_city", None) or city,
                    state=state,
                    years_at_camp=years_at_camp,
                    session_name=session_name,
                    session_cm_id=session_cm_id,
                    status=getattr(a, "status", "enrolled"),
                    is_returning=is_returning,
                    sessions=sessions_list,
                )
            )

        return result

    async def _handle_waitlist_breakdown(
        self,
        year: int,
        breakdown_type: str,
        sessions: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
    ) -> list[DrilldownAttendee]:
        """Handle waitlist-specific breakdown types.

        These need separate fetching logic since they cross-reference
        waitlisted vs enrolled attendees or query status history.

        Args:
            year: The year to get attendees for.
            breakdown_type: One of waitlist_no_enrollment, waitlist_has_enrollment,
                waitlist_accepted, waitlist_declined.
            sessions: Dictionary of sessions by cm_id.
            session_cm_id: Optional session filter.
            session_types: Optional session type filter.
            ag_session_ids: AG sessions for the filtered parent session.

        Returns:
            List of DrilldownAttendee records.
        """
        from api.services.waitlist_service import DECLINED_STATUSES

        persons = await self.repo.fetch_persons(year)

        if breakdown_type in ("waitlist_no_enrollment", "waitlist_has_enrollment"):
            return await self._handle_waitlist_enrollment_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                sessions=sessions,
                persons=persons,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
            )

        # UC3: accepted (waitlisted -> enrolled)
        # UC4: declined (waitlisted -> cancelled/withdrawn/dismissed)
        if breakdown_type == "waitlist_accepted":
            new_statuses = ["enrolled"]
        else:
            new_statuses = list(DECLINED_STATUSES)

        history = await self.repo.fetch_status_history(year, old_status="waitlisted", new_statuses=new_statuses)

        # Deduplicate by person, build DrilldownAttendee from history + persons
        seen_persons: set[int] = set()
        result: list[DrilldownAttendee] = []
        for record in history:
            pid = int(getattr(record, "person_id", 0))
            if not pid or pid in seen_persons:
                continue

            person = persons.get(pid)
            if not person:
                continue

            # Apply session filter
            session_info = self._get_session_from_record(record)
            if session_cm_id is not None and session_info:
                record_sid = int(getattr(session_info, "cm_id", 0))
                if record_sid != session_cm_id and record_sid not in ag_session_ids:
                    continue

            seen_persons.add(pid)

            session_name = getattr(session_info, "name", "Unknown") if session_info else "Unknown"
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0

            years_at_camp = getattr(person, "years_at_camp", None)
            is_returning = years_at_camp is not None and years_at_camp > 1
            city = getattr(person, "address_city", None) or None
            state = getattr(person, "address_state", None) or None

            result.append(
                DrilldownAttendee(
                    person_id=pid,
                    first_name=getattr(person, "first_name", ""),
                    last_name=getattr(person, "last_name", ""),
                    preferred_name=getattr(person, "preferred_name", None),
                    grade=getattr(person, "grade", None),
                    gender=getattr(person, "gender", None),
                    age=getattr(person, "age", None),
                    school=getattr(person, "normalized_school", None) or getattr(person, "school", None),
                    city=getattr(person, "normalized_city", None) or city,
                    state=state,
                    years_at_camp=years_at_camp,
                    session_name=session_name,
                    session_cm_id=session_cmid,
                    status=getattr(record, "new_status", "unknown"),
                    is_returning=is_returning,
                    sessions=[DrilldownSession(session_name=session_name, session_cm_id=session_cmid)],
                )
            )

        return result

    async def _handle_waitlist_enrollment_breakdown(
        self,
        year: int,
        breakdown_type: str,
        sessions: dict[int, Any],
        persons: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
    ) -> list[DrilldownAttendee]:
        """Handle waitlist_no_enrollment and waitlist_has_enrollment breakdowns.

        Fetches waitlisted + enrolled attendees and partitions by enrollment status.
        """
        import asyncio

        from api.services.waitlist_service import SUMMER_SESSION_TYPES

        effective_types = session_types or list(SUMMER_SESSION_TYPES)

        waitlisted_attendees, enrolled_attendees = await asyncio.gather(
            self.repo.fetch_attendees(year, ["waitlisted"]),
            self.repo.fetch_attendees(year, ["enrolled"]),
        )

        # Filter waitlisted by session
        waitlisted_attendees = self._filter_by_session(
            waitlisted_attendees, session_types, session_cm_id, ag_session_ids
        )

        # Build enrolled person_id set (across all summer sessions)
        enrolled_person_ids: set[int] = set()
        for att in enrolled_attendees:
            pid = getattr(att, "person_id", None)
            session_info = self._get_session_from_record(att)
            if pid is not None and session_info:
                session_type = getattr(session_info, "session_type", None)
                if session_type in effective_types:
                    enrolled_person_ids.add(int(pid))

        # Partition and deduplicate by person
        seen_persons: set[int] = set()
        matching_attendees: list[Any] = []
        for att in waitlisted_attendees:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid in seen_persons:
                continue
            seen_persons.add(pid)

            is_enrolled = pid in enrolled_person_ids
            if (
                breakdown_type == "waitlist_no_enrollment"
                and not is_enrolled
                or breakdown_type == "waitlist_has_enrollment"
                and is_enrolled
            ):
                matching_attendees.append(att)

        return self._build_response(matching_attendees, persons, sessions)

    def _get_session_from_record(self, record: Any) -> Any:
        """Extract session from a record's expand dict."""
        expand = getattr(record, "expand", {}) or {}
        if isinstance(expand, dict):
            return expand.get("session")
        return getattr(expand, "session", None)

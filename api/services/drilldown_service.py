"""Drilldown service - business logic for chart drill-down functionality.

This service enables clicking a chart segment to show matching campers.
It reuses the same filtering logic as RegistrationService but returns
individual attendee records instead of aggregated counts.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import DrilldownAttendee, DrilldownSession
from api.services.cancellation_service import CANCELLED_STATUSES
from api.services.extractors import filter_aged_out_attendees
from api.services.waitlist_service import DECLINED_STATUSES
from api.utils.session_metrics import (
    DEFAULT_SUMMER_SESSION_TYPES as SUMMER_SESSION_TYPES,
)
from api.utils.session_metrics import (
    SUMMER_TEEN_TYPES,
    compute_summer_metrics,
    filter_attendees_by_session,
    find_ag_sessions_for_parent,
    get_person_from_expand,
    get_session_from_expand,
    get_session_length_category,
    get_summer_window,
    is_summer_teen_session,
    resolve_duration_sessions,
)

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
        "session_length",
        "first_summer_year",
        "summer_years",
        "waitlist_no_enrollment",
        "waitlist_has_enrollment",
        "waitlist_accepted",
        "waitlist_declined",
        "waitlist_total",
        "waitlist_session_gender",
        "cancellation_total",
        "cancellation_was_enrolled",
        "cancellation_was_waitlisted",
        "cancellation_has_other_sessions",
        "cancellation_no_other_sessions",
        "cancellation_re_enrolled",
    }
)

# Retention card breakdown types (top-level cards on retention overview)
RETENTION_CARD_BREAKDOWNS = frozenset(
    {
        "retention_all",
        "retention_returned",
        "retention_not_returned",
    }
)

# Waitlist breakdown types that need separate fetching logic
WAITLIST_BREAKDOWNS = frozenset(
    {
        "waitlist_no_enrollment",
        "waitlist_has_enrollment",
        "waitlist_accepted",
        "waitlist_declined",
        "waitlist_total",
    }
)

# Cancellation breakdown types that need separate fetching logic
CANCELLATION_BREAKDOWNS = frozenset(
    {
        "cancellation_total",
        "cancellation_was_enrolled",
        "cancellation_was_waitlisted",
        "cancellation_has_other_sessions",
        "cancellation_no_other_sessions",
        "cancellation_re_enrolled",
    }
)


def _get_str_attr(obj: Any, attr: str) -> str | None:
    """Get a string attribute, returning None for empty/non-string values."""
    val = getattr(obj, attr, None)
    return val if isinstance(val, str) and val else None


def _group_enrolled_by_person(
    enrolled_attendees: list[Any],
    effective_types: tuple[str, ...] | list[str],
) -> dict[int, list[Any]]:
    """Group enrolled attendees by person_id, filtering by session type.

    Args:
        enrolled_attendees: List of attendee records with session expand.
        effective_types: Session types to include (e.g., ("main", "embedded", "ag", "quest")).

    Returns:
        Dictionary mapping person_id (int) to list of matching attendee records.
    """
    groups: dict[int, list[Any]] = {}
    for att in enrolled_attendees:
        pid = getattr(att, "person_id", None)
        session_info = get_session_from_expand(att)
        if pid is not None and session_info:
            session_type = getattr(session_info, "session_type", None)
            if session_type in effective_types:
                groups.setdefault(int(pid), []).append(att)
    return groups


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
        compare_year: int | None = None,
        duration: str | None = None,
    ) -> list[DrilldownAttendee]:
        """Get attendees matching a specific breakdown criteria.

        Args:
            year: The year to get attendees for.
            breakdown_type: Type of breakdown (session, gender, grade, school, years_at_camp).
            breakdown_value: The value to filter by (e.g., "F" for gender, "5" for grade).
            session_cm_id: Optional specific session ID to filter.
            session_types: Optional list of session types to filter.
            status_filter: Optional status filter (default: enrolled).
            compare_year: Optional compare year for retention drilldowns. When set,
                is_returning is based on whether the person returned to the compare year.

        Returns:
            List of DrilldownAttendee records matching the criteria.
        """
        # Default status filter
        if status_filter is None:
            status_filter = ["enrolled"]

        # Fetch sessions first to find AG sessions with matching parent
        sessions = await self.repo.fetch_sessions(year, session_types)
        ag_session_ids = find_ag_sessions_for_parent(sessions, session_cm_id)
        duration_session_ids = resolve_duration_sessions(sessions, duration) if duration else None

        # Retention card breakdowns (top cards: all, returned, not_returned)
        if breakdown_type in RETENTION_CARD_BREAKDOWNS and compare_year is not None:
            return await self._handle_retention_card_breakdown(
                year=year,
                compare_year=compare_year,
                card_type=breakdown_type,
                sessions=sessions,
                session_types=session_types,
                status_filter=status_filter,
                duration_session_ids=duration_session_ids,
            )

        # retention_session needs special handling - different from other breakdowns
        if breakdown_type == "retention_session" and compare_year is not None:
            return await self._handle_retention_session_breakdown(
                year=year,
                compare_year=compare_year,
                target_session_cm_id=int(breakdown_value),
                sessions=sessions,
                session_types=session_types,
                status_filter=status_filter,
                duration_session_ids=duration_session_ids,
            )

        # Cancellation breakdown types need separate fetching logic
        if breakdown_type in CANCELLATION_BREAKDOWNS:
            return await self._handle_cancellation_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                breakdown_value=breakdown_value,
                sessions=sessions,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
                duration_session_ids=duration_session_ids,
            )

        # Availability chart waitlist drilldown
        if breakdown_type == "waitlist_session_gender":
            return await self._handle_waitlist_session_gender(
                year=year,
                breakdown_value=breakdown_value,
                sessions=sessions,
                session_types=session_types,
                duration_session_ids=duration_session_ids,
            )

        # Teen program (SCIT/TLI) availability waitlist drilldown. Teen rows
        # carry session_cm_id=0, so we resolve the teen *type* to its real,
        # window-gated session cm_ids here instead of matching a single id.
        if breakdown_type == "waitlist_teen_program":
            return await self._handle_waitlist_teen_program(
                year=year,
                breakdown_value=breakdown_value,
                sessions=sessions,
                session_types=session_types,
                duration_session_ids=duration_session_ids,
            )

        # Waitlist breakdown types need separate fetching logic
        if breakdown_type in WAITLIST_BREAKDOWNS:
            return await self._handle_waitlist_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                breakdown_value=breakdown_value,
                sessions=sessions,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
                duration_session_ids=duration_session_ids,
            )

        # Person-level breakdowns with waitlisted status need special handling
        # to show all waitlisted sessions and enrolled sessions (like waitlist_total does)
        if (
            breakdown_type in PERSON_LEVEL_BREAKDOWNS
            and breakdown_type not in WAITLIST_BREAKDOWNS
            and status_filter == ["waitlisted"]
        ):
            return await self._handle_waitlist_person_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                breakdown_value=breakdown_value,
                sessions=sessions,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
                duration_session_ids=duration_session_ids,
            )

        # Fetch data in parallel
        attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_persons(year),
        )

        # Exclude aged-out persons when in retention context
        if compare_year is not None:
            attendees = filter_aged_out_attendees(attendees, persons)

        # Filter by session type and/or session_cm_id
        filtered_attendees = filter_attendees_by_session(
            attendees,
            session_types,
            session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

        # For first_summer_year or summer_years breakdown, pre-compute metrics
        first_year_by_person: dict[int, int] = {}
        summer_years_by_person: dict[int, int] = {}
        if breakdown_type in ("first_summer_year", "summer_years"):
            person_ids = {pid for a in filtered_attendees if (pid := getattr(a, "person_id", None)) is not None}
            if person_ids:
                enrollment_history = await self.repo.fetch_summer_enrollment_history(person_ids, year)
                summer_years_by_person, first_year_by_person = compute_summer_metrics(enrollment_history, person_ids)

        # Filter by breakdown criteria
        filtered_attendees = self._filter_by_breakdown(
            filtered_attendees,
            persons,
            sessions,
            breakdown_type,
            breakdown_value,
            first_year_by_person,
            summer_years_by_person,
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

        # When compare_year is set, compute returned_person_ids and enrolled_attendee_groups
        returned_person_ids: set[int] | None = None
        enrolled_attendee_groups: dict[int, list[Any]] | None = None
        if compare_year is not None:
            compare_attendees = await self.repo.fetch_attendees(compare_year, ["enrolled"])
            returned_person_ids = set()
            enrolled_attendee_groups = {}
            for a in compare_attendees:
                pid = getattr(a, "person_id", None)
                if pid is not None:
                    pid_int = int(pid)
                    returned_person_ids.add(pid_int)
                    if self._matches_session_types(a, session_types):
                        enrolled_attendee_groups.setdefault(pid_int, []).append(a)

        # Build response
        return self._build_response(
            filtered_attendees,
            persons,
            sessions,
            person_attendee_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
            returned_person_ids=returned_person_ids,
        )

    def _matches_session_types(self, attendee: Any, session_types: list[str] | None) -> bool:
        """Check if an attendee's session matches the allowed session types.

        Args:
            attendee: Attendee record with expand.session.
            session_types: Allowed session types, or None to match all.

        Returns:
            True if session type matches or no filter is applied.
        """
        if not session_types:
            return True
        session = get_session_from_expand(attendee)
        if not session:
            return False
        return getattr(session, "session_type", None) in session_types

    def _filter_by_breakdown(
        self,
        attendees: list[Any],
        persons: dict[int, Any],
        sessions: dict[int, Any],
        breakdown_type: str,
        breakdown_value: str,
        first_year_by_person: dict[int, int] | None = None,
        summer_years_by_person: dict[int, int] | None = None,
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
            summer_years_by_person: Pre-computed summer years count by person_id
                (only populated for summer_years breakdown).

        Returns:
            Filtered list of attendees.
        """
        if first_year_by_person is None:
            first_year_by_person = {}
        if summer_years_by_person is None:
            summer_years_by_person = {}
        filtered = []
        for a in attendees:
            person_id = getattr(a, "person_id", None)
            person = persons.get(person_id) if person_id else None

            session = get_session_from_expand(a)

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
                    ag_ids = find_ag_sessions_for_parent(sessions, target_session_id)
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
                    # Resolve AG sessions to parent for length classification
                    resolved_session = session
                    session_cm_id_val = getattr(session, "cm_id", None)
                    if getattr(session, "session_type", None) == "ag":
                        parent_id = getattr(session, "parent_id", None)
                        if parent_id and int(parent_id) in sessions:
                            resolved_session = sessions[int(parent_id)]
                    elif session_cm_id_val and int(session_cm_id_val) in sessions:
                        resolved_session = sessions[int(session_cm_id_val)]
                    start_date = getattr(resolved_session, "start_date", "") or ""
                    end_date = getattr(resolved_session, "end_date", "") or ""
                    length_category = get_session_length_category(start_date, end_date)
                    if length_category == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "first_summer_year":
                pid = int(person_id) if person_id is not None else None
                if pid is not None:
                    first_year = first_year_by_person.get(pid)
                    if first_year is not None and str(first_year) == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "summer_years":
                pid = int(person_id) if person_id is not None else None
                if pid is not None:
                    sy = summer_years_by_person.get(pid)
                    if sy is not None and str(sy) == breakdown_value:
                        filtered.append(a)

        return filtered

    async def _handle_retention_session_breakdown(
        self,
        year: int,
        compare_year: int,
        target_session_cm_id: int,
        sessions: dict[int, Any],
        session_types: list[str] | None,
        status_filter: list[str],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle retention_session breakdown - find base year campers who returned to a specific compare year session.

        Args:
            year: Base year (the year whose attendees we return).
            compare_year: Compare year (where we look for returnees).
            target_session_cm_id: The compare year session cm_id to filter by.
            sessions: Base year sessions dict.
            session_types: Session type filter.
            status_filter: Status filter for attendees.
            duration_session_ids: Optional set of session cm_ids matching the duration filter.

        Returns:
            List of DrilldownAttendee records from the base year.
        """
        # Fetch base year + compare year attendees and persons in parallel
        base_attendees, compare_attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_attendees(compare_year, ["enrolled"]),
            self.repo.fetch_persons(year),
        )

        # Exclude aged-out persons from retention drilldowns
        base_attendees = filter_aged_out_attendees(base_attendees, persons)

        # Apply duration filter to base year attendees
        base_attendees = filter_attendees_by_session(base_attendees, session_types, session_cm_ids=duration_session_ids)

        # Find compare year person_ids enrolled in the target session
        target_person_ids: set[int] = set()
        returned_person_ids: set[int] = set()
        enrolled_attendee_groups: dict[int, list[Any]] = {}
        for a in compare_attendees:
            pid = getattr(a, "person_id", None)
            if pid is None:
                continue
            pid_int = int(pid)
            returned_person_ids.add(pid_int)
            if self._matches_session_types(a, session_types):
                enrolled_attendee_groups.setdefault(pid_int, []).append(a)
            session = get_session_from_expand(a)
            if session:
                sid = getattr(session, "cm_id", None)
                if sid is not None and int(sid) == target_session_cm_id:
                    target_person_ids.add(pid_int)

        # Filter base year attendees to those who returned to the target session
        filtered: list[Any] = []
        seen_persons: set[int] = set()
        person_attendee_groups: dict[int, list[Any]] = {}
        for a in base_attendees:
            pid = getattr(a, "person_id", None)
            if pid is None:
                continue
            pid_int = int(pid)
            # Build groups for base year attendees matching target, filtered by session type
            if pid_int in target_person_ids:
                if self._matches_session_types(a, session_types):
                    person_attendee_groups.setdefault(pid_int, []).append(a)
                if pid_int not in seen_persons:
                    seen_persons.add(pid_int)
                    filtered.append(a)

        return self._build_response(
            filtered,
            persons,
            sessions,
            person_attendee_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
            returned_person_ids=returned_person_ids,
        )

    async def _handle_retention_card_breakdown(
        self,
        year: int,
        compare_year: int,
        card_type: str,
        sessions: dict[int, Any],
        session_types: list[str] | None,
        status_filter: list[str],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle retention top-card drilldowns (all, returned, not_returned).

        Args:
            year: Base year.
            compare_year: Compare year.
            card_type: One of retention_all, retention_returned, retention_not_returned.
            sessions: Base year sessions dict.
            session_types: Session type filter.
            status_filter: Status filter for attendees.
            duration_session_ids: Optional set of session cm_ids matching the duration filter.

        Returns:
            List of DrilldownAttendee records from the base year.
        """
        base_attendees, compare_attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, status_filter),
            self.repo.fetch_attendees(compare_year, ["enrolled"]),
            self.repo.fetch_persons(year),
        )

        # Exclude aged-out persons from retention drilldowns
        base_attendees = filter_aged_out_attendees(base_attendees, persons)

        # Apply duration filter to base year attendees
        base_attendees = filter_attendees_by_session(base_attendees, session_types, session_cm_ids=duration_session_ids)

        # Build returned_person_ids and enrolled_attendee_groups from compare year
        returned_person_ids: set[int] = set()
        enrolled_attendee_groups: dict[int, list[Any]] = {}
        for a in compare_attendees:
            pid = getattr(a, "person_id", None)
            if pid is not None:
                pid_int = int(pid)
                returned_person_ids.add(pid_int)
                if self._matches_session_types(a, session_types):
                    enrolled_attendee_groups.setdefault(pid_int, []).append(a)

        # Deduplicate base year by person, build groups for sessions list
        seen_persons: set[int] = set()
        filtered: list[Any] = []
        person_attendee_groups: dict[int, list[Any]] = {}
        for a in base_attendees:
            pid = getattr(a, "person_id", None)
            if pid is None:
                continue
            pid_int = int(pid)
            if self._matches_session_types(a, session_types):
                person_attendee_groups.setdefault(pid_int, []).append(a)

            if pid_int in seen_persons:
                continue
            seen_persons.add(pid_int)

            # Filter based on card type
            if card_type == "retention_all":
                filtered.append(a)
            elif card_type == "retention_returned":
                if pid_int in returned_person_ids:
                    filtered.append(a)
            elif card_type == "retention_not_returned":
                if pid_int not in returned_person_ids:
                    filtered.append(a)

        return self._build_response(
            filtered,
            persons,
            sessions,
            person_attendee_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
            returned_person_ids=returned_person_ids,
        )

    def _build_response(
        self,
        attendees: list[Any],
        persons: dict[int, Any],
        _sessions: dict[int, Any],
        person_attendee_groups: dict[int, list[Any]] | None = None,
        enrolled_attendee_groups: dict[int, list[Any]] | None = None,
        returned_person_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Build the response list from filtered attendees.

        Args:
            attendees: Filtered list of attendee records.
            persons: Dictionary of persons by cm_id.
            _sessions: Dictionary of sessions by cm_id.
            person_attendee_groups: If provided, maps person_id to all their
                attendee records (for building multi-session lists).
            enrolled_attendee_groups: If provided, maps person_id to their
                enrolled attendee records (for populating enrolled_sessions).
            returned_person_ids: If provided, determines is_returning based on
                membership in this set instead of years_at_camp > 1.

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

            session = get_session_from_expand(a)
            if not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            session_name = str(getattr(session, "name", "Unknown"))

            years_at_camp = getattr(person, "years_at_camp", None)
            if returned_person_ids is not None:
                is_returning = person_id in returned_person_ids
            else:
                is_returning = years_at_camp is not None and years_at_camp > 1

            # Read city and state from discrete columns (address_city, address_state)
            city = getattr(person, "address_city", None) or None
            state = getattr(person, "address_state", None) or None

            # Build sessions list from all attendee records for this person
            sessions_list: list[DrilldownSession] = []
            if person_attendee_groups and person_id in person_attendee_groups:
                for group_a in person_attendee_groups[person_id]:
                    g_session = get_session_from_expand(group_a)
                    if g_session:
                        sessions_list.append(
                            DrilldownSession(
                                session_name=str(getattr(g_session, "name", "Unknown")),
                                session_cm_id=int(getattr(g_session, "cm_id", 0)),
                            )
                        )
            else:
                sessions_list = [DrilldownSession(session_name=session_name, session_cm_id=session_cm_id)]

            # Build enrolled_sessions list from enrolled attendee records
            enrolled_sessions_list: list[DrilldownSession] = []
            if enrolled_attendee_groups and person_id in enrolled_attendee_groups:
                for enrolled_a in enrolled_attendee_groups[person_id]:
                    e_session = get_session_from_expand(enrolled_a)
                    if e_session:
                        enrolled_sessions_list.append(
                            DrilldownSession(
                                session_name=str(getattr(e_session, "name", "Unknown")),
                                session_cm_id=int(getattr(e_session, "cm_id", 0)),
                            )
                        )

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
                    enrollment_date=_get_str_attr(a, "enrollment_date"),
                    effective_date=_get_str_attr(a, "effective_date"),
                    session_name=session_name,
                    session_cm_id=session_cm_id,
                    status=getattr(a, "status", "enrolled"),
                    is_returning=is_returning,
                    sessions=sessions_list,
                    enrolled_sessions=enrolled_sessions_list,
                )
            )

        return result

    async def _handle_waitlist_breakdown(
        self,
        year: int,
        breakdown_type: str,
        breakdown_value: str,
        sessions: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle waitlist-specific breakdown types.

        These need separate fetching logic since they cross-reference
        waitlisted vs enrolled attendees or query status history.

        Args:
            year: The year to get attendees for.
            breakdown_type: One of waitlist_no_enrollment, waitlist_has_enrollment,
                waitlist_accepted, waitlist_declined, waitlist_total.
            breakdown_value: The breakdown value (used for session filtering in waitlist_total).
            sessions: Dictionary of sessions by cm_id.
            session_cm_id: Optional session filter.
            session_types: Optional session type filter.
            ag_session_ids: AG sessions for the filtered parent session.
            duration_session_ids: Optional set of session cm_ids matching the duration filter.

        Returns:
            List of DrilldownAttendee records.
        """
        persons = await self.repo.fetch_persons(year)

        if breakdown_type in ("waitlist_no_enrollment", "waitlist_has_enrollment", "waitlist_total"):
            return await self._handle_waitlist_enrollment_breakdown(
                year=year,
                breakdown_type=breakdown_type,
                breakdown_value=breakdown_value,
                sessions=sessions,
                persons=persons,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
                duration_session_ids=duration_session_ids,
            )

        # UC3: accepted (waitlisted -> enrolled)
        # UC4: declined (waitlisted -> cancelled/withdrawn/dismissed)
        if breakdown_type == "waitlist_accepted":
            new_statuses = ["enrolled"]
        else:
            new_statuses = list(DECLINED_STATUSES)

        effective_types = session_types or list(SUMMER_SESSION_TYPES)

        all_relevant_statuses = [*list(DECLINED_STATUSES), "enrolled", "waitlisted"]

        history, enrolled_attendees, all_attendees = await asyncio.gather(
            self.repo.fetch_status_history(year, old_status="waitlisted", new_statuses=new_statuses),
            self.repo.fetch_attendees(year, ["enrolled"]),
            self.repo.fetch_attendees(year, all_relevant_statuses),
        )

        # Build person_id -> earliest enrollment_date and effective_date lookups
        enrollment_date_lookup: dict[int, str] = {}
        effective_date_lookup: dict[int, str] = {}
        for att in all_attendees:
            pid = getattr(att, "person_id", None)
            if pid is None:
                continue
            pid_int = int(pid)
            edate = _get_str_attr(att, "enrollment_date")
            if edate:
                if pid_int not in enrollment_date_lookup or edate < enrollment_date_lookup[pid_int]:
                    enrollment_date_lookup[pid_int] = edate
            eff_date = _get_str_attr(att, "effective_date")
            if eff_date:
                if pid_int not in effective_date_lookup or eff_date < effective_date_lookup[pid_int]:
                    effective_date_lookup[pid_int] = eff_date

        # Build enrolled groups for enrolled_sessions population
        enrolled_attendee_groups = _group_enrolled_by_person(enrolled_attendees, effective_types)

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
            session_info = get_session_from_expand(record)
            if session_info:
                record_sid = int(getattr(session_info, "cm_id", 0))
                if session_cm_id is not None and record_sid != session_cm_id and record_sid not in ag_session_ids:
                    continue
                if duration_session_ids is not None and record_sid not in duration_session_ids:
                    continue

            seen_persons.add(pid)

            session_name = getattr(session_info, "name", "Unknown") if session_info else "Unknown"
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0

            years_at_camp = getattr(person, "years_at_camp", None)
            is_returning = years_at_camp is not None and years_at_camp > 1
            city = getattr(person, "address_city", None) or None
            state = getattr(person, "address_state", None) or None

            # Build enrolled_sessions for this person
            enrolled_sessions_list: list[DrilldownSession] = []
            for enrolled_a in enrolled_attendee_groups.get(pid, []):
                e_session = get_session_from_expand(enrolled_a)
                if e_session:
                    enrolled_sessions_list.append(
                        DrilldownSession(
                            session_name=str(getattr(e_session, "name", "Unknown")),
                            session_cm_id=int(getattr(e_session, "cm_id", 0)),
                        )
                    )

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
                    enrollment_date=enrollment_date_lookup.get(pid),
                    effective_date=effective_date_lookup.get(pid),
                    session_name=session_name,
                    session_cm_id=session_cmid,
                    status=getattr(record, "new_status", "unknown"),
                    is_returning=is_returning,
                    sessions=[DrilldownSession(session_name=session_name, session_cm_id=session_cmid)],
                    enrolled_sessions=enrolled_sessions_list,
                )
            )

        return result

    async def _handle_waitlist_enrollment_breakdown(
        self,
        year: int,
        breakdown_type: str,
        breakdown_value: str,
        sessions: dict[int, Any],
        persons: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle waitlist_no_enrollment, waitlist_has_enrollment, and waitlist_total breakdowns.

        Fetches waitlisted + enrolled attendees and partitions by enrollment status.
        For waitlist_total, returns all waitlisted (UC1 + UC2 combined).
        """
        effective_types = session_types or list(SUMMER_SESSION_TYPES)

        waitlisted_attendees, enrolled_attendees = await asyncio.gather(
            self.repo.fetch_attendees(year, ["waitlisted"]),
            self.repo.fetch_attendees(year, ["enrolled"]),
        )

        # For waitlist_total with a numeric session filter, override session_cm_id
        effective_session_cm_id = session_cm_id
        if breakdown_type == "waitlist_total" and breakdown_value != "all":
            try:
                effective_session_cm_id = int(breakdown_value)
            except ValueError:
                pass

        # Build waitlisted groups by person, then filter to summer/requested session types.
        # The "Waitlisted For" column shows all matching sessions a person is waitlisted for,
        # not just the one clicked in the drilldown, but limited to the active session types.
        all_waitlisted_groups: dict[int, list[Any]] = {}
        for att in waitlisted_attendees:
            pid = int(getattr(att, "person_id", 0))
            if pid:
                all_waitlisted_groups.setdefault(pid, []).append(att)

        valid_sessions = await self.repo.fetch_sessions(year, effective_types)
        valid_session_ids = set(valid_sessions.keys())
        for pid in all_waitlisted_groups:
            all_waitlisted_groups[pid] = [
                att
                for att in all_waitlisted_groups[pid]
                if int(getattr(get_session_from_expand(att), "cm_id", 0)) in valid_session_ids
            ]

        # Filter waitlisted by session (controls which persons appear in results)
        waitlisted_attendees = filter_attendees_by_session(
            waitlisted_attendees,
            session_types,
            effective_session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

        # Build enrolled person groups: person_id -> list of enrolled attendee records
        enrolled_attendee_groups = _group_enrolled_by_person(enrolled_attendees, effective_types)
        enrolled_person_ids = set(enrolled_attendee_groups.keys())

        # Partition and deduplicate by person
        seen_persons: set[int] = set()
        matching_attendees: list[Any] = []
        for att in waitlisted_attendees:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid in seen_persons:
                continue
            seen_persons.add(pid)

            is_enrolled = pid in enrolled_person_ids
            if breakdown_type == "waitlist_total":
                # Return all waitlisted (UC1 + UC2)
                matching_attendees.append(att)
            elif (breakdown_type == "waitlist_no_enrollment" and not is_enrolled) or (
                breakdown_type == "waitlist_has_enrollment" and is_enrolled
            ):
                matching_attendees.append(att)

        return self._build_response(
            matching_attendees,
            persons,
            sessions,
            person_attendee_groups=all_waitlisted_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
        )

    async def _handle_waitlist_session_gender(
        self,
        year: int,
        breakdown_value: str,
        sessions: dict[int, Any],
        session_types: list[str] | None,
        duration_session_ids: set[int] | None,
    ) -> list[DrilldownAttendee]:
        """Handle waitlist drilldown filtered by session + gender + optional grade.

        breakdown_value format: "session_cm_id:gender[:grade]"
        Examples: "1001:F", "2001:", "1001:F:6"
        """
        # Parse "session_cm_id:gender[:grade]" format
        parts = breakdown_value.split(":")
        try:
            target_session = int(parts[0])
        except ValueError, IndexError:
            return []
        target_gender = parts[1] if len(parts) > 1 and parts[1] else None
        target_grade = int(parts[2]) if len(parts) > 2 and parts[2] else None

        return await self._collect_waitlisted_drilldown(
            year=year,
            match_cm_ids={target_session},
            target_gender=target_gender,
            target_grade=target_grade,
            session_types=session_types,
        )

    async def _handle_waitlist_teen_program(
        self,
        year: int,
        breakdown_value: str,
        sessions: dict[int, Any],
        session_types: list[str] | None,
        duration_session_ids: set[int] | None,
    ) -> list[DrilldownAttendee]:
        """Handle SCIT/TLI availability waitlist drilldown.

        Teen availability rows are aggregated under session_cm_id=0, so the
        clicked identity is the teen *type* (scit/tli), not a session id.
        Resolve it to the real, window-gated teen session cm_ids (matching how
        the availability row was built) before collecting waitlisted attendees.

        breakdown_value format: "<teen_type>[:grade]"  (e.g. "scit", "tli:12")
        """
        parts = breakdown_value.split(":")
        teen_type = parts[0] if parts else ""
        if teen_type not in SUMMER_TEEN_TYPES:
            return []
        target_grade = int(parts[1]) if len(parts) > 1 and parts[1] else None

        window = get_summer_window(sessions)
        match_cm_ids = {
            int(sid)
            for sid, s in sessions.items()
            if getattr(s, "session_type", "") == teen_type and is_summer_teen_session(s, window)
        }
        if not match_cm_ids:
            return []

        # Teen sessions may not be in session_types; ensure they're treated as
        # valid lookup targets so the "Waitlisted For" column shows them.
        return await self._collect_waitlisted_drilldown(
            year=year,
            match_cm_ids=match_cm_ids,
            target_gender=None,
            target_grade=target_grade,
            session_types=session_types,
            extra_lookup_cm_ids=match_cm_ids,
        )

    async def _collect_waitlisted_drilldown(
        self,
        year: int,
        match_cm_ids: set[int],
        target_gender: str | None,
        target_grade: int | None,
        session_types: list[str] | None,
        extra_lookup_cm_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Collect waitlisted attendees for a set of session cm_ids.

        Shared by the single-session (waitlist_session_gender) and teen-program
        (waitlist_teen_program) drilldowns. An attendee matches when its session
        cm_id is in match_cm_ids and it passes the optional gender/grade filters.
        """
        # Fetch waitlisted and enrolled attendees in parallel
        waitlisted_attendees, enrolled_attendees = await asyncio.gather(
            self.repo.fetch_attendees_with_persons(year, status_filter=["waitlisted"]),
            self.repo.fetch_attendees_with_persons(year, status_filter=["enrolled"]),
        )

        # Build set of valid session cm_ids for filtering
        effective_types = session_types or list(SUMMER_SESSION_TYPES)
        summer_sessions = await self.repo.fetch_sessions(year, effective_types)
        summer_session_ids = set(summer_sessions.keys())
        if extra_lookup_cm_ids:
            summer_session_ids |= extra_lookup_cm_ids

        # Build enrolled sessions lookup: person_id -> list of enrolled summer session names
        enrolled_by_person: dict[int, list[DrilldownSession]] = {}
        for att in enrolled_attendees:
            person = get_person_from_expand(att)
            session = get_session_from_expand(att)
            if not person or not session:
                continue
            scmid = int(getattr(session, "cm_id", 0))
            if scmid not in summer_session_ids:
                continue
            pid = int(getattr(person, "cm_id", 0))
            if pid not in enrolled_by_person:
                enrolled_by_person[pid] = []
            enrolled_by_person[pid].append(
                DrilldownSession(
                    session_name=str(getattr(session, "name", "Unknown")),
                    session_cm_id=scmid,
                )
            )

        # Build waitlisted sessions lookup: person_id -> summer sessions they're waitlisted for
        waitlisted_by_person: dict[int, list[DrilldownSession]] = {}
        for att in waitlisted_attendees:
            person = get_person_from_expand(att)
            session = get_session_from_expand(att)
            if not person or not session:
                continue
            scmid = int(getattr(session, "cm_id", 0))
            if scmid not in summer_session_ids:
                continue
            pid = int(getattr(person, "cm_id", 0))
            if pid not in waitlisted_by_person:
                waitlisted_by_person[pid] = []
            waitlisted_by_person[pid].append(
                DrilldownSession(
                    session_name=str(getattr(session, "name", "Unknown")),
                    session_cm_id=int(getattr(session, "cm_id", 0)),
                )
            )

        # Filter waitlisted attendees for target session/gender/grade
        results = []
        seen_persons: set[int] = set()
        for att in waitlisted_attendees:
            person = get_person_from_expand(att)
            session = get_session_from_expand(att)
            if not person or not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            if session_cm_id not in match_cm_ids:
                continue

            gender = getattr(person, "gender", "")
            if target_gender and gender != target_gender:
                continue

            if target_grade is not None and getattr(person, "grade", None) != target_grade:
                continue

            pid = int(getattr(person, "cm_id", 0))
            if pid in seen_persons:
                continue
            seen_persons.add(pid)

            years_at_camp = getattr(person, "years_at_camp", None)

            results.append(
                DrilldownAttendee(
                    person_id=pid,
                    first_name=str(getattr(person, "first_name", "")),
                    last_name=str(getattr(person, "last_name", "")),
                    preferred_name=_get_str_attr(person, "preferred_name"),
                    grade=getattr(person, "grade", None),
                    gender=gender,
                    age=getattr(person, "age", None),
                    school=_get_str_attr(person, "normalized_school") or _get_str_attr(person, "school"),
                    city=_get_str_attr(person, "normalized_city") or _get_str_attr(person, "address_city"),
                    state=_get_str_attr(person, "address_state"),
                    years_at_camp=years_at_camp,
                    session_cm_id=session_cm_id,
                    session_name=str(getattr(session, "name", "Unknown")),
                    status="waitlisted",
                    is_returning=bool(years_at_camp and years_at_camp > 1),
                    effective_date=_get_str_attr(att, "effective_date"),
                    enrollment_date=_get_str_attr(att, "enrollment_date"),
                    sessions=waitlisted_by_person.get(pid, []),
                    enrolled_sessions=enrolled_by_person.get(pid, []),
                )
            )

        # Sort by waitlist position: effective_date ASC, enrollment_date ASC
        results.sort(key=lambda a: (a.effective_date or "", a.enrollment_date or ""))
        return results

    async def _handle_waitlist_person_breakdown(
        self,
        year: int,
        breakdown_type: str,
        breakdown_value: str,
        sessions: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle person-level breakdowns (grade, gender, etc.) with waitlisted status.

        The generic path only fetches waitlisted attendees and builds
        person_attendee_groups from the session-filtered set, so "Waitlisted For"
        only shows the filtered session and "Enrolled In" is always empty.

        This method mirrors _handle_waitlist_enrollment_breakdown: it builds
        all_waitlisted_groups BEFORE session filtering and also fetches enrolled
        attendees for the enrolled_sessions column.
        """
        effective_types = session_types or list(SUMMER_SESSION_TYPES)

        waitlisted_attendees, enrolled_attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, ["waitlisted"]),
            self.repo.fetch_attendees(year, ["enrolled"]),
            self.repo.fetch_persons(year),
        )

        # Build waitlisted groups by person, then filter to summer/requested session types.
        # The "Waitlisted For" column shows all matching sessions a person is waitlisted for,
        # not just the one clicked, but limited to the active session types.
        all_waitlisted_groups: dict[int, list[Any]] = {}
        for att in waitlisted_attendees:
            pid = int(getattr(att, "person_id", 0))
            if pid:
                all_waitlisted_groups.setdefault(pid, []).append(att)

        valid_sessions = await self.repo.fetch_sessions(year, effective_types)
        valid_session_ids = set(valid_sessions.keys())
        for pid in all_waitlisted_groups:
            all_waitlisted_groups[pid] = [
                att
                for att in all_waitlisted_groups[pid]
                if int(getattr(get_session_from_expand(att), "cm_id", 0)) in valid_session_ids
            ]

        # Filter waitlisted by session (controls which persons appear)
        filtered_waitlisted = filter_attendees_by_session(
            waitlisted_attendees,
            session_types,
            session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

        # Filter by breakdown criteria (grade, gender, etc.)
        filtered_waitlisted = self._filter_by_breakdown(
            filtered_waitlisted, persons, sessions, breakdown_type, breakdown_value
        )

        # Deduplicate by person
        seen_persons: set[int] = set()
        deduped: list[Any] = []
        for att in filtered_waitlisted:
            pid = int(getattr(att, "person_id", 0))
            if pid and pid not in seen_persons:
                seen_persons.add(pid)
                deduped.append(att)

        # Build enrolled groups from enrolled attendees
        enrolled_attendee_groups = _group_enrolled_by_person(enrolled_attendees, effective_types)

        return self._build_response(
            deduped,
            persons,
            sessions,
            person_attendee_groups=all_waitlisted_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
        )

    async def _handle_cancellation_breakdown(
        self,
        year: int,
        breakdown_type: str,
        breakdown_value: str,
        sessions: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle cancellation-specific breakdown types.

        Fetches cancelled attendees and cross-references with status history
        and enrolled attendees to partition by cancellation category.
        """
        effective_types = session_types or list(SUMMER_SESSION_TYPES)

        # Re-enrolled is a special case: these are currently enrolled campers
        # who have a cancelled->enrolled status history transition
        if breakdown_type == "cancellation_re_enrolled":
            return await self._handle_cancellation_re_enrolled(
                year=year,
                sessions=sessions,
                session_cm_id=session_cm_id,
                session_types=session_types,
                ag_session_ids=ag_session_ids,
                effective_types=effective_types,
                duration_session_ids=duration_session_ids,
            )

        cancelled_attendees, enrolled_attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, CANCELLED_STATUSES),
            self.repo.fetch_attendees(year, ["enrolled"]),
            self.repo.fetch_persons(year),
        )

        # Filter cancelled by session
        cancelled_attendees = filter_attendees_by_session(
            cancelled_attendees,
            session_types,
            session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

        # Build enrolled person set
        enrolled_attendee_groups = _group_enrolled_by_person(enrolled_attendees, effective_types)
        enrolled_person_ids = set(enrolled_attendee_groups.keys())

        # Build was_enrolled / was_waitlisted person sets from status history
        enrolled_to_cancelled, waitlisted_to_cancelled = await asyncio.gather(
            self.repo.fetch_status_history(year, old_status="enrolled", new_statuses=CANCELLED_STATUSES),
            self.repo.fetch_status_history(year, old_status="waitlisted", new_statuses=CANCELLED_STATUSES),
        )

        was_enrolled_persons: set[int] = set()
        for record in enrolled_to_cancelled:
            pid = int(getattr(record, "person_id", 0))
            if pid:
                was_enrolled_persons.add(pid)

        was_waitlisted_persons: set[int] = set()
        for record in waitlisted_to_cancelled:
            pid = int(getattr(record, "person_id", 0))
            if pid:
                was_waitlisted_persons.add(pid)

        # Deduplicate cancelled by person, filter by breakdown type
        seen_persons: set[int] = set()
        matching: list[Any] = []
        # Build cancelled groups for all sessions
        cancelled_groups: dict[int, list[Any]] = {}
        for att in cancelled_attendees:
            pid = int(getattr(att, "person_id", 0))
            if pid:
                cancelled_groups.setdefault(pid, []).append(att)

        for att in cancelled_attendees:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid in seen_persons:
                continue
            seen_persons.add(pid)

            if (
                breakdown_type == "cancellation_total"
                or (breakdown_type == "cancellation_was_enrolled" and pid in was_enrolled_persons)
                or (breakdown_type == "cancellation_was_waitlisted" and pid in was_waitlisted_persons)
                or (breakdown_type == "cancellation_has_other_sessions" and pid in enrolled_person_ids)
                or (breakdown_type == "cancellation_no_other_sessions" and pid not in enrolled_person_ids)
            ):
                matching.append(att)

        return self._build_response(
            matching,
            persons,
            sessions,
            person_attendee_groups=cancelled_groups,
            enrolled_attendee_groups=enrolled_attendee_groups,
        )

    async def _handle_cancellation_re_enrolled(
        self,
        year: int,
        sessions: dict[int, Any],
        session_cm_id: int | None,
        session_types: list[str] | None,
        ag_session_ids: set[int],
        effective_types: list[str],
        duration_session_ids: set[int] | None = None,
    ) -> list[DrilldownAttendee]:
        """Handle cancellation_re_enrolled breakdown.

        Re-enrolled campers are currently enrolled and have a status history
        transition from a cancelled status back to enrolled.
        """
        # Fetch enrolled attendees, persons, and status history for each cancelled status
        enrolled_attendees: list[Any]
        persons: dict[int, Any]
        enrolled_attendees, persons = await asyncio.gather(
            self.repo.fetch_attendees(year, ["enrolled"]),
            self.repo.fetch_persons(year),
        )

        history_tasks = [
            self.repo.fetch_status_history(year, old_status=status, new_statuses=["enrolled"])
            for status in CANCELLED_STATUSES
        ]
        history_lists: list[list[Any]] = await asyncio.gather(*history_tasks)

        # Find person IDs with cancelled->enrolled transitions
        re_enrolled_person_ids: set[int] = set()
        for history in history_lists:
            for record in history:
                pid = int(getattr(record, "person_id", 0))
                if pid:
                    re_enrolled_person_ids.add(pid)

        # Filter enrolled attendees by session
        filtered_enrolled = filter_attendees_by_session(
            enrolled_attendees,
            session_types,
            session_cm_id,
            ag_session_ids,
            session_cm_ids=duration_session_ids,
        )

        # Build person groups for enrolled sessions display
        enrolled_groups: dict[int, list[Any]] = {}
        for att in filtered_enrolled:
            pid = int(getattr(att, "person_id", 0))
            if pid:
                session_info = get_session_from_expand(att)
                if session_info:
                    session_type = getattr(session_info, "session_type", None)
                    if session_type in effective_types:
                        enrolled_groups.setdefault(pid, []).append(att)

        # Deduplicate by person, filter to re-enrolled only
        seen_persons: set[int] = set()
        matching: list[Any] = []
        for att in filtered_enrolled:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid in seen_persons:
                continue
            seen_persons.add(pid)
            if pid in re_enrolled_person_ids:
                matching.append(att)

        return self._build_response(
            matching,
            persons,
            sessions,
            person_attendee_groups=enrolled_groups,
        )

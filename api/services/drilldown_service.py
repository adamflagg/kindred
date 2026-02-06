"""Drilldown service - business logic for chart drill-down functionality.

This service enables clicking a chart segment to show matching campers.
It reuses the same filtering logic as RegistrationService but returns
individual attendee records instead of aggregated counts.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from api.schemas.metrics import DrilldownAttendee
from api.services.registration_service import get_session_length_category
from api.utils.session_metrics import compute_summer_metrics

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


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

        # For synagogue breakdown, pre-fetch congregation mapping
        congregation_by_person: dict[int, str] = {}
        if breakdown_type == "synagogue":
            congregation_by_person = await self.repo.fetch_congregation_by_person(year)

        # For city breakdown, pre-fetch normalized city mapping
        # This ensures drilldown matches on normalized values (what GeoDetailList shows)
        # instead of raw person.address["city"] values which may have typos/variations
        normalized_city_by_person: dict[int, str] = {}
        if breakdown_type == "city":
            normalized_city_by_person = await self.repo.fetch_normalized_city_by_person(year)

        # Filter by breakdown criteria
        filtered_attendees = self._filter_by_breakdown(
            filtered_attendees,
            persons,
            sessions,
            breakdown_type,
            breakdown_value,
            first_year_by_person,
            congregation_by_person,
            normalized_city_by_person,
        )

        # Build response
        return self._build_response(filtered_attendees, persons, sessions)

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
        congregation_by_person: dict[int, str] | None = None,
        normalized_city_by_person: dict[int, str] | None = None,
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
            congregation_by_person: Pre-computed congregation by person cm_id
                (only populated for synagogue breakdown).
            normalized_city_by_person: Pre-computed normalized city by person cm_id
                (only populated for city breakdown).

        Returns:
            Filtered list of attendees.
        """
        if first_year_by_person is None:
            first_year_by_person = {}
        if congregation_by_person is None:
            congregation_by_person = {}
        if normalized_city_by_person is None:
            normalized_city_by_person = {}
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
                # Match on normalized_school (set by normalize_geographic sync)
                # for consistency with GeoDetailList which shows normalized values.
                # Fall back to raw person.school if normalized_school not populated.
                if person:
                    normalized = getattr(person, "normalized_school", None)
                    if normalized:
                        if normalized == breakdown_value:
                            filtered.append(a)
                    elif getattr(person, "school", None) == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "city":
                # Match on normalized city from normalized_mappings
                # This ensures consistency with GeoDetailList which shows normalized values
                pid = int(person_id) if person_id is not None else None
                if pid is not None:
                    normalized_city = normalized_city_by_person.get(pid, "")
                    if normalized_city == breakdown_value:
                        filtered.append(a)

            elif breakdown_type == "synagogue":
                # Match on congregation/synagogue from person custom values
                pid = int(person_id) if person_id is not None else None
                if pid is not None:
                    congregation = congregation_by_person.get(pid, "")
                    if congregation == breakdown_value:
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
                years = getattr(person, "years_at_camp", None) if person else None
                if breakdown_value == "new":
                    if years == 1:
                        filtered.append(a)
                elif breakdown_value == "returning":
                    if years is not None and years > 1:
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
    ) -> list[DrilldownAttendee]:
        """Build the response list from filtered attendees.

        Args:
            attendees: Filtered list of attendee records.
            persons: Dictionary of persons by cm_id.
            sessions: Dictionary of sessions by cm_id.

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

            result.append(
                DrilldownAttendee(
                    person_id=person_id,
                    first_name=getattr(person, "first_name", ""),
                    last_name=getattr(person, "last_name", ""),
                    preferred_name=getattr(person, "preferred_name", None),
                    grade=getattr(person, "grade", None),
                    gender=getattr(person, "gender", None),
                    age=getattr(person, "age", None),
                    school=getattr(person, "school", None),
                    city=city,
                    state=state,
                    years_at_camp=years_at_camp,
                    session_name=session_name,
                    session_cm_id=session_cm_id,
                    status=getattr(a, "status", "enrolled"),
                    is_returning=is_returning,
                )
            )

        return result

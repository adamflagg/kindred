"""Attendee repository for data access.

Handles all database operations related to Attendee records,
which link persons to sessions for specific years."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pocketbase import PocketBase

from ...core.models import Person
from ...shared import parse_date
from ..pocketbase_wrapper import PocketBaseWrapper
from .person_repository import PersonRepository


class AttendeeRepository:
    """Repository for Attendee data access"""

    def __init__(self, pb_client: PocketBase | PocketBaseWrapper) -> None:
        """Initialize repository with PocketBase client.

        Args:
            pb_client: PocketBase client instance
        """
        self.pb = pb_client
        # Suppress deprecation warning for internal PersonRepository creation
        PersonRepository._from_factory = True
        try:
            self.person_repo = PersonRepository(pb_client)
        finally:
            PersonRepository._from_factory = False
        # Cache for get_session_attendees - keyed by (session_cm_id, year)

        self._session_attendees_cache: dict[tuple[int, int], list[dict[str, Any]]] = {}

    def get_by_person_and_year(
        self, person_cm_id: int, year: int, session_cm_id: int | None = None
    ) -> dict[str, Any] | None:
        """Get attendee record for a person in a specific year.

        Args:
            person_cm_id: CampMinder person ID
            year: The year to filter by
            session_cm_id: Optional session CM ID to filter by. Required when a person
                          is enrolled in multiple sessions (e.g., summer camp + family camp)
                          to ensure the correct attendee record is returned.
        """
        try:
            # DB field is person_id, not person_cm_id
            # Need expand for session since session_id field was deleted
            filter_str = f"person_id = {person_cm_id} && year = {year}"
            if session_cm_id is not None:
                filter_str += f" && session.cm_id = {session_cm_id}"

            result = self.pb.collection("attendees").get_list(
                query_params={
                    "filter": filter_str,
                    "expand": "session",
                    "perPage": 1,
                }
            )

            if result.items:
                return self._map_attendee_record(result.items[0])

        except Exception as e:
            print(f"Error finding attendee for person {person_cm_id} in year {year}: {e}")

        return None

    def get_session_attendees(self, session_cm_id: int, year: int) -> list[dict[str, Any]]:
        """Get all attendees for a specific session and year.

        Returns dict with fields: name, person_id, grade, age, session

        Results are cached per (session_cm_id, year) to avoid repeated DB queries,
        matching monolith's attendees_by_person and person_cache pattern.
        """
        cache_key = (session_cm_id, year)

        # Return cached result if available
        if cache_key in self._session_attendees_cache:
            return self._session_attendees_cache[cache_key]

        try:
            # session_id field was deleted - need to expand session relation
            result = self.pb.collection("attendees").get_full_list(
                query_params={"filter": f"year = {year}", "expand": "session"}
            )

            # Filter by session CM ID in Python (via expanded relation)
            filtered_attendees: list[Any] = []
            person_cm_ids: list[int] = []
            for item in result:
                session_cm_id_from_expand = self._get_session_cm_id(item)
                if session_cm_id_from_expand == session_cm_id:
                    filtered_attendees.append(item)
                    person_id = getattr(item, "person_id", None)
                    if person_id is not None:
                        person_cm_ids.append(person_id)

            persons_dict: dict[int, Person] = {}
            if person_cm_ids:
                persons_dict = self.person_repo.bulk_find_by_cm_ids(person_cm_ids)

            # Build result with full data including name and grade
            attendees: list[dict[str, Any]] = []
            for item in filtered_attendees:
                mapped = self._map_attendee_record(item)

                item_person_id = getattr(item, "person_id", None)
                person = persons_dict.get(item_person_id) if item_person_id is not None else None
                if person:
                    first_name = person.first_name or ""
                    last_name = person.last_name or ""
                    mapped["name"] = f"{first_name} {last_name}".strip()
                    mapped["grade"] = person.grade
                else:
                    mapped["name"] = ""
                    mapped["grade"] = None

                mapped["person_id"] = mapped["person_cm_id"]

                mapped["session"] = mapped["session_cm_id"]

                attendees.append(mapped)

            # Cache the result
            self._session_attendees_cache[cache_key] = attendees

            return attendees

        except Exception as e:
            print(f"Error finding attendees for session {session_cm_id} in year {year}: {e}")
            return []

    def clear_cache(self) -> None:
        """Clear the session attendees cache."""
        self._session_attendees_cache.clear()

    def _get_session_cm_id(self, attendee: Any) -> int | None:
        """Extract session CM ID from expanded relation"""
        if hasattr(attendee, "expand") and attendee.expand:
            session = attendee.expand.get("session")
            if session and hasattr(session, "cm_id"):
                result: int = session.cm_id
                return result
        return None

    def get_age_filtered_session_peers(
        self, person_cm_id: int, session_cm_id: int, year: int, max_age_diff_months: int = 24
    ) -> list[Person]:
        """Get peers from the same session within a specified age range.
        Excludes the requester themselves.
        """
        try:
            # Get requester's info - pass session to handle multi-enrolled campers
            requester_attendee = self.get_by_person_and_year(person_cm_id, year, session_cm_id)
            if not requester_attendee:
                return []

            # Get requester's birth date
            requester_birth_date = None
            if "birth_date" in requester_attendee and requester_attendee["birth_date"]:
                requester_birth_date = parse_date(requester_attendee["birth_date"])

            if not requester_birth_date:
                # Can't filter by age without birth date
                return []

            # Get all session attendees
            all_attendees = self.get_session_attendees(session_cm_id, year)

            # Filter out self
            peer_attendees = [a for a in all_attendees if a["person_cm_id"] != person_cm_id]

            if not peer_attendees:
                return []

            # Get person details for age filtering
            peer_cm_ids = [a["person_cm_id"] for a in peer_attendees]
            persons_dict = self.person_repo.bulk_find_by_cm_ids(peer_cm_ids)

            # Filter by age
            filtered_peers = []
            for _cm_id, person in persons_dict.items():
                if person.birth_date:
                    months_diff = self._calculate_months_difference(requester_birth_date, person.birth_date)
                    if abs(months_diff) <= max_age_diff_months:
                        filtered_peers.append(person)

            return filtered_peers

        except Exception as e:
            print(f"Error getting age-filtered peers: {e}")
            return []

    def bulk_get_sessions_for_persons(self, person_cm_ids: list[int], year: int) -> dict[int, int]:
        """Get session assignments for multiple persons in one query.
        Returns dict mapping person_cm_id to session_cm_id.
        """
        if not person_cm_ids:
            return {}

        try:
            # Build OR clause instead of IN to avoid encoding issues
            # DB field is person_id, not person_cm_id
            or_conditions = [f"person_id = {cm_id}" for cm_id in person_cm_ids]
            or_clause = " || ".join(or_conditions)

            result = self.pb.collection("attendees").get_list(
                page=1,
                per_page=len(person_cm_ids),
                query_params={
                    "filter": f"({or_clause}) && year = {year}",
                    "expand": "session",  # Need expand since session_id field deleted
                },
            )

            # Map to dictionary - person_id still exists, session via expand
            sessions_dict: dict[int, int] = {}
            for item in result.items:
                person_cm_id = getattr(item, "person_id", None)
                session_cm_id = self._get_session_cm_id(item)
                if person_cm_id and session_cm_id:
                    sessions_dict[person_cm_id] = session_cm_id

            return sessions_dict

        except Exception as e:
            print(f"Error bulk getting sessions: {e}")
            return {}

    def _map_attendee_record(self, db_record: Any) -> dict[str, Any]:
        """Map database record to dictionary

        Note: DB field person_id still exists, but session_id was deleted.
        Session CM ID must come from expanded relation.
        Returns person_cm_id and session_cm_id keys for backwards compatibility.
        """
        mapped: dict[str, Any] = {
            "person_cm_id": getattr(db_record, "person_id", None),  # DB field person_id still exists
            "session_cm_id": self._get_session_cm_id(db_record),  # Via expanded relation
            "year": getattr(db_record, "year", None),
        }

        # Add optional fields if present
        if hasattr(db_record, "cabin_name"):
            mapped["cabin_name"] = db_record.cabin_name
        if hasattr(db_record, "age"):
            mapped["age"] = db_record.age
        if hasattr(db_record, "birth_date"):
            mapped["birth_date"] = db_record.birth_date

        return mapped

    def _calculate_months_difference(self, date1: datetime, date2: datetime) -> int:
        """Calculate difference in months between two dates"""
        diff = date1 - date2
        months = diff.days / 30.44  # Average days per month
        return int(abs(months))

    def find_prior_year_bunkmates(self, requester_cm_id: int, session_cm_id: int, year: int) -> dict[str, Any]:
        """Find eligible bunkmates from prior year who are returning.

        This mirrors monolith's find_prior_year_bunkmates functionality,
        using bunk_assignments table instead of deprecated historical_bunking.

        Args:
            requester_cm_id: The camper requesting continuity
            session_cm_id: Current year session CM ID (used for checking returning)
            year: Current year

        Returns:
            Dict with cm_ids, prior_bunk, prior_year, total_in_bunk, returning_count
            Empty dict if no prior year assignment found or on error
        """
        try:
            previous_year = year - 1

            # Find requester's bunk assignment from prior year
            try:
                assignments = self.pb.collection("bunk_assignments").get_full_list(
                    query_params={
                        "filter": f"person.cm_id = {requester_cm_id} && year = {previous_year}",
                        "expand": "person,bunk",
                    }
                )
            except Exception as e:
                print(f"Error finding prior assignment for {requester_cm_id}: {e}")
                return {}

            if not assignments:
                return {}

            # Get the bunk from the assignment
            requester_assignment = assignments[0]
            expand = getattr(requester_assignment, "expand", {}) or {}
            bunk_data = expand.get("bunk")

            if not bunk_data:
                return {}

            bunk_id = getattr(bunk_data, "id", None)
            bunk_name = getattr(bunk_data, "name", None)

            if not bunk_id:
                return {}

            # Find all campers in that bunk for prior year
            bunkmates = self.pb.collection("bunk_assignments").get_full_list(
                query_params={"filter": f'bunk = "{bunk_id}" && year = {previous_year}', "expand": "person"}
            )

            if not bunkmates:
                return {}

            # Extract bunkmate CM IDs (excluding requester)
            bunkmate_cm_ids = []
            for assignment in bunkmates:
                assign_expand = getattr(assignment, "expand", {}) or {}
                person_data = assign_expand.get("person")
                if person_data:
                    cm_id = getattr(person_data, "cm_id", None)
                    if cm_id and cm_id != requester_cm_id:
                        bunkmate_cm_ids.append(cm_id)

            if not bunkmate_cm_ids:
                return {}

            # Check which bunkmates are returning this year
            returning_ids = []
            sessions_map = self.bulk_get_sessions_for_persons(bunkmate_cm_ids, year)
            for cm_id in bunkmate_cm_ids:
                if cm_id in sessions_map:
                    returning_ids.append(cm_id)

            return {
                "cm_ids": returning_ids,
                "prior_bunk": bunk_name,
                "prior_year": previous_year,
                "total_in_bunk": len(bunkmate_cm_ids),
                "returning_count": len(returning_ids),
            }

        except Exception as e:
            print(f"Failed to find prior year bunkmates: {e}")
            return {}

    def build_person_session_mappings(
        self, year: int, valid_session_ids: set[int], current_session_cm_ids: list[int] | None = None
    ) -> dict[str, Any]:
        """
        Build person-to-session mappings for current and previous year.

        Loads attendees for both current and previous year in a single query,
        then builds mappings that support multi-session enrollments.

        Args:
            year: Current year to process
            valid_session_ids: Set of valid bunking session CM IDs
            current_session_cm_ids: Optional filter for current year sessions.
                If provided, only these sessions are included for current year.
                Previous year includes all valid sessions.

        Returns:
            Dict with:
                - person_sessions: Dict[int, List[int]] - current year person → session mapping
                - person_previous_year_sessions: Dict[int, List[int]] - previous year mapping
                - stats: Dict with filtering/enrollment statistics
        """
        try:
            # Determine current year filter
            if current_session_cm_ids:
                current_year_valid = {sid for sid in current_session_cm_ids if sid in valid_session_ids}
                if not current_year_valid:
                    return {
                        "person_sessions": {},
                        "person_previous_year_sessions": {},
                        "stats": {"error": "No valid bunking sessions in requested IDs"},
                    }
            else:
                current_year_valid = valid_session_ids

            # Load attendees for current AND previous year
            previous_year = year - 1
            filter_str = f"(year = {year} || year = {previous_year}) && status = 'enrolled'"

            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": filter_str, "expand": "person,session"}
            )

            # Build mappings
            person_sessions: dict[int, list[int]] = {}
            person_previous_year_sessions: dict[int, list[int]] = {}
            multi_session_count = 0
            filtered_count = 0
            prev_year_count = 0

            for attendee in attendees:
                if not hasattr(attendee, "expand") or not attendee.expand:
                    continue

                person = attendee.expand.get("person")
                session = attendee.expand.get("session")

                if not person or not session:
                    continue

                person_cm_id = getattr(person, "cm_id", None)
                session_cm_id = getattr(session, "cm_id", None)
                attendee_year = getattr(attendee, "year", None)

                # Skip if any required field is missing
                if person_cm_id is None or session_cm_id is None or attendee_year is None:
                    continue

                # Filter by valid session CM IDs (all bunking sessions)
                if session_cm_id not in valid_session_ids:
                    filtered_count += 1
                    continue

                if attendee_year == year:
                    # Current year - also filter by requested sessions
                    if session_cm_id not in current_year_valid:
                        filtered_count += 1
                        continue

                    if person_cm_id not in person_sessions:
                        person_sessions[person_cm_id] = []

                    if session_cm_id not in person_sessions[person_cm_id]:
                        person_sessions[person_cm_id].append(session_cm_id)

                    if len(person_sessions[person_cm_id]) > 1:
                        multi_session_count += 1

                elif attendee_year == previous_year:
                    # Previous year - for disambiguation
                    if person_cm_id not in person_previous_year_sessions:
                        person_previous_year_sessions[person_cm_id] = []

                    if session_cm_id not in person_previous_year_sessions[person_cm_id]:
                        person_previous_year_sessions[person_cm_id].append(session_cm_id)
                        prev_year_count += 1

            # Build stats
            unique_persons = len(person_sessions)
            total_enrollments = sum(len(s) for s in person_sessions.values())
            prev_year_persons = len(person_previous_year_sessions)

            return {
                "person_sessions": person_sessions,
                "person_previous_year_sessions": person_previous_year_sessions,
                "stats": {
                    "unique_persons": unique_persons,
                    "total_enrollments": total_enrollments,
                    "multi_session_count": multi_session_count,
                    "filtered_count": filtered_count,
                    "prev_year_persons": prev_year_persons,
                    "prev_year_count": prev_year_count,
                },
            }

        except Exception as e:
            print(f"Error building person session mappings: {e}")
            return {"person_sessions": {}, "person_previous_year_sessions": {}, "stats": {"error": str(e)}}

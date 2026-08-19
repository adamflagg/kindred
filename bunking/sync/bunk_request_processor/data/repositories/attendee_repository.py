"""Attendee repository for data access.

Handles all database operations related to Attendee records,
which link persons to sessions for specific years."""

from collections.abc import Sequence
from datetime import datetime
from itertools import batched
from typing import Any

from api.utils.session_metrics import get_person_from_expand, get_session_from_expand
from bunking.logging_config import get_logger
from pocketbase import PocketBase

from ...core.models import EnrollmentInfo, Person
from ...shared import parse_date
from ...shared.constants import ACTIVE_ENROLLMENT_STATUSES, ENROLLED_STATUS_ID, PENDING_ENROLLMENT_STATUSES
from ..pocketbase_wrapper import PocketBaseWrapper
from .person_repository import PersonRepository
from .session_repository import VALID_BUNKING_SESSION_TYPES

logger = get_logger(__name__)


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

        except Exception:  # noqa: S110 — intentional silent handling
            pass

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

        except Exception:
            logger.exception("get_session_attendees failed for session_cm_id=%s year=%s", session_cm_id, year)
            return []

    def clear_cache(self) -> None:
        """Clear the session attendees cache."""
        self._session_attendees_cache.clear()

    def _get_session_cm_id(self, attendee: Any) -> int | None:
        """Extract session CM ID from expanded relation"""
        session = get_session_from_expand(attendee)
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
            if requester_attendee.get("birth_date"):
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
            for person in persons_dict.values():
                if person.birth_date:
                    months_diff = self._calculate_months_difference(requester_birth_date, person.birth_date)
                    if abs(months_diff) <= max_age_diff_months:
                        filtered_peers.append(person)

            return filtered_peers

        except Exception:
            logger.exception("get_age_filtered_session_peers failed for person_cm_id=%s", person_cm_id)
            return []

    _BULK_CHUNK_SIZE = 100

    def bulk_get_sessions_for_persons(self, person_cm_ids: list[int], year: int) -> dict[int, int]:
        """Get bunking-relevant session assignments for multiple persons.

        Returns dict mapping person_cm_id to session_cm_id, considering only
        bunking-relevant session types (main, embedded, ag). Campers enrolled
        in family camp, quests, or other non-bunking sessions are excluded.

        Chunks large requests to avoid PocketBase OR clause length limits
        (~150 IDs). Each chunk is queried separately and results merged.
        """
        if not person_cm_ids:
            return {}

        # Chunk to avoid PocketBase OR clause length limits
        sessions_dict: dict[int, int] = {}
        for chunk in batched(person_cm_ids, self._BULK_CHUNK_SIZE, strict=False):
            chunk_result = self._bulk_get_sessions_chunk(chunk, year)
            sessions_dict.update(chunk_result)

        return sessions_dict

    def _bulk_get_sessions_chunk(self, person_cm_ids: Sequence[int], year: int) -> dict[int, int]:
        """Get sessions for a single chunk of person IDs.

        Uses get_full_list to handle campers enrolled in multiple sessions
        (e.g., summer session + family camp) without per_page truncation.
        """
        try:
            # Build OR clause instead of IN to avoid encoding issues
            # DB field is person_id, not person_cm_id
            or_conditions = [f"person_id = {cm_id}" for cm_id in person_cm_ids]
            or_clause = " || ".join(or_conditions)

            # Use get_full_list to avoid per_page truncation when campers
            # have multiple enrollments (summer + family camp + quests)
            items = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"({or_clause}) && year = {year}",
                    "expand": "session",  # Need expand since session_id field deleted
                },
            )

            # Map to dictionary, filtering to bunking-relevant sessions only.
            # This prevents family camp / quest enrollments from overwriting
            # the correct summer session assignment.
            # Status priority: enrolled (2) wins over all other statuses.
            sessions_dict: dict[int, int] = {}
            sessions_status: dict[int, int] = {}  # person_cm_id → best status_id seen
            for item in items:
                person_cm_id = getattr(item, "person_id", None)
                session_cm_id = self._get_session_cm_id(item)
                status_id = getattr(item, "status_id", None)
                if not person_cm_id or not session_cm_id:
                    continue

                # Filter by session type — only bunking-relevant sessions
                session = get_session_from_expand(item)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type not in VALID_BUNKING_SESSION_TYPES:
                    continue

                # Don't overwrite an enrolled session with a non-enrolled one
                existing_status = sessions_status.get(person_cm_id)
                if existing_status == ENROLLED_STATUS_ID and status_id != ENROLLED_STATUS_ID:
                    continue

                sessions_dict[person_cm_id] = session_cm_id
                sessions_status[person_cm_id] = status_id or 0

            return sessions_dict

        except Exception:
            logger.exception("bulk_get_sessions_chunk failed for %d person IDs (year=%d)", len(person_cm_ids), year)
            return {}

    def bulk_get_all_sessions_for_persons(self, person_cm_ids: list[int], year: int) -> dict[int, list[int]]:
        """Get ALL bunking-relevant session enrollments per person.

        Unlike `bulk_get_sessions_for_persons` (which collapses to one session
        per person via status-priority tiebreak), returns the full list of
        bunking enrollments. Used by name-resolution matchers that need
        multi-enrollment awareness.

        Chunks at _BULK_CHUNK_SIZE (100) to avoid PocketBase OR clause length limits.
        Filters to VALID_BUNKING_SESSION_TYPES.
        """
        if not person_cm_ids:
            return {}

        sessions_dict: dict[int, list[int]] = {}
        for chunk in batched(person_cm_ids, self._BULK_CHUNK_SIZE, strict=False):
            chunk_result = self._bulk_get_all_sessions_chunk(chunk, year)
            for cm_id, session_list in chunk_result.items():
                sessions_dict.setdefault(cm_id, []).extend(session_list)

        return sessions_dict

    def _bulk_get_all_sessions_chunk(self, person_cm_ids: Sequence[int], year: int) -> dict[int, list[int]]:
        """Get all bunking sessions for a single chunk of person IDs.

        Mirrors `_bulk_get_sessions_chunk` but appends instead of overwriting,
        so multi-enrolled campers get every bunking session returned.
        """
        try:
            or_conditions = [f"person_id = {cm_id}" for cm_id in person_cm_ids]
            or_clause = " || ".join(or_conditions)

            items = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"({or_clause}) && year = {year}",
                    "expand": "session",
                },
            )

            sessions_dict: dict[int, list[int]] = {}
            for item in items:
                person_cm_id = getattr(item, "person_id", None)
                session_cm_id = self._get_session_cm_id(item)
                if not person_cm_id or not session_cm_id:
                    continue

                session = get_session_from_expand(item)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type not in VALID_BUNKING_SESSION_TYPES:
                    continue

                bucket = sessions_dict.setdefault(person_cm_id, [])
                if session_cm_id not in bucket:
                    bucket.append(session_cm_id)

            return sessions_dict

        except Exception:
            logger.exception(
                "bulk_get_all_sessions_chunk failed for %d person IDs (year=%d)",
                len(person_cm_ids),
                year,
            )
            return {}

    def bulk_get_enrollment_for_persons(self, person_cm_ids: list[int], year: int) -> dict[int, EnrollmentInfo]:
        """Get enrollment info including status_id for each person.

        Unlike bulk_get_sessions_for_persons (which returns only session_cm_id),
        this returns full EnrollmentInfo including status for disposition decisions.
        Filters to bunking session types only.
        Status priority: enrolled > waitlisted/applied > cancelled/other.
        """
        if not person_cm_ids:
            return {}

        enrollment_dict: dict[int, EnrollmentInfo] = {}
        for chunk in batched(person_cm_ids, self._BULK_CHUNK_SIZE, strict=False):
            chunk_result = self._bulk_get_enrollment_chunk(chunk, year)
            enrollment_dict.update(chunk_result)

        return enrollment_dict

    def _bulk_get_enrollment_chunk(self, person_cm_ids: Sequence[int], year: int) -> dict[int, EnrollmentInfo]:
        """Get enrollment info for a single chunk of person IDs."""
        try:
            or_conditions = [f"person_id = {cm_id}" for cm_id in person_cm_ids]
            or_clause = " || ".join(or_conditions)

            items = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"({or_clause}) && year = {year}",
                    "expand": "session",
                },
            )

            enrollment_dict: dict[int, EnrollmentInfo] = {}
            best_priority: dict[int, int] = {}

            for item in items:
                person_cm_id = getattr(item, "person_id", None)
                session_cm_id = self._get_session_cm_id(item)
                status_id = getattr(item, "status_id", None)
                if not person_cm_id or not session_cm_id:
                    continue

                session = get_session_from_expand(item)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type not in VALID_BUNKING_SESSION_TYPES:
                    continue

                # Status priority: enrolled (2) > pending (1) > inactive (0)
                new_priority = self._enrollment_priority(status_id or 0)
                existing_priority = best_priority.get(person_cm_id, -1)
                if existing_priority > new_priority:
                    continue

                enrollment_dict[person_cm_id] = EnrollmentInfo(
                    session_cm_id=session_cm_id,
                    status_id=status_id or 0,
                )
                best_priority[person_cm_id] = new_priority

            return enrollment_dict

        except Exception:
            logger.exception(
                "bulk_get_enrollment_chunk failed for %d person IDs (year=%d)",
                len(person_cm_ids),
                year,
            )
            return {}

    @staticmethod
    def _enrollment_priority(status_id: int) -> int:
        """Return priority for enrollment status: enrolled (2) > pending (1) > inactive (0)."""
        if status_id in ACTIVE_ENROLLMENT_STATUSES:
            return 2
        if status_id in PENDING_ENROLLMENT_STATUSES:
            return 1
        return 0

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

    def find_prior_year_bunkmates(self, requester_cm_id: int, year: int) -> dict[str, Any]:
        """Find eligible bunkmates from prior year who are returning.

        This mirrors monolith's find_prior_year_bunkmates functionality,
        using bunk_assignments table instead of deprecated historical_bunking.

        EVERY eligible prior-year cabin of the requester is searched, not one.
        The method used to keep `assignments[0]` and take the bunk, the session
        and therefore the whole peer pool from that single row; 66 of the 1,257
        campers with a 2025 assignment held two or more, in different cabins
        every time, so a real cabin of friends was unreachable for all of them.
        `sort: "id"` (#2445) made that pick stable, not right — PocketBase
        record ids are random, so which of a camper's three or four cabins won
        was arbitrary.

        There is one peer query per `(bunk, session)` pair rather than one
        overall. 94.7% of requesters have exactly one pair, so this is normally
        the same single query it always was.

        Args:
            requester_cm_id: The camper requesting continuity
            year: Current year

        Returns:
            Dict with cm_ids, prior_bunk_by_cm_id, prior_bunks, prior_year,
            total_in_bunk (distinct peers across ALL prior cabins) and
            returning_count. Empty dict if no prior year assignment found or on
            error.

            There is deliberately no single top-level `prior_bunk`: with every
            cabin searched it could only name an arbitrary one of them, which
            is what stamped the wrong cabin onto `last_year_bunk`. Use
            `prior_bunk_by_cm_id[cm_id]` for the cabin that peer actually
            shared with the requester.
        """
        # Imported at call time, not module scope: `bunking.graph` imports
        # `bunking.satisfaction`, which imports this package's `core.models`, so
        # a top-level import here is a genuine cycle. Importing at call time
        # keeps ONE definition of the eligible-session-type set rather than
        # adding another copy of it.
        from bunking.graph.social_graph_builder import LAST_YEAR_HISTORY_SESSION_TYPES  # noqa: PLC0415

        try:
            previous_year = year - 1

            # Find the requester's bunk assignments from prior year.
            #
            # The session-type predicate is pushed INTO the query so the
            # database returns only rows from a session that actually puts
            # children in a cabin. Without it a Family Camp DAY GROUP was
            # eligible to be returned as a summer prior cabin, and the whole
            # day group then came back as "bunkmates" (#2426). `sort: "id"`
            # fixes the order the cabins are searched in, which decides the
            # `cm_ids` order and therefore which of two same-named peers a
            # resolution picks. Same predicate and same STABLE_SORT convention
            # as `bunking/graph/social_graph_builder.py`, which already carries
            # this fix for its own query.
            type_clause = " || ".join(f'session.session_type = "{t}"' for t in LAST_YEAR_HISTORY_SESSION_TYPES)
            try:
                assignments = self.pb.collection("bunk_assignments").get_full_list(
                    query_params={
                        "filter": f"person.cm_id = {requester_cm_id} && year = {previous_year} && ({type_clause})",
                        "expand": "person,bunk,session",
                        "sort": "id",
                    }
                )
            except Exception:
                logger.exception("find_prior_year_bunkmates failed querying assignments for cm_id=%s", requester_cm_id)
                return {}

            # Only `year - 1` is ever searched, so a camper who skipped a season
            # resolves nothing here by construction (#2457). Say so rather than
            # returning silently — from a sync log the two are indistinguishable.
            if not assignments:
                logger.debug(
                    "No eligible %s bunk assignment for cm_id=%s; the prior-year bunkmate path only searches year-1",
                    previous_year,
                    requester_cm_id,
                )
                return {}

            # Collect every DISTINCT (bunk, session) pair the requester held.
            # A bunk is a building: 42 of the 57 bunks carrying a 2025
            # assignment served more than one session, so the pair — not the
            # bunk — is the set of children the requester actually lived with.
            cabins: dict[tuple[str, str], str] = {}
            for assignment in assignments:
                expand = getattr(assignment, "expand", {}) or {}
                bunk_data = expand.get("bunk")
                session_data = get_session_from_expand(assignment)

                bunk_id = getattr(bunk_data, "id", None) if bunk_data else None
                session_id = getattr(session_data, "id", None) if session_data else None

                # Without the session we cannot scope the bunk to a week, and an
                # unscoped query would return the whole building -- which is the
                # defect this method was fixed for. Skip THIS cabin; the
                # requester's other cabins are still perfectly searchable.
                if not bunk_id or not session_id:
                    continue

                cabins.setdefault((bunk_id, session_id), getattr(bunk_data, "name", None) or "")

            if not cabins:
                return {}

            # Union the peer sets, each still scoped to its own (bunk, session)
            # pair. The first cabin to contribute a peer owns them, so a child
            # the requester lived with twice is listed once.
            prior_bunk_by_cm_id: dict[int, str] = {}
            peer_cm_ids: list[int] = []
            for (bunk_id, session_id), bunk_name in cabins.items():
                # Same `sort: "id"` STABLE_SORT convention as the query above,
                # and for the same reason: `_try_prior_bunkmate_resolution`
                # returns the FIRST camper in `cm_ids` whose name matches the
                # target, so two cabinmates sharing a first name are separated
                # by nothing but the order this query happened to return.
                bunkmates = self.pb.collection("bunk_assignments").get_full_list(
                    query_params={
                        "filter": f'bunk = "{bunk_id}" && year = {previous_year} && session = "{session_id}"',
                        "expand": "person",
                        "sort": "id",
                    }
                )

                for assignment in bunkmates:
                    person_data = get_person_from_expand(assignment)
                    if not person_data:
                        continue
                    cm_id = getattr(person_data, "cm_id", None)
                    if not cm_id or cm_id == requester_cm_id or cm_id in prior_bunk_by_cm_id:
                        continue
                    prior_bunk_by_cm_id[cm_id] = bunk_name
                    peer_cm_ids.append(cm_id)

            if not peer_cm_ids:
                return {}

            # Check which bunkmates are returning this year. Deliberately not
            # narrowed to the requester's current session: a camper in Session 4
            # this year must still be able to request a friend from Session 1
            # last year.
            sessions_map = self.bulk_get_sessions_for_persons(peer_cm_ids, year)
            returning_ids = [cm_id for cm_id in peer_cm_ids if cm_id in sessions_map]

            return {
                "cm_ids": returning_ids,
                "prior_bunk_by_cm_id": {cm_id: prior_bunk_by_cm_id[cm_id] for cm_id in returning_ids},
                "prior_bunks": list(dict.fromkeys(cabins.values())),
                "prior_year": previous_year,
                "total_in_bunk": len(peer_cm_ids),
                "returning_count": len(returning_ids),
            }

        except Exception:
            logger.exception("find_prior_year_bunkmates failed for cm_id=%s", requester_cm_id)
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
                person = get_person_from_expand(attendee)
                session = get_session_from_expand(attendee)

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
            return {"person_sessions": {}, "person_previous_year_sessions": {}, "stats": {"error": str(e)}}

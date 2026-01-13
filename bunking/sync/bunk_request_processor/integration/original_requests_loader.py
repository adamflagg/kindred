"""Original Bunk Requests Loader - Reads from original_bunk_requests table (Go-imported data)

This loader fetches records from the original_bunk_requests table that need processing.
Change detection is hash-based: Go sync computes content_hash (MD5) and clears 'processed'
when content actually changes, so Python only needs to filter for processed = ''.

The original_bunk_requests table structure (from Go import):
- id: PocketBase ID
- requester: relation to persons table
- year: camp year
- field: select (bunk_with, not_bunk_with, bunking_notes, internal_notes, socialize_with)
- content: raw text from CSV
- content_hash: MD5 hash of content for change detection
- processed: timestamp of last processing (empty if needs processing)
- created: auto timestamp
- updated: auto timestamp"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from pocketbase import PocketBase

if TYPE_CHECKING:
    from ..data.pocketbase_wrapper import PocketBaseWrapper

from ..data.repositories.session_repository import SessionRepository
from ..shared.constants import (
    AI_PROCESSING_FIELDS,
    FIELD_TO_SOURCE_FIELD,
)

logger = logging.getLogger(__name__)


@dataclass
class OriginalRequest:
    """A single request record from original_bunk_requests table.
    One record = one person + one field type.
    """

    id: str  # PocketBase record ID
    _requester_ref: str  # PocketBase relation ref (internal, not for relationships)
    requester_cm_id: int  # CampMinder person ID
    first_name: str
    last_name: str
    preferred_name: str | None
    grade: int | None
    year: int
    field: str  # bunk_with, not_bunk_with, etc.
    content: str  # Raw text to process
    processed: datetime | None  # Last processed timestamp
    created: datetime
    updated: datetime

    @property
    def source_field(self) -> str:
        """Get the source field name for the orchestrator"""
        return FIELD_TO_SOURCE_FIELD.get(self.field, self.field)

    @property
    def needs_processing(self) -> bool:
        """Check if this record needs (re)processing"""
        if self.processed is None:
            return True
        return self.updated > self.processed

    def to_orchestrator_format(self, session_cm_id: int) -> dict[str, Any]:
        """Convert to the format expected by RequestOrchestrator.

        Args:
            session_cm_id: Session CM ID for this person

        Returns:
            Dict in orchestrator's expected format
        """
        return {
            "requester_cm_id": self.requester_cm_id,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "preferred_name": self.preferred_name,
            "Grade": self.grade or 0,
            "year": self.year,
            self._get_field_key(): self.content,
            # Additional metadata
            "_original_request_id": self.id,
            "_field": self.field,
        }

    def _get_field_key(self) -> str:
        """Get the dict key for the content based on field type"""
        field_keys = {
            "bunk_with": "share_bunk_with",
            "not_bunk_with": "do_not_share_bunk_with",
            "bunking_notes": "bunking_notes_notes",
            "internal_notes": "internal_bunk_notes",
            "socialize_with": "ret_parent_socialize_with_best",
        }
        return field_keys.get(self.field, self.field)


class OriginalRequestsLoader:
    """Loads records from original_bunk_requests that need AI processing.

    Handles:
    - Fetching unprocessed/updated records
    - Expanding person relations to get requester details
    - Converting to orchestrator format
    - Marking records as processed after completion
    """

    def __init__(self, pb: PocketBase | PocketBaseWrapper, year: int, session_cm_ids: list[int] | None = None):
        """Initialize loader.

        Args:
            pb: Authenticated PocketBase client
            year: Year to process requests for
            session_cm_ids: Optional list of session CM IDs to filter by
        """
        self.pb = pb
        self.year = year
        self.session_cm_ids = session_cm_ids  # Target sessions to process
        self._person_sessions: dict[int, list[int]] = {}  # CM ID -> session CM IDs (current year)
        self._person_previous_year_sessions: dict[int, list[int]] = {}  # CM ID -> session CM IDs (previous year)

        # Session repository for DB-based session queries
        self._session_repo = SessionRepository(pb)
        # Cache valid bunking session IDs to avoid repeated DB calls
        self._valid_session_ids = self._session_repo.get_valid_bunking_session_ids(year)

    def load_persons_cache(self) -> None:
        """Pre-load session data for the year.

        Loads:
        - _person_sessions: CM ID → session CM IDs (current year, for filtering)
        - _person_previous_year_sessions: CM ID → session CM IDs (for disambiguation)

        Session continuity is a strong signal - kids often return to the same
        session year after year.
        """
        logger.info(f"Loading session data for year {self.year} (with previous year sessions)")

        try:
            # Get attendees for current AND previous year
            previous_year = self.year - 1
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"(year = {self.year} || year = {previous_year}) && status = 'enrolled'",
                    "expand": "person,session",
                }
            )

            prev_year_count = 0

            for attendee in attendees:
                if not hasattr(attendee, "expand") or not attendee.expand:
                    continue

                person = attendee.expand.get("person")
                session = attendee.expand.get("session")
                attendee_year = attendee.year  # type: ignore[attr-defined]

                if person:
                    cm_id = person.cm_id

                    # Track sessions per person - only valid bunking sessions (from DB)
                    if session:
                        session_cm_id = session.cm_id
                        if session_cm_id in self._valid_session_ids:
                            if attendee_year == self.year:
                                # Current year sessions
                                if cm_id not in self._person_sessions:
                                    self._person_sessions[cm_id] = []
                                if session_cm_id not in self._person_sessions[cm_id]:
                                    self._person_sessions[cm_id].append(session_cm_id)
                            elif attendee_year == previous_year:
                                # Previous year sessions - for disambiguation
                                if cm_id not in self._person_previous_year_sessions:
                                    self._person_previous_year_sessions[cm_id] = []
                                if session_cm_id not in self._person_previous_year_sessions[cm_id]:
                                    self._person_previous_year_sessions[cm_id].append(session_cm_id)
                                    prev_year_count += 1

            logger.info(f"Loaded {len(self._person_sessions)} persons with current year sessions")
            if prev_year_count > 0:
                logger.info(
                    f"Loaded {len(self._person_previous_year_sessions)} persons with "
                    f"{prev_year_count} previous year sessions (for disambiguation)"
                )

        except Exception as e:
            logger.error(f"Failed to load persons cache: {e}")
            raise

    def _get_valid_requester_cm_ids(self) -> set[int]:
        """Get CampMinder IDs of persons enrolled in target sessions.

        Returns:
            Set of CM IDs for persons in target sessions
        """
        if not self.session_cm_ids:
            # No session filter - return all persons with sessions
            return set(self._person_sessions.keys())

        valid_cm_ids = set()
        for cm_id, person_sessions in self._person_sessions.items():
            if any(s in self.session_cm_ids for s in person_sessions):
                valid_cm_ids.add(cm_id)

        return valid_cm_ids

    def fetch_requests_needing_processing(
        self, fields: list[str] | None = None, limit: int | None = None
    ) -> list[OriginalRequest]:
        """Fetch original_bunk_requests that need processing.

        When session_cm_ids is specified, filters to only include requests from
        persons enrolled in those sessions BEFORE applying the limit.

        Args:
            fields: Specific fields to fetch (default: AI_PROCESSING_FIELDS)
            limit: Optional limit for testing (applied AFTER session filtering)

        Returns:
            List of OriginalRequest objects
        """
        if fields is None:
            fields = AI_PROCESSING_FIELDS

        # Build filter for fields that need AI processing
        field_conditions = [f"field = '{f}'" for f in fields]
        field_filter = "(" + " || ".join(field_conditions) + ")"

        # Filter: year matches AND needs processing
        # Change detection is handled by Go sync which:
        # - Computes content_hash (MD5) when importing from CampMinder CSV
        # - Compares hash vs stored hash to detect actual content changes
        # - Clears `processed` field when content changes, triggering reprocessing
        filter_str = f"year = {self.year} && {field_filter} && processed = ''"

        # If session filtering is needed with a limit, we need to handle it specially
        # to ensure the limit applies AFTER session filtering, not before
        apply_session_filter_in_python = bool(self.session_cm_ids and limit)

        if apply_session_filter_in_python:
            # Get valid requester CM IDs for target sessions
            valid_cm_ids = self._get_valid_requester_cm_ids()

            if len(valid_cm_ids) == 0:
                logger.warning(f"No persons found in target sessions {self.session_cm_ids}")
                return []

            # If small number of valid IDs, add to filter directly (more efficient)
            # Use requester.cm_id to filter by relation field - no PB IDs needed
            if len(valid_cm_ids) <= 50:
                id_conditions = [f"requester.cm_id = {cm_id}" for cm_id in valid_cm_ids]
                requester_filter = "(" + " || ".join(id_conditions) + ")"
                filter_str = f"{filter_str} && {requester_filter}"
                logger.info(f"Added session filter for {len(valid_cm_ids)} persons to query")
                apply_session_filter_in_python = False  # No need for Python filtering

        logger.info(f"Fetching requests with filter: {filter_str}")

        try:
            # Fetch with expand on requester relation
            # When session filtering in Python, fetch all then filter+limit
            if limit and not apply_session_filter_in_python:
                records = self.pb.collection("original_bunk_requests").get_list(
                    page=1,
                    per_page=limit,
                    query_params={"filter": filter_str, "expand": "requester", "sort": "-updated"},
                )
                items = records.items
            else:
                items = self.pb.collection("original_bunk_requests").get_full_list(
                    query_params={"filter": filter_str, "expand": "requester", "sort": "-updated"}
                )

            logger.info(f"Found {len(items)} records needing processing")

            # Convert to OriginalRequest objects
            requests = []
            for record in items:
                orig_req = self._parse_record(record)
                if orig_req:
                    requests.append(orig_req)

            # Apply session filtering in Python if we have many valid IDs
            if apply_session_filter_in_python:
                valid_cm_ids = self._get_valid_requester_cm_ids()
                before_count = len(requests)
                requests = [r for r in requests if r.requester_cm_id in valid_cm_ids]
                logger.info(
                    f"Session filter: {before_count} -> {len(requests)} requests "
                    f"(target sessions: {self.session_cm_ids})"
                )

                # Apply limit after session filtering
                if limit and len(requests) > limit:
                    requests = requests[:limit]
                    logger.info(f"Applied limit: {limit} requests")

            return requests

        except Exception as e:
            logger.error(f"Failed to fetch requests: {e}")
            raise

    def count_already_processed(self, fields: list[str] | None = None) -> int:
        """Count records that are already processed for the given scope.

        This provides visibility into how many records were skipped because
        they were already processed, separate from the "needs processing" query.

        Args:
            fields: Specific fields to count (default: AI_PROCESSING_FIELDS)

        Returns:
            Count of already processed records for the scope
        """
        if fields is None:
            fields = AI_PROCESSING_FIELDS

        # Build filter for specified fields
        field_conditions = [f"field = '{f}'" for f in fields]
        field_filter = "(" + " || ".join(field_conditions) + ")"

        # Filter: year matches AND already processed (non-empty processed field)
        filter_str = f"year = {self.year} && {field_filter} && processed != ''"

        try:
            # Just get the count, no need for full records
            records = self.pb.collection("original_bunk_requests").get_full_list(
                query_params={"filter": filter_str, "fields": "id"}
            )

            count = len(records)
            logger.debug(f"Found {count} already processed records for fields {fields}")
            return count

        except Exception as e:
            logger.warning(f"Failed to count already processed records: {e}")
            return 0

    def _parse_record(self, record: Any) -> OriginalRequest | None:
        """Parse a PocketBase record into OriginalRequest"""
        try:
            # Get requester from expand (always included in fetch query)
            requester_ref = record.requester  # PB relation value (internal use only)

            if hasattr(record, "expand") and record.expand and "requester" in record.expand:
                person = record.expand["requester"]
                person_data = {
                    "cm_id": person.cm_id,
                    "first_name": person.first_name,
                    "last_name": person.last_name,
                    "preferred_name": getattr(person, "preferred_name", None),
                    "grade": getattr(person, "grade", None),
                }
            else:
                # expand: requester is always included - if missing, something is wrong
                logger.warning(f"Missing expand data for requester ref {requester_ref}")
                return None

            # Parse timestamps (PocketBase client may return datetime or string)
            def parse_timestamp(val: Any) -> datetime | None:
                if val is None or val == "":
                    return None
                if isinstance(val, datetime):
                    return val
                if isinstance(val, str):
                    try:
                        return datetime.fromisoformat(val.replace("Z", "+00:00"))
                    except (ValueError, TypeError):
                        return None
                return None

            processed = parse_timestamp(record.processed)
            created = parse_timestamp(record.created) or datetime.now()
            updated = parse_timestamp(record.updated) or datetime.now()

            # Ensure proper type conversion (PocketBase may return strings)
            cm_id = person_data["cm_id"]
            if isinstance(cm_id, str):
                cm_id = int(cm_id)

            grade = person_data.get("grade")
            if isinstance(grade, str):
                grade = int(grade) if grade else None

            year = record.year
            if isinstance(year, str):
                year = int(year)

            return OriginalRequest(
                id=record.id,
                _requester_ref=requester_ref,
                requester_cm_id=cm_id,
                first_name=person_data["first_name"],
                last_name=person_data["last_name"],
                preferred_name=person_data.get("preferred_name"),
                grade=grade,
                year=year,
                field=record.field,
                content=record.content,
                processed=processed,
                created=created,
                updated=updated,
            )

        except Exception as e:
            logger.error(f"Failed to parse record {record.id}: {e}")
            return None

    def get_session_for_person(self, cm_id: int) -> int | None:
        """Get the primary session CM ID for a person"""
        sessions = self._person_sessions.get(cm_id, [])
        return sessions[0] if sessions else None

    def get_all_sessions_for_person(self, cm_id: int) -> list[int]:
        """Get all session CM IDs for a person"""
        return self._person_sessions.get(cm_id, [])

    def get_previous_year_session(self, cm_id: int) -> int | None:
        """Get the session a person attended in the previous year.

        Used for session-based disambiguation when resolving names like
        "Sarah from last year" - prioritizes Sarahs who were in the same
        session as the requester last year.

        Args:
            cm_id: Person's CampMinder ID

        Returns:
            Session CM ID from previous year, or None if not found
        """
        sessions = self._person_previous_year_sessions.get(cm_id, [])
        return sessions[0] if sessions else None

    def convert_to_orchestrator_input(self, requests: list[OriginalRequest]) -> list[dict[str, Any]]:
        """Convert OriginalRequest objects to orchestrator input format.

        Groups requests by person and builds the row format expected
        by the orchestrator.

        Args:
            requests: List of OriginalRequest objects

        Returns:
            List of dicts in orchestrator format
        """
        # Group by person to handle multiple fields per person
        by_person: dict[int, list[OriginalRequest]] = {}
        for req in requests:
            if req.requester_cm_id not in by_person:
                by_person[req.requester_cm_id] = []
            by_person[req.requester_cm_id].append(req)

        result = []
        skipped_wrong_session = 0
        for cm_id, person_requests in by_person.items():
            person_sessions = self.get_all_sessions_for_person(cm_id)
            if not person_sessions:
                logger.warning(f"No bunking session found for person {cm_id}, skipping")
                continue

            # Find first matching target session (or use first session if no filter)
            if self.session_cm_ids:
                matching = [s for s in person_sessions if s in self.session_cm_ids]
                if not matching:
                    skipped_wrong_session += 1
                    continue
                session_cm_id = matching[0]
            else:
                session_cm_id = person_sessions[0]

            # Build base row from first request
            first_req = person_requests[0]
            row: dict[str, Any] = {
                "requester_cm_id": cm_id,
                "first_name": first_req.first_name,
                "last_name": first_req.last_name,
                "preferred_name": first_req.preferred_name,
                "Grade": first_req.grade or 0,
                "year": first_req.year,
                "session_cm_id": session_cm_id,
                # Track original request IDs for marking processed
                "_original_request_ids": {},
            }

            # Add each field's content
            for req in person_requests:
                field_key = req._get_field_key()
                row[field_key] = req.content
                row["_original_request_ids"][req.field] = req.id

            result.append(row)

        if skipped_wrong_session > 0:
            logger.info(f"Skipped {skipped_wrong_session} persons not in target sessions {self.session_cm_ids}")

        # Count actual requests included (not skipped)
        included_request_count = sum(len(row.get("_original_request_ids", {})) for row in result)
        logger.info(
            f"Converted {included_request_count} requests to {len(result)} orchestrator rows (from {len(requests)} total)"
        )
        return result

    def mark_as_processed(self, request_ids: list[str]) -> int:
        """Mark original_bunk_requests as processed.

        Args:
            request_ids: List of PocketBase record IDs to mark

        Returns:
            Number of records successfully marked
        """
        if not request_ids:
            return 0

        success_count = 0
        now = datetime.utcnow().isoformat() + "Z"

        for req_id in request_ids:
            try:
                self.pb.collection("original_bunk_requests").update(req_id, {"processed": now})
                success_count += 1
            except Exception as e:
                logger.error(f"Failed to mark {req_id} as processed: {e}")

        logger.info(f"Marked {success_count}/{len(request_ids)} records as processed")
        return success_count

    def mark_row_as_processed(self, row: dict[str, Any]) -> int:
        """Mark all original_bunk_requests associated with an orchestrator row as processed.

        Args:
            row: Orchestrator row with _original_request_ids metadata

        Returns:
            Number of records marked
        """
        request_ids = row.get("_original_request_ids", {})
        if not request_ids:
            return 0

        return self.mark_as_processed(list(request_ids.values()))

"""Request repository for data access.

Handles all database operations related to BunkRequest records."""

from __future__ import annotations

import json
import logging
from typing import Any

from pocketbase import PocketBase

from ...core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from ..pocketbase_wrapper import PocketBaseWrapper

logger = logging.getLogger(__name__)


class RequestRepository:
    """Repository for BunkRequest data access"""

    def __init__(self, pb_client: PocketBase | PocketBaseWrapper) -> None:
        """Initialize repository with PocketBase client.

        Args:
            pb_client: PocketBase client instance
        """
        self.pb = pb_client

    def create(self, request: BunkRequest) -> bool:
        """Create a new bunk request in the database"""
        try:
            data = self._map_to_db(request)
            result = self.pb.collection("bunk_requests").create(data)
            return result is not None

        except Exception as e:
            logger.warning(
                f"Error creating bunk request: {e} "
                f"(requester={request.requester_cm_id}, requestee={request.requested_cm_id}, "
                f"type={request.request_type.value}, session={request.session_cm_id}, "
                f"source={request.source_field})"
            )
            return False

    def update(self, request: BunkRequest) -> bool:
        """Update an existing bunk request"""
        if not request.id:
            logger.warning("Cannot update request without ID")
            return False

        try:
            data = self._map_to_db(request)
            self.pb.collection("bunk_requests").update(request.id, data)
            return True

        except Exception as e:
            logger.warning(f"Error updating bunk request {request.id}: {e}")
            return False

    def find_existing(
        self,
        requester_cm_id: int,
        requested_cm_id: int | None,
        request_type: str,
        year: int,
        session_cm_id: int | None = None,
    ) -> BunkRequest | None:
        """Find an existing request matching the criteria.

        Args:
            requester_cm_id: CampMinder ID of the requester
            requested_cm_id: CampMinder ID of the requested person (None for placeholders)
            request_type: Type of request as string (e.g., 'bunk_with', 'not_bunk_with')
            year: Year of the request
            session_cm_id: Optional session filter - if provided, only matches requests
                          for this specific session

        Returns:
            Matching BunkRequest if found, None otherwise
        """
        try:
            # Build filter using current schema field names (post-migration)
            filter_parts = [f"requester_id = {requester_cm_id}", f"request_type = '{request_type}'", f"year = {year}"]

            if requested_cm_id is not None:
                filter_parts.append(f"requestee_id = {requested_cm_id}")
            else:
                filter_parts.append("requestee_id = null")

            # Add session filter if provided
            if session_cm_id is not None:
                filter_parts.append(f"session_id = {session_cm_id}")

            filter_str = " && ".join(filter_parts)

            result = self.pb.collection("bunk_requests").get_list(query_params={"filter": filter_str, "perPage": 1})

            if result.items:
                return self._map_from_db(result.items[0])

        except Exception as e:
            logger.warning(f"Error finding existing request: {e}")

        return None

    def clear_by_source_fields(
        self, requester_cm_id: int, source_fields: list[str], year: int, session_cm_ids: list[int] | None = None
    ) -> int:
        """Clear all requests from specific source fields for a person.

        This implements granular per-field clearing like V1:
        - Only clears requests matching the specified source_fields
        - Optionally filters by session for multi-session support
        - Paginates through all matching records (handles >1000 records)

        Args:
            requester_cm_id: Person to clear requests for
            source_fields: List of source_field values to clear
            year: Year to clear requests in
            session_cm_ids: Optional list of session CM IDs to filter by

        Returns:
            Number of requests deleted
        """
        if not source_fields:
            return 0

        page_size = 500  # Use smaller page size for safer pagination

        try:
            # Build source field filter
            field_conditions = [f"source_field = '{field}'" for field in source_fields]
            field_filter = "(" + " || ".join(field_conditions) + ")"

            filter_str = f"requester_id = {requester_cm_id} && year = {year} && {field_filter}"

            # Add session filter if provided
            if session_cm_ids:
                session_conditions = [f"session_id = {sid}" for sid in session_cm_ids]
                session_filter = "(" + " || ".join(session_conditions) + ")"
                filter_str += f" && {session_filter}"

            # Paginate through all matching records
            deleted_count = 0
            page = 1

            while True:
                result = self.pb.collection("bunk_requests").get_list(
                    page=page, per_page=page_size, query_params={"filter": filter_str}
                )

                if not result.items:
                    break

                # Delete each record in this page
                for item in result.items:
                    try:
                        self.pb.collection("bunk_requests").delete(item.id)
                        deleted_count += 1
                    except Exception as e:
                        logger.warning(f"Error deleting request {item.id}: {e}")

                # If we got fewer than page_size, we're done
                if len(result.items) < page_size:
                    break

                # Move to next page
                page += 1

            return deleted_count

        except Exception as e:
            logger.error(f"Error clearing requests by source fields: {e}")
            return 0

    def clear_all_for_year(self, year: int, verify: bool = False, batch_size: int = 500) -> int | tuple[int, bool]:
        """Clear ALL bunk requests for a specific year (test/reset mode).

        This implements the monolith's "test mode" (person_cm_ids=None) for clearing
        the entire year's requests. Useful for admin/testing scenarios.

        Args:
            year: Year to clear all requests for
            verify: If True, verify clearing succeeded and return tuple (count, verified)
            batch_size: Number of records to fetch per batch (default 500)

        Returns:
            If verify=False: int - count of deleted requests
            If verify=True: tuple (int, bool) - (count deleted, verification passed)
        """
        total_deleted = 0

        try:
            logger.info(f"Clearing ALL bunk requests for year {year} (test mode)")

            while True:
                # Always fetch page 1 - as we delete, new records become "first"
                result = self.pb.collection("bunk_requests").get_list(page=1, per_page=batch_size)

                if not result.items:
                    break

                # This ensures we never accidentally delete wrong year's data
                year_filtered = [r for r in result.items if getattr(r, "year", None) == year]

                if not year_filtered:
                    # No more records for this year
                    break

                # Delete this batch
                for request in year_filtered:
                    try:
                        self.pb.collection("bunk_requests").delete(request.id)
                        total_deleted += 1
                        if total_deleted % 100 == 0:
                            logger.debug(f"Progress: deleted {total_deleted} requests")
                    except Exception as e:
                        logger.warning(f"Error deleting request {request.id}: {e}")

            logger.info(f"Deleted {total_deleted} existing requests for year {year}")

            if verify:
                # Verify the table is empty for this year
                verify_result = self.pb.collection("bunk_requests").get_list(
                    page=1, per_page=1, query_params={"filter": f"year = {year}"}
                )
                verified = verify_result.total_items == 0
                if not verified:
                    logger.warning(f"After deletion, {verify_result.total_items} requests still remain for year {year}")
                return total_deleted, verified

            return total_deleted

        except Exception as e:
            logger.error(f"Error clearing all requests for year {year}: {e}")
            if verify:
                return total_deleted, False
            return total_deleted

    def _map_to_db(self, request: BunkRequest) -> dict[str, Any]:
        """Map BunkRequest model to database format

        Note: Field names match current PocketBase schema (post-migration):
        - requester_id (not requester_person_id)
        - requestee_id (not requested_person_id)
        - session_id (still a direct number field with CM ID)
        """
        data = {
            "requester_id": request.requester_cm_id,
            "requestee_id": request.requested_cm_id,
            "requested_person_name": request.requested_name,  # Store target name for GUI display
            "request_type": request.request_type.value,
            "session_id": request.session_cm_id,
            "priority": request.priority,
            "confidence_score": request.confidence_score,
            "source": request.source.value,
            "source_field": request.source_field,
            "csv_position": request.csv_position,
            "year": request.year,
            "status": request.status.value,
            "is_placeholder": request.is_placeholder,
            "metadata": json.dumps(request.metadata) if request.metadata else "{}",
        }

        # Extract fields from metadata to top-level DB columns
        if request.metadata:
            if "source_detail" in request.metadata:
                data["source_detail"] = request.metadata["source_detail"]
            if "original_text" in request.metadata:
                data["original_text"] = request.metadata["original_text"]
            if "parse_notes" in request.metadata:
                data["parse_notes"] = request.metadata["parse_notes"]
            if "keywords_found" in request.metadata:
                data["keywords_found"] = json.dumps(request.metadata["keywords_found"])
            if "ai_p1_reasoning" in request.metadata:
                data["ai_p1_reasoning"] = json.dumps(request.metadata["ai_p1_reasoning"])
            if "ai_p3_reasoning" in request.metadata:
                data["ai_p3_reasoning"] = json.dumps(request.metadata["ai_p3_reasoning"])
            if "ai_parsed" in request.metadata:
                data["ai_parsed"] = request.metadata["ai_parsed"]
            if "is_reciprocal" in request.metadata:
                data["is_reciprocal"] = request.metadata["is_reciprocal"]
            if "age_preference" in request.metadata:
                data["age_preference_target"] = request.metadata["age_preference"]

        # Add optional fields
        if hasattr(request, "resolution_notes") and request.resolution_notes:
            data["resolution_notes"] = request.resolution_notes

        return data

    def get_by_id(self, record_id: str) -> BunkRequest | None:
        """Get a bunk request by its PocketBase record ID.

        Args:
            record_id: PocketBase record ID

        Returns:
            BunkRequest if found, None otherwise
        """
        try:
            result = self.pb.collection("bunk_requests").get_one(record_id)
            return self._map_from_db(result)
        except Exception as e:
            logger.warning(f"Error getting request by id {record_id}: {e}")
            return None

    def update_for_merge(
        self,
        record_id: str,
        source_fields: list[str],
        confidence_score: float,
        metadata: dict[str, Any],
    ) -> bool:
        """Update an existing request during merge operation.

        Updates the source_fields array, confidence score, and metadata
        when merging a new source into an existing request.

        Args:
            record_id: PocketBase record ID of the request to update
            source_fields: Combined list of all contributing source fields
            confidence_score: New confidence score (should be max of old and new)
            metadata: Merged metadata dict

        Returns:
            True if update succeeded, False otherwise
        """
        try:
            data = {
                "source_fields": json.dumps(source_fields),
                "confidence_score": confidence_score,
                "metadata": json.dumps(metadata),
            }
            self.pb.collection("bunk_requests").update(record_id, data)
            return True
        except Exception as e:
            logger.warning(f"Error updating request for merge {record_id}: {e}")
            return False

    def _map_from_db(self, db_record: Any) -> BunkRequest:
        """Map database record to BunkRequest model

        Note: Field names match current PocketBase schema (post-migration):
        - requester_id (not requester_person_id)
        - requestee_id (not requested_person_id)
        """
        # Parse metadata - handle both JSON string and dict (PocketBase varies by version)
        metadata: dict[str, Any] = {}
        if hasattr(db_record, "metadata") and db_record.metadata:
            if isinstance(db_record.metadata, dict):
                metadata = db_record.metadata
            elif isinstance(db_record.metadata, str):
                try:
                    metadata = json.loads(db_record.metadata)
                except json.JSONDecodeError:
                    logger.warning(f"Error parsing metadata for request {db_record.id}")

        # Get field values with fallback for attribute access
        def get_field(record: Any, name: str, default: Any = None) -> Any:
            if hasattr(record, name):
                return getattr(record, name)
            elif isinstance(record, dict):
                return record.get(name, default)
            return default

        request = BunkRequest(
            requester_cm_id=get_field(db_record, "requester_id"),
            requested_cm_id=get_field(db_record, "requestee_id"),
            request_type=RequestType(get_field(db_record, "request_type")),
            session_cm_id=get_field(db_record, "session_id"),
            priority=get_field(db_record, "priority"),
            confidence_score=get_field(db_record, "confidence_score"),
            source=RequestSource(get_field(db_record, "source"))
            if get_field(db_record, "source")
            else RequestSource.FAMILY,
            source_field=get_field(db_record, "source_field"),
            csv_position=get_field(db_record, "csv_position"),
            year=get_field(db_record, "year"),
            status=RequestStatus(get_field(db_record, "status")),
            is_placeholder=get_field(db_record, "is_placeholder", False),
            metadata=metadata,
            id=get_field(db_record, "id"),  # PocketBase record ID for updates
        )

        return request

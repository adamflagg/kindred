"""Debug Parse Repository - Stores Phase 1 AI parsing results for debugging.

This repository manages the debug_parse_results collection which stores
Phase 1 parsing output separately from production bunk_requests.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pocketbase import PocketBase

    from ..pocketbase_wrapper import PocketBaseWrapper

logger = logging.getLogger(__name__)


class DebugParseRepository:
    """Repository for debug parse results."""

    COLLECTION_NAME = "debug_parse_results"

    def __init__(self, pb_client: PocketBase | PocketBaseWrapper) -> None:
        """Initialize the repository.

        Args:
            pb_client: PocketBase client instance
        """
        self.pb = pb_client

    def save_result(self, result_data: dict[str, Any]) -> str | None:
        """Save a Phase 1 debug result.

        Args:
            result_data: Dictionary containing:
                - original_request_id: ID of the original_bunk_requests record
                - session_id: Optional session ID for filtering
                - parsed_intents: List of parsed intent dictionaries
                - ai_raw_response: Optional raw AI response for debugging
                - token_count: Optional token count
                - prompt_version: Optional prompt version string
                - processing_time_ms: Optional processing time in milliseconds
                - is_valid: Whether parsing succeeded
                - error_message: Optional error message if parsing failed

        Returns:
            ID of created record, or None on error
        """
        try:
            record_data = {
                "original_request": result_data.get("original_request_id", ""),
                "session": result_data.get("session_id") or "",
                "parsed_intents": result_data.get("parsed_intents", []),
                "ai_raw_response": result_data.get("ai_raw_response"),
                "token_count": result_data.get("token_count"),
                "prompt_version": result_data.get("prompt_version"),
                "processing_time_ms": result_data.get("processing_time_ms"),
                "is_valid": result_data.get("is_valid", True),
                "error_message": result_data.get("error_message"),
            }

            result = self.pb.collection(self.COLLECTION_NAME).create(record_data)
            return result.id
        except Exception as e:
            logger.warning(f"Failed to save debug parse result: {e}")
            return None

    def get_by_original_request(self, original_request_id: str) -> dict[str, Any] | None:
        """Get the most recent debug result for an original request.

        Args:
            original_request_id: ID of the original_bunk_requests record

        Returns:
            Dictionary with debug result data, or None if not found
        """
        try:
            result = self.pb.collection(self.COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'original_request = "{original_request_id}"',
                    "sort": "-created",
                    "perPage": 1,
                }
            )

            if not result.items:
                return None

            record = result.items[0]
            return self._format_record(record)
        except Exception as e:
            logger.warning(f"Failed to get debug parse result: {e}")
            return None

    def get_by_id(self, record_id: str) -> dict[str, Any] | None:
        """Get a debug result by its ID.

        Args:
            record_id: ID of the debug_parse_results record

        Returns:
            Dictionary with debug result data, or None if not found
        """
        try:
            record = self.pb.collection(self.COLLECTION_NAME).get_one(
                record_id,
                query_params={
                    "expand": "original_request,original_request.requester",
                },
            )
            return self._format_record_with_expand(record)
        except Exception as e:
            logger.warning(f"Failed to get debug parse result by ID: {e}")
            return None

    def list_with_originals(
        self,
        limit: int = 50,
        offset: int = 0,
        session_id: str | None = None,
        source_field: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """List debug results with expanded original request data.

        Args:
            limit: Maximum number of results
            offset: Offset for pagination
            session_id: Optional session PocketBase ID to filter by
            source_field: Optional source field to filter by

        Returns:
            Tuple of (list of results, total count)
        """
        try:
            # Build filter
            filters = []
            if session_id:
                filters.append(f'session = "{session_id}"')
            if source_field:
                filters.append(f'original_request.field = "{source_field}"')

            filter_str = " && ".join(filters) if filters else ""

            # Calculate page number from offset
            page = (offset // limit) + 1 if limit > 0 else 1

            result = self.pb.collection(self.COLLECTION_NAME).get_list(
                query_params={
                    "filter": filter_str,
                    "sort": "-created",
                    "perPage": limit,
                    "page": page,
                    "expand": "original_request,original_request.requester",
                }
            )

            items = [self._format_record_with_expand(record) for record in result.items]
            return items, result.total_items
        except Exception as e:
            logger.warning(f"Failed to list debug parse results: {e}")
            return [], 0

    def delete_by_original_request(self, original_request_id: str) -> bool:
        """Delete debug results for an original request.

        Args:
            original_request_id: ID of the original_bunk_requests record

        Returns:
            True if deleted, False otherwise
        """
        try:
            result = self.pb.collection(self.COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'original_request = "{original_request_id}"',
                    "perPage": 100,
                }
            )

            if not result.items:
                return False

            for record in result.items:
                self.pb.collection(self.COLLECTION_NAME).delete(record.id)

            return True
        except Exception as e:
            logger.warning(f"Failed to delete debug parse result: {e}")
            return False

    def clear_all(self) -> int:
        """Delete all debug results.

        Returns:
            Number of records deleted, or -1 on error
        """
        try:
            deleted_count = 0
            while True:
                result = self.pb.collection(self.COLLECTION_NAME).get_list(query_params={"perPage": 100})

                if not result.items:
                    break

                for record in result.items:
                    self.pb.collection(self.COLLECTION_NAME).delete(record.id)
                    deleted_count += 1

            return deleted_count
        except Exception as e:
            logger.warning(f"Failed to clear debug parse results: {e}")
            return -1

    def _format_record(self, record: Any) -> dict[str, Any]:
        """Format a record for API response.

        Args:
            record: PocketBase record

        Returns:
            Formatted dictionary
        """
        return {
            "id": record.id,
            "original_request_id": record.original_request,
            "session_id": getattr(record, "session", None),
            "parsed_intents": getattr(record, "parsed_intents", []) or [],
            "ai_raw_response": getattr(record, "ai_raw_response", None),
            "token_count": getattr(record, "token_count", None),
            "prompt_version": getattr(record, "prompt_version", None),
            "processing_time_ms": getattr(record, "processing_time_ms", None),
            "is_valid": getattr(record, "is_valid", True),
            "error_message": getattr(record, "error_message", None),
            "created": str(record.created) if hasattr(record, "created") else None,
        }

    def _format_record_with_expand(self, record: Any) -> dict[str, Any]:
        """Format a record with expanded relations for API response.

        Args:
            record: PocketBase record with expanded relations

        Returns:
            Formatted dictionary with requester info and original text
        """
        base = self._format_record(record)

        # Extract original request data if expanded
        if hasattr(record, "expand") and record.expand:
            original = record.expand.get("original_request")
            if original:
                base["source_field"] = getattr(original, "field", None)
                base["original_text"] = getattr(original, "content", None)

                # Extract requester data if expanded
                if hasattr(original, "expand") and original.expand:
                    requester = original.expand.get("requester")
                    if requester:
                        first = getattr(requester, "preferred_name", None) or getattr(requester, "first_name", "")
                        last = getattr(requester, "last_name", "")
                        base["requester_name"] = f"{first} {last}".strip()
                        base["requester_cm_id"] = getattr(requester, "cm_id", None)

        return base

    def get_production_fallback(self, original_request_id: str) -> dict[str, Any] | None:
        """Get Phase 1 results from production bunk_requests via junction table.

        Queries bunk_request_sources to find linked bunk_requests and extracts
        their ai_p1_reasoning data for display in the debug UI.

        Args:
            original_request_id: ID of the original_bunk_requests record

        Returns:
            Dictionary with parsed_intents from production, or None if not found
        """
        try:
            # Query bunk_request_sources with bunk_request expansion
            result = self.pb.collection("bunk_request_sources").get_list(
                query_params={
                    "filter": f'original_request = "{original_request_id}"',
                    "expand": "bunk_request",
                    "perPage": 100,
                }
            )

            if not result.items:
                return None

            # Aggregate parsed intents from all linked bunk_requests
            all_intents: list[dict[str, Any]] = []

            for source in result.items:
                if not hasattr(source, "expand") or not source.expand:
                    continue

                bunk_request = source.expand.get("bunk_request")
                if not bunk_request:
                    continue

                ai_p1_reasoning = getattr(bunk_request, "ai_p1_reasoning", None)
                if not ai_p1_reasoning:
                    continue

                # Extract parsed_intents from ai_p1_reasoning
                if isinstance(ai_p1_reasoning, dict):
                    intents = ai_p1_reasoning.get("parsed_intents", [])
                    all_intents.extend(intents)

            if not all_intents:
                return None

            return {
                "source": "production",
                "parsed_intents": all_intents,
                "is_valid": True,
            }

        except Exception as e:
            logger.warning(f"Failed to get production fallback: {e}")
            return None

    def check_parse_status(self, original_request_id: str) -> tuple[bool, bool]:
        """Check if parse results exist in debug and/or production.

        Args:
            original_request_id: ID of the original_bunk_requests record

        Returns:
            Tuple of (has_debug_result, has_production_result)
        """
        has_debug = False
        has_production = False

        try:
            # Check debug_parse_results
            debug_result = self.pb.collection(self.COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'original_request = "{original_request_id}"',
                    "perPage": 1,
                }
            )
            has_debug = len(debug_result.items) > 0

            # Check bunk_request_sources (production)
            sources_result = self.pb.collection("bunk_request_sources").get_list(
                query_params={
                    "filter": f'original_request = "{original_request_id}"',
                    "perPage": 1,
                }
            )
            has_production = len(sources_result.items) > 0

        except Exception as e:
            logger.warning(f"Failed to check parse status: {e}")

        return has_debug, has_production

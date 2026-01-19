"""Debug Parse Repository - Stores Phase 1 AI parsing results for debugging.

This repository manages the debug_parse_results collection which stores
Phase 1 parsing output separately from production bunk_requests.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from bunking.sync.bunk_request_processor.services.staff_note_parser import (
    extract_staff_pattern,
)

if TYPE_CHECKING:
    from pocketbase import PocketBase

    from ..pocketbase_wrapper import PocketBaseWrapper

logger = logging.getLogger(__name__)


def _normalize_content_for_matching(content: str, field_type: str | None) -> str:
    """Normalize content from original_bunk_requests to match bunk_requests.original_text.

    During processing, bunk_requests.original_text may be sanitized:
    1. For bunking_notes: staff attribution is stripped (e.g., "STAFF NAME (date)")
    2. For some fields: multiple consecutive spaces are collapsed to single space
       (but newlines and other structure is preserved)

    Args:
        content: The raw content from original_bunk_requests
        field_type: The field type (bunk_with, bunking_notes, etc.)

    Returns:
        Normalized content that matches how it appears in bunk_requests.original_text
    """
    if not content:
        return content

    text = content

    # Step 1: Strip staff attribution for bunking_notes
    if field_type == "bunking_notes":
        text, _ = extract_staff_pattern(text)

    # Step 2: Collapse multiple consecutive spaces to single space
    # (preserves newlines and other whitespace characters)
    import re

    text = re.sub(r" {2,}", " ", text)

    return text


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
        """Get Phase 1 results from production bunk_requests.

        Queries bunk_requests directly by matching requester_id and original_text
        from the original_bunk_requests record.

        Args:
            original_request_id: ID of the original_bunk_requests record

        Returns:
            Dictionary with parsed_intents from production, or None if not found
        """
        try:
            # First, load the original request to get requester cm_id and content
            orig_result = self.pb.collection("original_bunk_requests").get_one(
                original_request_id,
                query_params={"expand": "requester"},
            )

            if not orig_result:
                return None

            # Get requester cm_id from expanded relation
            requester = None
            if hasattr(orig_result, "expand") and orig_result.expand:
                requester = orig_result.expand.get("requester")

            if not requester:
                return None

            requester_cm_id = getattr(requester, "cm_id", None)
            original_text = getattr(orig_result, "content", None)
            field_type = getattr(orig_result, "field", None)

            if not requester_cm_id or not original_text:
                return None

            # Normalize content to match how it appears in bunk_requests.original_text
            # (staff stripping for bunking_notes, whitespace normalization for all)
            text_to_match = _normalize_content_for_matching(original_text, field_type)

            # Query bunk_requests directly by requester_id and original_text
            # Need to escape quotes in original_text for PocketBase filter
            escaped_text = text_to_match.replace('"', '\\"')
            filter_str = f'requester_id = {requester_cm_id} && original_text = "{escaped_text}"'

            bunk_results = self.pb.collection("bunk_requests").get_list(
                query_params={
                    "filter": filter_str,
                    "perPage": 100,
                }
            )

            if not bunk_results.items:
                return None

            # Build parsed_intents from bunk_request records
            all_intents: list[dict[str, Any]] = []

            for br in bunk_results.items:
                # Extract data from main fields and metadata
                metadata = getattr(br, "metadata", {}) or {}

                intent: dict[str, Any] = {
                    "request_type": getattr(br, "request_type", "unknown"),
                    "target_name": metadata.get("target_name") or getattr(br, "target_name", None),
                    "keywords_found": metadata.get("keywords_found", []) or getattr(br, "keywords_found", []),
                    "parse_notes": metadata.get("parse_notes", "") or getattr(br, "parse_notes", ""),
                    "reasoning": metadata.get("reasoning", ""),
                    "list_position": getattr(br, "csv_position", 0),
                    "needs_clarification": getattr(br, "requires_manual_review", False),
                    "temporal_info": None,
                }
                all_intents.append(intent)

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

            # Check bunk_requests directly (production)
            # Load original request to get requester cm_id and content
            orig_result = self.pb.collection("original_bunk_requests").get_one(
                original_request_id,
                query_params={"expand": "requester"},
            )

            if orig_result:
                requester = None
                if hasattr(orig_result, "expand") and orig_result.expand:
                    requester = orig_result.expand.get("requester")

                if requester:
                    requester_cm_id = getattr(requester, "cm_id", None)
                    original_text = getattr(orig_result, "content", None)
                    field_type = getattr(orig_result, "field", None)

                    if requester_cm_id and original_text:
                        # Normalize content to match bunk_requests.original_text
                        text_to_match = _normalize_content_for_matching(original_text, field_type)

                        escaped_text = text_to_match.replace('"', '\\"')
                        filter_str = f'requester_id = {requester_cm_id} && original_text = "{escaped_text}"'

                        prod_result = self.pb.collection("bunk_requests").get_list(
                            query_params={"filter": filter_str, "perPage": 1}
                        )
                        has_production = len(prod_result.items) > 0

        except Exception as e:
            logger.warning(f"Failed to check parse status: {e}")

        return has_debug, has_production

    def check_parse_status_batch(self, original_request_ids: list[str]) -> dict[str, tuple[bool, bool]]:
        """Check parse status for multiple original requests in batch.

        Args:
            original_request_ids: List of original_bunk_requests record IDs

        Returns:
            Dict mapping original_request_id -> (has_debug, has_production)
        """
        if not original_request_ids:
            return {}

        # Initialize result with all False
        result: dict[str, tuple[bool, bool]] = {rid: (False, False) for rid in original_request_ids}

        try:
            # Build filter for debug results
            id_conditions = [f'original_request = "{rid}"' for rid in original_request_ids]
            filter_str = "(" + " || ".join(id_conditions) + ")"

            # Single query: debug_parse_results
            debug_results = self.pb.collection(self.COLLECTION_NAME).get_full_list(
                query_params={"filter": filter_str, "fields": "original_request"}
            )
            debug_ids = {r.original_request for r in debug_results}  # type: ignore[attr-defined]

            # For production: load original requests to get (cm_id, content) pairs
            orig_filter = "(" + " || ".join(f'id = "{rid}"' for rid in original_request_ids) + ")"
            orig_results = self.pb.collection("original_bunk_requests").get_full_list(
                query_params={"filter": orig_filter, "expand": "requester"}
            )

            # Build lookup: original_request_id -> (cm_id, content_to_match)
            # Normalize content to match bunk_requests.original_text
            orig_lookup: dict[str, tuple[int, str]] = {}
            for orig in orig_results:
                requester = None
                if hasattr(orig, "expand") and orig.expand:
                    requester = orig.expand.get("requester")
                if requester:
                    cm_id = getattr(requester, "cm_id", None)
                    content = getattr(orig, "content", None)
                    field_type = getattr(orig, "field", None)
                    if cm_id and content:
                        # Normalize content to match bunk_requests.original_text
                        content_to_match = _normalize_content_for_matching(content, field_type)
                        orig_lookup[orig.id] = (cm_id, content_to_match)

            # Get unique requester cm_ids to batch query bunk_requests
            cm_ids = {v[0] for v in orig_lookup.values()}
            if cm_ids:
                cm_id_filter = " || ".join(f"requester_id = {cm_id}" for cm_id in cm_ids)
                bunk_results = self.pb.collection("bunk_requests").get_full_list(
                    query_params={
                        "filter": f"({cm_id_filter})",
                        "fields": "requester_id,original_text",
                    }
                )

                # Build set of (cm_id, original_text) pairs that exist in bunk_requests
                prod_pairs: set[tuple[int, str]] = set()
                for br in bunk_results:
                    cm_id = getattr(br, "requester_id", None)
                    text = getattr(br, "original_text", None)
                    if cm_id and text:
                        prod_pairs.add((cm_id, text))

                # Check each original request against the production pairs
                for rid, (cm_id, content) in orig_lookup.items():
                    has_prod = (cm_id, content) in prod_pairs
                    has_debug = rid in debug_ids
                    result[rid] = (has_debug, has_prod)

            # Update debug status for requests not in orig_lookup
            for rid in original_request_ids:
                if rid not in orig_lookup:
                    result[rid] = (rid in debug_ids, False)

        except Exception as e:
            logger.warning(f"Failed to check parse status batch: {e}")

        return result

    def get_results_batch(self, original_request_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Get parse results for multiple original requests in batch.

        Returns debug results where available, otherwise production fallback.
        This is optimized to use minimal database queries.

        Args:
            original_request_ids: List of original_bunk_requests record IDs

        Returns:
            Dict mapping original_request_id -> result dict with:
                - source: "debug" | "production" | "none"
                - parsed_intents: list of intent dicts
                - is_valid: bool
                - error_message: optional str
                - Plus original request data (always included)
        """
        if not original_request_ids:
            return {}

        result: dict[str, dict[str, Any]] = {}

        try:
            # Query 1: Load all original requests with expanded requester
            orig_filter = "(" + " || ".join(f'id = "{rid}"' for rid in original_request_ids) + ")"
            orig_results = self.pb.collection("original_bunk_requests").get_full_list(
                query_params={"filter": orig_filter, "expand": "requester"}
            )

            # Build lookup for original request data
            orig_data: dict[str, dict[str, Any]] = {}
            orig_lookup: dict[str, tuple[int, str]] = {}  # id -> (cm_id, content)

            for orig in orig_results:
                requester = None
                if hasattr(orig, "expand") and orig.expand:
                    requester = orig.expand.get("requester")

                requester_cm_id = getattr(requester, "cm_id", None) if requester else None
                first_name = (
                    getattr(requester, "preferred_name", None) or getattr(requester, "first_name", "")
                    if requester
                    else ""
                )
                last_name = getattr(requester, "last_name", "") if requester else ""
                requester_name = f"{first_name} {last_name}".strip()

                content = getattr(orig, "content", "")
                field = getattr(orig, "field", "")

                orig_data[orig.id] = {
                    "original_request_id": orig.id,
                    "requester_name": requester_name,
                    "requester_cm_id": requester_cm_id,
                    "source_field": field,
                    "original_text": content,
                }

                if requester_cm_id and content:
                    # Normalize content to match bunk_requests.original_text
                    content_to_match = _normalize_content_for_matching(content, field)
                    orig_lookup[orig.id] = (requester_cm_id, content_to_match)

            # Query 2: Load all debug results
            debug_filter = "(" + " || ".join(f'original_request = "{rid}"' for rid in original_request_ids) + ")"
            debug_results = self.pb.collection(self.COLLECTION_NAME).get_full_list(
                query_params={"filter": debug_filter}
            )

            # Build debug results lookup
            debug_by_orig: dict[str, Any] = {}
            for dr in debug_results:
                orig_id = getattr(dr, "original_request", None)
                if orig_id:
                    debug_by_orig[orig_id] = dr

            # Query 3: Load bunk_requests for production fallback
            cm_ids = {v[0] for v in orig_lookup.values()}
            prod_by_pair: dict[tuple[int, str], list[Any]] = {}

            if cm_ids:
                cm_id_filter = " || ".join(f"requester_id = {cm_id}" for cm_id in cm_ids)
                bunk_results = self.pb.collection("bunk_requests").get_full_list(
                    query_params={"filter": f"({cm_id_filter})"}
                )

                # Group bunk_requests by (cm_id, original_text)
                for br in bunk_results:
                    cm_id = getattr(br, "requester_id", None)
                    text = getattr(br, "original_text", None)
                    if cm_id and text:
                        key = (cm_id, text)
                        if key not in prod_by_pair:
                            prod_by_pair[key] = []
                        prod_by_pair[key].append(br)

            # Build results for each original request
            for rid in original_request_ids:
                base = orig_data.get(
                    rid,
                    {
                        "original_request_id": rid,
                        "requester_name": "",
                        "requester_cm_id": None,
                        "source_field": "",
                        "original_text": "",
                    },
                )

                # Check for debug result first
                if rid in debug_by_orig:
                    dr = debug_by_orig[rid]
                    result[rid] = {
                        **base,
                        "source": "debug",
                        "id": dr.id,
                        "parsed_intents": getattr(dr, "parsed_intents", []) or [],
                        "is_valid": getattr(dr, "is_valid", True),
                        "error_message": getattr(dr, "error_message", None),
                        "token_count": getattr(dr, "token_count", None),
                        "processing_time_ms": getattr(dr, "processing_time_ms", None),
                        "prompt_version": getattr(dr, "prompt_version", None),
                        "created": getattr(dr, "created", None),
                    }
                    continue

                # Check for production fallback
                if rid in orig_lookup:
                    cm_id, content = orig_lookup[rid]
                    prod_records = prod_by_pair.get((cm_id, content), [])

                    if prod_records:
                        # Build parsed_intents from production bunk_request records
                        intents = []
                        for br in prod_records:
                            metadata = getattr(br, "metadata", {}) or {}
                            intent = {
                                "request_type": getattr(br, "request_type", "unknown"),
                                "target_name": metadata.get("target_name") or getattr(br, "target_name", None),
                                "keywords_found": metadata.get("keywords_found", []),
                                "parse_notes": metadata.get("parse_notes", ""),
                                "reasoning": metadata.get("reasoning", ""),
                                "list_position": getattr(br, "csv_position", 0),
                                "needs_clarification": getattr(br, "requires_manual_review", False),
                                "temporal_info": None,
                            }
                            intents.append(intent)

                        result[rid] = {
                            **base,
                            "source": "production",
                            "parsed_intents": intents,
                            "is_valid": True,
                        }
                        continue

                # Neither debug nor production
                result[rid] = {
                    **base,
                    "source": "none",
                    "parsed_intents": [],
                    "is_valid": True,
                }

        except Exception as e:
            logger.warning(f"Failed to get results batch: {e}")
            # Return empty results for all on error
            for rid in original_request_ids:
                if rid not in result:
                    result[rid] = {
                        "original_request_id": rid,
                        "source": "none",
                        "parsed_intents": [],
                        "is_valid": False,
                        "error_message": str(e),
                    }

        return result

    def clear_by_filter(
        self,
        session_id: str | None = None,
        source_field: str | None = None,
    ) -> int:
        """Delete debug results matching the given filters.

        Args:
            session_id: Optional PocketBase session ID to filter by
            source_field: Optional source field to filter by

        Returns:
            Number of records deleted, or -1 on error
        """
        try:
            # Build filter
            filters = []
            if session_id:
                filters.append(f'session = "{session_id}"')
            if source_field:
                filters.append(f'original_request.field = "{source_field}"')

            filter_str = " && ".join(filters) if filters else ""

            # Get matching records
            result = self.pb.collection(self.COLLECTION_NAME).get_full_list(
                query_params={"filter": filter_str} if filter_str else {}
            )

            if not result:
                return 0

            # Delete each record
            deleted_count = 0
            for record in result:
                try:
                    self.pb.collection(self.COLLECTION_NAME).delete(record.id)
                    deleted_count += 1
                except Exception as e:
                    logger.warning(f"Failed to delete debug result {record.id}: {e}")

            return deleted_count
        except Exception as e:
            logger.warning(f"Failed to clear debug results by filter: {e}")
            return -1

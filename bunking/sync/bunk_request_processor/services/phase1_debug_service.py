"""Phase 1 Debug Service - Isolated Phase 1 parsing for debug UI.

This service wraps Phase1ParseService to enable:
- Running Phase 1 parsing in isolation (no Phase 2/3)
- Storing results in debug_parse_results collection
- Caching with optional force_reparse
- Token tracking for prompt iteration
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from ..core.models import ParseRequest, ParseResult, RequestType
from ..shared.constants import FIELD_TO_SOURCE_FIELD

if TYPE_CHECKING:
    from ..data.repositories.debug_parse_repository import DebugParseRepository
    from ..integration.original_requests_loader import OriginalRequest, OriginalRequestsLoader
    from .phase1_parse_service import Phase1ParseService

logger = logging.getLogger(__name__)


class Phase1DebugService:
    """Service for isolated Phase 1 parsing for debugging."""

    def __init__(
        self,
        debug_repo: DebugParseRepository,
        original_requests_loader: OriginalRequestsLoader,
        phase1_service: Phase1ParseService,
        prompt_version: str | None = None,
    ) -> None:
        """Initialize the debug service.

        Args:
            debug_repo: Repository for storing debug results
            original_requests_loader: Loader for original_bunk_requests
            phase1_service: Phase 1 parsing service
            prompt_version: Version string to track which prompt was used
        """
        self.debug_repo = debug_repo
        self.original_requests_loader = original_requests_loader
        self.phase1_service = phase1_service
        self.prompt_version = prompt_version or "unknown"

    async def parse_selected_records(
        self, original_request_ids: list[str], force_reparse: bool = False
    ) -> list[dict[str, Any]]:
        """Parse selected original_bunk_requests records with Phase 1 only.

        Args:
            original_request_ids: List of original_bunk_requests PocketBase IDs
            force_reparse: If True, ignore cache and reparse

        Returns:
            List of formatted debug results
        """
        if not original_request_ids:
            return []

        results: list[dict[str, Any]] = []
        to_parse_ids: list[str] = []

        # Check cache for each request
        for orig_id in original_request_ids:
            if not force_reparse:
                cached = self.debug_repo.get_by_original_request(orig_id)
                if cached:
                    results.append(cached)
                    continue

            # Need to parse this one
            to_parse_ids.append(orig_id)

            # If force reparse, delete old cache
            if force_reparse:
                self.debug_repo.delete_by_original_request(orig_id)

        if not to_parse_ids:
            return results

        # Load original requests
        original_records = self.original_requests_loader.load_by_ids(to_parse_ids)

        if not original_records:
            logger.warning(f"No original records found for IDs: {to_parse_ids}")
            return results

        # Convert to ParseRequest format
        parse_requests: list[ParseRequest] = []
        original_map: dict[str, OriginalRequest] = {}  # Map requester_cm_id to original record

        for orig in original_records:
            parse_req = self._convert_to_parse_request(orig)
            if parse_req:
                parse_requests.append(parse_req)
                # Key by requester_cm_id + field for later mapping
                key = f"{parse_req.requester_cm_id}_{parse_req.field_name}"
                original_map[key] = orig

        if not parse_requests:
            return results

        # Run Phase 1 parsing
        start_time = time.time()
        parse_results = await self.phase1_service.batch_parse(parse_requests)
        processing_time_ms = int((time.time() - start_time) * 1000)

        # Save results and build response
        for i, parse_result in enumerate(parse_results):
            if i >= len(parse_requests):
                break

            parse_req = parse_requests[i]
            key = f"{parse_req.requester_cm_id}_{parse_req.field_name}"
            orig_maybe = original_map.get(key)

            if not orig_maybe:
                continue

            orig = orig_maybe

            # Format and save result
            formatted = self._format_parse_result(parse_result, orig.id)
            formatted["processing_time_ms"] = processing_time_ms // len(parse_results)

            # Save to debug collection
            saved_id = self.debug_repo.save_result(
                {
                    "original_request_id": orig.id,
                    "session_id": None,  # Could be added if needed
                    "parsed_intents": formatted["parsed_intents"],
                    "ai_raw_response": parse_result.metadata.get("ai_raw_response"),
                    "token_count": formatted.get("token_count"),
                    "prompt_version": self.prompt_version,
                    "processing_time_ms": formatted["processing_time_ms"],
                    "is_valid": formatted["is_valid"],
                    "error_message": formatted.get("error_message"),
                }
            )

            if saved_id:
                formatted["id"] = saved_id

            results.append(formatted)

        return results

    async def parse_by_filter(
        self,
        session_cm_id: int | None = None,
        source_field: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Parse original_bunk_requests matching filter criteria.

        Args:
            session_cm_id: Optional session CM ID to filter by
            source_field: Optional source field to filter by
            limit: Maximum number of records to parse

        Returns:
            List of formatted debug results
        """
        # Build filter params for loader
        original_records = self.original_requests_loader.load_by_filter(
            session_cm_id=session_cm_id,
            source_field=source_field,
            limit=limit,
        )

        if not original_records:
            return []

        # Extract IDs and delegate to parse_selected_records
        ids = [rec.id for rec in original_records]
        return await self.parse_selected_records(ids, force_reparse=False)

    def _convert_to_parse_request(
        self, original: Any, session_cm_id: int | None = None, session_name: str | None = None
    ) -> ParseRequest | None:
        """Convert an original_bunk_requests record to ParseRequest format.

        Args:
            original: OriginalRequest or PocketBase record
            session_cm_id: Session CM ID (optional, will try to get from person cache)
            session_name: Session name (optional)

        Returns:
            ParseRequest or None if conversion fails
        """
        try:
            # Handle both OriginalRequest dataclass and raw PB records
            if hasattr(original, "expand") and original.expand:
                # Raw PocketBase record with expand
                requester = original.expand.get("requester")
                if not requester:
                    return None

                first = getattr(requester, "preferred_name", None) or getattr(requester, "first_name", "")
                last = getattr(requester, "last_name", "")
                requester_name = f"{first} {last}".strip()
                requester_cm_id = getattr(requester, "cm_id", 0)
                grade = getattr(requester, "grade", None)
                content = getattr(original, "content", "")
                field = getattr(original, "field", "")
                year = getattr(original, "year", 2025)
            else:
                # OriginalRequest dataclass
                first = original.preferred_name or original.first_name
                requester_name = f"{first} {original.last_name}".strip()
                requester_cm_id = original.requester_cm_id
                grade = original.grade
                content = original.content
                field = original.field
                year = original.year

            # Get session info if not provided
            if session_cm_id is None:
                session_cm_id = self.original_requests_loader.get_session_for_person(requester_cm_id) or 0
            if session_name is None:
                session_name = f"Session {session_cm_id}" if session_cm_id else "Unknown"

            return ParseRequest(
                request_text=content,
                field_name=FIELD_TO_SOURCE_FIELD.get(field, field),
                requester_name=requester_name,
                requester_cm_id=requester_cm_id,
                requester_grade=str(grade) if grade else "",
                session_cm_id=session_cm_id,
                session_name=session_name,
                year=year,
                row_data={"_original_request_id": getattr(original, "id", "")},
            )
        except Exception as e:
            logger.warning(f"Failed to convert original request: {e}")
            return None

    def _format_parse_result(self, parse_result: ParseResult, original_request_id: str) -> dict[str, Any]:
        """Format a ParseResult for API response.

        Args:
            parse_result: Result from Phase 1 parsing
            original_request_id: ID of the original request

        Returns:
            Formatted dictionary for API/storage
        """
        parsed_intents = []
        for i, parsed_req in enumerate(parse_result.parsed_requests):
            intent = {
                "request_type": parsed_req.request_type.value
                if isinstance(parsed_req.request_type, RequestType)
                else str(parsed_req.request_type),
                "target_name": parsed_req.target_name,
                "keywords_found": parsed_req.metadata.get("keywords_found", []),
                "parse_notes": parsed_req.metadata.get("parse_notes", ""),
                "reasoning": parsed_req.metadata.get("reasoning", ""),
                "list_position": parsed_req.csv_position,
                "needs_clarification": parsed_req.metadata.get("needs_clarification", False),
                "temporal_info": None,
            }

            # Include temporal info if present
            if parsed_req.temporal_date or parsed_req.is_superseded:
                intent["temporal_info"] = {
                    "date": str(parsed_req.temporal_date) if parsed_req.temporal_date else None,
                    "is_superseded": parsed_req.is_superseded,
                    "supersedes_reason": parsed_req.supersedes_reason,
                }

            parsed_intents.append(intent)

        # Extract error message from metadata
        error_message = None
        if not parse_result.is_valid:
            error_message = parse_result.metadata.get("failure_reason", "Unknown error")

        return {
            "original_request_id": original_request_id,
            "parsed_intents": parsed_intents,
            "is_valid": parse_result.is_valid,
            "error_message": error_message,
            "token_count": parse_result.metadata.get("token_count"),
            "processing_time_ms": parse_result.metadata.get("processing_time_ms"),
            "prompt_version": self.prompt_version,
        }

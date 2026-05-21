"""Request Builder Service

Builds BunkRequest objects from parsed requests and resolution info.
Extracted from orchestrator to reduce class size and improve testability.
"""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

from ..core.models import (
    BunkRequest,
    ParsedRequest,
    RequestStatus,
    RequestType,
)
from ..disposition.disposition_rules import determine_disposition
from ..processing.first_request_detector import detect_first_request
from ..shared.constants import SourceField

logger = get_logger(__name__)


class RequestBuilder:
    """Builds BunkRequest objects from parsed requests and resolution context.

    This service handles the construction of BunkRequest objects, including:
    - Priority calculation
    - Metadata building
    - Status determination
    - Placeholder enrichment

    It does NOT handle validation or persistence - those remain in the orchestrator.
    """

    def __init__(
        self,
        temporal_name_cache: Any,
        year: int,
        auto_resolve_threshold: float,
    ) -> None:
        """Initialize the RequestBuilder.

        Args:
            temporal_name_cache: Cache for name lookups (can be None)
            year: The current year for requests
            auto_resolve_threshold: Confidence threshold for auto-resolving
        """
        self.temporal_name_cache = temporal_name_cache
        self.year = year
        self.auto_resolve_threshold = auto_resolve_threshold

    def build_requests(self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]) -> list[BunkRequest]:
        """Build BunkRequest objects from resolved requests.

        Groups by requester for first-pick detection, then builds each request.

        Args:
            resolved_requests: List of (ParsedRequest, resolution_info) tuples

        Returns:
            List of BunkRequest objects (unvalidated, unsaved)
        """
        pending_requests = []

        # Group requests by requester for first-pick detection
        requests_by_person: dict[int, list[tuple[ParsedRequest, dict[str, Any]]]] = {}
        for parsed_req, resolution_info in resolved_requests:
            requester_cm_id = resolution_info["requester_cm_id"]
            if requester_cm_id not in requests_by_person:
                requests_by_person[requester_cm_id] = []
            requests_by_person[requester_cm_id].append((parsed_req, resolution_info))

        # Process each person's requests
        for requester_cm_id, person_requests in requests_by_person.items():
            all_parsed_requests = [pr for pr, _ in person_requests]

            for parsed_req, resolution_info in person_requests:
                try:
                    bunk_request = self.build_single_request(
                        parsed_req, resolution_info, all_parsed_requests, requester_cm_id
                    )
                    if bunk_request:
                        pending_requests.append(bunk_request)
                except Exception as e:
                    logger.error(f"Failed to build bunk request: {e}")

        return pending_requests

    def build_single_request(
        self,
        parsed_req: ParsedRequest,
        resolution_info: dict[str, Any],
        all_parsed_requests: list[ParsedRequest],
        requester_cm_id: int,
    ) -> BunkRequest | None:
        """Build a single BunkRequest from parsed request and resolution info.

        Args:
            parsed_req: The parsed request
            resolution_info: Resolution context from Phase 2/3
            all_parsed_requests: All requests for this person (for first-pick detection)
            requester_cm_id: The requester's CM ID

        Returns:
            BunkRequest or None if building fails
        """
        # Determine if this is the family's "first pick" for the slot-0 boost,
        # and whether an explicit priority keyword drove that designation (TG-3).
        family_siblings = [
            r
            for r in all_parsed_requests
            if r is not parsed_req
            and r.source_field == SourceField.BUNK_REQUEST_FORM
            and r.request_type == RequestType.BUNK_WITH
        ]
        detection = detect_first_request(parsed_req, family_siblings=family_siblings)
        is_first = detection.is_first_requested
        keyword_detected = detection.priority_keyword_detected

        # Get requested person name
        requested_name = self.get_requested_name(parsed_req, resolution_info)

        # Determine if this was resolved in Phase 2 (local) or Phase 3 (AI disambiguation)
        ai_parsed = resolution_info.get("phase3_disambiguated", False)

        # Build metadata
        metadata = self.build_request_metadata(parsed_req, resolution_info, ai_parsed)

        # Determine status and disposition reason
        status, disposition_reason = self.determine_request_status(parsed_req, resolution_info, metadata)

        # Determine is_placeholder (only for true placeholders, not unresolved names)
        # True placeholders: person_cm_id is None (e.g., age_preference requests)
        # Unresolved names: person_cm_id < 0 (hash-based ID) - NOT placeholders
        # This distinction matters for database duplicate detection - unresolved requests
        # SHOULD be checked against the DB to prevent 400 errors on re-processing.
        person_cm_id = resolution_info.get("person_cm_id")
        is_placeholder = person_cm_id is None
        is_unresolved = person_cm_id is not None and person_cm_id < 0

        # Enrich metadata for both placeholders AND unresolved requests
        if is_placeholder or is_unresolved:
            session_cm_id = resolution_info.get("session_cm_id", 0)
            self.enrich_placeholder_metadata(metadata, requester_cm_id, session_cm_id, parsed_req.target_name)

        return BunkRequest(
            requester_cm_id=resolution_info["requester_cm_id"],
            requested_cm_id=person_cm_id,
            request_type=parsed_req.request_type,
            session_cm_id=resolution_info.get("session_cm_id", 0),
            is_first_requested=is_first,
            priority_keyword_detected=keyword_detected,
            confidence_score=resolution_info.get("confidence", parsed_req.confidence),
            source_field=parsed_req.source_field,
            csv_position=parsed_req.csv_position,
            year=self.year,
            status=status,
            is_placeholder=is_placeholder,
            metadata=metadata,
            requested_name=requested_name,
            resolution_method=resolution_info.get("resolution_method", ""),
            disposition_reason=disposition_reason,
        )

    def get_requested_name(self, parsed_req: ParsedRequest, resolution_info: dict[str, Any]) -> str | None:
        """Get the requested person's name from resolution or parsed request.

        Args:
            parsed_req: The parsed request
            resolution_info: Resolution context from Phase 2/3

        Returns:
            The person's name if available, None otherwise
        """
        if resolution_info.get("person_cm_id"):
            # Try to get from resolution info
            if "person_name" in resolution_info:
                name: str | None = resolution_info["person_name"]
                return name
            if "person" in resolution_info and hasattr(resolution_info["person"], "full_name"):
                full_name: str | None = resolution_info["person"].full_name
                return full_name
        elif parsed_req.target_name:
            # Use target name from parsed request
            return parsed_req.target_name
        return None

    def build_request_metadata(
        self, parsed_req: ParsedRequest, resolution_info: dict[str, Any], ai_parsed: bool
    ) -> dict[str, Any]:
        """Build comprehensive metadata dict for a bunk request.

        Args:
            parsed_req: The parsed request
            resolution_info: Resolution context from Phase 2/3
            ai_parsed: Whether this was disambiguated by AI in Phase 3

        Returns:
            Metadata dict to store with the request
        """
        metadata = {
            "parse_notes": parsed_req.notes or parsed_req.metadata.get("parse_notes", ""),
            "age_preference": parsed_req.age_preference.value if parsed_req.age_preference else None,
            "notes": parsed_req.notes,
            "is_reciprocal": resolution_info.get("is_reciprocal", False),
            "original_text": parsed_req.raw_text,
            "target_name": parsed_req.target_name,
            "keywords_found": parsed_req.metadata.get("keywords_found", []),
            "ai_p1_reasoning": parsed_req.metadata.get("reasoning", "") if not ai_parsed else "",
            "source_fragment": self._reconcile_source_fragment(parsed_req),
            "ai_p3_reasoning": resolution_info.get("resolution_metadata", {}).get("ai_p3_reasoning", {})
            if ai_parsed
            else {},
            "ai_parsed": ai_parsed,
            "locally_resolved": not ai_parsed,
        }

        # Set source_detail based on source type
        requester_name = resolution_info.get("requester_name", "")
        if requester_name:
            metadata["source_detail"] = f"Requester: {requester_name}"
            metadata["requester_full_name"] = requester_name
        else:
            metadata["source_detail"] = parsed_req.metadata.get("source_detail", "")

        return metadata

    @staticmethod
    def _reconcile_source_fragment(parsed_req: ParsedRequest) -> str:
        """Pick the minimal highlight fragment, falling back to target_name when the AI returned
        the full list as the fragment for a comma/semicolon-separated input (known failure mode).
        """
        ai_fragment = str(parsed_req.metadata.get("source_fragment", "")).strip()
        original = (parsed_req.raw_text or "").strip()
        target = (parsed_req.target_name or "").strip()

        ai_copied_whole_list = ai_fragment == original and original != "" and ("," in original or ";" in original)
        if ai_copied_whole_list and target and target in original:
            return target
        return ai_fragment

    def determine_request_status(
        self, parsed_req: ParsedRequest, resolution_info: dict[str, Any], metadata: dict[str, Any]
    ) -> tuple[RequestStatus, str]:
        """Determine the status and disposition reason for a bunk request.

        Returns:
            Tuple of (status, disposition_reason). AGE_PREFERENCE routes through
            disposition rules regardless of resolution — direction alone determines
            status (#1406). Unresolved names (other request types) return (PENDING, "").
            Resolved matches go through disposition rules (business gates + quality).
        """
        age_direction = parsed_req.age_preference.value if parsed_req.age_preference else None

        # AGE_PREFERENCE is resolution-independent: disposition_rules._age_preference_rules
        # routes by direction alone. Delegate to avoid duplicating the literals (#1411).
        if parsed_req.request_type == RequestType.AGE_PREFERENCE:
            disposition = determine_disposition(parsed_req.request_type, age_direction=age_direction)
            return disposition.status, disposition.reason

        person_cm_id = resolution_info.get("person_cm_id")

        # Unresolved: no person ID, or negative hash-based ID for an unmatched name.
        if person_cm_id is None or person_cm_id < 0:
            return RequestStatus.PENDING, ""

        # Resolved match — apply disposition rules
        conflict_type = resolution_info.get("conflict_type")

        disposition = determine_disposition(
            parsed_req.request_type,
            resolution_method=resolution_info.get("resolution_method", "unknown"),
            match_confidence=resolution_info.get("confidence", parsed_req.confidence),
            is_reciprocal=resolution_info.get("is_reciprocal", False),
            requester_is_inactive=conflict_type == "requester_not_attending",
            target_is_inactive=conflict_type == "target_not_attending",
            target_has_bunking_session=conflict_type != "target_not_enrolled",
            target_waitlisted=resolution_info.get("target_waitlisted", False),
            session_match=conflict_type not in ("session_mismatch", "cross_session_satisfied"),
            age_direction=age_direction,
            auto_resolve_threshold=self.auto_resolve_threshold,
        )

        if disposition.status == RequestStatus.DECLINED:
            metadata["declined_reason"] = resolution_info.get("conflict_description", disposition.reason)

        return disposition.status, disposition.reason

    def enrich_placeholder_metadata(
        self, metadata: dict[str, Any], requester_cm_id: int, session_cm_id: int, target_name: str | None
    ) -> None:
        """Add self-reference context to placeholder request metadata.

        Args:
            metadata: Metadata dict to enrich (modified in place)
            requester_cm_id: The requester's CM ID
            session_cm_id: The session CM ID
            target_name: The target name from parsed request
        """
        if not self.temporal_name_cache:
            return

        self_ref_context = self.temporal_name_cache.get_self_reference_context(
            requester_cm_id=requester_cm_id, session_cm_id=session_cm_id
        )
        if self_ref_context:
            metadata.update(self_ref_context)

        if target_name:
            metadata["raw_target_name"] = target_name

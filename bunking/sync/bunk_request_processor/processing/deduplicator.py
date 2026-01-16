"""Deduplicator - Removes duplicate bunk requests based on source priority

Handles deduplication within batches and optionally checks against
existing database records."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.models import BunkRequest, RequestSource, RequestType
from ..data.repositories.request_repository import RequestRepository

# Source priority order (higher number = higher priority)
# Used for deduplication tiebreaker only - staff validates family input
SOURCE_PRIORITY = {
    RequestSource.STAFF: 2,  # Staff validates/confirms family requests
    RequestSource.FAMILY: 1,  # Original family submission
}


@dataclass
class DuplicateGroup:
    """Represents a group of duplicate requests"""

    primary: BunkRequest
    duplicates: list[BunkRequest]
    # Key: (requester_cm_id, requested_cm_id, request_type, source_field, year, session_cm_id)
    # Includes source_field to prevent cross-field deduplication:
    # - Different form fields (share_bunk_with vs socialize_with) may have different semantics
    # - Staff notes vs parent form may have different timing context
    duplicate_key: tuple[int, int | None, RequestType, str, int, int]


@dataclass
class DeduplicationResult:
    """Result of deduplication process"""

    kept_requests: list[BunkRequest]
    duplicate_groups: list[DuplicateGroup]
    statistics: dict[str, int] = field(default_factory=dict)


class Deduplicator:
    """Handles deduplication of bunk requests"""

    def __init__(self, request_repository: RequestRepository | None = None):
        """Initialize the deduplicator.

        Args:
            request_repository: Repository for checking database duplicates
        """
        self.request_repository = request_repository

    def deduplicate_batch(self, requests: list[BunkRequest], check_database: bool = False) -> DeduplicationResult:
        """Deduplicate a batch of requests based on source priority.

        Args:
            requests: List of requests to deduplicate
            check_database: Whether to check for existing database records

        Returns:
            DeduplicationResult with kept requests and statistics
        """
        # Group requests by duplicate key
        request_groups: dict[tuple[int, int | None, RequestType, str, int, int] | None, list[BunkRequest]] = {}

        for request in requests:
            key: tuple[int, int | None, RequestType, str, int, int] | None
            # Check AGE_PREFERENCE FIRST - they have is_placeholder=True (no requestee)
            # but still need deduplication across source fields
            if request.request_type == RequestType.AGE_PREFERENCE:
                # Age preferences: group by (requester, None, type, "", year, session)
                # Dedupes across ALL source fields - matches DB unique constraint which
                # doesn't include source_field. Same requester's age preference from
                # different sources (AI-parsed vs dropdown) is the same intent.
                # Priority: STAFF > FAMILY during merge preserves metadata from both.
                key = (
                    request.requester_cm_id,
                    None,  # No target for age preferences
                    request.request_type,
                    "",  # Empty = dedupe across all source fields
                    request.year,
                    request.session_cm_id,
                )
            elif request.is_placeholder:
                # True placeholders (non-age_preference with no target) are unique
                key = None
            else:
                # Key generation is source-field-specific:
                # - socialize_with: Include source_field (preserves 1:1 age preference per child)
                # - Other fields: Exclude source_field (dedupes across form vs notes)
                #
                # This matches the DB unique constraint which does NOT include source_field.
                # Same requester→target from different fields = same intent = one request.
                if request.source_field == "socialize_with":
                    # socialize_with is special - never dedupe across sources
                    # This field outputs known age preference requests from dropdown values
                    key = (
                        request.requester_cm_id,
                        request.requested_cm_id,
                        request.request_type,
                        request.source_field,  # Include source_field
                        request.year,
                        request.session_cm_id,
                    )
                else:
                    # All other fields: dedupe across source fields
                    # Key: (requester_cm_id, requested_cm_id, request_type, year, session_cm_id)
                    # Matches DB unique constraint exactly
                    key = (
                        request.requester_cm_id,
                        request.requested_cm_id,
                        request.request_type,
                        "",  # Empty string placeholder to maintain tuple structure
                        request.year,
                        request.session_cm_id,
                    )

            if key:
                if key not in request_groups:
                    request_groups[key] = []
                request_groups[key].append(request)

        # Process each group
        kept_requests = []
        duplicate_groups = []
        total_duplicates = 0

        # Handle unique requests (no key) - only placeholders now
        for request in requests:
            if request.is_placeholder:
                kept_requests.append(request)

        # Handle potential duplicate groups
        for key, group_requests in request_groups.items():
            if len(group_requests) == 1:
                # No duplicates in batch
                kept_requests.append(group_requests[0])
            else:
                # Sort by source priority (descending) then confidence (descending)
                sorted_requests = sorted(
                    group_requests, key=lambda r: (SOURCE_PRIORITY.get(r.source, 0), r.confidence_score), reverse=True
                )

                primary = sorted_requests[0]
                duplicates = sorted_requests[1:]

                # Merge metadata from duplicates
                self._merge_metadata(primary, duplicates)

                kept_requests.append(primary)
                # key cannot be None here because None keys are only for placeholders,
                # which are handled separately and never reach request_groups
                assert key is not None, "Non-placeholder request should have a key"
                duplicate_groups.append(DuplicateGroup(primary=primary, duplicates=duplicates, duplicate_key=key))

                total_duplicates += len(duplicates)

        # Check database for duplicates if requested
        database_duplicates = 0
        if check_database and self.request_repository:
            for request in kept_requests:
                if not request.is_placeholder:
                    # Get request_type as string value (not enum)
                    request_type_str = (
                        request.request_type.value
                        if hasattr(request.request_type, "value")
                        else str(request.request_type)
                    )
                    existing = self.request_repository.find_existing(
                        requester_cm_id=request.requester_cm_id,
                        requested_cm_id=request.requested_cm_id,
                        request_type=request_type_str,
                        year=request.year,
                        session_cm_id=request.session_cm_id,
                    )

                    if existing:
                        request.metadata["has_database_duplicate"] = True
                        # existing is a BunkRequest object, access id attribute directly
                        request.metadata["database_duplicate_id"] = getattr(existing, "id", None)
                        database_duplicates += 1

        # Compile statistics
        statistics = {
            "total_requests": len(requests),
            "unique_requests": len(kept_requests),
            "duplicates_removed": total_duplicates,
            "duplicate_groups": len(duplicate_groups),
        }

        if check_database:
            statistics["database_duplicates"] = database_duplicates

        return DeduplicationResult(
            kept_requests=kept_requests, duplicate_groups=duplicate_groups, statistics=statistics
        )

    def _merge_metadata(self, primary: BunkRequest, duplicates: list[BunkRequest]) -> None:
        """Merge metadata from duplicate requests into the primary.

        Preserves full context from ALL source fields (e.g., when same request
        appears in bunk_with, bunking_notes, and internal_notes). This enables
        the frontend to show a split view with each source's context.

        Args:
            primary: The request to keep
            duplicates: The duplicate requests
        """
        all_requests = [primary] + duplicates

        # Build merged_sources array with full context from each source field
        merged_sources = []
        for req in all_requests:
            source_record = {
                # Identifying info
                "source": req.source.value,
                "source_field": req.source_field,
                # AI processing details
                "confidence_score": req.confidence_score,
                "original_text": req.metadata.get("original_text"),
                "ai_p1_reasoning": req.metadata.get("ai_p1_reasoning"),
                "ai_p3_reasoning": req.metadata.get("ai_p3_reasoning"),
                "parse_notes": req.metadata.get("parse_notes"),
                "keywords_found": req.metadata.get("keywords_found"),
                # Position and timing
                "csv_position": req.csv_position,
                "priority": req.priority,
            }
            merged_sources.append(source_record)

        primary.metadata["merged_sources"] = merged_sources
        primary.metadata["is_merged_duplicate"] = True

        # Track duplicate sources (legacy, for backwards compatibility)
        duplicate_sources = [r.source.value for r in duplicates]
        primary.metadata["duplicate_sources"] = duplicate_sources

        # Find highest confidence among all requests
        highest_conf = max(r.confidence_score for r in all_requests)

        # If a duplicate has higher confidence, boost the primary
        if highest_conf > primary.confidence_score:
            # Find which source had the highest confidence
            for req in all_requests:
                if req.confidence_score == highest_conf:
                    primary.metadata["confidence_boosted_from"] = req.source.value
                    break
            primary.confidence_score = highest_conf

        # Merge other metadata (primary values take precedence)
        for dup in duplicates:
            for key, value in dup.metadata.items():
                if key not in primary.metadata:
                    primary.metadata[key] = value

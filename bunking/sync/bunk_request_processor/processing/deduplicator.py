"""Deduplicator - Removes duplicate bunk requests based on source priority

Handles deduplication within batches and optionally checks against
existing database records."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field

from ..core.models import BunkRequest, RequestStatus, RequestType, source_from_field
from ..data.repositories.request_repository import RequestRepository
from ..shared.constants import SourceField

# Source field priority for dedup tiebreak.
# Materiality model: material parent intent > staff exclusion > staff
# observation > immaterial parent input. Higher number = higher priority.
# confidence_score breaks ties within rank.
SOURCE_FIELD_PRIORITY = {
    SourceField.BUNK_WITH: 4,  # material parent
    SourceField.NOT_BUNK_WITH: 3,  # staff exclusion
    SourceField.BUNKING_NOTES: 2,  # staff observation (tied with internal_notes)
    SourceField.INTERNAL_NOTES: 2,  # staff observation (tied with bunking_notes)
    SourceField.SOCIALIZE_WITH: 1,  # immaterial parent
}


def _resolve_source(req: BunkRequest) -> str:
    """Best-effort source string for metadata, never raises.

    Mirrors the validator pattern (bunking_validator.py:527-531) — falls back
    to the in-memory `req.source` when `source_field` is empty or unknown so
    a single legacy/malformed row can't abort the whole dedup pass.
    """
    try:
        return source_from_field(req.source_field).value
    except ValueError:
        return req.source.value


def _is_conflicting_age_preference_pair(group_requests: list[BunkRequest]) -> bool:
    """Return True when the group is exactly two AGE_PREFERENCE requests — one from
    SourceField.BUNK_WITH and one from SourceField.SOCIALIZE_WITH — and their
    age_preference metadata values are both present but differ.

    This is the Stage 3a conflict case: prose-derived age direction contradicts the
    boolean dropdown direction, so both rows must survive for staff review instead of
    being silently merged.
    """
    if len(group_requests) != 2:
        return False
    fields = {r.source_field for r in group_requests}
    if fields != {SourceField.BUNK_WITH, SourceField.SOCIALIZE_WITH}:
        return False
    targets = [r.metadata.get("age_preference") for r in group_requests]
    # Both must be non-None strings and they must differ
    if targets[0] is None or targets[1] is None:
        return False
    return bool(targets[0] != targets[1])


def _split_age_pref_pair(
    group_requests: list[BunkRequest],
) -> tuple[BunkRequest, BunkRequest]:
    """Return (bunk_with_row, socialize_with_row) from a two-element group known to
    contain exactly one BUNK_WITH and one SOCIALIZE_WITH AGE_PREFERENCE request."""
    bunk_with_req = next(r for r in group_requests if r.source_field == SourceField.BUNK_WITH)
    socialize_with_req = next(r for r in group_requests if r.source_field == SourceField.SOCIALIZE_WITH)
    return bunk_with_req, socialize_with_req


@dataclass
class DuplicateGroup:
    """Represents a group of duplicate requests"""

    primary: BunkRequest
    duplicates: list[BunkRequest]
    # Key: (requester_cm_id, requested_cm_id, request_type, source_field, year, session_cm_id)
    # source_field is always "" — cross-field deduplication is intentional
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
        # Requests with key=None are truly unique and added directly to unique_requests
        request_groups: dict[tuple[int, int | None, RequestType, str, int, int], list[BunkRequest]] = {}
        unique_requests: list[BunkRequest] = []  # No dedup key → add directly

        for request in requests:
            key: tuple[int, int | None, RequestType, str, int, int] | None
            # Check AGE_PREFERENCE FIRST - they have is_placeholder=True (no requestee)
            # but still need deduplication across source fields
            if request.request_type == RequestType.AGE_PREFERENCE:
                # Age preferences: group by (requester, None, type, "", year, session)
                # Dedupes across ALL source fields. Same requester's age preference from
                # different sources (AI-parsed vs dropdown) is the same intent.
                # Priority: FAMILY > STAFF during merge — parent-paramount (#1088).
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
                # Cross-field dedup: merge duplicates from different form fields
                # (e.g., same name in bunk_with AND bunking_notes) into one request,
                # picking the higher-priority source.
                #
                # Note: The DB unique constraint DOES include source_field. This in-batch
                # dedup intentionally excludes it to merge cross-field duplicates before
                # saving.
                key = (
                    request.requester_cm_id,
                    request.requested_cm_id,
                    request.request_type,
                    "",  # Empty string placeholder to maintain tuple structure
                    request.year,
                    request.session_cm_id,
                )

            # Use key as single source of truth:
            # - key=None → truly unique, add to unique_requests
            # - key!=None → potential duplicate, add to request_groups for dedup
            if key is None:
                unique_requests.append(request)
            else:
                if key not in request_groups:
                    request_groups[key] = []
                request_groups[key].append(request)

        # Process each group
        kept_requests = list(unique_requests)  # Start with truly unique requests
        duplicate_groups = []
        total_duplicates = 0

        # Handle potential duplicate groups
        for key, group_requests in request_groups.items():
            if len(group_requests) == 1:
                # No duplicates in batch
                kept_requests.append(group_requests[0])
            else:
                # Stage 3a: conflict-target detection for parent age_preference pairs.
                # When a bunk_with-parsed AGE_PREFERENCE and a socialize_with AGE_PREFERENCE
                # exist for the same person but carry different targets (e.g., prose="older"
                # vs boolean="younger"), the bunk_with-derived row is demoted to pending for
                # staff review. Both rows survive — no merge.
                if _is_conflicting_age_preference_pair(group_requests):
                    bunk_with_req, socialize_with_req = _split_age_pref_pair(group_requests)
                    bunk_with_pending = dataclasses.replace(bunk_with_req, status=RequestStatus.PENDING)
                    kept_requests.append(bunk_with_pending)
                    kept_requests.append(socialize_with_req)
                    # No entry in duplicate_groups: these are not merged duplicates,
                    # they are kept as distinct records for staff review.
                    continue

                # Tiebreak: SOURCE_FIELD_PRIORITY (materiality rank), then confidence.
                # bunk_with > not_bunk_with > bunking_notes/internal_notes (tied) >
                # socialize_with. Within rank, higher confidence wins.
                sorted_requests = sorted(
                    group_requests,
                    key=lambda r: (
                        SOURCE_FIELD_PRIORITY.get(r.source_field, 0),
                        r.confidence_score,
                    ),
                    reverse=True,
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
                        # Set action for orchestrator - indicates this should be merged
                        request.metadata["database_match_action"] = "merge"
                        # Include locked status for orchestrator decision
                        # (locked requests need manual review, not auto-merge)
                        request.metadata["database_match_locked"] = getattr(existing, "request_locked", False)
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
        all_requests = [primary, *duplicates]

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

        # Track duplicate sources (legacy, for backwards compatibility).
        # Falls back to req.source.value when source_field is unknown/empty so
        # one bad row can't abort the whole merge — mirrors the validator's
        # try/except pattern at bunking_validator.py:527-531.
        duplicate_sources = [_resolve_source(r) for r in duplicates]
        primary.metadata["duplicate_sources"] = duplicate_sources

        # Find highest confidence among all requests
        highest_conf = max(r.confidence_score for r in all_requests)

        # If a duplicate has higher confidence, boost the primary
        if highest_conf > primary.confidence_score:
            # Find which source had the highest confidence
            for req in all_requests:
                if req.confidence_score == highest_conf:
                    primary.metadata["confidence_boosted_from"] = _resolve_source(req)
                    break
            primary.confidence_score = highest_conf

        # Merge other metadata (primary values take precedence)
        for dup in duplicates:
            for key, value in dup.metadata.items():
                if key not in primary.metadata:
                    primary.metadata[key] = value

"""Partial Invalidation Handler for Cross-Run Deduplication.

Handles the case when an original_bunk_request's content changes (hash differs):
- For single-source requests: Delete the bunk_request entirely
- For multi-source unlocked requests: Remove source link, update source_fields, keep request
- For multi-source locked requests: Flag for manual review (don't auto-modify)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..data.repositories.request_repository import RequestRepository
    from ..data.repositories.source_link_repository import SourceLinkRepository

logger = logging.getLogger(__name__)


@dataclass
class InvalidationResult:
    """Result of handling a source change."""

    deleted_requests: list[str] = field(default_factory=list)
    unlinked_requests: list[str] = field(default_factory=list)
    flagged_for_review: list[str] = field(default_factory=list)

    @property
    def total_affected(self) -> int:
        """Total number of requests affected by this invalidation."""
        return len(self.deleted_requests) + len(self.unlinked_requests) + len(self.flagged_for_review)


class PartialInvalidationHandler:
    """Handles partial invalidation when source content changes.

    When an original_bunk_request's content_hash changes, we need to handle
    all bunk_requests that were derived from it. The behavior depends on:
    1. How many sources the request has (single vs multi-source)
    2. Whether the request is locked (staff-validated)
    """

    def __init__(
        self,
        request_repository: RequestRepository,
        source_link_repository: SourceLinkRepository,
    ) -> None:
        """Initialize handler with repositories.

        Args:
            request_repository: Repository for bunk_request operations
            source_link_repository: Repository for junction table operations
        """
        self.request_repository = request_repository
        self.source_link_repository = source_link_repository

    def handle_source_change(self, original_request_id: str) -> InvalidationResult:
        """Handle a change to an original_bunk_request.

        Called when content_hash changes for an original_bunk_request.
        Finds all linked bunk_requests and handles them appropriately.

        Args:
            original_request_id: PocketBase ID of the changed original_bunk_request

        Returns:
            InvalidationResult with lists of affected requests
        """
        result = InvalidationResult()

        # Find all bunk_requests linked to this original_request
        linked_request_ids = self.source_link_repository.get_requests_for_source(original_request_id)

        if not linked_request_ids:
            # No requests linked - nothing to do
            return result

        for bunk_request_id in linked_request_ids:
            source_count = self.source_link_repository.count_sources_for_request(bunk_request_id)

            if source_count <= 1:
                # Single-source request: delete entirely
                self._handle_single_source(bunk_request_id, result)
            else:
                # Multi-source request: check if locked
                self._handle_multi_source(bunk_request_id, original_request_id, result)

        return result

    def _handle_single_source(
        self,
        bunk_request_id: str,
        result: InvalidationResult,
    ) -> None:
        """Handle a single-source request when its source changes.

        Single-source requests should be deleted entirely since their
        only contributing source has changed.

        Args:
            bunk_request_id: ID of the request to delete
            result: InvalidationResult to update
        """
        # Delete the bunk_request
        self.request_repository.delete(bunk_request_id)

        # Remove all source links (should be just one)
        self.source_link_repository.remove_all_links_for_request(bunk_request_id)

        result.deleted_requests.append(bunk_request_id)
        logger.info(f"Deleted single-source request {bunk_request_id} due to source change")

    def _handle_multi_source(
        self,
        bunk_request_id: str,
        original_request_id: str,
        result: InvalidationResult,
    ) -> None:
        """Handle a multi-source request when one source changes.

        For multi-source requests:
        - If locked: flag for manual review (don't auto-modify)
        - If unlocked: remove the source link and update source_fields

        Args:
            bunk_request_id: ID of the merged request
            original_request_id: ID of the changed source
            result: InvalidationResult to update
        """
        # Get the request to check if it's locked
        request = self.request_repository.get_by_id(bunk_request_id)

        if request is None:
            logger.warning(f"Could not find request {bunk_request_id} for invalidation")
            return

        if getattr(request, "request_locked", False):
            # Locked request: flag for review instead of modifying
            self._flag_locked_request(bunk_request_id, original_request_id, result)
        else:
            # Unlocked request: unlink the changed source
            self._unlink_source(bunk_request_id, original_request_id, request, result)

    def _flag_locked_request(
        self,
        bunk_request_id: str,
        original_request_id: str,
        result: InvalidationResult,
    ) -> None:
        """Flag a locked request for manual review.

        Locked requests indicate staff validation, so we shouldn't
        auto-modify them. Instead, flag for manual review.

        Args:
            bunk_request_id: ID of the locked request
            original_request_id: ID of the changed source
            result: InvalidationResult to update
        """
        self.request_repository.flag_for_review(
            bunk_request_id,
            reason="source_changed_while_locked",
            changed_original_id=original_request_id,
        )

        result.flagged_for_review.append(bunk_request_id)
        logger.info(f"Flagged locked request {bunk_request_id} for review due to source change")

    def _unlink_source(
        self,
        bunk_request_id: str,
        original_request_id: str,
        request: object,
        result: InvalidationResult,
    ) -> None:
        """Unlink a changed source from a multi-source request.

        Removes the source link and updates the source_fields array
        to remove the invalidated field.

        Args:
            bunk_request_id: ID of the merged request
            original_request_id: ID of the changed source
            request: The BunkRequest object
            result: InvalidationResult to update
        """
        # Get the source_field that's being removed
        source_field = self.source_link_repository.get_source_field_for_link(bunk_request_id, original_request_id)

        # Remove the source link
        self.source_link_repository.remove_source_link(
            bunk_request_id=bunk_request_id,
            original_request_id=original_request_id,
        )

        # Update source_fields array if we know which field to remove
        if source_field:
            current_fields = getattr(request, "source_fields", []) or []
            if source_field in current_fields:
                updated_fields = [f for f in current_fields if f != source_field]
                self.request_repository.update_source_fields(
                    bunk_request_id,
                    source_fields=updated_fields,
                )

        result.unlinked_requests.append(bunk_request_id)
        logger.info(f"Unlinked source from multi-source request {bunk_request_id}")

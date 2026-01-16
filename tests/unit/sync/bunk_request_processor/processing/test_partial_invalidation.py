"""Test-Driven Development for Partial Invalidation

Tests the system's ability to handle changes to original_bunk_requests:
- When content_hash changes, existing bunk_requests linked via junction table
  need appropriate handling before reprocessing.

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)


class TestPartialInvalidationSingleSource:
    """Test partial invalidation for requests with a single source."""

    def _create_bunk_request(
        self,
        requester_cm_id: int = 12345,
        requested_cm_id: int = 67890,
        request_type: RequestType = RequestType.BUNK_WITH,
        source_field: str = "share_bunk_with",
        pb_id: str = "br_123",
        request_locked: bool = False,
    ) -> BunkRequest:
        """Helper to create a BunkRequest for testing."""
        request = BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=requested_cm_id,
            request_type=request_type,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field=source_field,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )
        request.id = pb_id
        return request

    def test_single_source_request_deleted_on_source_change(self) -> None:
        """Test that single-source requests are deleted when source changes.

        When original_bunk_request content changes (hash differs) and the
        linked bunk_request only has one source, the bunk_request should
        be deleted entirely.
        """
        # Mock repositories
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The original_request_id that changed
        original_request_id = "orig_123"

        # Junction table returns one linked bunk_request
        mock_source_link_repo.get_requests_for_source.return_value = ["br_123"]
        # This request has only ONE source (single-source)
        mock_source_link_repo.count_sources_for_request.return_value = 1

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        # Handle invalidation for this changed original_request
        result = handler.handle_source_change(original_request_id)

        # Should have deleted the bunk_request
        mock_request_repo.delete.assert_called_once_with("br_123")
        # Should have removed all source links for the deleted request
        mock_source_link_repo.remove_all_links_for_request.assert_called_once_with("br_123")

        # Result should indicate deletion
        assert result.deleted_requests == ["br_123"]
        assert result.unlinked_requests == []

    def test_single_source_no_requests_linked_is_noop(self) -> None:
        """Test that no action is taken when no requests are linked."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # No linked bunk_requests
        mock_source_link_repo.get_requests_for_source.return_value = []

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        result = handler.handle_source_change("orig_123")

        # No deletions or unlinkings
        mock_request_repo.delete.assert_not_called()
        assert result.deleted_requests == []
        assert result.unlinked_requests == []


class TestPartialInvalidationMultiSource:
    """Test partial invalidation for requests with multiple sources."""

    def test_multi_source_unlocked_removes_link_keeps_request(self) -> None:
        """Test that multi-source unlocked requests keep the request but unlink.

        When a merged request has multiple sources and the changing source
        is NOT the only one, we should:
        - Remove the source link for the changed original_request
        - Update the source_fields array
        - Keep the bunk_request (it still has other sources)
        """
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        original_request_id = "orig_123"

        # Junction table returns one linked bunk_request
        mock_source_link_repo.get_requests_for_source.return_value = ["br_merged_456"]
        # This request has MULTIPLE sources (merged request)
        mock_source_link_repo.count_sources_for_request.return_value = 3

        # Mock the request to check if it's locked
        mock_request = Mock()
        mock_request.id = "br_merged_456"
        mock_request.request_locked = False  # NOT locked
        mock_request.source_fields = ["share_bunk_with", "bunking_notes", "internal_notes"]
        mock_request_repo.get_by_id.return_value = mock_request

        # Mock to get source_field from junction record
        mock_source_link_repo.get_source_field_for_link.return_value = "bunking_notes"

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        result = handler.handle_source_change(original_request_id)

        # Should NOT delete the request (has other sources)
        mock_request_repo.delete.assert_not_called()

        # Should remove the specific source link
        mock_source_link_repo.remove_source_link.assert_called_once_with(
            bunk_request_id="br_merged_456",
            original_request_id=original_request_id,
        )

        # Should update source_fields array (remove the invalidated field)
        mock_request_repo.update_source_fields.assert_called_once()
        call_args = mock_request_repo.update_source_fields.call_args
        # The invalidated field should be removed
        assert "bunking_notes" not in call_args.kwargs.get("source_fields", [])

        # Result should indicate unlinking, not deletion
        assert result.deleted_requests == []
        assert "br_merged_456" in result.unlinked_requests

    def test_multi_source_locked_flags_for_review(self) -> None:
        """Test that locked multi-source requests are flagged for review.

        Locked requests indicate staff validation. When a source changes,
        we shouldn't auto-modify - instead, flag for manual review.
        """
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        original_request_id = "orig_123"

        mock_source_link_repo.get_requests_for_source.return_value = ["br_locked_789"]
        mock_source_link_repo.count_sources_for_request.return_value = 2

        # Mock a LOCKED request
        mock_request = Mock()
        mock_request.id = "br_locked_789"
        mock_request.request_locked = True  # LOCKED
        mock_request.metadata = {}
        mock_request_repo.get_by_id.return_value = mock_request

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        result = handler.handle_source_change(original_request_id)

        # Should NOT delete or unlink
        mock_request_repo.delete.assert_not_called()
        mock_source_link_repo.remove_source_link.assert_not_called()

        # Should flag for manual review
        mock_request_repo.flag_for_review.assert_called_once_with(
            "br_locked_789",
            reason="source_changed_while_locked",
            changed_original_id=original_request_id,
        )

        # Result should indicate flagged
        assert result.flagged_for_review == ["br_locked_789"]


class TestPartialInvalidationMultipleRequests:
    """Test partial invalidation when one source links to multiple requests."""

    def test_handles_multiple_linked_requests(self) -> None:
        """Test that all linked requests are handled appropriately.

        One original_request could link to multiple bunk_requests
        (e.g., different sessions or different types extracted from same field).
        """
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        original_request_id = "orig_123"

        # Junction returns multiple linked requests
        mock_source_link_repo.get_requests_for_source.return_value = [
            "br_single_1",  # Single source - should be deleted
            "br_multi_2",  # Multi source - should be unlinked
        ]

        # Define source counts
        def mock_count(request_id: str) -> int:
            counts = {"br_single_1": 1, "br_multi_2": 2}
            return counts.get(request_id, 0)

        mock_source_link_repo.count_sources_for_request.side_effect = mock_count

        # Define request properties
        def mock_get_by_id(request_id: str) -> Mock | None:
            if request_id == "br_multi_2":
                mock_req = Mock()
                mock_req.id = request_id
                mock_req.request_locked = False
                mock_req.source_fields = ["field_a", "field_b"]
                return mock_req
            return None

        mock_request_repo.get_by_id.side_effect = mock_get_by_id
        mock_source_link_repo.get_source_field_for_link.return_value = "field_a"

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        result = handler.handle_source_change(original_request_id)

        # Single-source should be deleted
        assert "br_single_1" in result.deleted_requests
        # Multi-source should be unlinked
        assert "br_multi_2" in result.unlinked_requests


class TestPartialInvalidationStatistics:
    """Test statistics tracking for partial invalidation."""

    def test_returns_comprehensive_statistics(self) -> None:
        """Test that handler returns detailed statistics."""
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        mock_source_link_repo.get_requests_for_source.return_value = ["br_123"]
        mock_source_link_repo.count_sources_for_request.return_value = 1

        from bunking.sync.bunk_request_processor.processing.partial_invalidation import (
            PartialInvalidationHandler,
        )

        handler = PartialInvalidationHandler(
            request_repository=mock_request_repo,
            source_link_repository=mock_source_link_repo,
        )

        result = handler.handle_source_change("orig_123")

        # Should have statistics attributes
        assert hasattr(result, "deleted_requests")
        assert hasattr(result, "unlinked_requests")
        assert hasattr(result, "flagged_for_review")
        assert hasattr(result, "total_affected")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

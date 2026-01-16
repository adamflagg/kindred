"""Test-Driven Development for Orchestrator Merge-on-Save

Tests the orchestrator's ability to handle merge-on-save when the deduplicator
detects a database match (cross-run duplicate).

Following TDD: These tests are written FIRST to define expected behavior.
"""

import sys
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

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


class TestOrchestratorMergeOnSave:
    """Test orchestrator behavior when deduplicator flags requests for merge."""

    def _create_request(
        self,
        requester_cm_id: int = 12345,
        requested_cm_id: int | None = 67890,
        request_type: RequestType = RequestType.BUNK_WITH,
        session_cm_id: int = 1000002,
        source_field: str = "share_bunk_with",
        source: RequestSource = RequestSource.FAMILY,
        confidence_score: float = 0.95,
        year: int = 2025,
        metadata: dict[str, Any] | None = None,
    ) -> BunkRequest:
        """Helper to create a BunkRequest."""
        return BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=requested_cm_id,
            request_type=request_type,
            session_cm_id=session_cm_id,
            priority=3,
            confidence_score=confidence_score,
            source=source,
            source_field=source_field,
            csv_position=0,
            year=year,
            status=RequestStatus.RESOLVED,
            is_placeholder=requested_cm_id is None,
            metadata=metadata or {},
        )

    def test_merge_on_save_updates_existing_record(self) -> None:
        """Test that requests flagged for merge update existing record.

        When deduplicator sets database_match_action="merge", the orchestrator
        should update the existing record instead of creating a new one.
        """
        # Request flagged for merge by deduplicator
        request = self._create_request(
            source_field="bunking_notes",
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_pb_id_123",
                "database_match_action": "merge",
                "database_match_locked": False,
            },
        )

        # Mock repositories
        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The existing record in DB - use a proper BunkRequest object
        existing_record = self._create_request(
            source_field="share_bunk_with",
            confidence_score=0.85,
        )
        existing_record.id = "existing_pb_id_123"
        # Set source_fields attribute that exists on DB records
        existing_record.source_fields = ["share_bunk_with"]
        mock_request_repo.get_by_id.return_value = existing_record
        mock_request_repo.update_for_merge.return_value = True

        # Import and create orchestrator with mocks
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # We'll need to patch the orchestrator's dependencies
        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            # Call the save method
            orchestrator._save_bunk_requests([request])

        # Should have called update on existing, not create new
        mock_request_repo.update_for_merge.assert_called_once()
        # Should NOT have called create
        mock_request_repo.create.assert_not_called()

    def test_merge_on_save_adds_source_link(self) -> None:
        """Test that merge adds source link from new original_request.

        The source link connects the existing bunk_request to the new
        original_bunk_request that triggered this merge.
        """
        request = self._create_request(
            source_field="bunking_notes",
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_pb_id_123",
                "database_match_action": "merge",
                "database_match_locked": False,
                "original_request_id": "orig_req_456",  # The new source
            },
        )

        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The existing record - use proper BunkRequest
        existing_record = self._create_request(
            source_field="share_bunk_with",
            confidence_score=0.85,
        )
        existing_record.id = "existing_pb_id_123"
        existing_record.source_fields = ["share_bunk_with"]
        mock_request_repo.get_by_id.return_value = existing_record
        mock_request_repo.update_for_merge.return_value = True

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            orchestrator._save_bunk_requests([request])

        # Should have created a source link for the new original_request
        mock_source_link_repo.add_source_link.assert_called_with(
            bunk_request_id="existing_pb_id_123",
            original_request_id="orig_req_456",
            is_primary=False,  # Not primary since we're merging into existing
            source_field="bunking_notes",
        )

    def test_merge_on_save_updates_source_fields_array(self) -> None:
        """Test that merge adds new source_field to the array.

        The source_fields JSON array should contain all contributing fields.
        """
        request = self._create_request(
            source_field="bunking_notes",
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_pb_id_123",
                "database_match_action": "merge",
                "database_match_locked": False,
            },
        )

        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The existing record - use proper BunkRequest
        existing_record = self._create_request(
            source_field="share_bunk_with",
            confidence_score=0.85,
        )
        existing_record.id = "existing_pb_id_123"
        existing_record.source_fields = ["share_bunk_with"]  # Existing field
        mock_request_repo.get_by_id.return_value = existing_record
        mock_request_repo.update_for_merge.return_value = True

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            orchestrator._save_bunk_requests([request])

        # Check that update was called with combined source_fields
        mock_request_repo.update_for_merge.assert_called_once()
        call_kwargs = mock_request_repo.update_for_merge.call_args.kwargs
        # Should contain both fields
        assert "bunking_notes" in call_kwargs.get("source_fields", [])
        assert "share_bunk_with" in call_kwargs.get("source_fields", [])

    def test_no_merge_creates_new_with_source_link(self) -> None:
        """Test that requests without database match create new records.

        Normal flow: create new bunk_request and add source link.
        """
        request = self._create_request(
            source_field="share_bunk_with",
            metadata={
                "original_request_id": "orig_req_789",
            },
        )

        mock_request_repo = Mock()
        mock_request_repo.create.return_value = True
        # After create, the request should have an id
        mock_source_link_repo = Mock()

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            orchestrator._save_bunk_requests([request])

        # Should have called create, not update
        mock_request_repo.create.assert_called_once()
        mock_request_repo.update_for_merge.assert_not_called()

    def test_new_request_source_link_is_primary(self) -> None:
        """Test that new requests have their source link marked as primary."""
        request = self._create_request(
            source_field="share_bunk_with",
            metadata={
                "original_request_id": "orig_req_789",
            },
        )

        mock_request_repo = Mock()
        mock_request_repo.create.return_value = True
        mock_source_link_repo = Mock()

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            # Set a PB ID on the request (simulating what create does)
            def set_id_on_create(req):
                req.id = "new_pb_id_999"
                return True

            mock_request_repo.create.side_effect = set_id_on_create

            orchestrator._save_bunk_requests([request])

        # Source link should be primary for new requests
        mock_source_link_repo.add_source_link.assert_called_with(
            bunk_request_id="new_pb_id_999",
            original_request_id="orig_req_789",
            is_primary=True,
            source_field="share_bunk_with",
        )

    def test_locked_request_skips_auto_merge(self) -> None:
        """Test that locked existing requests skip auto-merge.

        When database_match_locked=True, we should NOT auto-merge.
        Instead, create a new request and flag for manual review.
        """
        request = self._create_request(
            source_field="bunking_notes",
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_locked_123",
                "database_match_action": "merge",
                "database_match_locked": True,  # Locked!
                "original_request_id": "orig_req_456",
            },
        )

        mock_request_repo = Mock()
        mock_request_repo.create.return_value = True
        mock_source_link_repo = Mock()

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            def set_id_on_create(req):
                req.id = "new_pb_id_888"
                return True

            mock_request_repo.create.side_effect = set_id_on_create

            saved = orchestrator._save_bunk_requests([request])

        # Should create new, not merge (locked requests need manual review)
        mock_request_repo.create.assert_called_once()
        mock_request_repo.update_for_merge.assert_not_called()

        # The saved request should be flagged for manual review
        assert len(saved) == 1
        assert saved[0].metadata.get("requires_manual_merge_review") is True

    def test_merge_preserves_higher_confidence(self) -> None:
        """Test that merge keeps the higher confidence score."""
        request = self._create_request(
            source_field="bunking_notes",
            confidence_score=0.98,  # Higher than existing
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_pb_id_123",
                "database_match_action": "merge",
                "database_match_locked": False,
            },
        )

        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The existing record - use proper BunkRequest with lower confidence
        existing_record = self._create_request(
            source_field="share_bunk_with",
            confidence_score=0.85,  # Lower than new request
        )
        existing_record.id = "existing_pb_id_123"
        existing_record.source_fields = ["share_bunk_with"]
        mock_request_repo.get_by_id.return_value = existing_record
        mock_request_repo.update_for_merge.return_value = True

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            orchestrator._save_bunk_requests([request])

        # Check that update used the higher confidence
        mock_request_repo.update_for_merge.assert_called_once()
        call_kwargs = mock_request_repo.update_for_merge.call_args.kwargs
        assert call_kwargs.get("confidence_score") == 0.98

    def test_merge_stats_tracked(self) -> None:
        """Test that merge operations are tracked in statistics."""
        request = self._create_request(
            source_field="bunking_notes",
            metadata={
                "has_database_duplicate": True,
                "database_duplicate_id": "existing_pb_id_123",
                "database_match_action": "merge",
                "database_match_locked": False,
            },
        )

        mock_request_repo = Mock()
        mock_source_link_repo = Mock()

        # The existing record - use proper BunkRequest
        existing_record = self._create_request(
            source_field="share_bunk_with",
            confidence_score=0.85,
        )
        existing_record.id = "existing_pb_id_123"
        existing_record.source_fields = ["share_bunk_with"]
        mock_request_repo.get_by_id.return_value = existing_record
        mock_request_repo.update_for_merge.return_value = True

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        with patch.object(RequestOrchestrator, "__init__", lambda self: None):
            orchestrator = RequestOrchestrator()
            orchestrator.request_repository = mock_request_repo
            orchestrator.source_link_repository = mock_source_link_repo
            orchestrator._stats = {}

            orchestrator._save_bunk_requests([request])

        # Should track merge count
        assert orchestrator._stats.get("cross_run_merges", 0) == 1


class TestOrchestratorSourceLinkInitialization:
    """Test that orchestrator initializes SourceLinkRepository."""

    def test_orchestrator_has_source_link_repository(self) -> None:
        """Test that orchestrator creates SourceLinkRepository in _init_validation_components."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Mock the PocketBase client
        mock_pb_client = Mock()

        with patch(
            "bunking.sync.bunk_request_processor.orchestrator.orchestrator.SourceLinkRepository"
        ) as mock_slr_class:
            with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.RequestRepository"):
                with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SelfReferenceRule"):
                    with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.Deduplicator"):
                        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ReciprocalDetector"):
                            with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.RequestBuilder"):
                                # Create orchestrator instance manually
                                orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
                                orchestrator.pb = mock_pb_client
                                orchestrator.ai_config = {"reciprocal_confidence_boost": 0.1}
                                orchestrator.temporal_name_cache = Mock()
                                orchestrator.priority_calculator = Mock()
                                orchestrator.year = 2025

                                # Call the method that should init SourceLinkRepository
                                orchestrator._init_validation_components()

            # Should have created SourceLinkRepository with pb_client
            mock_slr_class.assert_called_once_with(mock_pb_client)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""Tests for the orchestrator save path.

Covers `_save_bunk_requests` creating new records with a primary source link,
and SourceLinkRepository initialization.

Note: cross-run DB merge (`_merge_into_existing` + the deduplicator's
`check_database` path) was removed — duplicate avoidance is handled upstream by
content-hash change detection (clears `processed` on change) plus granular
clear-then-recreate, so the save path always creates.
"""

import sys
from collections import defaultdict
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

import pytest

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestStatus,
    RequestType,
)


class TestOrchestratorSaveCreatePath:
    """Test orchestrator behavior when saving new (non-duplicate) requests."""

    def _create_request(
        self,
        requester_cm_id: int = 12345,
        requested_cm_id: int | None = 67890,
        request_type: RequestType = RequestType.BUNK_WITH,
        session_cm_id: int = 1000002,
        source_field: str = "bunk_request_form",
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
            is_first_requested=False,
            confidence_score=confidence_score,
            source_field=source_field,
            csv_position=0,
            year=year,
            status=RequestStatus.RESOLVED,
            metadata=metadata or {},
        )

    def test_save_creates_new_with_source_link(self) -> None:
        """Requests without a database match create new records.

        Normal flow: create new bunk_request and add source link.
        """
        request = self._create_request(
            source_field="bunk_request_form",
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
            orchestrator._stats = defaultdict(int)

            orchestrator._save_bunk_requests([request])

        # Should have called create, not update
        mock_request_repo.create.assert_called_once()
        mock_request_repo.update_for_merge.assert_not_called()

    def test_new_request_source_link_is_primary(self) -> None:
        """New requests have their source link marked as primary."""
        request = self._create_request(
            source_field="bunk_request_form",
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
            orchestrator._stats = defaultdict(int)

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
            source_field="bunk_request_form",
        )


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
                        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.RequestBuilder"):
                            # Create orchestrator instance manually
                            orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
                            orchestrator.pb = mock_pb_client
                            orchestrator.ai_config = {}
                            orchestrator.temporal_name_cache = Mock()
                            orchestrator.year = 2025

                            # Call the method that should init SourceLinkRepository
                            orchestrator._init_validation_components()

            # Should have created SourceLinkRepository with pb_client
            mock_slr_class.assert_called_once_with(mock_pb_client)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

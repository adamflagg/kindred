"""Test for cross-session decline logic.

Verifies that requests with session mismatch conflicts get DECLINED status

TDD Red Phase: This test should FAIL until the fix is implemented."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)


def _create_mock_pocketbase():
    """Create a mock PocketBase client"""
    pb = Mock()

    def mock_collection(name):
        collection = Mock()
        collection.get_full_list = Mock(return_value=[])
        collection.get_list = Mock(return_value=Mock(items=[], total_items=0))
        collection.create = Mock(return_value=Mock(id="test-id"))
        collection.update = Mock()
        collection.delete = Mock()
        return collection

    pb.collection = mock_collection
    return pb


def _create_parsed_request(
    target_name: str = "Sarah Smith",
    request_type: RequestType = RequestType.BUNK_WITH,
    confidence: float = 0.9,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=confidence,
        csv_position=1,
        metadata={},
    )


class TestCrossSessionDeclineLogic:
    """Tests for cross-session decline logic.

    - During resolution, if target is in different session
    - Sets status to DECLINED
    - Sets decline_reason metadata
    - Logs "DECLINED:" message

    Current modular behavior:
    - ConflictDetector detects SESSION_MISMATCH
    - apply_conflict_resolution adds has_conflict=True to resolution_info
    - BUT status is still RESOLVED (not DECLINED)

    This test verifies the fix that sets DECLINED status for conflicts.
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_session_mismatch_conflict_sets_declined_status(self, mock_social_graph, mock_factory):
        """Requests with session mismatch conflicts should have DECLINED status."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Setup mocks
        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create a parsed request and resolution info with a conflict
        parsed_req = _create_parsed_request(target_name="Sarah Smith")

        # resolution_info with has_conflict=True (as set by ConflictDetector.apply_conflict_resolution)
        resolution_info = {
            "requester_cm_id": 11111,
            "requester_name": "Test Requester",
            "session_cm_id": 1000002,  # Requester's session
            "person_cm_id": 22222,  # Resolved target - positive = success
            "person_name": "Sarah Smith",
            "confidence": 0.95,
            "resolution_method": "exact",
            # Conflict info added by ConflictDetector.apply_conflict_resolution
            "has_conflict": True,
            "conflict_type": "session_mismatch",
            "conflict_description": "Session mismatch: Person 11111 (session 1000002) requested 22222 (session 1000003)",
            "conflict_severity": "high",
            "auto_resolvable": False,
            "resolution_suggestion": "Cannot bunk across different sessions",
            "conflict_metadata": {
                "requester_session": 1000002,
                "target_session": 1000003,
            },
        }

        # Call _create_bunk_requests with the conflict-flagged request
        resolved_requests = [(parsed_req, resolution_info)]

        # Directly call the method under test
        created_requests = await orchestrator._create_bunk_requests(resolved_requests)

        # Verify results
        assert len(created_requests) == 1, "Should create exactly one request"

        request = created_requests[0]

        # CRITICAL ASSERTION: Status should be DECLINED for session mismatch
        assert request.status == RequestStatus.DECLINED, (
            f"Expected DECLINED status for session mismatch conflict, got {request.status}"
        )

        # Should have decline_reason in metadata
        assert "declined_reason" in request.metadata, "Expected 'declined_reason' in metadata for declined request"

        # decline_reason should contain session mismatch info
        assert (
            "session" in request.metadata["declined_reason"].lower()
            or "mismatch" in request.metadata["declined_reason"].lower()
        ), f"decline_reason should mention session mismatch, got: {request.metadata['declined_reason']}"

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_no_conflict_keeps_resolved_status(self, mock_social_graph, mock_factory):
        """Requests without conflicts should keep RESOLVED status.

        Ensures the fix doesn't accidentally decline valid requests.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Setup mocks
        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create a parsed request without conflict
        parsed_req = _create_parsed_request(target_name="Sarah Smith")

        # resolution_info WITHOUT has_conflict (normal successful resolution)
        resolution_info = {
            "requester_cm_id": 11111,
            "requester_name": "Test Requester",
            "session_cm_id": 1000002,
            "person_cm_id": 22222,  # Positive = resolved
            "person_name": "Sarah Smith",
            "confidence": 0.95,
            "resolution_method": "exact",
            # No conflict flags
        }

        resolved_requests = [(parsed_req, resolution_info)]
        created_requests = await orchestrator._create_bunk_requests(resolved_requests)

        assert len(created_requests) == 1
        request = created_requests[0]

        # Should be RESOLVED, not DECLINED
        assert request.status == RequestStatus.RESOLVED, (
            f"Expected RESOLVED status for valid request, got {request.status}"
        )

        # Should NOT have declined_reason
        assert "declined_reason" not in request.metadata, "Valid requests should not have declined_reason in metadata"

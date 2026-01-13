"""TDD Tests for Self-Reference Handling in Orchestrator

Tests that self-referential requests are KEPT with modifications for staff review,
NOT silently filtered out.

This addresses a parity gap where:
- Monolith: Keeps self-referential requests with modifications (confidence=0, metadata flags)
- Modular (before fix): Silently filters them out

The filtering approach is problematic because:
1. True self-references (parent typo) are rare
2. False positives (cross-session friends, first-name ambiguity) are more common
3. Silently dropping = losing potentially valid requests

The correct behavior (matching monolith) is to:
1. KEEP the request in the list
2. Set confidence = 0
3. Add metadata flags (self_referential, requires_clarification, manual_review_reason)
4. Update notes with "SELF-REFERENTIAL REQUEST" prefix
5. Let staff review and correct if needed"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
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


def _create_bunk_request(
    requester_cm_id: int = 12345,
    requested_cm_id: int | None = 67890,
    request_type: RequestType = RequestType.BUNK_WITH,
    session_cm_id: int = 1000002,
    confidence: float = 0.95,
    source: RequestSource = RequestSource.FAMILY,
    priority: int = 3,
    is_placeholder: bool = False,
    metadata: dict[str, Any] | None = None,
) -> BunkRequest:
    """Helper to create BunkRequest objects for testing"""
    return BunkRequest(
        requester_cm_id=requester_cm_id,
        requested_cm_id=requested_cm_id,
        request_type=request_type,
        session_cm_id=session_cm_id,
        priority=priority,
        confidence_score=confidence,
        source=source,
        source_field="share_bunk_with",
        csv_position=1,
        year=2025,
        status=RequestStatus.RESOLVED,
        is_placeholder=is_placeholder,
        metadata=metadata or {},
    )


class TestSelfReferentialRequestsKeptForReview:
    """Tests that self-referential requests are KEPT with modifications for staff review.

    These tests define the CORRECT behavior (matching monolith).
    The current implementation filters them out, so these tests will FAIL initially.
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_requests_kept_not_filtered(self, mock_social_graph, mock_factory):
        """Self-referential requests should be KEPT in the list, not filtered out.

        - Modifies request in-place
        - Appends to validated list (line 2050)
        - Request is NOT removed
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create a list of requests including a self-referential one
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),  # Valid
            _create_bunk_request(requester_cm_id=100, requested_cm_id=100),  # Self-ref!
            _create_bunk_request(requester_cm_id=300, requested_cm_id=400),  # Valid
        ]

        # Apply validation pipeline
        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Self-referential request should be KEPT (total 3, not 2)
        assert len(validated_requests) == 3, (
            "Self-referential requests should be kept for staff review, not filtered out"
        )

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_request_confidence_set_to_zero(self, mock_social_graph, mock_factory):
        """Self-referential requests should have confidence set to 0.

        request.confidence = 0.0  # Zero confidence
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=100,  # Self-ref!
                confidence=0.95,  # High confidence initially
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Request should exist with confidence = 0
        assert len(validated_requests) == 1
        assert validated_requests[0].confidence_score == 0.0, (
            "Self-referential requests should have confidence set to 0"
        )

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_request_target_cleared(self, mock_social_graph, mock_factory):
        """Self-referential requests should have target_cm_id cleared.

        request.target_cm_id = None  # Clear any ID
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=100,  # Self-ref! Same as requester
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        assert len(validated_requests) == 1
        assert validated_requests[0].requested_cm_id is None, (
            "Self-referential requests should have requested_cm_id cleared to None"
        )

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_request_metadata_flags_set(self, mock_social_graph, mock_factory):
        """Self-referential requests should have metadata flags set.

        request.metadata['self_referential'] = True
        request.metadata['requires_clarification'] = True
        request.metadata['ambiguity_reason'] = 'Self-referential request detected'
        request.metadata['manual_review_reason'] = 'Self-referential request'
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=100,  # Self-ref!
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        assert len(validated_requests) == 1
        metadata = validated_requests[0].metadata

        assert metadata.get("self_referential") is True, (
            "Self-referential requests should have self_referential=True in metadata"
        )
        assert metadata.get("requires_clarification") is True, (
            "Self-referential requests should have requires_clarification=True in metadata"
        )
        assert "manual_review_reason" in metadata, (
            "Self-referential requests should have manual_review_reason in metadata"
        )

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_request_has_ambiguity_reason(self, mock_social_graph, mock_factory):
        """Self-referential requests should have ambiguity_reason set in metadata.

            request.metadata['ambiguity_reason'] = 'Self-referential request detected'

        Note: Modular BunkRequest doesn't have a `notes` field, so we use
        metadata['ambiguity_reason'] instead.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=100,  # Self-ref!
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        assert len(validated_requests) == 1
        metadata = validated_requests[0].metadata

        assert "ambiguity_reason" in metadata, "Self-referential request should have ambiguity_reason in metadata"
        assert "self" in metadata["ambiguity_reason"].lower(), "Ambiguity reason should mention self-reference"

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_count_still_tracked(self, mock_social_graph, mock_factory):
        """Stats should still track how many self-referential requests were found.
        (Changed from 'filtered' to 'detected' since we're no longer filtering)
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=100),  # Self-ref
            _create_bunk_request(requester_cm_id=200, requested_cm_id=200),  # Self-ref
            _create_bunk_request(requester_cm_id=300, requested_cm_id=400),  # Valid
        ]

        orchestrator._apply_validation_pipeline(requests)

        # Should still track the count (key may be 'self_referential_detected' or 'self_referential_filtered')
        self_ref_count = orchestrator._stats.get(
            "self_referential_detected", orchestrator._stats.get("self_referential_filtered", 0)
        )
        assert self_ref_count == 2, "Stats should track that 2 self-referential requests were found"


class TestFirstNameAmbiguityHandling:
    """Tests for the critical false positive case: first-name-only requests that
    match the requester's first name but may be targeting someone in a different session.

    These should also be KEPT for staff review, not silently dropped.
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_first_name_only_ambiguity_kept_for_review(self, mock_social_graph, mock_factory):
        """When a first-name-only target matches requester's first name and no peers
        have that name, the request should be KEPT for staff review.

        Example: "Emma Wilson" (Session 2) requests "Emma" (meaning Emma Johnson in Session 3)
        - No other Emmas in Session 2
        - Current behavior: Silently dropped as "self-referential"
        - Correct behavior: Keep for staff to clarify
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Simulate a first-name-only unresolvable request
        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=None,  # Unresolved
                is_placeholder=True,
                metadata={
                    "raw_target_name": "Emma",  # First name only
                    "requester_first_name": "Emma",
                    "requester_full_name": "Emma Wilson",
                    "session_peers_with_same_first_name": 0,  # No other Emmas in session
                },
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Request should be KEPT (for potential cross-session friend)
        assert len(validated_requests) == 1, (
            "First-name ambiguity should be kept for staff review, "
            "not silently dropped - target may be in different session"
        )

        # Should be marked for clarification
        assert validated_requests[0].metadata.get("requires_clarification") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

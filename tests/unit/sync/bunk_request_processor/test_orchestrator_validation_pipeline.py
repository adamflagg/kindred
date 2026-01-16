"""TDD Tests for Orchestrator Validation Pipeline Integration

Tests that the orchestrator correctly wires up the validation components:
1. SelfReferenceRule - filters out self-referential requests
2. Deduplicator - removes duplicate requests
3. ReciprocalDetector - marks reciprocal request pairs

These tests define the expected behavior. The implementation must make them pass."""

from __future__ import annotations

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
    requested_cm_id: int = 67890,
    request_type: RequestType = RequestType.BUNK_WITH,
    session_cm_id: int = 1000002,
    confidence: float = 0.95,
    source: RequestSource = RequestSource.FAMILY,
    priority: int = 3,
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
        is_placeholder=False,
        metadata={},
    )


class TestOrchestratorSelfReferenceValidation:
    """Tests that self-referential requests are kept with modifications for staff review"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_referential_requests_are_kept_for_review(self, mock_social_graph, mock_factory):
        """Self-referential requests (requester == requested) should be KEPT with
        modifications for staff review, not filtered out.

        This prevents losing valid requests due to false positives (e.g.,
        first-name ambiguity for cross-session friends).
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

        # All 3 requests should be kept (self-ref modified, not filtered)
        assert len(validated_requests) == 3

        # Find the self-referential request (now has None target)
        self_ref = next(r for r in validated_requests if r.metadata.get("self_referential"))
        assert self_ref.requested_cm_id is None
        assert self_ref.confidence_score == 0.0
        assert self_ref.metadata.get("requires_clarification") is True

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_reference_count_tracked_in_stats(self, mock_social_graph, mock_factory):
        """Stats should track how many self-referential requests were filtered."""
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

        assert orchestrator._stats.get("self_referential_filtered", 0) == 2


class TestOrchestratorDeduplication:
    """Tests that duplicate requests are properly deduplicated by the orchestrator"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_duplicate_requests_are_removed(self, mock_social_graph, mock_factory):
        """Same-source duplicate requests should be deduplicated.

        Cross-source duplicates are NOT deduplicated - they're kept so staff
        can reconcile potential timing differences (e.g., parent form vs later call).
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

        # Create same-source duplicate requests (both FAMILY)
        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,
                source=RequestSource.FAMILY,
                confidence=0.90,
            ),
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,
                source=RequestSource.FAMILY,  # Same source - will dedupe
                confidence=0.80,
            ),
            _create_bunk_request(
                requester_cm_id=300,
                requested_cm_id=400,
                source=RequestSource.FAMILY,
                confidence=0.95,
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Should have 2 unique requests (one same-source duplicate removed)
        assert len(validated_requests) == 2

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_deduplication_count_tracked_in_stats(self, mock_social_graph, mock_factory):
        """Stats should track how many same-source duplicates were removed."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create 3 same-source duplicates of the same request
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200, source=RequestSource.FAMILY),
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200, source=RequestSource.FAMILY),
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200, source=RequestSource.FAMILY),
        ]

        orchestrator._apply_validation_pipeline(requests)

        assert orchestrator._stats.get("duplicates_removed", 0) == 2

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_different_request_types_not_deduplicated(self, mock_social_graph, mock_factory):
        """Requests with different types (bunk_with vs not_bunk_with) should NOT be
        considered duplicates even if requester/requested are the same.
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
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
            ),
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.NOT_BUNK_WITH,
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Both should be kept - different types
        assert len(validated_requests) == 2


class TestOrchestratorReciprocalDetection:
    """Tests that reciprocal requests are detected and marked by the orchestrator"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_reciprocal_requests_are_marked(self, mock_social_graph, mock_factory):
        """When A requests B and B requests A, both should be marked as reciprocal."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create reciprocal pair: A wants B, B wants A
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
            _create_bunk_request(requester_cm_id=200, requested_cm_id=100),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Both should be marked as reciprocal
        assert len(validated_requests) == 2
        assert all(r.metadata.get("is_reciprocal", False) for r in validated_requests)

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_reciprocal_requests_get_confidence_boost(self, mock_social_graph, mock_factory):
        """Reciprocal requests should receive a confidence boost."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        original_confidence = 0.80
        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,
                confidence=original_confidence,
            ),
            _create_bunk_request(
                requester_cm_id=200,
                requested_cm_id=100,
                confidence=original_confidence,
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Both should have boosted confidence (default boost is 0.1)
        for r in validated_requests:
            assert r.confidence_score > original_confidence
            assert r.metadata.get("reciprocal_boost") is not None

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_reciprocal_pairs_count_tracked_in_stats(self, mock_social_graph, mock_factory):
        """Stats should track how many reciprocal pairs were found."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create 2 reciprocal pairs
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
            _create_bunk_request(requester_cm_id=200, requested_cm_id=100),
            _create_bunk_request(requester_cm_id=300, requested_cm_id=400),
            _create_bunk_request(requester_cm_id=400, requested_cm_id=300),
        ]

        orchestrator._apply_validation_pipeline(requests)

        assert orchestrator._stats.get("reciprocal_pairs", 0) == 2

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_non_reciprocal_requests_not_marked(self, mock_social_graph, mock_factory):
        """One-way requests should NOT be marked as reciprocal."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # A wants B, but B doesn't want A
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
            _create_bunk_request(requester_cm_id=300, requested_cm_id=400),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Neither should be marked as reciprocal
        assert len(validated_requests) == 2
        assert all(not r.metadata.get("is_reciprocal", False) for r in validated_requests)


class TestOrchestratorValidationPipelineOrder:
    """Tests that validation components are applied in the correct order"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_self_ref_marked_before_dedup(self, mock_social_graph, mock_factory):
        """Self-referential requests should be marked BEFORE deduplication.
        Both requests are kept, but the self-ref has modified metadata.
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

        # Self-ref and valid request - both are kept
        requests = [
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=100,  # Self-ref!
                source=RequestSource.FAMILY,
                confidence=1.0,
            ),
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,  # Valid
                source=RequestSource.STAFF,
                confidence=0.70,
            ),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Both are kept - self-ref is marked, not filtered
        assert len(validated_requests) == 2

        # Self-ref should be modified
        self_ref = next(r for r in validated_requests if r.metadata.get("self_referential"))
        assert self_ref.requested_cm_id is None
        assert self_ref.confidence_score == 0.0

        # Valid request should be unchanged
        valid = next(r for r in validated_requests if r.requested_cm_id == 200)
        assert valid.confidence_score == 0.70

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_reciprocal_detection_after_dedup(self, mock_social_graph, mock_factory):
        """Reciprocal detection should run AFTER deduplication.
        This ensures we only count true reciprocal pairs, not duplicate ones.
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

        # Multiple copies of the same reciprocal pair
        requests = [
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200, source=RequestSource.FAMILY),
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200, source=RequestSource.STAFF),  # Dup
            _create_bunk_request(requester_cm_id=200, requested_cm_id=100, source=RequestSource.FAMILY),
            _create_bunk_request(requester_cm_id=200, requested_cm_id=100, source=RequestSource.STAFF),  # Dup
        ]

        orchestrator._apply_validation_pipeline(requests)

        # Should have exactly 1 reciprocal pair (not 2 or 4)
        assert orchestrator._stats.get("reciprocal_pairs", 0) == 1


class TestOrchestratorValidationPipelineIntegration:
    """End-to-end tests for the full validation pipeline"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_full_pipeline_with_mixed_requests(self, mock_social_graph, mock_factory):
        """Full pipeline test with self-refs, duplicates, and reciprocals."""
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
            # Self-ref (should be marked for review, not filtered)
            _create_bunk_request(requester_cm_id=100, requested_cm_id=100),
            # Duplicate pair (should keep one)
            _create_bunk_request(requester_cm_id=200, requested_cm_id=300, source=RequestSource.FAMILY),
            _create_bunk_request(requester_cm_id=200, requested_cm_id=300, source=RequestSource.STAFF),
            # Reciprocal pair (should be marked)
            _create_bunk_request(requester_cm_id=400, requested_cm_id=500),
            _create_bunk_request(requester_cm_id=500, requested_cm_id=400),
            # Regular request
            _create_bunk_request(requester_cm_id=600, requested_cm_id=700),
        ]

        validated_requests = orchestrator._apply_validation_pipeline(requests)

        # Expected: 5 requests (self-ref kept with modifications, 1 duplicate removed)
        assert len(validated_requests) == 5

        # Check stats
        assert orchestrator._stats.get("self_referential_filtered", 0) == 1  # Count tracked
        assert orchestrator._stats.get("duplicates_removed", 0) == 1
        assert orchestrator._stats.get("reciprocal_pairs", 0) == 1

        # Check self-ref is modified correctly
        self_ref = next(r for r in validated_requests if r.metadata.get("self_referential"))
        assert self_ref.requested_cm_id is None
        assert self_ref.confidence_score == 0.0

        # Check reciprocal marking
        reciprocal_requests = [
            r for r in validated_requests if r.requester_cm_id in (400, 500) and r.requested_cm_id in (400, 500)
        ]
        assert len(reciprocal_requests) == 2
        assert all(r.metadata.get("is_reciprocal", False) for r in reciprocal_requests)


# =============================================================================
# Parity Tracker Gap: Line 233 (Known Intentional Differences)
# =============================================================================


class TestAIReasoningConflictsDetection:
    """Tests for detecting conflicts in AI reasoning and flagging for manual review.

    "Modular stores ai_reasoning in metadata but never inspects it for conflicts"

    - Gets ai_reasoning from parsed.metadata
    - If ai_reasoning is a dict with 'conflicts' list
    - Sets status = PENDING for staff review
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_ai_reasoning_with_conflicts_sets_pending_status(self, mock_social_graph, mock_factory):
        """When AI reasoning contains conflicts, the request status should be PENDING
        for staff review.

            if conflicts:
                # Sets status = PENDING for staff review
        """
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create a parsed request with AI reasoning containing conflicts
        parsed_req = ParsedRequest(
            raw_text="Put Johnny with his brother",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=1,
            metadata={
                "ai_reasoning": {
                    "reasoning": "Found potential match",
                    "conflicts": ["Request conflicts with do_not_share_with entry"],
                }
            },
        )

        # Resolution info with resolved person
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "confidence": 0.85,
            "requester_name": "Test Parent",
            "session_cm_id": 1000002,
        }

        # Call the internal method to create bunk requests (async)
        requests = await orchestrator._create_bunk_requests([(parsed_req, resolution_info)])

        # Should have created one request
        assert len(requests) == 1
        request = requests[0]

        # Request should be PENDING due to conflicts
        from bunking.sync.bunk_request_processor.core.models import RequestStatus

        assert request.status == RequestStatus.PENDING

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_ai_reasoning_without_conflicts_not_flagged(self, mock_social_graph, mock_factory):
        """When AI reasoning has no conflicts, the request should NOT be flagged
        for manual review (unless flagged for other reasons).
        """
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Create a parsed request with AI reasoning but NO conflicts
        parsed_req = ParsedRequest(
            raw_text="Put Johnny with his friend",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,
            metadata={
                "ai_reasoning": {
                    "reasoning": "Clear match found",
                    "conflicts": [],  # Empty conflicts list
                }
            },
        )

        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "confidence": 0.95,
            "requester_name": "Test Parent",
            "session_cm_id": 1000002,
        }

        requests = await orchestrator._create_bunk_requests([(parsed_req, resolution_info)])

        assert len(requests) == 1
        request = requests[0]

        # Should NOT be PENDING due to conflicts (high confidence = RESOLVED)
        from bunking.sync.bunk_request_processor.core.models import RequestStatus

        assert request.status == RequestStatus.RESOLVED

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_ai_reasoning_string_not_flagged_for_conflicts(self, mock_social_graph, mock_factory):
        """When AI reasoning is a string (not a dict), there are no conflicts
        to detect. Should not flag for manual review due to conflicts.

            else:
                # If ai_reasoning is a string, there are no conflicts
                conflicts = []
        """
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # AI reasoning as a string (legacy format)
        parsed_req = ParsedRequest(
            raw_text="Put Johnny with his friend",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,
            metadata={"ai_reasoning": "Found exact match for Johnny Smith in session"},
        )

        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "confidence": 0.95,
            "requester_name": "Test Parent",
            "session_cm_id": 1000002,
        }

        requests = await orchestrator._create_bunk_requests([(parsed_req, resolution_info)])

        assert len(requests) == 1
        request = requests[0]

        # Should NOT be PENDING for conflicts (string reasoning has no conflicts, high confidence = RESOLVED)
        from bunking.sync.bunk_request_processor.core.models import RequestStatus

        assert request.status == RequestStatus.RESOLVED


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

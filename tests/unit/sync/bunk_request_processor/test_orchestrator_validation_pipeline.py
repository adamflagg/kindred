"""TDD Tests for Orchestrator Validation Pipeline Integration

Tests that the orchestrator correctly wires up the validation components:
1. SelfReferenceRule - filters out self-referential requests
2. Deduplicator - removes duplicate requests

Note: Reciprocal detection now occurs in the batch_signals stage before request building.

These tests define the expected behavior. The implementation must make them pass."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
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
    priority: int = 3,
    source_field: str = "bunk_with",
) -> BunkRequest:
    """Helper to create BunkRequest objects for testing"""
    return BunkRequest(
        requester_cm_id=requester_cm_id,
        requested_cm_id=requested_cm_id,
        request_type=request_type,
        session_cm_id=session_cm_id,
        is_first_requested=(priority >= 4),
        confidence_score=confidence,
        source_field=source_field,
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
        validated_requests, _ = orchestrator._apply_validation_pipeline(requests)

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

        orchestrator._apply_validation_pipeline(requests)  # returns (list, set) tuple

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
                confidence=0.90,
            ),
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,
                confidence=0.80,
            ),
            _create_bunk_request(
                requester_cm_id=300,
                requested_cm_id=400,
                confidence=0.95,
            ),
        ]

        validated_requests, _ = orchestrator._apply_validation_pipeline(requests)

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
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
            _create_bunk_request(requester_cm_id=100, requested_cm_id=200),
        ]

        orchestrator._apply_validation_pipeline(requests)  # returns (list, set) tuple

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

        validated_requests, _ = orchestrator._apply_validation_pipeline(requests)

        # Both should be kept - different types
        assert len(validated_requests) == 2


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
                confidence=1.0,
            ),
            _create_bunk_request(
                requester_cm_id=100,
                requested_cm_id=200,  # Valid
                confidence=0.70,
            ),
        ]

        validated_requests, _ = orchestrator._apply_validation_pipeline(requests)

        # Both are kept - self-ref is marked, not filtered
        assert len(validated_requests) == 2

        # Self-ref should be modified
        self_ref = next(r for r in validated_requests if r.metadata.get("self_referential"))
        assert self_ref.requested_cm_id is None
        assert self_ref.confidence_score == 0.0

        # Valid request should be unchanged
        valid = next(r for r in validated_requests if r.requested_cm_id == 200)
        assert valid.confidence_score == 0.70


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
            _create_bunk_request(requester_cm_id=200, requested_cm_id=300),
            _create_bunk_request(requester_cm_id=200, requested_cm_id=300),
            # Reciprocal pair (kept but NOT marked here — reciprocal detection
            # now happens in batch_signals stage before request building)
            _create_bunk_request(requester_cm_id=400, requested_cm_id=500),
            _create_bunk_request(requester_cm_id=500, requested_cm_id=400),
            # Regular request
            _create_bunk_request(requester_cm_id=600, requested_cm_id=700),
        ]

        validated_requests, _ = orchestrator._apply_validation_pipeline(requests)

        # Expected: 5 requests (self-ref kept with modifications, 1 duplicate removed)
        assert len(validated_requests) == 5

        # Check stats
        assert orchestrator._stats.get("self_referential_filtered", 0) == 1  # Count tracked
        assert orchestrator._stats.get("duplicates_removed", 0) == 1

        # Check self-ref is modified correctly
        self_ref = next(r for r in validated_requests if r.metadata.get("self_referential"))
        assert self_ref.requested_cm_id is None
        assert self_ref.confidence_score == 0.0


class TestDedupTraceKeyCollision:
    """Tests for dedup trace key collision fix (issue #788).

    The dedup trace key must include requested_cm_id to distinguish
    requests for different targets who share the same name. Without it,
    (requester_cm_id, requested_name) can collide when two different
    cm_ids resolve to the same display name, causing the surviving
    request to be incorrectly marked as DEDUPED.
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_deduped_keys_include_requested_cm_id(self, mock_social_graph, mock_factory):
        """deduped_keys must use (requester_cm_id, requested_cm_id, name) not just (requester_cm_id, name).

        When two requests from the same requester target different people who share a name,
        only the actual duplicate should appear in deduped_keys — not the distinct request.
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

        # Same requester, same name, DIFFERENT cm_ids — these are distinct people
        # Emma Johnson (cm_id=200) and Emma Johnson (cm_id=201) are different campers
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.95,
        )
        req_a.requested_name = "Emma Johnson"

        req_b = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=201,
            confidence=0.90,
        )
        req_b.requested_name = "Emma Johnson"

        validated, deduped_keys = orchestrator._apply_validation_pipeline([req_a, req_b])

        # Both should be kept — different targets (different cm_ids)
        assert len(validated) == 2
        # No duplicates removed — these are distinct requests
        assert len(deduped_keys) == 0

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_deduped_keys_distinguish_same_name_different_target(self, mock_social_graph, mock_factory):
        """When a true duplicate exists alongside a distinct same-name request,
        only the duplicate's key should be in deduped_keys.

        Setup: requester 100 requests both Emma Johnson (cm_id=200) twice
        and Emma Johnson (cm_id=201) once. The duplicate pair (cm_id=200)
        should produce a deduped_keys entry for cm_id=200 only.
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

        # Two requests for Emma Johnson (cm_id=200) — true duplicates
        dup_1 = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.95,
        )
        dup_1.requested_name = "Emma Johnson"

        dup_2 = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.80,
        )
        dup_2.requested_name = "Emma Johnson"

        # One request for different Emma Johnson (cm_id=201) — NOT a duplicate
        distinct = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=201,
            confidence=0.90,
        )
        distinct.requested_name = "Emma Johnson"

        validated, deduped_keys = orchestrator._apply_validation_pipeline([dup_1, dup_2, distinct])

        # 2 kept: one from the (200) duplicate pair + the distinct (201) request
        assert len(validated) == 2

        # deduped_keys should contain an entry for cm_id=200 (the removed duplicate)
        # but NOT for cm_id=201 (the distinct request that was never duplicated)
        assert len(deduped_keys) == 1

        # The key must include requested_cm_id so we can tell WHICH Emma Johnson was deduped
        deduped_key = next(iter(deduped_keys))
        assert 200 in deduped_key, "deduped key must contain the duplicated target's cm_id (200)"
        assert 201 not in deduped_key, "deduped key must NOT contain the distinct target's cm_id (201)"


# =============================================================================
# Parity Tracker Gap: Line 233 (Known Intentional Differences)
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

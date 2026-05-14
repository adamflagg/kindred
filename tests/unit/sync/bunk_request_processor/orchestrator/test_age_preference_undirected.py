"""Regression guard + e2e: undirected age_preference requests must PEND for
staff review and never have direction inferred from free-text prose.

History:
- The deleted ``RequestOrchestrator._map_age_preference_direction`` substring-
  matched the AI's free-text rationale (parse_notes + ai_reasoning) for
  direction keywords ("older", "younger", "above", "below", "grade up", etc.)
  and over-fired on prose where the AI used direction words to *describe* the
  absence of a direction (e.g. "No explicit direction (older vs younger)").
- PR #1402 deleted the fallback and left undirected parses as PENDING.
- PR #1401 makes direction a structured field on the AI schema:
  ``AIBunkRequestItem.age_direction: Literal["older","younger"]|None``.
  ``openai_provider`` reads it directly into ``ParsedRequest.age_preference``;
  the request_builder forwards that to ``determine_disposition`` which routes
  ``age_direction=None`` to ``Disposition(PENDING, "undirected_preference")``
  via ``disposition_rules._age_preference_rules``.

If you find yourself wanting to infer direction from any free-text source after
the AI parse, **stop** — the AI's structured ``age_direction`` is the only
trusted signal. If structured signal isn't enough, change the AI schema rather
than re-introducing prose sniffing.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
)


def _create_mock_pocketbase():
    pb = Mock()

    def mock_collection(_name):
        collection = Mock()
        collection.get_full_list = Mock(return_value=[])
        collection.get_list = Mock(return_value=Mock(items=[], total_items=0))
        collection.create = Mock(return_value=Mock(id="test-id"))
        collection.update = Mock()
        collection.delete = Mock()
        return collection

    pb.collection = mock_collection
    return pb


class TestKeywordFallbackNotReintroduced:
    def test_map_age_preference_direction_does_not_exist(self):
        """``_map_age_preference_direction`` must not be reintroduced on
        ``RequestOrchestrator``. Direction comes from the structured AI signal,
        not from substring-matching the AI's free-text rationale."""
        assert not hasattr(RequestOrchestrator, "_map_age_preference_direction"), (
            "Do not reintroduce _map_age_preference_direction. Direction must "
            "come from openai_provider's structured age_direction field; "
            "undirected parses must stay None and route to "
            "PENDING/undirected_preference via "
            "disposition_rules._age_preference_rules. See PR #1402 for the "
            "bug class this guards against."
        )


class TestUndirectedAgePreferenceE2E:
    """e2e through orchestrator._create_bunk_requests for an undirected age_preference.

    Closes #1406 — locks down that an undirected request (age_preference=None
    after provider conversion) produces a saved BunkRequest with:
      status == RequestStatus.PENDING
      disposition_reason == "undirected_preference"
      target_name is None
      age_preference is None
    """

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_undirected_age_preference_pends_with_correct_disposition_reason(
        self, mock_social_graph, mock_factory
    ):
        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        parsed_req = ParsedRequest(
            raw_text="Age-wise, no strong direction",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=None,
            source_field="bunk_with",
            confidence=0.85,
            csv_position=1,
            metadata={},
        )

        resolution_info = {
            "requester_cm_id": 11111,
            "requester_name": "Test Requester",
            "session_cm_id": 1000002,
            "person_cm_id": None,
            "person_name": None,
            "confidence": 0.0,
            "resolution_method": "age_preference",
        }

        created_requests, _ = await orchestrator._create_bunk_requests([(parsed_req, resolution_info)])

        assert len(created_requests) == 1, "expected one BunkRequest"
        req = created_requests[0]
        assert req.status == RequestStatus.PENDING, (
            f"undirected age_preference must PEND for staff review, got {req.status}"
        )
        assert req.disposition_reason == "undirected_preference", (
            f"disposition_reason must be 'undirected_preference', got {req.disposition_reason!r}"
        )
        assert req.requested_name is None, "requested_name must be cleared for age_preference"
        assert req.requested_cm_id is None, "undirected age_preference has no target person"

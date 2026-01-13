"""Tests for post-expansion conflict detection.

TDD tests for the _filter_post_expansion_conflicts() method that catches
conflicts introduced by SIBLING placeholder expansion.

The key insight: temporal conflict filtering happens BEFORE SIBLING expansion,
so conflicts like "not_bunk_with Pippi" vs "bunk_with SIBLING" (which expands
to Pippi) are never caught. This post-expansion filter provides a deterministic
safety net that doesn't depend on AI correctly marking is_superseded.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def make_person(cm_id: int, name: str = "Test") -> Person:
    """Helper to create a Person object."""
    return Person(cm_id=cm_id, first_name=name, last_name="User")


def make_parse_request(requester_cm_id: int = 99999) -> ParseRequest:
    """Helper to create a ParseRequest."""
    return ParseRequest(
        request_text="test",
        field_name="bunking_notes",
        requester_name="Test User",
        requester_cm_id=requester_cm_id,
        requester_grade="5",
        session_cm_id=1000001,
        session_name="Session 1",
        year=2025,
        row_data={},
    )


def make_request(
    request_type: RequestType,
    target_name: str,
    csv_position: int = 1,
    temporal_date: datetime | None = None,
) -> ParsedRequest:
    """Helper to create a ParsedRequest."""
    return ParsedRequest(
        raw_text="test",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="test",
        source=RequestSource.FAMILY,
        confidence=1.0,
        csv_position=csv_position,
        metadata={},
        temporal_date=temporal_date,
    )


def make_resolution(person: Person | None = None) -> ResolutionResult:
    """Helper to create a ResolutionResult."""
    return ResolutionResult(
        person=person,
        confidence=1.0 if person else 0.0,
        method="exact" if person else "unresolved",
    )


def make_parse_result(
    requests: list[ParsedRequest],
    requester_cm_id: int = 99999,
) -> ParseResult:
    """Helper to create a ParseResult with proper ParseRequest."""
    return ParseResult(
        parsed_requests=requests,
        is_valid=True,
        parse_request=make_parse_request(requester_cm_id),
    )


class TestPostExpansionConflictDetection:
    """Test the _filter_post_expansion_conflicts method."""

    def _make_orchestrator(self) -> RequestOrchestrator:
        """Create a minimal orchestrator for testing."""
        mock_pb = Mock()
        mock_pb.auth_store = Mock()
        mock_pb.auth_store.is_valid = True
        return RequestOrchestrator(
            pb=mock_pb,
            year=2025,
            session_cm_ids=[1000001],
        )

    def test_bunk_with_and_not_bunk_with_same_target_keeps_most_recent_by_position(self):
        """When SIBLING expands to create conflicting requests, keep higher csv_position."""
        orchestrator = self._make_orchestrator()
        sibling = make_person(12345, "Pippi")

        # Simulate: internal_notes had "not_bunk_with Pippi" (position 1)
        # and bunking_notes had "bunk_with SIBLING" which expanded to Pippi (position 2)
        req1 = make_request(RequestType.NOT_BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=2)

        parse_result = make_parse_result([req1, req2])

        resolutions = [
            make_resolution(sibling),  # not_bunk_with resolved to Pippi
            make_resolution(sibling),  # bunk_with resolved to Pippi
        ]

        expansion_results = [(parse_result, resolutions)]
        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        # Should keep only the bunk_with (position 2 is higher)
        assert kept == 1
        assert filtered == 1
        assert len(parse_result.parsed_requests) == 1
        assert parse_result.parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_bunk_with_and_not_bunk_with_same_target_keeps_most_recent_by_date(self):
        """When both have dates, prefer the later date."""
        orchestrator = self._make_orchestrator()
        sibling = make_person(12345, "Pippi")

        # Earlier date: not_bunk_with on 6/4
        # Later date: bunk_with on 6/5
        req1 = make_request(
            RequestType.NOT_BUNK_WITH,
            "Pippi",
            csv_position=1,
            temporal_date=datetime(2025, 6, 4),
        )
        req2 = make_request(
            RequestType.BUNK_WITH,
            "Pippi",
            csv_position=2,
            temporal_date=datetime(2025, 6, 5),
        )

        parse_result = make_parse_result([req1, req2])
        resolutions = [make_resolution(sibling), make_resolution(sibling)]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        assert kept == 1
        assert filtered == 1
        assert parse_result.parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_same_type_requests_for_same_target_not_filtered(self):
        """Two bunk_with requests for same target (duplicate) are not filtered here."""
        orchestrator = self._make_orchestrator()
        sibling = make_person(12345, "Pippi")

        # Both are bunk_with - no conflict
        req1 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=2)

        parse_result = make_parse_result([req1, req2])
        resolutions = [make_resolution(sibling), make_resolution(sibling)]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        # Both kept - deduplication is a separate concern
        assert kept == 2
        assert filtered == 0
        assert len(parse_result.parsed_requests) == 2

    def test_different_targets_not_filtered(self):
        """Requests for different targets don't conflict."""
        orchestrator = self._make_orchestrator()
        pippi = make_person(12345, "Pippi")
        calla = make_person(12346, "Calla")

        req1 = make_request(RequestType.NOT_BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.BUNK_WITH, "Calla", csv_position=2)

        parse_result = make_parse_result([req1, req2])
        resolutions = [make_resolution(pippi), make_resolution(calla)]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        assert kept == 2
        assert filtered == 0
        assert len(parse_result.parsed_requests) == 2

    def test_unresolved_requests_preserved(self):
        """Requests without resolved person_cm_id are kept."""
        orchestrator = self._make_orchestrator()
        sibling = make_person(12345, "Pippi")

        req1 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.BUNK_WITH, "Unknown Person", csv_position=2)

        parse_result = make_parse_result([req1, req2])
        resolutions = [
            make_resolution(sibling),  # Resolved
            make_resolution(None),  # Unresolved
        ]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        assert kept == 2
        assert filtered == 0
        assert len(parse_result.parsed_requests) == 2

    def test_invalid_parse_result_skipped(self):
        """Invalid parse results are skipped."""
        orchestrator = self._make_orchestrator()

        parse_result = ParseResult(
            is_valid=False,  # Invalid
            parsed_requests=[],
        )

        expansion_results: list[tuple[ParseResult, list[Any]]] = [(parse_result, [])]
        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        assert kept == 0
        assert filtered == 0

    def test_age_preference_not_affected(self):
        """Age preference requests are not affected by conflict detection."""
        orchestrator = self._make_orchestrator()
        sibling = make_person(12345, "Pippi")

        req1 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.AGE_PREFERENCE, "older", csv_position=2)

        parse_result = make_parse_result([req1, req2])
        resolutions = [
            make_resolution(sibling),
            make_resolution(None),  # Age preference has no target person
        ]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        # Both kept - age preference doesn't conflict with bunk_with
        assert kept == 2
        assert filtered == 0

    def test_multiple_parse_results_handled(self):
        """Multiple ParseResults are all processed."""
        orchestrator = self._make_orchestrator()
        pippi = make_person(12345, "Pippi")
        calla = make_person(12346, "Calla")

        # First requester: conflict
        req1 = make_request(RequestType.NOT_BUNK_WITH, "Pippi", csv_position=1)
        req2 = make_request(RequestType.BUNK_WITH, "Pippi", csv_position=2)
        parse_result1 = make_parse_result([req1, req2], requester_cm_id=99999)
        resolutions1 = [make_resolution(pippi), make_resolution(pippi)]

        # Second requester: no conflict
        req3 = make_request(RequestType.BUNK_WITH, "Calla", csv_position=1)
        parse_result2 = make_parse_result([req3], requester_cm_id=88888)
        resolutions2 = [make_resolution(calla)]

        expansion_results = [(parse_result1, resolutions1), (parse_result2, resolutions2)]
        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        assert kept == 2  # One from conflict resolution, one from no-conflict
        assert filtered == 1  # One filtered from conflict
        assert len(parse_result1.parsed_requests) == 1
        assert len(parse_result2.parsed_requests) == 1

    def test_twins_scenario_bunk_with_wins_over_not_bunk_with(self):
        """
        Real-world twins scenario: internal_notes says "not_bunk_with Pippi"
        but bunking_notes says "bunk_with SIBLING" which expands to Pippi.
        The bunk_with has higher position (processed later), so it wins.
        """
        orchestrator = self._make_orchestrator()
        pippi = make_person(19930605, "Pippi")

        # From internal_notes (earlier in processing)
        not_bunk_req = make_request(
            RequestType.NOT_BUNK_WITH,
            "Pippi",
            csv_position=1,  # Lower position
        )

        # From bunking_notes SIBLING expansion (later in processing)
        bunk_with_req = make_request(
            RequestType.BUNK_WITH,
            "Pippi",
            csv_position=2,  # Higher position
        )

        parse_result = make_parse_result([not_bunk_req, bunk_with_req], requester_cm_id=19930614)
        resolutions = [make_resolution(pippi), make_resolution(pippi)]
        expansion_results = [(parse_result, resolutions)]

        filtered_results, kept, filtered = orchestrator._filter_post_expansion_conflicts(expansion_results)

        # Bunk_with wins (higher position)
        assert kept == 1
        assert filtered == 1
        assert parse_result.parsed_requests[0].request_type == RequestType.BUNK_WITH
        assert parse_result.parsed_requests[0].target_name == "Pippi"

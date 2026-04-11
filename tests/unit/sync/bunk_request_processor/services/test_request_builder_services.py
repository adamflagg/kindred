"""Tests for services/request_builder.py

Tests the RequestBuilder class in services/ which handles:
- Building BunkRequest metadata from ParsedRequest
- AI reasoning storage (ai_p1_reasoning field)
- Status determination
"""

from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    ParsedRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.request_builder import RequestBuilder


class TestRequestBuilderMetadata:
    """Tests for build_request_metadata method"""

    @pytest.fixture
    def mock_priority_calculator(self):
        """Create a mock priority calculator"""
        mock = Mock()
        mock.calculate_priority.return_value = 3
        return mock

    @pytest.fixture
    def builder(self, mock_priority_calculator):
        """Create a RequestBuilder with mocked dependencies"""
        return RequestBuilder(
            priority_calculator=mock_priority_calculator,
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    @pytest.fixture
    def parsed_request_with_reasoning(self):
        """Create a ParsedRequest with reasoning in metadata (as AI provides it)"""
        return ParsedRequest(
            raw_text="Kyla Udell",
            target_name="Kyla Udell",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_bunk_with",
            csv_position=0,
            metadata={
                "requester_cm_id": 12345,
                "parse_notes": "Direct separation request",
                "reasoning": "Direct mention of name Kyla Udell indicating a request to not be bunked together.",
                "keywords_found": [],
            },
            notes=None,
        )

    def test_build_request_metadata_stores_reasoning_from_correct_key(self, builder, parsed_request_with_reasoning):
        """Verify ai_p1_reasoning is populated from metadata['reasoning'], not 'ai_reasoning'.

        This test exposes the bug where line 199 uses the wrong key 'ai_reasoning'
        instead of 'reasoning', causing ai_p1_reasoning to always be empty.
        """
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
            "person_cm_id": 67890,
            "person_name": "Kyla Udell",
        }
        ai_parsed = False  # Phase 1 parsing, not Phase 3 disambiguation

        metadata = builder.build_request_metadata(parsed_request_with_reasoning, resolution_info, ai_parsed)

        # The bug: metadata uses "ai_reasoning" key but AI provider stores "reasoning"
        # Expected: ai_p1_reasoning should contain the reasoning string
        expected_reasoning = "Direct mention of name Kyla Udell indicating a request to not be bunked together."
        assert metadata["ai_p1_reasoning"] == expected_reasoning, (
            f"ai_p1_reasoning should be '{expected_reasoning}', "
            f"got '{metadata['ai_p1_reasoning']}'. "
            "Bug: request_builder.py line 199 uses wrong key 'ai_reasoning' instead of 'reasoning'."
        )

    def test_build_request_metadata_stores_parse_notes(self, builder, parsed_request_with_reasoning):
        """Verify parse_notes is properly extracted from metadata"""
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
        }

        metadata = builder.build_request_metadata(parsed_request_with_reasoning, resolution_info, ai_parsed=False)

        assert metadata["parse_notes"] == "Direct separation request"

    def test_build_request_metadata_ai_p1_reasoning_empty_when_phase3(self, builder, parsed_request_with_reasoning):
        """When ai_parsed=True (Phase 3), ai_p1_reasoning should be empty."""
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
            "person_cm_id": 67890,
            "resolution_metadata": {
                "ai_p3_reasoning": {"disambiguation": "Selected based on session context"},
            },
        }

        metadata = builder.build_request_metadata(parsed_request_with_reasoning, resolution_info, ai_parsed=True)

        # Phase 3 should have empty ai_p1_reasoning
        assert metadata["ai_p1_reasoning"] == ""

    def test_build_request_metadata_reasoning_type_is_string(self, builder, parsed_request_with_reasoning):
        """ai_p1_reasoning should be a string, not a dict.

        The bug also uses {} as default, but reasoning should be a string.
        """
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
        }

        metadata = builder.build_request_metadata(parsed_request_with_reasoning, resolution_info, ai_parsed=False)

        assert isinstance(metadata["ai_p1_reasoning"], str), (
            f"ai_p1_reasoning should be a string, got {type(metadata['ai_p1_reasoning'])}. "
            "Bug: request_builder.py uses {} as default instead of '' for reasoning."
        )


class TestRequestBuilderIntegration:
    """Integration tests for full request building"""

    @pytest.fixture
    def mock_priority_calculator(self):
        mock = Mock()
        mock.calculate_priority.return_value = 3
        return mock

    @pytest.fixture
    def builder(self, mock_priority_calculator):
        return RequestBuilder(
            priority_calculator=mock_priority_calculator,
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    def test_build_single_request_includes_reasoning_in_metadata(self, builder):
        """Full integration test: reasoning flows through to BunkRequest metadata"""
        parsed_req = ParsedRequest(
            raw_text="Jane Smith",
            target_name="Jane Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_bunk_with",
            csv_position=0,
            metadata={
                "reasoning": "Separation request based on staff input.",
                "parse_notes": "",
                "keywords_found": [],
            },
        )

        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Requester",
            "person_cm_id": 67890,
            "person_name": "Jane Smith",
            "session_cm_id": 1000002,
            "confidence": 0.92,
        }

        bunk_request = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert bunk_request is not None
        assert bunk_request.metadata["ai_p1_reasoning"] == "Separation request based on staff input."


class TestCrossSessionSatisfied:
    """Tests for cross-session NOT_BUNK_WITH disposition via disposition rules."""

    def test_cross_session_high_confidence_resolves(self):
        """Cross-session NOT_BUNK_WITH with high confidence → RESOLVED."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "person_cm_id": 7777777,
            "conflict_type": "cross_session_satisfied",
            "confidence": 0.9,
            "conflict_metadata": {"requester_session": 1000010, "target_session": 1000020},
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.RESOLVED
        assert reason == "cross_session_satisfied"

    def test_cross_session_low_confidence_pending(self):
        """Cross-session NOT_BUNK_WITH with low confidence → PENDING for staff review."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.7,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "person_cm_id": 7777777,
            "conflict_type": "cross_session_satisfied",
            "confidence": 0.7,
            "conflict_metadata": {"requester_session": 1000010, "target_session": 1000020},
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.PENDING
        assert reason == "needs_review"

    def test_session_mismatch_declines(self):
        """Session mismatch conflict_type triggers DECLINED via disposition rules."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "person_cm_id": 7777777,
            "has_conflict": True,
            "conflict_type": "session_mismatch",
            "conflict_description": "Session mismatch",
            "confidence": 0.9,
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.DECLINED


class TestEnrollmentDispositionStatus:
    """Tests for enrollment-aware disposition in request builder."""

    def test_not_attending_conflict_declines(self):
        """has_conflict + target_not_attending → DECLINED with reason."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "person_cm_id": 1234567,
            "has_conflict": True,
            "conflict_type": "target_not_attending",
            "conflict_description": "Target 1234567 has inactive enrollment status (status_id=32)",
            "confidence": 0.90,
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.DECLINED
        assert "inactive enrollment" in metadata.get("declined_reason", "")

    def test_requester_not_attending_conflict_declines(self):
        """has_conflict + requester_not_attending → DECLINED with 'requester_not_attending' reason.

        Bug #830: Previously this produced 'target_not_attending' because the
        conflict types were conflated into a single target_is_inactive boolean.
        """
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "person_cm_id": 1234567,
            "has_conflict": True,
            "conflict_type": "requester_not_attending",
            "conflict_description": "Requester 1000001 has inactive enrollment status (status_id=32)",
            "confidence": 0.90,
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.DECLINED
        assert reason == "requester_not_attending"
        assert "inactive enrollment" in metadata.get("declined_reason", "")

    def test_waitlisted_target_stays_pending(self):
        """target_waitlisted=True → PENDING even with high confidence."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Olivia Chen",
            request_type=RequestType.BUNK_WITH,
            target_name="Olivia Chen",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        # High confidence (0.91 > 0.85) would normally RESOLVE, but waitlisted overrides
        resolution_info = {
            "person_cm_id": 1234567,
            "target_waitlisted": True,
            "confidence": 0.91,
        }
        metadata: dict[str, Any] = {}

        status, reason = builder.determine_request_status(parsed_req, resolution_info, metadata)

        assert status == RequestStatus.PENDING
        assert reason == "target_waitlisted"


class TestBunkRequestDispositionFields:
    """BunkRequest must carry disposition_reason and resolution_method as first-class fields."""

    def test_bunk_request_has_resolution_method_field(self):
        """resolution_method is a direct field, not buried in metadata."""
        br = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
            resolution_method="exact_match",
        )
        assert br.resolution_method == "exact_match"

    def test_bunk_request_has_disposition_reason_field(self):
        """disposition_reason is a direct field, not buried in metadata."""
        br = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
            disposition_reason="exact_match",
        )
        assert br.disposition_reason == "exact_match"

    def test_fields_default_to_empty_string(self):
        """Both fields default to empty string when not provided."""
        br = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )
        assert br.resolution_method == ""
        assert br.disposition_reason == ""


class TestResolutionMethodDirect:
    """resolution_method must be set on BunkRequest, not in metadata."""

    def test_build_single_request_sets_resolution_method(self):
        """build_single_request() sets resolution_method from resolution_info."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "person_name": "Emma Johnson",
            "session_cm_id": 1000002,
            "confidence": 0.95,
            "resolution_method": "exact_match",
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert br.resolution_method == "exact_match"

    def test_resolution_method_not_in_metadata(self):
        """resolution_method must NOT be stored in metadata dict."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "person_name": "Emma Johnson",
            "session_cm_id": 1000002,
            "confidence": 0.95,
            "resolution_method": "fuzzy_match",
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert "resolution_method" not in br.metadata
        assert "match_type" not in br.metadata


class TestDispositionReasonDirect:
    """disposition_reason must be set on BunkRequest, not in metadata."""

    def test_build_single_request_sets_disposition_reason(self):
        """Resolved exact match sets disposition_reason='exact_match' on BunkRequest."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "session_cm_id": 1000002,
            "confidence": 0.95,
            "resolution_method": "exact_match",
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert br.disposition_reason == "exact_match"

    def test_disposition_reason_not_in_metadata(self):
        """disposition_reason must NOT be stored in metadata dict."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 67890,
            "session_cm_id": 1000002,
            "confidence": 0.95,
            "resolution_method": "exact_match",
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert "disposition_reason" not in br.metadata
        assert "disposition_rule_id" not in br.metadata

    def test_cross_session_satisfied_sets_disposition_reason(self):
        """Cross-session conflict with high confidence sets disposition_reason='cross_session_satisfied'."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="not_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": 7777777,
            "session_cm_id": 1000002,
            "conflict_type": "cross_session_satisfied",
            "confidence": 0.9,
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert br.disposition_reason == "cross_session_satisfied"
        assert br.status == RequestStatus.RESOLVED

    def test_unresolved_name_has_empty_disposition(self):
        """Negative person_cm_id (unresolved) has no disposition — it's PENDING before rules."""
        builder = RequestBuilder(
            priority_calculator=Mock(),
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        builder.priority_calculator.calculate_priority.return_value = 3

        parsed_req = ParsedRequest(
            raw_text="Sophia",
            request_type=RequestType.BUNK_WITH,
            target_name="Sophia",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.5,
            csv_position=0,
            metadata={},
        )
        resolution_info = {
            "requester_cm_id": 12345,
            "person_cm_id": -787442027,
            "session_cm_id": 1000002,
            "confidence": 0.5,
            "resolution_method": "fuzzy_match",
        }

        br = builder.build_single_request(parsed_req, resolution_info, [parsed_req], 12345)

        assert br is not None
        assert br.disposition_reason == ""
        assert br.status == RequestStatus.PENDING


class TestPhase3Guardrails:
    """Tests for post-build guardrails that prevent pipeline over-generation.

    Guardrail 1: Output count limit - >5 requests from a single source text
    should be flagged for staff review, not auto-created as individual requests.

    Guardrail 2: Blanket statement detection - if the original text doesn't name
    specific people, individual per-person requests should not be created.
    """

    @pytest.fixture
    def mock_priority_calculator(self):
        mock = Mock()
        mock.calculate_priority.return_value = 2
        return mock

    @pytest.fixture
    def builder(self, mock_priority_calculator):
        return RequestBuilder(
            priority_calculator=mock_priority_calculator,
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    def _make_resolved_request(
        self,
        raw_text: str,
        target_name: str | None,
        requester_cm_id: int = 12345,
        person_cm_id: int | None = None,
        confidence: float = 0.85,
        source_field: str = "share_bunk_with",
        field_index: int = 0,
        total_in_field: int = 1,
    ) -> tuple[ParsedRequest, dict[str, Any]]:
        """Helper to create a (ParsedRequest, resolution_info) pair."""
        parsed = ParsedRequest(
            raw_text=raw_text,
            request_type=RequestType.BUNK_WITH,
            target_name=target_name,
            age_preference=None,
            source_field=source_field,
            source=RequestSource.FAMILY,
            confidence=confidence,
            csv_position=0,
            metadata={},
        )
        info: dict[str, Any] = {
            "requester_cm_id": requester_cm_id,
            "session_cm_id": 1000002,
            "confidence": confidence,
            "field_index": field_index,
            "total_in_field": total_in_field,
        }
        if person_cm_id is not None:
            info["person_cm_id"] = person_cm_id
            info["person_name"] = target_name
            info["resolution_method"] = "exact_match"
        return parsed, info

    def test_over_generation_flagged_when_exceeds_limit(self, builder: RequestBuilder) -> None:
        """When >5 requests come from the same source text, they should all be flagged as PENDING."""
        # 7 individual requests all from the same source text
        resolved_requests = []
        names = [
            "Emma Johnson",
            "Liam Garcia",
            "Olivia Chen",
            "Noah Kim",
            "Sophia Patel",
            "Mason Nguyen",
            "Isabella Brown",
        ]
        for i, name in enumerate(names):
            resolved_requests.append(
                self._make_resolved_request(
                    raw_text="wants to be with all her friends from school",
                    target_name=name,
                    person_cm_id=10000 + i,
                    field_index=i,
                    total_in_field=len(names),
                )
            )

        results = builder.build_requests(resolved_requests)

        # All 7 requests should be flagged as PENDING (not auto-resolved)
        assert len(results) > 0
        for req in results:
            assert req.status == RequestStatus.PENDING, (
                f"Request for {req.requested_name} should be PENDING due to over-generation guardrail"
            )
            assert req.metadata.get("over_generation_flagged") is True

    def test_normal_count_not_flagged(self, builder: RequestBuilder) -> None:
        """5 or fewer requests from same source should NOT be flagged."""
        resolved_requests = []
        names = ["Emma Johnson", "Liam Garcia", "Olivia Chen", "Noah Kim", "Sophia Patel"]
        for i, name in enumerate(names):
            resolved_requests.append(
                self._make_resolved_request(
                    raw_text="wants to bunk with Emma Johnson, Liam Garcia, Olivia Chen, Noah Kim, Sophia Patel",
                    target_name=name,
                    person_cm_id=10000 + i,
                    confidence=0.90,
                    field_index=i,
                    total_in_field=len(names),
                )
            )

        results = builder.build_requests(resolved_requests)

        # Should NOT be flagged
        for req in results:
            assert req.metadata.get("over_generation_flagged") is not True

    def test_blanket_statement_creates_single_pending(self, builder: RequestBuilder) -> None:
        """Text without specific people names should create a single PENDING request, not N individual ones."""
        # Blanket statement: no specific names, but somehow resolved to multiple people
        resolved_requests = []
        names = ["Emma Johnson", "Liam Garcia", "Olivia Chen"]
        for i, name in enumerate(names):
            resolved_requests.append(
                self._make_resolved_request(
                    raw_text="wants to be with kids her age",  # No names mentioned
                    target_name=name,
                    person_cm_id=10000 + i,
                    field_index=i,
                    total_in_field=len(names),
                )
            )

        results = builder.build_requests(resolved_requests)

        # Should produce either 0 individual requests (blanket detected) or all flagged as PENDING
        blanket_flagged = [r for r in results if r.metadata.get("blanket_statement_flagged")]
        assert len(blanket_flagged) == len(results), (
            "All requests from blanket statements should be flagged for staff review"
        )
        for req in blanket_flagged:
            assert req.status == RequestStatus.PENDING

    def test_named_requests_not_flagged_as_blanket(self, builder: RequestBuilder) -> None:
        """Text that explicitly mentions names should NOT be flagged as a blanket statement."""
        resolved_requests = [
            self._make_resolved_request(
                raw_text="Emma Johnson and Liam Garcia",
                target_name="Emma Johnson",
                person_cm_id=10001,
                field_index=0,
                total_in_field=2,
            ),
            self._make_resolved_request(
                raw_text="Emma Johnson and Liam Garcia",
                target_name="Liam Garcia",
                person_cm_id=10002,
                field_index=1,
                total_in_field=2,
            ),
        ]

        results = builder.build_requests(resolved_requests)

        for req in results:
            assert req.metadata.get("blanket_statement_flagged") is not True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

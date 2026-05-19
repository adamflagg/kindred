"""Tests for services/request_builder.py

Tests the RequestBuilder class in services/ which handles:
- Building BunkRequest metadata from ParsedRequest
- AI reasoning storage (ai_p1_reasoning field)
- Status determination
"""

from __future__ import annotations

from typing import Any

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    ParsedRequest,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.request_builder import RequestBuilder


class TestRequestBuilderMetadata:
    """Tests for build_request_metadata method"""

    @pytest.fixture
    def builder(self) -> RequestBuilder:
        """Create a RequestBuilder with mocked dependencies"""
        return RequestBuilder(
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
    def builder(self) -> RequestBuilder:
        return RequestBuilder(
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="staff_not_bunk_with",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="staff_not_bunk_with",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )

        parsed_req = ParsedRequest(
            raw_text="Olivia Chen",
            request_type=RequestType.BUNK_WITH,
            target_name="Olivia Chen",
            age_preference=None,
            source_field="bunk_request_form",
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
            is_first_requested=True,
            confidence_score=0.95,
            source_field="bunk_request_form",
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
            is_first_requested=True,
            confidence_score=0.95,
            source_field="bunk_request_form",
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
            is_first_requested=True,
            confidence_score=0.95,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Emma Johnson",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Ivy Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Ivy Smith",
            age_preference=None,
            source_field="staff_not_bunk_with",
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
            temporal_name_cache=None,
            year=2026,
            auto_resolve_threshold=0.85,
        )
        parsed_req = ParsedRequest(
            raw_text="Sophia",
            request_type=RequestType.BUNK_WITH,
            target_name="Sophia",
            age_preference=None,
            source_field="bunk_request_form",
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


class TestBuildMetadataSourceFragment:
    """build_request_metadata should surface source_fragment from parsed_req.metadata."""

    @pytest.fixture
    def builder(self) -> RequestBuilder:
        return RequestBuilder(
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    def test_build_metadata_preserves_source_fragment(self, builder: RequestBuilder) -> None:
        """BR metadata should include source_fragment from parsed_req when ai_parsed=False (Phase 1 path)."""
        parsed_req = ParsedRequest(
            target_name="Emma",
            raw_text="wants to be with Emma from last year",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={
                "reasoning": "because emma",
                "source_fragment": "wants to be with Emma from last year",
            },
        )
        resolution_info: dict[str, Any] = {}
        ai_parsed = False

        metadata = builder.build_request_metadata(parsed_req, resolution_info, ai_parsed)

        assert metadata["source_fragment"] == "wants to be with Emma from last year"

    def test_build_metadata_source_fragment_empty_when_missing(self, builder: RequestBuilder) -> None:
        """If parsed_req.metadata has no source_fragment key, default to empty string."""
        parsed_req = ParsedRequest(
            target_name="Emma",
            raw_text="some text",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={"reasoning": "x"},  # no source_fragment key
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=False)

        assert metadata["source_fragment"] == ""

    def test_narrows_fragment_when_ai_copied_whole_comma_list(self, builder: RequestBuilder) -> None:
        """Comma-separated list + AI returned the whole list → narrow to just the target name."""
        parsed_req = ParsedRequest(
            target_name="Edo Firstenberg",
            raw_text="Sasha Doerig-Krugman, Edo Firstenberg, Dean Roitman",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={
                "source_fragment": "Sasha Doerig-Krugman, Edo Firstenberg, Dean Roitman",
            },
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=True)

        assert metadata["source_fragment"] == "Edo Firstenberg"

    def test_narrows_fragment_for_semicolon_list(self, builder: RequestBuilder) -> None:
        parsed_req = ParsedRequest(
            target_name="Elizabeth Gordon",
            raw_text="Miya Marks; Elizabeth Gordon; Roslyn Euser",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={"source_fragment": "Miya Marks; Elizabeth Gordon; Roslyn Euser"},
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=True)

        assert metadata["source_fragment"] == "Elizabeth Gordon"

    def test_keeps_ai_fragment_when_subset_of_source(self, builder: RequestBuilder) -> None:
        """AI returned a minimal fragment (not the whole list) → keep it as-is."""
        parsed_req = ParsedRequest(
            target_name="Jake",
            raw_text="wants Emma but NOT Jake - he bullied her",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="staff_not_bunk_with",
            csv_position=0,
            metadata={"source_fragment": "NOT Jake"},
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=True)

        assert metadata["source_fragment"] == "NOT Jake"

    def test_keeps_ai_fragment_for_single_name_input(self, builder: RequestBuilder) -> None:
        """Single-name input where fragment == raw_text is legitimate, not a bug — keep it."""
        parsed_req = ParsedRequest(
            target_name="Emma Wilson",
            raw_text="Emma Wilson",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={"source_fragment": "Emma Wilson"},
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=True)

        assert metadata["source_fragment"] == "Emma Wilson"

    def test_keeps_ai_fragment_when_target_not_in_text(self, builder: RequestBuilder) -> None:
        """Parenthetical case: target='Levi Weissenborn' not contiguous in 'Levi (Fern) Weissenborn'.
        We can't safely narrow → trust the AI's fragment even if it equals the whole input.
        """
        parsed_req = ParsedRequest(
            target_name="Levi Weissenborn",
            raw_text="Levi (Fern) Weissenborn, Nico Mosseri",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.9,
            source_field="bunk_request_form",
            csv_position=0,
            metadata={"source_fragment": "Levi (Fern) Weissenborn, Nico Mosseri"},
        )

        metadata = builder.build_request_metadata(parsed_req, {}, ai_parsed=True)

        # target_name not in raw_text contiguously → can't narrow → keep AI fragment as-is
        assert metadata["source_fragment"] == "Levi (Fern) Weissenborn, Nico Mosseri"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

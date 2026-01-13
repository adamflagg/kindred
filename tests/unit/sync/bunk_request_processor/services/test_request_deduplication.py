"""Test-Driven Development for AI Request Text Deduplication

Tests the deduplication logic that groups identical request texts,
parses them once, and clones results back to all requesters.
These tests are written BEFORE implementation per TDD methodology."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestType,
)


def create_parse_request(
    request_text: str,
    requester_cm_id: int = 12345,
    requester_name: str = "Test Person",
    field_name: str = "bunk_with",
    session_cm_id: int = 1000002,
) -> ParseRequest:
    """Helper to create a ParseRequest for testing."""
    return ParseRequest(
        request_text=request_text,
        field_name=field_name,
        requester_name=requester_name,
        requester_cm_id=requester_cm_id,
        requester_grade="5",
        session_cm_id=session_cm_id,
        session_name="Session 1",
        year=2025,
        row_data={},
    )


def create_parse_result(
    parse_request: ParseRequest,
    target_names: list[str] | None = None,
) -> ParseResult:
    """Helper to create a ParseResult for testing."""
    from bunking.sync.bunk_request_processor.core.models import RequestSource

    parsed_requests = []
    for idx, name in enumerate(target_names or ["John Smith"]):
        parsed_requests.append(
            ParsedRequest(
                raw_text=parse_request.request_text,
                request_type=RequestType.BUNK_WITH,
                target_name=name,
                age_preference=None,
                source_field=parse_request.field_name,
                source=RequestSource.FAMILY,
                confidence=0.9,
                csv_position=idx,
                metadata={},
            )
        )
    return ParseResult(
        parsed_requests=parsed_requests, is_valid=True, parse_request=parse_request, metadata={"source": "ai"}
    )


class TestRequestTextNormalization:
    """Test text normalization for deduplication matching"""

    def test_identical_texts_normalize_to_same_key(self):
        """Identical texts should produce the same normalized key"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            normalize_request_text,
        )

        text1 = "John Smith"
        text2 = "John Smith"

        assert normalize_request_text(text1) == normalize_request_text(text2)

    def test_case_insensitive_normalization(self):
        """Text should be case-insensitive for matching"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            normalize_request_text,
        )

        text1 = "John Smith"
        text2 = "john smith"
        text3 = "JOHN SMITH"

        key1 = normalize_request_text(text1)
        key2 = normalize_request_text(text2)
        key3 = normalize_request_text(text3)

        assert key1 == key2 == key3

    def test_whitespace_normalization(self):
        """Extra whitespace should be normalized"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            normalize_request_text,
        )

        text1 = "John Smith"
        text2 = "  John   Smith  "
        text3 = "John\tSmith"

        key1 = normalize_request_text(text1)
        key2 = normalize_request_text(text2)
        key3 = normalize_request_text(text3)

        assert key1 == key2 == key3

    def test_different_texts_have_different_keys(self):
        """Different texts should have different normalized keys"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            normalize_request_text,
        )

        text1 = "John Smith"
        text2 = "Jane Doe"

        assert normalize_request_text(text1) != normalize_request_text(text2)


class TestRequestGrouping:
    """Test grouping of ParseRequests by normalized text"""

    def test_group_identical_texts(self):
        """ParseRequests with identical texts should be grouped together"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            group_by_request_text,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("John Smith", requester_cm_id=1002),
            create_parse_request("John Smith", requester_cm_id=1003),
        ]

        groups = group_by_request_text(requests)

        # Should have 1 group with 3 requests
        assert len(groups) == 1
        group_key = list(groups.keys())[0]
        assert len(groups[group_key]) == 3

    def test_group_different_texts_separately(self):
        """ParseRequests with different texts should be in separate groups"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            group_by_request_text,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("Jane Doe", requester_cm_id=1002),
            create_parse_request("Bob Wilson", requester_cm_id=1003),
        ]

        groups = group_by_request_text(requests)

        # Should have 3 groups, each with 1 request
        assert len(groups) == 3
        for group in groups.values():
            assert len(group) == 1

    def test_group_case_insensitive(self):
        """Case variations should be grouped together"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            group_by_request_text,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("john smith", requester_cm_id=1002),
            create_parse_request("JOHN SMITH", requester_cm_id=1003),
        ]

        groups = group_by_request_text(requests)

        assert len(groups) == 1

    def test_empty_list_returns_empty_groups(self):
        """Empty request list should return empty groups"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            group_by_request_text,
        )

        groups = group_by_request_text([])

        assert groups == {}


class TestDeduplicatedParsing:
    """Test the deduplicated parsing workflow"""

    def test_select_representative_request(self):
        """Should select one representative request per group for AI parsing"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            get_representative_requests,
            group_by_request_text,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("John Smith", requester_cm_id=1002),
            create_parse_request("Jane Doe", requester_cm_id=1003),
            create_parse_request("Jane Doe", requester_cm_id=1004),
        ]

        groups = group_by_request_text(requests)
        representatives = get_representative_requests(groups)

        # Should have 2 representatives (one per unique text)
        assert len(representatives) == 2

    def test_clone_result_preserves_parsed_requests(self):
        """Cloned result should have same parsed_requests as original"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            clone_parse_result,
        )

        original_request = create_parse_request("John Smith", requester_cm_id=1001)
        original_result = create_parse_result(original_request, ["John Smith", "Johnny Smith"])

        new_request = create_parse_request("john smith", requester_cm_id=1002)
        cloned_result = clone_parse_result(original_result, new_request)

        # Should have same number of parsed requests
        assert len(cloned_result.parsed_requests) == len(original_result.parsed_requests)

        # Target names should be preserved
        assert cloned_result.parsed_requests[0].target_name == "John Smith"
        assert cloned_result.parsed_requests[1].target_name == "Johnny Smith"

    def test_clone_result_updates_parse_request(self):
        """Cloned result should have the new parse_request"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            clone_parse_result,
        )

        original_request = create_parse_request("John Smith", requester_cm_id=1001)
        original_result = create_parse_result(original_request)

        new_request = create_parse_request("john smith", requester_cm_id=1002)
        cloned_result = clone_parse_result(original_result, new_request)

        # parse_request should be the new one
        assert cloned_result.parse_request is not None
        assert cloned_result.parse_request.requester_cm_id == 1002

        # Original should be unchanged
        assert original_result.parse_request is not None
        assert original_result.parse_request.requester_cm_id == 1001

    def test_clone_result_deep_copies_parsed_requests(self):
        """Cloned parsed_requests should be independent copies"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            clone_parse_result,
        )

        original_request = create_parse_request("John Smith", requester_cm_id=1001)
        original_result = create_parse_result(original_request)

        new_request = create_parse_request("john smith", requester_cm_id=1002)
        cloned_result = clone_parse_result(original_result, new_request)

        # Modifying cloned should not affect original
        cloned_result.parsed_requests[0].confidence = 0.5
        assert original_result.parsed_requests[0].confidence == 0.9

    def test_clone_result_marks_as_deduplicated(self):
        """Cloned result should have metadata indicating it was deduplicated"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            clone_parse_result,
        )

        original_request = create_parse_request("John Smith", requester_cm_id=1001)
        original_result = create_parse_result(original_request)

        new_request = create_parse_request("john smith", requester_cm_id=1002)
        cloned_result = clone_parse_result(original_result, new_request)

        assert cloned_result.metadata.get("deduplicated") is True
        assert cloned_result.metadata.get("original_requester_cm_id") == 1001


class TestDeduplicationIntegration:
    """Integration tests for the full deduplication workflow"""

    def test_full_deduplication_workflow(self):
        """Test complete workflow: group, select representatives, parse, expand"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("John Smith", requester_cm_id=1002),
            create_parse_request("John Smith", requester_cm_id=1003),
            create_parse_request("Jane Doe", requester_cm_id=1004),
        ]

        deduplicator = RequestDeduplicator()

        # Step 1: Get unique requests for AI parsing
        unique_requests, mapping = deduplicator.deduplicate(requests)

        # Should only send 2 requests to AI (not 4)
        assert len(unique_requests) == 2

        # Mapping should track original requests
        assert sum(len(group) for group in mapping.values()) == 4

    def test_expand_results_to_all_requesters(self):
        """After parsing, results should be expanded to all original requesters"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("John Smith", requester_cm_id=1002),
            create_parse_request("Jane Doe", requester_cm_id=1003),
        ]

        deduplicator = RequestDeduplicator()
        unique_requests, mapping = deduplicator.deduplicate(requests)

        # Simulate AI parsing results for unique requests (as list of ParseResults)
        # Results are returned in the same order as unique_requests
        ai_results = [
            create_parse_result(unique_requests[0], ["John Smith"]),
            create_parse_result(unique_requests[1], ["Jane Doe"]),
        ]

        # Expand results back to all original requesters
        expanded_results = deduplicator.expand_results(ai_results, unique_requests, mapping)

        # Should have 3 results (one per original request)
        assert len(expanded_results) == 3

        # Each result should have the correct requester
        requester_ids = {r.parse_request.requester_cm_id for r in expanded_results if r.parse_request is not None}
        assert requester_ids == {1001, 1002, 1003}

    def test_stats_tracking(self):
        """Deduplicator should track deduplication statistics"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("John Smith", requester_cm_id=1002),
            create_parse_request("John Smith", requester_cm_id=1003),
            create_parse_request("Jane Doe", requester_cm_id=1004),
            create_parse_request("Jane Doe", requester_cm_id=1005),
        ]

        deduplicator = RequestDeduplicator()
        unique_requests, _ = deduplicator.deduplicate(requests)

        stats = deduplicator.get_stats()

        assert stats["total_requests"] == 5
        assert stats["unique_texts"] == 2
        assert stats["requests_saved"] == 3  # 5 - 2 = 3 AI calls saved


class TestEdgeCases:
    """Test edge cases and special scenarios"""

    def test_single_request_no_deduplication(self):
        """Single request should pass through unchanged"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [create_parse_request("John Smith", requester_cm_id=1001)]

        deduplicator = RequestDeduplicator()
        unique_requests, mapping = deduplicator.deduplicate(requests)

        assert len(unique_requests) == 1
        assert unique_requests[0] is requests[0]

    def test_all_unique_texts_no_savings(self):
        """When all texts are unique, no AI calls are saved"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001),
            create_parse_request("Jane Doe", requester_cm_id=1002),
            create_parse_request("Bob Wilson", requester_cm_id=1003),
        ]

        deduplicator = RequestDeduplicator()
        unique_requests, _ = deduplicator.deduplicate(requests)

        stats = deduplicator.get_stats()
        assert stats["requests_saved"] == 0

    def test_different_field_names_same_text(self):
        """Same text from different fields should still be deduplicated"""
        from bunking.sync.bunk_request_processor.services.request_deduplication import (
            RequestDeduplicator,
        )

        requests = [
            create_parse_request("John Smith", requester_cm_id=1001, field_name="bunk_with"),
            create_parse_request("John Smith", requester_cm_id=1002, field_name="bunking_notes"),
        ]

        deduplicator = RequestDeduplicator()
        unique_requests, _ = deduplicator.deduplicate(requests)

        # Text is the same, should deduplicate
        assert len(unique_requests) == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

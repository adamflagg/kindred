"""Tests for "no preference" detection in orchestrator.

Verifies that fields containing only "no preference" indicators are skipped
before AI parsing, avoiding unnecessary API calls.

Patterns to detect:
- "no bunk requests" / "no bunk request"
- "no preference"
- "none"
- "n/a"
- "na"

All patterns should be case-insensitive and match the ENTIRE field value."""

from __future__ import annotations

from unittest.mock import Mock

import pytest


class TestNoPreferenceDetection:
    """Test that 'no preference' indicators are detected and skipped."""

    def test_no_bunk_requests_singular_skipped(self):
        """'no bunk request' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no bunk request") is True

    def test_no_bunk_requests_plural_skipped(self):
        """'no bunk requests' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no bunk requests") is True

    def test_no_preference_skipped(self):
        """'no preference' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no preference") is True

    def test_none_skipped(self):
        """'none' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("none") is True

    def test_na_skipped(self):
        """'na' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("na") is True

    def test_n_a_skipped(self):
        """'n/a' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("n/a") is True

    def test_case_insensitive_matching(self):
        """No preference patterns should be case-insensitive."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Test various case combinations
        assert orchestrator._is_no_preference("NO BUNK REQUESTS") is True
        assert orchestrator._is_no_preference("No Preference") is True
        assert orchestrator._is_no_preference("NONE") is True
        assert orchestrator._is_no_preference("N/A") is True
        assert orchestrator._is_no_preference("NA") is True
        assert orchestrator._is_no_preference("No Bunk Request") is True

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace should be ignored."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("  none  ") is True
        assert orchestrator._is_no_preference("\tno preference\n") is True
        assert orchestrator._is_no_preference(" n/a ") is True

    def test_normal_requests_not_skipped(self):
        """Normal bunk requests should NOT be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Real bunk request names
        assert orchestrator._is_no_preference("John Smith") is False
        assert orchestrator._is_no_preference("Sarah Johnson, Mike Lee") is False
        assert orchestrator._is_no_preference("wants to bunk with Emma") is False

    def test_embedded_none_not_skipped(self):
        """'none' embedded in longer text should NOT be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # "none" appears but is not the entire value
        assert orchestrator._is_no_preference("None of the Smith kids") is False
        assert orchestrator._is_no_preference("Has none in mind yet, maybe later") is False
        assert orchestrator._is_no_preference("not with anyone") is False

    def test_partial_match_not_skipped(self):
        """Partial matches of patterns should NOT be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Patterns that contain the keywords but are not exact matches
        assert orchestrator._is_no_preference("no bunk requests - see notes") is False
        assert orchestrator._is_no_preference("no preference for older kids") is False
        assert orchestrator._is_no_preference("na - will update later") is False


class TestNoPreferenceIntegration:
    """Test that no-preference detection integrates with _prepare_parse_requests."""

    @pytest.mark.asyncio
    async def test_no_preference_field_not_sent_to_ai(self):
        """Fields with 'no preference' should not create ParseRequest objects."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions to allow processing
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "User",
                "share_bunk_with": "none",  # Should be skipped
                "do_not_share_bunk_with": "",
                "bunking_notes_notes": "",
                "internal_bunk_notes": "",
                "ret_parent_socialize_with_best": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # 'none' should result in NO ParseRequest objects
        assert len(parse_requests) == 0
        assert len(pre_parsed) == 0

    @pytest.mark.asyncio
    async def test_mixed_fields_only_valid_sent_to_ai(self):
        """Only non-'no preference' fields should be sent to AI."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "User",
                "share_bunk_with": "John Smith",  # Valid - should create ParseRequest
                "do_not_share_bunk_with": "n/a",  # Should be skipped
                "bunking_notes_notes": "no preference",  # Should be skipped
                "internal_bunk_notes": "Keep with Sarah",  # Valid - should create ParseRequest
                "ret_parent_socialize_with_best": "",  # Empty - naturally skipped
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # Should have exactly 2 ParseRequests (share_bunk_with and internal_bunk_notes)
        assert len(parse_requests) == 2

        # Verify the correct fields were included
        field_names = {pr.field_name for pr in parse_requests}
        assert "Share Bunk With" in field_names
        assert "Internal Bunk Notes" in field_names

        # Verify skipped fields are NOT present
        assert "Do Not Share Bunk With" not in field_names
        assert "BunkingNotes Notes" not in field_names

    @pytest.mark.asyncio
    async def test_stat_tracking_for_skipped_no_preference(self):
        """Orchestrator should track count of skipped 'no preference' fields."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "User",
                "share_bunk_with": "none",
                "do_not_share_bunk_with": "n/a",
                "bunking_notes_notes": "no preference",
                "internal_bunk_notes": "",
                "ret_parent_socialize_with_best": "",
            }
        ]

        await orchestrator._prepare_parse_requests(raw_requests)

        # Should track that 3 fields were skipped
        assert orchestrator._stats.get("no_preference_skipped", 0) == 3

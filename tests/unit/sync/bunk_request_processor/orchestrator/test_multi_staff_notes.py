"""Tests for multi-entry staff notes parsing.

Verifies that parse_multi_staff_notes() correctly handles notes with
multiple staff entries (one per line), each with their own signature.

Gap: Line 222 in MONOLITH_PARITY_TRACKER.md"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.services.staff_note_parser import (
    parse_multi_staff_notes,
)


class TestParseMultiStaffNotes:
    """Test parse_multi_staff_notes function behavior."""

    def test_single_entry_with_staff_signature(self):
        """Single line with staff signature should extract content and staff."""
        note = "Bunk with quiet smart girls CASEY THOMPSON (May 19 2025  5:38PM)"

        result = parse_multi_staff_notes(note)

        assert len(result) == 1
        assert result[0]["content"] == "Bunk with quiet smart girls"
        assert result[0]["staff"] == "Casey Thompson"
        assert result[0]["timestamp"] == "May 19 2025  5:38PM"

    def test_single_entry_no_signature(self):
        """Single line without staff signature returns content only."""
        note = "Bunk with age or older"

        result = parse_multi_staff_notes(note)

        assert len(result) == 1
        assert result[0]["content"] == "Bunk with age or older"
        assert result[0]["staff"] is None
        assert result[0]["timestamp"] is None

    def test_multi_entry_different_staff(self):
        """Multiple lines with different staff signatures."""
        note = (
            "bunking note: bunk with kids from 2021 not 2022 MORGAN CHEN (May  2 2023  1:35PM)\n"
            "was separated from majority of his friends in summer 2022 ALEX MARTINEZ (Oct  3 2022  1:40PM)"
        )

        result = parse_multi_staff_notes(note)

        assert len(result) == 2
        # First entry
        assert result[0]["content"] == "bunking note: bunk with kids from 2021 not 2022"
        assert result[0]["staff"] == "Morgan Chen"
        assert "May  2 2023" in result[0]["timestamp"]
        # Second entry
        assert result[1]["content"] == "was separated from majority of his friends in summer 2022"
        assert result[1]["staff"] == "Alex Martinez"
        assert "Oct  3 2022" in result[1]["timestamp"]

    def test_multi_entry_same_staff_different_dates(self):
        """Multiple lines from same staff on different dates."""
        # Regex now correctly handles "Alex T JORDAN RIVERS" by matching
        # exactly 2 uppercase words (FIRST LAST) before the timestamp
        note = (
            "Call - Sarah shared top priority is being in unit without Alex T JORDAN RIVERS (Jun 19 2025 11:43AM)\n"
            "Call Sarah to update about bunking closer to summer JORDAN RIVERS (Apr  7 2025 12:31PM)"
        )

        result = parse_multi_staff_notes(note)

        assert len(result) == 2
        assert result[0]["staff"] == "Jordan Rivers"
        assert result[1]["staff"] == "Jordan Rivers"
        assert "Jun 19 2025" in result[0]["timestamp"]
        assert "Apr  7 2025" in result[1]["timestamp"]
        # "Alex T" should remain in the content, not be captured as part of staff name
        assert "Alex T" in result[0]["content"]

    def test_empty_input(self):
        """Empty input returns empty list."""
        assert parse_multi_staff_notes("") == []
        assert parse_multi_staff_notes(None) == []

    def test_filters_non_name_words(self):
        """Filters out FALL, SPRING, SESSION, etc. from staff names."""
        # This tests the non_name_words filtering logic
        note = "Test note FALL SESSION I (Jan 1 2025 1:00PM)"

        result = parse_multi_staff_notes(note)

        # After filtering FALL, SESSION, I - no valid name words remain
        assert len(result) == 1
        assert result[0]["staff"] is None  # No valid staff name after filtering

    def test_content_join_pattern(self):
        """Verify content can be joined with | separator like monolith."""
        note = "First note content STAFF ONE (Jan 1 2025 1:00PM)\nSecond note content STAFF TWO (Jan 2 2025 2:00PM)"

        result = parse_multi_staff_notes(note)
        joined = " | ".join([n["content"] for n in result if n["content"]])

        assert joined == "First note content | Second note content"


class TestPrepareParseRequestsStaffNotes:
    """Test that _prepare_parse_requests uses multi-staff parsing for bunking_notes.

    This is the integration test verifying the method is wired correctly.
    """

    @pytest.fixture
    def orchestrator(self):
        """Create orchestrator instance for testing."""
        from unittest.mock import Mock

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orch = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])
        # Mock person-session mapping so requests aren't skipped
        orch._person_sessions = {12345: [1234567]}  # cm_id -> [session_cm_ids]
        return orch

    @pytest.mark.asyncio
    async def test_bunking_notes_multi_entry_cleaned(self, orchestrator):
        """Bunking notes with multiple staff entries should have all signatures removed
        and content joined with | separator.
        """
        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "Camper",
                "bunking_notes_notes": (
                    "Bunk with John Smith JORDAN RIVERS (May 1 2025 1:00PM)\n"
                    "Also wants Sarah Jones MORGAN CHEN (May 2 2025 2:00PM)"
                ),
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # Find the bunking_notes parse request
        bunking_reqs = [r for r in parse_requests if "BunkingNotes" in r.field_name]

        assert len(bunking_reqs) == 1
        # Content should have staff signatures removed and be joined
        assert "JORDAN RIVERS" not in bunking_reqs[0].request_text
        assert "MORGAN CHEN" not in bunking_reqs[0].request_text
        assert "Bunk with John Smith" in bunking_reqs[0].request_text
        assert "Also wants Sarah Jones" in bunking_reqs[0].request_text
        # Should be joined with |
        assert " | " in bunking_reqs[0].request_text

    @pytest.mark.asyncio
    async def test_internal_notes_no_staff_extraction(self, orchestrator):
        """Internal notes should NOT have staff extraction applied.
        (They don't have staff signatures in the data.)
        """
        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "Camper",
                "internal_bunk_notes": "Needs bottom bunk. Must be with twin.",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # Find the internal notes parse request
        internal_reqs = [r for r in parse_requests if "Internal" in r.field_name]

        assert len(internal_reqs) == 1
        # Content should be unchanged (no staff patterns to extract)
        assert internal_reqs[0].request_text == "Needs bottom bunk. Must be with twin."

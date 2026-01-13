"""Tests for staff metadata storage in bunk_requests.

Verifies that staff attribution (author and date) from bunking_notes
is stored in bunk_requests.metadata for frontend display.

The pattern being extracted:
"Note text STAFFNAME (Month DD YYYY H:MMAM/PM)"

Example:
"Do not bunk with Emma Johnson JORDAN RIVERS (May 30 2024 2:18PM)"
-> staff_name: "Jordan Rivers", staff_timestamp: "May 30 2024 2:18PM"
"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.services.staff_note_parser import (
    extract_content_and_staff_metadata,
    parse_multi_staff_notes,
)


class TestStaffMetadataExtraction:
    """Test staff metadata extraction functions."""

    def test_extract_single_staff_metadata(self):
        """Single entry should extract staff_name and timestamp."""
        note = "Do not bunk with Emma JORDAN RIVERS (May 30 2024 2:18PM)"

        content, metadata = extract_content_and_staff_metadata(note)

        assert content == "Do not bunk with Emma"
        assert metadata is not None
        assert metadata["staff_name"] == "Jordan Rivers"
        assert metadata["timestamp"] == "May 30 2024 2:18PM"

    def test_extract_multiple_staff_metadata_uses_most_recent(self):
        """Multiple staff entries should return the most recent (last) staff."""
        note = "First note STAFF ONE (Jan 1 2025 1:00PM)\nSecond note STAFF TWO (Jan 2 2025 2:00PM)"

        content, metadata = extract_content_and_staff_metadata(note)

        # Content should be joined
        assert "First note" in content
        assert "Second note" in content
        # Staff should be from the most recent entry (last in list)
        assert metadata is not None
        assert metadata["staff_name"] == "Staff Two"
        assert "Jan 2 2025" in metadata["timestamp"]

    def test_extract_no_staff_metadata(self):
        """Entry without staff signature returns None metadata."""
        note = "Plain note without staff signature"

        content, metadata = extract_content_and_staff_metadata(note)

        assert content == note
        assert metadata is None

    def test_extract_empty_input(self):
        """Empty input returns empty content and None metadata."""
        content, metadata = extract_content_and_staff_metadata("")
        assert content == ""
        assert metadata is None

        content, metadata = extract_content_and_staff_metadata(None)
        assert content == ""
        assert metadata is None


class TestParseMultiStaffNotesMetadata:
    """Test that parse_multi_staff_notes returns proper metadata."""

    def test_all_staff_entries_preserved(self):
        """All staff entries should be available for tracking."""
        note = (
            "First note STAFF ONE (Jan 1 2025 1:00PM)\n"
            "Second note STAFF TWO (Jan 2 2025 2:00PM)\n"
            "Third note STAFF THREE (Jan 3 2025 3:00PM)"
        )

        result = parse_multi_staff_notes(note)

        assert len(result) == 3
        staff_names = [r["staff"] for r in result if r["staff"]]
        assert "Staff One" in staff_names
        assert "Staff Two" in staff_names
        assert "Staff Three" in staff_names


class TestParseRequestStaffMetadata:
    """Test that ParseRequest can carry staff_metadata."""

    def test_parse_request_has_staff_metadata_field(self):
        """ParseRequest should accept staff_metadata parameter."""
        from bunking.sync.bunk_request_processor.core.models import ParseRequest

        staff_metadata = {
            "staff_name": "Jordan Rivers",
            "timestamp": "May 30 2024 2:18PM",
        }

        # This should not raise an error - staff_metadata is an optional field
        request = ParseRequest(
            request_text="Test request",
            field_name="bunking_notes_notes",
            requester_name="Test Camper",
            requester_cm_id=12345,
            requester_grade="5",
            session_cm_id=123456,
            session_name="Session 2",
            year=2025,
            row_data={},
            staff_metadata=staff_metadata,
        )

        assert request.staff_metadata == staff_metadata
        assert request.staff_metadata["staff_name"] == "Jordan Rivers"

    def test_parse_request_staff_metadata_defaults_to_none(self):
        """ParseRequest staff_metadata should default to None."""
        from bunking.sync.bunk_request_processor.core.models import ParseRequest

        request = ParseRequest(
            request_text="Test request",
            field_name="bunking_notes_notes",
            requester_name="Test Camper",
            requester_cm_id=12345,
            requester_grade="5",
            session_cm_id=123456,
            session_name="Session 2",
            year=2025,
            row_data={},
        )

        assert request.staff_metadata is None


class TestOrchestratorStaffMetadataFlow:
    """Test that orchestrator passes staff_metadata through to ParseRequest."""

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
        orch._person_sessions = {12345: [1234567]}
        return orch

    @pytest.mark.asyncio
    async def test_bunking_notes_staff_metadata_in_parse_request(self, orchestrator):
        """Staff metadata should be included in ParseRequest for bunking_notes."""
        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "Camper",
                "bunking_notes_notes": ("Do not bunk with Emma JORDAN RIVERS (May 30 2024 2:18PM)"),
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # Find the bunking_notes parse request
        bunking_reqs = [r for r in parse_requests if "BunkingNotes" in r.field_name]

        assert len(bunking_reqs) == 1
        req = bunking_reqs[0]

        # Staff metadata should be attached
        assert req.staff_metadata is not None
        assert req.staff_metadata["staff_name"] == "Jordan Rivers"
        assert "May 30 2024" in req.staff_metadata["timestamp"]

    @pytest.mark.asyncio
    async def test_internal_notes_no_staff_metadata(self, orchestrator):
        """Internal notes should NOT have staff_metadata (they don't have signatures)."""
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
        # Internal notes should have None staff_metadata
        assert internal_reqs[0].staff_metadata is None

    @pytest.mark.asyncio
    async def test_multi_staff_notes_uses_all_staff(self, orchestrator):
        """Multiple staff entries should have all_staff list in metadata."""
        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Test",
                "last_name": "Camper",
                "bunking_notes_notes": (
                    "First note STAFF ONE (Jan 1 2025 1:00PM)\nSecond note STAFF TWO (Jan 2 2025 2:00PM)"
                ),
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        bunking_reqs = [r for r in parse_requests if "BunkingNotes" in r.field_name]
        assert len(bunking_reqs) == 1

        req = bunking_reqs[0]
        assert req.staff_metadata is not None
        # Should have all_staff list
        assert "all_staff" in req.staff_metadata
        assert len(req.staff_metadata["all_staff"]) == 2

        # Most recent (last) staff should be the primary
        assert req.staff_metadata["staff_name"] == "Staff Two"


class TestContextBuilderStaffMetadata:
    """Test that ContextBuilder passes staff_metadata to AIRequestContext."""

    def test_staff_metadata_in_additional_context(self):
        """Staff metadata should be included in additional_context."""
        from bunking.sync.bunk_request_processor.services.context_builder import (
            ContextBuilder,
        )

        builder = ContextBuilder()

        staff_metadata = {
            "staff_name": "Jordan Rivers",
            "timestamp": "May 30 2024 2:18PM",
            "all_staff": [{"staff": "Jordan Rivers", "timestamp": "May 30 2024 2:18PM"}],
        }

        context = builder.build_parse_only_context(
            requester_name="Test Camper",
            requester_cm_id=12345,
            requester_grade="5",
            session_cm_id=123456,
            session_name="Session 2",
            year=2025,
            field_name="bunking_notes_notes",
            additional_data={"staff_metadata": staff_metadata},
        )

        assert "staff_metadata" in context.additional_context
        assert context.additional_context["staff_metadata"]["staff_name"] == "Jordan Rivers"

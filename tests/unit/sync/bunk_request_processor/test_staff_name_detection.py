"""Tests for staff name filter scoping in Phase 2 resolution service.

ADR-6: Staff name filter must only apply to the bunk_with field.
It should NOT filter names mentioned in free-form notes fields
(bunking_notes, internal_notes), where a counselor may legitimately
write something like "Spoke with Sarah (counselor)".
"""

from __future__ import annotations

from unittest.mock import MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    Phase2ResolutionService,
    ResolutionCase,
)
from bunking.sync.bunk_request_processor.shared.constants import SourceField


def _make_parse_request(
    requester_cm_id: int = 11111,
    session_cm_id: int = 1000002,
    year: int = 2025,
) -> ParseRequest:
    """Create a minimal ParseRequest for testing."""
    return ParseRequest(
        request_text="test",
        field_name="bunk_with",
        requester_name="Emma Johnson",
        requester_cm_id=requester_cm_id,
        requester_grade="5",
        session_cm_id=session_cm_id,
        session_name="Session 2",
        year=year,
        row_data={},
    )


def _make_parsed_request(
    target_name: str = "Jordan",
    source_field: str = SourceField.BUNK_WITH,
    request_type: RequestType = RequestType.BUNK_WITH,
) -> ParsedRequest:
    """Create a ParsedRequest with the given source_field and target_name."""
    return ParsedRequest(
        raw_text=f"bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field=source_field,
        source=RequestSource.FAMILY,
        confidence=1.0,
        csv_position=0,
        metadata={},
        group_kind=None,
    )


def _make_parse_result(
    parsed_request: ParsedRequest,
    parse_request: ParseRequest | None = None,
) -> ParseResult:
    """Wrap a ParsedRequest in a ParseResult."""
    if parse_request is None:
        parse_request = _make_parse_request()
    return ParseResult(
        parsed_requests=[parsed_request],
        is_valid=True,
        parse_request=parse_request,
    )


def _make_service_with_staff_filter(staff_name: str = "Jordan") -> Phase2ResolutionService:
    """Build a Phase2ResolutionService with a mock pipeline and a staff filter."""
    pipeline = MagicMock()
    # Return an unresolved result so the request reaches staff filter logic
    pipeline.batch_resolve = Mock(return_value=[])
    return Phase2ResolutionService(
        resolution_pipeline=pipeline,
        staff_name_filter=lambda name: name == staff_name,
    )


class TestStaffFilterScoping:
    """Staff name filter must only apply to bunk_with, not notes fields."""

    def test_staff_name_in_bunk_with_is_filtered(self):
        """A ParsedRequest with source_field=BUNK_WITH containing a staff name is staff-filtered."""
        service = _make_service_with_staff_filter(staff_name="Jordan")

        parsed_req = _make_parsed_request(
            target_name="Jordan",
            source_field=SourceField.BUNK_WITH,
        )
        parse_result = _make_parse_result(parsed_req)
        case = ResolutionCase(parse_result)

        service._resolve_batch([case])

        assert service._stats["staff_filtered"] == 1

    def test_staff_name_in_bunking_notes_not_filtered(self):
        """A ParsedRequest with source_field=BUNKING_NOTES containing a staff name is NOT filtered.

        A counselor may write "Spoke with Jordan (counselor)" in bunking_notes — this is
        legitimate free-form text and must not be erroneously flagged as a staff name match.
        """
        service = _make_service_with_staff_filter(staff_name="Jordan")

        parsed_req = _make_parsed_request(
            target_name="Jordan",
            source_field=SourceField.BUNKING_NOTES,
        )
        parse_result = _make_parse_result(parsed_req)
        case = ResolutionCase(parse_result)

        service._resolve_batch([case])

        assert service._stats["staff_filtered"] == 0

    def test_staff_name_in_internal_notes_not_filtered(self):
        """A ParsedRequest with source_field=INTERNAL_NOTES containing a staff name is NOT filtered.

        Internal notes are free-form staff commentary and must not trigger the staff filter,
        which is designed only to catch campers who requested bunking with a staff member.
        """
        service = _make_service_with_staff_filter(staff_name="Jordan")

        parsed_req = _make_parsed_request(
            target_name="Jordan",
            source_field=SourceField.INTERNAL_NOTES,
        )
        parse_result = _make_parse_result(parsed_req)
        case = ResolutionCase(parse_result)

        service._resolve_batch([case])

        assert service._stats["staff_filtered"] == 0

"""Tests for PII logging levels — camper names/IDs must only appear at DEBUG, not INFO.

Verifies fix for #787: Individual camper names and CampMinder IDs were logged at INFO level.
After the fix, INFO gets aggregate counts only; DEBUG gets the detailed PII.

Remaining affected modules after the group-expansion removal:
- phase2_resolution_service.py (staff name filter log)
- staff_name_detector.py (detected staff/parent names)

The resolver-family tests (sibling / bunkmate / classmate / congregation
resolvers, plus PlaceholderExpander) used to live here but were removed
alongside the deletion of bunking/.../services/group_resolvers.py and
services/placeholder_expander.py.
"""

import logging
from unittest.mock import MagicMock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseResult,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.staff_name_detector import StaffNameDetector


def _make_parsed_req(
    raw_text: str = "test request",
    request_type: RequestType = RequestType.BUNK_WITH,
    target_name: str | None = None,
) -> ParsedRequest:
    """Create a ParsedRequest with all required fields."""
    return ParsedRequest(
        raw_text=raw_text,
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="bunking_notes",
        confidence=1.0,
        csv_position=0,
        metadata={},
    )


class TestStaffNameDetectorPiiLogging:
    """StaffNameDetector.build_global_set must log names at DEBUG only."""

    def test_info_log_contains_count_only(self, caplog):
        """INFO log should contain count of detected names, not the names themselves."""
        detector = StaffNameDetector(staff_list_path=None)

        notes: list[str | None] = [
            "Sarah Smith called to discuss bunking preferences",
            "Mom spoke with us about cabin assignment",
        ]

        with caplog.at_level(logging.DEBUG):
            result = detector.build_global_set(notes)

        if not result:
            pytest.skip("No staff names detected from test notes")

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should mention count, NOT individual names
        detected_names = list(result)
        for name in detected_names:
            assert not any(name in msg for msg in info_messages), f"Name '{name}' found in INFO log"

        # DEBUG should contain the detailed names
        assert any(any(name in msg for name in detected_names) for msg in debug_messages)


class TestPhase2ResolutionStaffFilterPiiLogging:
    """Phase 2 resolution service should log filtered staff names at DEBUG only."""

    @pytest.mark.asyncio
    async def test_staff_name_filter_log_is_debug(self, caplog):
        """Filtered staff name should appear in DEBUG, not INFO."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = MagicMock()
        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            staff_name_filter=lambda name: name == "Jordan",
        )

        parsed_req = _make_parsed_req(
            raw_text="bunk with Jordan",
            target_name="Jordan",
        )

        parse_request = MagicMock()
        parse_request.requester_cm_id = 1001
        parse_request.session_cm_id = 5001
        parse_request.year = 2025

        parse_result = ParseResult(
            parsed_requests=[parsed_req],
            needs_historical_context=False,
            is_valid=True,
            parse_request=parse_request,
        )

        with caplog.at_level(logging.DEBUG):
            await service.batch_resolve([parse_result])

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should NOT contain the filtered staff name
        assert not any("Jordan" in msg for msg in info_messages)

        # DEBUG should contain the filtered staff name
        assert any("Jordan" in msg for msg in debug_messages)

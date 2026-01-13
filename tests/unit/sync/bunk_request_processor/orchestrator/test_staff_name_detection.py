"""Tests for staff name detection integration in orchestrator.

Verifies that:
1. Staff names are detected early in process_requests() before Phase 1
2. detected_staff_names set is built from all bunking_notes and internal_notes
3. The set is used for filtering during resolution (tested elsewhere)"""

from __future__ import annotations

from typing import Any, cast
from unittest.mock import Mock, patch


class TestOrchestratorStaffNameDetection:
    """Test staff name detection integration in orchestrator."""

    def test_staff_name_detector_initialized(self):
        """StaffNameDetector should be initialized during orchestrator init."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert hasattr(orchestrator, "staff_name_detector")
        assert orchestrator.staff_name_detector is not None

    def test_detect_staff_names_from_raw_requests(self):
        """_detect_staff_names should extract names from notes fields."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        raw_requests = [
            {
                "bunking_notes_notes": "Mom called about bunking",
                "internal_bunk_notes": "Per Jordan, this is okay",
            },
            {
                "bunking_notes_notes": "",
                "internal_bunk_notes": "Dad mentioned preference",
            },
            {
                "bunking_notes_notes": "According to Lisa, put together",
                "internal_bunk_notes": "",
            },
        ]

        orchestrator._detect_staff_names(raw_requests)

        assert "Mom" in orchestrator.staff_name_detector.detected_staff_names
        assert "Jordan" in orchestrator.staff_name_detector.detected_staff_names
        assert "Dad" in orchestrator.staff_name_detector.detected_staff_names
        assert "Lisa" in orchestrator.staff_name_detector.detected_staff_names

    def test_detect_staff_names_empty_notes(self):
        """_detect_staff_names handles empty notes gracefully."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        raw_requests: list[dict[str, Any]] = [
            {"bunking_notes_notes": "", "internal_bunk_notes": ""},
            {"bunking_notes_notes": None, "internal_bunk_notes": None},
        ]

        orchestrator._detect_staff_names(raw_requests)

        assert orchestrator.staff_name_detector.detected_staff_names == set()

    def test_is_staff_name_check(self):
        """is_staff_name returns True for detected names."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        raw_requests = [{"bunking_notes_notes": "Per Jordan, bunk Sarah with Emily", "internal_bunk_notes": ""}]

        orchestrator._detect_staff_names(raw_requests)

        # Jordan is staff, should be filtered
        assert orchestrator.is_staff_name("Jordan") is True
        # Sarah is a camper name, should not be filtered
        assert orchestrator.is_staff_name("Sarah") is False
        # Emily is a camper name, should not be filtered
        assert orchestrator.is_staff_name("Emily") is False

    def test_detect_staff_names_logs_detected(self):
        """Detection should log the detected names."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        raw_requests = [{"bunking_notes_notes": "Mom called", "internal_bunk_notes": "Per Jordan, okay"}]

        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.logger") as mock_logger:
            orchestrator._detect_staff_names(raw_requests)

            # Should log that staff names were detected
            log_calls = [str(call) for call in mock_logger.info.call_args_list]
            assert any("staff" in call.lower() for call in log_calls)

    def test_likely_staff_flag_in_resolution_info(self):
        """Staff-filtered requests should have likely_staff flag in resolution_info."""
        from bunking.sync.bunk_request_processor.core.models import RequestType
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import (
            ResolutionResult,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Set up detected staff names
        orchestrator.staff_name_detector.detected_staff_names = {"Jordan"}

        # Create a staff-filtered resolution result
        staff_filtered_result = ResolutionResult(
            person=None, confidence=0.0, method="staff_filtered", metadata={"filtered_name": "Jordan"}
        )

        # Create parse result with staff name target
        parse_request = Mock()
        parse_request.requester_cm_id = 12345
        parse_request.requester_name = "Test Camper"
        parse_request.session_cm_id = 1

        parsed_request = Mock()
        parsed_request.target_name = "Jordan"
        parsed_request.request_type = RequestType.BUNK_WITH

        parse_result = Mock()
        parse_result.is_valid = True
        parse_result.parsed_requests = [parsed_request]
        parse_result.parse_request = parse_request

        # Test the _prepare_for_conflict_detection method
        resolution_results = [(parse_result, [staff_filtered_result])]
        prepared = orchestrator._prepare_for_conflict_detection(cast(Any, resolution_results))

        assert len(prepared) == 1
        _, resolution_info = prepared[0]

        # Check likely_staff flag is set (triggers PENDING status)
        assert resolution_info.get("likely_staff") is True
        assert resolution_info.get("resolution_method") == "staff_filtered"

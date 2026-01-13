"""Test structural validation logging for requests without target_name.

TDD Red Phase: This test verifies that the orchestrator logs a warning
when skipping BUNK_WITH/NOT_BUNK_WITH requests that have no target_name.

    if parsed.request_type in ['bunk_with', 'not_bunk_with'] and not parsed.target_name:
        logger.warning(f"Invalid {parsed.request_type} request without target name from {parsed.source_field} - skipping")"""

from __future__ import annotations

import logging
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import (
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator


class TestStructuralValidationLogging:
    """Test that requests without target_name are logged when skipped."""

    def test_logs_warning_when_skipping_bunk_with_without_target_name(self, caplog):
        """Verify warning is logged when BUNK_WITH request has no target_name.

        Matches monolith behavior: logger.warning() with request_type and source_field context.
        """
        # Arrange
        orchestrator = Mock(spec=RequestOrchestrator)
        orchestrator._prepare_for_conflict_detection = RequestOrchestrator._prepare_for_conflict_detection.__get__(
            orchestrator
        )

        # Create a ParsedRequest with BUNK_WITH type but no target_name
        parsed_req = Mock()
        parsed_req.request_type = RequestType.BUNK_WITH
        parsed_req.target_name = None  # No target name - should trigger warning
        parsed_req.source_field = "share_bunk_with"

        # Create ParseRequest for context
        parse_request = Mock()
        parse_request.requester_cm_id = 12345
        parse_request.requester_name = "Test Requester"
        parse_request.session_cm_id = 1234567

        # Create ParseResult containing the request
        parse_result = Mock()
        parse_result.is_valid = True
        parse_result.parsed_requests = [parsed_req]
        parse_result.parse_request = parse_request

        # Create empty resolution result (unresolved)
        resolution_result = Mock()
        resolution_result.is_resolved = False
        resolution_result.person = None
        resolution_result.confidence = 0.0

        resolution_results = [(parse_result, [resolution_result])]

        # Act
        with caplog.at_level(logging.WARNING):
            result = orchestrator._prepare_for_conflict_detection(resolution_results)

        # Assert - request should be skipped (not in result)
        assert len(result) == 0, "Request without target_name should be skipped"

        # Assert - warning should be logged with context
        warning_logs = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warning_logs) >= 1, "Expected at least one warning log"

        log_message = warning_logs[0].message
        assert "bunk_with" in log_message.lower() or "BUNK_WITH" in log_message, (
            f"Warning should mention request_type, got: {log_message}"
        )
        assert "share_bunk_with" in log_message.lower(), f"Warning should mention source_field, got: {log_message}"

    def test_logs_warning_when_skipping_not_bunk_with_without_target_name(self, caplog):
        """Verify warning is logged when NOT_BUNK_WITH request has no target_name."""
        # Arrange
        orchestrator = Mock(spec=RequestOrchestrator)
        orchestrator._prepare_for_conflict_detection = RequestOrchestrator._prepare_for_conflict_detection.__get__(
            orchestrator
        )

        parsed_req = Mock()
        parsed_req.request_type = RequestType.NOT_BUNK_WITH
        parsed_req.target_name = None
        parsed_req.source_field = "do_not_share_with"

        parse_request = Mock()
        parse_request.requester_cm_id = 12345
        parse_request.requester_name = "Test Requester"
        parse_request.session_cm_id = 1234567

        parse_result = Mock()
        parse_result.is_valid = True
        parse_result.parsed_requests = [parsed_req]
        parse_result.parse_request = parse_request

        resolution_result = Mock()
        resolution_result.is_resolved = False
        resolution_result.person = None
        resolution_result.confidence = 0.0

        resolution_results = [(parse_result, [resolution_result])]

        # Act
        with caplog.at_level(logging.WARNING):
            result = orchestrator._prepare_for_conflict_detection(resolution_results)

        # Assert
        assert len(result) == 0

        warning_logs = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warning_logs) >= 1, "Expected warning log for NOT_BUNK_WITH without target"

        log_message = warning_logs[0].message
        assert "not_bunk_with" in log_message.lower() or "NOT_BUNK_WITH" in log_message

    def test_no_warning_for_age_preference_without_target_name(self, caplog):
        """AGE_PREFERENCE requests don't need target_name - no warning expected."""
        # Arrange
        orchestrator = Mock(spec=RequestOrchestrator)
        orchestrator._prepare_for_conflict_detection = RequestOrchestrator._prepare_for_conflict_detection.__get__(
            orchestrator
        )

        parsed_req = Mock()
        parsed_req.request_type = RequestType.AGE_PREFERENCE
        parsed_req.target_name = None  # Age preferences don't need target_name
        parsed_req.source_field = "socialize_with"

        parse_request = Mock()
        parse_request.requester_cm_id = 12345
        parse_request.requester_name = "Test Requester"
        parse_request.session_cm_id = 1234567

        parse_result = Mock()
        parse_result.is_valid = True
        parse_result.parsed_requests = [parsed_req]
        parse_result.parse_request = parse_request

        resolution_result = Mock()
        resolution_result.is_resolved = False
        resolution_result.person = None
        resolution_result.confidence = 0.0

        resolution_results = [(parse_result, [resolution_result])]

        # Act
        with caplog.at_level(logging.WARNING):
            result = orchestrator._prepare_for_conflict_detection(resolution_results)

        # Assert - AGE_PREFERENCE should NOT be skipped
        assert len(result) == 1, "AGE_PREFERENCE should not be skipped"

        # Assert - no warning for AGE_PREFERENCE
        warning_logs = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warning_logs) == 0, "No warning expected for AGE_PREFERENCE without target_name"

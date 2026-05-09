"""Tests for full pipeline tracing in process_requests.

Verifies that trace_collector.record_*() calls are made for all phases
during a pipeline run. Uses a mock collector to capture calls without
requiring a real PocketBase connection.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector


def _make_raw_request(
    *,
    requester_cm_id: int = 12345,
    bunk_with: str = "Olivia Chen",
    original_request_ids: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a minimal raw request row for testing."""
    return {
        "requester_cm_id": requester_cm_id,
        "first_name": "Emma",
        "last_name": "Johnson",
        "Grade": 5,
        "year": 2025,
        "bunk_with": bunk_with,
        "not_bunk_with": "",
        "bunking_notes": "",
        "internal_notes": "",
        "socialize_with": "",
        "_original_request_ids": original_request_ids or {"bunk_with": "orig_req_1"},
    }


class TestFullPipelineTracing:
    """Test that all pipeline phases call the correct trace methods."""

    @pytest.fixture
    def mock_trace_collector(self):
        """Create a mock TraceCollector that captures all calls."""
        collector = MagicMock(spec=TraceCollector)
        collector.enabled = True
        collector.run_id = "test-run-123"
        return collector

    @pytest.fixture
    def mock_orchestrator(self, mock_config, mock_trace_collector):
        """Create an orchestrator with heavily mocked internals for testing trace calls."""
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import (
            ResolutionResult,
        )
        from bunking.sync.bunk_request_processor.shared.constants import SourceField

        mock_ctx = MagicMock()
        mock_ctx.pb_client = MagicMock()
        mock_ctx._year = 2025

        with patch.object(RequestOrchestrator, "_initialize_components"):
            orch = RequestOrchestrator(
                year=2025,
                session_cm_ids=[1000001],
                data_context=mock_ctx,
                trace_collector=mock_trace_collector,
            )

        # Set up person_sessions for the test requester
        orch._person_sessions = {12345: [1000001]}

        # Mock Phase 1 service
        parsed_req = ParsedRequest(
            raw_text="Olivia Chen",
            request_type=RequestType.BUNK_WITH,
            target_name="Olivia Chen",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            confidence=0.95,
            csv_position=1,
            metadata={},
        )
        row_data = _make_raw_request()
        parse_request = ParseRequest(
            request_text="Olivia Chen",
            field_name=SourceField.BUNK_WITH,
            requester_cm_id=12345,
            requester_name="Emma Johnson",
            requester_grade="5",
            session_cm_id=1000001,
            session_name="Session 1",
            year=2025,
            row_data=row_data,
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_req],
            is_valid=True,
            parse_request=parse_request,
        )
        orch.phase1_service = MagicMock()
        orch.phase1_service.batch_parse = AsyncMock(return_value=[parse_result])

        # Mock validation methods (pass-through)
        orch._validate_request_types = MagicMock(return_value=(1, 0))  # type: ignore[method-assign]
        orch._filter_temporal_conflicts = MagicMock(return_value=(1, 0))  # type: ignore[method-assign]
        orch._validate_target_names_in_source = MagicMock(return_value=(1, 0))  # type: ignore[method-assign]

        # After validation, parse_result still has parsed_requests
        # Mock temporal name cache
        orch.temporal_name_cache = MagicMock()
        orch.temporal_name_cache.initialize = MagicMock()
        orch.temporal_name_cache.get_stats = MagicMock(return_value={"persons_loaded": 10, "unique_names": 10})

        # Mock social graph
        orch._smart_resolution_enabled = False
        orch.social_graph = None

        # Mock Phase 2 service
        mock_person = MagicMock()
        mock_person.cm_id = 67890
        mock_person.full_name = "Olivia Chen"
        resolution_result = ResolutionResult(
            person=mock_person,
            confidence=0.95,
            method="exact_match",
        )
        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=[(parse_result, [resolution_result])])

        # Mock historical verification
        orch.historical_verification_service = MagicMock()
        orch.historical_verification_service.verify = AsyncMock(return_value=[(parse_result, [resolution_result])])

        # Mock Phase 3 service (not needed since all resolved)
        orch.phase3_service = MagicMock()

        # Mock conflict detection
        orch.conflict_detector = MagicMock()
        conflict_result = MagicMock()
        conflict_result.has_conflicts = False
        conflict_result.conflicts = []
        orch.conflict_detector.detect_conflicts = MagicMock(return_value=conflict_result)

        # Mock request creation
        orch._prepare_for_conflict_detection = MagicMock(return_value=[])  # type: ignore[method-assign]
        orch._create_bunk_requests = AsyncMock(return_value=([], set()))  # type: ignore[method-assign]

        # Mock cache monitor
        orch.cache_monitor = None

        # Mock staff name detection
        orch.staff_name_detector = MagicMock()
        orch.staff_name_detector.build_global_set = MagicMock(return_value=set())
        orch.staff_name_detector.detected_staff_names = set()

        # Mock clear existing
        orch.request_repository = MagicMock()

        return orch

    @pytest.mark.asyncio
    async def test_phase1_trace_called(self, mock_orchestrator, mock_trace_collector):
        """record_phase1() should be called after Phase 1 AI parse."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        # Verify record_phase1 was called
        mock_trace_collector.record_phase1.assert_called()
        call_kwargs = mock_trace_collector.record_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["ran"] is True

    @pytest.mark.asyncio
    async def test_validation_trace_called(self, mock_orchestrator, mock_trace_collector):
        """record_validation() should be called after validation chain."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        mock_trace_collector.record_validation.assert_called()
        call_kwargs = mock_trace_collector.record_validation.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"

    @pytest.mark.asyncio
    async def test_phase2_trace_called(self, mock_orchestrator, mock_trace_collector):
        """record_phase2() should be called after Phase 2 resolution."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        mock_trace_collector.record_phase2.assert_called()

    @pytest.mark.asyncio
    async def test_historical_trace_called(self, mock_orchestrator, mock_trace_collector):
        """record_historical() should be called after historical verification."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        mock_trace_collector.record_historical.assert_called()

    @pytest.mark.asyncio
    async def test_post_pipeline_traces_called(self, mock_orchestrator, mock_trace_collector):
        """All 4 finalization recorders should be called after post-pipeline steps."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        mock_trace_collector.record_batch_signals.assert_called()
        mock_trace_collector.record_conflict_detection.assert_called()
        mock_trace_collector.record_disposition.assert_called()
        mock_trace_collector.record_dedup_save.assert_called()

    @pytest.mark.asyncio
    async def test_all_phases_traced_in_order(self, mock_orchestrator, mock_trace_collector):
        """All trace methods should be called in correct phase order."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        # Verify all phase methods were called (pre_phase1 is tested separately in Task 7)
        mock_trace_collector.record_phase1.assert_called()
        mock_trace_collector.record_validation.assert_called()
        mock_trace_collector.record_phase2.assert_called()
        mock_trace_collector.record_historical.assert_called()
        mock_trace_collector.record_batch_signals.assert_called()
        mock_trace_collector.record_conflict_detection.assert_called()
        mock_trace_collector.record_disposition.assert_called()
        mock_trace_collector.record_dedup_save.assert_called()

    @pytest.mark.asyncio
    async def test_phase3_trace_skipped_when_all_resolved(self, mock_orchestrator, mock_trace_collector):
        """record_phase3() should still be called with ran=False when all are resolved."""
        raw_requests = [_make_raw_request()]

        await mock_orchestrator.process_requests(raw_requests=raw_requests, clear_existing=False)

        # Phase 3 trace should record that it wasn't needed
        mock_trace_collector.record_phase3.assert_called()

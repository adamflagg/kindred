"""Tests for PhaseRunner stop_at_phase capability."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from bunking.sync.bunk_request_processor.debug.phase_runner import PhaseRunner


class TestStopAtPhase:
    @pytest.mark.anyio
    async def test_stop_at_phase1_skips_phase2(self):
        """run_full_trace delegates stop_at_phase='phase1' to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "phase": "phase1"})
        runner = PhaseRunner(orch)
        result = await runner.run_full_trace([], dry_run=True, stop_at_phase="phase1")
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=[], stop_at_phase="phase1", dry_run=True
        )
        assert result["dry_run"] is True

    @pytest.mark.anyio
    async def test_stop_at_none_runs_all_phases(self):
        """run_full_trace delegates stop_at_phase=None to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "success": True})
        runner = PhaseRunner(orch)
        result = await runner.run_full_trace([], dry_run=True, stop_at_phase=None)
        orch.process_from_parse_requests.assert_called_once_with(parse_requests=[], stop_at_phase=None, dry_run=True)
        assert result["dry_run"] is True

    @pytest.mark.anyio
    async def test_stop_at_none_runs_all_phases_with_data(self):
        """run_full_trace passes parse_requests through to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "success": True})
        runner = PhaseRunner(orch)
        mock_requests = [MagicMock(), MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase=None)
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=mock_requests, stop_at_phase=None, dry_run=True
        )

    @pytest.mark.anyio
    async def test_stop_at_phase_before_start_raises_error(self):
        """run_from_phase should raise ValueError when stop_at_phase is before start phase."""
        orch = MagicMock()
        runner = PhaseRunner(orch)
        with pytest.raises(ValueError, match="before start phase"):
            await runner.run_from_phase("phase2", stop_at_phase="phase1")

    @pytest.mark.anyio
    async def test_stop_at_phase2_runs_phase1_and_phase2(self):
        """run_full_trace delegates stop_at_phase='phase2' to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "phase": "phase2"})
        runner = PhaseRunner(orch)
        mock_requests = [MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase="phase2")
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=mock_requests, stop_at_phase="phase2", dry_run=True
        )

    @pytest.mark.anyio
    async def test_stop_at_phase1_result_has_phase1_only(self):
        """run_full_trace returns whatever process_from_parse_requests returns."""
        orch = MagicMock()
        expected = {"dry_run": True, "phase": "phase1"}
        orch.process_from_parse_requests = AsyncMock(return_value=expected)
        runner = PhaseRunner(orch)
        result = await runner.run_full_trace([MagicMock()], dry_run=True, stop_at_phase="phase1")
        assert result is expected

    @pytest.mark.anyio
    async def test_run_from_phase2_with_stop_at_phase2(self):
        """run_from_phase starting at phase2 with stop_at_phase='phase2' should skip phase3."""
        orch = MagicMock()
        # Phase 2 returns ambiguous result that would normally cascade to phase3
        mock_rr = MagicMock()
        mock_rr.is_resolved = False
        mock_pr = MagicMock()
        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=[(mock_pr, [mock_rr])])
        orch.phase3_service = MagicMock()
        orch.phase3_service.batch_disambiguate = AsyncMock(return_value=[])
        orch.temporal_name_cache = MagicMock()
        orch.temporal_name_cache.is_initialized = MagicMock(return_value=True)

        runner = PhaseRunner(orch)

        from bunking.sync.bunk_request_processor.debug.trace_models import (
            Phase1Trace,
            PrePhase1Trace,
            TraceData,
        )

        trace_data = TraceData(
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma"),
            phase1_parse=Phase1Trace(
                ran=True,
                parsed_intents=[{"target_name": "Emma", "request_type": "BUNK_WITH", "confidence": 0.95}],
                is_valid=True,
            ),
        )

        await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True, stop_at_phase="phase2")

        orch.phase2_service.batch_resolve.assert_called_once()
        orch.phase3_service.batch_disambiguate.assert_not_called()

    @pytest.mark.anyio
    async def test_stop_at_pre_phase1_returns_immediately(self):
        """run_full_trace delegates stop_at_phase='pre_phase1' to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True})
        runner = PhaseRunner(orch)
        result = await runner.run_full_trace([], dry_run=True, stop_at_phase="pre_phase1")
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=[], stop_at_phase="pre_phase1", dry_run=True
        )
        assert result["dry_run"] is True

    @pytest.mark.anyio
    async def test_stop_at_validation_runs_phase1_only(self):
        """run_full_trace delegates stop_at_phase='validation' to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "phase": "validation"})
        runner = PhaseRunner(orch)
        mock_requests = [MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase="validation")  # type: ignore[arg-type]
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=mock_requests, stop_at_phase="validation", dry_run=True
        )

    @pytest.mark.anyio
    async def test_stop_at_expansion_runs_phase1_and_phase2(self):
        """run_full_trace delegates stop_at_phase='expansion' to process_from_parse_requests."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True, "phase": "expansion"})
        runner = PhaseRunner(orch)
        mock_requests = [MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase="expansion")  # type: ignore[arg-type]
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=mock_requests, stop_at_phase="expansion", dry_run=True
        )

    @pytest.mark.anyio
    async def test_stop_at_phase3_skips_production_write(self):
        """run_full_trace delegates stop_at_phase='phase3' with dry_run=False through."""
        orch = MagicMock()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": False, "phase": "phase3"})
        runner = PhaseRunner(orch)
        await runner.run_full_trace([], dry_run=False, stop_at_phase="phase3")
        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=[], stop_at_phase="phase3", dry_run=False
        )

    @pytest.mark.anyio
    async def test_stop_at_same_as_start_runs_only_that_phase(self):
        """run_from_phase with stop_at_phase == start phase runs only that phase."""
        orch = MagicMock()
        orch.phase3_service = MagicMock()
        orch.phase3_service.batch_disambiguate = AsyncMock(return_value=[])

        runner = PhaseRunner(orch)

        from bunking.sync.bunk_request_processor.debug.trace_models import (
            Phase1Trace,
            Phase2FinalResult,
            Phase2IntentTrace,
            PrePhase1Trace,
            TraceData,
        )

        trace_data = TraceData(
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma"),
            phase1_parse=Phase1Trace(
                ran=True,
                parsed_intents=[{"target_name": "Emma Johnson", "request_type": "BUNK_WITH", "confidence": 0.5}],
                is_valid=True,
            ),
            phase2_resolution=[
                Phase2IntentTrace(
                    target_name="Emma Johnson",
                    final_result=Phase2FinalResult(is_resolved=False, is_ambiguous=True, confidence=0.5),
                )
            ],
        )

        result = await runner.run_from_phase("phase3", trace_data=trace_data, dry_run=True, stop_at_phase="phase3")

        orch.phase3_service.batch_disambiguate.assert_called_once()
        assert result["dry_run"] is True

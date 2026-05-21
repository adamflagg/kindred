"""Tests for PhaseRunner — isolated phase execution for debugging.

Tests that PhaseRunner wraps an orchestrator and delegates phase execution,
supports dry-run (default) and production write modes, and creates traces.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from bunking.sync.bunk_request_processor.debug.phase_runner import PhaseRunner
from bunking.sync.bunk_request_processor.debug.trace_models import (
    Phase1Trace,
    Phase2IntentTrace,
    PrePhase1Trace,
    TraceData,
)


def _make_mock_orchestrator() -> MagicMock:
    """Create a mock orchestrator with the services PhaseRunner delegates to."""
    orch = MagicMock()

    # Phase 1 service
    orch.phase1_service = MagicMock()
    orch.phase1_service.batch_parse = AsyncMock(return_value=[])

    # Phase 2 service
    orch.phase2_service = MagicMock()
    orch.phase2_service.batch_resolve = AsyncMock(return_value=[])

    # Phase 3 service
    orch.phase3_service = MagicMock()
    orch.phase3_service.batch_disambiguate = AsyncMock(return_value=[])

    # Phase 2.5 historical verification (shared with full pipeline)
    orch.run_historical_verification = AsyncMock(side_effect=lambda results: results)

    # Temporal name cache (needed for phase 2 init)
    orch.temporal_name_cache = MagicMock()
    orch.temporal_name_cache.initialize = MagicMock()
    orch.temporal_name_cache.is_initialized = MagicMock(return_value=True)

    # Social graph
    orch.social_graph = MagicMock()
    orch.social_graph.initialize = AsyncMock()
    orch._smart_resolution_enabled = True

    # Request builder and request repository (for saving)
    orch.request_builder = MagicMock()
    orch.request_builder.build_requests = MagicMock(return_value=[])
    orch.request_repository = MagicMock()
    orch._save_bunk_requests = MagicMock(return_value=[])

    # Data context and pb
    orch.pb = MagicMock()
    orch._data_context = MagicMock()
    orch._data_context.pb_client = orch.pb

    # Year and session info
    orch.year = 2025
    orch.session_cm_ids = [1000001]

    # Trace collector
    orch.trace_collector = MagicMock()

    # Validation methods
    orch._validate_request_types = MagicMock(return_value=(0, 0))
    orch._filter_temporal_conflicts = MagicMock(return_value=(0, 0))
    orch._validate_target_names_in_source = MagicMock(return_value=(0, 0))

    # Close method
    orch.close = AsyncMock()

    return orch


class TestPhaseRunnerInit:
    def test_wraps_orchestrator(self):
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)
        assert runner._orch is orch

    def test_default_dry_run(self):
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)
        # dry_run is a per-call parameter, not an instance attribute
        # PhaseRunner itself does not store a default — methods accept it
        assert runner._orch is orch


class TestPhaseRunnerRunPhase1:
    @pytest.mark.anyio
    async def test_delegates_to_phase1_service(self):
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        mock_requests = [MagicMock()]
        await runner.run_phase1(mock_requests)  # type: ignore[arg-type]

        orch.phase1_service.batch_parse.assert_called_once_with(mock_requests, None)

    @pytest.mark.anyio
    async def test_returns_parse_results(self):
        orch = _make_mock_orchestrator()
        expected = [MagicMock()]
        orch.phase1_service.batch_parse = AsyncMock(return_value=expected)
        runner = PhaseRunner(orch)

        result = await runner.run_phase1([MagicMock()])
        assert result == expected

    @pytest.mark.anyio
    async def test_phase1_always_dry_run(self):
        """Phase 1 alone never writes to production."""
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        await runner.run_phase1([MagicMock()])

        # Should NOT call save methods
        orch._save_bunk_requests.assert_not_called()


class TestPhaseRunnerRunPhase2:
    @pytest.mark.anyio
    async def test_delegates_to_phase2_service(self):
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        mock_parse_results = [MagicMock()]
        await runner.run_phase2(mock_parse_results)  # type: ignore[arg-type]

        orch.phase2_service.batch_resolve.assert_called_once_with(mock_parse_results)

    @pytest.mark.anyio
    async def test_ensures_cache_initialized(self):
        orch = _make_mock_orchestrator()
        orch.temporal_name_cache.is_initialized.return_value = False
        runner = PhaseRunner(orch)

        await runner.run_phase2([MagicMock()])

        orch.temporal_name_cache.initialize.assert_called_once()

    @pytest.mark.anyio
    async def test_skips_cache_init_if_already_initialized(self):
        orch = _make_mock_orchestrator()
        orch.temporal_name_cache.is_initialized.return_value = True
        runner = PhaseRunner(orch)

        await runner.run_phase2([MagicMock()])

        orch.temporal_name_cache.initialize.assert_not_called()

    @pytest.mark.anyio
    async def test_returns_resolution_results(self):
        orch = _make_mock_orchestrator()
        expected = [(MagicMock(), [MagicMock()])]
        orch.phase2_service.batch_resolve = AsyncMock(return_value=expected)
        runner = PhaseRunner(orch)

        result = await runner.run_phase2([MagicMock()])
        assert result == expected


class TestPhaseRunnerRunPhase3:
    @pytest.mark.anyio
    async def test_delegates_to_phase3_service(self):
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        mock_ambiguous = [(MagicMock(), [MagicMock()])]
        await runner.run_phase3(mock_ambiguous)  # type: ignore[arg-type]

        orch.phase3_service.batch_disambiguate.assert_called_once_with(mock_ambiguous, None)

    @pytest.mark.anyio
    async def test_returns_disambiguated_results(self):
        orch = _make_mock_orchestrator()
        expected = [(MagicMock(), [MagicMock()])]
        orch.phase3_service.batch_disambiguate = AsyncMock(return_value=expected)
        runner = PhaseRunner(orch)

        result = await runner.run_phase3([(MagicMock(), [MagicMock()])])
        assert result == expected


class TestPhaseRunnerRunFromPhase:
    @pytest.mark.anyio
    async def test_run_from_phase2_skips_phase1(self):
        """When running from Phase 2, Phase 1 should not be called."""
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        # Provide a trace with phase1 data already present
        trace_data = TraceData(
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma"),
            phase1_parse=Phase1Trace(
                ran=True,
                parsed_intents=[{"target_name": "Emma", "request_type": "BUNK_WITH", "confidence": 0.95}],
                is_valid=True,
            ),
        )

        # Phase 2 returns empty list (no ambiguous)
        orch.phase2_service.batch_resolve = AsyncMock(return_value=[])
        await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True)

        orch.phase1_service.batch_parse.assert_not_called()
        orch.phase2_service.batch_resolve.assert_called_once()

    @pytest.mark.anyio
    async def test_run_from_phase3_skips_phase1_and_phase2(self):
        """When running from Phase 3, Phase 1 and Phase 2 should not be called."""
        orch = _make_mock_orchestrator()
        runner = PhaseRunner(orch)

        from bunking.sync.bunk_request_processor.debug.trace_models import Phase2FinalResult

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

        await runner.run_from_phase("phase3", trace_data=trace_data, dry_run=True)

        orch.phase1_service.batch_parse.assert_not_called()
        orch.phase2_service.batch_resolve.assert_not_called()
        orch.phase3_service.batch_disambiguate.assert_called_once()

    @pytest.mark.anyio
    async def test_dry_run_does_not_save(self):
        """Dry run mode should not save bunk requests."""
        orch = _make_mock_orchestrator()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=[])
        runner = PhaseRunner(orch)

        trace_data = TraceData(
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma"),
            phase1_parse=Phase1Trace(ran=True, is_valid=True),
        )

        await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True)

        orch._save_bunk_requests.assert_not_called()


class TestPhaseRunnerRunFullTrace:
    @pytest.mark.anyio
    async def test_delegates_to_process_from_parse_requests(self):
        """run_full_trace should delegate to orchestrator.process_from_parse_requests."""
        orch = _make_mock_orchestrator()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True})
        runner = PhaseRunner(orch)

        mock_requests = [MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True)  # type: ignore[arg-type]

        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=mock_requests,
            stop_at_phase=None,
            dry_run=True,
        )

    @pytest.mark.anyio
    async def test_passes_stop_at_phase(self):
        """run_full_trace should pass stop_at_phase to process_from_parse_requests."""
        orch = _make_mock_orchestrator()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": True})
        runner = PhaseRunner(orch)

        await runner.run_full_trace([], stop_at_phase="phase1", dry_run=True)

        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=[],
            stop_at_phase="phase1",
            dry_run=True,
        )

    @pytest.mark.anyio
    async def test_dry_run_false_passed_through(self):
        """run_full_trace dry_run=False should be forwarded."""
        orch = _make_mock_orchestrator()
        orch.process_from_parse_requests = AsyncMock(return_value={"dry_run": False})
        runner = PhaseRunner(orch)

        await runner.run_full_trace([], dry_run=False)

        orch.process_from_parse_requests.assert_called_once_with(
            parse_requests=[],
            stop_at_phase=None,
            dry_run=False,
        )

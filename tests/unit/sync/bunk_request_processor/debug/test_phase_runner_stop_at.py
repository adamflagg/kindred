"""Tests for PhaseRunner stop_at_phase capability."""

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
        mock_requests: list[MagicMock] = [MagicMock(), MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase=None)  # type: ignore[arg-type]
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
        mock_requests: list[MagicMock] = [MagicMock()]
        await runner.run_full_trace(mock_requests, dry_run=True, stop_at_phase="phase2")  # type: ignore[arg-type]
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
    async def test_run_from_phase2_with_stop_at_historical_runs_verify(self):
        """stop_at_phase='historical' from phase2 entry must run historical verification.

        Regression test for #921: phase2 branch returned early on 'historical' without
        ever calling historical_verification_service.verify().
        """
        orch = MagicMock()

        # Phase 2 returns an ambiguous result
        pr = MagicMock()
        raw_rr = MagicMock()
        raw_rr.is_resolved = False
        raw_rr.confidence = 0.70
        phase2_out = [(pr, [raw_rr])]

        # Verified (post-historical) returns a boosted version
        boosted_rr = MagicMock()
        boosted_rr.is_resolved = False
        boosted_rr.confidence = 0.80
        verified_out = [(pr, [boosted_rr])]

        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=phase2_out)
        orch.run_historical_verification = AsyncMock(return_value=verified_out)
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

        result = await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True, stop_at_phase="historical")

        orch.phase2_service.batch_resolve.assert_called_once()
        orch.run_historical_verification.assert_called_once_with(phase2_out)
        orch.phase3_service.batch_disambiguate.assert_not_called()
        assert result["historical_results"] == verified_out

    @pytest.mark.anyio
    async def test_run_from_phase2_with_stop_at_phase3_feeds_historical_into_phase3(self):
        """stop_at_phase='phase3' from phase2 entry must feed VERIFIED results into phase3.

        Regression test for #922: phase2 branch used to cascade raw phase2 output into
        phase3, skipping the historical boost entirely.
        """
        orch = MagicMock()

        pr = MagicMock()
        raw_rr = MagicMock()
        raw_rr.is_resolved = False
        phase2_out = [(pr, [raw_rr])]

        boosted_rr = MagicMock()
        boosted_rr.is_resolved = False  # still ambiguous so phase3 runs
        verified_out = [(pr, [boosted_rr])]

        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=phase2_out)
        orch.run_historical_verification = AsyncMock(return_value=verified_out)
        orch.phase3_service = MagicMock()
        orch.phase3_service.batch_disambiguate = AsyncMock(return_value=verified_out)
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

        await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True, stop_at_phase="phase3")

        orch.run_historical_verification.assert_called_once_with(phase2_out)
        # phase3 must be called with the VERIFIED results, not the raw phase2 output
        call_args = orch.phase3_service.batch_disambiguate.call_args
        assert call_args.args[0] == verified_out, "phase3 must receive historical-verified results, not raw phase2"

    @pytest.mark.anyio
    async def test_run_from_phase2_with_stop_at_phase2_does_not_run_historical(self):
        """stop_at_phase='phase2' must NOT trigger historical verification."""
        orch = MagicMock()

        mock_rr = MagicMock()
        mock_rr.is_resolved = False
        mock_pr = MagicMock()
        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=[(mock_pr, [mock_rr])])
        orch.run_historical_verification = AsyncMock()
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
        orch.run_historical_verification.assert_not_called()
        orch.phase3_service.batch_disambiguate.assert_not_called()

    @pytest.mark.anyio
    async def test_run_from_phase2_age_preference_excluded_from_phase3(self):
        """Unresolved age-preference RRs must NOT be fed to phase3 disambiguation.

        Regression guard: the ambiguous filter must mirror orchestrator.py:1280-1282,
        which excludes AGE_PREFERENCE entries from phase3. Passing them through would
        cause debug/full pipeline divergence for age-preference requests.
        """
        orch = MagicMock()

        pr = MagicMock()
        age_pref_rr = MagicMock()
        age_pref_rr.is_resolved = False
        age_pref_rr.method = "age_preference"
        phase2_out = [(pr, [age_pref_rr])]
        verified_out = [(pr, [age_pref_rr])]

        orch.phase2_service = MagicMock()
        orch.phase2_service.batch_resolve = AsyncMock(return_value=phase2_out)
        orch.run_historical_verification = AsyncMock(return_value=verified_out)
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
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma age older"),
            phase1_parse=Phase1Trace(
                ran=True,
                parsed_intents=[{"target_name": "Emma", "request_type": "AGE_PREFERENCE", "confidence": 0.95}],
                is_valid=True,
            ),
        )

        await runner.run_from_phase("phase2", trace_data=trace_data, dry_run=True, stop_at_phase="phase3")

        # Age-preference entries must not reach phase3 disambiguation
        orch.phase3_service.batch_disambiguate.assert_not_called()

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

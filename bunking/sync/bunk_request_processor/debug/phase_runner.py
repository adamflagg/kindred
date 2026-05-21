"""PhaseRunner — runs individual pipeline phases in isolation for debugging.

Wraps a RequestOrchestrator instance to reuse its initialized components
(repos, AI provider, resolution pipeline, caches, social graph).
Does NOT rebuild from scratch — accepts a pre-initialized orchestrator.

Supports dry-run (default) and production-write modes for cascades.
"""

from typing import Any

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
    needs_phase3,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.shared.constants import SourceField

from .trace_models import TraceData

logger = get_logger(__name__)

# Canonical phase ordering used by stop_at_phase validation
PHASE_ORDER: list[str] = [
    "pre_phase1",
    "phase1",
    "validation",
    "phase2",
    "historical",
    "phase3",
    "post_pipeline",
]


class PhaseRunner:
    """Runs individual pipeline phases in isolation for debugging.

    Wraps a RequestOrchestrator instance to reuse its initialized components.
    Does NOT rebuild from scratch — accepts a pre-initialized orchestrator.

    Methods:
        run_phase1: Run Phase 1 AI parse on given parse requests (always dry-run).
        run_phase2: Run Phase 2 local resolution on parse results (always dry-run).
        run_phase3: Run Phase 3 AI disambiguation on ambiguous cases (always dry-run).
        run_from_phase: Cascade from a specified phase through remaining phases.
        run_full_trace: Run all phases end-to-end with trace collection.
    """

    def __init__(self, orchestrator: RequestOrchestrator) -> None:
        self._orch = orchestrator

    async def run_phase1(
        self,
        parse_requests: list[ParseRequest],
        progress_callback: Any | None = None,
    ) -> list[ParseResult]:
        """Run Phase 1 AI parse on given requests.

        Always dry-run — single phase re-runs never write to production.

        Args:
            parse_requests: List of ParseRequest objects to parse.
            progress_callback: Optional progress callback.

        Returns:
            List of ParseResult from Phase 1 AI parsing.
        """
        logger.info("PhaseRunner: running Phase 1 on %d requests", len(parse_requests))
        results = await self._orch.phase1_service.batch_parse(parse_requests, progress_callback)
        return results

    async def run_phase2(
        self,
        parse_results: list[ParseResult],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Run Phase 2 local resolution on parse results.

        Always dry-run — single phase re-runs never write to production.
        Ensures the temporal name cache is initialized before resolution.

        Args:
            parse_results: List of ParseResult from Phase 1.

        Returns:
            List of (ParseResult, list[ResolutionResult]) tuples.
        """
        # Ensure caches are ready
        if hasattr(self._orch.temporal_name_cache, "is_initialized"):
            if not self._orch.temporal_name_cache.is_initialized():
                logger.info("PhaseRunner: initializing temporal name cache for Phase 2")
                self._orch.temporal_name_cache.initialize()

        logger.info("PhaseRunner: running Phase 2 on %d parse results", len(parse_results))
        results = await self._orch.phase2_service.batch_resolve(parse_results)
        return results

    async def run_phase3(
        self,
        ambiguous_cases: list[tuple[ParseResult, list[ResolutionResult]]],
        progress_callback: Any | None = None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Run Phase 3 AI disambiguation on ambiguous cases.

        Always dry-run — single phase re-runs never write to production.

        Args:
            ambiguous_cases: List of (ParseResult, list[ResolutionResult]) with ambiguous results.
            progress_callback: Optional progress callback.

        Returns:
            List of (ParseResult, list[ResolutionResult]) with disambiguation applied.
        """
        logger.info("PhaseRunner: running Phase 3 on %d ambiguous cases", len(ambiguous_cases))
        results = await self._orch.phase3_service.batch_disambiguate(ambiguous_cases, progress_callback)
        return results

    async def run_from_phase(
        self,
        phase: str,
        trace_data: TraceData | None = None,
        parse_requests: list[ParseRequest] | None = None,
        dry_run: bool = True,
        stop_at_phase: str | None = None,
    ) -> dict[str, Any]:
        """Cascade from a specified phase through all remaining phases.

        Loads prior phase outputs from trace_data for upstream phases,
        runs the specified phase and all downstream phases.

        Dry-run only — production writes are exclusively handled by
        ``run_full_trace`` (via ``RequestOrchestrator``). The ``dry_run``
        parameter is retained for API compatibility and is forwarded to
        downstream phases, but this method never writes to production.

        Args:
            phase: Phase to start from ("phase1", "phase2", "phase3").
            trace_data: Existing trace data with upstream phase results.
            parse_requests: Parse requests for phase1 start (if phase="phase1").
            dry_run: Forwarded to downstream phases; this method does not write
                to production regardless.
            stop_at_phase: If set, stop after this phase completes. Must be at or
                after the start phase in PHASE_ORDER. None runs all remaining phases.

        Returns:
            Dict with phase results and dry_run flag.

        Raises:
            ValueError: If stop_at_phase is before the start phase in PHASE_ORDER.
        """
        # Validate stop_at_phase ordering
        if stop_at_phase is not None:
            if phase not in PHASE_ORDER:
                msg = f"Unknown phase '{phase}'. Valid phases: {PHASE_ORDER}"
                raise ValueError(msg)
            if stop_at_phase not in PHASE_ORDER:
                msg = f"Unknown stop_at_phase '{stop_at_phase}'. Valid phases: {PHASE_ORDER}"
                raise ValueError(msg)
            start_idx = PHASE_ORDER.index(phase)
            stop_idx = PHASE_ORDER.index(stop_at_phase)
            if stop_idx < start_idx:
                msg = f"stop_at_phase '{stop_at_phase}' is before start phase '{phase}'"
                raise ValueError(msg)

        logger.info("PhaseRunner: running from %s (dry_run=%s, stop_at_phase=%s)", phase, dry_run, stop_at_phase)

        result: dict[str, Any] = {"dry_run": dry_run}

        if phase == "phase1":
            # Run all phases from the beginning
            return await self.run_full_trace(parse_requests or [], dry_run=dry_run, stop_at_phase=stop_at_phase)

        elif phase == "phase2":
            # Reconstruct parse results from trace data for Phase 2 input
            phase2_input = self._reconstruct_parse_results_from_trace(trace_data)
            phase2_results = await self.run_phase2(phase2_input)
            result["phase2_results"] = phase2_results

            if stop_at_phase == "phase2":
                return result

            # Phase 2.5: Historical Group Verification. Delegates to the shared
            # orchestrator method so debug cascades emit identical traces and
            # confidence boosts as the full pipeline.
            historical_results = await self._orch.run_historical_verification(phase2_results)
            result["historical_results"] = historical_results

            if stop_at_phase == "historical":
                return result

            # Continue to Phase 3 with unresolved, non-age-preference cases.
            ambiguous = [(pr, rr_list) for pr, rr_list in historical_results if any(needs_phase3(rr) for rr in rr_list)]
            if ambiguous:
                phase3_results = await self.run_phase3(ambiguous)
                result["phase3_results"] = phase3_results
            else:
                result["phase3_results"] = []

            if stop_at_phase == "phase3":
                return result

        elif phase == "phase3":
            # Reconstruct ambiguous cases from trace data for Phase 3 input
            phase3_input = self._reconstruct_ambiguous_from_trace(trace_data)
            phase3_results = await self.run_phase3(phase3_input)
            result["phase3_results"] = phase3_results

        return result

    async def run_full_trace(
        self,
        parse_requests: list[ParseRequest],
        dry_run: bool = True,
        stop_at_phase: str | None = None,
    ) -> dict[str, Any]:
        """Run all phases end-to-end with trace collection.

        Delegates to orchestrator.process_from_parse_requests, which runs the
        full pipeline with trace recording at every phase.

        Args:
            parse_requests: List of ParseRequest objects to process.
            dry_run: If True (default), do not write to production.
            stop_at_phase: If set, stop after this phase completes.
                Downstream phases will not execute. None runs all phases.

        Returns:
            Dict with pipeline results and dry_run flag.
        """
        logger.info("PhaseRunner: running full trace (dry_run=%s, stop_at_phase=%s)", dry_run, stop_at_phase)
        return await self._orch.process_from_parse_requests(
            parse_requests=parse_requests,
            stop_at_phase=stop_at_phase,
            dry_run=dry_run,
        )

    def _reconstruct_parse_results_from_trace(
        self,
        trace_data: TraceData | None,
        original_request_id: str = "",
    ) -> list[ParseResult]:
        """Reconstruct ParseResult objects from trace data for Phase 2 input.

        This creates lightweight ParseResult-like objects from the trace's Phase 1
        data so Phase 2 can be run in isolation using prior Phase 1 output.

        Args:
            trace_data: Trace data with Phase 1 results.
            original_request_id: PB record ID for the original bunk request,
                used to build row_data so _get_trace_key can resolve back to this trace.

        Returns:
            List of ParseResult objects (may be empty if trace_data is None).
        """
        if not trace_data or not trace_data.phase1_parse.ran:
            return []

        # Reconstruct parsed requests from trace intents
        parsed_requests = []
        for intent in trace_data.phase1_parse.parsed_intents:
            target_name = intent.get("target_name", "")
            request_type_str = intent.get("request_type", "BUNK_WITH")
            try:
                request_type = RequestType(request_type_str)
            except ValueError:
                request_type = RequestType.BUNK_WITH

            parsed_req = ParsedRequest(
                raw_text=trace_data.pre_phase1.original_text,
                target_name=target_name,
                request_type=request_type,
                age_preference=None,
                source_field=trace_data.pre_phase1.field_path or SourceField.BUNK_REQUEST_FORM,
                confidence=intent.get("confidence", 0.0),
                csv_position=intent.get("csv_position", 0),
                metadata=intent,
            )
            parsed_requests.append(parsed_req)

        # Build a ParseRequest with enough context for _get_trace_key to resolve
        # the original_request_id. _get_trace_key reads:
        #   parse_request.field_name -> looks up in row_data._original_request_ids
        source_field = trace_data.pre_phase1.field_path or SourceField.BUNK_REQUEST_FORM

        parse_request = ParseRequest(
            request_text=trace_data.pre_phase1.original_text,
            field_name=source_field,
            requester_name=trace_data.pre_phase1.requester_info.name,
            requester_cm_id=trace_data.pre_phase1.requester_info.cm_id,
            requester_grade=trace_data.pre_phase1.requester_info.grade,
            session_cm_id=trace_data.pre_phase1.session_cm_ids[0] if trace_data.pre_phase1.session_cm_ids else 0,
            session_name="",
            year=0,
            row_data={"_original_request_ids": {source_field: original_request_id}},
        )

        # Create a minimal ParseResult with parse_request for trace key resolution
        parse_result = ParseResult(
            is_valid=trace_data.phase1_parse.is_valid,
            parsed_requests=parsed_requests,
            parse_request=parse_request,
        )

        return [parse_result]

    def _reconstruct_ambiguous_from_trace(
        self,
        trace_data: TraceData | None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Reconstruct ambiguous cases from trace data for Phase 3 input.

        Creates lightweight objects from Phase 2 trace data representing
        unresolved/ambiguous resolution results.

        Args:
            trace_data: Trace data with Phase 2 results.

        Returns:
            List of (ParseResult, list[ResolutionResult]) tuples.
        """
        if not trace_data or not trace_data.phase2_resolution:
            return []

        # Reconstruct parse results from Phase 1 trace
        parse_results = self._reconstruct_parse_results_from_trace(trace_data)
        if not parse_results:
            return []

        # Reconstruct resolution results from Phase 2 trace
        # Note: ResolutionResult.is_resolved and is_ambiguous are computed properties,
        # not constructor arguments. is_resolved depends on person being set,
        # is_ambiguous depends on candidates list length.
        resolution_results: list[ResolutionResult] = []
        for p2_trace in trace_data.phase2_resolution:
            final = p2_trace.final_result
            # Build a minimal person if it was resolved
            person = None
            if final.is_resolved and final.person_cm_id:
                person = Person(
                    cm_id=final.person_cm_id,
                    first_name=final.person_name.split()[0] if final.person_name else "",
                    last_name=" ".join(final.person_name.split()[1:]) if final.person_name else "",
                )
            # Build candidates list to reflect ambiguity
            candidates: list[Any] | None = None
            if final.is_ambiguous:
                # Create placeholder Person objects so is_ambiguous returns True (needs len > 1)
                placeholder_a = Person(cm_id=0, first_name="Candidate", last_name="A")
                placeholder_b = Person(cm_id=0, first_name="Candidate", last_name="B")
                candidates = [placeholder_a, placeholder_b]

            res = ResolutionResult(
                target_name=p2_trace.target_name,
                confidence=final.confidence,
                method=final.method,
                person=person,
                candidates=candidates,
            )
            resolution_results.append(res)

        return [(parse_results[0], resolution_results)]

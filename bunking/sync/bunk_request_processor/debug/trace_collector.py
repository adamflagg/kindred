"""TraceCollector — captures per-request trace data during pipeline execution.

Records data at each phase via method calls. Writes to PocketBase in a single
batch at the end via flush(). NoOpTraceCollector does nothing (production default).
"""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

from .trace_models import (
    SCHEMA_VERSION,
    HistoricalVerificationTrace,
    Phase1Trace,
    Phase2IntentTrace,
    Phase3IntentTrace,
    PlaceholderExpansionTrace,
    PostPipelineTrace,
    PrePhase1Trace,
    RequesterInfo,
    SanitizationInfo,
    TraceData,
)

logger = get_logger(__name__)


class TraceCollector:
    """Collects per-request trace data during pipeline execution."""

    def __init__(self, run_id: str = "", enabled: bool = True) -> None:
        self.run_id = run_id
        self.enabled = enabled
        self._traces: dict[str, TraceData] = {}
        self._trace_metadata: dict[str, dict[str, Any]] = {}

    def _ensure_trace(self, key: str) -> TraceData:
        if key not in self._traces:
            self._traces[key] = TraceData()
        return self._traces[key]

    def _get_trace_metadata(self, key: str) -> dict[str, Any]:
        meta = self._trace_metadata.get(key, {})
        return {**meta, "schema_version": SCHEMA_VERSION}

    def record_pre_phase1(
        self,
        key: str,
        action: str,
        original_text: str,
        requester_cm_id: int,
        year: int,
        session_cm_id: int,
        source_field: str,
        cleaned_text: str = "",
        na_prefix_stripped: bool = False,
        staff_metadata: dict[str, Any] | None = None,
        field_path: str = "",
        socialize_mapped_value: str | None = None,
        session_cm_ids: list[int] | None = None,
        requester_name: str = "",
        requester_grade: str = "",
        skip_reason: str | None = None,
    ) -> None:
        trace = self._ensure_trace(key)
        trace.pre_phase1 = PrePhase1Trace(
            action=action,
            skip_reason=skip_reason,
            original_text=original_text,
            cleaned_text=cleaned_text or original_text,
            na_prefix_stripped=na_prefix_stripped,
            staff_metadata=staff_metadata,
            field_path=field_path,
            socialize_mapped_value=socialize_mapped_value,
            session_cm_ids=session_cm_ids or [],
            requester_info=RequesterInfo(cm_id=requester_cm_id, name=requester_name, grade=requester_grade),
        )
        self._trace_metadata[key] = {
            "original_request_id": key,
            "requester_cm_id": requester_cm_id,
            "year": year,
            "session_cm_id": session_cm_id,
            "source_field": source_field,
        }

    def record_phase1(
        self,
        key: str,
        ran: bool,
        parsed_intents: list[dict[str, Any]],
        token_count: int | None = None,
        processing_time_ms: int | None = None,
        is_valid: bool = True,
        error_message: str | None = None,
        ai_raw_response: dict[str, Any] | None = None,
        ai_reasoning_summary: str | None = None,
        parse_request: dict[str, Any] | None = None,
        sanitization: dict[str, Any] | None = None,
    ) -> None:
        trace = self._ensure_trace(key)
        trace.phase1_parse = Phase1Trace(
            ran=ran,
            parse_request=parse_request or {},
            parsed_intents=parsed_intents,
            ai_raw_response=ai_raw_response or {},
            ai_reasoning_summary=ai_reasoning_summary,
            token_count=token_count,
            processing_time_ms=processing_time_ms,
            sanitization=SanitizationInfo(**(sanitization or {})),
            is_valid=is_valid,
            error_message=error_message,
        )

    def record_validation(
        self,
        key: str,
        type_validation: dict[str, Any] | None = None,
        temporal_conflicts: dict[str, Any] | None = None,
        source_text_validation: dict[str, Any] | None = None,
    ) -> None:
        trace = self._ensure_trace(key)
        if type_validation:
            trace.validation.type_validation = type_validation
        if temporal_conflicts:
            trace.validation.temporal_conflicts = temporal_conflicts
        if source_text_validation:
            trace.validation.source_text_validation = source_text_validation

    def record_phase2(
        self,
        key: str,
        intent_idx: int,
        intent_trace: Phase2IntentTrace,
    ) -> None:
        trace = self._ensure_trace(key)
        while len(trace.phase2_resolution) <= intent_idx:
            trace.phase2_resolution.append(Phase2IntentTrace())
        trace.phase2_resolution[intent_idx] = intent_trace

    def record_expansion(
        self,
        key: str,
        triggered: bool = False,
        expansion_type: str | None = None,
        expanded_count: int = 0,
        expanded_targets: list[dict[str, Any]] | None = None,
    ) -> None:
        trace = self._ensure_trace(key)
        trace.placeholder_expansion = PlaceholderExpansionTrace(
            triggered=triggered,
            type=expansion_type,
            expanded_count=expanded_count,
            expanded_targets=expanded_targets or [],
        )

    def record_historical(
        self,
        key: str,
        ran: bool = False,
        boost_applied: bool = False,
        original_confidence: float | None = None,
        boosted_confidence: float | None = None,
    ) -> None:
        trace = self._ensure_trace(key)
        trace.historical_verification = HistoricalVerificationTrace(
            ran=ran,
            boost_applied=boost_applied,
            original_confidence=original_confidence,
            boosted_confidence=boosted_confidence,
        )

    def record_phase3(
        self,
        key: str,
        intent_idx: int,
        intent_trace: Phase3IntentTrace,
    ) -> None:
        trace = self._ensure_trace(key)
        while len(trace.phase3_disambiguation) <= intent_idx:
            trace.phase3_disambiguation.append(Phase3IntentTrace())
        trace.phase3_disambiguation[intent_idx] = intent_trace

    def record_post_pipeline(
        self,
        key: str,
        post_trace: PostPipelineTrace,
    ) -> None:
        trace = self._ensure_trace(key)
        trace.post_pipeline = post_trace

    async def flush(self, pb_client: Any, run_metadata: dict[str, Any] | None = None) -> str:
        """Write all traces to PocketBase. Returns the run record ID.

        Note: PocketBase Python SDK is synchronous, so PB calls are wrapped
        in asyncio.to_thread() to avoid blocking the event loop.
        """
        import asyncio

        if not self._traces:
            return ""

        from .retention import cleanup_old_runs

        # 1. Create run record
        run_meta = run_metadata or {}
        status_breakdown = self._compute_status_breakdown()

        def _create_run() -> Any:
            return pb_client.collection("debug_pipeline_runs").create(
                {
                    "run_id": self.run_id,
                    "year": run_meta.get("year", 0),
                    "session": run_meta.get("session", ""),
                    "source_fields": run_meta.get("source_fields", []),
                    "limit_param": run_meta.get("limit", 0),
                    "force": run_meta.get("force", False),
                    "trace_count": len(self._traces),
                    "status_breakdown": status_breakdown,
                    "pinned": False,
                }
            )

        run_record = await asyncio.to_thread(_create_run)
        logger.info("Created debug pipeline run: %s (%d traces)", self.run_id, len(self._traces))

        # 2. Create trace records (sync PB calls wrapped in to_thread)
        trace_ids: dict[str, str] = {}
        for key, trace_data in self._traces.items():
            meta = self._trace_metadata.get(key, {})
            data = {
                "run_id": self.run_id,
                "original_request": meta.get("original_request_id", ""),
                "requester_cm_id": meta.get("requester_cm_id", 0),
                "year": meta.get("year", 0),
                "session_cm_id": meta.get("session_cm_id", 0),
                "source_field": meta.get("source_field", ""),
                "trace_data": trace_data.model_dump(),
                "pinned": False,
                "schema_version": SCHEMA_VERSION,
            }
            record = await asyncio.to_thread(pb_client.collection("debug_pipeline_traces").create, data)
            trace_ids[key] = record.id

        # 3. Create summary records (one per final_bunk_request per trace)
        for key, trace_data in self._traces.items():
            trace_id = trace_ids.get(key, "")
            meta = self._trace_metadata.get(key, {})
            for br in trace_data.post_pipeline.final_bunk_requests:
                summary_data = {
                    "run_id": self.run_id,
                    "trace": trace_id,
                    "original_request": meta.get("original_request_id", ""),
                    "bunk_request": br.bunk_request_id or "",
                    "requester_cm_id": meta.get("requester_cm_id", 0),
                    "requester_name": trace_data.pre_phase1.requester_info.name,
                    "target_name": br.requested_name or "",
                    "source_field": meta.get("source_field", ""),
                    "session_cm_id": meta.get("session_cm_id", 0),
                    "request_type": br.request_type,
                    "final_status": br.status,
                    "final_confidence": br.confidence,
                    "resolution_method": br.resolution_method,
                    "phase3_triggered": any(p.ran for p in trace_data.phase3_disambiguation),
                    "ai_reasoning_summary": trace_data.phase1_parse.ai_reasoning_summary or "",
                    "pre_p1_action": trace_data.pre_phase1.action,
                    "year": meta.get("year", 0),
                }
                await asyncio.to_thread(pb_client.collection("debug_pipeline_summary").create, summary_data)

        # 4. Run retention cleanup
        try:
            await asyncio.to_thread(cleanup_old_runs, pb_client)
        except Exception as e:
            logger.warning("Retention cleanup failed: %s", e)

        return str(run_record.id)

    def _compute_status_breakdown(self) -> dict[str, int]:
        breakdown: dict[str, int] = {"resolved": 0, "pending": 0, "declined": 0, "skipped": 0}
        for trace_data in self._traces.values():
            if not trace_data.post_pipeline.final_bunk_requests:
                breakdown["skipped"] += 1
            for br in trace_data.post_pipeline.final_bunk_requests:
                status = br.status.lower()
                if status in breakdown:
                    breakdown[status] += 1
        return breakdown


class NoOpTraceCollector(TraceCollector):
    """Does nothing. Zero overhead in production."""

    def __init__(self) -> None:
        super().__init__(run_id="", enabled=False)

    def record_pre_phase1(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_phase1(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_validation(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_phase2(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_expansion(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_historical(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_phase3(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_post_pipeline(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    async def flush(self, pb_client: Any, run_metadata: dict[str, Any] | None = None) -> str:
        return ""

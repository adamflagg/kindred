"""TraceCollector — captures per-request trace data during pipeline execution.

Records data at each phase via method calls. Writes to PocketBase in a single
batch at the end via flush(). NoOpTraceCollector does nothing (production default).
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from bunking.logging_config import get_logger

from .retention import MAX_AGE_DAYS, MAX_RUNS, cleanup_old_runs
from .trace_models import (
    BatchSignalsTrace,
    ConflictDetectionTrace,
    DedupSaveTrace,
    DispositionTrace,
    HistoricalVerificationTrace,
    Phase1Trace,
    Phase2IntentTrace,
    Phase3IntentTrace,
    PrePhase1Trace,
    ReciprocalSignal,
    RequesterInfo,
    SanitizationInfo,
    TraceData,
)

logger = get_logger(__name__)


class TraceCollector:
    """Collects per-request trace data during pipeline execution."""

    def __init__(self, run_id: str = "", enabled: bool = True, trigger: str = "manual") -> None:
        self.run_id = run_id
        self.enabled = enabled
        self.trigger = trigger
        self._traces: dict[str, TraceData] = {}
        self._trace_metadata: dict[str, dict[str, Any]] = {}

    def _ensure_trace(self, key: str) -> TraceData:
        if key not in self._traces:
            self._traces[key] = TraceData()
        return self._traces[key]

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

    def record_batch_signals(
        self,
        key: str,
        reciprocal: ReciprocalSignal | None = None,
    ) -> None:
        """Record batch-level signals (reciprocal detection).

        Part of the flattened post-pipeline trace (issue #877). Note that
        `self_reference` is NOT recorded here — it lives on dedup_save.
        """
        trace = self._ensure_trace(key)
        trace.batch_signals = BatchSignalsTrace(reciprocal=reciprocal or ReciprocalSignal())

    def record_conflict_detection(
        self,
        key: str,
        conflict_detection: ConflictDetectionTrace | None = None,
    ) -> None:
        """Record conflict-detection outcome for this request."""
        trace = self._ensure_trace(key)
        trace.conflict_detection = conflict_detection or ConflictDetectionTrace()

    def record_disposition(
        self,
        key: str,
        disposition: DispositionTrace,
    ) -> None:
        """Record final disposition (priority-ordered rule application)."""
        trace = self._ensure_trace(key)
        trace.disposition = disposition

    def record_dedup_save(
        self,
        key: str,
        dedup_save: DedupSaveTrace,
    ) -> None:
        """Record dedup + save outcome, including self-reference detection."""
        trace = self._ensure_trace(key)
        trace.dedup_save = dedup_save

    async def flush(self, pb_client: Any, run_metadata: dict[str, Any] | None = None) -> str:
        """Write all traces to PocketBase. Returns the run record ID.

        Note: PocketBase Python SDK is synchronous, so PB calls are wrapped
        in asyncio.to_thread() to avoid blocking the event loop.
        """
        if not self._traces:
            return ""

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
                    "trigger": self.trigger,
                    "session_breakdown": self._compute_session_breakdown(),
                    "pinned": False,
                }
            )

        run_record = await asyncio.to_thread(_create_run)
        logger.info("Created debug pipeline run: %s (%d traces)", self.run_id, len(self._traces))

        # 2. Create trace records in parallel (they're independent)
        trace_keys = list(self._traces.keys())

        async def _create_trace(key: str) -> tuple[str, str]:
            trace_data = self._traces[key]
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
            }
            record = await asyncio.to_thread(pb_client.collection("debug_pipeline_traces").create, data)
            return key, record.id

        trace_results = await asyncio.gather(*[_create_trace(k) for k in trace_keys])
        trace_ids: dict[str, str] = dict(trace_results)

        # 3. Create summary records in parallel (they're independent)
        summary_tasks = []
        for key, trace_data in self._traces.items():
            trace_id = trace_ids.get(key, "")
            meta = self._trace_metadata.get(key, {})
            for br in trace_data.disposition.final_bunk_requests:
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
                    "disposition_reason": br.disposition_reason or "",
                    "is_reciprocal": br.is_reciprocal,
                }
                summary_tasks.append(
                    asyncio.to_thread(pb_client.collection("debug_pipeline_summary").create, summary_data)
                )
        if summary_tasks:
            await asyncio.gather(*summary_tasks)

        # 4. Run retention cleanup (only if needed)
        try:
            check = await asyncio.to_thread(
                pb_client.collection("debug_pipeline_runs").get_list, 1, 1, {"sort": "created"}
            )
            needs_cleanup = check.total_items > MAX_RUNS
            if not needs_cleanup and check.items:
                oldest_str = getattr(check.items[0], "created", "")
                if oldest_str:
                    try:
                        oldest = datetime.fromisoformat(str(oldest_str))
                        if oldest.tzinfo is None:
                            oldest = oldest.replace(tzinfo=UTC)
                        needs_cleanup = oldest < datetime.now(UTC) - timedelta(days=MAX_AGE_DAYS)
                    except ValueError, TypeError:
                        pass
            if needs_cleanup:
                await asyncio.to_thread(cleanup_old_runs, pb_client)
        except Exception as e:
            logger.warning("Retention cleanup failed: %s", e)

        return str(run_record.id)

    def _resolve_trace_status(self, trace_data: TraceData) -> str:
        """Return the most significant status for a single trace.

        Priority order (highest to lowest): pending > declined > deduped > resolved.
        A trace with no final bunk requests is considered 'skipped'.
        """
        if not trace_data.disposition.final_bunk_requests:
            return "skipped"
        trace_status = "resolved"
        for br in trace_data.disposition.final_bunk_requests:
            status = (br.status or "").lower()
            if status == "pending":
                return "pending"  # highest priority — short-circuit
            elif status == "declined" and trace_status != "pending":
                trace_status = "declined"
            elif status == "deduped" and trace_status not in ("pending", "declined"):
                trace_status = "deduped"
        return trace_status

    def _compute_status_breakdown(self) -> dict[str, int]:
        breakdown: dict[str, int] = {"resolved": 0, "pending": 0, "declined": 0, "skipped": 0, "deduped": 0}
        for trace_data in self._traces.values():
            trace_status = self._resolve_trace_status(trace_data)
            if trace_status in breakdown:
                breakdown[trace_status] += 1
        return breakdown

    def _compute_session_breakdown(self) -> dict[str, dict[str, int]]:
        """Return per-session status counts, keyed by str(session_cm_id).

        Each value has the same shape as _compute_status_breakdown():
        {"resolved": n, "pending": n, "declined": n, "skipped": n, "deduped": n}.
        """
        result: dict[str, dict[str, int]] = {}
        for key, trace_data in self._traces.items():
            session_cm_id = str(self._trace_metadata.get(key, {}).get("session_cm_id", 0))
            if session_cm_id not in result:
                result[session_cm_id] = {"resolved": 0, "pending": 0, "declined": 0, "skipped": 0, "deduped": 0}
            trace_status = self._resolve_trace_status(trace_data)
            if trace_status in result[session_cm_id]:
                result[session_cm_id][trace_status] += 1
        return result


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

    def record_historical(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_phase3(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_batch_signals(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_conflict_detection(self, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def record_disposition(self, key: str, disposition: DispositionTrace) -> None:
        pass

    def record_dedup_save(self, key: str, dedup_save: DedupSaveTrace) -> None:
        pass

    async def flush(self, pb_client: Any, run_metadata: dict[str, Any] | None = None) -> str:
        return ""

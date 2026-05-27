"""Pydantic models for pipeline debug trace data.

These models define the schema for trace_data JSON stored in debug_pipeline_traces.
Each model represents one phase of the pipeline with all captured data points.
"""

from typing import Any

from pydantic import BaseModel, Field


class RequesterInfo(BaseModel):
    cm_id: int = 0
    name: str = ""
    grade: str = ""


class PrePhase1Trace(BaseModel):
    action: str = ""  # parsed | skipped_no_preference | skipped_no_session | etc.
    skip_reason: str | None = None
    original_text: str = ""
    cleaned_text: str = ""
    na_prefix_stripped: bool = False
    staff_metadata: dict[str, Any] | None = None
    field_path: str = ""  # ai_parse | socialize_direct_map
    socialize_mapped_value: str | None = None
    session_cm_ids: list[int] = Field(default_factory=list)
    requester_info: RequesterInfo = Field(default_factory=RequesterInfo)


class SanitizationInfo(BaseModel):
    is_suspicious: bool = False
    risk_level: str | None = None
    confidence_penalty: float = 0.0


class Phase1Trace(BaseModel):
    ran: bool = False
    parse_request: dict[str, Any] = Field(default_factory=dict)
    parsed_intents: list[dict[str, Any]] = Field(default_factory=list)
    ai_raw_response: dict[str, Any] = Field(default_factory=dict)
    ai_reasoning_summary: str | None = None
    token_count: int | None = None
    processing_time_ms: int | None = None
    sanitization: SanitizationInfo = Field(default_factory=SanitizationInfo)
    is_valid: bool = True
    error_message: str | None = None


class ValidationTrace(BaseModel):
    type_validation: dict[str, Any] = Field(default_factory=lambda: {"passed": True, "rejected": []})
    temporal_conflicts: dict[str, Any] = Field(default_factory=lambda: {"filtered": 0, "details": []})
    source_text_validation: dict[str, Any] = Field(
        default_factory=lambda: {"rejected": 0, "hallucinated_names": [], "unit_names": []}
    )


class CandidateTrace(BaseModel):
    person_cm_id: int = 0
    name: str = ""
    session_cm_id: int | None = None
    grade: int | None = None
    school: str | None = None
    score_breakdown: dict[str, Any] = Field(default_factory=dict)


class Phase2FinalResult(BaseModel):
    person_cm_id: int | None = None
    person_name: str | None = None
    confidence: float = 0.0
    method: str = ""
    is_resolved: bool = False
    is_ambiguous: bool = False
    confidence_factors: dict[str, float] = Field(default_factory=dict)


class SocialGraphDetails(BaseModel):
    enhanced: bool = False
    connection_strength: float | None = None
    shared_friends: int | None = None
    smart_resolved: bool = False
    candidates_reranked: bool = False


class Phase2IntentTrace(BaseModel):
    target_name: str = ""
    fast_path_tried: list[str] = Field(default_factory=list)
    fast_path_result: dict[str, Any] | None = None
    pipeline_strategies_tried: list[dict[str, Any]] = Field(default_factory=list)
    all_candidates: list[CandidateTrace] = Field(default_factory=list)
    final_result: Phase2FinalResult = Field(default_factory=Phase2FinalResult)
    staff_filtered: bool = False
    hallucination_detected: bool = False
    social_graph_details: SocialGraphDetails = Field(default_factory=SocialGraphDetails)
    spread_filter_applied: bool = False


class HistoricalVerificationTrace(BaseModel):
    ran: bool = False
    boost_applied: bool = False
    original_confidence: float | None = None
    boosted_confidence: float | None = None


class Phase3IntentTrace(BaseModel):
    target_name: str = ""
    ran: bool = False
    candidates_sent: list[dict[str, Any]] = Field(default_factory=list)
    ai_context: dict[str, Any] = Field(default_factory=dict)
    ai_selection: int | None = None
    ai_reasoning: str | None = None
    ai_reasoning_summary: str | None = None
    result: str = "not_needed"  # not_needed | resolved | no_match | invalid_ai_output | still_ambiguous
    confidence_before: float | None = None
    confidence_after: float | None = None
    # JW reranker metadata (Phase 3 post-AI validation)
    reranked: bool = False
    jw_score: float | None = None
    ai_confidence: float | None = None  # Raw AI confidence before JW adjustment
    no_match_signal: bool = False  # AI explicitly indicated no candidate matches


class FinalBunkRequestTrace(BaseModel):
    bunk_request_id: str | None = None
    requester_cm_id: int = 0
    requested_cm_id: int | None = None
    requested_name: str | None = None
    request_type: str = ""
    status: str = ""
    confidence: float = 0.0
    is_first_requested: bool = False
    resolution_method: str = ""
    declined_reason: str | None = None
    disposition_reason: str = ""
    is_reciprocal: bool = False


# ---------------------------------------------------------------------------
# Finalization stage traces — flattened from the former PostPipelineTrace
# (see issue #877). Each of the four post-pipeline stages now owns its own
# typed trace. `self_reference` lives on DedupSaveTrace to match where the
# UI renders it (DedupDetail panel), not on BatchSignalsTrace.
# ---------------------------------------------------------------------------


class ReciprocalSignal(BaseModel):
    detected: bool = False
    boost_applied: bool = False
    boost_amount: float | None = None
    pair_cm_id: int | None = None


class SelfReferenceSignal(BaseModel):
    detected: bool = False


class BatchSignalsTrace(BaseModel):
    reciprocal: ReciprocalSignal = Field(default_factory=ReciprocalSignal)


class ConflictDetectionTrace(BaseModel):
    has_conflict: bool = False
    details: list[Any] = Field(default_factory=list)


class DispositionTrace(BaseModel):
    final_bunk_requests: list[FinalBunkRequestTrace] = Field(default_factory=list)


class DedupSaveTrace(BaseModel):
    was_duplicate: bool = False
    kept_over: str | None = None
    self_reference: SelfReferenceSignal = Field(default_factory=SelfReferenceSignal)


class TraceData(BaseModel):
    pre_phase1: PrePhase1Trace = Field(default_factory=PrePhase1Trace)
    phase1_parse: Phase1Trace = Field(default_factory=Phase1Trace)
    validation: ValidationTrace = Field(default_factory=ValidationTrace)
    phase2_resolution: list[Phase2IntentTrace] = Field(default_factory=list)
    historical_verification: HistoricalVerificationTrace = Field(default_factory=HistoricalVerificationTrace)
    phase3_disambiguation: list[Phase3IntentTrace] = Field(default_factory=list)
    # Flattened finalization stages (issue #877)
    batch_signals: BatchSignalsTrace = Field(default_factory=BatchSignalsTrace)
    conflict_detection: ConflictDetectionTrace = Field(default_factory=ConflictDetectionTrace)
    disposition: DispositionTrace = Field(default_factory=DispositionTrace)
    dedup_save: DedupSaveTrace = Field(default_factory=DedupSaveTrace)

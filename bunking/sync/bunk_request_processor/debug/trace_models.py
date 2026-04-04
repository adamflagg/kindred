"""Pydantic models for pipeline debug trace data.

These models define the schema for trace_data JSON stored in debug_pipeline_traces.
Each model represents one phase of the pipeline with all captured data points.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1


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


class PlaceholderExpansionTrace(BaseModel):
    triggered: bool = False
    type: str | None = None
    expanded_count: int = 0
    expanded_targets: list[dict[str, Any]] = Field(default_factory=list)


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
    result: str = "not_needed"  # not_needed | resolved | no_match | still_ambiguous
    confidence_before: float | None = None
    confidence_after: float | None = None


class FinalBunkRequestTrace(BaseModel):
    bunk_request_id: str | None = None
    requester_cm_id: int = 0
    requested_cm_id: int | None = None
    requested_name: str | None = None
    request_type: str = ""
    status: str = ""
    confidence: float = 0.0
    priority: int = 0
    resolution_method: str = ""
    is_placeholder: bool = False
    declined_reason: str | None = None
    disposition_reason: str = ""
    is_reciprocal: bool = False


class PostPipelineTrace(BaseModel):
    conflict_detection: dict[str, Any] = Field(default_factory=lambda: {"has_conflict": False, "details": []})
    self_reference: dict[str, Any] = Field(default_factory=lambda: {"detected": False})
    reciprocal: dict[str, Any] = Field(
        default_factory=lambda: {"detected": False, "boost_applied": False, "boost_amount": None, "pair_cm_id": None}
    )
    deduplication: dict[str, Any] = Field(default_factory=lambda: {"was_duplicate": False, "kept_over": None})
    final_bunk_requests: list[FinalBunkRequestTrace] = Field(default_factory=list)


class TraceData(BaseModel):
    pre_phase1: PrePhase1Trace = Field(default_factory=PrePhase1Trace)
    phase1_parse: Phase1Trace = Field(default_factory=Phase1Trace)
    validation: ValidationTrace = Field(default_factory=ValidationTrace)
    phase2_resolution: list[Phase2IntentTrace] = Field(default_factory=list)
    placeholder_expansion: PlaceholderExpansionTrace = Field(default_factory=PlaceholderExpansionTrace)
    historical_verification: HistoricalVerificationTrace = Field(default_factory=HistoricalVerificationTrace)
    phase3_disambiguation: list[Phase3IntentTrace] = Field(default_factory=list)
    post_pipeline: PostPipelineTrace = Field(default_factory=PostPipelineTrace)

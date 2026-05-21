"""Pipeline Debug API Schemas

Pydantic response models for the pipeline debug endpoints:
- Pipeline runs (list, pin)
- Pipeline traces (detail, by-camper)
- Pipeline summaries (batch list with filtering)
- Phase execution (run-phase2, run-phase3, run-from-phase, run-full-trace)
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

# =============================================================================
# Pipeline Runs
# =============================================================================


class PipelineRunItem(BaseModel):
    """A single pipeline debug run for the run selector."""

    id: str = Field(description="PocketBase record ID")
    run_id: str = Field(description="UUID for this run")
    year: int = Field(description="Camp year")
    session: str = Field(default="", description="Session param")
    source_fields: list[str] = Field(default_factory=list, description="Source fields processed")
    limit_param: int = Field(default=0, description="Limit param (0 = no limit)")
    force: bool = Field(default=False, description="Whether force mode was used")
    trace_count: int = Field(default=0, description="Number of traces in this run")
    status_breakdown: dict[str, int] = Field(
        default_factory=dict, description="Status counts: resolved, pending, declined, skipped"
    )
    pinned: bool = Field(default=False, description="Whether this run is pinned")
    created: datetime | None = Field(default=None, description="When the run completed")


class PipelineRunsResponse(BaseModel):
    """Response for listing pipeline runs."""

    items: list[PipelineRunItem] = Field(description="List of pipeline runs")
    total: int = Field(description="Total number of runs")


class PinToggleResponse(BaseModel):
    """Response for toggling a run's pinned status."""

    run_id: str = Field(description="Run ID that was toggled")
    pinned: bool = Field(description="New pinned status")


# =============================================================================
# Pipeline Summaries (Batch View)
# =============================================================================


class PipelineSummaryItem(BaseModel):
    """A single summary row for the batch list."""

    id: str = Field(description="PocketBase record ID")
    run_id: str = Field(description="Run ID")
    trace_id: str = Field(default="", description="Parent trace record ID")
    original_request_id: str = Field(default="", description="Original bunk request record ID")
    bunk_request_id: str | None = Field(default=None, description="Final bunk_request ID (null for declined/dry-run)")
    requester_cm_id: int = Field(default=0, description="Requester CampMinder ID")
    requester_name: str = Field(default="", description="Requester name")
    target_name: str = Field(default="", description="Parsed target name")
    source_field: str = Field(default="", description="Source field")
    session_cm_id: int = Field(default=0, description="Session CM ID")
    request_type: str = Field(default="", description="BUNK_WITH / NOT_BUNK_WITH / AGE_PREFERENCE")
    final_status: str = Field(default="", description="RESOLVED / PENDING / DECLINED")
    final_confidence: float = Field(default=0.0, description="Final confidence score")
    resolution_method: str = Field(default="", description="How the name was resolved")
    phase3_triggered: bool = Field(default=False, description="Whether disambiguation ran")
    ai_reasoning_summary: str = Field(default="", description="Short AI reasoning excerpt")
    pre_p1_action: str = Field(default="", description="Pre-Phase 1 action taken")
    year: int = Field(default=0, description="Camp year")
    disposition_reason: str = Field(default="", description="Why this request was resolved/pending/declined")
    is_reciprocal: bool = Field(default=False, description="Whether a reciprocal match was found")


class PipelineSummaryResponse(BaseModel):
    """Response for listing pipeline summaries for a run."""

    items: list[PipelineSummaryItem] = Field(description="List of summary rows")
    total: int = Field(description="Total matching records")
    page: int = Field(default=1, description="Current page")
    per_page: int = Field(default=50, description="Items per page")


# =============================================================================
# Pipeline Traces (Drill-Down)
# =============================================================================


class PipelineTraceItem(BaseModel):
    """A pipeline trace with full trace_data JSON."""

    id: str = Field(description="PocketBase record ID")
    run_id: str = Field(description="Run ID")
    original_request_id: str = Field(default="", description="Original bunk request record ID")
    requester_cm_id: int = Field(default=0, description="Requester CampMinder ID")
    year: int = Field(default=0, description="Camp year")
    session_cm_id: int = Field(default=0, description="Session CM ID")
    source_field: str = Field(default="", description="Source field")
    trace_data: dict[str, Any] = Field(default_factory=dict, description="Full trace JSON")
    pinned: bool = Field(default=False, description="Whether this trace is pinned")
    created: datetime | None = Field(default=None, description="When captured")


class PipelineTraceResponse(BaseModel):
    """Response for a single trace detail."""

    trace: PipelineTraceItem = Field(description="The trace record")


class PipelineTracesByCamperResponse(BaseModel):
    """Response for traces by camper CM ID."""

    items: list[PipelineTraceItem] = Field(description="Traces for this camper")
    total: int = Field(description="Total traces found")


# =============================================================================
# Phase Execution Requests/Responses
# =============================================================================


class RunPhase1Request(BaseModel):
    """Request to run Phase 1 parsing on selected original requests."""

    original_request_ids: list[str] = Field(min_length=1, description="Original bunk request IDs to parse")
    dry_run: bool = Field(default=True, description="Phase 1 is always read-only; included for API consistency")


class RunPhase2Request(BaseModel):
    """Request to run Phase 2 in isolation."""

    trace_id: str = Field(description="Trace ID to load Phase 1 output from")


class RunPhase3Request(BaseModel):
    """Request to run Phase 3 in isolation."""

    trace_id: str = Field(description="Trace ID to load Phase 2 output from")


class RunFromPhaseRequest(BaseModel):
    """Request to cascade from a specific phase."""

    trace_id: str = Field(description="Trace ID to load prior phase outputs from")
    year: int = Field(description="Camp year")
    session_cm_ids: list[int] = Field(description="Session CM IDs")
    dry_run: bool = Field(default=True, description="If False, write to production")
    stop_at_phase: str | None = Field(default=None, description="Stop after this phase (null = run all)")


class RunFullTraceRequest(BaseModel):
    """Request to run full pipeline trace."""

    original_request_ids: list[str] = Field(min_length=1, description="Original bunk request IDs to process")
    year: int = Field(description="Camp year")
    session_cm_ids: list[int] = Field(description="Session CM IDs")
    dry_run: bool = Field(default=True, description="If False, write to production")
    stop_at_phase: str | None = Field(default=None, description="Stop after this phase (null = run all)")


class PhaseRunResponse(BaseModel):
    """Response from a phase execution."""

    success: bool = Field(description="Whether execution succeeded")
    phase: str = Field(description="Phase that was run")
    dry_run: bool = Field(description="Whether this was a dry run")
    trace_id: str | None = Field(default=None, description="New trace ID if one was created")
    results: dict[str, Any] = Field(default_factory=dict, description="Phase execution results")
    error: str | None = Field(default=None, description="Error message if execution failed")


# =============================================================================
# Person Search (Autocomplete)
# =============================================================================


class PersonSearchItem(BaseModel):
    """A person result from search."""

    cm_id: int = Field(description="CampMinder person ID")
    first_name: str = Field(description="First name")
    last_name: str = Field(description="Last name")
    grade: int | None = Field(default=None, description="Grade")
    sessions: list[int] = Field(default_factory=list, description="Session CM IDs for given year")


class PersonSearchResponse(BaseModel):
    """Response for person search."""

    items: list[PersonSearchItem] = Field(description="Matching persons")
    total: int = Field(description="Total matches")

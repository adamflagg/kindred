"""Debug API Schemas

Pydantic models for the debug parse analysis endpoints.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# Source field enum for filtering
SourceFieldType = Literal["bunk_with", "not_bunk_with", "bunking_notes", "internal_notes"]


class ParseAnalysisFilter(BaseModel):
    """Filter parameters for listing parse analysis results."""

    session_cm_id: int | None = Field(default=None, description="Filter by session CampMinder ID")
    source_field: SourceFieldType | None = Field(default=None, description="Filter by source field type")
    year: int | None = Field(default=None, description="Filter by year")
    limit: int = Field(default=50, ge=1, le=500, description="Maximum number of results")
    offset: int = Field(default=0, ge=0, description="Offset for pagination")


class ParsedIntent(BaseModel):
    """A single parsed intent from Phase 1."""

    request_type: str = Field(description="Type of request (bunk_with, not_bunk_with, etc.)")
    target_name: str | None = Field(description="Extracted target camper name")
    keywords_found: list[str] = Field(default_factory=list, description="Keywords that triggered this intent")
    parse_notes: str = Field(default="", description="Notes about the parse")
    reasoning: str = Field(default="", description="AI reasoning for this parse")
    list_position: int = Field(description="Position in the original text (0-based)")
    needs_clarification: bool = Field(default=False, description="Whether this intent needs clarification")
    temporal_info: dict[str, Any] | None = Field(default=None, description="Temporal conflict information if present")


class ParseAnalysisItem(BaseModel):
    """A single parse analysis result for display."""

    id: str = Field(description="Debug result record ID")
    original_request_id: str = Field(description="Original bunk request record ID")
    requester_name: str | None = Field(description="Name of the camper who made the request")
    requester_cm_id: int | None = Field(description="CampMinder ID of the requester")
    source_field: str | None = Field(description="Source field (bunk_with, bunking_notes, etc.)")
    original_text: str | None = Field(description="Original request text from CSV")
    parsed_intents: list[ParsedIntent] = Field(default_factory=list, description="Parsed intents from Phase 1")
    is_valid: bool = Field(description="Whether parsing succeeded")
    error_message: str | None = Field(default=None, description="Error message if parsing failed")
    token_count: int | None = Field(default=None, description="Number of tokens used")
    processing_time_ms: int | None = Field(default=None, description="Processing time in milliseconds")
    prompt_version: str | None = Field(default=None, description="Version of prompt used")
    created: datetime | None = Field(default=None, description="When the result was created")


class ParseAnalysisDetailItem(ParseAnalysisItem):
    """Extended parse analysis with raw AI response for detail view."""

    ai_raw_response: dict[str, Any] | None = Field(default=None, description="Raw AI response for debugging")


class ParseAnalysisListResponse(BaseModel):
    """Response for listing parse analysis results."""

    items: list[ParseAnalysisItem] = Field(description="List of parse analysis results")
    total: int = Field(description="Total number of results matching filter")


class Phase1OnlyRequest(BaseModel):
    """Request body for running Phase 1 parsing."""

    original_request_ids: list[str] = Field(
        min_length=1,
        description="List of original_bunk_requests record IDs to parse",
    )
    force_reparse: bool = Field(
        default=False,
        description="If true, ignore cache and reparse even if results exist",
    )


class Phase1OnlyResponse(BaseModel):
    """Response from Phase 1 parsing."""

    results: list[ParseAnalysisItem] = Field(description="Parse results for each request")
    total_tokens: int = Field(description="Total tokens used across all parses")


class ClearAnalysisResponse(BaseModel):
    """Response from clearing analysis results."""

    deleted_count: int = Field(description="Number of records deleted")


class OriginalRequestItem(BaseModel):
    """An original bunk request for the debug list."""

    id: str = Field(description="PocketBase record ID")
    requester_name: str | None = Field(description="Name of the camper")
    requester_cm_id: int | None = Field(description="CampMinder ID of the requester")
    source_field: str = Field(description="Source field type")
    original_text: str = Field(description="Original request text")
    year: int = Field(description="Camp year")
    processed: bool = Field(description="Whether this request has been processed")


class OriginalRequestsListResponse(BaseModel):
    """Response for listing original requests."""

    items: list[OriginalRequestItem] = Field(description="List of original requests")
    total: int = Field(description="Total count")


class OriginalRequestWithStatus(BaseModel):
    """An original bunk request with parse status flags."""

    id: str = Field(description="PocketBase record ID")
    requester_name: str | None = Field(description="Name of the camper")
    requester_cm_id: int | None = Field(description="CampMinder ID of the requester")
    source_field: str = Field(description="Source field type")
    original_text: str = Field(description="Original request text")
    year: int = Field(description="Camp year")
    has_debug_result: bool = Field(description="Whether a debug parse result exists")
    has_production_result: bool = Field(description="Whether production bunk_requests exist")


class OriginalRequestsWithParseResponse(BaseModel):
    """Response for listing original requests with parse status."""

    items: list[OriginalRequestWithStatus] = Field(description="List of original requests with status")
    total: int = Field(description="Total count")


# Source type for parse results
ParseResultSource = Literal["debug", "production", "none"]


class ParseResultWithSource(BaseModel):
    """Parse result with source indicator for fallback display."""

    source: ParseResultSource = Field(description="Source of the parse result")
    id: str | None = Field(default=None, description="Debug result record ID (if source is debug)")
    original_request_id: str | None = Field(default=None, description="Original bunk request record ID")
    requester_name: str | None = Field(default=None, description="Name of the camper")
    requester_cm_id: int | None = Field(default=None, description="CampMinder ID of the requester")
    source_field: str | None = Field(default=None, description="Source field type")
    original_text: str | None = Field(default=None, description="Original request text")
    parsed_intents: list[ParsedIntent] = Field(default_factory=list, description="Parsed intents")
    is_valid: bool = Field(default=True, description="Whether parsing succeeded")
    error_message: str | None = Field(default=None, description="Error message if parsing failed")
    token_count: int | None = Field(default=None, description="Number of tokens used")
    processing_time_ms: int | None = Field(default=None, description="Processing time in milliseconds")
    prompt_version: str | None = Field(default=None, description="Version of prompt used")
    created: datetime | None = Field(default=None, description="When the result was created")


# Prompt Editor Schemas


class PromptListItem(BaseModel):
    """A single prompt file in the list."""

    name: str = Field(description="Prompt name (without extension)")
    filename: str = Field(description="Full filename")
    modified_at: datetime | None = Field(default=None, description="Last modification time")


class PromptListResponse(BaseModel):
    """Response for listing available prompts."""

    prompts: list[PromptListItem] = Field(description="List of available prompts")


class PromptContentResponse(BaseModel):
    """Response for getting prompt content."""

    name: str = Field(description="Prompt name")
    content: str = Field(description="Prompt content")
    modified_at: datetime | None = Field(default=None, description="Last modification time")


class PromptUpdateRequest(BaseModel):
    """Request body for updating a prompt."""

    content: str = Field(min_length=1, description="New prompt content")


class PromptUpdateResponse(BaseModel):
    """Response for updating a prompt."""

    name: str = Field(description="Prompt name")
    success: bool = Field(description="Whether update succeeded")


# Grouped by Camper Schemas (Phase 3)


class FieldParseResult(BaseModel):
    """A single field's parse result within a camper group."""

    original_request_id: str = Field(description="Original bunk request record ID")
    source_field: str = Field(description="Source field type")
    original_text: str = Field(description="Original request text")
    has_debug_result: bool = Field(description="Whether debug parse result exists")
    has_production_result: bool = Field(description="Whether production bunk_requests exist")


class CamperGroupedRequests(BaseModel):
    """Requests grouped by camper with their field parse results."""

    requester_cm_id: int = Field(description="CampMinder ID of the requester")
    requester_name: str = Field(description="Name of the camper")
    fields: list[FieldParseResult] = Field(description="List of fields for this camper")


class GroupedRequestsResponse(BaseModel):
    """Response for grouped original requests endpoint."""

    items: list[CamperGroupedRequests] = Field(description="List of camper groups")
    total: int = Field(description="Total number of campers")

"""Pydantic schemas for OpenAI SDK structured outputs.

These schemas define the expected response format for AI parsing and disambiguation.
The SDK will enforce these schemas via constrained decoding, guaranteeing valid output.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TemporalInfo(BaseModel):
    """Temporal metadata for tracking superseded requests.

    Used to handle temporal conflicts in bunk requests, such as:
    - "6/4 wants separate bunks | 6/5 changed minds, want together"
    - "Previously wanted Emma, but now wants Sarah instead"

    The AI marks requests with temporal metadata, and Python does
    deterministic filtering based on this information.
    """

    date_mentioned: str | None = None
    """Raw date text if present: '6/4', 'June 5', etc."""

    is_superseded: bool = False
    """True if a LATER entry explicitly overrides this request."""

    supersedes_reason: str | None = None
    """Why superseded: 'changed minds on 6/5', 'now wants together instead'."""


class AIBunkRequestItem(BaseModel):
    """Single parsed bunk request from AI.

    Maps to the JSON structure expected by the prompt in openai_provider.py.
    The Literal types ensure the AI can only output valid enum values.
    """

    request_type: Literal["bunk_with", "not_bunk_with", "age_preference"]
    """Type of request - constrained to exactly these three values."""

    target_name: str | None = None
    """Name of the person (bunk_with/not_bunk_with) or age preference value."""

    keywords_found: list[str] = Field(default_factory=list)
    """Priority/importance keywords extracted from the text."""

    source_field: str = ""
    """Which CSV field this was extracted from."""

    source_type: Literal["parent", "counselor", "staff"] = "parent"
    """Who made the request."""

    parse_notes: str = ""
    """Brief explanation of what was extracted."""

    reasoning: str = ""
    """Why the AI categorized it this way."""

    list_position: int = 0
    """Position in multi-request fields (0-indexed from AI, converted to 1-indexed)."""

    needs_clarification: bool = False
    """Whether this request needs human review."""

    ambiguity_reason: str | None = None
    """Explanation if the request is ambiguous."""

    temporal_info: TemporalInfo | None = None
    """Temporal metadata for conflict detection - date mentioned, superseded status."""


class AIParseResponse(BaseModel):
    """Response from parse-only AI request.

    This is the Phase 1 response format - extracts structure without ID resolution.
    """

    requests: list[AIBunkRequestItem] = Field(default_factory=list)
    """List of parsed requests from the input text."""


class AIFullParseRequestItem(BaseModel):
    """Parsed request with ID matching (Phase 1+2 combined, full mode).

    Extended version that includes person ID resolution from attendee lists.
    """

    request_type: Literal["bunk_with", "not_bunk_with", "age_preference"]
    target_name: str | None = None
    target_person_id: int | None = None
    """Matched person ID from attendee list, or None if not found."""

    match_certainty: Literal["exact", "partial", "ambiguous", "none"] = "none"
    """How confident the AI is in the ID match."""

    requires_clarification: bool = False
    ambiguity_reason: str | None = None
    keywords_found: list[str] = Field(default_factory=list)
    source_field: str = ""
    source_type: Literal["parent", "counselor", "staff"] = "parent"
    parse_notes: str = ""
    reasoning: str = ""
    found_in_current_year: bool = False
    found_in_previous_year_only: bool = False


class AIFullParseResponse(BaseModel):
    """Response from full AI request (with ID matching).

    Used when attendee context is provided for name-to-ID resolution.
    """

    needs_historical_context: bool = False
    """Whether historical data would help resolve this request."""

    historical_context_reason: str | None = None
    """Why historical context is needed."""

    requests: list[AIFullParseRequestItem] = Field(default_factory=list)


class AIDisambiguationResponse(BaseModel):
    """Response from disambiguation request (Phase 3).

    Used when Phase 2 local resolution found multiple candidates.
    """

    selected_person_id: int | None = None
    """The AI's selected person ID from the candidates."""

    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    """Confidence in the selection (0.0 to 1.0)."""

    reasoning: str = ""
    """Explanation for the selection."""

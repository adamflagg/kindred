"""
Pydantic schemas for manual review endpoints.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ManualReviewDecision(BaseModel):
    """Decision on a manual review item."""

    decision: str  # approved, rejected, deferred
    decision_notes: str = ""
    reviewed_by: str


class ManualReviewResponse(BaseModel):
    """Response for a manual review item."""

    id: str
    review_type: str
    session_cm_id: int
    year: int
    status: str
    data: dict[str, Any]
    suggested_action: str | None = None
    reasoning: str | None = None
    completeness_score: float | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    decision_notes: str | None = None
    created: str
    updated: str

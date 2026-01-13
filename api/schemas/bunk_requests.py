"""
Pydantic schemas for bunk request endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel


class BunkRequestCreate(BaseModel):
    """Request model for creating a bunk request."""

    requester_id: int
    requestee_id: int | None = None
    request_type: str
    priority: int
    year: int
    session_id: int
    original_text: str
    confidence_score: float = 1.0
    parse_notes: str = ""
    socialize_explain: str = ""
    request_source: str
    is_reciprocal: bool = False


class BunkRequestUpdate(BaseModel):
    """Request model for updating a bunk request."""

    priority: int | None = None
    status: str | None = None
    manual_notes: str | None = None
    priority_locked: bool | None = None
    requestee_id: int | None = None


class BunkRequestResponse(BaseModel):
    """Response model for bunk requests."""

    id: str
    requester_id: int
    requestee_id: int | None = None
    request_type: str
    priority: int
    year: int
    session_id: int
    status: str
    original_text: str
    confidence_score: float
    parse_notes: str
    manual_notes: str | None = None
    priority_locked: bool
    created: str
    updated: str

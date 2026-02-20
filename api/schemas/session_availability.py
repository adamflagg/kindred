"""Pydantic schemas for session availability API endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GenderAvailability(BaseModel):
    """Availability data for one gender within a session."""

    min_grade: int | None = Field(None, description="Minimum eligible grade")
    max_grade: int | None = Field(None, description="Maximum eligible grade")
    enrolled: int = Field(0, description="Number enrolled")
    waitlisted: int = Field(0, description="Number waitlisted")
    capacity: int | None = Field(None, description="Total capacity for this gender")
    status: str = Field("open", description="open, limited, or waitlist")


class SessionAvailability(BaseModel):
    """Availability for one non-AG session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    session_type: str = Field(description="main, embedded, or quest")
    sort_order: int = Field(0, description="Sort position")
    girls: GenderAvailability = Field(default_factory=GenderAvailability)
    boys: GenderAvailability = Field(default_factory=GenderAvailability)


class AGSessionAvailability(BaseModel):
    """Availability for one AG session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    parent_session_name: str | None = Field(None, description="Parent session name")
    min_grade: int | None = Field(None, description="Minimum eligible grade")
    max_grade: int | None = Field(None, description="Maximum eligible grade")
    enrolled: int = Field(0, description="Number enrolled")
    waitlisted: int = Field(0, description="Number waitlisted")
    capacity: int | None = Field(None, description="Total capacity")
    status: str = Field("open", description="open, limited, or waitlist")


class SessionAvailabilityResponse(BaseModel):
    """Full session availability response."""

    sessions: list[SessionAvailability] = Field(default_factory=list)
    ag_sessions: list[AGSessionAvailability] = Field(default_factory=list)
    limited_threshold: int = Field(80, description="Threshold percentage for limited status")

"""Pydantic schemas for session availability API endpoint."""

from pydantic import BaseModel, Field


class GenderAvailability(BaseModel):
    """Availability data for one gender within a session."""

    min_grade: int | None = None
    max_grade: int | None = None
    enrolled: int = 0
    waitlisted: int = 0
    capacity: int | None = None
    status: str = "open"


class SessionAvailability(BaseModel):
    """Availability for one non-AG session."""

    session_cm_id: int
    session_name: str
    session_type: str
    sort_order: int = 0
    girls: GenderAvailability = Field(default_factory=GenderAvailability)
    boys: GenderAvailability = Field(default_factory=GenderAvailability)


class AGSessionAvailability(BaseModel):
    """Availability for one AG session."""

    session_cm_id: int
    session_name: str
    parent_session_name: str | None = None
    min_grade: int | None = None
    max_grade: int | None = None
    enrolled: int = 0
    waitlisted: int = 0
    capacity: int | None = None
    status: str = "open"


class SessionAvailabilityResponse(BaseModel):
    """Full session availability response."""

    sessions: list[SessionAvailability] = Field(default_factory=list)
    ag_sessions: list[AGSessionAvailability] = Field(default_factory=list)
    limited_threshold: int = 80

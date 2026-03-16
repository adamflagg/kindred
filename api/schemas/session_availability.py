"""Pydantic schemas for session availability API endpoint."""

from pydantic import BaseModel, Field


class WaitlistedPerson(BaseModel):
    """Lightweight person record for tooltip display. Uses CampMinder person_id."""

    person_id: int
    first_name: str
    last_name: str
    preferred_name: str | None = None
    grade: int | None = None
    position: int


class GenderAvailability(BaseModel):
    """Availability data for one gender within a session."""

    min_grade: int | None = None
    max_grade: int | None = None
    enrolled: int = 0
    waitlisted: int = 0
    capacity: int | None = None
    status: str = "open"
    waitlisted_by_grade: dict[int, int] = Field(default_factory=dict)
    waitlisted_persons: list[WaitlistedPerson] = Field(default_factory=list)


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
    waitlisted_by_grade: dict[int, int] = Field(default_factory=dict)
    waitlisted_persons: list[WaitlistedPerson] = Field(default_factory=list)


class SessionAvailabilityResponse(BaseModel):
    """Full session availability response."""

    sessions: list[SessionAvailability] = Field(default_factory=list)
    ag_sessions: list[AGSessionAvailability] = Field(default_factory=list)
    limited_threshold: int = 80

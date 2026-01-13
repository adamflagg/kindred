"""
Direct models for solver V2 - works directly with PocketBase schema.
No transformation needed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DirectBunkRequest(BaseModel):
    """Direct representation of bunk_requests table data."""

    id: str
    requester_person_cm_id: int
    requested_person_cm_id: int | None = None
    request_type: str  # 'bunk_with', 'not_bunk_with', 'age_preference'
    priority: int = Field(default=1, ge=1, le=10)
    session_cm_id: int
    year: int
    confidence_score: float = 0.0
    status: str = "pending"

    # Additional fields for context
    original_text: str | None = None
    age_preference_target: str | None = None  # 'older', 'younger'
    friend_group_id: str | None = None
    request_source: str | None = None  # 'csv_explicit', 'socialize_field', 'prior_year', 'manual_entry', 'friend_group'
    source_field: str | None = None  # Which CSV field it came from
    csv_source_fields: list[str] | None = None  # Actual CSV fields that contributed to this request
    ai_reasoning: dict[str, Any] | None = None  # AI reasoning data including csv_source_fields


class DirectPerson(BaseModel):
    """Minimal person data needed for solver - direct from persons table."""

    campminder_person_id: int
    first_name: str
    last_name: str
    grade: int
    birthdate: str
    gender: str | None = None  # 'M', 'F', etc.
    friend_group_id: str | None = None
    session_cm_id: int  # Track which session this person is enrolled in

    @property
    def age(self) -> float:
        """Calculate age from birthdate in CampMinder format (e.g., 12.02 for 12 years, 2 months)."""
        if not self.birthdate:
            return 0.0

        today = datetime.now()
        birth = datetime.fromisoformat(self.birthdate.replace("Z", "+00:00"))

        years = today.year - birth.year
        months = today.month - birth.month

        if months < 0 or (months == 0 and today.day < birth.day):
            years -= 1
            months += 12

        if today.day < birth.day:
            months -= 1
            if months < 0:
                months = 11

        # Return age in CampMinder format
        return years + (months / 100)

    @property
    def name(self) -> str:
        """Full name for display."""
        return f"{self.first_name} {self.last_name}"


class DirectBunk(BaseModel):
    """Bunk data - direct from bunks table."""

    id: str
    campminder_id: int
    name: str
    capacity: int = 12
    area: str | None = None
    gender: str | None = None  # 'M', 'F', 'Mixed' for cabin gender eligibility
    session_cm_id: int  # Track which session this bunk belongs to


class DirectBunkAssignment(BaseModel):
    """Assignment data for output - maps to bunk_assignments table."""

    person_cm_id: int
    session_cm_id: int
    bunk_cm_id: int
    year: int
    is_locked: bool = False
    group_lock_id: str | None = None  # For group locking


class HistoricalBunkingRecord(BaseModel):
    """Record of a camper's historical bunk assignment from prior years.

    Used by level_progression constraint to ensure returning campers
    don't regress to lower bunk levels.
    """

    person_cm_id: int
    bunk_name: str  # e.g., "B-5", "G-3", "AG-8"
    year: int  # The year this assignment was from


class DirectSolverInput(BaseModel):
    """All data needed for solver in direct format."""

    persons: list[DirectPerson]
    requests: list[DirectBunkRequest]
    bunks: list[DirectBunk]
    existing_assignments: list[DirectBunkAssignment] = Field(default_factory=list)
    historical_bunking: list[HistoricalBunkingRecord] = Field(default_factory=list)

    @property
    def person_by_cm_id(self) -> dict[int, DirectPerson]:
        """Quick lookup of persons by CampMinder ID."""
        return {p.campminder_person_id: p for p in self.persons}

    @property
    def requests_by_person(self) -> dict[int, list[DirectBunkRequest]]:
        """Group requests by requester person CM ID."""
        result: dict[int, list[DirectBunkRequest]] = {}
        for request in self.requests:
            person_id = request.requester_person_cm_id
            if person_id not in result:
                result[person_id] = []
            result[person_id].append(request)
        return result

    @property
    def locked_assignments(self) -> dict[int, int]:
        """Get locked assignments as person_cm_id -> bunk_cm_id mapping."""
        return {
            a.person_cm_id: a.bunk_cm_id
            for a in self.existing_assignments
            if a.is_locked and not a.group_lock_id  # Exclude group locks
        }

    @property
    def group_locks(self) -> dict[str, list[int]]:
        """Get group locks as group_lock_id -> list of person_cm_ids."""
        group_locks: dict[str, list[int]] = {}
        for a in self.existing_assignments:
            if a.group_lock_id:
                if a.group_lock_id not in group_locks:
                    group_locks[a.group_lock_id] = []
                group_locks[a.group_lock_id].append(a.person_cm_id)
        return group_locks


class DirectSolverOutput(BaseModel):
    """Solver results in direct format."""

    assignments: list[DirectBunkAssignment]
    stats: dict[str, Any] = Field(default_factory=dict)
    satisfied_requests: dict[int, list[str]] = Field(
        default_factory=dict
    )  # person_cm_id -> list of satisfied request IDs
    warnings: list[str] = Field(default_factory=list)
    analysis: dict[str, Any] | None = None  # Post-solve analysis results
    log_file_path: str | None = None  # Path to saved solver log file

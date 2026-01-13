from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_serializer, field_validator


class RequestType(Enum):
    BUNK_WITH = "bunk_with"
    NOT_BUNK_WITH = "not_bunk_with"
    AGE_PREFERENCE = "age_preference"


class AgePreference(Enum):
    OLDER = "older"  # Prefers same grade + one grade above
    YOUNGER = "younger"  # Prefers same grade + one grade below


class PriorityType(Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"


class Request(BaseModel):
    request_type: RequestType
    target_camper_id: str | None = None
    age_preference: AgePreference | None = None
    priority: int = Field(default=1, ge=1, le=5)

    @field_validator("target_camper_id")
    @classmethod
    def validate_target(cls, v: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("request_type") in [RequestType.BUNK_WITH, RequestType.NOT_BUNK_WITH]:
            if not v:
                raise ValueError("target_camper_id required for bunk_with/not_bunk_with requests")
        return v

    @field_validator("age_preference")
    @classmethod
    def validate_age_pref(cls, v: AgePreference | None, info: ValidationInfo) -> AgePreference | None:
        if info.data.get("request_type") == RequestType.AGE_PREFERENCE:
            if not v:
                raise ValueError("age_preference required for age preference requests")
        return v


class Camper(BaseModel):
    id: str
    name: str
    age: float
    grade: int
    requests: list[Request] = Field(default_factory=list)
    priority_type: PriorityType | None = None
    is_new: bool = False  # Whether camper is new or returning
    friend_group_id: str | None = None  # ID of friend group if member of one
    previous_level: int | None = None  # Previous bunk level for returning campers

    @field_validator("priority_type")
    @classmethod
    def validate_priority_type(cls, v: PriorityType | None, info: ValidationInfo) -> PriorityType | None:
        if v and "requests" in info.data:
            positive_priorities = any(
                r.request_type == RequestType.BUNK_WITH and r.priority > 1 for r in info.data["requests"]
            )
            negative_priorities = any(
                r.request_type == RequestType.NOT_BUNK_WITH and r.priority > 1 for r in info.data["requests"]
            )

            if positive_priorities and negative_priorities:
                raise ValueError("Cannot prioritize both positive and negative requests")

            if positive_priorities and v != PriorityType.POSITIVE:
                raise ValueError("Priority type must be POSITIVE when positive requests are prioritized")

            if negative_priorities and v != PriorityType.NEGATIVE:
                raise ValueError("Priority type must be NEGATIVE when negative requests are prioritized")
        return v

    def get_sorted_requests(self) -> list[Request]:
        """Return requests sorted by priority (highest first)"""
        return sorted(self.requests, key=lambda r: r.priority, reverse=True)


class Cabin(BaseModel):
    id: str
    max_capacity: int = 12
    assigned_campers: list[str] = Field(default_factory=list)

    @property
    def current_size(self) -> int:
        return len(self.assigned_campers)

    @property
    def is_full(self) -> bool:
        return self.current_size >= self.max_capacity

    def can_add_camper(self) -> bool:
        return not self.is_full


class BunkingAssignment(BaseModel):
    """Result of the bunking optimization"""

    cabins: dict[str, list[str]]  # cabin_id -> list of camper_ids
    satisfied_requests: dict[str, list[int]]  # camper_id -> list of satisfied request indices
    unsatisfied_campers: list[str]  # campers with no satisfied requests

    def get_cabin_for_camper(self, camper_id: str) -> str | None:
        for cabin_id, campers in self.cabins.items():
            if camper_id in campers:
                return cabin_id
        return None

    def validate_assignment(self, campers: list[Camper]) -> bool:
        """Validate that every camper has at least one satisfied request"""
        camper_dict = {c.id: c for c in campers}

        return all(camper_id not in camper_dict for camper_id in self.unsatisfied_campers)


class ScenarioChangeType(Enum):
    """Types of changes that can be made to a scenario"""

    CREATED = "created"
    ASSIGNMENT_ADDED = "assignment_added"
    ASSIGNMENT_REMOVED = "assignment_removed"
    ASSIGNMENT_MOVED = "assignment_moved"
    CLEARED = "cleared"
    SOLVER_RUN = "solver_run"
    RENAMED = "renamed"
    REVERTED = "reverted"


class SavedScenario(BaseModel):
    """Represents a saved bunking scenario"""

    id: str | None = None
    name: str
    session_cm_id: int
    year: int  # Required for year-scoped queries
    created_by: str | None = None
    is_active: bool = True
    description: str | None = None

    model_config = ConfigDict()


class BunkAssignmentDraft(BaseModel):
    """Represents a draft bunk assignment for a scenario.

    Uses PocketBase relation IDs for database operations. The relational schema
    ensures data integrity and enables expand queries for related data.
    """

    id: str | None = None
    scenario: str  # PocketBase ID → saved_scenarios
    person: str  # PocketBase ID → persons
    bunk: str  # PocketBase ID → bunks
    session: str  # PocketBase ID → camp_sessions
    bunk_plan: str | None = None  # PocketBase ID → bunk_plans
    year: int
    assignment_locked: bool = False

    @field_validator("year")
    @classmethod
    def validate_year(cls, v: int) -> int:
        if v < 2000 or v > 2100:
            raise ValueError("Year must be between 2000 and 2100")
        return v


class ScenarioHistory(BaseModel):
    """Represents a change history entry for a scenario"""

    id: str | None = None
    scenario: str  # PocketBase ID of saved_scenario
    change_type: ScenarioChangeType
    change_data: dict[str, Any] | None = None
    changed_by: str | None = None
    changed_at: datetime

    model_config = ConfigDict()

    @field_serializer("changed_at")
    def serialize_datetime(self, dt: datetime) -> str:
        return dt.isoformat()


class CreateScenarioRequest(BaseModel):
    """Request to create a new scenario"""

    name: str
    session_cm_id: int
    year: int  # Required: year for the scenario
    description: str | None = None
    copy_from_production: bool | None = None  # Deprecated, kept for backward compatibility
    copy_from_scenario: str | None = None  # ID of scenario to copy from
    created_by: str | None = None

    @property
    def should_copy_from_production(self) -> bool:
        """Check if should copy from production (backward compatibility)"""
        # If new field is not set, fall back to old field
        if self.copy_from_scenario is None and self.copy_from_production is not None:
            return self.copy_from_production
        # If no copy source specified, default to copying from production
        return self.copy_from_scenario is None and self.copy_from_production is not False


class UpdateScenarioRequest(BaseModel):
    """Request to update a scenario"""

    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ClearScenarioRequest(BaseModel):
    """Request to clear all assignments in a scenario"""

    year: int  # Required: year for scoping the clear operation
    cleared_by: str | None = None


class ScenarioAssignmentUpdate(BaseModel):
    """Request to update assignments in a scenario.

    Frontend sends CampMinder IDs (person_id, bunk_id).
    Solver looks up PocketBase record IDs to use with relation fields.
    """

    session_cm_id: int  # CampMinder session ID
    year: int  # Required: year for scoping the update
    person_id: int  # CampMinder person ID
    bunk_id: int | None = None  # CampMinder bunk ID, None means remove assignment
    locked: bool | None = None
    updated_by: str | None = None


# V2 Schema Models for PocketBase integration
class Person(BaseModel):
    """Person model matching PocketBase schema."""

    id: str | None = None
    campminder_id: str
    name: str
    age: float | None = None
    grade: int | None = None
    gender: str | None = None
    is_camper: bool = True
    tags: list[str] = Field(default_factory=list)


class Bunk(BaseModel):
    """Bunk model matching PocketBase schema."""

    id: str | None = None
    campminder_id: str
    name: str
    area: str | None = None
    division_cm_id: str | None = None
    max_size: int = 12
    is_locked: bool = False
    gender: str | None = None


class BunkAssignment(BaseModel):
    """Bunk assignment model matching PocketBase schema."""

    id: str | None = None
    person_cm_id: str
    session_cm_id: str
    bunk_cm_id: str
    bunk_plan_cm_id: str | None = None
    year: int
    is_manual: bool = False


class BunkRequest(BaseModel):
    """Bunk request model matching PocketBase schema."""

    id: str | None = None
    requester_person_cm_id: str
    session_cm_id: str
    year: int
    request_type: str  # bunk_with, not_bunk_with, age_preference
    requested_person_cm_id: str | None = None
    priority: int = 5
    status: str = "pending"  # pending, approved, rejected
    source: str | None = None
    notes: str | None = None
    source_field: str | None = None  # CSV field that generated this request
    ai_reasoning: str | dict[str, Any] | None = None  # Legacy AI reasoning data
    ai_p1_reasoning: str | dict[str, Any] | None = None  # Phase 1 AI reasoning with csv_source_fields
    age_preference_target: str | None = None  # 'older' or 'younger' for age_preference requests


class Session(BaseModel):
    """Session model matching PocketBase schema."""

    id: str | None = None
    campminder_id: str
    name: str
    start_date: str | None = None
    end_date: str | None = None
    session_type: str | None = None
    year: int


class Division(BaseModel):
    """Division model matching PocketBase schema."""

    id: str | None = None
    campminder_id: str
    name: str
    min_grade: int | None = None
    max_grade: int | None = None
    gender: str | None = None


class FriendGroup(BaseModel):
    """Friend group model matching PocketBase schema."""

    id: str | None = None
    name: str
    session_cm_id: str
    year: int
    member_cm_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


# Solution Analysis Models
class WarningType(Enum):
    """Types of warnings that can be generated"""

    HIGH_ISOLATION = "high_isolation"
    SPLIT_FRIEND_GROUP = "split_friend_group"
    LOW_SATISFACTION = "low_satisfaction"
    LEVEL_REGRESSION = "level_regression"
    UNBALANCED_BUNK = "unbalanced_bunk"


class SeverityLevel(Enum):
    """Severity levels for warnings"""

    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class SolutionWarning(BaseModel):
    """Warning generated from solution analysis"""

    warning_type: WarningType
    severity: SeverityLevel
    message: str
    affected_bunks: list[str] = Field(default_factory=list)
    affected_campers: list[str] = Field(default_factory=list)
    suggestion: str | None = None


class BunkHealth(BaseModel):
    """Health metrics for a single bunk"""

    bunk_name: str
    cohesion_score: float = Field(ge=0.0, le=1.0)  # 0-1 based on internal connections
    isolated_count: int = Field(ge=0)
    satisfaction_rate: float = Field(ge=0.0, le=1.0)
    size: int = Field(ge=0)

    @property
    def overall_health(self) -> float:
        """Calculate overall health score (0-1)"""
        isolation_penalty = (self.isolated_count / self.size) if self.size > 0 else 0
        return (self.cohesion_score + self.satisfaction_rate - isolation_penalty) / 2


class FriendGroupAnalysis(BaseModel):
    """Analysis of friend group preservation"""

    preserved_groups: list[str] = Field(default_factory=list)
    split_groups: list[str] = Field(default_factory=list)
    group_distribution: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    preservation_rate: float = Field(ge=0.0, le=1.0)


class IsolationAnalysis(BaseModel):
    """Analysis of camper isolation"""

    isolated_campers: list[str] = Field(default_factory=list)
    bunk_isolation_counts: dict[str, int] = Field(default_factory=dict)
    high_isolation_bunks: list[tuple[str, int, float]] = Field(default_factory=list)
    total_isolated: int = Field(ge=0)
    isolation_rate: float = Field(ge=0.0, le=1.0)


class SatisfactionAnalysis(BaseModel):
    """Analysis of request satisfaction"""

    overall_satisfaction_rate: float = Field(ge=0.0, le=1.0)
    satisfaction_by_priority: dict[int, float] = Field(default_factory=dict)
    satisfaction_by_type: dict[str, float] = Field(default_factory=dict)
    low_satisfaction_campers: list[tuple[str, int, int, float]] = Field(default_factory=list)
    total_requests: int = Field(ge=0)
    total_satisfied: int = Field(ge=0)


class LevelProgressionAnalysis(BaseModel):
    """Analysis of camper level progressions"""

    progressions_up: list[tuple[str, int, int]] = Field(default_factory=list)
    progressions_flat: list[tuple[str, int, int]] = Field(default_factory=list)
    progressions_down: list[tuple[str, int, int]] = Field(default_factory=list)
    progression_rate: float = Field(ge=0.0, le=1.0)
    regression_rate: float = Field(ge=0.0, le=1.0)
    total_returning_campers: int = Field(ge=0)


class SolutionReport(BaseModel):
    """Comprehensive solution analysis report"""

    friend_group_analysis: FriendGroupAnalysis
    isolation_analysis: IsolationAnalysis
    satisfaction_analysis: SatisfactionAnalysis
    level_progression_analysis: LevelProgressionAnalysis
    bunk_health_scores: dict[str, BunkHealth]
    warnings: list[SolutionWarning]
    graph_data: dict[str, Any]  # For visualization

    @property
    def summary_metrics(self) -> dict[str, float]:
        """Get summary metrics for quick overview"""
        return {
            "friend_group_preservation": self.friend_group_analysis.preservation_rate,
            "isolation_rate": self.isolation_analysis.isolation_rate,
            "satisfaction_rate": self.satisfaction_analysis.overall_satisfaction_rate,
            "progression_rate": self.level_progression_analysis.progression_rate,
            "regression_rate": self.level_progression_analysis.regression_rate,
            "warnings_count": len(self.warnings),
            "critical_warnings": len([w for w in self.warnings if w.severity == SeverityLevel.CRITICAL]),
        }

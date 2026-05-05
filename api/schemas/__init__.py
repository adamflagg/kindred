"""
Pydantic schemas for the Bunking API.

Re-exports all schemas for convenient importing.
"""

from __future__ import annotations

from .admin import (
    BunkRequestUpload,
    UpdateAdminSetting,
    UpdateSyncSchedule,
    ValidateCronRequest,
)
from .bunk_requests import (
    BunkRequestCreate,
    BunkRequestResponse,
    BunkRequestUpdate,
)
from .config import SolverConfigUpdate
from .manual_review import ManualReviewDecision, ManualReviewResponse
from .metrics import (
    ComparisonDelta,
    ComparisonMetricsResponse,
    GenderBreakdown,
    GradeBreakdown,
    NewVsReturning,
    RegistrationMetricsResponse,
    RetentionByGender,
    RetentionByGrade,
    RetentionBySession,
    RetentionByYearsAtCamp,
    RetentionMetricsResponse,
    SessionBreakdown,
    SessionLengthBreakdown,
    YearsAtCampBreakdown,
    YearSummary,
)
from .social_graph import (
    BunkGraphMetrics,
    BunkGraphResponse,
    CamperPositionUpdate,
    CrossScopeEdge,
    IncrementalUpdateResponse,
    SocialGraphEdge,
    SocialGraphNode,
    SocialGraphResponse,
)
from .solver import (
    ClearAssignmentsRequest,
    MultiSessionSolverRequest,
    SolverRequest,
    SolverResponse,
)
from .validation import ValidateBunkingRequest

__all__ = [
    "BunkGraphMetrics",
    "BunkGraphResponse",
    "BunkRequestCreate",
    "BunkRequestResponse",
    "BunkRequestUpdate",
    "BunkRequestUpload",
    "CamperPositionUpdate",
    "ClearAssignmentsRequest",
    "ComparisonDelta",
    "ComparisonMetricsResponse",
    "CrossScopeEdge",
    "GenderBreakdown",
    "GradeBreakdown",
    "IncrementalUpdateResponse",
    "ManualReviewDecision",
    "ManualReviewResponse",
    "MultiSessionSolverRequest",
    "NewVsReturning",
    "RegistrationMetricsResponse",
    "RetentionByGender",
    "RetentionByGrade",
    "RetentionBySession",
    "RetentionByYearsAtCamp",
    "RetentionMetricsResponse",
    "SessionBreakdown",
    "SessionLengthBreakdown",
    "SocialGraphEdge",
    "SocialGraphNode",
    "SocialGraphResponse",
    "SolverConfigUpdate",
    "SolverRequest",
    "SolverResponse",
    "UpdateAdminSetting",
    "UpdateSyncSchedule",
    "ValidateBunkingRequest",
    "ValidateCronRequest",
    "YearSummary",
    "YearsAtCampBreakdown",
]

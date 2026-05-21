"""
Pydantic schemas for the Bunking API.

Re-exports all schemas for convenient importing.
"""

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

__all__ = [  # noqa: RUF022 — grouped by feature for navigability over alphabetical
    # Social Graph
    "BunkGraphMetrics",
    "BunkGraphResponse",
    "CamperPositionUpdate",
    "CrossScopeEdge",
    "IncrementalUpdateResponse",
    "SocialGraphEdge",
    "SocialGraphNode",
    "SocialGraphResponse",
    # Bunk Requests
    "BunkRequestCreate",
    "BunkRequestResponse",
    "BunkRequestUpdate",
    "BunkRequestUpload",
    # Solver
    "ClearAssignmentsRequest",
    "MultiSessionSolverRequest",
    "SolverConfigUpdate",
    "SolverRequest",
    "SolverResponse",
    # Metrics
    "ComparisonDelta",
    "ComparisonMetricsResponse",
    "GenderBreakdown",
    "GradeBreakdown",
    "NewVsReturning",
    "RegistrationMetricsResponse",
    "RetentionByGender",
    "RetentionByGrade",
    "RetentionBySession",
    "RetentionByYearsAtCamp",
    "RetentionMetricsResponse",
    "SessionBreakdown",
    "SessionLengthBreakdown",
    "YearSummary",
    "YearsAtCampBreakdown",
    # Manual Review
    "ManualReviewDecision",
    "ManualReviewResponse",
    # Admin / Config
    "UpdateAdminSetting",
    "UpdateSyncSchedule",
    "ValidateCronRequest",
    # Validation
    "ValidateBunkingRequest",
]

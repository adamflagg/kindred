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
from .social_graph import (
    BunkGraphMetrics,
    BunkGraphResponse,
    CamperPositionUpdate,
    EgoNetworkResponse,
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
    # Admin
    "BunkRequestUpload",
    "UpdateAdminSetting",
    "UpdateSyncSchedule",
    "ValidateCronRequest",
    # Bunk Requests
    "BunkRequestCreate",
    "BunkRequestResponse",
    "BunkRequestUpdate",
    # Config
    "SolverConfigUpdate",
    # Manual Review
    "ManualReviewDecision",
    "ManualReviewResponse",
    # Social Graph
    "BunkGraphMetrics",
    "BunkGraphResponse",
    "CamperPositionUpdate",
    "EgoNetworkResponse",
    "IncrementalUpdateResponse",
    "SocialGraphEdge",
    "SocialGraphNode",
    "SocialGraphResponse",
    # Solver
    "ClearAssignmentsRequest",
    "MultiSessionSolverRequest",
    "SolverRequest",
    "SolverResponse",
    # Validation
    "ValidateBunkingRequest",
]

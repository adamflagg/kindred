"""
Pydantic schemas for social graph endpoints.
"""

from typing import Any

from pydantic import BaseModel

# CrossScopeEdge lives in bunking.graph.scope_filter (domain layer); re-exported here for symmetry with the other social-graph schemas.
from bunking.graph.scope_filter import CrossScopeEdge as CrossScopeEdge


class SocialGraphNode(BaseModel):
    """Node in the social graph"""

    id: int  # person_cm_id
    name: str
    grade: int | None = None
    bunk_cm_id: int | None = None
    centrality: float = 0.0
    clustering: float = 0.0
    community: int | None = None
    satisfaction_status: str | None = None  # 'satisfied' | 'unsatisfied' | 'no_requests'
    # Stage 2 parent-paramount split. parent_satisfaction_status drives the graph
    # node border color in the frontend; staff_satisfaction_status is emitted but
    # intentionally not rendered (Stage 2 scope decision).
    parent_satisfaction_status: str | None = None
    staff_satisfaction_status: str | None = None
    first_year: bool = False  # True if camper has no historical attendance
    last_year_session: str | None = None  # Previous year's session name
    last_year_bunk: str | None = None  # Previous year's bunk name


class SocialGraphEdge(BaseModel):
    """Edge in the social graph"""

    source: int
    target: int
    weight: float
    edge_type: str  # 'request'
    reciprocal: bool = False
    confidence: float | None = None  # AI confidence score for request edges
    request_type: str | None = None  # 'bunk_with' | 'not_bunk_with' for type='request' edges
    metadata: dict[str, Any] = {}  # Additional edge metadata
    cross_scope: bool = False  # True for edges crossing the active scope boundary


class SocialGraphResponse(BaseModel):
    """Complete social graph data"""

    nodes: list[SocialGraphNode]
    edges: list[SocialGraphEdge]
    metrics: dict[str, float]
    communities: dict[int, list[int]]  # community_id -> member_ids
    warnings: list[str] = []  # Warnings about isolated campers, split groups, etc.
    layout_positions: dict[int, tuple[float, float]] | None = None  # node_id -> (x, y)
    edge_type_counts: dict[str, int] = {}  # edge_type -> count
    cross_scope_edges: list[CrossScopeEdge] = []  # Edges crossing the scope boundary (when ?cross_scope=true)
    cross_scope_nodes: list[SocialGraphNode] = []  # Out-of-scope node endpoints (when ?cross_scope=true)


class BunkGraphMetrics(BaseModel):
    """Metrics specific to a bunk subgraph"""

    cohesion_score: float  # 0-1, how well connected the bunk is
    average_degree: float
    density: float
    isolated_count: int
    suggestions: list[str] = []


class BunkGraphResponse(BaseModel):
    """Bunk-level social subgraph"""

    bunk_cm_id: int
    bunk_name: str
    nodes: list[SocialGraphNode]
    edges: list[SocialGraphEdge]
    metrics: BunkGraphMetrics
    health_score: float  # Overall health score 0-1
    # Cross-scope edges and ghost nodes — populated when ?cross_scope=true.
    # Mirror the SocialGraphResponse shape so the frontend can reuse the same
    # createGraphElements plumbing for both the session and bunk graphs.
    cross_scope_edges: list[CrossScopeEdge] = []
    cross_scope_nodes: list[SocialGraphNode] = []


class CamperPositionUpdate(BaseModel):
    """Request body for updating a camper's position"""

    new_bunk_cm_id: int


class IncrementalUpdateResponse(BaseModel):
    """Response with minimal update data"""

    updated_node: dict[str, Any]
    affected_edges: list[dict[str, Any]]
    cache_invalidated: bool = True

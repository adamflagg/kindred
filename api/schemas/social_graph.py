"""
Pydantic schemas for social graph endpoints.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SocialGraphNode(BaseModel):
    """Node in the social graph"""

    id: int  # person_cm_id
    name: str
    grade: int | None = None
    bunk_cm_id: int | None = None
    centrality: float = 0.0
    clustering: float = 0.0
    community: int | None = None
    satisfaction_status: str | None = None  # 'satisfied', 'partial', 'isolated'
    first_year: bool = False  # True if camper has no historical attendance
    last_year_session: str | None = None  # Previous year's session name
    last_year_bunk: str | None = None  # Previous year's bunk name


class SocialGraphEdge(BaseModel):
    """Edge in the social graph"""

    source: int
    target: int
    weight: float
    type: str  # 'request', 'historical', 'sibling', 'classmate_city', 'classmate_state'
    reciprocal: bool = False
    confidence: float | None = None  # AI confidence score for request edges
    priority: int | None = None  # Priority level for request edges
    metadata: dict[str, Any] = {}  # Additional edge metadata (e.g., location for classmate edges)


class SocialGraphResponse(BaseModel):
    """Complete social graph data"""

    nodes: list[SocialGraphNode]
    edges: list[SocialGraphEdge]
    metrics: dict[str, float]
    communities: dict[int, list[int]]  # community_id -> member_ids
    warnings: list[str] = []  # Warnings about isolated campers, split groups, etc.
    layout_positions: dict[int, tuple[float, float]] | None = None  # node_id -> (x, y)
    edge_type_counts: dict[str, int] = {}  # edge_type -> count


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


class EgoNetworkResponse(BaseModel):
    """Individual's ego network"""

    center_node: SocialGraphNode
    nodes: list[SocialGraphNode]  # Includes center node
    edges: list[SocialGraphEdge]
    radius: int
    metrics: dict[str, Any]  # degree, betweenness_centrality, etc.


class CamperPositionUpdate(BaseModel):
    """Request body for updating a camper's position"""

    new_bunk_cm_id: int


class IncrementalUpdateResponse(BaseModel):
    """Response with minimal update data"""

    updated_node: dict[str, Any]
    affected_edges: list[dict[str, Any]]
    cache_invalidated: bool = True

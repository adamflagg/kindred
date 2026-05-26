"""Cross-scope assembly for the per-bunk social graph (#1606, #1610).

The bunk social-graph endpoint can return "ghost" nodes/edges for campers
connected from *outside* the current bunk. Producing those requires the full
session graph (from cache, or built on demand), scoping it to the single bunk
via :func:`bunking.graph.scope_filter.apply_scope`, and resolving each ghost's
current bunk name. This module keeps that domain orchestration out of the
FastAPI router so the router stays transport-only glue (see api/CLAUDE.md).
"""

import asyncio
from typing import Any

from pocketbase import PocketBase
from pydantic import BaseModel

from api.constants.collections import BUNKS
from bunking.graph.graph_cache_manager import GraphCacheManager
from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from bunking.graph.scope_filter import CrossScopeEdge, apply_scope
from bunking.logging_config import get_logger

logger = get_logger(__name__)


class GhostNode(BaseModel):
    """An out-of-bunk camper that a cross-scope edge points at.

    Domain payload for a cross-scope endpoint of the per-bunk graph. The API
    layer maps these to ``SocialGraphNode`` for the response; keeping a domain
    model here (rather than returning api.schemas types) avoids a layering
    inversion (bunking importing from the presentation layer).
    """

    id: int
    name: str
    grade: int | None = None
    bunk_cm_id: int | None = None
    # Human-readable name of the bunk this out-of-bunk camper is currently in.
    bunk_name: str | None = None
    centrality: float = 0.0
    clustering: float = 0.0
    community: int | None = None
    satisfaction_status: str | None = None
    parent_satisfaction_status: str | None = None
    staff_satisfaction_status: str | None = None


async def collect_bunk_cross_scope(
    *,
    graph_cache: GraphCacheManager,
    pb: PocketBase,
    session_cm_id: int,
    bunk_cm_id: int,
    year: int,
    scenario_id: str | None,
    random_seed: int,
) -> tuple[list[CrossScopeEdge], list[GhostNode]]:
    """Return the cross-scope boundary edges and ghost nodes for one bunk.

    Fetches the session graph from cache (or builds + caches it on a miss),
    scopes it to ``bunk_cm_id``, and resolves each ghost's current bunk name.
    The synchronous graph build and the PocketBase bunk-name lookup are both
    offloaded via :func:`asyncio.to_thread` so the caller's event loop is never
    blocked — matching the offload pattern used throughout the social_graph
    router.
    """
    session_graph = graph_cache.get_session_graph(session_cm_id, year, scenario_id=scenario_id)
    if session_graph is None:
        # Cache miss — build the full session graph on demand and cache it.
        builder = OptimizedSocialGraphBuilder(pb, random_seed=random_seed)
        session_graph = await asyncio.to_thread(
            builder.build_social_network, year, session_cm_id, scenario_id=scenario_id
        )
        graph_cache.cache_session_graph(session_cm_id, year, session_graph, scenario_id=scenario_id)

    if session_graph is None:
        return [], []

    _, cross_scope_edges, cross_scope_node_ids = apply_scope(
        session_graph,
        in_scope_bunk_cm_ids={bunk_cm_id},
        include_cross_scope=True,
    )

    # Resolve ghost bunk_cm_id -> bunk name (one lookup over the year's bunks),
    # only when there are ghost nodes to label.
    bunk_name_by_cm_id: dict[int, str] = {}
    if cross_scope_node_ids:
        bunks_resp = await asyncio.to_thread(
            pb.collection(BUNKS).get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        bunk_name_by_cm_id = {b.cm_id: b.name for b in bunks_resp}  # type: ignore[attr-defined]

    ghosts: list[GhostNode] = []
    for node_id in cross_scope_node_ids:
        if node_id not in session_graph.nodes:
            continue
        data: dict[str, Any] = session_graph.nodes[node_id]
        ghost_bunk_cm_id = data.get("bunk_cm_id")
        ghosts.append(
            GhostNode(
                id=node_id,
                name=data.get("name", f"Person {node_id}"),
                grade=data.get("grade"),
                bunk_cm_id=ghost_bunk_cm_id,
                bunk_name=bunk_name_by_cm_id.get(ghost_bunk_cm_id) if ghost_bunk_cm_id is not None else None,
                centrality=data.get("centrality", 0.0),
                clustering=data.get("clustering", 0.0),
                community=data.get("community"),
                satisfaction_status=data.get("satisfaction_status"),
                parent_satisfaction_status=data.get("parent_satisfaction_status"),
                staff_satisfaction_status=data.get("staff_satisfaction_status"),
            )
        )

    logger.info(f"Cross-scope for bunk {bunk_cm_id}: {len(cross_scope_edges)} cross edges, {len(ghosts)} ghost nodes")
    return cross_scope_edges, ghosts

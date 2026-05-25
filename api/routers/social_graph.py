"""
Social Graph Router - Endpoints for social graph visualization and analysis.

This router handles:
- Session-level social graph building and caching
- Bunk-level subgraph extraction with health metrics
- Individual ego network generation
- Incremental position updates for drag-drop operations
"""

import asyncio
from datetime import UTC, datetime
from typing import Annotated

import networkx as nx
from fastapi import APIRouter, Depends, HTTPException, Path, Query

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from bunking.graph.scope_filter import apply_scope, parse_scope_query, resolve_scope_bunk_ids
from bunking.logging_config import get_logger
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..constants.collections import BUNK_REQUESTS, BUNKS, PERSONS
from ..dependencies import graph_cache, pb
from ..schemas import (
    BunkGraphMetrics,
    BunkGraphResponse,
    CamperPositionUpdate,
    CrossScopeEdge,
    IncrementalUpdateResponse,
    SocialGraphEdge,
    SocialGraphNode,
    SocialGraphResponse,
)
from ..settings import get_settings

logger = get_logger(__name__)

# Load settings for graph algorithm configuration
_settings = get_settings()
GRAPH_RANDOM_SEED = _settings.graph_random_seed

router = APIRouter(tags=["social-graph"])


# ========================================
# Session Social Graph Endpoint
# ========================================


@router.get("/api/sessions/{session_cm_id}/social-graph")
async def get_session_social_graph(
    session_cm_id: Annotated[int, Path(description="Session CampMinder ID")],
    year: Annotated[int | None, Query(description="Year (defaults to current)")] = None,
    include_metrics: Annotated[bool, Query(description="Include graph metrics")] = True,
    layout: Annotated[str, Query(description="Layout algorithm: force, circle, hierarchical")] = "force",
    edge_types: Annotated[str | None, Query(description="Comma-separated edge types to include")] = None,
    scenario_id: Annotated[
        str | None,
        Query(description="Scenario ID — when set, source bunk assignments from bunk_assignments_draft"),
    ] = None,
    units: Annotated[
        str | None,
        Query(description="Comma-separated unit slugs to scope to (e.g. galil,carmel)"),
    ] = None,
    bunks: Annotated[
        str | None,
        Query(description="Comma-separated bunk codes to scope to (e.g. b-9,g-10). Lowercase bunk names."),
    ] = None,
    cross_scope: Annotated[
        bool,
        Query(description="When true and scope is active, include cross-scope edges as ghosted"),
    ] = False,
    user: AuthUser = Depends(get_current_user),
) -> SocialGraphResponse:
    """Get the full social graph for a session using NetworkX analysis.

    Args:
        session_cm_id: CampMinder session ID
        year: Year (defaults to current year)
        include_metrics: Include graph metrics (density, clustering, etc.)
        layout: Graph layout algorithm (force, circle, hierarchical)

    Returns:
        Complete social graph with nodes, edges, metrics, and communities
    """
    try:
        if year is None:
            year = datetime.now(tz=UTC).year

        logger.info(
            f"Building social graph for session {session_cm_id}, year {year}"
            f"{f', scenario {scenario_id}' if scenario_id else ''}"
        )

        # Check cache first. The cache key is scoped by scenario_id so that
        # production and scenario graphs are cached independently and cannot
        # leak into one another.
        cached_graph = graph_cache.get_session_graph(session_cm_id, year, scenario_id=scenario_id)
        if cached_graph:
            logger.info(f"Using cached graph for session {session_cm_id}")
            graph = cached_graph
        else:
            # Check if session has any bunk requests first (bunk_requests uses session_id field)
            try:
                requests_check = await asyncio.to_thread(
                    pb.collection(BUNK_REQUESTS).get_list,
                    1,
                    1,  # Just check if any exist
                    query_params={"filter": f"year = {year} && session_id = {session_cm_id}"},
                )
                has_requests = requests_check.total_items > 0
            except Exception as e:
                logger.warning(f"Failed to check for bunk requests: {e}")
                has_requests = False

            # If no requests exist, return empty graph with explanation
            if not has_requests:
                logger.info(f"No bunk requests found for session {session_cm_id}, returning empty graph")
                return SocialGraphResponse(
                    nodes=[],
                    edges=[],
                    metrics={
                        "density": 0.0,
                        "average_clustering": 0.0,
                        "number_of_components": 0,
                        "average_degree": 0.0,
                    },
                    communities={},
                    warnings=[
                        "No bunk requests found for this session. Run the bunk request sync to populate social connections."
                    ],
                    layout_positions={},
                )

            # Use optimized builder with centralized random seed setting
            builder = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

            # Build the graph — pass scenario_id so bunk assignments are sourced
            # from bunk_assignments_draft when a scenario is active.
            graph = builder.build_social_network(year, session_cm_id, scenario_id=scenario_id)

            # Cache under a scenario-scoped key so production and scenario
            # graphs are stored independently.
            graph_cache.cache_session_graph(session_cm_id, year, graph, scenario_id=scenario_id)

        # Apply scope filter if units/bunks params are present
        unit_slugs, bunk_codes = parse_scope_query(units, bunks)
        scoped_cross_edges: list[CrossScopeEdge] = []
        cross_scope_node_ids: set[int] = set()
        pre_scope_graph = graph
        if unit_slugs or bunk_codes:
            session_bunks_resp = await asyncio.to_thread(
                pb.collection(BUNKS).get_full_list,
                query_params={"filter": f"year = {year}"},
            )
            bunk_records = [
                {"cm_id": b.cm_id, "name": b.name}  # type: ignore[attr-defined]
                for b in session_bunks_resp
            ]
            in_scope_bunk_cm_ids = resolve_scope_bunk_ids(
                units=unit_slugs,
                bunk_codes=bunk_codes,
                bunks=bunk_records,
            )
            graph, scoped_cross_edges, cross_scope_node_ids = apply_scope(
                graph,
                in_scope_bunk_cm_ids=in_scope_bunk_cm_ids,
                include_cross_scope=cross_scope,
            )
            logger.info(
                f"Scope filter: units={unit_slugs} bunks={bunk_codes} "
                f"→ {len(in_scope_bunk_cm_ids)} bunks, "
                f"{graph.number_of_nodes()} nodes, "
                f"{graph.number_of_edges()} edges, "
                f"{len(scoped_cross_edges)} cross-scope edges, "
                f"{len(cross_scope_node_ids)} cross-scope ghost nodes"
            )

        # Convert to response format
        nodes = []
        for node_id in graph.nodes():
            node_data = graph.nodes[node_id]

            # Get person details - must filter by year to get correct grade
            try:
                person = await asyncio.to_thread(
                    pb.collection(PERSONS).get_first_list_item, f"cm_id = {node_id} && year = {year}"
                )
                name = f"{person.first_name} {person.last_name}"
                grade = getattr(person, "grade", None)
            except Exception:
                name = f"Person {node_id}"
                grade = None

            nodes.append(
                SocialGraphNode(
                    id=node_id,
                    name=name,
                    grade=grade,
                    bunk_cm_id=node_data.get("bunk_cm_id"),
                    centrality=node_data.get("centrality", 0.0),
                    clustering=node_data.get("clustering", 0.0),
                    community=node_data.get("community"),
                    satisfaction_status=node_data.get("satisfaction_status"),
                    parent_satisfaction_status=node_data.get("parent_satisfaction_status"),
                    staff_satisfaction_status=node_data.get("staff_satisfaction_status"),
                )
            )

        # Ghost nodes: out-of-scope endpoints of cross-scope edges. Node attrs
        # (name, grade, bunk_cm_id, etc.) are stored in the graph by the builder.
        cross_nodes: list[SocialGraphNode] = []
        for node_id in cross_scope_node_ids:
            if node_id not in pre_scope_graph.nodes:
                continue
            node_data = pre_scope_graph.nodes[node_id]
            cross_nodes.append(
                SocialGraphNode(
                    id=node_id,
                    name=node_data.get("name", f"Person {node_id}"),
                    grade=node_data.get("grade"),
                    bunk_cm_id=node_data.get("bunk_cm_id"),
                    centrality=node_data.get("centrality", 0.0),
                    clustering=node_data.get("clustering", 0.0),
                    community=node_data.get("community"),
                    satisfaction_status=node_data.get("satisfaction_status"),
                    parent_satisfaction_status=node_data.get("parent_satisfaction_status"),
                    staff_satisfaction_status=node_data.get("staff_satisfaction_status"),
                )
            )

        # Parse edge type filter
        allowed_edge_types = None
        if edge_types:
            allowed_edge_types = set(edge_types.split(","))
            logger.info(f"Filtering edges to types: {allowed_edge_types}")

        # Convert edges
        edges = []
        edge_type_counts: dict[str, int] = {}
        for source, target, data in graph.edges(data=True):
            edge_type = data.get("edge_type", "request")

            # Count edge types for metadata
            edge_type_counts[edge_type] = edge_type_counts.get(edge_type, 0) + 1

            # Filter by edge type if specified
            if allowed_edge_types and edge_type not in allowed_edge_types:
                continue

            edges.append(
                SocialGraphEdge(
                    source=source,
                    target=target,
                    weight=data.get("weight", 1.0),
                    edge_type=edge_type,
                    reciprocal=graph.has_edge(target, source),
                    confidence=data.get("confidence"),
                    request_type=data.get("request_type"),
                    metadata=data.get("metadata", {}),
                )
            )

        # Calculate metrics if requested
        metrics = {}
        if include_metrics:
            if len(graph) > 0:
                metrics = {
                    "density": nx.density(graph),
                    "average_clustering": nx.average_clustering(graph.to_undirected()),
                    "number_of_components": nx.number_weakly_connected_components(graph),
                    "average_degree": sum(dict(graph.degree()).values()) / len(graph),
                }
            else:
                metrics = {"density": 0.0, "average_clustering": 0.0, "number_of_components": 0, "average_degree": 0.0}

        # Get communities
        communities: dict[int, list[int]] = {}
        for node_id, node_data in graph.nodes(data=True):
            comm = node_data.get("community")
            if comm is not None:
                if comm not in communities:
                    communities[comm] = []
                communities[comm].append(node_id)

        # Generate warnings
        warnings = []

        # Check for isolated campers
        isolated_nodes = [node for node in graph.nodes() if graph.degree(node) == 0]
        if isolated_nodes:
            warnings.append(f"{len(isolated_nodes)} camper(s) have no social connections")

        # Check for weakly connected campers (only 1 connection)
        weakly_connected = [node for node in graph.nodes() if graph.degree(node) == 1]
        if weakly_connected:
            warnings.append(f"{len(weakly_connected)} camper(s) have only one social connection")

        # Check for split friend groups across bunks
        if communities:
            for comm_id, members in communities.items():
                if len(members) > 2:
                    # Get bunk assignments for community members
                    member_bunk_ids: set[int] = set()
                    for member in members:
                        bunk_id = graph.nodes[member].get("bunk_cm_id")
                        if bunk_id:
                            member_bunk_ids.add(bunk_id)
                    if len(member_bunk_ids) > 1:
                        warnings.append(f"Friend group {comm_id} is split across {len(member_bunk_ids)} bunks")

        # Calculate layout positions if requested
        layout_positions = None
        if layout != "none" and len(graph) > 0:
            if layout == "force":
                pos = nx.spring_layout(graph, k=1.5, iterations=50)
            elif layout == "circle":
                pos = nx.circular_layout(graph)
            elif layout == "hierarchical":
                # Create a tree from the graph for hierarchical layout
                # Use to_undirected() since is_connected only works on undirected graphs
                undirected = graph.to_undirected()
                if nx.is_connected(undirected):
                    tree = nx.minimum_spanning_tree(undirected)
                    pos = nx.spring_layout(tree)
                else:
                    pos = nx.spring_layout(graph)
            else:
                pos = nx.spring_layout(graph)  # Default to force layout

            # Convert positions to serializable format
            layout_positions = {node: (float(x), float(y)) for node, (x, y) in pos.items()}

        return SocialGraphResponse(
            nodes=nodes,
            edges=edges,
            metrics=metrics,
            communities=communities,
            warnings=warnings,
            layout_positions=layout_positions,
            edge_type_counts=edge_type_counts,
            cross_scope_edges=scoped_cross_edges,
            cross_scope_nodes=cross_nodes,
        )

    except HTTPException:
        raise
    except Exception:
        logger.error("Error building social graph", exc_info=True)
        raise


# ========================================
# Bunk Social Graph Endpoint
# ========================================


@router.get("/api/bunks/{bunk_cm_id}/social-graph")
async def get_bunk_social_graph(
    bunk_cm_id: int,
    session_cm_id: int,
    year: int | None = None,
    scenario_id: Annotated[
        str | None,
        Query(description="Scenario ID — when set, source bunk membership from bunk_assignments_draft"),
    ] = None,
    cross_scope: Annotated[
        bool,
        Query(description="When true, include edges that cross outside the bunk as ghosted context edges"),
    ] = False,
    user: AuthUser = Depends(get_current_user),
) -> BunkGraphResponse:
    """Get the social subgraph for a specific bunk.

    Args:
        bunk_cm_id: CampMinder bunk ID
        session_cm_id: CampMinder session ID (required)
        year: Year (defaults to current year)
        scenario_id: When provided, source bunk membership from the scenario's
            draft assignments so the bunk subgraph matches the active scenario.
            When absent, production (CampMinder) data is used. Cache entries
            are keyed separately per scenario so scenario and production graphs
            never collide.

    Returns:
        Bunk subgraph with health metrics and improvement suggestions
    """
    try:
        if year is None:
            year = datetime.now(tz=UTC).year

        logger.info(
            f"Building bunk social graph for bunk {bunk_cm_id}, session {session_cm_id}, year {year}"
            f"{f', scenario {scenario_id}' if scenario_id else ''}"
        )

        # Get bunk details first
        try:
            bunk = await asyncio.to_thread(pb.collection(BUNKS).get_first_list_item, f"cm_id = {bunk_cm_id}")
            bunk_name = bunk.name
        except Exception:
            bunk_name = f"Bunk {bunk_cm_id}"

        # Check cache first — scoped by scenario so production and scenario
        # graphs occupy distinct cache slots for the same bunk+session+year.
        cached_graph = graph_cache.get_bunk_graph(bunk_cm_id, session_cm_id, year, scenario_id=scenario_id)
        if cached_graph:
            logger.info(f"Using cached graph for bunk {bunk_cm_id}")
            bunk_graph = cached_graph
        else:
            # Use optimized builder with centralized random seed setting
            builder = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

            # Build bunk-specific graph with only request and sibling edges.
            # Pass scenario_id so membership is sourced from the scenario's
            # draft assignments when active.
            bunk_graph = builder.build_bunk_graph(year, bunk_cm_id, session_cm_id, scenario_id=scenario_id)

            # Cache it if not empty
            if bunk_graph.number_of_nodes() > 0:
                graph_cache.cache_bunk_graph(bunk_cm_id, session_cm_id, year, bunk_graph, scenario_id=scenario_id)

        if bunk_graph.number_of_nodes() == 0:
            logger.info(f"No members found in bunk {bunk_cm_id}, returning empty graph")
            # Return empty graph with explanation instead of 404
            return BunkGraphResponse(
                bunk_cm_id=bunk_cm_id,
                bunk_name=bunk_name,
                nodes=[],
                edges=[],
                metrics=BunkGraphMetrics(
                    cohesion_score=0.0, average_degree=0.0, density=0.0, isolated_count=0, suggestions=[]
                ),
                health_score=0.0,
            )

        # Get first-year campers by checking years_at_camp field
        first_year_campers = set()
        bunk_member_ids = list(bunk_graph.nodes())
        logger.info(f"Checking first-year status for {len(bunk_member_ids)} bunk members")

        # We'll determine first-year status when we fetch person details below

        # Convert nodes
        nodes = []
        for node_id in bunk_graph.nodes():
            node_data = bunk_graph.nodes[node_id]

            # Get person details - must filter by year to get correct grade
            try:
                person = await asyncio.to_thread(
                    pb.collection(PERSONS).get_first_list_item, f"cm_id = {node_id} && year = {year}"
                )
                name = f"{person.first_name} {person.last_name}"
                grade = getattr(person, "grade", None)

                # Check years_at_camp to determine first-year status
                years_at_camp = getattr(person, "years_at_camp", None)
                if years_at_camp == 1:
                    first_year_campers.add(node_id)
                    logger.info(f"Person {node_id} ({name}) is a first-year camper (years_at_camp={years_at_camp})")

                logger.debug(f"Bunk graph - Person {node_id} ({name}): grade={grade}, years_at_camp={years_at_camp}")
            except Exception as e:
                name = f"Person {node_id}"
                grade = None
                logger.warning(f"Failed to get person details for {node_id}: {e}")

            nodes.append(
                SocialGraphNode(
                    id=node_id,
                    name=name,
                    grade=grade,
                    bunk_cm_id=bunk_cm_id,
                    centrality=node_data.get("centrality", 0.0),
                    clustering=node_data.get("clustering", 0.0),
                    community=node_data.get("community"),
                    satisfaction_status=node_data.get("satisfaction_status"),
                    parent_satisfaction_status=node_data.get("parent_satisfaction_status"),
                    staff_satisfaction_status=node_data.get("staff_satisfaction_status"),
                    first_year=node_id in first_year_campers,
                    last_year_session=node_data.get("last_year_session"),
                    last_year_bunk=node_data.get("last_year_bunk"),
                )
            )

        # Convert edges - handle edges that may have both primary and secondary types.
        edges = []

        for source, target, data in bunk_graph.edges(data=True):
            # Use reciprocal flag from edge data (set during graph building)
            is_reciprocal = data.get("reciprocal", False)

            # Handle edges with both a primary type and a secondary_type.
            if data.get("secondary_type"):
                primary_type = data.get("edge_type", "request")
                is_request = primary_type == "request"
                secondary_type = data.get("secondary_type")

                # Add primary edge (always)
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        edge_type=primary_type,
                        reciprocal=is_reciprocal,
                        confidence=data.get("confidence") if is_request else None,
                        request_type=data.get("request_type") if is_request else None,
                    )
                )

                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=1.0,
                        edge_type=secondary_type,
                        reciprocal=is_reciprocal,
                        confidence=data.get("request_confidence"),
                    )
                )
            else:
                edge_type = data.get("edge_type", "request")
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        edge_type=edge_type,
                        reciprocal=is_reciprocal,
                        confidence=data.get("confidence"),
                        request_type=data.get("request_type"),
                    )
                )

        # Log final edge counts
        edge_type_summary: dict[str, int] = {}
        for edge in edges:
            edge_type_summary[edge.edge_type] = edge_type_summary.get(edge.edge_type, 0) + 1
        logger.info(f"Final edges being sent to frontend: {edge_type_summary}, total={len(edges)}")

        # Calculate bunk-specific metrics
        isolated_count = len([n for n in bunk_graph.nodes() if bunk_graph.degree(n) == 0])
        # Calculate density manually for directed graphs
        n = len(bunk_graph)
        density = bunk_graph.number_of_edges() / (n * (n - 1)) if n > 1 else 0.0
        avg_degree = sum(dict(bunk_graph.degree()).values()) / len(bunk_graph) if len(bunk_graph) > 0 else 0

        # Calculate cohesion score
        cohesion_score = 0.0
        if len(bunk_graph) > 1:
            # Base score on connectivity (use weakly connected for directed graphs)
            if nx.is_weakly_connected(bunk_graph):
                cohesion_score = 0.5
            else:
                # Penalize based on number of components
                num_components = nx.number_weakly_connected_components(bunk_graph)
                cohesion_score = max(0.0, 0.5 - (num_components - 1) * 0.1)

            # Add density component
            cohesion_score += density * 0.3

            # Add degree distribution component
            if avg_degree >= 2.0:
                cohesion_score += 0.2
            else:
                cohesion_score += (avg_degree / 2.0) * 0.2

        # Overall health score
        health_score = cohesion_score
        if isolated_count > 0:
            health_score *= 1 - isolated_count / len(bunk_graph)

        metrics = BunkGraphMetrics(
            cohesion_score=cohesion_score,
            average_degree=avg_degree,
            density=density,
            isolated_count=isolated_count,
            suggestions=[],  # No suggestions for bunk view
        )

        # Cross-scope edges — fetch the full session graph (from cache if available),
        # scope it to just this bunk, and collect the boundary edges + ghost nodes.
        # Reuses the same apply_scope infra as the session-level endpoint.
        cross_scope_edges_out: list[CrossScopeEdge] = []
        cross_scope_nodes_out: list[SocialGraphNode] = []
        if cross_scope:
            session_graph = graph_cache.get_session_graph(session_cm_id, year, scenario_id=scenario_id)
            if session_graph is None:
                # Build and cache the session graph on demand. This is a fallback —
                # in normal usage the session graph is already cached when a user
                # navigates from the session view to the bunk modal.
                builder_full = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)
                # Offload the synchronous build to a worker thread so it doesn't
                # block the event loop — matches every other build/IO call in
                # this router (e.g. the bunks/persons fetches above).
                session_graph = await asyncio.to_thread(
                    builder_full.build_social_network, year, session_cm_id, scenario_id=scenario_id
                )
                graph_cache.cache_session_graph(session_cm_id, year, session_graph, scenario_id=scenario_id)

            if session_graph is not None:
                _, scoped_cross_edges, cross_scope_node_ids = apply_scope(
                    session_graph,
                    in_scope_bunk_cm_ids={bunk_cm_id},
                    include_cross_scope=True,
                )
                cross_scope_edges_out = scoped_cross_edges

                # Resolve each ghost's bunk_cm_id → bunk name so the UI can show
                # which bunk an out-of-bunk camper is currently assigned to.
                # One lookup over the year's bunks (mirrors the session endpoint),
                # only when there are ghost nodes to label.
                bunk_name_by_cm_id: dict[int, str] = {}
                if cross_scope_node_ids:
                    session_bunks_resp = await asyncio.to_thread(
                        pb.collection(BUNKS).get_full_list,
                        query_params={"filter": f"year = {year}"},
                    )
                    bunk_name_by_cm_id = {
                        b.cm_id: b.name  # type: ignore[attr-defined]
                        for b in session_bunks_resp
                    }

                # Fetch person details for ghost nodes (same pattern as session graph endpoint)
                for node_id in cross_scope_node_ids:
                    if node_id not in session_graph.nodes:
                        continue
                    node_data = session_graph.nodes[node_id]
                    ghost_bunk_cm_id = node_data.get("bunk_cm_id")
                    cross_scope_nodes_out.append(
                        SocialGraphNode(
                            id=node_id,
                            name=node_data.get("name", f"Person {node_id}"),
                            grade=node_data.get("grade"),
                            bunk_cm_id=ghost_bunk_cm_id,
                            bunk_name=bunk_name_by_cm_id.get(ghost_bunk_cm_id),
                            centrality=node_data.get("centrality", 0.0),
                            clustering=node_data.get("clustering", 0.0),
                            community=node_data.get("community"),
                            satisfaction_status=node_data.get("satisfaction_status"),
                            parent_satisfaction_status=node_data.get("parent_satisfaction_status"),
                            staff_satisfaction_status=node_data.get("staff_satisfaction_status"),
                        )
                    )
            logger.info(
                f"Cross-scope for bunk {bunk_cm_id}: "
                f"{len(cross_scope_edges_out)} cross edges, "
                f"{len(cross_scope_nodes_out)} ghost nodes"
            )

        return BunkGraphResponse(
            bunk_cm_id=bunk_cm_id,
            bunk_name=bunk_name,
            nodes=nodes,
            edges=edges,
            metrics=metrics,
            health_score=health_score,
            cross_scope_edges=cross_scope_edges_out,
            cross_scope_nodes=cross_scope_nodes_out,
        )

    except HTTPException:
        raise
    except Exception:
        logger.error("Error building bunk social graph", exc_info=True)
        raise


# ========================================
# Incremental Update Endpoint for Drag-Drop Operations
# ========================================


@router.patch("/api/sessions/{session_cm_id}/campers/{person_cm_id}/position")
async def update_camper_position(
    session_cm_id: int,
    person_cm_id: int,
    update: CamperPositionUpdate,
    year: int | None = None,
    scenario_id: Annotated[
        str | None,
        Query(description="Scenario ID — when set, source bunk assignments from bunk_assignments_draft"),
    ] = None,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> IncrementalUpdateResponse:
    """Update a camper's bunk position and return incremental changes.

    This endpoint is optimized for drag-drop operations to avoid full graph rebuilds.

    Args:
        session_cm_id: CampMinder session ID
        person_cm_id: CampMinder person ID
        update: New bunk assignment
        year: Year (defaults to current year)
        scenario_id: Optional scenario ID — cache reads/writes use the scenario-scoped slot

    Returns:
        Incremental update data with only affected nodes/edges
    """
    try:
        if year is None:
            year = datetime.now(tz=UTC).year

        logger.info(f"Updating position for person {person_cm_id} to bunk {update.new_bunk_cm_id}")

        # Use optimized builder for incremental update with centralized random seed
        builder = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

        # First ensure we have the graph built (will use cache if available).
        # Pass scenario_id so we read/write the scenario-scoped cache slot — without
        # this the re-cache lands in the "prod" slot while reads look in the scenario
        # slot, making the re-cache wasted work.
        cached_graph = graph_cache.get_session_graph(session_cm_id, year, scenario_id=scenario_id)
        if not cached_graph:
            # Build it if not cached — pass scenario_id so bunk assignments are sourced
            # from bunk_assignments_draft when a scenario is active.  Without this the
            # graph is built from production data and then stored under the scenario-scoped
            # cache key, poisoning that slot with stale production data.
            graph = builder.build_social_network(year, session_cm_id, scenario_id=scenario_id)
            graph_cache.cache_session_graph(session_cm_id, year, graph, scenario_id=scenario_id)
        else:
            # Use the builder's graph
            builder.graph = cached_graph

        # Perform incremental update
        update_result = builder.update_node_position(person_cm_id, update.new_bunk_cm_id, session_cm_id, year)

        # Invalidate caches for affected graphs
        invalidated_count = graph_cache.invalidate_for_person(person_cm_id)
        logger.info(f"Invalidated {invalidated_count} cached graphs after position update")

        return IncrementalUpdateResponse(
            updated_node=update_result["updated_node"],
            affected_edges=update_result["affected_edges"],
            cache_invalidated=True,
        )

    except ValueError as e:
        logger.error(f"Invalid update request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.error("Error updating camper position", exc_info=True)
        raise

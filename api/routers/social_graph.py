"""
Social Graph Router - Endpoints for social graph visualization and analysis.

This router handles:
- Session-level social graph building and caching
- Bunk-level subgraph extraction with health metrics
- Individual ego network generation
- Incremental position updates for drag-drop operations
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from bunking.graph.social_graph_builder import SocialGraphBuilder

from ..dependencies import graph_cache, pb
from ..schemas import (
    BunkGraphMetrics,
    BunkGraphResponse,
    CamperPositionUpdate,
    EgoNetworkResponse,
    IncrementalUpdateResponse,
    SocialGraphEdge,
    SocialGraphNode,
    SocialGraphResponse,
)
from ..settings import get_settings

logger = logging.getLogger(__name__)

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
    include_historical: Annotated[bool, Query(description="Include historical data")] = False,
    layout: Annotated[str, Query(description="Layout algorithm: force, circle, hierarchical")] = "force",
    edge_types: Annotated[str | None, Query(description="Comma-separated edge types to include")] = None,
) -> SocialGraphResponse:
    """Get the full social graph for a session using NetworkX analysis.

    Args:
        session_cm_id: CampMinder session ID
        year: Year (defaults to current year)
        include_metrics: Include graph metrics (density, clustering, etc.)
        include_historical: Include edges from historical bunking data
        layout: Graph layout algorithm (force, circle, hierarchical)

    Returns:
        Complete social graph with nodes, edges, metrics, and communities
    """
    try:
        if year is None:
            year = datetime.now().year

        logger.info(f"Building social graph for session {session_cm_id}, year {year}")

        # Check cache first
        cached_graph = graph_cache.get_session_graph(session_cm_id, year)
        if cached_graph:
            logger.info(f"Using cached graph for session {session_cm_id}")
            graph = cached_graph
        else:
            # Check if session has any bunk requests first (bunk_requests uses session_id field)
            try:
                requests_check = await asyncio.to_thread(
                    pb.collection("bunk_requests").get_list,
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

            # Build the graph
            graph = builder.build_social_network(year, session_cm_id)

            # Cache it
            graph_cache.cache_session_graph(session_cm_id, year, graph)

        # Convert to response format
        nodes = []
        for node_id in graph.nodes():
            node_data = graph.nodes[node_id]

            # Get person details - must filter by year to get correct grade
            try:
                person = await asyncio.to_thread(
                    pb.collection("persons").get_first_list_item, f"cm_id = {node_id} && year = {year}"
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

            # Handle bundled edges
            if edge_type == "bundled":
                # For bundled edges, include all relationship types
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        type=edge_type,
                        reciprocal=graph.has_edge(target, source),
                        confidence=data.get("metadata", {}).get("request", {}).get("confidence"),
                        priority=data.get("metadata", {}).get("request", {}).get("priority"),
                        metadata={
                            "types": data.get("types", []),
                            "bundle_count": data.get("bundle_count", 1),
                            "details": data.get("metadata", {}),
                        },
                    )
                )
            else:
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        type=edge_type,
                        reciprocal=graph.has_edge(target, source),
                        confidence=data.get("confidence"),
                        priority=data.get("priority"),
                        metadata=data.get("metadata", {}),
                    )
                )

        # Calculate metrics if requested
        metrics = {}
        if include_metrics:
            import networkx as nx

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
                    bunks = set()
                    for member in members:
                        bunk_id = graph.nodes[member].get("bunk_cm_id")
                        if bunk_id:
                            bunks.add(bunk_id)
                    if len(bunks) > 1:
                        warnings.append(f"Friend group {comm_id} is split across {len(bunks)} bunks")

        # Calculate layout positions if requested
        import networkx as nx

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
        )

    except Exception as e:
        logger.error(f"Error building social graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================
# Bunk Social Graph Endpoint
# ========================================


@router.get("/api/bunks/{bunk_cm_id}/social-graph")
async def get_bunk_social_graph(bunk_cm_id: int, session_cm_id: int, year: int | None = None) -> BunkGraphResponse:
    """Get the social subgraph for a specific bunk.

    Args:
        bunk_cm_id: CampMinder bunk ID
        session_cm_id: CampMinder session ID (required)
        year: Year (defaults to current year)

    Returns:
        Bunk subgraph with health metrics and improvement suggestions
    """
    try:
        if year is None:
            year = datetime.now().year

        logger.info(f"Building bunk social graph for bunk {bunk_cm_id}, session {session_cm_id}, year {year}")

        # Get bunk details first
        try:
            bunk = await asyncio.to_thread(pb.collection("bunks").get_first_list_item, f"cm_id = {bunk_cm_id}")
            bunk_name = bunk.name
        except Exception:
            bunk_name = f"Bunk {bunk_cm_id}"

        # Check cache first
        cached_graph = graph_cache.get_bunk_graph(bunk_cm_id, session_cm_id, year)
        if cached_graph:
            logger.info(f"Using cached graph for bunk {bunk_cm_id}")
            bunk_graph = cached_graph
        else:
            # Use optimized builder with centralized random seed setting
            builder = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

            # Build bunk-specific graph with only request and sibling edges
            bunk_graph = builder.build_bunk_graph(year, bunk_cm_id, session_cm_id)

            # Cache it if not empty
            if bunk_graph.number_of_nodes() > 0:
                graph_cache.cache_bunk_graph(bunk_cm_id, session_cm_id, year, bunk_graph)

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
                    pb.collection("persons").get_first_list_item, f"cm_id = {node_id} && year = {year}"
                )
                name = f"{person.first_name} {person.last_name}"
                grade = getattr(person, "grade", None)

                # Check years_at_camp to determine first-year status
                years_at_camp = getattr(person, "years_at_camp", None)
                if years_at_camp == 1:
                    first_year_campers.add(node_id)
                    logger.info(f"Person {node_id} ({name}) is a first-year camper (years_at_camp={years_at_camp})")

                # Log grade info for debugging
                if "mila" in name.lower() and "cowles" in name.lower():
                    logger.info(
                        f"MILA COWLES DEBUG - Person {node_id}: grade={grade}, years_at_camp={years_at_camp}, all fields: {vars(person)}"
                    )
                else:
                    logger.debug(
                        f"Bunk graph - Person {node_id} ({name}): grade={grade}, years_at_camp={years_at_camp}"
                    )
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
                    first_year=node_id in first_year_campers,
                    last_year_session=node_data.get("last_year_session"),
                    last_year_bunk=node_data.get("last_year_bunk"),
                )
            )

        # Convert edges - handle edges that may have both request and sibling relationships
        edges = []
        processed_edges = set()  # Track processed edges to avoid duplication

        # Debug: log edge counts by type
        edge_type_counts = {"request": 0, "sibling": 0, "both": 0}
        for source, target, data in bunk_graph.edges(data=True):
            if data.get("secondary_type"):
                edge_type_counts["both"] += 1
            else:
                edge_type_counts[data.get("edge_type", "unknown")] = (
                    edge_type_counts.get(data.get("edge_type", "unknown"), 0) + 1
                )
        logger.info(f"Edge type counts in bunk graph: {edge_type_counts}")

        for source, target, data in bunk_graph.edges(data=True):
            # Use reciprocal flag from edge data (set during graph building)
            is_reciprocal = data.get("reciprocal", False)

            # For sibling edges, only process once (they're always bidirectional)
            if data.get("edge_type") == "sibling":
                edge_key = tuple(sorted([source, target]))
                if edge_key in processed_edges:
                    continue
                processed_edges.add(edge_key)

            # Handle edges with both sibling and request relationships
            if data.get("secondary_type"):
                # This edge has both types - create two separate edges for frontend
                primary_type = data.get("edge_type", "request")
                secondary_type = data.get("secondary_type")
                logger.info(
                    f"Processing edge with both types: {source}->{target}, primary={primary_type}, secondary={secondary_type}"
                )

                # Add primary edge
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        type=primary_type,
                        reciprocal=is_reciprocal,
                        confidence=data.get("confidence") if primary_type == "request" else None,
                        priority=data.get("priority") if primary_type == "request" else None,
                    )
                )

                # Add secondary edge (only if it's not a sibling that we already processed)
                if secondary_type == "sibling":
                    sec_edge_key = tuple(sorted([source, target]))
                    if sec_edge_key not in processed_edges:
                        processed_edges.add(sec_edge_key)
                        edges.append(
                            SocialGraphEdge(
                                source=source,
                                target=target,
                                weight=1.5,
                                type=secondary_type,
                                reciprocal=True,  # Siblings are always reciprocal
                                confidence=None,
                                priority=None,
                            )
                        )
                else:
                    edges.append(
                        SocialGraphEdge(
                            source=source,
                            target=target,
                            weight=1.0,
                            type=secondary_type,
                            reciprocal=is_reciprocal,
                            confidence=data.get("request_confidence"),
                            priority=data.get("request_priority"),
                        )
                    )
            else:
                # Single type edge
                edge_type = data.get("edge_type", "request")
                # Siblings are always reciprocal, otherwise use the flag from edge data
                if edge_type == "sibling":
                    is_reciprocal = True
                edges.append(
                    SocialGraphEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        type=edge_type,
                        reciprocal=is_reciprocal,
                        confidence=data.get("confidence"),
                        priority=data.get("priority"),
                    )
                )

        # Log final edge counts
        edge_type_summary: dict[str, int] = {}
        for edge in edges:
            edge_type_summary[edge.type] = edge_type_summary.get(edge.type, 0) + 1
        logger.info(f"Final edges being sent to frontend: {edge_type_summary}, total={len(edges)}")

        # Calculate bunk-specific metrics
        import networkx as nx

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

        return BunkGraphResponse(
            bunk_cm_id=bunk_cm_id,
            bunk_name=bunk_name,
            nodes=nodes,
            edges=edges,
            metrics=metrics,
            health_score=health_score,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building bunk social graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================
# Ego Network Endpoint
# ========================================


@router.get("/api/persons/{person_cm_id}/ego-network")
async def get_person_ego_network(
    person_cm_id: int, session_cm_id: int | None = None, radius: int = 2, include_historical: bool = False
) -> EgoNetworkResponse:
    """Get an individual's ego network.

    Args:
        person_cm_id: CampMinder person ID
        session_cm_id: Optional session filter
        radius: Network radius (default 2)
        include_historical: Include historical connections

    Returns:
        Ego network with person's social metrics
    """
    try:
        year = datetime.now().year

        logger.info(f"Building ego network for person {person_cm_id}, radius {radius}")

        # Create builder instance with centralized random seed setting
        builder = SocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

        # Build the appropriate graph
        if session_cm_id:
            full_graph = builder.build_session_graph(year, session_cm_id)
        else:
            # Build a cross-session graph for this year
            # This would need to be implemented in SocialGraphBuilder
            raise HTTPException(status_code=400, detail="Cross-session ego networks not yet implemented")

        # Check if person is in graph
        if person_cm_id not in full_graph:
            raise HTTPException(status_code=404, detail=f"Person {person_cm_id} not found in session")

        # Get ego network
        import networkx as nx

        ego_graph = nx.ego_graph(full_graph, person_cm_id, radius=radius)

        # Get center person details - must filter by year to get correct grade
        try:
            person = await asyncio.to_thread(
                pb.collection("persons").get_first_list_item, f"cm_id = {person_cm_id} && year = {year}"
            )
            center_name = f"{person.first_name} {person.last_name}"
            center_grade = getattr(person, "grade", None)
        except Exception:
            center_name = f"Person {person_cm_id}"
            center_grade = None

        center_node = SocialGraphNode(
            id=person_cm_id,
            name=center_name,
            grade=center_grade,
            bunk_cm_id=full_graph.nodes[person_cm_id].get("bunk_cm_id"),
            centrality=full_graph.nodes[person_cm_id].get("centrality", 0.0),
            clustering=full_graph.nodes[person_cm_id].get("clustering", 0.0),
            community=full_graph.nodes[person_cm_id].get("community"),
        )

        # Convert nodes
        nodes = []
        for node_id in ego_graph.nodes():
            node_data = ego_graph.nodes[node_id]

            # Get person details - must filter by year to get correct grade
            try:
                person = await asyncio.to_thread(
                    pb.collection("persons").get_first_list_item, f"cm_id = {node_id} && year = {year}"
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
                )
            )

        # Convert edges
        edges = []
        for source, target, data in ego_graph.edges(data=True):
            edges.append(
                SocialGraphEdge(
                    source=source,
                    target=target,
                    weight=data.get("weight", 1.0),
                    type=data.get("edge_type", "request"),
                    reciprocal=ego_graph.has_edge(target, source),
                    confidence=data.get("confidence"),
                    priority=data.get("priority"),
                )
            )

        # Calculate person-specific metrics
        metrics = {
            "degree": full_graph.degree(person_cm_id),
            "degree_centrality": nx.degree_centrality(full_graph)[person_cm_id],
            "clustering_coefficient": nx.clustering(full_graph)[person_cm_id],
            "friends_count": ego_graph.degree(person_cm_id),
            "network_size": len(ego_graph) - 1,  # Exclude self
        }

        # Add betweenness centrality if graph is small enough
        if len(full_graph) < 200:
            betweenness = nx.betweenness_centrality(full_graph)
            metrics["betweenness_centrality"] = betweenness[person_cm_id]

        return EgoNetworkResponse(
            center_node=center_node,
            nodes=nodes,
            edges=edges,
            radius=radius,
            metrics=metrics,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building ego network: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================
# Incremental Update Endpoint for Drag-Drop Operations
# ========================================


@router.patch("/api/sessions/{session_cm_id}/campers/{person_cm_id}/position")
async def update_camper_position(
    session_cm_id: int, person_cm_id: int, update: CamperPositionUpdate, year: int | None = None
) -> IncrementalUpdateResponse:
    """Update a camper's bunk position and return incremental changes.

    This endpoint is optimized for drag-drop operations to avoid full graph rebuilds.

    Args:
        session_cm_id: CampMinder session ID
        person_cm_id: CampMinder person ID
        update: New bunk assignment
        year: Year (defaults to current year)

    Returns:
        Incremental update data with only affected nodes/edges
    """
    try:
        if year is None:
            year = datetime.now().year

        logger.info(f"Updating position for person {person_cm_id} to bunk {update.new_bunk_cm_id}")

        # Use optimized builder for incremental update with centralized random seed
        builder = OptimizedSocialGraphBuilder(pb, random_seed=GRAPH_RANDOM_SEED)

        # First ensure we have the graph built (will use cache if available)
        cached_graph = graph_cache.get_session_graph(session_cm_id, year)
        if not cached_graph:
            # Build it if not cached
            graph = builder.build_social_network(year, session_cm_id)
            graph_cache.cache_session_graph(session_cm_id, year, graph)
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
    except Exception as e:
        logger.error(f"Error updating camper position: {e}")
        raise HTTPException(status_code=500, detail="Failed to update camper position")

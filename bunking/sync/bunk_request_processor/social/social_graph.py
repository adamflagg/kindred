"""Native V2 Social Graph Service - Direct implementation without adapter pattern

Provides social network analysis for bunk request processing with support for
family and school relationships. All edges are informational only - used for
confidence scoring and name disambiguation, not for creating new requests."""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any

import networkx as nx

from pocketbase import PocketBase

from ..core.models import Person
from ..data.repositories.session_repository import SessionRepository
from ..resolution.interfaces import ResolutionResult

logger = logging.getLogger(__name__)


class RelationshipType(Enum):
    """Types of relationships in the social graph"""

    BUNK_REQUEST = "bunk_request"  # Explicit request from CSV
    SIBLING = "sibling"  # Same family_id
    CLASSMATE = "classmate"  # Same school and grade
    BUNKMATE = "bunkmate"  # Currently in same bunk


# Relationship weights for distance calculations
RELATIONSHIP_WEIGHTS = {
    RelationshipType.SIBLING: 3.0,  # Strongest connection
    RelationshipType.BUNKMATE: 2.0,  # Strong connection
    RelationshipType.CLASSMATE: 1.5,  # Medium connection
    RelationshipType.BUNK_REQUEST: 1.0,  # Base connection
}


class FriendGroup:
    """Represents a detected friend group in the social network"""

    def __init__(self, members: set[int], density: float, cohesion: float):
        self.members = members
        self.density = density
        self.cohesion = cohesion
        self.size = len(members)
        self.id = f"group_{min(members)}_{len(members)}"

    def __repr__(self) -> str:
        return f"FriendGroup(size={self.size}, density={self.density:.2f})"


class SocialGraph:
    """Native V2 implementation of social graph analysis.

    Builds session-specific graphs with multiple relationship types.
    All relationships are informational only and used for confidence
    scoring and name disambiguation, not for creating new requests.
    """

    def __init__(self, pb: PocketBase, year: int, session_cm_ids: list[int] | None = None):
        """Initialize the social graph service.

        Args:
            pb: PocketBase client
            year: Current year for analysis
            session_cm_ids: List of session CM IDs to analyze
        """
        self.pb = pb
        self.year = year
        self.session_cm_ids = session_cm_ids or []

        # Session repository for DB-based session queries
        self._session_repo = SessionRepository(pb)

        # Session-specific graphs to ensure isolation
        self.graphs: dict[int, nx.Graph] = {}  # session_cm_id -> graph
        self._initialized = False

        # Cache for performance
        self._ego_networks: dict[int, nx.Graph] = {}
        self._shortest_paths: dict[tuple[int, int], int | None] = {}
        self._friend_groups: dict[int, list[FriendGroup]] = {}  # session_cm_id -> List[FriendGroup]

        # Statistics per session
        self._stats: dict[int, dict[str, Any]] = {}

    async def initialize(self) -> None:
        """Build session-specific social graphs from database"""
        if self._initialized:
            return

        logger.info(f"Building social graphs for year {self.year}, sessions {self.session_cm_ids}")

        # If no sessions specified, use all valid bunking sessions from DB
        if not self.session_cm_ids:
            valid_sessions = self._session_repo.get_valid_bunking_session_ids(self.year)
            self.session_cm_ids = list(valid_sessions)
            logger.info(f"No sessions specified, using all valid sessions: {self.session_cm_ids}")

        # Build a separate graph for each session
        for session_cm_id in self.session_cm_ids:
            try:
                self.graphs[session_cm_id] = await self._build_session_graph(session_cm_id)
                self._calculate_metrics(session_cm_id)

                stats = self._stats[session_cm_id]
                logger.info(
                    f"Session {session_cm_id} graph: {stats['node_count']} nodes, "
                    f"{stats['edge_count']} edges, density={stats['density']:.3f}"
                )
            except Exception as e:
                logger.error(f"Failed to build social graph for session {session_cm_id}: {e}")
                # Initialize empty graph and stats to allow processing to continue
                self.graphs[session_cm_id] = nx.Graph()
                self._stats[session_cm_id] = {
                    "node_count": 0,
                    "edge_count": 0,
                    "density": 0.0,
                    "connected_components": 0,
                    "avg_degree": 0.0,
                    "avg_clustering": 0.0,
                }

        self._initialized = True

    async def _build_session_graph(self, session_cm_id: int) -> nx.Graph:
        """Build NetworkX graph for a specific session"""
        G = nx.Graph()

        try:
            # Build graph from legitimate data sources only
            # NO loading from bunk_requests table - that would be circular dependency

            # Add family, school, bunkmate relationships from attendees
            await self._add_informational_relationships(G, session_cm_id)

            # Add historical bunking relationships from previous years
            await self._add_historical_bunking_relationships(G, session_cm_id)

        except Exception as e:
            logger.error(f"Error building social graph for session {session_cm_id}: {e}")

        return G

    def _calculate_edge_weight(self, request: Any) -> float:
        """Calculate edge weight based on request properties"""
        base_weight = 1.0

        # Adjust by request type
        if request.request_type == "bunk_with":
            base_weight = 1.0
        elif request.request_type == "not_bunk_with":
            base_weight = -0.5  # Negative relationships
        elif request.request_type == "age_preference":
            base_weight = 0.3  # Weak connection

        # Adjust by confidence
        confidence = getattr(request, "confidence_score", 0.5)
        base_weight *= confidence

        # Boost for reciprocal requests (checked later)
        if hasattr(request, "is_reciprocal") and request.is_reciprocal:
            base_weight *= 1.5

        return base_weight

    async def _add_informational_relationships(self, G: nx.Graph, session_cm_id: int) -> None:
        """Add family, school, and bunkmate relationships (informational only)"""
        try:
            # Get all attendees for this year with person and session expanded
            filter_str = f"year = {self.year} && status = 'enrolled'"

            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": filter_str, "expand": "person,session"}
            )

            # Create lookup structures
            attendee_data: dict[int, Any] = {}
            families: dict[str, list[int]] = {}  # family_id -> [person_cm_ids]
            schools: dict[tuple[str, int | None], list[int]] = {}  # (school, grade) -> [person_cm_ids]
            bunks: dict[str, list[int]] = {}  # bunk_id -> [person_cm_ids]

            for attendee in attendees:
                # Filter by session CM ID (check expanded session)
                if not hasattr(attendee, "expand") or not attendee.expand:
                    continue
                session = attendee.expand.get("session")
                if not session or session.cm_id != session_cm_id:
                    continue

                # Get person CM ID from expanded person
                person = attendee.expand.get("person")
                if not person:
                    continue
                person_cm_id = person.cm_id
                attendee_data[person_cm_id] = attendee

                # Group by family
                if hasattr(attendee, "family_id") and attendee.family_id:
                    family_id = attendee.family_id
                    if family_id not in families:
                        families[family_id] = []
                    families[family_id].append(person_cm_id)

                # Group by school and grade
                if hasattr(attendee, "school") and attendee.school and hasattr(attendee, "grade") and attendee.grade:
                    school_key = (attendee.school, attendee.grade)
                    if school_key not in schools:
                        schools[school_key] = []
                    schools[school_key].append(person_cm_id)

                # Group by current bunk
                if hasattr(attendee, "current_bunk_id") and attendee.current_bunk_id:
                    bunk_id = attendee.current_bunk_id
                    if bunk_id not in bunks:
                        bunks[bunk_id] = []
                    bunks[bunk_id].append(person_cm_id)

            # Add sibling edges (strongest informational connection)
            for family_id, members in families.items():
                if len(members) > 1:
                    for i in range(len(members)):
                        for j in range(i + 1, len(members)):
                            self._add_informational_edge(
                                G,
                                members[i],
                                members[j],
                                RelationshipType.SIBLING,
                                RELATIONSHIP_WEIGHTS[RelationshipType.SIBLING],
                            )

            # Add classmate edges (medium informational connection)
            for (_school, _grade), members in schools.items():
                if len(members) > 1:
                    for i in range(len(members)):
                        for j in range(i + 1, len(members)):
                            self._add_informational_edge(
                                G,
                                members[i],
                                members[j],
                                RelationshipType.CLASSMATE,
                                RELATIONSHIP_WEIGHTS[RelationshipType.CLASSMATE],
                            )

            # Add bunkmate edges (strong informational connection)
            for bunk_id, members in bunks.items():
                if len(members) > 1:
                    for i in range(len(members)):
                        for j in range(i + 1, len(members)):
                            self._add_informational_edge(
                                G,
                                members[i],
                                members[j],
                                RelationshipType.BUNKMATE,
                                RELATIONSHIP_WEIGHTS[RelationshipType.BUNKMATE],
                            )

        except Exception as e:
            logger.debug(f"Could not add informational relationships: {e}")

    async def _add_historical_bunking_relationships(self, G: nx.Graph, session_cm_id: int) -> None:
        """Add historical bunking relationships from previous years using bunk_assignments table"""
        try:
            # Get all people in this session's graph
            if G.number_of_nodes() == 0:
                return

            person_cm_ids = list(G.nodes())

            # Query bunk_assignments for these people in previous years
            # Build filter in chunks to avoid overly long filter strings
            chunk_size = 25
            all_assignments = []

            for i in range(0, len(person_cm_ids), chunk_size):
                chunk = person_cm_ids[i : i + chunk_size]
                person_filter = " || ".join([f"person.cm_id = {pid}" for pid in chunk])
                filter_str = f"year < {self.year} && ({person_filter})"

                assignments = self.pb.collection("bunk_assignments").get_full_list(
                    query_params={"filter": filter_str, "expand": "person,bunk"}
                )
                all_assignments.extend(assignments)

            # Group assignments by (year, bunk) to find who bunked together
            year_bunk_members: dict[tuple[int, str], set[int]] = {}
            for assignment in all_assignments:
                expand = getattr(assignment, "expand", {}) or {}
                person_data = expand.get("person")
                bunk_data = expand.get("bunk")

                if not person_data or not bunk_data:
                    continue

                person_cm_id = getattr(person_data, "cm_id", None)
                bunk_id = getattr(bunk_data, "id", None)
                year = getattr(assignment, "year", None)

                if person_cm_id and bunk_id and year:
                    key = (year, bunk_id)
                    if key not in year_bunk_members:
                        year_bunk_members[key] = set()
                    year_bunk_members[key].add(person_cm_id)

            # Create edges for historical bunkmates
            historical_edges = 0
            processed_pairs: set[tuple[int, int]] = set()

            for (year, _bunk_id), members in year_bunk_members.items():
                # Only consider members who are in the current session's graph
                graph_members = [m for m in members if m in G]

                # Create edges between all pairs of bunkmates
                for i, person_id in enumerate(graph_members):
                    for bunkmate_id in graph_members[i + 1 :]:
                        # Avoid duplicate edges
                        pair: tuple[int, int] = (min(person_id, bunkmate_id), max(person_id, bunkmate_id))
                        if pair in processed_pairs:
                            continue
                        processed_pairs.add(pair)

                        # Weight based on recency (more recent = stronger)
                        years_ago = self.year - year
                        recency_weight = 1.0 / (1 + years_ago * 0.2)  # Decay by 20% per year

                        self._add_informational_edge(
                            G,
                            person_id,
                            bunkmate_id,
                            RelationshipType.BUNKMATE,  # Historical bunkmate
                            RELATIONSHIP_WEIGHTS[RelationshipType.BUNKMATE] * recency_weight,
                        )
                        historical_edges += 1

            if historical_edges > 0:
                logger.info(f"Added {historical_edges} historical bunking edges for session {session_cm_id}")

        except Exception as e:
            logger.debug(f"Could not add historical bunking relationships: {e}")

    def _add_informational_edge(self, G: nx.Graph, u: int, v: int, rel_type: RelationshipType, weight: float) -> None:
        """Add or update an informational edge"""
        if G.has_edge(u, v):
            # Update existing edge
            edge_data = G[u][v]
            edge_data["weight"] += weight * 0.5  # Reduce weight when combining
            if "relationship_types" not in edge_data:
                edge_data["relationship_types"] = []
            if rel_type not in edge_data["relationship_types"]:
                edge_data["relationship_types"].append(rel_type)
        else:
            # Add new edge
            G.add_edge(
                u, v, weight=weight, relationship_types=[rel_type], informational_only=True
            )  # These edges are just for signals

    def _calculate_metrics(self, session_cm_id: int) -> None:
        """Calculate graph metrics for a specific session"""
        graph = self.graphs.get(session_cm_id)
        if not graph:
            # Set empty stats so callers don't get KeyError
            self._stats[session_cm_id] = {
                "node_count": 0,
                "edge_count": 0,
                "density": 0.0,
                "components": 0,
                "average_degree": 0.0,
                "clustering_coefficient": 0.0,
            }
            return

        stats = {
            "node_count": graph.number_of_nodes(),
            "edge_count": graph.number_of_edges(),
            "density": nx.density(graph) if graph.number_of_nodes() > 0 else 0.0,
            "components": nx.number_connected_components(graph),
            "average_degree": 0.0,
            "clustering_coefficient": 0.0,
        }

        if stats["node_count"] > 0:
            degrees = [d for _, d in graph.degree()]
            stats["average_degree"] = sum(degrees) / len(degrees)

            # Only calculate clustering for smaller graphs
            if stats["node_count"] < 1000:
                stats["clustering_coefficient"] = nx.average_clustering(graph)

        self._stats[session_cm_id] = stats

    async def enhance_resolution(
        self, resolution: ResolutionResult, requester_cm_id: int, session_cm_id: int
    ) -> ResolutionResult:
        """Enhance an ambiguous resolution using social graph analysis.

        Args:
            resolution: The ambiguous resolution result
            requester_cm_id: The person making the request
            session_cm_id: The session context

        Returns:
            Enhanced resolution result with social signals
        """
        if not resolution.is_ambiguous or not resolution.candidates:
            return resolution

        # Ensure graph is initialized
        await self.initialize()

        # Get the session-specific graph
        graph = self.graphs.get(session_cm_id)
        if not graph or requester_cm_id not in graph:
            logger.warning(f"Requester {requester_cm_id} not in session {session_cm_id} graph")
            return resolution

        # Analyze each candidate
        enhanced_candidates = []

        for candidate in resolution.candidates[:5]:  # Top 5 only
            # Only consider candidates in the same session
            if candidate.session_cm_id != session_cm_id:
                continue

            social_signals = self.get_social_signals(requester_cm_id, candidate.cm_id, session_cm_id)

            # Create enhanced person with social metadata
            enhanced_person = Person(
                cm_id=candidate.cm_id,
                first_name=candidate.first_name,
                last_name=candidate.last_name,
                preferred_name=candidate.preferred_name,
                birth_date=candidate.birth_date,
                grade=candidate.grade,
                school=candidate.school,
                session_cm_id=candidate.session_cm_id,
            )

            # Add social signals to metadata
            if not hasattr(enhanced_person, "metadata"):
                enhanced_person.metadata = {}
            enhanced_person.metadata.update(social_signals)
            enhanced_candidates.append(enhanced_person)

        # Sort by social distance (lower is better) and mutual connections
        enhanced_candidates.sort(
            key=lambda p: (
                p.metadata.get("social_distance", 999),
                -p.metadata.get("mutual_connections", 0),
                -p.metadata.get("relationship_strength", 0),
            )
        )

        # Update resolution with enhanced candidates
        resolution.candidates = enhanced_candidates

        # Add enhancement metadata
        if not resolution.metadata:
            resolution.metadata = {}
        resolution.metadata["social_graph_enhanced"] = True
        resolution.metadata["graph_metrics"] = {
            "requester_degree": graph.degree(requester_cm_id),
            "requester_clustering": nx.clustering(graph, requester_cm_id),
            "component_size": len(nx.node_connected_component(graph, requester_cm_id)),
        }

        return resolution

    def get_social_signals(self, requester_cm_id: int, target_cm_id: int, session_cm_id: int) -> dict[str, Any]:
        """Get social signals between two people in a specific session.

        Args:
            requester_cm_id: The person making the request
            target_cm_id: The person being requested
            session_cm_id: The session context

        Returns:
            Dictionary with social signals
        """
        graph = self.graphs.get(session_cm_id)
        if not graph:
            return self._default_signals()

        signals = {
            "in_ego_network": False,
            "social_distance": 999,
            "mutual_connections": 0,
            "network_density": 0.0,
            "ego_network_size": 0,
            "relationship_strength": 0.0,
            "in_same_component": False,
            "found_by": "social_graph_analysis",
        }

        # Check if both nodes exist in this session's graph
        if requester_cm_id not in graph or target_cm_id not in graph:
            return signals

        # Get ego network
        ego_network = self._get_ego_network(requester_cm_id, session_cm_id)
        signals["ego_network_size"] = len(ego_network)
        signals["in_ego_network"] = target_cm_id in ego_network

        # Check component membership
        requester_component = nx.node_connected_component(graph, requester_cm_id)
        target_component = nx.node_connected_component(graph, target_cm_id)
        if requester_component == target_component:
            signals["in_same_component"] = True

        # Calculate shortest path (social distance)
        try:
            distance = self._get_shortest_path_length(requester_cm_id, target_cm_id, session_cm_id)
            signals["social_distance"] = distance
        except nx.NetworkXNoPath:
            pass

        # Count mutual connections
        requester_neighbors = set(graph.neighbors(requester_cm_id))
        target_neighbors = set(graph.neighbors(target_cm_id))
        mutual = requester_neighbors & target_neighbors
        signals["mutual_connections"] = len(mutual)

        # Calculate local network density
        if len(ego_network) > 1:
            ego_subgraph = graph.subgraph(ego_network | {requester_cm_id})
            signals["network_density"] = nx.density(ego_subgraph)

        # Direct connection strength and relationship types
        if graph.has_edge(requester_cm_id, target_cm_id):
            edge_data = graph[requester_cm_id][target_cm_id]
            signals["relationship_strength"] = edge_data.get("weight", 1.0)
            signals["social_distance"] = 1

            # Include relationship types for transparency
            rel_types = edge_data.get("relationship_types", [])
            signals["relationship_types"] = [rt.value if hasattr(rt, "value") else str(rt) for rt in rel_types]
            signals["informational_only"] = edge_data.get("informational_only", False)

        return signals

    def detect_friend_groups(self, session_cm_id: int, min_size: int = 3, max_size: int = 8) -> list[FriendGroup]:
        """Detect natural friend groups using community detection for a specific session.

        Args:
            session_cm_id: The session to analyze
            min_size: Minimum group size
            max_size: Maximum group size

        Returns:
            List of detected friend groups
        """
        if not self._initialized:
            raise RuntimeError("Graph not initialized. Call initialize() first.")

        graph = self.graphs.get(session_cm_id)
        if not graph:
            logger.warning(f"No graph available for session {session_cm_id}")
            return []

        # Check cache
        if session_cm_id in self._friend_groups:
            return [g for g in self._friend_groups[session_cm_id] if min_size <= g.size <= max_size]

        groups = []

        # Use Louvain community detection
        try:
            import community as community_louvain

            partition = community_louvain.best_partition(graph)

            # Group nodes by community
            communities: dict[int, set[int]] = {}
            for node, comm_id in partition.items():
                if comm_id not in communities:
                    communities[comm_id] = set()
                communities[comm_id].add(node)

            # Convert to FriendGroup objects
            for comm_id, members in communities.items():
                if min_size <= len(members) <= max_size:
                    # Calculate group metrics
                    subgraph = graph.subgraph(members)
                    density = nx.density(subgraph)
                    cohesion = self._calculate_cohesion(subgraph)

                    group = FriendGroup(members, density, cohesion)
                    groups.append(group)

        except ImportError:
            # Fallback to clique-based detection
            logger.info("Using clique-based friend group detection")
            groups = self._detect_groups_by_cliques(graph, min_size, max_size)

        # Cache results
        if session_cm_id not in self._friend_groups:
            self._friend_groups[session_cm_id] = []
        self._friend_groups[session_cm_id] = groups

        return groups

    def _detect_groups_by_cliques(self, graph: nx.Graph, min_size: int, max_size: int) -> list[FriendGroup]:
        """Fallback friend group detection using cliques"""
        groups = []

        # Find all maximal cliques
        cliques = list(nx.find_cliques(graph))

        # Filter by size and convert to FriendGroups
        for clique in cliques:
            if min_size <= len(clique) <= max_size:
                members = set(clique)
                subgraph = graph.subgraph(members)
                density = nx.density(subgraph)  # Always 1.0 for cliques
                cohesion = self._calculate_cohesion(subgraph)

                group = FriendGroup(members, density, cohesion)
                groups.append(group)

        return groups

    def _calculate_cohesion(self, subgraph: nx.Graph) -> float:
        """Calculate group cohesion metric"""
        if subgraph.number_of_nodes() < 2:
            return 0.0

        # Cohesion based on average edge weight
        total_weight = sum(data.get("weight", 1.0) for _, _, data in subgraph.edges(data=True))
        num_edges = subgraph.number_of_edges()

        if num_edges == 0:
            return 0.0

        avg_weight = total_weight / num_edges
        max_possible_edges = (subgraph.number_of_nodes() * (subgraph.number_of_nodes() - 1)) / 2

        # Normalize by density and average weight
        cohesion = (num_edges / max_possible_edges) * avg_weight
        result: float = min(1.0, cohesion)
        return result

    def find_isolated_campers(self, session_cm_id: int, threshold: int = 1) -> list[int]:
        """Find campers with few or no connections in a specific session.

        Args:
            session_cm_id: The session to analyze
            threshold: Maximum number of connections to be considered isolated

        Returns:
            List of isolated camper IDs
        """
        if not self._initialized:
            raise RuntimeError("Graph not initialized. Call initialize() first.")

        graph = self.graphs.get(session_cm_id)
        if not graph:
            logger.warning(f"No graph available for session {session_cm_id}")
            return []

        isolated = []

        for node in graph.nodes():
            degree = graph.degree(node)
            if degree <= threshold:
                isolated.append(node)

        return isolated

    def get_graph_metrics(self) -> dict[int, dict[str, Any]]:
        """Get comprehensive graph metrics"""
        return self._stats.copy()

    def _get_ego_network(self, node: int, session_cm_id: int, radius: int = 1) -> set[int]:
        """Get cached ego network for a node in a specific session"""
        graph = self.graphs.get(session_cm_id)
        if not graph or node not in graph:
            return set()

        cache_key = node  # Simplified cache key using just node
        if cache_key not in self._ego_networks:
            ego_graph = nx.ego_graph(graph, node, radius=radius)
            self._ego_networks[cache_key] = ego_graph
        ego_nodes: set[int] = set(self._ego_networks[cache_key].nodes()) - {node}
        return ego_nodes

    def _get_shortest_path_length(self, source: int, target: int, session_cm_id: int) -> int:
        """Get cached shortest path length in a specific session"""
        graph = self.graphs.get(session_cm_id)
        if not graph:
            raise nx.NetworkXNoPath("No graph for session")

        cache_key: tuple[int, int] = (min(source, target), max(source, target))
        if cache_key not in self._shortest_paths:
            path_length: int = nx.shortest_path_length(graph, source, target)
            self._shortest_paths[cache_key] = path_length
        result = self._shortest_paths[cache_key]
        if result is None:
            raise nx.NetworkXNoPath("No path found")
        return result

    def _default_signals(self) -> dict[str, Any]:
        """Default signals when no graph is available"""
        return {
            "in_ego_network": False,
            "social_distance": 999,
            "mutual_connections": 0,
            "network_density": 0.0,
            "ego_network_size": 0,
            "relationship_strength": 0.0,
            "in_same_component": False,
            "found_by": "no_graph",
        }

    # =========================================================================
    # Phase 2.5 Smart Resolution Methods
    # =========================================================================

    def calculate_social_score(
        self,
        requester_cm_id: int,
        candidate_cm_id: int,
        session_cm_id: int,
        config: dict[str, Any],
        has_mutual_request: bool = False,
    ) -> float:
        """Calculate social connection score between requester and candidate.

        Scoring formula:
        - mutual_request_bonus: +10 if has mutual request
        - common_friends_weight: +1.0 per common friend
        - historical_bunking_weight: +0.8 if bunked together before

        Args:
            requester_cm_id: The person making the request
            candidate_cm_id: The candidate being evaluated
            session_cm_id: The session context
            config: Configuration with scoring weights
            has_mutual_request: Whether mutual request exists (hybrid detection)

        Returns:
            Social connection score (0.0 = no connection, higher = stronger)
        """
        score = 0.0

        # Mutual request bonus (hybrid: provided by caller from ReciprocalDetector or DB query)
        if has_mutual_request:
            score += config.get("mutual_request_bonus", 10)

        # Get graph for session
        graph = self.graphs.get(session_cm_id)
        if not graph:
            return score

        # Both must be in graph
        if requester_cm_id not in graph or candidate_cm_id not in graph:
            return score

        # Common friends bonus
        requester_neighbors = set(graph.neighbors(requester_cm_id))
        candidate_neighbors = set(graph.neighbors(candidate_cm_id))
        common_friends = requester_neighbors & candidate_neighbors
        common_friends_weight = config.get("common_friends_weight", 1.0)
        score += len(common_friends) * common_friends_weight

        # Historical bunking bonus (check for BUNKMATE relationship type)
        if graph.has_edge(requester_cm_id, candidate_cm_id):
            edge_data = graph[requester_cm_id][candidate_cm_id]
            relationship_types = edge_data.get("relationship_types", [])

            # Check if any relationship is BUNKMATE (historical)
            for rel_type in relationship_types:
                if rel_type == RelationshipType.BUNKMATE:
                    historical_weight = config.get("historical_bunking_weight", 0.8)
                    score += historical_weight
                    break

        final_social_score: float = score
        return final_social_score

    def calculate_confidence_from_score(
        self,
        score: float,
        config: dict[str, Any],
    ) -> float:
        """Convert social score to confidence value.

        Formula: 0.6 + (min(score/20, 1.0) * connection_score_weight * 0.4)
        - Base confidence: 0.6
        - Max additional: 0.4 * connection_score_weight
        - Max total (with default weight 0.7): 0.6 + 0.28 = 0.88

        Args:
            score: The social connection score
            config: Configuration with connection_score_weight

        Returns:
            Confidence value between 0.6 and ~0.88
        """
        connection_score_weight = config.get("connection_score_weight", 0.7)

        # Normalize score to 0-1 range (max out at score of 20)
        normalized = min(score / 20.0, 1.0)

        # Calculate confidence: base + (normalized * weight * max_additional)
        confidence: float = 0.6 + (normalized * connection_score_weight * 0.4)

        return confidence

    def smart_resolve_candidates(
        self,
        name: str,
        candidates: list[Person],
        requester_cm_id: int,
        session_cm_id: int,
        config: dict[str, Any],
        mutual_request_cm_ids: set[int],
    ) -> tuple[tuple[int, float, str] | None, list[Person]]:
        """Attempt to auto-resolve ambiguous candidates using social signals.

        Auto-resolves when:
        1. Best candidate has score_diff >= significant_connection_threshold (5)
        2. Best score >= min_connections_for_auto_resolve (3)
        3. Confidence >= min_confidence_for_auto_resolve (0.85)

        Architecture: Option 2 (Hybrid)
        - mutual_request_cm_ids provided by caller (from ReciprocalDetector + DB query)
        - Graph stays pure (informational relationships only)

        PARITY FIX: Always returns ranked candidates so Phase 3 gets TOP 5 by
        social score instead of arbitrary DB order. Fixes the "5-candidate limit"
        gap in MONOLITH_PARITY_TRACKER.md Section 4.

        Args:
            name: The name being resolved
            candidates: List of candidate Person objects
            requester_cm_id: The person making the request
            session_cm_id: The session context
            config: Smart resolution configuration
            mutual_request_cm_ids: Set of candidate cm_ids that have mutual requests

        Returns:
            Tuple of:
            - auto_result: (resolved_cm_id, confidence, method) if auto-resolved, else None
            - ranked_candidates: All candidates sorted by social score (highest first)
        """
        # Check if enabled
        if not config.get("enabled", True):
            return (None, candidates)

        # Need at least 1 candidate
        if not candidates:
            return (None, [])

        # Calculate scores for each candidate
        scores: dict[int, float] = {}
        for candidate in candidates:
            has_mutual = candidate.cm_id in mutual_request_cm_ids
            score = self.calculate_social_score(
                requester_cm_id=requester_cm_id,
                candidate_cm_id=candidate.cm_id,
                session_cm_id=session_cm_id,
                config=config,
                has_mutual_request=has_mutual,
            )
            scores[candidate.cm_id] = score

        # Find best and second-best scores
        sorted_candidates = sorted(candidates, key=lambda c: scores.get(c.cm_id, 0), reverse=True)
        best_candidate = sorted_candidates[0]
        best_score = scores.get(best_candidate.cm_id, 0)

        # Get second-best score for comparison
        second_best_score = 0.0
        if len(sorted_candidates) > 1:
            second_best_score = scores.get(sorted_candidates[1].cm_id, 0)

        score_diff = best_score - second_best_score

        # Check thresholds
        threshold = config.get("significant_connection_threshold", 5)
        min_connections = config.get("min_connections_for_auto_resolve", 3)
        min_confidence = config.get("min_confidence_for_auto_resolve", 0.85)

        # Calculate confidence from score
        confidence = self.calculate_confidence_from_score(best_score, config)

        # Auto-resolve if all conditions met
        if score_diff >= threshold and best_score >= min_connections and confidence >= min_confidence:
            logger.info(
                f"Smart resolution auto-resolved '{name}' to {best_candidate.cm_id} "
                f"(score={best_score:.1f}, diff={score_diff:.1f}, conf={confidence:.2f})"
            )
            return ((best_candidate.cm_id, confidence, "social_graph_auto"), sorted_candidates)

        # Can't auto-resolve - needs AI disambiguation
        # But still return ranked candidates so Phase 3 gets TOP 5 by relevance
        logger.debug(
            f"Smart resolution skipped for '{name}': "
            f"score={best_score:.1f}, diff={score_diff:.1f}, conf={confidence:.2f} "
            f"(needs: diff>={threshold}, score>={min_connections}, conf>={min_confidence})"
        )
        return (None, sorted_candidates)

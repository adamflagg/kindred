"""Relationship Analyzer - Analyzes social connections for name disambiguation

Uses the social graph to determine relationships between requesters and
potential matches, boosting confidence for people within social circles."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import networkx as nx

from ..core.models import Person

if TYPE_CHECKING:
    from ..social.social_graph import SocialGraph


@dataclass
class CandidateRelationship:
    """Relationship details between requester and a candidate"""

    candidate_cm_id: int
    is_sibling: bool = False
    is_classmate: bool = False
    is_bunkmate: bool = False
    relationship_distance: float = float("inf")
    connection_strength: float = 0.0
    mutual_connections: set[int] = field(default_factory=set)


@dataclass
class RelationshipContext:
    """Context of relationships for a name resolution attempt"""

    requester_cm_id: int
    candidate_relationships: dict[int, CandidateRelationship]


class RelationshipAnalyzer:
    """Analyzes relationships to help disambiguate names"""

    # Confidence boost factors
    SIBLING_BOOST = 0.25  # Strong boost for siblings
    BUNKMATE_BOOST = 0.15  # Good boost for bunkmates
    CLASSMATE_BOOST = 0.10  # Moderate boost for classmates
    INDIRECT_BOOST = 0.05  # Small boost for indirect connections

    def __init__(self, social_graph: SocialGraph):
        """Initialize the analyzer.

        Args:
            social_graph: SocialGraph instance for relationship analysis
        """
        self.social_graph = social_graph

    def analyze_relationships(
        self, requester: Person, candidates: list[Person], session_cm_id: int
    ) -> RelationshipContext:
        """Analyze relationships between requester and candidates.

        Args:
            requester: The person making the request
            candidates: List of potential matches
            session_cm_id: Session to analyze relationships within

        Returns:
            Context containing relationship details for each candidate
        """
        # Get the graph for this session
        graph = self.social_graph.graphs.get(session_cm_id)

        # Initialize context
        context = RelationshipContext(requester_cm_id=requester.cm_id, candidate_relationships={})

        if not graph:
            # No graph available, return empty relationships
            for candidate in candidates:
                context.candidate_relationships[candidate.cm_id] = CandidateRelationship(
                    candidate_cm_id=candidate.cm_id
                )
            return context

        # Analyze each candidate
        for candidate in candidates:
            relationship = self._analyze_candidate(graph, requester.cm_id, candidate.cm_id, session_cm_id)
            context.candidate_relationships[candidate.cm_id] = relationship

        return context

    def _analyze_candidate(
        self, graph: nx.Graph, requester_cm_id: int, candidate_cm_id: int, session_cm_id: int
    ) -> CandidateRelationship:
        """Analyze relationship between requester and a single candidate"""
        relationship = CandidateRelationship(candidate_cm_id=candidate_cm_id)

        # Check if both are in the graph
        if requester_cm_id not in graph or candidate_cm_id not in graph:
            return relationship

        # Check direct connection
        if graph.has_edge(requester_cm_id, candidate_cm_id):
            edge_data = graph[requester_cm_id][candidate_cm_id]
            edge_type = edge_data.get("type")

            # Set relationship flags based on edge type
            if edge_type:
                # Handle both string and enum types
                type_value = edge_type.value if hasattr(edge_type, "value") else edge_type
                relationship.is_sibling = type_value == "sibling"
                relationship.is_classmate = type_value == "classmate"
                relationship.is_bunkmate = type_value == "bunkmate"

            # Check for additional relationship flags in edge data
            if edge_data.get("is_classmate"):
                relationship.is_classmate = True

            # Get connection strength
            relationship.connection_strength = edge_data.get("weight", 0.0)

        # Calculate relationship distance using SocialGraph's method
        try:
            relationship.relationship_distance = float(
                self.social_graph._get_shortest_path_length(requester_cm_id, candidate_cm_id, session_cm_id)
            )
        except nx.NetworkXNoPath:
            relationship.relationship_distance = float("inf")

        # Find mutual connections
        relationship.mutual_connections = self._get_shared_connections(graph, requester_cm_id, candidate_cm_id)

        return relationship

    def _get_shared_connections(self, graph: nx.Graph, node1: int, node2: int) -> set[int]:
        """Get nodes connected to both node1 and node2"""
        if node1 not in graph or node2 not in graph:
            return set()

        neighbors1 = set(graph.neighbors(node1))
        neighbors2 = set(graph.neighbors(node2))
        return neighbors1 & neighbors2

    def get_confidence_boost(self, context: RelationshipContext, candidate_cm_id: int) -> float:
        """Calculate confidence boost based on relationships.

        Args:
            context: Relationship context from analyze_relationships
            candidate_cm_id: The candidate to get boost for

        Returns:
            Confidence boost value (0.0 to 0.3)
        """
        if candidate_cm_id not in context.candidate_relationships:
            return 0.0

        rel = context.candidate_relationships[candidate_cm_id]

        # Calculate boost based on relationship types
        boost = 0.0

        if rel.is_sibling:
            boost = max(boost, self.SIBLING_BOOST)
        if rel.is_bunkmate:
            boost = max(boost, self.BUNKMATE_BOOST)
        if rel.is_classmate:
            boost = max(boost, self.CLASSMATE_BOOST)

        # Add small boost for indirect connections
        if boost == 0.0 and rel.relationship_distance < float("inf"):
            # Decay boost with distance
            distance_factor = 1.0 / (1.0 + rel.relationship_distance)
            boost = self.INDIRECT_BOOST * distance_factor

        return min(boost, 0.3)  # Cap at 0.3 to not overwhelm other factors

    def describe_relationship(self, context: RelationshipContext, candidate_cm_id: int) -> str:
        """Generate human-readable description of relationship.

        Args:
            context: Relationship context
            candidate_cm_id: Candidate to describe

        Returns:
            Description of the relationship
        """
        if candidate_cm_id not in context.candidate_relationships:
            return "No relationship information available"

        rel = context.candidate_relationships[candidate_cm_id]

        # Build list of direct relationships
        relationships = []
        if rel.is_sibling:
            relationships.append("sibling")
        if rel.is_bunkmate:
            relationships.append("bunkmate")
        if rel.is_classmate:
            relationships.append("classmate")

        # Create description
        if relationships:
            desc = f"Direct relationship: {', '.join(relationships)}"
            if rel.mutual_connections:
                desc += f" ({len(rel.mutual_connections)} mutual connections)"
            return desc
        elif rel.relationship_distance < float("inf"):
            return f"Indirect connection through {len(rel.mutual_connections)} mutual connections"
        else:
            return "No known relationship"

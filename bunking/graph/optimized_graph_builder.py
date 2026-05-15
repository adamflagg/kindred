"""
Optimized social graph builder with performance improvements.

Implements batch operations, incremental updates, and efficient algorithms
while maintaining all data fields and readability.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

import networkx as nx

from api.constants.collections import (
    ATTENDEES,
    BUNK_ASSIGNMENTS,
    BUNK_REQUESTS,
    BUNKS,
    PERSONS,
)
from bunking.logging_config import get_logger

from .social_graph_builder import SocialGraphBuilder, build_request_edge_attrs

logger = get_logger(__name__)


class OptimizedSocialGraphBuilder(SocialGraphBuilder):
    """Performance-optimized social graph builder using batch operations."""

    def build_social_network(
        self,
        year: int,
        session_cm_id: int,
        scenario_id: str | None = None,
    ) -> nx.DiGraph:
        """Build social network with performance optimizations.

        Args:
            year: Camp year.
            session_cm_id: CampMinder session ID.
            scenario_id: Optional PocketBase ID of a saved scenario. When provided,
                bunk assignments are sourced from the ``bunk_assignments_draft``
                collection filtered by scenario. When absent, assignments come
                from the production ``bunk_assignments`` collection (CampMinder).

        Optimizations:
        - Batch node/edge operations
        - Pre-computed lookup dictionaries
        - Efficient edge deduplication
        - Rounded decimal values
        """
        logger.info(
            f"Building optimized social graph for session {session_cm_id}, year {year}"
            + (f", scenario {scenario_id}" if scenario_id else "")
        )
        start_time = time.perf_counter()

        # Initialize graph
        self.graph = nx.DiGraph()

        # Get all attendees for the session (attendees uses session relation)
        try:
            attendees = self.pb.collection(ATTENDEES).get_full_list(
                query_params={"filter": f"session.cm_id = {session_cm_id} && year = {year} && status_id = 2"}
            )
            logger.info(f"Found {len(attendees)} active attendees for session {session_cm_id}")
        except Exception as e:
            logger.error(f"Error getting attendees: {e}")
            return self.graph

        if not attendees:
            logger.warning(f"No attendees found for session {session_cm_id}, year {year}")
            return self.graph

        # Pre-fetch all person records at once (attendees uses person_id field)
        person_cm_ids: list[int] = []
        for a in attendees:
            pid = getattr(a, "person_id", None)
            if pid is not None:
                person_cm_ids.append(pid)
        persons_map = self._batch_fetch_persons(person_cm_ids)

        # Get all bunk requests for these people
        requests = self._batch_fetch_requests(person_cm_ids, session_cm_id, year)

        # Group requests by person and target for efficient processing
        # bunk_requests uses requester_id and requestee_id fields
        requests_by_person = defaultdict(list)
        requests_by_target = defaultdict(list)

        for request in requests:
            requester = getattr(request, "requester_id", None)
            requestee = getattr(request, "requestee_id", None)
            if requester:
                requests_by_person[requester].append(request)
            if requestee:
                requests_by_target[requestee].append(request)

        logger.info(f"Processing {len(requests)} bunk requests")

        # Prepare batch node data
        node_data = []
        for attendee in attendees:
            person_id: int | None = getattr(attendee, "person_id", None)
            person = persons_map.get(person_id) if person_id is not None else None
            if not person:
                logger.warning(f"Person {person_id} not found, skipping")
                continue

            # Get bunk assignment. When scenario_id is provided, source from the
            # bunk_assignments_draft collection (scenario data); otherwise use the
            # production bunk_assignments collection (CampMinder sync data).
            bunk_cm_id = None
            assignment_collection, scenario_clause = self._assignment_source(scenario_id)
            assignment_filter = (
                f"person.cm_id = {person.cm_id} && session.cm_id = {session_cm_id} && year = {year}{scenario_clause}"
            )
            try:
                assignment = self.pb.collection(assignment_collection).get_first_list_item(
                    assignment_filter,
                    query_params={"expand": "bunk"},
                )
                # Get bunk cm_id from expanded relation
                expand = getattr(assignment, "expand", {}) or {}
                bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
                bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None
            except Exception:  # noqa: S110 — intentional silent handling
                pass

            node_attrs = {
                "name": f"{person.first_name} {person.last_name}",
                "grade": person.grade,
                "age": getattr(person, "age", None),
                "gender": person.gender,
                "bunk_cm_id": bunk_cm_id,
                "division": getattr(attendee, "division", None),
                "centrality": 0.0,  # Will be calculated later
                "clustering": 0.0,  # Will be calculated later
                "years_at_camp": getattr(person, "years_at_camp", None),
            }

            node_data.append((person.cm_id, node_attrs))

        # Batch add all nodes at once
        self.graph.add_nodes_from(node_data)
        logger.debug(f"Added {len(node_data)} nodes to graph")

        # Prepare batch edge data.
        #
        # We intentionally do NOT collapse same-type mutuals into a single
        # edge with reciprocal=True. Cytoscape renders two opposite-direction
        # edges as two separate curves (one per direction), which makes per-
        # direction state visually obvious — e.g. when A requests B but B
        # requests _not_ with A, the asymmetry shows as two distinct curves.
        # Collapsing would force a double-headed arrow on a single line that
        # can't represent that asymmetry.
        edge_data = []

        # Process all requests (using requestee_id field for target person)
        for person_id, person_requests in requests_by_person.items():
            for request in person_requests:
                requestee = getattr(request, "requestee_id", None)
                if not requestee:
                    continue

                # Skip if target not in graph
                if requestee not in self.graph:
                    continue

                # Reciprocal stays as metadata (not used to dedup any more).
                # Treated as same-type mutual: A → B exists with the same
                # request_type as the reverse B → A.
                reciprocal = any(
                    getattr(r, "requester_id", None) == requestee
                    and getattr(r, "requestee_id", None) == person_id
                    and r.request_type == request.request_type
                    for r in requests_by_target.get(person_id, [])
                )

                edge_attrs = build_request_edge_attrs(
                    request,
                    reciprocal=reciprocal,
                    weight=self._calculate_edge_weight(request, reciprocal),
                    # Keep year and rounded confidence as overrides — the helper
                    # uses getattr(request, "confidence_score", 1.0) which may
                    # differ from the rounded form stored here.
                    year=getattr(request, "year", None),
                    confidence=round(request.confidence_score, 2) if request.confidence_score else None,
                )

                edge_data.append((person_id, requestee, edge_attrs))

        # Batch add all edges at once
        self.graph.add_edges_from(edge_data)
        logger.debug(f"Added {len(edge_data)} edges to graph")

        # Calculate metrics
        self._calculate_node_metrics()

        # Log performance
        build_time = time.perf_counter() - start_time
        logger.debug(
            f"Optimized graph built in {build_time:.2f}s with {self.graph.number_of_nodes()} nodes and {self.graph.number_of_edges()} edges"
        )

        return self.graph

    def _batch_fetch_persons(self, person_cm_ids: list[int]) -> dict[int, Any]:
        """Fetch all persons in batches for efficiency."""
        persons_map = {}

        # PocketBase has a limit on filter size, so batch the requests
        batch_size = 100
        for i in range(0, len(person_cm_ids), batch_size):
            batch_ids = person_cm_ids[i : i + batch_size]
            filter_str = " || ".join([f"cm_id = {pid}" for pid in batch_ids])

            try:
                persons = self.pb.collection(PERSONS).get_full_list(query_params={"filter": filter_str})
                for person in persons:
                    cm_id = getattr(person, "cm_id", None)
                    if cm_id is not None:
                        persons_map[cm_id] = person
            except Exception as e:
                logger.error(f"Error fetching persons batch: {e}")

        return persons_map

    def _batch_fetch_requests(self, person_cm_ids: list[int], session_cm_id: int, year: int) -> list[Any]:
        """Fetch all bunk requests in batches.

        Note: bunk_requests uses requester_id and session_id fields (not person_cm_id/session_cm_id).
        """
        all_requests = []

        # Batch the person IDs
        batch_size = 100
        for i in range(0, len(person_cm_ids), batch_size):
            batch_ids = person_cm_ids[i : i + batch_size]
            person_filter = " || ".join([f"requester_id = {pid}" for pid in batch_ids])
            filter_str = f"({person_filter}) && session_id = {session_cm_id} && year = {year} && status = \"resolved\" && (merged_into = '' || merged_into = null)"

            try:
                requests = self.pb.collection(BUNK_REQUESTS).get_full_list(query_params={"filter": filter_str})
                all_requests.extend(requests)
            except Exception as e:
                logger.error(f"Error fetching requests batch: {e}")

        return all_requests

    def update_node_position(
        self, person_cm_id: int, new_bunk_cm_id: int, session_cm_id: int, year: int
    ) -> dict[str, Any]:
        """Update a single node's position and return incremental changes.

        This method is designed for drag-drop operations to avoid full graph rebuilds.

        Returns:
            Dictionary with updated_node and affected_edges
        """
        if person_cm_id not in self.graph:
            raise ValueError(f"Person {person_cm_id} not found in graph")

        # Update the node's bunk assignment
        old_bunk_cm_id = self.graph.nodes[person_cm_id].get("bunk_cm_id")
        self.graph.nodes[person_cm_id]["bunk_cm_id"] = new_bunk_cm_id

        # Find all edges connected to this node
        out_edges = list(self.graph.out_edges(person_cm_id, data=True))
        in_edges = list(self.graph.in_edges(person_cm_id, data=True))

        # Prepare the response
        affected_edges = []

        # Add outgoing edges
        for source, target, data in out_edges:
            affected_edges.append(
                {
                    "source": source,
                    "target": target,
                    "type": data.get("edge_type"),
                    "request_type": data.get("request_type"),
                    "reciprocal": data.get("reciprocal", False),
                }
            )

        # Add incoming edges
        for source, target, data in in_edges:
            # Skip if already added (for reciprocal edges)
            if not any(e["source"] == source and e["target"] == target for e in affected_edges):
                affected_edges.append(
                    {
                        "source": source,
                        "target": target,
                        "type": data.get("edge_type"),
                        "request_type": data.get("request_type"),
                        "reciprocal": data.get("reciprocal", False),
                    }
                )

        # Update database (optional - could be done by caller)
        try:
            assignment = self.pb.collection(BUNK_ASSIGNMENTS).get_first_list_item(
                f"person.cm_id = {person_cm_id} && session.cm_id = {session_cm_id} && year = {year}",
                query_params={"expand": "bunk"},
            )
            # Need to find the bunk record ID for the new bunk_cm_id to update the relation
            new_bunk = self.pb.collection(BUNKS).get_first_list_item(f"cm_id = {new_bunk_cm_id}")
            self.pb.collection(BUNK_ASSIGNMENTS).update(assignment.id, {"bunk": new_bunk.id})
        except Exception as e:
            logger.warning(f"Could not update database assignment: {e}")

        return {
            "updated_node": {"id": person_cm_id, "old_bunk_cm_id": old_bunk_cm_id, "new_bunk_cm_id": new_bunk_cm_id},
            "affected_edges": affected_edges,
        }

    def _calculate_edge_weight(self, request: Any, reciprocal: bool) -> float:
        """Calculate edge weight based on request properties."""
        base_weight = 1.0

        # Double weight for reciprocal requests
        if reciprocal:
            base_weight *= 2

        # Adjust for confidence
        if hasattr(request, "confidence_score") and request.confidence_score:
            base_weight *= request.confidence_score

        return round(base_weight, 2)

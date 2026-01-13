"""
Social Graph Builder using NetworkX for advanced friend group detection
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import community as community_louvain
import networkx as nx

from pocketbase import PocketBase

logger = logging.getLogger(__name__)

# Create dedicated logger for self-referential detection
self_ref_logger = logging.getLogger("self_referential")
self_ref_handler = logging.FileHandler("logs/self_referential_caught.log")
self_ref_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
self_ref_logger.addHandler(self_ref_handler)
self_ref_logger.setLevel(logging.INFO)


@dataclass
class SocialEdge:
    """Represents a relationship between two campers"""

    weight: float
    edge_type: str  # 'request', 'sibling', 'school' (removed 'historical')
    year: int
    metadata: dict[str, Any]


@dataclass
class FriendGroupDetection:
    """Result of friend group detection"""

    members: list[int]
    cohesion_score: float
    detection_method: str  # 'clique', 'community', 'hybrid'
    edge_members: list[int]  # Kids with single connection into group
    missing_connections: list[tuple[int, int]]
    recommendation: str  # 'natural_group', 'review_needed', 'split_recommended'
    metadata: dict[str, Any]


class SocialGraphBuilder:
    """Builds and analyzes the camp social graph using NetworkX"""

    def __init__(self, pb: PocketBase, random_seed: int | None = None):
        self.pb = pb
        self.graph = nx.Graph()
        self.current_year = datetime.now().year
        self.person_cache: dict[int, dict[str, Any]] = {}
        self.attendee_cache: dict[int, list[dict[str, Any]]] = {}
        self.random_seed = random_seed

    def build_session_graph(self, year: int, session_cm_id: int) -> nx.Graph:
        """Build complete social graph for a session

        Note: Historical edges have been removed. The graph now contains:
        - Current bunk requests (bunk_with/not_bunk_with)
        - Sibling relationships (based on family_id)
        - Classmate relationships (marked as informational_only)
        """
        logger.info(f"Building social graph for year {year}, session {session_cm_id}")

        # Get session info for logging
        session_name = "Unknown"
        try:
            session = self.pb.collection("camp_sessions").get_first_list_item(f"cm_id = {session_cm_id}")
            session_name = session.name
            logger.info(f"Session type: {'AG' if 'all-gender' in session_name.lower() else 'Regular'} - {session_name}")
        except Exception as e:
            logger.warning(f"Could not get session name: {e}")

        # Reset graph
        self.graph = nx.Graph()

        # 1. Add all campers as nodes
        self._add_camper_nodes(year, session_cm_id)

        # 2. Add edges from various sources
        self._add_request_edges(year, session_cm_id)
        # Historical edges removed - only using current requests and relationships
        self._add_sibling_edges(year, session_cm_id)
        self._add_classmate_edges(year, session_cm_id)

        # 3. Bundle edges with multiple relationship types
        self._bundle_edges()

        # 4. Calculate graph metrics
        self._calculate_node_metrics()

        logger.info(f"Graph built with {self.graph.number_of_nodes()} nodes and {self.graph.number_of_edges()} edges")

        return self.graph

    def build_bunk_graph(self, year: int, bunk_cm_id: int, session_cm_id: int) -> nx.DiGraph:
        """Build a graph specifically for a single bunk with only request and sibling edges"""
        logger.info(f"Building bunk-specific graph for bunk {bunk_cm_id} in session {session_cm_id}, year {year}")

        # Create new DIRECTED graph for this bunk to preserve edge directionality
        bunk_graph = nx.DiGraph()

        # Get all members of this bunk for the specific session (uses relations)
        bunk_members = []
        try:
            assignments = self.pb.collection("bunk_assignments").get_full_list(
                query_params={
                    "filter": f"bunk.cm_id = {bunk_cm_id} && year = {year} && session.cm_id = {session_cm_id}",
                    "expand": "person,bunk,session",
                }
            )
            # Extract person cm_ids from expanded relation
            for a in assignments:
                expand = getattr(a, "expand", {}) or {}
                person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
                if person_data and hasattr(person_data, "cm_id"):
                    bunk_members.append(person_data.cm_id)
            logger.info(f"Found {len(bunk_members)} members in bunk {bunk_cm_id} for session {session_cm_id}")
        except Exception as e:
            logger.error(f"Error getting bunk members: {e}")
            return bunk_graph

        # If no members found for the specific session, check if this is an AG bunk
        # that might have assignments in a different session
        if not bunk_members:
            logger.warning(f"No members found for bunk {bunk_cm_id} in session {session_cm_id}")

            # Get bunk details to check if it's an AG bunk
            try:
                bunk = self.pb.collection("bunks").get_first_list_item(f"cm_id = {bunk_cm_id}")
                bunk_name = getattr(bunk, "name", "")

                if "AG" in bunk_name or bunk_name.startswith("AG"):
                    logger.info(f"AG bunk detected: {bunk_name}, checking all sessions for assignments")

                    # Find all sessions this bunk is assigned to (uses relations)
                    all_assignments = self.pb.collection("bunk_assignments").get_full_list(
                        query_params={
                            "filter": f"bunk.cm_id = {bunk_cm_id} && year = {year}",
                            "expand": "person,session",
                        }
                    )

                    # Group by session to find which session has assignments
                    session_counts: dict[int, int] = {}
                    for assignment in all_assignments:
                        expand = getattr(assignment, "expand", {}) or {}
                        session_data = (
                            expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                        )
                        sess_id = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                        if sess_id:
                            session_counts[sess_id] = session_counts.get(sess_id, 0) + 1

                    if session_counts:
                        # Use the session with the most assignments
                        best_session = max(session_counts.items(), key=lambda x: x[1])
                        logger.info(f"Found assignments in sessions: {session_counts}")
                        logger.info(f"Using session {best_session[0]} with {best_session[1]} assignments")

                        # Get assignments from the best session and extract person cm_ids
                        for a in all_assignments:
                            expand = getattr(a, "expand", {}) or {}
                            session_data = (
                                expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                            )
                            person_data = (
                                expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
                            )
                            sess_id = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                            if sess_id == best_session[0] and person_data and hasattr(person_data, "cm_id"):
                                bunk_members.append(person_data.cm_id)
                        logger.info(f"Found {len(bunk_members)} members in AG bunk using session {best_session[0]}")
            except Exception as e:
                logger.error(f"Error checking for AG bunk assignments: {e}")

        if not bunk_members:
            logger.warning(f"No members found for bunk {bunk_cm_id} after AG check")
            return bunk_graph

        # Add nodes for each bunk member
        for person_cm_id in bunk_members:
            # Get person details
            try:
                person = self.pb.collection("persons").get_first_list_item(f"cm_id = {person_cm_id}")

                # Get last year's historical data from bunk_assignments
                last_year_session = None
                last_year_bunk = None
                try:
                    last_year = year - 1
                    # Query bunk_assignments with expanded relations
                    historical = self.pb.collection("bunk_assignments").get_first_list_item(
                        f"person.cm_id = {person_cm_id} && year = {last_year}", query_params={"expand": "session,bunk"}
                    )
                    # Access expanded data safely
                    expand = getattr(historical, "expand", {}) or {}
                    session_data = expand.get("session")
                    bunk_data = expand.get("bunk")

                    # Only include if it's a valid session type
                    session_type = getattr(session_data, "session_type", None) if session_data else None
                    if session_type in ["main", "taste", "embedded", "ag"]:
                        last_year_session = getattr(session_data, "name", None) if session_data else None
                        last_year_bunk = getattr(bunk_data, "name", None) if bunk_data else None
                        logger.debug(
                            f"Found {last_year} history for {person_cm_id}: {last_year_session} - {last_year_bunk}"
                        )
                except Exception as e:
                    # No historical data is fine
                    logger.debug(f"No historical data for {person_cm_id} in {last_year}: {e}")
                    pass

                # Add node with attributes
                bunk_graph.add_node(
                    person_cm_id,
                    name=f"{person.first_name} {person.last_name}",
                    grade=person.grade,
                    age=getattr(person, "age", None),
                    gender=person.gender,
                    bunk_cm_id=bunk_cm_id,
                    last_year_session=last_year_session,
                    last_year_bunk=last_year_bunk,
                )
            except Exception as e:
                logger.warning(f"Could not get person details for {person_cm_id}: {e}")
                # Add minimal node
                bunk_graph.add_node(person_cm_id, bunk_cm_id=bunk_cm_id)

        # Add ONLY request edges between bunk members
        try:
            # Get all requests for members of this bunk
            requests = self.pb.collection("bunk_requests").get_full_list(
                query_params={"filter": f'year = {year} && status = "resolved"'}
            )

            logger.info(f"Processing {len(requests)} total resolved requests for year {year}")
            request_count = 0

            # Group requests by pair to detect reciprocals
            # Note: bunk_requests uses requester_id and requestee_id fields
            request_pairs = defaultdict(list)
            for request in requests:
                requester = getattr(request, "requester_id", None)
                requestee = getattr(request, "requestee_id", None)
                if (
                    requester is not None
                    and requestee is not None
                    and requester in bunk_members
                    and requestee in bunk_members
                ):
                    if requester != requestee:  # Skip self-referential
                        pair_key = (min(requester, requestee), max(requester, requestee))
                        request_pairs[pair_key].append(request)

            # Process request pairs
            for pair_key, pair_requests in request_pairs.items():
                person1, person2 = pair_key

                # Check if we have reciprocal requests
                has_forward = any(
                    getattr(r, "requester_id", None) == person1 and getattr(r, "requestee_id", None) == person2
                    for r in pair_requests
                )
                has_backward = any(
                    getattr(r, "requester_id", None) == person2 and getattr(r, "requestee_id", None) == person1
                    for r in pair_requests
                )
                is_reciprocal = has_forward and has_backward

                if is_reciprocal:
                    # Use the first request for properties
                    request = pair_requests[0]
                    priority = getattr(request, "priority", 5)
                    weight = 1.0 + (priority / 10.0)

                    # Check if sibling edge exists
                    if bunk_graph.has_edge(person1, person2):
                        edge_data = bunk_graph[person1][person2]
                        if edge_data.get("edge_type") == "sibling":
                            # Sibling edge exists, add request as secondary
                            edge_data["secondary_type"] = "request"
                            edge_data["has_request"] = True
                            edge_data["request_priority"] = priority
                            edge_data["request_confidence"] = getattr(request, "confidence_score", 1.0)
                            edge_data["weight"] = max(edge_data["weight"], weight)
                            logger.info(
                                f"Added reciprocal request as secondary type to sibling edge: {person1} <-> {person2}"
                            )
                    else:
                        # Add single reciprocal edge
                        bunk_graph.add_edge(
                            person1,
                            person2,
                            weight=weight,
                            edge_type="request",
                            edge_types=["request"],
                            priority=priority,
                            confidence=getattr(request, "confidence_score", 1.0),
                            reciprocal=True,
                        )
                        request_count += 1
                        logger.info(f"Added reciprocal request edge #{request_count}: {person1} <-> {person2}")
                else:
                    # Non-reciprocal - add each request as directed edge
                    for request in pair_requests:
                        requester = getattr(request, "requester_id", None)
                        requestee = getattr(request, "requestee_id", None)
                        req_priority = getattr(request, "priority", 5)
                        weight = 1.0 + (req_priority / 10.0)

                        # Check if sibling edge exists
                        if bunk_graph.has_edge(requester, requestee):
                            edge_data = bunk_graph[requester][requestee]
                            if edge_data.get("edge_type") == "sibling":
                                # Sibling edge exists, add request as secondary
                                edge_data["secondary_type"] = "request"
                                edge_data["has_request"] = True
                                edge_data["request_priority"] = req_priority
                                edge_data["request_confidence"] = getattr(request, "confidence_score", 1.0)
                                edge_data["weight"] = max(edge_data["weight"], weight)
                                logger.info(
                                    f"Added request as secondary type to sibling edge: {requester} -> {requestee}"
                                )
                        else:
                            # No existing edge, create request edge
                            bunk_graph.add_edge(
                                requester,
                                requestee,
                                weight=weight,
                                edge_type="request",
                                edge_types=["request"],
                                priority=req_priority,
                                confidence=getattr(request, "confidence_score", 1.0),
                                reciprocal=False,
                            )
                            request_count += 1
                            logger.info(f"Added request edge #{request_count}: {requester} -> {requestee}")

            logger.info(f"Added {request_count} request edges to bunk graph")

        except Exception as e:
            logger.error(f"Error adding request edges: {e}")

        # Add ONLY sibling edges between bunk members
        sibling_count = 0
        try:
            # Get all persons who are bunk members
            persons_data = {}
            for person_cm_id in bunk_members:
                try:
                    person = self.pb.collection("persons").get_first_list_item(f"cm_id = {person_cm_id}")
                    if person.family_id:
                        persons_data[person_cm_id] = person.family_id
                except Exception:
                    pass

            # Find siblings
            family_groups = defaultdict(list)
            for person_id, family_id in persons_data.items():
                family_groups[family_id].append(person_id)

            # Add sibling edges
            for family_id, members in family_groups.items():
                if len(members) > 1:
                    # Add BIDIRECTIONAL edges between all siblings in the same bunk
                    for i in range(len(members)):
                        for j in range(i + 1, len(members)):
                            # For sibling edges, we need to handle them differently
                            # Check if request edges already exist and add sibling info
                            for source, target in [(members[i], members[j]), (members[j], members[i])]:
                                if bunk_graph.has_edge(source, target):
                                    # Edge exists, add sibling as secondary type
                                    edge_data = bunk_graph[source][target]
                                    if "secondary_type" not in edge_data:
                                        edge_data["secondary_type"] = "sibling"
                                        edge_data["has_sibling"] = True
                                        logger.info(f"Added sibling as secondary type: {source} -> {target}")
                                else:
                                    # No existing edge, create sibling edge
                                    bunk_graph.add_edge(
                                        source, target, weight=1.5, edge_type="sibling", edge_types=["sibling"]
                                    )
                                    sibling_count += 1

                            logger.info(f"Added separate sibling edges: {members[i]} <-> {members[j]}")

            logger.info(f"Added {sibling_count} sibling edges to bunk graph")

        except Exception as e:
            logger.error(f"Error adding sibling edges: {e}")

        # Calculate basic node metrics for the bunk graph
        for node in bunk_graph.nodes():
            bunk_graph.nodes[node]["centrality"] = 0.0
            bunk_graph.nodes[node]["clustering"] = 0.0
            bunk_graph.nodes[node]["community"] = None

        # Calculate centrality if graph has edges
        if bunk_graph.number_of_edges() > 0:
            centrality = nx.degree_centrality(bunk_graph)
            for node, cent in centrality.items():
                bunk_graph.nodes[node]["centrality"] = cent

            # Calculate clustering coefficient
            clustering = nx.clustering(bunk_graph)
            for node, clust in clustering.items():
                bunk_graph.nodes[node]["clustering"] = clust

        logger.info(
            f"Bunk graph built with {bunk_graph.number_of_nodes()} nodes and {bunk_graph.number_of_edges()} edges"
        )
        logger.info(
            f"Edge types: request={len([e for e in bunk_graph.edges(data=True) if e[2].get('edge_type') == 'request'])}, "
            f"sibling={len([e for e in bunk_graph.edges(data=True) if e[2].get('edge_type') == 'sibling'])}"
        )

        return bunk_graph

    def detect_friend_groups(
        self,
        min_size: int = 3,
        max_size: int = 8,
        ignore_threshold: float = 0.70,
        manual_threshold: float = 0.85,
        auto_threshold: float = 0.95,
    ) -> list[FriendGroupDetection]:
        """Detect friend groups using multiple algorithms"""
        detections = []

        logger.info(f"Starting friend group detection with {self.graph.number_of_nodes()} nodes")

        # 1. Detect via Louvain community detection
        logger.info("Phase 1: Running Louvain community detection...")
        community_groups = self._detect_via_communities(min_size, max_size)
        logger.info(f"Found {len(community_groups)} communities via Louvain")

        # 2. Detect via clique analysis (existing method)
        logger.info("Phase 2: Running clique analysis...")
        clique_groups = self._detect_via_cliques(min_size, max_size)
        logger.info(f"Found {len(clique_groups)} groups via clique analysis")

        # 3. Merge and deduplicate detections
        logger.info("Phase 3: Merging and deduplicating detections...")
        all_groups = self._merge_detections(community_groups, clique_groups)
        logger.info(f"Merged to {len(all_groups)} unique groups")

        # 4. Analyze each group
        logger.info("Phase 4: Analyzing group cohesion and structure...")
        for i, group_members in enumerate(all_groups):
            if i % 10 == 0 and i > 0:
                logger.info(f"Analyzed {i}/{len(all_groups)} groups")

            detection = self._analyze_group(group_members, ignore_threshold, manual_threshold, auto_threshold)
            if detection:
                detections.append(detection)

        # Sort by cohesion score
        detections.sort(key=lambda d: d.cohesion_score, reverse=True)
        logger.info(f"Detection complete: {len(detections)} groups meet threshold criteria")

        logger.info(f"Detected {len(detections)} friend groups")
        return detections

    def _add_camper_nodes(self, year: int, session_cm_id: int) -> None:
        """Add all campers as nodes with attributes"""
        # Attendees uses session relation and person_id field
        attendees = self.pb.collection("attendees").get_full_list(
            query_params={"filter": f"year = {year} && session.cm_id = {session_cm_id}"}
        )

        logger.info(f"Found {len(attendees)} attendees for session {session_cm_id}")
        assignments_found = 0

        for attendee in attendees:
            # Cache attendee data - uses person_id field
            person_cm_id = getattr(attendee, "person_id", None)
            if not person_cm_id:
                continue
            if person_cm_id not in self.attendee_cache:
                self.attendee_cache[person_cm_id] = []
            self.attendee_cache[person_cm_id].append(attendee.__dict__)

            # Get person details if not cached
            if person_cm_id not in self.person_cache:
                try:
                    person = self.pb.collection("persons").get_first_list_item(f"cm_id = {person_cm_id}")
                    self.person_cache[person_cm_id] = person.__dict__
                except Exception as e:
                    logger.warning(f"Person {person_cm_id} not found: {e}")
                    continue

            person = self.person_cache[person_cm_id]

            # Get bunk assignment for this person (uses relations)
            bunk_cm_id = None
            try:
                assignment = self.pb.collection("bunk_assignments").get_first_list_item(
                    f"person.cm_id = {person_cm_id} && session.cm_id = {session_cm_id} && year = {year}",
                    query_params={"expand": "bunk"},
                )
                # Extract bunk cm_id from expanded relation
                expand = getattr(assignment, "expand", {}) or {}
                bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
                bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None
                if bunk_cm_id:
                    assignments_found += 1
                    logger.debug(
                        f"Found assignment for person {person_cm_id} in session {session_cm_id}: bunk {bunk_cm_id}"
                    )
            except Exception:
                # No assignment found
                logger.debug(f"No assignment found for person {person_cm_id} in session {session_cm_id}")
                pass

            # Get full name
            full_name = f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
            if not full_name:
                full_name = person.get("name", f"Person {person_cm_id}")

            # Add node with attributes
            # Get attributes from person data (not attendee)
            self.graph.add_node(
                person_cm_id,
                name=full_name,
                grade=person.get("grade", 0),
                age=person.get("age", 0),
                pb_id=person.get("id", ""),
                bunk_cm_id=bunk_cm_id,
            )

        logger.info(f"Total assignments found: {assignments_found} out of {len(attendees)} attendees")
        logger.info(f"Attendees without assignments: {len(attendees) - assignments_found}")

    def _add_request_edges(self, year: int, session_cm_id: int) -> None:
        """Add edges from bunk requests"""
        # bunk_requests uses session_id, requester_id, requestee_id fields
        requests = self.pb.collection("bunk_requests").get_full_list(
            query_params={
                "filter": f"year = {year} && session_id = {session_cm_id} && "
                f'request_type = "bunk_with" && status != "removed"'
            }
        )

        for request in requests:
            requester = getattr(request, "requester_id", None)
            requestee = getattr(request, "requestee_id", None)
            if requestee and requestee > 0:
                # Check for self-referential request (defense in depth)
                if requester == requestee:
                    # Log detailed information about self-referential request
                    req_priority = getattr(request, "priority", None)
                    req_confidence = getattr(request, "confidence_score", None)
                    req_status = getattr(request, "status", None)
                    self_ref_logger.warning(
                        f"Self-referential request caught in graph builder! "
                        f"Request ID: {request.id}, "
                        f"Person CM ID: {requester}, "
                        f"Year: {year}, "
                        f"Session CM ID: {session_cm_id}, "
                        f"Priority: {req_priority}, "
                        f"Confidence: {req_confidence}, "
                        f"Original Text: {getattr(request, 'original_text', 'N/A')}, "
                        f"Status: {req_status}"
                    )
                    logger.warning(
                        f"Skipping self-referential request: person {requester} "
                        f"requesting themselves (request ID: {request.id})"
                    )
                    continue  # Skip adding this edge

                # Calculate edge weight based on priority and confidence
                priority = getattr(request, "priority", 5)
                confidence_score = getattr(request, "confidence_score", 1.0)
                weight = priority * confidence_score

                self.graph.add_edge(
                    requester,
                    requestee,
                    weight=weight,
                    edge_type="request",
                    year=year,
                    priority=priority,
                    confidence=confidence_score,
                    is_reciprocal=getattr(request, "is_reciprocal", False),
                )

    def _add_sibling_edges(self, year: int, session_cm_id: int) -> None:
        """Add edges between siblings using family_id from CampMinder"""
        # Get all nodes in graph
        node_ids = list(self.graph.nodes())

        # Group persons by family_id
        family_groups = defaultdict(list)
        for node_id in node_ids:
            person = self.person_cache.get(node_id, {})
            family_id = person.get("family_id", 0)

            # Only group if family_id is valid (> 0)
            if family_id and family_id > 0:
                family_groups[family_id].append(node_id)

        # Add edges between all family members
        sibling_count = 0
        for family_id, members in family_groups.items():
            if len(members) < 2:
                continue  # No siblings if only one family member

            # Create edges between all pairs in the family
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    self.graph.add_edge(
                        members[i], members[j], weight=0.3, edge_type="sibling", year=year, family_id=family_id
                    )
                    sibling_count += 1

        logger.info(f"Added {sibling_count} sibling edges based on family_id")

    def _add_classmate_edges(self, year: int, session_cm_id: int) -> None:
        """Add edges between potential classmates based on school, city, and state"""
        # Get all nodes in graph
        node_ids = list(self.graph.nodes())
        logger.info(f"Checking for school connections among {len(node_ids)} campers")

        school_matches = 0

        # Count people with school data for debugging
        people_with_schools = sum(1 for node_id in node_ids if self.person_cache.get(node_id, {}).get("school"))
        logger.info(f"Found {people_with_schools} campers with school data")

        # Check each pair of campers
        for i in range(len(node_ids)):
            for j in range(i + 1, len(node_ids)):
                person1 = self.person_cache.get(node_ids[i], {})
                person2 = self.person_cache.get(node_ids[j], {})

                # Skip if already connected
                if self.graph.has_edge(node_ids[i], node_ids[j]):
                    continue

                # Get school info
                school1 = person1.get("school", "").strip()
                school2 = person2.get("school", "").strip()

                # Skip if no school info for either person
                if not school1 or not school2:
                    continue

                # Get addresses
                addr1 = person1.get("address", {})
                addr2 = person2.get("address", {})

                # Skip if no address info
                if not addr1 or not addr2:
                    continue

                # Get location data
                city1 = addr1.get("city", "").strip()
                city2 = addr2.get("city", "").strip()
                state1 = addr1.get("state", "").strip()
                state2 = addr2.get("state", "").strip()

                # Skip if missing any location data
                if not (city1 and city2 and state1 and state2):
                    continue

                # Get grades
                grade1 = person1.get("grade", 0)
                grade2 = person2.get("grade", 0)

                # Check for same school AND same city AND same state AND similar grade (within 1 year)
                if (
                    school1.lower() == school2.lower()
                    and city1.lower() == city2.lower()
                    and state1.lower() == state2.lower()
                    and abs(grade1 - grade2) <= 1
                ):
                    # Same school - they're classmates!
                    self.graph.add_edge(
                        node_ids[i],
                        node_ids[j],
                        weight=0.3,
                        edge_type="school",
                        year=year,
                        metadata={
                            "school": school1,
                            "city": city1,
                            "state": state1,
                            "informational_only": True,  # Mark as informational edge
                        },
                    )
                    school_matches += 1
                    if school_matches <= 5:  # Log first few matches
                        logger.info(
                            f"Found school match: {person1.get('first_name', '')} {person1.get('last_name', '')} and {person2.get('first_name', '')} {person2.get('last_name', '')} at {school1}"
                        )

        logger.info(f"Added {school_matches} school-based classmate edges")

    def _bundle_edges(self) -> None:
        """Bundle multiple edges between same nodes into a single edge with metadata"""
        # Create a new graph to rebuild with bundled edges
        bundled_graph = nx.Graph()

        # Copy all nodes with their attributes
        for node, attrs in self.graph.nodes(data=True):
            bundled_graph.add_node(node, **attrs)

        # Track edge types between each pair of nodes
        edge_bundles: dict[tuple[int, int], dict[str, Any]] = defaultdict(
            lambda: {"types": [], "weights": [], "metadata": {}}
        )

        # Collect all edges and their types
        for u, v, data in self.graph.edges(data=True):
            # Create a sorted tuple to ensure consistency
            edge_key = tuple(sorted([u, v]))
            edge_type = data.get("edge_type", "unknown")

            bundle = edge_bundles[edge_key]
            bundle["types"].append(edge_type)
            bundle["weights"].append(data.get("weight", 1.0))

            # Store type-specific metadata
            if edge_type not in bundle["metadata"]:
                bundle["metadata"][edge_type] = {}

            # Copy relevant attributes for each edge type
            if edge_type == "request":
                bundle["metadata"][edge_type] = {
                    "priority": data.get("priority"),
                    "confidence": data.get("confidence", 0.5),
                    "is_reciprocal": data.get("is_reciprocal", False),
                }
            elif edge_type == "sibling":
                bundle["metadata"][edge_type] = {"family_id": data.get("family_id")}
            elif edge_type == "school":
                bundle["metadata"][edge_type] = data.get("metadata", {})

        # Create bundled edges
        bundled_count = 0
        for (u, v), bundle in edge_bundles.items():
            if len(bundle["types"]) > 1:
                # Multiple relationship types - create bundled edge
                bundled_graph.add_edge(
                    u,
                    v,
                    edge_type="bundled",
                    types=bundle["types"],
                    weight=max(bundle["weights"]),  # Use highest weight
                    metadata=bundle["metadata"],
                    bundle_count=len(bundle["types"]),
                )
                bundled_count += 1
            else:
                # Single relationship type - copy as is
                edge_type = bundle["types"][0]
                bundled_graph.add_edge(
                    u, v, edge_type=edge_type, weight=bundle["weights"][0], **bundle["metadata"].get(edge_type, {})
                )

        # Replace the graph with the bundled version
        self.graph = bundled_graph
        logger.info(f"Bundled {bundled_count} multi-relationship edges")

    def _calculate_node_metrics(self) -> None:
        """Calculate and store node-level metrics"""
        # Degree centrality
        degree_centrality = nx.degree_centrality(self.graph)
        nx.set_node_attributes(self.graph, degree_centrality, "centrality")

        # Clustering coefficient (how connected are a node's neighbors)
        clustering = nx.clustering(self.graph)
        nx.set_node_attributes(self.graph, clustering, "clustering")

        # Connected component size
        components = list(nx.connected_components(self.graph))
        component_map = {}
        for _i, component in enumerate(components):
            for node in component:
                component_map[node] = len(component)
        nx.set_node_attributes(self.graph, component_map, "component_size")

        # Calculate request satisfaction based on actual bunk assignments
        satisfaction_map = {}
        for node in self.graph.nodes():
            node_data = self.graph.nodes[node]
            node_bunk = node_data.get("bunk_cm_id")

            # Get all request edges for this node
            request_edges = [(n, data) for n, data in self.graph[node].items() if data.get("edge_type") == "request"]

            if not request_edges:
                # No requests - check if isolated
                satisfaction_map[node] = "isolated" if self.graph.degree(node) == 0 else "satisfied"
            else:
                # Check how many requests are satisfied
                satisfied_count = 0
                for requested_person, _edge_data in request_edges:
                    requested_bunk = self.graph.nodes[requested_person].get("bunk_cm_id")
                    if node_bunk and requested_bunk and node_bunk == requested_bunk:
                        satisfied_count += 1

                # Determine satisfaction status
                if satisfied_count == len(request_edges):
                    satisfaction_map[node] = "satisfied"
                elif satisfied_count > 0:
                    satisfaction_map[node] = "partial"
                else:
                    satisfaction_map[node] = "isolated"

        nx.set_node_attributes(self.graph, satisfaction_map, "satisfaction_status")

    def _detect_via_communities(self, min_size: int, max_size: int) -> list[set[int]]:
        """Detect communities using Louvain algorithm"""
        groups: list[set[int]] = []

        # Only process the largest connected component for now
        if self.graph.number_of_nodes() == 0:
            return groups

        # Apply Louvain community detection
        try:
            partition = community_louvain.best_partition(self.graph, random_state=self.random_seed)

            # Group nodes by community
            communities = defaultdict(set)
            for node, comm_id in partition.items():
                communities[comm_id].add(node)

            # Filter by size
            for community in communities.values():
                if min_size <= len(community) <= max_size:
                    groups.append(community)

        except Exception as e:
            logger.warning(f"Community detection failed: {e}")

        return groups

    def _detect_via_cliques(self, min_size: int, max_size: int) -> list[set[int]]:
        """Detect groups via clique analysis with triangle pre-filtering (NetworkX 3.6+)

        Uses all_triangles() to identify tightly connected nodes before
        running full clique detection, improving performance on sparse graphs.
        """
        groups = []

        # Pre-filter using triangles (NetworkX 3.6+)
        # Nodes that participate in triangles are more likely to be in cliques
        triangle_nodes: set[int] = set()
        try:
            for n1, n2, n3 in nx.all_triangles(self.graph):
                triangle_nodes.update([n1, n2, n3])
            logger.debug(f"Found {len(triangle_nodes)} nodes participating in triangles")
        except Exception as e:
            logger.warning(f"Triangle detection failed, falling back to full clique search: {e}")
            triangle_nodes = set(self.graph.nodes())

        # If we have triangle nodes, search for cliques in that subgraph first
        if triangle_nodes and len(triangle_nodes) < self.graph.number_of_nodes():
            triangle_subgraph = self.graph.subgraph(triangle_nodes)
            cliques = list(nx.find_cliques(triangle_subgraph))
        else:
            # Fall back to full graph clique detection
            cliques = list(nx.find_cliques(self.graph))

        # Filter by size and convert to sets
        for clique in cliques:
            if min_size <= len(clique) <= max_size:
                groups.append(set(clique))

        return groups

    def _merge_detections(self, community_groups: list[set[int]], clique_groups: list[set[int]]) -> list[set[int]]:
        """Merge and deduplicate group detections"""
        all_groups = []

        # Add all groups
        for group in community_groups:
            all_groups.append(group)

        for clique in clique_groups:
            # Check if this clique is a subset of any community group
            is_subset = False
            for comm_group in community_groups:
                if clique.issubset(comm_group):
                    is_subset = True
                    break

            if not is_subset:
                all_groups.append(clique)

        # Remove duplicates and near-duplicates
        unique_groups: list[set[int]] = []
        for group in all_groups:
            is_duplicate = False
            for existing in unique_groups:
                # If 80% overlap, consider duplicate
                overlap = len(group & existing) / min(len(group), len(existing))
                if overlap > 0.8:
                    is_duplicate = True
                    # Keep the larger group
                    if len(group) > len(existing):
                        unique_groups.remove(existing)
                        unique_groups.append(group)
                    break

            if not is_duplicate:
                unique_groups.append(group)

        return unique_groups

    def _analyze_group(
        self, members: set[int], ignore_threshold: float, manual_threshold: float, auto_threshold: float
    ) -> FriendGroupDetection | None:
        """Analyze a detected group and generate detection result"""
        members_list = list(members)

        # Calculate cohesion score (edge density within group)
        subgraph = self.graph.subgraph(members_list)
        possible_edges = len(members_list) * (len(members_list) - 1) / 2
        actual_edges = subgraph.number_of_edges()
        cohesion = actual_edges / possible_edges if possible_edges > 0 else 0

        # Skip if below ignore threshold
        if cohesion < ignore_threshold:
            return None

        # Find edge members (kids with exactly 1 connection to the group)
        edge_members = []
        for node in self.graph.nodes():
            if node not in members:
                connections_to_group = sum(1 for member in members if self.graph.has_edge(node, member))
                if connections_to_group == 1:
                    edge_members.append(node)

        # Find missing connections within group
        missing_connections = []
        for i in range(len(members_list)):
            for j in range(i + 1, len(members_list)):
                if not subgraph.has_edge(members_list[i], members_list[j]):
                    missing_connections.append((members_list[i], members_list[j]))

        # Determine detection method
        if actual_edges == possible_edges:
            detection_method = "clique"
        elif len(missing_connections) <= 2:
            detection_method = "hybrid"
        else:
            detection_method = "community"

        # Make recommendation
        if cohesion >= auto_threshold:
            recommendation = "natural_group"
        elif cohesion >= manual_threshold:
            recommendation = "review_needed"
        else:
            recommendation = "split_recommended"

        # Calculate additional metrics
        avg_degree = sum(subgraph.degree(n) for n in members_list) / len(members_list)

        # Find core subgroup using densest_subgraph (NetworkX 3.6+)
        core_info = None
        if len(members_list) >= 4:
            try:
                density, core_nodes = nx.approximation.densest_subgraph(subgraph)
                core_info = {
                    "core_members": list(core_nodes),
                    "core_density": density,
                    "core_size": len(core_nodes),
                }
            except Exception as e:
                logger.debug(f"Could not compute densest subgraph for group: {e}")

        return FriendGroupDetection(
            members=members_list,
            cohesion_score=cohesion,
            detection_method=detection_method,
            edge_members=edge_members,
            missing_connections=missing_connections,
            recommendation=recommendation,
            metadata={
                "actual_edges": actual_edges,
                "possible_edges": possible_edges,
                "average_degree": avg_degree,
                "edge_member_count": len(edge_members),
                "missing_connection_count": len(missing_connections),
                "core_group": core_info,  # NetworkX 3.6+ densest subgraph
            },
        )

    def get_graph_metrics(self) -> dict[str, Any]:
        """Get overall graph metrics"""
        if self.graph.number_of_nodes() == 0:
            return {
                "node_count": 0,
                "edge_count": 0,
                "density": 0.0,
                "average_clustering": 0.0,
                "connected_components": 0,
                "largest_component_size": 0,
                "average_degree": 0.0,
            }

        # Check if graph is directed or undirected
        is_directed = isinstance(self.graph, nx.DiGraph)

        # Get components based on graph type
        if is_directed:
            components = list(nx.weakly_connected_components(self.graph))
            num_components = nx.number_weakly_connected_components(self.graph)
        else:
            components = list(nx.connected_components(self.graph))
            num_components = nx.number_connected_components(self.graph)

        # Calculate density manually for directed graphs
        n = self.graph.number_of_nodes()
        if is_directed:
            density = self.graph.number_of_edges() / (n * (n - 1)) if n > 1 else 0.0
        else:
            density = nx.density(self.graph)

        # Calculate clustering coefficient
        if is_directed:
            # For directed graphs, convert to undirected for clustering calculation
            undirected = self.graph.to_undirected()
            avg_clustering = nx.average_clustering(undirected)
        else:
            avg_clustering = nx.average_clustering(self.graph)

        return {
            "node_count": n,
            "edge_count": self.graph.number_of_edges(),
            "density": density,
            "average_clustering": avg_clustering,
            "connected_components": num_components,
            "largest_component_size": len(max(components, key=len)) if components else 0,
            "average_degree": sum(dict(self.graph.degree()).values()) / n,
        }

    def find_isolated_campers(self, threshold: int = 1) -> list[int]:
        """Find campers with few or no connections"""
        isolated = []
        for node in self.graph.nodes():
            if self.graph.degree(node) <= threshold:
                isolated.append(node)
        return isolated

    def find_bridge_campers(self) -> list[int]:
        """Find campers who connect different groups"""
        # Calculate betweenness centrality
        betweenness = nx.betweenness_centrality(self.graph)

        # Find nodes with high betweenness (top 10%)
        threshold = (
            sorted(betweenness.values(), reverse=True)[int(len(betweenness) * 0.1)] if len(betweenness) > 10 else 0
        )

        bridges = [node for node, score in betweenness.items() if score >= threshold]
        return bridges

    def split_large_friend_group(
        self, members: list[int], max_size: int = 12, min_subgroup_size: int = 4, strategy: str = "community"
    ) -> list[dict[str, Any]]:
        """Split a large friend group into smaller sub-groups using graph analysis

        Args:
            members: List of camper IDs in the friend group
            max_size: Maximum size for a sub-group
            min_subgroup_size: Minimum size for a viable sub-group
            strategy: Splitting strategy ('community', 'balanced', 'graph_partition')

        Returns:
            List of sub-groups with metadata
        """
        if len(members) <= max_size:
            return [{"members": members, "split_reason": None, "cohesion_score": 1.0}]

        # Create subgraph for just this friend group
        subgraph = self.graph.subgraph(members).copy()

        # Type annotation for proper mypy inference
        subgroups: list[dict[str, Any]] = []

        if strategy == "community":
            # Use Louvain community detection
            partition = community_louvain.best_partition(subgraph, random_state=self.random_seed)
            communities = defaultdict(list)
            for node, comm_id in partition.items():
                communities[comm_id].append(node)

            # Convert communities to subgroups
            for comm_members in communities.values():
                if len(comm_members) >= min_subgroup_size:
                    cohesion = self._calculate_group_cohesion(comm_members)
                    subgroups.append(
                        {"members": comm_members, "split_reason": "community_detection", "cohesion_score": cohesion}
                    )
                else:
                    # Merge small communities with nearest larger one
                    if subgroups:
                        members_list: list[int] = subgroups[-1]["members"]
                        members_list.extend(comm_members)
                        subgroups[-1]["cohesion_score"] = self._calculate_group_cohesion(members_list)

        elif strategy == "graph_partition":
            # Use graph partitioning based on edge cuts
            k = (len(members) + max_size - 1) // max_size  # Number of partitions

            # Use Kernighan-Lin algorithm for balanced partitioning
            if k == 2:
                part1, part2 = nx.algorithms.community.kernighan_lin_bisection(subgraph, seed=self.random_seed)
                subgroups = [
                    {
                        "members": list(part1),
                        "split_reason": "balanced_split",
                        "cohesion_score": self._calculate_group_cohesion(list(part1)),
                    },
                    {
                        "members": list(part2),
                        "split_reason": "balanced_split",
                        "cohesion_score": self._calculate_group_cohesion(list(part2)),
                    },
                ]
            else:
                # For k > 2, fall back to balanced strategy
                return self.split_large_friend_group(members, max_size, min_subgroup_size, "balanced")

        else:  # balanced strategy
            # Simple balanced split
            k = (len(members) + max_size - 1) // max_size
            chunk_size = len(members) // k
            remainder = len(members) % k

            start = 0
            for i in range(k):
                size = chunk_size + (1 if i < remainder else 0)
                subgroup_members = members[start : start + size]
                if len(subgroup_members) >= min_subgroup_size:
                    subgroups.append(
                        {
                            "members": subgroup_members,
                            "split_reason": "balanced_split",
                            "cohesion_score": self._calculate_group_cohesion(subgroup_members),
                        }
                    )
                elif subgroups:
                    # Merge with previous if too small
                    prev_members: list[int] = subgroups[-1]["members"]
                    prev_members.extend(subgroup_members)
                    subgroups[-1]["cohesion_score"] = self._calculate_group_cohesion(prev_members)
                start += size

        # Ensure all subgroups meet minimum size
        final_subgroups: list[dict[str, Any]] = []
        for sg in subgroups:
            sg_members: list[int] = sg["members"]
            if len(sg_members) >= min_subgroup_size:
                final_subgroups.append(sg)
            elif final_subgroups:
                # Merge with previous
                final_members: list[int] = final_subgroups[-1]["members"]
                final_members.extend(sg_members)
                final_subgroups[-1]["cohesion_score"] = self._calculate_group_cohesion(final_members)

        return (
            final_subgroups
            if final_subgroups
            else [{"members": members, "split_reason": "size_exceeded", "cohesion_score": 1.0}]
        )

    def _calculate_group_cohesion(self, members: list[int]) -> float:
        """Calculate cohesion score for a group of members"""
        if len(members) < 2:
            return 1.0

        # Create subgraph
        subgraph = self.graph.subgraph(members)

        # Calculate density (ratio of actual edges to possible edges)
        possible_edges = len(members) * (len(members) - 1) / 2
        actual_edges = subgraph.number_of_edges()

        if possible_edges == 0:
            return 0.0

        return float(actual_edges) / possible_edges

    def find_core_group(self, members: list[int] | None = None) -> dict[str, Any]:
        """Find the most densely connected subgroup using NetworkX 3.6+ densest_subgraph

        This identifies the "social core" - the tightest-knit subset of campers
        within a larger group or the entire session.

        Args:
            members: Optional list of camper IDs to search within.
                    If None, searches the entire graph.

        Returns:
            Dictionary with core_members, density, and peripheral members
        """
        # Use subgraph if members specified, otherwise full graph
        if members:
            search_graph = self.graph.subgraph(members)
        else:
            search_graph = self.graph

        if search_graph.number_of_nodes() < 3:
            return {
                "core_members": list(search_graph.nodes()),
                "density": 1.0 if search_graph.number_of_edges() > 0 else 0.0,
                "peripheral_members": [],
                "core_size": search_graph.number_of_nodes(),
            }

        try:
            # NetworkX 3.6+ densest_subgraph returns (density, node_set)
            density, core_nodes = nx.approximation.densest_subgraph(search_graph)

            # Calculate peripheral members (in original set but not in core)
            all_members = set(search_graph.nodes())
            peripheral = list(all_members - core_nodes)

            logger.debug(
                f"Found core group of {len(core_nodes)} members (density={density:.3f}) from {len(all_members)} total"
            )

            return {
                "core_members": list(core_nodes),
                "density": density,
                "peripheral_members": peripheral,
                "core_size": len(core_nodes),
            }

        except Exception as e:
            logger.warning(f"densest_subgraph failed, falling back to full group: {e}")
            return {
                "core_members": list(search_graph.nodes()),
                "density": nx.density(search_graph),
                "peripheral_members": [],
                "core_size": search_graph.number_of_nodes(),
            }

    def find_bunk_social_core(self, year: int, bunk_cm_id: int, session_cm_id: int) -> dict[str, Any]:
        """Find the social core of a specific bunk

        Uses densest_subgraph to identify the most connected campers
        in a cabin, useful for understanding social dynamics.

        Returns:
            Dictionary with core group info and recommendations
        """
        # Build the bunk graph first
        bunk_graph = self.build_bunk_graph(year, bunk_cm_id, session_cm_id)

        if bunk_graph.number_of_nodes() < 3:
            return {
                "core_members": list(bunk_graph.nodes()),
                "density": 0.0,
                "peripheral_members": [],
                "isolated_members": [],
                "recommendation": "too_small_for_analysis",
            }

        # Store reference to use find_core_group
        original_graph = self.graph
        self.graph = bunk_graph

        try:
            core_result = self.find_core_group()

            # Find truly isolated members (degree 0)
            isolated = [n for n in bunk_graph.nodes() if bunk_graph.degree(n) == 0]

            # Remove isolated from peripheral (they're a separate category)
            peripheral = [m for m in core_result["peripheral_members"] if m not in isolated]

            # Generate recommendation
            core_ratio = len(core_result["core_members"]) / bunk_graph.number_of_nodes()
            if core_ratio > 0.8:
                recommendation = "highly_cohesive"
            elif core_ratio > 0.5:
                recommendation = "moderate_cohesion"
            elif isolated:
                recommendation = "integration_needed"
            else:
                recommendation = "fragmented"

            return {
                "core_members": core_result["core_members"],
                "density": core_result["density"],
                "peripheral_members": peripheral,
                "isolated_members": isolated,
                "recommendation": recommendation,
                "bunk_cm_id": bunk_cm_id,
                "total_members": bunk_graph.number_of_nodes(),
            }

        finally:
            # Restore original graph
            self.graph = original_graph

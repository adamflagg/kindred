"""
Social Graph Builder using NetworkX for advanced friend group detection
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import networkx as nx

from api.constants.collections import (
    ATTENDEES,
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_REQUESTS,
    BUNKS,
    PERSONS,
)
from api.utils.session_metrics import get_person_from_expand, get_session_from_expand
from bunking.graph._types import cast_person
from bunking.logging_config import get_logger
from bunking.satisfaction import BucketCount, RequestBucket, camper_satisfaction
from bunking.satisfaction.aggregate import bucket_status
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField
from pocketbase import PocketBase

logger = get_logger(__name__)


@dataclass
class SocialEdge:
    """Represents a relationship between two campers"""

    weight: float
    edge_type: str  # 'request'
    year: int
    metadata: dict[str, Any]


# Mirrors bunking.satisfaction.bucket. Used to backfill source_field for legacy
# edges whose upstream PB row predates the source_field column or has it null.
# `age_preference` maps to `socialize_with` — per bucket.py, the parent
# "socialize with / age preference" dropdown lives under socialize_with.
# Returning "age_preference" would produce an invalid source_field that
# bucket.classify_request rejects.
_REQUEST_TYPE_TO_SOURCE_FIELD: dict[str, str] = {
    "bunk_with": SourceField.BUNK_REQUEST_FORM,
    "not_bunk_with": SourceField.STAFF_NOT_BUNK_WITH,
    "socialize_with": SourceField.SOCIALIZE_WITH,
    "age_preference": SourceField.SOCIALIZE_WITH,
}


def _confidence_or_default(request: Any) -> float:
    """Return a numeric confidence score, defaulting to 1.0 on missing/None.

    `getattr(request, "confidence_score", 1.0)` bypasses the default when the
    attribute is present-and-None (legal for PB nullable columns), letting a
    None value propagate into edge weight and `max(...)` calls downstream.
    """
    raw = getattr(request, "confidence_score", None)
    if raw is None:
        return 1.0
    return float(raw)


def _backfill_source_field(request_type: str, source_field: str | None) -> str:
    """Derive source_field from request_type when the row's source_field is missing.

    Unknown request_types fall back to "socialize_with" (IMMATERIAL bucket —
    visible-but-uncounted) rather than the counted MATERIAL_PARENT bucket. A
    silent promotion to parent would inflate parent_satisfaction_status with
    no signal whenever a typo or future request_type slips through. We log a
    warning when the fallback fires so the path is observable.
    """
    if source_field:
        return source_field
    result = _REQUEST_TYPE_TO_SOURCE_FIELD.get(request_type)
    if result is not None:
        return result
    logger.warning(
        "unknown request_type with null source_field; classifying as socialize_with (immaterial): %r",
        request_type,
    )
    return "socialize_with"


def build_request_edge_attrs(
    request: Any,
    *,
    reciprocal: bool,
    weight: float,
    **overrides: Any,
) -> dict[str, Any]:
    """Centralize every attribute the new aggregator depends on.

    All three add_edge sites in social_graph_builder and one in
    optimized_graph_builder use this helper so that attribute drift is caught
    in one place.
    """
    raw_requester = getattr(request, "requester_id", None)
    raw_requestee = getattr(request, "requestee_id", None)
    requester_id = int(raw_requester) if raw_requester is not None else None
    requestee_id = int(raw_requestee) if raw_requestee is not None else None
    # An empty-string request_type would silently coerce to "bunk_with" via `or`
    # and the backfill warning would never fire. Pass the raw value through
    # so _backfill_source_field can warn on empty/None equally.
    raw_request_type = getattr(request, "request_type", None)
    sf = _backfill_source_field(
        raw_request_type or "",
        getattr(request, "source_field", None),
    )
    attrs: dict[str, Any] = {
        "weight": weight,
        "edge_type": "request",
        "confidence": _confidence_or_default(request),
        "reciprocal": reciprocal,
        "source_field": sf,
        # `or` instead of getattr default so explicit-None becomes the default.
        "request_type": getattr(request, "request_type", None) or "bunk_with",
        "request_id": getattr(request, "id", ""),
        "requester_id": requester_id,
        "requestee_id": requestee_id,
    }
    attrs.update(overrides)
    return attrs


class SocialGraphBuilder:
    """Builds and analyzes the camp social graph using NetworkX"""

    def __init__(self, pb: PocketBase, random_seed: int | None = None):
        self.pb = pb
        self.graph = nx.MultiGraph()
        self.current_year = datetime.now(tz=UTC).year
        self.person_cache: dict[int, dict[str, Any]] = {}
        self.attendee_cache: dict[int, list[dict[str, Any]]] = {}
        self.random_seed = random_seed

    @staticmethod
    def _assignment_source(scenario_id: str | None) -> tuple[str, str]:
        """Pick the bunk assignment collection and scenario filter clause.

        When a scenario is active, bunk membership lives in
        ``bunk_assignments_draft`` filtered by ``scenario``. Otherwise the
        production ``bunk_assignments`` collection is used. Returned tuple:

        * collection name to query
        * scenario clause to AND into the caller's base filter (empty when
          no scenario is active). The leading ``&&`` and surrounding space
          are included so callers can append it directly.
        """
        if scenario_id:
            return BUNK_ASSIGNMENTS_DRAFT, f' && scenario = "{scenario_id}"'
        return BUNK_ASSIGNMENTS, ""

    def build_bunk_graph(
        self,
        year: int,
        bunk_cm_id: int,
        session_cm_id: int,
        scenario_id: str | None = None,
    ) -> nx.DiGraph:
        """Build a graph specifically for a single bunk with only request and sibling edges.

        Args:
            year: Camp year.
            bunk_cm_id: CampMinder bunk ID.
            session_cm_id: CampMinder session ID.
            scenario_id: Optional PocketBase scenario record ID. When provided,
                bunk membership is sourced from ``bunk_assignments_draft``
                filtered by the scenario; otherwise the production
                ``bunk_assignments`` collection is used. This mirrors
                ``OptimizedSocialGraphBuilder.build_social_network``.
        """
        logger.info(
            f"Building bunk-specific graph for bunk {bunk_cm_id} in session {session_cm_id}, year {year}"
            + (f" (scenario={scenario_id})" if scenario_id else "")
        )

        # Create new DIRECTED graph for this bunk to preserve edge directionality
        bunk_graph = nx.DiGraph()

        # Route the membership query to the scenario's draft collection when a
        # scenario is active; otherwise hit the production (CampMinder-sourced)
        # collection. Production path behavior is unchanged.
        assignment_collection, scenario_clause = self._assignment_source(scenario_id)
        primary_filter = (
            f"bunk.cm_id = {bunk_cm_id} && year = {year} && session.cm_id = {session_cm_id}{scenario_clause}"
        )

        # Get all members of this bunk for the specific session (uses relations)
        bunk_members = []
        try:
            assignments = self.pb.collection(assignment_collection).get_full_list(
                query_params={
                    "filter": primary_filter,
                    "expand": "person,bunk,session",
                }
            )
            # Extract person cm_ids from expanded relation
            for a in assignments:
                person_data = get_person_from_expand(a)
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
                bunk = self.pb.collection(BUNKS).get_first_list_item(f"cm_id = {bunk_cm_id}")
                bunk_name = getattr(bunk, "name", "")

                if "AG" in bunk_name or bunk_name.startswith("AG"):
                    logger.info(f"AG bunk detected: {bunk_name}, checking all sessions for assignments")

                    # Find all sessions this bunk is assigned to (uses relations).
                    # Stay on the same source (draft vs prod) as the primary
                    # lookup above so scenario and production data never mix.
                    if scenario_id:
                        ag_filter = f'bunk.cm_id = {bunk_cm_id} && year = {year} && scenario = "{scenario_id}"'
                    else:
                        ag_filter = f"bunk.cm_id = {bunk_cm_id} && year = {year}"
                    all_assignments = self.pb.collection(assignment_collection).get_full_list(
                        query_params={
                            "filter": ag_filter,
                            "expand": "person,session",
                        }
                    )

                    # Group by session to find which session has assignments
                    session_counts: dict[int, int] = {}
                    for assignment in all_assignments:
                        session_data = get_session_from_expand(assignment)
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
                            session_data = get_session_from_expand(a)
                            person_data = get_person_from_expand(a)
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
                _person_rec = self.pb.collection(PERSONS).get_first_list_item(f"cm_id = {person_cm_id}")
                person = cast_person(_person_rec)

                # Get last year's historical data from bunk_assignments
                last_year_session = None
                last_year_bunk = None
                last_year = year - 1  # bind before inner try so except handler can reference it
                try:
                    # Query bunk_assignments with expanded relations
                    historical = self.pb.collection(BUNK_ASSIGNMENTS).get_first_list_item(
                        f"person.cm_id = {person_cm_id} && year = {last_year}", query_params={"expand": "session,bunk"}
                    )
                    # Access expanded data safely
                    expand = getattr(historical, "expand", {}) or {}
                    session_data = get_session_from_expand(historical)
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

                # Add node with attributes
                bunk_graph.add_node(
                    person_cm_id,
                    name=f"{person['first_name']} {person['last_name']}",
                    grade=person["grade"],
                    age=person.get("age"),
                    gender=person["gender"],
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
            # Get all requests for members of this bunk. Both bunk_with
            # (parent) and not_bunk_with (staff) edges land here; not_bunk_with
            # edges between bunkmates are violations and render red, and the
            # bucketer inverts the satisfaction rule for them. age_preference
            # rows have no paired requestee.
            # session_id filter is required: a person in multiple sessions in
            # the same year would otherwise leak cross-session rows into this
            # bunk's graph. Keep parity with _add_request_edges.
            requests = self.pb.collection(BUNK_REQUESTS).get_full_list(
                query_params={
                    "filter": f"year = {year} && session_id = {session_cm_id} && "
                    f'(request_type = "bunk_with" || request_type = "not_bunk_with") && '
                    f'status = "resolved"'
                }
            )

            logger.info(f"Processing {len(requests)} total resolved requests for year {year}")
            request_count = 0

            # Group by (pair, request_type) so opposite types don't collide.
            # An A→B bunk_with paired with B→A not_bunk_with must NOT collapse
            # into one edge — different request_types render and bucket
            # differently (not_bunk_with same-bunk = violation).
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
                        rtype = getattr(request, "request_type", RequestType.BUNK_WITH.value)
                        pair_key = (
                            min(requester, requestee),
                            max(requester, requestee),
                            rtype,
                        )
                        request_pairs[pair_key].append(request)

            # Process request pairs
            for pair_key, pair_requests in request_pairs.items():
                person1, person2, request_type = pair_key

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
                    weight = _confidence_or_default(request)

                    # A reciprocal pair carries TWO requests (one per direction).
                    # Storing only pair_requests[0] as the edge's requester drops the
                    # second camper's row in _calculate_node_metrics' per-requester filter,
                    # leaving them with parent_satisfaction_status="no_requests" instead of
                    # the correct "satisfied". Carry every pair_request's (requester, id)
                    # tuple so the metrics pass can reconstruct rows for both campers.
                    reciprocal_rows = [
                        {
                            "request_id": getattr(r, "id", "") or "",
                            "requester_id": int(getattr(r, "requester_id", 0) or 0),
                            "requestee_id": int(getattr(r, "requestee_id", 0) or 0),
                        }
                        for r in pair_requests
                    ]

                    # Check if sibling edge exists
                    if bunk_graph.has_edge(person1, person2):
                        edge_data = bunk_graph[person1][person2]
                        if edge_data.get("edge_type") == "sibling":
                            # Sibling edge exists, add request as secondary
                            edge_data["secondary_type"] = "request"
                            edge_data["has_request"] = True
                            edge_data["request_confidence"] = _confidence_or_default(request)
                            edge_data["weight"] = max(edge_data["weight"], weight)
                            edge_data["reciprocal_rows"] = reciprocal_rows
                            logger.info(
                                f"Added reciprocal request as secondary type to sibling edge: {person1} <-> {person2}"
                            )
                    else:
                        # Add single reciprocal edge with the pair_key's
                        # request_type (authoritative — pair_keys include type).
                        bunk_graph.add_edge(
                            person1,
                            person2,
                            **build_request_edge_attrs(
                                request,
                                reciprocal=True,
                                weight=weight,
                                # pair_key request_type is authoritative
                                request_type=request_type,
                                reciprocal_rows=reciprocal_rows,
                            ),
                        )
                        request_count += 1
                        logger.info(f"Added reciprocal request edge #{request_count}: {person1} <-> {person2}")
                else:
                    # Non-reciprocal - add each request as directed edge
                    for request in pair_requests:
                        requester = getattr(request, "requester_id", None)
                        requestee = getattr(request, "requestee_id", None)
                        weight = _confidence_or_default(request)

                        # Check if sibling edge exists
                        if bunk_graph.has_edge(requester, requestee):
                            edge_data = bunk_graph[requester][requestee]
                            if edge_data.get("edge_type") == "sibling":
                                # Sibling edge exists, add request as secondary
                                edge_data["secondary_type"] = "request"
                                edge_data["has_request"] = True
                                edge_data["request_confidence"] = _confidence_or_default(request)
                                edge_data["weight"] = max(edge_data["weight"], weight)
                                logger.info(
                                    f"Added request as secondary type to sibling edge: {requester} -> {requestee}"
                                )
                        else:
                            # No existing edge, create request edge
                            bunk_graph.add_edge(
                                requester,
                                requestee,
                                **build_request_edge_attrs(request, reciprocal=False, weight=weight),
                            )
                            request_count += 1
                            logger.info(f"Added request edge #{request_count}: {requester} -> {requestee}")

            logger.info(f"Added {request_count} request edges to bunk graph")

        except Exception as e:
            logger.error(f"Error adding request edges: {e}")

        # Sibling edges are intentionally NOT added (#1675). Siblings are a
        # deprecated graph concept — the session graph dropped them under #1094.
        # On the bunk graph they rendered as a spurious extra line per sibling
        # pair (and, after the #1640 multi change, a spurious bezier). The bunk
        # graph is now request-only, matching the session graph. Node
        # degree/centrality below is therefore request-only too, so a camper
        # connected only by a sibling relationship reads as isolated — correct,
        # since they have no bunk requests.

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
            # nx.clustering(G) returns dict[node, float] when called with a graph;
            # cast to silence pyright's ambiguous-overload noise (float|int|dict).
            clustering = cast(dict[Any, float], nx.clustering(bunk_graph))
            for node, clust in clustering.items():
                bunk_graph.nodes[node]["clustering"] = clust

        logger.info(
            f"Bunk graph built with {bunk_graph.number_of_nodes()} nodes and {bunk_graph.number_of_edges()} edges"
        )
        logger.info(
            f"Edge types: request={len([e for e in bunk_graph.edges(data=True) if e[2].get('edge_type') == 'request'])}, "
            f"sibling={len([e for e in bunk_graph.edges(data=True) if e[2].get('edge_type') == 'sibling'])}"
        )

        # Populate satisfaction node attrs (parent_satisfaction_status,
        # staff_satisfaction_status, satisfaction_status).  _calculate_node_metrics
        # operates on self.graph, so we temporarily point it at bunk_graph.
        # (#1063 Layer 2 fix)
        saved_graph = self.graph
        self.graph = bunk_graph
        try:
            self._calculate_node_metrics()
        finally:
            self.graph = saved_graph

        return bunk_graph

    def _add_camper_nodes(self, year: int, session_cm_id: int) -> None:
        """Add all campers as nodes with attributes"""
        # Attendees uses session relation and person_id field
        attendees = self.pb.collection(ATTENDEES).get_full_list(
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
            self.attendee_cache[person_cm_id].append(dict(attendee.__dict__))

            # Get person details if not cached
            if person_cm_id not in self.person_cache:
                try:
                    person = self.pb.collection(PERSONS).get_first_list_item(f"cm_id = {person_cm_id}")
                    self.person_cache[person_cm_id] = dict(person.__dict__)
                except Exception as e:
                    logger.warning(f"Person {person_cm_id} not found: {e}")
                    continue

            person = self.person_cache[person_cm_id]

            # Get bunk assignment for this person (uses relations)
            bunk_cm_id = None
            try:
                assignment = self.pb.collection(BUNK_ASSIGNMENTS).get_first_list_item(
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
        """Add edges from bunk requests.

        Only resolved rows produce edges. Both bunk_with (parent-source) and
        not_bunk_with (staff-source) edges are emitted — the latter render
        as red lines on the graph so staff can see violation candidates.
        age_preference rows have no paired requestee and don't produce edges.
        """
        requests = self.pb.collection(BUNK_REQUESTS).get_full_list(
            query_params={
                "filter": f"year = {year} && session_id = {session_cm_id} && "
                f'(request_type = "bunk_with" || request_type = "not_bunk_with") && '
                f'status = "resolved"'
            }
        )

        for request in requests:
            requester = getattr(request, "requester_id", None)
            requestee = getattr(request, "requestee_id", None)
            if requestee and requestee > 0:
                # Check for self-referential request (defense in depth)
                if requester == requestee:
                    # Log detailed information about self-referential request
                    req_confidence = getattr(request, "confidence_score", None)
                    req_status = getattr(request, "status", None)
                    logger.warning(
                        f"Skipping self-referential request: person {requester} "
                        f"requesting themselves (request ID: {request.id}, "
                        f"confidence: {req_confidence}, "
                        f"status: {req_status})"
                    )
                    continue  # Skip adding this edge

                # Calculate edge weight from confidence; priority dimension removed
                weight = _confidence_or_default(request)

                self.graph.add_edge(
                    requester,
                    requestee,
                    **build_request_edge_attrs(
                        request,
                        reciprocal=getattr(request, "is_reciprocal", False),
                        weight=weight,
                        year=year,
                    ),
                )

    def _calculate_node_metrics(self) -> None:
        """Calculate and store node-level metrics"""
        # Degree centrality
        degree_centrality = nx.degree_centrality(self.graph)
        nx.set_node_attributes(self.graph, degree_centrality, "centrality")

        # Clustering coefficient (how connected are a node's neighbors)
        # nx.clustering(G) always returns dict[node, float] when passed a graph;
        # cast to resolve pyright's ambiguous overload (float|int|dict).
        # nx.clustering does not support multigraphs — collapse to a simple graph
        # first. nx.Graph(multigraph) picks one edge per pair (the last one added),
        # which is fine for clustering (structural topology, not per-edge data).
        clustering = cast(dict[Any, float], nx.clustering(nx.Graph(self.graph)))
        nx.set_node_attributes(self.graph, clustering, "clustering")

        # Connected component size — use weakly_connected_components for directed graphs
        # (OptimizedSocialGraphBuilder uses nx.DiGraph; the parent path uses nx.MultiGraph).
        # Without this branch, nx.connected_components raises NetworkXNotImplemented on
        # DiGraph inputs and the satisfaction_status loop below never runs — leaving every
        # node's status null and every frontend border falling back to the default color.
        if self.graph.is_directed():
            # cast: pyright can't narrow via .is_directed(); we know it's a DiGraph here
            components = list(nx.weakly_connected_components(cast(nx.DiGraph, self.graph)))
        else:
            components = list(nx.connected_components(self.graph))
        component_map = {}
        for _i, component in enumerate(components):
            for node in component:
                component_map[node] = len(component)
        nx.set_node_attributes(self.graph, component_map, "component_size")

        # Calculate per-node satisfaction statuses using the bucket policy in
        # bunking.satisfaction.aggregate (canonical module for COUNTED_BUCKETS /
        # IMMATERIAL policy). See that module for status semantics.
        # Build person_to_bunk from graph node attrs (only assigned campers).
        person_to_bunk: dict[int, int] = {
            int(n): int(self.graph.nodes[n]["bunk_cm_id"])
            for n in self.graph.nodes()
            if self.graph.nodes[n].get("bunk_cm_id") is not None
        }

        # Reconstruct per-camper request rows by scanning every request edge once.
        # We iterate `self.graph.edges(data=True)` rather than per-node adjacency
        # so reciprocal pairs (which can be stored as a single directed edge in
        # DiGraph mode) yield one row per direction — `reciprocal_rows` carries
        # the (request_id, requester_id, requestee_id) tuple for each direction.
        # Without this, the per-requester filter dropped the second camper's
        # request whenever a reciprocal pair was collapsed.
        parent_status_map: dict[Any, str] = {}
        staff_status_map: dict[Any, str] = {}
        aggregate_status_map: dict[Any, str] = {}

        node_requests: dict[int, list[dict[str, Any]]] = {int(n): [] for n in self.graph.nodes()}

        for u, v, data in self.graph.edges(data=True):
            if data.get("edge_type") != "request":
                continue
            # age_preference rows need bunkmate_grades the graph doesn't track per-edge;
            # they're scored by the solver, not surfaced in graph node colors.
            if data.get("request_type") == "age_preference":
                continue
            # Coerce explicit-None request_type to "" so the backfill helper sees a
            # consistent "missing" signal (matches the call site at line 107-110).
            # Empty string falls through the helper's mapping and triggers the warning
            # path → socialize_with (IMMATERIAL bucket), which is the correct
            # "missing data" treatment (parent_satisfaction_status stays no_requests).
            raw_request_type = data.get("request_type") or ""
            resolved_source_field = _backfill_source_field(raw_request_type, data.get("source_field"))
            # Unknown request_type would crash the predicate (ValueError). The
            # predicate only handles bunk_with / not_bunk_with / age_preference;
            # source_field=socialize_with maps onto a bunk_with-shaped row at the
            # predicate level (its result lands in IMMATERIAL and is discarded by
            # COUNTED_BUCKETS anyway). Normalize unknowns to bunk_with — the
            # backfill warning above is the observable signal that this happened.
            resolved_request_type = (
                raw_request_type if raw_request_type in {"bunk_with", "not_bunk_with"} else "bunk_with"
            )

            # Reciprocal pairs carry one tuple per direction so both campers'
            # requests survive. Non-reciprocal edges fall back to the
            # single (requester_id, request_id) on the edge itself.
            edge_rows = data.get("reciprocal_rows") or [
                {
                    "request_id": data.get("request_id") or "",
                    "requester_id": data.get("requester_id"),
                    "requestee_id": data.get("requestee_id"),
                }
            ]

            for row in edge_rows:
                row_requester = row.get("requester_id")
                if row_requester is None:
                    continue
                row_requester = int(row_requester)
                if row_requester not in node_requests:
                    continue
                row_requestee = row.get("requestee_id")
                # If requestee is missing on a reciprocal row, derive from the edge's other endpoint.
                if row_requestee is None:
                    row_requestee = int(v) if int(u) == row_requester else int(u)
                # PerRequestStatus.request_id has min_length=1 (#7) — synthesize
                # a stable per-edge id when the edge doesn't carry a real PB id.
                # Real prod data always has an id; the fallback is for graph-only
                # synthetic edges (e.g. tests, edges constructed without a row).
                row_id = row.get("request_id") or f"edge:{row_requester}:{int(row_requestee)}"
                node_requests[row_requester].append(
                    {
                        "id": row_id,
                        "requester_id": row_requester,
                        "requestee_id": int(row_requestee),
                        "request_type": resolved_request_type,
                        "source_field": resolved_source_field,
                        "requester_grade": self.graph.nodes[row_requester].get("grade"),
                    }
                )

        for node in self.graph.nodes():
            person_requests = node_requests.get(int(node), [])
            sat = camper_satisfaction(
                person_cm_id=int(node),
                person_requests=person_requests,
                person_to_bunk=person_to_bunk,
            )
            parent_status_map[node] = bucket_status(sat.counted_totals[RequestBucket.MATERIAL_PARENT])
            staff_status_map[node] = bucket_status(sat.counted_totals[RequestBucket.STAFF])

            # Aggregate combines counted buckets (material + staff) only —
            # immaterial parent (socialize_with) is excluded from totals per
            # COUNTED_BUCKETS policy.
            counted_total = sum(c.total for c in sat.counted_totals.values())
            counted_satisfied = sum(c.satisfied for c in sat.counted_totals.values())
            aggregate_status_map[node] = bucket_status(BucketCount(satisfied=counted_satisfied, total=counted_total))

        nx.set_node_attributes(self.graph, parent_status_map, "parent_satisfaction_status")
        nx.set_node_attributes(self.graph, staff_status_map, "staff_satisfaction_status")
        nx.set_node_attributes(self.graph, aggregate_status_map, "satisfaction_status")

"""TDD: SocialGraphBuilder must preserve both edges when two bunk_request rows
exist between the same pair of campers with different source_field values.

Red phase: these tests fail because nx.Graph() overwrites attributes on the
second add_edge call — only the last edge's source_field/request_id survives.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_graph_with_parallel_requests(
    *,
    same_bunk: bool,
) -> tuple[SocialGraphBuilder, nx.Graph]:
    """Return a builder whose graph has two request edges between nodes 1 and 2.

    Node 1 → Node 2: source_field='bunk_with'   (parent row)
    Node 1 → Node 2: source_field='bunking_notes' (staff row)

    When same_bunk=True both nodes are in bunk 10; when False, node 2 is in
    bunk 11 so the parent request is unsatisfied.
    """
    bunk2 = 10 if same_bunk else 11
    builder = SocialGraphBuilder(pb=MagicMock())
    g = builder.graph
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=bunk2, grade=5)

    # Edge 1: parent bunk_with request
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="bunk_with",
        source_field="bunk_with",
        request_id="req-parent-1",
        requester_id=1,
        requestee_id=2,
        weight=5.0,
    )
    # Edge 2: staff bunking_notes request (same pair, different source)
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="bunk_with",
        source_field="bunking_notes",
        request_id="req-staff-1",
        requester_id=1,
        requestee_id=2,
        weight=5.0,
    )
    return builder, g


# ---------------------------------------------------------------------------
# Structural tests: both edges must survive as distinct parallel edges
# ---------------------------------------------------------------------------


class TestParallelEdgesPreserved:
    """Both bunk_request rows between the same pair must produce distinct edges."""

    def test_two_parallel_edges_exist(self) -> None:
        """nx.MultiGraph must store both edges; nx.Graph would collapse them."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=True)
        # For nx.Graph this is 1; for nx.MultiGraph it's 2.
        assert g.number_of_edges() == 2, (
            f"Expected 2 edges between pair 1-2 but got {g.number_of_edges()}. "
            "SocialGraphBuilder must use nx.MultiGraph, not nx.Graph."
        )

    def test_both_source_fields_present(self) -> None:
        """Both 'bunk_with' and 'bunking_notes' source_field values must survive."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=True)
        source_fields = {data.get("source_field") for _, _, data in g.edges(data=True)}
        assert "bunk_with" in source_fields, "parent source_field 'bunk_with' was lost"
        assert "bunking_notes" in source_fields, "staff source_field 'bunking_notes' was lost"

    def test_both_request_ids_present(self) -> None:
        """Both request_id values must survive as separate edge attributes."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=True)
        request_ids = {data.get("request_id") for _, _, data in g.edges(data=True)}
        assert "req-parent-1" in request_ids, "parent request_id was overwritten"
        assert "req-staff-1" in request_ids, "staff request_id was overwritten"


# ---------------------------------------------------------------------------
# _calculate_node_metrics: per-bucket counts must reflect both rows
# ---------------------------------------------------------------------------


class TestNodeMetricsPerSourceBuckets:
    """_calculate_node_metrics must count each source row independently."""

    def test_parent_and_staff_both_satisfied(self) -> None:
        """When same bunk: parent bucket satisfied AND staff bucket satisfied."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=True)
        builder._calculate_node_metrics()
        node = g.nodes[1]
        assert node.get("parent_satisfaction_status") == "satisfied", (
            f"parent_satisfaction_status={node.get('parent_satisfaction_status')!r}; "
            "bunk_with row must be counted in MATERIAL_PARENT bucket"
        )
        assert node.get("staff_satisfaction_status") == "satisfied", (
            f"staff_satisfaction_status={node.get('staff_satisfaction_status')!r}; "
            "bunking_notes row must be counted in STAFF bucket"
        )

    def test_parent_unsatisfied_staff_satisfied(self) -> None:
        """When different bunks: parent bucket is unsatisfied, staff is satisfied."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=False)
        builder._calculate_node_metrics()
        node = g.nodes[1]
        assert node.get("parent_satisfaction_status") == "unsatisfied", (
            f"parent_satisfaction_status={node.get('parent_satisfaction_status')!r}; "
            "different-bunk bunk_with request should be unsatisfied"
        )
        assert node.get("staff_satisfaction_status") == "unsatisfied", (
            f"staff_satisfaction_status={node.get('staff_satisfaction_status')!r}; "
            "different-bunk bunking_notes request should be unsatisfied"
        )

    def test_node2_has_no_requests(self) -> None:
        """Node 2 is the requestee, not the requester — must remain no_requests."""
        builder, g = _make_graph_with_parallel_requests(same_bunk=True)
        builder._calculate_node_metrics()
        node = g.nodes[2]
        assert node.get("parent_satisfaction_status") == "no_requests", (
            f"node 2 parent_satisfaction_status={node.get('parent_satisfaction_status')!r}; "
            "requestee must not inherit requester's bucket"
        )
        assert node.get("staff_satisfaction_status") == "no_requests", (
            f"node 2 staff_satisfaction_status={node.get('staff_satisfaction_status')!r}; "
            "requestee must not inherit requester's staff bucket"
        )


# ---------------------------------------------------------------------------
# Regression: existing single-edge behavior is unchanged
# ---------------------------------------------------------------------------


class TestSingleEdgeUnchanged:
    """Switching to MultiGraph must not break the single-edge case."""

    def test_single_parent_request_unsatisfied(self) -> None:
        """Single bunk_with request to different bunk → unsatisfied (existing behavior)."""
        builder = SocialGraphBuilder(pb=MagicMock())
        g = builder.graph
        g.add_node(1, bunk_cm_id=10, grade=5)
        g.add_node(2, bunk_cm_id=11, grade=5)
        g.add_edge(
            1,
            2,
            edge_type="request",
            request_type="bunk_with",
            source_field="bunk_with",
            request_id="r1",
            requester_id=1,
            requestee_id=2,
        )
        builder._calculate_node_metrics()
        assert g.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
        assert g.nodes[2]["parent_satisfaction_status"] == "no_requests"

    def test_graph_is_multigraph(self) -> None:
        """SocialGraphBuilder.graph must be an nx.MultiGraph instance."""
        builder = SocialGraphBuilder(pb=MagicMock())
        assert isinstance(builder.graph, nx.MultiGraph), (
            f"Expected nx.MultiGraph but got {type(builder.graph).__name__}. "
            "SocialGraphBuilder.__init__ must use nx.MultiGraph()."
        )

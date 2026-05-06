"""Regression: age_preference edges must not crash _calculate_node_metrics."""

from unittest.mock import MagicMock

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


def test_age_preference_edge_does_not_crash_node_metrics():
    """The age_preference branch must be exercised by the *request_type=='age_preference'*
    skip — set requester_id/requestee_id so the edge isn't filtered out earlier
    by missing-attr guards (Finding #18).
    """
    builder = SocialGraphBuilder(pb=MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=10, grade=5)
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="age_preference",
        source_field="age_preference",
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    builder._calculate_node_metrics()  # must not raise
    assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert g.nodes[2]["parent_satisfaction_status"] == "no_requests"

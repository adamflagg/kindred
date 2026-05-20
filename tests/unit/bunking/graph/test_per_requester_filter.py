"""Regression: B must not inherit A's bunk_with request via undirected adjacency."""

from unittest.mock import MagicMock

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


def test_b_does_not_inherit_a_request():
    builder = SocialGraphBuilder(MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=11, grade=5)  # different bunks → not satisfied
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="bunk_with",
        source_field="bunk_request_form",
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    builder._calculate_node_metrics()
    assert g.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
    assert g.nodes[2]["parent_satisfaction_status"] == "no_requests"

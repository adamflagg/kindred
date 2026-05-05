"""Regression: missing source_field must derive from request_type, not default to bunk_with."""

from unittest.mock import MagicMock

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


def test_not_bunk_with_with_null_source_field_classifies_as_staff():
    builder = SocialGraphBuilder(MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=11, grade=5)  # different bunks → not_bunk_with satisfied
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="not_bunk_with",
        source_field=None,  # legacy/sync gap
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    builder._calculate_node_metrics()
    assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert g.nodes[1]["staff_satisfaction_status"] == "satisfied"

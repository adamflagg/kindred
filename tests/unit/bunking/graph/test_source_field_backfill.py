"""Regression: missing source_field must derive from request_type, not default to bunk_with."""

import logging
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


def test_unknown_request_type_with_null_source_field_lands_immaterial(caplog):
    """Unknown request_type with null source_field must NOT land in MATERIAL_PARENT.

    The previous fallback dict-lookup default of "bunk_with" silently promoted any
    unmapped type into the counted parent bucket, inflating parent_satisfaction_status.
    The fix routes unknowns to "socialize_with" (IMMATERIAL — visible-but-uncounted)
    and emits a logger.warning so the fallback path is observable.
    """
    builder = SocialGraphBuilder(MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=10, grade=5)
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="future_unknown_kind",
        source_field=None,
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    with caplog.at_level(logging.WARNING, logger="bunking.graph.social_graph_builder"):
        builder._calculate_node_metrics()
    assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"  # not counted
    assert any("unknown request_type" in rec.message.lower() for rec in caplog.records)

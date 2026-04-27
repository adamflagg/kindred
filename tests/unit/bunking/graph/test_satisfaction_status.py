"""Tests for SocialGraphBuilder satisfaction_status calculation.

Locked behavior (scoreboard #43):
- ≥1 request satisfied  → "satisfied"   (renders green border)
- has requests, 0 satisfied → "isolated" (renders red border)
- no request edges at all → "no_requests" (renders gray border — neutral, nothing to satisfy)

Per scoreboard #43 follow-up: a camper with zero requests should not be lumped
into either bucket — they have nothing to satisfy. The legacy logic merged that
case into "satisfied" or "isolated" depending on whether other (sibling/school)
edges existed, which was misleading.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


def _make_builder() -> SocialGraphBuilder:
    return SocialGraphBuilder(pb=MagicMock())


def _populate(
    builder: SocialGraphBuilder,
    nodes: dict[int, int | None],
    request_edges: list[tuple[int, int]],
    other_edges: list[tuple[int, int]] | None = None,
) -> None:
    """Populate builder.graph with nodes (id → bunk_cm_id) and edges."""
    builder.graph = nx.Graph()
    for node_id, bunk_cm_id in nodes.items():
        builder.graph.add_node(node_id, bunk_cm_id=bunk_cm_id)
    for u, v in request_edges:
        builder.graph.add_edge(u, v, edge_type="request")
    for u, v in other_edges or []:
        builder.graph.add_edge(u, v, edge_type="sibling")


def test_all_requests_satisfied_marks_satisfied() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 100}, request_edges=[(1, 2)])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"
    assert builder.graph.nodes[2]["satisfaction_status"] == "satisfied"


def test_some_requests_satisfied_collapses_to_satisfied() -> None:
    """Formerly 'partial' — collapsed into 'satisfied' under the binary 1+ vs none model."""
    builder = _make_builder()
    # Node 1 requests both 2 and 3; only 2 shares the cabin.
    _populate(builder, nodes={1: 100, 2: 100, 3: 200}, request_edges=[(1, 2), (1, 3)])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"


def test_has_requests_none_satisfied_marks_isolated() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2)])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "isolated"
    assert builder.graph.nodes[2]["satisfaction_status"] == "isolated"


def test_no_request_edges_marks_no_requests_even_when_connected() -> None:
    """A camper with sibling/school edges but no requests still has nothing to satisfy."""
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 100}, request_edges=[], other_edges=[(1, 2)])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "no_requests"
    assert builder.graph.nodes[2]["satisfaction_status"] == "no_requests"


def test_no_request_edges_and_fully_isolated_node_marks_no_requests() -> None:
    """Degree-0 node with no requests is still 'no_requests', not 'isolated'."""
    builder = _make_builder()
    _populate(builder, nodes={1: 100}, request_edges=[])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "no_requests"


def _populate_digraph(
    builder: SocialGraphBuilder,
    nodes: dict[int, int | None],
    request_edges: list[tuple[int, int]],
) -> None:
    """Same as _populate but uses nx.DiGraph — what the OptimizedSocialGraphBuilder uses."""
    builder.graph = nx.DiGraph()
    for node_id, bunk_cm_id in nodes.items():
        builder.graph.add_node(node_id, bunk_cm_id=bunk_cm_id)
    for u, v in request_edges:
        builder.graph.add_edge(u, v, edge_type="request")


def test_calculate_node_metrics_on_digraph_sets_satisfaction_status() -> None:
    """Regression: OptimizedSocialGraphBuilder uses nx.DiGraph; satisfaction_status must
    still be populated on every node. Prior bug: nx.connected_components raised
    NetworkXNotImplemented on DiGraph, aborting before the satisfaction loop and leaving
    satisfaction_status=None on every node — causing all graph node borders to fall back
    to the same color in the frontend."""
    builder = _make_builder()
    _populate_digraph(builder, nodes={1: 100, 2: 100, 3: 200}, request_edges=[(1, 2), (1, 3)])
    builder._calculate_node_metrics()
    for node_id in (1, 2, 3):
        assert "satisfaction_status" in builder.graph.nodes[node_id], (
            f"node {node_id} missing satisfaction_status — _calculate_node_metrics bailed early"
        )
        assert builder.graph.nodes[node_id]["satisfaction_status"] is not None


def test_calculate_node_metrics_on_digraph_classifies_correctly() -> None:
    """Same node membership semantics on DiGraph as on Graph."""
    builder = _make_builder()
    # 1 → 2 (same bunk, satisfied), 3 → 4 (different bunks, isolated), 5 alone (no_requests)
    _populate_digraph(
        builder,
        nodes={1: 100, 2: 100, 3: 200, 4: 300, 5: 400},
        request_edges=[(1, 2), (3, 4)],
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"
    assert builder.graph.nodes[3]["satisfaction_status"] == "isolated"
    assert builder.graph.nodes[5]["satisfaction_status"] == "no_requests"

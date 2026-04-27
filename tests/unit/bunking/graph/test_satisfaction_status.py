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

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from bunking.graph.social_graph_builder import SocialGraphBuilder


def _make_builder() -> SocialGraphBuilder:
    return SocialGraphBuilder(pb=MagicMock())


def _make_optimized_builder() -> OptimizedSocialGraphBuilder:
    return OptimizedSocialGraphBuilder(pb=MagicMock())


def _populate(
    builder: SocialGraphBuilder,
    nodes: dict[int, int | None],
    request_edges: list[tuple[int, int]],
    other_edges: list[tuple[int, int]] | None = None,
    graph_type: type = nx.Graph,
) -> None:
    """Populate builder.graph with nodes (id → bunk_cm_id) and edges.

    graph_type defaults to nx.Graph; pass nx.DiGraph to mirror what
    OptimizedSocialGraphBuilder uses.
    """
    builder.graph = graph_type()
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


def test_optimized_builder_sets_satisfaction_status() -> None:
    """Regression: OptimizedSocialGraphBuilder is the GUI path (3 of 4 production
    callers in api/routers/social_graph.py — the friends page hits it). Prior bug:
    OptimizedSocialGraphBuilder._calculate_node_metrics overrode the parent and
    silently dropped the satisfaction loop, leaving satisfaction_status absent on
    every node and forcing every frontend border to fall back to a default color."""
    builder = _make_optimized_builder()
    _populate(builder, nodes={1: 100, 2: 100, 3: 200}, request_edges=[(1, 2), (1, 3)], graph_type=nx.DiGraph)
    builder._calculate_node_metrics()
    for node_id in (1, 2, 3):
        assert "satisfaction_status" in builder.graph.nodes[node_id], (
            f"node {node_id} missing satisfaction_status — OptimizedSocialGraphBuilder "
            f"override is dropping the satisfaction loop"
        )
        assert builder.graph.nodes[node_id]["satisfaction_status"] is not None


def test_optimized_builder_classifies_correctly() -> None:
    """OptimizedSocialGraphBuilder must produce the same satisfaction labels as the
    parent on the same logical graph (just expressed as a DiGraph)."""
    builder = _make_optimized_builder()
    # 1 → 2 (same bunk, satisfied), 3 → 4 (different bunks, isolated), 5 alone (no_requests)
    _populate(
        builder,
        nodes={1: 100, 2: 100, 3: 200, 4: 300, 5: 400},
        request_edges=[(1, 2), (3, 4)],
        graph_type=nx.DiGraph,
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"
    assert builder.graph.nodes[3]["satisfaction_status"] == "isolated"
    assert builder.graph.nodes[5]["satisfaction_status"] == "no_requests"


def test_parent_builder_on_digraph_still_works() -> None:
    """Defensive: even though parent SocialGraphBuilder always builds nx.Graph in
    practice, _calculate_node_metrics must remain DiGraph-safe so nothing regresses
    if the parent is ever invoked on a directed graph."""
    builder = _make_builder()
    _populate(
        builder,
        nodes={1: 100, 2: 100, 3: 200},
        request_edges=[(1, 2), (1, 3)],
        graph_type=nx.DiGraph,
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"

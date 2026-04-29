"""Tests for SocialGraphBuilder satisfaction_status calculation.

Locked behavior (scoreboard #43):
- ≥1 request satisfied  → "satisfied"    (renders green border)
- has requests, 0 satisfied → "unsatisfied" (renders red border)
- no request edges at all → "no_requests"  (renders gray border — neutral, nothing to satisfy)

Per scoreboard #43 follow-up: a camper with zero requests should not be lumped
into either bucket — they have nothing to satisfy. The legacy logic merged that
case into "satisfied" or "unsatisfied" depending on whether other (sibling/school)
edges existed, which was misleading.

Stage 3a: renamed from "isolated" to "unsatisfied" to align with codebase
nomenclature (sidebar alerts, frontend display labels).
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
    request_edges: list[tuple[int, int]] | list[tuple[int, int, str]],
    other_edges: list[tuple[int, int]] | None = None,
    graph_type: type = nx.Graph,
) -> None:
    """Populate builder.graph with nodes (id → bunk_cm_id) and edges.

    graph_type defaults to nx.Graph; pass nx.DiGraph to mirror what
    OptimizedSocialGraphBuilder uses.

    request_edges accepts 2-tuples (u, v) for legacy tests or 3-tuples
    (u, v, source) for parent/staff-split tests.
    """
    builder.graph = graph_type()
    for node_id, bunk_cm_id in nodes.items():
        builder.graph.add_node(node_id, bunk_cm_id=bunk_cm_id)
    for edge in request_edges:
        if len(edge) == 3:
            u, v, source = edge
            builder.graph.add_edge(u, v, edge_type="request", source=source)
        else:
            u, v = edge
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


def test_has_requests_none_satisfied_marks_unsatisfied() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2)])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["satisfaction_status"] == "unsatisfied"
    assert builder.graph.nodes[2]["satisfaction_status"] == "unsatisfied"


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
    assert builder.graph.nodes[3]["satisfaction_status"] == "unsatisfied"
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


# ---------------------------------------------------------------------------
# Stage 2: parent-paramount edge tagging + per-source satisfaction status
# ---------------------------------------------------------------------------


def _fake_request(requester_id: int, requestee_id: int, source: str | None = "family", **overrides: object) -> object:
    """Build a minimal duck-typed ParsedRequest that _add_request_edges can read."""
    attrs: dict[str, object] = {
        "id": f"r-{requester_id}-{requestee_id}",
        "requester_id": requester_id,
        "requestee_id": requestee_id,
        "request_type": "bunk_with",
        "priority": 4,
        "confidence_score": 0.95,
        "is_reciprocal": False,
        "status": "resolved",
        "year": 2026,
        "source": source,
    }
    attrs.update(overrides)
    request = MagicMock()
    for key, value in attrs.items():
        setattr(request, key, value)
    return request


def test_node_emits_parent_satisfaction_status_unsatisfied_when_only_parent_unsat() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2, "family")])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "no_requests"


def test_node_emits_staff_satisfaction_status_unsatisfied_when_only_staff_unsat() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2, "staff")])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"


def test_node_with_both_sources_evaluates_independently() -> None:
    """Parent request satisfied (same bunk); staff request unsatisfied (different bunk).
    Each split is computed from its own edges, not from the aggregate."""
    builder = _make_builder()
    _populate(
        builder,
        nodes={1: 100, 2: 100, 3: 200},
        request_edges=[(1, 2, "family"), (1, 3, "staff")],
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "satisfied"
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"


def test_node_with_no_requests_at_all_emits_no_requests_for_both_splits() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100}, request_edges=[])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "no_requests"


def test_legacy_satisfaction_status_still_emitted_for_backwards_compat() -> None:
    """Stage 2 keeps the aggregate satisfaction_status populated so any consumer not
    yet migrated to parent_satisfaction_status keeps working until a future stage."""
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2, "family")])
    builder._calculate_node_metrics()
    assert "satisfaction_status" in builder.graph.nodes[1]
    assert builder.graph.nodes[1]["satisfaction_status"] == "unsatisfied"


def test_session_graph_request_edges_only_query_resolved_rows() -> None:
    """Spec §2.1 + Stage 3a sweep: _add_request_edges (session-graph path) must
    query bunk_requests with `status = "resolved"`, NOT `status != "removed"`.

    The legacy filter `status != "removed"` was permissive — pending and
    declined rows leaked into the graph as phantom edges. The bunk-graph path
    (line 286) was already correct; this regression-locks the session-graph
    path to the same rule.
    """
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    builder = SocialGraphBuilder(pb=pb)
    builder.graph = nx.Graph()
    builder._add_request_edges(year=2026, session_cm_id=999)

    call_kwargs = pb.collection.return_value.get_full_list.call_args.kwargs
    filter_str = call_kwargs.get("query_params", {}).get("filter", "")
    assert 'status = "resolved"' in filter_str, (
        f"session-graph filter must require status=resolved, got: {filter_str!r}"
    )
    assert 'status != "removed"' not in filter_str, (
        f"session-graph filter must not use legacy 'status != removed'; got: {filter_str!r}"
    )


def test_request_edges_carry_source_attribute() -> None:
    """Each request edge should expose the source-of-record (family/staff) so
    satisfaction can be computed per source. Required by Stage 2 to drive
    parent_satisfaction_status vs staff_satisfaction_status."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        _fake_request(1, 2, source="family"),
        _fake_request(2, 3, source="staff"),
    ]
    builder = SocialGraphBuilder(pb=pb)
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=100)
    builder.graph.add_node(2, bunk_cm_id=100)
    builder.graph.add_node(3, bunk_cm_id=200)
    builder._add_request_edges(year=2026, session_cm_id=999)
    edge_1_2 = builder.graph[1].get(2) or builder.graph[2].get(1)
    edge_2_3 = builder.graph[2].get(3) or builder.graph[3].get(2)
    assert edge_1_2 is not None
    assert edge_1_2.get("source") == "family"
    assert edge_2_3 is not None
    assert edge_2_3.get("source") == "staff"


# ---------------------------------------------------------------------------
# Stage 3a: "isolated" → "unsatisfied" rename
# ---------------------------------------------------------------------------


def test_socialize_with_only_camper_no_parent_unsatisfied() -> None:
    """A camper whose only resolved request is a socialize_with-source
    age_preference (best-effort) must NOT get parent_satisfaction_status='unsatisfied'.
    Best-effort rows don't drive the parent badge.

    Why this passes immediately (implicit materiality narrowing):
    _add_request_edges queries bunk_requests with
    `request_type = "bunk_with" && status != "removed"`, so age_preference rows
    from socialize_with-source entries are filtered out at the DB layer.
    They never become graph edges, so parent_edges in _calculate_node_metrics is
    empty for such a camper → status falls through to "no_requests".

    This test locks that behavior as a regression guard — if the DB filter is ever
    accidentally widened to include age_preference rows, this test will catch it.
    """
    builder = _make_builder()
    # Emma Johnson (cm_id=5001) alone in bunk 101.
    # No edges — simulates a camper whose only request was age_preference (socialize_with-source),
    # which was filtered out before reaching the graph.
    _populate(builder, nodes={5001: 101}, request_edges=[])
    builder._calculate_node_metrics()
    status = builder.graph.nodes[5001]["parent_satisfaction_status"]
    assert status != "unsatisfied", (
        f"parent_satisfaction_status={status!r} for a camper with no request edges — "
        "age_preference/socialize_with-source rows must not drive the parent badge"
    )
    assert status == "no_requests", f"expected 'no_requests' for a camper with no edges, got {status!r}"


def test_satisfaction_status_uses_unsatisfied_not_isolated() -> None:
    """Stage 3a: graph payload uses 'unsatisfied' instead of 'isolated'.

    Applies to parent_satisfaction_status, staff_satisfaction_status, and
    legacy satisfaction_status. The string 'isolated' must never appear in
    any of these three node attributes.
    """
    builder = _make_builder()
    # One camper with an unsatisfied parent request (different bunks).
    _populate(builder, nodes={1: 100, 2: 200}, request_edges=[(1, 2, "family")])
    builder._calculate_node_metrics()

    # New value must be present.
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
    assert builder.graph.nodes[1]["satisfaction_status"] == "unsatisfied"

    # Old value must never appear in any of the three status fields.
    for node_id in builder.graph.nodes():
        for attr in ("parent_satisfaction_status", "staff_satisfaction_status", "satisfaction_status"):
            val = builder.graph.nodes[node_id].get(attr)
            assert val != "isolated", f"node {node_id} {attr}='isolated' — Stage 3a requires 'unsatisfied'"


# ---------------------------------------------------------------------------
# Stage 3a Task 9: build_bunk_graph must call _calculate_node_metrics (#1063 Layer 2)
# ---------------------------------------------------------------------------


def _make_person(cm_id: int, first_name: str, last_name: str, bunk_cm_id: int) -> object:
    """Minimal duck-typed person object for build_bunk_graph node creation."""
    from types import SimpleNamespace

    return SimpleNamespace(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=7,
        gender="F",
        age=12,
        family_id=None,
    )


def _make_assignment_with_expand(person_cm_id: int) -> object:
    """Minimal assignment record with expand.person so get_person_from_expand works."""
    from types import SimpleNamespace

    person = SimpleNamespace(cm_id=person_cm_id)
    expand = SimpleNamespace(person=person)
    return SimpleNamespace(expand=expand)


def _make_request_record(requester_id: int, requestee_id: int, source: str) -> object:
    """Minimal bunk_request record for build_bunk_graph edge creation."""
    from types import SimpleNamespace

    return SimpleNamespace(
        id=f"r-{requester_id}-{requestee_id}",
        requester_id=requester_id,
        requestee_id=requestee_id,
        request_type="bunk_with",
        priority=4,
        confidence_score=0.95,
        is_reciprocal=False,
        status="resolved",
        year=2026,
        source=source,
    )


def test_build_bunk_graph_emits_satisfaction_fields() -> None:
    """#1063 Layer 2: build_bunk_graph node attrs must include parent_satisfaction_status,
    staff_satisfaction_status, and legacy satisfaction_status.

    Prior bug: build_bunk_graph never called _calculate_node_metrics, so those three
    attrs were always absent from the returned graph's nodes.

    Fixture: two campers in bunk 555 with a resolved parent (family) request between
    them.  Because they share the bunk both should be "satisfied".  The important
    check is that the attrs exist at all — if _calculate_node_metrics is not called
    the dict lookup returns None and the assertions below fail.
    """
    pb = MagicMock()

    # Person cm_ids and bunk
    person_a_id = 1001
    person_b_id = 1002
    bunk_cm_id = 555
    session_cm_id = 999
    year = 2026

    # Build expand-aware assignment stubs
    assign_a = _make_assignment_with_expand(person_a_id)
    assign_b = _make_assignment_with_expand(person_b_id)

    # Build person stubs for get_first_list_item lookups
    person_a = _make_person(person_a_id, "Emma", "Johnson", bunk_cm_id)
    person_b = _make_person(person_b_id, "Liam", "Garcia", bunk_cm_id)

    # A resolved family request: person_a requests person_b (same bunk → satisfied)
    request_ab = _make_request_record(person_a_id, person_b_id, source="family")

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [assign_a, assign_b]
        elif name == "bunk_requests":
            col.get_full_list.return_value = [request_ab]
        elif name == "persons":

            def _get_first(flt: str, *_a: object, **_kw: object) -> object:
                if str(person_a_id) in flt:
                    return person_a
                if str(person_b_id) in flt:
                    return person_b
                raise RuntimeError(f"no person for filter {flt!r}")

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_full_list.return_value = []
            col.get_first_list_item.side_effect = RuntimeError("no record")
        return col

    pb.collection.side_effect = _collection_side_effect

    builder = SocialGraphBuilder(pb=pb)
    bunk_graph = builder.build_bunk_graph(year=year, bunk_cm_id=bunk_cm_id, session_cm_id=session_cm_id)

    # Graph must have both nodes
    assert bunk_graph.number_of_nodes() == 2, f"Expected 2 nodes, got {bunk_graph.number_of_nodes()}"

    # All three satisfaction attrs must be present on every node (#1063 Layer 2)
    for node_id in (person_a_id, person_b_id):
        node_attrs = bunk_graph.nodes[node_id]
        assert "parent_satisfaction_status" in node_attrs, (
            f"node {node_id} missing parent_satisfaction_status — build_bunk_graph must call _calculate_node_metrics()"
        )
        assert "staff_satisfaction_status" in node_attrs, (
            f"node {node_id} missing staff_satisfaction_status — build_bunk_graph must call _calculate_node_metrics()"
        )
        assert "satisfaction_status" in node_attrs, (
            f"node {node_id} missing satisfaction_status — build_bunk_graph must call _calculate_node_metrics()"
        )

    # Correctness check: same-bunk parent request → satisfied
    assert bunk_graph.nodes[person_a_id]["parent_satisfaction_status"] == "satisfied", (
        f"person_a parent_satisfaction_status="
        f"{bunk_graph.nodes[person_a_id].get('parent_satisfaction_status')!r}, expected 'satisfied'"
    )
    assert bunk_graph.nodes[person_a_id]["staff_satisfaction_status"] == "no_requests"

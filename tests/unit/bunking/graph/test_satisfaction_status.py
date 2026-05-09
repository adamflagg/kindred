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

from typing import Any
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

    Post-#1041: _calculate_node_metrics now classifies on source_field, not
    request_type. The legacy 2-axis source ("family"/"staff") is mapped to
    source_field per the canonical pairing:
      source="family" → source_field="bunk_with"      (MATERIAL_PARENT)
      source="staff"  → source_field="not_bunk_with"  (STAFF)
    request_type is also set so other consumers (cytoscape coloring, frontend
    inversion) keep working.
    """
    builder.graph = graph_type()
    for node_id, bunk_cm_id in nodes.items():
        builder.graph.add_node(node_id, bunk_cm_id=bunk_cm_id)
    for edge in request_edges:
        if len(edge) == 3:
            u, v, source = edge
            # Default the type to mirror the canonical source/type pairing
            # (family→bunk_with, staff→not_bunk_with) so legacy tests that only
            # specify source continue to behave as documented.
            request_type = "not_bunk_with" if source == "staff" else "bunk_with"
            source_field = "not_bunk_with" if source == "staff" else "bunk_with"
            builder.graph.add_edge(
                u,
                v,
                edge_type="request",
                source=source,
                source_field=source_field,
                request_type=request_type,
                requester_id=u,
                requestee_id=v,
            )
        else:
            u, v = edge
            builder.graph.add_edge(
                u,
                v,
                edge_type="request",
                request_type="bunk_with",
                source_field="bunk_with",
                requester_id=u,
                requestee_id=v,
            )
    for u, v in other_edges or []:
        builder.graph.add_edge(u, v, edge_type="sibling")


def test_all_requests_satisfied_marks_satisfied() -> None:
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 100}, request_edges=[(1, 2)])
    builder._calculate_node_metrics()
    # Node 1 is the requester — satisfied (same bunk).
    assert builder.graph.nodes[1]["satisfaction_status"] == "satisfied"
    # Node 2 is the receiver only — no requests they made → no_requests.
    assert builder.graph.nodes[2]["satisfaction_status"] == "no_requests"


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
    # Node 1 is the requester — unsatisfied (different bunks).
    assert builder.graph.nodes[1]["satisfaction_status"] == "unsatisfied"
    # Node 2 is the receiver only — no requests they made → no_requests.
    assert builder.graph.nodes[2]["satisfaction_status"] == "no_requests"


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
    """Build a minimal duck-typed ParsedRequest that _add_request_edges can read.

    source_field defaults based on (request_type, source) pairing so that
    staff-sourced requests get the right source_field without explicit override.
    Pass source_field= explicitly to override.
    """
    request_type = str(overrides.get("request_type", "bunk_with"))
    # Only structurally valid (request_type, source) → source_field pairings are
    # listed here. Callers testing invalid/edge-case paths must pass source_field=
    # explicitly rather than relying on this default map.
    default_source_field = {
        ("bunk_with", "parent"): "bunk_with",
        # ("bunk_with", "staff"): removed — semantically invalid (type/field disagree)
        ("not_bunk_with", "parent"): "not_bunk_with",
        ("not_bunk_with", "staff"): "not_bunk_with",
        ("socialize_with", "parent"): "socialize_with",
        # ("age_preference", "parent"): removed — "age_preference" is not a valid source_field
    }.get((request_type, source or "parent"), "bunk_with")
    attrs: dict[str, object] = {
        "id": f"r-{requester_id}-{requestee_id}",
        "requester_id": requester_id,
        "requestee_id": requestee_id,
        "request_type": request_type,
        "priority": 4,
        "confidence_score": 0.95,
        "is_reciprocal": False,
        "status": "resolved",
        "year": 2026,
        "source": source,
        "source_field": default_source_field,
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
    """Inverted semantics for not_bunk_with: same-bunk = violation
    (unsatisfied). The default _populate maps source="staff" to
    request_type="not_bunk_with", so put 1 and 2 in the same bunk to trigger
    a violation."""
    builder = _make_builder()
    _populate(builder, nodes={1: 100, 2: 100}, request_edges=[(1, 2, "staff")])
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"


def test_node_with_both_sources_evaluates_independently() -> None:
    """Parent request unsatisfied (different bunk); staff not_bunk_with violation
    (same bunk). Each split is computed from its own edges with its own
    inversion direction, not from the aggregate."""
    builder = _make_builder()
    _populate(
        builder,
        nodes={1: 100, 2: 200, 3: 100},
        request_edges=[(1, 2, "family"), (1, 3, "staff")],
    )
    builder._calculate_node_metrics()
    # Parent: bunk_with from 1 to 2 (different bunks) → unsatisfied.
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
    # Staff: not_bunk_with from 1 to 3 (same bunk) → violation, unsatisfied.
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
    """_add_request_edges must query bunk_requests with the affirmative
    `status = "resolved"` filter, never the permissive
    `status != "removed"` form (pending and declined rows would otherwise
    leak in as phantom edges).
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


def test_session_graph_includes_not_bunk_with_edges() -> None:
    """The session-graph fetch must include `not_bunk_with` rows so staff
    edges render as red lines. An earlier iteration scoped the filter to
    `bunk_with` only, dropping every staff edge from the graph despite the
    legend advertising a red staff edge.
    """
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    builder = SocialGraphBuilder(pb=pb)
    builder.graph = nx.Graph()
    builder._add_request_edges(year=2026, session_cm_id=999)

    filter_str = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]["filter"]
    assert 'request_type = "bunk_with"' in filter_str, filter_str
    assert 'request_type = "not_bunk_with"' in filter_str, filter_str
    assert 'status = "resolved"' in filter_str, filter_str


def test_bunk_graph_includes_not_bunk_with_edges() -> None:
    """Bunk-graph fetch must include `not_bunk_with` so violations between
    bunkmates render as red lines instead of being silently dropped.
    """
    pb = MagicMock()
    bunk = MagicMock()
    bunk.name = "TestBunk"
    pb.collection.return_value.get_first_list_item.return_value = bunk

    # Mock at least one bunk member so build_bunk_graph reaches the
    # bunk_requests fetch (early-returns on empty membership).
    member_assignment = MagicMock()
    member_assignment.expand = {"person": MagicMock(cm_id=1)}
    person_record = MagicMock(cm_id=1, first_name="A", last_name="B", grade=6, gender="M")

    def _full_list(query_params: dict[str, str] | None = None, **_: Any) -> list[Any]:
        f = (query_params or {}).get("filter", "")
        if "bunk.cm_id" in f or "bunk_assignments" in f:
            return [member_assignment]
        if "request_type" in f:
            return []  # no requests; we only care that this fetch was issued
        if "cm_id = 1" in f and "request_type" not in f:
            return [person_record]
        return []

    pb.collection.return_value.get_full_list.side_effect = _full_list
    builder = SocialGraphBuilder(pb=pb)
    builder.build_bunk_graph(year=2026, bunk_cm_id=100, session_cm_id=999)

    fetch_calls = [
        c
        for c in pb.collection.return_value.get_full_list.call_args_list
        if "request_type" in c.kwargs.get("query_params", {}).get("filter", "")
    ]
    assert fetch_calls, "expected a bunk_requests fetch with request_type filter"
    filter_str = fetch_calls[0].kwargs["query_params"]["filter"]
    assert 'request_type = "bunk_with"' in filter_str, filter_str
    assert 'request_type = "not_bunk_with"' in filter_str, filter_str
    assert 'status = "resolved"' in filter_str, filter_str


def test_request_edges_carry_request_type_attribute() -> None:
    """Each request edge tags its request_type so the frontend cytoscape
    style can color bunk_with vs not_bunk_with differently (red for the
    latter)."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        _fake_request(1, 2, source="family", request_type="bunk_with"),
        _fake_request(3, 4, source="staff", request_type="not_bunk_with"),
    ]
    builder = SocialGraphBuilder(pb=pb)
    builder.graph = nx.Graph()
    for nid in (1, 2, 3, 4):
        builder.graph.add_node(nid, bunk_cm_id=100)
    builder._add_request_edges(year=2026, session_cm_id=999)
    edge_bw = builder.graph[1].get(2) or builder.graph[2].get(1)
    edge_nbw = builder.graph[3].get(4) or builder.graph[4].get(3)
    assert edge_bw is not None
    assert edge_bw.get("request_type") == "bunk_with"
    assert edge_nbw is not None
    assert edge_nbw.get("request_type") == "not_bunk_with"


def test_not_bunk_with_same_bunk_marks_unsatisfied() -> None:
    """A not_bunk_with edge where the requester is in the same bunk as the requestee
    is a violation — staff bucket marks unsatisfied for the requester."""
    builder = _make_builder()
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=100)
    builder.graph.add_node(2, bunk_cm_id=100)
    builder.graph.add_edge(
        1,
        2,
        edge_type="request",
        source="staff",
        source_field="not_bunk_with",
        request_type="not_bunk_with",
        requester_id=1,
        requestee_id=2,
    )
    builder._calculate_node_metrics()
    # Node 1 is the requester — violation (same bunk) → unsatisfied.
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"
    # Node 2 is the receiver only — no requests they made → no_requests.
    assert builder.graph.nodes[2]["staff_satisfaction_status"] == "no_requests"


def test_not_bunk_with_different_bunks_marks_satisfied() -> None:
    """A not_bunk_with edge where the target is in a different bunk satisfies
    the requester."""
    builder = _make_builder()
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=100)
    builder.graph.add_node(2, bunk_cm_id=200)
    builder.graph.add_edge(
        1,
        2,
        edge_type="request",
        source="staff",
        source_field="not_bunk_with",
        request_type="not_bunk_with",
        requester_id=1,
        requestee_id=2,
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "satisfied"


def test_not_bunk_with_unbunked_target_marks_satisfied() -> None:
    """A not_bunk_with where the target is unbunked is satisfied."""
    builder = _make_builder()
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=100)
    builder.graph.add_node(2, bunk_cm_id=None)
    builder.graph.add_edge(
        1,
        2,
        edge_type="request",
        source="staff",
        source_field="not_bunk_with",
        request_type="not_bunk_with",
        requester_id=1,
        requestee_id=2,
    )
    builder._calculate_node_metrics()
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "satisfied"


def test_unbunked_requester_marks_unsatisfied() -> None:
    """An unbunked requester with active requests is honestly unsatisfied
    rather than silently grey-stated.

    Updated under #1041 T9: the OLD `_bucket()` returned "no_requests" for
    unbunked requesters regardless of edge count. The NEW aggregator-backed
    bucket policy classifies them per-edge bucket and surfaces "unsatisfied"
    when there are pending counted requests the camper has not yet had met.
    This is the correct UI signal — an unassigned camper with a parent
    bunk_with request is NOT satisfied; they're waiting on placement.
    """
    builder = _make_builder()
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=None)  # unbunked requester
    builder.graph.add_node(2, bunk_cm_id=100)
    builder.graph.add_node(3, bunk_cm_id=100)
    builder.graph.add_edge(
        1,
        2,
        edge_type="request",
        source="family",
        source_field="bunk_with",
        request_type="bunk_with",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph.add_edge(
        1,
        3,
        edge_type="request",
        source="staff",
        source_field="not_bunk_with",
        request_type="not_bunk_with",
        requester_id=1,
        requestee_id=3,
    )
    builder._calculate_node_metrics()
    # Parent bucket: bunk_with → unsatisfied (requester unbunked → predicate False).
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "unsatisfied"
    # Staff bucket: not_bunk_with → unsatisfied (requester unbunked → predicate False).
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"


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
    """Minimal bunk_request record for build_bunk_graph edge creation.

    source_field defaults to "bunk_with" (MATERIAL_PARENT) for legacy callers
    that only specify the 2-axis source and request_type=bunk_with.
    """
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
        source_field="bunk_with",
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


def test_build_bunk_graph_reciprocal_pair_both_campers_satisfied() -> None:
    """Finding #5: reciprocal A↔B bunk_with pairs collapse to ONE edge in
    build_bunk_graph, storing only pair_requests[0] as the requester. The
    per-requester filter in _calculate_node_metrics then drops the *other*
    camper's request entirely — they get parent_satisfaction_status="no_requests"
    instead of "satisfied".

    Both campers in the same bunk with reciprocal bunk_with requests must each
    show as parent-satisfied.
    """
    pb = MagicMock()

    person_a_id = 2001
    person_b_id = 2002
    bunk_cm_id = 777
    session_cm_id = 999
    year = 2026

    assign_a = _make_assignment_with_expand(person_a_id)
    assign_b = _make_assignment_with_expand(person_b_id)
    person_a = _make_person(person_a_id, "Olivia", "Chen", bunk_cm_id)
    person_b = _make_person(person_b_id, "Riley", "Sam", bunk_cm_id)

    # Two reciprocal requests: a→b AND b→a.
    request_ab = _make_request_record(person_a_id, person_b_id, source="family")
    request_ba = _make_request_record(person_b_id, person_a_id, source="family")

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [assign_a, assign_b]
        elif name == "bunk_requests":
            col.get_full_list.return_value = [request_ab, request_ba]
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

    # Both campers must register as satisfied — neither's request can be lost.
    assert bunk_graph.nodes[person_a_id]["parent_satisfaction_status"] == "satisfied", (
        f"person_a parent_satisfaction_status="
        f"{bunk_graph.nodes[person_a_id].get('parent_satisfaction_status')!r}, expected 'satisfied'"
    )
    assert bunk_graph.nodes[person_b_id]["parent_satisfaction_status"] == "satisfied", (
        f"person_b parent_satisfaction_status="
        f"{bunk_graph.nodes[person_b_id].get('parent_satisfaction_status')!r}, expected 'satisfied' "
        "(reciprocal-pair collapse drops the second camper's request — see Finding #5)"
    )


# ---------------------------------------------------------------------------
# Audit 2026-04-29 finding: build_bunk_graph fetched all request types.
# A not_bunk_with row between two campers placed in the same bunk produced an
# edge that the satisfaction bucketer treated as "satisfied" (bunk == bunk),
# but the request is in fact VIOLATED — those two campers should not be
# bunkmates. The session-graph path filters request_type = "bunk_with" at
# the DB; the bunk-graph path must do the same.
# ---------------------------------------------------------------------------


def _make_typed_request_record(
    requester_id: int,
    requestee_id: int,
    source: str,
    request_type: str,
    source_field: str | None = None,
) -> object:
    """Same as _make_request_record but with explicit request_type.

    source_field defaults to mirror the canonical source/type pairing so
    pre-#1041 callsites continue to bucket as expected:
      source="family" + bunk_with     → source_field="bunk_with"
      source="staff"  + not_bunk_with → source_field="not_bunk_with"
    Override `source_field` directly for boundary cases.
    """
    from types import SimpleNamespace

    if source_field is None:
        source_field = "not_bunk_with" if request_type == "not_bunk_with" else "bunk_with"
    return SimpleNamespace(
        id=f"r-{requester_id}-{requestee_id}-{request_type}",
        requester_id=requester_id,
        requestee_id=requestee_id,
        request_type=request_type,
        priority=4,
        confidence_score=0.95,
        is_reciprocal=False,
        status="resolved",
        year=2026,
        source=source,
        source_field=source_field,
    )


def test_build_bunk_graph_includes_not_bunk_with_as_violation() -> None:
    """A not_bunk_with row between same-bunk people IS a violation — it must
    enter the graph as a request edge AND drive staff_satisfaction_status to
    "unsatisfied" so the frontend renders the relationship as a red line.

    Setup: Emma and Liam are in bunk 555. The only request between them is a
    not_bunk_with row from staff. They should not be bunkmates, so the staff
    bucketer must mark them unsatisfied (NOT no_requests).
    """
    pb = MagicMock()

    person_a_id = 1001
    person_b_id = 1002
    bunk_cm_id = 555
    session_cm_id = 999
    year = 2026

    assign_a = _make_assignment_with_expand(person_a_id)
    assign_b = _make_assignment_with_expand(person_b_id)

    person_a = _make_person(person_a_id, "Emma", "Johnson", bunk_cm_id)
    person_b = _make_person(person_b_id, "Liam", "Garcia", bunk_cm_id)

    not_bunk_request = _make_typed_request_record(
        person_a_id, person_b_id, source="staff", request_type="not_bunk_with"
    )

    captured_filters: list[str] = []

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [assign_a, assign_b]
        elif name == "bunk_requests":

            def _capture_filter(*args: object, **kwargs: object) -> list[object]:
                qp = kwargs.get("query_params") or (args[0] if args else {})
                flt = str(qp.get("filter", "")) if isinstance(qp, dict) else ""
                captured_filters.append(flt)
                # The bunk_graph fetch now includes both
                # request_type values; the DB returns whatever matches.
                # The not_bunk_with row should come back and produce a
                # red-line edge in the graph.
                return [not_bunk_request]

            col.get_full_list.side_effect = _capture_filter
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

    # The DB query for bunk_requests must include both request_types so
    # not_bunk_with violations land as red-line edges.
    request_filters = [f for f in captured_filters if "request_type" in f]
    assert any('request_type = "bunk_with"' in f for f in request_filters), request_filters
    assert any('request_type = "not_bunk_with"' in f for f in request_filters), request_filters

    # The not_bunk_with row should produce a request edge tagged with its type.
    request_edges = [(u, v, d) for u, v, d in bunk_graph.edges(data=True) if d.get("edge_type") == "request"]
    assert len(request_edges) >= 1, f"expected a request edge from the not_bunk_with row; got {request_edges!r}"
    nbw_edges = [e for e in request_edges if e[2].get("request_type") == "not_bunk_with"]
    assert nbw_edges, f"expected a not_bunk_with-tagged edge; got {request_edges!r}"

    # Same-bunk not_bunk_with is a violation → the REQUESTER's
    # staff_satisfaction_status flips to unsatisfied. The requestee made no
    # request of their own, so their status stays at no_requests (each
    # camper's status reflects their own requests; bunk_graph is a DiGraph).
    # parent_satisfaction_status remains no_requests for both (no bunk_with rows).
    assert bunk_graph.nodes[person_a_id]["staff_satisfaction_status"] == "unsatisfied"
    assert bunk_graph.nodes[person_b_id]["staff_satisfaction_status"] == "no_requests"


# ---------------------------------------------------------------------------
# bunk_graph regression tests for cross-session leak, reciprocal-collapse
# request_type collisions, and the parent/staff classifier.
# ---------------------------------------------------------------------------


def test_build_bunk_graph_request_fetch_filters_by_session_id() -> None:
    """build_bunk_graph must scope its bunk_requests fetch to the current
    session_cm_id, not just the year. Without this filter, when the same
    person has assignments in multiple sessions in the same year, requests
    from session B leak into the bunk graph for session A.
    """
    pb = MagicMock()
    bunk = MagicMock()
    bunk.name = "TestBunk"
    pb.collection.return_value.get_first_list_item.return_value = bunk

    member_assignment = MagicMock()
    member_assignment.expand = {"person": MagicMock(cm_id=1)}
    person_record = MagicMock(cm_id=1, first_name="A", last_name="B", grade=6, gender="M")

    captured_filters: list[str] = []

    def _full_list(query_params: dict[str, str] | None = None, **_: Any) -> list[Any]:
        f = (query_params or {}).get("filter", "")
        if "bunk.cm_id" in f or "bunk_assignments" in f:
            return [member_assignment]
        if "request_type" in f:
            captured_filters.append(f)
            return []
        if "cm_id = 1" in f and "request_type" not in f:
            return [person_record]
        return []

    pb.collection.return_value.get_full_list.side_effect = _full_list
    builder = SocialGraphBuilder(pb=pb)
    builder.build_bunk_graph(year=2026, bunk_cm_id=100, session_cm_id=999)

    assert captured_filters, "expected a bunk_requests fetch with request_type filter"
    flt = captured_filters[0]
    assert "session_id = 999" in flt, f"build_bunk_graph fetch must filter by session_cm_id (#1 scan-it), got: {flt!r}"


def test_build_bunk_graph_reciprocal_with_opposite_request_types_preserves_both() -> None:
    """Reciprocal-edge collapse must NOT flatten an A→B bunk_with paired with
    B→A not_bunk_with into one edge. The pair_key includes request_type so
    each type collapses independently and both directions survive.
    """
    pb = MagicMock()

    person_a_id = 1001
    person_b_id = 1002
    bunk_cm_id = 555
    session_cm_id = 999
    year = 2026

    assign_a = _make_assignment_with_expand(person_a_id)
    assign_b = _make_assignment_with_expand(person_b_id)

    person_a = _make_person(person_a_id, "Emma", "Johnson", bunk_cm_id)
    person_b = _make_person(person_b_id, "Liam", "Garcia", bunk_cm_id)

    bw_request = _make_typed_request_record(person_a_id, person_b_id, source="family", request_type="bunk_with")
    nbw_request = _make_typed_request_record(person_b_id, person_a_id, source="staff", request_type="not_bunk_with")

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [assign_a, assign_b]
        elif name == "bunk_requests":
            col.get_full_list.return_value = [bw_request, nbw_request]
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

    request_edges = [(u, v, d) for u, v, d in bunk_graph.edges(data=True) if d.get("edge_type") == "request"]
    rt_present = {d.get("request_type") for _u, _v, d in request_edges}
    assert "bunk_with" in rt_present, (
        f"bunk_with edge must survive collapse; edges={[(u, v, d.get('request_type')) for u, v, d in request_edges]!r}"
    )
    assert "not_bunk_with" in rt_present, (
        f"not_bunk_with edge must survive collapse alongside bunk_with; "
        f"edges={[(u, v, d.get('request_type')) for u, v, d in request_edges]!r}"
    )


def test_parent_edges_filter_excludes_not_bunk_with_source_field() -> None:
    """A not_bunk_with-source request must NOT feed the parent (MATERIAL_PARENT)
    bucket, regardless of which legacy 2-axis `source` value it had.

    Updated under #1041 T9: classification now reads `source_field` (the
    canonical 3-bucket axis from bunking.satisfaction.bucket), not
    `request_type`. The boundary case the older test captured (FAMILY-source
    not_bunk_with) is structurally impossible under the new policy because
    source_field=not_bunk_with always classifies into STAFF — independent of
    the legacy `source` field.
    """
    builder = _make_builder()
    builder.graph = nx.Graph()
    builder.graph.add_node(1, bunk_cm_id=100)
    builder.graph.add_node(2, bunk_cm_id=100)
    # source_field=not_bunk_with → STAFF bucket; must NOT feed parent.
    builder.graph.add_edge(
        1,
        2,
        edge_type="request",
        source="family",
        source_field="not_bunk_with",
        request_type="not_bunk_with",
        requester_id=1,
        requestee_id=2,
    )
    builder._calculate_node_metrics()
    # Parent bucket sees no MATERIAL_PARENT edges → no_requests.
    assert builder.graph.nodes[1]["parent_satisfaction_status"] == "no_requests", (
        f"not_bunk_with source_field must route to STAFF, not MATERIAL_PARENT "
        f"(#6 scan-it); got {builder.graph.nodes[1].get('parent_satisfaction_status')!r}"
    )
    # The not_bunk_with edge falls into the staff bucket (it's a violation —
    # same bunk → unsatisfied).
    assert builder.graph.nodes[1]["staff_satisfaction_status"] == "unsatisfied"

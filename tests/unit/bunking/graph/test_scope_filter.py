"""Tests for graph scope filtering — used by the scoped social-graph endpoint.

The scope filter takes a built NetworkX graph and a set of in-scope bunk_cm_ids
and returns:
  - a subgraph containing only nodes whose bunk_cm_id is in scope
  - (optionally) the cross-scope edges that span the boundary, tagged for the
    frontend to render as ghosted

This module is a pure function — no PocketBase, no FastAPI. Endpoint wiring is
tested separately.
"""

from __future__ import annotations

import networkx as nx
import pytest
from pydantic import ValidationError

from api.schemas.social_graph import SocialGraphResponse
from bunking.graph.scope_filter import CrossScopeEdge, apply_scope


def _make_graph() -> nx.DiGraph:
    """Build a tiny graph: 4 campers across 2 bunks, with edges within and across.

        bunk 100: Alice(1), Bob(2)
        bunk 200: Carol(3), Dave(4)

    Edges:
        1 → 2  (within bunk 100)
        3 → 4  (within bunk 200)
        2 → 3  (cross-bunk: 100 → 200)
        4 → 1  (cross-bunk: 200 → 100)
    """
    g = nx.DiGraph()
    g.add_node(1, bunk_cm_id=100, name="Alice")
    g.add_node(2, bunk_cm_id=100, name="Bob")
    g.add_node(3, bunk_cm_id=200, name="Carol")
    g.add_node(4, bunk_cm_id=200, name="Dave")
    g.add_edge(1, 2, weight=1.0, edge_type="request")
    g.add_edge(3, 4, weight=1.0, edge_type="request")
    g.add_edge(2, 3, weight=1.0, edge_type="request")
    g.add_edge(4, 1, weight=1.0, edge_type="request")
    return g


class TestApplyScope:
    def test_empty_scope_returns_full_graph_unchanged(self) -> None:
        g = _make_graph()
        sub, cross, oos = apply_scope(g, in_scope_bunk_cm_ids=set(), include_cross_scope=False)
        assert set(sub.nodes()) == {1, 2, 3, 4}
        assert sub.number_of_edges() == 4
        assert cross == []
        assert oos == set()

    def test_scope_to_one_bunk_drops_other_bunk_nodes(self) -> None:
        g = _make_graph()
        sub, _, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=False)
        assert set(sub.nodes()) == {1, 2}

    def test_scope_to_one_bunk_keeps_only_within_scope_edges(self) -> None:
        g = _make_graph()
        sub, _, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=False)
        assert list(sub.edges()) == [(1, 2)]

    def test_scope_to_two_bunks_includes_within_each(self) -> None:
        g = _make_graph()
        sub, _, _ = apply_scope(g, in_scope_bunk_cm_ids={100, 200}, include_cross_scope=False)
        assert set(sub.nodes()) == {1, 2, 3, 4}
        assert {(u, v) for u, v in sub.edges()} == {(1, 2), (3, 4), (2, 3), (4, 1)}

    def test_cross_scope_disabled_returns_no_cross_edges(self) -> None:
        g = _make_graph()
        _, cross, oos = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=False)
        assert cross == []
        assert oos == set()

    def test_cross_scope_enabled_returns_boundary_edges_only(self) -> None:
        g = _make_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        # 2→3 leaves scope (2 in, 3 out); 4→1 enters scope (4 out, 1 in)
        cross_pairs = {(e.source, e.target) for e in cross}
        assert cross_pairs == {(2, 3), (4, 1)}

    def test_cross_scope_edges_are_tagged_cross_scope(self) -> None:
        g = _make_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        for edge in cross:
            assert edge.cross_scope is True

    def test_cross_scope_does_not_introduce_out_of_scope_nodes_into_subgraph(self) -> None:
        """Cross-scope edges return as a separate list — the subgraph itself
        only contains in-scope nodes. The cross_scope_node_ids set carries the
        out-of-scope endpoints so the caller can render them as ghosts."""
        g = _make_graph()
        sub, cross, oos = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        assert set(sub.nodes()) == {1, 2}
        assert cross  # cross-edges still surface
        # 2→3 contributes 3, 4→1 contributes 4 — both out-of-scope endpoints.
        assert oos == {3, 4}

    def test_cross_scope_node_ids_dedupe_when_same_endpoint_used_twice(self) -> None:
        g = _make_graph()
        # Add a second cross-edge into node 3 from node 1 so endpoint 3 fires twice.
        g.add_edge(1, 3, weight=1.0, edge_type="request")
        _, _, oos = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        assert 3 in oos
        # Set semantics: 3 appears once even though two edges leave to it.
        assert sum(1 for n in oos if n == 3) == 1

    def test_scope_with_bunk_no_nodes_returns_empty_subgraph(self) -> None:
        g = _make_graph()
        sub, cross, oos = apply_scope(g, in_scope_bunk_cm_ids={999}, include_cross_scope=False)
        assert sub.number_of_nodes() == 0
        assert sub.number_of_edges() == 0
        assert cross == []
        assert oos == set()

    def test_subgraph_preserves_node_attributes(self) -> None:
        g = _make_graph()
        sub, _, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=False)
        assert sub.nodes[1]["name"] == "Alice"
        assert sub.nodes[1]["bunk_cm_id"] == 100

    def test_subgraph_preserves_edge_attributes(self) -> None:
        g = _make_graph()
        sub, _, _ = apply_scope(g, in_scope_bunk_cm_ids={100, 200}, include_cross_scope=False)
        assert sub.edges[1, 2]["weight"] == 1.0
        assert sub.edges[1, 2]["edge_type"] == "request"

    def test_cross_scope_edges_carry_request_metadata(self) -> None:
        """Cross-scope edges must surface the same request_type / priority /
        confidence / reciprocal fields the frontend uses on in-scope edges,
        so the bucket-collapse logic can treat them as first-class participants
        (sameKind comparison, multi-curve detection, reciprocal collapse)."""
        g = nx.DiGraph()
        g.add_node(1, bunk_cm_id=100, name="Alice")
        g.add_node(2, bunk_cm_id=200, name="Bob")
        g.add_node(3, bunk_cm_id=200, name="Carol")
        # Cross-edge 1 → 2 with full request metadata
        g.add_edge(
            1,
            2,
            weight=1.0,
            edge_type="request",
            priority=5,
            confidence=0.9,
            is_reciprocal=True,
            request_type="bunk_with",
        )
        # Reciprocal back-edge 2 → 1, so apply_scope can derive reciprocal=True
        # via graph.has_edge(target, source) the same way the router does.
        g.add_edge(
            2,
            1,
            weight=1.0,
            edge_type="request",
            priority=5,
            confidence=0.9,
            is_reciprocal=True,
            request_type="bunk_with",
        )
        # A second cross-edge with different request_type, no reciprocal,
        # so the test also covers the no-reciprocal + distinct-request_type path.
        g.add_edge(
            1,
            3,
            weight=1.0,
            edge_type="request",
            priority=2,
            confidence=0.6,
            is_reciprocal=False,
            request_type="not_bunk_with",
        )

        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        by_pair = {(e.source, e.target): e for e in cross}

        # 1 → 2 cross-edge: full metadata, reciprocal=True (back-edge exists)
        e12 = by_pair[(1, 2)]
        assert e12.request_type == "bunk_with"
        assert e12.confidence == 0.9
        assert e12.reciprocal is True

        # 2 → 1 cross-edge: same metadata, reciprocal=True (forward edge exists)
        e21 = by_pair[(2, 1)]
        assert e21.request_type == "bunk_with"
        assert e21.reciprocal is True

        # 1 → 3 cross-edge: different request_type, reciprocal=False (no back-edge)
        e13 = by_pair[(1, 3)]
        assert e13.request_type == "not_bunk_with"
        assert e13.confidence == 0.6
        assert e13.reciprocal is False


class TestResolveScopeBunkIds:
    """resolve_scope_bunk_ids takes user-facing slugs (units, bunk codes)
    plus a list of bunk records and returns the set of in-scope bunk_cm_ids."""

    def test_empty_inputs_return_empty_set(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        result = resolve_scope_bunk_ids(units=[], bunk_codes=[], bunks=[])
        assert result == set()

    def test_unit_slug_resolves_to_all_bunks_in_that_unit(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        bunks = [
            {"cm_id": 100, "name": "B-3"},  # Galil
            {"cm_id": 101, "name": "G-3"},  # Galil
            {"cm_id": 102, "name": "AG-3"},  # Galil
            {"cm_id": 200, "name": "B-7"},  # Haifa
        ]
        result = resolve_scope_bunk_ids(units=["galil"], bunk_codes=[], bunks=bunks)
        assert result == {100, 101, 102}

    def test_bunk_code_resolves_to_one_bunk_cm_id(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        bunks = [
            {"cm_id": 100, "name": "B-9"},
            {"cm_id": 101, "name": "G-9"},
        ]
        # bunk_codes are slugified bunk names — "b-9" matches "B-9"
        result = resolve_scope_bunk_ids(units=[], bunk_codes=["b-9"], bunks=bunks)
        assert result == {100}

    def test_unit_and_bunk_codes_union(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        bunks = [
            {"cm_id": 100, "name": "B-3"},  # Galil
            {"cm_id": 200, "name": "B-9"},  # Chalutzim 1
        ]
        result = resolve_scope_bunk_ids(units=["galil"], bunk_codes=["b-9"], bunks=bunks)
        assert result == {100, 200}

    def test_unknown_unit_slug_silently_drops(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        bunks = [{"cm_id": 100, "name": "B-3"}]
        result = resolve_scope_bunk_ids(units=["atlantis"], bunk_codes=[], bunks=bunks)
        assert result == set()

    def test_unknown_bunk_code_silently_drops(self) -> None:
        from bunking.graph.scope_filter import resolve_scope_bunk_ids

        bunks = [{"cm_id": 100, "name": "B-3"}]
        result = resolve_scope_bunk_ids(units=[], bunk_codes=["q-99"], bunks=bunks)
        assert result == set()


class TestParseScopeQuery:
    """parse_scope_query splits CSV query strings into clean lists."""

    def test_returns_empty_lists_when_none(self) -> None:
        from bunking.graph.scope_filter import parse_scope_query

        units, bunks = parse_scope_query(units_param=None, bunks_param=None)
        assert units == []
        assert bunks == []

    def test_splits_csv_and_lowercases(self) -> None:
        from bunking.graph.scope_filter import parse_scope_query

        units, bunks = parse_scope_query(units_param="Galil,CARMEL", bunks_param="B-9,G-10")
        assert units == ["galil", "carmel"]
        assert bunks == ["b-9", "g-10"]

    def test_strips_whitespace(self) -> None:
        from bunking.graph.scope_filter import parse_scope_query

        units, bunks = parse_scope_query(units_param=" galil , carmel ", bunks_param=" b-9 ")
        assert units == ["galil", "carmel"]
        assert bunks == ["b-9"]

    def test_drops_empty_segments(self) -> None:
        from bunking.graph.scope_filter import parse_scope_query

        units, bunks = parse_scope_query(units_param="galil,,carmel", bunks_param=",")
        assert units == ["galil", "carmel"]
        assert bunks == []


class TestCrossScopeEdgeModel:
    """Unit tests for the CrossScopeEdge Pydantic model.

    Covers construction, default values, required-field validation, and the
    constraint that cross_scope is always True (Literal[True]).
    """

    def test_minimal_construction(self) -> None:
        """Required fields: source, target, edge_type. Everything else has defaults."""
        edge = CrossScopeEdge(source=1, target=2, edge_type="request")
        assert edge.source == 1
        assert edge.target == 2
        assert edge.edge_type == "request"
        assert edge.weight == 1.0
        assert edge.reciprocal is False
        assert edge.cross_scope is True

    def test_full_construction(self) -> None:
        """All optional fields accepted and round-trip correctly."""
        edge = CrossScopeEdge(
            source=10,
            target=20,
            edge_type="request",
            weight=2.5,
            request_type="bunk_with",
            priority=5,
            confidence=0.95,
            reciprocal=True,
        )
        assert edge.request_type == "bunk_with"
        assert edge.confidence == 0.95
        assert edge.reciprocal is True

    def test_cross_scope_false_is_rejected(self) -> None:
        """Pydantic should reject cross_scope=False since the field is Literal[True]."""
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2, edge_type="request", cross_scope=False)

    def test_missing_source_raises(self) -> None:
        with pytest.raises(ValidationError):
            CrossScopeEdge(target=2, edge_type="request")  # type: ignore[call-arg]

    def test_missing_target_raises(self) -> None:
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, edge_type="request")  # type: ignore[call-arg]

    def test_missing_edge_type_raises(self) -> None:
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2)  # type: ignore[call-arg]

    def test_optional_fields_default_to_none(self) -> None:
        edge = CrossScopeEdge(source=1, target=2, edge_type="request")
        assert edge.request_type is None
        assert edge.confidence is None

    def test_deprecated_historical_edge_type_rejected(self) -> None:
        """edge_type='historical' was removed in #1162; schema must reject it."""
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2, edge_type="historical")

    def test_deprecated_sibling_edge_type_rejected(self) -> None:
        """edge_type='sibling' was removed in #1162; schema must reject it."""
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2, edge_type="sibling")

    def test_deprecated_classmate_city_edge_type_rejected(self) -> None:
        """edge_type='classmate_city' was removed in #1162; schema must reject it."""
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2, edge_type="classmate_city")

    def test_deprecated_classmate_state_edge_type_rejected(self) -> None:
        """edge_type='classmate_state' was removed in #1162; schema must reject it."""
        with pytest.raises(ValidationError):
            CrossScopeEdge(source=1, target=2, edge_type="classmate_state")

    def test_serialises_to_dict_with_cross_scope_true(self) -> None:
        edge = CrossScopeEdge(source=1, target=2, edge_type="request")
        d = edge.model_dump()
        assert d["cross_scope"] is True
        assert d["source"] == 1
        assert d["target"] == 2


class TestSocialGraphResponseCrossScopeEdgesTyped:
    """SocialGraphResponse.cross_scope_edges must be typed as list[CrossScopeEdge],
    not list[dict[str, Any]]. Pydantic validates on assignment."""

    def test_accepts_cross_scope_edge_instances(self) -> None:
        """list[CrossScopeEdge] — model instances accepted."""
        edges = [
            CrossScopeEdge(source=1, target=3, edge_type="request"),
            CrossScopeEdge(source=2, target=4, edge_type="request", reciprocal=True),
        ]
        resp = SocialGraphResponse(
            nodes=[],
            edges=[],
            metrics={},
            communities={},
            cross_scope_edges=edges,
        )
        assert len(resp.cross_scope_edges) == 2
        assert isinstance(resp.cross_scope_edges[0], CrossScopeEdge)

    def test_accepts_raw_dicts_via_pydantic_coercion(self) -> None:
        """Pydantic v2 coerces compatible dicts into CrossScopeEdge instances."""
        raw = [{"source": 1, "target": 3, "edge_type": "request"}]
        resp = SocialGraphResponse(
            nodes=[],
            edges=[],
            metrics={},
            communities={},
            cross_scope_edges=raw,
        )
        assert isinstance(resp.cross_scope_edges[0], CrossScopeEdge)
        assert resp.cross_scope_edges[0].cross_scope is True

    def test_rejects_dict_missing_required_fields(self) -> None:
        """Dict without 'edge_type' fails Pydantic validation for CrossScopeEdge."""
        with pytest.raises(ValidationError):
            SocialGraphResponse(
                nodes=[],
                edges=[],
                metrics={},
                communities={},
                cross_scope_edges=[{"source": 1, "target": 2}],
            )

    def test_defaults_to_empty_list(self) -> None:
        resp = SocialGraphResponse(nodes=[], edges=[], metrics={}, communities={})
        assert resp.cross_scope_edges == []


class TestApplyScopeReturnsCrossScopeEdgeObjects:
    """apply_scope should return list[CrossScopeEdge] (typed model instances)
    rather than list[dict[str, Any]]."""

    def _make_simple_graph(self) -> nx.DiGraph:
        g = nx.DiGraph()
        g.add_node(1, bunk_cm_id=100, name="Emma Johnson")
        g.add_node(2, bunk_cm_id=200, name="Liam Garcia")
        g.add_edge(1, 2, weight=1.0, edge_type="request", priority=3, confidence=0.8, request_type="bunk_with")
        g.add_edge(2, 1, weight=1.0, edge_type="request", priority=3, confidence=0.8, request_type="bunk_with")
        return g

    def test_cross_scope_edges_are_crossscopeedge_instances(self) -> None:
        g = self._make_simple_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        assert len(cross) > 0
        for edge in cross:
            assert isinstance(edge, CrossScopeEdge), f"Expected CrossScopeEdge, got {type(edge)}"

    def test_cross_scope_edge_fields_populated_from_graph(self) -> None:
        g = self._make_simple_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=True)
        by_pair = {(e.source, e.target): e for e in cross}
        e12 = by_pair[(1, 2)]
        assert e12.edge_type == "request"
        assert e12.confidence == 0.8
        assert e12.request_type == "bunk_with"
        assert e12.reciprocal is True  # back-edge 2→1 exists
        assert e12.cross_scope is True

    def test_empty_cross_scope_returns_empty_list(self) -> None:
        g = self._make_simple_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids={100}, include_cross_scope=False)
        assert cross == []

    def test_empty_scope_returns_empty_list(self) -> None:
        g = self._make_simple_graph()
        _, cross, _ = apply_scope(g, in_scope_bunk_cm_ids=set(), include_cross_scope=True)
        assert cross == []

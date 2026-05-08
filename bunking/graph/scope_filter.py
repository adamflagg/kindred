"""Pure functions for scoping a built social graph to a subset of bunks/units.

The scoped social-graph endpoint composes these three functions:

    1. parse_scope_query  → splits "?units=galil,carmel&bunks=b-9" into clean lists
    2. resolve_scope_bunk_ids → maps unit slugs + bunk codes to bunk_cm_ids using
       the bunks collection plus bunking.utils.units
    3. apply_scope        → returns (subgraph, cross_scope_edges) given a graph
       and the resolved set of in-scope bunk_cm_ids

Empty scope is treated as a no-op (full graph) so the same code path can serve
unfiltered requests.
"""

from __future__ import annotations

from typing import Any, Literal, cast

import networkx as nx
from pydantic import BaseModel

from bunking.utils.units import UNIT_NAMES, get_bunks_in_unit, unit_to_slug


class CrossScopeEdge(BaseModel):
    """An edge crossing the active scope boundary.

    Returned alongside the in-scope subgraph when ?cross_scope=true so the
    frontend can render these as ghosted/dashed context edges.

    Lives in the domain layer (bunking.graph) to keep bunking/ self-contained
    and avoid a layering inversion (domain importing from presentation).
    """

    source: int
    target: int
    edge_type: Literal["request"]
    weight: float = 1.0
    request_type: str | None = None
    priority: int | None = None
    confidence: float | None = None
    reciprocal: bool = False
    cross_scope: Literal[True] = True


def parse_scope_query(
    units_param: str | None,
    bunks_param: str | None,
) -> tuple[list[str], list[str]]:
    """Split CSV query params into trimmed, lowercased lists. Empty segments dropped."""

    def _split(raw: str | None) -> list[str]:
        if not raw:
            return []
        return [seg.strip().lower() for seg in raw.split(",") if seg.strip()]

    return _split(units_param), _split(bunks_param)


def resolve_scope_bunk_ids(
    units: list[str],
    bunk_codes: list[str],
    bunks: list[dict[str, Any]],
) -> set[int]:
    """Map user-facing slugs to the set of in-scope bunk_cm_ids.

    Args:
        units: lowercase unit slugs (e.g. ["galil", "carmel"])
        bunk_codes: lowercase bunk slugs (e.g. ["b-9"])
        bunks: bunk records [{cm_id, name, ...}, ...]

    Unknown slugs are silently dropped (defensive against stale URLs).
    """
    in_scope: set[int] = set()
    bunk_names = [str(b.get("name", "")) for b in bunks]
    bunk_by_name = {str(b.get("name", "")).lower(): b for b in bunks}

    for unit_slug in units:
        unit_name = next(
            (u for u in UNIT_NAMES if unit_to_slug(u) == unit_slug),
            None,
        )
        if unit_name is None:
            continue
        names_in_unit = set(get_bunks_in_unit(unit_name, bunk_names))
        for bunk in bunks:
            if str(bunk.get("name", "")) in names_in_unit:
                cm_id = bunk.get("cm_id")
                if cm_id is not None:
                    in_scope.add(int(cm_id))

    for code in bunk_codes:
        matched = bunk_by_name.get(code)
        if matched is not None:
            cm_id = matched.get("cm_id")
            if cm_id is not None:
                in_scope.add(int(cm_id))

    return in_scope


def apply_scope(
    graph: nx.DiGraph,
    in_scope_bunk_cm_ids: set[int],
    include_cross_scope: bool,
) -> tuple[nx.DiGraph, list[CrossScopeEdge], set[int]]:
    """Filter a built graph to in-scope nodes and (optionally) tag cross-scope edges.

    Returns:
        subgraph: NetworkX DiGraph containing only in-scope nodes and the edges
            among them.
        cross_scope_edges: list of CrossScopeEdge instances for edges that cross
            the scope boundary in either direction.
            Empty when in_scope is empty or include_cross_scope is False.
        cross_scope_node_ids: set of node ids (camper cm_ids) that sit on the
            far side of a cross-scope edge — i.e. out-of-scope endpoints the
            caller needs to surface as ghosted nodes for context. Empty when
            include_cross_scope is False.
    """
    if not in_scope_bunk_cm_ids:
        # Empty scope = no filtering (caller treats this as "show everything")
        return graph, [], set()

    in_scope_nodes = {n for n, data in graph.nodes(data=True) if data.get("bunk_cm_id") in in_scope_bunk_cm_ids}

    subgraph = cast(nx.DiGraph, graph.subgraph(in_scope_nodes).copy())

    cross_scope_edges: list[CrossScopeEdge] = []
    cross_scope_node_ids: set[int] = set()
    if include_cross_scope:
        for source, target, data in graph.edges(data=True):
            source_in = source in in_scope_nodes
            target_in = target in in_scope_nodes
            if source_in != target_in:
                cross_scope_edges.append(
                    CrossScopeEdge(
                        source=source,
                        target=target,
                        weight=data.get("weight", 1.0),
                        edge_type=data.get("edge_type", "request"),
                        request_type=data.get("request_type"),
                        priority=data.get("priority"),
                        confidence=data.get("confidence"),
                        # Derived from the full pre-subgraph topology — same approach
                        # the API router uses for in-scope SocialGraphEdge.reciprocal.
                        reciprocal=graph.has_edge(target, source),
                    )
                )
                cross_scope_node_ids.add(target if source_in else source)

    return subgraph, cross_scope_edges, cross_scope_node_ids

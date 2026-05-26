"""Unit tests for the extracted bunk cross-scope domain helper (#1636).

The cross-scope assembly (get-or-build session graph -> apply_scope -> resolve
each ghost's current bunk name) was lifted out of the social_graph router into
``bunking.graph.bunk_cross_scope`` so it is unit-testable without booting
FastAPI and so the router stays transport-only glue.
"""

import asyncio
from unittest.mock import MagicMock, patch

import networkx as nx

from bunking.graph.bunk_cross_scope import GhostNode, collect_bunk_cross_scope

BUNK_CM_ID = 9001
OTHER_BUNK_CM_ID = 9002
SESSION_CM_ID = 5001
YEAR = 2025
IN_BUNK_PERSON = 101
OUT_OF_BUNK_PERSON = 202


def _session_graph() -> nx.DiGraph:
    """Session graph with one cross-scope edge from the in-bunk camper to an
    out-of-bunk camper, so a single ghost node/edge is produced."""
    g = nx.DiGraph()
    g.add_node(
        IN_BUNK_PERSON,
        bunk_cm_id=BUNK_CM_ID,
        grade=7,
        name="Emma Johnson",
        centrality=0.5,
        clustering=0.0,
        community=0,
    )
    g.add_node(
        OUT_OF_BUNK_PERSON,
        bunk_cm_id=OTHER_BUNK_CM_ID,
        grade=7,
        name="Liam Garcia",
        centrality=0.4,
        clustering=0.0,
        community=1,
    )
    g.add_edge(
        IN_BUNK_PERSON,
        OUT_OF_BUNK_PERSON,
        edge_type="request",
        weight=1.0,
        reciprocal=False,
        confidence=0.9,
        request_type="bunk_with",
    )
    return g


def _mock_pb() -> MagicMock:
    # `name` is a reserved MagicMock constructor kwarg (sets the mock's repr),
    # so assign the attribute after construction.
    eagle = MagicMock(cm_id=BUNK_CM_ID)
    eagle.name = "Eagle Cabin"
    hawk = MagicMock(cm_id=OTHER_BUNK_CM_ID)
    hawk.name = "Hawk Cabin"
    col = MagicMock()
    col.get_full_list.return_value = [eagle, hawk]
    pb = MagicMock()
    pb.collection.return_value = col
    return pb


def test_cache_hit_returns_boundary_edges_and_named_ghosts() -> None:
    cache = MagicMock()
    cache.get_session_graph.return_value = _session_graph()
    pb = _mock_pb()

    edges, ghosts = asyncio.run(
        collect_bunk_cross_scope(
            graph_cache=cache,
            pb=pb,
            session_cm_id=SESSION_CM_ID,
            bunk_cm_id=BUNK_CM_ID,
            year=YEAR,
            scenario_id=None,
            random_seed=42,
        )
    )

    # Cache hit -> no on-demand build/cache write.
    cache.cache_session_graph.assert_not_called()
    assert len(edges) == 1
    assert len(ghosts) == 1
    ghost = ghosts[0]
    assert isinstance(ghost, GhostNode)
    assert ghost.id == OUT_OF_BUNK_PERSON
    # The ghost carries its CURRENT bunk's name, resolved from its bunk_cm_id.
    assert ghost.bunk_name == "Hawk Cabin"


def test_cache_miss_builds_and_caches_session_graph() -> None:
    cache = MagicMock()
    cache.get_session_graph.return_value = None  # miss -> on-demand build
    pb = _mock_pb()

    builder = MagicMock()
    builder.build_social_network.return_value = _session_graph()

    with patch(
        "bunking.graph.bunk_cross_scope.OptimizedSocialGraphBuilder",
        return_value=builder,
    ):
        edges, ghosts = asyncio.run(
            collect_bunk_cross_scope(
                graph_cache=cache,
                pb=pb,
                session_cm_id=SESSION_CM_ID,
                bunk_cm_id=BUNK_CM_ID,
                year=YEAR,
                scenario_id=None,
                random_seed=42,
            )
        )

    builder.build_social_network.assert_called_once()
    cache.cache_session_graph.assert_called_once()
    assert len(edges) == 1
    assert len(ghosts) == 1
    assert ghosts[0].bunk_name == "Hawk Cabin"

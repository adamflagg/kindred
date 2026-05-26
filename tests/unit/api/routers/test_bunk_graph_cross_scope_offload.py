"""Finding 3: the cross-scope cache-miss session-graph build must be offloaded.

When ?cross_scope=true and the session graph is NOT already cached, the bunk
social-graph endpoint builds the full session graph on demand. That build is a
synchronous, CPU/IO-heavy call (`builder.build_social_network`). Running it
directly on the asyncio event loop blocks every other request on the worker
until it finishes — the rest of this router already offloads such calls via
`asyncio.to_thread`.

This test asserts the cross-scope on-demand build is dispatched through
`asyncio.to_thread` (the established offload pattern in this router), rather
than being awaited/called inline on the event loop.
"""

import asyncio
import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock, patch

import networkx as nx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user

BUNK_CM_ID = 9001
SESSION_CM_ID = 5001
YEAR = 2025
IN_BUNK_PERSON = 101
OUT_OF_BUNK_PERSON = 202
OTHER_BUNK_CM_ID = 9002


def _mock_admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _make_person_record(cm_id: int, first_name: str, last_name: str) -> MagicMock:
    record = MagicMock()
    record.cm_id = cm_id
    record.first_name = first_name
    record.last_name = last_name
    record.grade = 7
    record.years_at_camp = 3
    return record


def _build_bunk_graph() -> nx.DiGraph:
    """Minimal in-bunk graph: one node, no edges (keeps the bunk path simple)."""
    g = nx.DiGraph()
    g.add_node(
        IN_BUNK_PERSON,
        centrality=0.5,
        clustering=0.0,
        community=0,
        parent_satisfaction_status="no_requests",
        staff_satisfaction_status="no_requests",
        satisfaction_status="no_requests",
        last_year_session=None,
        last_year_bunk=None,
    )
    return g


def _build_session_graph() -> nx.DiGraph:
    """Full session graph with a cross-scope edge from the in-bunk camper to an
    out-of-bunk camper so the cross-scope path produces a ghost node/edge."""
    g = nx.DiGraph()
    g.add_node(IN_BUNK_PERSON, bunk_cm_id=BUNK_CM_ID, grade=7, centrality=0.5, clustering=0.0, community=0)
    g.add_node(OUT_OF_BUNK_PERSON, bunk_cm_id=OTHER_BUNK_CM_ID, grade=7, centrality=0.4, clustering=0.0, community=1)
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


@pytest.fixture
def cross_scope_client() -> Generator[tuple[TestClient, dict[str, int]]]:
    """TestClient that records whether the session-graph build was offloaded."""
    recorded: dict[str, int] = {"build_calls": 0, "offloaded_build_calls": 0}

    person_in = _make_person_record(IN_BUNK_PERSON, "Emma", "Johnson")
    person_out = _make_person_record(OUT_OF_BUNK_PERSON, "Liam", "Garcia")
    fake_bunk = MagicMock()
    fake_bunk.name = "Eagle Cabin"

    def _pb_collection(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunks":
            col.get_first_list_item.return_value = fake_bunk
        elif name == "persons":

            def _get_first(filter_str: str, **_kwargs: object) -> MagicMock:
                return person_out if str(OUT_OF_BUNK_PERSON) in filter_str else person_in

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_list.return_value = MagicMock(items=[])
            col.get_first_list_item.return_value = MagicMock()
        return col

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = _pb_collection

    def _build_social_network(*_args: object, **_kwargs: object) -> nx.DiGraph:
        recorded["build_calls"] += 1
        return _build_session_graph()

    mock_builder = MagicMock()
    mock_builder.build_bunk_graph.return_value = _build_bunk_graph()
    mock_builder.build_social_network.side_effect = _build_social_network

    mock_cache = MagicMock()
    # Bunk graph cached so the bunk build path is trivial; session graph NOT
    # cached so the cross-scope on-demand build executes.
    mock_cache.get_bunk_graph.return_value = _build_bunk_graph()
    mock_cache.get_session_graph.return_value = None

    from api.routers.social_graph import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    # Wrap the real asyncio.to_thread so we can detect whether the session-graph
    # build was dispatched through it (the offload contract). We forward to the
    # genuine implementation so the endpoint behaves normally.
    real_to_thread = asyncio.to_thread

    async def _spy_to_thread(func: object, /, *args: object, **kwargs: object) -> object:
        target = getattr(func, "__name__", "") or getattr(getattr(func, "func", None), "__name__", "")
        if target == "build_social_network" or func is mock_builder.build_social_network:
            recorded["offloaded_build_calls"] += 1
        return await real_to_thread(func, *args, **kwargs)  # type: ignore[arg-type]

    # The cross-scope assembly (build + offload) now lives in
    # bunking.graph.bunk_cross_scope; pb/graph_cache are still read at the
    # router level and passed in, so those patches stay router-scoped.
    with (
        patch("api.routers.social_graph.pb", mock_pb),
        patch("api.routers.social_graph.graph_cache", mock_cache),
        patch("bunking.graph.bunk_cross_scope.OptimizedSocialGraphBuilder", return_value=mock_builder),
        patch("bunking.graph.bunk_cross_scope.asyncio.to_thread", _spy_to_thread),
    ):
        client = TestClient(app)
        yield client, recorded


class TestCrossScopeSessionBuildOffloaded:
    def test_cross_scope_cache_miss_build_runs_off_event_loop(
        self, cross_scope_client: tuple[TestClient, dict[str, int]]
    ) -> None:
        client, recorded = cross_scope_client

        response = client.get(
            f"/api/bunks/{BUNK_CM_ID}/social-graph",
            params={"session_cm_id": SESSION_CM_ID, "year": YEAR, "cross_scope": "true"},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        # The on-demand session-graph build must have executed (cache miss path).
        assert recorded["build_calls"] == 1, "Expected build_social_network to be called once on cache miss"

        # And it must have been dispatched through asyncio.to_thread — proving
        # the call was offloaded rather than awaited/run inline on the loop.
        assert recorded["offloaded_build_calls"] == 1, (
            "build_social_network was not dispatched through asyncio.to_thread — the "
            "cross-scope cache-miss build must be wrapped in asyncio.to_thread (Finding 3)"
        )

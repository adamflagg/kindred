"""#1094: sibling edges must be filtered from graph API responses.

TDD tests — written first, verified failing before implementation.

Scope:
- /api/bunks/{id}/social-graph  → no sibling edges in response
- /api/sessions/{id}/social-graph → no sibling edges in response

Graph builders are NOT touched — sibling edges remain in-memory for the
resolution pipeline. These tests only assert on the HTTP response payload.
"""

from __future__ import annotations

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


def _mock_admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _make_person_record(cm_id: int, first_name: str, last_name: str, grade: int = 7) -> MagicMock:
    record = MagicMock()
    record.cm_id = cm_id
    record.first_name = first_name
    record.last_name = last_name
    record.grade = grade
    record.years_at_camp = 2
    return record


def _make_bunk_record(bunk_cm_id: int, name: str = "Eagle Cabin") -> MagicMock:
    record = MagicMock()
    record.cm_id = bunk_cm_id
    record.name = name
    return record


def _build_bunk_graph_with_sibling_and_request(person_ids: list[int]) -> nx.DiGraph:
    """Graph that mirrors what the real builder produces for bunk members who are siblings.

    The real social_graph_builder.py uses a single DiGraph, so when two nodes have
    both a request edge AND a sibling relationship, the builder encodes both on one
    edge via secondary_type.  This fixture uses the same approach:

    - Edge A→B: edge_type='request', secondary_type=None  (pure request)
    - Edge B→A: edge_type='sibling', secondary_type=None  (pure sibling — must be filtered)

    This exercises the single-type sibling-skip branch in the bunk-graph serializer.
    """
    g = nx.DiGraph()
    for pid in person_ids:
        g.add_node(
            pid,
            centrality=0.5,
            clustering=0.3,
            community=0,
            parent_satisfaction_status="satisfied",
            staff_satisfaction_status="no_requests",
            satisfaction_status="satisfied",
            last_year_session=None,
            last_year_bunk=None,
        )

    if len(person_ids) >= 2:
        a, b = person_ids[0], person_ids[1]
        # Forward bunk request edge — must survive the filter
        g.add_edge(
            a,
            b,
            edge_type="request",
            weight=1.0,
            reciprocal=False,
            confidence=0.9,
            priority=1,
            request_type="bunk_with",
            secondary_type=None,
        )
        # Reverse sibling edge — must be stripped at the response boundary.
        # The builder adds sibling edges bidirectionally when no request exists in
        # that direction; here we place it as B→A so it doesn't overwrite A→B.
        g.add_edge(
            b,
            a,
            edge_type="sibling",
            weight=1.5,
            reciprocal=True,
            confidence=None,
            priority=None,
            request_type=None,
            secondary_type=None,
        )

    return g


def _build_bunk_graph_with_secondary_sibling(person_ids: list[int]) -> nx.DiGraph:
    """Graph with an edge whose primary type is 'request' but secondary_type is 'sibling'.

    The bunk-graph code path has a special branch for edges with secondary_type.
    This tests that secondary sibling edges are also stripped.
    """
    g = nx.DiGraph()
    for pid in person_ids:
        g.add_node(
            pid,
            centrality=0.5,
            clustering=0.3,
            community=0,
            parent_satisfaction_status="no_requests",
            staff_satisfaction_status="no_requests",
            satisfaction_status="no_requests",
            last_year_session=None,
            last_year_bunk=None,
        )

    if len(person_ids) >= 2:
        a, b = person_ids[0], person_ids[1]
        # Edge that carries BOTH request and sibling info — tests the secondary_type branch
        g.add_edge(
            a,
            b,
            edge_type="request",
            weight=1.0,
            reciprocal=False,
            confidence=0.8,
            priority=2,
            request_type="bunk_with",
            secondary_type="sibling",  # <- the secondary sibling that must be filtered
        )

    return g


def _build_session_graph_with_sibling(person_ids: list[int]) -> nx.DiGraph:
    """Minimal session-level graph with a sibling edge and a request edge."""
    g = nx.DiGraph()
    for pid in person_ids:
        g.add_node(
            pid,
            centrality=0.5,
            clustering=0.3,
            community=0,
            bunk_cm_id=9001,
            satisfaction_status="satisfied",
            parent_satisfaction_status="satisfied",
            staff_satisfaction_status="no_requests",
            name=f"Person {pid}",
            grade=7,
        )

    if len(person_ids) >= 2:
        a, b = person_ids[0], person_ids[1]
        g.add_edge(
            a,
            b,
            edge_type="request",
            weight=1.0,
            reciprocal=False,
            confidence=0.85,
            priority=1,
            request_type="bunk_with",
            metadata={},
        )
        g.add_edge(
            b,
            a,
            edge_type="sibling",
            weight=1.5,
            reciprocal=True,
            confidence=None,
            priority=None,
            request_type=None,
            metadata={},
        )

    return g


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BUNK_CM_ID = 9001
SESSION_CM_ID = 5001
YEAR = 2026
PERSON_A = 101
PERSON_B = 102


def _make_pb_collection_mock(bunk_record: MagicMock, person_a: MagicMock, person_b: MagicMock):
    """Build a `pb.collection(name)` side_effect that dispatches by collection name."""

    def _pb_collection(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunks":
            col.get_first_list_item.return_value = bunk_record
        elif name == "persons":

            def _get_first(filter_str: str, **_kwargs: object) -> MagicMock:
                return person_a if str(person_a.cm_id) in filter_str else person_b

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_list.return_value = MagicMock(items=[])
            col.get_first_list_item.return_value = MagicMock()
        return col

    return _pb_collection


def _make_bunk_test_client(mock_pb: MagicMock, mock_builder: MagicMock) -> Generator[TestClient]:
    """Build a TestClient with social_graph router and standard bunk-graph mocks patched in."""
    from api.routers.social_graph import router

    mock_cache = MagicMock()
    mock_cache.get_bunk_graph.return_value = None

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.social_graph.pb", mock_pb),
        patch("api.routers.social_graph.graph_cache", mock_cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
    ):
        yield TestClient(app)


@pytest.fixture
def bunk_graph_client_with_siblings() -> Generator[TestClient]:
    """TestClient where the mock bunk graph contains both request and sibling edges."""
    fake_bunk = _make_bunk_record(BUNK_CM_ID)
    person_a = _make_person_record(PERSON_A, "Emma", "Johnson")
    person_b = _make_person_record(PERSON_B, "Liam", "Garcia")

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = _make_pb_collection_mock(fake_bunk, person_a, person_b)

    mock_builder = MagicMock()
    mock_builder.build_bunk_graph.return_value = _build_bunk_graph_with_sibling_and_request([PERSON_A, PERSON_B])

    yield from _make_bunk_test_client(mock_pb, mock_builder)


@pytest.fixture
def bunk_graph_client_with_secondary_sibling() -> Generator[TestClient]:
    """TestClient where the mock bunk graph has an edge with secondary_type='sibling'."""
    fake_bunk = _make_bunk_record(BUNK_CM_ID)
    person_a = _make_person_record(PERSON_A, "Olivia", "Chen")
    person_b = _make_person_record(PERSON_B, "Noah", "Williams")

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = _make_pb_collection_mock(fake_bunk, person_a, person_b)

    mock_builder = MagicMock()
    mock_builder.build_bunk_graph.return_value = _build_bunk_graph_with_secondary_sibling([PERSON_A, PERSON_B])

    yield from _make_bunk_test_client(mock_pb, mock_builder)


@pytest.fixture
def session_graph_client_with_siblings() -> Generator[TestClient]:
    """TestClient where the mock session graph contains a sibling edge."""
    person_a = _make_person_record(PERSON_A, "Samuel", "Johnson")
    person_b = _make_person_record(PERSON_B, "Riley", "Sam")

    def _pb_collection(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_requests":
            result = MagicMock()
            result.total_items = 1
            col.get_list.return_value = result
        elif name == "persons":

            def _get_first(filter_str: str, **_kwargs: object) -> MagicMock:
                return person_a if str(PERSON_A) in filter_str else person_b

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_list.return_value = MagicMock(items=[], total_items=0)
            col.get_first_list_item.return_value = MagicMock()
        return col

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = _pb_collection

    fake_graph = _build_session_graph_with_sibling([PERSON_A, PERSON_B])

    mock_builder = MagicMock()
    mock_builder.build_social_network.return_value = fake_graph

    mock_cache = MagicMock()
    mock_cache.get_session_graph.return_value = None

    from api.routers.social_graph import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.social_graph.pb", mock_pb),
        patch("api.routers.social_graph.graph_cache", mock_cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
    ):
        yield TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBunkGraphSiblingEdgeFilter:
    """#1094: /api/bunks/{id}/social-graph must not emit sibling edges."""

    def test_sibling_edges_absent_from_bunk_graph_response(self, bunk_graph_client_with_siblings: TestClient) -> None:
        """Bunk graph response must contain zero edges with type='sibling'.

        Even when the underlying NetworkX graph carries sibling edges
        (required for name-resolution confidence boost), the serializer
        must strip them before sending to the frontend.
        """
        response = bunk_graph_client_with_siblings.get(
            f"/api/bunks/{BUNK_CM_ID}/social-graph",
            params={"session_cm_id": SESSION_CM_ID, "year": YEAR},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        payload = response.json()
        edges = payload.get("edges", [])

        sibling_edges = [e for e in edges if e.get("type") == "sibling"]
        assert sibling_edges == [], (
            f"Bunk graph response must not include sibling edges, but found {len(sibling_edges)}: {sibling_edges}"
        )

    def test_request_edges_still_present_in_bunk_graph_response(
        self, bunk_graph_client_with_siblings: TestClient
    ) -> None:
        """Non-sibling edges (e.g. request) must still appear in the response."""
        response = bunk_graph_client_with_siblings.get(
            f"/api/bunks/{BUNK_CM_ID}/social-graph",
            params={"session_cm_id": SESSION_CM_ID, "year": YEAR},
        )

        assert response.status_code == 200
        payload = response.json()
        edges = payload.get("edges", [])

        request_edges = [e for e in edges if e.get("type") == "request"]
        assert len(request_edges) >= 1, (
            "At least one request edge must remain in the bunk graph response — only sibling edges should be stripped"
        )

    def test_secondary_sibling_edges_absent_from_bunk_graph_response(
        self, bunk_graph_client_with_secondary_sibling: TestClient
    ) -> None:
        """Edges emitted with secondary_type='sibling' must also be filtered out.

        The bunk-graph serializer has a special branch for edges that carry
        both a primary type and a secondary_type. When secondary_type='sibling',
        that secondary edge must not appear in the response.
        """
        response = bunk_graph_client_with_secondary_sibling.get(
            f"/api/bunks/{BUNK_CM_ID}/social-graph",
            params={"session_cm_id": SESSION_CM_ID, "year": YEAR},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        payload = response.json()
        edges = payload.get("edges", [])

        sibling_edges = [e for e in edges if e.get("type") == "sibling"]
        assert sibling_edges == [], (
            f"Secondary sibling edges must also be stripped from bunk graph response, "
            f"but found {len(sibling_edges)}: {sibling_edges}"
        )

        # The primary request edge should still be present
        request_edges = [e for e in edges if e.get("type") == "request"]
        assert len(request_edges) >= 1, (
            "Primary request edge must survive even when secondary_type='sibling' is dropped"
        )


class TestSessionSocialGraphSiblingEdgeFilter:
    """#1094: /api/sessions/{id}/social-graph must not emit sibling edges."""

    def test_sibling_edges_absent_from_session_graph_response(
        self, session_graph_client_with_siblings: TestClient
    ) -> None:
        """Session social graph response must contain zero edges with type='sibling'.

        The session graph builder adds sibling edges to the in-memory graph for
        name-resolution use. The serializer must strip them before the HTTP response.
        """
        response = session_graph_client_with_siblings.get(
            f"/api/sessions/{SESSION_CM_ID}/social-graph",
            params={"year": YEAR, "include_metrics": "false"},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        payload = response.json()
        edges = payload.get("edges", [])

        sibling_edges = [e for e in edges if e.get("type") == "sibling"]
        assert sibling_edges == [], (
            f"Session social-graph response must not include sibling edges, "
            f"but found {len(sibling_edges)}: {sibling_edges}"
        )

    def test_request_edges_still_present_in_session_graph_response(
        self, session_graph_client_with_siblings: TestClient
    ) -> None:
        """Non-sibling edges must survive the filter in the session graph."""
        response = session_graph_client_with_siblings.get(
            f"/api/sessions/{SESSION_CM_ID}/social-graph",
            params={"year": YEAR, "include_metrics": "false"},
        )

        assert response.status_code == 200
        payload = response.json()
        edges = payload.get("edges", [])

        request_edges = [e for e in edges if e.get("type") == "request"]
        assert len(request_edges) >= 1, (
            "At least one request edge must remain in the session graph response — "
            "only sibling edges should be stripped"
        )

"""Cross-scope ghost nodes on the per-bunk graph must carry their bunk name.

When ?cross_scope=true the bunk social-graph endpoint returns "ghost" nodes for
campers connected from outside the current bunk. The UI shows each ghost's
current bunk assignment next to their name, so the response node must include a
human-readable `bunk_name` resolved from the camper's `bunk_cm_id` (#1636).
"""

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
CURRENT_BUNK_NAME = "Eagle Cabin"
OTHER_BUNK_NAME = "Hawk Cabin"


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


def _make_bunk_record(cm_id: int, name: str) -> MagicMock:
    record = MagicMock()
    record.cm_id = cm_id
    record.name = name
    return record


def _build_bunk_graph() -> nx.DiGraph:
    """Minimal in-bunk graph: one node, no edges."""
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
    """Session graph with a cross-scope edge from the in-bunk camper to an
    out-of-bunk camper (in OTHER_BUNK_CM_ID) so a ghost node is produced."""
    g = nx.DiGraph()
    g.add_node(
        IN_BUNK_PERSON, bunk_cm_id=BUNK_CM_ID, grade=7, name="Emma Johnson", centrality=0.5, clustering=0.0, community=0
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


@pytest.fixture
def bunk_name_client() -> Generator[TestClient]:
    person_in = _make_person_record(IN_BUNK_PERSON, "Emma", "Johnson")
    person_out = _make_person_record(OUT_OF_BUNK_PERSON, "Liam", "Garcia")
    current_bunk = _make_bunk_record(BUNK_CM_ID, CURRENT_BUNK_NAME)
    other_bunk = _make_bunk_record(OTHER_BUNK_CM_ID, OTHER_BUNK_NAME)

    def _pb_collection(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunks":
            col.get_first_list_item.return_value = current_bunk
            col.get_full_list.return_value = [current_bunk, other_bunk]
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

    mock_builder = MagicMock()
    mock_builder.build_bunk_graph.return_value = _build_bunk_graph()
    mock_builder.build_social_network.return_value = _build_session_graph()

    mock_cache = MagicMock()
    mock_cache.get_bunk_graph.return_value = _build_bunk_graph()
    # Session graph cached, so the cross-scope path runs without an on-demand build.
    mock_cache.get_session_graph.return_value = _build_session_graph()

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


class TestCrossScopeGhostBunkName:
    def test_ghost_node_includes_its_current_bunk_name(self, bunk_name_client: TestClient) -> None:
        response = bunk_name_client.get(
            f"/api/bunks/{BUNK_CM_ID}/social-graph",
            params={"session_cm_id": SESSION_CM_ID, "year": YEAR, "cross_scope": "true"},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        ghosts = response.json()["cross_scope_nodes"]
        assert len(ghosts) == 1, f"expected exactly one ghost node, got {ghosts}"
        ghost = ghosts[0]
        assert ghost["id"] == OUT_OF_BUNK_PERSON
        assert ghost["bunk_name"] == OTHER_BUNK_NAME, (
            f"ghost node must carry its current bunk name for the UI; got {ghost.get('bunk_name')!r}"
        )

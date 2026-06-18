"""#1063 Layer 1: bunk-graph endpoint serializer forwards satisfaction fields.

Task 10 of parent-paramount Stage 3a.

The bunk-graph router must include parent_satisfaction_status,
staff_satisfaction_status, and satisfaction_status on every node in the
BunkGraphResponse — data populated by Task 9 (build_bunk_graph now calls
_calculate_node_metrics).
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


def _mock_admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _make_person_record(
    cm_id: int,
    first_name: str,
    last_name: str,
    grade: int = 7,
    years_at_camp: int = 3,
) -> MagicMock:
    record = MagicMock()
    record.cm_id = cm_id
    record.first_name = first_name
    record.last_name = last_name
    record.grade = grade
    record.years_at_camp = years_at_camp
    return record


def _make_bunk_record(bunk_cm_id: int, name: str = "Cabin 1") -> MagicMock:
    record = MagicMock()
    record.cm_id = bunk_cm_id
    record.name = name
    return record


def _build_bunk_graph_with_satisfaction(person_ids: list[int]) -> nx.DiGraph:
    """Build a minimal NetworkX DiGraph whose nodes carry satisfaction attrs,
    as Task 9 ensures build_bunk_graph produces."""
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
    # Add a request edge between the two so the graph is non-trivial
    if len(person_ids) >= 2:
        g.add_edge(
            person_ids[0],
            person_ids[1],
            edge_type="request",
            weight=1.0,
            reciprocal=False,
            confidence=None,
            priority=None,
            request_type="bunk_with",
            secondary_type=None,
        )
    return g


@pytest.fixture
def bunk_graph_client() -> Generator[TestClient]:
    """Return a TestClient for the social_graph router with all heavy deps mocked."""
    bunk_cm_id = 9001
    session_cm_id = 5001
    year = 2025
    person_a_id = 101
    person_b_id = 102

    fake_bunk = _make_bunk_record(bunk_cm_id, "Eagle Cabin")
    person_a = _make_person_record(person_a_id, "Emma", "Johnson")
    person_b = _make_person_record(person_b_id, "Liam", "Garcia")

    def _pb_collection(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunks":
            col.get_first_list_item.return_value = fake_bunk
        elif name == "persons":

            def _get_first(filter_str: str, **_kwargs: object) -> MagicMock:
                if str(person_a_id) in filter_str:
                    return person_a
                return person_b

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_list.return_value = MagicMock(items=[])
            col.get_first_list_item.return_value = MagicMock()
        return col

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = _pb_collection

    fake_graph = _build_bunk_graph_with_satisfaction([person_a_id, person_b_id])

    mock_builder = MagicMock()
    mock_builder.build_bunk_graph.return_value = fake_graph

    mock_cache = MagicMock()
    mock_cache.get_bunk_graph.return_value = None  # force rebuild path

    # Import after path setup
    from api.routers.social_graph import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.social_graph.pb", mock_pb),
        patch("api.routers.social_graph.graph_cache", mock_cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder),
    ):
        client = TestClient(app)
        # Store fixture data for the test to use in the URL
        client._bunk_cm_id = bunk_cm_id
        client._session_cm_id = session_cm_id
        client._year = year
        yield client


class TestBunkGraphSatisfactionFields:
    """#1063 Layer 1: bunk-graph endpoint must forward satisfaction fields."""

    def test_bunk_graph_endpoint_includes_satisfaction_fields(self, bunk_graph_client: TestClient) -> None:
        """Each node in BunkGraphResponse must carry all three satisfaction fields."""
        client = bunk_graph_client
        bunk_cm_id = client._bunk_cm_id
        session_cm_id = client._session_cm_id
        year = client._year

        response = client.get(
            f"/api/bunks/{bunk_cm_id}/social-graph",
            params={"session_cm_id": session_cm_id, "year": year},
        )

        assert response.status_code == 200, f"Unexpected status: {response.status_code}\n{response.text}"

        payload = response.json()
        nodes = payload.get("nodes", [])
        assert len(nodes) >= 1, "Expected at least one node in bunk graph response"

        for node in nodes:
            assert "parent_satisfaction_status" in node, (
                f"Node {node.get('id')} missing 'parent_satisfaction_status' — "
                "bunk-graph serializer must forward this field (#1063 Layer 1)"
            )
            assert "staff_satisfaction_status" in node, (
                f"Node {node.get('id')} missing 'staff_satisfaction_status' — "
                "bunk-graph serializer must forward this field (#1063 Layer 1)"
            )
            assert "satisfaction_status" in node, (
                f"Node {node.get('id')} missing 'satisfaction_status' — "
                "bunk-graph serializer must forward this field (#1063 Layer 1)"
            )

    def test_bunk_graph_satisfaction_field_values_match_graph_attrs(self, bunk_graph_client: TestClient) -> None:
        """Satisfaction field values must match what the graph builder set on nodes."""
        client = bunk_graph_client
        bunk_cm_id = client._bunk_cm_id
        session_cm_id = client._session_cm_id
        year = client._year

        response = client.get(
            f"/api/bunks/{bunk_cm_id}/social-graph",
            params={"session_cm_id": session_cm_id, "year": year},
        )

        assert response.status_code == 200
        nodes = response.json()["nodes"]

        for node in nodes:
            # _build_bunk_graph_with_satisfaction sets these specific values
            assert node["parent_satisfaction_status"] == "satisfied", (
                f"Node {node['id']}: expected parent_satisfaction_status='satisfied', "
                f"got {node['parent_satisfaction_status']!r}"
            )
            assert node["staff_satisfaction_status"] == "no_requests", (
                f"Node {node['id']}: expected staff_satisfaction_status='no_requests', "
                f"got {node['staff_satisfaction_status']!r}"
            )
            assert node["satisfaction_status"] == "satisfied", (
                f"Node {node['id']}: expected satisfaction_status='satisfied', got {node['satisfaction_status']!r}"
            )

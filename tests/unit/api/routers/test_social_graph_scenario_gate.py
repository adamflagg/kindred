"""A scenario_id reads bunk_assignments_draft, whose PocketBase list rule needs
bunking.manage. FastAPI reads PocketBase as the service account, so the router
must enforce that permission itself whenever a scenario_id is supplied. The
production graph (no scenario_id) stays open to any signed-in user.
"""

from typing import Any
from unittest.mock import MagicMock, patch

import networkx as nx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission

SESSION_URL = "/api/sessions/1001/social-graph"
BUNK_URL = "/api/bunks/9001/social-graph"


def _user(*, admin: bool = False, permissions: set[str] | None = None) -> AuthUser:
    user = AuthUser(
        username="TestUser",
        email="test@example.com",
        display_name="Test User",
        groups=["admin"] if admin else [],
        is_admin=admin,
    )
    user.permissions = permissions or set()
    return user


def _built(builder: MagicMock) -> list[Any]:
    """Builder calls made; the graph is empty, so the response body past the gate is not under test."""
    calls: list[Any] = builder.build_social_network.call_args_list + builder.build_bunk_graph.call_args_list
    return calls


def _get(url: str, user: AuthUser, **params: str | int) -> tuple[Any, MagicMock]:
    from api.routers.social_graph import router

    builder = MagicMock()
    builder.build_social_network.return_value = nx.DiGraph()
    builder.build_bunk_graph.return_value = nx.DiGraph()
    cache = MagicMock()
    cache.get_session_graph.return_value = None
    cache.get_bunk_graph.return_value = None

    pb = MagicMock()
    pb.collection.return_value.get_list.return_value.total_items = 1

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user

    with (
        patch("api.routers.social_graph.pb", pb),
        patch("api.routers.social_graph.graph_cache", cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=builder),
    ):
        resp = TestClient(app, raise_server_exceptions=False).get(
            url, params={"year": 2025, "session_cm_id": 1001, **params}
        )
    return resp, builder


@pytest.mark.parametrize("url", [SESSION_URL, BUNK_URL])
class TestScenarioGraphRequiresBunkingManage:
    def test_signed_in_user_without_permission_is_refused(self, url: str) -> None:
        resp, builder = _get(url, _user(permissions={Permission.METRICS_FINANCIAL}), scenario_id="scn1")
        assert resp.status_code == 403
        assert Permission.BUNKING_MANAGE in resp.json()["detail"]
        builder.build_social_network.assert_not_called()
        builder.build_bunk_graph.assert_not_called()

    def test_bunking_manager_gets_the_scenario_graph(self, url: str) -> None:
        resp, builder = _get(url, _user(permissions={Permission.BUNKING_MANAGE}), scenario_id="scn1")
        assert resp.status_code != 403
        calls = _built(builder)
        assert calls
        assert calls[0].kwargs["scenario_id"] == "scn1"

    def test_admin_gets_the_scenario_graph(self, url: str) -> None:
        resp, builder = _get(url, _user(admin=True), scenario_id="scn1")
        assert resp.status_code != 403
        assert _built(builder)

    def test_production_graph_stays_open_to_any_signed_in_user(self, url: str) -> None:
        resp, builder = _get(url, _user(permissions={Permission.METRICS_FINANCIAL}))
        assert resp.status_code != 403
        calls = _built(builder)
        assert calls
        assert calls[0].kwargs["scenario_id"] is None

"""#978 — update_camper_position must pass scenario_id to cache methods.

After PR #977 re-keyed GraphCacheManager by (session_cm_id, year, scenario_id),
update_camper_position continued to call get_session_graph / cache_session_graph
without scenario_id, causing re-cache writes to land in the production cache slot
while reads look in the scenario-specific slot — wasted work at best, stale data
at worst.

These tests assert that:
  1. scenario_id from the query param is forwarded to get_session_graph.
  2. scenario_id is forwarded to cache_session_graph on a cache miss.
  3. When scenario_id is omitted the calls use None (production slot).
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_admin_user() -> AuthUser:
    user = AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )
    user.permissions = set(ALL_PERMISSIONS)
    return user


def _make_position_client(
    scenario_id: str | None,
    cache_hit: bool = False,
) -> tuple[MagicMock, MagicMock]:
    """Run a position PATCH request through a test app.

    Returns:
        (mock_cache, mock_builder_instance) — both exposed so tests can assert on
        cache methods *and* on build_social_network call arguments.
    """
    from fastapi import FastAPI

    from api.routers.social_graph import router

    # Build a graph stub that update_node_position returns
    update_stub = {
        "updated_node": {"id": "1001", "bunk_cm_id": 9001},
        "affected_edges": [],
    }

    mock_graph = MagicMock()

    mock_cache = MagicMock()
    if cache_hit:
        mock_cache.get_session_graph.return_value = mock_graph
    else:
        mock_cache.get_session_graph.return_value = None

    mock_builder_instance = MagicMock()
    mock_builder_instance.build_social_network.return_value = mock_graph
    mock_builder_instance.update_node_position.return_value = update_stub

    mock_pb = MagicMock()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _mock_admin_user

    with (
        patch("api.routers.social_graph.pb", mock_pb),
        patch("api.routers.social_graph.graph_cache", mock_cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=mock_builder_instance),
    ):
        req_params: dict[str, str | int] = {"year": 2025}
        if scenario_id is not None:
            req_params["scenario_id"] = scenario_id

        client = TestClient(app)
        resp = client.patch(
            "/api/sessions/1001/campers/2001/position",
            json={"new_bunk_cm_id": 9001},
            params=req_params,
        )
        assert resp.status_code == 200, f"Unexpected status: {resp.status_code} — {resp.text}"

        return mock_cache, mock_builder_instance


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestUpdateCamperPositionPassesScenarioIdToCache:
    """scenario_id must flow through to get_session_graph and cache_session_graph."""

    def test_get_session_graph_called_with_scenario_id_on_miss(self) -> None:
        """On a cache miss the get_session_graph call must include the scenario_id."""
        mock_cache, _ = _make_position_client(scenario_id="scenario-abc123", cache_hit=False)
        mock_cache.get_session_graph.assert_called_once()
        # Extract positional call
        call_args = mock_cache.get_session_graph.call_args
        assert call_args == call(1001, 2025, scenario_id="scenario-abc123"), (
            f"Expected get_session_graph(1001, 2025, scenario_id='scenario-abc123') but got {call_args}"
        )

    def test_cache_session_graph_called_with_scenario_id_on_miss(self) -> None:
        """After a rebuild, cache_session_graph must store under the scenario-keyed slot."""
        mock_cache, _ = _make_position_client(scenario_id="scenario-abc123", cache_hit=False)
        cache_call = mock_cache.cache_session_graph.call_args
        assert cache_call is not None, "cache_session_graph was never called on a cache miss"
        # Signature: cache_session_graph(session_cm_id, year, graph, scenario_id=...)
        assert cache_call.kwargs.get("scenario_id") == "scenario-abc123" or (
            len(cache_call.args) >= 4 and cache_call.args[3] == "scenario-abc123"
        ), f"scenario_id not forwarded to cache_session_graph: {cache_call}"

    def test_build_social_network_called_with_scenario_id_on_miss(self) -> None:
        """On a cache miss build_social_network must receive scenario_id as a keyword arg.

        Without this the graph is built from production bunk_assignments even when a
        scenario is active, then stored under the scenario-scoped cache key — poisoning
        that slot with stale production data (finding #1 from PR #1131 scan-it review).
        """
        _, mock_builder = _make_position_client(scenario_id="scenario-abc123", cache_hit=False)
        mock_builder.build_social_network.assert_called_once_with(2025, 1001, scenario_id="scenario-abc123")

    def test_get_session_graph_uses_none_when_no_scenario(self) -> None:
        """Without scenario_id the call must use None (production cache slot)."""
        mock_cache, _ = _make_position_client(scenario_id=None, cache_hit=False)
        call_args = mock_cache.get_session_graph.call_args
        # None scenario_id → production slot
        assert call_args == call(1001, 2025, scenario_id=None), (
            f"Expected get_session_graph(1001, 2025, scenario_id=None) but got {call_args}"
        )

    def test_get_session_graph_called_with_scenario_id_on_hit(self) -> None:
        """On a cache hit the get_session_graph lookup must still use scenario_id."""
        mock_cache, _ = _make_position_client(scenario_id="scenario-xyz789", cache_hit=True)
        call_args = mock_cache.get_session_graph.call_args
        assert call_args == call(1001, 2025, scenario_id="scenario-xyz789"), (
            f"Expected get_session_graph(1001, 2025, scenario_id='scenario-xyz789') but got {call_args}"
        )

    def test_cache_session_graph_not_called_on_hit(self) -> None:
        """When the graph is already cached, cache_session_graph must NOT be called again."""
        mock_cache, _ = _make_position_client(scenario_id="scenario-xyz789", cache_hit=True)
        mock_cache.cache_session_graph.assert_not_called()

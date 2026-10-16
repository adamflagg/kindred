"""Screens that guessed the season from the calendar must follow the season rule.

Prod flipped to 2027 on 2026-10-15 (the Oct 15 Pacific rollover). From then until
31 Dec the wall-clock year is still 2026, so any site that asks the calendar for
"the current year" picks last season. Every test here freezes the clock at
2026-11-01, where the calendar says 2026 and the season rule says 2027.
"""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import networkx as nx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

FROZEN = datetime(2026, 11, 1, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    monkeypatch.setattr("api.services.camp_calendar._utcnow", lambda: FROZEN)


class TestDefaultSeasonYear:
    def test_follows_the_rule_after_the_rollover(self) -> None:
        from api.services.camp_calendar import default_season_year

        assert default_season_year() == 2027

    def test_season_env_var_beats_the_rule(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from api.services.camp_calendar import default_season_year

        monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
        assert default_season_year() == 2031

    @pytest.mark.parametrize("raw", ["", "abc"])
    def test_blank_or_non_numeric_env_falls_back_to_the_rule(self, monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
        from api.services.camp_calendar import default_season_year

        monkeypatch.setenv("CAMPMINDER_SEASON_ID", raw)
        assert default_season_year() == 2027


def _admin() -> AuthUser:
    user = AuthUser(username="A", email="a@example.com", display_name="A", groups=["admin"], is_admin=True)
    user.permissions = set(ALL_PERMISSIONS)
    return user


def _call_router(method: str, url: str) -> MagicMock:
    """Hit a social-graph route with no `year` and return the cache mock to inspect."""
    from api.routers.social_graph import router

    builder = MagicMock()
    builder.build_social_network.return_value = nx.DiGraph()
    builder.build_bunk_graph.return_value = nx.DiGraph()
    builder.update_node_position.return_value = {"updated_node": {"id": "1", "bunk_cm_id": 1}, "affected_edges": []}
    cache = MagicMock()
    cache.get_session_graph.return_value = None
    cache.get_bunk_graph.return_value = None
    pb = MagicMock()
    pb.collection.return_value.get_list.return_value.total_items = 1

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin
    with (
        patch("api.routers.social_graph.pb", pb),
        patch("api.routers.social_graph.graph_cache", cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=builder),
    ):
        client = TestClient(app, raise_server_exceptions=False)
        if method == "GET":
            client.get(url, params={"session_cm_id": 1001})
        else:
            client.patch(url, json={"new_bunk_cm_id": 9001})
    return cache


class TestSocialGraphRoutes:
    def test_session_graph_defaults_to_the_season(self) -> None:
        cache = _call_router("GET", "/api/sessions/1001/social-graph")
        assert cache.get_session_graph.call_args.args[1] == 2027

    def test_bunk_graph_defaults_to_the_season(self) -> None:
        cache = _call_router("GET", "/api/bunks/9001/social-graph")
        assert cache.get_bunk_graph.call_args.args[2] == 2027

    def test_camper_position_defaults_to_the_season(self) -> None:
        cache = _call_router("PATCH", "/api/sessions/1001/campers/2001/position")
        assert cache.get_session_graph.call_args.args[1] == 2027


def test_social_graph_builder_current_year_is_the_season() -> None:
    from bunking.graph.social_graph_builder import SocialGraphBuilder

    assert SocialGraphBuilder(MagicMock()).current_year == 2027


@pytest.mark.asyncio
async def test_historical_trends_default_window_ends_on_the_season() -> None:
    from api.services.historical_service import HistoricalService

    repo: Any = MagicMock()
    asked: list[int] = []

    async def fetch_sessions(year: int) -> list[Any]:
        asked.append(year)
        raise RuntimeError("stop after the window is chosen")

    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    with pytest.raises(RuntimeError):
        await HistoricalService(repo).calculate_historical_trends()
    assert sorted(set(asked)) == [2023, 2024, 2025, 2026, 2027]

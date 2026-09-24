"""The social-graph endpoints' PocketBase reads and event-loop use.

* Node names and grades: the session and bunk endpoints looked each node up
  with its own sequential `get_first_list_item`, on every request, including a
  graph-cache hit. A 356-camper session paid 356 round trips just to label a
  cached graph. They now read the nodes' `persons` rows in one year-scoped read.
* Graph builds: `build_social_network` / `build_bunk_graph` are synchronous
  PocketBase + NetworkX work. With one uvicorn worker, a build run directly in
  the handler blocks every other request until it finishes. The builds now run
  in a worker thread (`asyncio.to_thread`), the pattern the rest of this router
  and `bunk_cross_scope` already use. The check is behavioural: a build that
  runs on the event-loop thread can see a running loop, and one in a worker
  thread cannot.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import networkx as nx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pocketbase.models.record import Record

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

YEAR = 2026
SESSION = 5001
BUNK = 9001

PERSONS = {
    101: {"cm_id": 101, "first_name": "Emma", "last_name": "Johnson", "grade": 5, "years_at_camp": 1, "year": YEAR},
    102: {"cm_id": 102, "first_name": "Liam", "last_name": "Garcia", "grade": 6, "years_at_camp": 3, "year": YEAR},
    # 103 has no persons row this year -> labelled "Person 103", grade None.
}


def _admin() -> AuthUser:
    user = AuthUser(
        username="TestAdmin", email="test@example.com", display_name="Test Admin", groups=["admin"], is_admin=True
    )
    user.permissions = set(ALL_PERMISSIONS)
    return user


def _graph() -> nx.DiGraph:
    g = nx.DiGraph()
    for pid in (101, 102, 103):
        g.add_node(pid, bunk_cm_id=BUNK, centrality=0.5, clustering=0.0, community=0)
    g.add_edge(101, 102, edge_type="request", weight=1.0, request_type="bunk_with")
    return g


class _PersonsPB:
    """`persons` answers `get_full_list` by the cm_ids named in the filter, and
    counts every call. `get_first_list_item` answers too, so the old per-node
    path still works here; the tests assert it is not used."""

    def __init__(self) -> None:
        self.full_list_calls: list[dict[str, Any]] = []
        self.first_item_calls = 0

    def collection(self, name: str) -> MagicMock:
        coll = MagicMock()
        if name == "persons":

            def get_full_list(batch: int = 100, query_params: dict[str, Any] | None = None) -> list[Record]:
                params = dict(query_params or {})
                self.full_list_calls.append({"batch": batch, **params})
                assert f"year = {YEAR}" in params["filter"]
                ids = {int(m) for m in re.findall(r"cm_id = (\d+)", params["filter"])}
                return [Record(dict(row)) for pid, row in PERSONS.items() if pid in ids]

            def get_first_list_item(filter_str: str, *_a: Any, **_kw: Any) -> Record:
                self.first_item_calls += 1
                pid = int(re.findall(r"cm_id = (\d+)", filter_str)[0])
                if pid not in PERSONS:
                    raise RuntimeError("not found")
                return Record(dict(PERSONS[pid]))

            coll.get_full_list.side_effect = get_full_list
            coll.get_first_list_item.side_effect = get_first_list_item
        elif name == "bunks":
            bunk = MagicMock()
            bunk.name = "B-1"
            coll.get_first_list_item.return_value = bunk
        else:
            coll.get_list.return_value = MagicMock(total_items=1, items=[])
        return coll


@pytest.fixture
def pb() -> _PersonsPB:
    return _PersonsPB()


@contextmanager
def _client(pb: _PersonsPB, cache: MagicMock, builder: MagicMock) -> Iterator[TestClient]:
    from api.routers.social_graph import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin
    with (
        patch("api.routers.social_graph.pb", pb),
        patch("api.routers.social_graph.graph_cache", cache),
        patch("api.routers.social_graph.OptimizedSocialGraphBuilder", return_value=builder),
    ):
        yield TestClient(app)


def _cache(hit: bool) -> MagicMock:
    cache = MagicMock()
    cache.get_session_graph.return_value = _graph() if hit else None
    cache.get_bunk_graph.return_value = _graph() if hit else None
    return cache


def _record_loop(seen: dict[str, bool], key: str) -> None:
    try:
        asyncio.get_running_loop()
        seen[key] = True
    except RuntimeError:
        seen[key] = False


# ------------------------------------------------------------ node labels


def test_session_graph_labels_nodes_from_one_persons_read_on_a_cache_hit(pb: _PersonsPB) -> None:
    with _client(pb, _cache(hit=True), MagicMock()) as client:
        resp = client.get(f"/api/sessions/{SESSION}/social-graph", params={"year": YEAR, "layout": "none"})
    assert resp.status_code == 200, resp.text

    assert pb.first_item_calls == 0, f"{pb.first_item_calls} per-node persons lookups"
    assert len(pb.full_list_calls) == 1, pb.full_list_calls
    nodes = {n["id"]: (n["name"], n["grade"]) for n in resp.json()["nodes"]}
    assert nodes == {101: ("Emma Johnson", 5), 102: ("Liam Garcia", 6), 103: ("Person 103", None)}


def test_bunk_graph_labels_nodes_from_one_persons_read_on_a_cache_hit(pb: _PersonsPB) -> None:
    with _client(pb, _cache(hit=True), MagicMock()) as client:
        resp = client.get(f"/api/bunks/{BUNK}/social-graph", params={"session_cm_id": SESSION, "year": YEAR})
    assert resp.status_code == 200, resp.text

    assert pb.first_item_calls == 0, f"{pb.first_item_calls} per-node persons lookups"
    assert len(pb.full_list_calls) == 1, pb.full_list_calls
    nodes = {n["id"]: (n["name"], n["grade"], n["first_year"]) for n in resp.json()["nodes"]}
    assert nodes == {
        101: ("Emma Johnson", 5, True),
        102: ("Liam Garcia", 6, False),
        103: ("Person 103", None, False),
    }


def test_persons_read_pages_at_the_ceiling_with_a_projection_and_no_skip_total(pb: _PersonsPB) -> None:
    with _client(pb, _cache(hit=True), MagicMock()) as client:
        client.get(f"/api/sessions/{SESSION}/social-graph", params={"year": YEAR, "layout": "none"})
    (call,) = pb.full_list_calls
    assert call["batch"] == 1000
    assert "skipTotal" not in call
    assert set(call["fields"].split(",")) == {"cm_id", "first_name", "last_name", "grade", "years_at_camp"}


# ------------------------------------------------------------ builds off the loop


def test_session_graph_build_runs_off_the_event_loop(pb: _PersonsPB) -> None:
    seen: dict[str, bool] = {}
    builder = MagicMock()

    def build(*_a: Any, **_kw: Any) -> nx.DiGraph:
        _record_loop(seen, "build")
        return _graph()

    builder.build_social_network.side_effect = build
    with _client(pb, _cache(hit=False), builder) as client:
        resp = client.get(f"/api/sessions/{SESSION}/social-graph", params={"year": YEAR, "layout": "none"})
    assert resp.status_code == 200, resp.text
    assert seen == {"build": False}, "build_social_network ran on the event-loop thread"


def test_bunk_graph_build_runs_off_the_event_loop(pb: _PersonsPB) -> None:
    seen: dict[str, bool] = {}
    builder = MagicMock()

    def build(*_a: Any, **_kw: Any) -> nx.DiGraph:
        _record_loop(seen, "build")
        return _graph()

    builder.build_bunk_graph.side_effect = build
    with _client(pb, _cache(hit=False), builder) as client:
        resp = client.get(f"/api/bunks/{BUNK}/social-graph", params={"session_cm_id": SESSION, "year": YEAR})
    assert resp.status_code == 200, resp.text
    assert seen == {"build": False}, "build_bunk_graph ran on the event-loop thread"


def test_position_update_cache_miss_build_runs_off_the_event_loop(pb: _PersonsPB) -> None:
    seen: dict[str, bool] = {}
    builder = MagicMock()

    def build(*_a: Any, **_kw: Any) -> nx.DiGraph:
        _record_loop(seen, "build")
        return _graph()

    builder.build_social_network.side_effect = build
    builder.update_node_position.return_value = {"updated_node": {"id": 101}, "affected_edges": []}
    with _client(pb, _cache(hit=False), builder) as client:
        resp = client.patch(
            f"/api/sessions/{SESSION}/campers/101/position", json={"new_bunk_cm_id": BUNK}, params={"year": YEAR}
        )
    assert resp.status_code == 200, resp.text
    assert seen == {"build": False}, "build_social_network ran on the event-loop thread"

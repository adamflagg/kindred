"""`build_social_network` reads the session's bunk assignments once.

It used to issue one `get_first_list_item` per attendee (356 sequential round
trips for the largest session) to find each camper's bunk. One read of the
session's assignments gives the same map. `get_first_list_item` returned the
FIRST matching row, so where a person has more than one row, the first one in
read order still wins.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pocketbase.models.record import Record

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from tests.fixtures.pb_projection import project

YEAR = 2026
SESSION = 1000001

ASSIGNMENT_FIELDS = {"expand.person.cm_id", "expand.bunk.cm_id"}


def _person(cm_id: int) -> SimpleNamespace:
    return SimpleNamespace(
        cm_id=cm_id, first_name="Emma", last_name="Johnson", grade=5, gender="F", age=10, years_at_camp=1
    )


def _assignment(person_cm_id: int, bunk_cm_id: int | None) -> dict[str, Any]:
    """A WIDE assignment row. `bunk_cm_id=None` is a row whose bunk relation is
    empty (a camper parked in Unassigned), which expands to nothing."""
    expand: dict[str, Any] = {"person": {"id": f"p{person_cm_id}", "cm_id": person_cm_id, "grade": 5, "year": YEAR}}
    if bunk_cm_id is not None:
        expand["bunk"] = {"id": f"b{bunk_cm_id}", "cm_id": bunk_cm_id, "name": f"B-{bunk_cm_id}"}
    return {
        "id": f"a{person_cm_id}-{bunk_cm_id}",
        "person": f"p{person_cm_id}",
        "bunk": f"b{bunk_cm_id}" if bunk_cm_id is not None else "",
        "session": "s1",
        "year": YEAR,
        "expand": expand,
    }


class _PB:
    def __init__(self, assignments: list[dict[str, Any]], *, project_rows: bool = True) -> None:
        self.assignments = assignments
        self.project_rows = project_rows
        self.calls: dict[str, list[dict[str, Any]]] = {}
        self.first_item_calls: list[str] = []

    def collection(self, name: str) -> MagicMock:
        coll = MagicMock()

        def get_full_list(batch: int = 100, query_params: dict[str, Any] | None = None) -> list[Any]:
            params = dict(query_params or {})
            self.calls.setdefault(name, []).append({"batch": batch, **params})
            if name == "attendees":
                return [SimpleNamespace(person_id=pid, division="A") for pid in (1, 2, 3, 4)]
            if name == "persons":
                return [_person(pid) for pid in (1, 2, 3, 4)]
            if name in ("bunk_assignments", "bunk_assignments_draft"):
                fields = params.get("fields") if self.project_rows else None
                return [Record(project(row, fields)) for row in self.assignments]
            return []

        def get_first_list_item(filter_str: str, *_a: Any, **_kw: Any) -> Any:
            self.first_item_calls.append(f"{name}: {filter_str}")
            raise RuntimeError("no record")

        coll.get_full_list.side_effect = get_full_list
        coll.get_first_list_item.side_effect = get_first_list_item
        return coll


def _builder(pb: _PB) -> OptimizedSocialGraphBuilder:
    return OptimizedSocialGraphBuilder(cast(Any, pb), random_seed=42)


# Person 1 in bunk 10; person 2 has two rows (first wins); person 3 is parked
# with an empty bunk relation; person 4 has no row at all.
ASSIGNMENTS = [_assignment(1, 10), _assignment(2, 11), _assignment(2, 12), _assignment(3, None)]
EXPECTED_BUNKS = {1: 10, 2: 11, 3: None, 4: None}


@pytest.mark.parametrize(
    ("scenario", "collection", "clause"),
    [(None, "bunk_assignments", ""), ("scn123456789abc", "bunk_assignments_draft", ' && scenario = "scn123456789abc"')],
)
def test_assignments_are_read_once_for_the_whole_session(scenario: str | None, collection: str, clause: str) -> None:
    pb = _PB(ASSIGNMENTS)

    graph = _builder(pb).build_social_network(YEAR, SESSION, scenario_id=scenario)

    assert pb.first_item_calls == [], pb.first_item_calls
    (call,) = pb.calls[collection]
    assert call["filter"] == f"session.cm_id = {SESSION} && year = {YEAR}{clause}"
    assert {n: graph.nodes[n]["bunk_cm_id"] for n in graph.nodes} == EXPECTED_BUNKS


def test_assignment_read_pages_at_the_ceiling_with_a_projection_and_no_skip_total() -> None:
    pb = _PB(ASSIGNMENTS)
    _builder(pb).build_social_network(YEAR, SESSION)

    (call,) = pb.calls["bunk_assignments"]
    assert call["batch"] == 1000
    assert "skipTotal" not in call
    assert set(call["fields"].split(",")) == ASSIGNMENT_FIELDS


def test_projected_assignment_read_builds_the_same_graph_as_full_rows() -> None:
    full = _builder(_PB(ASSIGNMENTS, project_rows=False)).build_social_network(YEAR, SESSION)
    projected = _builder(_PB(ASSIGNMENTS)).build_social_network(YEAR, SESSION)

    assert dict(projected.nodes(data=True)) == dict(full.nodes(data=True))

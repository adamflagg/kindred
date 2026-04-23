"""Tests for OptimizedSocialGraphBuilder scenario-aware data sourcing.

Verifies that when scenario_id is provided, bunk assignments are sourced
from bunk_assignments_draft (scenario data) instead of bunk_assignments
(CampMinder production data).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder


class _CollectionCapture:
    """Simple capture of .collection(name) -> mock chain.

    Tracks which collection was accessed and what filter string was passed to
    get_first_list_item so tests can assert on data source and scenario filter.
    """

    def __init__(self) -> None:
        self.accessed: list[str] = []
        self.filters: dict[str, list[str]] = {}
        # Map collection_name -> mock collection object
        self._collections: dict[str, MagicMock] = {}

    def make_collection(self, name: str) -> MagicMock:
        mock = MagicMock()

        # Default: get_full_list returns empty list, get_first_list_item raises
        mock.get_full_list.return_value = []

        def _first_list_item(filter_str: str, *_a: object, **_kw: object) -> object:
            self.filters.setdefault(name, []).append(filter_str)
            raise RuntimeError("no record")  # bubbles up, caller catches

        mock.get_first_list_item.side_effect = _first_list_item
        self._collections[name] = mock
        return mock

    def __call__(self, name: str) -> MagicMock:
        self.accessed.append(name)
        return self._collections.get(name) or self.make_collection(name)


@pytest.fixture
def capturing_pb() -> tuple[MagicMock, _CollectionCapture]:
    pb = MagicMock()
    capture = _CollectionCapture()

    # Pre-seed common collections so get_full_list returns empty
    for cname in (
        "attendees",
        "bunk_requests",
        "persons",
        "bunk_assignments",
        "bunk_assignments_draft",
    ):
        capture.make_collection(cname)

    # Attendees: return one active attendee so the loop executes
    attendee = SimpleNamespace(person_id=111, division="A", year=2026)
    capture._collections["attendees"].get_full_list.return_value = [attendee]

    # persons: return one person for the attendee
    person = SimpleNamespace(
        cm_id=111,
        first_name="Emma",
        last_name="Johnson",
        grade=7,
        gender="F",
        age=12,
        years_at_camp=2,
        family_id=1,
    )
    capture._collections["persons"].get_full_list.return_value = [person]

    pb.collection.side_effect = capture
    return pb, capture


def test_scenario_id_routes_assignment_query_to_draft_collection(
    capturing_pb: tuple[MagicMock, _CollectionCapture],
) -> None:
    """When scenario_id is provided, bunk assignment lookup must hit bunk_assignments_draft."""
    pb, capture = capturing_pb
    builder = OptimizedSocialGraphBuilder(pb, random_seed=42)

    builder.build_social_network(year=2026, session_cm_id=999, scenario_id="scn_xyz")

    # The draft collection MUST have been queried for assignments
    assert "bunk_assignments_draft" in capture.filters, (
        f"Expected bunk_assignments_draft query when scenario_id set. Filters seen: {capture.filters}"
    )
    # Production bunk_assignments MUST NOT be queried for assignments
    assert "bunk_assignments" not in capture.filters, (
        f"Must not query bunk_assignments when scenario_id is set. Filters seen: {capture.filters}"
    )

    # The draft filter must include the scenario clause
    draft_filters = capture.filters["bunk_assignments_draft"]
    assert any('scenario = "scn_xyz"' in f for f in draft_filters), (
        f"Expected scenario filter in draft query, got: {draft_filters}"
    )


def test_no_scenario_id_preserves_production_query(
    capturing_pb: tuple[MagicMock, _CollectionCapture],
) -> None:
    """When scenario_id is None/absent, assignments come from bunk_assignments (CampMinder)."""
    pb, capture = capturing_pb
    builder = OptimizedSocialGraphBuilder(pb, random_seed=42)

    builder.build_social_network(year=2026, session_cm_id=999)

    assert "bunk_assignments" in capture.filters, (
        f"Expected bunk_assignments query when scenario_id is absent. Filters seen: {capture.filters}"
    )
    assert "bunk_assignments_draft" not in capture.filters, (
        f"Must not query bunk_assignments_draft without scenario_id. Filters seen: {capture.filters}"
    )


def test_build_social_network_accepts_scenario_id_kwarg(
    capturing_pb: tuple[MagicMock, _CollectionCapture],
) -> None:
    """Signature must accept scenario_id as keyword arg (backwards-compatible default)."""
    pb, _ = capturing_pb
    builder = OptimizedSocialGraphBuilder(pb, random_seed=42)

    # Must not raise TypeError
    builder.build_social_network(year=2026, session_cm_id=999, scenario_id=None)
    builder.build_social_network(year=2026, session_cm_id=999, scenario_id="abc")

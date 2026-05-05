"""Tests for PocketBase record TypedDicts in bunking/graph/_types.py.

These tests verify that:
1. The TypedDicts export the required fields used by social_graph_builder.py.
2. The cast helpers (cast_person, cast_session) return the correct TypedDict
   type so downstream attribute access type-checks cleanly.
3. Regression: last_year is always defined before the exception handler that
   references it (line ~264 in social_graph_builder.py).
4. Regression: nx.clustering() result is safely iterable as a dict even when
   pyright sees ambiguous return type.
"""

from __future__ import annotations

from typing import Any, get_type_hints
from unittest.mock import MagicMock

import networkx as nx

from bunking.graph._types import (
    CampSessionRecord,
    PersonRecord,
    cast_person,
    cast_session,
)
from bunking.graph.social_graph_builder import SocialGraphBuilder

# ---------------------------------------------------------------------------
# TypedDict field coverage
# ---------------------------------------------------------------------------


class TestPersonRecordFields:
    """PersonRecord must expose every field accessed via person.<attr> in
    social_graph_builder.py."""

    def test_has_first_name(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "first_name" in hints

    def test_has_last_name(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "last_name" in hints

    def test_has_grade(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "grade" in hints

    def test_has_gender(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "gender" in hints

    def test_has_family_id(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "family_id" in hints

    def test_has_cm_id(self) -> None:
        hints = get_type_hints(PersonRecord)
        assert "cm_id" in hints


class TestCampSessionRecordFields:
    """CampSessionRecord must expose every field accessed via session.<attr> in
    social_graph_builder.py."""

    def test_has_name(self) -> None:
        hints = get_type_hints(CampSessionRecord)
        assert "name" in hints

    def test_has_cm_id(self) -> None:
        hints = get_type_hints(CampSessionRecord)
        assert "cm_id" in hints


# ---------------------------------------------------------------------------
# cast helpers round-trip
# ---------------------------------------------------------------------------


class TestCastHelpers:
    """cast_person / cast_session must preserve the underlying data."""

    def _make_mock_record(self, **attrs: Any) -> MagicMock:
        mock = MagicMock()
        for k, v in attrs.items():
            setattr(mock, k, v)
        return mock

    def test_cast_person_preserves_first_name(self) -> None:
        mock = self._make_mock_record(
            first_name="Emma",
            last_name="Johnson",
            grade=7,
            gender="F",
            family_id=12345,
            cm_id=9999,
            id="abc",
            created="",
            updated="",
        )
        p = cast_person(mock)
        assert p["first_name"] == "Emma"

    def test_cast_person_preserves_family_id(self) -> None:
        mock = self._make_mock_record(
            first_name="Liam",
            last_name="Garcia",
            grade=8,
            gender="M",
            family_id=42,
            cm_id=1001,
            id="def",
            created="",
            updated="",
        )
        p = cast_person(mock)
        assert p["family_id"] == 42

    def test_cast_session_preserves_name(self) -> None:
        mock = self._make_mock_record(
            name="Session 1A",
            cm_id=1000001,
            id="ghi",
            created="",
            updated="",
        )
        s = cast_session(mock)
        assert s["name"] == "Session 1A"

    def test_cast_session_preserves_cm_id(self) -> None:
        mock = self._make_mock_record(
            name="Session 2B",
            cm_id=1000002,
            id="jkl",
            created="",
            updated="",
        )
        s = cast_session(mock)
        assert s["cm_id"] == 1000002


# ---------------------------------------------------------------------------
# Regression: last_year never unbound
# ---------------------------------------------------------------------------


class TestLastYearBinding:
    """Regression: build_bunk_graph must not raise NameError due to last_year
    being unbound when the historical-data lookup raises before assignment.

    This reproduces the 'last_year is possibly unbound' pyright error by
    confirming the function runs without NameError even when the inner try
    block fails immediately.
    """

    def test_build_bunk_graph_no_name_error_on_history_failure(self) -> None:
        pb = MagicMock()

        # Simulate: person fetch succeeds, historical fetch fails immediately
        person_mock = MagicMock()
        person_mock.cm_id = 111
        person_mock.first_name = "Olivia"
        person_mock.last_name = "Chen"
        person_mock.grade = 7
        person_mock.gender = "F"
        person_mock.family_id = 0

        def _get_first_list_item(filter_: str, **kwargs: Any) -> MagicMock:
            if "cm_id = 111" in filter_ and "person" not in filter_:
                return person_mock
            raise Exception("no historical data")

        assignment_mock = MagicMock()
        assignment_mock.expand = {}

        expand_person = MagicMock()
        expand_person.cm_id = 111

        assignment_mock.expand = {"person": expand_person}

        pb.collection.return_value.get_full_list.return_value = [assignment_mock]
        pb.collection.return_value.get_first_list_item.side_effect = _get_first_list_item

        builder = SocialGraphBuilder(pb=pb)
        # Should not raise NameError — last_year must always be bound before use
        result = builder.build_bunk_graph(year=2025, bunk_cm_id=1, session_cm_id=1000001)
        assert isinstance(result, nx.DiGraph)


# ---------------------------------------------------------------------------
# Regression: nx.clustering() result safe as dict
# ---------------------------------------------------------------------------


class TestClusteringDictSafety:
    """Regression: _calculate_node_metrics must not raise AttributeError when
    calling .items() on the result of nx.clustering().

    nx.clustering(G) returns a dict[node, float] when given a graph (not a
    single node), so .items() is always valid. This test exercises the code
    path to confirm no AttributeError at runtime.
    """

    def test_calculate_node_metrics_clustering_iterable(self) -> None:
        builder = SocialGraphBuilder(pb=MagicMock())
        builder.graph = nx.Graph()
        builder.graph.add_node(1, bunk_cm_id=100)
        builder.graph.add_node(2, bunk_cm_id=100)
        builder.graph.add_edge(1, 2, edge_type="request", request_type="bunk_with")
        # Must not raise AttributeError — this validates .items() is callable
        builder._calculate_node_metrics()
        assert "clustering" in builder.graph.nodes[1]
        assert "clustering" in builder.graph.nodes[2]

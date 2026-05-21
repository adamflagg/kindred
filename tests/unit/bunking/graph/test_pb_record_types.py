"""Tests for PocketBase record TypedDicts in bunking/graph/_types.py.

These tests verify that:
1. ``cast_person`` and ``cast_session`` round-trip realistic PocketBase
   ``Record`` shapes correctly, reading from the actual schema field names.
2. ``cast_person`` reads ``household_id`` (the field that exists in the
   ``persons`` PocketBase migration), not ``family_id`` (which does not exist
   anywhere in the schema).
3. Regression: ``last_year`` is always defined before the exception handler
   that references it (line ~264 in social_graph_builder.py).
4. Regression: ``nx.clustering()`` result is safely iterable as a dict.
"""

from typing import Any
from unittest.mock import MagicMock

import networkx as nx

from bunking.graph._types import (
    cast_person,
    cast_session,
)
from bunking.graph.social_graph_builder import SocialGraphBuilder

# ---------------------------------------------------------------------------
# cast_person — schema-correct field reads
# ---------------------------------------------------------------------------


def _make_record(**attrs: Any) -> MagicMock:
    """Build a mock PocketBase record with explicit attribute values.

    ``MagicMock`` auto-creates attributes on access, so attributes that are
    NOT set here still resolve to fresh MagicMock instances. Callers that
    want to test default-fallback behavior should use ``MagicMock(spec=[])``
    instead — that raises ``AttributeError`` on missing access, exercising
    the ``getattr(record, name, default)`` fallback path.
    """
    mock = MagicMock()
    for k, v in attrs.items():
        setattr(mock, k, v)
    return mock


class TestCastPersonFromRecord:
    """cast_person() must read from the correct PocketBase schema fields."""

    def test_reads_household_id_from_record_attribute(self) -> None:
        """cast_person must read household_id (the actual PB field)."""
        mock = _make_record(
            id="p1",
            cm_id=9999,
            first_name="Emma",
            last_name="Johnson",
            grade=7,
            gender="F",
            household_id=12345,
            school="Riverside Elementary",
        )
        p = cast_person(mock)
        assert p["household_id"] == 12345

    def test_household_id_zero_when_missing(self) -> None:
        """Cast must default household_id to 0 when the attribute is absent."""
        mock = MagicMock(spec=[])  # empty spec — AttributeError on any access
        p = cast_person(mock)
        assert p["household_id"] == 0

    def test_preserves_first_name(self) -> None:
        mock = _make_record(
            id="p2",
            cm_id=1001,
            first_name="Liam",
            last_name="Garcia",
            grade=8,
            gender="M",
            household_id=42,
            school="Oak Valley Middle",
        )
        p = cast_person(mock)
        assert p["first_name"] == "Liam"

    def test_preserves_cm_id(self) -> None:
        mock = _make_record(
            id="p3",
            cm_id=2002,
            first_name="Olivia",
            last_name="Chen",
            grade=6,
            gender="F",
            household_id=99,
            school="Hillcrest High",
        )
        p = cast_person(mock)
        assert p["cm_id"] == 2002

    def test_preserves_grade(self) -> None:
        mock = _make_record(
            id="p4",
            cm_id=3003,
            first_name="Riley",
            last_name="Sam",
            grade=9,
            gender="NB",
            household_id=7,
            school="Riverside Elementary",
        )
        p = cast_person(mock)
        assert p["grade"] == 9

    def test_age_defaults_to_none_when_absent(self) -> None:
        mock = MagicMock(spec=[])
        p = cast_person(mock)
        assert p.get("age") is None


# ---------------------------------------------------------------------------
# cast_session — schema-correct field reads
# ---------------------------------------------------------------------------


class TestCastSessionFromRecord:
    """cast_session() must read from the correct PocketBase schema fields."""

    def test_preserves_name(self) -> None:
        mock = _make_record(id="s1", cm_id=1000001, name="Session 1A", session_type="overnight")
        s = cast_session(mock)
        assert s["name"] == "Session 1A"

    def test_preserves_cm_id(self) -> None:
        mock = _make_record(id="s2", cm_id=1000002, name="Session 2B", session_type="day")
        s = cast_session(mock)
        assert s["cm_id"] == 1000002

    def test_name_defaults_to_empty_string_when_absent(self) -> None:
        mock = MagicMock(spec=[])
        s = cast_session(mock)
        assert s["name"] == ""


# ---------------------------------------------------------------------------
# Regression: last_year never unbound
# ---------------------------------------------------------------------------


class TestLastYearBinding:
    """Regression: build_bunk_graph must not raise NameError due to last_year
    being unbound when the historical-data lookup raises before assignment.
    """

    def test_build_bunk_graph_no_name_error_on_history_failure(self) -> None:
        pb = MagicMock()

        person_mock = MagicMock()
        person_mock.cm_id = 111
        person_mock.first_name = "Olivia"
        person_mock.last_name = "Chen"
        person_mock.grade = 7
        person_mock.gender = "F"
        # Non-zero household_id — proves the sibling branch is reachable.
        # (Sibling logic is still skipped here because there's only one bunk
        # member, so no pairwise edges to add — but the cast/lookup path runs.)
        person_mock.household_id = 50001

        def _get_first_list_item(filter_: str, **kwargs: Any) -> MagicMock:
            if filter_ == "cm_id = 111":
                return person_mock
            raise Exception("no historical data")

        assignment_mock = MagicMock()

        expand_person = MagicMock()
        expand_person.cm_id = 111

        assignment_mock.expand = {"person": expand_person}

        pb.collection.return_value.get_full_list.return_value = [assignment_mock]
        pb.collection.return_value.get_first_list_item.side_effect = _get_first_list_item

        builder = SocialGraphBuilder(pb=pb)
        result = builder.build_bunk_graph(year=2025, bunk_cm_id=1, session_cm_id=1000001)
        assert isinstance(result, nx.DiGraph)


# ---------------------------------------------------------------------------
# Regression: nx.clustering() result safe as dict
# ---------------------------------------------------------------------------


class TestClusteringDictSafety:
    """Regression: _calculate_node_metrics must not raise AttributeError when
    calling .items() on the result of nx.clustering().
    """

    def test_calculate_node_metrics_clustering_iterable(self) -> None:
        builder = SocialGraphBuilder(pb=MagicMock())
        builder.graph = nx.Graph()
        builder.graph.add_node(1, bunk_cm_id=100)
        builder.graph.add_node(2, bunk_cm_id=100)
        builder.graph.add_edge(1, 2, edge_type="request", request_type="bunk_with")
        builder._calculate_node_metrics()
        assert "clustering" in builder.graph.nodes[1]
        assert "clustering" in builder.graph.nodes[2]

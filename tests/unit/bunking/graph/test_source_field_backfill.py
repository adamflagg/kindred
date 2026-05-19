"""Regression: missing source_field must derive from request_type, not default to bunk_with."""

import logging
from unittest.mock import MagicMock

import networkx as nx
import pytest

from bunking.graph.social_graph_builder import SocialGraphBuilder, _backfill_source_field
from bunking.satisfaction.bucket import classify_request


def test_not_bunk_with_with_null_source_field_classifies_as_staff():
    builder = SocialGraphBuilder(MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=11, grade=5)  # different bunks → not_bunk_with satisfied
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="not_bunk_with",
        source_field=None,  # legacy/sync gap
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    builder._calculate_node_metrics()
    assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"
    assert g.nodes[1]["staff_satisfaction_status"] == "satisfied"


def test_unknown_request_type_with_null_source_field_lands_immaterial(caplog):
    """Unknown request_type with null source_field must NOT land in MATERIAL_PARENT.

    The previous fallback dict-lookup default of "bunk_with" silently promoted any
    unmapped type into the counted parent bucket, inflating parent_satisfaction_status.
    The fix routes unknowns to "socialize_with" (IMMATERIAL — visible-but-uncounted)
    and emits a logger.warning so the fallback path is observable.
    """
    builder = SocialGraphBuilder(MagicMock())
    g = nx.Graph()
    g.add_node(1, bunk_cm_id=10, grade=5)
    g.add_node(2, bunk_cm_id=10, grade=5)
    g.add_edge(
        1,
        2,
        edge_type="request",
        request_type="future_unknown_kind",
        source_field=None,
        request_id="r1",
        requester_id=1,
        requestee_id=2,
    )
    builder.graph = g
    with caplog.at_level(logging.WARNING, logger="bunking.graph.social_graph_builder"):
        builder._calculate_node_metrics()
    assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"  # not counted
    assert any("unknown request_type" in rec.message.lower() for rec in caplog.records)


class TestBackfillSourceFieldDirect:
    """Scan-it round 3 #2: legacy `age_preference` request_type with null
    source_field was mapped to `age_preference` — but `bucket.classify_request`
    only knows bunk_with / socialize_with / not_bunk_with / bunking_notes /
    internal_notes, so the result was a latent ValueError. Per bucket.py's
    docstring, the parent "socialize with / age preference" dropdown maps to
    socialize_with — that's where age_preference legacy rows belong.
    """

    def test_age_preference_legacy_maps_to_socialize_with(self) -> None:
        result = _backfill_source_field("age_preference", None)
        assert result == "socialize_with"
        # And the result must be classifiable (no ValueError).
        classify_request(result)

    def test_age_preference_legacy_with_empty_source_field_maps_to_socialize_with(self) -> None:
        result = _backfill_source_field("age_preference", "")
        assert result == "socialize_with"
        classify_request(result)

    def test_explicit_source_field_wins_over_request_type(self) -> None:
        # When source_field is set, it's used as-is regardless of request_type.
        assert _backfill_source_field("age_preference", "internal_notes") == "internal_notes"

    def test_known_legacy_types_round_trip(self) -> None:
        # request_type "bunk_with" / "not_bunk_with" / "socialize_with" map to
        # the renamed source_field values (and those results must be classifiable).
        expected = {
            "bunk_with": "bunk_request_form",
            "not_bunk_with": "staff_not_bunk_with",
            "socialize_with": "socialize_with",
        }
        for rt, expected_sf in expected.items():
            result = _backfill_source_field(rt, None)
            assert result == expected_sf, f"request_type {rt!r} → {result!r}, expected {expected_sf!r}"
            classify_request(result)


class TestBackfillSourceFieldNoneRequestType:
    """Scan-it round 3 #3: edge attr `request_type` can be explicit-None on
    legacy rows; `data.get("request_type", "bunk_with")` returns None (not
    the default), and `_backfill_source_field(None, ...)` violated the
    `request_type: str` signature. The graph code now coerces to "" before
    calling the helper so the fallback path stays clean.
    """

    def test_none_request_type_in_edge_falls_back_to_socialize_with(self, caplog: pytest.LogCaptureFixture) -> None:
        builder = SocialGraphBuilder(MagicMock())
        g = nx.Graph()
        g.add_node(1, bunk_cm_id=10, grade=5)
        g.add_node(2, bunk_cm_id=10, grade=5)
        g.add_edge(
            1,
            2,
            edge_type="request",
            request_type=None,  # explicit-None, not default
            source_field=None,
            request_id="r1",
            requester_id=1,
            requestee_id=2,
        )
        builder.graph = g
        with caplog.at_level(logging.WARNING, logger="bunking.graph.social_graph_builder"):
            # Must not crash on None request_type
            builder._calculate_node_metrics()
        # Falls through to no_requests bucket (socialize_with is IMMATERIAL).
        assert g.nodes[1]["parent_satisfaction_status"] == "no_requests"

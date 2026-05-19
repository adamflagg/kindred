"""Contract: every request-type edge produced by build_social_network has the
attributes _calculate_node_metrics depends on (source_field, request_id,
requester_id).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder


def _attendee(person_id: int) -> SimpleNamespace:
    return SimpleNamespace(person_id=person_id, status_id=2, division=None)


def _person(cm_id: int) -> SimpleNamespace:
    return SimpleNamespace(
        cm_id=cm_id,
        first_name=f"Person{cm_id}",
        last_name="Test",
        grade=8,
        gender="F",
        family_id=None,
        age=None,
        years_at_camp=None,
    )


def _request(id: str, requester_id: int, requestee_id: int, source_field: str | None = "bunk_with") -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        cm_id=int(id.lstrip("r")),
        requester_id=requester_id,
        requestee_id=requestee_id,
        request_type="bunk_with",
        source_field=source_field,
        priority=5,
        confidence_score=1.0,
        year=2026,
        session_id=5,
        merged_into=None,
        status="resolved",
        source="parent",
        is_reciprocal=False,
    )


def test_every_request_edge_has_source_field_and_request_id() -> None:
    """Every edge with edge_type='request' must carry source_field, request_id,
    and requester_id — the three attributes _calculate_node_metrics depends on."""
    attendees = [_attendee(1), _attendee(2), _attendee(3)]
    persons = [_person(1), _person(2), _person(3)]
    requests = [
        _request("r1", requester_id=1, requestee_id=2, source_field="bunk_request_form"),
        _request("r2", requester_id=2, requestee_id=3, source_field=None),  # backfill case
    ]

    pb = MagicMock()

    # Track how get_full_list is called to return the right data.
    # build_social_network calls pb.collection(ATTENDEES).get_full_list first,
    # then _batch_fetch_persons calls pb.collection(PERSONS).get_full_list,
    # then _batch_fetch_requests calls pb.collection(BUNK_REQUESTS).get_full_list.
    # Per-attendee assignment lookups use get_first_list_item (not get_full_list).
    from api.constants.collections import ATTENDEES, BUNK_REQUESTS, PERSONS

    def _make_col(name: str) -> MagicMock:
        col = MagicMock()
        if name == ATTENDEES:
            col.get_full_list.return_value = attendees
        elif name == PERSONS:
            col.get_full_list.return_value = persons
        elif name == BUNK_REQUESTS:
            col.get_full_list.return_value = requests
        else:
            # Assignment collection: return None (no assignment) — get_first_list_item raises
            col.get_first_list_item.side_effect = Exception("not found")
        return col

    pb.collection.side_effect = _make_col

    builder = OptimizedSocialGraphBuilder(pb)
    builder.build_social_network(year=2026, session_cm_id=5)

    request_edges = [(u, v, d) for u, v, d in builder.graph.edges(data=True) if d.get("edge_type") == "request"]
    assert request_edges, "expected at least one request edge"
    for u, v, d in request_edges:
        assert d.get("source_field"), f"edge {u}-{v} missing source_field"
        assert d.get("request_id"), f"edge {u}->{v} missing request_id"
        assert d.get("requester_id") is not None, f"edge {u}->{v} missing requester_id"

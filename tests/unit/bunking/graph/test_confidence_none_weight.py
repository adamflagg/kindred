"""Contract: weight derived from confidence_score must be numeric (not None).

`getattr(request, "confidence_score", 1.0)` returns the default ONLY if the
attribute is missing — if the attribute is present-and-None (legal for PB
nullable bool/float columns), the default is bypassed and `weight` becomes
None. Downstream `max(edge_data["weight"], weight)` then crashes.

The PR replaced `weight = 1.0 + (priority / 10.0)` with `weight =
confidence_score`, removing the priority bottom-bound that used to mask this.
"""

from types import SimpleNamespace

from bunking.graph.social_graph_builder import build_request_edge_attrs


def _request_with_confidence(score: float | None) -> SimpleNamespace:
    return SimpleNamespace(
        id="r1",
        requester_id=1,
        requestee_id=2,
        request_type="bunk_with",
        source_field="bunk_request_form",
        confidence_score=score,
    )


def test_build_request_edge_attrs_with_none_confidence_yields_numeric() -> None:
    """confidence_score=None must not propagate into edge attributes."""
    request = _request_with_confidence(None)
    attrs = build_request_edge_attrs(request, reciprocal=False, weight=1.0)
    assert attrs["confidence"] is not None, "edge 'confidence' must be numeric"
    assert isinstance(attrs["confidence"], (int, float))


def test_build_request_edge_attrs_with_present_confidence_passes_through() -> None:
    """Non-None confidence values pass through unchanged."""
    request = _request_with_confidence(0.85)
    attrs = build_request_edge_attrs(request, reciprocal=False, weight=0.85)
    assert attrs["confidence"] == 0.85

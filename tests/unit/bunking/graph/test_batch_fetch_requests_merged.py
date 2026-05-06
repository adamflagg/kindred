"""Regression: merged-away requests must not enter the graph."""

from unittest.mock import MagicMock

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder


def test_batch_fetch_excludes_merged_into():
    pb = MagicMock()
    captured: list[str] = []

    def fake_get_full_list(query_params=None, **_):
        filter_str = query_params.get("filter", "") if query_params else ""
        captured.append(filter_str)
        return []

    pb.collection.return_value.get_full_list.side_effect = fake_get_full_list

    builder = OptimizedSocialGraphBuilder(pb)
    builder._batch_fetch_requests([1, 2, 3], session_cm_id=5, year=2026)

    # At least one of the captured filter strings must contain a merged_into clause.
    assert captured, "No filters were captured"
    assert any("merged_into" in f for f in captured), f"No merged_into filter found in: {captured}"

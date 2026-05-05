"""Captures pre-migration solver scores and graph node attrs.

Tasks 8 (solver migration) and 9 (graph migration) will run this fixture
again post-migration and assert byte-identical output. The baseline JSONs
are committed alongside this test as the contract every migration must
preserve.

To recapture (after intentional spec change): RECAPTURE=1 uv run pytest \\
    tests/unit/bunking/satisfaction/test_baseline_regression.py -s
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

BASELINE_DIR = Path(__file__).parent / "baselines"


def _baseline_path(name: str) -> Path:
    return BASELINE_DIR / f"{name}.json"


def _save_or_compare(name: str, actual: dict[str, Any]) -> None:
    """First run captures; subsequent runs compare. Set RECAPTURE=1 to refresh."""
    path = _baseline_path(name)
    if os.environ.get("RECAPTURE") == "1" or not path.exists():
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(actual, indent=2, sort_keys=True))
        pytest.skip(f"Captured baseline {name} — re-run without RECAPTURE to assert.")
    expected = json.loads(path.read_text())
    assert actual == expected, f"Regression in {name}"


class _MinimalConfig:
    """Minimal config stub for score_evaluator — returns all defaults."""

    _defaults: dict[str, int | float] = {
        "objective.enable_diminishing_returns": 1,
        "objective.first_request_multiplier": 10,
        "objective.second_request_multiplier": 5,
        "objective.third_plus_request_multiplier": 1,
        "objective.source_multipliers.share_bunk_with": 1.5,
        "objective.source_multipliers.do_not_share_with": 1.5,
        "objective.source_multipliers.bunking_notes": 1.2,
        "objective.source_multipliers.internal_notes": 1.0,
        "objective.source_multipliers.socialize_preference": 0.8,
        "penalty.grade_spread": 100,
        "constraint.grade_spread.max_spread": 2,
        "penalty.over_capacity": 500,
        "constraint.cabin_capacity.standard": 12,
        "constraint.cabin_occupancy.minimum": 8,
        "penalty.under_occupancy": 50,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._defaults.get(key)
        if v is None:
            return default if default is not None else 0
        return int(v)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._defaults.get(key)
        if v is None:
            return default if default is not None else 0.0
        return float(v)


def test_solver_score_baseline(
    synthetic_persons: list[dict[str, Any]],
    synthetic_bunks: list[dict[str, Any]],
    synthetic_assignments: list[dict[str, Any]],
    synthetic_requests: list[dict[str, Any]],
) -> None:
    """Pin solver score breakdown for the synthetic fixture."""
    from bunking.solver.score_evaluator import evaluate_scenario_score

    breakdown = evaluate_scenario_score(
        requests=synthetic_requests,
        assignments=synthetic_assignments,
        persons=synthetic_persons,
        bunks=synthetic_bunks,
        config=_MinimalConfig(),  # type: ignore[arg-type]
    )
    actual = {
        "total_score": breakdown.total_score,
        "request_satisfaction_score": breakdown.request_satisfaction_score,
        "soft_penalty_score": breakdown.soft_penalty_score,
        "total_requests": breakdown.total_requests,
        "satisfied_requests": breakdown.satisfied_requests,
        "field_scores": breakdown.field_scores,
    }
    _save_or_compare("solver_score", actual)


def test_graph_node_metrics_baseline(
    synthetic_persons: list[dict[str, Any]],
    synthetic_assignments: list[dict[str, Any]],
    synthetic_requests: list[dict[str, Any]],
) -> None:
    """Pin per-node parent_satisfaction_status / staff_satisfaction_status / satisfaction_status."""
    from unittest.mock import MagicMock

    import networkx as nx

    from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder

    builder = OptimizedSocialGraphBuilder(pb=MagicMock(), random_seed=42)

    # Build the graph in-memory rather than going through the PB-fetching path.
    g = nx.DiGraph()
    for p in synthetic_persons:
        bunk = next(
            (a["bunk_cm_id"] for a in synthetic_assignments if a["person_cm_id"] == p["cm_id"]),
            None,
        )
        g.add_node(p["cm_id"], bunk_cm_id=bunk, grade=p["grade"], gender=p["gender"])

    for r in synthetic_requests:
        # The graph builder's _calculate_node_metrics reads request_type off edges
        # to bucket into parent_edges vs staff_edges. Set source for completeness
        # (matches what the production build_social_network path produces).
        g.add_edge(
            r["requester_id"],
            r["requestee_id"],
            edge_type="request",
            request_type=r["request_type"],
            priority=r["priority"],
            source=("staff" if r["source_field"] in ("not_bunk_with", "bunking_notes", "internal_notes") else "family"),
            request_id=r["id"],
        )
    builder.graph = g
    builder._calculate_node_metrics()

    actual = {
        str(n): {
            "parent_satisfaction_status": g.nodes[n].get("parent_satisfaction_status"),
            "staff_satisfaction_status": g.nodes[n].get("staff_satisfaction_status"),
            "satisfaction_status": g.nodes[n].get("satisfaction_status"),
        }
        for n in sorted(g.nodes())
    }
    _save_or_compare("graph_node_metrics", actual)

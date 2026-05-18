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
from typing import Any, ClassVar

import pytest

BASELINE_DIR = Path(__file__).parent / "baselines"


def _baseline_path(name: str) -> Path:
    return BASELINE_DIR / f"{name}.json"


def _save_or_compare(name: str, actual: dict[str, Any]) -> None:
    """Compare against committed baseline; set RECAPTURE=1 to refresh."""
    path = _baseline_path(name)
    if not path.exists():
        if os.environ.get("RECAPTURE") == "1":
            BASELINE_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
            pytest.skip(f"baseline written to {path} (RECAPTURE=1)")
        pytest.fail(f"baseline missing at {path}; rerun with RECAPTURE=1 to capture")
    if os.environ.get("RECAPTURE") == "1":
        path.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
        pytest.skip(f"Captured baseline {name} — re-run without RECAPTURE to assert.")
    expected = json.loads(path.read_text())
    assert actual == expected, f"Regression in {name}"


class _MinimalConfig:
    """Minimal config stub for score_evaluator — returns all defaults.

    Includes BOTH the legacy keys (for back-compat with anything still
    reading them) AND the canonical keys that score_evaluator now reads
    via the centralized accessors in ``bunking.solver.penalties``. The
    canonical values are intentionally identical to the legacy values
    here so this baseline JSON stays byte-identical across the B1/B2/B4
    centralization. Callers that want to test the production magnitudes
    (50000/2000/3000) should set those canonical keys explicitly.
    """

    _defaults: ClassVar[dict[str, int | float]] = {
        "objective.enable_diminishing_returns": 1,
        "objective.first_request_multiplier": 10,
        "objective.second_request_multiplier": 5,
        "objective.third_plus_request_multiplier": 1,
        # Pin Stream 4 mutual boost off — this baseline is a centralization-
        # invariant snapshot, not a feature-shipping baseline. The synthetic
        # fixture contains r6↔r7 (4↔5 bunk_with) which the default 2.0 boost
        # would inflate. Feature integration coverage lives in
        # tests/unit/bunking/solver/test_mutual_request_boost.py.
        "objective.mutual_request_boost": 1.0,
        "objective.source_multipliers.share_bunk_with": 1.5,
        "objective.source_multipliers.do_not_share_with": 1.5,
        "objective.source_multipliers.bunking_notes": 1.2,
        "objective.source_multipliers.internal_notes": 1.0,
        "objective.source_multipliers.socialize_preference": 0.8,
        # Legacy keys (no longer read by score_evaluator after B1/B2/B4 fix)
        "penalty.grade_spread": 100,
        "penalty.over_capacity": 500,
        "constraint.cabin_occupancy.minimum": 8,
        "penalty.under_occupancy": 50,
        # Canonical keys used by the centralized accessors. Values match
        # the legacy ones above so this snapshot test pins behavior, not
        # production magnitudes.
        "constraint.grade_spread.penalty": 100,
        "constraint.cabin_capacity.penalty": 500,
        "constraint.cabin_minimum_occupancy.penalty": 50,
        # Other canonical keys
        "constraint.grade_spread.max_spread": 2,
        "constraint.cabin_capacity.standard": 12,
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
    from bunking.config import ConfigLoader
    from bunking.solver.score_evaluator import evaluate_scenario_score

    minimal = _MinimalConfig()
    # The score_evaluator's centralized accessors (grade_spread_penalty,
    # cabin_capacity_penalty, etc.) read via ConfigLoader.get_instance(),
    # so install our _MinimalConfig there in addition to passing it
    # through the `config=` parameter.
    with ConfigLoader.use(minimal):  # type: ignore[arg-type]
        breakdown = evaluate_scenario_score(
            requests=synthetic_requests,
            assignments=synthetic_assignments,
            persons=synthetic_persons,
            bunks=synthetic_bunks,
            config=minimal,
        )
    # Snapshot the full ScoreBreakdown — partial snapshots let parts of the
    # solver contract regress silently (#16).
    actual = {
        "total_score": breakdown.total_score,
        "request_satisfaction_score": breakdown.request_satisfaction_score,
        "soft_penalty_score": breakdown.soft_penalty_score,
        "total_requests": breakdown.total_requests,
        "satisfied_requests": breakdown.satisfied_requests,
        "satisfaction_rate": breakdown.satisfaction_rate,
        "field_scores": breakdown.field_scores,
        "penalties": breakdown.penalties,
    }
    _save_or_compare("solver_score", actual)


# NOTE: The graph_node_metrics.json baseline was regenerated as part of T9
# (2026-05-05) to reflect the intentional spec change from request_type-based
# bucketing to source_field-based bucketing per #1041:
#
#   OLD: parent_edges = request_type == "bunk_with"
#        staff_edges  = request_type == "not_bunk_with"
#        aggregate    = ANY request edge satisfied
#
#   NEW: MATERIAL_PARENT = source_field == "bunk_with"
#        STAFF           = source_field in {not_bunk_with, bunking_notes, internal_notes}
#        IMMATERIAL      = source_field == "socialize_with" (visible-uncounted)
#        aggregate       = ANY material_parent OR staff edge satisfied
#                         (immaterial excluded from totals)
#
# Notable behavioral changes captured in the new baseline:
# - Nodes whose only requests are socialize_with go "satisfied" → "no_requests"
#   (gray) since immaterial doesn't count toward totals.
# - bunk_with requests sourced from staff (bunking_notes, internal_notes) move
#   from parent_satisfaction_status to staff_satisfaction_status.
# - Unbunked campers with request edges go from "no_requests" → "unsatisfied"
#   (the new aggregator is honest about unmet requests vs. silently grey-stating
#   them).
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
        # The graph builder's _calculate_node_metrics reads source_field off
        # edges to classify into MATERIAL_PARENT / STAFF / IMMATERIAL_PARENT
        # per bunking.satisfaction.bucket. Set both `source` (legacy 2-axis,
        # still consumed by some UI paths) AND `source_field` (new 3-bucket
        # axis driving graph satisfaction statuses).
        # requester_id / requestee_id are required by the per-requester filter
        # in _calculate_node_metrics (edges without these attrs are skipped).
        g.add_edge(
            r["requester_id"],
            r["requestee_id"],
            edge_type="request",
            request_type=r["request_type"],
            source=("staff" if r["source_field"] in ("not_bunk_with", "bunking_notes", "internal_notes") else "family"),
            source_field=r["source_field"],
            request_id=r["id"],
            requester_id=r["requester_id"],
            requestee_id=r["requestee_id"],
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

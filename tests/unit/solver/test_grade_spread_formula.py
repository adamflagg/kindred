"""Verify grade_spread evaluators use the unique-grade-count formula (B3 fix).

The OR-Tools cost term in ``bunking/solver/constraints/grade_spread.py`` (the
soft constraint, lines ~150-170) computes:

    excess_grades = max(0, unique_grade_count - max_unique_grades)
    cost          = penalty_weight * excess_grades

The post-solve evaluators (``objective_evaluator._calculate_grade_spread_penalty``
and ``score_evaluator._calculate_penalties``) historically used a different
formula — ``spread = max(grades) - min(grades)`` then ``excess = spread -
max_unique_grades`` — which over-counts whenever non-adjacent grades are
present (e.g. {5, 5, 5, 10, 10}: range=5 but only 2 unique grades).

This module pins both evaluators to the OR-Tools formula so the displayed
score matches what the solver actually optimized.
"""

from __future__ import annotations

from typing import Any

import pytest

from bunking.config import ConfigLoader


class _Config:
    """Stub loader providing the four centralized keys + threshold."""

    def __init__(self, max_spread: int = 2, penalty: int = 1000):
        self._values: dict[str, int] = {
            "constraint.grade_spread.penalty": penalty,
            "constraint.grade_spread.max_spread": max_spread,
            "constraint.cabin_capacity.penalty": 500,
            "constraint.cabin_capacity.standard": 12,
            "constraint.cabin_minimum_occupancy.min": 8,
            "constraint.cabin_minimum_occupancy.penalty": 50,
        }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


def _make_persons(grades: list[int]) -> dict[int, dict[str, Any]]:
    """Returns ``{cm_id: {"cm_id": ..., "grade": g}}`` for one cabin's worth."""
    return {i + 1: {"cm_id": i + 1, "grade": g} for i, g in enumerate(grades)}


def _make_bunk_to_persons(n: int) -> dict[int, list[int]]:
    return {100: list(range(1, n + 1))}


# --- score_evaluator (used in the scenario score breakdown) --------------------


def _score_evaluator_grade_spread(grades: list[int], cfg: _Config) -> int:
    """Run score_evaluator._calculate_penalties on a single-bunk fixture and
    return just the grade_spread component (0 if absent).
    """
    from bunking.solver.score_evaluator import _calculate_penalties

    person_to_bunk = {i + 1: 100 for i in range(len(grades))}
    bunk_to_persons = _make_bunk_to_persons(len(grades))
    person_by_cm_id = _make_persons(grades)
    bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

    with ConfigLoader.use(cfg):  # type: ignore[arg-type]
        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, cfg)
    return penalties.get("grade_spread", 0)


def test_score_evaluator_unique_grade_count_not_range():
    """Pin score_evaluator to the unique-grade-count formula."""
    cfg = _Config(max_spread=2, penalty=1000)

    # 4 unique grades, max=2 → excess=2 → penalty=2000.
    assert _score_evaluator_grade_spread([5, 5, 6, 6, 7, 8], cfg) == 2000

    # 3 grades all the same → unique=1, excess=0, penalty=0.
    assert _score_evaluator_grade_spread([5, 5, 5], cfg) == 0

    # 2 unique grades far apart (range=5 but unique=2, excess=0) → penalty=0.
    # Under the OLD range formula this was non-zero.
    assert _score_evaluator_grade_spread([5, 5, 5, 10, 10], cfg) == 0

    # Boundary: exactly max_spread unique grades → no penalty.
    assert _score_evaluator_grade_spread([5, 5, 6, 6], cfg) == 0


def test_score_evaluator_grade_spread_scales_linearly_with_excess():
    cfg = _Config(max_spread=2, penalty=1000)
    # 5 unique grades, max=2 → excess=3 → penalty=3000.
    assert _score_evaluator_grade_spread([4, 5, 6, 7, 8], cfg) == 3000


# --- objective_evaluator (the "exact-match-the-solver" evaluator) --------------


def _objective_evaluator_grade_spread(grades: list[int], cfg: _Config) -> int:
    """Run objective_evaluator._calculate_grade_spread_penalty directly."""
    from bunking.solver.objective_evaluator import ObjectiveEvaluator

    bunk_to_persons = _make_bunk_to_persons(len(grades))
    person_by_cm_id = _make_persons(grades)
    bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

    with ConfigLoader.use(cfg):  # type: ignore[arg-type]
        evaluator = ObjectiveEvaluator(config=cfg)  # type: ignore[arg-type]
        return evaluator._calculate_grade_spread_penalty(bunk_to_persons, person_by_cm_id, bunk_by_cm_id)


def test_objective_evaluator_unique_grade_count_not_range():
    """Pin objective_evaluator to the unique-grade-count formula."""
    cfg = _Config(max_spread=2, penalty=1000)

    assert _objective_evaluator_grade_spread([5, 5, 6, 6, 7, 8], cfg) == 2000
    assert _objective_evaluator_grade_spread([5, 5, 5], cfg) == 0
    assert _objective_evaluator_grade_spread([5, 5, 5, 10, 10], cfg) == 0
    assert _objective_evaluator_grade_spread([5, 5, 6, 6], cfg) == 0


# --- The two evaluators must agree at every point ------------------------------


@pytest.mark.parametrize(
    "grades",
    [
        [5, 5, 5],
        [5, 5, 5, 10, 10],
        [4, 5, 6, 7],
        [4, 5, 6, 7, 8],
        [5, 5, 6, 6],
        [5, 5, 6, 6, 7, 8],
    ],
)
def test_score_evaluator_matches_objective_evaluator(grades):
    """Both evaluators must report the same grade_spread penalty."""
    cfg = _Config(max_spread=2, penalty=1000)
    assert _score_evaluator_grade_spread(grades, cfg) == _objective_evaluator_grade_spread(grades, cfg)

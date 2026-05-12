"""Verify both evaluators charge under-occupancy against PREFERRED_BUNK_OCCUPANCY.

B5 drift fix: the OR-Tools cost path in
``bunking/solver/constraints/cabin_occupancy.py:add_cabin_minimum_occupancy_soft_penalty``
charges ``penalty * max(0, preferred - occupancy)`` for each used non-AG bunk.
The post-solve evaluators historically charged against the hard minimum
(``MIN_BUNK_OCCUPANCY=8``) instead, so any feasible bunk in the (min, preferred]
band (8 or 9 campers) contributed zero to the displayed score even though the
solver was actively pushing toward 10. Worst-case the displayed score
under-reports by ~120k.

These tests pin both Python evaluators to the same formula and assert they
agree at every point. In the feasible band (occupancy >= MIN_BUNK_OCCUPANCY)
this formula also matches the OR-Tools cost contribution; sub-MIN cases
cannot occur in a valid solver solution (the hard constraint forbids them)
and the OR-Tools ``underfill`` IntVar is bounded at ``PREFERRED - MIN``, so
those parametrize rows exercise only the Python evaluators, not OR-Tools
alignment.
"""

from __future__ import annotations

from typing import Any

import pytest

from bunking.config import ConfigLoader


class _Config:
    """Stub loader providing the centralized keys evaluators read."""

    def __init__(self, penalty: int = 50):
        self._values: dict[str, int] = {
            "constraint.cabin_minimum_occupancy.penalty": penalty,
            # After Phase 2 these are constants, not config keys. The accessor
            # ignores config; entries here exist so any legacy direct reads
            # would still resolve and signal regression elsewhere.
            "constraint.grade_spread.penalty": 100,
            "constraint.grade_spread.max_spread": 2,
        }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


def _make_bunk_to_persons(occupancy: int) -> dict[int, list[int]]:
    return {100: list(range(1, occupancy + 1))} if occupancy > 0 else {100: []}


def _make_person_by_cm_id(occupancy: int) -> dict[int, dict[str, Any]]:
    return {i + 1: {"cm_id": i + 1, "grade": 5} for i in range(occupancy)}


# --- score_evaluator -----------------------------------------------------------


def _score_evaluator_under_occupancy(occupancy: int, cfg: _Config) -> int:
    from bunking.solver.score_evaluator import _calculate_penalties

    person_to_bunk = {i + 1: 100 for i in range(occupancy)}
    bunk_to_persons = _make_bunk_to_persons(occupancy)
    person_by_cm_id = _make_person_by_cm_id(occupancy)
    bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

    with ConfigLoader.use(cfg):  # type: ignore[arg-type]
        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, cfg)
    return penalties.get("under_occupancy", 0)


@pytest.mark.parametrize(
    ("occupancy", "expected_deficit"),
    [
        (0, 0),  # empty bunk — no underfill (not a "used" bunk)
        (1, 9),  # 1 camper, preferred 10 → 9
        (8, 2),  # B5 regression case: feasible at hard minimum, deficit 2
        (9, 1),  # B5 regression case: 1 below preferred, deficit 1
        (10, 0),  # at preferred — no penalty
        (12, 0),  # full bunk — no penalty
    ],
)
def test_score_evaluator_charges_against_preferred(occupancy, expected_deficit):
    cfg = _Config(penalty=50)
    assert _score_evaluator_under_occupancy(occupancy, cfg) == expected_deficit * 50


# --- objective_evaluator -------------------------------------------------------


def _objective_evaluator_under_occupancy(occupancy: int, cfg: _Config) -> int:
    from bunking.solver.objective_evaluator import ObjectiveEvaluator

    bunk_to_persons = _make_bunk_to_persons(occupancy)
    bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

    with ConfigLoader.use(cfg):  # type: ignore[arg-type]
        evaluator = ObjectiveEvaluator(config=cfg)  # type: ignore[arg-type]
        return evaluator._calculate_occupancy_penalty(bunk_to_persons, bunk_by_cm_id)


@pytest.mark.parametrize(
    ("occupancy", "expected_deficit"),
    [
        (0, 0),
        (1, 9),
        (8, 2),
        (9, 1),
        (10, 0),
        (12, 0),
    ],
)
def test_objective_evaluator_charges_against_preferred(occupancy, expected_deficit):
    cfg = _Config(penalty=50)
    assert _objective_evaluator_under_occupancy(occupancy, cfg) == expected_deficit * 50


# --- The two evaluators must agree at every point ------------------------------


@pytest.mark.parametrize("occupancy", [0, 1, 5, 8, 9, 10, 11, 12])
def test_score_evaluator_matches_objective_evaluator(occupancy):
    cfg = _Config(penalty=50)
    assert _score_evaluator_under_occupancy(occupancy, cfg) == _objective_evaluator_under_occupancy(occupancy, cfg)

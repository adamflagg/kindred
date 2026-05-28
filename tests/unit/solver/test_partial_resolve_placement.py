"""Placement behaviour for partial cabin re-solve under hard cardinality.

Every working-set camper must be placed (``total == 1``). If no valid bunk
exists for a camper, the solver returns INFEASIBLE — never silently drops the
camper.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.bunking.solver.conftest import is_optimal_or_feasible
from tests.unit.solver.impossibility.conftest import make_bunk, make_input, make_person


class _PenaltyStubLoader:
    _values: ClassVar[dict[str, int]] = {
        "constraint.cabin_minimum_occupancy.penalty": 0,
        "constraint.grade_spread.penalty": 0,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


@pytest.fixture
def mock_config() -> Generator[Any]:
    cfg = MagicMock()

    def _get_constraint(constraint_type: str, param: str, default: Any = None) -> Any:
        if constraint_type == "grade_spread" and param == "max_spread":
            return 2
        return default if default is not None else 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = lambda key, default=None: default if default is not None else 0
    cfg.get_float.side_effect = lambda key, default=None: default if default is not None else 0.0
    cfg.get_str.side_effect = lambda key, default=None: "hard" if "grade_spread.mode" in key else (default or "")
    cfg.get_bool.side_effect = lambda key, default=None: default if default is not None else False
    cfg.get_soft_constraint_weight.side_effect = lambda name: 0

    with ConfigLoader.use(_PenaltyStubLoader()):  # type: ignore[arg-type]
        yield cfg


def _solve(solver: DirectBunkingSolver) -> tuple[cp_model.CpSolver, Any]:
    solver.check_feasibility()
    solver.add_constraints()
    solver.add_objective()
    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = 10
    return cp, cp.Solve(solver.model)


def _count_placed(solver: DirectBunkingSolver, cp: cp_model.CpSolver) -> int:
    placed = 0
    for pi in range(len(solver.person_ids)):
        if any(cp.Value(solver.assignments[(pi, bi)]) == 1 for bi in range(len(solver.bunks))):
            placed += 1
    return placed


def test_places_everyone_when_room_exists(mock_config):
    # 11 request-less campers; locked bunk 2001 (empty -> forbids everyone) + unlocked
    # bunk 2002 (cap 12). Hard cardinality == 1: every working camper must land somewhere.
    # All 11 fit in 2002; solver must place them all.
    persons = [make_person(1000 + i, gender="M", grade=5) for i in range(11)]
    locked = make_bunk(2001, gender="M")
    free = make_bunk(2002, gender="M")
    inp = make_input(persons, [locked, free], [])
    inp.locked_bunks = {2001: []}  # partial mode; 2001 frozen empty -> all go to 2002
    solver = DirectBunkingSolver(inp, mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert _count_placed(solver, cp) == 11  # nobody left unassigned when there's room


def test_single_working_bunk_gender_mismatch_is_infeasible(mock_config):
    """Under the new must-place rule, a boy in a session with only female bunks returns
    INFEASIBLE — the solver cannot silently leave him unassigned.

    Setup: lock G-1 (with its occupant), leaving G-2 (F) as the only working bunk.
    Working set = 1 unlocked F bunk + 1 boy. The boy must be placed; no valid (male)
    bunk exists; solve returns None.
    """
    locked_occupant = make_person(1000001, gender="F", grade=5)
    unplaceable_boy = make_person(1000002, gender="M", grade=5)
    locked_bunk = make_bunk(2000001, gender="F", name="G-1")
    free_bunk = make_bunk(2000002, gender="F", name="G-2")
    inp = make_input([locked_occupant, unplaceable_boy], [locked_bunk, free_bunk], [])
    inp.locked_bunks = {2000001: [1000001]}  # lock G-1 with its occupant -> working set = {G-2}

    output = DirectBunkingSolver(inp, mock_config).solve(time_limit_seconds=10)

    # Under the new rule the boy cannot be silently dropped — solver is INFEASIBLE.
    assert output is None

"""Placement bonus for partial cabin re-solve (#1609).

Verifies that in PARTIAL mode (locked_bunks non-empty), the solver places every
request-less camper that can physically fit rather than leaving them unassigned
under the relaxed ``<= 1`` cardinality introduced in Task 3.
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
    # bunk 2002 (cap 12). Partial mode (locked_bunks non-empty). With the relaxed <= 1
    # cardinality, the solver COULD leave campers unassigned at no objective cost; the
    # placement bonus must drive it to place all 11 (room exists in 2002).
    persons = [make_person(1000 + i, gender="M", grade=5) for i in range(11)]
    locked = make_bunk(2001, gender="M")
    free = make_bunk(2002, gender="M")
    inp = make_input(persons, [locked, free], [])
    inp.locked_bunks = {2001: []}  # partial mode; 2001 frozen empty -> all go to 2002
    solver = DirectBunkingSolver(inp, mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert _count_placed(solver, cp) == 11  # nobody left unassigned when there's room

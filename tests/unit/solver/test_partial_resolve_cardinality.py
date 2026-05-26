"""Cardinality relaxation for partial re-solve mode (#1609).

In partial mode (``locked_bunks`` is non-empty) the per-person cardinality
constraint is relaxed from ``== 1`` to ``<= 1``, so surplus campers can be
left unassigned when there is no room in the unlocked cabins.

In normal mode (``locked_bunks`` empty) the ``== 1`` constraint is unchanged
and the solver must assign everyone.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.bunking.solver.conftest import is_infeasible, is_optimal_or_feasible
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


def test_partial_mode_allows_unassigned_when_no_room(mock_config):
    # 2 campers, ONE unlocked male bunk capacity 1. locked_bunks is non-empty
    # (sentinel id 9999 — not a real bunk; its only role is to switch the solver
    # into PARTIAL mode). So the only question is: can a camper be left unassigned?
    # Partial mode relaxes cardinality to <= 1, so one camper is placed and one
    # is left unassigned -> FEASIBLE.
    persons = [make_person(1001, gender="M", grade=5), make_person(1002, gender="M", grade=5)]
    bunks = [make_bunk(2002, gender="M", capacity=1)]
    inp = make_input(persons, bunks, [])
    inp.locked_bunks = {9999: []}  # non-empty => partial mode
    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)  # feasible: surplus camper unassigned


def test_full_mode_still_requires_everyone_assigned(mock_config):
    # Same roster, NO locked_bunks => normal mode (== 1). 2 campers, one cap-1
    # bunk -> everyone must be placed but there's no room -> INFEASIBLE.
    persons = [make_person(1001, gender="M", grade=5), make_person(1002, gender="M", grade=5)]
    bunks = [make_bunk(2002, gender="M", capacity=1)]
    inp = make_input(persons, bunks, [])
    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)
    assert is_infeasible(status)

"""Cardinality invariant: the solver always requires every working-set camper to be placed.

The ``allow_unassigned`` field has been removed; the per-person cardinality
constraint is unconditionally ``== 1``. A roster that exceeds available capacity
returns INFEASIBLE so staff see the diagnostics modal.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.bunking.solver.conftest import is_infeasible
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


def test_solver_requires_everyone_assigned(mock_config):
    # 2 campers, ONE male bunk with capacity 1 → everyone must be placed but there's
    # no room → INFEASIBLE. The solver never silently drops a camper.
    persons = [make_person(1000001, gender="M", grade=5), make_person(1000002, gender="M", grade=5)]
    bunks = [make_bunk(2000002, gender="M", capacity=1)]
    inp = make_input(persons, bunks, [])
    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)
    assert is_infeasible(status)


def test_single_bunk_over_capacity_returns_none(mock_config):
    # Single-bunk shortcut (the ``len(self.bunks) == 1`` path in solve()):
    # Stream C now always allows up to 13 (DEFAULT_BUNK_CAPACITY + 1). So 14+
    # campers in a single 12-cap bunk is what now triggers INFEASIBLE.
    persons = [make_person(1000000 + i, gender="F", grade=5) for i in range(1, 15)]
    bunks = [make_bunk(2000001, gender="F", capacity=12)]
    inp = make_input(persons, bunks, [])
    solver = DirectBunkingSolver(inp, mock_config)
    assert solver.solve() is None


def test_single_bunk_over_capacity_clamps_to_default(mock_config):
    # Raw bunk.capacity > DEFAULT_BUNK_CAPACITY is clamped to the standard
    # (mirroring cabin_capacity.py); Stream C raises the effective cap by 1
    # because overflow is always available, so 14+ campers → INFEASIBLE.
    persons = [make_person(1000000 + i, gender="F", grade=5) for i in range(1, 15)]
    bunks = [make_bunk(2000001, gender="F", capacity=15)]
    inp = make_input(persons, bunks, [])
    solver = DirectBunkingSolver(inp, mock_config)
    assert solver.solve() is None


def test_single_bunk_at_overflow_capacity_succeeds(mock_config):
    # allow_overflow=True raises effective_cap to DEFAULT_BUNK_CAPACITY+1 = 13.
    # 13 campers must now fit in a single 12-cap bunk and solve() returns a result.
    persons = [make_person(1000000 + i, gender="F", grade=5) for i in range(1, 14)]
    bunks = [make_bunk(2000001, gender="F", capacity=12)]
    inp = make_input(persons, bunks, [])
    inp.allow_overflow = True
    solver = DirectBunkingSolver(inp, mock_config)
    output = solver.solve()
    assert output is not None
    assert len(output.assignments) == 13

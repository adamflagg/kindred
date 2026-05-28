"""Overflow-aware post-solve capacity check.

With allow_overflow=True, a bunk that the solver fills to 13 (one above
DEFAULT_BUNK_CAPACITY=12) should NOT produce a cabin_capacity error violation
in _check_constraint_violations.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunkAssignment
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.bunking.solver.conftest import is_optimal_or_feasible
from tests.unit.solver.impossibility.conftest import make_bunk, make_input, make_person


class _ZeroPenaltyLoader:
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

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        yield cfg


def _solve(solver: DirectBunkingSolver) -> tuple[cp_model.CpSolver, Any]:
    solver.check_feasibility()
    solver.add_constraints()
    solver.add_objective()
    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = 10
    return cp, cp.Solve(solver.model)


def test_overflow_bunk_no_cabin_capacity_violation(mock_config: Any) -> None:
    """allow_overflow=True filling a bunk to 13.

    Setup:
      - one bunk (3000001), 13 female campers, capacity=12.
      - allow_overflow=True → solver can fill to 13.

    The post-solve violation check should NOT flag the bunk at 13/12 as an
    "error" severity cabin_capacity violation when overflow is active.
    """
    # 13 campers — will all go to the single bunk (overflow fills it to 13)
    persons = [make_person(1000000 + i, gender="F", grade=5) for i in range(1, 14)]
    bunk = make_bunk(3000001, gender="F")  # capacity=12 by default

    inp = make_input(persons, [bunk], [])
    inp.allow_overflow = True

    solver = DirectBunkingSolver(inp, mock_config)
    cp, status = _solve(solver)

    assert is_optimal_or_feasible(status), f"Expected FEASIBLE but got {status}"

    # Extract assignments from the cp solution (mirrors what DirectBunkingSolver.solve() does)
    assignments = []
    for person_idx, person_cm_id in enumerate(solver.person_ids):
        for bunk_idx, bunk_obj in enumerate(solver.bunks):
            if cp.Value(solver.assignments[(person_idx, bunk_idx)]) == 1:
                person = solver.input.person_by_cm_id[person_cm_id]
                assignments.append(
                    DirectBunkAssignment(
                        person_cm_id=person_cm_id,
                        session_cm_id=person.session_cm_id,
                        bunk_cm_id=bunk_obj.campminder_id,
                        year=2026,
                    )
                )
                break

    # Directly invoke the post-solve violation check
    solver._check_constraint_violations(assignments, cp)

    # Verify bunk at 13 does NOT produce a cabin_capacity error violation in overflow mode
    cabin_cap_violations = solver.constraint_logger.violations.get("cabin_capacity", [])
    error_violations = [v for v in cabin_cap_violations if v.get("severity") == "error"]

    assert not error_violations, (
        f"Expected no cabin_capacity error violations in overflow mode, "
        f"but got: {error_violations}. "
        "The post-solve check should use effective cap (13) not bunk.capacity (12) "
        "when allow_overflow=True."
    )

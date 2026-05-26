"""Fix #4 — overflow-aware post-solve capacity check (#1609).

In a partial re-solve with allow_overflow=True, an unlocked bunk that the solver
fills to 13 (one above DEFAULT_BUNK_CAPACITY=12) should NOT produce a
cabin_capacity error violation in _check_constraint_violations.

TDD: test written BEFORE the fix and verified RED.
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
    """Partial re-solve with allow_overflow=True filling an unlocked bunk to 13.

    Setup:
      - locked_bunk (3001): 8 persons pinned → at exactly MIN_BUNK_OCCUPANCY,
        so the old min-occupancy hard floor would NOT trigger INFEASIBLE even
        pre-Fix-#1 (it was passing the hard floor). Frozen in place.
      - free_bunk (3002): 13 free campers, capacity=12, allow_overflow=True
        → solver can fill to 13 (cap is 12+1=13 in overflow mode).

    Without the fix:
      _check_constraint_violations flags free_bunk at 13/12 as an "error"
      severity cabin_capacity violation.

    After the fix:
      No cabin_capacity error violation is recorded.

    Note: once Fix #1 (min-occupancy exemption) is applied this test also
    confirms the post-solve check passes for the overflow bunk.
    """
    # 8 persons pinned in locked bunk — exactly at MIN_BUNK_OCCUPANCY
    locked_persons = [make_person(1000 + i, gender="F", grade=5) for i in range(8)]
    # 13 free campers — will all go to the unlocked bunk (overflow fills it to 13)
    free_persons = [make_person(2000 + i, gender="F", grade=5) for i in range(13)]

    locked_bunk = make_bunk(3001, gender="F")
    free_bunk = make_bunk(3002, gender="F")  # capacity=12 by default

    all_persons = locked_persons + free_persons
    inp = make_input(all_persons, [locked_bunk, free_bunk], [])
    inp.locked_bunks = {3001: [p.campminder_person_id for p in locked_persons]}
    inp.allow_overflow = True

    solver = DirectBunkingSolver(inp, mock_config)
    cp, status = _solve(solver)

    assert is_optimal_or_feasible(status), f"Expected FEASIBLE but got {status}"

    # Extract assignments from the cp solution (mirrors what DirectBunkingSolver.solve() does)
    assignments = []
    for person_idx, person_cm_id in enumerate(solver.person_ids):
        for bunk_idx, bunk in enumerate(solver.bunks):
            if cp.Value(solver.assignments[(person_idx, bunk_idx)]) == 1:
                person = solver.input.person_by_cm_id[person_cm_id]
                assignments.append(
                    DirectBunkAssignment(
                        person_cm_id=person_cm_id,
                        session_cm_id=person.session_cm_id,
                        bunk_cm_id=bunk.campminder_id,
                        year=2026,
                    )
                )
                break

    # Directly invoke the post-solve violation check
    solver._check_constraint_violations(assignments, cp)

    # Verify the unlocked bunk at 13 does NOT produce a cabin_capacity error violation
    cabin_cap_violations = solver.constraint_logger.violations.get("cabin_capacity", [])
    error_violations = [v for v in cabin_cap_violations if v.get("severity") == "error"]

    assert not error_violations, (
        f"Expected no cabin_capacity error violations in overflow mode, "
        f"but got: {error_violations}. "
        "The post-solve check should use effective cap (13) not bunk.capacity (12) "
        "when locked_bunks is non-empty and allow_overflow=True."
    )

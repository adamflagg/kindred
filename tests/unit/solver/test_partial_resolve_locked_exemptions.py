"""Locked-bunk exemptions for hard composition constraints (#1609).

Verifies that locked bunks are exempt from hard per-bunk composition
constraints (minimum occupancy, grade spread, grade adjacency). A locked
bunk's roster is FROZEN by add_locked_bunk_constraints — any additional hard
composition constraint applied to it can only create infeasibility, never
improve the solution.

TDD: all tests written BEFORE the fix and verified RED.
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


class _ZeroPenaltyLoader:
    """Stub ConfigLoader that zeros all penalties and sets grade_spread max_spread=2."""

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


# ---------------------------------------------------------------------------
# Fix #1a — minimum occupancy: locked under-filled bunk must not go INFEASIBLE
# ---------------------------------------------------------------------------


def test_locked_underfilled_bunk_is_feasible(mock_config: Any) -> None:
    """Lock a bunk with fewer than MIN_BUNK_OCCUPANCY campers.

    Without the fix, add_cabin_minimum_occupancy_constraints forces
    is_used=1 → occupancy >= MIN_BUNK_OCCUPANCY (8) for all non-AG bunks,
    which contradicts the pinned occupancy of 4 → INFEASIBLE.

    After the fix, the locked bunk is skipped and the model is FEASIBLE.
    """
    # Locked bunk gets exactly 4 campers pinned (< MIN_BUNK_OCCUPANCY = 8)
    locked_occupants = [make_person(1000 + i, gender="F", grade=5) for i in range(4)]
    # Provide enough unlocked campers to satisfy minimum occupancy on two free bunks
    free_campers = [make_person(2000 + i, gender="F", grade=5) for i in range(16)]

    locked_bunk = make_bunk(3001, gender="F")
    free_bunk_a = make_bunk(3002, gender="F")
    free_bunk_b = make_bunk(3003, gender="F")

    all_persons = locked_occupants + free_campers
    inp = make_input(all_persons, [locked_bunk, free_bunk_a, free_bunk_b], [])
    inp.locked_bunks = {3001: [p.campminder_person_id for p in locked_occupants]}

    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)

    assert is_optimal_or_feasible(status), (
        f"Expected FEASIBLE but got {status}. "
        "Locked bunk with {len(locked_occupants)} occupants (< MIN_BUNK_OCCUPANCY={MIN_BUNK_OCCUPANCY}) "
        "should be exempt from the minimum occupancy hard constraint."
    )


# ---------------------------------------------------------------------------
# Fix #1b — grade_spread: locked bunk with 3 unique grades must not go INFEASIBLE
# ---------------------------------------------------------------------------


def test_locked_three_grade_bunk_grade_spread_feasible(mock_config: Any) -> None:
    """Lock a bunk with campers from 3 unique grades (grade_spread max=2).

    Without the fix, add_grade_spread_constraints enforces <=2 unique grades
    per bunk — a locked roster with grades 4, 5, 6 contradicts this → INFEASIBLE.

    After the fix, the locked bunk is skipped and the model is FEASIBLE.
    """
    # Locked bunk: 3 campers across 3 grades (4, 5, 6) — exceeds MAX_UNIQUE_GRADES_PER_BUNK=2
    locked_occupants = [
        make_person(1001, gender="F", grade=4),
        make_person(1002, gender="F", grade=5),
        make_person(1003, gender="F", grade=6),
    ]
    # Provide enough free campers (all grade 5) to fill the two unlocked bunks
    free_campers = [make_person(2000 + i, gender="F", grade=5) for i in range(16)]

    locked_bunk = make_bunk(3001, gender="F")
    free_bunk_a = make_bunk(3002, gender="F")
    free_bunk_b = make_bunk(3003, gender="F")

    all_persons = locked_occupants + free_campers
    inp = make_input(all_persons, [locked_bunk, free_bunk_a, free_bunk_b], [])
    inp.locked_bunks = {3001: [p.campminder_person_id for p in locked_occupants]}

    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)

    assert is_optimal_or_feasible(status), (
        f"Expected FEASIBLE but got {status}. "
        "Locked bunk with grades [4,5,6] should be exempt from grade_spread hard constraint (max=2)."
    )


# ---------------------------------------------------------------------------
# Fix #1c — grade_adjacency: locked bunk with non-adjacent grades must not go INFEASIBLE
# ---------------------------------------------------------------------------


def test_locked_non_adjacent_grades_feasible(mock_config: Any) -> None:
    """Lock a bunk with grades 4 and 6 (non-adjacent — gap=2).

    Without the fix, add_grade_adjacency_constraints forbids both grade 4 and
    grade 6 from co-occupying a bunk → INFEASIBLE for the locked roster.

    After the fix, the locked bunk is skipped and the model is FEASIBLE.
    """
    # Locked bunk: grades 4 and 6 (non-adjacent)
    locked_occupants = [
        make_person(1001, gender="F", grade=4),
        make_person(1002, gender="F", grade=4),
        make_person(1003, gender="F", grade=6),
        make_person(1004, gender="F", grade=6),
    ]
    # Provide enough free campers (all grade 5) to fill the two unlocked bunks
    free_campers = [make_person(2000 + i, gender="F", grade=5) for i in range(16)]

    locked_bunk = make_bunk(3001, gender="F")
    free_bunk_a = make_bunk(3002, gender="F")
    free_bunk_b = make_bunk(3003, gender="F")

    all_persons = locked_occupants + free_campers
    inp = make_input(all_persons, [locked_bunk, free_bunk_a, free_bunk_b], [])
    inp.locked_bunks = {3001: [p.campminder_person_id for p in locked_occupants]}

    solver = DirectBunkingSolver(inp, mock_config)
    _cp, status = _solve(solver)

    assert is_optimal_or_feasible(status), (
        f"Expected FEASIBLE but got {status}. "
        "Locked bunk with non-adjacent grades [4,6] should be exempt from grade_adjacency constraint."
    )

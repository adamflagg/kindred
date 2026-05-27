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


def test_single_working_bunk_still_respects_gender(mock_config):
    """#1609 regression: a partial re-solve that locks all but one cabin reduces the
    WORKING set to a single bunk, taking the simplified single-bunk path. That path
    must still honour the gender hard constraint — a wrong-gender unplaced camper must
    be left unassigned, never crammed into the only (opposite-gender) unlocked cabin.
    """
    # Full session: two female cabins. Lock G-1 (with its occupant) so the working set
    # collapses to the single unlocked female cabin G-2.
    locked_occupant = make_person(1000001, gender="F", grade=5)
    unplaced_boy = make_person(1000002, gender="M", grade=5)
    locked_bunk = make_bunk(2000001, gender="F", name="G-1")
    free_bunk = make_bunk(2000002, gender="F", name="G-2")
    inp = make_input([locked_occupant, unplaced_boy], [locked_bunk, free_bunk], [])
    inp.allow_unassigned = True
    inp.locked_bunks = {2000001: [1000001]}  # lock G-1 with its occupant -> working set = {G-2}

    output = DirectBunkingSolver(inp, mock_config).solve(time_limit_seconds=10)

    assert output is not None
    placements = {(a.person_cm_id, a.bunk_cm_id) for a in output.assignments}
    # Frozen occupant keeps her locked cabin.
    assert (1000001, 2000001) in placements
    # The boy has no valid (male) cabin and must stay unassigned — never placed in G-2.
    assert (1000002, 2000002) not in placements
    assert all(a.person_cm_id != 1000002 for a in output.assignments)

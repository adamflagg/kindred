"""Full-solver wiring for hard staff separation (#1541).

Constructs a real DirectBunkingSolver (mock ConfigLoader, no DB) and solves with
cp_model to confirm the staff_separation module is invoked by add_constraints and
behaves end-to-end. The fixture has 16 same-gender campers across 2 bunks: the
hard minimum-occupancy floor (8/bunk) forces an 8/8 split, so separating one pair
(or keeping it together) is genuinely feasible.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectPerson
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.bunking.solver.conftest import is_optimal_or_feasible
from tests.unit.solver.impossibility.conftest import make_bunk, make_input, make_person, make_request


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


def _roster() -> tuple[list[DirectPerson], list[DirectBunk]]:
    # Emma=100, Liam=200, plus 14 filler girls → 16 campers, 2 F bunks (cap 12).
    # min-occupancy 8/bunk forces an 8/8 split.
    persons = [make_person(100, gender="F", grade=6), make_person(200, gender="F", grade=6)]
    persons += [make_person(1000 + i, gender="F", grade=6) for i in range(14)]
    bunks = [make_bunk(2001, gender="F"), make_bunk(2002, gender="F")]
    return persons, bunks


def _solve(solver: DirectBunkingSolver) -> tuple[cp_model.CpSolver, Any]:
    solver.check_feasibility()
    solver.add_constraints()
    solver.add_objective()
    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = 10
    return cp, cp.Solve(solver.model)


def _bunk_idx(solver: DirectBunkingSolver, cp: cp_model.CpSolver, cm_id: int) -> int:
    return int(cp.Value(solver.person_bunk_assignment[solver.person_idx_map[cm_id]]))


def test_solver_enforces_staff_nbw_separation(mock_config):
    persons, bunks = _roster()
    reqs = [
        make_request(
            "n1", requester=100, requestee=200, request_type="not_bunk_with", source_field="staff_not_bunk_with"
        )
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert _bunk_idx(solver, cp, 100) != _bunk_idx(solver, cp, 200)
    assert solver.staff_nbw_yields == []


def test_solver_carveout_places_together_and_records_yield(mock_config):
    persons, bunks = _roster()
    reqs = [
        make_request(
            "n1", requester=100, requestee=200, request_type="not_bunk_with", source_field="staff_not_bunk_with"
        ),
        make_request("p1", requester=200, requestee=100, request_type="bunk_with", source_field="bunk_request_form"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert _bunk_idx(solver, cp, 100) == _bunk_idx(solver, cp, 200)  # parent paramount forces sole MP wish
    assert len(solver.staff_nbw_yields) == 1
    assert solver.staff_nbw_yields[0]["nbw_request_id"] == "n1"


def test_yield_surfaced_in_request_validation_stats(mock_config):
    persons, bunks = _roster()
    reqs = [
        make_request(
            "n1", requester=100, requestee=200, request_type="not_bunk_with", source_field="staff_not_bunk_with"
        ),
        make_request("p1", requester=200, requestee=100, request_type="bunk_with", source_field="bunk_request_form"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    output = solver.solve(time_limit_seconds=10)
    assert output is not None
    rv = output.stats["request_validation"]
    assert rv["staff_nbw_yielded_count"] == 1
    assert rv["staff_nbw_yielded"][0]["nbw_request_id"] == "n1"


def test_find_infeasibility_cause_isolates_staff_separation(mock_config):
    from bunking.solver.feasibility import find_infeasibility_cause

    # 8 girls fit one cabin (min-occupancy 8 is satisfied). A staff NBW between
    # two of them then demands a separation with no second cabin → the staff
    # constraint is the SOLE cause; disabling it restores feasibility.
    persons = [make_person(100, gender="F", grade=6), make_person(200, gender="F", grade=6)]
    persons += [make_person(1000 + i, gender="F", grade=6) for i in range(6)]
    bunks = [make_bunk(2001, gender="F")]  # single cabin, capacity 12
    reqs = [
        make_request(
            "n1", requester=100, requestee=200, request_type="not_bunk_with", source_field="staff_not_bunk_with"
        )
    ]
    cause = find_infeasibility_cause(make_input(persons, bunks, reqs), mock_config, time_limit_seconds=5)
    assert "staff_separation" in cause

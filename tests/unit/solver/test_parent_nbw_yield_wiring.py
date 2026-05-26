"""Full-solver wiring for the parent-paramount NBW carve-out (#1638 Stream C).

Constructs a real DirectBunkingSolver (mock ConfigLoader, no DB) and solves with
cp_model to confirm that when a parent-form ``not_bunk_with`` is a camper's SOLE
Material-Parent request and directly opposes another camper's sole-MP parent
``bunk_with``, the positive request wins: the pair is co-placed, the NBW yields,
and the yield is recorded + surfaced. The fixture has 16 same-gender campers
across 2 bunks: the hard minimum-occupancy floor (8/bunk) forces an 8/8 split,
so co-placing one pair (or separating it) is genuinely feasible.
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


def test_clean_solve_exposes_empty_parent_nbw_yielded(mock_config):
    persons, bunks = _roster()
    reqs = [
        make_request("p1", requester=100, requestee=200, request_type="bunk_with", source_field="bunk_request_form"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    output = solver.solve(time_limit_seconds=10)
    assert output is not None
    rv = output.stats["request_validation"]
    assert rv["parent_nbw_yielded_count"] == 0
    assert rv["parent_nbw_yielded"] == []
    assert solver.parent_nbw_yields == []


def test_carveout_places_together_and_records_yield(mock_config):
    # Emma's parent: bunk_with Liam (Emma's only MP). Liam's parent: NOT bunk_with
    # Emma (Liam's only MP). Positive wins -> together, Liam's NBW recorded.
    persons, bunks = _roster()
    reqs = [
        make_request("p1", requester=100, requestee=200, request_type="bunk_with", source_field="bunk_request_form"),
        make_request(
            "n1", requester=200, requestee=100, request_type="not_bunk_with", source_field="bunk_request_form"
        ),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert _bunk_idx(solver, cp, 100) == _bunk_idx(solver, cp, 200)  # together
    assert len(solver.parent_nbw_yields) == 1
    y = solver.parent_nbw_yields[0]
    assert y["nbw_request_id"] == "n1"
    assert y["subject_cm"] == 200  # the yielding (NBW) camper
    assert y["target_cm"] == 100
    assert y["protected_parent_request_id"] == "p1"
    assert y["protected_camper_cm"] == 100  # the bunk_with requester


def test_no_yield_when_nbw_camper_has_a_second_mp(mock_config):
    # Liam has NBW Emma AND bunk_with a filler -> his MSO is satisfiable elsewhere,
    # so the NBW is never the sole forcing var: no carve-out, no recorded yield.
    persons, bunks = _roster()
    reqs = [
        make_request("p1", requester=100, requestee=200, request_type="bunk_with", source_field="bunk_request_form"),
        make_request(
            "n1", requester=200, requestee=100, request_type="not_bunk_with", source_field="bunk_request_form"
        ),
        make_request("p2", requester=200, requestee=1000, request_type="bunk_with", source_field="bunk_request_form"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert solver.parent_nbw_yields == []


def test_no_yield_when_positive_camper_has_a_second_mp(mock_config):
    # Emma has bunk_with Liam AND bunk_with a filler -> Emma's MSO is satisfiable
    # without Liam, so Liam's sole-MP NBW holds: pair apart, no yield.
    persons, bunks = _roster()
    reqs = [
        make_request("p1", requester=100, requestee=200, request_type="bunk_with", source_field="bunk_request_form"),
        make_request("p2", requester=100, requestee=1000, request_type="bunk_with", source_field="bunk_request_form"),
        make_request(
            "n1", requester=200, requestee=100, request_type="not_bunk_with", source_field="bunk_request_form"
        ),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, reqs), mock_config)
    cp, status = _solve(solver)
    assert is_optimal_or_feasible(status)
    assert solver.parent_nbw_yields == []
    assert _bunk_idx(solver, cp, 100) != _bunk_idx(solver, cp, 200)  # NBW honored

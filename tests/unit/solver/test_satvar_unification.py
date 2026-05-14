"""Full-solver tests for #1395 sat-var unification.

Asserts that bunk_with / not_bunk_with satisfaction vars are built once and
shared between parent_paramount (hard MP constraint) and add_objective via
the canonical `solver.request_satisfied_vars` map.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
)


@pytest.fixture
def mock_config() -> Any:
    """ConfigLoader mock that forwards every typed getter to its `default=`.

    Mirrors the proven fixture in tests/integration/solver/
    test_taste_of_camp_feasible.py so add_constraints() + add_objective()
    run cleanly without a real ConfigLoader.
    """
    # Forward-declared here; consumed by the add_constraints()/add_objective()
    # tests added in later tasks of this plan.
    cfg = MagicMock()

    def _get_constraint(constraint_type: str, param: str, default: Any = None) -> Any:
        if constraint_type == "grade_spread" and param == "max_spread":
            return 2
        return default if default is not None else 0

    def _get_int(key: str, default: Any = None) -> Any:
        return default if default is not None else 0

    def _get_float(key: str, default: Any = None) -> Any:
        return default if default is not None else 0.0

    def _get_str(key: str, default: Any = None) -> Any:
        if "grade_spread.mode" in key:
            return "hard"
        return default if default is not None else ""

    def _get_bool(key: str, default: Any = None) -> Any:
        return default if default is not None else False

    def _get_priority(priority_type: str, subtype: str = "default") -> int:
        return 4

    def _get_soft_constraint_weight(constraint_name: str) -> int:
        return 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = _get_int
    cfg.get_float.side_effect = _get_float
    cfg.get_str.side_effect = _get_str
    cfg.get_bool.side_effect = _get_bool
    cfg.get_priority.side_effect = _get_priority
    cfg.get_soft_constraint_weight.side_effect = _get_soft_constraint_weight
    return cfg


def test_solver_exposes_shared_request_satisfied_vars_map() -> None:
    """DirectBunkingSolver owns a request_satisfied_vars dict, threaded
    by-reference into every SolverContext it builds."""
    persons = [make_person(1, session=1000, gender="F"), make_person(2, session=1000, gender="F")]
    bunks = [make_bunk(100, session=1000, gender="F")]
    solver = DirectBunkingSolver(make_input(persons, bunks, []), config_service=MagicMock())

    assert solver.request_satisfied_vars == {}
    ctx = solver._build_solver_context()
    assert ctx.request_satisfied_vars is solver.request_satisfied_vars

"""Full-solver tests for #1395 sat-var unification.

Asserts that bunk_with / not_bunk_with satisfaction vars are built once and
shared between parent_paramount (hard MP constraint) and add_objective via
the canonical `solver.request_satisfied_vars` map.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)

# ---------------------------------------------------------------------------
# Minimal stub loader for penalty accessors that call ConfigLoader.get_instance()
# directly (e.g. penalties.py::min_occupancy_penalty).
# ---------------------------------------------------------------------------


class _PenaltyStubLoader:
    """Provides only the keys that penalties.py / grade_spread.py read via
    ConfigLoader.get_instance(), returning sensible zero/stub values."""

    # Extend when penalty helpers start reading new key types (get_str/get_constraint)
    # via ConfigLoader.get_instance().
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
    """ConfigLoader mock that forwards every typed getter to its `default=`.

    Also installs a _PenaltyStubLoader via ConfigLoader.use() so that
    penalty helpers (penalties.py) that call ConfigLoader.get_instance()
    directly work without a real PocketBase connection.

    Mirrors the proven fixture in tests/integration/solver/
    test_taste_of_camp_feasible.py so add_constraints() + add_objective()
    run cleanly without a real ConfigLoader.
    """
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

    with ConfigLoader.use(_PenaltyStubLoader()):  # type: ignore[arg-type]
        yield cfg


def test_solver_exposes_shared_request_satisfied_vars_map() -> None:
    """DirectBunkingSolver owns a request_satisfied_vars dict, threaded
    by-reference into every SolverContext it builds."""
    persons = [make_person(1, session=1000, gender="F"), make_person(2, session=1000, gender="F")]
    bunks = [make_bunk(100, session=1000, gender="F")]
    solver = DirectBunkingSolver(make_input(persons, bunks, []), config_service=MagicMock())

    assert solver.request_satisfied_vars == {}
    ctx = solver._build_solver_context()
    assert ctx.request_satisfied_vars is solver.request_satisfied_vars


def test_objective_registers_bunk_request_in_shared_map(mock_config: Any) -> None:
    """add_objective routes bunk requests through the shared sat-var map.

    Uses a non-MP bunk_with request (source_field=bunking_notes -> STAFF
    bucket) so parent_paramount skips it -- only add_objective can put it
    in the map.
    """
    persons = [make_person(1, session=1000, gender="F"), make_person(2, session=1000, gender="F")]
    bunks = [make_bunk(100, session=1000, gender="F"), make_bunk(200, session=1000, gender="F")]
    req = make_request("nr1", requester=1, requestee=2, request_type="bunk_with", source_field="bunking_notes")
    solver = DirectBunkingSolver(make_input(persons, bunks, [req]), config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    assert "nr1" in solver.request_satisfied_vars


def test_mp_objective_request_has_single_sat_var(mock_config: Any) -> None:
    """An MP bunk request that is also objective-relevant gets exactly ONE
    sat var, shared between parent_paramount and add_objective.

    Proves both halves of the shared-var property:
    - parent_paramount builds the var during add_constraints() (in the map).
    - add_objective reuses it rather than building a duplicate (proto count 1).
    """
    persons = [make_person(1, session=1000, gender="F"), make_person(2, session=1000, gender="F")]
    bunks = [make_bunk(100, session=1000, gender="F"), make_bunk(200, session=1000, gender="F")]
    req = make_request("mr1", requester=1, requestee=2, request_type="bunk_with", source_field="bunk_with")
    solver = DirectBunkingSolver(make_input(persons, bunks, [req]), config_service=mock_config)

    solver.add_constraints()
    # parent_paramount must have built the MP bunk_with sat var already.
    assert "mr1" in solver.request_satisfied_vars

    solver.add_objective()

    var_names = [v.name for v in solver.model.Proto().variables]
    assert var_names.count("req_satisfied_mr1") == 1, (
        "MP objective request must have one shared sat var, not a parent_paramount copy plus an add_objective copy"
    )

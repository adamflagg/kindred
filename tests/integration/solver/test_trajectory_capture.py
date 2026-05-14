"""Integration tests for Tier 2 trajectory capture (Stream 2, Phase 2).

Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver


class _PenaltyStubLoader:
    """Provides the keys that penalties.py reads via ConfigLoader.get_instance().

    Mirrors the stub in tests/unit/solver/test_satvar_unification.py — the
    pattern is established there and must stay in sync with it.
    """

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
def mock_config() -> MagicMock:
    """ConfigLoader mock returning typed defaults.

    Returns the mock config object directly (no `yield`). The companion
    `ConfigLoader.use(_PenaltyStubLoader())` context — needed so `penalties.py`
    helpers that call `ConfigLoader.get_instance()` directly do not require a
    real PocketBase — is installed inline in the test body, not in this
    fixture. The side-effect stubs mirror the proven config mocks in
    tests/integration/solver/test_taste_of_camp_feasible.py and
    tests/unit/solver/test_satvar_unification.py.
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

    def _get_priority(_priority_type: str, _subtype: str = "default") -> int:
        return 4

    def _get_soft_constraint_weight(_constraint_name: str) -> int:
        return 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = _get_int
    cfg.get_float.side_effect = _get_float
    cfg.get_str.side_effect = _get_str
    cfg.get_bool.side_effect = _get_bool
    cfg.get_priority.side_effect = _get_priority
    cfg.get_soft_constraint_weight.side_effect = _get_soft_constraint_weight
    return cfg


def _two_bunk_input() -> DirectSolverInput:
    """2 same-gender bunks, 10 same-session same-gender campers, no requests.

    Trivially feasible: solver must place 10 campers across 2 bunks of
    capacity 12 with only hard constraints active.  No requests means there
    is exactly one solution family (any split satisfies all constraints), so
    the solver finds the first solution quickly and `objective_trajectory`
    will be non-empty.
    """
    bunks = [
        DirectBunk(
            id=f"bunk-{i}",
            campminder_id=9000 + i,
            name=f"Cabin-{i}",
            capacity=12,
            gender="M",
            session_cm_id=1000001,
        )
        for i in range(2)
    ]
    persons = [
        DirectPerson(
            campminder_person_id=2000 + i,
            first_name=f"Camper{i}",
            last_name="Test",
            grade=8,
            birthdate="2014-01-01",
            gender="M",
            session_cm_id=1000001,
        )
        for i in range(10)
    ]
    return DirectSolverInput(persons=persons, requests=[], bunks=bunks)


def test_multibunk_solve_populates_tier2_stats(mock_config: MagicMock) -> None:
    with ConfigLoader.use(_PenaltyStubLoader()):  # type: ignore[arg-type]
        solver = DirectBunkingSolver(input_data=_two_bunk_input(), config_service=mock_config)
        result = solver.solve(time_limit_seconds=5)
    assert result is not None
    stats = result.stats
    # The multi-bunk solve path wires both capture surfaces.
    assert isinstance(stats["objective_trajectory"], list)
    assert isinstance(stats["bound_trajectory"], list)
    assert len(stats["objective_trajectory"]) >= 1, "a feasible solve yields >=1 solution callback"
    assert stats["bound_trajectory_truncated"] is False
    # presolve compression is computed from a real model
    assert stats["presolve_booleans_pre"] > 0
    assert isinstance(stats["presolve_compression_ratio"], float)

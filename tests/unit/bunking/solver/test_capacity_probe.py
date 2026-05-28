"""Unit tests for the capacity probe (Stream C).

probe_capacity_relaxation_feasible(input, config, time_limit_seconds) -> bool
returns True iff solving the same input with allow_overflow=True is feasible.
This is the gate that decides whether the smart orchestrator auto-runs pass 2.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from bunking.solver.direct_solver import probe_capacity_relaxation_feasible

from .conftest import FICTIONAL_CAMPER_NAMES, build_direct_solver_input, create_bunk, create_person


class _PenaltyStubLoader:
    """Match the stub pattern used by tests/unit/solver/test_partial_resolve_placement.py.

    Code paths that call ConfigLoader.get_instance() directly bypass the
    config passed to DirectBunkingSolver; ConfigLoader.use(stub) swaps the
    singleton so those paths see consistent zeros.
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
def mock_config() -> Generator[Any]:
    """Minimal stub config — mirrors test_partial_resolve_placement.py exactly,
    including the ConfigLoader.use() context manager to override the singleton."""
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


class TestCapacityProbe:
    def test_overflow_fixable_returns_true(self, mock_config):
        """13 M campers, 1 M bunk + 1 F bunk → strict 12-cap is INFEASIBLE
        (gender forces all to B-1), but allow_overflow=True is feasible."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(13)
        ]
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        input_data = build_direct_solver_input(persons=campers, bunks=bunks)

        assert probe_capacity_relaxation_feasible(input_data, mock_config, time_limit_seconds=5) is True

    def test_overflow_doesnt_help_returns_false(self, mock_config):
        """14 M campers, 1 M bunk → INFEASIBLE even at 13-cap (14 > 13)."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(14)
        ]
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)]
        input_data = build_direct_solver_input(persons=campers, bunks=bunks)

        assert probe_capacity_relaxation_feasible(input_data, mock_config, time_limit_seconds=5) is False

    def test_12_cap_already_feasible_returns_true(self, mock_config):
        """12 M campers, 1 M bunk → trivially feasible at 12 AND 13."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(12)
        ]
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)]
        input_data = build_direct_solver_input(persons=campers, bunks=bunks)

        assert probe_capacity_relaxation_feasible(input_data, mock_config, time_limit_seconds=5) is True

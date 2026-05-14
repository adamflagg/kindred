"""Shared fixtures for tests/integration/solver/.

`mock_config` mirrors the proven fixture in
tests/unit/solver/test_satvar_unification.py: a MagicMock ConfigLoader that
forwards every typed getter to its `default=`, plus a _PenaltyStubLoader
installed via ConfigLoader.use() so penalty helpers in penalties.py that call
ConfigLoader.get_instance() directly work without a real PocketBase
connection.

Lives in this conftest so future integration tests under
tests/integration/solver/ can opt in; test_satvar_predicate_alignment.py is
the current consumer. The sibling test_taste_of_camp_feasible.py keeps its own
variant — it runs the full solve()+scoring path and injects the mock itself as
the ConfigLoader singleton, which the shallow _PenaltyStubLoader here does not
cover.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader


class _PenaltyStubLoader:
    """Provides only the keys that penalties.py reads via
    ConfigLoader.get_instance(), returning sensible zero/stub values."""

    # Extend when penalty helpers start reading new key types via
    # ConfigLoader.get_instance().
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

    Also installs a _PenaltyStubLoader via ConfigLoader.use() so that penalty
    helpers (penalties.py) that call ConfigLoader.get_instance() directly work
    without a real ConfigLoader. With get_soft_constraint_weight pinned to 0,
    soft penalties are inert and the solver only enforces hard constraints
    (assignment, capacity, min-occupancy, grade_spread, grade_adjacency,
    session_boundary, gender, parent_paramount).
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

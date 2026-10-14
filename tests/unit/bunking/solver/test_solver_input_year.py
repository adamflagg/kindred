"""The solver stamps assignments with the year of its input, never a global.

The camp season rolls over on Oct 15, so the primary season can differ from the
calendar year and from ``CAMPMINDER_SEASON_ID``. A stale global must not leak in.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver

from .conftest import FICTIONAL_CAMPER_NAMES, build_direct_solver_input, create_bunk, create_person


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
    cfg.get_constraint.side_effect = lambda t, p, default=None: (
        2 if (t, p) == ("grade_spread", "max_spread") else (default or 0)
    )
    cfg.get_int.side_effect = lambda key, default=None: default if default is not None else 0
    cfg.get_float.side_effect = lambda key, default=None: default if default is not None else 0.0
    cfg.get_str.side_effect = lambda key, default=None: "hard" if "grade_spread.mode" in key else (default or "")
    cfg.get_bool.side_effect = lambda key, default=None: default if default is not None else False
    cfg.get_soft_constraint_weight.side_effect = lambda name: 0
    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        yield cfg


def _campers(n: int) -> list:
    return [
        create_person(
            cm_id=1001 + i,
            first_name=FICTIONAL_CAMPER_NAMES[i % len(FICTIONAL_CAMPER_NAMES)][0],
            last_name=FICTIONAL_CAMPER_NAMES[i % len(FICTIONAL_CAMPER_NAMES)][1],
            gender="M",
            grade=5,
        )
        for i in range(n)
    ]


def test_single_bunk_assignments_carry_the_input_year(monkeypatch: pytest.MonkeyPatch, mock_config) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2026")  # a stale global must not leak in
    inp = build_direct_solver_input(
        persons=_campers(3), bunks=[create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)], year=2027
    )
    out = DirectBunkingSolver(inp, mock_config).solve()
    assert out is not None
    assert out.assignments
    assert {a.year for a in out.assignments} == {2027}


def test_multi_bunk_assignments_carry_the_input_year(monkeypatch: pytest.MonkeyPatch, mock_config) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2026")
    bunks = [
        create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12),
        create_bunk(cm_id=2002, name="B-2", gender="M", capacity=12),
    ]
    inp = build_direct_solver_input(persons=_campers(16), bunks=bunks, year=2027)
    out = DirectBunkingSolver(inp, mock_config).solve()
    assert out is not None
    assert out.assignments
    assert {a.year for a in out.assignments} == {2027}

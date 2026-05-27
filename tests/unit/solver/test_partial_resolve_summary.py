"""Tests for partial_resolve_summary helper (#1609).

Verifies that the completion-summary counts (unassigned campers + cross-boundary
positive requests) are computed correctly from a DirectSolverInput + assignments list.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunkAssignment, DirectBunkRequest, DirectSolverInput
from bunking.solver.constraints.locked_bunks import partial_resolve_summary
from tests.unit.solver.impossibility.conftest import make_bunk, make_input, make_person


def _assignment(person_cm_id: int, bunk_cm_id: int) -> DirectBunkAssignment:
    return DirectBunkAssignment(person_cm_id=person_cm_id, session_cm_id=1000001, bunk_cm_id=bunk_cm_id, year=2026)


def test_summary_reports_unassigned_count():
    persons = [make_person(1001, gender="M", grade=5), make_person(1002, gender="M", grade=5)]
    inp = DirectSolverInput(persons=persons, requests=[], bunks=[], locked_bunks={2001: []})
    assignments = [_assignment(1001, 2002)]  # only 1 of 2 placed
    summary = partial_resolve_summary(inp, assignments)
    assert summary["unassigned_count"] == 1
    assert summary["unassigned_person_cm_ids"] == [1002]  # the unplaced camper, by cm_id
    assert summary["cross_boundary_request_count"] == 0


def test_summary_reports_cross_boundary_count():
    persons = [make_person(1001, gender="M", grade=5), make_person(1002, gender="M", grade=5)]
    req = DirectBunkRequest(
        id="r1",
        requester_person_cm_id=1002,
        requested_person_cm_id=1001,
        request_type="bunk_with",
        session_cm_id=1000001,
        year=2026,
    )
    inp = DirectSolverInput(persons=persons, requests=[req], bunks=[], locked_bunks={2001: [1001]})
    assignments = [_assignment(1001, 2001), _assignment(1002, 2002)]  # all placed
    summary = partial_resolve_summary(inp, assignments)
    assert summary["unassigned_count"] == 0
    assert summary["unassigned_person_cm_ids"] == []  # everyone placed
    assert summary["cross_boundary_request_count"] == 1  # 1002->1001 (locked) unmeetable


# ---------------------------------------------------------------------------
# Spike: end-to-end via .solve() to verify the wiring in direct_solver.py
# ---------------------------------------------------------------------------


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


def test_partial_resolve_stats_attached_via_solve(mock_config):
    """End-to-end: locked_bunks set → partial_resolve key appears in output.stats.

    16 M campers across 2 bunks (satisfies min-occupancy 8/bunk). Bunk 2001 locked
    with 8 occupants; bunk 2002 is free. 8 unlocked campers all land in bunk 2002.
    """
    from bunking.solver.direct_solver import DirectBunkingSolver

    locked_ids = list(range(1001, 1009))  # 8 campers frozen in bunk 2001
    unlocked_ids = list(range(2001, 2009))  # 8 campers to be placed in bunk 2002
    persons = [make_person(i, gender="M", grade=5) for i in locked_ids + unlocked_ids]
    bunks = [make_bunk(2001, gender="M", capacity=12), make_bunk(2002, gender="M", capacity=12)]
    inp = make_input(persons, bunks, [])
    inp.locked_bunks = {2001: locked_ids}

    out = DirectBunkingSolver(inp, mock_config).solve(time_limit_seconds=5)
    assert out is not None
    assert "partial_resolve" in out.stats
    assert out.stats["partial_resolve"]["unassigned_count"] == 0  # all 16 placed
    assert out.stats["partial_resolve"]["cross_boundary_request_count"] == 0

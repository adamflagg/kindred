"""Integration tests for the smart overflow orchestrator (Stream C).

Verifies DirectBunkingSolver.solve()'s user-visible branches:
- 12-cap feasible → return solution immediately (pass 1 only).
- 12-cap infeasible + overflow fixable → auto-run pass 2, return solution
  with overflow_used > 0.
- 12-cap infeasible + overflow doesn't help → return empty-assignments output
  with infeasibility_diagnosis populated.
- Pass 2 picks the minimum number of overflowed bunks (lex penalty works).
"""

from collections import Counter
from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.direct_solver import DirectBunkingSolver
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from tests.unit.bunking.solver.conftest import (
    FICTIONAL_CAMPER_NAMES,
    build_direct_solver_input,
    create_bunk,
    create_person,
)


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


class TestSmartOverflowOrchestration:
    def test_12cap_feasible_returns_solution_no_overflow(self, mock_config):
        """12 M campers, 1 M bunk + 1 F bunk (room to spare) → 12-cap solve."""
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
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)

        result = DirectBunkingSolver(solver_input, mock_config).solve(time_limit_seconds=30)

        assert result is not None
        assert len(result.assignments) == 12
        assert result.overflow_used == 0
        assert result.infeasibility_diagnosis is None
        counts = Counter(a.bunk_cm_id for a in result.assignments)
        assert all(c <= DEFAULT_BUNK_CAPACITY for c in counts.values())

    def test_12cap_infeasible_overflow_fixable_auto_runs_pass2(self, mock_config):
        """13 M campers + (M bunk + F bunk) — strict 12-cap INFEASIBLE.
        Pass 2 auto-runs, puts 13 in B-1 (B-2 is F-only). overflow_used=1."""
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
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)

        result = DirectBunkingSolver(solver_input, mock_config).solve(time_limit_seconds=30)

        assert result is not None
        assert len(result.assignments) == 13
        assert result.overflow_used == 1
        counts = Counter(a.bunk_cm_id for a in result.assignments)
        assert counts[2001] == 13

    def test_12cap_infeasible_overflow_doesnt_help_returns_diagnostic(self, mock_config):
        """14 M campers, 1 M bunk only — INFEASIBLE even at 13-cap (14 > 13).
        Returns empty-assignments output with infeasibility_diagnosis set."""
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
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        # Single-bunk session path is bypassed because len(bunks) > 1, but only
        # B-1 can hold M campers if we lock B-2 to a different gender. Make B-2 F
        # to force the squeeze.
        bunks[1] = create_bunk(cm_id=2002, name="B-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY)
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)

        result = DirectBunkingSolver(solver_input, mock_config).solve(time_limit_seconds=30)

        # Returns an empty-assignments DirectSolverOutput, not None — the
        # output carries infeasibility_diagnosis for the frontend.
        assert result is not None
        assert result.assignments == []
        assert result.infeasibility_diagnosis is not None
        assert len(result.infeasibility_diagnosis) > 0

    def test_pass2_picks_minimum_overflow_split(self, mock_config):
        """25 M campers, 2 M bunks. Pass 1 infeasible (>24 cap). Pass 2 must
        split 13+12 (exactly 1 overflowed bunk), NOT 13+13+... wastefully."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(25)
        ]
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)

        result = DirectBunkingSolver(solver_input, mock_config).solve(time_limit_seconds=30)

        assert result is not None
        assert len(result.assignments) == 25
        assert result.overflow_used == 1
        counts = Counter(a.bunk_cm_id for a in result.assignments)
        # Exactly one bunk at 13, the other at 12
        overflowed = sum(1 for c in counts.values() if c > DEFAULT_BUNK_CAPACITY)
        assert overflowed == 1


class TestSolveOnceStatePreservation:
    """Stream C's two-pass orchestrator reuses one solver instance across
    passes. These tests pin the invariants that keep per-pass state changes
    from corrupting input-derived state."""

    def test_rebuild_model_preserves_mp_set_entirely_impossible(self, mock_config):
        """#1: _rebuild_model resets model-derived state but MUST preserve
        mp_set_entirely_impossible — it is input-derived (computed once in
        __init__ from the impossibility report) and read post-solve for the
        request_validation_summary dashboard signal."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(3)
        ]
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)
        solver = DirectBunkingSolver(solver_input, mock_config)

        # Simulate __init__ having recorded an entirely-impossible MP camper.
        solver.mp_set_entirely_impossible = [1002]

        solver._rebuild_model()

        assert solver.mp_set_entirely_impossible == [1002]

    def test_solve_once_restores_allow_overflow_on_exception(self, mock_config):
        """#5: _solve_once mutates self.input.allow_overflow for the pass and
        must restore it even when an inner build step raises — otherwise a
        later pass / inspection sees the wrong overflow state."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(3)
        ]
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)
        solver = DirectBunkingSolver(solver_input, mock_config)
        solver.input.allow_overflow = False

        # Force a raise after the flag has been mutated for the pass.
        def _boom() -> None:
            raise RuntimeError("simulated build failure")

        solver.add_constraints = _boom  # type: ignore[method-assign]

        with pytest.raises(RuntimeError, match="simulated build failure"):
            solver._solve_once(allow_overflow=True, time_limit_seconds=5)

        # The flag must be back to its pre-pass value despite the exception.
        assert solver.input.allow_overflow is False

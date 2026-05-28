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
from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.direct_solver import DirectBunkingSolver
from bunking.models_v2 import DirectBunkAssignment
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

    def test_pass2_overflow_does_not_log_spurious_capacity_violation(self, mock_config):
        """#1: a pass-2 overflow solve legitimately seats 13 in a bunk. The
        post-solve _check_constraint_violations must use the pass-scoped
        allow_overflow=True cap (13), NOT the restored input value (12), so it
        does not log a spurious cabin_capacity violation for the intended
        13-seat bunk. The input flag stays at its default False, so a check that
        reads the restored flag would compute a 12-cap and wrongly flag the bunk."""
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
        assert solver_input.allow_overflow is False  # input flag is the restored value

        solver = DirectBunkingSolver(solver_input, mock_config)
        result = solver.solve(time_limit_seconds=30)

        assert result is not None
        assert result.overflow_used == 1  # pass 2 ran and seated 13 in B-1
        # The 13-seat bunk is the intended pass-2 outcome — no capacity violation.
        assert "cabin_capacity" not in solver.constraint_logger.violations


class TestCountOverflowedBunks:
    """`_count_overflowed_bunks` reports how many bunks THIS solve overflowed.

    It must measure each bunk against its own strict cap ``min(capacity, 12)``
    (not a fixed 12) and must ignore frozen (locked) bunks merged back into the
    result — a pre-existing overfilled locked bunk is a staff action, not the
    solver's overflow.
    """

    def test_counts_specialty_bunk_over_its_own_strict_cap(self, mock_config):
        """A capacity-8 bunk seating 9 used its overflow seat → counts as 1.

        A fixed ``> 12`` threshold would miss it (9 < 12) and under-report
        overflow_used / the staff toast.
        """
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(9)
        ]
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=8)]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)
        solver = DirectBunkingSolver(solver_input, mock_config)

        assignments = [
            DirectBunkAssignment(person_cm_id=1001 + i, bunk_cm_id=2001, session_cm_id=1000, year=2025)
            for i in range(9)
        ]
        assert solver._count_overflowed_bunks(assignments) == 1

    def test_skips_frozen_locked_bunks(self, mock_config):
        """A frozen (locked) bunk merged back into the result is NOT in
        self.bunk_idx_map; a pre-existing 13-occupant locked bunk must not
        inflate the count. Only the working bunk this solve overflowed counts."""
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
        bunks = [create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)
        solver = DirectBunkingSolver(solver_input, mock_config)

        # Working bunk 2001 (in bunk_idx_map) at 13 → overflowed by this solve.
        working = [
            DirectBunkAssignment(person_cm_id=1001 + i, bunk_cm_id=2001, session_cm_id=1000, year=2025)
            for i in range(13)
        ]
        # Frozen locked bunk 9999 (NOT in bunk_idx_map) also at 13 → staff's doing.
        frozen = [
            DirectBunkAssignment(person_cm_id=5001 + i, bunk_cm_id=9999, session_cm_id=1000, year=2025)
            for i in range(13)
        ]
        assert solver._count_overflowed_bunks(working + frozen) == 1


class TestPass2TimeoutDiagnostic:
    """When the capacity probe proves overflow would help but pass 2 times out
    before finding an incumbent, solve() must surface a structured timeout
    diagnostic — never None. Returning None routes solver_runner into
    find_infeasibility_cause, which only probes INFO_ONLY constraints (never
    capacity) and would emit a misleading 'no cause found' message."""

    def test_pass2_timeout_after_positive_probe_returns_diagnostic(self, mock_config, monkeypatch):
        import bunking.solver.direct_solver as ds

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
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)
        solver = DirectBunkingSolver(solver_input, mock_config)

        # Probe says overflow WOULD fix infeasibility...
        monkeypatch.setattr(ds, "probe_capacity_relaxation_feasible", lambda *a, **k: True)

        # ...but pass 1 is INFEASIBLE and pass 2 times out with no incumbent.
        def fake_solve_once(allow_overflow, time_limit_seconds, with_overflow_penalty=False):
            if not allow_overflow:
                return (None, cp_model.INFEASIBLE)
            return (None, cp_model.UNKNOWN)

        monkeypatch.setattr(solver, "_solve_once", fake_solve_once)

        result = solver.solve(time_limit_seconds=30)

        assert result is not None
        assert result.assignments == []
        assert result.infeasibility_diagnosis is not None
        assert "time" in result.infeasibility_diagnosis.lower()

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


class TestRequestConflictDiagnosis:
    """Stream D Task 4: diagnostic must probe at the established (overflow) capacity.

    When pass-1 is INFEASIBLE and the capacity probe also returns INFEASIBLE
    (overflow alone doesn't fix it), the tier-3 diagnostic calls
    find_infeasibility_cause. At strict 12-cap, capacity co-blocks, so no
    single-constraint removal isolates — the diagnostic returns "multiple
    interacting constraints". At the established overflow (13-cap) capacity,
    request conflicts isolate cleanly and the diagnostic names the cause.

    This test calls find_infeasibility_cause directly (focused unit test) to
    pin the before/after contract of the allow_overflow flag. The full solve()
    integration is tested separately; the focused approach makes the RED/GREEN
    boundary unambiguous.
    """

    def test_request_conflict_diagnosis_names_parent_paramount(self, mock_config):
        """Capacity AND requests both block at 12-cap, but at the established
        (overflow) capacity the request cause isolates cleanly — so the diagnosis
        must name parent_paramount, not 'multiple interacting constraints'.

        Roster design (all same grade to avoid grade-adjacency interference):
          - 25 F campers, all grade 5, 2 F bunks (12-cap each = 24 seats total)
          - 14 of the 25 campers each have a material bunk_with to camper X
          - MSO hard constraint forces each of the 14 into X's bunk: X+14=15>13cap
          - At 12-cap: INFEASIBLE (25>24 capacity); removing parent_paramount
            alone still leaves 25>24 → no single removal isolates → "multiple
            interacting constraints"
          - At 13-cap: INFEASIBLE (parent_paramount forces 15 into one bunk);
            removing grade_adjacency doesn't help (no grade issue), removing
            parent_paramount restores OPTIMAL → diagnostic names parent_paramount

        Mirrors the production failure pattern where the SAME roster is:
          12-cap: capacity co-blocks, obscuring the real request cause
          13-cap: capacity resolved, only parent_paramount blocks
        """
        from bunking.models_v2 import DirectBunkRequest
        from bunking.solver.feasibility import find_infeasibility_cause

        # 25 F G5 campers — no grade adjacency or spread issues (all same grade)
        campers = [
            create_person(cm_id=1001 + i, first_name=f"C{1001 + i}", last_name="T", gender="F", grade=5)
            for i in range(25)
        ]
        # Camper 0 (cm_id 1001) = X, the shared bunk_with target
        x_target = campers[0]

        bunks = [
            create_bunk(cm_id=2001, name="G-1", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="G-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
        ]

        # 14 material bunk_with requests to X. MSO hard constraint forces all 14
        # into X's bunk → bunk needs X + 14 = 15 seats > 13-cap → INFEASIBLE at 13-cap.
        requests = [
            DirectBunkRequest(
                id=f"req-diag-{i + 1:04d}",
                requester_person_cm_id=campers[1 + i].campminder_person_id,
                requested_person_cm_id=x_target.campminder_person_id,
                request_type="bunk_with",
                source_field="bunk_request_form",
                status="resolved",
                session_cm_id=1000,
                year=2026,
                is_first_requested=True,
            )
            for i in range(14)
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks, requests=requests)

        # At strict 12-cap: capacity also blocks (25 > 24), so no single constraint
        # removal fixes it — removing parent_paramount still leaves 25>24 INFEASIBLE.
        # Diagnostic must return "multiple interacting constraints".
        result_strict = find_infeasibility_cause(
            input_data=solver_input,
            config=mock_config,
            time_limit_seconds=15,
            allow_overflow=False,
        )
        strict_diag = result_strict.lower()
        assert "multiple interacting" in strict_diag, (
            f"Expected 'multiple interacting' at 12-cap (capacity co-blocks), got: {result_strict!r}"
        )

        # At overflow (13-cap): capacity no longer co-blocks. The only remaining
        # infeasibility is parent_paramount (15 must-colocate > 13-cap). The
        # diagnostic must name parent_paramount, NOT "multiple interacting".
        result_overflow = find_infeasibility_cause(
            input_data=solver_input,
            config=mock_config,
            time_limit_seconds=15,
            allow_overflow=True,
        )
        diag = result_overflow.lower()
        assert "multiple interacting" not in diag, (
            f"Expected named cause at 13-cap, still got 'multiple interacting': {result_overflow!r}"
        )
        assert "parent_paramount" in diag or "parent paramount" in diag, (
            f"Expected parent_paramount named at 13-cap, got: {result_overflow!r}"
        )

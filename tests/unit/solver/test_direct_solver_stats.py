"""TDD tests for stats helpers added to direct_solver.

These tests define the expected behavior of the new helpers used to capture
CP-SAT internals on every solver run. Implementation must conform to these
tests, not the other way around.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver, _compute_optimality_gap, _count_constraint_types


class TestCountConstraintTypes:
    def test_empty_model_returns_empty_dict(self) -> None:
        model = cp_model.CpModel()
        result = _count_constraint_types(model.Proto())
        assert result == {}

    def test_counts_bool_and_constraints(self) -> None:
        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        model.AddBoolAnd([a, b])
        model.AddBoolAnd([a, b.Not()])
        result = _count_constraint_types(model.Proto())
        assert result["bool_and"] == 2

    def test_counts_mixed_types(self) -> None:
        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        x = model.NewIntVar(0, 10, "x")
        model.AddBoolAnd([a, b])
        model.AddBoolOr([a, b])
        model.Add(x >= 5)
        result = _count_constraint_types(model.Proto())
        assert result["bool_and"] == 1
        assert result["bool_or"] == 1
        assert result["linear"] == 1


class TestComputeOptimalityGap:
    def test_returns_zero_when_objective_equals_bound(self) -> None:
        assert _compute_optimality_gap(100.0, 100.0) == 0.0

    def test_returns_none_when_objective_is_none(self) -> None:
        assert _compute_optimality_gap(None, 100.0) is None

    def test_returns_none_when_bound_is_none(self) -> None:
        assert _compute_optimality_gap(100.0, None) is None

    def test_computes_relative_gap(self) -> None:
        # |102 - 100| / max(|102|, 1) = 2 / 102 ≈ 0.0196
        result = _compute_optimality_gap(102.0, 100.0)
        assert result is not None
        assert abs(result - (2.0 / 102.0)) < 1e-9

    def test_handles_zero_objective(self) -> None:
        # |0 - 0| / max(|0|, 1) = 0
        assert _compute_optimality_gap(0.0, 0.0) == 0.0


class TestBuildStatsDict:
    """Tests for _build_stats_dict — the always-on CP-SAT internals capture."""

    def _make_solver(self, **overrides: object) -> object:
        """Build a MagicMock standing in for cp_model.CpSolver with sensible defaults."""
        from unittest.mock import MagicMock

        solver = MagicMock()
        solver.StatusName.return_value = "OPTIMAL"
        solver.ObjectiveValue.return_value = 100.0
        solver.WallTime.return_value = 23.1
        solver.UserTime.return_value = 47.1
        solver.DeterministicTime.return_value = 4.3e8
        solver.BestObjectiveBound.return_value = 100.0
        solver.NumBranches.return_value = 3210
        solver.NumConflicts.return_value = 147
        solver.NumBooleans.return_value = 14801
        solver.NumIntegers.return_value = 433
        response = MagicMock(gap_integral=67.2, num_solutions=7, solution_info="feasibility_jump_search worker 3")
        solver.ResponseProto.return_value = response
        for k, v in overrides.items():
            getattr(solver, k).return_value = v
        return solver

    def _make_proto(self, num_vars: int = 0) -> object:
        from unittest.mock import MagicMock

        proto = MagicMock()
        proto.variables = [MagicMock()] * num_vars
        proto.constraints = []  # constraint_type_breakdown tested separately
        return proto

    def test_includes_existing_back_compat_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(15234),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=98,
            num_bunks=12,
            num_requests=240,
            satisfied_count=235,
        )

        # Existing back-compat fields preserved
        assert stats["status"] == "OPTIMAL"
        assert stats["objective_value"] == 100.0
        assert stats["solve_time"] == 23.1
        assert stats["total_persons"] == 98
        assert stats["total_bunks"] == 12
        assert stats["total_requests"] == 240
        assert stats["satisfied_request_count"] == 235

    def test_includes_new_timing_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["walltime_seconds"] == 23.1
        assert stats["user_time_seconds"] == 47.1
        assert stats["deterministic_time"] == 4.3e8
        assert stats["time_budget_seconds"] == 60
        assert stats["num_workers"] == 8

    def test_includes_new_quality_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["best_objective_bound"] == 100.0
        assert stats["optimality_gap"] == 0.0
        assert stats["gap_integral"] == 67.2
        assert stats["num_solutions_found"] == 7
        assert stats["solution_info"] == "feasibility_jump_search worker 3"

    def test_includes_new_search_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["num_branches"] == 3210
        assert stats["num_conflicts"] == 147
        assert stats["num_booleans"] == 14801
        assert stats["num_integer_variables"] == 433

    def test_includes_new_model_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(15234),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["model_num_variables"] == 15234
        assert stats["model_num_constraints"] == 0
        assert stats["constraint_type_breakdown"] == {}

    def test_handles_missing_ortools_methods_gracefully(self) -> None:
        """getattr guards must return None when OR-Tools API drifts, not raise."""
        from unittest.mock import MagicMock

        from bunking.solver.direct_solver import _build_stats_dict

        # spec= limits which methods exist; missing ones must default to None
        solver = MagicMock(
            spec=[
                "StatusName",
                "ObjectiveValue",
                "WallTime",
                "NumBranches",
                "NumConflicts",
                "NumBooleans",
                "ResponseProto",
            ]
        )
        solver.StatusName.return_value = "FEASIBLE"
        solver.ObjectiveValue.return_value = 50.0
        solver.WallTime.return_value = 10.0
        solver.NumBranches.return_value = 100
        solver.NumConflicts.return_value = 5
        solver.NumBooleans.return_value = 200
        solver.ResponseProto.return_value = MagicMock(gap_integral=None, num_solutions=None, solution_info="")

        stats = _build_stats_dict(
            solver=solver,
            status=2,
            model_proto=self._make_proto(),
            time_limit_seconds=30,
            num_workers=4,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )

        assert stats["user_time_seconds"] is None
        assert stats["deterministic_time"] is None
        assert stats["best_objective_bound"] is None
        assert stats["num_integer_variables"] is None
        assert stats["optimality_gap"] is None  # bound was None


class TestSingleBunkPathStats:
    """Single-bunk sessions (e.g. AG) take a simplified path that bypasses CP-SAT.

    The new impact-analysis flow persists `solver_runs.stats`; without a stats
    payload single-bunk runs would appear as empty rows in the debug table.
    A minimal stats dict with the same shape as the multi-bunk path keeps
    them consistent — even if many CP-SAT-only fields are None.
    """

    def _make_input(self, num_persons: int = 3, capacity: int = 12) -> DirectSolverInput:
        bunk = DirectBunk(
            id="bunk-1",
            campminder_id=9001,
            name="AG-1",
            capacity=capacity,
            gender="Mixed",
            session_cm_id=500,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=500,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=[], bunks=[bunk])

    def test_single_bunk_solve_populates_stats(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert isinstance(result.stats, dict)
        assert result.stats, "single-bunk runs must populate stats so the debug UI is consistent"

    def test_single_bunk_stats_includes_marker(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("single_bunk_session") is True

    def test_single_bunk_stats_includes_persons_and_bunks_counts(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("total_persons") == 3
        assert result.stats.get("total_bunks") == 1

    def test_single_bunk_stats_status_is_optimal(self) -> None:
        """Trivial: every camper assigned to the only bunk → 'OPTIMAL'."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("status") == "OPTIMAL"

    def test_single_bunk_over_capacity_is_infeasible(self) -> None:
        """Over-capacity single-bunk run must report INFEASIBLE, not a hardcoded OPTIMAL.

        Impact-analysis aggregates `solver_runs.stats.status_code`; a hardcoded
        OPTIMAL would silently skew comparisons for AG sessions that don't fit.
        """
        solver = DirectBunkingSolver(
            input_data=self._make_input(num_persons=5, capacity=2),
            config_service=MagicMock(),
        )
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("status") == "INFEASIBLE"
        assert result.stats.get("status_code") == cp_model.INFEASIBLE


# Keys emitted by _build_stats_dict on the multi-bunk path. Single-bunk runs
# must emit the same key set (with None for fields the simplified path can't
# populate) so impact-analysis frontend rendering is consistent across
# session types.
_BUILD_STATS_DICT_KEYS = frozenset(
    {
        "status",
        "status_code",
        "objective_value",
        "solve_time",
        "total_persons",
        "total_bunks",
        "total_requests",
        "satisfied_request_count",
        "walltime_seconds",
        "user_time_seconds",
        "deterministic_time",
        "time_budget_seconds",
        "num_workers",
        "best_objective_bound",
        "optimality_gap",
        "gap_integral",
        "num_solutions_found",
        "solution_info",
        "num_branches",
        "num_conflicts",
        "num_booleans",
        "num_integer_variables",
        "model_num_variables",
        "model_num_constraints",
        "constraint_type_breakdown",
    }
)


class TestSingleBunkStatsKeyParity:
    """Single-bunk stats must include every key from `_build_stats_dict`.

    The PR comment claims "the keys match `_build_stats_dict`" but the actual
    dict was a strict subset. Frontend code doing `stats?.walltime_seconds`
    gets `undefined` for AG runs but `null` for multi-bunk runs — different
    rendering paths for the same logical "no value".
    """

    def _make_input(self, num_persons: int = 3, capacity: int = 12) -> DirectSolverInput:
        bunk = DirectBunk(
            id="bunk-1",
            campminder_id=9001,
            name="AG-1",
            capacity=capacity,
            gender="Mixed",
            session_cm_id=500,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=500,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=[], bunks=[bunk])

    def test_single_bunk_stats_emits_full_key_set(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        emitted = set(result.stats.keys())
        missing = _BUILD_STATS_DICT_KEYS - emitted
        assert not missing, f"single-bunk stats missing keys vs _build_stats_dict: {missing}"

    def test_single_bunk_stats_cp_sat_only_fields_are_none(self) -> None:
        """Fields the simplified path cannot populate must be `None`, not absent."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        for key in (
            "user_time_seconds",
            "deterministic_time",
            "time_budget_seconds",
            "num_workers",
            "best_objective_bound",
            "optimality_gap",
            "gap_integral",
            "num_solutions_found",
            "solution_info",
            "num_branches",
            "num_conflicts",
            "num_booleans",
            "num_integer_variables",
            "model_num_variables",
            "model_num_constraints",
        ):
            assert key in result.stats, f"single-bunk stats missing key {key!r}"
            assert result.stats[key] is None, f"expected {key!r} to be None for single-bunk, got {result.stats[key]!r}"

    def test_single_bunk_stats_constraint_type_breakdown_is_empty_dict(self) -> None:
        """`constraint_type_breakdown` is a dict on the multi-bunk path; for
        single-bunk it must still be a dict (empty), not None or missing,
        so the frontend can iterate it safely."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("constraint_type_breakdown") == {}


class TestSingleBunkSatisfiedRequestsCentralization:
    """Single-bunk path must use shared `calculate_satisfied_requests` so it:

    1. Stores real PocketBase request IDs (not synthetic 'bunk_with:<id>'
       strings) — the frontend looks them up by ID.
    2. Counts NOT_BUNK_WITH satisfied requests (skipped by the hand-rolled
       BUNK_WITH-only loop) — though in a single-bunk session a NOT_BUNK_WITH
       between two co-bunked persons is *unsatisfied*, not satisfied.
    """

    def _make_input(
        self, num_persons: int = 3, capacity: int = 12, requests: list[DirectBunkRequest] | None = None
    ) -> DirectSolverInput:
        bunk = DirectBunk(
            id="bunk-1",
            campminder_id=9001,
            name="AG-1",
            capacity=capacity,
            gender="Mixed",
            session_cm_id=500,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=500,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=requests or [], bunks=[bunk])

    def test_single_bunk_satisfied_uses_real_request_ids(self) -> None:
        """`satisfied_requests[person_cm_id]` values must be real PB record IDs,
        matching what the multi-bunk path emits via `calculate_satisfied_requests`."""
        req = DirectBunkRequest(
            id="pb_req_abc123",
            requester_person_cm_id=1000,
            requested_person_cm_id=1001,
            request_type="bunk_with",
            session_cm_id=500,
            year=2026,
        )
        solver = DirectBunkingSolver(
            input_data=self._make_input(num_persons=3, requests=[req]),
            config_service=MagicMock(),
        )
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.satisfied_requests.get(1000) == ["pb_req_abc123"]

    def test_single_bunk_satisfied_does_not_emit_synthetic_strings(self) -> None:
        """The old hand-rolled loop emitted strings like 'bunk_with:1001'.
        These must not appear in the satisfied_requests output any more."""
        req = DirectBunkRequest(
            id="pb_req_real",
            requester_person_cm_id=1000,
            requested_person_cm_id=1001,
            request_type="bunk_with",
            session_cm_id=500,
            year=2026,
        )
        solver = DirectBunkingSolver(
            input_data=self._make_input(num_persons=3, requests=[req]),
            config_service=MagicMock(),
        )
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        for ids in result.satisfied_requests.values():
            for rid in ids:
                assert not rid.startswith("bunk_with:"), f"synthetic ID leaked: {rid!r}"

    def test_single_bunk_not_bunk_with_between_co_bunked_is_unsatisfied(self) -> None:
        """In a single-bunk session both persons are in the same bunk, so a
        NOT_BUNK_WITH request between them is *not* satisfied. The shared
        helper handles this; the old hand-rolled loop ignored NOT_BUNK_WITH
        entirely (returning satisfied_count of 0 instead of the correct 0,
        but for the wrong reason)."""
        req = DirectBunkRequest(
            id="pb_req_not_with",
            requester_person_cm_id=1000,
            requested_person_cm_id=1001,
            request_type="not_bunk_with",
            session_cm_id=500,
            year=2026,
        )
        solver = DirectBunkingSolver(
            input_data=self._make_input(num_persons=3, requests=[req]),
            config_service=MagicMock(),
        )
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert 1000 not in result.satisfied_requests, (
            "NOT_BUNK_WITH between two persons in the same bunk must NOT be satisfied"
        )
        assert result.stats.get("satisfied_request_count") == 0


class TestUnknownConstraintBucket:
    """Constraints whose oneof type isn't in `_CONSTRAINT_TYPES` must land in an
    'unknown' bucket so `sum(breakdown.values()) == model_num_constraints` —
    otherwise OR-Tools upgrades silently shrink the displayed breakdown.
    """

    def test_unknown_constraint_lands_in_unknown_bucket(self) -> None:
        """A bare MagicMock proto with one constraint that has no `has_*`
        method matching `_CONSTRAINT_TYPES` must produce `{'unknown': 1}`."""
        proto = MagicMock()
        fake_constraint = MagicMock(spec=[])  # spec=[] → no `has_*` attrs
        proto.constraints = [fake_constraint]

        result = _count_constraint_types(proto)
        assert result.get("unknown") == 1
        assert sum(result.values()) == 1

    def test_known_and_unknown_are_both_counted(self) -> None:
        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        model.AddBoolAnd([a, b])
        # Known bool_and constraint plus a synthetic unknown one
        proto = model.Proto()
        # Wrap in MagicMock to splice in a fake constraint whose `has_*`
        # methods all return False
        fake_unknown = MagicMock(spec=[])
        constraints_list = list(proto.constraints) + [fake_unknown]

        wrapper = MagicMock()
        wrapper.constraints = constraints_list

        result = _count_constraint_types(wrapper)
        assert result.get("bool_and") == 1
        assert result.get("unknown") == 1
        assert sum(result.values()) == 2

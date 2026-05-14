"""TDD tests for stats helpers added to direct_solver.

These tests define the expected behavior of the new helpers used to capture
CP-SAT internals on every solver run. Implementation must conform to these
tests, not the other way around.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.solver.observability import _compute_optimality_gap, _count_constraint_types


def _make_req(req_id: str, requester: int, source_field: str) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        request_type="bunk_with",
        session_cm_id=1000001,
        year=2026,
        source_field=source_field,
    )


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


class TestStatsDictIsJsonSerializable:
    """The stats dict round-trips through `solver_runs.stats` (a JSON column).

    Real OR-Tools returns a `CpSolverStatus` enum from `solver.Solve(...)` —
    json.dumps cannot encode that natively, so storing it raw breaks the
    PocketBase save with `Object of type CpSolverStatus is not JSON
    serializable`. The fix is to store the int value, not the enum.
    """

    def test_stats_dict_is_json_serializable_when_status_is_an_enum(self) -> None:
        import json
        from unittest.mock import MagicMock

        from bunking.solver.observability import _build_stats_dict

        solver = MagicMock()
        solver.StatusName.return_value = "OPTIMAL"
        solver.ObjectiveValue.return_value = 100.0
        solver.WallTime.return_value = 1.0
        solver.UserTime.return_value = 1.0
        solver.BestObjectiveBound.return_value = 100.0
        solver.NumBranches.return_value = 0
        solver.NumConflicts.return_value = 0
        solver.NumBooleans.return_value = 0
        response = MagicMock(
            gap_integral=0.0,
            deterministic_time=1.0,
            num_integers=0,
            additional_solutions=[],
            solution_info="",
        )
        solver.ResponseProto.return_value = response
        proto = MagicMock()
        proto.variables = []
        proto.constraints = []

        stats = _build_stats_dict(
            solver=solver,
            status=cp_model.OPTIMAL,
            model_proto=proto,
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=0,
            satisfied_count=0,
        )

        # Must round-trip through json — this is the bug that was blocking
        # solver_runs persistence on every successful run.
        json.dumps(stats)


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
        solver.BestObjectiveBound.return_value = 100.0
        solver.NumBranches.return_value = 3210
        solver.NumConflicts.return_value = 147
        solver.NumBooleans.return_value = 14801
        # ortools 9.15: deterministic_time, num_integers, additional_solutions
        # live on the response proto (snake_case). Mirror that here.
        response = MagicMock(
            gap_integral=67.2,
            deterministic_time=4.3e8,
            num_integers=433,
            additional_solutions=[MagicMock()] * 6,  # +1 final solution = 7
            solution_info="feasibility_jump_search worker 3",
        )
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
        from bunking.solver.observability import _build_stats_dict

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
        from bunking.solver.observability import _build_stats_dict

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
        from bunking.solver.observability import _build_stats_dict

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
        from bunking.solver.observability import _build_stats_dict

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
        from bunking.solver.observability import _build_stats_dict

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

    def test_optional_solver_methods_fall_back_to_none(self) -> None:
        """Defensive guards on PascalCase methods that exist in 9.15 but aren't core.

        `UserTime` and `BestObjectiveBound` are wrapped in `getattr(..., lambda:
        None)` because they're peripheral — if a future OR-Tools drops them, the
        debug row can still save with `None` for those cells. Core attrs
        (deterministic_time, num_integers, additional_solutions) intentionally
        raise loudly instead — silent-None data loss is what we just got out of.
        """
        from unittest.mock import MagicMock

        from bunking.solver.observability import _build_stats_dict

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
        solver.ResponseProto.return_value = MagicMock(
            gap_integral=None,
            deterministic_time=0.5,
            num_integers=10,
            additional_solutions=[],
            solution_info="",
        )

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
        assert stats["best_objective_bound"] is None
        assert stats["optimality_gap"] is None  # bound was None
        # status_code 2 = FEASIBLE → 1 solution + 0 additional
        assert stats["num_solutions_found"] == 1


class TestBuildStatsDictWithRealSolver:
    """Smoke test against the actual OR-Tools API.

    Mock-based tests above invented attribute names that don't exist on a real
    `cp_model.CpSolver` — they passed because `MagicMock` happily returns
    `MagicMock()` for any attribute access. Production then silently captured
    `None` via the `getattr(solver, "Whatever", lambda: None)()` fallback and
    the debug UI showed empty cells. A real solve is the only thing that
    catches that drift.
    """

    def test_real_solve_populates_cp_sat_internals(self) -> None:
        from bunking.solver.observability import _build_stats_dict

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 10, "x")
        y = model.NewIntVar(0, 10, "y")
        model.Add(x + y <= 7)
        model.Maximize(x + y)

        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

        stats = _build_stats_dict(
            solver=solver,
            status=status,
            model_proto=model.Proto(),
            time_limit_seconds=10,
            num_workers=1,
            num_persons=1,
            num_bunks=1,
            num_requests=0,
            satisfied_count=0,
        )

        # The three fields that silently went None against ortools 9.15+:
        # `solver.DeterministicTime()` / `solver.NumIntegers()` / `response.num_solutions`
        # do not exist on the real surface — code must read snake_case proto fields.
        assert stats["deterministic_time"] is not None
        assert isinstance(stats["deterministic_time"], float)
        assert stats["num_integer_variables"] is not None
        assert isinstance(stats["num_integer_variables"], int)
        assert stats["num_solutions_found"] is not None
        assert stats["num_solutions_found"] >= 1


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
            session_cm_id=1000001,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=1000001,
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
        # Tier 1 observability (Stream 2, issue #1380)
        "num_reified_linear",
        "max_linear_coefficient",
        "soft_constraints_by_module",
        "request_density_histogram_by_bucket",
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
            session_cm_id=1000001,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=1000001,
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


class TestSingleBunkRequestValidation:
    """Single-bunk stats must include the `request_validation` payload that
    the multi-bunk path attaches at the end of `solve()`. Without it, the
    debug page's MP/all-camper outcome rate columns render blank for every
    AG / single-bunk session — different rendering from multi-bunk runs
    even when the underlying signal exists.
    """

    def _make_input(
        self,
        num_persons: int = 3,
        capacity: int = 12,
        requests: list[DirectBunkRequest] | None = None,
    ) -> DirectSolverInput:
        bunk = DirectBunk(
            id="bunk-1",
            campminder_id=9001,
            name="AG-1",
            capacity=capacity,
            gender="Mixed",
            session_cm_id=1000001,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=1000001,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=requests or [], bunks=[bunk])

    def test_single_bunk_stats_includes_request_validation_key(self) -> None:
        """The `request_validation` key must be present on single-bunk stats.

        Frontend `pickStat` reads `stats.request_validation?.mp_requests_total`
        etc.; a missing key collapses every bucket-aware outcome column to `—`
        for AG sessions.
        """
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert "request_validation" in result.stats, (
            "single-bunk stats missing 'request_validation' key — debug-page outcome columns will render blank"
        )

    def test_single_bunk_request_validation_has_bucket_aware_count_keys(self) -> None:
        """All 6 bucket-aware count keys must be populated on the single-bunk path."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        rv = result.stats.get("request_validation")
        assert isinstance(rv, dict), f"expected dict request_validation payload, got {type(rv)!r}"
        for key in (
            "mp_requests_total",
            "mp_requests_satisfied",
            "mp_campers_total",
            "mp_campers_satisfied",
            "all_campers_total",
            "all_campers_satisfied",
        ):
            assert key in rv, f"single-bunk request_validation missing {key!r}"

    def test_single_bunk_counts_satisfied_mp_request(self) -> None:
        """In a single-bunk session every camper shares a bunk, so a `bunk_with`
        request between two enrolled campers is satisfied. The MP/all-camper
        counts must reflect this — not return zeros because the diagnostic loop
        was never run.
        """
        requests = [
            DirectBunkRequest(
                id="r1",
                requester_person_cm_id=1000,
                requested_person_cm_id=1001,
                request_type="bunk_with",
                source_field="bunk_with",
                status="resolved",
                priority=4,
                session_cm_id=1000001,
                year=2026,
            )
        ]
        solver = DirectBunkingSolver(
            input_data=self._make_input(num_persons=2, requests=requests),
            config_service=MagicMock(),
        )
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        rv = result.stats["request_validation"]
        assert rv["mp_requests_total"] == 1
        assert rv["mp_requests_satisfied"] == 1
        assert rv["mp_campers_total"] == 1
        assert rv["mp_campers_satisfied"] == 1
        assert rv["all_campers_total"] == 1
        assert rv["all_campers_satisfied"] == 1


class TestParentParamountStats:
    """Stage 4 (#1379) hard MP constraint exposes two new keys on
    ``request_validation`` for the SolverDebug dashboard:

    - ``mp_set_entirely_impossible_count``: how many campers had MP requests
      where every one was structurally impossible (cross-session,
      unresolved name, etc.) — the hard constraint was not added for them.
    - ``mp_set_entirely_impossible_cm_ids``: the cm_id list for the same
      cohort.

    Both must be present (even when zero) so the dashboard can render the
    field without a missing-key fallback.
    """

    def _make_input(
        self,
        num_persons: int = 3,
    ) -> DirectSolverInput:
        # Single bunk — uses the fast-path solver (no grade_ratio / etc. config
        # reads) so a plain MagicMock() config_service works, matching the
        # pattern used by TestSingleBunkSatisfiedRequestsCentralization.
        bunk = DirectBunk(
            id="bunk-a",
            campminder_id=9001,
            name="G-1",
            capacity=12,
            gender="F",
            session_cm_id=1000001,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="F",
                session_cm_id=1000001,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=[], bunks=[bunk])

    def test_stats_includes_mp_set_entirely_impossible_count_zero_when_clean(self) -> None:
        """When no camper has an all-impossible MP set, the count is 0 and
        cm_ids is an empty list (still present, not missing)."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        rv = result.stats["request_validation"]
        assert rv["mp_set_entirely_impossible_count"] == 0
        assert rv["mp_set_entirely_impossible_cm_ids"] == []

    def test_stats_includes_mp_set_entirely_impossible_when_populated(self) -> None:
        """When parent_paramount marks a camper as all-MP-impossible, the
        count and cm_ids fields reflect the cohort exactly. Populates the
        field directly on self (the constraint module would do this during
        the build pass; tests bypass that pass)."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        solver.mp_set_entirely_impossible.extend([1000, 1001])
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        rv = result.stats["request_validation"]
        assert rv["mp_set_entirely_impossible_count"] == 2
        assert sorted(rv["mp_set_entirely_impossible_cm_ids"]) == [1000, 1001]


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
            session_cm_id=1000001,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=1000001,
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
            session_cm_id=1000001,
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
            session_cm_id=1000001,
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
            session_cm_id=1000001,
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


# ──────────────────────────────────────────────────────────────────────
# Tier 1 observability metrics (Stream 2 of solver roadmap, issue #1380)
# ──────────────────────────────────────────────────────────────────────


class TestCountReifiedLinearConstraints:
    """Reified linear = linear constraint with non-empty enforcement_literal.

    Stage 4 of Stream 1 (hard MSO) cuts ~164 reified-linear constraints. We
    need this metric in `solver_runs.stats` so the simplification PR is
    visible on the dashboard.
    """

    def test_empty_model_returns_zero(self) -> None:
        from bunking.solver.observability import _count_reified_linear_constraints

        model = cp_model.CpModel()
        assert _count_reified_linear_constraints(model.Proto()) == 0

    def test_plain_linear_not_counted(self) -> None:
        from bunking.solver.observability import _count_reified_linear_constraints

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 10, "x")
        model.Add(x >= 5)  # plain linear, no enforcement_literal
        assert _count_reified_linear_constraints(model.Proto()) == 0

    def test_counts_reified_linear_constraints(self) -> None:
        from bunking.solver.observability import _count_reified_linear_constraints

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 10, "x")
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        # Two reified linear: x>=5 only when a; x<=3 only when b
        model.Add(x >= 5).OnlyEnforceIf(a)
        model.Add(x <= 3).OnlyEnforceIf(b)
        # One plain linear (no enforcement) — must NOT be counted
        model.Add(x != 7)
        # One bool_and — must NOT be counted (different constraint type)
        model.AddBoolAnd([a, b])
        assert _count_reified_linear_constraints(model.Proto()) == 2


class TestCountSoftConstraintsByModule:
    """`soft_constraint_violations` keys carry module prefixes set by each
    constraint helper. Roll them up into a per-module count so the dashboard
    can show which constraint families produced the most penalty terms.

    Known prefixes (as of 2026-05):
    - `must_satisfy_<cm_id>`             (must_satisfy.py)
    - `grade_ratio_<bunk>_grade_<grade>` (grade_ratio.py)
    - `level_regression_<p>_<b>`         (level_progression.py)
    - `age_spread_b<bunk>`               (age_spread.py)
    """

    def test_empty_dict_returns_empty(self) -> None:
        from bunking.solver.observability import _count_soft_constraints_by_module

        assert _count_soft_constraints_by_module({}) == {}

    def test_groups_keys_by_known_prefix(self) -> None:
        from bunking.solver.observability import _count_soft_constraints_by_module

        # Values don't matter — function only inspects keys
        violations: dict[str, object] = {
            "must_satisfy_12345": object(),
            "must_satisfy_67890": object(),
            "grade_ratio_0_grade_5": object(),
            "grade_ratio_1_grade_6": object(),
            "grade_ratio_2_grade_7": object(),
            "level_regression_0_0": object(),
            "age_spread_b0": object(),
            "age_spread_b1": object(),
        }
        result = _count_soft_constraints_by_module(violations)
        assert result == {
            "must_satisfy": 2,
            "grade_ratio": 3,
            "level_regression": 1,
            "age_spread": 2,
        }

    def test_unknown_prefix_lands_in_other(self) -> None:
        from bunking.solver.observability import _count_soft_constraints_by_module

        violations: dict[str, object] = {
            "some_future_constraint_42": object(),
            "must_satisfy_1": object(),
        }
        result = _count_soft_constraints_by_module(violations)
        assert result.get("must_satisfy") == 1
        assert result.get("other") == 1


class TestMaxLinearCoefficient:
    """Max absolute linear coefficient surfaces big-M modeling. Values >100K
    are a signal that the model has weak indicator-style constraints that
    LP relaxation can't tighten."""

    def test_empty_model_returns_zero(self) -> None:
        from bunking.solver.observability import _max_linear_coefficient

        model = cp_model.CpModel()
        assert _max_linear_coefficient(model.Proto()) == 0

    def test_finds_max_across_linear_constraints(self) -> None:
        from bunking.solver.observability import _max_linear_coefficient

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 1000, "x")
        y = model.NewIntVar(0, 1000, "y")
        model.Add(2 * x + 1000 * y <= 50_000)
        model.Add(3 * x + 7 * y >= 10)
        # Largest abs coefficient is 1000 (the 50_000 is the bound, not a coeff)
        assert _max_linear_coefficient(model.Proto()) == 1000

    def test_negative_coefficient_uses_absolute_value(self) -> None:
        from bunking.solver.observability import _max_linear_coefficient

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 100, "x")
        y = model.NewIntVar(0, 100, "y")
        model.Add(-50_000 * x + 3 * y <= 0)
        assert _max_linear_coefficient(model.Proto()) == 50_000

    def test_includes_reified_linear_constraints(self) -> None:
        from bunking.solver.observability import _max_linear_coefficient

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 100, "x")
        a = model.NewBoolVar("a")
        model.Add(250_000 * x <= 0).OnlyEnforceIf(a)
        assert _max_linear_coefficient(model.Proto()) == 250_000

    def test_ignores_non_linear_constraint_types(self) -> None:
        from bunking.solver.observability import _max_linear_coefficient

        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        model.AddBoolAnd([a, b])  # No coefficients to look at
        model.AddBoolOr([a, b])
        assert _max_linear_coefficient(model.Proto()) == 0


class TestImpossibleRequestBreakdownByReason:
    """`_validate_requests` already classifies impossible requests into three
    cases internally (target_not_in_solver / cross_session / malformed). The
    summary previously exposed only the total — now it must expose per-reason
    counts so the dashboard can show *why* requests are impossible.
    """

    def _make_input(
        self,
        persons: list[DirectPerson],
        requests: list[DirectBunkRequest],
        bunks: list[DirectBunk] | None = None,
    ) -> DirectSolverInput:
        if bunks is None:
            bunks = [
                DirectBunk(
                    id="bunk-1",
                    campminder_id=9001,
                    name="A",
                    capacity=10,
                    gender="Mixed",
                    session_cm_id=1000001,
                ),
                DirectBunk(
                    id="bunk-2",
                    campminder_id=9002,
                    name="B",
                    capacity=10,
                    gender="Mixed",
                    session_cm_id=1000002,
                ),
            ]
        return DirectSolverInput(persons=persons, requests=requests, bunks=bunks)

    def test_summary_includes_breakdown_dict(self) -> None:
        persons = [
            DirectPerson(
                campminder_person_id=1,
                first_name="A",
                last_name="X",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000001,
            ),
        ]
        input_data = self._make_input(persons, requests=[])
        solver = DirectBunkingSolver(input_data=input_data, config_service=MagicMock())
        # _validate_requests has been called in __init__
        breakdown = solver.request_validation_summary.get("impossible_by_reason")
        assert isinstance(breakdown, dict)
        assert breakdown == {
            "target_not_in_solver": 0,
            "cross_session": 0,
            "malformed": 0,
            "pair_no_shared_bunk": 0,
            "age_pref_no_eligible_grade": 0,
        }

    def test_target_not_in_solver_counted(self) -> None:
        persons = [
            DirectPerson(
                campminder_person_id=1,
                first_name="A",
                last_name="X",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000001,
            ),
        ]
        # Request targets person 9999 who does not exist in input.persons
        request = DirectBunkRequest(
            id="req-1",
            requester_person_cm_id=1,
            requested_person_cm_id=9999,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2026,
        )
        input_data = self._make_input(persons, requests=[request])
        solver = DirectBunkingSolver(input_data=input_data, config_service=MagicMock())
        breakdown = solver.request_validation_summary["impossible_by_reason"]
        assert breakdown["target_not_in_solver"] == 1
        assert breakdown["cross_session"] == 0
        assert breakdown["malformed"] == 0

    def test_cross_session_counted(self) -> None:
        persons = [
            DirectPerson(
                campminder_person_id=1,
                first_name="A",
                last_name="X",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000001,
            ),
            DirectPerson(
                campminder_person_id=2,
                first_name="B",
                last_name="Y",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000002,  # different session
            ),
        ]
        request = DirectBunkRequest(
            id="req-1",
            requester_person_cm_id=1,
            requested_person_cm_id=2,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2026,
        )
        input_data = self._make_input(persons, requests=[request])
        solver = DirectBunkingSolver(input_data=input_data, config_service=MagicMock())
        breakdown = solver.request_validation_summary["impossible_by_reason"]
        assert breakdown["cross_session"] == 1
        assert breakdown["target_not_in_solver"] == 0
        assert breakdown["malformed"] == 0

    def test_malformed_counted(self) -> None:
        persons = [
            DirectPerson(
                campminder_person_id=1,
                first_name="A",
                last_name="X",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000001,
            ),
        ]
        # bunk_with with empty requested_person_cm_id → malformed
        request = DirectBunkRequest(
            id="req-1",
            requester_person_cm_id=1,
            requested_person_cm_id=None,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2026,
        )
        input_data = self._make_input(persons, requests=[request])
        solver = DirectBunkingSolver(input_data=input_data, config_service=MagicMock())
        breakdown = solver.request_validation_summary["impossible_by_reason"]
        assert breakdown["malformed"] == 1
        assert breakdown["target_not_in_solver"] == 0
        assert breakdown["cross_session"] == 0

    def test_breakdown_sum_equals_total_impossible(self) -> None:
        persons = [
            DirectPerson(
                campminder_person_id=1,
                first_name="A",
                last_name="X",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000001,
            ),
            DirectPerson(
                campminder_person_id=2,
                first_name="B",
                last_name="Y",
                grade=8,
                birthdate="2014-01-01",
                gender="M",
                session_cm_id=1000002,
            ),
        ]
        requests = [
            # target_not_in_solver
            DirectBunkRequest(
                id="r1",
                requester_person_cm_id=1,
                requested_person_cm_id=9999,
                request_type="bunk_with",
                session_cm_id=1000001,
                year=2026,
            ),
            # cross_session
            DirectBunkRequest(
                id="r2",
                requester_person_cm_id=1,
                requested_person_cm_id=2,
                request_type="bunk_with",
                session_cm_id=1000001,
                year=2026,
            ),
            # malformed
            DirectBunkRequest(
                id="r3",
                requester_person_cm_id=1,
                requested_person_cm_id=None,
                request_type="bunk_with",
                session_cm_id=1000001,
                year=2026,
            ),
        ]
        input_data = self._make_input(persons, requests=requests)
        solver = DirectBunkingSolver(input_data=input_data, config_service=MagicMock())
        summary = solver.request_validation_summary
        breakdown = summary["impossible_by_reason"]
        assert sum(breakdown.values()) == summary["impossible_requests"]
        assert summary["impossible_requests"] == 3


class TestTier1MetricsInStatsDict:
    """The 5 new Tier 1 metrics (Stream 2) must land in `solver_runs.stats`.

    `_build_stats_dict` now accepts:
    - `soft_constraint_violations`: dict — to compute soft_by_module
    - `requests_by_person`: dict — to compute request density histogram
    - `request_validation_summary`: dict — pass-through with impossible_by_reason

    And emits:
    - `num_reified_linear`: int
    - `max_linear_coefficient`: int
    - `soft_constraints_by_module`: dict[str, int]
    - `request_density_histogram_by_bucket`: dict[str, dict[int, int]]
    - request_validation.impossible_by_reason: dict[str, int]  (via existing field)
    """

    def _base_mock_solver(self) -> MagicMock:
        solver = MagicMock()
        solver.StatusName.return_value = "OPTIMAL"
        solver.ObjectiveValue.return_value = 1.0
        solver.WallTime.return_value = 0.1
        solver.UserTime.return_value = 0.1
        solver.BestObjectiveBound.return_value = 1.0
        solver.NumBranches.return_value = 0
        solver.NumConflicts.return_value = 0
        solver.NumBooleans.return_value = 0
        solver.ResponseProto.return_value = MagicMock(
            gap_integral=None,
            deterministic_time=0.0,
            num_integers=0,
            additional_solutions=[],
            solution_info="",
        )
        return solver

    def test_emits_new_tier1_keys(self) -> None:
        from bunking.solver.observability import _build_stats_dict

        model = cp_model.CpModel()
        x = model.NewIntVar(0, 10, "x")
        a = model.NewBoolVar("a")
        model.Add(50_000 * x <= 100).OnlyEnforceIf(a)  # reified + big-M

        solver = self._base_mock_solver()
        violations = {
            "must_satisfy_1": object(),
            "must_satisfy_2": object(),
            "grade_ratio_0_grade_5": object(),
        }
        requests_by_person: dict[int, list[DirectBunkRequest]] = {
            1: [_make_req("r1", 1, "bunk_with")],
            2: [_make_req("r2", 2, "bunk_with"), _make_req("r3", 2, "bunk_with")],
        }
        stats = _build_stats_dict(
            solver=solver,
            status=4,  # OPTIMAL int — keep test stable across versions
            model_proto=model.Proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=2,
            num_bunks=1,
            num_requests=3,
            satisfied_count=0,
            soft_constraint_violations=violations,
            requests_by_person=requests_by_person,
        )

        assert stats["num_reified_linear"] == 1
        assert stats["max_linear_coefficient"] == 50_000
        assert stats["soft_constraints_by_module"] == {
            "must_satisfy": 2,
            "grade_ratio": 1,
        }
        assert stats["request_density_histogram_by_bucket"] == {
            "material_parent": {1: 1, 2: 1},
            "immaterial_parent": {},
            "staff": {},
        }

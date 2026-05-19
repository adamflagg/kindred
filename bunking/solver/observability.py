"""Solver-run observability: stats-dict construction and CP-SAT introspection.

Helpers that build the `solver_runs.stats` payload rendered by the Solver
Debug tab. Extracted from `direct_solver.py` (issue #1388) so Tier 1/Tier 2
metric helpers have a focused home as the dashboard grows.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger
from bunking.models_v2 import DirectBunkRequest
from bunking.satisfaction.bucket import RequestBucket, classify_request

logger = get_logger(__name__)


# Known CP-SAT constraint oneof variants. The pybind wrapper exposes
# ``has_<name>()`` methods rather than the older protobuf ``WhichOneof``.
_CONSTRAINT_TYPES = (
    "bool_and",
    "bool_or",
    "bool_xor",
    "linear",
    "all_diff",
    "at_most_one",
    "exactly_one",
    "automaton",
    "circuit",
    "cumulative",
    "dummy_constraint",
    "element",
    "int_div",
    "int_mod",
    "int_prod",
    "interval",
    "inverse",
    "lin_max",
    "no_overlap",
    "no_overlap_2d",
    "reservoir",
    "routes",
    "table",
)


def _count_constraint_types(proto: Any) -> dict[str, int]:
    """Count CP-SAT model constraints grouped by their oneof type name.

    Used both for INFEASIBLE diagnostics and for the always-on stats capture
    that surfaces in the solver debug tab. Constraints whose oneof type isn't
    in ``_CONSTRAINT_TYPES`` (e.g. a future OR-Tools upgrade) land in an
    ``"unknown"`` bucket so ``sum(counts.values()) == len(proto.constraints)``
    holds — the impact-analysis breakdown never silently shrinks.
    """
    counts: dict[str, int] = {}
    for c in proto.constraints:
        matched = False
        for kind in _CONSTRAINT_TYPES:
            checker = getattr(c, f"has_{kind}", None)
            if callable(checker) and checker():
                counts[kind] = counts.get(kind, 0) + 1
                matched = True
                break
        if not matched:
            counts["unknown"] = counts.get("unknown", 0) + 1
    return counts


def _compute_optimality_gap(objective: float | None, best_bound: float | None) -> float | None:
    """Relative gap between solution and proven best bound.

    Returns ``|obj - bound| / max(|obj|, 1)`` as a float in ``[0, ∞)``,
    or ``None`` if either input is ``None``. The frontend formats as percent.
    """
    if objective is None or best_bound is None:
        return None
    return abs(objective - best_bound) / max(abs(objective), 1.0)


def _count_presolve_compression(model_proto: Any, solver: Any) -> dict[str, Any]:
    """Pre-presolve vs post-presolve boolean-variable counts.

    Pre = model-proto variables whose domain is exactly ``[0, 1]`` (the
    booleans the model was *built* with). Post = ``solver.NumBooleans()``
    (booleans the SAT core actually works on, after presolve). ``ratio`` =
    post / pre — lower means presolve eliminated more redundancy, which is
    the Stream 3 (variable-count attack) target signal. ``ratio`` is
    ``None`` when the model has no booleans (avoids div-by-zero).
    """
    booleans_pre = sum(1 for v in model_proto.variables if list(v.domain) == [0, 1])
    booleans_post = solver.NumBooleans()
    ratio = (booleans_post / booleans_pre) if booleans_pre > 0 else None
    return {"presolve_compression_ratio": ratio, "presolve_booleans_pre": booleans_pre}


def _lp_root_gap(bound_trajectory: list[dict[str, float]], objective: float | None) -> float | None:
    """Relative gap between the root LP bound and the final objective.

    The first ``best_bound_callback`` value (``bound_trajectory[0]``) is the
    earliest proven bound — CP-SAT computes it after presolve + the root LP
    relaxation, before B&B opens any nodes — so it is a good proxy for the
    root LP bound. The gap against the final objective is the relaxation's
    quality, independent of the time budget. ``None`` if the trajectory is
    empty (no bound was ever reported).

    The "first point ≈ root LP bound" approximation relies on a
    callback-ordering assumption — that the caller wires ``BestBoundCallback``
    before ``Solve()`` and it fires once at the root before branching — which
    this function cannot itself verify; it is not a model-level guarantee.
    """
    if not bound_trajectory:
        return None
    return _compute_optimality_gap(objective, bound_trajectory[0]["bound"])


def _derive_plateau_scalars(
    objective_trajectory: list[dict[str, float]],
    bound_trajectory: list[dict[str, float]],
) -> dict[str, float | None]:
    """Comparable scalars distilled from the raw trajectories.

    - ``objective_plateau_time``: ``t`` of the last objective improvement.
      Low vs. the time budget = the solver stopped finding better solutions
      early.
    - ``bound_gain_after_plateau``: absolute bound movement *after* the last
      solution. ~0 = fully stuck; large = the solver kept working the bound
      even though the objective was flat. Absolute value so it is correct
      regardless of min/max objective sense (the bound is monotonic).
    - ``time_to_first_solution``: ``t`` of the first solution. Long = the
      model was hard to even make feasible.

    All ``None`` when ``objective_trajectory`` is empty (INFEASIBLE / no
    solution / single-bunk path).
    """
    if not objective_trajectory:
        return {
            "objective_plateau_time": None,
            "bound_gain_after_plateau": None,
            "time_to_first_solution": None,
        }
    first = objective_trajectory[0]
    last = objective_trajectory[-1]
    final_bound = bound_trajectory[-1]["bound"] if bound_trajectory else last["bound"]
    return {
        "objective_plateau_time": last["t"],
        "bound_gain_after_plateau": abs(final_bound - last["bound"]),
        "time_to_first_solution": first["t"],
    }


def _is_linear_constraint(c: Any) -> bool:
    """True if the constraint proto is a linear constraint.

    Uses the ``has_linear()`` accessor exposed by ortools' wrapped protobuf,
    matching the pattern used by :func:`_count_constraint_types`.
    """
    checker = getattr(c, "has_linear", None)
    return bool(callable(checker) and checker())


def _count_reified_linear_constraints(proto: Any) -> int:
    """Count linear constraints with non-empty enforcement_literal.

    Stage 4 of Stream 1 (hard MSO) cuts ~164 reified-linear constraints from
    the S2 model. Without this metric in `solver_runs.stats` the
    simplification wins are invisible on the dashboard.
    """
    return sum(1 for c in proto.constraints if _is_linear_constraint(c) and len(c.enforcement_literal) > 0)


# Soft-constraint key prefixes set by each constraint helper. New constraint
# modules should append a (prefix, module-label) pair here so they roll up
# correctly. Keys whose prefix doesn't match any entry fall into "other".
_SOFT_CONSTRAINT_PREFIXES: tuple[tuple[str, str], ...] = (
    ("must_satisfy_", "must_satisfy"),
    ("grade_ratio_", "grade_ratio"),
    ("level_regression_", "level_regression"),
    ("age_spread_b", "age_spread"),
)


_MODULE_LABELS: tuple[str, ...] = ("must_satisfy", "grade_ratio", "level_regression", "age_spread", "other")


def _classify_bucket(name: str) -> str:
    for prefix, label in _SOFT_CONSTRAINT_PREFIXES:
        if name.startswith(prefix):
            return label
    return "other"


def _bucket_soft_constraint_violations(
    solver: Any,
    violations: dict[str, Any],
) -> tuple[dict[str, int], dict[str, int]]:
    """Bucket soft-constraint violation vars by module prefix.

    Returns ``(fires_by_module, penalty_total_by_module)``. Both dicts are
    keyed by ``_MODULE_LABELS`` and pre-seeded to 0 so missing-vs-zero is
    unambiguous downstream. ``solver=None`` is the single-bunk path: the
    CP-SAT model never runs, so both dicts come back all-zero.

    Replaces the previous ``_count_soft_constraints_by_module`` (which
    counted dict keys = vars created at model-build time, not fires
    honored in the final solution; cf. #1532).
    """
    fires: dict[str, int] = dict.fromkeys(_MODULE_LABELS, 0)
    penalty_totals: dict[str, int] = dict.fromkeys(_MODULE_LABELS, 0)
    if solver is None or not violations:
        return fires, penalty_totals
    for name, (var, penalty) in violations.items():
        bucket = _classify_bucket(name)
        value = int(solver.Value(var))
        fires[bucket] += value
        penalty_totals[bucket] += penalty * value
    return fires, penalty_totals


def _max_linear_coefficient(proto: Any) -> int:
    """Max absolute linear coefficient across all linear constraints (plain
    and reified). Values >100K signal big-M modeling; weak LP relaxation."""
    max_coef = 0
    for c in proto.constraints:
        if _is_linear_constraint(c):
            for coef in c.linear.coeffs:
                abs_coef = abs(coef)
                if abs_coef > max_coef:
                    max_coef = abs_coef
    return max_coef


def _build_request_density_histogram_by_bucket(
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[str, dict[int, int]]:
    """Per-bucket histogram of (request_count -> camper_count).

    For each (camper, bucket) pair where the camper has >= 1 request of that
    bucket, increments result[bucket][N] where N is the camper's request count
    in that bucket. All three RequestBucket keys are always present; empty
    buckets are {}. Requests with a missing or unknown source_field are dropped
    with a DEBUG log.
    """
    result: dict[str, dict[int, int]] = {
        RequestBucket.MATERIAL_PARENT.value: {},
        RequestBucket.IMMATERIAL_PARENT.value: {},
        RequestBucket.STAFF.value: {},
    }
    for reqs in requests_by_person.values():
        per_bucket: dict[str, int] = {}
        for req in reqs:
            sf = req.source_field
            if not sf:
                logger.debug("density histogram: request %s has no source_field — skipping", req.id)
                continue
            try:
                bucket = classify_request(sf)
            except ValueError:
                logger.debug("density histogram: unknown source_field %r on request %s — skipping", sf, req.id)
                continue
            per_bucket[bucket.value] = per_bucket.get(bucket.value, 0) + 1
        for bucket_key, count in per_bucket.items():
            result[bucket_key][count] = result[bucket_key].get(count, 0) + 1
    return result


def _build_impossible_by_reason_by_bucket(
    impossible_by_request: Iterable[tuple[DirectBunkRequest, str]],
) -> dict[str, dict[str, int]]:
    """Bucket-outer breakdown of impossible requests by reason code.

    Takes (request, reason_code) pairs. A request may appear multiple times
    with different reason codes — impossibility.validate_impossibility's Layer 2
    records a request under every matching per-pair predicate — and each pair is
    counted independently (matches the non-deduped flat-count behaviour). All
    three RequestBucket keys are always present; empty buckets are {}. Requests
    with a missing or unknown source_field are dropped with a DEBUG log.
    """
    result: dict[str, dict[str, int]] = {
        RequestBucket.MATERIAL_PARENT.value: {},
        RequestBucket.IMMATERIAL_PARENT.value: {},
        RequestBucket.STAFF.value: {},
    }
    for req, reason_code in impossible_by_request:
        sf = req.source_field
        if not sf:
            logger.debug("impossible-by-reason: request %s has no source_field — skipping", req.id)
            continue
        try:
            bucket = classify_request(sf)
        except ValueError:
            logger.debug("impossible-by-reason: unknown source_field %r on request %s — skipping", sf, req.id)
            continue
        reasons = result[bucket.value]
        reasons[reason_code] = reasons.get(reason_code, 0) + 1
    return result


def _build_stats_dict(
    solver: Any,
    status: Any,  # `cp_model.CpSolverStatus` enum at runtime; cast to int for JSON
    model_proto: Any,
    time_limit_seconds: int,
    num_workers: int,
    num_persons: int,
    num_bunks: int,
    num_requests: int,
    satisfied_count: int,
    *,
    soft_constraint_violations: dict[str, Any] | None = None,
    requests_by_person: dict[int, list[DirectBunkRequest]] | None = None,
    objective_trajectory: list[dict[str, float]] | None = None,
    bound_trajectory: list[dict[str, float]] | None = None,
    bound_trajectory_truncated: bool = False,
    objective_trajectory_truncated: bool = False,
) -> dict[str, Any]:
    """Build the full stats dict captured per solver run.

    Core CP-SAT internals (``deterministic_time``, ``num_integers``,
    ``additional_solutions``) are read directly from the response proto — if
    OR-Tools renames them again, we want a loud ``AttributeError`` over silent
    null data. Peripheral PascalCase methods (``UserTime``,
    ``BestObjectiveBound``) and optional proto fields (``gap_integral``,
    ``solution_info``) keep ``getattr`` guards because losing them is recoverable.
    The dict round-trips through ``solver_runs.stats`` and is rendered by the
    solver debug tab.
    """
    response_proto = solver.ResponseProto()
    objective = solver.ObjectiveValue()
    best_bound = getattr(solver, "BestObjectiveBound", lambda: None)()
    solution_info = getattr(response_proto, "solution_info", None) or None
    # ortools 9.15 dropped PascalCase `DeterministicTime` / `NumIntegers` on
    # CpSolver and `num_solutions` on the response proto. Read snake_case proto
    # fields directly — if a future bump drops these too we want a loud
    # AttributeError, not the silent-None data loss this replaces.
    deterministic_time = response_proto.deterministic_time
    num_integers = response_proto.num_integers
    has_solution = int(status) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    num_solutions_found = (1 + len(response_proto.additional_solutions)) if has_solution else 0

    objective_trajectory = objective_trajectory or []
    bound_trajectory = bound_trajectory or []

    fires_by_module, penalty_by_module = _bucket_soft_constraint_violations(solver, soft_constraint_violations or {})

    return {
        # Existing back-compat fields
        "status": solver.StatusName(status),
        # int() cast: real OR-Tools returns a `CpSolverStatus` enum from
        # `solver.Solve(...)`, which json.dumps cannot encode — the row save
        # to solver_runs.stats fails on every successful run otherwise.
        "status_code": int(status),
        "objective_value": objective,
        "solve_time": solver.WallTime(),
        "total_persons": num_persons,
        "total_bunks": num_bunks,
        "total_requests": num_requests,
        "satisfied_request_count": satisfied_count,
        # Timing
        "walltime_seconds": solver.WallTime(),
        "user_time_seconds": getattr(solver, "UserTime", lambda: None)(),
        "deterministic_time": deterministic_time,
        "time_budget_seconds": time_limit_seconds,
        "num_workers": num_workers,
        # Quality
        "best_objective_bound": best_bound,
        "optimality_gap": _compute_optimality_gap(objective, best_bound),
        "gap_integral": getattr(response_proto, "gap_integral", None),
        "num_solutions_found": num_solutions_found,
        "solution_info": solution_info,
        # Search
        "num_branches": solver.NumBranches(),
        "num_conflicts": solver.NumConflicts(),
        "num_booleans": solver.NumBooleans(),
        "num_integer_variables": num_integers,
        # Model
        "model_num_variables": len(model_proto.variables),
        "model_num_constraints": len(model_proto.constraints),
        "constraint_type_breakdown": _count_constraint_types(model_proto),
        # Tier 1 observability (Stream 2, issue #1380)
        "num_reified_linear": _count_reified_linear_constraints(model_proto),
        "max_linear_coefficient": _max_linear_coefficient(model_proto),
        "soft_constraints_by_module": fires_by_module,
        "soft_constraint_penalty_by_module": penalty_by_module,
        "request_density_histogram_by_bucket": _build_request_density_histogram_by_bucket(requests_by_person or {}),
        # Tier 2 observability (Stream 2, Phase 2 — plateau-diagnostic metrics)
        "objective_trajectory": objective_trajectory,
        "bound_trajectory": bound_trajectory,
        "bound_trajectory_truncated": bound_trajectory_truncated,
        "objective_trajectory_truncated": objective_trajectory_truncated,
        "lp_root_gap": _lp_root_gap(bound_trajectory, objective),
        **_count_presolve_compression(model_proto, solver),
        **_derive_plateau_scalars(objective_trajectory, bound_trajectory),
    }

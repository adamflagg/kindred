"""
Direct Bunking Solver - works directly with bunk_requests data.
No transformation needed.
"""

from __future__ import annotations

import os
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.models_v2 import (
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectSolverInput,
    DirectSolverOutput,
)
from bunking.satisfaction.bucket import is_material_parent_request
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SOURCE_FIELD_TO_CONFIG_KEY
from campminder.client import get_current_season

from .callbacks import SolverProgressCallback
from .constraints.age_grade_flow import add_age_grade_flow_objective
from .constraints.age_spread import add_age_spread_constraints
from .constraints.base import SolverContext
from .constraints.cabin_occupancy import (
    add_cabin_minimum_occupancy_constraints,
    add_cabin_minimum_occupancy_soft_penalty,
)
from .constraints.gender import add_gender_constraints
from .constraints.grade_adjacency import add_grade_adjacency_constraints
from .constraints.grade_ratio import add_grade_ratio_constraints
from .constraints.grade_spread import add_grade_spread_constraints, add_grade_spread_soft_constraint
from .constraints.group_locks import add_group_lock_constraints
from .constraints.level_progression import add_level_progression_constraints
from .constraints.parent_paramount import add_must_satisfy_one_request_constraints
from .feasibility import check_feasibility as _check_feasibility
from .feasibility import find_infeasibility_cause as _find_infeasibility_cause
from .logging import ConstraintLogger
from .solution import analyze_solution, calculate_satisfied_requests

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


def _count_soft_constraints_by_module(violations: dict[str, Any]) -> dict[str, int]:
    """Group `soft_constraint_violations` keys by constraint module prefix.

    The dashboard uses this to show which constraint families dominate the
    penalty surface — e.g. `grade_ratio=420` vs `must_satisfy=83` tells a
    very different optimization story.
    """
    result: dict[str, int] = {}
    for key in violations:
        bucket = "other"
        for prefix, label in _SOFT_CONSTRAINT_PREFIXES:
            if key.startswith(prefix):
                bucket = label
                break
        result[bucket] = result.get(bucket, 0) + 1
    return result


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


def _build_request_density_histogram(
    requests_by_person: dict[int, list[Any]],
) -> dict[int, int]:
    """Histogram of (request_count -> camper_count).

    Excludes campers with zero requests — they're the silent majority and
    aren't useful signal. The interesting tail is single-request campers
    (the stuck-core cohort from the S2 sweep)."""
    result: dict[int, int] = {}
    for reqs in requests_by_person.values():
        count = len(reqs)
        if count == 0:
            continue
        result[count] = result.get(count, 0) + 1
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
    requests_by_person: dict[int, list[Any]] | None = None,
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
        "soft_constraints_by_module": _count_soft_constraints_by_module(soft_constraint_violations or {}),
        "request_density_histogram": _build_request_density_histogram(requests_by_person or {}),
    }


class DirectBunkingSolver:
    """Solver that works directly with bunk_requests table data."""

    def __init__(
        self,
        input_data: DirectSolverInput,
        config_service: ConfigLoader,
        debug_constraints: dict[str, bool] | None = None,
    ):
        self.input = input_data
        self.config = config_service
        self.model = cp_model.CpModel()
        self.debug_constraints = debug_constraints or {}  # Dict of constraint names to disable

        # Debug mode from SOLVER_LOG_LEVEL env var (consolidates solver.debug.enabled and log_level)
        solver_log_level = os.getenv("SOLVER_LOG_LEVEL", "INFO").upper()
        self.debug_mode = solver_log_level == "DEBUG"
        self.constraint_logger = ConstraintLogger(debug_mode=self.debug_mode)

        # Create person ID mapping for solver variables
        self.person_ids = sorted([p.campminder_person_id for p in self.input.persons])
        self.person_idx_map = {pid: idx for idx, pid in enumerate(self.person_ids)}

        # Create bunk mapping
        self.bunks = sorted(self.input.bunks, key=lambda b: b.name)
        self.bunk_idx_map = {b.campminder_id: idx for idx, b in enumerate(self.bunks)}

        # Decision variables: person_idx -> bunk_idx
        self.assignments = {}
        for person_idx in range(len(self.person_ids)):
            for bunk_idx in range(len(self.bunks)):
                self.assignments[(person_idx, bunk_idx)] = self.model.NewBoolVar(
                    f"person_{person_idx}_in_bunk_{bunk_idx}"
                )

        # Also create integer variables representing which bunk each person is in
        # This allows for direct comparison in bunk_with/not_bunk_with constraints
        self.person_bunk_assignment = {}
        for person_idx in range(len(self.person_ids)):
            self.person_bunk_assignment[person_idx] = self.model.NewIntVar(
                0, len(self.bunks) - 1, f"person_{person_idx}_bunk"
            )
            # Link the integer variable to the boolean assignments
            # person_bunk_assignment[i] == j iff assignments[(i,j)] == 1
            for bunk_idx in range(len(self.bunks)):
                self.model.Add(self.person_bunk_assignment[person_idx] == bunk_idx).OnlyEnforceIf(
                    self.assignments[(person_idx, bunk_idx)]
                )

        # Track soft constraint violations for penalty-based optimization
        self.soft_constraint_violations: dict[str, tuple[cp_model.IntVar, int]] = {}
        # Track soft constraint bonuses (rewards for good configurations)
        self.soft_constraint_bonuses: dict[str, tuple[cp_model.IntVar, int]] = {}
        # Track campers whose entire MP request set was impossible — populated by
        # parent_paramount's hard constraint pass; surfaced post-solve into stats.
        self.mp_set_entirely_impossible: list[int] = []

        # Limit debug logging for pair reduction (only first 5 pairs)
        self._pair_reduction_logged = 0

        # Validate requests and categorize as possible/impossible
        self.possible_requests: dict[int, list[DirectBunkRequest]] = {}  # person_cm_id -> list of possible requests
        self.impossible_requests: dict[int, list[DirectBunkRequest]] = {}  # person_cm_id -> list of impossible requests
        self._validate_requests()

    def _build_solver_context(self) -> SolverContext:
        """Build a SolverContext from current solver state.

        This allows extracted constraint modules to access solver state
        in a structured way without tight coupling to the solver class.
        """
        # Build requests_by_person from input
        requests_by_person: dict[int, list[DirectBunkRequest]] = {}
        for request in self.input.requests:
            cm_id = request.requester_person_cm_id
            if cm_id not in requests_by_person:
                requests_by_person[cm_id] = []
            requests_by_person[cm_id].append(request)

        return SolverContext(
            model=self.model,
            assignments=self.assignments,
            person_bunk_assignment=self.person_bunk_assignment,
            person_ids=self.person_ids,
            person_idx_map=self.person_idx_map,
            persons=list(self.input.persons),
            person_by_cm_id=self.input.person_by_cm_id,
            bunks=self.bunks,
            bunk_idx_map=self.bunk_idx_map,
            requests_by_person=requests_by_person,
            possible_requests=self.possible_requests,
            impossible_requests=self.impossible_requests,
            input=self.input,
            config=self.config,
            constraint_logger=self.constraint_logger,
            debug_constraints=self.debug_constraints,
            soft_constraint_violations=self.soft_constraint_violations,
            soft_constraint_bonuses=self.soft_constraint_bonuses,
            mp_set_entirely_impossible=self.mp_set_entirely_impossible,
        )

    def _session_grade_bounds_for_gender(self, session_cm_id: int, gender: str) -> tuple[int, int] | None:
        """Return (min_grade, max_grade) among same-gender campers in the session.

        AG cabins don't enter — gender is the person attribute (M or F);
        AG is a bunk attribute. Returns None if no same-gender campers exist
        in the session (defensive; shouldn't happen for a real request).

        Used by _validate_requests to gate age_preference requests at grade
        bounds where camp policy considers them moot (e.g. oldest-grade
        camper prefers older → no older peers exist → impossible). The
        lone-gender case is naturally caught: grades=[my_grade], min==max,
        so any preference resolves at-bound.

        A follow-up issue tracks switching this to admin-GUI-configured
        min/max grade bounds; this scan-the-pool fallback is the interim.
        """
        grades = [
            p.grade
            for p in self.input.persons
            if p.session_cm_id == session_cm_id and p.gender == gender and p.grade is not None
        ]
        if not grades:
            return None
        return min(grades), max(grades)

    def _pair_has_shared_bunk(self, person1_idx: int, person2_idx: int) -> bool:
        """Return True if the two persons can co-occupy at least one bunk.

        Checks session compatibility and gender compatibility. Short-circuits
        on first match. Used by _validate_requests to reject bunk_with requests
        that no placement could ever satisfy (e.g. cross-gender with no AG bunk).
        """
        person1 = self.input.person_by_cm_id[self.person_ids[person1_idx]]
        person2 = self.input.person_by_cm_id[self.person_ids[person2_idx]]

        if person1.session_cm_id != person2.session_cm_id:
            return False

        for bunk in self.bunks:
            if bunk.session_cm_id != person1.session_cm_id:
                continue
            if bunk.gender in ("Mixed", "AG"):
                return True
            if bunk.gender and person1.gender == bunk.gender and person2.gender == bunk.gender:
                return True

        return False

    def _get_valid_bunks_for_pair(self, person1_idx: int, person2_idx: int) -> list[int]:
        """Get list of bunk indices where both campers can be validly assigned.

        Filters by:
        - Session compatibility (both must be in same session)
        - Gender compatibility (both must match bunk gender or bunk is Mixed)

        This dramatically reduces the search space for bunk_with/not_bunk_with constraints.
        """
        person1_cm_id = self.person_ids[person1_idx]
        person2_cm_id = self.person_ids[person2_idx]

        person1 = self.input.person_by_cm_id[person1_cm_id]
        person2 = self.input.person_by_cm_id[person2_cm_id]

        # They must be in the same session to bunk together
        if person1.session_cm_id != person2.session_cm_id:
            return []

        session_id = person1.session_cm_id

        valid_bunks = []
        for bunk_idx, bunk in enumerate(self.bunks):
            # Bunk must be in their session
            if bunk.session_cm_id != session_id:
                continue

            # Check gender compatibility
            if bunk.gender in ["Mixed", "AG"]:
                # Mixed/AG bunks accept anyone
                valid_bunks.append(bunk_idx)
            elif bunk.gender:
                # Single-gender bunk - both campers must match
                if person1.gender == bunk.gender and person2.gender == bunk.gender:
                    valid_bunks.append(bunk_idx)
            # If bunk has no gender specified, skip it (shouldn't happen)

        # Log reduction for debugging (only first few times)
        if self._pair_reduction_logged < 5:
            logger.debug(
                f"Valid bunks for pair {person1_cm_id}-{person2_cm_id} "
                f"(session {session_id}, genders {person1.gender}/{person2.gender}): "
                f"{len(valid_bunks)}/{len(self.bunks)} bunks"
            )
            self._pair_reduction_logged += 1

        return valid_bunks

    def _validate_requests(self) -> None:
        """Validate requests and categorize as possible or impossible.

        Impossible cases:
        - Requested person is not in the solver at all
        - bunk_with targeting a person in a different session (session boundaries
          prevent sharing a bunk). not_bunk_with across sessions is still possible
          since separation is guaranteed by session boundaries.
        - bunk_with or not_bunk_with request with no requested_person_cm_id
          (malformed request)
        """
        person_by_cm_id = self.input.person_by_cm_id
        total_requests = 0
        impossible_count = 0
        affected_campers = set()
        impossible_by_reason = {
            "target_not_in_solver": 0,
            "cross_session": 0,
            "malformed": 0,
            "pair_no_shared_bunk": 0,
            "age_pref_no_eligible_grade": 0,
        }

        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in self.person_idx_map:
                continue  # Skip if person not in session

            self.possible_requests[person_cm_id] = []
            self.impossible_requests[person_cm_id] = []

            for request in requests:
                total_requests += 1

                # Check if this is a request that references another person
                if request.request_type in [RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value]:
                    if request.requested_person_cm_id:
                        if request.requested_person_cm_id not in self.person_idx_map:
                            # Requested person not in solver at all
                            self.impossible_requests[person_cm_id].append(request)
                            impossible_count += 1
                            impossible_by_reason["target_not_in_solver"] += 1
                            affected_campers.add(person_cm_id)
                        elif (
                            request.request_type == RequestType.BUNK_WITH.value
                            and person_by_cm_id[person_cm_id].session_cm_id
                            != person_by_cm_id[request.requested_person_cm_id].session_cm_id
                        ):
                            # bunk_with across sessions is impossible — session
                            # boundary constraints prevent sharing a bunk.
                            # (not_bunk_with across sessions is trivially satisfied.)
                            self.impossible_requests[person_cm_id].append(request)
                            impossible_count += 1
                            impossible_by_reason["cross_session"] += 1
                            affected_campers.add(person_cm_id)
                        elif request.request_type == RequestType.BUNK_WITH.value and not self._pair_has_shared_bunk(
                            self.person_idx_map[person_cm_id],
                            self.person_idx_map[request.requested_person_cm_id],
                        ):
                            # bunk_with where no bunk is gender-compatible for both
                            # campers is impossible. Without this gate, a hard MP
                            # constraint (Stage 4) would force co-placement that
                            # gender constraints forbid → INFEASIBLE.
                            # (not_bunk_with is trivially satisfied when no shared
                            # bunk exists, so we keep it possible.)
                            self.impossible_requests[person_cm_id].append(request)
                            impossible_count += 1
                            impossible_by_reason["pair_no_shared_bunk"] += 1
                            affected_campers.add(person_cm_id)
                        else:
                            self.possible_requests[person_cm_id].append(request)
                    else:
                        # No requested person specified - treat as impossible
                        self.impossible_requests[person_cm_id].append(request)
                        impossible_count += 1
                        impossible_by_reason["malformed"] += 1
                elif request.request_type == RequestType.AGE_PREFERENCE.value:
                    # age_preference at the same-gender grade bound (in the wrong
                    # direction) is impossible per camp policy: if you're the
                    # oldest grade and prefer older, "too bad" — there are no
                    # older peers. Same for youngest-prefers-younger. Without
                    # this gate, a hard MP constraint (Stage 4) for an at-bound
                    # camper has no satisfiable assignment → INFEASIBLE.
                    #
                    # Scan-the-pool fallback: bounds are derived from the
                    # session's same-gender camper pool. A follow-up issue
                    # will switch this to admin-GUI-configured min/max grades.
                    requester = person_by_cm_id[person_cm_id]
                    target = request.age_preference_target
                    impossible = False
                    if requester.gender and requester.grade is not None and target in ("older", "younger"):
                        bounds = self._session_grade_bounds_for_gender(requester.session_cm_id, requester.gender)
                        if bounds is None:
                            impossible = True
                        else:
                            min_g, max_g = bounds
                            if (target == "older" and requester.grade >= max_g) or (
                                target == "younger" and requester.grade <= min_g
                            ):
                                impossible = True

                    if impossible:
                        self.impossible_requests[person_cm_id].append(request)
                        impossible_count += 1
                        impossible_by_reason["age_pref_no_eligible_grade"] += 1
                        affected_campers.add(person_cm_id)
                    else:
                        self.possible_requests[person_cm_id].append(request)
                else:
                    # Other request types are always possible
                    self.possible_requests[person_cm_id].append(request)

        # Log validation results — break out the per-reason count instead of a
        # static enumeration so new reasons (e.g. pair_no_shared_bunk,
        # age_pref_no_eligible_grade) show up without further log edits.
        if impossible_count > 0:
            reason_summary = ", ".join(f"{k}={v}" for k, v in impossible_by_reason.items() if v > 0)
            logger.warning(
                f"Request validation: {impossible_count} of {total_requests} requests are infeasible ({reason_summary})"
            )
            logger.warning(f"Affected campers: {len(affected_campers)}")

            # Log details for debugging
            if self.debug_mode:
                logger.debug("Impossible requests by camper:")
                for person_cm_id in list(affected_campers)[:10]:  # Show first 10
                    person = person_by_cm_id[person_cm_id]
                    impossible_reqs = self.impossible_requests[person_cm_id]
                    for req in impossible_reqs:
                        if req.requested_person_cm_id and req.requested_person_cm_id in self.person_idx_map:
                            reason = "different session"
                        else:
                            reason = "not in solver"
                        logger.debug(
                            f"  - {person.name}: {req.request_type} request for "
                            f"ID {req.requested_person_cm_id} ({reason})"
                        )

        # Store summary for later use
        self.request_validation_summary: dict[str, Any] = {
            "total_requests": total_requests,
            "possible_requests": total_requests - impossible_count,
            "impossible_requests": impossible_count,
            "affected_campers": len(affected_campers),
            "impossible_by_reason": impossible_by_reason,
        }

    def check_feasibility(self) -> None:
        """Perform pre-solve feasibility checks and log warnings."""
        _check_feasibility(
            bunks=self.bunks,
            person_ids=self.person_ids,
            input_data=self.input,
            constraint_logger=self.constraint_logger,
            person_idx_map=self.person_idx_map,
            possible_requests=self.possible_requests,
            impossible_requests=self.impossible_requests,
            request_validation_summary=self.request_validation_summary,
        )

    def add_constraints(self) -> None:
        """Add all constraints to the model."""
        # 1. Each person assigned to exactly one bunk
        if not self.debug_constraints.get("assignment", False):
            self.constraint_logger.log_constraint(
                "hard", "assignment", f"Each of {len(self.person_ids)} campers must be assigned to exactly one bunk"
            )
            for person_idx in range(len(self.person_ids)):
                self.model.Add(
                    sum(self.assignments[(person_idx, bunk_idx)] for bunk_idx in range(len(self.bunks))) == 1
                )
        else:
            logger.warning("DEBUG: Assignment constraints DISABLED")

        # 2. Session boundary constraints - campers can only be assigned to bunks in their session
        if not self.debug_constraints.get("session_boundary", False):
            self.constraint_logger.log_constraint(
                "hard", "session_boundary", "Campers can only be assigned to bunks within their enrolled session"
            )
            for person_idx, person_cm_id in enumerate(self.person_ids):
                person = self.input.person_by_cm_id[person_cm_id]
                person_session = person.session_cm_id

                for bunk_idx, bunk in enumerate(self.bunks):
                    # If bunk is not in the person's session, prohibit assignment
                    if bunk.session_cm_id != person_session:
                        self.model.Add(self.assignments[(person_idx, bunk_idx)] == 0)
        else:
            logger.warning("DEBUG: Session boundary constraints DISABLED")

        # 3. Bunk capacity constraints — hard cap at bunk.capacity (always 12
        # via DEFAULT_BUNK_CAPACITY today; future per-bunk variance lives here).
        self.constraint_logger.log_constraint(
            "hard", "cabin_capacity", f"Cabin capacity constraints for {len(self.bunks)} bunks"
        )
        for bunk_idx, bunk in enumerate(self.bunks):
            self.model.Add(
                sum(self.assignments[(person_idx, bunk_idx)] for person_idx in range(len(self.person_ids)))
                <= bunk.capacity
            )

        # 3.5. Minimum occupancy constraint for non-AG bunks
        # Staff never put fewer than ~8 campers in a cabin
        ctx = self._build_solver_context()
        self.bunk_is_used = add_cabin_minimum_occupancy_constraints(ctx)

        # 4. Group locks
        # Uses extracted constraint module - debug check is internal
        add_group_lock_constraints(self._build_solver_context())

        # 6. Grade/age spread constraints - NOW ENABLED with aggregation
        # Check if grade spread should be hard or soft constraint
        grade_spread_mode = self.config.get_str("constraint.grade_spread.mode", default="hard")
        logger.debug(f"Grade spread mode from config: '{grade_spread_mode}'")
        if grade_spread_mode == "hard":
            # Uses extracted constraint module - debug check is internal
            add_grade_spread_constraints(self._build_solver_context())
        else:
            logger.debug("Grade spread will be handled as SOFT constraint in objective function")
        # If soft, it will be handled in the objective function

        # 7. Grade ratio percentage constraints
        # Uses extracted constraint module - debug check is internal
        add_grade_ratio_constraints(self._build_solver_context())

        # 7b. Grade adjacency constraints - penalize non-adjacent grades in bunks
        # Uses extracted constraint module - debug check is internal
        add_grade_adjacency_constraints(self._build_solver_context())

        # 8. Age spread soft constraints - NOW ENABLED with aggregation
        # Uses extracted constraint module - debug check is internal
        add_age_spread_constraints(self._build_solver_context())

        # 10. Must satisfy one request constraints
        # Uses extracted constraint module - debug check is internal
        add_must_satisfy_one_request_constraints(self._build_solver_context())

        # 11. Level progression constraints
        # Uses extracted constraint module - debug check is internal
        add_level_progression_constraints(self._build_solver_context())

        # 12. Gender constraints - CRITICAL for safety
        # Uses extracted constraint module - debug check is internal
        add_gender_constraints(self._build_solver_context())

    def _get_csv_field_multiplier(self, request: DirectBunkRequest) -> float:
        """Get the appropriate multiplier based on source field.

        Maps canonical SourceField values to config keys for lookup.
        """
        if hasattr(request, "source_field") and request.source_field:
            config_key = SOURCE_FIELD_TO_CONFIG_KEY.get(request.source_field)
            if config_key:
                return self.config.get_float(f"objective.source_multipliers.{config_key}", default=1.0)
            logger.warning(f"Unknown source_field value not in SOURCE_FIELD_TO_CONFIG_KEY: {request.source_field!r}")

        # Default multiplier
        return 1.0

    def add_objective(self) -> None:
        """Add objective function to maximize satisfied requests with diminishing returns."""
        objective_terms = []

        # First, create satisfaction variables for each request
        person_request_satisfaction = defaultdict(list)  # person_cm_id -> list of (request, satisfaction_var)

        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in self.person_idx_map:
                continue

            person_idx = self.person_idx_map[person_cm_id]

            for request in requests:
                if request.request_type == RequestType.BUNK_WITH.value:
                    # Positive request - want them together
                    if request.requested_person_cm_id and request.requested_person_cm_id in self.person_idx_map:
                        target_idx = self.person_idx_map[request.requested_person_cm_id]

                        # Create satisfaction variable for this request
                        request_satisfied = self.model.NewBoolVar(f"req_satisfied_{request.id}")

                        # OPTIMIZED: Request is satisfied if both are in same bunk
                        # Direct comparison - O(1) instead of O(bunks)

                        # Check if they can possibly be in the same bunk (gender/session compatible)
                        valid_bunks = self._get_valid_bunks_for_pair(person_idx, target_idx)

                        if not valid_bunks:
                            # No valid bunks for this pair - request cannot be satisfied
                            self.model.Add(request_satisfied == 0)
                        else:
                            # Request is satisfied if their bunk assignments are equal
                            # This is a single constraint instead of 20+ constraints!
                            self.model.Add(
                                self.person_bunk_assignment[person_idx] == self.person_bunk_assignment[target_idx]
                            ).OnlyEnforceIf(request_satisfied)

                            self.model.Add(
                                self.person_bunk_assignment[person_idx] != self.person_bunk_assignment[target_idx]
                            ).OnlyEnforceIf(request_satisfied.Not())

                        person_request_satisfaction[person_cm_id].append((request, request_satisfied))

                elif request.request_type == RequestType.NOT_BUNK_WITH.value:
                    # Negative request - want them apart
                    if request.requested_person_cm_id and request.requested_person_cm_id in self.person_idx_map:
                        target_idx = self.person_idx_map[request.requested_person_cm_id]

                        # Add as hard constraint if priority is high enough
                        if request.priority >= self.config.get_constraint(
                            "negative_requests", "hard_constraint_threshold", default=8
                        ):
                            # OPTIMIZED: Direct comparison - they must NOT be in same bunk
                            # Check if they could possibly be in the same bunk
                            valid_bunks = self._get_valid_bunks_for_pair(person_idx, target_idx)

                            if valid_bunks:
                                # Only add constraint if they could potentially be together
                                # This is a single constraint instead of 20+ constraints!
                                self.model.Add(
                                    self.person_bunk_assignment[person_idx] != self.person_bunk_assignment[target_idx]
                                )
                        else:
                            # Soft constraint - create satisfaction variable
                            request_satisfied = self.model.NewBoolVar(f"req_satisfied_{request.id}")

                            # OPTIMIZED: Request is satisfied if they are NOT in same bunk
                            # Direct comparison - O(1) instead of O(bunks)

                            # Check if they can possibly be in the same bunk
                            valid_bunks = self._get_valid_bunks_for_pair(person_idx, target_idx)

                            if not valid_bunks:
                                # No valid bunks for this pair - they can't be together anyway
                                self.model.Add(request_satisfied == 1)
                            else:
                                # Request is satisfied if their bunk assignments are NOT equal
                                # This is a single constraint instead of 20+ constraints!
                                self.model.Add(
                                    self.person_bunk_assignment[person_idx] != self.person_bunk_assignment[target_idx]
                                ).OnlyEnforceIf(request_satisfied)

                                self.model.Add(
                                    self.person_bunk_assignment[person_idx] == self.person_bunk_assignment[target_idx]
                                ).OnlyEnforceIf(request_satisfied.Not())

                            person_request_satisfaction[person_cm_id].append((request, request_satisfied))

                # Note: age_preference requests are handled by must_satisfy_one constraint only

        # Now apply diminishing returns to the satisfaction variables
        # Get config for diminishing returns
        enable_diminishing = self.config.get_int("objective.enable_diminishing_returns", default=1)
        first_multiplier = self.config.get_int("objective.first_request_multiplier", default=10)
        second_multiplier = self.config.get_int("objective.second_request_multiplier", default=5)
        third_plus_multiplier = self.config.get_int("objective.third_plus_request_multiplier", default=1)

        for person_cm_id, request_satisfactions in person_request_satisfaction.items():
            if not request_satisfactions:
                continue

            # Sort by priority (highest first)
            request_satisfactions.sort(key=lambda x: x[0].priority, reverse=True)

            if enable_diminishing:
                # Apply diminishing returns based on how many requests are satisfied
                for i, (request, satisfied_var) in enumerate(request_satisfactions):
                    base_weight = float(request.priority * 10)

                    # Apply source field multiplier based on CSV fields
                    source_multiplier = self._get_csv_field_multiplier(request)
                    base_weight = base_weight * source_multiplier

                    if i == 0:
                        # First request gets full weight multiplier
                        weight = base_weight * first_multiplier
                    elif i == 1:
                        # Second request gets reduced weight
                        weight = base_weight * second_multiplier
                    else:
                        # Third+ requests get minimal weight
                        weight = base_weight * third_plus_multiplier

                    objective_terms.append(int(weight) * satisfied_var)
            else:
                # No diminishing returns - use standard weights
                for request, satisfied_var in request_satisfactions:
                    weight = float(request.priority * 10)

                    # Apply source field multiplier based on CSV fields
                    source_multiplier = self._get_csv_field_multiplier(request)
                    weight = weight * source_multiplier
                    objective_terms.append(int(weight) * satisfied_var)

        # NOTE: Age preference is now handled by constraints/age_preference.py
        # NOTE: Level progression is now handled by constraints/level_progression.py

        # Build solver context for modular constraint calls
        ctx = self._build_solver_context()

        # Add age/grade flow incentives
        add_age_grade_flow_objective(ctx, objective_terms)

        # Add grade spread soft constraint if configured
        grade_spread_mode = self.config.get_str("constraint.grade_spread.mode", default="hard")
        if grade_spread_mode == "soft":
            add_grade_spread_soft_constraint(ctx, objective_terms)

        # NOTE: cabin_capacity soft constraint removed in Phase 2. Solver caps
        # at DEFAULT_BUNK_CAPACITY (hard); staff manual edits cap at
        # MAX_BUNK_CAPACITY in the assignments UI.

        # Add cabin minimum occupancy soft penalty (prefer fuller bunks)
        add_cabin_minimum_occupancy_soft_penalty(ctx, objective_terms, self.bunk_is_used)

        # Subtract penalties for soft constraint violations
        for violation_var, penalty in self.soft_constraint_violations.values():
            objective_terms.append(-penalty * violation_var)

        # Add bonuses for soft constraint rewards (e.g., preferred age spread)
        for bonus_var, bonus in self.soft_constraint_bonuses.values():
            objective_terms.append(bonus * bonus_var)

        # Maximize objective
        self.model.Maximize(sum(objective_terms))

    def find_infeasibility_cause(self, time_limit_seconds: int = 10) -> str:
        """Try to identify which constraint is causing infeasibility.

        Returns a description of the likely cause.
        """
        return _find_infeasibility_cause(
            input_data=self.input,
            config=self.config,
            time_limit_seconds=time_limit_seconds,
        )

    def _solve_single_bunk_session(self) -> DirectSolverOutput:
        """Simplified solving for single-bunk sessions (like AG sessions).

        For sessions with only one bunk, we simply assign all enrolled campers
        to that bunk. No complex constraints needed.
        """
        bunk = self.bunks[0]
        bunk_cm_id = bunk.campminder_id
        over_capacity = len(self.person_ids) > bunk.capacity

        logger.info(f"Single-bunk session: {bunk.name} (capacity: {bunk.capacity})")
        logger.info(f"Campers to assign: {len(self.person_ids)}")

        # Check if we have too many campers for the bunk
        if over_capacity:
            logger.warning(f"WARNING: {len(self.person_ids)} campers but only {bunk.capacity} spots!")
            logger.warning("This will be infeasible, but continuing anyway...")

        # Get configured year from CampMinder settings
        year = get_current_season()

        # Create assignments - everyone goes to the single bunk
        assignments = []
        for person_cm_id in self.person_ids:
            person = self.input.person_by_cm_id[person_cm_id]
            assignments.append(
                DirectBunkAssignment(
                    person_cm_id=person_cm_id, bunk_cm_id=bunk_cm_id, session_cm_id=person.session_cm_id, year=year
                )
            )

        # Use the shared helper so single-bunk satisfied_requests carry real
        # PocketBase request IDs (matching the multi-bunk path) rather than
        # synthetic 'bunk_with:<cm_id>' strings the frontend can't look up,
        # and so all request types — NOT_BUNK_WITH, AGE_PREFERENCE, etc. —
        # are evaluated, not just BUNK_WITH.
        satisfied_requests = calculate_satisfied_requests(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        # Log results
        logger.info(f"Assigned {len(assignments)} campers to {bunk.name}")
        logger.info(f"Satisfied {len(satisfied_requests)} campers' requests")

        # Single-bunk runs bypass CP-SAT, but the frontend impact-analysis
        # table renders every key from `_build_stats_dict`. Emit the full
        # key set with `None` for fields the simplified path can't populate
        # so column rendering is identical across session types.
        stats: dict[str, Any] = {
            "status": "INFEASIBLE" if over_capacity else "OPTIMAL",
            # int() cast — same reason as _build_stats_dict above: cp_model
            # status constants are an enum in current OR-Tools, not raw ints.
            "status_code": int(cp_model.INFEASIBLE if over_capacity else cp_model.OPTIMAL),
            "objective_value": None,
            "solve_time": 0.0,
            "total_persons": len(self.person_ids),
            "total_bunks": len(self.bunks),
            "total_requests": len(self.input.requests),
            "satisfied_request_count": sum(len(v) for v in satisfied_requests.values()),
            # CP-SAT-only fields are None, not absent — keeps frontend
            # `stats?.foo` lookups consistent (always null, never undefined).
            "walltime_seconds": None,
            "user_time_seconds": None,
            "deterministic_time": None,
            "time_budget_seconds": None,
            "num_workers": None,
            "best_objective_bound": None,
            "optimality_gap": None,
            "gap_integral": None,
            "num_solutions_found": None,
            "solution_info": None,
            "num_branches": None,
            "num_conflicts": None,
            "num_booleans": None,
            "num_integer_variables": None,
            "model_num_variables": None,
            "model_num_constraints": None,
            "constraint_type_breakdown": {},
            # Tier 1 observability (Stream 2, issue #1380) — single-bunk
            # path has no CP-SAT model, so reified/big-M are 0. Histogram
            # and soft-by-module use the actual data we have.
            "num_reified_linear": 0,
            "max_linear_coefficient": 0,
            "soft_constraints_by_module": _count_soft_constraints_by_module(self.soft_constraint_violations),
            "request_density_histogram": _build_request_density_histogram(self.input.requests_by_person),
            "single_bunk_session": True,
        }

        # Populate `request_validation` so the debug page's bucket-aware
        # outcome columns (mp_request_rate, all_camper_rate, ...) render for
        # single-bunk sessions identically to multi-bunk. Mirrors the
        # multi-bunk solve() path that attaches the summary post-solve.
        self._check_must_satisfy_one_violations(assignments)
        stats["request_validation"] = self.request_validation_summary

        return DirectSolverOutput(
            assignments=assignments,
            satisfied_requests=satisfied_requests,
            stats=stats,
            analysis={
                "single_bunk_session": True,
                "bunk_name": bunk.name,
                "campers_assigned": len(assignments),
                "capacity": bunk.capacity,
                "utilization": len(assignments) / bunk.capacity if bunk.capacity > 0 else 0,
            },
        )

    def solve(self, time_limit_seconds: int = 60) -> DirectSolverOutput | None:
        """Solve the bunking problem."""
        # Check if this is a single-bunk session (like AG sessions)
        if len(self.bunks) == 1:
            logger.info("Single-bunk session detected - using simplified solving")
            return self._solve_single_bunk_session()

        # Run feasibility check first
        self.check_feasibility()

        # Add constraints and objective
        self.constraint_logger.log_progress("Adding constraints to model...")
        self.add_constraints()

        self.constraint_logger.log_progress("Setting up objective function...")
        self.add_objective()

        # Create solver and set time limit
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_seconds

        # Only enable OR-Tools search progress in debug mode
        if self.debug_mode:
            solver.parameters.log_search_progress = True
            solver.log_callback = lambda msg: logger.debug(f"OR-Tools: {msg}")

        # Add optimization parameters for better performance
        # Read worker count from env (default 8 for good parallelism)
        num_workers = int(os.getenv("SOLVER_NUM_WORKERS", "8"))
        solver.parameters.num_search_workers = num_workers
        solver.parameters.linearization_level = 2  # Better for circuit/boolean constraints
        solver.parameters.cp_model_presolve = True  # Enable preprocessing
        solver.parameters.search_branching = cp_model.FIXED_SEARCH  # Try different search strategies

        # Add callback for progress tracking
        callback = SolverProgressCallback(self.constraint_logger, self.debug_mode)

        # Log solver start
        self.constraint_logger.log_progress(f"Starting solver with {time_limit_seconds}s time limit...")
        logger.debug(
            f"Model has {len(self.model.Proto().variables)} variables and {len(self.model.Proto().constraints)} constraints"
        )

        # Export model for debugging if it fails
        model_export_path = (
            f"logs/solver/model_session_{getattr(self.input.persons[0], 'session_cm_id', 'unknown')}.txt"
        )

        # Solve with callback
        status = solver.Solve(self.model, callback)

        # Log solver summary at INFO (key metrics only)
        status_name = solver.StatusName(status)
        logger.info(f"Solver complete: {status_name}, wall={solver.WallTime():.1f}s, workers={num_workers}")

        # If infeasible, export the model and try to find conflicts
        if status == cp_model.INFEASIBLE:
            logger.error("Model is INFEASIBLE - exporting model for analysis")
            try:
                os.makedirs(os.path.dirname(model_export_path), exist_ok=True)
                with open(model_export_path, "w") as f:
                    f.write(str(self.model.Proto()))
                logger.info(f"Model exported to {model_export_path}")

                # Try to find minimal infeasible subset
                logger.info("Attempting to identify conflicting constraints...")
                type_counts = _count_constraint_types(self.model.Proto())
                logger.info("Constraint types: " + ", ".join(f"{k}={v}" for k, v in sorted(type_counts.items())))

            except Exception as e:
                logger.error(f"Failed to export model: {e}")

        if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            logger.warning(f"Solver failed with status: {solver.StatusName(status)}")

            # Log failure details
            if status == cp_model.INFEASIBLE:
                self.constraint_logger.log_progress("SOLVER FAILED: Problem is INFEASIBLE!")
                logger.error("The constraints cannot be satisfied. Check feasibility warnings above.")
            elif status == cp_model.MODEL_INVALID:
                self.constraint_logger.log_progress("SOLVER FAILED: Model is INVALID!")
            elif status == cp_model.UNKNOWN:
                self.constraint_logger.log_progress("SOLVER FAILED: Status UNKNOWN (timeout?)")

            # Save logs even on failure
            log_file_path = None
            if self.input.requests and len(self.input.requests) > 0:
                session_id = self.input.requests[0].session_cm_id
                log_file_path = self.constraint_logger.save_to_file(session_id)
                logger.info(f"Solver logs saved to {log_file_path} despite failure")

            return None

        # Log success
        self.constraint_logger.log_progress(f"Solver completed successfully! Status: {solver.StatusName(status)}")

        # Log objective breakdown
        self._log_objective_breakdown(solver)

        # Extract solution
        assignments = []
        for person_idx, person_cm_id in enumerate(self.person_ids):
            for bunk_idx, bunk in enumerate(self.bunks):
                if solver.Value(self.assignments[(person_idx, bunk_idx)]) == 1:
                    # Get the person's actual enrolled session
                    person = self.input.person_by_cm_id[person_cm_id]
                    assignments.append(
                        DirectBunkAssignment(
                            person_cm_id=person_cm_id,
                            session_cm_id=person.session_cm_id,
                            bunk_cm_id=bunk.campminder_id,
                            year=get_current_season(),
                        )
                    )
                    break

        # Calculate satisfied requests
        satisfied_requests = calculate_satisfied_requests(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        # Perform post-solve analysis
        analysis = analyze_solution(
            assignments,
            satisfied_requests,
            self.input.requests_by_person,
            self.input.requests,
            self.bunks,
        )

        # Log field-level statistics
        if "field_level_stats" in analysis:
            logger.info("=== Request Satisfaction by CSV Field ===")
            for field, stats in analysis["field_level_stats"]["by_field"].items():
                if stats["total"] > 0:
                    logger.info(
                        f"{field}: {stats['satisfied']}/{stats['total']} ({stats['satisfaction_rate']:.1%} satisfied)"
                    )

            explicit_stats = analysis["field_level_stats"]["explicit_csv_requests"]
            logger.info(
                "Explicit source fields (Share Bunk With, Do Not Share Bunk With, BunkingNotes Notes, Internal Bunk Notes):"
            )
            logger.info(f"  Total: {explicit_stats['total']} requests")
            logger.info(f"  Satisfied: {explicit_stats['satisfied']} ({explicit_stats['satisfaction_rate']:.1%})")
            logger.info(
                f"  Campers with unsatisfied explicit requests: {explicit_stats['campers_with_unsatisfied_explicit']}"
            )

        # Check constraint violations in final solution
        self._check_constraint_violations(assignments, solver)

        # Add constraint logger summary to analysis
        analysis["constraint_summary"] = self.constraint_logger.get_summary()

        # Save logs to file if we have a session ID
        log_file_path = None
        if self.input.requests and len(self.input.requests) > 0:
            session_id = self.input.requests[0].session_cm_id
            log_file_path = self.constraint_logger.save_to_file(session_id)

        # Create output
        stats = _build_stats_dict(
            solver=solver,
            status=status,
            model_proto=self.model.Proto(),
            time_limit_seconds=time_limit_seconds,
            num_workers=num_workers,
            num_persons=len(self.person_ids),
            num_bunks=len(self.bunks),
            num_requests=len(self.input.requests),
            satisfied_count=sum(len(reqs) for reqs in satisfied_requests.values()),
            soft_constraint_violations=self.soft_constraint_violations,
            requests_by_person=self.input.requests_by_person,
        )
        stats["request_validation"] = self.request_validation_summary

        return DirectSolverOutput(
            assignments=assignments,
            stats=stats,
            satisfied_requests=satisfied_requests,
            analysis=analysis,
            log_file_path=log_file_path,
        )

    def _log_objective_breakdown(self, solver: cp_model.CpSolver) -> None:
        """Log breakdown of objective value by category.

        Shows how much each soft constraint category contributed to the objective.
        """
        logger.info("=== Post-Solve Objective Breakdown ===")
        logger.info(f"Total objective value: {solver.ObjectiveValue():.0f}")

        # Group soft constraint violations by category
        category_totals: dict[str, float] = defaultdict(float)
        category_counts: dict[str, int] = defaultdict(int)

        for name, (var, penalty) in self.soft_constraint_violations.items():
            # Extract category from name (e.g., "grade_ratio_5_grade_7" -> "grade_ratio")
            parts = name.split("_")
            if len(parts) >= 2:
                category = f"{parts[0]}_{parts[1]}"
            else:
                category = name

            try:
                value = solver.Value(var)
                if value > 0:
                    contribution = penalty * value if isinstance(value, int) else penalty
                    category_totals[category] += contribution
                    category_counts[category] += 1
            except Exception:  # noqa: S110 — intentional silent handling
                # Variable might not be in solution
                pass

        if category_totals:
            logger.info("Soft constraint penalties by category:")
            for category, total in sorted(category_totals.items(), key=lambda x: -x[1]):
                count = category_counts[category]
                logger.info(f"  {category}: {total:.0f} ({count} violations)")
        else:
            logger.info("No soft constraint penalties incurred")

    def _check_constraint_violations(self, assignments: list[DirectBunkAssignment], solver: cp_model.CpSolver) -> None:
        """Check for constraint violations in the final solution."""
        logger.info("=== Post-Solve Constraint Violation Check ===")

        # Build assignment structures for analysis
        person_to_bunk = {a.person_cm_id: a.bunk_cm_id for a in assignments}
        bunk_to_persons = defaultdict(list)
        for person_cm_id, bunk_cm_id in person_to_bunk.items():
            bunk_to_persons[bunk_cm_id].append(person_cm_id)

        # 1. Check cabin capacity violations
        capacity_violations = 0
        for bunk_cm_id, person_cm_ids in bunk_to_persons.items():
            bunk_idx = self.bunk_idx_map[bunk_cm_id]
            bunk = self.bunks[bunk_idx]
            occupancy = len(person_cm_ids)

            if occupancy > bunk.capacity:
                capacity_violations += 1
                self.constraint_logger.log_violation(
                    "cabin_capacity",
                    f"Cabin {bunk.name} is OVER capacity: {occupancy}/{bunk.capacity} (+{occupancy - bunk.capacity})",
                    severity="error",
                )

        if capacity_violations == 0:
            logger.info("✓ All cabin capacity constraints satisfied")

        # 2. Check gender constraint violations
        gender_violations = 0
        for bunk_cm_id, person_cm_ids in bunk_to_persons.items():
            bunk_idx = self.bunk_idx_map[bunk_cm_id]
            bunk = self.bunks[bunk_idx]

            if bunk.gender and bunk.gender not in ["Mixed", "AG"]:
                for person_cm_id in person_cm_ids:
                    person = self.input.person_by_cm_id[person_cm_id]
                    if person.gender and person.gender != bunk.gender:
                        gender_violations += 1
                        self.constraint_logger.log_violation(
                            "gender",
                            f"Gender mismatch: {person.name} ({person.gender}) in {bunk.gender}-only cabin {bunk.name}",
                            severity="error",
                        )

        if gender_violations == 0:
            logger.info("✓ All gender constraints satisfied")

        # 3. Check soft constraint violations
        soft_violations: list[dict[str, Any]] = []
        for name, (var, penalty) in self.soft_constraint_violations.items():
            if isinstance(var, int):
                # It's an IntVar
                value = solver.Value(var)
                if value > 0:
                    soft_violations.append({"name": name, "value": value, "penalty": penalty * value})
            else:
                # It's a BoolVar
                value = solver.Value(var)
                if value == 1:
                    soft_violations.append({"name": name, "value": 1, "penalty": penalty})

        if soft_violations:
            logger.info(f"{len(soft_violations)} soft constraint violations:")
            total_penalty: float = 0
            for violation in soft_violations:
                total_penalty += float(violation["penalty"])
                self.constraint_logger.log_violation(
                    "soft_constraint",
                    f"{violation['name']}: value={violation['value']}, penalty={violation['penalty']}",
                    severity="info",
                )
            logger.info(f"Total soft constraint penalty: {total_penalty}")
        else:
            logger.info("✓ No soft constraint violations")

        # 4. Check must-satisfy-one violations (split by population — see helper).
        self._check_must_satisfy_one_violations(assignments)

        logger.info("=== End Constraint Violation Check ===")

    def _check_must_satisfy_one_violations(self, assignments: list[DirectBunkAssignment]) -> None:
        """Post-solve diagnostic: split unsatisfied campers into actionable buckets.

        Mirrors the solver's resolved-only scope (``data_fetcher.py:140``
        filters bunk_requests to ``status="resolved"`` before they reach the
        solver). Pending and declined requests are not the solver's concern,
        so the diagnostic ignores them entirely. This also collapses the
        cross-session "no possible" case in practice — those are auto-DECLINED
        by the bunk_request_processor at sync time and never reach this loop
        as resolved.

        Three populations were previously emitted under one ``must_satisfy_one``
        warning, which conflated solver-actionable failures with parent-input
        issues. This split surfaces:

        - ``must_satisfy_one_no_possible`` (info): the camper's resolved
          requests are all structurally impossible from the solver's
          perspective. With upstream resolution working correctly this
          should be near-empty in production — non-empty values indicate a
          data-hygiene regression where a request marked ``resolved`` is in
          fact unsatisfiable.
        - ``must_satisfy_one_material_parent_unmet`` (warning): camper has
          ≥1 resolved possible MATERIAL_PARENT request (``bunk_with``) and
          the solver satisfied none. Headline staff failure mode per the
          parent-paramount design.
        - ``must_satisfy_one_other_unmet`` (info): camper has only resolved
          non-material possible requests (STAFF or IMMATERIAL_PARENT) and
          the solver satisfied none. Lower-priority signal.

        Counts are also surfaced in ``request_validation_summary`` so the
        structured solver-log JSON carries the breakdown.
        """
        person_to_bunk = {a.person_cm_id: a.bunk_cm_id for a in assignments}
        all_satisfied = calculate_satisfied_requests(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        no_possible: list[int] = []
        material_parent_unmet: list[int] = []
        other_unmet: list[int] = []
        # Per-camper resolved-possible count, used for the violation message text.
        # The unfiltered self.possible_requests dict can include pending/declined
        # entries (validation doesn't filter by status), so reading its length
        # directly would overstate the number shown in the diagnostic.
        resolved_possible_count: dict[int, int] = {}

        # Symmetric met/total counts for the symmetric outcome metrics added in
        # PR1 of the solver-debug metric expansion. Hoisted ABOVE the loop's
        # early-continues because the diagnostic skips campers with >=1
        # satisfied request, and we need every camper in scope here. Uses the
        # canonical `classify_request()` from `bunking.satisfaction.bucket`.
        mp_requests_total = 0
        mp_requests_satisfied = 0
        mp_campers_total = 0
        mp_campers_satisfied = 0
        all_campers_total = 0
        all_campers_satisfied = 0

        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in person_to_bunk:
                continue
            # Restrict to resolved requests — pending/declined aren't part of the solver's scope.
            resolved_requests = [r for r in requests if r.status == "resolved"]
            if not resolved_requests:
                continue

            # PR1 symmetric counts -- must happen before the early-continue
            # below, which skips campers with >=1 satisfied request.
            satisfied_ids_for_person: set[str] = set(all_satisfied.get(person_cm_id, []))

            resolved_mp = [r for r in resolved_requests if is_material_parent_request(r)]
            mp_requests_total += len(resolved_mp)
            satisfied_mp = [r for r in resolved_mp if r.id in satisfied_ids_for_person]
            mp_requests_satisfied += len(satisfied_mp)
            if resolved_mp:
                mp_campers_total += 1
                if satisfied_mp:
                    mp_campers_satisfied += 1
            all_campers_total += 1
            if any(r.id in satisfied_ids_for_person for r in resolved_requests):
                all_campers_satisfied += 1

            resolved_ids = {r.id for r in resolved_requests}
            if any(rid in resolved_ids for rid in all_satisfied.get(person_cm_id, [])):
                continue

            resolved_possible = [r for r in self.possible_requests.get(person_cm_id, []) if r.status == "resolved"]
            if not resolved_possible:
                no_possible.append(person_cm_id)
                continue

            resolved_possible_count[person_cm_id] = len(resolved_possible)
            if any(is_material_parent_request(r) for r in resolved_possible):
                material_parent_unmet.append(person_cm_id)
            else:
                other_unmet.append(person_cm_id)

        # Persist the breakdown alongside the existing pre-solve totals so the
        # structured JSON solver log carries it without scraping violation names.
        self.request_validation_summary["unsatisfied_no_possible"] = len(no_possible)
        self.request_validation_summary["unsatisfied_material_parent_unmet"] = len(material_parent_unmet)
        self.request_validation_summary["unsatisfied_other_unmet"] = len(other_unmet)
        # Hard MSO bug signal: non-zero means the hard constraint failed to bind.
        # Dashboard and alerting latch onto this key specifically.
        self.request_validation_summary["mp_constraint_bug_signal"] = len(material_parent_unmet)
        # Campers whose entire MP set was structurally impossible — the hard
        # constraint was not added for them. Populated by parent_paramount
        # during constraint build; surfaced here for dashboard visibility.
        self.request_validation_summary["mp_set_entirely_impossible_count"] = len(self.mp_set_entirely_impossible)
        self.request_validation_summary["mp_set_entirely_impossible_cm_ids"] = list(self.mp_set_entirely_impossible)

        # PR1 symmetric met/total counts -- mirror the bucket-aware unmet keys
        # above with positive-side counts. Consumers (debug page) derive unmet
        # = total - satisfied; we don't persist unmet redundantly.
        self.request_validation_summary["mp_requests_total"] = mp_requests_total
        self.request_validation_summary["mp_requests_satisfied"] = mp_requests_satisfied
        self.request_validation_summary["mp_campers_total"] = mp_campers_total
        self.request_validation_summary["mp_campers_satisfied"] = mp_campers_satisfied
        self.request_validation_summary["all_campers_total"] = all_campers_total
        self.request_validation_summary["all_campers_satisfied"] = all_campers_satisfied

        if no_possible:
            logger.info(
                f"{len(no_possible)} campers had only structurally-impossible requests "
                f"(parent input issue: requestee in another session or absent from solver)"
            )
            for person_cm_id in no_possible[:10]:
                person = self.input.person_by_cm_id[person_cm_id]
                self.constraint_logger.log_violation(
                    "must_satisfy_one_no_possible",
                    f"{person.name} (ID: {person_cm_id}): all requests impossible — fix parent input",
                    severity="info",
                )
            if len(no_possible) > 10:
                logger.info(f"... and {len(no_possible) - 10} more")

        if material_parent_unmet:
            logger.info(
                f"{len(material_parent_unmet)} campers with possible MATERIAL_PARENT requests "
                f"left unsatisfied by the solver"
            )
            for person_cm_id in material_parent_unmet[:10]:
                person = self.input.person_by_cm_id[person_cm_id]
                possible_count = resolved_possible_count[person_cm_id]
                self.constraint_logger.log_violation(
                    "must_satisfy_one_material_parent_unmet",
                    f"{person.name} (ID: {person_cm_id}): {possible_count} possible requests, none satisfied",
                    severity="error",
                )
            if len(material_parent_unmet) > 10:
                logger.info(f"... and {len(material_parent_unmet) - 10} more")
            if material_parent_unmet:
                logger.error(
                    "parent_paramount_unbound: %d MP-having campers ended with no MP request satisfied under hard MSO",
                    len(material_parent_unmet),
                    extra={
                        "parent_paramount": {
                            "unmet_cm_ids": material_parent_unmet,
                            "bug": "parent_paramount_unbound",
                        }
                    },
                )

        if other_unmet:
            logger.info(
                f"{len(other_unmet)} campers with only non-material (staff/immaterial) possible requests "
                f"left unsatisfied"
            )
            for person_cm_id in other_unmet[:10]:
                person = self.input.person_by_cm_id[person_cm_id]
                possible_count = resolved_possible_count[person_cm_id]
                self.constraint_logger.log_violation(
                    "must_satisfy_one_other_unmet",
                    f"{person.name} (ID: {person_cm_id}): {possible_count} possible requests, none satisfied",
                    severity="info",
                )
            if len(other_unmet) > 10:
                logger.info(f"... and {len(other_unmet) - 10} more")

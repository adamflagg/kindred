"""
Direct Bunking Solver - works directly with bunk_requests data.
No transformation needed.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, Any

from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.models_v2 import (
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectSolverInput,
    DirectSolverOutput,
)
from bunking.satisfaction import weight_for
from bunking.satisfaction.batch import satisfied_request_ids_by_person
from bunking.satisfaction.bucket import RequestBucket, is_counted_request, is_material_parent_request
from bunking.sync.bunk_request_processor.core.models import RequestType
from campminder.client import get_current_season

from .callbacks import BestBoundCallback, SolverProgressCallback
from .constraints.age_grade_flow import add_age_grade_flow_objective
from .constraints.age_spread import add_age_spread_constraints
from .constraints.base import SolverContext
from .constraints.bunk_requests import get_or_create_request_sat_var
from .constraints.cabin_occupancy import (
    add_cabin_minimum_occupancy_constraints,
    add_cabin_minimum_occupancy_soft_penalty,
)
from .constraints.gender import add_gender_constraints
from .constraints.grade_adjacency import add_grade_adjacency_constraints
from .constraints.grade_ratio import add_grade_ratio_constraints
from .constraints.grade_spread import add_grade_spread_constraints
from .constraints.group_locks import add_group_lock_constraints
from .constraints.level_progression import add_level_progression_constraints
from .constraints.parent_paramount import add_must_satisfy_one_request_constraints
from .constraints.staff_separation import add_staff_separation_constraints
from .feasibility import RequestValidationSummary
from .feasibility import check_feasibility as _check_feasibility
from .feasibility import find_infeasibility_cause as _find_infeasibility_cause
from .logging import ConstraintLogger
from .observability import (
    _bucket_soft_constraint_violations,
    _build_impossible_by_reason_by_bucket,
    _build_request_density_histogram_by_bucket,
    _build_stats_dict,
    _count_constraint_types,
)

if TYPE_CHECKING:
    from bunking.solver.impossibility import ImpossibilityReport

logger = get_logger(__name__)

# Objective shape constants (formerly objective.* PB config keys; hardcoded
# 2026-05-15 per solver-config-decisions.md "Bunk Request Priority +
# Diminishing Returns" domain — zero production tuning evidence on any of
# them, and the priority dimension they multiplied is gone).
BASE_REQUEST_WEIGHT = 40  # matches old `priority * 10` for typical P4 first-pick;
# keeps satisfaction net-positive against the under-occupancy penalty (else a
# typical fixture totals negative — see solver_score.json baseline).
FIRST_REQUEST_MULTIPLIER = 10  # slot-0 boost
SECOND_REQUEST_MULTIPLIER = 5
THIRD_PLUS_REQUEST_MULTIPLIER = 1


def find_mutual_pairs(directed_edges: Iterable[tuple[int, int]]) -> set[frozenset[int]]:
    """Given directed (a, b) edges, return the set of unordered {a, b} pairs
    where both (a, b) and (b, a) are present. Caller is responsible for
    filtering edges to the relevant subset (request type, validity, etc.).
    """
    edges = set(directed_edges)
    return {frozenset({a, b}) for a, b in edges if (b, a) in edges}


def compute_mutual_bunk_with_pairs(
    requests_by_person: Mapping[int, Iterable[DirectBunkRequest]],
) -> set[frozenset[int]]:
    """Stream 4 (#1382): collect unordered cm_id pairs where both directions
    are filed as bunk_with — A→B AND B→A. Used by the objective to apply the
    `objective.mutual_request_boost` multiplier to reciprocated requests.

    Self-loops, null requestees, and non-bunk_with rows are skipped. Reciprocal
    not_bunk_with is intentionally NOT mutual: a bunk_with↔not_bunk_with pair
    is a conflict, not an agreement, and reciprocal not_bunk_with is symmetric
    by intent (penalty already treats both directions equally).
    """
    return find_mutual_pairs(
        (r.requester_person_cm_id, r.requested_person_cm_id)
        for reqs in requests_by_person.values()
        for r in reqs
        if r.request_type == RequestType.BUNK_WITH.value
        and r.requested_person_cm_id is not None
        and r.requester_person_cm_id != r.requested_person_cm_id
    )


class DirectBunkingSolver:
    """Solver that works directly with bunk_requests table data."""

    def __init__(
        self,
        input_data: DirectSolverInput,
        config_service: ConfigLoader,
        debug_constraints: dict[str, bool] | None = None,
        mp_skip_cms: set[int] | None = None,
        impossibility_report: ImpossibilityReport | None = None,
    ):
        self.input = input_data
        self.config = config_service
        self.model = cp_model.CpModel()
        self.debug_constraints = debug_constraints or {}  # Dict of constraint names to disable
        # IIS-localization probe: campers whose hard MP constraint should be
        # skipped this run. Used only by the infeasibility analyzer.
        self.mp_skip_cms: set[int] = set(mp_skip_cms or ())
        # Precomputed impossibility report. When supplied (by the diagnostic
        # probe loops, which build many solvers over identical request data),
        # _validate_requests reuses it instead of re-running the full
        # request×predicate scan. None → compute it from scratch.
        self._impossibility_report_override = impossibility_report

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
        # Hard staff/manual not_bunk_with yields (#1541) — separations relaxed to
        # protect a parent-paramount MSO. Populated by add_staff_separation_constraints;
        # surfaced post-solve into request_validation_summary["staff_nbw_yielded"].
        self.staff_nbw_yields: list[dict[str, Any]] = []

        # Canonical per-request satisfaction vars (bunk_with / not_bunk_with),
        # keyed by request.id. Populated by get_or_create_request_sat_var via
        # parent_paramount and add_objective; one shared var per request.
        self.request_satisfied_vars: dict[str, cp_model.IntVar] = {}

        # Limit debug logging for pair reduction (only first 5 pairs)
        self._pair_reduction_logged = 0

        # Validate requests and categorize as possible/impossible
        self.possible_requests: dict[int, list[DirectBunkRequest]] = {}  # person_cm_id -> list of possible requests
        self.impossible_requests: dict[int, list[DirectBunkRequest]] = {}  # person_cm_id -> list of impossible requests
        # Set by _validate_requests; surfaced so diagnostic probe loops can
        # reuse it across solver constructions (see _impossibility_report_override).
        self.impossibility_report: ImpossibilityReport
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
            staff_nbw_yields=self.staff_nbw_yields,
            mp_skip_cms=self.mp_skip_cms,
            request_satisfied_vars=self.request_satisfied_vars,
        )

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
        """Classify requests as possible or impossible via the shared module.

        Delegates entirely to bunking.solver.impossibility.validate_impossibility,
        which both this solver and api.routers.solver.pre_validate_solver share —
        there is no longer any hand-rolled fallback, so the two paths cannot
        drift. Populates self.possible_requests, self.impossible_requests,
        self.mp_set_entirely_impossible, and self.request_validation_summary
        from the structured report.
        """
        # Initialize per-camper dicts (existing API surface)
        for person_cm_id in self.input.requests_by_person:
            self.possible_requests[person_cm_id] = []
            self.impossible_requests[person_cm_id] = []

        # Imported lazily, not at module top, so tests can monkeypatch
        # bunking.solver.impossibility.validate_impossibility — a module-level
        # binding would capture the original before the patch is applied.
        from .impossibility import (  # noqa: PLC0415 - test monkeypatch needs late binding
            validate_impossibility,
        )

        # Reuse a precomputed report when the diagnostic probe loops supplied
        # one — the request data is identical across probes, so re-running the
        # full predicate scan per solver construction is wasted work.
        report = (
            self._impossibility_report_override
            if self._impossibility_report_override is not None
            else validate_impossibility(self.input, self.config)
        )
        self.impossibility_report = report
        impossible_request_ids: set[str] = {item.request_id for item in report.flat}

        # Camper-level rollup of entirely-impossible MP sets — single source of
        # truth (computed in validate_impossibility). parent_paramount no longer
        # re-derives this during constraint build; it consumes this list directly.
        self.mp_set_entirely_impossible.extend(entry["cm_id"] for entry in report.mp_campers_entirely_impossible)

        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in self.person_idx_map:
                continue
            for request in requests:
                if request.id in impossible_request_ids:
                    self.impossible_requests[person_cm_id].append(request)
                else:
                    self.possible_requests[person_cm_id].append(request)

        # Resolve report items back to request objects — ImpossibleItem carries
        # request_id + reason_code but not source_field, and the per-bucket
        # helper needs the request to classify its bucket.
        request_by_id = {r.id: r for r in self.input.requests}
        impossible_pairs: list[tuple[DirectBunkRequest, str]] = [
            (request_by_id[item.request_id], item.reason_code) for item in report.flat
        ]
        # NB: impossible_by_reason (bucketed) drops requests with unknown source_field,
        # while total_impossible never does — the two are intentionally independent counts.
        impossible_by_reason = _build_impossible_by_reason_by_bucket(impossible_pairs)

        # Material-only aggregates (Group 65 #1539) — popup-visible counts exclude
        # IMMATERIAL_PARENT (socialize_with). The solver still processes immaterial
        # requests; only the reported totals filter them out.
        total_requests = sum(
            1
            for person_cm_id, reqs in self.input.requests_by_person.items()
            if person_cm_id in self.person_idx_map
            for r in reqs
            if is_counted_request(r)
        )

        # Drop IMMATERIAL_PARENT bucket from impossible_by_reason. The helper
        # emits {bucket: {reason_code: count}}; zero out the immaterial bucket
        # so the popup renders only actionable (material + staff) breakdowns.
        material_impossible_by_reason: dict[str, dict[str, int]] = {
            bucket: (reasons if bucket != RequestBucket.IMMATERIAL_PARENT.value else {})
            for bucket, reasons in impossible_by_reason.items()
        }

        # Material-only impossible count — request-id-unique, mirroring
        # report.total_impossible's dedup. A request impossible for >1 reason
        # appears once per reason in report.flat (Layer 2 records every
        # overlapping blocker); counting rows directly would double-count it and
        # could drive possible_requests negative.
        material_impossible_count = len(
            {item.request_id for item in report.flat if item.bucket != RequestBucket.IMMATERIAL_PARENT.value}
        )

        # affected_campers — distinct requester cm_id among material-impossible rows only.
        material_affected_campers = len(
            {
                item.requester.get("cm_id")
                for item in report.flat
                if item.bucket != RequestBucket.IMMATERIAL_PARENT.value and item.requester.get("cm_id") is not None
            }
        )

        self.request_validation_summary: RequestValidationSummary = {
            "total_requests": total_requests,
            "possible_requests": total_requests - material_impossible_count,
            "impossible_requests": material_impossible_count,
            "impossible_by_reason": material_impossible_by_reason,
            "affected_campers": material_affected_campers,
        }

        if report.total_impossible > 0:
            reason_summary = (
                " ".join(
                    f"{bucket}.{reason}={count}"
                    for bucket, reasons in impossible_by_reason.items()
                    for reason, count in reasons.items()
                )
                # impossible_by_reason drops requests with a missing/unknown source_field,
                # so the bucketed breakdown can be empty even when total_impossible > 0.
                or "unclassified — impossible requests have missing/unknown source_field"
            )
            logger.warning(
                f"Request validation: {report.total_impossible} total infeasible "
                f"({material_impossible_count} material) of {total_requests} material requests "
                f"({reason_summary})"
            )
            logger.warning(f"Affected campers: {self.request_validation_summary['affected_campers']}")

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

        # 6. Grade spread (hard) - max MAX_UNIQUE_GRADES_PER_BUNK distinct grades per bunk
        # Uses extracted constraint module - debug check is internal
        add_grade_spread_constraints(self._build_solver_context())

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

        # 10b. Hard staff/manual not_bunk_with separation (#1541), with the
        # parent-paramount MSO carve-out. Runs after parent_paramount so the
        # must-satisfy-one set is conceptually settled.
        add_staff_separation_constraints(self._build_solver_context())

        # 11. Level progression constraints
        # Uses extracted constraint module - debug check is internal
        add_level_progression_constraints(self._build_solver_context())

        # 12. Gender constraints - CRITICAL for safety
        # Uses extracted constraint module - debug check is internal
        add_gender_constraints(self._build_solver_context())

    def _get_csv_field_multiplier(self, request: DirectBunkRequest) -> float:
        """Objective multiplier for a request, routed through the canonical
        `(source, type)` registry (PR #1552 completion).

        Matches `score_evaluator.py` / `objective_evaluator.py` byte-for-byte
        on in-registry data and on missing config keys (per-key
        `_WEIGHT_DEFAULTS` fallback). Off-axis combos and missing source
        fields fall back to a neutral 1.0 with a warning — same pattern the
        evaluators use.
        """
        source_field = getattr(request, "source_field", None)
        if not source_field:
            return 1.0
        try:
            return weight_for(source_field, request.request_type, self.config)
        except ValueError:
            logger.warning(
                "objective_multiplier_fallback request_id=%s source_field=%s request_type=%s multiplier=1.0 reason=off_axis_source_type",
                request.id,
                source_field,
                request.request_type,
            )
            return 1.0

    def add_objective(self) -> None:
        """Add objective function to maximize satisfied requests with diminishing returns."""
        objective_terms = []

        # First, create satisfaction variables for each request
        person_request_satisfaction = defaultdict(list)  # person_cm_id -> list of (request, satisfaction_var)

        # SolverContext carries self.request_satisfied_vars by reference, so
        # get_or_create_request_sat_var memo-shares with parent_paramount.
        ctx = self._build_solver_context()

        # Stream 3 Phase B (#1381): iterate self.possible_requests instead of
        # self.input.requests_by_person.items() so the objective builder never
        # sees a request already in impossibility_report.flat. This drops the
        # pinned-to-0 req_satisfied BoolVar (line ~525 below for the
        # no-valid-bunks fallback) AND frees the diminishing-returns slot the
        # impossible request would otherwise consume, letting a possible
        # request claim a higher-weighted slot. _validate_requests initializes
        # possible_requests for every person in requests_by_person but only
        # populates entries for persons in person_idx_map, so the roster guard
        # stays.
        for person_cm_id, requests in self.possible_requests.items():
            if person_cm_id not in self.person_idx_map:
                continue

            person_idx = self.person_idx_map[person_cm_id]

            for request in requests:
                if request.request_type == RequestType.BUNK_WITH.value:
                    # Positive request - want them together
                    if request.requested_person_cm_id and request.requested_person_cm_id in self.person_idx_map:
                        target_idx = self.person_idx_map[request.requested_person_cm_id]

                        # Check if they can possibly be in the same bunk (gender/session compatible)
                        valid_bunks = self._get_valid_bunks_for_pair(person_idx, target_idx)

                        if not valid_bunks:
                            # No valid bunks for this pair - request cannot be satisfied.
                            # Pinned-impossible var stays objective-local (not in the shared map).
                            request_satisfied = self.model.NewBoolVar(f"req_satisfied_{request.id}")
                            self.model.Add(request_satisfied == 0)
                        else:
                            # Borrow the one canonical bidirectional sat var.
                            request_satisfied = get_or_create_request_sat_var(ctx, request)

                        if request_satisfied is not None:
                            person_request_satisfaction[person_cm_id].append((request, request_satisfied))

                elif request.request_type == RequestType.NOT_BUNK_WITH.value:
                    # Negative request — want them apart. Always soft: the
                    # legacy `priority >= 8` hard branch was unreachable
                    # since the producer capped priority at 4 (#1432) and
                    # the priority field is gone post-deletion.
                    if request.requested_person_cm_id and request.requested_person_cm_id in self.person_idx_map:
                        target_idx = self.person_idx_map[request.requested_person_cm_id]

                        # Check if they can possibly be in the same bunk
                        valid_bunks = self._get_valid_bunks_for_pair(person_idx, target_idx)

                        if not valid_bunks:
                            # No valid bunks for this pair — they can't be together anyway.
                            # Pinned-trivial var stays objective-local (not in the shared map).
                            request_satisfied = self.model.NewBoolVar(f"req_satisfied_{request.id}")
                            self.model.Add(request_satisfied == 1)
                        else:
                            # Borrow the one canonical bidirectional sat var.
                            request_satisfied = get_or_create_request_sat_var(ctx, request)

                        if request_satisfied is not None:
                            person_request_satisfaction[person_cm_id].append((request, request_satisfied))

                # age_preference is intentionally absent from the objective:
                # MP age_preference is enforced by parent_paramount's hard
                # must-satisfy-one constraint (see constraints/age_preference.py).
                # Non-MP age_preference has no solver representation — staff
                # treat those as best-effort ("maybe you'll get it"), and the
                # planned material/immaterial/staff bucket weights (see
                # docs/reference/solver-config-decisions.md) will be the right
                # home for any future non-MP modeling. #1433.

        # Apply diminishing returns to the satisfaction variables.
        # When `objective.enable_first_boost` is true, sort so that the
        # family's first-pick request (is_first_requested=true) lands in
        # slot 0 of the diminishing-returns stack. When false, slot 0
        # falls to natural iteration order — useful for A/B-testing the
        # boost in the solver-debug UI.
        enable_first_boost = bool(self.config.get_int("objective.enable_first_boost", default=1))

        # Stream 4 (#1382): boost reciprocated bunk_with pairs. Always on;
        # set to 1.0 to disable in-place without removing the code path.
        mutual_request_boost = self.config.get_float("objective.mutual_request_boost", default=2.0)
        # #1561: feed possible_requests so an impossible reciprocal (e.g.
        # self_conflict on B's side, malformed B→A) doesn't register (A, B)
        # as mutual and falsely apply the 2x boost to A→B.
        mutual_bunk_with_pairs = compute_mutual_bunk_with_pairs(self.possible_requests)

        for person_cm_id, request_satisfactions in person_request_satisfaction.items():
            if not request_satisfactions:
                continue

            if enable_first_boost:
                # Stable sort by is_first_requested DESC — True (1) before
                # False (0), insertion order preserved among ties.
                request_satisfactions.sort(key=lambda x: x[0].is_first_requested, reverse=True)

            for i, (request, satisfied_var) in enumerate(request_satisfactions):
                base_weight = float(BASE_REQUEST_WEIGHT)
                # Apply source field multiplier based on CSV fields
                source_multiplier = self._get_csv_field_multiplier(request)
                base_weight = base_weight * source_multiplier

                if (
                    request.request_type == RequestType.BUNK_WITH.value
                    and request.requested_person_cm_id is not None
                    and frozenset({request.requester_person_cm_id, request.requested_person_cm_id})
                    in mutual_bunk_with_pairs
                ):
                    base_weight = base_weight * mutual_request_boost

                if i == 0:
                    weight = base_weight * FIRST_REQUEST_MULTIPLIER
                elif i == 1:
                    weight = base_weight * SECOND_REQUEST_MULTIPLIER
                else:
                    weight = base_weight * THIRD_PLUS_REQUEST_MULTIPLIER

                objective_terms.append(int(weight) * satisfied_var)

        # NOTE: Age preference is now handled by constraints/age_preference.py
        # NOTE: Level progression is now handled by constraints/level_progression.py

        # Add age/grade flow incentives
        add_age_grade_flow_objective(ctx, objective_terms)

        # NOTE: grade_spread soft constraint removed in Phase 2. Solver enforces
        # the MAX_UNIQUE_GRADES_PER_BUNK ceiling as a hard constraint; staff
        # manual overrides on the bunking board surface as ``grade_spread_warning``
        # ValidationIssues post-solve.

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
        satisfied_requests = satisfied_request_ids_by_person(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        # Log results
        logger.info(f"Assigned {len(assignments)} campers to {bunk.name}")
        logger.info(f"Satisfied {len(satisfied_requests)} campers' requests")

        # Single-bunk runs bypass CP-SAT, but the frontend impact-analysis
        # table renders every key from `_build_stats_dict`. Emit the full
        # key set with `None` for fields the simplified path can't populate
        # so column rendering is identical across session types.
        single_bunk_fires, single_bunk_penalties = _bucket_soft_constraint_violations(
            None, self.soft_constraint_violations
        )
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
            "soft_constraints_by_module": single_bunk_fires,
            "soft_constraint_penalty_by_module": single_bunk_penalties,
            "request_density_histogram_by_bucket": _build_request_density_histogram_by_bucket(
                self.input.requests_by_person
            ),
            # Tier 2 observability (Stream 2, Phase 2) — single-bunk path has
            # no CP-SAT solve, so trajectories are empty and derived scalars
            # are None. Keys present so frontend rendering is uniform.
            "objective_trajectory": [],
            "bound_trajectory": [],
            "bound_trajectory_truncated": False,
            "objective_trajectory_truncated": False,
            "lp_root_gap": None,
            "presolve_compression_ratio": None,
            "presolve_booleans_pre": 0,
            "objective_plateau_time": None,
            "bound_gain_after_plateau": None,
            "time_to_first_solution": None,
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

        # Add callback for progress tracking. Both capture surfaces (this and
        # BestBoundCallback, wired below) share one monotonic origin so their
        # trajectories are directly comparable.
        start_monotonic = time.monotonic()
        callback = SolverProgressCallback(self.constraint_logger, start_monotonic, self.debug_mode)

        # Best-bound capture surface — fires on every bound improvement,
        # independent of solutions, so it samples through the plateau when
        # `callback` goes quiet. hasattr guard: a pre-9.15 ortools local env
        # degrades to an empty bound_trajectory instead of crashing.
        bound_cb = BestBoundCallback(start_monotonic)
        if hasattr(solver, "best_bound_callback"):
            solver.best_bound_callback = bound_cb

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
        satisfied_requests = satisfied_request_ids_by_person(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        # Check constraint violations in final solution
        self._check_constraint_violations(assignments, solver)

        # Save logs to file if we have a session ID
        log_file_path = None
        if self.input.requests and len(self.input.requests) > 0:
            session_id = self.input.requests[0].session_cm_id
            log_file_path = self.constraint_logger.save_to_file(session_id)

        # Material-only counts for user-facing stats (Group 65 #1539).
        # Immaterial requests (socialize_with) still ran through the solver but
        # are excluded from the reported aggregates.
        material_requests = [r for r in self.input.requests if is_counted_request(r)]
        request_by_id = {r.id: r for r in self.input.requests}
        satisfied_material_count = sum(
            1
            for req_ids in satisfied_requests.values()
            for req_id in req_ids
            if is_counted_request(request_by_id[req_id])
        )

        # Create output
        stats = _build_stats_dict(
            solver=solver,
            status=status,
            model_proto=self.model.Proto(),
            time_limit_seconds=time_limit_seconds,
            num_workers=num_workers,
            num_persons=len(self.person_ids),
            num_bunks=len(self.bunks),
            num_requests=len(material_requests),
            satisfied_count=satisfied_material_count,
            soft_constraint_violations=self.soft_constraint_violations,
            requests_by_person=self.input.requests_by_person,
            objective_trajectory=callback.objective_trajectory,
            bound_trajectory=bound_cb.bound_trajectory,
            bound_trajectory_truncated=bound_cb.truncated,
            objective_trajectory_truncated=callback.truncated,
        )
        stats["request_validation"] = self.request_validation_summary

        return DirectSolverOutput(
            assignments=assignments,
            stats=stats,
            satisfied_requests=satisfied_requests,
            log_file_path=log_file_path,
        )

    def _log_objective_breakdown(self, solver: cp_model.CpSolver) -> None:
        """Log breakdown of objective value by category."""
        logger.info("=== Post-Solve Objective Breakdown ===")
        logger.info(f"Total objective value: {solver.ObjectiveValue():.0f}")

        fires_by_module, penalty_by_module = _bucket_soft_constraint_violations(solver, self.soft_constraint_violations)

        firing_buckets = [
            (label, penalty_by_module[label], fires_by_module[label])
            for label in penalty_by_module
            if fires_by_module[label] > 0
        ]
        if firing_buckets:
            logger.info("Soft constraint penalties by category:")
            for label, total, count in sorted(firing_buckets, key=lambda x: -x[1]):
                logger.info(f"  {label}: {total} ({count} violations)")
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
        all_satisfied = satisfied_request_ids_by_person(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )

        # Input-property `no_possible`: placed campers in the canonical rollup
        # (`ImpossibilityReport.campers_no_resolved_possible`). Decoupled from
        # `all_satisfied` so the count is invariant across solve outcomes. The
        # diagnostic-loop body below skips these campers when bucketing into
        # material_parent_unmet / other_unmet to preserve mutual exclusivity.
        no_possible_cm_ids: set[int] = {
            int(entry["cm_id"]) for entry in self.impossibility_report.campers_no_resolved_possible
        }
        no_possible: list[int] = [cm_id for cm_id in no_possible_cm_ids if cm_id in person_to_bunk]
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
        all_requests_total = 0
        all_requests_satisfied = 0

        # All four rate metrics ("Optimized (MP req)", "Acceptable (MP camper)",
        # "Request rate", "Camper rate") gate on possibility so they share the
        # same denominator semantics: only resolved requests/campers the solver
        # actually has a path to satisfy. Without this, structurally-impossible
        # requests (e.g. requestee in another session) silently drag denominators
        # down and the metrics drift apart purely as bookkeeping artifacts.
        impossible_request_ids: set[str] = {item.request_id for item in self.impossibility_report.flat}

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
            resolved_possible_mp = [r for r in resolved_mp if r.id not in impossible_request_ids]
            resolved_possible = [r for r in resolved_requests if r.id not in impossible_request_ids]

            # Request-level "Optimized" (MP) rate.
            mp_requests_total += len(resolved_possible_mp)
            mp_requests_satisfied += sum(1 for r in resolved_possible_mp if r.id in satisfied_ids_for_person)

            # Camper-level "Acceptable" (MP) rate.
            if resolved_possible_mp:
                mp_campers_total += 1
                if any(r.id in satisfied_ids_for_person for r in resolved_possible_mp):
                    mp_campers_satisfied += 1

            # Request-level "Request rate" (any source).
            all_requests_total += len(resolved_possible)
            all_requests_satisfied += sum(1 for r in resolved_possible if r.id in satisfied_ids_for_person)

            # Camper-level "Camper rate" (any source).
            if resolved_possible:
                all_campers_total += 1
                if any(r.id in satisfied_ids_for_person for r in resolved_possible):
                    all_campers_satisfied += 1

            # Campers already accounted for as input-property `no_possible` are
            # not eligible for the post-solve unmet buckets (mutual exclusivity).
            if person_cm_id in no_possible_cm_ids:
                continue

            resolved_ids = {r.id for r in resolved_requests}
            if any(rid in resolved_ids for rid in all_satisfied.get(person_cm_id, [])):
                continue

            resolved_possible = [r for r in self.possible_requests.get(person_cm_id, []) if r.status == "resolved"]
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
        # constraint was not added for them. Populated by `_validate_requests`
        # from the impossibility report (single source of truth); `parent_paramount`
        # no longer re-derives it. Surfaced here for dashboard visibility.
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
        self.request_validation_summary["all_requests_total"] = all_requests_total
        self.request_validation_summary["all_requests_satisfied"] = all_requests_satisfied

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

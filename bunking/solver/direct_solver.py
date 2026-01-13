"""
Direct Bunking Solver - works directly with bunk_requests data.
No transformation needed.
"""

from __future__ import annotations

import logging
import os
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

from bunking.config import ConfigLoader
from bunking.models_v2 import (
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectSolverInput,
    DirectSolverOutput,
)
from campminder.client import get_current_season

from .callbacks import SolverProgressCallback
from .constraints.age_grade_flow import add_age_grade_flow_objective
from .constraints.age_spread import add_age_spread_constraints
from .constraints.base import SolverContext
from .constraints.cabin_capacity import add_cabin_capacity_soft_constraint
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
from .constraints.must_satisfy import add_must_satisfy_one_request_constraints
from .feasibility import check_feasibility as _check_feasibility
from .feasibility import find_infeasibility_cause as _find_infeasibility_cause
from .logging import ConstraintLogger
from .solution import analyze_solution, calculate_satisfied_requests

logger = logging.getLogger(__name__)


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
        if not hasattr(self, "_pair_reduction_logged"):
            self._pair_reduction_logged = 0
        if self._pair_reduction_logged < 5:
            logger.debug(
                f"Valid bunks for pair {person1_cm_id}-{person2_cm_id} "
                f"(session {session_id}, genders {person1.gender}/{person2.gender}): "
                f"{len(valid_bunks)}/{len(self.bunks)} bunks"
            )
            self._pair_reduction_logged += 1

        return valid_bunks

    def _validate_requests(self) -> None:
        """Validate requests and categorize as possible (can be satisfied) or impossible (reference out-of-session people)."""
        total_requests = 0
        impossible_count = 0
        affected_campers = set()

        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in self.person_idx_map:
                continue  # Skip if person not in session

            self.possible_requests[person_cm_id] = []
            self.impossible_requests[person_cm_id] = []

            for request in requests:
                total_requests += 1

                # Check if this is a request that references another person
                if request.request_type in ["bunk_with", "not_bunk_with"]:
                    if request.requested_person_cm_id:
                        # Check if requested person is in this session
                        if request.requested_person_cm_id in self.person_idx_map:
                            self.possible_requests[person_cm_id].append(request)
                        else:
                            self.impossible_requests[person_cm_id].append(request)
                            impossible_count += 1
                            affected_campers.add(person_cm_id)
                    else:
                        # No requested person specified - treat as impossible
                        self.impossible_requests[person_cm_id].append(request)
                        impossible_count += 1
                else:
                    # Other request types (age_preference, etc.) are always possible
                    self.possible_requests[person_cm_id].append(request)

        # Log validation results
        if impossible_count > 0:
            logger.warning(
                f"Request validation: {impossible_count} of {total_requests} requests "
                f"reference people not in this session"
            )
            logger.warning(f"Affected campers: {len(affected_campers)}")

            # Log details for debugging
            if self.debug_mode:
                logger.debug("Impossible requests by camper:")
                for person_cm_id in list(affected_campers)[:10]:  # Show first 10
                    person = self.input.person_by_cm_id[person_cm_id]
                    impossible_reqs = self.impossible_requests[person_cm_id]
                    for req in impossible_reqs:
                        logger.debug(
                            f"  - {person.name}: {req.request_type} request for "
                            f"ID {req.requested_person_cm_id} (not in session)"
                        )

        # Store summary for later use
        self.request_validation_summary = {
            "total_requests": total_requests,
            "possible_requests": total_requests - impossible_count,
            "impossible_requests": impossible_count,
            "affected_campers": len(affected_campers),
        }

    def check_feasibility(self) -> None:
        """Perform pre-solve feasibility checks and log warnings."""
        _check_feasibility(
            bunks=self.bunks,
            person_ids=self.person_ids,
            input_data=self.input,
            constraint_logger=self.constraint_logger,
            person_idx_map=self.person_idx_map,
            bunk_idx_map=self.bunk_idx_map,
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

        # 3. Bunk capacity constraints
        capacity_mode = self.config.get_str("constraint.cabin_capacity.mode", default="hard")

        if capacity_mode == "hard":
            self.constraint_logger.log_constraint(
                "hard", "cabin_capacity", f"Cabin capacity constraints for {len(self.bunks)} bunks"
            )
            for bunk_idx, bunk in enumerate(self.bunks):
                self.model.Add(
                    sum(self.assignments[(person_idx, bunk_idx)] for person_idx in range(len(self.person_ids)))
                    <= bunk.capacity
                )
        else:
            # Soft mode - enforce max capacity as hard limit, penalize over standard
            max_capacity = self.config.get_int("constraint.cabin_capacity.max", default=14)
            self.constraint_logger.log_constraint(
                "soft",
                "cabin_capacity",
                f"Cabin capacity soft constraints for {len(self.bunks)} bunks (max: {max_capacity})",
            )
            for bunk_idx, bunk in enumerate(self.bunks):
                occupancy_expr = sum(
                    self.assignments[(person_idx, bunk_idx)] for person_idx in range(len(self.person_ids))
                )

                # Hard constraint: In soft mode, allow up to max_capacity
                # This allows overflow beyond the bunk's standard capacity
                self.model.Add(occupancy_expr <= max_capacity)

                # Soft constraint: Track overcrowding beyond standard capacity
                # This will be penalized in the objective function

        # 3.5. Minimum occupancy constraint for non-AG bunks
        # Staff never put fewer than ~8 campers in a cabin
        ctx = self._build_solver_context()
        self.bunk_is_used = add_cabin_minimum_occupancy_constraints(ctx)

        # 4. Manual locks (individual)
        if self.input.locked_assignments:
            self.constraint_logger.log_constraint(
                "hard", "manual_locks", f"{len(self.input.locked_assignments)} individual camper locks"
            )
        for person_cm_id, bunk_cm_id in self.input.locked_assignments.items():
            if person_cm_id in self.person_idx_map and bunk_cm_id in self.bunk_idx_map:
                person_idx = self.person_idx_map[person_cm_id]
                bunk_idx = self.bunk_idx_map[bunk_cm_id]
                self.model.Add(self.assignments[(person_idx, bunk_idx)] == 1)

        # 5. Group locks
        # Uses extracted constraint module - debug check is internal
        add_group_lock_constraints(self._build_solver_context())

        # 6. Grade/age spread constraints - NOW ENABLED with aggregation
        # Check if grade spread should be hard or soft constraint
        grade_spread_mode = self.config.get_str("constraint.grade_spread.mode", default="hard")
        logger.info(f"Grade spread mode from config: '{grade_spread_mode}'")
        if grade_spread_mode == "hard":
            # Uses extracted constraint module - debug check is internal
            add_grade_spread_constraints(self._build_solver_context())
        else:
            logger.info("Grade spread will be handled as SOFT constraint in objective function")
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
        """Get the appropriate multiplier based on CSV source fields.

        Priority order (highest to lowest):
        1. share_bunk_with (1.5x)
        2. do_not_share_with (1.5x)
        3. bunking_notes (1.0x)
        4. internal_notes (0.8x)
        5. socialize_preference (0.05x)
        """
        # Try to get csv_source_fields from request or ai_reasoning
        csv_fields = None
        if hasattr(request, "csv_source_fields") and request.csv_source_fields:
            csv_fields = request.csv_source_fields
        elif hasattr(request, "ai_reasoning") and isinstance(request.ai_reasoning, dict):
            csv_fields = request.ai_reasoning.get("csv_source_fields", None)

        if csv_fields:
            # Apply the highest priority multiplier from all source fields
            max_multiplier = 0.0

            for field in csv_fields:
                multiplier_key = f"objective.source_multipliers.{field}"
                field_multiplier = self.config.get_float(multiplier_key, default=1.0)
                max_multiplier = max(max_multiplier, field_multiplier)

            return max_multiplier

        # Fallback to source_field for backwards compatibility
        elif hasattr(request, "source_field") and request.source_field:
            multiplier_key = f"objective.source_multipliers.{request.source_field}"
            return self.config.get_float(multiplier_key, default=1.0)

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
                if request.request_type == "bunk_with":
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

                elif request.request_type == "not_bunk_with":
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

        # Add cabin capacity soft constraint if configured
        capacity_mode = self.config.get_str("constraint.cabin_capacity.mode", default="hard")
        if capacity_mode == "soft":
            add_cabin_capacity_soft_constraint(ctx, objective_terms)

        # Add cabin minimum occupancy soft penalty (prefer fuller bunks)
        add_cabin_minimum_occupancy_soft_penalty(ctx, objective_terms, self.bunk_is_used)

        # Subtract penalties for soft constraint violations
        for _violation_name, (violation_var, penalty) in self.soft_constraint_violations.items():
            objective_terms.append(-penalty * violation_var)

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

        logger.info(f"Single-bunk session: {bunk.name} (capacity: {bunk.capacity})")
        logger.info(f"Campers to assign: {len(self.person_ids)}")

        # Check if we have too many campers for the bunk
        if len(self.person_ids) > bunk.capacity:
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

        # Calculate simple satisfaction stats
        satisfied_requests = {}
        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in self.person_ids:
                continue

            satisfied = []
            for request in requests:
                if request.request_type == "bunk_with" and request.requested_person_cm_id:
                    # Check if requested person is also in this session
                    if request.requested_person_cm_id in self.person_ids:
                        satisfied.append(f"bunk_with:{request.requested_person_cm_id}")

            if satisfied:
                satisfied_requests[person_cm_id] = satisfied

        # Log results
        logger.info(f"Assigned {len(assignments)} campers to {bunk.name}")
        logger.info(f"Satisfied {len(satisfied_requests)} campers' requests")

        # Return output
        return DirectSolverOutput(
            assignments=assignments,
            satisfied_requests=satisfied_requests,
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

        # Enable detailed logging for debugging
        solver.parameters.log_search_progress = True
        solver.log_callback = lambda msg: logger.info(f"OR-Tools: {msg}")

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
        logger.info(
            f"Model has {self.model.Proto().variables} variables and {len(self.model.Proto().constraints)} constraints"
        )

        # Export model for debugging if it fails
        model_export_path = (
            f"logs/solver/model_session_{getattr(self.input.persons[0], 'session_cm_id', 'unknown')}.txt"
        )

        # Solve with callback
        status = solver.Solve(self.model, callback)

        # If infeasible, export the model and try to find conflicts
        if status == cp_model.INFEASIBLE:
            logger.error("Model is INFEASIBLE - exporting model for analysis")
            try:
                with open(model_export_path, "w") as f:
                    f.write(str(self.model.Proto()))
                logger.info(f"Model exported to {model_export_path}")

                # Try to find minimal infeasible subset
                logger.info("Attempting to identify conflicting constraints...")
                # Log some basic stats about constraints
                proto = self.model.Proto()
                bool_and_count = sum(1 for c in proto.constraints if c.HasField("bool_and"))
                bool_or_count = sum(1 for c in proto.constraints if c.HasField("bool_or"))
                linear_count = sum(1 for c in proto.constraints if c.HasField("linear"))
                logger.info(
                    f"Constraint types: bool_and={bool_and_count}, bool_or={bool_or_count}, linear={linear_count}"
                )

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
            logger.info("\n=== Request Satisfaction by CSV Field ===")
            for field, stats in analysis["field_level_stats"]["by_field"].items():
                if stats["total"] > 0:
                    logger.info(
                        f"{field}: {stats['satisfied']}/{stats['total']} ({stats['satisfaction_rate']:.1%} satisfied)"
                    )

            explicit_stats = analysis["field_level_stats"]["explicit_csv_requests"]
            logger.info("\nExplicit CSV fields (share_bunk_with, do_not_share_with, bunking_notes, internal_notes):")
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
        return DirectSolverOutput(
            assignments=assignments,
            stats={
                "status": solver.StatusName(status),
                "objective_value": solver.ObjectiveValue(),
                "solve_time": solver.WallTime(),
                "total_persons": len(self.person_ids),
                "total_bunks": len(self.bunks),
                "total_requests": len(self.input.requests),
                "satisfied_request_count": sum(len(reqs) for reqs in satisfied_requests.values()),
                # Request validation statistics
                "request_validation": self.request_validation_summary,
            },
            satisfied_requests=satisfied_requests,
            analysis=analysis,
            log_file_path=log_file_path,
        )

    def _log_objective_breakdown(self, solver: cp_model.CpSolver) -> None:
        """Log breakdown of objective value by category.

        Shows how much each soft constraint category contributed to the objective.
        """
        logger.info("\n=== Post-Solve Objective Breakdown ===")
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
            except Exception:
                # Variable might not be in solution
                pass

        if category_totals:
            logger.info("\nSoft constraint penalties by category:")
            for category, total in sorted(category_totals.items(), key=lambda x: -x[1]):
                count = category_counts[category]
                logger.info(f"  {category}: {total:.0f} ({count} violations)")
        else:
            logger.info("No soft constraint penalties incurred")

    def _check_constraint_violations(self, assignments: list[DirectBunkAssignment], solver: cp_model.CpSolver) -> None:
        """Check for constraint violations in the final solution."""
        logger.info("\n=== Post-Solve Constraint Violation Check ===")

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
            logger.info(f"\n{len(soft_violations)} soft constraint violations:")
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

        # 4. Check must-satisfy-one violations
        unsatisfied_campers = []
        all_satisfied = calculate_satisfied_requests(
            assignments, self.input.requests_by_person, self.input.person_by_cm_id
        )
        for person_cm_id, requests in self.input.requests_by_person.items():
            if person_cm_id not in person_to_bunk:
                continue

            # Check if any request is satisfied
            satisfied_count = len(all_satisfied.get(person_cm_id, []))

            if satisfied_count == 0 and len(requests) > 0:
                unsatisfied_campers.append(person_cm_id)

        if unsatisfied_campers:
            logger.info(f"\n{len(unsatisfied_campers)} campers with NO satisfied requests:")
            for person_cm_id in unsatisfied_campers[:10]:  # Show first 10
                person = self.input.person_by_cm_id[person_cm_id]
                self.constraint_logger.log_violation(
                    "must_satisfy_one",
                    f"{person.name} (ID: {person_cm_id}) has no satisfied requests",
                    severity="warning",
                )
            if len(unsatisfied_campers) > 10:
                logger.info(f"... and {len(unsatisfied_campers) - 10} more")

        logger.info("=== End Constraint Violation Check ===\n")

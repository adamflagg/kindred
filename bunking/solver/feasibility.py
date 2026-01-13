"""
Feasibility checking for the bunk solver.

Pre-solve checks to identify potential issues before running the solver.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from ortools.sat.python import cp_model

if TYPE_CHECKING:
    from bunking.config import ConfigLoader
    from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectSolverInput
    from bunking.solver.logging import ConstraintLogger

logger = logging.getLogger(__name__)


def check_feasibility(
    bunks: list[DirectBunk],
    person_ids: list[int],
    input_data: DirectSolverInput,
    constraint_logger: ConstraintLogger,
    person_idx_map: dict[int, int],
    bunk_idx_map: dict[int, int],
    possible_requests: dict[int, list[DirectBunkRequest]],
    impossible_requests: dict[int, list[DirectBunkRequest]],
    request_validation_summary: dict[str, int],
) -> None:
    """Perform pre-solve feasibility checks and log warnings.

    Args:
        bunks: List of bunks in the solver
        person_ids: List of person CampMinder IDs
        input_data: The full solver input data
        constraint_logger: Logger for constraint messages
        person_idx_map: Map from person cm_id to solver index
        bunk_idx_map: Map from bunk cm_id to solver index
        possible_requests: Map from person cm_id to satisfiable requests
        impossible_requests: Map from person cm_id to unsatisfiable requests
        request_validation_summary: Summary of request validation results
    """
    logger.info("=== Pre-solve Feasibility Check ===")

    # 1. Total capacity check
    total_capacity = sum(bunk.capacity for bunk in bunks)
    total_campers = len(person_ids)

    if total_campers > total_capacity:
        constraint_logger.log_feasibility_warning(
            f"CRITICAL: Total campers ({total_campers}) exceeds total capacity ({total_capacity}). "
            f"Solution is IMPOSSIBLE without soft capacity constraints!"
        )
    else:
        logger.info(f"Total capacity check: {total_campers} campers, {total_capacity} spots available")

    # 1.5 Session analysis
    camper_sessions: dict[int, dict[str, int]] = {}
    bunk_sessions: dict[int, dict[str, Any]] = {}
    for p in input_data.persons:
        session = p.session_cm_id
        if session not in camper_sessions:
            camper_sessions[session] = {"total": 0, "M": 0, "F": 0, "Other": 0}
        camper_sessions[session]["total"] += 1
        if p.gender == "M":
            camper_sessions[session]["M"] += 1
        elif p.gender == "F":
            camper_sessions[session]["F"] += 1
        else:
            camper_sessions[session]["Other"] += 1

    for b in bunks:
        session = b.session_cm_id
        if session not in bunk_sessions:
            bunk_sessions[session] = {"bunks": [], "capacity": {"M": 0, "F": 0, "Mixed": 0}}
        bunk_sessions[session]["bunks"].append(b.name)
        if b.gender == "M":
            bunk_sessions[session]["capacity"]["M"] += b.capacity
        elif b.gender == "F":
            bunk_sessions[session]["capacity"]["F"] += b.capacity
        else:
            bunk_sessions[session]["capacity"]["Mixed"] += b.capacity

    logger.info("=== Session Distribution ===")
    for session in sorted(set(camper_sessions.keys()) | set(bunk_sessions.keys())):
        logger.info(f"Session {session}:")
        if session in camper_sessions:
            cs = camper_sessions[session]
            logger.info(f"  Campers: Total={cs['total']}, M={cs['M']}, F={cs['F']}, Other={cs['Other']}")
        else:
            logger.info("  Campers: None")

        if session in bunk_sessions:
            bs = bunk_sessions[session]
            logger.info(f"  Bunks: {len(bs['bunks'])} total")
            logger.info(
                f"  Capacity: M={bs['capacity']['M']}, F={bs['capacity']['F']}, Mixed={bs['capacity']['Mixed']}"
            )

            # Check gender-specific capacity
            if session in camper_sessions:
                cs = camper_sessions[session]
                for gender in ["M", "F"]:
                    camper_count = cs[gender]
                    # Include both gender-specific and Mixed/AG capacity
                    capacity = bs["capacity"].get(gender, 0) + bs["capacity"].get("Mixed", 0)
                    if camper_count > capacity:
                        constraint_logger.log_feasibility_warning(
                            f"Session {session} {gender}: {camper_count} campers but only {capacity} spots (including AG)!"
                        )
        else:
            logger.info("  Bunks: None (No bunks for this session!)")

        if session in bunk_sessions:
            bs = bunk_sessions[session]
            total_cap = sum(bs["capacity"].values())
            logger.info(f"  Bunks: {len(bs['bunks'])} bunks, Total capacity={total_cap}")
            logger.info(
                f"  Capacity by gender: M={bs['capacity']['M']}, F={bs['capacity']['F']}, Mixed={bs['capacity']['Mixed']}"
            )
        else:
            logger.info("  Bunks: None")

    # Check for session mismatches
    camper_only_sessions = set(camper_sessions.keys()) - set(bunk_sessions.keys())
    bunk_only_sessions = set(bunk_sessions.keys()) - set(camper_sessions.keys())
    if camper_only_sessions:
        constraint_logger.log_feasibility_warning(
            f"CRITICAL: Campers in sessions with NO bunks: {camper_only_sessions}"
        )
    if bunk_only_sessions:
        logger.warning(f"Bunks in sessions with NO campers: {bunk_only_sessions}")

    # 2. Gender-specific capacity check (overall)
    male_campers = sum(1 for p in input_data.persons if p.gender == "M")
    female_campers = sum(1 for p in input_data.persons if p.gender == "F")
    other_campers = sum(1 for p in input_data.persons if p.gender not in ["M", "F"])

    male_capacity = sum(b.capacity for b in bunks if b.gender == "M")
    female_capacity = sum(b.capacity for b in bunks if b.gender == "F")
    mixed_capacity = sum(b.capacity for b in bunks if b.gender == "Mixed")

    logger.info("\n=== Overall Gender Analysis ===")
    logger.info(f"Gender distribution: M={male_campers}, F={female_campers}, Other={other_campers}")
    logger.info(f"Gender capacity: M={male_capacity}, F={female_capacity}, Mixed={mixed_capacity}")

    # Check male capacity
    if male_campers > male_capacity + mixed_capacity:
        constraint_logger.log_feasibility_warning(
            f"Gender constraint violation: {male_campers} males but only "
            f"{male_capacity + mixed_capacity} spots (M: {male_capacity}, Mixed: {mixed_capacity})"
        )

    # Check female capacity
    if female_campers > female_capacity + mixed_capacity:
        constraint_logger.log_feasibility_warning(
            f"Gender constraint violation: {female_campers} females but only "
            f"{female_capacity + mixed_capacity} spots (F: {female_capacity}, Mixed: {mixed_capacity})"
        )

    # 3. Group lock feasibility
    for group_lock_id, person_cm_ids in input_data.group_locks.items():
        group_size = len([pid for pid in person_cm_ids if pid in person_idx_map])

        # Find bunks that can fit this group
        suitable_bunks = [b for b in bunks if b.capacity >= group_size]

        if not suitable_bunks:
            constraint_logger.log_feasibility_warning(
                f"Group lock {group_lock_id} has {group_size} members but no cabin "
                f"has capacity >= {group_size}. This group CANNOT be kept together!"
            )
        else:
            logger.info(f"Group lock {group_lock_id} ({group_size} members) can fit in {len(suitable_bunks)} cabins")

    # 4. Individual cabin analysis
    logger.info("\n=== Cabin Capacity Analysis ===")
    for bunk in bunks:
        occupancy_info = f"Cabin {bunk.name}: capacity {bunk.capacity}, gender {bunk.gender}"
        logger.info(occupancy_info)

    # 5. Check for locked assignments exceeding capacity
    bunk_locked_counts: dict[int, int] = defaultdict(int)
    for person_cm_id, bunk_cm_id in input_data.locked_assignments.items():
        if person_cm_id in person_idx_map and bunk_cm_id in bunk_idx_map:
            bunk_locked_counts[bunk_cm_id] += 1

    for bunk_cm_id, locked_count in bunk_locked_counts.items():
        bunk_idx = bunk_idx_map[bunk_cm_id]
        bunk = bunks[bunk_idx]
        if locked_count > bunk.capacity:
            constraint_logger.log_feasibility_warning(
                f"Cabin {bunk.name} has {locked_count} locked assignments but capacity is only {bunk.capacity}!"
            )

    # 6. Request validation summary
    if request_validation_summary["impossible_requests"] > 0:
        logger.info("\n=== Request Validation Summary ===")
        logger.info(f"Total requests: {request_validation_summary['total_requests']}")
        logger.info(f"Possible requests: {request_validation_summary['possible_requests']}")
        logger.info(
            f"Impossible requests: {request_validation_summary['impossible_requests']} "
            f"(reference people not in session)"
        )
        logger.info(f"Campers affected: {request_validation_summary['affected_campers']}")

        # Check if any campers have ONLY impossible requests
        campers_with_only_impossible = []
        for person_cm_id in person_ids:
            if person_cm_id in possible_requests:
                if len(possible_requests[person_cm_id]) == 0 and len(impossible_requests.get(person_cm_id, [])) > 0:
                    campers_with_only_impossible.append(person_cm_id)

        if campers_with_only_impossible:
            constraint_logger.log_feasibility_warning(
                f"{len(campers_with_only_impossible)} campers have ONLY impossible requests! "
                f"Must-satisfy-one constraint cannot be satisfied for them."
            )

    # Check for stranded campers
    logger.info("=== Checking for stranded campers ===")
    stranded_count = 0
    stranded_by_reason: dict[str, int] = defaultdict(int)

    for p in input_data.persons:
        possible_bunks = 0
        for b in bunks:
            # Check if this person can go in this bunk
            if b.session_cm_id == p.session_cm_id and (b.gender == p.gender or b.gender == "Mixed"):
                possible_bunks += 1

        if possible_bunks == 0:
            stranded_count += 1
            reason = f"session={p.session_cm_id},gender={p.gender}"
            stranded_by_reason[reason] += 1
            if stranded_count <= 5:  # Log first few
                logger.warning(f"STRANDED: {p.name} ({reason}) has NO possible bunks!")

    if stranded_count > 0:
        constraint_logger.log_feasibility_warning(
            f"CRITICAL: {stranded_count} campers have no possible bunks due to session/gender constraints!"
        )
        logger.warning("Stranded campers by reason:")
        for reason, count in stranded_by_reason.items():
            logger.warning(f"  {reason}: {count} campers")

    logger.info("=== End Feasibility Check ===\n")


def find_infeasibility_cause(
    input_data: DirectSolverInput,
    config: ConfigLoader,
    time_limit_seconds: int = 10,
) -> str:
    """Try to identify which constraint is causing infeasibility.

    Creates new solver instances with different constraint combinations
    to identify which constraint is causing the problem.

    Args:
        input_data: The solver input data
        config: Configuration service
        time_limit_seconds: Time limit for each solver run

    Returns:
        A description of the likely cause.
    """
    # Import here to avoid circular dependency
    from bunking.solver import DirectBunkingSolver

    logger.info("=== Starting Infeasibility Analysis ===")

    # List of constraints to test
    constraint_types = [
        "session_boundary",
        "must_satisfy_one",
        "grade_spread",
        "gender",
        "level_progression",
        "group_locks",
    ]

    results = {}

    # First, try with all constraints
    logger.info("Testing with all constraints enabled...")
    solver = DirectBunkingSolver(input_data, config, {})
    solver.check_feasibility()
    solver.add_constraints()
    solver.add_objective()

    cp_solver = cp_model.CpSolver()
    cp_solver.parameters.max_time_in_seconds = time_limit_seconds
    status = cp_solver.Solve(solver.model)

    all_enabled_status = cp_solver.StatusName(status)
    logger.info(f"All constraints enabled: {all_enabled_status}")

    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        return "No infeasibility found - problem is solvable!"

    # Test disabling each constraint type
    for constraint in constraint_types:
        logger.info(f"\nTesting with {constraint} DISABLED...")

        debug_constraints = {constraint: True}  # True means disabled
        solver = DirectBunkingSolver(input_data, config, debug_constraints)
        solver.check_feasibility()
        solver.add_constraints()
        solver.add_objective()

        cp_solver = cp_model.CpSolver()
        cp_solver.parameters.max_time_in_seconds = time_limit_seconds
        status = cp_solver.Solve(solver.model)

        results[constraint] = cp_solver.StatusName(status)
        logger.info(f"With {constraint} disabled: {results[constraint]}")

        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            logger.info(f"FOUND IT! Disabling {constraint} makes the problem feasible.")
            return f"The {constraint} constraint is causing infeasibility"

    # If still infeasible with each individual constraint disabled, try combinations
    logger.info("\nNo single constraint removal fixed it. The issue may be a combination.")
    return "Infeasibility caused by multiple interacting constraints"

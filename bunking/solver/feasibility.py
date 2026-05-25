"""
Feasibility checking for the bunk solver.

Pre-solve checks to identify potential issues before running the solver.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any, TypedDict

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger
from bunking.satisfaction.bucket import is_material_parent_request
from bunking.solver.constants import MAX_AGE_SPREAD_MONTHS, MAX_UNIQUE_GRADES_PER_BUNK
from bunking.solver.constraints.age_spread import _age_to_months

if TYPE_CHECKING:
    from bunking.config import ConfigLoader
    from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectSolverInput
    from bunking.solver.impossibility import ImpossibilityReport
    from bunking.solver.logging import ConstraintLogger

logger = get_logger(__name__)


class _RequestValidationSummaryBase(TypedDict, total=True):
    # Required keys set by _validate_requests before check_feasibility is called
    total_requests: int
    possible_requests: int
    impossible_requests: int
    impossible_by_reason: dict[str, dict[str, int]]
    affected_campers: int


class RequestValidationSummary(_RequestValidationSummaryBase, total=False):
    # Optional keys written post-solve in direct_solver.py
    unsatisfied_no_possible: int
    unsatisfied_material_parent_unmet: int
    unsatisfied_other_unmet: int
    mp_constraint_bug_signal: int
    mp_set_entirely_impossible_count: int
    mp_set_entirely_impossible_cm_ids: list[int]
    mp_requests_total: int
    mp_requests_satisfied: int
    mp_campers_total: int
    mp_campers_satisfied: int
    all_campers_total: int
    all_campers_satisfied: int
    all_requests_total: int
    all_requests_satisfied: int
    # Hard staff/manual not_bunk_with separations that yielded to a parent-paramount
    # MSO (#1541). Each entry: {nbw_request_id, subject_cm, target_cm,
    # protected_parent_request_id, protected_camper_cm}. Consumed by Stream B (#1638).
    staff_nbw_yielded_count: int
    staff_nbw_yielded: list[dict[str, Any]]


def check_feasibility(
    bunks: list[DirectBunk],
    person_ids: list[int],
    input_data: DirectSolverInput,
    constraint_logger: ConstraintLogger,
    person_idx_map: dict[int, int],
    possible_requests: dict[int, list[DirectBunkRequest]],
    impossible_requests: dict[int, list[DirectBunkRequest]],
    request_validation_summary: RequestValidationSummary,
) -> None:
    """Perform pre-solve feasibility checks and log warnings.

    Args:
        bunks: List of bunks in the solver
        person_ids: List of person CampMinder IDs
        input_data: The full solver input data
        constraint_logger: Logger for constraint messages
        person_idx_map: Map from person cm_id to solver index
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

    logger.debug("=== Session Distribution ===")
    for session in sorted(set(camper_sessions.keys()) | set(bunk_sessions.keys())):
        logger.debug(f"Session {session}:")
        if session in camper_sessions:
            cs = camper_sessions[session]
            logger.debug(f"  Campers: Total={cs['total']}, M={cs['M']}, F={cs['F']}, Other={cs['Other']}")
        else:
            logger.debug("  Campers: None")

        if session in bunk_sessions:
            bs = bunk_sessions[session]
            total_cap = sum(bs["capacity"].values())
            logger.debug(
                f"  Bunks: {len(bs['bunks'])}, total capacity={total_cap}, "
                f"M={bs['capacity']['M']}, F={bs['capacity']['F']}, Mixed={bs['capacity']['Mixed']}"
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
            logger.debug("  Bunks: None (No bunks for this session!)")

    # Concise INFO summary of session distribution
    all_sessions = sorted(set(camper_sessions) | set(bunk_sessions))
    session_parts = [f"{s}: {camper_sessions.get(s, {}).get('total', 0)} campers" for s in all_sessions]
    logger.info(f"Sessions: {len(all_sessions)} ({', '.join(session_parts)})")

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

    logger.debug("=== Overall Gender Analysis ===")
    logger.debug(f"Gender distribution: M={male_campers}, F={female_campers}, Other={other_campers}")
    logger.debug(f"Gender capacity: M={male_capacity}, F={female_capacity}, Mixed={mixed_capacity}")

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
    logger.debug("=== Cabin Capacity Analysis ===")
    for bunk in bunks:
        occupancy_info = f"Cabin {bunk.name}: capacity {bunk.capacity}, gender {bunk.gender}"
        logger.debug(occupancy_info)

    # 5. Request validation summary
    if request_validation_summary["impossible_requests"] > 0:
        logger.info("=== Request Validation Summary ===")
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
                logger.warning(f"STRANDED: {p.campminder_person_id} ({reason}) has NO possible bunks!")

    if stranded_count > 0:
        constraint_logger.log_feasibility_warning(
            f"CRITICAL: {stranded_count} campers have no possible bunks due to session/gender constraints!"
        )
        logger.warning("Stranded campers by reason:")
        for reason, count in stranded_by_reason.items():
            logger.warning(f"  {reason}: {count} campers")

    logger.info("=== End Feasibility Check ===")


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
    from bunking.solver import (  # noqa: PLC0415 — circular: bunking.solver.__init__ imports direct_solver which imports feasibility
        DirectBunkingSolver,
    )

    logger.info("=== Starting Infeasibility Analysis ===")

    # List of constraints to test. Each name must have a matching
    # is_constraint_disabled() check in its constraint module, or the probe
    # is a no-op solve that can never isolate a cause.
    constraint_types = [
        "session_boundary",
        "parent_paramount",  # supersedes the former must_satisfy_one probe
        "grade_spread",
        "age_spread",
        "gender",
        "level_progression",
        "group_locks",
    ]

    results = {}

    # First, try with all constraints
    logger.info("Testing with all constraints enabled...")
    solver = DirectBunkingSolver(input_data, config, {})
    # Reuse this report across every probe solver below — the request set is
    # identical, so re-running validate_impossibility per probe is wasted work.
    base_impossibility_report = solver.impossibility_report
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
        logger.info(f"Testing with {constraint} DISABLED...")

        debug_constraints = {constraint: True}  # True means disabled
        solver = DirectBunkingSolver(
            input_data, config, debug_constraints, impossibility_report=base_impossibility_report
        )
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
            if constraint == "grade_spread":
                actionable = _explain_grade_spread_infeasibility(input_data)
                if actionable is not None:
                    return actionable
            elif constraint == "age_spread":
                actionable = _explain_age_spread_infeasibility(input_data)
                if actionable is not None:
                    return actionable
            return f"The {constraint} constraint is causing infeasibility"

    # If still infeasible with each individual constraint disabled, try combinations
    logger.info("No single constraint removal fixed it. The issue may be a combination.")
    return "Infeasibility caused by multiple interacting constraints"


def _explain_age_spread_infeasibility(input_data: DirectSolverInput) -> str | None:
    """Return a staff-actionable diagnosis when a locked group exceeds ``MAX_AGE_SPREAD_MONTHS``.

    The hard ``MAX_AGE_SPREAD_MONTHS`` ceiling makes one new infeasibility
    class possible: a locked group whose members span more than that many
    months in age cannot fit any non-AG bunk. Surface that with the offending
    group + the next action (split on the bunking board, or accept the manual
    override).

    Returns ``None`` if no locked group exceeds the limit — the caller falls
    back to the generic ``"The age_spread constraint is causing
    infeasibility"`` message in that case.
    """
    person_by_cm = input_data.person_by_cm_id
    for group_id, member_cms in input_data.group_locks.items():
        ages_months = []
        for cm in member_cms:
            person = person_by_cm.get(cm)
            if person is not None and hasattr(person, "age"):
                ages_months.append(_age_to_months(person.age))
        if len(ages_months) < 2:
            continue
        spread = max(ages_months) - min(ages_months)
        if spread > MAX_AGE_SPREAD_MONTHS:
            return (
                f"Cannot solve within the {MAX_AGE_SPREAD_MONTHS}-month age "
                f"spread limit: locked group {group_id!r} spans {spread} months "
                f"— split the group on the bunking board or accept the manual "
                f"override."
            )
    return None


def _explain_grade_spread_infeasibility(input_data: DirectSolverInput) -> str | None:
    """Return a staff-actionable diagnosis when a locked group is the culprit.

    The hard ``MAX_UNIQUE_GRADES_PER_BUNK`` ceiling makes one new infeasibility
    class possible: a locked group spanning more than that many unique grades
    cannot fit in any bunk. Surface that with the offending grades + the next
    action (split on the bunking board, or accept the manual override).

    Returns ``None`` if no locked group is over the limit — the caller falls
    back to the generic ``"The grade_spread constraint is causing
    infeasibility"`` message in that case.
    """
    person_by_cm = input_data.person_by_cm_id
    for group_id, member_cms in input_data.group_locks.items():
        grades = sorted({person_by_cm[cm].grade for cm in member_cms if cm in person_by_cm})
        if len(grades) > MAX_UNIQUE_GRADES_PER_BUNK:
            return (
                f"Cannot solve within the {MAX_UNIQUE_GRADES_PER_BUNK}-grade limit: "
                f"locked group {group_id!r} spans grades {grades} — split the "
                f"group on the bunking board or accept the manual override."
            )
    return None


def _probe_mp_feasibility(
    input_data: DirectSolverInput,
    config: ConfigLoader,
    time_limit_seconds: int,
    skip: set[int],
    impossibility_report: ImpossibilityReport | None = None,
) -> bool | None:
    """Solve with the hard MP constraints for the ``skip`` campers lifted.

    Tri-state result:
      * ``True``  — feasible with those constraints skipped
      * ``False`` — provably infeasible
      * ``None``  — inconclusive (CP-SAT returned UNKNOWN, e.g. hit the time
        limit). Callers MUST treat ``None`` as "cannot conclude" and abort;
        collapsing it into infeasible corrupts the localization verdict
        (false ``minimal_correction_set`` / "not parent_paramount" results).

    ``impossibility_report`` is threaded into ``DirectBunkingSolver`` so the
    request×predicate scan runs once for the whole localization, not once per
    probe.
    """
    from bunking.solver import (  # noqa: PLC0415 — circular: bunking.solver.__init__ imports direct_solver which imports feasibility
        DirectBunkingSolver,
    )

    s = DirectBunkingSolver(input_data, config, {}, mp_skip_cms=skip, impossibility_report=impossibility_report)
    s.check_feasibility()
    s.add_constraints()
    s.add_objective()
    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = time_limit_seconds
    cp.parameters.num_search_workers = 1  # diagnostic — keep fast
    st = cp.Solve(s.model)
    if st == cp_model.UNKNOWN:
        logger.warning(f"  Probe returned UNKNOWN (skip={sorted(skip)[:5]}{'…' if len(skip) > 5 else ''})")
        return None
    return st in (cp_model.OPTIMAL, cp_model.FEASIBLE)


def localize_hard_mso_infeasibility(
    input_data: DirectSolverInput,
    config: ConfigLoader,
    time_limit_seconds: int = 5,
    max_candidates: int = 200,
) -> dict[str, Any]:
    """Locate which subset of MP-hard-constrained campers is jointly infeasible.

    Called by ``solver_runner.py`` after ``find_infeasibility_cause`` identifies
    ``parent_paramount`` as the cause. Two-pass strategy:

    1. **Singleton isolation** — for each candidate camper, solve with their
       hard MP constraint skipped. Collect any cm whose alone-removal restores
       feasibility (an "MCS singleton"). If non-empty, return.
    2. **Deletion filter** — if no singleton works, start with all candidates
       skipped (feasible by construction) and add them back one at a time.
       Each cm whose re-addition flips the model to INFEASIBLE is part of the
       minimal correction set. Returns a minimal MCS in O(N) solves.

    Cost: ~time_limit_seconds × N solves where N = MP-hard-constrained cms.
    Each solve usually returns INFEASIBLE in presolve (<0.1s), so 95
    candidates ≈ 10s total. Capped by ``max_candidates`` to prevent runaway
    cost on pathologically large sessions.

    Returns:
        {
          "approach": "singleton" | "deletion_filter" | "skipped",
          "candidate_count": N,
          "singleton_critical_cms": [cm_ids that alone restore feasibility],
          "minimal_correction_set": [cm_ids in a minimal MCS],
          "notes": str,
        }
    """
    logger.info("=== Localizing parent_paramount infeasibility ===")

    from bunking.solver import (  # noqa: PLC0415 — circular: bunking.solver.__init__ imports direct_solver which imports feasibility
        DirectBunkingSolver,
    )

    # Probe pass: build candidate cms (MP-hard-constrained, excluding
    # mp_set_entirely_impossible). Sorted so the deletion-filter walk below —
    # and the minimal_correction_set it produces — is reproducible run to run,
    # independent of upstream dict/request insertion order.
    probe = DirectBunkingSolver(input_data, config, {})
    probe.check_feasibility()
    # Reuse this report across every probe solver — the request set is
    # identical, so re-running validate_impossibility per probe is wasted work.
    impossibility_report = probe.impossibility_report
    excluded = set(probe.mp_set_entirely_impossible)
    candidate_cms = sorted(
        cm
        for cm, possible in probe.possible_requests.items()
        if cm not in excluded and any(is_material_parent_request(r) for r in possible)
    )

    logger.info(f"  Candidate MP-hard-constrained cms: {len(candidate_cms)}")

    if not candidate_cms:
        return {
            "approach": "skipped",
            "candidate_count": 0,
            "singleton_critical_cms": [],
            "minimal_correction_set": [],
            "notes": "No MP-hard-constrained campers; nothing to localize.",
        }

    if len(candidate_cms) > max_candidates:
        return {
            "approach": "skipped",
            "candidate_count": len(candidate_cms),
            "singleton_critical_cms": [],
            "minimal_correction_set": [],
            "notes": f"Candidate set ({len(candidate_cms)}) exceeds max_candidates ({max_candidates}); skipping localization to keep diagnostic cost bounded.",
        }

    def _skipped_unknown() -> dict[str, Any]:
        """Result returned when any probe is inconclusive (CP-SAT UNKNOWN)."""
        return {
            "approach": "skipped",
            "candidate_count": len(candidate_cms),
            "singleton_critical_cms": [],
            "minimal_correction_set": [],
            "notes": "Localization aborted: at least one solver probe returned UNKNOWN (likely timeout). Increase time_limit_seconds or reduce candidate set.",
        }

    def _is_feasible(skip: set[int]) -> bool | None:
        """Tri-state probe — True feasible, False infeasible, None inconclusive."""
        return _probe_mp_feasibility(input_data, config, time_limit_seconds, skip, impossibility_report)

    # Step 1: singleton isolation
    logger.info("  Pass 1: singleton isolation...")
    singleton_critical: list[int] = []
    for cm in candidate_cms:
        result = _is_feasible({cm})
        if result is None:
            logger.warning("  Aborting localization — a singleton probe was inconclusive (UNKNOWN)")
            return _skipped_unknown()
        if result:
            singleton_critical.append(cm)

    if singleton_critical:
        logger.info(f"  Singleton-critical cms (each alone restores feasibility): {singleton_critical}")
        return {
            "approach": "singleton",
            "candidate_count": len(candidate_cms),
            "singleton_critical_cms": sorted(singleton_critical),
            "minimal_correction_set": sorted(singleton_critical),
            "notes": "Each listed camper alone restores feasibility when their hard MP constraint is removed.",
        }

    # Step 2: deletion filter
    logger.info("  No singleton works; running deletion filter for minimal correction set...")
    skip: set[int] = set(candidate_cms)  # full removal = feasible
    full_removal = _is_feasible(skip)
    if full_removal is None:
        logger.warning("  Aborting localization — the full-removal probe was inconclusive (UNKNOWN)")
        return _skipped_unknown()
    if not full_removal:
        # Sanity check: full removal should be feasible by definition (no hard MSO).
        # If not, the infeasibility lives in a non-parent_paramount constraint after all.
        return {
            "approach": "deletion_filter",
            "candidate_count": len(candidate_cms),
            "singleton_critical_cms": [],
            "minimal_correction_set": [],
            "notes": "Removing ALL hard MP constraints did not restore feasibility — cause is not parent_paramount alone.",
        }

    minimal_mcs: list[int] = []
    for cm in candidate_cms:
        trial = skip - {cm}  # try re-enforcing this cm's constraint
        result = _is_feasible(trial)
        if result is None:
            logger.warning("  Aborting localization — a deletion-filter probe was inconclusive (UNKNOWN)")
            return _skipped_unknown()
        if result:
            skip = trial  # cm is not required in MCS
        else:
            minimal_mcs.append(cm)  # cm must stay in MCS
            # skip unchanged
    logger.info(f"  Minimal correction set ({len(minimal_mcs)} cms): {minimal_mcs}")
    return {
        "approach": "deletion_filter",
        "candidate_count": len(candidate_cms),
        "singleton_critical_cms": [],
        "minimal_correction_set": sorted(minimal_mcs),
        "notes": "Removing the hard MP constraints for these campers (collectively) restores feasibility. Conflict is multi-camper; no single one suffices.",
    }

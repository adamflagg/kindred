"""
Age Preference Satisfaction - Efficient algorithm using shared grade presence variables.

Business logic:
- "older" preference = avoid YOUNGER grades → same grade or older is fine
- "younger" preference = avoid OLDER grades → same grade or younger is fine

This module uses grade comparison (not actual age) since grade is the primary
organization principle for bunks.

The key efficiency gain is using SHARED `bunk_has_grade[(bunk_idx, grade)]`
boolean variables across all campers, rather than creating O(n²) pairwise
comparison variables. These are CP-SAT constraint variables - their VALUES
are determined by the solver at solve time, not when created.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ortools.sat.python import cp_model

from .base import SolverContext

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = logging.getLogger(__name__)


def add_age_preference_satisfaction_vars(
    ctx: SolverContext,
    requests_by_person: dict[int, list[DirectBunkRequest]],
    bunk_has_grade: dict[tuple[int, int], cp_model.IntVar] | None = None,
) -> tuple[dict[int, list[cp_model.IntVar]], dict[tuple[int, int], cp_model.IntVar]]:
    """Create satisfaction variables for age_preference requests.

    Uses efficient grade presence tracking:
    1. Build shared bunk_has_grade[(bunk_idx, grade)] variables (if not provided)
    2. For each request, check if bunk contains violating grades
    3. Return satisfaction variables

    Args:
        ctx: Solver context with model, assignments, and mappings
        requests_by_person: Dict mapping person_cm_id to their age_preference requests
        bunk_has_grade: Optional pre-computed grade presence variables (for reuse)

    Returns:
        Tuple of:
        - Dict mapping person_cm_id to list of satisfaction BoolVars
        - The bunk_has_grade variables (for reuse by other constraints)
    """
    # Build or reuse shared grade presence variables
    if bunk_has_grade is None:
        bunk_has_grade = _build_bunk_has_grade_vars(ctx)

    satisfaction_vars: dict[int, list[cp_model.IntVar]] = {}

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        person_idx = ctx.person_idx_map[person_cm_id]
        person = ctx.person_by_cm_id[person_cm_id]
        person_grade = person.grade

        person_sat_vars: list[cp_model.IntVar] = []

        for request in requests:
            if request.request_type != "age_preference":
                continue

            preference = request.age_preference_target
            if not preference or preference not in ("older", "younger"):
                continue

            sat_var = _create_age_preference_satisfaction_var(
                ctx, person_idx, person_grade, preference, request, bunk_has_grade
            )
            if sat_var is not None:
                person_sat_vars.append(sat_var)

        if person_sat_vars:
            satisfaction_vars[person_cm_id] = person_sat_vars

    return satisfaction_vars, bunk_has_grade


def add_age_preference_penalties(
    ctx: SolverContext,
    objective_terms: list[Any],
    requests_by_person: dict[int, list[DirectBunkRequest]],
    bunk_has_grade: dict[tuple[int, int], cp_model.IntVar],
) -> None:
    """Add soft penalties for age preference violations.

    For each camper with an age preference:
    - If "older" and bunk has younger grades: penalty
    - If "younger" and bunk has older grades: penalty

    This provides a graduated incentive even when the preference can't be
    fully satisfied (e.g., when the camper is the youngest/oldest grade).

    Args:
        ctx: Solver context
        objective_terms: List to append penalty terms to (negative values)
        requests_by_person: Dict mapping person_cm_id to their age_preference requests
        bunk_has_grade: Pre-computed grade presence variables
    """
    penalty = ctx.config.get_int("constraint.age_preference.penalty", default=500)
    if penalty == 0:
        return

    # Get unique grades present in the solver
    all_grades = set()
    for person_cm_id in ctx.person_ids:
        person = ctx.person_by_cm_id[person_cm_id]
        all_grades.add(person.grade)

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        person_idx = ctx.person_idx_map[person_cm_id]
        person = ctx.person_by_cm_id[person_cm_id]
        person_grade = person.grade

        for request in requests:
            if request.request_type != "age_preference":
                continue

            preference = request.age_preference_target
            if not preference or preference not in ("older", "younger"):
                continue

            # Determine violating grades
            if preference == "older":
                # "older" = avoid younger grades (< person's grade)
                bad_grades = [g for g in all_grades if g < person_grade]
            else:  # younger
                # "younger" = avoid older grades (> person's grade)
                bad_grades = [g for g in all_grades if g > person_grade]

            if not bad_grades:
                # No violating grades possible - preference always satisfied
                continue

            # Add penalty for each bunk × bad_grade where camper could be placed
            for bunk_idx in range(len(ctx.bunks)):
                for bad_grade in bad_grades:
                    if (bunk_idx, bad_grade) not in bunk_has_grade:
                        continue

                    # Create violation indicator: camper in bunk AND bunk has bad grade
                    violation = ctx.model.NewBoolVar(f"age_pref_violation_{person_cm_id}_{bunk_idx}_{bad_grade}")
                    ctx.model.AddBoolAnd(
                        [ctx.assignments[(person_idx, bunk_idx)], bunk_has_grade[(bunk_idx, bad_grade)]]
                    ).OnlyEnforceIf(violation)

                    # Penalty is negative (reduces objective)
                    objective_terms.append(-penalty * violation)


def _build_bunk_has_grade_vars(ctx: SolverContext) -> dict[tuple[int, int], cp_model.IntVar]:
    """Build shared bunk_has_grade[(bunk_idx, grade)] variables.

    These variables track whether ANY camper of a specific grade is assigned
    to a specific bunk. They're constraint variables - their values are
    determined by the solver based on assignment decisions.

    Returns:
        Dict mapping (bunk_idx, grade) to BoolVar
    """
    bunk_has_grade: dict[tuple[int, int], cp_model.IntVar] = {}

    # Get unique grades present in the solver
    grade_to_person_indices: dict[int, list[int]] = {}
    for person_idx, person_cm_id in enumerate(ctx.person_ids):
        person = ctx.person_by_cm_id[person_cm_id]
        if person.grade not in grade_to_person_indices:
            grade_to_person_indices[person.grade] = []
        grade_to_person_indices[person.grade].append(person_idx)

    num_bunks = len(ctx.bunks)

    # For each bunk × grade, create a variable tracking presence
    for bunk_idx in range(num_bunks):
        for grade, person_indices in grade_to_person_indices.items():
            # bunk_has_grade = 1 if ANY person of this grade is in this bunk
            has_grade = ctx.model.NewBoolVar(f"bunk_{bunk_idx}_has_grade_{grade}")

            # Sum of assignments for all persons of this grade to this bunk
            grade_assignments = [ctx.assignments[(p_idx, bunk_idx)] for p_idx in person_indices]

            # has_grade = 1 iff sum >= 1
            ctx.model.Add(sum(grade_assignments) >= 1).OnlyEnforceIf(has_grade)
            ctx.model.Add(sum(grade_assignments) == 0).OnlyEnforceIf(has_grade.Not())

            bunk_has_grade[(bunk_idx, grade)] = has_grade

    logger.debug(f"Created {len(bunk_has_grade)} bunk_has_grade variables")
    return bunk_has_grade


def _create_age_preference_satisfaction_var(
    ctx: SolverContext,
    person_idx: int,
    person_grade: int,
    preference: str,
    request: DirectBunkRequest,
    bunk_has_grade: dict[tuple[int, int], cp_model.IntVar],
) -> cp_model.IntVar | None:
    """Create satisfaction variable for a single age preference request.

    An age preference is satisfied when the camper's bunk does NOT contain
    any violating grades (younger for "older" pref, older for "younger" pref).

    Args:
        ctx: Solver context
        person_idx: Index of the requesting person
        person_grade: Grade of the requesting person
        preference: "older" or "younger"
        request: The age_preference request
        bunk_has_grade: Shared grade presence variables

    Returns:
        BoolVar that's true when request is satisfied, or None if no valid check
    """
    # Get all grades present in the solver
    all_grades = set()
    for person_cm_id in ctx.person_ids:
        person = ctx.person_by_cm_id[person_cm_id]
        all_grades.add(person.grade)

    # Determine which grades would violate this preference
    if preference == "older":
        # "older" = "avoid younger grades" → grades < person_grade violate
        bad_grades = [g for g in all_grades if g < person_grade]
    else:  # younger
        # "younger" = "avoid older grades" → grades > person_grade violate
        bad_grades = [g for g in all_grades if g > person_grade]

    if not bad_grades:
        # No violating grades exist - preference is trivially satisfied
        # Return a constant-true variable
        sat_var = ctx.model.NewBoolVar(f"age_req_{request.id}_satisfied")
        ctx.model.Add(sat_var == 1)  # Always satisfied
        return sat_var

    # Create satisfaction variable
    sat_var = ctx.model.NewBoolVar(f"age_req_{request.id}_satisfied")

    # For each bunk the person might be in, check if it contains bad grades
    for bunk_idx in range(len(ctx.bunks)):
        # Check: person in this bunk AND bunk has NO bad grades
        person_in_bunk = ctx.assignments[(person_idx, bunk_idx)]

        # Collect "bunk has bad grade" variables for this bunk
        bad_grade_present_vars = []
        for bad_grade in bad_grades:
            if (bunk_idx, bad_grade) in bunk_has_grade:
                bad_grade_present_vars.append(bunk_has_grade[(bunk_idx, bad_grade)])

        if not bad_grade_present_vars:
            # No bad grades possible in this bunk - satisfied if person is here
            ctx.model.Add(sat_var == 1).OnlyEnforceIf(person_in_bunk)
        else:
            # bunk_is_clean = NONE of the bad grades are present
            bunk_is_clean = ctx.model.NewBoolVar(f"age_req_{request.id}_clean_bunk_{bunk_idx}")

            # Clean means all bad_grade_present vars are 0
            # Using AddBoolAnd with negated variables
            ctx.model.AddBoolAnd([v.Not() for v in bad_grade_present_vars]).OnlyEnforceIf(bunk_is_clean)

            # If person in bunk AND bunk is clean, satisfied
            person_in_clean_bunk = ctx.model.NewBoolVar(f"age_req_{request.id}_in_clean_{bunk_idx}")
            ctx.model.AddBoolAnd([person_in_bunk, bunk_is_clean]).OnlyEnforceIf(person_in_clean_bunk)
            ctx.model.Add(sat_var == 1).OnlyEnforceIf(person_in_clean_bunk)

    return sat_var

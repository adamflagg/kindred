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

from typing import TYPE_CHECKING

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.core.models import RequestType

from .base import SolverContext

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)


def add_age_preference_satisfaction_vars(
    ctx: SolverContext,
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[str, list[cp_model.IntVar]]:
    """Create bidirectional satisfaction variables for MP age_preference requests.

    Builds, for each feasible request, a sat_var bidirectionally bound to the
    post-solve satisfaction condition ("requester's bunk contains no grades the
    preference forbids") via the forcing_indicators returned to the caller.
    Each sat_var is registered in ``ctx.request_satisfied_vars`` keyed by
    request id — the same shared map ``get_or_create_request_sat_var`` uses for
    bunk_with / not_bunk_with — so #1398's golden alignment test picks them up
    automatically.

    Only MP age_preference requests are modeled today; non-MP age_preference
    requests have no solver representation. This is intentional — staff treat
    non-MP age preferences as best-effort ("maybe you'll get it"), and the
    planned material/immaterial/staff bucket weights (see
    docs/reference/solver-config-decisions.md) will be the right home for any
    future non-MP modeling.

    Args:
        ctx: Solver context with model, assignments, and mappings
        requests_by_person: Dict mapping person_cm_id to their MP age_preference
            requests (caller already filtered to MATERIAL_PARENT bucket)

    Returns:
        Dict mapping request.id to its per-(request, bunk) forcing indicators.
        Each forcing indicator is a BoolVar (or an assignment IntVar in the
        no-bad-grades-possible branch) that, when set to 1, forces the
        requester into a clean bunk and thus satisfies the request. Consumed
        by parent_paramount's hard must-satisfy-one constraint via summation.
    """
    bunk_has_grade = _build_bunk_has_grade_vars(ctx)

    forcing_indicators_by_req_id: dict[str, list[cp_model.IntVar]] = {}

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        person_idx = ctx.person_idx_map[person_cm_id]
        person = ctx.person_by_cm_id[person_cm_id]
        person_grade = person.grade

        for request in requests:
            if request.request_type != RequestType.AGE_PREFERENCE.value:
                continue

            preference = request.age_preference_target
            if not preference or preference not in ("older", "younger"):
                continue

            sat_var, forcing_indicators = _create_age_preference_satisfaction_var(
                ctx, person_idx, person_grade, preference, request, bunk_has_grade
            )
            if sat_var is not None:
                ctx.request_satisfied_vars[request.id] = sat_var
                forcing_indicators_by_req_id[request.id] = forcing_indicators

    return forcing_indicators_by_req_id


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
) -> tuple[cp_model.IntVar | None, list[cp_model.IntVar]]:
    """Create bidirectional satisfaction variable for a single age preference request.

    An age preference is satisfied when the camper's bunk does NOT contain
    any violating grades (younger for "older" pref, older for "younger" pref).

    Both ``sat_var`` and its intermediate predicates (``bunk_is_clean``,
    ``person_in_clean_bunk``) are bidirectionally bound to their definitions
    so the post-solve predicate (``bunking.utils.age_preference.is_age_preference_satisfied``)
    agrees with ``sat_var.value`` per the #1398 alignment test. (The predicate
    is more permissive in the mixed-grade case has_older AND has_younger; the
    integration fixture deliberately avoids that case — see
    ``tests/integration/solver/fixtures.py``.)

    Returns:
        Tuple (sat_var, forcing_indicators):
        - sat_var: BoolVar true iff request is satisfied, or None if no valid check.
        - forcing_indicators: per-(request, bunk) BoolVars (or assignment IntVars
          in the no-bad-grades-possible branch) that, when forced to 1, force
          the requester into a clean bunk. For the trivially-satisfied branch,
          the list contains a single always-1 BoolVar. Used by parent_paramount's
          hard MP constraint: summing these and constraining >= 1 forces real
          satisfaction.
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

    forcing_indicators: list[cp_model.IntVar] = []

    if not bad_grades:
        # No violating grades exist - preference is trivially satisfied
        # Return a constant-true variable
        sat_var = ctx.model.NewBoolVar(f"age_req_{request.id}_satisfied")
        ctx.model.Add(sat_var == 1)  # Always satisfied
        # Trivially-satisfied request: the sat_var itself is a forcing indicator
        # (always 1, so it contributes 1 to any sum it appears in).
        forcing_indicators.append(sat_var)
        return sat_var, forcing_indicators

    # Create satisfaction variable
    sat_var = ctx.model.NewBoolVar(f"age_req_{request.id}_satisfied")

    # For each bunk the person might be in, check if it contains bad grades
    for bunk_idx in range(len(ctx.bunks)):
        # Check: person in this bunk AND bunk has NO bad grades
        person_in_bunk = ctx.assignments[(person_idx, bunk_idx)]

        # Collect "bunk has bad grade" variables for this bunk
        bad_grade_present_vars = [
            bunk_has_grade[(bunk_idx, bad_grade)] for bad_grade in bad_grades if (bunk_idx, bad_grade) in bunk_has_grade
        ]

        if not bad_grade_present_vars:
            # No bad grades possible in this bunk - satisfied if person is here.
            # The assignment var IS the forcing indicator: setting it to 1
            # forces the person into this bunk, which is trivially clean.
            ctx.model.Add(sat_var == 1).OnlyEnforceIf(person_in_bunk)
            forcing_indicators.append(person_in_bunk)
        else:
            # bunk_is_clean ↔ NONE of the bad grades are present
            bunk_is_clean = ctx.model.NewBoolVar(f"age_req_{request.id}_clean_bunk_{bunk_idx}")
            ctx.model.AddBoolAnd([v.Not() for v in bad_grade_present_vars]).OnlyEnforceIf(bunk_is_clean)
            # Converse for bidirectional alignment: if any bad grade is present,
            # bunk is not clean. Without this, bunk_is_clean=0 is consistent
            # with all bad_grade_present=0, which would let sat_var drift away
            # from the post-solve predicate.
            ctx.model.AddBoolOr(bad_grade_present_vars).OnlyEnforceIf(bunk_is_clean.Not())

            # person_in_clean_bunk ↔ person_in_bunk AND bunk_is_clean
            person_in_clean_bunk = ctx.model.NewBoolVar(f"age_req_{request.id}_in_clean_{bunk_idx}")
            ctx.model.AddBoolAnd([person_in_bunk, bunk_is_clean]).OnlyEnforceIf(person_in_clean_bunk)
            # Converse: person_in_bunk AND bunk_is_clean ⇒ person_in_clean_bunk.
            ctx.model.Add(person_in_clean_bunk == 1).OnlyEnforceIf([person_in_bunk, bunk_is_clean])

            ctx.model.Add(sat_var == 1).OnlyEnforceIf(person_in_clean_bunk)
            forcing_indicators.append(person_in_clean_bunk)

    # Bidirectional binding of sat_var to forcing_indicators. The forward
    # direction (forcing_indicator → sat_var=1) is already encoded per-bunk
    # above. Here we add the reverse: sat_var=1 → at least one forcing
    # indicator is 1. Without this, when all forcing_indicators=0 the solver
    # is free to set sat_var=1 and disagree with the post-solve predicate.
    ctx.model.AddBoolOr(forcing_indicators).OnlyEnforceIf(sat_var)

    return sat_var, forcing_indicators


# ---------------------------------------------------------------------------
# Impossibility predicate
# ---------------------------------------------------------------------------

from bunking.models_v2 import DirectBunkRequest  # noqa: E402
from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class AgePreferenceImpossibility(HardConstraintImpossibility):
    name = "age_preference"

    def check_request(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type != "age_preference":
            return None
        requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
        if requester is None:
            return None
        target = req.age_preference_target
        if target not in ("older", "younger"):
            return None
        session = ctx.person_session.get(req.requester_person_cm_id)
        if session is None:
            return None
        # grade=0 is the "unknown grade" sentinel set by data_fetcher when the
        # source record has no grade. Refuse to call impossible on either side
        # without real grades — defer to the solver rather than emit a spurious
        # 'no younger peer' that fires because 0 < every real grade.
        if requester.grade <= 0:
            return None
        same_gender_peers = [
            p
            for p in ctx.input.persons
            if p.gender == requester.gender
            and ctx.person_session.get(p.campminder_person_id) == session
            and p.campminder_person_id != requester.campminder_person_id
            and p.grade > 0
        ]
        if not same_gender_peers:
            return ImpossibilityReason(
                code="age_pref_no_eligible_grade",
                message=(
                    f"No same-gender peers in session {session} to satisfy "
                    f"'{target}' age preference for grade {requester.grade}."
                ),
                detail={
                    "direction": target,
                    "requester_grade": requester.grade,
                    "session": session,
                },
            )
        grades = [p.grade for p in same_gender_peers]
        if target == "older" and max(grades) <= requester.grade:
            return ImpossibilityReason(
                code="age_pref_no_eligible_grade",
                message=(
                    f"Camper is at grade {requester.grade}; no older same-gender "
                    f"peer exists in session {session} (pool max: {max(grades)})."
                ),
                detail={
                    "direction": "older",
                    "requester_grade": requester.grade,
                    "pool_max_grade": max(grades),
                },
            )
        if target == "younger" and min(grades) >= requester.grade:
            return ImpossibilityReason(
                code="age_pref_no_eligible_grade",
                message=(
                    f"Camper is at grade {requester.grade}; no younger same-gender "
                    f"peer exists in session {session} (pool min: {min(grades)})."
                ),
                detail={
                    "direction": "younger",
                    "requester_grade": requester.grade,
                    "pool_min_grade": min(grades),
                },
            )
        return None


register(AgePreferenceImpossibility())

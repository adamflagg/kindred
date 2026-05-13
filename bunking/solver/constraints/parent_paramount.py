"""
Parent Paramount Constraints — Hard must-satisfy-one for Material-Parent requests.

This module enforces that every camper with at least one possible Material-Parent
(MP) request has at least one of those requests satisfied — as a HARD constraint.

"Material-Parent" is determined by the request's source-field bucket (via
``bunking.satisfaction.bucket.is_material_parent_request``), not the request
type. A request of any type (bunk_with, not_bunk_with, age_preference) is MP
iff its source_field classifies as MATERIAL_PARENT. Age preference requests
that come from socialize-with sources are NOT MP and don't count toward this
constraint.

Mechanism:
  * For each MP-having camper, build (or borrow) one forcing indicator per MP
    request and add ``model.Add(sum(forcing_indicators) >= 1)``.
  * For bunk_with / not_bunk_with requests we build a bidirectional
    ``person_bunk_assignment``-based sat var per request (matches the encoding
    add_objective uses at direct_solver.py:663-714). One BoolVar + two reified
    linears per request — much smaller than the per-bunk indicator helpers
    use under the hood.
  * For age_preference requests we read the per-(request, bunk) forcing
    indicators returned by ``add_age_preference_satisfaction_vars`` (the
    helper's internal ``person_in_clean_bunk`` / ``person_in_bunk`` BoolVars).
    These already exist; we just sum them.

Campers whose every MP request is impossible (filtered out of
``ctx.possible_requests``) are recorded in
``ctx.mp_set_entirely_impossible`` and skipped.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from bunking.logging_config import get_logger
from bunking.satisfaction.bucket import is_material_parent_request
from bunking.sync.bunk_request_processor.core.models import RequestType

from .age_preference import add_age_preference_satisfaction_vars
from .base import SolverContext

if TYPE_CHECKING:
    from ortools.sat.python import cp_model

    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)


def add_must_satisfy_one_request_constraints(ctx: SolverContext) -> None:
    """Add hard constraints ensuring each MP-having camper has ≥1 MP request honored.

    For every camper whose ``possible_requests`` include at least one
    Material-Parent request, adds::

        model.Add(sum(forcing_indicators) >= 1)

    where forcing_indicators is one BoolVar per MP request such that setting
    it to 1 forces the request's satisfaction condition (co-placement,
    separation, or clean-bunk depending on request type).

    Campers with no MP requests at all are skipped silently. Campers whose
    every MP request is impossible (excluded from possible_requests but
    present in the input) are recorded in ctx.mp_set_entirely_impossible.
    """
    logger.info("=== Parent Paramount (Hard MP Must-Satisfy-One) Constraints ===")
    logger.info(f"Total campers in solver: {len(ctx.person_ids)}")
    logger.info(f"Campers with requests: {len(ctx.input.requests_by_person)}")

    # Step 1: identify MP-possible requests per camper, partitioned by type.
    # age_preference goes to the helper because building the bunk-cleanliness
    # logic ourselves would duplicate add_age_preference_satisfaction_vars.
    mp_bunk_requests_by_person: dict[int, list[DirectBunkRequest]] = {}
    mp_age_requests_by_person: dict[int, list[DirectBunkRequest]] = {}

    for cm_id, possible_reqs in ctx.possible_requests.items():
        if cm_id not in ctx.person_idx_map:
            continue

        for r in possible_reqs:
            if not is_material_parent_request(r):
                continue
            if r.request_type in (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value):
                mp_bunk_requests_by_person.setdefault(cm_id, []).append(r)
            elif r.request_type == RequestType.AGE_PREFERENCE.value:
                mp_age_requests_by_person.setdefault(cm_id, []).append(r)

    # Step 2: build sat vars for MP age_preference requests via the helper.
    # The third return value is a per-request list of forcing indicators
    # (person_in_clean_bunk BoolVars, or assignment vars in the no-bad-grades
    # branch, or always-1 vars in the trivially-satisfied branch). We sum
    # these directly in the hard constraint — they're one-way OnlyEnforceIf-
    # anchored to real placement, which is sufficient when forced upward.
    age_forcing_indicators_by_req_id: dict[str, list[cp_model.IntVar]] = {}
    if mp_age_requests_by_person:
        _, _, age_forcing_indicators_by_req_id = add_age_preference_satisfaction_vars(ctx, mp_age_requests_by_person)

    # Step 3: per-camper, build bunk-request forcing vars inline and combine
    # with age-preference forcing indicators. Add the hard constraint.
    constraints_added = 0
    campers_without_requests: list[int] = []

    for person_cm_id in ctx.person_ids:
        if person_cm_id not in ctx.input.requests_by_person:
            campers_without_requests.append(person_cm_id)
            continue

        forcing_vars: list[cp_model.IntVar] = []

        for r in mp_bunk_requests_by_person.get(person_cm_id, []):
            sat_var = _build_bunk_request_forcing_var(ctx, r)
            if sat_var is not None:
                forcing_vars.append(sat_var)

        for r in mp_age_requests_by_person.get(person_cm_id, []):
            forcing_vars.extend(age_forcing_indicators_by_req_id.get(r.id, []))

        if forcing_vars:
            # Forces at least one forcing indicator to 1, which in turn forces
            # the corresponding request's satisfaction condition.
            ctx.model.Add(sum(forcing_vars) >= 1)
            constraints_added += 1
            continue

        # No forcing vars — did this camper have any MP requests at all?
        all_requests = ctx.input.requests_by_person.get(person_cm_id, [])
        if any(is_material_parent_request(r) for r in all_requests):
            # Had MP requests but all were either impossible or malformed
            ctx.mp_set_entirely_impossible.append(person_cm_id)
            logger.debug(f"Camper {person_cm_id}: all MP requests impossible — no hard constraint added")
        # else: no MP requests at all — silently skip

    # Step 4: end-of-build logging
    if ctx.mp_set_entirely_impossible:
        logger.warning(
            "Parent-paramount: campers with all MP requests impossible (no hard constraint added)",
            extra={"parent_paramount": {"skipped_cm_ids": ctx.mp_set_entirely_impossible}},
        )

    logger.info(
        f"Parent-paramount hard constraints: added={constraints_added}, "
        f"all_mp_impossible={len(ctx.mp_set_entirely_impossible)}, "
        f"no_requests={len(campers_without_requests)}"
    )


def _build_bunk_request_forcing_var(
    ctx: SolverContext,
    request: DirectBunkRequest,
) -> cp_model.IntVar | None:
    """Build a bidirectional sat var for a bunk_with / not_bunk_with request.

    Uses ``ctx.person_bunk_assignment`` (the integer-bunk-index variables) so
    the sat var is honestly tied to placement: ``sat_var = 1`` iff the
    requested co-placement (or separation) actually holds.

    Mirrors the encoding ``add_objective`` uses at direct_solver.py:663-714
    but creates a separate BoolVar (unification with the objective's vars is
    a follow-up — see PR body).

    Returns None for malformed requests (e.g., target not in person_idx_map),
    which shouldn't happen because ctx.possible_requests is the input.
    """
    requester_cm_id = request.requester_person_cm_id
    target_cm_id = request.requested_person_cm_id

    if target_cm_id is None or target_cm_id not in ctx.person_idx_map:
        return None
    if requester_cm_id not in ctx.person_idx_map:
        return None

    requester_idx = ctx.person_idx_map[requester_cm_id]
    target_idx = ctx.person_idx_map[target_cm_id]

    sat_var = ctx.model.NewBoolVar(f"parent_paramount_req_{request.id}_satisfied")

    if request.request_type == RequestType.BUNK_WITH.value:
        # sat_var == 1 ⇔ requester and target are in the same bunk
        ctx.model.Add(
            ctx.person_bunk_assignment[requester_idx] == ctx.person_bunk_assignment[target_idx]
        ).OnlyEnforceIf(sat_var)
        ctx.model.Add(
            ctx.person_bunk_assignment[requester_idx] != ctx.person_bunk_assignment[target_idx]
        ).OnlyEnforceIf(sat_var.Not())
    elif request.request_type == RequestType.NOT_BUNK_WITH.value:
        # sat_var == 1 ⇔ requester and target are in DIFFERENT bunks
        ctx.model.Add(
            ctx.person_bunk_assignment[requester_idx] != ctx.person_bunk_assignment[target_idx]
        ).OnlyEnforceIf(sat_var)
        ctx.model.Add(
            ctx.person_bunk_assignment[requester_idx] == ctx.person_bunk_assignment[target_idx]
        ).OnlyEnforceIf(sat_var.Not())
    else:
        return None  # Unsupported request type for this helper

    return sat_var

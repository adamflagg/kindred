"""
Parent Paramount Constraints — Hard must-satisfy-one for Material-Parent requests.

This module enforces that every camper with at least one possible Material-Parent
(MP) request has at least one of those requests satisfied — as a HARD constraint.

"Material-Parent" is determined by ``ctx.material_request_ids`` (pre-computed
by ``bunking.satisfaction.bucket.compute_material_request_ids`` in
``_validate_requests``), not per-request classification at build time.
``material_request_ids`` applies the #1664 age-preference suppression: a form
AGE_PREFERENCE is excluded from the material set when its requester already
has a resolved-and-possible form BUNK_WITH/NOT_BUNK_WITH.

Mechanism:
  * For each MP-having camper, build (or borrow) one forcing indicator per MP
    request and add ``model.Add(sum(forcing_indicators) >= 1)``.
  * For bunk_with / not_bunk_with requests we borrow the shared sat var from
    ``get_or_create_request_sat_var`` (bunk_requests.py) — one honest
    bidirectional ``person_bunk_assignment``-based BoolVar per request,
    memoized in ``ctx.request_satisfied_vars`` and shared with add_objective.
  * For age_preference requests we read the per-(request, bunk) forcing
    indicators returned by ``add_age_preference_satisfaction_vars`` (the
    helper's internal ``person_in_clean_bunk`` / ``person_in_bunk`` BoolVars).
    These already exist; we just sum them.

Campers whose every MP request is impossible (filtered out of
``ctx.possible_requests``) are recorded in
``ctx.mp_set_entirely_impossible`` and skipped.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.core.models import RequestType

from .age_preference import add_age_preference_satisfaction_vars
from .base import SolverContext
from .bunk_requests import get_or_create_request_sat_var

if TYPE_CHECKING:
    from ortools.sat.python import cp_model

    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)


def _parent_nbw_yield_record(
    person_cm_id: int,
    mp_bunk_requests_by_person: dict[int, list[DirectBunkRequest]],
    mp_age_requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[str, Any] | None:
    """Yield record if this camper's SOLE Material-Parent request is a
    not_bunk_with whose target's SOLE MP request is a bunk_with toward this pair.

    In that both-sole, directly-opposing case the positive request wins: the
    caller skips this camper's must-satisfy-one (dropping the NBW) so the
    target's bunk_with MSO can co-place the pair. Returns the yield detail for
    ctx.parent_nbw_yields (same shape as staff_nbw_yields), or None.
    """
    own = mp_bunk_requests_by_person.get(person_cm_id, [])
    if len(own) != 1 or mp_age_requests_by_person.get(person_cm_id):
        return None  # not a sole MP request
    nbw = own[0]
    if nbw.request_type != RequestType.NOT_BUNK_WITH.value:
        return None
    target_cm = nbw.requested_person_cm_id
    if target_cm is None:
        return None
    pair = {person_cm_id, target_cm}
    target_own = mp_bunk_requests_by_person.get(target_cm, [])
    if len(target_own) != 1 or mp_age_requests_by_person.get(target_cm):
        return None  # target's positive wish must also be sole-MP
    bw = target_own[0]
    if bw.request_type != RequestType.BUNK_WITH.value:
        return None
    if {bw.requester_person_cm_id, bw.requested_person_cm_id} != pair:
        return None
    return {
        "nbw_request_id": nbw.id,
        "subject_cm": person_cm_id,
        "target_cm": target_cm,
        "protected_parent_request_id": bw.id,
        "protected_camper_cm": target_cm,
    }


def add_must_satisfy_one_request_constraints(ctx: SolverContext) -> None:
    """Add hard constraints ensuring each MP-having camper has ≥1 MP request honored.

    For every camper whose ``possible_requests`` include at least one
    Material-Parent request, adds::

        model.Add(sum(forcing_indicators) >= 1)

    where forcing_indicators is one BoolVar per MP request such that setting
    it to 1 forces the request's satisfaction condition (co-placement,
    separation, or clean-bunk depending on request type).

    Campers with no MP requests at all are skipped silently. Campers whose
    every MP request is impossible are already recorded in
    ctx.mp_set_entirely_impossible by _validate_requests; parent_paramount
    reads this list for logging but does not modify it.
    """
    logger.info("=== Parent Paramount (Hard MP Must-Satisfy-One) Constraints ===")
    if ctx.is_constraint_disabled("parent_paramount"):
        logger.info("Parent-paramount hard constraints DISABLED via debug settings")
        return
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
            if r.id not in ctx.material_request_ids:
                continue
            if r.request_type in (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value):
                mp_bunk_requests_by_person.setdefault(cm_id, []).append(r)
            elif r.request_type == RequestType.AGE_PREFERENCE.value:
                mp_age_requests_by_person.setdefault(cm_id, []).append(r)

    # Step 2: build bidirectional sat vars + forcing indicators for MP
    # age_preference requests via the helper. The helper registers each sat
    # var in ctx.request_satisfied_vars (shared with bunk_with / not_bunk_with)
    # and returns per-request forcing indicators (person_in_clean_bunk BoolVars
    # per bunk, or a single always-1 BoolVar in the trivially-satisfied branch).
    # We sum these directly in the hard constraint.
    age_forcing_indicators_by_req_id: dict[str, list[cp_model.IntVar]] = {}
    if mp_age_requests_by_person:
        age_forcing_indicators_by_req_id = add_age_preference_satisfaction_vars(ctx, mp_age_requests_by_person)

    # Step 3: per-camper, build bunk-request forcing vars inline and combine
    # with age-preference forcing indicators. Add the hard constraint.
    constraints_added = 0
    campers_without_requests: list[int] = []
    skipped_for_iis_probe = 0

    for person_cm_id in ctx.person_ids:
        if person_cm_id not in ctx.input.requests_by_person:
            campers_without_requests.append(person_cm_id)
            continue

        # IIS-localization probe: when the infeasibility analyzer is bisecting,
        # it temporarily skips the hard constraint for specific cms to find a
        # minimal infeasible subset. The constraint is otherwise unchanged.
        if person_cm_id in ctx.mp_skip_cms:
            skipped_for_iis_probe += 1
            continue

        # Parent-paramount carve-out (#1638 Stream C): if this camper's sole MP
        # wish is a not_bunk_with that directly opposes a sole-MP parent bunk_with,
        # the positive wins — skip this camper's MSO (drop the NBW) and record it.
        parent_yield = _parent_nbw_yield_record(person_cm_id, mp_bunk_requests_by_person, mp_age_requests_by_person)
        if parent_yield is not None:
            ctx.parent_nbw_yields.append(parent_yield)
            continue

        forcing_vars: list[cp_model.IntVar] = []

        for r in mp_bunk_requests_by_person.get(person_cm_id, []):
            sat_var = get_or_create_request_sat_var(ctx, r)
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

        # No forcing vars built. Entirely-impossible MP campers are already
        # recorded in ctx.mp_set_entirely_impossible by _validate_requests
        # (single source of truth: validate_impossibility) — nothing to derive
        # here. Campers with no MP requests at all also land here harmlessly.
        logger.debug(f"Camper {person_cm_id}: no forcing vars built — no hard constraint added")

    # Step 4: end-of-build logging
    if ctx.mp_set_entirely_impossible:
        logger.warning(
            "Parent-paramount: campers with all MP requests impossible (no hard constraint added)",
            extra={"parent_paramount": {"skipped_cm_ids": ctx.mp_set_entirely_impossible}},
        )

    skip_suffix = f", iis_probe_skipped={skipped_for_iis_probe}" if skipped_for_iis_probe else ""
    logger.info(
        f"Parent-paramount hard constraints: added={constraints_added}, "
        f"all_mp_impossible={len(ctx.mp_set_entirely_impossible)}, "
        f"no_requests={len(campers_without_requests)}{skip_suffix}"
    )

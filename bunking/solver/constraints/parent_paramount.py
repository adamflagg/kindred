"""
Parent Paramount Constraints - Hard must-satisfy-one for Material-Parent requests.

This module enforces that every camper with at least one possible Material-Parent
(MP) request has at least one of those requests satisfied — as a HARD constraint.

"Material-Parent" means source_field == "bunk_with" (the parent bunk-request
form).  Staff and immaterial-parent requests are not covered by this constraint.

The MECHANICS of request satisfaction variables are handled by:
- bunk_requests.py: bunk_with, not_bunk_with
- age_preference.py: age_preference

This module handles:
1. Pre-filtering to MP-only possible requests per camper
2. Delegating to specialized modules for satisfaction variable creation
3. Adding a hard `sum(mp_sat_vars) >= 1` constraint per qualifying camper
4. Recording campers whose entire MP set was impossible in ctx.mp_set_entirely_impossible
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger
from bunking.satisfaction.bucket import is_material_parent_request
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField

from .age_preference import add_age_preference_satisfaction_vars
from .base import SolverContext

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)

# Source fields that contain explicit camper requests (not inferred preferences)
EXPLICIT_SOURCE_FIELDS = {
    SourceField.BUNK_REQUEST_FORM,
    SourceField.STAFF_NOT_BUNK_WITH,
    SourceField.BUNKING_NOTES,
    SourceField.INTERNAL_NOTES,
}


def add_must_satisfy_one_request_constraints(ctx: SolverContext) -> None:
    """Add hard constraints ensuring each camper satisfies at least one MP request.

    For every camper whose possible_requests include at least one
    Material-Parent request, adds:

        model.Add(sum(mp_sat_vars) >= 1)

    Campers with no MP requests in possible_requests are skipped.
    Campers whose entire MP set was impossible (possible count == 0, but
    input had MP requests) are recorded in ctx.mp_set_entirely_impossible.

    Rules:
    - If camper has possible MP bunk_with requests, at least one must be satisfied
    - If camper has ONLY possible MP age_preference requests (no bunk MP), age preference must be satisfied
    - Campers with no MP requests at all have no constraint added
    - Campers whose every MP request is impossible are skipped and recorded
    """
    logger.info("=== Parent Paramount (Hard MP Must-Satisfy-One) Constraints ===")
    logger.info(f"Total campers in solver: {len(ctx.person_ids)}")
    logger.info(f"Campers with requests: {len(ctx.input.requests_by_person)}")

    # Step 1: Pre-filter to MP-possible requests per camper.
    # Walk ctx.possible_requests (the post-validation map) and keep only MP requests.
    mp_bunk_by_person: dict[int, list[DirectBunkRequest]] = {}
    mp_age_by_person: dict[int, list[DirectBunkRequest]] = {}

    for cm_id, possible_reqs in ctx.possible_requests.items():
        if cm_id not in ctx.person_idx_map:
            continue

        mp_possible = [r for r in possible_reqs if is_material_parent_request(r)]
        if not mp_possible:
            continue

        bunk_reqs, age_reqs = _filter_and_categorize_requests(mp_possible)
        if bunk_reqs:
            mp_bunk_by_person[cm_id] = bunk_reqs
        if age_reqs:
            mp_age_by_person[cm_id] = age_reqs

    # Step 2: Build satisfaction variables ONLY for MP-possible requests.
    # NOTE: add_bunk_request_satisfaction_vars creates one-way implication sat vars
    # (satisfied => var=1, but var=1 does NOT require actually-satisfied).  Those
    # are appropriate for soft-constraint objectives but not for hard constraints.
    # We use _build_hard_bunk_sat_vars instead, which creates proper bidirectional
    # indicator variables so sum(vars) >= 1 actually forces co-placement.
    bunk_sat_vars = _build_hard_bunk_sat_vars(ctx, mp_bunk_by_person)

    # Age preference vars only for campers with NO MP bunk requests
    mp_age_only: dict[int, list[DirectBunkRequest]] = {
        cm_id: age_reqs for cm_id, age_reqs in mp_age_by_person.items() if cm_id not in mp_bunk_by_person
    }
    age_sat_vars, _ = add_age_preference_satisfaction_vars(ctx, mp_age_only)

    # Step 3: Loop and add hard constraints per camper.
    constraints_added = 0
    campers_without_requests: list[int] = []

    for person_cm_id in ctx.person_ids:
        if person_cm_id not in ctx.input.requests_by_person:
            campers_without_requests.append(person_cm_id)
            continue

        mp_sat_vars = bunk_sat_vars.get(person_cm_id, []) + age_sat_vars.get(person_cm_id, [])

        if mp_sat_vars:
            # Hard constraint: at least one MP request must be satisfied
            ctx.model.Add(sum(mp_sat_vars) >= 1)
            constraints_added += 1
        else:
            # No MP sat vars — did this camper have any MP requests at all?
            all_requests = ctx.input.requests_by_person.get(person_cm_id, [])
            had_any_mp = any(is_material_parent_request(r) for r in all_requests)
            if had_any_mp:
                # They had MP requests but all were impossible — record for diagnostics
                ctx.mp_set_entirely_impossible.append(person_cm_id)
                logger.debug(f"Camper {person_cm_id}: all MP requests impossible — no hard constraint added")
            # else: no MP requests at all — silently skip

    # Step 4: Logging
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


def _build_hard_bunk_sat_vars(
    ctx: SolverContext,
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[int, list[cp_model.IntVar]]:
    """Build **bidirectional** sat vars for hard bunk_with constraints.

    Unlike add_bunk_request_satisfaction_vars (one-way: satisfied => var=1),
    this creates vars where var=1 IFF the placement actually satisfies the request.
    Required for hard `sum(vars) >= 1` to genuinely enforce co-placement.

    Only handles bunk_with requests — not_bunk_with is not an MP request type
    (not_bunk_with comes from source_field="not_bunk_with" which is STAFF bucket).
    Age preference is handled separately via add_age_preference_satisfaction_vars.

    Returns:
        Dict mapping person_cm_id to list of bidirectional BoolVars.
    """
    satisfaction_vars: dict[int, list[cp_model.IntVar]] = {}

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        requester_idx = ctx.person_idx_map[person_cm_id]
        person_sat_vars: list[cp_model.IntVar] = []

        for request in requests:
            if request.request_type != RequestType.BUNK_WITH.value:
                continue
            if not request.requested_person_cm_id:
                continue
            if request.requested_person_cm_id not in ctx.person_idx_map:
                logger.debug(
                    "hard_mp: requested person %d not in solver (request %s) — skipping",
                    request.requested_person_cm_id,
                    request.id,
                )
                continue

            requested_idx = ctx.person_idx_map[request.requested_person_cm_id]

            # Bidirectional indicator: sat_var = 1 IFF both in same bunk.
            # We model this as: sat_var = OR over bunks b of both_in_b[b],
            # where each both_in_b[b] is a proper conjunction.
            sat_var = ctx.model.NewBoolVar(f"mp_hard_req_{request.id}_satisfied")

            both_in_bunk_vars: list[cp_model.IntVar] = []
            for bunk_idx in range(len(ctx.bunks)):
                both = ctx.model.NewBoolVar(f"mp_hard_req_{request.id}_b{bunk_idx}")
                # both == 1 IFF assign(requester, b)==1 AND assign(requested, b)==1
                ctx.model.Add(
                    ctx.assignments[(requester_idx, bunk_idx)] + ctx.assignments[(requested_idx, bunk_idx)] == 2
                ).OnlyEnforceIf(both)
                ctx.model.Add(
                    ctx.assignments[(requester_idx, bunk_idx)] + ctx.assignments[(requested_idx, bunk_idx)] <= 1
                ).OnlyEnforceIf(both.Not())
                both_in_bunk_vars.append(both)

            # sat_var == OR(both_in_bunk_vars) — bidirectional
            ctx.model.AddBoolOr(both_in_bunk_vars).OnlyEnforceIf(sat_var)
            ctx.model.AddBoolAnd([b.Not() for b in both_in_bunk_vars]).OnlyEnforceIf(sat_var.Not())

            person_sat_vars.append(sat_var)

        if person_sat_vars:
            satisfaction_vars[person_cm_id] = person_sat_vars

    return satisfaction_vars


def _filter_and_categorize_requests(
    requests: list[DirectBunkRequest],
) -> tuple[list[DirectBunkRequest], list[DirectBunkRequest]]:
    """Filter requests to explicit sources and categorize by type.

    Args:
        requests: All requests for a camper

    Returns:
        Tuple of (bunk_requests, age_requests) filtered for explicit sources
    """
    bunk_requests: list[DirectBunkRequest] = []
    age_requests: list[DirectBunkRequest] = []

    track_debug = logger.isEnabledFor(logging.DEBUG)

    for request in requests:
        # Check if request comes from explicit CSV fields
        request_csv_fields = getattr(request, "csv_source_fields", None)
        if not request_csv_fields and hasattr(request, "ai_reasoning") and isinstance(request.ai_reasoning, dict):
            request_csv_fields = request.ai_reasoning.get("csv_source_fields", None)

        if request_csv_fields:
            # Check if ANY of the csv_source_fields are explicit fields
            is_explicit = any(field in EXPLICIT_SOURCE_FIELDS for field in request_csv_fields)
            if not is_explicit:
                if track_debug:
                    logger.debug(f"Skipping request from {request_csv_fields} for must-satisfy-one (non-explicit)")
                continue
        else:
            # Fallback to old source_field check
            if hasattr(request, "source_field") and request.source_field not in EXPLICIT_SOURCE_FIELDS:
                if track_debug:
                    logger.debug(f"Skipping request from {request.source_field} field for must-satisfy-one")
                continue

        # Categorize by request type
        if request.request_type in [RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value]:
            bunk_requests.append(request)
        elif request.request_type == RequestType.AGE_PREFERENCE.value:
            # SOCIALIZE_WITH requests are excluded by the explicit-field check
            # above (SOCIALIZE_WITH is NOT in EXPLICIT_SOURCE_FIELDS), so they
            # never reach this point. Safe to append unconditionally.
            age_requests.append(request)

    return bunk_requests, age_requests

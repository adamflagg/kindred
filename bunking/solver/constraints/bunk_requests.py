"""
Bunk Request Satisfaction Variables.

Creates satisfaction variables for bunk_with and not_bunk_with requests.
These variables are used by must_satisfy.py to ensure at least one request
is satisfied per camper.

This module handles the MECHANICS of request satisfaction:
- bunk_with: satisfied when both campers are in the same bunk
- not_bunk_with: satisfied when campers are in different bunks
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ortools.sat.python import cp_model

from .base import SolverContext

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = logging.getLogger(__name__)


def add_bunk_request_satisfaction_vars(
    ctx: SolverContext,
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[int, list[cp_model.IntVar]]:
    """Create satisfaction variables for bunk_with/not_bunk_with requests.

    This function creates boolean variables that track whether each request
    is satisfied. The actual "at least one satisfied" constraint is added
    by must_satisfy.py.

    Args:
        ctx: Solver context with model, assignments, and mappings
        requests_by_person: Dict mapping person_cm_id to their filtered
            bunk_with/not_bunk_with requests (already filtered for explicit sources)

    Returns:
        Dict mapping person_cm_id to list of satisfaction BoolVars
    """
    satisfaction_vars: dict[int, list[cp_model.IntVar]] = {}

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        person_idx = ctx.person_idx_map[person_cm_id]
        person_sat_vars: list[cp_model.IntVar] = []

        for request in requests:
            if request.request_type == "bunk_with":
                sat_var = _create_bunk_with_satisfaction_var(ctx, person_idx, request)
                if sat_var is not None:
                    person_sat_vars.append(sat_var)

            elif request.request_type == "not_bunk_with":
                sat_var = _create_not_bunk_with_satisfaction_var(ctx, person_idx, request)
                if sat_var is not None:
                    person_sat_vars.append(sat_var)

        if person_sat_vars:
            satisfaction_vars[person_cm_id] = person_sat_vars

    return satisfaction_vars


def _create_bunk_with_satisfaction_var(
    ctx: SolverContext,
    requester_idx: int,
    request: DirectBunkRequest,
) -> cp_model.IntVar | None:
    """Create satisfaction variable for a bunk_with request.

    A bunk_with request is satisfied if both the requester and requested
    person are assigned to the same bunk.

    Args:
        ctx: Solver context
        requester_idx: Index of the requesting person
        request: The bunk_with request

    Returns:
        BoolVar that's true when request is satisfied, or None if request is invalid
    """
    if not request.requested_person_cm_id:
        return None

    if request.requested_person_cm_id not in ctx.person_idx_map:
        logger.debug(f"bunk_with request {request.id}: requested person {request.requested_person_cm_id} not in solver")
        return None

    requested_idx = ctx.person_idx_map[request.requested_person_cm_id]

    # Create the satisfaction variable
    sat_var = ctx.model.NewBoolVar(f"req_{request.id}_satisfied")

    # Request is satisfied if both are in the same bunk
    # For each bunk, create a helper variable tracking if both are there
    for bunk_idx in range(len(ctx.bunks)):
        both_in_bunk = ctx.model.NewBoolVar(f"req_{request.id}_bunk_{bunk_idx}")

        # Both must be in this bunk
        ctx.model.Add(
            ctx.assignments[(requester_idx, bunk_idx)] + ctx.assignments[(requested_idx, bunk_idx)] == 2
        ).OnlyEnforceIf(both_in_bunk)

        # If both in bunk, request is satisfied
        ctx.model.Add(sat_var == 1).OnlyEnforceIf(both_in_bunk)

    return sat_var


def _create_not_bunk_with_satisfaction_var(
    ctx: SolverContext,
    requester_idx: int,
    request: DirectBunkRequest,
) -> cp_model.IntVar | None:
    """Create satisfaction variable for a not_bunk_with request.

    A not_bunk_with request is satisfied if the requester and requested
    person are assigned to different bunks.

    Args:
        ctx: Solver context
        requester_idx: Index of the requesting person
        request: The not_bunk_with request

    Returns:
        BoolVar that's true when request is satisfied, or None if request is invalid
    """
    if not request.requested_person_cm_id:
        return None

    if request.requested_person_cm_id not in ctx.person_idx_map:
        logger.debug(
            f"not_bunk_with request {request.id}: requested person {request.requested_person_cm_id} not in solver"
        )
        return None

    requested_idx = ctx.person_idx_map[request.requested_person_cm_id]

    # Create the satisfaction variable
    sat_var = ctx.model.NewBoolVar(f"req_{request.id}_satisfied")

    # Request is satisfied if NOT in same bunk
    # We need to check they're in different bunks
    different_bunks_vars = []

    for bunk_idx in range(len(ctx.bunks)):
        # Check if person is in this bunk but requested is not
        person_in_bunk = ctx.assignments[(requester_idx, bunk_idx)]
        requested_not_in_bunk = ctx.model.NewBoolVar(f"req_{request.id}_diff_bunk_{bunk_idx}")
        ctx.model.Add(ctx.assignments[(requested_idx, bunk_idx)] == 0).OnlyEnforceIf(requested_not_in_bunk)

        # If person in bunk and requested not, they're separated
        separated = ctx.model.NewBoolVar(f"req_{request.id}_separated_{bunk_idx}")
        ctx.model.AddBoolAnd([person_in_bunk, requested_not_in_bunk]).OnlyEnforceIf(separated)
        different_bunks_vars.append(separated)

    # If separated in any bunk assignment, request is satisfied
    ctx.model.AddBoolOr(different_bunks_vars).OnlyEnforceIf(sat_var)

    return sat_var

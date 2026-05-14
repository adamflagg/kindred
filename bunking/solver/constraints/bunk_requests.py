"""
Bunk request satisfaction variables.

Single canonical builder for bunk_with / not_bunk_with satisfaction vars.
Both the objective (direct_solver.add_objective) and the hard MP constraint
(parent_paramount) call get_or_create_request_sat_var, sharing exactly one
honest bidirectional sat var per request via the memoized
`ctx.request_satisfied_vars` map.

A sat var is true iff the request's placement condition actually holds:
- bunk_with:     requester and target are in the same bunk
- not_bunk_with: requester and target are in different bunks

This module also hosts MalformedRequestImpossibility, the registered
impossibility predicate for malformed bunk requests.
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


def get_or_create_request_sat_var(
    ctx: SolverContext,
    request: DirectBunkRequest,
) -> cp_model.IntVar | None:
    """Return the shared bidirectional satisfaction var for a bunk request.

    Creates and memoizes the var on first call; later calls for the same
    request.id return the identical var object. Both add_objective and
    parent_paramount call this, so each request gets exactly one sat var.

    Encoding (bidirectional, via ctx.person_bunk_assignment):
        bunk_with:     sat_var == 1  <=>  requester bunk == target bunk
        not_bunk_with: sat_var == 1  <=>  requester bunk != target bunk

    Returns None for requests this builder cannot encode: an unsupported
    request_type (only bunk_with / not_bunk_with), a missing target, or a
    target/requester absent from person_idx_map.
    """
    existing = ctx.request_satisfied_vars.get(request.id)
    if existing is not None:
        return existing

    if request.request_type not in (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value):
        # Silent: an unsupported type (e.g. age_preference) is expected control
        # flow for callers, not a data-integrity smell — unlike the cases below.
        return None

    target_cm_id = request.requested_person_cm_id
    requester_cm_id = request.requester_person_cm_id
    if target_cm_id is None or target_cm_id not in ctx.person_idx_map:
        logger.debug(f"request {request.id}: target {target_cm_id} not in solver — no sat var")
        return None
    if requester_cm_id not in ctx.person_idx_map:
        logger.debug(f"request {request.id}: requester {requester_cm_id} not in solver — no sat var")
        return None

    requester_bunk = ctx.person_bunk_assignment[ctx.person_idx_map[requester_cm_id]]
    target_bunk = ctx.person_bunk_assignment[ctx.person_idx_map[target_cm_id]]

    sat_var = ctx.model.NewBoolVar(f"req_satisfied_{request.id}")

    if request.request_type == RequestType.BUNK_WITH.value:
        ctx.model.Add(requester_bunk == target_bunk).OnlyEnforceIf(sat_var)
        ctx.model.Add(requester_bunk != target_bunk).OnlyEnforceIf(sat_var.Not())
    else:  # NOT_BUNK_WITH
        ctx.model.Add(requester_bunk != target_bunk).OnlyEnforceIf(sat_var)
        ctx.model.Add(requester_bunk == target_bunk).OnlyEnforceIf(sat_var.Not())

    ctx.request_satisfied_vars[request.id] = sat_var
    return sat_var


from bunking.models_v2 import DirectBunkRequest  # noqa: E402
from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class MalformedRequestImpossibility(HardConstraintImpossibility):
    name = "malformed"

    def check_request(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type not in ("bunk_with", "not_bunk_with"):
            return None
        if not req.requested_person_cm_id:
            return ImpossibilityReason(
                code="malformed",
                message=f"{req.request_type} request is missing requestee_id.",
                detail={"request_type": req.request_type},
            )
        return None


register(MalformedRequestImpossibility())

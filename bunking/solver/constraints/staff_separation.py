"""Hard staff/manual "do-not-bunk-with" separation constraints (#1541).

Enforces SolverRule.HARD_MNT: not_bunk_with requests from the staff_not_bunk_with
form and the admin-UI manual channel become a HARD separation
(bunk[requester] != bunk[target]), not a soft objective term. The single
parent-paramount carve-out lives in _mso_protection_applies.

No impossibility predicate: cabins are not grade-hard-locked, so separation is
essentially always feasible (a camper can land in an adjacent-grade bunk,
penalized but legal). Rare genuine hard-vs-hard conflicts surface as
infeasibility for manual resolution (find_infeasibility_cause / Stream B #1638).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger
from bunking.satisfaction.request_registry import SolverRule, rule_for
from bunking.sync.bunk_request_processor.core.models import RequestType

from .base import SolverContext
from .bunk_requests import get_or_create_request_sat_var

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)


def _is_hard_mnt(request: DirectBunkRequest) -> bool:
    """True iff the registry classifies this request's (source, type) as HARD_MNT."""
    source_field = request.source_field
    if not source_field:
        return False
    try:
        return rule_for(source_field, request.request_type) == SolverRule.HARD_MNT
    except ValueError:
        # Off-axis (source, type) combo — pipeline-hygiene issue, not HARD_MNT.
        logger.debug(
            "staff_separation: off-axis (source=%r, type=%r) request %s — not HARD_MNT",
            source_field,
            request.request_type,
            request.id,
        )
        return False


def _possible_mp_count(ctx: SolverContext, cm_id: int) -> int:
    """Number of possible Material-Parent requests for a camper (#1664-aware)."""
    return sum(1 for r in ctx.possible_requests.get(cm_id, []) if r.id in ctx.material_request_ids)


def _mso_protection_applies(ctx: SolverContext, subject_cm: int, target_cm: int) -> dict[str, Any] | None:
    """Yield record if separating the pair would starve a parent-paramount MSO.

    Looks for a Material-Parent bunk_with between {subject, target} whose requester
    has exactly one possible MP request (this one). Either direction qualifies.
    Returns the yield detail (protected_*) for ctx.staff_nbw_yields, or None.
    """
    pair = {subject_cm, target_cm}
    for requester_cm in (subject_cm, target_cm):
        for r in ctx.possible_requests.get(requester_cm, []):
            if r.request_type != RequestType.BUNK_WITH.value:
                continue
            if r.id not in ctx.material_request_ids:
                continue
            if {r.requester_person_cm_id, r.requested_person_cm_id} != pair:
                continue
            if _possible_mp_count(ctx, requester_cm) == 1:
                return {"protected_parent_request_id": r.id, "protected_camper_cm": requester_cm}
    return None


def add_staff_separation_constraints(ctx: SolverContext) -> None:
    """Force separation for staff/manual not_bunk_with (HARD_MNT), with MSO carve-out."""
    if ctx.is_constraint_disabled("staff_separation"):
        logger.info("staff_separation constraints DISABLED via debug settings")
        return

    enforced = 0
    yielded = 0
    for requests in ctx.possible_requests.values():
        for r in requests:
            if not _is_hard_mnt(r):
                continue
            subject_cm = r.requester_person_cm_id
            target_cm = r.requested_person_cm_id
            if target_cm is None:
                continue  # malformed — dropped pre-solve; defensive
            if (subject_cm, target_cm) in ctx.staff_nbw_skip_pairs:
                continue  # IIS-localization probe

            protection = _mso_protection_applies(ctx, subject_cm, target_cm)
            if protection is not None:
                ctx.staff_nbw_yields.append(
                    {"nbw_request_id": r.id, "subject_cm": subject_cm, "target_cm": target_cm, **protection}
                )
                yielded += 1
                continue

            sat_var = get_or_create_request_sat_var(ctx, r)
            if sat_var is None:
                continue  # target not in roster ⇒ trivially separated
            if ctx.break_glass:
                # Break-glass: staff NBW becomes soft. Don't force separation;
                # leave sat_var free so the lex objective penalizes (1 - sat_var).
                # Record the relaxation for the post-solve compromise report.
                ctx.break_glass_nbw_relaxed.append(
                    {"nbw_request_id": r.id, "subject_cm": subject_cm, "target_cm": target_cm}
                )
            else:
                ctx.model.Add(sat_var == 1)  # force separation
                enforced += 1

    logger.info(f"staff_separation: enforced={enforced}, yielded(parent-paramount)={yielded}")

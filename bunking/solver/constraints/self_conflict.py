"""Self-conflict impossibility: same requester has both bunk_with and not_bunk_with to same target."""

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.impossibility import (
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)

_OPPOSITE: dict[str, str] = {
    "bunk_with": "not_bunk_with",
    "not_bunk_with": "bunk_with",
}


class SelfConflictImpossibility(HardConstraintImpossibility):
    """Flag any bunk_with or not_bunk_with request whose requester also has the
    opposite-polarity request toward the same target camper.

    Both sides of the contradictory pair are caught independently as the
    predicate iterates over each request in turn.
    """

    name: str = "self_conflict"

    def check_request(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type not in ("bunk_with", "not_bunk_with"):
            return None
        if not req.requested_person_cm_id:
            return None  # malformed — MalformedRequestImpossibility owns this

        target_cm_id = req.requested_person_cm_id
        opposite_type = _OPPOSITE[req.request_type]

        sibling_requests = ctx.input.requests_by_person.get(req.requester_person_cm_id, [])
        for sibling in sibling_requests:
            if sibling.id == req.id:
                continue
            if sibling.request_type != opposite_type:
                continue
            if sibling.requested_person_cm_id != target_cm_id:
                continue
            requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
            target = ctx.person_by_cm_id.get(target_cm_id)
            requester_name = (
                f"{requester.first_name} {requester.last_name}".strip()
                if requester
                else str(req.requester_person_cm_id)
            )
            target_name = f"{target.first_name} {target.last_name}".strip() if target else str(target_cm_id)
            return ImpossibilityReason(
                code="self_conflict",
                message=(
                    f"{requester_name} has both a {req.request_type!r} and a "
                    f"{opposite_type!r} request toward {target_name} — "
                    f"these are contradictory and cannot both be satisfied."
                ),
                detail={
                    "conflicting_request_id": sibling.id,
                    "requested_person_cm_id": target_cm_id,
                    "this_type": req.request_type,
                    "conflicting_type": opposite_type,
                },
            )
        return None


register(SelfConflictImpossibility())

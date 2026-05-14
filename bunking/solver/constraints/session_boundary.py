"""Session boundary: campers can only bunk with peers in the same session."""

from __future__ import annotations

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.impossibility import (
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class SessionBoundaryImpossibility(HardConstraintImpossibility):
    name = "session_boundary"

    def check_pair(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type != "bunk_with":
            return None
        if not req.requested_person_cm_id:
            return None
        s1 = ctx.person_session.get(req.requester_person_cm_id)
        s2 = ctx.person_session.get(req.requested_person_cm_id)
        if s1 is None or s2 is None:
            return None
        if s1 == s2:
            return None
        return ImpossibilityReason(
            code="cross_session",
            message=(f"Requester is in session {s1} but requestee is in session {s2}; they cannot share a bunk."),
            detail={
                "requester_session": s1,
                "requestee_session": s2,
            },
        )


register(SessionBoundaryImpossibility())

"""Camper router -- the camper journey's one server read (kindred#2776).

Thin by design: parse input, call the service, return the model. The merge
lives in `api/services/camper_journey_service.py` (see api/CLAUDE.md).

Caddy needs no configuration change: its inverse routing sends everything
under /api/* that is not an explicit PocketBase path to FastAPI.
"""

from fastapi import APIRouter, Depends, Query

from api.schemas.camper_journey import CamperJourneyResponse
from api.services.camper_journey_service import CamperJourneyService
from api.services.lodging_repository import LodgingRepository
from bunking.auth_middleware import AuthUser, get_current_user

from ..dependencies import pb

router = APIRouter(prefix="/api/campers", tags=["campers"])


@router.get("/{person_cm_id}/journey", response_model=CamperJourneyResponse)
async def get_camper_journey(
    person_cm_id: int,
    year: int = Query(..., description="The viewed year. Rows are the years before it."),
    user: AuthUser = Depends(get_current_user),
) -> CamperJourneyResponse:
    """A person's camper journey as of one viewed year: the prior-year rows,
    the header counts, and the TLI/SCIT cabins a current-year row looks
    itself up by.

    THE YEAR IS REQUIRED, unlike the household journey and person-housing
    reads this one composes, because the answer depends on it: rows stop
    before it, the counts and the summers cap run through it, and adulthood
    and the household are read off the person's row for it.

    Open to any authenticated user, exactly like those two reads: cabin names,
    session names and dates, and no narrative. `persons` itself requires auth
    in PocketBase, and so does this.
    """
    return await CamperJourneyService(LodgingRepository(pb)).build_camper_journey(person_cm_id, year)

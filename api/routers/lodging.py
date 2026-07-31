"""Weekend lodging router — read-only roster for family and adult programs.

Thin by design: parse input, call the service, return the model. Business
logic lives in api/services/lodging_*.py (see api/CLAUDE.md).

Caddy needs no configuration change: its inverse routing sends everything
under /api/* that is not an explicit PocketBase path to FastAPI.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas.lodging import (
    HouseholdMedicalResponse,
    WeekendRosterResponse,
    WeekendSessionListResponse,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import LodgingRosterService, SessionNotFoundError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.logging_config import get_logger
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

logger = get_logger(__name__)

router = APIRouter(prefix="/api/lodging", tags=["lodging"])


def _service() -> LodgingRosterService:
    return LodgingRosterService(LodgingRepository(pb))


@router.get("/sessions", response_model=WeekendSessionListResponse)
async def list_weekend_sessions(
    year: int = Query(..., description="Year to list weekend sessions for", ge=2000, le=2100),
    user: AuthUser = Depends(get_current_user),
) -> WeekendSessionListResponse:
    """List every family-camp and adult-weekend session for a year.

    These are the two `camp_sessions.session_type` values this surface owns;
    summer session types belong to the bunking board.
    """
    return await _service().list_sessions(year)


@router.get("/roster", response_model=WeekendRosterResponse)
async def get_weekend_roster(
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session"),
    user: AuthUser = Depends(get_current_user),
) -> WeekendRosterResponse:
    """Per-weekend roster: parties, the unit inventory, and honest counts.

    Assignments are read-only in this slice. Capacity figures exclude
    building/container rows and units whose `sleeps` is unknown, so they
    never overstate what is placeable.
    """
    try:
        return await _service().build_roster(year, session_cm_id)
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"No family or adult session with CampMinder id {session_cm_id} in {year}",
        ) from exc


@router.get("/households/{household_cm_id}/medical", response_model=HouseholdMedicalResponse)
async def get_household_medical(
    household_cm_id: int,
    year: int = Query(..., description="Year of the registration", ge=2000, le=2100),
    user: AuthUser = Depends(require_permission(Permission.LODGING_PHI)),
) -> HouseholdMedicalResponse:
    """PHI. The narrative behind the roster's accessibility flags.

    Spec §5: this text is a detailed medical disclosure about named
    individuals. It is served only here, only to a caller holding
    `lodging.phi`, and never appears in the roster payload or any export.

    The access is logged, but only its subject and the caller -- never a
    narrative field, which would put the disclosure into the log it is being
    gated out of.
    """
    logger.info(
        "PHI reveal: lodging medical narrative accessed",
        extra={"household_cm_id": household_cm_id, "year": year, "user": user.email},
    )
    return await _service().get_household_medical(year, household_cm_id)

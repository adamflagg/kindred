"""Weekend friend groups — staff-authored household sets (kindred#1913 half 1).

Its own router rather than four more endpoints on `api/routers/lodging.py`.
That one is the roster and the placement drafts; this is an INPUT to placement
that shares no service, no schema module and no permission story beyond the
gate every lodging write already uses.

Reads are open to any authenticated user, exactly as the roster's are: a
viewer looking at the read-only mirror board needs to see that two families
are grouped even though they may not edit it. The three writes gate on
`bunking.manage`.

The permission check here is not redundant with the collection rules. This
service reaches PocketBase with its own credentials, so the collection rule
never sees the caller; without these dependencies the API would be an open
door standing beside a locked one.

Caddy needs no configuration change: its inverse routing sends everything
under /api/* that is not an explicit PocketBase path to FastAPI.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas.lodging_friend_groups import (
    FriendGroup,
    FriendGroupCreateRequest,
    FriendGroupDeleteResponse,
    FriendGroupListResponse,
    FriendGroupUpdateRequest,
)
from api.services.lodging_friend_group_service import (
    FriendGroupNotFoundError,
    LodgingFriendGroupRepository,
    LodgingFriendGroupService,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import SessionNotFoundError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/lodging/friend-groups", tags=["lodging"])


def _service() -> LodgingFriendGroupService:
    return LodgingFriendGroupService(LodgingRepository(pb), LodgingFriendGroupRepository(pb))


def _weekend_404(year: int, session_cm_id: int) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"No family or adult session with CampMinder id {session_cm_id} in {year}",
    )


def _group_404(group_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"No friend group {group_id}")


@router.get("", response_model=FriendGroupListResponse)
async def list_friend_groups(
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session"),
    user: AuthUser = Depends(get_current_user),
) -> FriendGroupListResponse:
    """Every friend group on one weekend, with its household membership.

    NO `scenario` parameter, unlike the roster. Migration 1500000144 gives this
    table no scenario dimension: a group records what households asked for,
    which is true of the weekend in every plan for it -- the same argument
    1500000135 made for `lodging_availability`. See that migration's header.
    """
    try:
        return await _service().list_groups(year, session_cm_id)
    except SessionNotFoundError as exc:
        raise _weekend_404(year, session_cm_id) from exc


@router.post("", response_model=FriendGroup)
async def create_friend_group(
    request: FriendGroupCreateRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> FriendGroup:
    """Author one group over at least two households.

    `intent` is required and has no default: NEAR and WITH are different
    requests -- NEAR is satisfied by distance between units, WITH by putting
    both parties in one room -- so a group that does not say which one it
    means is refused with a 422 rather than guessed at.
    """
    try:
        return await _service().create_group(request, user.email)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.patch("/{group_id}", response_model=FriendGroup)
async def update_friend_group(
    group_id: str,
    request: FriendGroupUpdateRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> FriendGroup:
    """Rename, recolour, switch intent, or replace the membership.

    A true PATCH: an omitted field is untouched, while `name: ""` is a real
    edit meaning "fall back to the auto-name". The weekend and the year are
    not editable -- moving a group to another weekend would carry households
    that are not on the destination roster, which is a new group, not an edit.
    """
    try:
        return await _service().update_group(group_id, request, user.email)
    except FriendGroupNotFoundError as exc:
        raise _group_404(group_id) from exc


@router.delete("/{group_id}", response_model=FriendGroupDeleteResponse)
async def delete_friend_group(
    group_id: str,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> FriendGroupDeleteResponse:
    """Dissolve a group. Its membership cascades away with it (1500000144)."""
    try:
        return await _service().delete_group(group_id)
    except FriendGroupNotFoundError as exc:
        raise _group_404(group_id) from exc

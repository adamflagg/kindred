"""Weekend lodging router — roster reads and draft writes.

Thin by design: parse input, call the service, return the model. Business
logic lives in api/services/lodging_*.py (see api/CLAUDE.md).

Reads are open to any authenticated user; the four writes at the bottom gate
on `bunking.manage` and reach only the DRAFT grain. `lodging_assignments` and
its history stay admin-only in PocketBase and no endpoint here writes them --
the copy endpoint reads the mirror to seed a scenario, which is the one
direction that line permits.

Caddy needs no configuration change: its inverse routing sends everything
under /api/* that is not an explicit PocketBase path to FastAPI.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    HouseholdJourneyResponse,
    HouseholdMedicalResponse,
    LodgingCopyResponse,
    LodgingWriteResponse,
    PlacementCopyRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
    SlotMergeRequest,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSummaryResponse,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import LodgingRosterService, SessionNotFoundError
from api.services.lodging_write_service import LodgingWriteService, ScenarioNotEmptyError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/lodging", tags=["lodging"])


def _service() -> LodgingRosterService:
    return LodgingRosterService(LodgingRepository(pb))


def _writes() -> LodgingWriteService:
    return LodgingWriteService(LodgingRepository(pb))


def _weekend_404(year: int, session_cm_id: int) -> HTTPException:
    """The one 404 this surface raises, worded once.

    A write naming a weekend that does not exist is a client error, not a
    silent no-op: the board would otherwise report a successful placement into
    nothing.
    """
    return HTTPException(
        status_code=404,
        detail=f"No family or adult session with CampMinder id {session_cm_id} in {year}",
    )


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


@router.get("/summary", response_model=WeekendSummaryResponse)
async def get_weekend_summary(
    year: int = Query(..., description="Year of the weekends", ge=2000, le=2100),
    scenario: str = Query("", description="Saved scenario id; empty resolves the CampMinder mirror"),
    user: AuthUser = Depends(get_current_user),
) -> WeekendSummaryResponse:
    """Every weekend in a year with its counts, for the lander, in one request.

    The lander needs a handful of figures per weekend. Getting them from
    `/roster` costs one composed read each, and that read is dominated by
    year-scoped work identical across every weekend -- so twelve weekends
    repeat it twelve times. This does it once. The counts come from the same
    helpers `/roster` uses, so the two can never disagree.

    `scenario` is here for exactly that reason. A lander that could not take it
    would report a family placed while the page it links to shows them
    unplaced -- the two disagreeing by resolving the scenario differently
    rather than by drifting apart in code.
    """
    return await _service().build_summary(year, scenario)


@router.get("/roster", response_model=WeekendRosterResponse)
async def get_weekend_roster(
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session"),
    scenario: str = Query("", description="Saved scenario id; empty resolves the CampMinder mirror"),
    user: AuthUser = Depends(get_current_user),
) -> WeekendRosterResponse:
    """Per-weekend roster: parties, the unit inventory, and honest counts.

    Capacity figures exclude building/container rows and units whose `sleeps`
    is unknown, so they never overstate what is placeable.

    With no `scenario` this is the CampMinder mirror -- the synced rows, which
    no UI may write. With one, the scenario's own draft placements REPLACE
    them: a party with no draft row is unplaced in that scenario, and the
    mirror is not read at all. Availability does NOT vary this way: 1500000135
    deleted its scenario dimension, so the same rows resolve for every plan --
    a burst pipe closes a cabin in all of them. See `set_availability` below.
    """
    try:
        return await _service().build_roster(year, session_cm_id, scenario)
    except SessionNotFoundError as exc:
        raise _weekend_404(year, session_cm_id) from exc


@router.get("/households/{household_cm_id}/journey", response_model=HouseholdJourneyResponse)
async def get_household_journey(
    household_cm_id: int,
    user: AuthUser = Depends(get_current_user),
) -> HouseholdJourneyResponse:
    """A household's family-camp record, year by year (kindred#2073).

    TAKES NO YEAR, unlike every other read on this router, and that is the
    contract rather than an omission: the journey's window is DISCOVERED, not
    chosen. A year appears when the household has a trace in it -- an enrolled
    child, an adult on file, or a registration -- and those three reach
    different distances back. A `?year=` parameter would imply the caller
    picks the window, which is exactly how a four-year family ends up
    rendered as a one-year one.

    Open to any authenticated user, like `/roster` and `/summary` above and
    UNLIKE the medical endpoint directly below. It carries names, ages and
    grades -- the same fields the roster already publishes for the current
    weekend -- and no narrative, so the PHI boundary is untouched.
    """
    return await _service().build_household_journey(household_cm_id)


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

    RBAC is the control, and there is deliberately NO access log. One existed
    and was deleted: `lodging.phi` is what decides who may read this, and a
    log line is not a second gate. It also stopped meaning what it said once
    kindred#1889 removed the reveal button -- the panel fetches on mount, so
    the event fired on every panel open, including households with nothing on
    file, and could no longer distinguish a deliberate read from a click.

    The other half of that ruling stands and is not about auditing: PHI must
    not enter the roster payload, pinned by tests/unit/api/test_lodging_phi_boundary.py.
    """
    return await _service().get_household_medical(year, household_cm_id)


# --------------------------------------------------------------------- writes
#
# All four gate on `bunking.manage`, which is the point of the draft split: the
# people who do this job are bunking staff, not admins, and the admin-only
# record of truth is never written from a UI. The frontend must reach these
# through `fetchWithAuth` from `useApiWithAuth()` -- the PocketBase JWT lives in
# localStorage, not cookies, so a raw `fetch` silently 401s.
#
# The permission check here is not redundant with the collection rules. This
# service writes to PocketBase with its own credentials, so the collection rule
# never sees the caller; without these dependencies the API would be an open
# door standing beside a locked one.


@router.post("/placements", response_model=LodgingWriteResponse)
async def upsert_placement(
    request: PlacementWriteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingWriteResponse:
    """Place a party in a scenario, into one or more units.

    `unit_ids` must name at least one unit; an empty list is a 422. It used to
    be the tombstone, which kindred#1974 retired along with the fall-through
    it existed to suppress. To take a party off the board, DELETE the row.
    """
    try:
        return await _writes().place_party(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.delete("/placements", response_model=LodgingWriteResponse)
async def delete_placement(
    request: PlacementDeleteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingWriteResponse:
    """UNPLACE a party: drop its draft row.

    Under replace semantics the absence of a row IS the unplaced state, so
    this is the whole of "staff took this party off the board" -- what
    dragging a card to the unplaced rail calls.

    Takes a body rather than path parameters because the row is identified by
    four values (weekend, year, scenario, party) in one of two grains, and no
    part of that is a resource id a client already holds.
    """
    try:
        return await _writes().unplace_party(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.post("/placements/copy", response_model=LodgingCopyResponse)
async def copy_placements_from_mirror(
    request: PlacementCopyRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingCopyResponse:
    """Seed a scenario from the CampMinder mirror, for one weekend.

    A scenario replaces the mirror rather than overlaying it (kindred#1974),
    so a new one is empty; this is the step that fills it. Summer's equivalent
    rides inside `POST /api/scenarios`, which copies `bunk_assignments` and
    returns zero rows for a weekend session -- create the scenario there, fill
    it here.

    409 when the scenario already holds placements for this weekend — whether
    it did before the call or another caller seeded it mid-copy, which the
    draft's unique index catches and which would otherwise surface as a 400. A
    second copy would overwrite what staff placed and re-place everything they
    unplaced, so the refusal is the feature: re-baselining a worked plan
    against upstream drift is a different operation and does not exist yet.
    """
    try:
        return await _writes().copy_from_mirror(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc
    except ScenarioNotEmptyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/availability", response_model=LodgingWriteResponse)
async def set_availability(
    request: AvailabilityWriteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingWriteResponse:
    """Reserve or release one unit for this weekend.

    Takes NO scenario, unlike every other write on this router. Availability is
    a fact about the weekend rather than about the plan -- a burst pipe closes
    a cabin in every scenario for that weekend -- so 1500000135 deleted the
    dimension. Requiring one is what made this endpoint uncallable.

    `family_available: null` clears the override, which is spelled as the
    ABSENCE of a row: there is no value meaning "normal", and writing one would
    pin the unit against a later change to its role.
    """
    try:
        return await _writes().set_availability(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.put("/merge", response_model=LodgingWriteResponse)
async def set_slot_merge(
    request: SlotMergeRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingWriteResponse:
    """Set one container's draw level, at a scenario or at the weekend.

    UNLIKE every other scenario-scoped write here, `scenario` on the body is
    OPTIONAL (1500000140): a blank value is a legal, distinct WEEKEND-LEVEL
    write, not a refused one. Still `BUNKING_MANAGE`-gated -- a merge is a
    fact about the weekend rather than about a plan (same argument
    1500000135 made for `/availability`'s own weekend-level fact), but it is
    still a planning decision a staff member makes, not something CampMinder
    ever syncs, so the write permission does not relax the way the read side
    does.

    Catches SessionNotFoundError the same way every other write below does --
    `set_slot_merge` resolves the weekend through the identical
    `_resolve_session_pb_id` helper, so an unknown `session_cm_id` must answer
    404 here too rather than falling through as an unhandled 500.
    """
    try:
        return await _writes().set_slot_merge(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc

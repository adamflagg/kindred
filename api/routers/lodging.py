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
    PushExecuteRequest,
    PushExecuteResponse,
    PushPreviewResponse,
    ScenarioCompareResponse,
    SessionAttributionConflictsResponse,
    SlotMergeRequest,
    UnpushResponse,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSummaryResponse,
    WriteInDeleteRequest,
)
from api.services.lodging_attribution_service import LodgingAttributionService
from api.services.lodging_compare_service import LodgingCompareService, NotAFamilyWeekendError
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import LodgingRosterService, SessionNotFoundError
from api.services.lodging_write_service import (
    AlreadyUnpushedError,
    LodgingWriteService,
    PushDecisionsIncompleteError,
    PushDigestStaleError,
    PushNotFoundError,
    ScenarioNotEmptyError,
    UnpushDriftError,
    WriteInNameTakenError,
    WriteInRenameConflictError,
)
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/lodging", tags=["lodging"])


def _service() -> LodgingRosterService:
    return LodgingRosterService(LodgingRepository(pb))


def _may_read_staff_notes(user: AuthUser) -> bool:
    """Whether this caller may see the two staff-authored request blocks.

    `BunkingNotes Notes` and `Internal Bunk Notes` are `original_bunk_requests`
    rows -- a table whose own PocketBase listRule is `bunking.manage`, and
    whose raw `content` every other API route (`api/routers/debug.py`) serves
    only to an admin. `/roster` below is open to any authenticated user, so
    the blocks are withheld here rather than at the read, which is cached per
    year and shared across callers. Same predicate as `require_permission`,
    admin included; it is a boolean rather than a dependency because the rest
    of the payload stays open.
    """
    return user.is_admin or Permission.BUNKING_MANAGE in user.permissions


def _writes() -> LodgingWriteService:
    return LodgingWriteService(LodgingRepository(pb))


def _compare() -> LodgingCompareService:
    return LodgingCompareService(LodgingRepository(pb))


def _attribution() -> LodgingAttributionService:
    return LodgingAttributionService(LodgingRepository(pb))


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
    mirror is not read at all.

    WRITE-INS REPLACE THE SAME WAY (kindred#2382): a scenario reads
    `lodging_write_ins_draft` and the live table is not read at all, because an
    occupancy is a modelling choice belonging to the plan that made it. The
    staff<->family ROLE does NOT vary this way -- 1500000135 deleted that
    table's scenario dimension and the split left it deleted, so the same
    `lodging_availability` rows resolve for every plan. See `set_availability`
    below, which steers exactly the half that varies.

    OPEN to any authenticated user, with ONE screen-reduction inside the
    payload: the two staff-authored free-text blocks need `bunking.manage`.
    See `_may_read_staff_notes`. The family-authored blocks and `request_text`
    stay ungated, exactly as before -- a household's own housing ask is a
    placement input (kindred#2398).
    """
    try:
        return await _service().build_roster(
            year, session_cm_id, scenario, include_staff_notes=_may_read_staff_notes(user)
        )
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
    chosen. A year appears when camp actually had the household -- an ENROLLED
    child on a family session, or (for a paper registration, which leaves no
    attendee row at all) a cabin on file -- and attendance reaches further
    back than housing does. A `?year=` parameter would imply the caller picks
    the window, which is exactly how a four-year family ends up rendered as a
    one-year one.

    ⚠️ Registration and adult-on-file rows STOPPED being traces of their own
    in kindred#2516: both fire on a form being filled in rather than on
    anybody turning up, so a cancelled or waitlisted family carried a year
    indistinguishable from one they attended.

    Open to any authenticated user, like `/roster` and `/summary` above and
    UNLIKE the medical endpoint directly below. It carries names, ages and
    grades -- the same fields the roster already publishes for the current
    weekend -- and no narrative, so nothing gated moves.
    """
    return await _service().build_household_journey(household_cm_id)


@router.get("/households/{household_cm_id}/medical", response_model=HouseholdMedicalResponse)
async def get_household_medical(
    household_cm_id: int,
    year: int = Query(..., description="Year of the registration", ge=2000, le=2100),
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> HouseholdMedicalResponse:
    """The medical narrative behind the roster's accessibility flags.

    Spec §5: this text is a detailed medical disclosure about named
    individuals. It is served only here, only to a caller holding
    `bunking.manage`, and never appears in the roster payload or any export.

    kindred#2312: this used to gate on a separate `lodging.phi` permission,
    removed because RBAC in this product is screen-reduction, not a data
    boundary -- every user of the tool can already see this data in
    CampMinder, and every sibling endpoint on this router already gates on
    `bunking.manage`. There is one permission on this surface, not two
    (kindred#2398): a thing here is either behind `bunking.manage` or it is
    not, and the medical narrative is. So are internal notes, which that
    change left exactly where they were.

    RBAC is the control, and there is deliberately NO access log. One existed
    and was deleted: `bunking.manage` is what decides who may read this, and a
    log line is not a second gate. It also stopped meaning what it said once
    kindred#1889 removed the reveal button -- the panel fetches on mount, so
    the event fired on every panel open, including households with nothing on
    file, and could no longer distinguish a deliberate read from a click.

    The other half of that ruling stands and is not about auditing: the
    narrative must not enter the roster payload, pinned by
    tests/unit/api/test_lodging_medical_narrative_containment.py.
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
    """Write somebody into one unit for this weekend, or release one to families.

    ONE ENDPOINT, TWO TABLES since kindred#2382. `family_available` answers two
    unrelated questions and each is stored where it belongs: `false` is an
    OCCUPANCY and goes to `lodging_write_ins` or its scenario-scoped draft
    twin, `true` is a staff<->family ROLE override for the weekend and stays in
    `lodging_availability`. The URL and everything a staff member sees are
    unchanged -- the split is behind them, and the request model grew exactly
    one optional field for it. `set_availability` carries the reasoning.

    `scenario` is OPTIONAL on the body, as it is on `/merge` and unlike every
    other write here, and it steers the OCCUPANCY half alone. Blank is the LIVE
    board -- a scope in its own right rather than the absence of one, because
    staff evaluate the real board and must be able to write onto it -- and a
    scenario id writes that scenario's own draft occupancy. REQUIRING one is
    what made this endpoint uncallable before kindred#2382, and would leave the
    live board with no write path now.

    The role half ignores it: `lodging_availability` has no scenario column,
    and a release made from inside a plan is still a fact about the weekend.

    `family_available: null` clears the override, which is spelled as the
    ABSENCE of a row -- in BOTH tables. There is no value meaning "normal", and
    writing one would pin the unit against a later change to its role.

    `previous_occupant_name` RENAMES one row, and is a compare-and-swap
    (kindred#2583 step 4). Under Design B the occupant's name is the row's
    address, so an edit that changes that name cannot address itself -- the
    form sends the name it loaded, this resolves that row, and `occupant_name`
    is written onto it. A previous name that resolves nothing answers **409**:
    the row moved under the card, and falling through to a create is what
    turns one rename into two rows now that step 8 has narrowed the index.
    """
    try:
        return await _writes().set_availability(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc
    except WriteInRenameConflictError as exc:
        # kindred#2583 step 4. `previous_occupant_name` is a compare-and-swap
        # and this is the failed swap: the request is well formed and the
        # weekend resolves, but the ROW the card was opened against is gone.
        # 409 is the reading `/placements/copy` and `unpush` already give that
        # shape. The message is the entire client-side handling -- a toast
        # saying the row moved and to reopen the card (owner, 2026-08-29:
        # staff each work their own weekend async, so this fires essentially
        # never and buys correctness rather than a conflict UI).
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except WriteInNameTakenError as exc:
        # kindred#2583 step 8 (raised by #2642's scan). The swap RESOLVED --
        # the row is where the card said it was -- and the index refused the
        # new name because the co-occupant beside it already holds it. 409 for
        # the same reason the rename conflict above is one: the request is
        # well formed and the state, not the input, is what refuses it. The
        # message names the taken name because the remedy is to choose another
        # one, which a bare "Invalid request" (what `pb_error_to_http` renders
        # a raw PocketBase 400 as) gives staff no way to reach.
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/write-ins", response_model=LodgingWriteResponse)
async def delete_write_in(
    request: WriteInDeleteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> LodgingWriteResponse:
    """Remove ONE occupant from one unit, leaving everything else standing.

    kindred#2583 step 7. `PUT /availability` with `family_available: null`
    stays the CLEAR-THIS-UNIT-ENTIRELY verb -- it drops the role row and every
    occupancy row on the unit, which is exactly what it means today while a
    cabin can hold one write-in, so nothing at that boundary moves. This is
    the other half: "take one paper family out of a shared cabin and leave the
    other where she is."

    Takes a BODY rather than path parameters, exactly as `DELETE /placements`
    does and for the same reason: the row is identified by values the client
    already holds -- weekend, year, scenario, unit, occupant -- and none of
    them is a resource id. Under Design B (kindred#2583, RULED 2026-08-29)
    `(unit_id, occupant_name)` is that identity; Design A, which would have
    published the record id for the client to round-trip, was declined.

    The ROLE row is left alone. A staff<->family override is a fact about the
    weekend and taking an occupant out of a cabin says nothing about it; only
    the clear verb touches both tables.

    Idempotent: removing somebody who is not there answers 200 with
    `deleted: false`, the same as `DELETE /placements` does for a party that
    was never placed. The absence of the row IS the state the caller asked
    for.
    """
    try:
        return await _writes().remove_write_in(request)
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.get("/push/preview", response_model=PushPreviewResponse)
async def get_push_preview(
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session", gt=0),
    scenario: str = Query(
        ..., description="Scenario whose write-ins are compared against the live board", min_length=1
    ),
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> PushPreviewResponse:
    """Classify a scenario's write-ins against the live board (kindred#2477).

    Reads and reports; nothing here is applied yet. Not a crossing of this
    module's own mirror line -- `lodging_write_ins` is app-owned rather than
    a CampMinder ingest table (see the module docstring atop
    `api/services/lodging_write_service.py`), so diffing it against a
    scenario's draft twin is the same kind of read/write this router already
    makes onto the draft grain, not a new exception to it.

    CLASSIFICATION IS SERVER-SIDE ONLY, and there is deliberately no TS
    mirror of it: `/roster` already replaces `lodging_write_ins` with the
    scenario's draft rows for the duration of a scenario, so a client working
    inside one never reads the live table at all and has nothing to diff
    against even if it tried. `preview_push` is the one place both sides are
    read together, and this endpoint is a thin wrapper over it.

    `BUNKING_MANAGE`-gated like every write below, even though this endpoint
    writes nothing -- reviewing what a push would do is part of the same
    staff workflow the push itself is.
    """
    try:
        return await _writes().preview_push(year, session_cm_id, scenario)
    except SessionNotFoundError as exc:
        raise _weekend_404(year, session_cm_id) from exc


@router.get("/compare", response_model=ScenarioCompareResponse)
async def get_scenario_compare(
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session", gt=0),
    scenario: str = Query(
        ..., description="Scenario whose placements are compared against the CampMinder mirror", min_length=1
    ),
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> ScenarioCompareResponse:
    """Compare a scenario's placements against the CampMinder mirror (kindred#2478 §5).

    REPORT-ONLY, by owner ruling (§5.6). This reads and classifies; it offers
    no take-CampMinder's / keep-mine action on any row and writes nothing.
    Half the verdicts could not be actioned even if it did: acting on `remove`
    means writing TOWARD `lodging_assignments`, which
    `api/services/lodging_write_service.py` forbids outright. See
    `api/services/lodging_compare_service.py`.

    CLASSIFICATION IS SERVER-SIDE, the same argument `get_push_preview` above
    documents one grain over: inside a scenario `/roster` replaces the mirror's
    placements with the scenario's draft rows, so a client working inside one
    never reads the live table and has nothing to diff against. This endpoint
    is the one place both sides are read together.

    `BUNKING_MANAGE`-gated exactly like `/push/preview`, and for the same
    reason: it writes nothing, but reviewing a plan against CampMinder is part
    of the same staff workflow placing families is.

    A weekend that is not family camp is a 400, not an empty report -- owner
    ruling §5.1 scopes this to family camp, and an empty report would read as
    agreement rather than as a question this feature does not answer.
    """
    try:
        return await _compare().compare_scenario(year, session_cm_id, scenario)
    except SessionNotFoundError as exc:
        raise _weekend_404(year, session_cm_id) from exc
    except NotAFamilyWeekendError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/attribution/conflicts", response_model=SessionAttributionConflictsResponse)
async def get_session_attribution_conflicts(
    year: int = Query(..., description="Year of the attribution queue", ge=2000, le=2100),
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SessionAttributionConflictsResponse:
    """Occupancy evidence for the open cabin-weekend attribution queue.

    §12.8 of the round-2 triage-attack plan, owner-designed and owner-ruled
    2026-08-31. It CLOSES NO ISSUE and none is filed, deliberately.

    When a household attends 2+ weekends, CampMinder holds one cabin value for
    the year and cannot say which weekend it describes; the Go ingest files an
    `ambiguous_session` row carrying `AttributeSession`'s timestamp guess. This
    answers the question that guess cannot -- is the cabin already occupied in
    each candidate weekend, and by whom -- and DEMOTES the conflicted weekends.

    CLASSIFICATION IS SERVER-SIDE ONLY, the same argument `/push/preview` and
    `/compare` above each make one grain over: the answer needs the live board's
    placements AND its write-ins across every candidate weekend, which a client
    holding only the queue rows cannot assemble, and a client that tried would
    be a second implementation of availability
    (`api/services/lodging_rules.py`'s `is_family_available` /
    `free_family_spots`, owner rulings 2026-08-23 and 2026-08-29).

    BOTH SUGGESTIONS CROSS THE WIRE. `suggested_session` in PocketBase keeps
    its unchanged timestamp value -- nothing in Go moves, and `AttributeSession`
    is untouched -- so publishing only the conflict-aware answer would make the
    UI silently disagree with the row it is rendering. Publishing both is what
    lets it say *"FC2, because FC1 is taken."*

    UNCACHED DELIBERATELY, for two reasons rather than one. Staff flip
    `is_resolved` straight against PocketBase from the admin panel
    (`confirmSessionAttribution` in `frontend/src/services/lodgingCrud.ts`),
    which is the call `count_open_unresolved_aliases` already makes for the
    queue this annotates -- and this additionally reads LIVE WRITE-INS, which
    the board writes directly through `api/services/lodging_write_service.py`.

    `BUNKING_MANAGE`-gated like the two report endpoints above, even though it
    writes nothing: the payload names households and the cabins they are in,
    and deciding which weekend a cabin value belongs to is part of the same
    staff workflow placing families is.
    """
    return await _attribution().build_conflicts(year)


@router.post("/push", response_model=PushExecuteResponse)
async def execute_push(
    request: PushExecuteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> PushExecuteResponse:
    """Apply a scenario's write-ins onto the live board (kindred#2477).

    Still `lodging_write_ins`, not `lodging_assignments` or its history --
    this is not the promote/publish path that
    `api/services/lodging_write_service.py`'s module docstring says does not
    exist yet, because the table it writes is app-owned rather than a
    CampMinder mirror in the first place.

    `pushed_by=user.email` -- `AuthUser` (`bunking/auth_middleware.py`) has
    no `.id`; `email` is the same identity `api/routers/lodging_friend_groups.py`
    already records a creator/editor by on this surface.

    `execute_push` re-classifies before touching anything and refuses rather
    than trusting what this request already believes: a digest that no
    longer matches means the board or the scenario moved since the review
    was opened (409, with the fresh report so the client can re-render
    rather than just retry blind), and a `conflict`/`remove` building with no
    decision refuses the whole push rather than defaulting to keep-live
    (422) -- see `PushDigestStaleError` and `PushDecisionsIncompleteError`.
    """
    try:
        return await _writes().execute_push(request, pushed_by=user.email)
    except PushDigestStaleError as exc:
        raise HTTPException(status_code=409, detail={"reason": "stale", "report": exc.report.model_dump()}) from exc
    except PushDecisionsIncompleteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise _weekend_404(request.year, request.session_cm_id) from exc


@router.post("/push/{push_id}/unpush", response_model=UnpushResponse)
async def unpush(
    push_id: str,
    year: int = Query(..., description="Year of the weekend", ge=2000, le=2100),
    session_cm_id: int = Query(..., description="CampMinder id of the weekend session", gt=0),
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> UnpushResponse:
    """Revert one push as a unit (kindred#2477 Task 5).

    Replays the ledger row's `changes` in reverse against `lodging_write_ins`
    -- the same app-owned table `execute_push` above writes -- deleting what
    the push added and recreating what it removed. See
    `LodgingWriteService.unpush` for the drift check that refuses the whole
    revert rather than applying it partially when a touched unit no longer
    matches the push's own after-state.
    """
    try:
        return await _writes().unpush(push_id, year, session_cm_id)
    except PushNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"push {push_id} not found") from exc
    except AlreadyUnpushedError as exc:
        raise HTTPException(status_code=409, detail={"reason": "already_unpushed"}) from exc
    except UnpushDriftError as exc:
        raise HTTPException(status_code=409, detail={"reason": "drift", "buildings": exc.buildings}) from exc
    except SessionNotFoundError as exc:
        raise _weekend_404(year, session_cm_id) from exc


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

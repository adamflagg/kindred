"""Jotform admin router (kindred#2759). Thin: parse, call the service, map its
two errors. EVERY endpoint gates on `bunking.manage` -- the tables carry every
answer on the form, medical included."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from api.schemas.jotform import (
    JotformActionResult,
    JotformFormRow,
    JotformFormsResponse,
    JotformFormWrite,
    JotformLinkRequest,
    JotformQueueResponse,
    JotformWriteInLinkRequest,
)
from api.services.jotform_admin_service import JotformAdminService, JotformNotFoundError, JotformValidationError
from api.services.jotform_repository import JotformRepository
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/jotform", tags=["jotform"])
_MANAGE = Depends(require_permission(Permission.BUNKING_MANAGE))


def _service() -> JotformAdminService:
    return JotformAdminService(JotformRepository(pb))


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, JotformNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


# One filer, one decision (kindred#2839 follow-up): a staff action also moves
# the same filer's other filings of the weekend. When it did, the 200 names
# them so the tab can say so; when it moved only the clicked filing, there is
# nothing to report and the answer stays a 204.
_ACTION_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {"model": JotformActionResult, "description": "The filer's other filings the action also moved"}
}


def _done(result: JotformActionResult | None) -> Response:
    if result is None or not result.also:
        return Response(status_code=204)
    return JSONResponse(result.model_dump(mode="json"))


@router.get("/forms", response_model=JotformFormsResponse)
async def list_forms(year: int = Query(..., ge=2000, le=2100), user: AuthUser = _MANAGE) -> JotformFormsResponse:
    """One row per active-season adult weekend, set up or not."""
    return await _service().build_forms(year)


@router.put("/forms/{session_cm_id}", response_model=JotformFormRow)
async def save_form(
    session_cm_id: int, body: JotformFormWrite, year: int = Query(..., ge=2000, le=2100), user: AuthUser = _MANAGE
) -> JotformFormRow:
    try:
        return await _service().save_form(year, session_cm_id, body)
    except (JotformNotFoundError, JotformValidationError) as exc:
        raise _http(exc) from exc


@router.get("/queue", response_model=JotformQueueResponse)
async def get_queue(
    year: int = Query(..., ge=2000, le=2100),
    session_cm_id: int | None = Query(None, gt=0, description="One adult weekend: its Requests tab"),
    scenario: str = Query("", max_length=64, description="Saved scenario id; empty reads the live board"),
    user: AuthUser = _MANAGE,
) -> JotformQueueResponse:
    """The year's queue, or -- with `session_cm_id` -- one weekend's, read in
    `scenario` (kindred#2828 ruling 2026-09-25): its write-in links resolve
    against that scenario's write-ins. The scenario must be the weekend's."""
    try:
        return await _service().build_queue(year, session_cm_id=session_cm_id, scenario=scenario)
    except (JotformNotFoundError, JotformValidationError) as exc:
        raise _http(exc) from exc


@router.post("/submissions/{submission_id}/link", status_code=204, response_class=Response, responses=_ACTION_RESPONSES)
async def link_submission(submission_id: str, body: JotformLinkRequest, user: AuthUser = _MANAGE) -> Response:
    try:
        result = await _service().link(submission_id, body.person_cm_id, user.email)
    except (JotformNotFoundError, JotformValidationError) as exc:
        raise _http(exc) from exc
    return _done(result)


@router.post(
    "/submissions/{submission_id}/ignore", status_code=204, response_class=Response, responses=_ACTION_RESPONSES
)
async def ignore_submission(submission_id: str, user: AuthUser = _MANAGE) -> Response:
    try:
        result = await _service().ignore(submission_id, user.email)
    except JotformNotFoundError as exc:
        raise _http(exc) from exc
    return _done(result)


@router.post(
    "/submissions/{submission_id}/unlink", status_code=204, response_class=Response, responses=_ACTION_RESPONSES
)
async def unlink_submission(submission_id: str, user: AuthUser = _MANAGE) -> Response:
    try:
        result = await _service().unlink(submission_id)
    except JotformNotFoundError as exc:
        raise _http(exc) from exc
    return _done(result)


@router.post(
    "/submissions/{submission_id}/write-in", status_code=204, response_class=Response, responses=_ACTION_RESPONSES
)
async def link_submission_to_write_in(
    submission_id: str, body: JotformWriteInLinkRequest, user: AuthUser = _MANAGE
) -> Response:
    """Link a filing to one of its weekend's board write-ins (kindred#2759 follow-up)."""
    try:
        result = await _service().link_write_in(submission_id, body.unit_id, body.occupant_name, user.email)
    except (JotformNotFoundError, JotformValidationError) as exc:
        raise _http(exc) from exc
    return _done(result)

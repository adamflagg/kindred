"""Jotform admin router (kindred#2759). Thin: parse, call the service, map its
two errors. EVERY endpoint gates on `bunking.manage` -- the tables carry every
answer on the form, medical included."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from api.schemas.jotform import (
    JotformFormRow,
    JotformFormsResponse,
    JotformFormWrite,
    JotformLinkRequest,
    JotformQueueResponse,
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
async def get_queue(year: int = Query(..., ge=2000, le=2100), user: AuthUser = _MANAGE) -> JotformQueueResponse:
    return await _service().build_queue(year)


@router.post("/submissions/{submission_id}/link", status_code=204, response_class=Response)
async def link_submission(submission_id: str, body: JotformLinkRequest, user: AuthUser = _MANAGE) -> Response:
    try:
        await _service().link(submission_id, body.person_cm_id, user.email)
    except (JotformNotFoundError, JotformValidationError) as exc:
        raise _http(exc) from exc
    return Response(status_code=204)


@router.post("/submissions/{submission_id}/ignore", status_code=204, response_class=Response)
async def ignore_submission(submission_id: str, user: AuthUser = _MANAGE) -> Response:
    try:
        await _service().ignore(submission_id, user.email)
    except JotformNotFoundError as exc:
        raise _http(exc) from exc
    return Response(status_code=204)


@router.post("/submissions/{submission_id}/unlink", status_code=204, response_class=Response)
async def unlink_submission(submission_id: str, user: AuthUser = _MANAGE) -> Response:
    try:
        await _service().unlink(submission_id)
    except JotformNotFoundError as exc:
        raise _http(exc) from exc
    return Response(status_code=204)

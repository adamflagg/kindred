"""Board notes -- /api/subject-notes (spec 2026-09-25, migration 1500000189).

`bunking.manage` gates READING as well as writing (owner, 2026-09-25): a
viewer without it sees no note anywhere. The dependency is not redundant with
the collection rules -- this service reaches PocketBase with its own
credentials, so the rule never sees the caller.

Caddy needs no change: its inverse routing sends everything under /api/* that
is not an explicit PocketBase path to FastAPI.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.schemas.subject_notes import (
    SubjectNotePromoteRequest,
    SubjectNotesResponse,
    SubjectNoteWriteRequest,
    SubjectNoteWriteResponse,
)
from api.services.subject_note_service import (
    NothingToPromoteError,
    PromotedNoteTooLongError,
    ScenarioNotFoundError,
    SubjectNoteScopeError,
    SubjectNoteService,
)
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb
from ..utils.pb_error import pb_error_to_http

router = APIRouter(prefix="/api/subject-notes", tags=["subject-notes"])

_UNPROCESSABLE = (SubjectNoteScopeError, PromotedNoteTooLongError)
_NOT_FOUND = (ScenarioNotFoundError, NothingToPromoteError)


def _service() -> SubjectNoteService:
    return SubjectNoteService(pb)


def _author(user: AuthUser) -> str:
    """Display only -- `updated_by` is never used for access."""
    return user.display_name or user.username or user.email


@contextmanager
def _map_domain_errors() -> Iterator[None]:
    """The one place the three endpoints' domain-error -> HTTP mapping lives
    (controller ruling F6, 2026-09-25) -- status codes and bodies per spec §5."""
    try:
        yield
    except _UNPROCESSABLE as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except _NOT_FOUND as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ClientResponseError as exc:
        raise pb_error_to_http(exc) from exc


@router.get("", response_model=SubjectNotesResponse)
async def list_subject_notes(
    session_cm_id: Annotated[int, Query(gt=0, description="The BOARD's session CampMinder id")],
    year: Annotated[int, Query(ge=2000, le=2100)],
    scenario: Annotated[str, Query(max_length=32, pattern=r"^[A-Za-z0-9]*$")] = "",
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SubjectNotesResponse:
    """Every standard note on the board's session family, plus the viewed scenario's plan-only notes."""
    with _map_domain_errors():
        notes = await _service().list_for_board(session_cm_id=session_cm_id, year=year, scenario=scenario)
    return SubjectNotesResponse(notes=notes)


@router.put("", response_model=SubjectNoteWriteResponse)
async def save_subject_note(
    request: SubjectNoteWriteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SubjectNoteWriteResponse:
    """Upsert one note on its unique key. An empty or whitespace-only body deletes it."""
    with _map_domain_errors():
        return await _service().save(request, updated_by=_author(user))


@router.post("/promote", response_model=SubjectNoteWriteResponse)
async def promote_subject_note(
    request: SubjectNotePromoteRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SubjectNoteWriteResponse:
    """ "Keep on all plans": append this scenario's plan-only note to the standard note."""
    with _map_domain_errors():
        return await _service().promote(request, updated_by=_author(user))

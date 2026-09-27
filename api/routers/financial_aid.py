"""Campership (financial aid) router.

Thin: parse input, call the service, map its errors. Sub-project 5 adds intake
reads (financial_aid.view), casework writes including payer shares and the
income override (financial_aid.casework), and session capacity
(financial_aid.rules). Every aid_* collection is superuser-only in PocketBase,
so these routes are the only way in.
"""

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from api.schemas.financial_aid_intake import (
    ApplicationDetailResponse,
    ApplicationListResponse,
    CapacityOut,
    CapacitySet,
    CorrectionCreate,
    CorrectionOut,
    DuplicateMark,
    HeadcountSet,
    HouseholdShareSet,
    PayerSharesSet,
    RequestFlagFilter,
    RequestOut,
    RequestQueueResponse,
    RequestStatus,
    SessionResolve,
)
from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_payer_shares import ShareSpec
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/financial-aid", tags=["financial-aid"])


def _casework() -> FinancialAidCaseworkService:
    # Every write commits through the repository's one write path, sub-project 4a's
    # commit_aid_writes: the record and its aid_change_log row in one batch.
    repository = FinancialAidIntakeRepository(pb)
    return FinancialAidCaseworkService(repository)


def _raise_http(exc: Exception) -> NoReturn:
    if isinstance(exc, CaseworkNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, DuplicateRequestError):
        raise HTTPException(status_code=409, detail={"message": str(exc), "holder_id": exc.holder_id}) from exc
    if isinstance(exc, (CaseworkValidationError, CorrectionError)):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


_ERRORS = (CaseworkNotFoundError, DuplicateRequestError, CaseworkValidationError, CorrectionError)


@router.get("/applications", response_model=ApplicationListResponse)
async def list_aid_applications(
    year: int = Query(ge=2017, le=2100),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_VIEW)),
) -> ApplicationListResponse:
    return await _casework().list_applications(year)


@router.get("/applications/{year}/{household_cm_id}", response_model=ApplicationDetailResponse)
async def get_aid_application(
    year: int = Path(ge=2017, le=2100),
    household_cm_id: int = Path(gt=0),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_VIEW)),
) -> ApplicationDetailResponse:
    try:
        return await _casework().application_detail(year, household_cm_id)
    except _ERRORS as exc:
        _raise_http(exc)


@router.get("/requests", response_model=RequestQueueResponse)
async def list_aid_requests(
    year: int = Query(ge=2017, le=2100),
    status: RequestStatus = Query(),
    flag: RequestFlagFilter | None = Query(default=None),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_VIEW)),
) -> RequestQueueResponse:
    return await _casework().list_requests(year, status, flag)


@router.post("/applications/{year}/{household_cm_id}/corrections", response_model=CorrectionOut, status_code=201)
async def add_aid_correction(
    body: CorrectionCreate,
    year: int = Path(ge=2017, le=2100),
    household_cm_id: int = Path(gt=0),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> CorrectionOut:
    try:
        return await _casework().add_correction(
            year,
            household_cm_id,
            body.field,
            body.new_value,
            body.reason,
            user.email,
            body.request_id,
        )
    except _ERRORS as exc:
        _raise_http(exc)


@router.post("/requests/{request_id}/session", response_model=RequestOut)
async def resolve_aid_request_session(
    body: SessionResolve,
    request_id: str = Path(min_length=1, max_length=15),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> RequestOut:
    try:
        return await _casework().resolve_session(request_id, body.session_cm_id, body.reason, user.email)
    except _ERRORS as exc:
        _raise_http(exc)


@router.post("/requests/{request_id}/duplicate", response_model=RequestOut)
async def mark_aid_request_duplicate(
    body: DuplicateMark,
    request_id: str = Path(min_length=1, max_length=15),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> RequestOut:
    try:
        return await _casework().mark_duplicate(request_id, body.duplicate_of, body.reason, user.email)
    except _ERRORS as exc:
        _raise_http(exc)


@router.put("/requests/{request_id}/headcount", response_model=RequestOut)
async def set_aid_request_headcount(
    body: HeadcountSet,
    request_id: str = Path(min_length=1, max_length=15),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> RequestOut:
    try:
        return await _casework().set_headcount(
            request_id, body.non_infant, body.infant, body.source, body.reason, user.email
        )
    except _ERRORS as exc:
        _raise_http(exc)


@router.put("/requests/{request_id}/payer-shares", response_model=RequestOut)
async def set_aid_request_payer_shares(
    body: PayerSharesSet,
    request_id: str = Path(min_length=1, max_length=15),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> RequestOut:
    shares = [ShareSpec(s.household_cm_id, s.share_pct) for s in body.shares]
    try:
        return await _casework().set_payer_shares(request_id, shares, body.reason, user.email)
    except _ERRORS as exc:
        _raise_http(exc)


@router.put("/requests/{request_id}/payer-shares/{household_cm_id}", response_model=RequestOut)
async def set_aid_request_household_share(
    body: HouseholdShareSet,
    request_id: str = Path(min_length=1, max_length=15),
    household_cm_id: int = Path(gt=0),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> RequestOut:
    """One household's share as a % or, once the request has a priced amount, as dollars
    (stored as a %); the other share of a two-way split gets the remainder."""
    try:
        return await _casework().set_household_share(
            request_id,
            household_cm_id,
            share_pct=body.share_pct,
            amount=body.amount,
            reason=body.reason,
            actor=user.email,
        )
    except _ERRORS as exc:
        _raise_http(exc)


@router.put("/capacity/{year}/{session_cm_id}", response_model=CapacityOut)
async def set_aid_session_capacity(
    body: CapacitySet,
    year: int = Path(ge=2017, le=2100),
    session_cm_id: int = Path(gt=0),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_RULES)),
) -> CapacityOut:
    try:
        return await _casework().set_capacity(year, session_cm_id, body.capacity, body.note, user.email)
    except _ERRORS as exc:
        _raise_http(exc)

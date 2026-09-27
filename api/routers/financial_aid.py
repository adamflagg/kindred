"""Campership ledger router (sub-project 4). Thin: parse, call a service, map
its two errors. Every route is gated on a financial_aid.* permission; the aid_*
collections have null rules, so this router is the only way in. Every write
passes the real signed-in person (user.email); the write service records it
(spec §14.4).

/summary and /net-totals are finance-facing and unsuppressed (per-family
derived), so they need financial_aid.view. Development's financial_aid.summary
reaches none of these routes; its aggregate endpoint (sub-project 8) must be
named apart from /summary."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import StringConstraints

from api.schemas.financial_aid import (
    AidSourceRow,
    AidSourcesResponse,
    AidSourceUpdate,
    AttributionLevel,
    BulkLoadResult,
    DataQualityResponse,
    DispositionBulkLoad,
    DispositionsResponse,
    HouseholdDetailResponse,
    HouseholdLinkCreate,
    HouseholdLinkRow,
    LedgerResponse,
    NetTotalsResponse,
    OverrideBulkLoad,
    ProgramBucket,
    SourceFamily,
    SummaryResponse,
)
from api.services.financial_aid_ledger_service import (
    FinancialAidLedgerService,
    FinancialAidNotFoundError,
    FinancialAidValidationError,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_write_service import FinancialAidWriteService
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/financial-aid", tags=["financial-aid"])
_VIEW = Depends(require_permission(Permission.FINANCIAL_AID_VIEW))
_CASEWORK = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK))
_RULES = Depends(require_permission(Permission.FINANCIAL_AID_RULES))

# A DELETE reason: whitespace-only would otherwise reach commit_aid_writes
# (4a's helper), which raises ValueError on a blank reason -> an unhandled 500.
# Stripping and re-checking min_length here turns that into a clean 422.
_Reason = Annotated[str, Query(...), StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


def _ledger() -> FinancialAidLedgerService:
    return FinancialAidLedgerService(FinancialAidRepository(pb))


def _writes() -> FinancialAidWriteService:
    return FinancialAidWriteService(FinancialAidRepository(pb))


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, FinancialAidNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.get("/ledger", response_model=LedgerResponse)
async def get_ledger(
    year: int = Query(..., ge=2017, le=2100),
    program_family: ProgramBucket | None = None,
    source_family: SourceFamily | None = None,
    level: AttributionLevel | None = None,
    user: AuthUser = _VIEW,
) -> LedgerResponse:
    """Per-household live aid for a season, with source and program attribution."""
    return await _ledger().ledger(year, program_family=program_family, source_family=source_family, level=level)


@router.get("/households/{household_cm_id}", response_model=HouseholdDetailResponse)
async def get_household(
    household_cm_id: int, year: int = Query(..., ge=2017, le=2100), user: AuthUser = _VIEW
) -> HouseholdDetailResponse:
    """The family's posting history (live and reversed) with enrollments."""
    try:
        return await _ledger().household(year, household_cm_id)
    except FinancialAidNotFoundError as exc:
        raise _http(exc) from exc


@router.get("/summary", response_model=SummaryResponse)
async def get_summary(
    year: int = Query(..., ge=2017, le=2100), as_of: date | None = None, user: AuthUser = _VIEW
) -> SummaryResponse:
    """Unsuppressed posted totals by program and source family. Finance-facing, not development."""
    return await _ledger().summary(year, as_of=as_of)


@router.get("/net-totals", response_model=NetTotalsResponse)
async def get_net_totals(
    year: int = Query(..., ge=2017, le=2100), as_of: date | None = None, user: AuthUser = _VIEW
) -> NetTotalsResponse:
    """Net posted aid by posting household, family, source, program and placement (the reconciliation read model)."""
    return await _ledger().net_totals(year, as_of=as_of)


@router.get("/data-quality", response_model=DataQualityResponse)
async def get_data_quality(year: int = Query(..., ge=2017, le=2100), user: AuthUser = _VIEW) -> DataQualityResponse:
    return await _ledger().data_quality(year)


@router.get("/sources", response_model=AidSourcesResponse)
async def list_sources(user: AuthUser = _VIEW) -> AidSourcesResponse:
    return await _ledger().sources()


@router.patch("/sources/{source_id}", response_model=AidSourceRow)
async def classify_source(source_id: str, body: AidSourceUpdate, user: AuthUser = _RULES) -> AidSourceRow:
    try:
        return await _writes().classify_source(source_id, body, user.email)
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc


@router.post("/household-links", response_model=HouseholdLinkRow, status_code=201)
async def create_household_link(body: HouseholdLinkCreate, user: AuthUser = _CASEWORK) -> HouseholdLinkRow:
    try:
        return await _writes().create_link(body, user.email)
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc


@router.delete("/household-links/{link_id}", status_code=204, response_class=Response)
async def delete_household_link(link_id: str, reason: _Reason, user: AuthUser = _CASEWORK) -> Response:
    try:
        await _writes().delete_link(link_id, user.email, reason)
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc
    return Response(status_code=204)


@router.post("/overrides/bulk", response_model=BulkLoadResult)
async def load_overrides(body: OverrideBulkLoad, user: AuthUser = _RULES) -> BulkLoadResult:
    """Bulk-load reviewed placements and reclassifications (the sub-project 7 lookup, source reclassifications, staff placements).

    One atomic operation; a load that would change more rows than one batch holds is refused whole (422)."""
    try:
        return await _writes().load_overrides(body, user.email)
    except FinancialAidValidationError as exc:
        raise _http(exc) from exc


@router.get("/flag-dispositions", response_model=DispositionsResponse)
async def list_flag_dispositions(
    year: int = Query(..., ge=2017, le=2100), user: AuthUser = _VIEW
) -> DispositionsResponse:
    return await _ledger().dispositions(year)


@router.post("/flag-dispositions/bulk", response_model=BulkLoadResult)
async def load_flag_dispositions(body: DispositionBulkLoad, user: AuthUser = _RULES) -> BulkLoadResult:
    """Record finance's decisions on posting flags ("accepted: let stand", "accepted: late grant"). One atomic operation."""
    try:
        return await _writes().load_dispositions(body, user.email)
    except FinancialAidValidationError as exc:
        raise _http(exc) from exc


@router.delete("/flag-dispositions/{disposition_id}", status_code=204, response_class=Response)
async def delete_flag_disposition(disposition_id: str, reason: _Reason, user: AuthUser = _RULES) -> Response:
    """Reopen a flag."""
    try:
        await _writes().delete_disposition(disposition_id, user.email, reason)
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc
    return Response(status_code=204)

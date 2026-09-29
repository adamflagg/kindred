"""Campership (financial aid) router.

Thin: parse input, call the service, map its errors. Sub-project 4 adds the
ledger (aid_sources / aid_postings / aid_household_links / overrides /
dispositions); sub-project 5 adds intake reads (financial_aid.view), casework
writes including payer shares and the income override (financial_aid.casework),
and session capacity (financial_aid.rules). The rules routes (`/rules/...`, the
rules loader) read, validate, create, save and approve a season's rules
document (financial_aid.rules); an approval's note names the approving body
(D39). Every aid_* collection is superuser-only in PocketBase, so these routes
are the only way in. Every ledger write passes the real signed-in person
(user.email); the write service records it (spec sec 14.4).

/summary and /net-totals are finance-facing and unsuppressed (per-family
derived), so they need financial_aid.view. Development's financial_aid.summary
reaches none of these routes; its aggregate endpoint (sub-project 8) must be
named apart from /summary.
"""

from datetime import date
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
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
    SourceGrantorIn,
    SummaryResponse,
)
from api.schemas.financial_aid_grants import (
    GrantorCreate,
    GrantorOut,
    GrantorSave,
    GrantorsResponse,
    GrantsResponse,
    PlaceGrantsIn,
    PlaceGrantsOut,
)
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
from api.schemas.financial_aid_rules import RulesApproveIn, RulesDocumentIn, RulesVersionOut
from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import GrantorKeyTakenError, GrantsService
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_ledger_service import (
    FinancialAidLedgerService,
    FinancialAidNotFoundError,
    FinancialAidValidationError,
)
from api.services.financial_aid_payer_shares import ShareSpec
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_rules_service import (
    AidRulesRepository,
    FinancialAidRulesService,
    NotLatestVersionError,
    RulesNotFoundError,
    RulesVersion,
    VersionExistsError,
)
from api.services.financial_aid_write_service import FinancialAidWriteService
from bunking.auth_middleware import AuthUser
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import AidRules, ValidationReport
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


def _ledger() -> FinancialAidLedgerService:
    return FinancialAidLedgerService(FinancialAidRepository(pb))


def _writes() -> FinancialAidWriteService:
    return FinancialAidWriteService(FinancialAidRepository(pb))


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, FinancialAidNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def _rules() -> FinancialAidRulesService:
    return FinancialAidRulesService(AidRulesRepository(pb))


def _rules_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, RulesNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (VersionExistsError, NotLatestVersionError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def _same_year(year: int, document: AidRules) -> None:
    if document.year != year:
        raise HTTPException(status_code=422, detail=f"The document is for {document.year}, not {year}")


def _rules_out(version: RulesVersion, report: ValidationReport) -> RulesVersionOut:
    return RulesVersionOut(
        year=version.year,
        version=version.version,
        parent_year=version.parent_year,
        parent_version=version.parent_version,
        document=version.document,
        section_status=version.section_status,
        report=report,
    )


def _grants() -> GrantsService:
    return GrantsService(GrantsRepository(pb))


def _grants_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, FinancialAidNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, GrantorKeyTakenError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


_GrantorKeyPath = Annotated[str, Path(min_length=1, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")]

_Year = Annotated[int, Path(ge=2017, le=2100)]
_Version = Annotated[int, Path(ge=1)]


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


@router.put("/sources/{source_id}/grantor", response_model=AidSourceRow)
async def map_source_grantor(source_id: str, body: SourceGrantorIn, user: AuthUser = _RULES) -> AidSourceRow:
    try:
        return await _writes().map_source_grantor(source_id, body, user.email)
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


@router.get("/rules/{year}", response_model=RulesVersionOut)
async def get_aid_rules(
    year: _Year, version: int | None = Query(default=None, ge=1), user: AuthUser = _RULES
) -> RulesVersionOut:
    """One version of the season's rules (the latest by default), with its validation report."""
    service = _rules()
    try:
        loaded = await service.load(year, version)
        return _rules_out(loaded, await service.validate_document(loaded.document))
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


@router.post("/rules/{year}/validate", response_model=ValidationReport)
async def validate_aid_rules(year: _Year, body: RulesDocumentIn, user: AuthUser = _RULES) -> ValidationReport:
    """Check a document against the season's synced sessions without saving it."""
    _same_year(year, body.document)
    return await _rules().validate_document(body.document)


@router.post("/rules/{year}/versions", response_model=RulesVersionOut, status_code=201)
async def create_aid_rules_version(year: _Year, body: RulesDocumentIn, user: AuthUser = _RULES) -> RulesVersionOut:
    """Version 1 of a season with no rules yet, from a whole document (the one-time load);
    409 when the season already has rules."""
    _same_year(year, body.document)
    service = _rules()
    try:
        created = await service.bootstrap(body.document, actor=user.email)
        return _rules_out(created, await service.validate_document(created.document))
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


@router.post("/rules/{year}/start-from-last-year", response_model=RulesVersionOut, status_code=201)
async def start_aid_rules_from_last_year(year: _Year, user: AuthUser = _RULES) -> RulesVersionOut:
    """Version 1 of an empty season, copied from last season's latest (prices and dates cleared)."""
    try:
        created, report = await _rules().start_from_last_year(year, actor=user.email)
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc
    return _rules_out(created, report)


@router.put("/rules/{year}/versions/{version}", response_model=RulesVersionOut)
async def save_aid_rules(
    year: _Year, version: _Version, body: RulesDocumentIn, user: AuthUser = _RULES
) -> RulesVersionOut:
    """Save the whole document over the latest version. Changed approved sections go back to draft;
    a change to a locked section is refused (make a new version)."""
    _same_year(year, body.document)
    try:
        saved, report = await _rules().save(year, version, body.document, actor=user.email)
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc
    return _rules_out(saved, report)


@router.post("/rules/{year}/versions/{version}/approve", response_model=RulesVersionOut)
async def approve_aid_rules_sections(
    year: _Year, version: _Version, body: RulesApproveIn, user: AuthUser = _RULES
) -> RulesVersionOut:
    """Approve sections as one logged operation; the note names the approving body (D39)."""
    try:
        approved, report = await _rules().approve_sections(
            year, version, body.sections, actor=user.email, note=body.note
        )
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc
    return _rules_out(approved, report)


# --- grants (sub-project 6-core) ----------------------------------------------------


@router.get("/grantors", response_model=GrantorsResponse)
async def list_grantors(user: AuthUser = _VIEW) -> GrantorsResponse:
    # D57: everyone with view access sees the directory, contacts included; edits are finance's.
    return await _grants().list_grantors()


@router.post("/grantors", response_model=GrantorOut, status_code=201)
async def create_grantor(body: GrantorCreate, user: AuthUser = _RULES) -> GrantorOut:
    try:
        return await _grants().create_grantor(body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.put("/grantors/{key}", response_model=GrantorOut)
async def save_grantor(key: _GrantorKeyPath, body: GrantorSave, user: AuthUser = _RULES) -> GrantorOut:
    try:
        return await _grants().save_grantor(key, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.get("/grants/{year}", response_model=GrantsResponse)
async def get_grants(year: _Year, user: AuthUser = _VIEW) -> GrantsResponse:
    # D57: family level for everyone with view, contacts included; development gets aggregates
    # from Reports, never this read.
    return await _grants().read(year)


@router.post("/grants/{year}/placements", response_model=PlaceGrantsOut)
async def place_grants(year: _Year, body: PlaceGrantsIn, user: AuthUser = _CASEWORK) -> PlaceGrantsOut:
    try:
        return await _grants().place(year, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc

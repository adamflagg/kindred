"""Campership (financial aid) router.

Thin: parse input, call the service, map its errors. Sub-project 4 adds the
ledger (aid_sources / aid_postings / aid_household_links / overrides /
dispositions); sub-project 5 adds intake reads (financial_aid.view), casework
writes including payer shares and the income override (financial_aid.casework),
and session capacity (financial_aid.rules). The rules routes (`/rules/...`, the
rules loader) read, validate, create, save and approve a season's rules
document (financial_aid.rules); an approval's note names the approving body
(D39). SP9a adds the rules draft read, the section editor's save, a new version, and D76's approved
read for financial_aid.view. Every aid_* collection is superuser-only in PocketBase, so these routes
are the only way in. Every ledger write passes the real signed-in person
(user.email); the write service records it (spec sec 14.4).

/summary and /net-totals are finance-facing and unsuppressed (per-family
derived), so they need financial_aid.view. Development's financial_aid.summary
reaches none of these routes except the decisions Remaining line below; its
aggregate endpoint (sub-project 8) must be named apart from /summary.

Sub-project 10a adds decisions: the season's Requests grid, Rounds & budget and
the Remaining line (view; the Remaining line also summary, D75), each round's
asks and Round 3 amounts and the Posted and Accepted ticks (casework), and
Round 3 approval (rules).
Follow-up 3b adds releasing a check's hold and placing a manual hold
(casework). Sub-project 10b-2 adds each request's cancellation and its cancel reason
(D101, D141; casework).

Sub-project 9b adds the scenario routes (`/scenarios/...`, financial_aid.rules):
freeze the season, the per-person draft and its trail, keep, compare, fit to
budget, the one-step sensitivity, a request set (requests received through a
date), and making a kept option the rules draft.
Sub-project 9c adds what the committee compares: compare's tables by tier and
last season's posted money (RPT-17, RPT-32), and a starting point from last
season's rules (RPT-18).
"""

from datetime import date
from decimal import Decimal
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
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    AskIn,
    AsOfAxis,
    BudgetResponse,
    CancellationIn,
    DecisionWriteOut,
    HoldReleaseIn,
    ManualHoldIn,
    PostedIn,
    RemainingResponse,
    RequestsGridResponse,
    Round3AmountIn,
    Round3ApprovalIn,
    UnpostIn,
)
from api.schemas.financial_aid_grants import (
    CommitmentIn,
    CommitmentOut,
    GrantorCreate,
    GrantorOut,
    GrantorSave,
    GrantorsResponse,
    GrantsResponse,
    PlaceGrantsIn,
    PlaceGrantsOut,
    WithdrawIn,
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
from api.schemas.financial_aid_rules import (
    ApprovedRulesOut,
    ApprovedSectionOut,
    DraftSectionOut,
    NewVersionIn,
    RulesApproveIn,
    RulesDocumentIn,
    RulesDraftOut,
    RulesVersionOut,
    SectionSaveIn,
    field_change_out,
)
from api.schemas.financial_aid_scenarios import (
    CommitteeOut,
    CompareColumnOut,
    CompareOut,
    DocumentIn,
    DraftOut,
    EvaluateIn,
    EvaluateOut,
    FitOut,
    KeepIn,
    LastSeasonOut,
    LeverEffectOut,
    LoadIn,
    MakeRulesDraftIn,
    OptionCode,
    OptionOut,
    PoolResultOut,
    PromotionPreviewOut,
    PromotionSectionOut,
    ReplacementWarningOut,
    RequestSetOut,
    ResultsOut,
    Round2CompareOut,
    SensitivityOut,
    SnapshotOut,
    TierCompareOut,
    TierRowOut,
    TrailPageOut,
    TrailRowOut,
    ViewIn,
    WorkspaceOut,
)
from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_decisions_service import (
    DecisionChangedError,
    DecisionNotFoundError,
    FinancialAidDecisionsService,
)
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import GrantorKeyTakenError, GrantsService
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_ledger_service import (
    FinancialAidLedgerService,
    FinancialAidNotFoundError,
    FinancialAidValidationError,
    money,
)
from api.services.financial_aid_payer_shares import ShareSpec
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_rules_service import (
    AidRulesRepository,
    ApprovedRules,
    FinancialAidRulesService,
    NotLatestVersionError,
    PricingVersionInUseError,
    PromotionPreview,
    ReplacementNotAcknowledgedError,
    RulesDraft,
    RulesNotFoundError,
    RulesVersion,
    VersionExistsError,
)
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, capture_season
from api.services.financial_aid_scenarios_repository import (
    OptionCodeTakenError,
    ScenarioRepository,
    SnapshotMeta,
    SnapshotMissingError,
    TrailRecord,
)
from api.services.financial_aid_scenarios_service import (
    CompareColumn,
    Draft,
    Evaluation,
    FinancialAidScenariosService,
    KeptOption,
    LastSeason,
    RequestSetChoice,
    ScenarioConflictError,
    ScenarioNotFoundError,
    Workspace,
)
from api.services.financial_aid_write_service import FinancialAidWriteService
from bunking.auth_middleware import AuthUser
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import AidRules, SectionName, ValidationReport
from bunking.financial_aid.scenarios import CommitteeView, ScenarioResults
from bunking.rbac.dependencies import require_any_permission, require_permission
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
    if isinstance(
        exc,
        (
            VersionExistsError,
            NotLatestVersionError,
            PricingVersionInUseError,
            ReplacementNotAcknowledgedError,
        ),
    ):
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


def _draft_out(draft: RulesDraft, *, branched_from: int | None = None) -> RulesDraftOut:
    version = draft.version
    return RulesDraftOut(
        year=version.year,
        version=version.version,
        parent_year=version.parent_year,
        parent_version=version.parent_version,
        approved_version=draft.approved_version,
        document=version.document,
        report=draft.report,
        branched_from=branched_from,
        sections=[
            DraftSectionOut(
                section=s.section,
                status=s.status,
                changes=[field_change_out(c) for c in s.changes],
                errors=sum(1 for i in draft.report.errors if i.section == s.section),
                warnings=sum(1 for i in draft.report.warnings if i.section == s.section),
            )
            for s in draft.sections
        ],
    )


def _approved_out(rules: ApprovedRules) -> ApprovedRulesOut:
    return ApprovedRulesOut(
        year=rules.year,
        version=rules.version,
        sections=[
            ApprovedSectionOut(
                section=s.section,
                version=s.version,
                state=s.status.state,
                approved_by=s.status.approved_by,
                approved_at=s.status.approved_at,
                note=s.status.note,
                locked_at=s.status.locked_at,
                content=s.content,
            )
            for s in rules.sections
        ],
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
    a change to a locked section is refused (make a new version). 409 when the version prices the season, or
    is the one intake reads for `programs` and `cost`, and the save would change an approved or locked section
    there, or send one back to draft: use the section editor, which branches a new version."""
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


@router.get("/rules/{year}/draft", response_model=RulesDraftOut)
async def get_aid_rules_draft(year: _Year, user: AuthUser = _RULES) -> RulesDraftOut:
    """The rules draft section by section, each with its status and its changes against the approved rules
    pricing the season (spec §7.5, D39)."""
    try:
        return _draft_out(await _rules().draft_view(year))
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


@router.put("/rules/{year}/sections/{section}", response_model=RulesDraftOut)
async def save_aid_rules_section(
    year: _Year, section: SectionName, body: SectionSaveIn, user: AuthUser = _RULES
) -> RulesDraftOut:
    """One section editor's save. It lands in a new version rather than overwrite the approved rules in use
    (`branched_from` names the version it came from); 409 when the rules draft moved on since the editor opened."""
    service = _rules()
    try:
        saved = await service.save_section(year, body.base_version, section, body.content, actor=user.email)
        return _draft_out(await service.draft_view(year), branched_from=saved.branched_from)
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


@router.post("/rules/{year}/versions/{version}/new-version", response_model=RulesVersionOut, status_code=201)
async def start_aid_rules_version(
    year: _Year, version: _Version, body: NewVersionIn, user: AuthUser = _RULES
) -> RulesVersionOut:
    """A new version copied from `version`, keeping every approval and every lock except those in `unlock`."""
    service = _rules()
    try:
        created = await service.new_version(year, version, actor=user.email, unlock=body.unlock)
        return _rules_out(created, await service.validate_document(created.document))
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


@router.get("/rules/{year}/approved", response_model=ApprovedRulesOut)
async def get_approved_aid_rules(
    year: _Year, version: int | None = Query(default=None, ge=1), user: AuthUser = _VIEW
) -> ApprovedRulesOut:
    """D76: the approved rules, read only, for everyone with view. Without `version`, section by section: the
    pricing sections from the version pricing the season, every other section from the newest version where it is
    approved or locked. With `version` (a receipt's link), that version alone. A draft section has no content."""
    try:
        return _approved_out(await _rules().approved_view(year, version))
    except FinancialAidError as exc:
        raise _rules_http(exc) from exc


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


_CommitmentId = Annotated[str, Path(min_length=15, max_length=15, pattern=r"^[a-z0-9]+$")]


@router.post("/grants/{year}/commitments", response_model=CommitmentOut, status_code=201)
async def create_grant_commitment(year: _Year, body: CommitmentIn, user: AuthUser = _CASEWORK) -> CommitmentOut:
    try:
        return await _grants().create_commitment(year, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.put("/grants/{year}/commitments/{commitment_id}", response_model=CommitmentOut)
async def save_grant_commitment(
    year: _Year, commitment_id: _CommitmentId, body: CommitmentIn, user: AuthUser = _CASEWORK
) -> CommitmentOut:
    try:
        return await _grants().save_commitment(year, commitment_id, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.post("/grants/{year}/commitments/{commitment_id}/withdraw", response_model=CommitmentOut)
async def withdraw_grant_commitment(
    year: _Year, commitment_id: _CommitmentId, body: WithdrawIn, user: AuthUser = _CASEWORK
) -> CommitmentOut:
    try:
        return await _grants().withdraw_commitment(year, commitment_id, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


# --- decisions (sub-project 10a) ---------------------------------------------------


def _decisions() -> FinancialAidDecisionsService:
    return FinancialAidDecisionsService(
        FinancialAidDecisionsRepository(pb), _rules(), GrantsService(GrantsRepository(pb)).register_rows
    )


def _decisions_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, DecisionNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, DecisionChangedError):
        return HTTPException(
            status_code=409, detail={"message": str(exc), "rows": [row.model_dump() for row in exc.rows]}
        )
    return HTTPException(status_code=422, detail=str(exc))


_RequestIdPath = Annotated[str, Path(min_length=15, max_length=15, pattern=r"^[a-z0-9]+$")]
# D48, D75: the Remaining line is for everyone with Camperships, summary-only users included.
_VIEW_OR_SUMMARY = Depends(require_any_permission(Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_SUMMARY))


@router.get("/decisions/{year}/grid", response_model=RequestsGridResponse)
async def get_requests_grid(
    year: _Year, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder", user: AuthUser = _VIEW
) -> RequestsGridResponse:
    """The Requests grid, live or as of the end of a past day, camp time (3c), on the axis asked."""
    return await _decisions().grid(year, as_of=as_of, as_of_axis=as_of_axis)


@router.get("/decisions/{year}/budget", response_model=BudgetResponse)
async def get_rounds_budget(
    year: _Year, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder", user: AuthUser = _VIEW
) -> BudgetResponse:
    """Rounds & budget, live or as of a past day; a past day names what it leaves empty."""
    return await _decisions().budget(year, as_of=as_of, as_of_axis=as_of_axis)


@router.get("/decisions/{year}/remaining", response_model=RemainingResponse)
async def get_remaining_line(
    year: _Year, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder", user: AuthUser = _VIEW_OR_SUMMARY
) -> RemainingResponse:
    """The Remaining line (D48), live or as of a past day."""
    return await _decisions().remaining(year, as_of=as_of, as_of_axis=as_of_axis)


@router.post("/requests/{request_id}/asks", response_model=DecisionWriteOut)
async def key_aid_ask(request_id: _RequestIdPath, body: AskIn, user: AuthUser = _CASEWORK) -> DecisionWriteOut:
    try:
        return await _decisions().key_ask(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/requests/{request_id}/round3-amount", response_model=DecisionWriteOut)
async def key_round3_amount(
    request_id: _RequestIdPath, body: Round3AmountIn, user: AuthUser = _CASEWORK
) -> DecisionWriteOut:
    # D22, D79: finance's own Round 3 amount needs no approval; the registrar's above the limit waits.
    can_approve = user.is_admin or Permission.FINANCIAL_AID_RULES in user.permissions
    try:
        return await _decisions().key_round3_amount(request_id, body, user.email, can_approve=can_approve)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/requests/{request_id}/round3-approval", response_model=DecisionWriteOut)
async def decide_round3_amount(
    request_id: _RequestIdPath, body: Round3ApprovalIn, user: AuthUser = _RULES
) -> DecisionWriteOut:
    try:
        return await _decisions().decide_round3(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/decisions/{year}/posted", response_model=DecisionWriteOut)
async def tick_posted(year: _Year, body: PostedIn, user: AuthUser = _CASEWORK) -> DecisionWriteOut:
    try:
        return await _decisions().tick_posted(year, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/decisions/{year}/unposted", response_model=DecisionWriteOut)
async def undo_posted(year: _Year, body: UnpostIn, user: AuthUser = _CASEWORK) -> DecisionWriteOut:
    try:
        return await _decisions().undo_posted(year, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/decisions/{year}/accepted", response_model=DecisionWriteOut)
async def tick_accepted(year: _Year, body: AcceptedIn, user: AuthUser = _CASEWORK) -> DecisionWriteOut:
    try:
        return await _decisions().tick_accepted(year, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/requests/{request_id}/hold-release", response_model=DecisionWriteOut)
async def set_hold_release(
    request_id: _RequestIdPath, body: HoldReleaseIn, user: AuthUser = _CASEWORK
) -> DecisionWriteOut:
    """Release a check's hold with a note, or put it back (main spec §10.5; follow-up 3b)."""
    try:
        return await _decisions().set_hold_release(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/requests/{request_id}/manual-hold", response_model=DecisionWriteOut)
async def set_manual_hold(
    request_id: _RequestIdPath, body: ManualHoldIn, user: AuthUser = _CASEWORK
) -> DecisionWriteOut:
    """Put the request on hold by hand with a reason, or lift it (app spec §6.3; follow-up 3b)."""
    try:
        return await _decisions().set_manual_hold(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


# --- scenarios (sub-project 9b) ------------------------------------------------------------------------------


def _scenarios() -> FinancialAidScenariosService:
    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(
            FinancialAidDecisionsRepository(pb), GrantsService(GrantsRepository(pb)).register_rows, _rules(), year
        )

    return FinancialAidScenariosService(ScenarioRepository(pb), _rules(), capture, season_read=_decisions().season)


def _scenarios_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, (ScenarioNotFoundError, RulesNotFoundError, SnapshotMissingError)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ReplacementNotAcknowledgedError):
        return HTTPException(status_code=409, detail={"message": str(exc), "sections": exc.sections})
    if isinstance(exc, (ScenarioConflictError, OptionCodeTakenError, NotLatestVersionError, VersionExistsError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def _request_set(view: ViewIn) -> RequestSetChoice | None:
    """The request set a body asks for (D138); None: every frozen request."""
    if view.through_round1_deadline:
        return "round1_deadline"
    return view.received_through


def _cents(value: Decimal | None) -> float | None:
    return money(value) if value is not None else None


def _results_out(r: ScenarioResults) -> ResultsOut:
    return ResultsOut(
        requests=r.requests,
        families=r.families,
        round1=money(r.round1),
        round2=money(r.round2),
        round3=money(r.round3),
        round1_allocated=_cents(r.round1_allocated),
        round1_remaining=_cents(r.round1_remaining),
        remaining=_cents(r.remaining),
        at_minimum=r.at_minimum,
        held=r.held,
        held_asked=money(r.held_asked),
        round1_unmet=money(r.round1_unmet),
        pools=[
            PoolResultOut(
                pool=p.pool,
                label=p.label,
                round1=money(p.round1),
                round2=money(p.round2),
                round3=money(p.round3),
                round1_allocated=_cents(p.round1_allocated),
                round1_remaining=_cents(p.round1_remaining),
                remaining=_cents(p.remaining),
                round1_unmet=money(p.round1_unmet),
            )
            for p in r.pools
        ],
        by_tier=[
            TierRowOut(
                tier=t.tier, requests=t.requests, families=t.families, round1=money(t.round1), asked=_cents(t.asked)
            )
            for t in r.by_tier
        ],
        not_in_tiers=money(r.not_in_tiers),
        request_set=RequestSetOut(**r.request_set.model_dump()) if r.request_set is not None else None,
        round2_allocated=_cents(r.round2_allocated),
        round2_remaining=_cents(r.round2_remaining),
    )


def _pct(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _committee_out(view: CommitteeView) -> CommitteeOut:
    return CommitteeOut(
        budget_total=_cents(view.budget_total),
        round1=money(view.round1),
        round1_pct_of_budget=_pct(view.round1_pct_of_budget),
        round2=money(view.round2),
        round1_by_tier=[
            TierCompareOut(
                table=r.table,
                tier=r.tier,
                requests=r.requests,
                families=r.families,
                asked=money(r.asked),
                average_ask=_cents(r.average_ask),
                fee_pct=_pct(r.fee_pct),
                pct_of_ask=_pct(r.pct_of_ask),
                round1=money(r.round1),
                average_round1=_cents(r.average_round1),
                held=r.held,
                held_asked=money(r.held_asked),
                no_ask=r.no_ask,
            )
            for r in view.round1_by_tier
        ],
        round2_by_tier=[
            Round2CompareOut(
                table=r.table,
                tier=r.tier,
                appeals=r.appeals,
                asked=money(r.asked),
                max_pct=_pct(r.max_pct),
                priced=r.priced,
                priced_asked=money(r.priced_asked),
                round2=money(r.round2),
                average_round2=_cents(r.average_round2),
                pct_of_ask=_pct(r.pct_of_ask),
                held_asked=money(r.held_asked),
            )
            for r in view.round2_by_tier
        ],
        not_in_tiers=money(view.not_in_tiers),
        round2_not_in_tiers=money(view.round2_not_in_tiers),
    )


def _last_season_out(last: LastSeason) -> LastSeasonOut:
    return LastSeasonOut(
        year=last.year,
        loaded=last.loaded,
        label=last.label,
        rules_version=last.rules_version,
        view=_committee_out(last.view) if last.view is not None else None,
    )


def _snapshot_out(meta: SnapshotMeta) -> SnapshotOut:
    return SnapshotOut(
        id=meta.id,
        taken_at=meta.created,
        taken_by=meta.actor,
        requests=meta.requests,
        awaiting_rules=meta.awaiting_rules,
    )


def _option_out(kept: KeptOption) -> OptionOut:
    r = kept.record
    return OptionOut(
        code=r.code,
        starting_point=r.starting_point or None,
        from_code=r.from_code or None,
        origin_version=r.origin_version,
        label=kept.label,
        kept_by=r.actor,
        kept_at=r.created,
        results=_results_out(r.results),
        stale=kept.stale,
    )


def _scenario_draft_out(draft: Draft) -> DraftOut:
    return DraftOut(
        trail_id=draft.trail_id,
        from_code=draft.from_code,
        label=draft.label,
        document=draft.document,
        changes=[field_change_out(c) for c in draft.changes],
        results=_results_out(draft.results) if draft.results is not None else None,
        report=draft.report,
        recorded_at=draft.recorded_at,
    )


def _workspace_out(workspace: Workspace) -> WorkspaceOut:
    return WorkspaceOut(
        year=workspace.year,
        rules_version=workspace.rules_version,
        pricing_version=workspace.pricing_version,
        snapshot=_snapshot_out(workspace.snapshot) if workspace.snapshot is not None else None,
        draft=_scenario_draft_out(workspace.draft) if workspace.draft is not None else None,
        options=[_option_out(kept) for kept in workspace.options],
    )


def _evaluation_out(evaluation: Evaluation) -> EvaluateOut:
    return EvaluateOut(document=evaluation.document, results=_results_out(evaluation.results), report=evaluation.report)


def _column_out(column: CompareColumn) -> CompareColumnOut:
    return CompareColumnOut(
        code=column.code,
        label=column.label,
        document=column.document,
        changes=[field_change_out(c) for c in column.changes],
        results=_results_out(column.results),
        up=column.up,
        down=column.down,
        committee=_committee_out(column.committee) if column.committee is not None else None,
    )


def _trail_row_out(row: TrailRecord) -> TrailRowOut:
    return TrailRowOut(
        id=row.id,
        recorded_at=row.created,
        actor=row.actor,
        from_code=row.from_code,
        change=row.change,
        kept_code=row.kept_code or None,
        round1=_cents(row.results.round1) if row.results is not None else None,
        round1_remaining=_cents(row.results.round1_remaining) if row.results is not None else None,
        at_minimum=row.results.at_minimum if row.results is not None else None,
        stale=row.stale,
    )


def _preview_out(code: str, preview: PromotionPreview) -> PromotionPreviewOut:
    return PromotionPreviewOut(
        code=code,
        origin_version=preview.origin_version,
        base_version=preview.base_version,
        sections=[
            PromotionSectionOut(
                section=s.section,
                changes=[field_change_out(c) for c in s.changes],
                warning=ReplacementWarningOut(
                    kind=s.warning.kind, by=s.warning.by, at=s.warning.at, via=s.warning.via, token=s.warning.token
                )
                if s.warning is not None
                else None,
            )
            for s in preview.sections
        ],
        unchanged=list(preview.unchanged),
    )


_OptionCodePath = Annotated[str, Path(pattern=r"^[A-Z]+[0-9]*$", max_length=12)]


@router.post("/scenarios/{year}/snapshot", response_model=SnapshotOut)
async def freeze_scenario_season(year: _Year, user: AuthUser = _RULES) -> SnapshotOut:
    """Freeze the season's applications for scenarios (spec §7.4); nothing is written when they haven't moved."""
    try:
        return _snapshot_out(await _scenarios().freeze(year, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.post("/scenarios/{year}/starting-points", response_model=WorkspaceOut)
async def start_scenarios_from_rules(year: _Year, user: AuthUser = _RULES) -> WorkspaceOut:
    """A starting point from the rules draft, loaded into your draft."""
    try:
        return _workspace_out(await _scenarios().start_from_rules(year, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.post("/scenarios/{year}/starting-points/last-season", response_model=WorkspaceOut)
async def start_scenarios_from_last_season(year: _Year, user: AuthUser = _RULES) -> WorkspaceOut:
    """RPT-18: a starting point from the rules draft with last season's approved criteria copied in, loaded into
    your draft. 422 when last season has no approved rules, or its criteria don't fit this season's programs."""
    try:
        return _workspace_out(await _scenarios().start_from_last_season(year, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.get("/scenarios/{year}", response_model=WorkspaceOut)
async def get_scenarios(year: _Year, user: AuthUser = _RULES) -> WorkspaceOut:
    """Your draft, every kept option, and the snapshot they run on (D38)."""
    try:
        return _workspace_out(await _scenarios().workspace(year, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.post("/scenarios/{year}/evaluate", response_model=EvaluateOut)
async def evaluate_scenario(year: _Year, body: EvaluateIn, user: AuthUser = _RULES) -> EvaluateOut:
    """A document priced on the frozen season with the sizing settings applied, on a request set when asked (D138);
    nothing is recorded (the live preview while a slider moves)."""
    try:
        evaluation = await _scenarios().evaluate(
            year,
            body.document,
            tier_shift=body.tier_shift,
            band_width_delta=body.band_width_delta,
            request_set=_request_set(body),
        )
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return _evaluation_out(evaluation)


@router.put("/scenarios/{year}/draft", response_model=DraftOut)
async def save_scenario_draft(year: _Year, body: DocumentIn, user: AuthUser = _RULES) -> DraftOut:
    """A released setting: your draft becomes this document, recorded in the trail (D38)."""
    try:
        return _scenario_draft_out(await _scenarios().save_draft(year, body.document, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.post("/scenarios/{year}/draft/load", response_model=DraftOut)
async def load_scenario_draft(year: _Year, body: LoadIn, user: AuthUser = _RULES) -> DraftOut:
    """A kept option or any trail row into your draft; recorded, so nothing is lost."""
    try:
        draft = await _scenarios().load(year, user.email, option=body.option, trail_row=body.trail_row)
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return _scenario_draft_out(draft)


@router.post("/scenarios/{year}/keep", response_model=OptionOut)
async def keep_scenario(year: _Year, body: KeepIn, user: AuthUser = _RULES) -> OptionOut:
    """Keep your draft: a variant under its starting point, or a new starting point (two levels, D38)."""
    try:
        return _option_out(await _scenarios().keep(year, user.email, starting_point=body.starting_point))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.get("/scenarios/{year}/compare", response_model=CompareOut)
async def compare_scenarios(
    year: _Year,
    codes: Annotated[list[OptionCode], Query(max_length=4)] = [],  # noqa: B006
    through_round1_deadline: bool = Query(default=False),
    received_through: date | None = Query(default=None),
    last_season: bool = Query(default=False),
    user: AuthUser = _RULES,
) -> CompareOut:
    """Your draft first, beside up to 4 kept options, all on the current snapshot, on a request set when asked
    (D138: the Round 1 deadline switch or a received-through date, not both). Each column carries what the committee
    compares (RPT-17, RPT-32); `last_season` adds last season's posted money beside them."""
    if through_round1_deadline and received_through is not None:
        raise HTTPException(status_code=422, detail="Choose the Round 1 deadline or a received-through date, not both")
    request_set: RequestSetChoice | None = "round1_deadline" if through_round1_deadline else received_through
    try:
        comparison = await _scenarios().compare(
            year, user.email, codes, request_set=request_set, last_season=last_season
        )
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return CompareOut(
        year=year,
        snapshot=_snapshot_out(comparison.snapshot),
        columns=[_column_out(c) for c in comparison.columns],
        last_season=_last_season_out(comparison.last_season) if comparison.last_season is not None else None,
    )


@router.post("/scenarios/{year}/fit-to-budget", response_model=FitOut)
async def fit_scenario_to_budget(year: _Year, body: ViewIn, user: AuthUser = _RULES) -> FitOut:
    """The tier shift that uses Round 1's allocation: the total row's Round 1 Remaining (main spec §12.3 method 1;
    Decision 11 (a), D119), naming the tightest pool as information; nothing is recorded. 422 on a request set."""
    try:
        fitted = await _scenarios().fit(year, body.document, request_set=_request_set(body))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return FitOut(
        tier_shift=float(fitted.fit.shift),
        outcome=fitted.fit.kind,
        tightest_pool=fitted.tightest_pool,
        tried=fitted.fit.tried,
        document=fitted.evaluation.document,
        results=_results_out(fitted.evaluation.results),
        report=fitted.evaluation.report,
    )


@router.post("/scenarios/{year}/sensitivity", response_model=SensitivityOut)
async def scenario_sensitivity(year: _Year, body: ViewIn, user: AuthUser = _RULES) -> SensitivityOut:
    """What one step of each sizing setting moves Round 1 by (spec §7.4), the dollar-for-dollar switch included
    (D137)."""
    try:
        sensitivity = await _scenarios().sensitivity(year, body.document, request_set=_request_set(body))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return SensitivityOut(
        results=_results_out(sensitivity.results),
        levers=[
            LeverEffectOut(
                lever=e.lever.key,
                label=e.lever.label,
                step=float(e.lever.step) if e.lever.step is not None else None,
                on=e.on,
                round1_change=money(e.round1_change),
            )
            for e in sensitivity.effects
        ],
    )


@router.get("/scenarios/{year}/trail", response_model=TrailPageOut)
async def get_scenario_trail(
    year: _Year,
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=50, ge=1, le=200),
    user: AuthUser = _RULES,
) -> TrailPageOut:
    """Every released setting, everyone's, newest first (D38)."""
    try:
        rows, total = await _scenarios().trail(year, page=page, per_page=per_page)
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return TrailPageOut(page=page, per_page=per_page, total=total, rows=[_trail_row_out(r) for r in rows])


@router.get("/scenarios/{year}/options/{code}/rules-draft", response_model=PromotionPreviewOut)
async def preview_scenario_rules_draft(
    year: _Year, code: _OptionCodePath, user: AuthUser = _RULES
) -> PromotionPreviewOut:
    """ "Make B2 the rules draft": each section it changes, old -> new, and whose edit it would replace (D39)."""
    try:
        return _preview_out(code, await _scenarios().rules_draft_preview(year, code))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.post("/scenarios/{year}/options/{code}/rules-draft", response_model=RulesDraftOut)
async def make_scenario_rules_draft(
    year: _Year, code: _OptionCodePath, body: MakeRulesDraftIn, user: AuthUser = _RULES
) -> RulesDraftOut:
    """Copy the option's changed sections into the rules draft; each then goes through approval (D39). 409 when the
    rules draft moved on, or a section whose edit it replaces was not confirmed with its preview token."""
    try:
        draft, branched_from = await _scenarios().make_rules_draft(
            year, code, base_version=body.base_version, acknowledged=body.acknowledged, actor=user.email
        )
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return _draft_out(draft, branched_from=branched_from)


@router.post("/requests/{request_id}/cancellation", response_model=DecisionWriteOut)
async def set_request_cancellation(
    request_id: _RequestIdPath, body: CancellationIn, user: AuthUser = _CASEWORK
) -> DecisionWriteOut:
    """D101, D141: cancel with a reason from the fixed list, give the reason for a CampMinder
    cancellation, or reopen a Kindred cancellation (sub-project 10b-2)."""
    try:
        return await _decisions().set_cancellation(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc

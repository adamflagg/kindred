"""Campership (financial aid) router.

Thin: parse input, call the service, map its errors. Sub-project 4 adds the
ledger (aid_sources / aid_postings / aid_household_links / overrides /
dispositions); sub-project 5 adds intake reads (financial_aid.view), casework
writes including payer shares and the income override (financial_aid.casework).
The rules routes (`/rules/...`, the rules loader) read, validate, create, save
and approve a season's rules document (financial_aid.rules); an approval's note
names the approving body (D39). SP9a adds the rules draft read, the section editor's save, a new version, and D76's approved
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
The Reports back end adds finance's reports (financial_aid.view): Statistics,
Programs and the committee's year-over-year tables (`/reports/{year}/...`), and
finance's typed "as reported" history (`/reports/reported-history`,
financial_aid.rules); and development's report (`/reports/{year}/development`,
financial_aid.view or .summary: aggregates only, D65).
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Final, Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import StringConstraints

from api.schemas.financial_aid import (
    AidSourceRow,
    AidSourcesResponse,
    AidSourceUpdate,
    BulkLoadResult,
    DataQualityResponse,
    HouseholdDetailResponse,
    HouseholdLinkCreate,
    HouseholdLinkRow,
    NetTotalsResponse,
    OverrideBulkLoad,
    ProgramFamily,
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
    CostOverrideIn,
    DecisionWriteOut,
    EditorPreviewOut,
    HoldReleaseIn,
    ManualHoldIn,
    PostedIn,
    PreviewIn,
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
    GrantorRetireIn,
    GrantorSave,
    GrantorsResponse,
    GrantsResponse,
    PlaceGrantsIn,
    PlaceGrantsOut,
    WithdrawIn,
)
from api.schemas.financial_aid_history import HistoryKind, HistoryOperationDetailOut, HistoryPageOut
from api.schemas.financial_aid_household_page import HouseholdPageResponse
from api.schemas.financial_aid_intake import (
    ApplicationDetailResponse,
    ApplicationListResponse,
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
    UseFormIn,
    UseFormOut,
)
from api.schemas.financial_aid_march_file import MarchFileOut
from api.schemas.financial_aid_money_ledger import LedgerLevelOut, LedgerTotalOut, MoneyLedgerLinesOut, MoneyLedgerOut
from api.schemas.financial_aid_reports import (
    CommitteeResponse,
    DevelopmentResponse,
    FundingSourceIn,
    FundingSourceOut,
    FundingSourceRowOut,
    FundingSourcesResponse,
    ProgramsResponse,
    ReportColumnsIn,
    ReportColumnsResponse,
    ReportedHistoryResponse,
    ReportedLoadIn,
    ReportedLoadOut,
    ReportRequestIdsOut,
    StatisticsBasis,
    StatisticsResponse,
    ZipResponse,
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
    PoolProjectionOut,
    PoolResultOut,
    ProjectionOut,
    PromotionPreviewOut,
    PromotionSectionOut,
    RenameIn,
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
from api.schemas.financial_aid_surfaces import (
    DefinitionNoteOut,
    DefinitionsResponse,
    HouseholdSearchResponse,
    JumpIndexResponse,
    TodayResponse,
)
from api.schemas.financial_aid_to_place import (
    LeaveLineIn,
    PlaceLineIn,
    PlaceLinesIn,
    PlaceOut,
    PlacePreviewIn,
    PlacePreviewOut,
    ReclassifyLineIn,
    ToPlaceResponse,
    ToPlaceWriteOut,
)
from api.services.financial_aid_arrival_curves_repository import ArrivalCurveRepository
from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_change_log_reads import EntityLogReads, HistoryLogReads
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    DecisionChangedError,
    DecisionNotFoundError,
    FinancialAidDecisionsService,
    PricingRules,
    Season,
)
from api.services.financial_aid_development_repository import DevelopmentRepository
from api.services.financial_aid_development_service import (
    FinancialAidDevelopmentService,
    FunderNotFoundError,
    FundingSourceNotFoundError,
)
from api.services.financial_aid_grant_offsets import GrantsRegisterService
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import (
    GrantorInUseError,
    GrantorKeyTakenError,
    GrantorStateError,
    GrantsService,
)
from api.services.financial_aid_household_page import HouseholdNotFoundError, HouseholdPageService
from api.services.financial_aid_household_search import HouseholdSearchRepository, HouseholdSearchService
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_jump_index import JumpIndexRepository, JumpIndexService
from api.services.financial_aid_ledger_service import (
    FinancialAidLedgerService,
    FinancialAidNotFoundError,
    FinancialAidValidationError,
    money,
)
from api.services.financial_aid_march_file import MarchFileService
from api.services.financial_aid_money_ledger import LedgerFilters
from api.services.financial_aid_money_ledger_service import MoneyLedgerService
from api.services.financial_aid_payer_shares import ShareSpec
from api.services.financial_aid_reconciliation import split_placed
from api.services.financial_aid_reports_repository import ReportedFigureTakenError, ReportsRepository
from api.services.financial_aid_reports_service import (
    FinancialAidReportsService,
    OutcomeRowKind,
    ReportedFigureNotFoundError,
    StatisticsPart,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_request_overrides import DEFAULT_REASON_CODES
from api.services.financial_aid_rules_effect_pricing import SeasonApprovalEffects
from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
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
    SectionChangedError,
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
    ScenarioSectionLockedError,
    Workspace,
    received_moments,
)
from api.services.financial_aid_season_history import HistoryFilter, HistoryNotFoundError, SeasonHistoryService
from api.services.financial_aid_to_place_service import ToPlaceService
from api.services.financial_aid_today import TodayService
from api.services.financial_aid_write_service import FinancialAidWriteService
from bunking.auth_middleware import AuthUser
from bunking.branding import get_branding, get_camp_name
from bunking.financial_aid.arrival import Projection
from bunking.financial_aid.change_log import AidWriteConflictError
from bunking.financial_aid.definitions import BY_KEY, SURFACES, render
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.history import ReportedFigure
from bunking.financial_aid.reports.programs import ProgramsCount, ProgramsPart
from bunking.financial_aid.reports.statistics import OutcomeKind, RoundChip, StatisticsCount
from bunking.financial_aid.rules import AidRules, SectionName, ValidationReport
from bunking.financial_aid.scenarios import (
    CommitteeView,
    PoolResult,
    ScenarioResults,
    all_rows_totals,
    appeal_totals,
    round2_by_tier_totals,
)
from bunking.rbac.dependencies import require_any_permission, require_permission
from bunking.rbac.permissions import Permission

from ..dependencies import pb

router = APIRouter(prefix="/api/financial-aid", tags=["financial-aid"])

_VIEW = Depends(require_permission(Permission.FINANCIAL_AID_VIEW))
_CASEWORK = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK))
_RULES = Depends(require_permission(Permission.FINANCIAL_AID_RULES))
# Owner ruling 2026-10-01: the grantor directory's writes (create, save, retire, unretire, mapping a description to
# a grantor) are their own permission, held by development and finance; not rules.
_GRANTORS = Depends(require_permission(Permission.FINANCIAL_AID_GRANTORS))
# Owner ruling 2026-10-01: the grantor list and the source list are readable with view OR grantors, so the
# development role (grantors, no view) sees what it edits. No other read widens.
_VIEW_OR_GRANTORS = Depends(require_any_permission(Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_GRANTORS))

# A DELETE reason: whitespace-only would otherwise reach commit_aid_writes
# (4a's helper), which raises ValueError on a blank reason -> an unhandled 500.
# Stripping and re-checking min_length here turns that into a clean 422.
_Reason = Annotated[str, Query(...), StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


async def _override_reasons(year: int) -> tuple[str, ...]:
    """The season's reason codes for cost overrides and headcounts (Decision 6): the approved pricing rules', else the
    rules' defaults."""
    approved = await _rules().latest_approved(year, PRICING_SECTIONS)
    return tuple(approved.document.cost.override_reasons) if approved is not None else DEFAULT_REASON_CODES


def _casework() -> FinancialAidCaseworkService:
    # Every write commits through the repository's one write path, sub-project 4a's
    # commit_aid_writes: the record and its aid_change_log row in one batch.
    repository = FinancialAidDecisionsRepository(pb)
    return FinancialAidCaseworkService(repository, reason_codes=_override_reasons)


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
    if isinstance(exc, SectionChangedError):  # structured, so the editor can mark the stale sections
        return HTTPException(status_code=409, detail={"message": str(exc), "sections": exc.sections})
    if isinstance(exc, RulesNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(
        exc,
        (
            VersionExistsError,
            NotLatestVersionError,
            PricingVersionInUseError,
            ReplacementNotAcknowledgedError,
            AidWriteConflictError,
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
        budget_total_locked=draft.budget_total_locked,
        sections=[
            DraftSectionOut(
                section=s.section,
                status=s.status,
                changes=[field_change_out(c) for c in s.changes],
                errors=sum(1 for i in draft.report.errors if i.section == s.section),
                warnings=sum(1 for i in draft.report.warnings if i.section == s.section),
                fingerprint=s.fingerprint,
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


def _grants_register() -> GrantsRegisterService:
    """Grants' read with each share's round (slice 3 ask 10): the season priced once, on the register it shows."""
    return GrantsRegisterService(_grants(), FinancialAidDecisionsRepository(pb), _rules())


def _grants_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, FinancialAidNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, GrantorInUseError):
        detail = {"message": str(exc), "descriptions": exc.descriptions, "grants": exc.grants}
        return HTTPException(status_code=409, detail=detail)
    if isinstance(exc, (GrantorKeyTakenError, GrantorStateError)):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, AidWriteConflictError):  # G6: the write lost a race; nothing was written (slice 3 PR-B)
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


@router.post("/applications/{year}/{household_cm_id}/use-form", response_model=UseFormOut, status_code=201)
async def use_aid_form(
    body: UseFormIn,
    year: int = Path(ge=2017, le=2100),
    household_cm_id: int = Path(gt=0),
    user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_CASEWORK)),
) -> UseFormOut:
    """Use X's Form: one sibling's form answers every question the household's forms disagree on, as one operation of
    ordinary corrections (household-v3 section 3)."""
    try:
        return await _casework().use_form(year, household_cm_id, body.person_cm_id, body.reason, user.email)
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
            request_id, body.non_infant, body.infant, body.source, body.reason, user.email, reason_code=body.reason_code
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
    """One household's share as a %; the other share of a two-way split gets the remainder."""
    try:
        return await _casework().set_household_share(
            request_id,
            household_cm_id,
            share_pct=body.share_pct,
            reason=body.reason,
            actor=user.email,
        )
    except _ERRORS as exc:
        _raise_http(exc)


def _history() -> SeasonHistoryService:
    return SeasonHistoryService(HistoryLogReads(pb))


_OperationId = Annotated[str, Path(pattern=r"^[a-z0-9]{15}$")]


@router.get("/history/{year}", response_model=HistoryPageOut)
async def get_season_history(
    year: _Year,
    kind: Annotated[list[HistoryKind] | None, Query()] = None,
    actor: Annotated[str | None, Query(max_length=320)] = None,
    since: date | None = None,
    until: date | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
    include_intake: bool = False,
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=50, ge=1, le=200),
    user: AuthUser = _VIEW,
) -> HistoryPageOut:
    """Season › History (D49, §7.6): one line per operation, newest first. Rules operations only with
    financial_aid.rules; intake runs only when asked. `until` shows the log through that camp day, exactly."""
    f = HistoryFilter(
        kinds=frozenset(kind or ()),
        actor=actor,
        since=since,
        until=until,
        text=q,
        include_intake=include_intake,
        rules=_holds(user, Permission.FINANCIAL_AID_RULES),
    )
    return await _history().page(year, f, page=page, per_page=per_page)


@router.get("/history/{year}/operations/{operation_id}", response_model=HistoryOperationDetailOut)
async def get_season_history_operation(
    year: _Year, operation_id: _OperationId, user: AuthUser = _VIEW
) -> HistoryOperationDetailOut:
    """One operation's rows and their field-level diffs. 404 when it doesn't exist or the reader may not see it."""
    try:
        return await _history().operation(year, operation_id, rules=_holds(user, Permission.FINANCIAL_AID_RULES))
    except HistoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    """Unsuppressed posted totals by program and source family. Finance-facing, not development. A live read from the
    first ticked season reads Kindred's placements for its levels (D151: a split line is not household level)."""
    placed: dict[int, Decimal] | None = None
    if as_of is None and year >= FIRST_TICKED_SEASON:
        season = await _decisions().season(year)
        placed = split_placed(season.ledger, season.splits, season.camp_lines)
    return await _ledger().summary(year, as_of=as_of, split_placed=placed)


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
async def list_sources(
    year: int | None = Query(None, ge=2017, le=2100), user: AuthUser = _VIEW_OR_GRANTORS
) -> AidSourcesResponse:
    """Money › Sources (§8.1). `year` adds each description's live lines this season and their net."""
    return await _ledger().sources(year)


@router.patch("/sources/{source_id}", response_model=AidSourceRow)
async def classify_source(source_id: str, body: AidSourceUpdate, user: AuthUser = _RULES) -> AidSourceRow:
    try:
        return await _writes().classify_source(source_id, body, user.email)
    except AidWriteConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc


@router.put("/sources/{source_id}/grantor", response_model=AidSourceRow)
async def map_source_grantor(source_id: str, body: SourceGrantorIn, user: AuthUser = _GRANTORS) -> AidSourceRow:
    try:
        return await _writes().map_source_grantor(source_id, body, user.email)
    except AidWriteConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (FinancialAidNotFoundError, FinancialAidValidationError) as exc:
        raise _http(exc) from exc


@router.post("/household-links", response_model=HouseholdLinkRow, status_code=201)
async def create_household_link(body: HouseholdLinkCreate, user: AuthUser = _CASEWORK) -> HouseholdLinkRow:
    try:
        return await _writes().create_link(body, user.email)
    except AidWriteConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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


@router.post("/rules/{year}/versions/{version}/approve", response_model=RulesVersionOut)
async def approve_aid_rules_sections(
    year: _Year, version: _Version, body: RulesApproveIn, user: AuthUser = _RULES
) -> RulesVersionOut:
    """Approve sections as one logged operation; the note names the approving body (D39)."""
    try:
        approved, report = await _rules_approving().approve_sections(
            year, version, body.sections, actor=user.email, note=body.note, fingerprints=body.fingerprints
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
        saved = await service.save_section(
            year,
            body.base_version,
            section,
            body.content,
            actor=user.email,
            expected_fingerprint=body.expected_fingerprint,
        )
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
async def list_grantors(
    include_retired: bool = Query(False),
    year: int | None = Query(None, ge=2017, le=2100),
    user: AuthUser = _VIEW_OR_GRANTORS,
) -> GrantorsResponse:
    # D57: view or grantors sees the directory, contacts included; edits are financial_aid.grantors.
    # A retired grantor is left out (pickers never offer one) unless include_retired. `year` adds each grantor's
    # live grant lines that season (Grants › Grantors' "grants / $ this season").
    if year is None:
        return await _grants().list_grantors(include_retired=include_retired)
    return await _grants().list_grantors(include_retired=include_retired, year=year)


@router.post("/grantors", response_model=GrantorOut, status_code=201)
async def create_grantor(body: GrantorCreate, user: AuthUser = _GRANTORS) -> GrantorOut:
    try:
        return await _grants().create_grantor(body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.put("/grantors/{key}", response_model=GrantorOut)
async def save_grantor(key: _GrantorKeyPath, body: GrantorSave, user: AuthUser = _GRANTORS) -> GrantorOut:
    try:
        return await _grants().save_grantor(key, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.post("/grantors/{key}/retire", response_model=GrantorOut)
async def retire_grantor(key: _GrantorKeyPath, body: GrantorRetireIn, user: AuthUser = _GRANTORS) -> GrantorOut:
    """409 while a description maps to it or an open grant names it (the detail counts each), or when it is
    already retired; nothing is written or logged then."""
    try:
        return await _grants().retire_grantor(key, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.post("/grantors/{key}/unretire", response_model=GrantorOut)
async def unretire_grantor(key: _GrantorKeyPath, body: GrantorRetireIn, user: AuthUser = _GRANTORS) -> GrantorOut:
    """409 when it isn't retired."""
    try:
        return await _grants().unretire_grantor(key, body, user.email)
    except FinancialAidError as exc:
        raise _grants_http(exc) from exc


@router.get("/grants/{year}", response_model=GrantsResponse)
async def get_grants(year: _Year, offsets: bool = Query(True), user: AuthUser = _VIEW) -> GrantsResponse:
    # D57: family level for everyone with view, contacts included; development gets aggregates
    # from Reports, never this read.
    # Slice 3 ask 10: each share names the round it offsets, so the read prices the season (one register load).
    # offsets=false is for a caller that wants only the stored fields (a commitment edit's fresh read, staleTime 0):
    # it keeps the plain read and skips the pricing.
    if not offsets:
        return await _grants().read(year)
    return await _grants_register().read(year)


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


def _rules_approving() -> FinancialAidRulesService:
    """The rules service for the approve route: its approvals record their effect on the season's pricing (H3),
    measured on the version before and after with a pricing that writes nothing (no grant placement log)."""
    register = GrantsService(GrantsRepository(pb)).register_rows

    async def season_on(pricing: PricingRules, year: int) -> Season:
        service = FinancialAidDecisionsService(
            FinancialAidDecisionsRepository(pb), pricing, register, log_placements=False
        )
        return await service.season(year)

    return FinancialAidRulesService(AidRulesRepository(pb), effects=SeasonApprovalEffects(_rules(), season_on))


def _decisions_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, DecisionNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, DecisionChangedError):
        return HTTPException(
            status_code=409, detail={"message": str(exc), "rows": [row.model_dump() for row in exc.rows]}
        )
    if isinstance(exc, AidWriteConflictError):
        return HTTPException(status_code=409, detail=str(exc))
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


def _march_file() -> MarchFileService:
    return MarchFileService(_decisions(), FinancialAidDecisionsRepository(pb))


@router.get("/decisions/{year}/march-file", response_model=MarchFileOut)
async def get_march_file(year: _Year, user: AuthUser = _CASEWORK) -> MarchFileOut:
    """The March bulk file (§8.3; D73; S3-7): one row per payer share of each Round 1 offer still to make, at that
    share's part of Round 1's decided amount, for CampMinder's staff. Live only; changes nothing."""
    try:
        return await _march_file().read(year)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


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
    can_approve = _holds(user, Permission.FINANCIAL_AID_RULES)
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


@router.post("/requests/{request_id}/cost-override", response_model=DecisionWriteOut)
async def set_cost_override(
    request_id: _RequestIdPath, body: CostOverrideIn, user: AuthUser = _CASEWORK
) -> DecisionWriteOut:
    """A cost override with its reason code, or clearing it (D22; app spec §2: casework)."""
    try:
        return await _decisions().set_cost_override(request_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


# --- scenarios (sub-project 9b) ------------------------------------------------------------------------------


def _scenarios() -> FinancialAidScenariosService:
    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(
            FinancialAidDecisionsRepository(pb), GrantsService(GrantsRepository(pb)).register_rows, _rules(), year
        )

    async def received(year: int) -> list[datetime]:
        return await received_moments(FinancialAidDecisionsRepository(pb), year)

    return FinancialAidScenariosService(
        ScenarioRepository(pb),
        _rules(),
        capture,
        season_read=_decisions().season,
        curves=ArrivalCurveRepository(pb).curve,
        received=received,
    )


def _scenarios_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, ScenarioSectionLockedError):
        return HTTPException(status_code=409, detail={"message": str(exc), "sections": exc.sections})
    if isinstance(exc, (ScenarioNotFoundError, RulesNotFoundError, SnapshotMissingError)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ReplacementNotAcknowledgedError):
        return HTTPException(status_code=409, detail={"message": str(exc), "sections": exc.sections})
    if isinstance(
        exc,
        (ScenarioConflictError, OptionCodeTakenError, NotLatestVersionError, VersionExistsError, AidWriteConflictError),
    ):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def _request_set(view: ViewIn) -> RequestSetChoice | None:
    """The request set a body asks for (D138); None: every frozen request."""
    if view.through_round1_deadline:
        return "round1_deadline"
    return view.received_through


def _cents(value: Decimal | None) -> float | None:
    return money(value) if value is not None else None


def _pool_out(p: PoolResult) -> PoolResultOut:
    return PoolResultOut(
        pool=p.pool,
        label=p.label,
        round1=money(p.round1),
        round2=money(p.round2),
        round3=money(p.round3),
        round1_allocated=_cents(p.round1_allocated),
        round1_remaining=_cents(p.round1_remaining),
        remaining=_cents(p.remaining),
        round1_unmet=money(p.round1_unmet),
        allocated=_cents(p.round1_allocated),
    )


def _projection_out(projection: Projection | None) -> ProjectionOut | None:
    if projection is None:
        return None
    return ProjectionOut(
        share=round(float(projection.share), 3),
        through=projection.through,
        basis_year=projection.basis_year,
        aligned_on=projection.aligned_on,
        requests=projection.requests,
        round1=money(projection.round1),
        round1_and_2=money(projection.round1_and_2),
        remaining=_cents(projection.remaining),
        pools=[PoolProjectionOut(pool=p.pool, remaining=_cents(p.remaining)) for p in projection.pools],
    )


def _results_out(r: ScenarioResults, projection: Projection | None = None) -> ResultsOut:
    round2s = round2_by_tier_totals(r)
    appeals, appeals_asked = appeal_totals(r)
    return ResultsOut(
        projection=_projection_out(projection),
        requests=r.requests,
        families=r.families,
        round1=money(r.round1),
        round2=money(r.round2),
        round3=money(r.round3),
        round1_allocated=_cents(r.round1_allocated),
        allocated=_cents(r.round1_allocated),
        round1_remaining=_cents(r.round1_remaining),
        remaining=_cents(r.remaining),
        at_minimum=r.at_minimum,
        held=r.held,
        held_asked=money(r.held_asked),
        round1_unmet=money(r.round1_unmet),
        pools=[_pool_out(p) for p in r.pools],
        by_tier=[
            TierRowOut(
                tier=t.tier,
                requests=t.requests,
                families=t.families,
                round1=money(t.round1),
                asked=_cents(t.asked),
                round2=money(round2s.get(t.tier, ZERO)),
            )
            for t in r.by_tier
        ],
        not_in_tiers=money(r.not_in_tiers),
        request_set=RequestSetOut(**r.request_set.model_dump()) if r.request_set is not None else None,
        appeals=appeals,
        appeals_asked=money(appeals_asked),
    )


def _pct(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _committee_out(view: CommitteeView) -> CommitteeOut:
    requests, average = all_rows_totals(view)
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
        requests=requests,
        average_round1=_cents(average),
    )


def _last_season_out(last: LastSeason) -> LastSeasonOut:
    return LastSeasonOut(
        year=last.year,
        loaded=last.loaded,
        label=last.label,
        rules_version=last.rules_version,
        view=_committee_out(last.view) if last.view is not None else None,
        round3=money(last.round3),
        pools=[_pool_out(p) for p in last.pools],
        remaining=_cents(last.remaining),
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
        name=kept.name,
        promotable=kept.promotable,
        blocked=kept.blocked,
    )


def _scenario_draft_out(draft: Draft) -> DraftOut:
    return DraftOut(
        trail_id=draft.trail_id,
        from_code=draft.from_code,
        label=draft.label,
        document=draft.document,
        changes=[field_change_out(c) for c in draft.changes],
        results=_results_out(draft.results, draft.projection) if draft.results is not None else None,
        report=draft.report,
        recorded_at=draft.recorded_at,
        source_document=draft.source_document,
        same_as=draft.same_as,
        differs_in=list(draft.differs_in),
    )


def _workspace_out(workspace: Workspace) -> WorkspaceOut:
    return WorkspaceOut(
        year=workspace.year,
        rules_version=workspace.rules_version,
        pricing_version=workspace.pricing_version,
        snapshot=_snapshot_out(workspace.snapshot) if workspace.snapshot is not None else None,
        draft=_scenario_draft_out(workspace.draft) if workspace.draft is not None else None,
        options=[_option_out(kept) for kept in workspace.options],
        rules_draft_version=workspace.rules_draft_version,
        locked_sections=list(workspace.locked_sections),
        locked_by_round=workspace.locked_by_round,
        last_rules_version=workspace.last_rules_version,
    )


def _evaluation_out(evaluation: Evaluation) -> EvaluateOut:
    return EvaluateOut(
        document=evaluation.document,
        results=_results_out(evaluation.results, evaluation.projection),
        report=evaluation.report,
    )


def _column_out(column: CompareColumn) -> CompareColumnOut:
    return CompareColumnOut(
        code=column.code,
        label=column.label,
        document=column.document,
        changes=[field_change_out(c) for c in column.changes],
        results=_results_out(column.results, column.projection),
        up=column.up,
        down=column.down,
        committee=_committee_out(column.committee) if column.committee is not None else None,
        version=column.version,
        approved_at=column.approved_at,
        via=column.via,
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


def _preview_out(code: str, preview: PromotionPreview, *, fixed_kept: int = 0) -> PromotionPreviewOut:
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
        fixed_kept=fixed_kept,
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
    """A kept option, any trail row or a built-in start into your draft; recorded, so nothing is lost."""
    try:
        draft = await _scenarios().load(
            year, user.email, option=body.option, trail_row=body.trail_row, start=body.start
        )
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return _scenario_draft_out(draft)


@router.post("/scenarios/{year}/keep", response_model=OptionOut)
async def keep_scenario(year: _Year, body: KeepIn, user: AuthUser = _RULES) -> OptionOut:
    """Keep your draft as the next lettered option (Scenarios addendum §S11.1), named or, when blank, by its label."""
    try:
        return _option_out(await _scenarios().keep(year, user.email, name=body.name))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.patch("/scenarios/{year}/options/{code}", response_model=OptionOut)
async def rename_scenario_option(
    year: _Year, code: _OptionCodePath, body: RenameIn, user: AuthUser = _RULES
) -> OptionOut:
    """Rename a kept option (Scenarios addendum §S11.1): one operation; everyone with `rules` sees it. 404 for an
    unknown code; 422 for a blank name."""
    try:
        return _option_out(await _scenarios().rename(year, code, body.name, user.email))
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc


@router.get("/scenarios/{year}/compare", response_model=CompareOut)
async def compare_scenarios(
    year: _Year,
    codes: Annotated[list[OptionCode], Query(max_length=4)] = [],  # noqa: B006
    through_round1_deadline: bool = Query(default=False),
    received_through: date | None = Query(default=None),
    last_season: bool = Query(default=False),
    rules: bool = Query(default=False),
    last_rules: bool = Query(default=False),
    draft: bool = Query(default=True),
    user: AuthUser = _RULES,
) -> CompareOut:
    """The rules in effect, last season's rules, your draft (each when asked) and up to 4 kept options, in §S5 H's
    fixed order, all on the current snapshot and each counted against the rules in effect, on a request set when
    asked (D138: the Round 1 deadline switch or a received-through date, not both). Each column carries what the committee
    compares (RPT-17, RPT-32); `last_season` adds last season's posted money beside them."""
    if through_round1_deadline and received_through is not None:
        raise HTTPException(status_code=422, detail="Choose the Round 1 deadline or a received-through date, not both")
    request_set: RequestSetChoice | None = "round1_deadline" if through_round1_deadline else received_through
    try:
        comparison = await _scenarios().compare(
            year,
            user.email,
            codes,
            request_set=request_set,
            last_season=last_season,
            rules=rules,
            last_rules=last_rules,
            draft=draft,
        )
    except FinancialAidError as exc:
        raise _scenarios_http(exc) from exc
    return CompareOut(
        year=year,
        snapshot=_snapshot_out(comparison.snapshot),
        columns=[_column_out(c) for c in comparison.columns],
        last_season=_last_season_out(comparison.last_season) if comparison.last_season is not None else None,
        last_rules_refused=comparison.last_rules_refused,
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
        promotion = await _scenarios().rules_draft_preview(year, code)
        return _preview_out(code, promotion.preview, fixed_kept=promotion.fixed_kept)
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


# --- slice 1's reads (clean spec §12.2) -------------------------------------------------------------


def camp_label() -> str:
    """The camp's name in staff copy: branding's short name, else its full name."""
    short = str(get_branding().get("camp_name_short") or "").strip()
    return short or get_camp_name()


@router.get("/definitions", response_model=DefinitionsResponse)
async def get_definitions(
    surface: Annotated[str, Query(min_length=1, max_length=64)], user: AuthUser = _VIEW_OR_SUMMARY
) -> DefinitionsResponse:
    """A surface's numbered definition notes (§4.8, D20): §5's signed meanings, shared with Reports ›
    Development. An unknown surface is 404."""
    keys = SURFACES.get(surface)
    if keys is None:
        raise HTTPException(status_code=404, detail=f"no definitions for surface {surface!r}")
    camp = camp_label()
    return DefinitionsResponse(
        surface=surface,
        notes=[
            DefinitionNoteOut(key=key, n=n, text=render(BY_KEY[key], camp=camp).text)
            for n, key in enumerate(keys, start=1)
        ],
    )


@router.get("/jump-index/{year}", response_model=JumpIndexResponse)
async def get_jump_index(year: _Year, user: AuthUser = _VIEW) -> JumpIndexResponse:
    """The jump box's index (§3.5, D13): every household with aid activity this season, read once."""
    return await JumpIndexService(JumpIndexRepository(pb)).read(year)


@router.get("/household-search/{year}", response_model=HouseholdSearchResponse)
async def search_households(
    year: _Year,
    q: Annotated[str, Query(min_length=2, max_length=100)],
    user: AuthUser = _VIEW,
) -> HouseholdSearchResponse:
    """The Add-a-link picker's search (owner F3 #27): a household by name or CampMinder id (a household's or a
    person's), with the family keys it is linked under. financial_aid.view, as the household page's links."""
    return await HouseholdSearchService(HouseholdSearchRepository(pb)).search(year, q)


def _holds(user: AuthUser, permission: str) -> bool:
    return user.is_admin or permission in user.permissions


@router.get("/today/{year}", response_model=TodayResponse)
async def get_today(year: _Year, user: AuthUser = _VIEW) -> TodayResponse:
    """Today (§6.4): one dense line per waiting queue; its sections follow the user's permissions."""
    store = FinancialAidDecisionsRepository(pb)
    service = TodayService(
        store=store,
        pricing=_rules(),
        rules=_rules(),
        grants=GrantsService(GrantsRepository(pb)),
        ledger=_ledger(),
        intake=FinancialAidIntakeRepository(pb),
        to_place=store,  # To place's own reads (SP11): Today counts its open lines as Money › To place does
    )
    return await service.read(
        year,
        casework=_holds(user, Permission.FINANCIAL_AID_CASEWORK),
        finance=_holds(user, Permission.FINANCIAL_AID_RULES),
    )


@router.get("/household-page/{year}/{household_cm_id}", response_model=HouseholdPageResponse)
async def get_household_page(
    year: _Year, household_cm_id: Annotated[int, Path(gt=0)], user: AuthUser = _VIEW
) -> HouseholdPageResponse:
    """The household page (§6.3): one family's aggregate, its request rows the grid's own (D21, D26)."""
    service = HouseholdPageService(
        store=FinancialAidDecisionsRepository(pb),
        pricing=_rules(),
        grants=GrantsService(GrantsRepository(pb)),
        casework=_casework(),
        ledger=FinancialAidRepository(pb),
        history=EntityLogReads(pb),
    )
    try:
        return await service.read(year, household_cm_id)
    except HouseholdNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/requests/{request_id}/preview", response_model=EditorPreviewOut)
async def preview_request_edit(
    request_id: _RequestIdPath, body: PreviewIn, user: AuthUser = _CASEWORK
) -> EditorPreviewOut:
    """The request editor's line while typing (§4.6, D22): priced as the write would price it; writes nothing."""
    can_approve = _holds(user, Permission.FINANCIAL_AID_RULES)
    try:
        return await _decisions().preview(request_id, body, can_approve=can_approve)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


# --- Money > To place (campership SP11-rest; clean spec §8.1) ----------------------------------

_TransactionId = Annotated[int, Path(ge=1)]


def _to_place() -> ToPlaceService:
    return ToPlaceService(_decisions(), FinancialAidDecisionsRepository(pb))


@router.get("/money/{year}/to-place", response_model=ToPlaceResponse)
async def get_to_place(
    year: _Year, household_cm_id: int | None = Query(None, ge=1), user: AuthUser = _VIEW
) -> ToPlaceResponse:
    """Camp-aid lines no single request takes, by reason, with Kindred's suggestions and their evidence
    (D12, D16, D58); `household_cm_id` scopes it to one household page (D26)."""
    try:
        return await _to_place().read(year, household_cm_id=household_cm_id)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/money/{year}/to-place/place", response_model=PlaceOut)
async def place_lines(year: _Year, body: PlaceLinesIn, user: AuthUser = _CASEWORK) -> PlaceOut:
    """Confirm a whole class of lines at once (D16), all or nothing, as one operation with the ticks they make."""
    try:
        return await _to_place().place_lines(year, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/money/{year}/to-place/{transaction_cm_id}/place", response_model=PlaceOut)
async def place_line(
    year: _Year, transaction_cm_id: _TransactionId, body: PlaceLineIn, user: AuthUser = _CASEWORK
) -> PlaceOut:
    """Confirm or Split (D12): the staff placement and the Posted ticks it makes, as one operation (D81)."""
    try:
        return await _to_place().place(year, transaction_cm_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/money/{year}/to-place/{transaction_cm_id}/preview", response_model=PlacePreviewOut)
async def preview_place_line(
    year: _Year, transaction_cm_id: _TransactionId, body: PlacePreviewIn, user: AuthUser = _CASEWORK
) -> PlacePreviewOut:
    """What a typed Split… or Place on another request would tick, lock and withhold (slice 3, ask 8), from the plan
    the write runs. Writes nothing; refuses as the write would."""
    try:
        return await _to_place().preview(year, transaction_cm_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/money/{year}/to-place/{transaction_cm_id}/leave", response_model=ToPlaceWriteOut)
async def leave_line(
    year: _Year, transaction_cm_id: _TransactionId, body: LeaveLineIn, user: AuthUser = _CASEWORK
) -> ToPlaceWriteOut:
    """Leave at family level, with a note (D58)."""
    try:
        return await _to_place().leave(year, transaction_cm_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.delete("/money/{year}/to-place/{transaction_cm_id}/leave", response_model=ToPlaceWriteOut)
async def reopen_line(
    year: _Year, transaction_cm_id: _TransactionId, reason: _Reason, user: AuthUser = _CASEWORK
) -> ToPlaceWriteOut:
    """Undo Leave at family level: the line is open in To place again."""
    try:
        return await _to_place().reopen(year, transaction_cm_id, reason, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.post("/money/{year}/to-place/{transaction_cm_id}/reclassify", response_model=ToPlaceWriteOut)
async def reclassify_line(
    year: _Year, transaction_cm_id: _TransactionId, body: ReclassifyLineIn, user: AuthUser = _RULES
) -> ToPlaceWriteOut:
    """Reclassify (D104, finance): the line's money is really another source's; Go applies it on the next sync."""
    try:
        return await _to_place().reclassify(year, transaction_cm_id, body, user.email)
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


# --- Money > Ledger (campership slice 3, ask 1; clean spec §8.1) -------------------------------


def _money_ledger() -> MoneyLedgerService:
    return MoneyLedgerService(_decisions(), FinancialAidDecisionsRepository(pb))


@router.get("/money/{year}/ledger", response_model=MoneyLedgerOut)
async def get_money_ledger(
    year: _Year,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    source: SourceFamily | None = None,
    program: ProgramFamily | None = None,
    level: LedgerLevelOut | None = None,
    user: AuthUser = _VIEW,
) -> MoneyLedgerOut:
    """Money > Ledger (§8.1): one row per family (D26), In CampMinder (net) and Outside grants (§5.5, D97), and the
    level where a line isn't on a request, read from Kindred's placements (D151). Live, or as of a past day."""
    try:
        return await _money_ledger().ledger(
            year, as_of=as_of, axis=as_of_axis, filters=LedgerFilters(source, program, level)
        )
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


@router.get("/money/{year}/ledger/lines", response_model=MoneyLedgerLinesOut)
async def get_money_ledger_lines(
    year: _Year,
    total: LedgerTotalOut,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    source: SourceFamily | None = None,
    program: ProgramFamily | None = None,
    level: LedgerLevelOut | None = None,
    user: AuthUser = _VIEW,
) -> MoneyLedgerLinesOut:
    """The lines behind one of the Ledger's two totals, with the same filters ("totals open their lines", §8.1)."""
    try:
        return await _money_ledger().lines(
            year, total, as_of=as_of, axis=as_of_axis, filters=LedgerFilters(source, program, level)
        )
    except FinancialAidError as exc:
        raise _decisions_http(exc) from exc


# --- Reports (slice 4's back end, Part A: Statistics, Programs, the committee's tables, typed history) ------------


def _reports() -> FinancialAidReportsService:
    return FinancialAidReportsService(
        FinancialAidDecisionsRepository(pb),
        _rules(),
        GrantsService(GrantsRepository(pb)).register_rows,
        ReportsRepository(pb),
    )


def _reports_http(exc: FinancialAidError) -> HTTPException:
    if isinstance(exc, (ReportedFigureNotFoundError, FundingSourceNotFoundError, FunderNotFoundError)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ReportedFigureTakenError, AidWriteConflictError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


_RoundChip = Literal["1", "2", "3", "all"]
_ROUND_CHIPS: Final[dict[str, RoundChip]] = {"1": 1, "2": 2, "3": 3, "all": None}
_RecordIdPath = Annotated[str, Path(min_length=15, max_length=15, pattern=r"^[a-z0-9]+$")]


@router.get("/reports/{year}/statistics", response_model=StatisticsResponse)
async def get_report_statistics(
    year: _Year,
    table: Annotated[str | None, Query(max_length=60)] = None,
    round: _RoundChip = "1",
    basis: StatisticsBasis = "posted",
    through_round1_deadline: bool = False,
    received_through: date | None = None,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    user: AuthUser = _VIEW,
) -> StatisticsResponse:
    """Reports › Statistics (§9.2): one table per award-table × round chip (no `table`: All award tables; round
    "all": All rounds), RPT-9 and RPT-23 beside it. `basis=posted_and_decided` adds "Decided (not yet offered)"
    (D130; on a past date too, as 3c-2 prices it, Task A6c); the two reporting controls (D138) cut on each request's
    received date."""
    try:
        return await _reports().statistics(
            year,
            table=table,
            round_=_ROUND_CHIPS[round],
            basis=basis,
            through_deadline=through_round1_deadline,
            through=received_through,
            as_of=as_of,
            axis=as_of_axis,
        )
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/{year}/programs", response_model=ProgramsResponse)
async def get_report_programs(
    year: _Year,
    through_round1_deadline: bool = False,
    received_through: date | None = None,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    user: AuthUser = _VIEW,
) -> ProgramsResponse:
    """Reports › Programs (§9.3, RPT-11): sessions grouped by pool, pooled subtotals; the reporting controls apply."""
    try:
        return await _reports().programs(
            year,
            through_deadline=through_round1_deadline,
            through=received_through,
            as_of=as_of,
            axis=as_of_axis,
        )
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/{year}/statistics/requests", response_model=ReportRequestIdsOut)
async def get_report_statistics_requests(
    year: _Year,
    part: StatisticsPart,
    table: Annotated[str | None, Query(max_length=60)] = None,
    round: _RoundChip = "1",
    basis: StatisticsBasis = "posted",
    through_round1_deadline: bool = False,
    received_through: date | None = None,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    tier: Annotated[int | None, Query(ge=1, le=50)] = None,
    count: StatisticsCount | None = None,
    reason: Annotated[str | None, Query(max_length=60)] = None,
    pool: Annotated[str | None, Query(max_length=60)] = None,
    posted_round: Annotated[int | None, Query(ge=1, le=3)] = None,
    outcome_row: OutcomeRowKind | None = None,
    outcome: OutcomeKind | None = None,
    user: AuthUser = _VIEW,  # D65: never development's summary
) -> ReportRequestIdsOut:
    """The requests behind one Statistics count (D20; slice 4 asks 1 and 8), on the read `/statistics` gives for the
    same parameters. `part`: `tier` (`tier` absent: the "no tier" row) or `total` with a `count`; `cancelled` (an
    RPT-22 row: `reason`, `posted_round`, `pool` absent for a null pool); `outcome` (an RPT-23 row: `outcome_row` =
    its kind, `pool` for a pool row, `outcome`)."""
    try:
        return await _reports().statistics_request_ids(
            year,
            part=part,
            table=table,
            round_=_ROUND_CHIPS[round],
            basis=basis,
            through_deadline=through_round1_deadline,
            through=received_through,
            as_of=as_of,
            axis=as_of_axis,
            tier=tier,
            count=count,
            reason=reason,
            pool=pool,
            posted_round=posted_round,
            outcome_row=outcome_row,
            outcome=outcome,
        )
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/{year}/programs/requests", response_model=ReportRequestIdsOut)
async def get_report_programs_requests(
    year: _Year,
    part: ProgramsPart,
    block: Annotated[int, Query(ge=1, le=3)],
    count: ProgramsCount,
    pool: Annotated[str | None, Query(max_length=60)] = None,
    session: Annotated[int | None, Query(ge=0)] = None,
    through_round1_deadline: bool = False,
    received_through: date | None = None,
    as_of: date | None = None,
    as_of_axis: AsOfAxis = "campminder",
    user: AuthUser = _VIEW,  # D65: never development's summary
) -> ReportRequestIdsOut:
    """The requests behind one Programs count (D20; slice 4 ask 1), on the read `/programs` gives for the same
    parameters: a `session` row (`pool` absent: the no-pool group; `session` 0: "session not matched"), a pool's
    `subtotal`, or the `total`, in round `block`'s block."""
    try:
        return await _reports().programs_request_ids(
            year,
            part=part,
            block=block,
            count=count,
            pool=pool,
            session=session,
            through_deadline=through_round1_deadline,
            through=received_through,
            as_of=as_of,
            axis=as_of_axis,
        )
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/{year}/committee", response_model=CommitteeResponse)
async def get_report_committee(
    year: _Year, received_through: date | None = None, user: AuthUser = _VIEW
) -> CommitteeResponse:
    """The committee's year-over-year tables (§9.7 RPT-1, 2, 6, 7, 8, 13, 24) from 2022 to `year`: P rows from
    Kindred's decisions, r rows from finance's typed history. `received_through` moves this season's RPT-2 cutoff
    off the application deadline."""
    try:
        return await _reports().committee(year, through=received_through)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/reported-history", response_model=ReportedHistoryResponse)
async def get_reported_history(user: AuthUser = _RULES) -> ReportedHistoryResponse:
    """Every typed "as reported" figure (O-930-13), for checking a load."""
    return await _reports().reported_history()


@router.post("/reports/reported-history/bulk", response_model=ReportedLoadOut)
async def load_reported_history(body: ReportedLoadIn, user: AuthUser = _RULES) -> ReportedLoadOut:
    """Type finance's history once (§9.5): adds figures, corrects stored ones by their natural key, skips the
    unchanged. All or nothing; one logged operation."""
    figures = [
        ReportedFigure(
            year=f.year,
            view=f.view,
            metric=f.metric,
            pool=f.pool,
            tier=f.tier,
            phase=f.phase,
            at=f.at,
            as_of=f.as_of,
            value=f.value,
            source=f.source,
            note=f.note,
        )
        for f in body.figures
    ]
    try:
        return await _reports().load_reported(figures, actor=user.email)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.delete("/reports/reported-history/{record_id}", status_code=204, response_class=Response)
async def delete_reported_figure(record_id: _RecordIdPath, reason: _Reason, user: AuthUser = _RULES) -> Response:
    """Remove a typed figure (one keyed wrongly); the reason is logged."""
    try:
        await _reports().delete_reported(record_id, reason=reason, actor=user.email)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc
    return Response(status_code=204)


# --- Reports › Development (Part B) ------------------------------------------------------------------------------


def _development() -> FinancialAidDevelopmentService:
    return FinancialAidDevelopmentService(
        FinancialAidDecisionsRepository(pb),
        _rules(),
        GrantsService(GrantsRepository(pb)).register_rows,
        DevelopmentRepository(pb),
        ReportsRepository(pb),
    )


@router.get("/reports/{year}/development", response_model=DevelopmentResponse)
async def get_report_development(year: _Year, user: AuthUser = _VIEW_OR_SUMMARY) -> DevelopmentResponse:
    """Reports › Development (§9.4): development's lines by group, seasons from 2022 as columns (r as reported, P
    Kindred's), all money (D87). Aggregates only: development's summary permission reads it (D65)."""
    try:
        return await _development().development(year)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


# --- Reports › Development: ZIP codes, dated columns, Funding sources (Part C) ----------------------------------

# D100: development and finance edit a funding source's group and incentive flag; the registrar may not.
_FUNDING_SOURCES_EDIT = Depends(
    require_any_permission(Permission.FINANCIAL_AID_FUNDING_SOURCES, Permission.FINANCIAL_AID_RULES)
)


@router.get("/reports/{year}/development/zip", response_model=ZipResponse)
async def get_report_development_zip(
    year: _Year,
    group: Annotated[str | None, Query(max_length=60)] = None,
    user: AuthUser = _VIEW_OR_SUMMARY,
) -> ZipResponse:
    """ZIP codes (§9.4, D90): every camper, and campers who got aid with their dollars, by billing ZIP. `group` is
    one of the season's pool keys or `all`; omitted, it is the summer group. Anything else is a 422."""
    try:
        return await _development().zip_codes(year, group)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/development/columns", response_model=ReportColumnsResponse)
async def get_report_development_columns(user: AuthUser = _VIEW_OR_SUMMARY) -> ReportColumnsResponse:
    """Development's saved dated columns ("+ Add a dated column", §9.4)."""
    return await _development().report_columns()


@router.put("/reports/development/columns", response_model=ReportColumnsResponse)
async def save_report_development_columns(
    body: ReportColumnsIn, user: AuthUser = _VIEW_OR_SUMMARY
) -> ReportColumnsResponse:
    """Replace development's dated columns: a season as of a past day, from 2027 (dated decisions, D67)."""
    try:
        return await _development().save_report_columns(body.columns, actor=user.email)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.get("/reports/{year}/funding-sources", response_model=FundingSourcesResponse)
async def get_funding_sources(year: _Year, user: AuthUser = _VIEW_OR_SUMMARY) -> FundingSourcesResponse:
    """Funding sources (D100): every outside source with its three facts (D88) and reporting group. No family data."""
    return await _development().funding_sources(year)


@router.put("/reports/{year}/funding-sources/{source_id}", response_model=FundingSourceOut)
async def save_funding_source(
    year: _Year, source_id: _RecordIdPath, body: FundingSourceIn, user: AuthUser = _FUNDING_SOURCES_EDIT
) -> FundingSourceOut:
    """Set a source's reporting group (one of `year`'s pools) and incentive flag (D88, D100), logged."""
    try:
        return await _development().save_funding_source(year, source_id, body, actor=user.email)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc


@router.put("/reports/{year}/funding-sources/funders/{grantor_key}", response_model=FundingSourceRowOut)
async def save_funding_source_funder(
    year: _Year, grantor_key: _GrantorKeyPath, body: FundingSourceIn, user: AuthUser = _FUNDING_SOURCES_EDIT
) -> FundingSourceRowOut:
    """Set a funder row's reporting group and incentive flag on each of its descriptions, in one logged operation
    (D159; Decision 48)."""
    try:
        return await _development().save_funder(year, grantor_key, body, actor=user.email)
    except FinancialAidError as exc:
        raise _reports_http(exc) from exc

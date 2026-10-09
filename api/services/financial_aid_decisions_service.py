"""Campership decisions (sub-project 10a): the season priced, its three reads, and the writes that
record each round's asks and decisions (spec §5.1–§5.3, §6.1, §7.1–§7.3; D41–D44, D50–D53, D78–D82).

Reads (financial_aid.view; the Remaining line also financial_aid.summary). Each prices the whole
season on the server and returns one aggregate (D21): the Requests grid, Rounds & budget, and the
Remaining line. Each takes an optional as-of date (3c): a past date shows the season by the end of
that day, and names every figure it leaves empty in not_rebuilt. On the default axis, `campminder`
(owner ruling 2026-09-30), a Posted tick counts from its CampMinder post day, as Money's ledger ?as_of
does; on `recorded` every fold and replay cuts on created, which is what Kindred showed that day, and the
ledger's lines count only once Kindred had recorded them and their reversals (as_recorded). Facts
with no CampMinder date (decisions, asks, holds, corrections, the rules, request status, payer shares,
Accepted) cut on created on both axes.

Holds (follow-up 3b): each request's released check codes and its manual hold come from
aid_hold_events, folded like the rounds, and reach pricing through with_holds.

Writes. Each is one staff action and one operation through sub-project 4a's commit_aid_writes:
the aid_decisions rows and their aid_change_log rows in ONE PocketBase batch, and a first lock's
rules-section locks in that same batch (Decision 11). A write that changes nothing writes nothing:
the helper refuses an empty operation, and change_row refuses a no-op, which would be a 500.
Holds (follow-up 3b): releasing a check's hold, putting it back, and placing or lifting a manual hold
are each one operation of one aid_hold_events row with a required note.
Cancellations (sub-project 10b-2): cancelling a request with its reason, or reopening one cancelled in
Kindred, is one operation of one aid_cancellations row with a required reason.

Pricing uses the season's newest rules version whose pricing sections are all approved or locked
(PRICING_SECTIONS). With none, every live request is held and nothing is allocated.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Final, Protocol

from api.constants.collections import (
    AID_APPLICATIONS,
    AID_ATTRIBUTION_OVERRIDES,
    AID_CANCELLATIONS,
    AID_DECISIONS,
    AID_GRANTS,
    AID_HOLD_EVENTS,
    AID_PAYER_SHARES,
    AID_REQUESTS,
)
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    AskIn,
    AsOfAxis,
    BelowTheLineOut,
    BudgetResponse,
    CancellationIn,
    CancellationOut,
    CellOut,
    ChangedRowOut,
    ConfirmationOut,
    CostOverrideIn,
    CostOverrideOut,
    CountOut,
    DecisionTypeLineOut,
    DecisionWriteOut,
    EditorPreviewOut,
    ForwardDemandOut,
    GridRowOut,
    HoldReleaseIn,
    LedgerTicksOut,
    ManualHoldIn,
    NotRebuiltOut,
    PoolBudgetOut,
    PostedIn,
    PreviewIn,
    PreviewShareOut,
    ReleasedHoldOut,
    RemainingPoolOut,
    RemainingResponse,
    RequestsGridResponse,
    Round3AmountIn,
    Round3ApprovalIn,
    RoundCellOut,
    RoundCountsOut,
    RoundOut,
    SessionCandidateOut,
    ShareConfirmationOut,
    UnconfirmedOut,
    UnpostIn,
    UntickedMoneyOut,
    _CellBase,
)
from api.schemas.financial_aid_intake import IssueOut
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_calc_inputs import (
    calculator_inputs,
    effective_ask,
    priced_program,
    request_issues,
    to_application_inputs,
)
from api.services.financial_aid_cancellations import (
    CANCEL_REASON_LABELS,
    CancelEvent,
    Cancellation,
    CancelState,
    EnrollmentState,
    cancellations_by_request,
    cancelled_days,
    enrollment_cancelled,
    first_cancelled_on,
    fold_cancellations,
)
from api.services.financial_aid_corrections import APPLICATION_CORRECTABLE, REVERT, effective_values
from api.services.financial_aid_grant_placements import (
    PLACEMENT_ACTOR,
    PLACEMENT_REASON,
    PlacementRecord,
    PlacementsAsOf,
    placement_writes,
    placements_as_of,
)
from api.services.financial_aid_grants_register import (
    Placement,
    RegisterRow,
    counts_as_outside,
    grant_inputs_by_request,
    outside_grants_by_request,
)
from api.services.financial_aid_intake_plan import application_fields, request_fields, share_entity_id
from api.services.financial_aid_intake_repository import application_record, request_record
from api.services.financial_aid_intake_types import (
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    ApplicationRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_ledger_service import as_of_cutoff, money, parse_pb_datetime
from api.services.financial_aid_payer_shares import PayerShareError, split_award
from api.services.financial_aid_queues import ROUND_STATUS_LABELS, UNTICKED_LABELS, row_queues, row_stage
from api.services.financial_aid_reconciliation import (
    AWAITING_SYNC_TEXT,
    CampLine,
    Confirmation,
    LedgerTick,
    LineOverride,
    SeasonLedger,
    SplitPart,
    Unticked,
    apply_clawback,
    as_recorded,
    awaits_sync,
    build_ledger,
    camp_date,
    clawback_eligible,
    confirmation,
    ledger_note,
    ledger_ticks,
    ledger_walk,
    override_placement,
    override_split,
    pending_text,
    placeable,
    request_scope,
    round_ledger,
    stop_text,
    undone_rounds,
)
from api.services.financial_aid_request_overrides import (
    COST_OVERRIDE,
    encode_cost_override,
    latest,
    override_write,
    parse_cost_override,
)
from api.services.financial_aid_request_overrides import by_request as overrides_by_request
from api.services.financial_aid_requesters import FaContact, requester_names
from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS as PRICING_SECTIONS,  # defined in the rules service; re-exported for its importers
)
from api.services.financial_aid_rules_service import (
    ROUND_SECTIONS as ROUND_SECTIONS,  # defined in the rules service (the budget total's lock reads it); re-exported
)
from api.services.financial_aid_rules_service import (
    RulesHistoryIncompleteError,
    RulesVersion,
)
from api.services.financial_aid_share_split import grid_shares, payers
from api.services.financial_aid_to_place import (
    SYNC_HISTORY,
    ChangedReason,
    SinceInputs,
    SinceRecords,
    on_placed_money,
    reads_person_fields,
    withheld_why,
    withhold,
)
from bunking.financial_aid.calculator import ApplicationInputs, CalcIssue, GrantInput, RequestInputs
from bunking.financial_aid.calculator.cost import CostResolution, resolve_cost
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, AidWriteConflictError
from bunking.financial_aid.change_replay import LogRow, Replayed, replay
from bunking.financial_aid.decisions import (
    BUDGET_GAPS,
    GRID_GAPS,
    MANUAL_HOLD,
    NEVER_A_HOLD,
    NO_HOLDS,
    NO_POOL,
    PAST_DATE_GAPS,
    POSTED_GAPS,
    REMAINING_GAPS,
    TOTAL,
    UNRELEASABLE,
    Count,
    DecisionEvent,
    EventKind,
    HoldEvent,
    HoldEventKind,
    HoldState,
    PoolBudget,
    PoolCell,
    PricedRequest,
    RequestToPrice,
    RoundCell,
    RoundLedger,
    RoundState,
    RoundView,
    SeasonBudget,
    apply_event,
    fold_holds,
    fold_rounds,
    lock_snapshot,
    needs_finance,
    price_as_of,
    price_request,
    releasable,
    season_budget,
    with_holds,
)
from bunking.financial_aid.decisions.budget import outside_part
from bunking.financial_aid.decisions.rounds import LOADED
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO, dollars
from bunking.financial_aid.rules.schema import AidRules, SectionName
from bunking.pocketbase_batch import BatchError, BatchLimitError

if TYPE_CHECKING:  # the household page imports this module, so the labeler type is only named for the checker
    from api.services.financial_aid_household_page import HouseholdLabeler

_LIVE: Final = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})
_CLOSED_REVERSIBLE: Final = frozenset({STATUS_WITHDRAWN, STATUS_DUPLICATE})


def is_included(status: str | None, *, cancelled: bool) -> bool:
    """D77's included request: live (the budget's own set) and not cancelled (D129). Derived only: staff have no
    override on it (owner ruling). The household band and each card's money line read it; pricing, Rounds & budget,
    the Remaining line and Today never do."""
    return status in _LIVE and not cancelled


# Spec §5.4: 2026 has no ticks and no dated decisions; its decisions are reproduced from the repaired
# sheet (D67). Before this season the ledger never ticks, and no confirmation or Note is shown.
FIRST_TICKED_SEASON: Final = 2027

# ROUND_SECTIONS (which rules sections a round's first lock locks) lives in financial_aid_rules_service, which the
# budget total's lock also reads; it is imported above under the same name.
_WHY_NOT: Final[Mapping[str, str]] = {
    "held": "is on hold: release the hold first",
    "pending_approval": "waits for finance's approval",
    "refused": "was refused by finance",
    "not_decided": "has no amount keyed yet",
}

# Decision 14 (plan review 2026-09-30): a request the registrar cancelled takes no new decisions. Owner 2026-10-05: nor
# does one CampMinder cancelled. Refused: asks, Round 3 amounts and finance's answer, the editor preview, cost
# overrides, and checking Posted or Accepted (_cancelled_refusal). Still open: its reason (given or changed), a reopen
# of Kindred's own cancellation, undoing a Posted tick, unchecking Accepted, and holds. CampMinder's cancellation is
# undone by re-enrolling there, so its refusal doesn't say "reopen".
CANCELLED_IN_KINDRED: Final = "Cancelled in the dashboard: reopen it first"
CANCELLED_IN_CAMPMINDER: Final = "Cancelled in CampMinder: nothing new can be decided"

# 4a's actor for the ledger's own writes, as intake writes as "system:intake" (INTAKE_ACTOR).
LEDGER_ACTOR: Final = "system:ledger"
_POSTED_OVERRIDE_WARNING: Final = (
    "A round is already posted: this cost changes the later rounds, never the money already posted"
)
# Intake's flag on an unmatched request (financial_aid_intake_plan): its detail lists the candidate session ids.
_UNMATCHED_FLAG: Final = "unmatched_session"


class DecisionNotFoundError(FinancialAidError, LookupError):
    """No such request, or none in the season named."""


class DecisionRefusedError(FinancialAidError, ValueError):
    """A write that can't be applied; the message is safe to show staff."""


class DecisionChangedError(FinancialAidError, ValueError):
    """A confirmed amount is no longer the decided amount (Decision 9). Nothing was written."""

    def __init__(self, rows: Sequence[ChangedRowOut]) -> None:
        super().__init__(
            "A decided amount moved since it was shown, so nothing was posted: "
            "check the amount and mark it posted again"
        )
        self.rows = list(rows)


class DecisionsStore(Protocol):
    async def fetch_applications(self, year: int) -> list[ApplicationRecord]: ...
    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]: ...
    async def fetch_request(self, record_id: str) -> RequestRecord | None: ...
    async def fetch_corrections(self, year: int, application_id: str | None) -> list[CorrectionRecord]: ...
    async def fetch_sessions(self, year: int) -> list[SessionRow]: ...
    async def fetch_payer_shares(
        self, year: int, request_ids: Sequence[str] | None = None
    ) -> list[PayerShareRecord]: ...
    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]: ...
    async def fetch_decision_events(self, year: int) -> list[DecisionEvent]: ...
    async def fetch_request_events(self, request_id: str) -> list[DecisionEvent]: ...
    async def fetch_hold_events(self, year: int) -> list[HoldEvent]: ...
    async def fetch_change_log(self, year: int, entity: str) -> list[LogRow]: ...
    async def fetch_request_hold_events(self, request_id: str) -> list[HoldEvent]: ...
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
    async def fetch_fa_contacts(self, year: int) -> list[FaContact]: ...
    async def fetch_camp_lines(self, year: int, *, recorded_times: bool = False) -> list[CampLine]: ...
    async def fetch_line_placements(self, year: int) -> dict[int, Placement]: ...
    async def fetch_line_splits(self, year: int) -> dict[int, tuple[SplitPart, ...]]: ...
    async def fetch_changed_since(self, year: int, floor: datetime, *, persons: bool) -> SinceRecords: ...
    async def fetch_line_overrides(self, year: int) -> list[LineOverride]: ...
    async def fetch_last_ledger_sync(self, year: int) -> datetime | None: ...
    async def fetch_grant_placements(self, year: int) -> list[PlacementRecord]: ...
    async def fetch_cancellations(self, year: int) -> list[CancelEvent]: ...
    async def fetch_request_cancellations(self, request_id: str) -> list[CancelEvent]: ...
    async def fetch_enrollment_states(
        self, year: int, person_cm_ids: Collection[int], household_cm_ids: Collection[int]
    ) -> list[EnrollmentState]: ...
    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        operation_id: str | None = None,
        reason: str | None = None,
        require_reason: bool = False,
        allow_chunking: bool = False,
    ) -> AidOperationResult: ...


class PricingRules(Protocol):
    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None: ...
    async def approved_as_of(
        self, year: int, sections: Collection[SectionName], at: datetime
    ) -> RulesVersion | None: ...
    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]: ...
    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]: ...


RegisterSource = Callable[[int], Awaitable[Sequence[RegisterRow]]]


@dataclass(frozen=True)
class Season:
    year: int
    rules: RulesVersion | None
    requests: Mapping[str, RequestRecord]
    priced: Mapping[str, PricedRequest]
    rounds: Mapping[str, Mapping[int, RoundState]]
    register: tuple[RegisterRow, ...]
    sessions: Mapping[int, SessionRow]
    # Each request's released check codes and manual hold (follow-up 3b).
    holds: Mapping[str, HoldState]
    # None: priced now. A date: the past-date read (3c), by the end of that day on `axis`.
    as_of: date | None = None
    axis: AsOfAxis | None = None  # the as-of axis a past read cut on; None when live
    gaps: tuple[NotRebuiltOut, ...] = ()  # rebuild gaps: rules or request history, deleted since, pool unknown
    unrebuilt: frozenset[str] = frozenset()  # requests whose history couldn't be replayed
    # Sub-project 10b. Defaults: a read that loads no ledger (3c's past date) reconciles nothing.
    ledger: SeasonLedger = field(default_factory=SeasonLedger)
    reversed_on: Mapping[str, date] = field(default_factory=dict)  # request -> the day its money came back (D54)
    shares: Mapping[str, tuple[PayerShareRecord, ...]] = field(default_factory=dict)
    undone: frozenset[tuple[str, int]] = frozenset()  # rounds a person un-ticked: the ledger leaves them
    posted_unknown: frozenset[str] = frozenset()  # past read: posted money whose clawback can't be replayed
    # Slice 3 ask 1 (Money > Ledger's family rows): a past read's camp-aid lines placed as of the day, as
    # _ledger_as_of built them. None on the live read (`ledger` is that) and on a past read with no camp-aid line.
    # Nothing else reads it: a past read reconciles nothing, so `ledger` stays empty there.
    past_ledger: SeasonLedger | None = None
    shares_unknown: frozenset[str] = frozenset()  # past read: requests whose payer shares can't be replayed (⚠39)
    # 3c-2, past read: request -> the gap that keeps it to 3c-1's figures (_PRICING_GAPS), and whether a
    # grant by then has no logged placement (its household's pools, and money off requests, stay empty).
    gapped: Mapping[str, str] = field(default_factory=dict)
    grants_unplaced: bool = False
    deleted: frozenset[str] = frozenset()  # past read: requests deleted since, which can't be shown or priced
    # Sub-project 10b-2: the cancelled live requests (D101); on a past read, as of the day (Decision 11).
    cancellations: Mapping[str, Cancellation] = field(default_factory=dict)
    # Owner ruling 2026-10-02 (⚠, via the lead): the requests whose registration CampMinder cancelled (by the day, on a
    # past read: 3c-2's rule). Read ONLY by forward demand (season_budget's not_demand); never widens `live`.
    cancelled_in_campminder: frozenset[str] = frozenset()
    # Decision 15, widened by owner ruling (a): cancelled with live camp aid placed on it, or withdrawn with
    # posted camp aid still live (D54's forgotten reversal). Empty on a past read.
    to_reverse: frozenset[str] = frozenset()
    # Slice 1: each request as pricing read it, so the editor's preview re-prices one request with a typed
    # amount on exactly the inputs the season used. Empty on a past read.
    inputs: Mapping[str, RequestToPrice] = field(default_factory=dict)
    # Reports: a cancelled request is priced as not live (no result), so its income tier is read by pricing it live
    # once, tier only. Never an award or a round view. On a past read: the cancelled requests with no pricing gap.
    live_tiers: Mapping[str, int] = field(default_factory=dict)
    # SP11-rest: what the live ledger was built from, so To place can re-place a line and see where it lands.
    # Empty on a past read.
    camp_lines: tuple[CampLine, ...] = ()
    placements: Mapping[int, Placement] = field(default_factory=dict)
    # Slice 1 part 2 (reads 5-6): each request's standing cost-override row (aid_application_corrections), dated by
    # the read's day on a past read.
    cost_overrides: Mapping[str, CorrectionRecord] = field(default_factory=dict)
    splits: Mapping[int, tuple[SplitPart, ...]] = field(default_factory=dict)
    # D162: each request's rounds CampMinder holds money for with no Posted tick, and why (with_unticked). Filled
    # only by the reads that show it (the grid, Today, the household page, Rounds & budget's counts, the March file,
    # the Accepted tick); empty elsewhere and on a past read.
    unticked: Mapping[str, tuple[Unticked, ...]] = field(default_factory=dict)
    # C1 (owner 10-03): the rounds CampMinder covers in full with nothing blocking tonight's tick, each with its
    # decided amount. No Not reconciled reason: they wait on the family at once, CampMinder "pending". Filled with
    # `unticked`, by the same walk.
    pending: Mapping[tuple[str, int], Decimal] = field(default_factory=dict)

    def in_campminder(self) -> frozenset[tuple[str, int]]:
        """The (request, round)s with no Posted tick that CampMinder already holds money for (D162, Q1): Not
        reconciled's direction (b) and C1's pending rounds. None of them is a Needs an offer round: posting them
        again risks posting the family twice."""
        return frozenset(self.pending) | frozenset(
            (rid, u.round) for rid, items in self.unticked.items() for u in items
        )


Names = tuple[dict[int, str], dict[int, str]]


@dataclass(frozen=True)
class _PastLedgerInputs:
    """A past read's ledger loads: the dated lines, and the staff placements as they stand now (the
    replay's `current`) with their change log."""

    camp_lines: list[CampLine]
    overrides: list[LineOverride]
    override_log: list[LogRow]


@dataclass(frozen=True)
class _RequestSide:
    """The season's loads that hang off its requests: rules, applications, corrections, equity
    answers, the registrations a cancellation reads (10b-2), and (for the grid) the family and camper
    names."""

    rules: RulesVersion | None
    applications: list[ApplicationRecord]
    requests: list[RequestRecord]
    corrections: list[CorrectionRecord]
    equity: dict[int, EquityAnswers]
    enrollments: list[EnrollmentState]
    names: Names


async def _no_names() -> Names:
    return {}, {}


async def _unlogged() -> list[PlacementRecord]:
    return []


def _to_price(
    request: RequestRecord,
    application: ApplicationRecord | None,
    corrections: Sequence[CorrectionRecord],
    sessions: Mapping[int, SessionRow],
    shares: Sequence[PayerShareRecord],
    equity: EquityAnswers | None,
    rounds: Mapping[int, RoundState],
    grants: tuple[GrantInput, ...],
    rules: AidRules | None,
    cancelled: bool = False,
) -> RequestToPrice:
    ask = effective_ask(request, corrections)
    answers = effective_values(
        application.answers if application is not None else {}, APPLICATION_CORRECTABLE, corrections
    )
    live = request.status in _LIVE and not cancelled  # a cancelled request is not live (10b-2 Decision 14)

    def build(
        app_inputs: ApplicationInputs, inputs: RequestInputs | None, blocked: str, issues: tuple[CalcIssue, ...]
    ) -> RequestToPrice:
        return RequestToPrice(
            request_id=request.id,
            household_cm_id=request.household_cm_id,
            live=live,
            application=app_inputs,
            request=inputs,
            blocked=blocked,
            issues=issues,
            rounds=rounds,
            r1_ask=Decimal(ask.effective) if ask.effective != "" else None,
            grants=grants,
            session_cm_id=request.session_cm_id,
        )

    if not live or application is None:
        blocked = ("cancelled" if cancelled else request.status) if not live else "no application for this request"
        return build(ApplicationInputs(household_cm_id=request.household_cm_id), None, blocked, ())
    if rules is None:
        issues = tuple(request_issues(request, application.flags, answers, shares, None))
        return build(to_application_inputs(application.household_cm_id, answers), None, "", issues)
    converted = calculator_inputs(request, application, answers, corrections, sessions, shares, equity, rules)
    return build(converted.application, converted.request, converted.blocked, converted.issues)


def _live_tier(
    request: RequestRecord,
    applications: Mapping[str, ApplicationRecord],
    corrections: Mapping[str, list[CorrectionRecord]],
    sessions: Mapping[int, SessionRow],
    shares: Sequence[PayerShareRecord],
    equity: Mapping[int, EquityAnswers],
    grants: Mapping[str, Any],
    rules: AidRules | None,
) -> int | None:
    """A cancelled request's income tier: the request priced as if live, read for its tier alone."""
    priced = price_request(
        _to_price(
            request,
            applications.get(request.application_id),
            corrections.get(request.application_id, []),
            sessions,
            shares,
            equity.get(request.person_cm_id),
            {},
            tuple(grants.get(request.id, [])),
            rules,
            cancelled=False,
        ),
        rules,
    )
    return priced.result.final_tier if priced.result is not None else None


def _money(value: Decimal | None) -> float | None:
    return money(value) if value is not None else None


def _issue(issue: CalcIssue) -> IssueOut:
    return IssueOut(code=issue.code, severity=issue.severity, message=issue.message)


def _shares_by_request(shares: Iterable[PayerShareRecord]) -> dict[str, tuple[PayerShareRecord, ...]]:
    grouped: dict[str, list[PayerShareRecord]] = defaultdict(list)
    for share in shares:
        grouped[share.request_id].append(share)
    return {request_id: tuple(rows) for request_id, rows in grouped.items()}


def _share_key(request_id: str, household_cm_id: int) -> str:
    return share_entity_id(request_id, household_cm_id)


def _share_log_fields(share: PayerShareRecord) -> dict[str, Any]:
    """A stored share in the shape its log rows carry (the replay's `current`)."""
    return {
        "year": share.year,
        "request": share.request_id,
        "household_cm_id": share.household_cm_id,
        "share_pct": f"{share.share_pct.normalize():f}",
        "source": share.source,
        "actor": share.actor,
        "note": share.note,
    }


def _unreplayable(keys_now: Collection[str], log: Sequence[LogRow], replayed: Mapping[str, Replayed]) -> frozenset[str]:
    """The records whose state at the date can't be established: a history that isn't complete, one
    with no create row, or a record that exists today with no log row at all."""
    logged = {row.entity_id for row in log}
    made = {row.entity_id for row in log if row.before is None}
    return frozenset(
        {key for key, record in replayed.items() if not record.complete} | (logged - made) | (set(keys_now) - logged)
    )


def _shares_as_of(
    current: Sequence[PayerShareRecord], log: Sequence[LogRow], at: datetime
) -> tuple[dict[str, tuple[PayerShareRecord, ...]], frozenset[str], frozenset[int]]:
    """Each request's payer shares as of `at`, replayed from aid_change_log the way requests are
    (3c-1), and the requests, and the households, behind shares that can't be replayed exactly."""
    now = {_share_key(s.request_id, s.household_cm_id): s for s in current}
    replayed = replay(log, as_of=at, current={key: _share_log_fields(s) for key, s in now.items()})
    bad = _unreplayable(now.keys(), log, replayed)
    grouped: dict[str, list[PayerShareRecord]] = defaultdict(list)
    for key, record in replayed.items():
        if key in bad or record.state is None:
            continue
        state = record.state
        grouped[str(state["request"])].append(
            PayerShareRecord(
                id=now[key].id if key in now else "",
                year=int(state["year"]),
                request_id=str(state["request"]),
                household_cm_id=int(state["household_cm_id"]),
                share_pct=Decimal(str(state["share_pct"])),
                source=str(state.get("source", "")),
                actor=str(state.get("actor", "")),
                note=str(state.get("note", "")),
            )
        )
    return (
        {rid: tuple(rows) for rid, rows in grouped.items()},
        frozenset(key.split(":")[0] for key in bad),
        frozenset(int(key.split(":")[1]) for key in bad),
    )


def _placements_as_of(
    current: Sequence[LineOverride], log: Sequence[LogRow], at: datetime
) -> tuple[dict[int, Placement], dict[int, tuple[SplitPart, ...]], set[int], set[int]]:
    """The staff placements and splits as of `at`, replayed from aid_change_log, and the transactions and camper
    people behind any placement that can't be replayed exactly (an unreplayable one places nothing)."""
    now = {o.id: o for o in current}
    replayed = replay(log, as_of=at, current={o.id: o.fields() for o in current})
    bad = _unreplayable(now.keys(), log, replayed)
    placements: dict[int, Placement] = {}
    splits: dict[int, tuple[SplitPart, ...]] = {}
    for key, record in replayed.items():
        if key in bad or record.state is None:
            continue
        placement = override_placement(record.state)
        if placement is not None:
            placements[placement.transaction_cm_id] = placement
        parts = override_split(record.state)
        if parts:
            splits[int(record.state.get("transaction_cm_id") or 0)] = parts
    transactions: set[int] = set()
    people: set[int] = set()
    for row in log:
        if row.entity_id in bad:
            for side in (row.before, row.after):
                if side and side.get("transaction_cm_id"):
                    transactions.add(int(side["transaction_cm_id"]))
                if side and side.get("attributed_person_cm_id"):
                    people.add(int(side["attributed_person_cm_id"]))
                if side:
                    people.update(part.person_cm_id for part in override_split(side) if part.person_cm_id > 0)
    for key in bad & now.keys():
        transactions.add(now[key].transaction_cm_id)
        if now[key].attributed_person_cm_id:
            people.add(now[key].attributed_person_cm_id)
        # A split override attributes to no one (person 0): the campers it paid are in its parts.
        people.update(part.person_cm_id for part in now[key].split if part.person_cm_id > 0)
    return placements, splits, transactions, people


def _posted_ids(rounds: Mapping[str, Mapping[int, RoundState]]) -> frozenset[str]:
    """Requests, of any status, with at least one posted round: a closed one's reversed money can be clawed back."""
    return frozenset(rid for rid, states in rounds.items() if any(state.posted for state in states.values()))


def _confirmation_out(c: Confirmation) -> ConfirmationOut:
    return ConfirmationOut(
        status=c.status,
        locked=money(c.locked),
        in_campminder=money(c.in_campminder),
        gap=money(c.gap),
        on=c.on,
        reconciled=c.reconciled,
        family_unplaced=money(c.family_unplaced),
        shares=[
            ShareConfirmationOut(
                household_cm_id=s.household_cm_id,
                expected=money(s.expected),
                in_campminder=money(s.in_campminder),
                status=s.status,
            )
            for s in c.shares
        ],
    )


def _enrollment_scope(requests: Iterable[RequestRecord]) -> tuple[set[int], set[int]]:
    """Whose registrations a cancellation reads (SP10b-2): the camper of each live or withdrawn
    camper-level request, and the household of each household-level (Family Camp) one."""
    wanted = [r for r in requests if r.status in _LIVE or r.status == STATUS_WITHDRAWN]
    return (
        {r.person_cm_id for r in wanted if r.person_cm_id > 0},
        {r.household_cm_id for r in wanted if r.person_cm_id <= 0},
    )


def _cancellation_out(c: Cancellation) -> CancellationOut:
    return CancellationOut(by=c.by, on=c.on, reason=c.reason, note=c.note)


def _candidates(request: RequestRecord, sessions: Mapping[int, SessionRow]) -> list[SessionCandidateOut]:
    """Session not settled (§6.2; read 4): the sessions intake found for an unmatched request, each once, named from
    the season's sessions ("Session <id>" for one the season lacks). A settled request lists none, whatever its old
    flag still says."""
    if request.status != STATUS_UNMATCHED:
        return []
    ids: list[int] = []
    for flag in request.flags:
        if flag.get("code") != _UNMATCHED_FLAG:
            continue
        detail = flag.get("detail")
        if not isinstance(detail, Mapping):
            continue
        candidates = detail.get("candidates")
        if not isinstance(candidates, list):
            continue
        ids.extend(c for c in candidates if isinstance(c, int) and not isinstance(c, bool))
    return [
        SessionCandidateOut(session_cm_id=i, name=sessions[i].name if i in sessions else f"Session {i}")
        for i in dict.fromkeys(ids)
    ]


def _total_decided(priced: PricedRequest) -> float | None:
    """A request's total decided: every round with a decided amount. A clawed-back round stays in Decided (a
    declined offer was still decided) and leaves Posted. The grid row and the editor preview share this."""
    decided = [v.decided for v in priced.rounds if v.decided is not None]
    return money(sum(decided, ZERO)) if decided else None


def grid_row(
    request: RequestRecord,
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    sessions: Mapping[int, SessionRow],
    families: Mapping[int, str],
    campers: Mapping[int, str],
    hold: HoldState,
    *,
    confirmation: Confirmation | None = None,
    cancellation: Cancellation | None = None,
    to_reverse: bool = False,
    appeal: str | None = None,
    type_labels: Mapping[str, str] | None = None,
) -> GridRowOut:
    session = sessions.get(request.session_cm_id)
    result = priced.result
    labels = type_labels or {}

    def outside(v: RoundView) -> tuple[float | None, str | None]:
        part = outside_part(v)
        if part <= 0:
            return None, None
        return _money(part), (labels.get(v.decision_type, v.decision_type) if v.decision_type else None)

    views = [
        RoundOut(
            round=v.round,
            status=v.status,
            ask=_money(v.ask),
            asked_on=rounds[v.round].asked_on if v.round in rounds else None,
            decided=_money(v.decided),
            posted=_money(v.locked),
            posted_on=rounds[v.round].posted_on if v.round in rounds else None,
            accepted=v.accepted,
            pending_approval=_money(v.pending),
            would_change_by=None,  # never emitted since 2026-10-05 (RoundOut)
            # A named full-cost fund round's camp award counts toward the budget (owner 10-06) though the type's own
            # flag is False: the Requests filters are row membership, so the family must match the budget strip.
            counts_toward_budget=v.counts_toward_budget or v.extra_outside,
            outside_budget=outside_amount,
            outside_label=outside_label,
            rules_version=rounds[v.round].rules_version if v.round in rounds else None,
            lock_source=(rounds[v.round].lock_source or None) if v.status == "posted" and v.round in rounds else None,
            clawed_back=v.clawed_back,
            status_label=ROUND_STATUS_LABELS[v.status],
        )
        for v in priced.rounds
        for outside_amount, outside_label in [outside(v)]
    ]
    posted = [v.locked for v in priced.rounds if v.status == "posted" and v.locked is not None and not v.clawed_back]
    return GridRowOut(
        request_id=request.id,
        household_cm_id=request.household_cm_id,
        family_name=families.get(request.household_cm_id, f"Household {request.household_cm_id}"),
        person_cm_id=request.person_cm_id,
        camper_name=campers.get(request.person_cm_id, ""),
        session_cm_id=request.session_cm_id,
        session_name=session.name if session is not None else "",
        session_type=session.session_type if session is not None else "",
        program_key=priced.program_key,
        pool=priced.pool,
        request_status=request.status,
        tier=result.final_tier if result is not None else None,
        cost=_money(result.cost) if result is not None else None,
        rounds=views,
        total_decided=_total_decided(priced),
        total_posted=money(sum(posted, ZERO)) if posted else None,
        holds=[_issue(i) for i in priced.holds],
        released_holds=[
            ReleasedHoldOut(code=r.code, note=r.note, released_at=r.released_at, released_by=r.released_by)
            for code, r in sorted(hold.released.items())
            if priced.live and code in hold.released_codes() and code not in NEVER_A_HOLD
        ],
        notes=[_issue(i) for i in priced.notes],
        confirmation=_confirmation_out(confirmation) if confirmation is not None else None,
        cancellation=_cancellation_out(cancellation) if cancellation is not None else None,
        to_reverse=to_reverse,
        appeal_refusal=appeal,
        session_candidates=_candidates(request, sessions),
    )


def _pending_round(view: RoundOut, decided: Decimal | None) -> RoundOut:
    """C1 (owner 10-03): a round CampMinder covers in full with nothing blocking tonight's tick reads "Posted" and
    waits on the family at once, its CampMinder cell "pending". Its status and Posted figure still follow the tick
    (status needs_offer, posted None until tonight), so the posted money totals do too. `decided`: the round's decided
    amount while it is pending (Season.pending); None leaves the round as it is."""
    if decided is None:
        return view
    return view.model_copy(
        update={
            "cm_pending": True,
            "cm_pending_message": pending_text(decided),
            "status_label": ROUND_STATUS_LABELS["posted"],
        }
    )


def _awaiting_round(view: RoundOut, awaiting: Collection[int]) -> RoundOut:
    """V1 (owner 10-03): a posted round whose hand tick awaits tonight's sync reads CM ✓ "pending" with its line.
    `awaiting`: the request's rounds that do (row_of)."""
    if view.round not in awaiting:
        return view
    return view.model_copy(update={"cm_pending": True, "cm_pending_message": AWAITING_SYNC_TEXT})


def _count(count: Count) -> CountOut:
    return CountOut(families=count.families, requests=count.requests)


def _unconfirmed(cell: RoundCell) -> UnconfirmedOut | None:
    if cell.unconfirmed is None or cell.unconfirmed_count is None:
        return None
    return UnconfirmedOut(
        count=cell.unconfirmed_count.requests, families=cell.unconfirmed_count.families, amount=money(cell.unconfirmed)
    )


def _maybe_count(count: Count | None) -> CountOut | None:
    return _count(count) if count is not None else None


def _round_cell(n: int, cell: RoundCell) -> RoundCellOut:
    return RoundCellOut(
        round=n,
        posted=money(cell.posted),
        accepted=money(cell.accepted),
        needs_offer=money(cell.needs_offer),
        pending_approval=money(cell.pending_approval),
        needs_offer_count=_count(cell.needs_offer_count),
        pending_approval_count=_count(cell.pending_approval_count),
        unconfirmed=_unconfirmed(cell),
        committed=money(cell.committed),
    )


def _cell(cell: PoolCell) -> CellOut:
    return CellOut(
        allocated=_money(cell.allocated),
        posted=money(cell.posted),
        accepted=money(cell.accepted),
        needs_offer=money(cell.needs_offer),
        pending_approval=money(cell.pending_approval),
        remaining=_money(cell.remaining),
        needs_offer_count=_count(cell.needs_offer_count),
        pending_approval_count=_count(cell.pending_approval_count),
        unconfirmed=_unconfirmed(cell),
        committed=money(cell.committed),
    )


def _pool_out(pool: PoolBudget) -> PoolBudgetOut:
    return PoolBudgetOut(
        pool=pool.pool,
        label=pool.label,
        rounds=[_round_cell(n, cell) for n, cell in sorted(pool.rounds.items())],
        share_pct=float(pool.share_pct) if pool.share_pct is not None else None,
        total=_cell(pool.total),
        below=BelowTheLineOut(
            held=_count(pool.below.held),
            held_asked=money(pool.below.held_asked),
            outside_grants=money(pool.below.outside_grants),
            outside_budget=money(pool.below.outside_budget),
            outside_budget_posted=money(pool.below.outside_budget_posted),
            outside_grants_requests=_count(pool.below.outside_grants_requests),
        ),
        demand=ForwardDemandOut(
            round2_asks=_count(pool.demand.round2_asks),
            round2_asked=money(pool.demand.round2_asked),
            round2_computed=money(pool.demand.round2_computed),
            round1_unmet=money(pool.demand.round1_unmet),
            round1_unmet_requests=_count(pool.demand.round1_unmet_requests),
            round2_held=_count(pool.demand.round2_held),
            round2_held_asked=money(pool.demand.round2_held_asked),
            round1_held=_count(pool.demand.round1_held),
            round1_held_asked=money(pool.demand.round1_held_asked),
        ),
        decision_types=[
            DecisionTypeLineOut(
                key=t.key,
                label=t.label,
                counts_toward_budget=t.counts_toward_budget,
                amount=money(t.amount),
                posted=money(t.posted),
                own=money(t.own),
                requests=_count(t.requests),
            )
            for t in pool.decision_types
        ],
    )


def budget_out(year: int, rules: RulesVersion | None, budget: SeasonBudget) -> BudgetResponse:
    return BudgetResponse(
        year=year,
        rules_version=rules.version if rules is not None else None,
        pools=[_pool_out(p) for p in budget.pools],
        total=_pool_out(budget.total),
        strip=[
            RoundCountsOut(
                round=n,
                needs_offer=_count(c.needs_offer),
                posted=_count(c.posted),
                accepted=_count(c.accepted),
                held=_count(c.held),
                pending_approval=_count(c.pending_approval),
                awaiting_sync=_maybe_count(c.awaiting_sync),
                not_reconciled=_maybe_count(c.not_reconciled),
            )
            for n, c in sorted(budget.strip.items())
        ],
        outside_grants_off_requests=money(budget.outside_grants_off_requests),
    )


# Main spec §6.2: an as-of date is the whole of that day in camp time. The ledger's cutoff is the
# first instant after it; the folds and the replay keep what was recorded at or before theirs.
@dataclass(frozen=True)
class _PostingDay:
    """A withheld round's price at the end of its posting day (3c-2's past pricing): the season then, the request as
    priced then, and the amount, which is higher than today's decided (owner question 1's default)."""

    season: Season
    priced: PricedRequest
    amount: Decimal


_INSTANT: Final = timedelta(microseconds=1)


def as_of_instant(day: date) -> datetime:
    """The last instant of `day` in camp time (Pacific), in UTC."""
    return as_of_cutoff(day) - _INSTANT


def _gaps(figures: Sequence[str]) -> list[NotRebuiltOut]:
    return [NotRebuiltOut(figure=figure, reason=PAST_DATE_GAPS[figure]) for figure in figures]


def _past_gaps(figures: Sequence[str], season: Season) -> list[NotRebuiltOut]:
    """A past read's always-named gaps; cancellation lists the requests it keeps from being priced."""
    cancelled = sorted(rid for rid, gap in season.gapped.items() if gap == "cancellation")
    return [g.model_copy(update={"requests": cancelled}) if g.figure == "cancellation" else g for g in _gaps(figures)]


def _dated_by(corrections: Sequence[CorrectionRecord], at: datetime) -> list[CorrectionRecord]:
    return [c for c in corrections if (stamp := parse_pb_datetime(c.created)) is not None and stamp <= at]


# What PocketBase stores when a create omits the field: real camper-level create rows leave out the
# headcount fields, so a missing key is that default, never None.
_STORED_DEFAULTS: Final[Mapping[str, Any]] = {
    "person_cm_id": 0,
    "session_cm_id": 0,
    "program_option_text": "",
    "program_option_key": "",
    "ask": 0,
    "headcount_non_infant": 0,
    "headcount_infant": 0,
    "headcount_source": "",
    "duplicate_of": "",
    "flags": [],
    "equity": None,  # a json field a create omits is null: every create row from before 3c-2
}


def _requests_as_of(
    log: Sequence[LogRow], at: datetime, today: Sequence[RequestRecord]
) -> tuple[dict[str, RequestRecord], frozenset[str], frozenset[str]]:
    """Each request as it stood at `at`, replayed from its log, then the requests whose history can't
    be replayed, never read as state:
      - one that exists today keeps today's identity (household, person, session) and is returned in
        the second set: its history is incomplete, or its create row is missing;
      - one deleted since can't be shown at all, and is returned in the third set."""
    now = {r.id: r for r in today}
    rebuilt = replay(log, as_of=at, current={r.id: request_fields(r) for r in today})
    made = {row.entity_id for row in log if row.before is None}
    out: dict[str, RequestRecord] = {}
    unrebuilt: set[str] = set()
    deleted: set[str] = set()
    for request_id, record in rebuilt.items():
        if record.complete:
            if record.state is not None:
                out[request_id] = request_record(SimpleNamespace(id=request_id, **{**_STORED_DEFAULTS, **record.state}))
        elif request_id in now:
            out[request_id] = now[request_id]
            unrebuilt.add(request_id)
        elif record.state is not None:
            deleted.add(request_id)
        # else: an incomplete history that ends deleted by `at`: it provably wasn't there
    for request_id, request in now.items():
        if request_id not in made and request_id not in out:  # rows only after `at`, or none: no create to replay
            out[request_id] = request
            unrebuilt.add(request_id)
    # Logged, with no create row, absent today, and not replayed by `at` (rows only after it): deleted since.
    deleted |= {row.entity_id for row in log} - made - now.keys() - rebuilt.keys()
    return out, frozenset(unrebuilt), frozenset(deleted)


def _applications_as_of(
    log: Sequence[LogRow], at: datetime, today: Sequence[ApplicationRecord]
) -> tuple[dict[str, ApplicationRecord], frozenset[str]]:
    """Each application as it stood at `at`, replayed from its log (intake writes every application
    through 4a), and the applications whose history can't be replayed, never read as state (3c-2)."""
    now = {a.id: a for a in today}
    replayed = replay(log, as_of=at, current={a.id: application_fields(a) for a in today})
    bad = _unreplayable(now.keys(), log, replayed)
    return (
        {
            key: application_record(SimpleNamespace(id=key, **record.state))
            for key, record in replayed.items()
            if key not in bad and record.state is not None
        },
        bad,
    )


# 3c-2: the gaps that keep a request to 3c-1's figures, in the order they are checked; the first that
# applies names it. Every other request is priced exactly as live prices it.
_PRICING_GAPS: Final = (
    "rules_history",
    "request_history",
    "cancellation",
    "application_history",
    "pricing_shares_history",
    "equity_not_recorded",
    "grant_placement",
)
# Named apart: rules_history and request_history as 3c-1 names them, and cancellation on every past read (_past_gaps).
_NAMED_APART: Final = frozenset({"rules_history", "request_history", "cancellation"})


def _cancelled_in_campminder(
    requests: Mapping[str, RequestRecord],
    today: Sequence[RequestRecord],
    enrollments: Sequence[EnrollmentState],
    sessions: Sequence[SessionRow],
    day: date,
) -> frozenset[str]:
    """The requests live on `day` whose registration CampMinder had cancelled by then, as its registrations
    read today: a cancelled registration's enrollment_date is CampMinder's date for its current status, and
    the earliest one counts (live on that day already saw it); an undated one counts too. Under the record
    as it stood then or as it is now, since intake may have re-resolved its session since. One axis-free
    comparison: CampMinder dates the status, and Kindred records no time for it. A registration whose status
    changed after the day can't be seen (PAST_DATE_GAPS["cancellation"])."""
    session_types = {s.cm_id: s.session_type for s in sessions}
    now = {r.id: r for r in today}

    def by_then(record: RequestRecord) -> bool:
        cancelled, on = first_cancelled_on(record, enrollments, session_types)
        return cancelled and (on is None or on <= day)

    return frozenset(
        rid for rid, r in requests.items() if r.status in _LIVE and (by_then(r) or (rid in now and by_then(now[rid])))
    )


def _past_cancellations(
    requests: Mapping[str, RequestRecord],
    today: Sequence[RequestRecord],
    enrollments: Sequence[EnrollmentState],
    sessions: Sequence[SessionRow],
    day: date,
    kindred: Mapping[str, CancelState],
    cancelled_now: frozenset[str],
) -> dict[str, Cancellation]:
    """Decision 11: each request's cancellation as of `day`, built by the rule the past figures use, so 6(b)'s
    Appeals list (which reads the row's cancellation) agrees with Round 2 asks so far. CampMinder's first, dated by
    its latest cancelled registration on or before the day (`_cancelled_in_campminder`'s rule, under the record as
    it stood then or as it is now); else Kindred's as recorded by then. As cancellations_by_request orders them."""
    session_types = {s.cm_id: s.session_type for s in sessions}
    now = {r.id: r for r in today}
    out: dict[str, Cancellation] = {}
    for request_id, record in requests.items():
        state = kindred.get(request_id, CancelState())
        if request_id in cancelled_now:
            days = [
                on
                for r in (record, now.get(request_id))
                if r is not None
                for on in cancelled_days(r, enrollments, session_types)
                if on is not None and on <= day
            ]
            # The latest, as today's row shows (enrollment_cancelled), so a past read and today's agree.
            out[request_id] = Cancellation("campminder", max(days) if days else None, state.reason, state.note)
        elif state.in_kindred and record.status in _LIVE:
            on = camp_date(state.at) if state.at is not None else None
            out[request_id] = Cancellation("kindred", on, state.reason, state.note)
    return out


def _pricing_gap(
    request: RequestRecord,
    *,
    rules_known: bool,
    unrebuilt: bool,
    cancelled: bool,
    cancelled_now: bool,
    bad_applications: frozenset[str],
    bad_shares: frozenset[str],
    placed: PlacementsAsOf,
) -> str | None:
    """Which undated or unreplayable input keeps this request from being priced as of the date, if any.
    A request that wasn't live then (its status) shows only its posted rounds, exactly as live does, so none
    reaches it. One cancelled in Kindred by then also shows only those, but Decision 19 still counts the
    grants on it in its pool, so a grant with no logged placement reaches it. One whose registration CampMinder
    had cancelled by then (`cancelled_now`) can't be priced as live."""
    if not rules_known:
        return "rules_history"
    if unrebuilt:
        return "request_history"
    if request.status not in _LIVE:
        return None
    unplaced = (
        request.household_cm_id in placed.households
        or request.person_cm_id in placed.people
        or request.id in placed.requests
    )
    if cancelled:
        return "grant_placement" if unplaced else None
    if cancelled_now:
        return "cancellation"
    if request.application_id in bad_applications:
        return "application_history"
    if request.id in bad_shares:
        return "pricing_shares_history"
    if request.person_cm_id > 0 and request.equity is None:
        return "equity_not_recorded"
    return "grant_placement" if unplaced else None


def _posted_before_request(
    rounds: Mapping[str, Mapping[int, RoundState]], known: Collection[str]
) -> list[NotRebuiltOut]:
    """Fix round 1: on the campminder axis a back-dated tick can post a round of a request Kindred
    recorded only after the date. That request isn't shown then, and no row is invented for it, so its
    posting is named, never silently dropped. A request deleted since is already named request_deleted."""
    ids = sorted(
        rid for rid, by_round in rounds.items() if rid not in known and any(r.posted for r in by_round.values())
    )
    if not ids:
        return []
    return [NotRebuiltOut(figure="posted_before_request", reason=PAST_DATE_GAPS["posted_before_request"], requests=ids)]


def _home(
    request: RequestRecord, sessions: Mapping[int, SessionRow], rules: AidRules | None
) -> tuple[str | None, str | None]:
    """(program key, pool) live pricing gives the request (_to_price, then price_request): for a live
    request only, its program under the rules then (priced_program, shared with live), and that
    program's budget pool. Live also needs the request's application; the past read reads no answers,
    so it takes the application intake made with the request as there."""
    if rules is None or request.status not in _LIVE:
        return None, None
    key, _ = priced_program(request, sessions, rules)
    program = rules.programs.get(key) if key is not None else None
    return key, program.budget_pool if program is not None else None


def _gapped_pools(season: Season) -> frozenset[str] | None:
    """The pools a gap request sits in, as the budget places it (budget._home_pool: one with no pool sits in
    No pool); None, meaning every pool, when one can't be placed: the rules' or its history can't be replayed.
    A request deleted since can't be priced or placed at all, so every pool then (it may have sat in any)."""
    if season.deleted:
        return None
    pools: set[str] = set()
    for request_id, gap in season.gapped.items():
        priced = season.priced[request_id]
        if gap in ("rules_history", "request_history"):
            return None
        # A gap request that isn't live is one cancelled in Kindred (Decision 19: its grants stay in its pool).
        home = priced.pool or next((view.pool for view in priced.rounds if view.pool), None)
        pools.add(home or NO_POOL)
    return frozenset(pools)


def _masked(pool: str, gapped: frozenset[str] | None) -> bool:
    """Whether a past pool's priced figures stay empty: a gap request sits in it, or (the total) anywhere."""
    if gapped is None:
        return True
    return bool(gapped) if pool == TOTAL else pool in gapped


def _past_cell[C: _CellBase](cell: C, *, priced: bool, posted: bool) -> C:
    update: dict[str, Any] = (
        {}
        if priced
        else {"needs_offer": None, "pending_approval": None, "needs_offer_count": None, "pending_approval_count": None}
    )
    if not (priced and posted):
        update["committed"] = None
        if isinstance(cell, CellOut):
            update["remaining"] = None
    return cell.model_copy(update=update)


def _past_pool(pool: PoolBudgetOut, *, priced: bool, asks: bool, posted: bool) -> PoolBudgetOut:
    """One pool on a past date (3c-2): exact unless `priced` is False (a gap request sits in it), when
    Needs an offer, Pending approval, Remaining, the held figures, outside grants, outside the budget
    and the computed demand stay empty. Remaining also needs Posted (`posted`), and Round 2 asks so far
    every request's status (`asks`)."""
    demand: dict[str, Any] = (
        {}
        if priced
        else {
            "round2_computed": None,
            "round1_unmet": None,
            "round1_unmet_requests": None,
            "round1_held": None,
            "round1_held_asked": None,
            "round2_held": None,
            "round2_held_asked": None,
        }
    )
    if not asks:
        demand |= {"round2_asks": None, "round2_asked": None, "round2_held": None, "round2_held_asked": None}
    below: dict[str, Any] = (
        {}
        if priced
        else {
            "held": None,
            "held_asked": None,
            "outside_grants": None,
            "outside_grants_requests": None,
            "outside_budget": None,
        }
    )
    types = (
        pool.decision_types
        if priced
        else [t.model_copy(update={"amount": None, "own": None, "requests": None}) for t in pool.decision_types]
    )
    return pool.model_copy(
        update={
            "rounds": [_past_cell(cell, priced=priced, posted=posted) for cell in pool.rounds],
            "total": _past_cell(pool.total, priced=priced, posted=posted),
            "below": pool.below.model_copy(update=below),
            "demand": pool.demand.model_copy(update=demand),
            "decision_types": types,
        }
    )


def _posted_unknown(row: GridRowOut) -> GridRowOut:
    """A past row whose payer shares or staff placements can't be replayed: whether CampMinder had
    reversed its posted money is unknown, so the money is left empty (never guessed). A posted round's outside part
    is posted money too (A9), so it goes with it, as Rounds & budget empties outside_budget_posted."""
    rounds = [
        r.model_copy(
            update={
                "posted": None,
                "clawed_back": False,
                **({"outside_budget": None, "outside_label": None} if r.status == "posted" else {}),
            }
        )
        for r in row.rounds
    ]
    # A payer's Needs an offer part is measured from the posted total, so it goes with its posted part.
    shares = [s.model_copy(update={"posted": None, "needs_offer": None}) for s in row.payer_shares]
    return row.model_copy(update={"rounds": rounds, "total_posted": None, "notes": None, "payer_shares": shares})


def _decided_unknown(row: GridRowOut) -> GridRowOut:
    """A past row whose total decided is masked: its payers' parts of it are masked with it (⚠39), and the part of
    the rounds that need an offer, which reads the same decided amounts."""
    shares = [s.model_copy(update={"decided": None, "needs_offer": None}) for s in row.payer_shares]
    return row.model_copy(update={"notes": None, "total_decided": None, "payer_shares": shares})


def _emptied_posted(out: BudgetResponse) -> BudgetResponse:
    """The budget's posted and accepted figures, when some request's posted money is unknown."""

    def cell[C: _CellBase](cell: C) -> C:
        return cell.model_copy(update={"posted": None, "accepted": None})

    def pool(p: PoolBudgetOut) -> PoolBudgetOut:
        return p.model_copy(
            update={
                "rounds": [cell(c) for c in p.rounds],
                "total": cell(p.total),
                "below": p.below.model_copy(update={"outside_budget_posted": None}),
                "decision_types": [
                    t.model_copy(update={"posted": None, "amount": None, "own": None, "requests": None})
                    for t in p.decision_types
                ],
            }
        )

    return out.model_copy(
        update={
            "pools": [pool(p) for p in out.pools],
            "total": pool(out.total),
            "strip": [row.model_copy(update={"posted": None, "accepted": None}) for row in out.strip],
        }
    )


def past_budget(out: BudgetResponse, season: Season) -> BudgetResponse:
    """3c-2's past Rounds & budget: priced exactly as live wherever no gap request sits. A pool a gap
    request sits in, and the total, keep Allocated, Posted, Accepted, posted money outside the budget
    and Round 2 asks so far (unless a request's status is unknown); the season's strip keeps its posted
    and accepted counts. Money on no request stays empty while a grant by then has no logged placement."""
    gapped = _gapped_pools(season)
    asks = not season.unrebuilt
    posted = not season.posted_unknown
    emptied = [] if asks else _gaps(["round2_asks", "round2_asked"])
    posted_gaps = _gaps(POSTED_GAPS) if season.posted_unknown else []
    if season.posted_unknown:
        out = _emptied_posted(out)
    any_masked = _masked(TOTAL, gapped)
    return out.model_copy(
        update={
            "pools": [_past_pool(p, priced=not _masked(p.pool, gapped), asks=asks, posted=posted) for p in out.pools],
            "total": _past_pool(out.total, priced=not any_masked, asks=asks, posted=posted),
            "strip": [
                row.model_copy(update={"needs_offer": None, "held": None, "pending_approval": None})
                if any_masked
                else row
                for row in out.strip
            ],
            "outside_grants_off_requests": None if season.grants_unplaced else out.outside_grants_off_requests,
            "as_of": season.as_of,
            "as_of_axis": season.axis,
            "not_rebuilt": [*_past_gaps(BUDGET_GAPS, season), *emptied, *posted_gaps, *season.gaps],
        }
    )


def _refuse(reason: str | None) -> None:
    if reason is not None:
        raise DecisionRefusedError(reason)


# D67: 2026's rounds are loaded once, "read-only and labelled". Nothing undoes, (un)accepts or adds to them.
REPRODUCED_READ_ONLY: Final = "2026's decisions are reproduced from the repaired sheet and are read-only"


def _reproduced_refusal(rounds: Mapping[int, RoundState], n: int | None = None) -> str | None:
    """The refusal for a write on a reproduced round (round n), or on any round of a request that carries one."""
    states = rounds.values() if n is None else [rounds.get(n, RoundState(round=n))]
    return REPRODUCED_READ_ONLY if any(state.lock_source in LOADED for state in states) else None


def _ask_refusal(rounds: Mapping[int, RoundState], n: int) -> str | None:
    """Why a Round n ask can't be keyed now, or None. The write and the editor's preview share it (plan review I2)."""
    if rounds.get(n, RoundState(round=n)).posted:
        return f"Round {n} is posted; its ask can't change"
    if n == 2 and not rounds.get(1, RoundState(round=1)).posted:
        return (
            "Round 1 needs to show as posted before you can start an appeal. Once it's posted in CampMinder, this"
            " updates overnight. If it's waiting under Not reconciled, mark it posted there. If you meant to fix the"
            " original request, edit the Round 1 ask instead."
        )
    later = next((m for m in range(n + 1, 4) if rounds.get(m, RoundState(round=m)).posted), None)
    if later is not None:
        return f"Round {later} is posted and builds on Round {n}: its ask can't change now"
    return None


def _not_live(status: str) -> str:
    return f"a {status} request takes no new asks or amounts"


def _cancelled_refusal(cancellation: Cancellation | None) -> str | None:
    """Decision 14 as the owner widened it (2026-10-05): why a cancelled request takes no new decision, in the words
    of whoever cancelled it, or None when it isn't cancelled."""
    if cancellation is None:
        return None
    return CANCELLED_IN_KINDRED if cancellation.by == "kindred" else CANCELLED_IN_CAMPMINDER


def appeal_refusal(
    request: RequestRecord, rounds: Mapping[int, RoundState], cancellation: Cancellation | None
) -> str | None:
    """Why the request's Round 2 ask (an appeal) can't be keyed now, in key_ask's own words, or None (read 3): the
    grid's editor row says it instead of opening. key_ask refuses the same ways in the same order (_live, then
    _ask_refusal), so the row and the write never disagree."""
    if request.status not in _LIVE:
        return _not_live(request.status)
    return _cancelled_refusal(cancellation) or _ask_refusal(rounds, 2)


def _round3_refusal(rounds: Mapping[int, RoundState]) -> str | None:
    """Why a Round 3 amount can't be keyed yet, before the rules are read; shared with the preview."""
    state = rounds.get(3, RoundState(round=3))
    if state.posted:
        return "Round 3 is posted; its amount can't change"
    if state.ask is None:
        return "Key the family's Round 3 ask and statement of need first"
    return None


def _round3_unchanged(state: RoundState, amount: Decimal) -> bool:
    """Retyping the Round 3 amount already keyed is the write's no-op (a refused one may be keyed again)."""
    return state.award == amount and state.approval != "refused"


def _round3_rules_refusal(rounds: Mapping[int, RoundState], rules: AidRules, year: int) -> str | None:
    """Why the season's rules refuse a Round 3 amount (an appeal first); shared with the preview."""
    if rules.round3.require_round2 and rounds.get(2, RoundState(round=2)).ask is None:
        return f"The {year} rules give Round 3 only after a Round 2 appeal: key the family's Round 2 ask first"
    return None


def _payer_households(season: Season) -> set[int]:
    """Every household holding a payer share this season: a split row names each (⚠39)."""
    return {s.household_cm_id for shares in season.shares.values() for s in shares}


class FinancialAidDecisionsService:
    def __init__(
        self,
        store: DecisionsStore,
        rules: PricingRules,
        register: RegisterSource,
        *,
        clock: Callable[[], datetime] | None = None,
        log_placements: bool = True,
        labels: HouseholdLabeler | None = None,
    ) -> None:
        """`log_placements` False: this service's live pricing neither reads nor writes the grant placement
        log (3c-2). Only a scenario's frozen season and a rules approval's effect measurement (H3) pass it; neither
        is a read staff see, and neither writes."""
        self._store = store
        self._rules = rules
        self._register = register
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        self._logs_placements = log_placements
        # The household page's label helper: names a household-level grid row as Money and Grants name it. None: the
        # row falls back to its family name.
        self._labels = labels

    async def _request_side(self, year: int, *, names: bool) -> _RequestSide:
        rules, applications, requests, corrections = await asyncio.gather(
            self._rules.latest_approved(year, PRICING_SECTIONS),
            self._store.fetch_applications(year),
            self._store.fetch_requests(year),
            self._store.fetch_corrections(year, None),
        )
        people = sorted({r.person_cm_id for r in requests if r.person_cm_id > 0})
        households = {r.household_cm_id for r in requests}
        equity, enrollments, found = await asyncio.gather(
            self._store.fetch_equity_answers(year, people),
            self._store.fetch_enrollment_states(year, *_enrollment_scope(requests)),
            self._store.fetch_names(year, households, people) if names else _no_names(),
        )
        return _RequestSide(rules, applications, requests, corrections, equity, enrollments, found)

    async def _rounds_side(
        self, year: int
    ) -> tuple[list[SessionRow], list[PayerShareRecord], list[DecisionEvent], list[HoldEvent], Sequence[RegisterRow]]:
        return await asyncio.gather(
            self._store.fetch_sessions(year),
            self._store.fetch_payer_shares(year),
            self._store.fetch_decision_events(year),
            self._store.fetch_hold_events(year),
            self._register(year),
        )

    async def _ledger_side(
        self, year: int
    ) -> tuple[list[CampLine], dict[int, Placement], dict[int, tuple[SplitPart, ...]], datetime | None]:
        return await asyncio.gather(
            self._store.fetch_camp_lines(year),
            self._store.fetch_line_placements(year),
            self._store.fetch_line_splits(year),
            self._store.fetch_last_ledger_sync(year),
        )

    async def _past_ledger_side(self, year: int) -> _PastLedgerInputs | None:
        """What a past read needs of the ledger: the (dated) lines, and each undated record as it stands
        now, read BEFORE its change log, only as the replay's `current` (3c-1). With no lines there is
        nothing to place or claw back, and none of it is read. The payer shares are replayed once, by
        past_season, which prices with them too (3c-2)."""
        camp_lines, overrides = await asyncio.gather(
            self._store.fetch_camp_lines(year, recorded_times=True), self._store.fetch_line_overrides(year)
        )
        if not camp_lines:
            return None
        override_log = await self._store.fetch_change_log(year, AID_ATTRIBUTION_OVERRIDES)
        return _PastLedgerInputs(camp_lines, overrides, override_log)

    async def season(self, year: int) -> Season:
        """Every request of the season priced now, with its rounds and its holds (D21: the server decides)."""
        return (await self._season(year, names=False))[0]

    async def _season(self, year: int, *, names: bool) -> tuple[Season, Names]:
        """The season's loads run as five concurrent branches: the requests with what hangs off them
        (the names too, when asked), the sessions, shares, events and grants register, the CampMinder
        ledger (10b), the cancellation events (10b-2), and the grant placement log (3c-2). The registrations
        a cancellation reads hang off the requests, so they are read in the first branch, once the requests
        say whose to read. The register's placement is logged before anything is priced."""
        (
            side,
            (sessions, shares, events, hold_events, register),
            (camp_lines, placements, splits, synced_at),
            cancel_events,
            logged,
        ) = await asyncio.gather(
            self._request_side(year, names=names),
            self._rounds_side(year),
            self._ledger_side(year),
            self._store.fetch_cancellations(year),
            self._store.fetch_grant_placements(year) if self._logs_placements else _unlogged(),
        )
        if self._logs_placements:
            await self._log_placements(year, register, logged)
        enrollments = side.enrollments
        rules = side.rules
        rounds = fold_rounds(events)
        holds = fold_holds(hold_events)
        grants = grant_inputs_by_request(register)
        by_id = {a.id: a for a in side.applications}
        own: dict[str, list[CorrectionRecord]] = defaultdict(list)
        for correction in side.corrections:
            own[correction.application_id].append(correction)
        session_map = {s.cm_id: s for s in sessions}
        document = rules.document if rules is not None else None
        # Sub-project 10b-2: a cancelled request is not live (spec §5.3, Decision 14), so it is priced that way.
        cancellations = cancellations_by_request(side.requests, cancel_events, enrollments, sessions)
        cost_overrides = overrides_by_request(side.corrections)
        items = {
            r.id: with_holds(
                _to_price(
                    r,
                    by_id.get(r.application_id),
                    own.get(r.application_id, []),
                    session_map,
                    shares,
                    side.equity.get(r.person_cm_id),
                    rounds.get(r.id, {}),
                    tuple(grants.get(r.id, [])),
                    document,
                    cancelled=r.id in cancellations,
                ),
                holds.get(r.id, NO_HOLDS),
            )
            for r in side.requests
        }
        priced = {r.id: price_request(items[r.id], document) for r in side.requests}
        live_tiers: dict[str, int] = {}
        for request in side.requests:
            if request.id in cancellations:
                tier = _live_tier(request, by_id, own, session_map, shares, side.equity, grants, document)
                if tier is not None:
                    live_tiers[request.id] = tier
                # Decision 19: a cancelled request keeps the program and pool live pricing gives it, so
                # the grid still names them and its outside grants stay in its pool, not in No pool.
                key, pool = _home(request, session_map, document)
                priced[request.id] = replace(priced[request.id], program_key=key, pool=pool)
        # Sub-project 10b: the CampMinder ledger. Each camp-aid line on its one request (main spec §11),
        # money CampMinder reversed back in Remaining (D54), and the Note on unticked rows (D81).
        shares_of = _shares_by_request(shares)
        ledger = build_ledger(
            camp_lines,
            placements,
            [placeable(r, session_map, shares_of.get(r.id, ())) for r in side.requests],
            synced_at,
            _posted_ids(rounds),
            splits=splits,
        )
        reversed_on: dict[str, date] = {}
        for request in side.requests:
            scope = request_scope(request, shares_of.get(request.id, ()))
            unplaced = ledger.family_unplaced(scope)
            live = request.status in _LIVE
            lines = ledger.lines(request.id) if live else ledger.closed_lines(request.id)
            item, day = apply_clawback(
                priced[request.id],
                rounds.get(request.id, {}),
                lines,
                eligible=clawback_eligible(request.status, cancelled=request.id in cancellations),
                family_lines=ledger.family_lines(scope),
            )
            if day is not None:
                reversed_on[request.id] = day
            note = ledger_note(item, lines, unplaced) if year >= FIRST_TICKED_SEASON else None
            priced[request.id] = replace(item, notes=(*item.notes, note)) if note is not None else item
        # Owner ruling (a), 2026-10-02: a withdrawn or confirmed-duplicate request whose camp aid is still live in
        # CampMinder is To reverse whatever its enrollment says (and once that money is reversed it reads clawed back:
        # clawback_eligible). A duplicate_pending one is neither: it stays in Duplicates with its money Posted.
        to_reverse = frozenset(
            r.id
            for r in side.requests
            if (r.id in cancellations and any(line.live() for line in ledger.lines(r.id)))
            or (r.status in _CLOSED_REVERSIBLE and any(line.live() for line in ledger.closed_lines(r.id)))
        )
        season = Season(
            year=year,
            rules=rules,
            requests={r.id: r for r in side.requests},
            priced=priced,
            rounds=rounds,
            register=tuple(register),
            sessions=session_map,
            holds=holds,
            ledger=ledger,
            reversed_on=reversed_on,
            shares=shares_of,
            undone=undone_rounds(events),
            cancellations=cancellations,
            cancelled_in_campminder=frozenset(rid for rid, c in cancellations.items() if c.by == "campminder"),
            to_reverse=to_reverse,
            inputs=items,
            live_tiers=live_tiers,
            camp_lines=tuple(camp_lines),
            placements=placements,
            splits=splits,
            cost_overrides=cost_overrides,
        )
        return season, side.names

    async def _log_placements(
        self, year: int, register: Sequence[RegisterRow], logged: Sequence[PlacementRecord]
    ) -> None:
        """3c-2 (owner rulings 2026-09-30, 2026-10-01): log where the grants register placed each grant this
        pricing reads, so a past date can replay it. One operation as system:grant-placement, only for grants
        whose placement is new, changed or gone; nothing when the log already holds it. Strict: a failed write
        fails the read, since a placement priced but not logged would leave that day's past view wrong.
        Chunking is safe: each row stands alone, and the next read writes whatever a failed chunk left."""
        writes = placement_writes(year, register, logged)
        if writes:
            await self._store.commit(writes, actor=PLACEMENT_ACTOR, reason=PLACEMENT_REASON, allow_chunking=True)

    def _past_day(self, as_of: date | None) -> date | None:
        """The past date a read shows, or None for the live read (no date, or today or later in camp time)."""
        if as_of is None or as_of >= self._today():
            return None
        return as_of

    async def _rules_as_of(self, year: int, at: datetime) -> tuple[RulesVersion | None, tuple[NotRebuiltOut, ...]]:
        try:
            return await self._rules.approved_as_of(year, PRICING_SECTIONS, at), ()
        except RulesHistoryIncompleteError:
            return None, tuple(_gaps(["rules_history"]))

    async def rules_on(
        self, year: int, days: Collection[date]
    ) -> tuple[dict[date, RulesVersion | None], frozenset[date]]:
        """The rules version that priced the season at the end of each day (camp time), from one read of the
        rules history (D16b), and apart, the days whose history can't be replayed."""
        ends = {as_of_instant(day): day for day in days}
        found, unknown = await self._rules.approved_as_of_each(year, PRICING_SECTIONS, ends.keys())
        return {ends[at]: version for at, version in found.items()}, frozenset(ends[at] for at in unknown)

    async def since_inputs(self, season: Season, ticks: Sequence[LedgerTick]) -> SinceInputs | None:
        """D16b's loads for these ticks, once (moved here from To place, so the placement, the overnight tick and a
        person's tick read the same): everything recorded after the end of the earliest posting day, and the rules
        at the end of each. None when every tick is dated today (nothing can be after it)."""
        now = self._clock()
        days = sorted({t.posted_on for t in ticks if as_of_instant(t.posted_on) < now})
        if not days:
            return None
        records, (rules_at, unknown) = await asyncio.gather(
            self._store.fetch_changed_since(
                season.year, as_of_instant(days[0]), persons=reads_person_fields(season.rules)
            ),
            self.rules_on(season.year, days),
        )
        return SinceInputs(
            now=now, history_from=now - SYNC_HISTORY, records=records, rules_at=rules_at, rules_unknown=unknown
        )

    async def _withheld(
        self, season: Season, ticks: Sequence[LedgerTick]
    ) -> list[tuple[LedgerTick, tuple[ChangedReason, ...]]]:
        """D152 (owner, B1 Q1 2026-10-02): money a person placed is the placement's to tick, so a round D16 withholds
        there stays withheld at night too, for a person to tick at its posting-day price. The rest (money CampMinder
        posted to the camper) is the overnight tick's own, priced at the sync (SP10b-1 Decision 2). Withheld is per
        request and as broad as D16's check: a later camper-posted round, or a top-up of a short placement, on a
        request with a placed line waits too. The ticks among `ticks` it holds, with why."""
        placed = on_placed_money(season, ticks)
        if not placed:
            return []
        _, held = withhold(season, placed, await self.since_inputs(season, placed))
        return held

    async def _without_withheld(self, season: Season, ticks: Sequence[LedgerTick]) -> list[LedgerTick]:
        """The ticks the overnight tick writes: `ticks` less the ones D152 withholds (`_withheld`)."""
        left = {(tick.request_id, tick.round) for tick, _ in await self._withheld(season, ticks)}
        return [tick for tick in ticks if (tick.request_id, tick.round) not in left]

    async def with_unticked(self, season: Season) -> Season:
        """D162: Requests › Not reconciled's direction (b), on the live read from the first ticked season. For every
        round CampMinder holds money for that has no Posted tick, why: the overnight tick's own walk (ledger_walk, the
        rule ledger_ticks runs, so the two can't disagree) says where it stopped, and a round it would tick is either
        held by D152 (`withheld`, the same check the overnight tick runs) or is pending tonight's tick (C1, owner
        10-03: `pending`, no reason). The rows these mark are those D81's Note marks, less an over-posting with nothing
        asked for the next round (H1, direction a's). A round decided at $0 is a reason too (owner 10-03:
        `decided_zero`, "Decided $0"), on any round, beside direction (a)'s "over" on a later one. The Requests grid,
        Today and the household page read it (row_of), as do Rounds & budget's Needs an offer counts, the March file
        and the Accepted tick; D16's load runs only when such a round sits on money a person placed. A reason offers
        Mark posted only on the request's first unposted round, the only one tick_posted takes alone (H3)."""
        if season.as_of is not None or not season.ledger.read or season.year < FIRST_TICKED_SEASON:
            return season
        ledger = season.ledger
        walk = ledger_walk(
            season.priced.values(),
            ledger,
            today=self._today(),
            undone=season.undone,
            family_unplaced={
                rid: ledger.family_unplaced(request_scope(request, season.shares.get(rid, ())))
                for rid, request in season.requests.items()
            },
            split=frozenset(rid for rid, shares in season.shares.items() if len(shares) > 1),
        )
        held = {(tick.request_id, tick.round): reasons for tick, reasons in await self._withheld(season, walk.ticks)}

        def first(request_id: str, n: int) -> bool:
            return all(
                v.status == "posted" for v in season.priced[request_id].rounds if v.round < n
            )  # H3: tick_posted's "mark Round m posted before Round n"

        found: dict[str, list[Unticked]] = defaultdict(list)
        pending: dict[tuple[str, int], Decimal] = {}
        for tick in walk.ticks:
            reasons = held.get((tick.request_id, tick.round))
            if reasons is None:
                pending[(tick.request_id, tick.round)] = tick.amount
                continue
            why = withheld_why(tick, reasons)
            found[tick.request_id].append(Unticked(tick.round, "withheld", why, first(tick.request_id, tick.round)))
        for stop in walk.stops:
            found[stop.request_id].append(
                Unticked(stop.round, stop.code, stop_text(stop), first(stop.request_id, stop.round))
            )
        return replace(season, unticked={rid: tuple(items) for rid, items in found.items()}, pending=pending)

    async def _posting_day_locks(
        self, season: Season, keys: Collection[tuple[str, int]]
    ) -> dict[tuple[str, int], _PostingDay]:
        """A withheld round keeps its posting-day price (D152; owner, B1 Q1 2026-10-02; Group 3a Q5; S1 Q1). Among
        `keys`, the rounds D16 withholds (the ledger's own tick on money a person placed, with something that prices
        the request recorded after its posting day), each priced as of the end of that day. Kept only where 3c-2
        rebuilds the request exactly then, the round was decided then, and that is higher than today's: an award that
        rose since locks today's (owner question 1), and one Kindred can't rebuild locks today's (owner question 2).
        One withheld round per request per tick, whose earlier rounds stand as they did on the posting day; otherwise
        today's, as before. One past pricing per distinct posting day (concurrently), only when a ticked round is
        withheld."""
        # a person is ticking it, so their own earlier undo doesn't matter here
        everything = ledger_ticks(season.priced.values(), season.ledger, today=self._today(), undone=frozenset())
        ticks = [t for t in on_placed_money(season, everything) if (t.request_id, t.round) in keys]
        if not ticks:
            return {}
        _, held = withhold(season, ticks, await self.since_inputs(season, ticks))
        by_request: dict[str, list[LedgerTick]] = defaultdict(list)
        for tick, _ in held:
            by_request[tick.request_id].append(tick)
        days = sorted({mine[0].posted_on for mine in by_request.values()})
        pasts = dict(zip(days, await asyncio.gather(*(self.past_season(season.year, d) for d in days)), strict=True))
        found: dict[tuple[str, int], _PostingDay] = {}
        for request_id, mine in by_request.items():
            if len(mine) != 1:
                continue  # several rounds at once: today's for all, so each prices against the lock before it
            (tick,) = mine
            past = pasts[tick.posted_on]
            then, now = past.priced.get(request_id), season.priced[request_id]
            view = then.view(tick.round) if then is not None else None
            if (
                then is None
                or view is None
                or past.rules is None
                or request_id in past.gapped
                or view.status != "needs_offer"
                or view.decided is None
                or view.decided <= tick.amount
                or any(  # an earlier round must stand as it did then, so this round prices against the same lock
                    (a := then.view(m)) is None
                    or (b := now.view(m)) is None
                    or (a.status, a.locked) != (b.status, b.locked)
                    for m in range(1, tick.round)
                )
            ):
                continue
            found[(request_id, tick.round)] = _PostingDay(past, then, view.decided)
        return found

    async def past_season(self, year: int, day: date, axis: AsOfAxis = "campminder") -> Season:
        """The season by the end of `day`, camp time, priced (3c-2): applications, requests and payer
        shares replayed from aid_change_log; the corrections, events, hold events and Kindred's
        cancellations dated by then; the rules replayed to then; and each grant where the placement log
        had it then. Every request is priced exactly as live prices it (_to_price -> with_holds ->
        price_request), with the camper's equity answers as intake had recorded them. A request an undated
        or unreplayable input reaches (_PRICING_GAPS) keeps 3c-1's figures (as_of.price_as_of) and is
        named. On the campminder axis the Posted ticks and grant lines CampMinder dated by `day` count too
        (posted_by); everything with no CampMinder date cuts on when Kindred recorded it, on both axes.
        CampMinder dates only a registration's current status (10b-2 Decision 21): a request whose registration
        CampMinder had cancelled by `day`, by that date, keeps 3c-1's figures and its pool is left empty (the
        cancellation gap); one whose status changed since can't be seen."""
        at = as_of_instant(day)
        posted_by = day if axis == "campminder" else None
        rules_read = asyncio.create_task(self._rules_as_of(year, at))
        try:
            # Today's records settle same-instant clashes in the log, so they are read to completion
            # BEFORE the log reads start (approved_as_of orders its reads the same way). The rules
            # read, and the other reads, overlap freely.
            today, applications_now, shares_now = await asyncio.gather(
                self._store.fetch_requests(year),
                self._store.fetch_applications(year),
                self._store.fetch_payer_shares(year),
            )
            # Three branches (asyncio.gather types at most six), run concurrently: the change logs with the
            # corrections and sessions; the dated rows, today's register and today's registrations; and the
            # ledger. Today's request records say whose registrations to read.
            (
                (log, app_log, share_log, grant_log, corrections, sessions),
                (events, hold_events, cancel_events, logged, register, enrollments),
                ledger_in,
            ) = await asyncio.gather(
                asyncio.gather(
                    self._store.fetch_change_log(year, AID_REQUESTS),
                    self._store.fetch_change_log(year, AID_APPLICATIONS),
                    self._store.fetch_change_log(year, AID_PAYER_SHARES),
                    self._store.fetch_change_log(year, AID_GRANTS),
                    self._store.fetch_corrections(year, None),
                    self._store.fetch_sessions(year),
                ),
                asyncio.gather(
                    self._store.fetch_decision_events(year),
                    self._store.fetch_hold_events(year),
                    self._store.fetch_cancellations(year),
                    self._store.fetch_grant_placements(year),
                    self._register(year),  # today's, only to find the grants the log can't place
                    self._store.fetch_enrollment_states(  # today's: CampMinder dates only the current status
                        year,
                        {r.person_cm_id for r in today if r.person_cm_id > 0},
                        {r.household_cm_id for r in today if r.person_cm_id <= 0},
                    ),
                ),
                self._past_ledger_side(year),
            )
            rules, gaps = await rules_read
        finally:
            rules_read.cancel()
            await asyncio.gather(rules_read, return_exceptions=True)  # retrieve its exception, if it had one
        requests, unrebuilt, deleted = _requests_as_of(log, at, today)
        applications, bad_applications = _applications_as_of(app_log, at, applications_now)
        shares_of, bad_shares, bad_share_households = _shares_as_of(shares_now, share_log, at)
        shares = [share for group in shares_of.values() for share in group]
        placed = placements_as_of(logged, register, grant_log, at, posted_by=posted_by)
        grants = grant_inputs_by_request(placed.rows)
        rounds = fold_rounds(events, as_of=at, posted_by=posted_by)
        holds = fold_holds(hold_events, as_of=at)
        # Decision 21: a cancellation in Kindred is dated, so it applies as of the date (on created, on
        # both axes). CampMinder's is read from today's registrations, dated by their current status: a request
        # whose registration CampMinder had cancelled by the day isn't priced as live then (the cancellation
        # gap); one whose status changed since (re-enrolled, cancelled again, removed) can't be seen.
        kindred_states = fold_cancellations(cancel_events, as_of=at)
        in_kindred = {rid for rid, state in kindred_states.items() if state.in_kindred}
        cancelled_now = _cancelled_in_campminder(requests, today, enrollments, sessions, day)
        session_map = {s.cm_id: s for s in sessions}
        own: dict[str, list[CorrectionRecord]] = defaultdict(list)
        for correction in _dated_by(corrections, at):
            own[correction.application_id].append(correction)
        document = rules.document if rules is not None else None
        rules_known = not any(gap.figure == "rules_history" for gap in gaps)
        priced: dict[str, PricedRequest] = {}
        gapped: dict[str, str] = {}
        live_tiers: dict[str, int] = {}
        for request_id, request in requests.items():
            cancelled = request_id in in_kindred
            gap = _pricing_gap(
                request,
                rules_known=rules_known,
                unrebuilt=request_id in unrebuilt,
                cancelled=cancelled,
                cancelled_now=request_id in cancelled_now,
                bad_applications=bad_applications,
                bad_shares=bad_shares,
                placed=placed,
            )
            hold = holds.get(request_id, NO_HOLDS)
            mine = own.get(request.application_id, [])
            if gap in (None, "grant_placement"):
                full = price_request(
                    with_holds(
                        _to_price(
                            request,
                            applications.get(request.application_id),
                            mine,
                            session_map,
                            shares,
                            request.equity,  # intake's recorded copy as it stood (3c-2)
                            rounds.get(request_id, {}),
                            tuple(grants.get(request_id, [])) if gap is None else (),
                            document,
                            cancelled=cancelled,
                        ),
                        hold,
                    ),
                    document,
                )
                if gap is None:
                    if cancelled:
                        # Decision 19, as live: a cancelled request keeps the program and pool live pricing gives it.
                        key, pool = _home(request, session_map, document)
                        full = replace(full, program_key=key, pool=pool)
                        # Reports, as live: the income tier of a cancelled request, read by pricing it live once.
                        tier = _live_tier(
                            request,
                            applications,
                            own,
                            session_map,
                            shares,
                            {request.person_cm_id: request.equity} if request.equity is not None else {},
                            grants,
                            document,
                        )
                        if tier is not None:
                            live_tiers[request_id] = tier
                    priced[request_id] = full
                    continue
            gapped[request_id] = gap
            rebuilt = gap != "request_history"
            program_key, pool = _home(request, session_map, document) if rebuilt else (None, None)
            ask = effective_ask(request, mine)
            kept = price_as_of(
                request_id,
                request.household_cm_id,
                rounds.get(request_id, {}),
                document,
                live=rebuilt and request.status in _LIVE and not cancelled,
                r1_ask=Decimal(ask.effective) if rebuilt and ask.effective != "" else None,
                hold=hold,
                pool=pool,
                program_key=program_key,
            )
            # Its tier and cost come before the grants step, so they are exact without the placement.
            priced[request_id] = replace(kept, result=full.result) if gap == "grant_placement" else kept
        # Sub-project 10b: money CampMinder had reversed by then is back in Remaining on that date too
        # (D54), so Posted stays exact. Everything the ledger reads is as of the date: the lines are
        # dated (on the recorded axis, also by when Kindred recorded them), and the payer shares and
        # staff placements are replayed from their change logs. A request whose shares or placements
        # can't be replayed keeps its posted money empty, and is named. D81's Note reads the same dated
        # lines. Undated, still today's: a line's funder-type reclassification and Go's attribution.
        posted_unknown: frozenset[str] = frozenset()
        past_ledger: SeasonLedger | None = None
        if ledger_in is not None:
            ledger_gaps, posted_unknown, past_ledger = self._ledger_as_of(
                ledger_in,
                at,
                axis,
                requests,
                session_map,
                rounds,
                priced,
                (shares_of, bad_shares, bad_share_households),
                # As live's cancellations_by_request and _past_cancellations: a Kindred cancellation counts
                # only on a request live then, so a pending duplicate's money stays Posted on both reads.
                cancelled=frozenset(r for r in in_kindred if r in requests and requests[r].status in _LIVE)
                | cancelled_now,
                notes=year >= FIRST_TICKED_SEASON,
            )
            gaps = (*gaps, *ledger_gaps)
        grants_unplaced = bool(placed.households or placed.people or placed.requests)
        named = [
            NotRebuiltOut(figure=code, reason=PAST_DATE_GAPS[code], requests=ids)
            for code in _PRICING_GAPS
            if code not in _NAMED_APART
            and (
                (ids := sorted(r for r, g in gapped.items() if g == code))
                or (code == "grant_placement" and grants_unplaced)
            )
        ]
        gaps = (*gaps, *self._unresolved(priced, unrebuilt, deleted, named_pools=rules is not None), *named)
        if axis == "campminder":
            gaps = (*gaps, *_posted_before_request(rounds, requests.keys() | deleted))
        cost_overrides = overrides_by_request(_dated_by(corrections, at))
        return Season(
            year=year,
            rules=rules,
            requests=requests,
            priced=priced,
            rounds=rounds,
            register=placed.rows,
            sessions=session_map,
            holds=holds,
            shares=shares_of,  # the replayed payer shares: a past row's split rows and payer names read them (⚠39)
            as_of=day,
            axis=axis,
            gaps=gaps,
            unrebuilt=unrebuilt,
            posted_unknown=posted_unknown,
            gapped=gapped,
            shares_unknown=bad_shares,
            grants_unplaced=grants_unplaced,
            deleted=deleted,
            cost_overrides=cost_overrides,
            cancelled_in_campminder=cancelled_now,
            past_ledger=past_ledger,
            live_tiers=live_tiers,
            cancellations=_past_cancellations(
                requests, today, enrollments, sessions, day, kindred_states, cancelled_now
            ),
        )

    @staticmethod
    def _ledger_as_of(
        inputs: _PastLedgerInputs,
        at: datetime,
        axis: AsOfAxis,
        requests: Mapping[str, RequestRecord],
        sessions: Mapping[int, SessionRow],
        rounds: Mapping[str, Mapping[int, RoundState]],
        priced: dict[str, PricedRequest],
        shares_as_of: tuple[dict[str, tuple[PayerShareRecord, ...]], frozenset[str], frozenset[int]],
        *,
        cancelled: frozenset[str],
        notes: bool = False,
    ) -> tuple[list[NotRebuiltOut], frozenset[str], SeasonLedger]:
        """Clawbacks as of `at` (only a cancelled-by-then or closed request is clawed back, `clawback_eligible`;
        `cancelled` is the requests cancelled by the day, in Kindred or CampMinder), and with `notes` (a ticked season) D81's Note as live adds it (3c-2), applied
        to `priced` in place; the gaps and the requests whose posted money is left empty (their shares or
        placements can't be replayed). On the campminder axis the lines cut on CampMinder's post and reversal
        dates; on recorded, also on when Kindred had recorded each line and its reversal (as_recorded, ruling
        C), so everything below reads that set. It also returns the ledger it placed, which `past_season` keeps as
        `Season.past_ledger`."""
        camp_lines = inputs.camp_lines if axis == "campminder" else as_recorded(inputs.camp_lines, at)
        shares_of, bad_shares, bad_share_households = shares_as_of
        placements, splits, bad_txns, bad_people = _placements_as_of(inputs.overrides, inputs.override_log, at)
        ledger = build_ledger(
            camp_lines,
            placements,
            [placeable(r, sessions, shares_of.get(r.id, ())) for r in requests.values()],
            None,
            _posted_ids(rounds),
            at,
            splits=splits,
        )
        behind = [line for line in camp_lines if line.transaction_cm_id in bad_txns]
        bad_households = {line.household_cm_id for line in behind}
        bad_people |= {line.person_cm_id for line in behind if line.person_cm_id > 0}
        posted = _posted_ids(rounds)
        by_shares = sorted(
            rid
            for rid, r in requests.items()
            if rid in posted and (rid in bad_shares or bad_share_households & request_scope(r, shares_of.get(rid, ())))
        )
        by_placements = (
            sorted(
                rid
                for rid, r in requests.items()
                if rid in posted
                and rid not in by_shares
                and (r.person_cm_id in bad_people or bad_households & request_scope(r, shares_of.get(rid, ())))
            )
            if bad_txns or bad_people
            else []
        )
        unknown = frozenset(by_shares) | frozenset(by_placements)
        for request_id, request in requests.items():
            if request_id in unknown:
                continue
            lines = ledger.lines(request_id) if request.status in _LIVE else ledger.closed_lines(request_id)
            scope = request_scope(request, shares_of.get(request_id, ()))
            item, _ = apply_clawback(
                priced[request_id],
                rounds.get(request_id, {}),
                lines,
                eligible=clawback_eligible(request.status, cancelled=request_id in cancelled),
                at=at,
                family_lines=ledger.family_lines(scope),
            )
            note = ledger_note(item, lines, ledger.family_unplaced(scope), at=at) if notes else None
            priced[request_id] = replace(item, notes=(*item.notes, note)) if note is not None else item
        gaps = [
            NotRebuiltOut(figure="ledger_classification", reason=PAST_DATE_GAPS["ledger_classification"]),
            *(
                NotRebuiltOut(figure=figure, reason=PAST_DATE_GAPS[figure], requests=ids)
                for figure, ids in (("payer_shares_history", by_shares), ("line_placements_history", by_placements))
                if ids
            ),
        ]
        return gaps, unknown, ledger

    @staticmethod
    def _unresolved(
        priced: Mapping[str, PricedRequest], unrebuilt: frozenset[str], deleted: frozenset[str], *, named_pools: bool
    ) -> list[NotRebuiltOut]:
        """The gaps a past rebuild names: requests whose history can't be replayed, requests deleted
        since that can't be shown, and requests in the budget whose home pool can't be resolved (they
        sit in No pool). With no rules by then every pool is unknown, and the rules gap covers it."""
        out: list[NotRebuiltOut] = []
        if deleted:
            out.append(
                NotRebuiltOut(
                    figure="request_deleted", reason=PAST_DATE_GAPS["request_deleted"], requests=sorted(deleted)
                )
            )
        if unrebuilt:
            out.append(
                NotRebuiltOut(
                    figure="request_history", reason=PAST_DATE_GAPS["request_history"], requests=sorted(unrebuilt)
                )
            )
        homeless = sorted(  # in No pool, as the budget places it (budget._home_pool)
            rid for rid, p in priced.items() if p.rounds and p.pool is None and not any(v.pool for v in p.rounds)
        )
        if homeless and named_pools:
            out.append(NotRebuiltOut(figure="pool_unknown", reason=PAST_DATE_GAPS["pool_unknown"], requests=homeless))
        return out

    async def _season_for(self, year: int, as_of: date | None, axis: AsOfAxis) -> Season:
        day = self._past_day(as_of)
        return await self.season(year) if day is None else await self.past_season(year, day, axis)

    def _budget(self, season: Season, *, confirmed: bool = False) -> SeasonBudget:
        # The register's money, not the calculator's inputs: a pays-after-camp-aid grant (D143) never
        # reaches the calculator but is still outside money below the line (D125).
        by_request = outside_grants_by_request(season.register)
        off = sum(
            (
                row.amount
                for row in season.register
                if counts_as_outside(row.counts, row.funder_type) and not row.requests
            ),
            ZERO,
        )
        document = season.rules.document if season.rules is not None else None
        return season_budget(
            season.priced.values(),
            document,
            outside_grants=by_request,
            outside_grants_off_requests=off,
            not_demand=season.cancelled_in_campminder,
            ledger=self._round_ledgers(season) if confirmed else None,
            off_list=season.in_campminder(),  # C2: empty unless the read ran with_unticked (budget() does)
        )

    def budget_of(self, season: Season) -> SeasonBudget:
        """The season's budget figures, exactly as the Rounds & budget read computes them. Scenarios (sub-project
        9b) price through this service and read their figures here."""
        return self._budget(season)

    async def grid(
        self, year: int, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder"
    ) -> RequestsGridResponse:
        day = self._past_day(as_of)

        async def load() -> tuple[Season, dict[int, str], dict[int, str]]:
            if day is None:
                live, (fam, cam) = await self._season(year, names=True)
                live = await self.with_unticked(live)
                unnamed = _payer_households(live) - fam.keys()
                if unnamed:  # a household that pays a share but applied for nothing (⚠39)
                    more, _ = await self._store.fetch_names(year, unnamed, set())
                    fam = {**fam, **more}
                return live, fam, cam
            past = await self.past_season(year, day, as_of_axis)
            fam, cam = await self._store.fetch_names(
                year,
                {r.household_cm_id for r in past.requests.values()} | _payer_households(past),
                {r.person_cm_id for r in past.requests.values() if r.person_cm_id > 0},
            )
            return past, fam, cam

        # The aid form's contact names (Requested by) are read once, beside the season's own loads.
        (season, families, campers), contacts = await asyncio.gather(load(), self._store.fetch_fa_contacts(year))
        requesters = requester_names(contacts, season.requests.values())
        rows = [self.row_of(season, (families, campers), rid, requesters) for rid in season.priced]
        rows = await self._with_household_labels(year, rows)
        if season.as_of is not None:
            # 3c-2: a row is exact unless a gap reaches its request; then it keeps 3c-1's figures. Every past
            # row leaves out what CampMinder's cancellations and the ledger's sync time feed (GRID_GAPS). Included
            # reads the row's cancellation as of the day (Decision 11), so it is filled, except for a request whose
            # status can't be replayed (request_history), where it and the to-dos (none since owner ruling B,
            # 2026-10-04) stay empty with its status.
            rows = [
                row.model_copy(
                    update={
                        "queues": None,
                        "unticked": None,
                        "rounds": [
                            r.model_copy(update={"cm_pending": None, "cm_pending_message": None}) for r in row.rounds
                        ],
                        "to_reverse": None,
                        "appeal_refusal": None,
                        **(
                            {"included": None, "todos": None, "request_status": None}
                            if row.request_id in season.unrebuilt
                            else {}
                        ),
                    }
                )
                for row in rows
            ]
            # The Stage reads the status alone here (cm_pending is not rebuilt), so it is no GRID_GAPS figure.
            rows = [row.model_copy(update={"stage": row_stage(row)}) for row in rows]
            rows = [_decided_unknown(row) if row.request_id in season.gapped else row for row in rows]
            rows = [
                row.model_copy(update={"payer_count": None, "payer_shares": []})
                if row.request_id in season.shares_unknown
                else row
                for row in rows
            ]
            rows = [_posted_unknown(row) if row.request_id in season.posted_unknown else row for row in rows]
        rows.sort(key=lambda r: (r.family_name.lower(), r.household_cm_id, r.camper_name.lower(), r.request_id))
        rules_version = season.rules.version if season.rules is not None else None
        past = season.as_of is not None
        return RequestsGridResponse(
            year=year,
            rules_version=rules_version,
            rows=rows,
            as_of=season.as_of,
            as_of_axis=season.axis,
            ticked_season=year >= FIRST_TICKED_SEASON,
            not_rebuilt=[
                *_past_gaps(GRID_GAPS, season),
                *(_gaps(["posted"]) if season.posted_unknown else []),
                *season.gaps,
            ]
            if past
            else [],
        )

    async def _with_household_labels(self, year: int, rows: list[GridRowOut]) -> list[GridRowOut]:
        """A household-level row (no camper) reads the household's label as Money and Grants name it, the tie-break
        scoped to the grid's household-level rows; with no label read it falls back to its family name. A camper row
        keeps "" (the grid names its camper)."""
        households = {r.household_cm_id for r in rows if r.person_cm_id <= 0}
        named = await self._labels(year, households) if self._labels is not None and households else {}
        out: list[GridRowOut] = []
        for row in rows:
            if row.person_cm_id > 0:
                out.append(row)
                continue
            label = named.get(row.household_cm_id)
            out.append(
                row.model_copy(
                    update={
                        "household_label": (label.label if label is not None else "") or row.family_name,
                        "household_label_tiebreak": label.tiebreak if label is not None else "",
                    }
                )
            )
        return out

    def row_of(
        self,
        season: Season,
        names: Names,
        request_id: str,
        requesters: Mapping[str, str | None] | None = None,
    ) -> GridRowOut:
        """One request's grid row, with the Requests views it is in (slice 1, D21). The grid and the
        household page build their rows here, so the two always show the same figures."""
        families, campers = names
        rules = season.rules.document if season.rules is not None else None
        row = grid_row(
            season.requests[request_id],
            season.priced[request_id],
            season.rounds.get(request_id, {}),
            season.sessions,
            families,
            campers,
            season.holds.get(request_id, NO_HOLDS),
            confirmation=self._confirmation(season, request_id),
            cancellation=season.cancellations.get(request_id),
            to_reverse=request_id in season.to_reverse,
            appeal=appeal_refusal(
                season.requests[request_id], season.rounds.get(request_id, {}), season.cancellations.get(request_id)
            ),
            type_labels={k: t.label for k, t in rules.awards.decision_types.items()} if rules is not None else None,
        )
        request = season.requests[request_id]
        program = rules.programs.get(row.program_key) if rules is not None and row.program_key else None
        description = (program.campminder_description or None) if program is not None else None
        priced = season.priced[request_id]
        without: CostResolution | None = None
        if rules is not None and priced.inputs is not None:
            without = resolve_cost(priced.inputs.model_copy(update={"cost_override": None}), rules)
        listed = (
            without
            if without is not None and without.amount is not None and without.source in ("catalog", "per_person")
            else None
        )
        standing = season.cost_overrides.get(request_id)
        parsed = parse_cost_override(standing.new_value) if standing is not None else None
        paying = payers(request_id, request.household_cm_id, season.shares.get(request_id, ()))
        # V1 (owner 10-03): while the request reads awaiting_sync, each posted round whose own hand tick awaits
        # tonight's sync is CM ✓ "pending" (its Not reconciled exclusion is Confirmation.reconciled's).
        awaiting = (
            {
                r.round
                for r in row.rounds
                if r.status == "posted"
                and not r.clawed_back
                and awaits_sync(season.rounds.get(request_id, {}).get(r.round), season.ledger.synced_at)
            }
            if row.confirmation is not None and row.confirmation.status == "awaiting_sync"
            else set()
        )
        row = row.model_copy(
            update={
                "unticked": [
                    UntickedMoneyOut(
                        round=u.round,
                        code=u.code,
                        message=u.message,
                        mark_posted=u.mark_posted,
                        label=UNTICKED_LABELS[u.code],
                    )
                    for u in season.unticked.get(request_id, ())
                ],
                "rounds": [
                    _awaiting_round(_pending_round(r, season.pending.get((request_id, r.round))), awaiting)
                    for r in row.rounds
                ],
            }
        )
        return row.model_copy(
            update={
                "queues": row_queues(row),
                "stage": row_stage(row),
                "payer_count": len(paying),
                "payer_shares": grid_shares(row, paying, families),
                "campminder_description": description,
                "requested_by": (requesters or {}).get(request_id),
                "cost_override": (
                    CostOverrideOut(
                        amount=money(parsed.amount),
                        reason_code=parsed.reason,
                        note=standing.reason,
                        actor=standing.actor,
                        at=parse_pb_datetime(standing.created),
                    )
                    if standing is not None and parsed is not None
                    else None
                ),
                "rules_cost": money(listed.amount) if listed is not None and listed.amount is not None else None,
                "rules_cost_from": listed.source if listed is not None else None,
                "included": is_included(row.request_status, cancelled=row.cancellation is not None),
            }
        )

    @staticmethod
    def _round_ledgers(season: Season) -> dict[str, dict[int, RoundLedger]] | None:
        """Owner ruling ⚠10: each request's posted rounds against CampMinder's live net. None (not computed) on a read
        that loaded no ledger (a past date) and before the first ticked season, exactly as _confirmation."""
        if not season.ledger.read or season.year < FIRST_TICKED_SEASON:
            return None
        ledger = season.ledger
        out: dict[str, dict[int, RoundLedger]] = {}
        for request_id, request in season.requests.items():
            lines = ledger.lines(request_id) if request.status in _LIVE else ledger.closed_lines(request_id)
            out[request_id] = round_ledger(
                season.priced[request_id],
                season.rounds.get(request_id, {}),
                lines,
                season.shares.get(request_id, ()),
                request.household_cm_id,
                synced_at=ledger.synced_at,
            )
        return out

    @staticmethod
    def _confirmation(season: Season, request_id: str) -> Confirmation | None:
        """The request's confirmation state (D59); None on a read that loaded no ledger (a past date),
        and before the first ticked season (nothing then was ticked, SP10b Decision 9). A C1 pending round counts as
        locked at what tonight's tick locks (owner 10-03): `Season.pending`, which with_unticked fills on the live read
        only, before row_of builds the row."""
        if not season.ledger.read or season.year < FIRST_TICKED_SEASON:
            return None
        request = season.requests[request_id]
        shares = season.shares.get(request_id, ())
        ledger = season.ledger
        lines = ledger.lines(request_id) if request.status in _LIVE else ledger.closed_lines(request_id)
        return confirmation(
            season.priced[request_id],
            season.rounds.get(request_id, {}),
            lines,
            shares,
            request.household_cm_id,
            synced_at=ledger.synced_at,
            family_unplaced=ledger.family_unplaced(request_scope(request, shares)),
            reversed_on=season.reversed_on.get(request_id),
            pending={n: amount for (rid, n), amount in season.pending.items() if rid == request_id},
        )

    async def budget(self, year: int, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder") -> BudgetResponse:
        # C2 (D162, owner 10-03): Needs an offer's counts are the grid's list, so the read walks the ledger as the grid
        # does (a past read and a season before the first ticked one are returned unchanged).
        season = await self.with_unticked(await self._season_for(year, as_of, as_of_axis))
        out = budget_out(year, season.rules, self._budget(season, confirmed=True))
        return out if season.as_of is None else past_budget(out, season)

    async def remaining(
        self, year: int, as_of: date | None = None, as_of_axis: AsOfAxis = "campminder"
    ) -> RemainingResponse:
        """D48: one figure per pool, summed over Rounds 1–3, and the total. Aggregates only (D75)."""
        season = await self._season_for(year, as_of, as_of_axis)
        budget = self._budget(season)
        if season.as_of is not None:
            gapped = _gapped_pools(season)
            posted = not season.posted_unknown
            return RemainingResponse(
                year=year,
                pools=[
                    RemainingPoolOut(
                        pool=p.pool,
                        label=p.label,
                        remaining=_money(p.total.remaining) if posted and not _masked(p.pool, gapped) else None,
                    )
                    for p in budget.pools
                    if p.pool != NO_POOL and p.total.allocated is not None
                ],
                total=_money(budget.total.total.remaining) if posted and not _masked(TOTAL, gapped) else None,
                as_of=season.as_of,
                as_of_axis=season.axis,
                # Summary-only users read this line (D75): a gap keeps its figure and reason, never the
                # requests it names.
                not_rebuilt=[gap.model_copy(update={"requests": []}) for gap in (*_gaps(REMAINING_GAPS), *season.gaps)],
            )
        return RemainingResponse(
            year=year,
            pools=[
                RemainingPoolOut(pool=p.pool, label=p.label, remaining=_money(p.total.remaining))
                for p in budget.pools
                if p.pool != NO_POOL and p.total.remaining is not None
            ],
            total=_money(budget.total.total.remaining),
        )

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    @staticmethod
    def _unchanged(year: int, count: int = 1) -> DecisionWriteOut:
        return DecisionWriteOut(year=year, written=0, unchanged=count, operation_id="")

    @staticmethod
    def _write(request: RequestRecord, n: int, kind: EventKind, actor: str, **fields: Any) -> AidWrite:
        """One aid_decisions row and its log line. A field given as None is left out. The log's `after`
        leaves out a post's snapshot: the row keeps the receipt, the log what changed."""
        data: dict[str, Any] = {
            "year": request.year,
            "request": request.id,
            "round": n,
            "event": kind,
            "actor": actor,
            **{key: value for key, value in fields.items() if value is not None},
        }
        return AidWrite(
            collection=AID_DECISIONS,
            action="create",
            year=request.year,
            data=data,
            after={key: value for key, value in data.items() if key != "snapshot"},
            log_action=kind,
            entity_id=f"{request.id}:{n}",
        )

    def _post_write(
        self,
        season: Season,
        priced: PricedRequest,
        n: int,
        amount: Decimal,
        actor: str,
        *,
        posted_on: date,
        lock_source: str,
        note: str | None = None,
    ) -> AidWrite:
        """A Posted tick's row (D51, D52): the decided amount it locks, the receipt as it was when posted,
        and the rules version that priced it. A person's tick and the ledger's (D78) write the same row."""
        if season.rules is None:
            raise DecisionRefusedError(f"{season.year}'s pricing rules are not approved yet")
        version = season.rules.version
        return self._write(
            season.requests[priced.request_id],
            n,
            "post",
            actor,
            amount=amount,
            effective_on=posted_on,
            lock_source=lock_source,
            rules_version=version,
            snapshot=lock_snapshot(priced, n, version),
            note=note,
        )

    @staticmethod
    def _cancel_write(request: RequestRecord, kind: str, actor: str, **fields: Any) -> AidWrite:
        """One aid_cancellations row and its log line (entity aid_cancellations, id the request's). A
        field given as None is left out."""
        data: dict[str, Any] = {
            "year": request.year,
            "request": request.id,
            "event": kind,
            "actor": actor,
            **{key: value for key, value in fields.items() if value is not None},
        }
        return AidWrite(
            collection=AID_CANCELLATIONS,
            action="create",
            year=request.year,
            data=data,
            after=data,
            log_action=kind,
            entity_id=request.id,
        )

    async def _live(self, request_id: str) -> tuple[RequestRecord, dict[int, RoundState]]:
        request = await self._store.fetch_request(request_id)
        if request is None:
            raise DecisionNotFoundError("no such request")
        if request.status not in _LIVE:
            raise DecisionRefusedError(_not_live(request.status))
        events, cancels, enrollments, sessions = await asyncio.gather(
            self._store.fetch_request_events(request.id),
            self._store.fetch_request_cancellations(request.id),
            self._store.fetch_enrollment_states(request.year, *_enrollment_scope([request])),
            self._store.fetch_sessions(request.year),
        )
        # "Reopen it first" only while Kindred's cancellation stands: once CampMinder cancels the enrollment too it
        # wins (as on the grid) and reopening is refused, so the refusal says CampMinder's words instead.
        _refuse(_cancelled_refusal(cancellations_by_request([request], cancels, enrollments, sessions).get(request.id)))
        rounds = fold_rounds(events).get(request.id, {})
        _refuse(_reproduced_refusal(rounds))
        return request, dict(rounds)

    async def _approved_rules(self, year: int) -> RulesVersion:
        rules = await self._rules.latest_approved(year, PRICING_SECTIONS)
        if rules is None:
            raise DecisionRefusedError(f"{year}'s pricing rules are not approved yet")
        return rules

    async def key_ask(self, request_id: str, body: AskIn, actor: str) -> DecisionWriteOut:
        """A family's ask for Round 2 (an appeal) or Round 3, recorded dated when it arrives, before
        anything is decided (D91, D82). Round 3's statement of need is the operation's reason (D22)."""
        request, rounds = await self._live(request_id)
        n = body.round
        state = rounds.get(n, RoundState(round=n))
        _refuse(_ask_refusal(rounds, n))
        if (state.ask, state.asked_on, state.statement_of_need) == (
            body.amount,
            body.asked_on,
            body.statement_of_need,
        ) and not await self._ask_note_changed(request.id, n, body.note):
            return self._unchanged(request.year)
        write = self._write(
            request,
            n,
            "ask",
            actor,
            amount=body.amount,
            effective_on=body.asked_on,
            statement_of_need=body.statement_of_need or None,
            note=body.note or None,
        )
        reason = body.statement_of_need if n == 3 else (body.note or None)
        result = await self._store.commit([write], actor=actor, reason=reason, require_reason=n == 3)
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

    async def _ask_note_changed(self, request_id: str, n: int, note: str | None) -> bool:
        """Whether a resent ask carries a note the round's latest ask doesn't. The screen shows the save, so a
        new note is written as one more ask event with the same amount and day: the round reads as it did,
        and the note and its change row persist. A blank note adds nothing to keep."""
        if not note:
            return False
        asks = [e for e in await self._store.fetch_request_events(request_id) if e.kind == "ask" and e.round == n]
        latest = max(asks, key=lambda e: (e.created, e.id), default=None)
        return latest is None or (latest.note or "") != note

    async def key_round3_amount(
        self, request_id: str, body: Round3AmountIn, actor: str, *, can_approve: bool
    ) -> DecisionWriteOut:
        """A Round 3 amount. Keyed by someone without finance's permission above the season's registrar
        limit, it waits as Pending approval (D22, D79); finance's own is approved at once."""
        request, rounds = await self._live(request_id)
        state = rounds.get(3, RoundState(round=3))
        _refuse(_round3_refusal(rounds))
        rules = await self._approved_rules(request.year)
        _refuse(_round3_rules_refusal(rounds, rules.document, request.year))
        if _round3_unchanged(state, body.amount):
            return self._unchanged(request.year)
        pending = not can_approve and needs_finance(body.amount, rules.document)
        write = self._write(
            request, 3, "award", actor, amount=body.amount, needs_approval=pending, note=body.note or None
        )
        result = await self._store.commit([write], actor=actor, reason=body.note or None)
        return DecisionWriteOut(
            year=request.year, written=1, unchanged=0, operation_id=result.operation_id, pending_approval=pending
        )

    async def decide_round3(self, request_id: str, body: Round3ApprovalIn, actor: str) -> DecisionWriteOut:
        """Finance's answer to a pending Round 3 amount (D79): approved, it joins Needs an offer;
        refused, it leaves."""
        request, rounds = await self._live(request_id)
        state = rounds.get(3, RoundState(round=3))
        if state.approval == ("approved" if body.approve else "refused"):
            return self._unchanged(request.year)
        if state.approval != "pending":
            raise DecisionRefusedError("No Round 3 amount is waiting for finance's approval")
        write = self._write(request, 3, "approve" if body.approve else "refuse", actor, note=body.note)
        result = await self._store.commit([write], actor=actor, reason=body.note, require_reason=True)
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

    async def preview(self, request_id: str, body: PreviewIn, *, can_approve: bool) -> EditorPreviewOut:
        """The editor's line while typing (§4.6, D22): the request re-priced with the typed Round 2 ask or Round 3
        amount on the season's own inputs. The same refusals as the write; nothing is written or logged."""
        request, rounds = await self._live(request_id)
        n = body.round
        _refuse(_ask_refusal(rounds, n) if n == 2 else _round3_refusal(rounds))
        rules = await self._approved_rules(request.year)
        if n == 3:
            _refuse(_round3_rules_refusal(rounds, rules.document, request.year))
        current = rounds.get(n, RoundState(round=n))
        # The write's no-op: the amount already keyed stands as it is, so nothing moves and nothing waits.
        # Round 2's write compares ask, asked_on and statement; the preview input carries only the amount, so
        # the preview treats a same-amount retype as no change.
        unchanged = current.ask == body.amount if n == 2 else _round3_unchanged(current, body.amount)
        pending = not unchanged and n == 3 and not can_approve and needs_finance(body.amount, rules.document)
        season = await self.season(request.year)
        item = season.inputs.get(request.id)
        if item is None:
            raise DecisionNotFoundError("no such request")
        typed = DecisionEvent(
            id="preview",
            request_id=request.id,
            round=n,
            kind="ask" if n == 2 else "award",
            created=self._clock(),
            amount=body.amount,
            effective_on=self._today() if n == 2 else None,
            needs_approval=pending,
        )
        after_rounds = (
            dict(item.rounds)
            if unchanged
            else {**item.rounds, n: apply_event(item.rounds.get(n, RoundState(round=n)), typed)}
        )
        before = price_request(item, rules.document).view(n)
        after = price_request(replace(item, rounds=after_rounds), rules.document)
        view = after.view(n)
        decided = [v.decided for v in after.rounds if v.decided is not None]
        shares = season.shares.get(request.id, ())
        split: dict[int, Decimal] = {}
        if len(shares) > 1 and decided:
            try:
                split = split_award(sum(decided, ZERO), shares, request.household_cm_id)
            except PayerShareError:
                split = {}
        award = None if view is None else view.decided if view.decided is not None else view.pending
        before_status = before.status if before is not None else None
        after_status = view.status if view is not None else None
        moved = after_status if after_status != before_status else None
        return EditorPreviewOut(
            award=_money(award),
            trace=list(after.result.trace) if after.result is not None else [],
            stage_after=moved,
            stage_after_label=ROUND_STATUS_LABELS[moved] if moved is not None else None,
            shares=[
                PreviewShareOut(
                    household_cm_id=s.household_cm_id, pct=float(s.share_pct), amount=money(split[s.household_cm_id])
                )
                for s in sorted(shares, key=lambda s: s.household_cm_id)
                if s.household_cm_id in split
            ],
            pending_approval=pending,
            total_decided=_total_decided(after),
        )

    async def tick_posted(self, year: int, body: PostedIn, actor: str) -> DecisionWriteOut:
        """The registrar entered these awards in CampMinder: tick Posted, locking each round at its
        decided amount with its receipt and rules version (D51, D52), and lock the rules sections a
        round's first lock reads (Decision 11). All or nothing (Decision 9). A round whose automatic tick D16
        withheld keeps its posting-day price where that is higher than today's and Kindred rebuilds it, with that
        day's receipt and rules version (D152; owner, B1 Q1 2026-10-02): `_posting_day_locks`."""
        season = await self.season(year)
        if season.rules is None:
            raise DecisionRefusedError(f"{year}'s pricing rules are not approved yet")
        confirmed: dict[tuple[str, int], Decimal] = {}
        for row in body.rows:
            key = (row.request_id, row.round)
            if confirmed.setdefault(key, row.amount) != row.amount:
                raise DecisionRefusedError(f"{row.request_id}: Round {row.round} appears twice with different amounts")
        posting_day = await self._posting_day_locks(season, confirmed.keys())
        problems: list[str] = []
        changed: list[ChangedRowOut] = []
        to_post: list[tuple[Season, PricedRequest, int, Decimal]] = []
        unchanged = 0
        for (request_id, n), amount in confirmed.items():
            priced = season.priced.get(request_id)
            if priced is None:
                raise DecisionNotFoundError(f"request {request_id} is not in {year}")
            view = priced.view(n)
            if view is not None and view.status == "posted":
                unchanged += 1
                continue
            if (why_cancelled := _cancelled_refusal(season.cancellations.get(request_id))) is not None:
                problems.append(f"{request_id}: {why_cancelled}")
                continue
            if view is None or view.status != "needs_offer" or view.decided is None:
                why = _WHY_NOT.get(view.status, "cannot be posted") if view is not None else "has nothing decided"
                problems.append(f"{request_id}: Round {n} {why}")
                continue
            unposted = next(
                (
                    m
                    for m in range(1, n)
                    if (earlier := priced.view(m)) is not None
                    and earlier.status != "posted"
                    and (request_id, m) not in confirmed
                ),
                None,
            )
            if unposted is not None:
                problems.append(f"{request_id}: mark Round {unposted} posted before Round {n}")
                continue
            then = posting_day.get((request_id, n))
            lock = then.amount if then is not None else view.decided
            if lock != amount:
                changed.append(
                    ChangedRowOut(request_id=request_id, round=n, confirmed=money(amount), decided_now=money(lock))
                )
                continue
            to_post.append((then.season, then.priced, n, lock) if then is not None else (season, priced, n, lock))
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        if changed:
            raise DecisionChangedError(changed)
        if not to_post:
            return self._unchanged(year, unchanged)
        version = season.rules.version
        posted_on = body.posted_on or self._today()
        writes = [
            self._post_write(priced_on, priced, n, amount, actor, posted_on=posted_on, lock_source="tick")
            for priced_on, priced, n, amount in to_post
        ]
        sections = sorted({section for _, _, n, _ in to_post for section in ROUND_SECTIONS[n]})
        locks, not_locked = await self._rules.lock_writes(year, version, sections)
        try:
            result = await self._store.commit([*writes, *locks], actor=actor)
        except BatchLimitError as exc:
            raise DecisionRefusedError(
                f"{len(writes)} rounds are too many to mark posted at once; mark them posted in smaller groups"
            ) from exc
        return DecisionWriteOut(
            year=year,
            written=len(writes),
            unchanged=unchanged,
            operation_id=result.operation_id,
            total_locked=money(sum((amount for _, _, _, amount in to_post), ZERO)),
            sections_not_locked=list(not_locked),
        )

    async def undo_posted(self, year: int, body: UnpostIn, actor: str) -> DecisionWriteOut:
        """Undo a mistaken Posted tick (Decision 10): refused while Accepted is ticked or a later round
        is posted. The history keeps both rows; rules-section locks are not reversed."""
        request = await self._store.fetch_request(body.request_id)
        if request is None or request.year != year:
            raise DecisionNotFoundError(f"request {body.request_id} is not in {year}")
        rounds = fold_rounds(await self._store.fetch_request_events(request.id)).get(request.id, {})
        n = body.round
        state = rounds.get(n, RoundState(round=n))
        if not state.posted:
            return self._unchanged(year)
        _refuse(_reproduced_refusal(rounds, n))
        if state.accepted:
            raise DecisionRefusedError(f"Uncheck Accepted on Round {n} first")
        for m in range(n + 1, 4):
            later = rounds.get(m)
            if later is not None and later.posted:
                raise DecisionRefusedError(f"Round {m} is posted and builds on Round {n}: undo it first")
        write = self._write(request, n, "unpost", actor, note=body.reason)
        result = await self._store.commit([write], actor=actor, reason=body.reason, require_reason=True)
        return DecisionWriteOut(year=year, written=1, unchanged=0, operation_id=result.operation_id)

    async def tick_writes(
        self,
        season: Season,
        ticks: Sequence[LedgerTick],
        actor: str,
        *,
        lock_source: str,
        note: Callable[[LedgerTick], str],
    ) -> tuple[list[AidWrite], list[AidWrite], list[SectionName]]:
        """The Posted rows for ticks worked out from CampMinder's money (the ledger's own, D78, or a
        registrar's placement, D81): each locks its round at the decided amount with its receipt, dated
        the posting's day. Also the rules-section locks a first lock reads (SP10a Decision 11), and the
        sections that could not be locked. The caller commits them as one operation. (The ledger sync builds
        its rows here too.)"""
        if season.rules is None:
            raise DecisionRefusedError(f"{season.year}'s pricing rules are not approved yet")
        writes = [
            self._post_write(
                season,
                season.priced[tick.request_id],
                tick.round,
                tick.amount,
                actor,
                posted_on=tick.posted_on,
                lock_source=lock_source,
                note=note(tick),
            )
            for tick in ticks
        ]
        sections = sorted({section for tick in ticks for section in ROUND_SECTIONS[tick.round]})
        locks, not_locked = await self._rules.lock_writes(season.year, season.rules.version, sections)
        return writes, locks, list(not_locked)

    async def ledger_ticks(self, year: int) -> LedgerTicksOut:
        """`_ledger_ticks_once`, re-run ONCE when a person changed the rules between its read and its write (G6).

        The refused attempt wrote nothing: its rules-section locks are the only guarded writes, and they ride
        in its first batch. So the retry is a fresh run, re-reading the season and re-deriving every tick and
        lock; nothing is applied twice. A second conflict is a DecisionRefusedError, which the internal route
        answers 422 and the Go sync counts as an aid-ledger warning: the next night's run ticks those rounds."""
        try:
            return await self._ledger_ticks_once(year)
        except AidWriteConflictError:
            try:
                return await self._ledger_ticks_once(year)
            except AidWriteConflictError as exc:
                raise DecisionRefusedError(
                    f"the {year} rules changed while the ledger sync checked Posted, twice; the next ledger sync "
                    "checks these rounds"
                ) from exc

    async def _ledger_ticks_once(self, year: int) -> LedgerTicksOut:
        """D78: after the overnight ledger sync, tick Posted where CampMinder holds camp aid on a request
        beyond what its posted rounds lock: the oldest decided round first, locked at its decided amount
        with its receipt, as a person's tick would have done, dated the posting's day (never after today).
        A family-level line never ticks (D81), nor a round a person un-ticked. Nor does a round on a
        request holding money a person placed, when D16 finds something that prices the request recorded
        after its posting day: it waits for a person (D152). One operation for the
        season, as system:ledger, with the rules sections a first lock reads (SP10a Decision 11).
        Idempotent: a round it ticked is posted, so the next run finds nothing beyond the locks. Two runs
        at once could each write a post for one round; the fold is idempotent, so that is left alone.
        Called by the Go aid-ledger sync (/api/internal)."""
        if year < FIRST_TICKED_SEASON:
            return LedgerTicksOut(
                year=year,
                ticked=0,
                operation_id="",
                skipped=f"{year} predates the ledger checking Posted, which starts in {FIRST_TICKED_SEASON}",
            )
        season = await self.season(year)
        if season.rules is None:
            return LedgerTicksOut(
                year=year, ticked=0, operation_id="", skipped=f"{year}'s pricing rules are not approved yet"
            )
        ticks = ledger_ticks(season.priced.values(), season.ledger, today=self._today(), undone=season.undone)
        ticks = await self._without_withheld(season, ticks)
        if not ticks:
            return LedgerTicksOut(year=year, ticked=0, operation_id="")
        writes, locks, not_locked = await self.tick_writes(
            season,
            ticks,
            LEDGER_ACTOR,
            lock_source="ledger",
            note=lambda tick: (
                f"The ledger sync checked Posted: CampMinder shows {dollars(tick.in_campminder)} on this request"
            ),
        )
        # Locks first: March's bulk import can pass one batch, so this may commit in chunks, and the
        # sections then lock in the first one. A chunk that fails leaves its rounds for the next run.
        try:
            result = await self._store.commit([*locks, *writes], actor=LEDGER_ACTOR, allow_chunking=True)
        except BatchError as exc:
            # A refused batch committed nothing, but a transport failure's may have: either way the
            # next run re-reads. A failure after an earlier chunk committed is not a BatchError
            # (AidOperationPartiallyCommittedError): it goes to the global 500 (change_log.py).
            raise DecisionRefusedError(
                f"the ledger's Posted checks for {year} may not have been written: {exc}"
            ) from exc
        return LedgerTicksOut(
            year=year,
            ticked=len(writes),
            operation_id=result.operation_id,
            total_locked=money(sum((tick.amount for tick in ticks), ZERO)),
            sections_not_locked=list(not_locked),
        )

    async def set_cancellation(self, request_id: str, body: CancellationIn, actor: str) -> DecisionWriteOut:
        """D101 as amended by D141: cancel a request with a reason from the fixed list, or reopen one
        cancelled in Kindred. On a request CampMinder already cancelled, cancelling only records the
        reason; on an enrolled camper it cancels the request in Kindred (the family declined, or wants
        no aid). Reopening undoes only a Kindred cancellation: CampMinder's is undone by re-enrolling
        there. A reason is changed by cancelling again: the latest wins."""
        request = await self._store.fetch_request(request_id)
        if request is None:
            raise DecisionNotFoundError("no such request")
        if request.status not in _LIVE:
            raise DecisionRefusedError(f"a {request.status} request can't be cancelled or reopened")
        events, enrollments, sessions = await asyncio.gather(
            self._store.fetch_request_cancellations(request.id),
            self._store.fetch_enrollment_states(request.year, *_enrollment_scope([request])),
            self._store.fetch_sessions(request.year),
        )
        state = fold_cancellations(events).get(request.id, CancelState())
        in_campminder, _ = enrollment_cancelled(request, enrollments, {s.cm_id: s.session_type for s in sessions})
        if body.cancelled:
            if body.reason is None:  # the model refuses this; narrowed for mypy
                raise DecisionRefusedError("a cancellation needs its reason")
            # A reason edited after CampMinder also cancelled keeps Kindred's cancellation (the family
            # declined), so a later re-enrolment in CampMinder does not bring the request back.
            in_kindred = state.in_kindred or not in_campminder
            if state.reason is not None and (state.reason, state.note, state.in_kindred) == (
                body.reason,
                body.note,
                in_kindred,
            ):
                return self._unchanged(request.year)
            label = CANCEL_REASON_LABELS[body.reason]
            write = self._cancel_write(
                request, "cancel", actor, reason=body.reason, in_kindred=in_kindred, note=body.note or None
            )
            reason = f"{label}: {body.note}" if body.note else label
        else:
            if in_campminder:
                raise DecisionRefusedError(
                    "CampMinder cancelled this enrollment: re-enroll the camper there to reopen it "
                    "(a reason can be changed by cancelling again)"
                )
            if not state.in_kindred and state.reason is None:
                return self._unchanged(request.year)
            write = self._cancel_write(request, "reopen", actor, note=body.note)
            reason = body.note
        result = await self._store.commit([write], actor=actor, reason=reason, require_reason=True)
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

    async def tick_accepted(self, year: int, body: AcceptedIn, actor: str) -> DecisionWriteOut:
        """The Accepted tick, single or bulk (D47: no ledger meaning; shown, never subtracted, D53). All or nothing. A
        round must be posted, or (from the first ticked season) be one CampMinder covers in full with nothing blocking
        tonight's tick (C1, owner 10-03: Season.pending, from the same ledger walk the grid reads), so the family can
        accept before tonight's tick marks it posted."""
        requests = {r.id: r for r in await self._store.fetch_requests(year)}
        # Only the requests being ticked: their registrations, never every aid camper of the season.
        ticked = [requests[rid] for rid in dict.fromkeys(row.request_id for row in body.rows) if rid in requests]
        events, cancel_events, sessions, enrollments = await asyncio.gather(
            self._store.fetch_decision_events(year),
            self._store.fetch_cancellations(year),
            self._store.fetch_sessions(year),
            self._store.fetch_enrollment_states(year, *_enrollment_scope(ticked)),
        )
        rounds = fold_rounds(events)
        cancelled = cancellations_by_request(ticked, cancel_events, enrollments, sessions)
        keys = dict.fromkeys((row.request_id, row.round) for row in body.rows)
        unposted = [
            (rid, n)
            for rid, n in keys
            if rid in requests and not rounds.get(rid, {}).get(n, RoundState(round=n)).posted
        ]
        # The walk prices the season: run only to accept a round that isn't posted (with_unticked keeps the season gate).
        pending = (await self.with_unticked(await self.season(year))).pending if unposted and body.accepted else {}
        writes: list[AidWrite] = []
        problems: list[str] = []
        unchanged = 0
        for request_id, n in keys:
            request = requests.get(request_id)
            if request is None:
                raise DecisionNotFoundError(f"request {request_id} is not in {year}")
            state = rounds.get(request_id, {}).get(n, RoundState(round=n))
            if state.accepted == body.accepted:
                unchanged += 1
            elif state.lock_source in LOADED:
                problems.append(f"{request_id}: {REPRODUCED_READ_ONLY}")
            elif body.accepted and (why_cancelled := _cancelled_refusal(cancelled.get(request_id))) is not None:
                problems.append(f"{request_id}: {why_cancelled}")
            # An un-accept is always allowed: a same-day Accepted (C1) whose round then stops being pending would
            # otherwise be stuck until it posts.
            elif body.accepted and not state.posted and (request_id, n) not in pending:
                problems.append(f"{request_id}: Round {n} is not posted")
            else:
                writes.append(self._write(request, n, "accept" if body.accepted else "unaccept", actor))
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        if not writes:
            return self._unchanged(year, unchanged)
        result = await self._store.commit(writes, actor=actor)
        return DecisionWriteOut(year=year, written=len(writes), unchanged=unchanged, operation_id=result.operation_id)

    # --- holds (follow-up 3b) --------------------------------------------------------------

    async def _hold_target(self, request_id: str) -> tuple[RequestRecord, HoldState]:
        """The live request and its hold state now. A request that is not live has no hold to change."""
        request = await self._store.fetch_request(request_id)
        if request is None:
            raise DecisionNotFoundError("no such request")
        if request.status not in _LIVE:
            raise DecisionRefusedError(f"a {request.status} request's holds can't change")
        events = await self._store.fetch_request_hold_events(request.id)
        return request, fold_holds(events).get(request.id, NO_HOLDS)

    @staticmethod
    def _hold_write(
        request: RequestRecord,
        kind: HoldEventKind,
        code: str,
        note: str,
        actor: str,
        fact: Mapping[str, Any] | None = None,
    ) -> AidWrite:
        """One aid_hold_events row and its log line: entity aid_hold_events, id "{request}:{code}". The
        log's `after` leaves out a release's `fact`: the row keeps it, the log keeps what changed."""
        data: dict[str, Any] = {
            "year": request.year,
            "request": request.id,
            "event": kind,
            "code": code,
            "note": note,
            "actor": actor,
        }
        if fact is not None:
            data["fact"] = dict(fact)
        return AidWrite(
            collection=AID_HOLD_EVENTS,
            action="create",
            year=request.year,
            data=data,
            after={key: value for key, value in data.items() if key != "fact"},
            log_action=kind,
            entity_id=f"{request.id}:{code}",
        )

    async def _commit_hold(self, request: RequestRecord, write: AidWrite, note: str, actor: str) -> DecisionWriteOut:
        result = await self._store.commit([write], actor=actor, reason=note, require_reason=True)
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

    async def _release_fact(self, request: RequestRecord, code: str) -> dict[str, Any]:
        """A release lifts only a hold the request shows now (Decision 4). Returns what it is released
        against, stored as the row's `fact` (Decision 3): the check's message and step, and the
        application figures the checks read. Prices the season, as the Posted tick does."""
        priced = (await self.season(request.year)).priced.get(request.id)
        shown = next((h for h in priced.holds if h.code == code), None) if priced is not None else None
        if priced is None or shown is None:
            raise DecisionRefusedError(
                f"This request is not on hold for '{code}': only a hold it shows now can be released"
            )
        if not releasable(shown):
            raise DecisionRefusedError(
                f"'{code}' means the request can't be priced ({shown.message}): fix that instead"
            )
        return {
            "message": shown.message,
            "step": shown.step,
            "application": priced.application.model_dump(mode="json"),
        }

    async def set_hold_release(self, request_id: str, body: HoldReleaseIn, actor: str) -> DecisionWriteOut:
        """Release a check's hold with a note, or put it back (main spec §10.5). A release stands until
        it is put back, and covers every round of the request not yet posted (Decisions 2 and 3). A
        hold that clears only when fixed, or a code that is never a hold, is refused first, before the
        no-op guard, so asking to release one is always a 422, even when an old release row exists
        (Decision 5)."""
        request, state = await self._hold_target(request_id)
        if body.code == MANUAL_HOLD:
            raise DecisionRefusedError("The manual hold is not a check: lift the manual hold instead")
        if body.released:
            why = UNRELEASABLE.get(body.code)
            if why is not None:
                raise DecisionRefusedError(f"This hold can't be released: {why}")
            if body.code in NEVER_A_HOLD:
                raise DecisionRefusedError(
                    f"'{body.code}' is never a hold: either the request can't be priced (fix that instead) "
                    "or it is only a note"
                )
        if (body.code in state.released) == body.released:
            return self._unchanged(request.year)
        fact = await self._release_fact(request, body.code) if body.released else None
        kind: HoldEventKind = "release" if body.released else "unrelease"
        write = self._hold_write(request, kind, body.code, body.note, actor, fact)
        return await self._commit_hold(request, write, body.note, actor)

    async def set_cost_override(self, request_id: str, body: CostOverrideIn, actor: str) -> DecisionWriteOut:
        """A cost override with its reason code, or clearing it (D22; reads 5-6): one aid_application_corrections row
        and its log line. The code must be one of the approved rules' cost.override_reasons. What stands, retyped,
        writes nothing."""
        request, rounds = await self._live(request_id)
        value = REVERT
        if body.amount is not None and body.reason_code is not None:
            rules = await self._approved_rules(request.year)
            codes = rules.document.cost.override_reasons
            if body.reason_code not in codes:
                raise DecisionRefusedError(
                    f"{body.reason_code} is not one of {request.year}'s cost override reasons ({', '.join(codes)})"
                )
            value = encode_cost_override(body.reason_code, body.amount)
        out = await self._override(request, COST_OVERRIDE, value, actor, body.note)
        if out.written and any(state.posted for state in rounds.values()):
            # The override re-prices later rounds; money already posted is locked and never moves.
            return out.model_copy(update={"warning": _POSTED_OVERRIDE_WARNING})
        return out

    async def _override(
        self, request: RequestRecord, field_name: str, value: str, actor: str, note: str
    ) -> DecisionWriteOut:
        corrections = await self._store.fetch_corrections(request.year, request.application_id)
        standing = latest(corrections, request.id, field_name)
        if value == (standing.new_value if standing is not None else REVERT) and (
            standing is None or standing.new_value == REVERT or standing.reason == note
        ):
            return self._unchanged(request.year)  # same value and same note; a new note on it is a real edit
        result = await self._store.commit(
            [override_write(request, field_name, value, actor, note)], actor=actor, reason=note, require_reason=True
        )
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

    async def set_manual_hold(self, request_id: str, body: ManualHoldIn, actor: str) -> DecisionWriteOut:
        """Put the request on hold by hand with a reason ("waiting on something" is a hold, not a stage:
        main spec §10.2; app spec §6.3), or lift it. Placing it again with a new reason replaces the
        reason; the same reason again writes nothing (Decision 6)."""
        request, state = await self._hold_target(request_id)
        current = state.manual
        if body.held and current is not None and current.reason == body.note:
            return self._unchanged(request.year)
        if not body.held and current is None:
            return self._unchanged(request.year)
        kind: HoldEventKind = "place" if body.held else "lift"
        write = self._hold_write(request, kind, MANUAL_HOLD, body.note, actor)
        return await self._commit_hold(request, write, body.note, actor)

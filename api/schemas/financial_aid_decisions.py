"""Campership decisions (sub-project 10a): the Requests grid, Rounds & budget and the Remaining line
(reads), and each round's asks and decisions (writes). Spec §5.1–§5.3, §6.1, §7.1–§7.3.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
ledger and grants reads. None is "nothing there"; 0 is a real zero (D74). The basis words are
decided and posted (D20, D59). No field here is named "awarded", which is finance's report label
for Posted, or "Total Awards Granted", which is development's all-money figure (§5.6, D80, D87).
A test pins it.

A past date (?as_of=, 3c) shows the season by the end of that day: every figure it can't rebuild
exactly is None and is named in not_rebuilt; as_of is None on the live read. Two axes (owner ruling
2026-09-30): `campminder`, the default, counts a Posted tick from its CampMinder post day, as Money's
ledger ?as_of cuts on post date; `recorded` shows what Kindred had recorded by then (the audit view).
Facts with no CampMinder date cut on when Kindred recorded them on both axes.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from api.schemas.financial_aid_intake import IssueOut
from api.services.camp_calendar import CAMP_TZ
from bunking.financial_aid.calculator.result import TraceStep


def today() -> date:
    """Today on camp time. A module function, so a test can pin it."""
    return datetime.now(CAMP_TZ).date()


def _not_future(value: date) -> date:
    if value > today():
        raise ValueError("can't be a future date")
    return value


# A day something happened outside Kindred (the family asked; the registrar posted): never after today.
_PastDay = Annotated[date, AfterValidator(_not_future)]


# The as-of axis (owner ruling 2026-09-30): campminder cuts a Posted tick on its CampMinder post day;
# recorded cuts every fact on when Kindred recorded it. A response names the axis it used; None is live.
AsOfAxis = Literal["campminder", "recorded"]


RoundStatusOut = Literal["posted", "held", "pending_approval", "refused", "not_decided", "needs_offer", "not_rebuilt"]


class NotRebuiltOut(BaseModel):
    """A figure a past-date read leaves empty, and why; `requests` names the requests that cause it
    when it is theirs. Never approximated (3c plan Decision 1)."""

    figure: str
    reason: str
    requests: list[str] = Field(default_factory=list)


class RoundOut(BaseModel):
    """One round of a request. On a clawed-back round (D54) `posted` still carries the locked amount and
    `accepted` stays True, as the record of what was ticked, but the budget counts that money nowhere:
    never sum `rounds[].posted` for a total. Use the row's `total_posted` or the budget's figures."""

    round: int
    status: RoundStatusOut
    ask: float | None
    asked_on: date | None
    decided: float | None
    posted: float | None
    posted_on: date | None
    accepted: bool
    pending_approval: float | None
    would_change_by: float | None
    counts_toward_budget: bool
    rules_version: int | None
    # "tick" (registrar), "ledger" (automatic tick, D78) or "placement" (To place, D81); None while unposted
    lock_source: str | None = None
    clawed_back: bool = False  # CampMinder reversed its money: it counts nowhere (D54)
    # Its words (ROUND_STATUS_LABELS; read 3): the screens keep no map of their own (§6.1, D21). Set on every row the
    # server builds.
    status_label: str = ""


class ReleasedHoldOut(BaseModel):
    """A check's hold released with a note (follow-up 3b; main spec §10.5): it no longer stops the
    award. Listed so the household page can show it and put it back."""

    code: str
    note: str
    released_at: datetime
    released_by: str


ConfirmationStatusOut = Literal["awaiting_sync", "confirmed", "short", "over", "not_in_campminder", "reversed"]


class ShareConfirmationOut(BaseModel):
    """One payer share against its own household's lines (main spec §11)."""

    household_cm_id: int
    expected: float
    in_campminder: float
    status: ConfirmationStatusOut


class ConfirmationOut(BaseModel):
    """Beside every Posted figure (D59): awaiting tonight's sync · ✓ confirmed (on) · CampMinder shows
    in_campminder, short or over by gap · not in CampMinder · reversed (on). Net-total reconciliation of
    the camp-aid lines placed on the request against its locked total (main spec §11). family_unplaced
    is the family's camp aid no single request takes yet (D81)."""

    status: ConfirmationStatusOut
    locked: float
    in_campminder: float
    gap: float
    on: date | None
    reconciled: bool
    family_unplaced: float
    shares: list[ShareConfirmationOut]


# D141's nine cancel reasons (api.services.financial_aid_cancellations.CancelReason; a test pins them equal).
CancelReasonOut = Literal[
    "aid_not_enough",
    "medical",
    "schedule",
    "not_ready",
    "did_not_want_to_appeal",
    "not_financially_related",
    "early_cancel",
    "another_reason",
    "not_known",
]


class CancellationOut(BaseModel):
    """A cancelled request (D101): by CampMinder (the enrollment; `on` is its cancellation day) or in
    Kindred (the registrar; `on` is the day it was recorded). reason None = none given yet."""

    by: Literal["campminder", "kindred"]
    on: date | None
    reason: CancelReasonOut | None
    note: str


class TodoOut(BaseModel):
    """A to-do on the row: neither a hold nor a Note ("Cancelled: give a reason", D101)."""

    code: str
    message: str


# The Requests views a row belongs to (spec §6.2; D21: the server decides queue membership). Today's
# counts (§6.4) count these same memberships. Order is the views' order; api.services.financial_aid_queues.
QueueOut = Literal[
    "needs_offer",
    "holds",
    "pending_approval",
    "waiting_on_family",
    "appeals",
    "not_reconciled",
    "to_reverse",
    "session_not_settled",
    "duplicates",
    "cancel_reason",
]


class GridShareOut(BaseModel):
    """One payer of a split request, on its grid row (§6.2: Needs an offer has one row per payer share; ⚠39, owner
    ruling 2026-10-01). Its whole-dollar part of the request's decided total (`decided`: the household's new total
    once the open rounds post, ⚠40), of the posted total, and of the rounds that need an offer (`needs_offer`: what
    is posted to this household when they are ticked). None while the request has no such money, or its shares
    don't add up to 100%."""

    household_cm_id: int
    family_name: str
    share_pct: float
    decided: float | None
    posted: float | None
    needs_offer: float | None


class SessionCandidateOut(BaseModel):
    """A session intake found for an unmatched request (Session not settled, §6.2; read 4), named from the season's
    sessions, or "Session <id>" when the season lacks it."""

    session_cm_id: int
    name: str


class CostOverrideOut(BaseModel):
    """A staff cost override (D22): the cost the request is priced at, its reason code from the season's
    cost.override_reasons, the note and who. The calculator's cost step reads it (calculator/cost.py)."""

    amount: float
    reason_code: str
    note: str
    actor: str


class IncludeOverrideOut(BaseModel):
    """A staff exclusion (D22; main spec §10.2's "audited override"): the request is left out of the household band
    (Decision 5); the note says why."""

    note: str
    actor: str


class GridRowOut(BaseModel):
    request_id: str
    household_cm_id: int
    family_name: str
    person_cm_id: int
    camper_name: str
    session_cm_id: int
    session_name: str
    program_key: str | None
    pool: str | None
    request_status: str | None
    tier: int | None
    cost: float | None
    rounds: list[RoundOut]
    # Decided includes a clawed-back round: a declined offer was still decided (owner ruling 2026-09-30).
    # total_posted, and the budget's Posted and Remaining, drop it (D54).
    total_decided: float | None
    total_posted: float | None
    holds: list[IssueOut]
    released_holds: list[ReleasedHoldOut]
    notes: list[IssueOut] | None
    confirmation: ConfirmationOut | None = None
    # Sub-project 10b-2. None on a past read: cancellations aren't rebuilt as of a date (not_rebuilt).
    cancellation: CancellationOut | None = None
    to_reverse: bool | None = False  # cancelled with camp aid still live in CampMinder (spec §6.2, D54)
    todos: list[TodoOut] | None = Field(default_factory=list)
    # Slice 1: the views the row is in. None on a past read: membership reads figures a past date leaves empty.
    queues: list[QueueOut] | None = Field(default_factory=list)
    # ⚠39 (owner ruling 2026-10-01): how many households pay the request (1 with no share row), and each payer's part
    # when two or more do ([] for one payer, as the editor preview's shares). On a past read payer_count is None
    # (and payer_shares []) for a request whose payer shares couldn't be replayed for that date.
    payer_count: int | None = 1
    payer_shares: list[GridShareOut] = Field(default_factory=list)
    # Read 3: why the request's Round 2 ask (an appeal) can't be keyed now, in key_ask's own words; None when it can;
    # a past read names it in not_rebuilt.
    appeal_refusal: str | None = None
    cost_override: CostOverrideOut | None = None
    # D77/D129 and Decision 5: live, not cancelled, and not excluded by staff. None on a past read: it reads the
    # cancellation, which a past date doesn't rebuild (not_rebuilt names it).
    included: bool | None = None
    include_override: IncludeOverrideOut | None = None
    session_candidates: list[SessionCandidateOut] = Field(default_factory=list)  # read 4: an unmatched request's
    # Read 2 (§6.2 Needs an offer): the description to post the program's aid under, from the rules; None: none named.
    campminder_description: str | None = None


class RequestsGridResponse(BaseModel):
    year: int
    rules_version: int | None
    rows: list[GridRowOut]
    as_of: date | None = None  # None: live. Else the past date shown (end of that day, camp time).
    as_of_axis: AsOfAxis | None = None  # the axis a past read cut on; None: live
    not_rebuilt: list[NotRebuiltOut] = Field(default_factory=list)


class CountOut(BaseModel):
    families: int
    requests: int


class CellOut(BaseModel):
    allocated: float | None
    posted: float | None  # None: a past read whose posted money can't be replayed exactly
    accepted: float | None
    needs_offer: float | None
    pending_approval: float | None
    remaining: float | None


class RoundCellOut(CellOut):
    round: int


class BelowTheLineOut(BaseModel):
    held: CountOut | None
    held_asked: float | None
    outside_grants: float | None
    outside_budget: float | None
    outside_budget_posted: float | None


class ForwardDemandOut(BaseModel):
    round2_asks: CountOut | None
    round2_asked: float | None
    round2_computed: float | None
    round1_unmet: float | None


class PoolBudgetOut(BaseModel):
    pool: str
    label: str
    rounds: list[RoundCellOut]
    total: CellOut
    below: BelowTheLineOut
    demand: ForwardDemandOut


class RoundCountsOut(BaseModel):
    round: int
    needs_offer: CountOut | None
    posted: CountOut | None
    accepted: CountOut | None
    held: CountOut | None
    pending_approval: CountOut | None


class BudgetResponse(BaseModel):
    year: int
    rules_version: int | None
    pools: list[PoolBudgetOut]
    total: PoolBudgetOut
    strip: list[RoundCountsOut]
    outside_grants_off_requests: float | None
    as_of: date | None = None  # None: live. Else the past date shown (end of that day, camp time).
    as_of_axis: AsOfAxis | None = None  # the axis a past read cut on; None: live
    not_rebuilt: list[NotRebuiltOut] = Field(default_factory=list)


class RemainingPoolOut(BaseModel):
    pool: str
    label: str
    remaining: float | None


class RemainingResponse(BaseModel):
    year: int
    pools: list[RemainingPoolOut]
    total: float | None
    as_of: date | None = None  # None: live. Else the past date shown (end of that day, camp time).
    as_of_axis: AsOfAxis | None = None  # the axis a past read cut on; None: live
    not_rebuilt: list[NotRebuiltOut] = Field(default_factory=list)


_Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
_Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
_Statement = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
_Amount = Annotated[Decimal, Field(ge=0, le=1_000_000, decimal_places=2)]
_RequestId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]{15}$")]
_DecisionType = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]
_HoldCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]


class AskIn(BaseModel):
    """A family's ask for Round 2 (an appeal) or Round 3, keyed when it arrives (D91, D82). Round 3's
    statement of need is required (D22); an appeal's note is optional ("Family emailed (date)")."""

    round: Literal[2, 3]
    amount: _Amount
    asked_on: _PastDay
    statement_of_need: _Statement = ""
    note: _Note = ""

    @model_validator(mode="after")
    def _only_round_3_states_its_need(self) -> AskIn:
        if self.round == 3 and not self.statement_of_need:
            raise ValueError("a Round 3 ask needs its statement of need")
        if self.round == 2 and self.statement_of_need:
            raise ValueError("only a Round 3 ask carries a statement of need")
        return self


class Round3AmountIn(BaseModel):
    """A Round 3 amount. Above the season's registrar limit, the registrar's waits for finance (D79)."""

    amount: _Amount
    note: _Note = ""


class Round3ApprovalIn(BaseModel):
    approve: bool
    note: _Reason


class RoundRef(BaseModel):
    request_id: _RequestId
    round: Literal[1, 2, 3]


class PostedRow(RoundRef):
    """`amount` is the decided amount the person confirmed; it must still be the decided amount (Decision 9)."""

    amount: _Amount


class PostedIn(BaseModel):
    rows: list[PostedRow] = Field(min_length=1, max_length=900)
    posted_on: _PastDay | None = None  # the day it was posted in CampMinder; default today, camp time


class UnpostIn(RoundRef):
    reason: _Reason


class HoldReleaseIn(BaseModel):
    """Release a check's hold with a note (released=True), or put it back (released=False) (main spec
    §10.5; follow-up 3b). The note is required both ways (app spec §4.6; main spec §14.4)."""

    code: _HoldCode
    released: bool
    note: _Reason


_ReasonCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=48)]


class CostOverrideIn(BaseModel):
    """A cost override (D22): the cost to price the request at, a reason code from the season's cost.override_reasons
    and a note (required, main spec §14.4). amount None clears the override, and then takes no code. The code is at
    most 48 characters so "<code>:<amount>" fits the corrections table's 64."""

    amount: _Amount | None
    reason_code: _ReasonCode | None = None
    note: _Reason

    @model_validator(mode="after")
    def _code_with_amount(self) -> CostOverrideIn:
        if self.amount is not None and self.reason_code is None:
            raise ValueError("a cost override needs its reason code (D22)")
        if self.amount is None and self.reason_code is not None:
            raise ValueError("clearing a cost override takes no reason code")
        return self


class IncludeIn(BaseModel):
    """Leave a request out of the household band (included=false) or put it back (true), with a note (D22, Decision 5).
    It never includes a request derived as not included."""

    included: bool
    note: _Reason


class ManualHoldIn(BaseModel):
    """Put the request on hold by hand (held=True, "Put on hold…", app spec §6.3), or lift it
    (held=False). The note is the hold's reason when placing it and why when lifting it; required."""

    held: bool
    note: _Reason


class CancellationIn(BaseModel):
    """D101 as amended by D141. cancelled=true records a reason from the fixed list; it cancels the
    request in Kindred when CampMinder hasn't cancelled the enrollment. "another_reason" needs a note.
    cancelled=false reopens a request cancelled in Kindred and needs a note saying why (main spec §14.4)."""

    cancelled: bool
    reason: CancelReasonOut | None = None
    note: _Note = ""

    @model_validator(mode="after")
    def _d141(self) -> CancellationIn:
        if self.cancelled and self.reason is None:
            raise ValueError("a cancellation needs its reason (D141)")
        if self.cancelled and self.reason == "another_reason" and not self.note:
            raise ValueError('"another reason" needs a note')
        if not self.cancelled and self.reason is not None:
            raise ValueError("reopening takes no reason")
        if not self.cancelled and not self.note:
            raise ValueError("reopening needs a note saying why")
        return self


class PreviewIn(BaseModel):
    """What the request editor is typing (D22): a Round 2 ask (the award is computed) or a Round 3 amount.
    Priced as the write would price it; never written or logged."""

    round: Literal[2, 3]
    amount: _Amount


class PreviewShareOut(BaseModel):
    """One payer's whole-dollar part of the request's decided total once the typed amount stands (§6.3)."""

    household_cm_id: int
    pct: float
    amount: float


class EditorPreviewOut(BaseModel):
    """The editor's line while typing (§4.6): the round's computed award (None: held, or nothing computable),
    the calculator's trace (the receipt sentence's source), the round's state once it stands (None: it doesn't
    move) and its display words, the recomputed payer shares (none for one payer), and whether it would wait for
    finance (D79): `pending_approval` is False when nothing would change; read the row's own state for a round
    already pending."""

    award: float | None
    trace: list[TraceStep]
    stage_after: RoundStatusOut | None
    stage_after_label: str | None  # its words (ROUND_STATUS_LABELS), so the screen keeps no map of its own
    shares: list[PreviewShareOut]
    pending_approval: bool


class AcceptedIn(BaseModel):
    rows: list[RoundRef] = Field(min_length=1, max_length=900)
    accepted: bool


class ChangedRowOut(BaseModel):
    request_id: str
    round: int
    confirmed: float
    decided_now: float | None


class DecisionWriteOut(BaseModel):
    """What a write did. A write that changed nothing wrote nothing: operation_id is then ""."""

    year: int
    written: int
    unchanged: int
    operation_id: str
    total_locked: float | None = None
    pending_approval: bool = False
    # A write that went through but moves figures its author may not expect (a cost override on a request with a
    # posted round); the screen shows it beside the save.
    warning: str | None = None
    sections_not_locked: list[str] = Field(default_factory=list)


class LedgerTicksOut(BaseModel):
    """What the ledger's automatic Posted tick did for one season (D78). The Go ledger sync reads it.
    `skipped` says why nothing was considered (a season before ticks began, no approved rules)."""

    year: int
    ticked: int
    operation_id: str
    total_locked: float | None = None
    sections_not_locked: list[str] = Field(default_factory=list)
    skipped: str = ""

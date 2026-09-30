"""Campership decisions (sub-project 10a): the Requests grid, Rounds & budget and the Remaining line
(reads), and each round's asks and decisions (writes). Spec §5.1–§5.3, §6.1, §7.1–§7.3.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
ledger and grants reads. None is "nothing there"; 0 is a real zero (D74). The basis words are
decided and posted (D20, D59). No field here is named "awarded", which is finance's report label
for Posted, or "Total Awards Granted", which is development's all-money figure (§5.6, D80, D87).
A test pins it.

A past date (?as_of=, 3c) shows what Kindred had recorded by the end of that day: every figure it can't
rebuild exactly is None and is named in not_rebuilt; as_of is None on the live read.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from api.schemas.financial_aid_intake import IssueOut
from api.services.camp_calendar import CAMP_TZ


def today() -> date:
    """Today on camp time. A module function, so a test can pin it."""
    return datetime.now(CAMP_TZ).date()


def _not_future(value: date) -> date:
    if value > today():
        raise ValueError("can't be a future date")
    return value


# A day something happened outside Kindred (the family asked; the registrar posted): never after today.
_PastDay = Annotated[date, AfterValidator(_not_future)]


RoundStatusOut = Literal["posted", "held", "pending_approval", "refused", "not_decided", "needs_offer", "not_rebuilt"]


class NotRebuiltOut(BaseModel):
    """A figure a past-date read leaves empty, and why; `requests` names the requests that cause it
    when it is theirs. Never approximated (3c plan Decision 1)."""

    figure: str
    reason: str
    requests: list[str] = Field(default_factory=list)


class RoundOut(BaseModel):
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


class ReleasedHoldOut(BaseModel):
    """A check's hold released with a note (follow-up 3b; main spec §10.5): it no longer stops the
    award. Listed so the household page can show it and put it back."""

    code: str
    note: str
    released_at: datetime
    released_by: str


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
    total_decided: float | None
    total_posted: float | None
    holds: list[IssueOut] | None
    released_holds: list[ReleasedHoldOut]
    notes: list[IssueOut] | None


class RequestsGridResponse(BaseModel):
    year: int
    rules_version: int | None
    rows: list[GridRowOut]
    as_of: date | None = None  # None: live. Else the past date shown (end of that day, camp time).
    as_of_axis: Literal["recorded"] | None = None  # past reads cut on when Kindred recorded each fact
    not_rebuilt: list[NotRebuiltOut] = Field(default_factory=list)


class CountOut(BaseModel):
    families: int
    requests: int


class CellOut(BaseModel):
    allocated: float | None
    posted: float
    accepted: float
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
    outside_budget_posted: float


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
    posted: CountOut
    accepted: CountOut
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
    as_of_axis: Literal["recorded"] | None = None  # past reads cut on when Kindred recorded each fact
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
    as_of_axis: Literal["recorded"] | None = None  # past reads cut on when Kindred recorded each fact
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


class ManualHoldIn(BaseModel):
    """Put the request on hold by hand (held=True, "Put on hold…", app spec §6.3), or lift it
    (held=False). The note is the hold's reason when placing it and why when lifting it; required."""

    held: bool
    note: _Reason


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
    sections_not_locked: list[str] = Field(default_factory=list)

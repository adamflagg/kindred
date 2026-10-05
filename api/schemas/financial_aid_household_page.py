"""The household page's one aggregate read (clean spec §6.3, D8, D26, D32, D50, D77, D127; §10's
household aggregate). Request rows are the Requests grid's own rows (GridRowOut), built by the same
code, so the page and the grid never disagree.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
decisions, grants and ledger reads. None is "nothing there"; 0 is a real zero (D74). The basis words
are decided and posted (D20, D59); no field is named "awarded" (§5.6). A receipt's trace is the
calculator's own TraceStep: its Decimal values travel as JSON strings, live and locked alike.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from api.schemas.financial_aid import AidPostingLine, HouseholdLinkRow
from api.schemas.financial_aid_decisions import ConfirmationStatusOut, GridRowOut
from api.schemas.financial_aid_grants import ExpectedOut, GrantRowOut
from api.schemas.financial_aid_intake import AnswerOut, FlagOut, PayerShareStatus
from bunking.financial_aid.calculator.result import TraceStep


class ConfirmationStateOut(BaseModel):
    """How many requests (or payer shares, on a household card) are in one confirmation state, and their
    summed gap (in CampMinder minus posted: negative is short). "posted · 1 short $210" (D77, D59)."""

    status: ConfirmationStatusOut
    count: int
    gap: float


class HouseholdMoneyOut(BaseModel):
    """A household card's money line (D32 as amended by D59): this household's payer share of the decided
    and of the posted money on the page's requests, and its share's confirmation."""

    decided: float | None
    posted: float | None
    in_campminder: float | None
    states: list[ConfirmationStateOut]


class HouseholdCardOut(BaseModel):
    """One household with a financial stake (D26). `chip` is D32's 1 · 2 · 3, the opened household first.
    `adults` are the parents its campers' records name, or, with no camper on the page (a second payer), its own
    members' (owner N11); `emails` come from the same people; `request_ids` the page's requests it pays a share of
    or applied for."""

    household_cm_id: int
    chip: int
    family_name: str
    # O3 (owner 2026-10-04, late): the chip's short name, "Johnson" / "Johnson & Garcia" (short_family_name); the full
    # family_name when no camper on the page carries a surname. Defaulted only so older fixtures still type-check.
    short_name: str = ""
    adults: list[str]
    phone: str
    emails: list[str]
    city: str
    # D32: the county holding most of the billing ZIP's land (Census ZCTA-to-county, Decision 8a); None when unknown.
    county: str | None = None
    money: HouseholdMoneyOut
    request_ids: list[str]


class HouseholdTotalsOut(BaseModel):
    """The band's five figures (D77): cost − {camp} aid (decided) − grants = family's share, then Posted with
    its confirmation folded into its label. Over the page's included requests (live, not cancelled).
    family_share is None until every included request has a cost and a decided total, and never below 0."""

    cost: float | None
    decided: float | None
    grants: float | None  # None with no included request
    family_share: float | None
    posted: float | None
    states: list[ConfirmationStateOut]
    # ⚠38 (b), owner ruling 2026-10-01: the band shows grants APPLIED, so cost − aid (decided) − grants applied = family's
    # share, except when a request's aid alone exceeds its cost (open owner item 1b): its share is floored at 0, so the
    # band then falls short of the equation by Σ(aid − cost) of those requests. What grants paid beyond a request's
    # owed amount is its own line. `grants` stays the counted grants (the Grants table's money). Both None whenever
    # family_share is (Decision 1).
    grants_applied: float | None = None
    grants_beyond_owed: float | None = None
    # Read 12 (Decision 2, ⚠): an included request has a round whose amount isn't decided yet (held, not decided,
    # pending approval), so "aid, decided" is a partial sum: the band labels it "aid, decided so far".
    decided_partial: bool = False


class ShareLineOut(BaseModel):
    """One payer of a request: the share table's row, or the one money line when there is one payer (D32).
    `chip` 0 means the payer is outside the page's scope: it has no household card."""

    household_cm_id: int
    chip: int
    share_pct: float
    decided: float | None
    posted: float | None
    in_campminder: float | None
    status: ConfirmationStatusOut | None


class ReceiptLabelOut(BaseModel):
    """What the receipt's label says (§4.7; D43, D52, D67): live ("live · rules 2027 v3"), or locked at a
    round's lock ("rules 2027 v3 · locked Mar 9 by <name>'s Posted tick"), or reproduced from the repaired
    2026 sheet. The screen writes the words; these are the facts. A name is the Kindred user's display name,
    None for the ledger's own tick or a person Kindred has no name for."""

    kind: Literal["live", "locked", "reproduced"]
    season: int
    rules_version: int
    locked_on: date | None
    lock_source: Literal["tick", "ledger", "placement"] | None
    ticked_by_name: str | None
    decided_by_name: str | None  # a staff-decided Round 3 amount: who decided it (finance once approved)


class ReceiptOut(BaseModel):
    """One round's receipt (D33, D34, §6.5): the calculator's own trace. A posted round's is the snapshot
    stored at its lock; an unposted round's is live, the request priced now."""

    round: int
    trace: list[TraceStep]
    label: ReceiptLabelOut


class Round3ContextOut(BaseModel):
    """A Round 3 request's session, for context only (§6.3 item 4; main spec §10.4): its enrolled campers (attendees
    status 2, as the solver counts them), its waitlist (status 8) and the capacity finance entered (aid_session_capacity;
    None: not entered)."""

    session_cm_id: int
    enrolled: int
    waitlisted: int
    capacity: int | None
    capacity_note: str


class HouseholdRequestOut(BaseModel):
    row: GridRowOut
    ask: AnswerOut | None  # the Round 1 ask with its corrections beside the original (main spec §9.3)
    payer_share_status: PayerShareStatus
    shares: list[ShareLineOut]
    receipts: list[ReceiptOut]
    grants: float = 0.0  # the request's counted grants (band_grants_by_request)
    # ⚠38 (b): min(grants, max(0, cost − decided)), what of them the family owed; None until the request has a cost and
    # a decided total, and on a request outside the band (D77's included).
    grants_applied: float | None = None
    grants_beyond_owed: float | None = None  # grants − grants_applied
    round3_context: Round3ContextOut | None = None  # only on a request with a Round 3


class IncomeOut(BaseModel):
    """One application's household income: every answer with corrections beside the original, the free-text
    answers (special circumstances) and the application's flags (main spec §9.3)."""

    household_cm_id: int
    status: str
    answers: list[AnswerOut]
    notes: dict[str, str]
    flags: list[FlagOut]


class HistoryEntryOut(BaseModel):
    """One aid_change_log row about the page's requests, applications, corrections, commitments or links
    (main spec §14.4); intake's own rows carry the actor system:intake. The screen writes the line (D49)."""

    at: datetime
    action: str
    entity: str
    entity_id: str
    request_id: str | None
    actor: str
    reason: str
    operation_id: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class HouseholdGrantRowOut(GrantRowOut):
    """A register row as the household page shows it, with whether the band counted it."""

    in_band: bool = Field(
        description="True when the household band counts this grant (same rule as the band: it counts, its "
        "funder is outside, and it sits on at least one included request, i.e. live and not cancelled, so a "
        "grant on a withdrawn or duplicate request is left out). The band counts per request share: a grant split "
        "over an included and an excluded request reads true, and only its share on the included request is in "
        "the band"
    )


class HouseholdPageLinkOut(HouseholdLinkRow):
    """A Linked households row (owner ruling 2026-10-04, late): the link, plus the household named as a card names
    it (HouseholdCardOut's family_name, adults and city), so it reads as a family and not a number. A household in
    the page's scope reads exactly as its card; one outside it takes its adults from its own members.
    Defaulted only so older clients' fixtures still type-check; the page always fills them."""

    family_name: str = ""
    adults: list[str] = Field(default_factory=list)
    city: str = ""


class HouseholdPageResponse(BaseModel):
    year: int
    household_cm_id: int
    rules_version: int | None
    households: list[HouseholdCardOut]
    totals: HouseholdTotalsOut
    requests: list[HouseholdRequestOut]
    incomes: list[IncomeOut]
    grants: list[HouseholdGrantRowOut]
    expected: list[ExpectedOut]
    postings: list[AidPostingLine]
    links: list[HouseholdPageLinkOut]
    history: list[HistoryEntryOut]
    override_reasons: list[str] = Field(
        default_factory=list
    )  # Decision 6: what the cost-override and headcount forms offer

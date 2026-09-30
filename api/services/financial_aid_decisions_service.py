"""Campership decisions (sub-project 10a): the season priced, its three reads, and the writes that
record each round's asks and decisions (spec §5.1–§5.3, §6.1, §7.1–§7.3; D41–D44, D50–D53, D78–D82).

Reads (financial_aid.view; the Remaining line also financial_aid.summary). Each prices the whole
season on the server and returns one aggregate (D21): the Requests grid, Rounds & budget, and the
Remaining line. They are live only (Decision 12), but every event they read is dated, so as-of can
follow.

Writes. Each is one staff action and one operation through sub-project 4a's commit_aid_writes:
the aid_decisions rows and their aid_change_log rows in ONE PocketBase batch, and a first lock's
rules-section locks in that same batch (Decision 11). A write that changes nothing writes nothing:
the helper refuses an empty operation, and change_row refuses a no-op, which would be a 500.

Pricing uses the season's newest rules version whose pricing sections are all approved or locked
(PRICING_SECTIONS). With none, every live request is held and nothing is allocated.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import AID_DECISIONS
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    AskIn,
    BelowTheLineOut,
    BudgetResponse,
    CellOut,
    ChangedRowOut,
    CountOut,
    DecisionWriteOut,
    DiscretionaryIn,
    ForwardDemandOut,
    GridRowOut,
    PoolBudgetOut,
    PostedIn,
    RemainingPoolOut,
    RemainingResponse,
    RequestsGridResponse,
    Round3AmountIn,
    Round3ApprovalIn,
    RoundCellOut,
    RoundCountsOut,
    RoundOut,
    UnpostIn,
)
from api.schemas.financial_aid_intake import IssueOut
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_calc_inputs import (
    calculator_inputs,
    effective_ask,
    request_issues,
    to_application_inputs,
)
from api.services.financial_aid_corrections import APPLICATION_CORRECTABLE, effective_values
from api.services.financial_aid_grants_register import RegisterRow, grant_inputs_by_request
from api.services.financial_aid_intake_types import (
    STATUS_ACTIVE,
    STATUS_UNMATCHED,
    ApplicationRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_rules_service import RulesVersion
from bunking.financial_aid.calculator import ApplicationInputs, CalcIssue, GrantInput, RequestInputs
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.decisions import (
    NO_POOL,
    Cell,
    Count,
    DecisionEvent,
    EventKind,
    PoolBudget,
    PricedRequest,
    RequestToPrice,
    RoundState,
    SeasonBudget,
    fold_rounds,
    lock_snapshot,
    needs_finance,
    price_request,
    season_budget,
)
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules, SectionName
from bunking.pocketbase_batch import BatchLimitError

PRICING_SECTIONS: Final[tuple[SectionName, ...]] = (
    "income",
    "tiers",
    "equity",
    "award_tables",
    "programs",
    "cost",
    "grants",
    "awards",
    "round2",
    "round3",
    "budget",
)
_LIVE: Final = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})

# Which rules sections a round reads, so its first lock locks them (spec §7.5, Decision 11).
ROUND_SECTIONS: Final[Mapping[int, tuple[SectionName, ...]]] = {
    1: ("income", "tiers", "equity", "award_tables", "programs", "cost", "grants", "awards"),
    2: ("round2",),
    3: ("round3",),
}
_WHY_NOT: Final[Mapping[str, str]] = {
    "held": "is on hold: release the hold first",
    "pending_approval": "waits for finance's approval",
    "refused": "was refused by finance",
    "not_decided": "has no amount keyed yet",
}


class DecisionNotFoundError(FinancialAidError, LookupError):
    """No such request, or none in the season named."""


class DecisionRefusedError(FinancialAidError, ValueError):
    """A write that can't be applied; the message is safe to show staff."""


class DecisionChangedError(FinancialAidError, ValueError):
    """A confirmed amount is no longer the decided amount (Decision 9). Nothing was written."""

    def __init__(self, rows: Sequence[ChangedRowOut]) -> None:
        super().__init__(
            "A decided amount moved since it was shown, so nothing was posted: check the rows and tick again"
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
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
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
    # The grants register's calculator input per request, built once for pricing and the budget.
    grants: Mapping[str, Sequence[GrantInput]]


Names = tuple[dict[int, str], dict[int, str]]


@dataclass(frozen=True)
class _RequestSide:
    """The season's loads that hang off its requests: rules, applications, corrections, equity
    answers, and (for the grid) the family and camper names."""

    rules: RulesVersion | None
    applications: list[ApplicationRecord]
    requests: list[RequestRecord]
    corrections: list[CorrectionRecord]
    equity: dict[int, EquityAnswers]
    names: Names


async def _no_names() -> Names:
    return {}, {}


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
) -> RequestToPrice:
    ask = effective_ask(request, corrections)
    answers = effective_values(
        application.answers if application is not None else {}, APPLICATION_CORRECTABLE, corrections
    )
    live = request.status in _LIVE

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
        )

    if not live or application is None:
        blocked = request.status if not live else "no application for this request"
        return build(ApplicationInputs(household_cm_id=request.household_cm_id), None, blocked, ())
    if rules is None:
        issues = tuple(request_issues(request, application.flags, answers, shares, None))
        return build(to_application_inputs(application.household_cm_id, answers), None, "", issues)
    converted = calculator_inputs(request, application, answers, corrections, sessions, shares, equity, rules)
    return build(converted.application, converted.request, converted.blocked, converted.issues)


def _money(value: Decimal | None) -> float | None:
    return money(value) if value is not None else None


def _issue(issue: CalcIssue) -> IssueOut:
    return IssueOut(code=issue.code, severity=issue.severity, message=issue.message)


def grid_row(
    request: RequestRecord,
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    sessions: Mapping[int, SessionRow],
    families: Mapping[int, str],
    campers: Mapping[int, str],
) -> GridRowOut:
    session = sessions.get(request.session_cm_id)
    result = priced.result
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
            would_change_by=_money(v.would_change_by),
            counts_toward_budget=v.counts_toward_budget,
            rules_version=rounds[v.round].rules_version if v.round in rounds else None,
        )
        for v in priced.rounds
    ]
    decided = [v.decided for v in priced.rounds if v.decided is not None]
    posted = [v.locked for v in priced.rounds if v.status == "posted" and v.locked is not None]
    return GridRowOut(
        request_id=request.id,
        household_cm_id=request.household_cm_id,
        family_name=families.get(request.household_cm_id, f"Household {request.household_cm_id}"),
        person_cm_id=request.person_cm_id,
        camper_name=campers.get(request.person_cm_id, ""),
        session_cm_id=request.session_cm_id,
        session_name=session.name if session is not None else "",
        program_key=priced.program_key,
        pool=priced.pool,
        request_status=request.status,
        tier=result.final_tier if result is not None else None,
        cost=_money(result.cost) if result is not None else None,
        rounds=views,
        total_decided=money(sum(decided, ZERO)) if decided else None,
        total_posted=money(sum(posted, ZERO)) if posted else None,
        holds=[_issue(i) for i in priced.holds],
        notes=[_issue(i) for i in priced.notes],
    )


def _count(count: Count) -> CountOut:
    return CountOut(families=count.families, requests=count.requests)


def _cell(cell: Cell) -> CellOut:
    return CellOut(
        allocated=_money(cell.allocated),
        posted=money(cell.posted),
        accepted=money(cell.accepted),
        needs_offer=money(cell.needs_offer),
        pending_approval=money(cell.pending_approval),
        remaining=_money(cell.remaining),
    )


def _pool_out(pool: PoolBudget) -> PoolBudgetOut:
    return PoolBudgetOut(
        pool=pool.pool,
        label=pool.label,
        rounds=[RoundCellOut(round=n, **_cell(cell).model_dump()) for n, cell in sorted(pool.rounds.items())],
        total=_cell(pool.total),
        below=BelowTheLineOut(
            held=_count(pool.below.held),
            held_asked=money(pool.below.held_asked),
            outside_grants=money(pool.below.outside_grants),
            outside_budget=money(pool.below.outside_budget),
        ),
        demand=ForwardDemandOut(
            round2_asks=_count(pool.demand.round2_asks),
            round2_asked=money(pool.demand.round2_asked),
            round2_computed=money(pool.demand.round2_computed),
            round1_unmet=money(pool.demand.round1_unmet),
        ),
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
            )
            for n, c in sorted(budget.strip.items())
        ],
        outside_grants_off_requests=money(budget.outside_grants_off_requests),
    )


class FinancialAidDecisionsService:
    def __init__(
        self,
        store: DecisionsStore,
        rules: PricingRules,
        register: RegisterSource,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._rules = rules
        self._register = register
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def _request_side(self, year: int, *, names: bool) -> _RequestSide:
        rules, applications, requests, corrections = await asyncio.gather(
            self._rules.latest_approved(year, PRICING_SECTIONS),
            self._store.fetch_applications(year),
            self._store.fetch_requests(year),
            self._store.fetch_corrections(year, None),
        )
        people = sorted({r.person_cm_id for r in requests if r.person_cm_id > 0})
        households = {r.household_cm_id for r in requests}
        equity, found = await asyncio.gather(
            self._store.fetch_equity_answers(year, people),
            self._store.fetch_names(year, households, people) if names else _no_names(),
        )
        return _RequestSide(rules, applications, requests, corrections, equity, found)

    async def _rounds_side(
        self, year: int
    ) -> tuple[list[SessionRow], list[PayerShareRecord], list[DecisionEvent], Sequence[RegisterRow]]:
        return await asyncio.gather(
            self._store.fetch_sessions(year),
            self._store.fetch_payer_shares(year),
            self._store.fetch_decision_events(year),
            self._register(year),
        )

    async def season(self, year: int) -> Season:
        """Every request of the season priced now, with its rounds (D21: the server decides)."""
        return (await self._season(year, names=False))[0]

    async def _season(self, year: int, *, names: bool) -> tuple[Season, Names]:
        """The season's loads run as two concurrent branches: the requests with what hangs off them
        (the names too, when asked), and the sessions, shares, events and grants register."""
        side, (sessions, shares, events, register) = await asyncio.gather(
            self._request_side(year, names=names), self._rounds_side(year)
        )
        rules = side.rules
        rounds = fold_rounds(events)
        grants = grant_inputs_by_request(register)
        by_id = {a.id: a for a in side.applications}
        own: dict[str, list[CorrectionRecord]] = defaultdict(list)
        for correction in side.corrections:
            own[correction.application_id].append(correction)
        session_map = {s.cm_id: s for s in sessions}
        document = rules.document if rules is not None else None
        priced = {
            r.id: price_request(
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
                ),
                document,
            )
            for r in side.requests
        }
        season = Season(
            year=year,
            rules=rules,
            requests={r.id: r for r in side.requests},
            priced=priced,
            rounds=rounds,
            register=tuple(register),
            sessions=session_map,
            grants=grants,
        )
        return season, side.names

    def _budget(self, season: Season) -> SeasonBudget:
        by_request = {rid: sum((g.amount for g in grants), ZERO) for rid, grants in season.grants.items()}
        off = sum(
            (row.amount for row in season.register if row.counts and row.funder_type == "outside" and not row.requests),
            ZERO,
        )
        document = season.rules.document if season.rules is not None else None
        return season_budget(
            season.priced.values(), document, outside_grants=by_request, outside_grants_off_requests=off
        )

    async def grid(self, year: int) -> RequestsGridResponse:
        season, (families, campers) = await self._season(year, names=True)
        rows = [
            grid_row(season.requests[rid], priced, season.rounds.get(rid, {}), season.sessions, families, campers)
            for rid, priced in season.priced.items()
        ]
        rows.sort(key=lambda r: (r.family_name.lower(), r.household_cm_id, r.camper_name.lower(), r.request_id))
        rules_version = season.rules.version if season.rules is not None else None
        return RequestsGridResponse(year=year, rules_version=rules_version, rows=rows)

    async def budget(self, year: int) -> BudgetResponse:
        season = await self.season(year)
        return budget_out(year, season.rules, self._budget(season))

    async def remaining(self, year: int) -> RemainingResponse:
        """D48: one figure per pool, summed over Rounds 1–3, and the total. Aggregates only (D75)."""
        budget = self._budget(await self.season(year))
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

    async def _live(self, request_id: str) -> tuple[RequestRecord, dict[int, RoundState]]:
        request = await self._store.fetch_request(request_id)
        if request is None:
            raise DecisionNotFoundError("no such request")
        if request.status not in _LIVE:
            raise DecisionRefusedError(f"a {request.status} request takes no new asks or amounts")
        rounds = fold_rounds(await self._store.fetch_request_events(request.id)).get(request.id, {})
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
        if state.posted:
            raise DecisionRefusedError(f"Round {n} is posted; its ask can't change")
        if n == 2 and not rounds.get(1, RoundState(round=1)).posted:
            raise DecisionRefusedError(
                "An appeal answers a posted offer: tick Round 1 Posted first, or correct the Round 1 ask"
            )
        later = next((m for m in range(n + 1, 4) if rounds.get(m, RoundState(round=m)).posted), None)
        if later is not None:
            raise DecisionRefusedError(f"Round {later} is posted and builds on Round {n}: its ask can't change now")
        if (state.ask, state.asked_on, state.statement_of_need) == (body.amount, body.asked_on, body.statement_of_need):
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

    async def key_round3_amount(
        self, request_id: str, body: Round3AmountIn, actor: str, *, can_approve: bool
    ) -> DecisionWriteOut:
        """A Round 3 amount. Keyed by someone without finance's permission above the season's registrar
        limit, it waits as Pending approval (D22, D79); finance's own is approved at once."""
        request, rounds = await self._live(request_id)
        state = rounds.get(3, RoundState(round=3))
        if state.posted:
            raise DecisionRefusedError("Round 3 is posted; its amount can't change")
        if state.ask is None:
            raise DecisionRefusedError("Key the family's Round 3 ask and statement of need first")
        rules = await self._approved_rules(request.year)
        if rules.document.round3.require_round2 and rounds.get(2, RoundState(round=2)).ask is None:
            raise DecisionRefusedError(
                f"The {request.year} rules give Round 3 only after a Round 2 appeal: key the family's Round 2 ask first"
            )
        if state.award == body.amount and state.approval != "refused":
            return self._unchanged(request.year)
        pending = not can_approve and needs_finance(body.amount, rules.document)
        write = self._write(
            request, 3, "award", actor, amount=body.amount, needs_approval=pending, note=body.note or None
        )
        result = await self._store.commit([write], actor=actor, reason=body.note or None)
        return DecisionWriteOut(
            year=request.year, written=1, unchanged=0, operation_id=result.operation_id, pending_approval=pending
        )

    async def key_discretionary(self, request_id: str, body: DiscretionaryIn, actor: str) -> DecisionWriteOut:
        """Finance's discretionary money, on the round its decision type names (spec §7.1)."""
        request, rounds = await self._live(request_id)
        rules = await self._approved_rules(request.year)
        decision = rules.document.awards.decision_types.get(body.decision_type)
        if decision is None or decision.kind != "discretionary":
            raise DecisionRefusedError(
                f"'{body.decision_type}' is not a discretionary decision type in the {request.year} rules"
            )
        other = next(
            (s.discretionary_type for s in rounds.values() if s.discretionary_type not in ("", body.decision_type)),
            None,
        )
        if other is not None:
            raise DecisionRefusedError(f"This request already carries '{other}'")
        if any(s.posted and (s.snapshot or {}).get("decision_type") for s in rounds.values()):
            raise DecisionRefusedError("This request's discretionary money is already posted; it can't change")
        n = decision.round
        state = rounds.get(n, RoundState(round=n))
        if state.posted:
            raise DecisionRefusedError(f"Round {n} is posted; its discretionary amount can't change")
        if state.discretionary_type == body.decision_type and state.discretionary == body.amount:
            return self._unchanged(request.year)
        write = self._write(
            request, n, "award", actor, amount=body.amount, decision_type=body.decision_type, note=body.note
        )
        result = await self._store.commit([write], actor=actor, reason=body.note, require_reason=True)
        return DecisionWriteOut(year=request.year, written=1, unchanged=0, operation_id=result.operation_id)

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

    async def tick_posted(self, year: int, body: PostedIn, actor: str) -> DecisionWriteOut:
        """The registrar entered these awards in CampMinder: tick Posted, locking each round at its
        decided amount with its receipt and rules version (D51, D52), and lock the rules sections a
        round's first lock reads (Decision 11). All or nothing (Decision 9)."""
        season = await self.season(year)
        if season.rules is None:
            raise DecisionRefusedError(f"{year}'s pricing rules are not approved yet")
        confirmed: dict[tuple[str, int], Decimal] = {}
        for row in body.rows:
            key = (row.request_id, row.round)
            if confirmed.setdefault(key, row.amount) != row.amount:
                raise DecisionRefusedError(f"{row.request_id}: Round {row.round} appears twice with different amounts")
        problems: list[str] = []
        changed: list[ChangedRowOut] = []
        to_post: list[tuple[PricedRequest, int, Decimal]] = []
        unchanged = 0
        for (request_id, n), amount in confirmed.items():
            priced = season.priced.get(request_id)
            if priced is None:
                raise DecisionNotFoundError(f"request {request_id} is not in {year}")
            view = priced.view(n)
            if view is not None and view.status == "posted":
                unchanged += 1
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
                problems.append(f"{request_id}: tick Round {unposted} Posted before Round {n}")
                continue
            if view.decided != amount:
                changed.append(
                    ChangedRowOut(
                        request_id=request_id, round=n, confirmed=money(amount), decided_now=money(view.decided)
                    )
                )
                continue
            to_post.append((priced, n, view.decided))
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        if changed:
            raise DecisionChangedError(changed)
        if not to_post:
            return self._unchanged(year, unchanged)
        version = season.rules.version
        posted_on = body.posted_on or self._today()
        writes = [
            self._write(
                season.requests[priced.request_id],
                n,
                "post",
                actor,
                amount=amount,
                effective_on=posted_on,
                lock_source="tick",
                rules_version=version,
                snapshot=lock_snapshot(priced, n, version),
            )
            for priced, n, amount in to_post
        ]
        sections = sorted({section for _, n, _ in to_post for section in ROUND_SECTIONS[n]})
        locks, not_locked = await self._rules.lock_writes(year, version, sections)
        try:
            result = await self._store.commit([*writes, *locks], actor=actor)
        except BatchLimitError as exc:
            raise DecisionRefusedError(
                f"{len(writes)} rounds are too many to tick at once; tick them in smaller groups"
            ) from exc
        return DecisionWriteOut(
            year=year,
            written=len(writes),
            unchanged=unchanged,
            operation_id=result.operation_id,
            total_locked=money(sum((amount for _, _, amount in to_post), ZERO)),
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
        if state.accepted:
            raise DecisionRefusedError(f"Untick Accepted on Round {n} first")
        for m in range(n + 1, 4):
            later = rounds.get(m)
            if later is not None and later.posted:
                raise DecisionRefusedError(f"Round {m} is posted and builds on Round {n}: undo it first")
        write = self._write(request, n, "unpost", actor, note=body.reason)
        result = await self._store.commit([write], actor=actor, reason=body.reason, require_reason=True)
        return DecisionWriteOut(year=year, written=1, unchanged=0, operation_id=result.operation_id)

    async def tick_accepted(self, year: int, body: AcceptedIn, actor: str) -> DecisionWriteOut:
        """The Accepted tick, single or bulk (D47: no ledger meaning; shown, never subtracted, D53)."""
        requests = {r.id: r for r in await self._store.fetch_requests(year)}
        rounds = fold_rounds(await self._store.fetch_decision_events(year))
        writes: list[AidWrite] = []
        problems: list[str] = []
        unchanged = 0
        for request_id, n in dict.fromkeys((row.request_id, row.round) for row in body.rows):
            request = requests.get(request_id)
            if request is None:
                raise DecisionNotFoundError(f"request {request_id} is not in {year}")
            state = rounds.get(request_id, {}).get(n, RoundState(round=n))
            if state.accepted == body.accepted:
                unchanged += 1
            elif not state.posted:
                problems.append(f"{request_id}: Round {n} is not posted")
            else:
                writes.append(self._write(request, n, "accept" if body.accepted else "unaccept", actor))
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        if not writes:
            return self._unchanged(year, unchanged)
        result = await self._store.commit(writes, actor=actor)
        return DecisionWriteOut(year=year, written=len(writes), unchanged=unchanged, operation_id=result.operation_id)

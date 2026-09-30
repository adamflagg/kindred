"""Campership decisions (sub-project 10a): the season priced, its three reads, and the writes that
record each round's asks and decisions (spec §5.1–§5.3, §6.1, §7.1–§7.3; D41–D44, D50–D53, D78–D82).

Reads (financial_aid.view; the Remaining line also financial_aid.summary). Each prices the whole
season on the server and returns one aggregate (D21): the Requests grid, Rounds & budget, and the
Remaining line. They are live only (Decision 12), but every event they read is dated, so as-of can
follow.

Pricing uses the season's newest rules version whose pricing sections are all approved or locked
(PRICING_SECTIONS). With none, every live request is held and nothing is allocated.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final, Protocol

from api.schemas.financial_aid_decisions import (
    BelowTheLineOut,
    BudgetResponse,
    CellOut,
    CountOut,
    ForwardDemandOut,
    GridRowOut,
    PoolBudgetOut,
    RemainingPoolOut,
    RemainingResponse,
    RequestsGridResponse,
    RoundCellOut,
    RoundCountsOut,
    RoundOut,
)
from api.schemas.financial_aid_intake import IssueOut
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
    PoolBudget,
    PricedRequest,
    RequestToPrice,
    RoundState,
    SeasonBudget,
    fold_rounds,
    price_request,
    season_budget,
)
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules, SectionName

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

    async def season(self, year: int) -> Season:
        """Every request of the season priced now, with its rounds (D21: the server decides)."""
        # Two gathers: asyncio.gather's typed overloads stop at six awaitables.
        rules, applications, requests, corrections = await asyncio.gather(
            self._rules.latest_approved(year, PRICING_SECTIONS),
            self._store.fetch_applications(year),
            self._store.fetch_requests(year),
            self._store.fetch_corrections(year, None),
        )
        sessions, shares, events, register = await asyncio.gather(
            self._store.fetch_sessions(year),
            self._store.fetch_payer_shares(year),
            self._store.fetch_decision_events(year),
            self._register(year),
        )
        people = sorted({r.person_cm_id for r in requests if r.person_cm_id > 0})
        equity = await self._store.fetch_equity_answers(year, people)
        rounds = fold_rounds(events)
        grants = grant_inputs_by_request(register)
        by_id = {a.id: a for a in applications}
        own: dict[str, list[CorrectionRecord]] = defaultdict(list)
        for correction in corrections:
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
                    equity.get(r.person_cm_id),
                    rounds.get(r.id, {}),
                    tuple(grants.get(r.id, [])),
                    document,
                ),
                document,
            )
            for r in requests
        }
        return Season(
            year=year,
            rules=rules,
            requests={r.id: r for r in requests},
            priced=priced,
            rounds=rounds,
            register=tuple(register),
            sessions=session_map,
        )

    def _budget(self, season: Season) -> SeasonBudget:
        by_request = {
            rid: sum((g.amount for g in grants), ZERO)
            for rid, grants in grant_inputs_by_request(season.register).items()
        }
        off = sum(
            (row.amount for row in season.register if row.counts and row.funder_type == "outside" and not row.requests),
            ZERO,
        )
        document = season.rules.document if season.rules is not None else None
        return season_budget(
            season.priced.values(), document, outside_grants=by_request, outside_grants_off_requests=off
        )

    async def grid(self, year: int) -> RequestsGridResponse:
        season = await self.season(year)
        households = {r.household_cm_id for r in season.requests.values()}
        persons = {r.person_cm_id for r in season.requests.values() if r.person_cm_id > 0}
        families, campers = await self._store.fetch_names(year, households, persons)
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

"""Today (clean spec §6.4; D24: one dense line per queue; D21: counts come from the same server query
as the lists). The casework lines count the queue memberships the Requests grid carries on each row
(financial_aid_queues), so "Open ›" shows exactly the rows counted. The grants lines read the grants
register's needs-attention groups; the finance lines read the same rows plus the rules draft and the
season's descriptions. Counts of work carry no basis word and no definition (D20).

Not here yet: To place (SP11-rest builds it) and the intake run's equity_field_never_true warning
(it is computed by the intake run and not stored where a read can find it).
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Final, Protocol

from api.schemas.financial_aid import UnclassifiedSource
from api.schemas.financial_aid_decisions import GridRowOut, QueueOut
from api.schemas.financial_aid_grants import GrantorOut, GrantorsResponse, GrantsResponse
from api.schemas.financial_aid_surfaces import (
    TodayKey,
    TodayLineOut,
    TodayReasonOut,
    TodayResponse,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import DecisionsStore, FinancialAidDecisionsService, PricingRules
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import GrantsLoader, OneGrantsLoad
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_queues import UNRECONCILED
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from bunking.financial_aid.decisions.pricing import NO_APPROVED_RULES

CASEWORK_LINES: Final[tuple[TodayKey, ...]] = (
    "needs_offer",
    "holds",
    "waiting_on_family",
    "not_reconciled",
    "to_reverse",
    "session_not_settled",
    "duplicates",
    "cancel_reason",
    "grants",
    "late_full_coverage",
)
FINANCE_LINES: Final[tuple[TodayKey, ...]] = ("pending_approval", "rules_sections", "would_change", "sources", "intake")
WAITING_TOO_LONG_DAYS: Final = 14  # §6.4: "how many over 14 days"


@dataclass(frozen=True)
class TodayInputs:
    year: int
    rows: Sequence[GridRowOut]
    grants: GrantsResponse
    register: Sequence[RegisterRow]  # the rows the season was priced with (OneGrantsLoad): each grant's recorded_at
    grantors: Sequence[GrantorOut]
    draft_sections: Sequence[str] | None  # the rules draft's sections not yet approved; None: no rules yet
    unclassified: Sequence[UnclassifiedSource]
    today: date


def _families(rows: Iterable[GridRowOut]) -> int:
    return len({row.household_cm_id for row in rows})


def _reasons(pairs: Iterable[tuple[str, int]]) -> list[TodayReasonOut]:
    """(code, household) pairs, one per item, into reasons: largest first, then by code."""
    items: dict[str, int] = defaultdict(int)
    households: dict[str, set[int]] = defaultdict(set)
    for code, household in pairs:
        items[code] += 1
        households[code].add(household)
    return [
        TodayReasonOut(code=code, families=len(households[code]) if households[code] - {0} else None, items=n)
        for code, n in sorted(items.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _line(
    key: TodayKey,
    rows: Sequence[GridRowOut],
    *,
    reasons: list[TodayReasonOut] | None = None,
    amount: float | None = None,
    oldest_days: int | None = None,
    over_14_days: int | None = None,
    largest_gap: float | None = None,
    listed: bool = False,
) -> TodayLineOut:
    """A line counting grid rows: families and requests. `listed` lines that are no Requests view name their
    request ids, so Open › shows exactly what was counted (D21; plan review I4)."""
    return TodayLineOut(
        key=key,
        families=_families(rows),
        items=len(rows),
        item_kind="requests",
        reasons=reasons or [],
        amount=amount,
        oldest_days=oldest_days,
        over_14_days=over_14_days,
        largest_gap=largest_gap,
        request_ids=[row.request_id for row in rows] if listed else [],
    )


def _in(rows: Sequence[GridRowOut], queue: QueueOut) -> list[GridRowOut]:
    return [row for row in rows if row.queues and queue in row.queues]


def _waiting_since(row: GridRowOut) -> date | None:
    days = [r.posted_on for r in row.rounds if r.status == "posted" and not r.accepted and not r.clawed_back]
    return min((d for d in days if d is not None), default=None)


def _unreconciled(row: GridRowOut) -> set[str]:
    """Why a row is Not reconciled: the request's state, or, when it is confirmed, its shares' (D59)."""
    c = row.confirmation
    if c is None:
        return set()
    if c.status in UNRECONCILED:
        return {c.status}
    return {s.status for s in c.shares if s.status in UNRECONCILED}


DISAGREEING: Final = frozenset({"short", "over", "not_in_campminder"})


def _disagreements(row: GridRowOut) -> list[float]:
    """The dollar size of each disagreement on the row: the request's, else its shares'. Short, over and
    not_in_campminder (a lock CampMinder holds $0 against: its gap is the locked amount) count; awaiting_sync
    is not a disagreement (owner ruling 2026-10-01)."""
    c = row.confirmation
    if c is None:
        return []
    if c.status in DISAGREEING:
        return [abs(c.gap)]
    return [
        money(abs(Decimal(str(s.in_campminder)) - Decimal(str(s.expected))))
        for s in c.shares
        if s.status in DISAGREEING
    ]


def _late_full_coverage(inputs: TodayInputs) -> list[GridRowOut]:
    """Main spec §10.3: a counted grant from a full-coverage grantor that became known (D116: the register row's
    recorded_at, a commitment's entry or the line's post, whichever came first) after a round of its request was
    posted, so the posted award was set without it (D43: never lowered; talk to the family). A last-dollar grantor
    (pays_after_camp_aid, D143) pays after the award by design and is never late. A grant with no date is skipped."""
    full = {g.key for g in inputs.grantors if g.full_coverage and not g.pays_after_camp_aid}
    by_id = {row.request_id: row for row in inputs.rows}
    late: dict[str, GridRowOut] = {}
    for grant in inputs.register:
        if (
            not grant.counts
            or grant.is_reversed
            or grant.funder_type != "outside"
            or grant.pays_after_camp_aid
            or grant.grantor_key not in full
            or grant.recorded_at is None
        ):
            continue
        known = grant.recorded_at.astimezone(CAMP_TZ).date()
        for share in grant.requests:
            row = by_id.get(share.request_id)
            if row is not None and any(
                r.status == "posted" and not r.clawed_back and r.posted_on is not None and r.posted_on < known
                for r in row.rounds
            ):
                late[row.request_id] = row
    return [late[rid] for rid in sorted(late)]


def _casework(inputs: TodayInputs) -> list[TodayLineOut]:
    rows = inputs.rows
    needs_offer = _in(rows, "needs_offer")
    holds = _in(rows, "holds")
    waiting = _in(rows, "waiting_on_family")
    since = [d for d in (_waiting_since(row) for row in waiting) if d is not None]
    unreconciled = _in(rows, "not_reconciled")
    gaps = [gap for row in unreconciled for gap in _disagreements(row)]
    needs_camper = inputs.grants.needs_camper
    waiting_grants = inputs.grants.waiting
    grant_households = {n.grant.household_cm_id for n in needs_camper} | {
        w.grant.household_cm_id for w in waiting_grants
    }
    lines = {
        "needs_offer": _line(
            "needs_offer",
            needs_offer,
            reasons=_reasons(
                (f"r{r.round}", row.household_cm_id)
                for row in needs_offer
                for r in row.rounds
                if r.status == "needs_offer"
            ),
        ),
        "holds": _line(
            "holds", holds, reasons=_reasons((h.code, row.household_cm_id) for row in holds for h in row.holds)
        ),
        "waiting_on_family": _line(
            "waiting_on_family",
            waiting,
            oldest_days=(inputs.today - min(since)).days if since else None,
            over_14_days=sum(1 for d in since if (inputs.today - d).days > WAITING_TOO_LONG_DAYS),
        ),
        "not_reconciled": _line(
            "not_reconciled",
            unreconciled,
            reasons=_reasons((code, row.household_cm_id) for row in unreconciled for code in _unreconciled(row)),
            largest_gap=max(gaps) if gaps else None,
        ),
        "to_reverse": _line("to_reverse", _in(rows, "to_reverse")),
        "session_not_settled": _line("session_not_settled", _in(rows, "session_not_settled")),
        "duplicates": _line("duplicates", _in(rows, "duplicates")),
        "cancel_reason": _line("cancel_reason", _in(rows, "cancel_reason")),
        "grants": TodayLineOut(
            key="grants",
            families=len(grant_households),
            items=len(needs_camper) + len(waiting_grants),
            item_kind="grants",
            reasons=_reasons(
                [("needs_camper", n.grant.household_cm_id) for n in needs_camper]
                + [(w.reason, w.grant.household_cm_id) for w in waiting_grants]
            ),
        ),
        "late_full_coverage": _line("late_full_coverage", _late_full_coverage(inputs), listed=True),
    }
    return [lines[key] for key in CASEWORK_LINES]


def _finance(inputs: TodayInputs) -> list[TodayLineOut]:
    rows = inputs.rows
    pending = _in(rows, "pending_approval")
    pending_amount = sum(
        (Decimal(str(r.pending_approval)) for row in pending for r in row.rounds if r.pending_approval is not None),
        Decimal(0),
    )
    would_change = [
        row for row in rows if any(r.status == "posted" and r.would_change_by not in (None, 0) for r in row.rounds)
    ]
    intake_codes = (FLAG_AWAITING_RULES, NO_APPROVED_RULES)
    intake = [row for row in rows if any(h.code in intake_codes for h in row.holds)]
    sections = sorted(inputs.draft_sections or [])
    lines = {
        "pending_approval": _line("pending_approval", pending, amount=money(pending_amount)),
        "rules_sections": TodayLineOut(
            key="rules_sections",
            families=None,
            items=len(sections),
            item_kind="sections",
            reasons=_reasons((name, 0) for name in sections),
        ),
        "would_change": _line("would_change", would_change, listed=True),
        "sources": TodayLineOut(
            key="sources",
            families=None,
            items=len(inputs.grants.unmapped) + len(inputs.unclassified),
            item_kind="descriptions",
            reasons=_reasons(
                [("no_grantor", 0) for _ in inputs.grants.unmapped] + [("unclassified", 0) for _ in inputs.unclassified]
            ),
        ),
        "intake": _line(
            "intake",
            intake,
            reasons=_reasons(
                (h.code, row.household_cm_id) for row in intake for h in row.holds if h.code in intake_codes
            ),
            listed=True,
        ),
    }
    return [lines[key] for key in FINANCE_LINES]


def build_today(inputs: TodayInputs, *, casework: bool, finance: bool) -> TodayResponse:
    return TodayResponse(
        year=inputs.year,
        casework=_casework(inputs) if casework else None,
        finance=_finance(inputs) if finance else None,
    )


class GrantsReads(GrantsLoader, Protocol):
    async def list_grantors(self) -> GrantorsResponse: ...


class RulesDrafts(Protocol):
    async def load(self, year: int, version: int | None = None) -> RulesVersion: ...


class LedgerReads(Protocol):
    async def unclassified_sources(self, year: int) -> list[UnclassifiedSource]: ...


async def _draft_sections(rules: RulesDrafts, year: int) -> list[str] | None:
    """The rules draft's sections awaiting approval (D39): the latest version's sections still in draft."""
    try:
        latest = await rules.load(year)
    except RulesNotFoundError:
        return None
    return [name for name, status in latest.section_status.items() if status.state == "draft"]


class TodayService:
    """Today's one aggregate read (D21): the live season priced once, with the grants register it was
    priced with (OneGrantsLoad), and only for finance the rules draft and the season's descriptions."""

    def __init__(
        self,
        *,
        store: DecisionsStore,
        pricing: PricingRules,
        rules: RulesDrafts,
        grants: GrantsReads,
        ledger: LedgerReads,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._pricing = pricing
        self._rules = rules
        self._grants = grants
        self._ledger = ledger
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def read(self, year: int, *, casework: bool, finance: bool) -> TodayResponse:
        if not (casework or finance):
            return TodayResponse(year=year, casework=None, finance=None)
        shared = OneGrantsLoad(self._grants, year)
        decisions = FinancialAidDecisionsService(self._store, self._pricing, shared.register, clock=self._clock)
        season, (grants, register), grantors, draft, unclassified = await asyncio.gather(
            decisions.season(year),
            shared.read(),
            self._grants.list_grantors() if casework else _no_grantors(),
            _draft_sections(self._rules, year) if finance else _none(),
            self._ledger.unclassified_sources(year) if finance else _no_sources(),
        )
        rows = [decisions.row_of(season, ({}, {}), request_id) for request_id in season.priced]
        inputs = TodayInputs(
            year=year,
            rows=rows,
            grants=grants,
            register=register,
            grantors=grantors.grantors,
            draft_sections=draft,
            unclassified=unclassified,
            today=self._clock().astimezone(CAMP_TZ).date(),
        )
        return build_today(inputs, casework=casework, finance=finance)


async def _no_grantors() -> GrantorsResponse:
    return GrantorsResponse(grantors=[])


async def _none() -> None:
    return None


async def _no_sources() -> list[UnclassifiedSource]:
    return []

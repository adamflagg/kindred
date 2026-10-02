"""Rounds & budget's figures (campership sub-project 10a; spec §5.3, §5.9, §7.2; D44, D46, D53, D54, D79, D82).

Per pool × round, and in total:

  Allocated         the round's share of the pool, from the approved rules. Round 2 and Round 3 get
                    their reserves (budget.reserves, % of the pool); Round 1 gets the rest, its
                    late-Round-1 reserve included (D44: unused reserves stay inside each round).
  Posted            the locked amounts of posted rounds (D53).
  Accepted          the locked amounts of posted rounds ticked Accepted: shown, never subtracted.
  Needs an offer    the decided amounts of rounds decided and not posted.
  Pending approval  Round 3 amounts above the registrar's limit awaiting finance, at the keyed amount (D79).
  Remaining         Allocated − Posted − Needs an offer − Pending approval (D44, D53, D79).

A round whose decision type does not count toward the budget is left out of Posted, Accepted and
Needs an offer whole, base and extra alike: its money goes below the line (owner ruling 2026-09-30).

Below the line, never in Remaining: held rounds (their count and ask), outside grants, and money on
a decision type outside the camp's own budget. Forward demand (D82): Round 2 asks so far (count,
total asked, total computed; held appeals' asks included) and Round 1 unmet ask, not yet appealed
(§5.9). This year only (D46): no pace, no last year. A posted round whose money CampMinder has
reversed (clawed_back, D54) counts nowhere: its money is back in Remaining.

Money on a program the rules give no pool is counted in the total only, under "No pool": it has no
allocation of its own. The total's allocation is the sum of the rules' pools.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from bunking.financial_aid.decisions.pricing import PricedRequest, RoundView
from bunking.financial_aid.decisions.rounds import ROUNDS
from bunking.financial_aid.money import HUNDRED, ZERO
from bunking.financial_aid.rules.schema import AidRules

NO_POOL: Final = ""
NO_POOL_LABEL: Final = "No pool"
TOTAL: Final = "*"
_CENT: Final = Decimal("0.01")
_STRIP: Final = ("needs_offer", "posted", "accepted", "held", "pending_approval")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Count:
    """Principle 7: every count says both ("3 families · 4 requests")."""

    families: int = 0
    requests: int = 0


@dataclass(frozen=True)
class RoundLedger:
    """What the ledger says of one posted round (owner ruling ⚠10, 2026-10-02). `unconfirmed` is the part of its lock
    that CampMinder's live camp-aid net on the request doesn't fill, oldest round first, per payer share; `awaiting` is
    its own tick coming after the last ledger sync. Built by api.services.financial_aid_reconciliation.round_ledger."""

    unconfirmed: Decimal
    awaiting: bool


@dataclass(frozen=True)
class Cell:
    allocated: Decimal | None
    posted: Decimal
    accepted: Decimal
    needs_offer: Decimal
    pending_approval: Decimal
    # Owner ruling ⚠10: the part of Posted CampMinder hasn't confirmed. None: the read loaded no ledger.
    unconfirmed: Decimal | None = None
    unconfirmed_count: Count | None = None

    @property
    def remaining(self) -> Decimal | None:
        """Allocated − Posted − Needs an offer − Pending approval (D44, D53, D79); None with no allocation."""
        if self.allocated is None:
            return None
        return self.allocated - self.posted - self.needs_offer - self.pending_approval


@dataclass(frozen=True)
class RoundCounts:
    needs_offer: Count
    posted: Count
    accepted: Count
    held: Count
    pending_approval: Count
    # Decision 3: the amber count split by why (None: no ledger read).
    awaiting_sync: Count | None = None
    not_reconciled: Count | None = None


@dataclass(frozen=True)
class BelowTheLine:
    held: Count
    held_asked: Decimal
    outside_grants: Decimal
    outside_budget: Decimal
    outside_budget_posted: Decimal  # the posted part of outside_budget: dated on every read (3c)


@dataclass(frozen=True)
class ForwardDemand:
    round2_asks: Count
    round2_asked: Decimal
    round2_computed: Decimal
    round1_unmet: Decimal


@dataclass(frozen=True)
class PoolBudget:
    pool: str
    label: str
    rounds: Mapping[int, Cell]
    total: Cell
    below: BelowTheLine
    demand: ForwardDemand


@dataclass(frozen=True)
class SeasonBudget:
    pools: tuple[PoolBudget, ...]
    total: PoolBudget
    strip: Mapping[int, RoundCounts]
    outside_grants_off_requests: Decimal


@dataclass
class _Tally:
    amount: Decimal = ZERO
    families: set[int] = field(default_factory=set)
    requests: set[str] = field(default_factory=set)

    def add(self, request: PricedRequest, amount: Decimal) -> None:
        self.amount += amount
        self.families.add(request.household_cm_id)
        self.requests.add(request.request_id)

    def count(self) -> Count:
        return Count(families=len(self.families), requests=len(self.requests))


_Tallies = dict[tuple[str, int, str], _Tally]


def _merged(tallies: Iterable[_Tally]) -> _Tally:
    out = _Tally()
    for tally in tallies:
        out.amount += tally.amount
        out.families |= tally.families
        out.requests |= tally.requests
    return out


def allocations(rules: AidRules) -> dict[str, dict[int, Decimal]]:
    """pool -> round -> Allocated (Decision 6): Round 2 and 3 get their reserves, Round 1 the rest."""
    out: dict[str, dict[int, Decimal]] = {}
    budget = rules.budget
    for key, pool in budget.pools.items():
        whole = pool.amount if pool.amount is not None else budget.total * (pool.share_pct or ZERO) / HUNDRED
        reserves = budget.reserves.get(key, {})
        r2 = _cents(whole * reserves.get("r2", ZERO) / HUNDRED)
        r3 = _cents(whole * reserves.get("r3", ZERO) / HUNDRED)
        # Round 1 is the remainder after the reserves round, never below 0 (an odd cent at 100% reserves).
        out[key] = {1: max(_cents(whole) - r2 - r3, ZERO), 2: r2, 3: r3}
    return out


def _home_pool(request: PricedRequest) -> str:
    return request.pool or next((view.pool for view in request.rounds if view.pool), None) or NO_POOL


def _tally_round(
    tallies: _Tallies,
    pool: str,
    request: PricedRequest,
    view: RoundView,
    ledger: Mapping[int, RoundLedger] | None = None,
) -> None:
    def add(measure: str, amount: Decimal) -> None:
        tallies[(pool, view.round, measure)].add(request, amount)

    # A type that does not count toward the budget takes its whole round below the line (owner ruling
    # 2026-09-30: only grant money is not coming out of the camp's budget), base and extra alike.
    whole = not view.counts_toward_budget
    if view.status == "posted":
        if view.clawed_back:
            return  # D54: its money came back to Remaining when CampMinder's reversal posted
        locked = view.locked or ZERO
        outside = locked if whole else ZERO
        if not whole:  # a wholly-outside round is no posted or accepted money, nor a posted request
            add("posted", locked)
            if view.accepted:
                add("accepted", locked)
            part = ledger.get(view.round) if ledger is not None else None
            if part is not None and part.unconfirmed > 0:  # ⚠10: in the round's locked pool, as Posted
                add("unconfirmed", part.unconfirmed)
                add("awaiting_sync" if part.awaiting else "not_reconciled", ZERO)  # Decision 3
        if outside:
            add("outside_budget", outside)
            add("outside_budget_posted", outside)
    elif view.status == "needs_offer":
        decided = view.decided or ZERO
        outside = decided if whole else ZERO
        if not whole:
            add("needs_offer", decided)
        if outside:
            add("outside_budget", outside)
    elif view.status == "pending_approval":
        pending = view.pending or ZERO
        if whole:  # not the camp's money: below the line, never lowering Remaining (D79 binds counting types)
            add("outside_budget", pending)
        else:
            add("pending_approval", pending)
    elif view.status == "held":
        add("held", view.ask or ZERO)


def _tally_demand(
    request: PricedRequest,
    pool: str,
    asks2: dict[str, _Tally],
    computed2: dict[str, Decimal],
    unmet1: dict[str, Decimal],
) -> None:
    """D82. Round 2 asks so far, held appeals' asks included (computed leaves held ones out); else
    Round 1 unmet ask, not yet appealed (§5.9): ask − Round 1 on a decided or posted Round 1, or the
    whole ask while Round 1 is held. It knows only the appeals keyed so far (a known gap, D82)."""
    r1, r2 = request.view(1), request.view(2)
    if r2 is not None and r2.ask is not None:
        if r2.clawed_back:
            return  # D54: a clawed-back round counts nowhere (and implies Round 1 was clawed back too)
        asks2[pool].add(request, r2.ask)
        if not r2.counts_toward_budget:
            return  # a non-counting round is not the camp's money: no forward demand
        if r2.status == "posted":
            computed2[pool] += r2.locked or ZERO
        elif r2.status == "needs_offer":
            computed2[pool] += r2.decided or ZERO
        return
    if r1 is None or r1.ask is None or r1.clawed_back:
        return  # D54: a declined offer is not unmet ask
    if r1.status == "held":
        unmet1[pool] += r1.ask
    elif not r1.counts_toward_budget:
        return  # a non-counting round is not the camp's money: no unmet demand against it
    elif r1.status in ("needs_offer", "posted"):
        amount = r1.locked if r1.status == "posted" else r1.decided
        if amount is not None:
            unmet1[pool] += max(ZERO, r1.ask - amount)  # one family's overage never offsets another's unmet


def _tally_of(tallies: _Tallies, pool: str, n: int, measure: str) -> _Tally:
    return tallies.get((pool, n, measure)) or _Tally()


def _pool_budget(
    pool: str,
    label: str,
    by_round: Mapping[int, Decimal] | None,
    tallies: _Tallies,
    *,
    grants: Decimal,
    asks2: _Tally,
    computed2: Decimal,
    unmet1: Decimal,
    confirmed: bool,
) -> PoolBudget:
    def amount(n: int, measure: str) -> Decimal:
        return _tally_of(tallies, pool, n, measure).amount

    rounds = {
        n: Cell(
            allocated=by_round[n] if by_round is not None else None,
            posted=amount(n, "posted"),
            accepted=amount(n, "accepted"),
            needs_offer=amount(n, "needs_offer"),
            pending_approval=amount(n, "pending_approval"),
            unconfirmed=amount(n, "unconfirmed") if confirmed else None,
            unconfirmed_count=_tally_of(tallies, pool, n, "unconfirmed").count() if confirmed else None,
        )
        for n in ROUNDS
    }
    cells = list(rounds.values())
    total = Cell(
        allocated=sum((c.allocated for c in cells if c.allocated is not None), ZERO) if by_round is not None else None,
        posted=sum((c.posted for c in cells), ZERO),
        accepted=sum((c.accepted for c in cells), ZERO),
        needs_offer=sum((c.needs_offer for c in cells), ZERO),
        pending_approval=sum((c.pending_approval for c in cells), ZERO),
        unconfirmed=sum((amount(n, "unconfirmed") for n in ROUNDS), ZERO) if confirmed else None,
        unconfirmed_count=(
            _merged(_tally_of(tallies, pool, n, "unconfirmed") for n in ROUNDS).count() if confirmed else None
        ),
    )
    held = _merged(_tally_of(tallies, pool, n, "held") for n in ROUNDS)
    return PoolBudget(
        pool=pool,
        label=label,
        rounds=rounds,
        total=total,
        below=BelowTheLine(
            held=held.count(),
            held_asked=held.amount,
            outside_grants=grants,
            outside_budget=sum((amount(n, "outside_budget") for n in ROUNDS), ZERO),
            outside_budget_posted=sum((amount(n, "outside_budget_posted") for n in ROUNDS), ZERO),
        ),
        demand=ForwardDemand(
            round2_asks=asks2.count(), round2_asked=asks2.amount, round2_computed=computed2, round1_unmet=unmet1
        ),
    )


def season_budget(
    priced: Iterable[PricedRequest],
    rules: AidRules | None,
    *,
    outside_grants: Mapping[str, Decimal],
    outside_grants_off_requests: Decimal = ZERO,
    not_demand: Collection[str] = frozenset(),
    ledger: Mapping[str, Mapping[int, RoundLedger]] | None = None,
) -> SeasonBudget:
    """`outside_grants` is each request's counted outside grants (the grants register's shares,
    summed, a pays-after-camp-aid grant included, D143); `outside_grants_off_requests` the counted
    outside grants on no request (Decision 14). `not_demand` are requests forward demand leaves out although
    they are live (owner ruling 2026-10-02: CampMinder cancelled them; `live` itself is not changed). `ledger` is each
    request's posted rounds against CampMinder's live net (`round_ledger`); None: no ledger read."""
    allocated = allocations(rules) if rules is not None else {}
    labels = {key: pool.label for key, pool in rules.budget.pools.items()} if rules is not None else {}
    tallies: _Tallies = defaultdict(_Tally)
    grants: dict[str, Decimal] = defaultdict(Decimal)
    asks2: dict[str, _Tally] = defaultdict(_Tally)
    computed2: dict[str, Decimal] = defaultdict(Decimal)
    unmet1: dict[str, Decimal] = defaultdict(Decimal)
    unrebuilt: set[str] = set()
    for request in priced:
        home = _home_pool(request)
        mine = ledger.get(request.request_id, {}) if ledger is not None else None
        for view in request.rounds:
            for pool in (view.pool or NO_POOL, TOTAL):
                _tally_round(tallies, pool, request, view, mine)
            if view.status == "not_rebuilt":  # a past read's: its status is unknown, but it sits in its pool (3c)
                unrebuilt.add(view.pool or NO_POOL)
        for pool in (home, TOTAL):
            grants[pool] += outside_grants.get(request.request_id, ZERO)
            if request.live and request.request_id not in not_demand:
                _tally_demand(request, pool, asks2, computed2, unmet1)
    seen = {pool for pool, _, _ in tallies} | {p for p, v in grants.items() if v} | set(asks2) | set(unmet1) | unrebuilt
    seen.discard(TOTAL)
    order = [*allocated, *sorted(seen - set(allocated) - {NO_POOL}), *([NO_POOL] if NO_POOL in seen else [])]

    def budget_for(pool: str, label: str, by_round: Mapping[int, Decimal] | None) -> PoolBudget:
        return _pool_budget(
            pool,
            label,
            by_round,
            tallies,
            grants=grants[pool],
            asks2=asks2[pool],
            computed2=computed2[pool],
            unmet1=unmet1[pool],
            confirmed=ledger is not None,
        )

    pools = tuple(
        budget_for(pool, labels.get(pool) or (NO_POOL_LABEL if pool == NO_POOL else pool), allocated.get(pool))
        for pool in order
    )
    total_allocated = (
        {n: sum((per_round[n] for per_round in allocated.values()), ZERO) for n in ROUNDS}
        if rules is not None
        else None
    )
    strip = {
        n: RoundCounts(
            **{measure: _tally_of(tallies, TOTAL, n, measure).count() for measure in _STRIP},
            awaiting_sync=_tally_of(tallies, TOTAL, n, "awaiting_sync").count() if ledger is not None else None,
            not_reconciled=_tally_of(tallies, TOTAL, n, "not_reconciled").count() if ledger is not None else None,
        )
        for n in ROUNDS
    }
    return SeasonBudget(
        pools=pools,
        total=budget_for(TOTAL, "Total", total_allocated),
        strip=strip,
        outside_grants_off_requests=outside_grants_off_requests,
    )

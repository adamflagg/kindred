"""Rounds & budget's figures (campership sub-project 10a; spec §5.3, §5.9, §7.2; D44 (reserves, superseded: nothing reads them), D46, D53, D54, D79, D82).

Per pool (and per round where a figure has one), and in total:

  Allocated         the pool's share of the approved total (§5.3 note 1); rounds have none, and
                    Round 3 is whatever is left in the pool.
  Posted            the locked amounts of posted rounds (D53).
  Accepted          the locked amounts of posted rounds ticked Accepted: shown, never subtracted.
  Needs an offer    the decided amounts of rounds decided and not posted.
  Pending approval  Round 3 amounts above the registrar's limit awaiting finance, at the keyed amount (D79).
  Committed         Posted + Needs an offer + Pending approval.
  Remaining         Allocated − Posted − Needs an offer − Pending approval, per pool and in total,
                    never per round (D53, D79).

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
# D162 C2 (owner 10-03): the Needs an offer rounds the Requests grid lists. Every count of Needs an offer reads this;
# its money reads "needs_offer", which keeps a round CampMinder already holds money for.
_LISTED: Final = "needs_offer_listed"


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
class RoundCell:
    """One round's money (spec §5.3): what it committed. A round has no allocation of its own and no Remaining
    (owner, round 2: "Remaining per POOL, not per round"; owner 10-06: the round plan dropped)."""

    posted: Decimal
    accepted: Decimal
    needs_offer: Decimal
    pending_approval: Decimal
    needs_offer_count: Count = Count()
    pending_approval_count: Count = Count()
    # Owner ruling ⚠10: the part of Posted CampMinder hasn't confirmed. None: the read loaded no ledger.
    unconfirmed: Decimal | None = None
    unconfirmed_count: Count | None = None

    @property
    def committed(self) -> Decimal:
        """Posted + Needs an offer + Pending approval: the three figures Remaining takes away (§5.3 note 12)."""
        return self.posted + self.needs_offer + self.pending_approval


@dataclass(frozen=True)
class PoolCell(RoundCell):
    """A pool's money, or the season's: its rounds summed, and its allocation from the approved rules."""

    allocated: Decimal | None = None

    @property
    def remaining(self) -> Decimal | None:
        """Allocated − Posted − Needs an offer − Pending approval (§5.3 note 6); None with no allocation."""
        if self.allocated is None:
            return None
        return self.allocated - self.committed


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
    # Decision 13: the requests the outside grants offset ("offsetting awards (41 campers)").
    outside_grants_requests: Count = Count()


@dataclass(frozen=True)
class ForwardDemand:
    round2_asks: Count
    round2_asked: Decimal
    round2_computed: Decimal
    round1_unmet: Decimal
    round1_unmet_requests: Count = Count()  # Decision 7: requests whose part is above $0
    round2_held: Count = Count()  # inside round2_asks
    round2_held_asked: Decimal = ZERO
    round1_held: Count = Count()  # inside round1_unmet_requests
    round1_held_asked: Decimal = ZERO


@dataclass(frozen=True)
class PoolBudget:
    pool: str
    label: str
    rounds: Mapping[int, RoundCell]
    total: PoolCell
    below: BelowTheLine
    demand: ForwardDemand
    decision_types: tuple[DecisionTypeLine, ...] = ()
    # The pool's share from the approved rules (§5.3 note 11); None for No pool, the total, no rules, and a pool given as an amount.
    share_pct: Decimal | None = None


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


NO_DECISION_TYPE_LABEL: Final = "No named decision type"


@dataclass(frozen=True)
class DecisionTypeLine:
    """Main spec §12.1, app spec §7.2: one line per named decision type, in or out of the budget, and one for the
    rounds that carry none. `amount` is the whole rounds' money as the budget counts it (Posted, Needs an offer,
    Pending approval, or below the line), so the lines add up to the budget's own figures (⚠ Decision 2); `own` is
    the type's own money inside it (its top-up or discretionary amount)."""

    key: str | None
    label: str
    counts_toward_budget: bool
    amount: Decimal
    posted: Decimal
    own: Decimal
    requests: Count


@dataclass
class _TypeTally:
    amount: Decimal = ZERO
    posted: Decimal = ZERO
    own: Decimal = ZERO
    families: set[int] = field(default_factory=set)
    requests: set[str] = field(default_factory=set)


_TypeTallies = dict[tuple[str, str | None, bool], _TypeTally]


def counted_part(view: RoundView, amount: Decimal) -> tuple[Decimal, Decimal]:
    """(the camp's money, the money below the line) in a round's amount. A type that doesn't count takes its whole
    round below the line (owner ruling 2026-09-30), except a full-cost-after-aid round, whose camp award counts as usual
    and whose own remainder (`extra`) alone sits below the line (owner 10-06). That remainder is already net of the
    request's outside grants (the engine subtracts them, owner 10-06 (a)); the grants have their own line
    (`outside_grants`), so nothing here subtracts them again."""
    if view.counts_toward_budget:
        return amount, ZERO
    if view.extra_outside:
        outside = min(view.extra, amount)
        return amount - outside, outside
    return ZERO, amount


def _round_money(view: RoundView) -> tuple[Decimal, Decimal] | None:
    """The round's money as _tally_round counts it, and its posted part; None for money it counts nowhere."""
    if view.status == "posted":
        return None if view.clawed_back else (view.locked or ZERO, view.locked or ZERO)
    if view.status == "needs_offer":
        return view.decided or ZERO, ZERO
    if view.status == "pending_approval":
        return view.pending or ZERO, ZERO
    return None


def _tally_type(types: _TypeTallies, pool: str, request: PricedRequest, view: RoundView) -> None:
    money = _round_money(view)
    if money is None:
        return
    if view.extra_outside and not view.counts_toward_budget:
        inside, outside = counted_part(view, money[0])
        posted_in, posted_out = counted_part(view, money[1])
        for key, counts, amount, posted, own in (
            (None, True, inside, posted_in, ZERO),
            (view.decision_type, False, outside, posted_out, view.extra),
        ):
            if amount > 0:
                part = types[(pool, key, counts)]
                part.amount += amount
                part.posted += posted
                part.own += own
                part.families.add(request.household_cm_id)
                part.requests.add(request.request_id)
        return
    key = view.decision_type
    tally = types[(pool, key, view.counts_toward_budget)]
    tally.amount += money[0]
    tally.posted += money[1]
    tally.own += view.extra if key is not None else ZERO
    tally.families.add(request.household_cm_id)
    tally.requests.add(request.request_id)


def _type_lines(types: _TypeTallies, pool: str, rules: AidRules | None) -> tuple[DecisionTypeLine, ...]:
    named = rules.awards.decision_types if rules is not None else {}
    order = list(named)

    def rank(item: tuple[str | None, bool]) -> tuple[bool, int, str, bool]:
        key, counts = item
        return (key is None, order.index(key) if key in named else len(order), key or "", not counts)

    out: list[DecisionTypeLine] = []
    for key, counts in sorted(((k, c) for p, k, c in types if p == pool), key=rank):
        tally = types[(pool, key, counts)]
        label = NO_DECISION_TYPE_LABEL if key is None else (named[key].label if key in named else key)
        out.append(
            DecisionTypeLine(
                key,
                label,
                counts,
                tally.amount,
                tally.posted,
                tally.own,
                Count(len(tally.families), len(tally.requests)),
            )
        )
    return tuple(out)


def _merged(tallies: Iterable[_Tally]) -> _Tally:
    out = _Tally()
    for tally in tallies:
        out.amount += tally.amount
        out.families |= tally.families
        out.requests |= tally.requests
    return out


def allocations(rules: AidRules) -> dict[str, Decimal]:
    """pool -> Allocated (§5.3 note 1): the approved total × the pool's share, to the cent, half up. Rounds have no
    allocation of their own and nothing is held back for a later round (owner 10-06): Round 3 is whatever is left."""
    budget = rules.budget
    out: dict[str, Decimal] = {}
    for key, pool in budget.pools.items():
        out[key] = _cents(budget.total * pool.share_pct / HUNDRED)
    return out


def _home_pool(request: PricedRequest) -> str:
    return request.pool or next((view.pool for view in request.rounds if view.pool), None) or NO_POOL


def _tally_round(
    tallies: _Tallies,
    pool: str,
    request: PricedRequest,
    view: RoundView,
    ledger: Mapping[int, RoundLedger] | None = None,
    *,
    listed: bool = True,
) -> None:
    """`listed`: a round needing an offer is on the Requests grid's Needs an offer list (D162 C2, owner 10-03). One
    that isn't (CampMinder already holds money for it) keeps its money in Needs an offer, and Remaining with it, but
    leaves the count, so the count is the list it opens."""

    def add(measure: str, amount: Decimal) -> None:
        tallies[(pool, view.round, measure)].add(request, amount)

    if view.status == "posted":
        if view.clawed_back:
            return  # D54: its money came back to Remaining when CampMinder's reversal posted
        inside, outside = counted_part(view, view.locked or ZERO)
        if view.counts_toward_budget or inside > 0:  # a wholly-outside round is no posted money, nor a posted request
            add("posted", inside)
            if view.accepted:
                add("accepted", inside)
            part = ledger.get(view.round) if ledger is not None else None
            if part is not None and part.unconfirmed > 0:  # ⚠10: in the round's locked pool, as Posted
                add("unconfirmed", part.unconfirmed)
                add("awaiting_sync" if part.awaiting else "not_reconciled", ZERO)  # Decision 3
        if outside:
            add("outside_budget", outside)
            add("outside_budget_posted", outside)
    elif view.status == "needs_offer":
        inside, outside = counted_part(view, view.decided or ZERO)
        if view.counts_toward_budget or inside > 0:
            add("needs_offer", inside)
            if listed:
                add(_LISTED, ZERO)
        if outside:
            add("outside_budget", outside)
    elif view.status == "pending_approval":
        inside, outside = counted_part(view, view.pending or ZERO)
        if view.counts_toward_budget or inside > 0:
            add("pending_approval", inside)  # D79 binds counting money
        if outside:
            add("outside_budget", outside)
    elif view.status == "held":
        add("held", view.ask or ZERO)


@dataclass
class _Demand:
    """One pool's forward demand as the season is read (D82, §5.9). `seen`: demand reached the pool, so it is listed
    even when every figure is $0 (as the per-figure dicts it replaces did)."""

    asks2: _Tally = field(default_factory=_Tally)
    held2: _Tally = field(default_factory=_Tally)
    computed2: Decimal = ZERO
    unmet1: _Tally = field(default_factory=_Tally)
    held1: _Tally = field(default_factory=_Tally)
    seen: bool = False


def _tally_demand(request: PricedRequest, demand: _Demand) -> None:
    """D82. Round 2 asks so far, held appeals' asks included (computed leaves held ones out); else
    Round 1 unmet ask, not yet appealed (§5.9): ask − Round 1 on a decided or posted Round 1, or the
    whole ask while Round 1 is held. It knows only the appeals keyed so far (a known gap, D82)."""
    r1, r2 = request.view(1), request.view(2)
    if r2 is not None and r2.ask is not None:
        if r2.clawed_back:
            return  # D54: a clawed-back round counts nowhere (and implies Round 1 was clawed back too)
        demand.seen = True
        demand.asks2.add(request, r2.ask)
        if r2.status == "held":
            demand.held2.add(request, r2.ask)
        if not r2.counts_toward_budget:
            # Deliberate for the full-cost fund too: it allows no appeal and pays the rest of the cost, so it leaves no unmet ask.
            return  # a non-counting round is not the camp's money: no forward demand
        if r2.status == "posted":
            demand.computed2 += r2.locked or ZERO
        elif r2.status == "needs_offer":
            demand.computed2 += r2.decided or ZERO
        return
    if r1 is None or r1.ask is None or r1.clawed_back:
        return  # D54: a declined offer is not unmet ask
    if r1.status == "held":
        demand.seen = True
        if r1.ask > 0:
            demand.unmet1.add(request, r1.ask)
            demand.held1.add(request, r1.ask)
    elif not r1.counts_toward_budget:
        # Deliberate for the full-cost fund too: it allows no appeal and pays the rest of the cost, so it leaves no unmet ask.
        return  # a non-counting round is not the camp's money: no unmet demand against it
    elif r1.status in ("needs_offer", "posted"):
        amount = r1.locked if r1.status == "posted" else r1.decided
        if amount is not None:
            demand.seen = True
            gap = max(ZERO, r1.ask - amount)  # one family's overage never offsets another's unmet
            if gap > 0:
                demand.unmet1.add(request, gap)


def _tally_of(tallies: _Tallies, pool: str, n: int, measure: str) -> _Tally:
    return tallies.get((pool, n, measure)) or _Tally()


def _pool_budget(
    pool: str,
    label: str,
    allocated: Decimal | None,
    share_pct: Decimal | None,
    tallies: _Tallies,
    *,
    grants: Decimal,
    demand: _Demand,
    confirmed: bool,
    decision_types: tuple[DecisionTypeLine, ...],
    grant_requests: _Tally,
) -> PoolBudget:
    def amount(n: int, measure: str) -> Decimal:
        return _tally_of(tallies, pool, n, measure).amount

    def count(n: int, measure: str) -> Count:
        return _tally_of(tallies, pool, n, measure).count()

    rounds = {
        n: RoundCell(
            posted=amount(n, "posted"),
            accepted=amount(n, "accepted"),
            needs_offer=amount(n, "needs_offer"),
            pending_approval=amount(n, "pending_approval"),
            needs_offer_count=count(n, _LISTED),
            pending_approval_count=count(n, "pending_approval"),
            unconfirmed=amount(n, "unconfirmed") if confirmed else None,
            unconfirmed_count=_tally_of(tallies, pool, n, "unconfirmed").count() if confirmed else None,
        )
        for n in ROUNDS
    }
    cells = list(rounds.values())
    total = PoolCell(
        allocated=allocated,
        posted=sum((c.posted for c in cells), ZERO),
        accepted=sum((c.accepted for c in cells), ZERO),
        needs_offer=sum((c.needs_offer for c in cells), ZERO),
        pending_approval=sum((c.pending_approval for c in cells), ZERO),
        needs_offer_count=_merged(_tally_of(tallies, pool, n, _LISTED) for n in ROUNDS).count(),
        pending_approval_count=_merged(_tally_of(tallies, pool, n, "pending_approval") for n in ROUNDS).count(),
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
            outside_grants_requests=grant_requests.count(),
        ),
        demand=ForwardDemand(
            round2_asks=demand.asks2.count(),
            round2_asked=demand.asks2.amount,
            round2_computed=demand.computed2,
            round1_unmet=demand.unmet1.amount,
            round1_unmet_requests=demand.unmet1.count(),
            round2_held=demand.held2.count(),
            round2_held_asked=demand.held2.amount,
            round1_held=demand.held1.count(),
            round1_held_asked=demand.held1.amount,
        ),
        decision_types=decision_types,
        share_pct=share_pct,
    )


def season_budget(
    priced: Iterable[PricedRequest],
    rules: AidRules | None,
    *,
    outside_grants: Mapping[str, Decimal],
    outside_grants_off_requests: Decimal = ZERO,
    not_demand: Collection[str] = frozenset(),
    ledger: Mapping[str, Mapping[int, RoundLedger]] | None = None,
    off_list: Collection[tuple[str, int]] = frozenset(),
) -> SeasonBudget:
    """`outside_grants` is each request's counted outside grants (the grants register's shares,
    summed, a pays-after-camp-aid grant included, D143); `outside_grants_off_requests` the counted
    outside grants on no request (Decision 14). `not_demand` are requests forward demand leaves out although
    they are live (owner ruling 2026-10-02: CampMinder cancelled them; `live` itself is not changed). `ledger` is each
    request's posted rounds against CampMinder's live net (`round_ledger`); None: no ledger read. `off_list` are the
    (request, round)s needing an offer that the Requests grid's Needs an offer list leaves out (D162 C2: CampMinder
    already holds money for them): their money stays in Needs an offer, and they leave its counts."""
    allocated = allocations(rules) if rules is not None else {}
    shares = {key: pool.share_pct for key, pool in rules.budget.pools.items()} if rules is not None else {}
    labels = {key: pool.label for key, pool in rules.budget.pools.items()} if rules is not None else {}
    tallies: _Tallies = defaultdict(_Tally)
    grants: dict[str, Decimal] = defaultdict(Decimal)
    demand: dict[str, _Demand] = defaultdict(_Demand)
    grant_requests: dict[str, _Tally] = defaultdict(_Tally)
    types: _TypeTallies = defaultdict(_TypeTally)
    unrebuilt: set[str] = set()
    for request in priced:
        home = _home_pool(request)
        mine = ledger.get(request.request_id, {}) if ledger is not None else None
        for view in request.rounds:
            for pool in (view.pool or NO_POOL, TOTAL):
                _tally_round(
                    tallies, pool, request, view, mine, listed=(request.request_id, view.round) not in off_list
                )
                _tally_type(types, pool, request, view)
            if view.status == "not_rebuilt":  # a past read's: its status is unknown, but it sits in its pool (3c)
                unrebuilt.add(view.pool or NO_POOL)
        for pool in (home, TOTAL):
            share = outside_grants.get(request.request_id, ZERO)
            grants[pool] += share
            if share > 0:
                grant_requests[pool].add(request, ZERO)
            if request.live and request.request_id not in not_demand:
                _tally_demand(request, demand[pool])
    seen = (
        {pool for pool, _, _ in tallies}
        | {p for p, v in grants.items() if v}
        | {p for p, d in demand.items() if d.seen}
        | unrebuilt
    )
    seen.discard(TOTAL)
    order = [*allocated, *sorted(seen - set(allocated) - {NO_POOL}), *([NO_POOL] if NO_POOL in seen else [])]

    def budget_for(pool: str, label: str, allocation: Decimal | None, share: Decimal | None) -> PoolBudget:
        return _pool_budget(
            pool,
            label,
            allocation,
            share,
            tallies,
            grants=grants[pool],
            demand=demand.get(pool) or _Demand(),
            confirmed=ledger is not None,
            decision_types=_type_lines(types, pool, rules),
            grant_requests=grant_requests.get(pool) or _Tally(),
        )

    pools = tuple(
        budget_for(
            pool,
            labels.get(pool) or (NO_POOL_LABEL if pool == NO_POOL else pool),
            allocated.get(pool),
            shares.get(pool),
        )
        for pool in order
    )
    total_allocated = sum(allocated.values(), ZERO) if rules is not None else None
    strip = {
        n: RoundCounts(
            **{
                measure: _tally_of(tallies, TOTAL, n, _LISTED if measure == "needs_offer" else measure).count()
                for measure in _STRIP
            },
            awaiting_sync=_tally_of(tallies, TOTAL, n, "awaiting_sync").count() if ledger is not None else None,
            not_reconciled=_tally_of(tallies, TOTAL, n, "not_reconciled").count() if ledger is not None else None,
        )
        for n in ROUNDS
    }
    return SeasonBudget(
        pools=pools,
        total=budget_for(TOTAL, "Total", total_allocated, None),
        strip=strip,
        outside_grants_off_requests=outside_grants_off_requests,
    )

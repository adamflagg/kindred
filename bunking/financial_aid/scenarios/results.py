"""A scenario's results (sub-project 9b; spec §7.4, §5.3; the mock's strip, Compare and Trail). Pure: from the
priced season and its budget, exactly as sub-project 10a's Rounds & budget computes them.

  Round n            Posted + Needs an offer + Pending approval for round n (round n's Committed): the money
                     §5.3's Remaining subtracts from the pool's Allocated. Round 2 is only the Round 2 asks keyed so
                     far; there is no appeal estimate (Decision 10).
  Round 1 remaining  the pool's Allocated less every Round 1 dollar (§8.2: no reserves); what Fit to budget fits
                     (Decision 11 (a)); Remaining is every round's.
  At the minimum     live requests whose Round 1, not yet posted, is the minimum award (the calculator's r1_bound).
  By tier            each final tier's live requests, families, Round 1 and those requests' Round 1 asks, counted
                     exactly as the budget counts Round 1 (a posted Round 1 at its lock; a clawed-back round, or one
                     whose decision type is outside the budget, in no tier). SP9c fills `asked` (RPT-17) and `held`:
                     the tier's live requests whose Round 1 is held (a check's hold has a tier), counted apart so a
                     tier's apps are never silently short. A counted request with no Round 1 ask is counted apart
                     (`no_ask`, with its Round 1): the ask-based figures leave it out, like for like.
  By table           the same requests split by the award table their program uses under the priced document
                     ("" for a program with no Round 1 table): RPT-17's per-table rows (SP9c). They sum to By tier.
  Round 2 by tier    per Round 2 table and final tier: the live requests with a Round 2 ask that is not clawed back
                     (held ones included: the budget's Round 2 asks so far, _tally_demand), their asks, and the Round
                     2 money the budget counts on them (RPT-32, SP9c). Round 2 money no appeal row holds (a withdrawn
                     request's posted Round 2, a request with no tier, a Round 2 with no ask) is `round2_not_in_tiers`:
                     rows plus it are Round 2.
  Not in tiers       Round 1 money the budget counts on a request with no tier: a withdrawn request's posted round
                     (only live requests are priced into a tier) or a live one priced without a final tier. The tier
                     rows plus this are Round 1 (final review 2).
  Held               requests with a held round and their asks: below the line, never counted.
  Round 1 unmet      §5.9's "Round 1 unmet ask, not yet appealed" (SP10a's demand.round1_unmet): below the line,
                     never subtracted -- the forward signal for sizing Round 2 (plan Decision 10 (b), RULED
                     2026-09-30).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from bunking.financial_aid.decisions import PoolBudget, PricedRequest, RoundCell, RoundView, SeasonBudget
from bunking.financial_aid.decisions.budget import counted_part
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules import lookup as rules_lookup
from bunking.financial_aid.scenarios.request_set import RequestSetNote


class _Result(BaseModel):
    # Stored as JSON on kept options and trail rows: a key this build doesn't know (written by a newer one) is
    # ignored, so a rollback still reads every row (SP9c final review).
    model_config = ConfigDict(frozen=True, extra="ignore")


class TierRow(_Result):
    tier: int
    requests: int
    families: int
    round1: Decimal
    # The tier's Round 1 asks (RPT-17's by-tier compare, SP9c). None only on results stored by SP9b: defaulted so
    # its kept options still load.
    asked: Decimal | None = None
    held: int = 0  # SP9c: the tier's live requests whose Round 1 is held, in none of the figures above
    # Their Round 1 asks, counted apart: a held family's grant can't be counted yet, so its ask is not in `asked`
    # (which stays like for like with Round 1). Defaulted so stored results still load.
    held_asked: Decimal = ZERO
    # SP9c: counted requests with no Round 1 ask, and their Round 1. In `requests` and `round1`, but not in `asked`,
    # so the ask-based figures (average ask, % of ask) leave them out and stay like for like.
    no_ask: int = 0
    no_ask_round1: Decimal = ZERO


class TableTierRow(_Result):
    """Round 1 by award table and final tier (RPT-17): the requests a tier row counts, split by the award table
    their program uses under the priced document ("" for a program with no Round 1 table)."""

    table: str
    tier: int
    requests: int
    families: int
    round1: Decimal
    asked: Decimal
    held: int = 0
    held_asked: Decimal = ZERO  # as TierRow's
    no_ask: int = 0  # as TierRow's
    no_ask_round1: Decimal = ZERO


class Round2TierRow(_Result):
    """Round 2 by Round 2 table and final tier (RPT-32). `appeals` are live requests with a Round 2 ask, held ones
    included; `priced` are those whose Round 2 the budget counts (Posted, Needs an offer, Pending approval), and
    `round2` and `priced_asked` are theirs, so "% of Round 2 ask" divides like for like.

    An appeal on a request with no final tier (one that could not be priced: the results' total `held` counts it) is
    in no row, by design: a tier row needs a tier. Its Round 2 money, if any, is `round2_not_in_tiers`."""

    table: str  # the program's Round 2 table under the priced document; "" when it has none
    tier: int
    appeals: int
    asked: Decimal
    priced: int
    priced_asked: Decimal
    round2: Decimal
    # The asks of the held appeals (a held Round 2 round): in `asked`, never in `priced_asked`, so "% of Round 2
    # ask" is unchanged. Defaulted so stored results still load.
    held_asked: Decimal = ZERO


class PoolResult(_Result):
    pool: str
    label: str
    round1: Decimal
    round2: Decimal
    round3: Decimal
    # The pool's whole Allocated (§8.2: no reserves). Rows stored before the reserves were dropped keep the older
    # figure, Round 1's allocation after Round 2's and Round 3's reserves, until the option is priced again.
    round1_allocated: Decimal | None
    round1_remaining: Decimal | None
    remaining: Decimal | None
    round1_unmet: Decimal  # below the line


class ScenarioResults(_Result):
    requests: int
    families: int
    round1: Decimal
    round2: Decimal
    round3: Decimal
    # The pools' whole Allocated summed (§8.2); stored rows keep the older figure, reserves taken off, as PoolResult's.
    round1_allocated: Decimal | None
    round1_remaining: Decimal | None
    remaining: Decimal | None
    at_minimum: int
    held: int
    held_asked: Decimal
    round1_unmet: Decimal  # below the line: §5.9, the forward signal for Round 2 (Decision 10 (b), RULED 2026-09-30)
    pools: list[PoolResult]
    by_tier: list[TierRow]
    # Round 1 the budget counts on requests in no tier (a withdrawn request's posted round): by_tier + this = round1.
    # Defaulted so kept options stored before it still load.
    not_in_tiers: Decimal = ZERO
    # The request set these figures were priced on (D138); None: every frozen request. Kept options and trail rows
    # always store None: a request set is a view setting, applied when a figure is read.
    request_set: RequestSetNote | None = None
    # SP9c (RPT-17, RPT-32). Every one is defaulted so results stored by SP9b still load; `committee_rows` says the
    # rows below were computed (SP9b's stored results carry none, so compare prices those options again).
    by_table: list[TableTierRow] = Field(default_factory=list)
    round2_by_tier: list[Round2TierRow] = Field(default_factory=list)
    round2_not_in_tiers: Decimal = ZERO  # Round 2 the budget counts on requests in no tier: rows + this = round2
    # No Round 2 allocation exists (owner 10-06); None on new results, kept as recorded on stored ones.
    round2_allocated: Decimal | None = None
    round2_remaining: Decimal | None = None
    committee_rows: bool = False


@dataclass
class TierTally:
    requests: set[str] = field(default_factory=set)
    families: set[int] = field(default_factory=set)
    round1: Decimal = ZERO
    asked: Decimal = ZERO
    held: set[str] = field(default_factory=set)
    held_asked: Decimal = ZERO
    no_ask: set[str] = field(default_factory=set)
    no_ask_round1: Decimal = ZERO

    def add(self, priced: PricedRequest, amount: Decimal, ask: Decimal | None) -> None:
        """A counted Round 1. One with no ask is counted apart (`no_ask`), so the ask-based figures stay like for
        like; it still counts in the requests and Round 1."""
        self.requests.add(priced.request_id)
        self.families.add(priced.household_cm_id)
        self.round1 += amount
        if ask is None:
            self.no_ask.add(priced.request_id)
            self.no_ask_round1 += amount
        else:
            self.asked += ask

    def hold(self, priced: PricedRequest, ask: Decimal | None) -> None:
        """A held Round 1: counted apart, with its ask (None: it had none) beside the count."""
        self.held.add(priced.request_id)
        self.held_asked += ask or ZERO


@dataclass
class AppealTally:
    appeals: set[str] = field(default_factory=set)
    asked: Decimal = ZERO
    priced: set[str] = field(default_factory=set)
    priced_asked: Decimal = ZERO
    round2: Decimal = ZERO
    held_asked: Decimal = ZERO

    def add(self, priced: PricedRequest, ask: Decimal, amount: Decimal | None, *, held: bool = False) -> None:
        self.appeals.add(priced.request_id)
        self.asked += ask
        if held:
            self.held_asked += ask
        if amount is not None:
            self.priced.add(priced.request_id)
            self.priced_asked += ask
            self.round2 += amount


def appeal_ask(view: RoundView | None) -> Decimal | None:
    """A Round 2 view's ask when the budget counts it as an appeal (budget._tally_demand, "Round 2 asks so far"):
    keyed and not clawed back (D54), held or not; else None."""
    return view.ask if view is not None and not view.clawed_back else None


def round1_table(document: AidRules, program_key: str | None) -> str:
    """The award table a program prices from under `document` (the resolver, §9.9); "" for none."""
    program = document.programs.get(program_key) if program_key is not None else None
    return (rules_lookup.round1_table(document, program) or "") if program is not None else ""


def round2_table(document: AidRules, program_key: str | None) -> str:
    """The Round 2 table a program's appeals use under `document`; "" when it has none or isn't listed."""
    if program_key is None:
        return ""
    try:
        return rules_lookup.round2_table(document, program_key) or ""
    except rules_lookup.Round2TableNotListedError:
        return ""


def tier_rows(tiers: Mapping[int, TierTally]) -> list[TierRow]:
    return [
        TierRow(
            tier=n,
            requests=len(t.requests),
            families=len(t.families),
            round1=t.round1,
            asked=t.asked,
            held=len(t.held),
            held_asked=t.held_asked,
            no_ask=len(t.no_ask),
            no_ask_round1=t.no_ask_round1,
        )
        for n, t in sorted(tiers.items())
    ]


def table_rows(tables: Mapping[tuple[str, int], TierTally]) -> list[TableTierRow]:
    return [
        TableTierRow(
            table=table,
            tier=n,
            requests=len(t.requests),
            families=len(t.families),
            round1=t.round1,
            asked=t.asked,
            held=len(t.held),
            held_asked=t.held_asked,
            no_ask=len(t.no_ask),
            no_ask_round1=t.no_ask_round1,
        )
        for (table, n), t in sorted(tables.items())
    ]


def round2_rows(appeals: Mapping[tuple[str, int], AppealTally]) -> list[Round2TierRow]:
    return [
        Round2TierRow(
            table=table,
            tier=n,
            appeals=len(a.appeals),
            asked=a.asked,
            priced=len(a.priced),
            priced_asked=a.priced_asked,
            round2=a.round2,
            held_asked=a.held_asked,
        )
        for (table, n), a in sorted(appeals.items())
    ]


def _spent(cell: RoundCell) -> Decimal:
    return cell.committed


def _round1_left(allocated: Decimal | None, round1: RoundCell) -> Decimal | None:
    """§8.2: the pool's Allocated less every Round 1 dollar (no reserves: Round 1 may use the whole share)."""
    return None if allocated is None else allocated - round1.committed


def round1_amount(priced: PricedRequest) -> Decimal | None:
    """A request's Round 1: its locked amount once posted, its decided amount while it needs an offer, else None."""
    view = priced.view(1)
    if view is None:
        return None
    if view.status == "posted":
        return view.locked
    if view.status == "needs_offer":
        return view.decided
    return None


def round1_by_request(priced: Iterable[PricedRequest]) -> dict[str, Decimal]:
    return {p.request_id: amount for p in priced if p.live and (amount := round1_amount(p)) is not None}


def up_down(reference: Mapping[str, Decimal], other: Mapping[str, Decimal]) -> tuple[int, int]:
    """Requests whose Round 1 is higher / lower in `other` than in `reference`. A request priced on one side only
    (held on the other) counts in neither."""
    shared = reference.keys() & other.keys()
    return sum(1 for r in shared if other[r] > reference[r]), sum(1 for r in shared if other[r] < reference[r])


def _pool(pool: PoolBudget) -> PoolResult:
    return PoolResult(
        pool=pool.pool,
        label=pool.label,
        round1=_spent(pool.rounds[1]),
        round2=_spent(pool.rounds[2]),
        round3=_spent(pool.rounds[3]),
        round1_allocated=pool.total.allocated,
        round1_remaining=_round1_left(pool.total.allocated, pool.rounds[1]),
        remaining=pool.total.remaining,
        round1_unmet=pool.demand.round1_unmet,
    )


def counted(view: RoundView) -> Decimal | None:
    """A round's money exactly as the budget counts it (budget._tally_round): its camp part (`counted_part`)."""
    if view.status == "posted":
        amount = None if view.clawed_back else (view.locked or ZERO)
    elif view.status == "needs_offer":
        amount = view.decided or ZERO
    elif view.status == "pending_approval":
        amount = view.pending or ZERO
    else:
        amount = None
    if amount is None:
        return None
    inside, _ = counted_part(view, amount)
    return inside if (view.counts_toward_budget or inside > 0) else None


def scenario_results(
    priced: Iterable[PricedRequest],
    budget: SeasonBudget,
    *,
    document: AidRules,
    request_set: RequestSetNote | None = None,
) -> ScenarioResults:
    """`document` is the rules the season was priced with: it says which award table and Round 2 table each
    request's program uses (the per-table rows, SP9c)."""
    every = list(priced)
    live = [p for p in every if p.live]
    tiers: dict[int, TierTally] = defaultdict(TierTally)
    tables: dict[tuple[str, int], TierTally] = defaultdict(TierTally)
    appeals: dict[tuple[str, int], AppealTally] = defaultdict(AppealTally)
    not_in_tiers = ZERO
    round2_not_in_tiers = ZERO
    at_minimum = 0
    for p in live:
        view = p.view(1)
        if (
            view is not None
            and view.status == "needs_offer"
            and p.result is not None
            and p.result.r1_bound == "minimum"
        ):
            at_minimum += 1
    for p in every:
        tier = p.result.final_tier if p.live and p.result is not None else None
        view = p.view(1)
        amount = counted(view) if view is not None else None
        if view is not None and amount is not None:
            if tier is None:
                not_in_tiers += amount
            else:
                tiers[tier].add(p, amount, view.ask)
                tables[(round1_table(document, p.program_key), tier)].add(p, amount, view.ask)
        elif view is not None and view.status == "held" and tier is not None:
            tiers[tier].hold(p, view.ask)
            tables[(round1_table(document, p.program_key), tier)].hold(p, view.ask)
        appeal = p.view(2)
        money2 = counted(appeal) if appeal is not None else None
        asked2 = appeal_ask(appeal)
        if tier is not None and asked2 is not None:
            appeals[(round2_table(document, p.program_key), tier)].add(
                p, asked2, money2, held=appeal is not None and appeal.status == "held"
            )
        elif money2 is not None:
            round2_not_in_tiers += money2
    total = budget.total
    return ScenarioResults(
        requests=len(live),
        families=len({p.household_cm_id for p in live}),
        round1=_spent(total.rounds[1]),
        round2=_spent(total.rounds[2]),
        round3=_spent(total.rounds[3]),
        round1_allocated=total.total.allocated,
        round1_remaining=_round1_left(total.total.allocated, total.rounds[1]),
        remaining=total.total.remaining,
        at_minimum=at_minimum,
        held=total.below.held.requests,
        held_asked=total.below.held_asked,
        round1_unmet=total.demand.round1_unmet,
        pools=[_pool(pool) for pool in budget.pools],
        by_tier=tier_rows(tiers),
        not_in_tiers=not_in_tiers,
        request_set=request_set,
        by_table=table_rows(tables),
        round2_by_tier=round2_rows(appeals),
        round2_not_in_tiers=round2_not_in_tiers,
        round2_allocated=None,
        round2_remaining=None,
        committee_rows=True,
    )


def round2_by_tier_totals(results: ScenarioResults) -> dict[int, Decimal]:
    """Round 2 per final tier, summed across the Round 2 tables (Scenarios addendum §S11.4: the By tier popover once
    Round 1 posts). Results stored before the rows existed read as {}."""
    totals: dict[int, Decimal] = {}
    for row in results.round2_by_tier:
        totals[row.tier] = totals.get(row.tier, ZERO) + row.round2
    return totals


def appeal_totals(results: ScenarioResults) -> tuple[int, Decimal]:
    """The appeals keyed so far and their asks (§S11.4: Below the line after the lock): the Round 2 rows summed.
    A request sits in one Round 2 table, so the sum counts each appeal once. It counts the appeals in a tier: an
    appeal on a request with no final tier sits in no tier row, so only its money shows (in `round2_not_in_tiers`)
    and it is left out of this count."""
    return sum(row.appeals for row in results.round2_by_tier), sum((row.asked for row in results.round2_by_tier), ZERO)

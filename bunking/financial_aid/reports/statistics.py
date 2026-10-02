"""Reports › Statistics (finance's Statistics tab; clean spec §9.2, §9.7 RPT-5, RPT-9, RPT-10, RPT-22, RPT-23; D72,
D80, D106, D129–D131). Pure: no I/O.

One row per income tier of the season's rules, then a "no tier" row when any request has none, then the totals.
The chips are an award table (None: All award tables, RPT-10) and a round (None: All rounds).

  population      Round 1 and All rounds: every received request in the table (D72; cancelled included, D131).
                  Round 2 and Round 3: those with that round's ask (or its lock).
  tier            the round's tier (at its lock, else the request's now; All rounds: Round 1's).
  apps            the population; `cancelled` counts the cancelled ones among them, the line beside apps (D131).
  asked           the population's asks on the chip's round(s), as keyed (D80); `asks` counts the requests with
                  one, and the average ask divides by it.
  amount          awarded (D80, Posted net of clawback, the camp's own money) on live requests; on the
                  "posted_and_decided" basis (D130) plus decided and not yet offered, broken out as `decided`.
  awarded_count   live requests whose AWARDED (Posted) money is above $0, on either basis; the average award is
                  awarded ÷ this count (D80, labelled with its population: O-930-16), never decided money (D130:
                  decided is never called awarded). `decided_count` counts the requests with decided money apart.
  % of ask        amount ÷ the asks of the LIVE requests (a cancelled request's ask leaves with its award), as they
                  stand today; a round outside the budget (D121's full-cost outside funder) is never awarded, so its
                  ask leaves the denominator too (owner (c), RULED 2026-10-02; `asked` keeps it). On the
                  "posted_and_decided" basis amount is Posted + Decided and the column reads
                  PCT_OF_ASK_DECIDED_LABEL (owner (b), RULED 2026-10-02).
  % with grants   (amount + the counting outside grants on the live requests) ÷ the same asks: the sheet's
                  "% of Ask Granted in Total". Round 1 and All rounds only: a grant belongs to the request, not a
                  round.
  fee %           Round 1 and All rounds: the chip table's Round 1 % for the tier. Round 2: the Round 2 table the
                  chip table's programs use, when they use one (its total %, a rules value). Round 3 and the All
                  chip: None (the screen reads "varies").

Every % is to one decimal place and every average to the cent; a 0 denominator gives None, never 0 (§9.7).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.facts import REPORT_ROUNDS, ReportRequest, average, in_round, in_table
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.scenarios.committee import fee_pct, pct, round2_max_pct

Basis = Literal["posted", "posted_and_decided"]
RoundChip = Literal[1, 2, 3] | None
NO_REASON: Final = "not_recorded"  # a cancellation with no reason: before 2027, or not given yet (D101)


PCT_OF_ASK_LABEL: Final = "% of ask"
PCT_OF_ASK_DECIDED_LABEL: Final = "% of ask (posted + decided)"


@dataclass(frozen=True)
class StatisticsRow:
    tier: int | None  # None: the "no tier" row, or the totals
    income_from: Decimal | None
    income_to: Decimal | None
    fee_pct: Decimal | None
    apps: int
    cancelled: int
    asked: Decimal
    asks: int
    average_ask: Decimal | None
    amount: Decimal
    decided: Decimal
    awarded_count: int
    decided_count: int
    average_award: Decimal | None
    live_asked: Decimal
    pct_of_ask: Decimal | None
    grants: Decimal | None
    pct_of_ask_with_grants: Decimal | None


@dataclass(frozen=True)
class CancelledRow:
    """Aid recipients who cancelled (D131, RPT-22): requests with a posted award on `round` later cancelled, by
    reason, pool and round. `posted` is what the lock posted, clawed back since or not: they were recipients."""

    reason: str
    pool: str | None
    round: int
    requests: int
    posted: Decimal


@dataclass(frozen=True)
class TierAppealsRow:
    """RPT-9, per tier: Round 1 apps and fee %, appeals (the Round 2 count), the Round 2 max % (a rules value, not
    an outcome), Round 3 awarded, and the appeal rate (Kindred-derived: appeals ÷ Round 1 apps)."""

    tier: int | None
    income_from: Decimal | None
    income_to: Decimal | None
    round1_apps: int
    round1_fee_pct: Decimal | None
    appeals: int
    round2_max_pct: Decimal | None
    round3_awarded: Decimal
    appeal_rate: Decimal | None


@dataclass(frozen=True)
class OutcomeRow:
    """RPT-23, the March committee's outcomes for one pool (None: all pools): accepted, appealed and waiting for
    a response (posted Round 1, not accepted, no Round 2 ask), on live requests."""

    pool: str | None
    accepted: int
    accepted_amount: Decimal
    appealed: int
    appealed_asked: Decimal
    waiting: int


@dataclass(frozen=True)
class StatisticsTable:
    rows: tuple[StatisticsRow, ...]
    total: StatisticsRow
    recipients_cancelled: tuple[CancelledRow, ...]


def _rounds(round_: RoundChip) -> tuple[int, ...]:
    return REPORT_ROUNDS if round_ is None else (round_,)


def _tier(request: ReportRequest, round_: RoundChip) -> int | None:
    facts = request.round(round_ or 1)
    if facts is not None and facts.tier is not None:
        return facts.tier
    return None if round_ in (None, 1) else _tier(request, 1)


def _bands(document: AidRules | None) -> dict[int, tuple[Decimal, Decimal | None]]:
    if document is None:
        return {}
    return {n: (band.lower, band.upper) for n, band in enumerate(document.tiers.bands, start=1)}


def _round2_tables(document: AidRules, table: str) -> set[str]:
    return {
        document.round2.program_tables.get(key) or ""
        for key, program in document.programs.items()
        if (program.r1_table or "") == table
    } - {""}


def _fee(document: AidRules | None, table: str | None, round_: RoundChip, tier: int | None) -> Decimal | None:
    if document is None or table is None or tier is None or round_ == 3:
        return None
    if round_ == 2:
        tables = _round2_tables(document, table)
        return round2_max_pct(document, next(iter(tables)), tier) if len(tables) == 1 else None
    return fee_pct(document, table, tier)


def _row(
    requests: Sequence[ReportRequest],
    *,
    tier: int | None,
    band: tuple[Decimal, Decimal | None] | None,
    fee: Decimal | None,
    round_: RoundChip,
    basis: Basis,
) -> StatisticsRow:
    rounds = _rounds(round_)
    with_decided = basis == "posted_and_decided"
    asked = live_asked = amount = decided = awarded = ZERO
    asks = awarded_count = decided_count = cancelled = 0
    grants = ZERO
    for request in requests:
        ask = request.asked(rounds)
        if ask is not None:
            asked += ask
            asks += 1
        if request.standing == "cancelled":
            cancelled += 1
        if not request.live:
            continue
        if (in_budget := request.asked_in_budget(rounds)) is not None:
            live_asked += in_budget
        money = request.awarded(rounds, decided=with_decided)
        posted = request.awarded(rounds)
        amount += money
        awarded += posted
        decided += money - posted
        awarded_count += posted > 0
        decided_count += money - posted > 0
        grants += request.grants
    shows_grants = round_ in (None, 1)
    # Owner (b) (RULED 2026-10-02): pct_of_ask and "% with grants" divide Posted (+ Decided, on the decided basis) by
    # the live requests' asks, so a request still waiting on an offer sits in the denominator at $0; the decided
    # basis's column says so (PCT_OF_ASK_DECIDED_LABEL).
    return StatisticsRow(
        tier=tier,
        income_from=band[0] if band is not None else None,
        income_to=band[1] if band is not None else None,
        fee_pct=fee,
        apps=len(requests),
        cancelled=cancelled,
        asked=asked,
        asks=asks,
        average_ask=average(asked, asks),
        amount=amount,
        decided=decided,
        awarded_count=awarded_count,
        decided_count=decided_count,
        average_award=average(awarded, awarded_count),
        live_asked=live_asked,
        pct_of_ask=pct(amount, live_asked),
        grants=grants if shows_grants else None,
        pct_of_ask_with_grants=pct(amount + grants, live_asked) if shows_grants else None,
    )


def _population(requests: Iterable[ReportRequest], table: str | None, round_: RoundChip) -> list[ReportRequest]:
    return [r for r in in_table(requests, table) if in_round(r, round_)]


def statistics(
    requests: Iterable[ReportRequest],
    document: AidRules | None,
    *,
    table: str | None,
    round_: RoundChip,
    basis: Basis = "posted",
) -> StatisticsTable:
    population = _population(requests, table, round_)
    by_tier: dict[int | None, list[ReportRequest]] = defaultdict(list)
    for request in population:
        by_tier[_tier(request, round_)].append(request)
    bands = _bands(document)
    tiers: list[int | None] = [*sorted(bands.keys() | {t for t in by_tier if t is not None})]
    if None in by_tier:
        tiers.append(None)
    rows = tuple(
        _row(
            by_tier.get(tier, []),
            tier=tier,
            band=bands.get(tier) if tier is not None else None,
            fee=_fee(document, table, round_, tier),
            round_=round_,
            basis=basis,
        )
        for tier in tiers
    )
    total = _row(population, tier=None, band=None, fee=None, round_=round_, basis=basis)
    return StatisticsTable(rows, total, recipients_cancelled(population, round_))


def recipients_cancelled(requests: Iterable[ReportRequest], round_: RoundChip = None) -> tuple[CancelledRow, ...]:
    """D131: requests with a posted award (D80) later cancelled, by cancel reason, pool and round."""
    tally: dict[tuple[str, str | None, int], tuple[int, Decimal]] = {}
    for request in requests:
        if request.standing != "cancelled":
            continue
        for n in _rounds(round_):
            facts = request.round(n)
            if facts is None or facts.locked is None:
                continue
            key = (request.cancel_reason or NO_REASON, facts.pool, n)
            count, money = tally.get(key, (0, ZERO))
            tally[key] = (count + 1, money + facts.locked)
    return tuple(
        CancelledRow(reason, pool, n, count, money)
        for (reason, pool, n), (count, money) in sorted(
            tally.items(), key=lambda kv: (kv[0][0], kv[0][1] or "", kv[0][2])
        )
    )


def tier_appeals(
    requests: Iterable[ReportRequest], document: AidRules | None, *, table: str | None
) -> tuple[TierAppealsRow, ...]:
    """RPT-9: each tier's Round 1 apps beside its appeals, then a "no tier" row when any, then the totals (tier None,
    no band)."""
    population = in_table(requests, table)
    round1: dict[int | None, list[ReportRequest]] = defaultdict(list)
    round2: dict[int | None, int] = defaultdict(int)
    round3: dict[int | None, Decimal] = defaultdict(lambda: ZERO)
    for request in population:
        round1[_tier(request, 1)].append(request)
        # Owner ruling (RULED 2026-10-02, appeals and cancellations): a cancelled request's Round 2 ask counts as an appeal,
        # because the rate divides by applications, which include cancellations (D131). RPT-23 leaves them out.
        if in_round(request, 2):
            round2[_tier(request, 2)] += 1
        round3[_tier(request, 3)] += request.awarded((3,))
    bands = _bands(document)
    tiers: list[int | None] = [*sorted(bands.keys() | {t for t in (*round1, *round2) if t is not None})]
    if None in round1 or None in round2:
        tiers.append(None)

    def row(tier: int | None, apps: int, appealed: int, r3: Decimal, *, total: bool = False) -> TierAppealsRow:
        band = bands.get(tier) if tier is not None and not total else None
        return TierAppealsRow(
            tier=None if total else tier,
            income_from=band[0] if band is not None else None,
            income_to=band[1] if band is not None else None,
            round1_apps=apps,
            round1_fee_pct=None if total else _fee(document, table, 1, tier),
            appeals=appealed,
            round2_max_pct=None if total else _fee(document, table, 2, tier),
            round3_awarded=r3,
            appeal_rate=pct(Decimal(appealed), Decimal(apps)),
        )

    rows = [row(tier, len(round1.get(tier, [])), round2.get(tier, 0), round3.get(tier, ZERO)) for tier in tiers]
    rows.append(row(None, len(population), sum(round2.values()), sum(round3.values(), ZERO), total=True))
    return tuple(rows)


def outcomes(requests: Iterable[ReportRequest]) -> tuple[OutcomeRow, ...]:
    """RPT-23 per home pool, then all pools (pool None): accepted (Round 1 posted and accepted: count and the posted
    amount), appealed (a Round 2 ask: count and the asks), waiting (Round 1 posted, not accepted, no Round 2 ask).
    Live requests only: a cancelled family is no longer waiting."""
    pools: dict[str | None, list[ReportRequest]] = defaultdict(list)
    every: list[ReportRequest] = []
    for request in requests:
        if request.live:
            pools[request.pool].append(request)
            every.append(request)

    def row(pool: str | None, members: Sequence[ReportRequest]) -> OutcomeRow:
        accepted = appealed = waiting = 0
        accepted_amount = appealed_asked = ZERO
        for request in members:
            first = request.round(1)
            second = request.round(2)
            posted = first.posted if first is not None else None
            asked2 = second.ask if second is not None else None
            if posted is not None and first is not None and first.accepted:
                accepted += 1
                accepted_amount += posted
            if asked2 is not None:
                appealed += 1
                appealed_asked += asked2
            elif posted is not None and first is not None and not first.accepted:
                waiting += 1
        return OutcomeRow(pool, accepted, accepted_amount, appealed, appealed_asked, waiting)

    ordered = sorted(pools, key=lambda p: (p is None, p or ""))
    return (*(row(pool, pools[pool]) for pool in ordered), row(None, every))

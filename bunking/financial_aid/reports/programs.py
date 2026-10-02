"""Reports › Programs (finance's Program Statistics tab; clean spec §9.3, §9.7 RPT-11; D72, D80, D129). Pure.

One row per session, grouped by category (the rules' pools) with a subtotal per pool, then the grand total.
Each row: Round 1 (apps, requested, awarded, average request, average award, % awarded), Round 2 (the same six
over the appeals), Round 3 (apps, awarded), and total awarded. Kindred's additions over the sheet (marked so on
the screen): the pool grouping and subtotals, the Round 3 columns and total awarded.

  sessions          from the rules, never a hand-kept list: every session a rules program claims, in its program's
                    pool (the caller resolves them), even with no applications; then, per pool, one "session not
                    matched" row (session 0) when a request in that pool has no matched session, and a "no pool"
                    group for requests whose program has none.
  a request         counts once, in its own session (a request is one camper × one session, or one household ×
                    one Family Camp session; a camper at two sessions is two requests), under that session's pool;
                    a request with no rules session counts in its home pool's "session not matched" row.
  apps, requested   as Statistics (D72): received requests, cancelled included; their asks as keyed.
  awarded           as Statistics (D80, D129): Posted on live requests, net of clawback.
  average request   requested ÷ requests with an ask; average award: awarded ÷ requests with an award (D80, labelled,
                    O-930-16; the sheet divided by every app).
  % awarded         awarded ÷ the live requests' asks (the sheet's avg award ÷ avg request is awarded ÷ requested).
  subtotals/total   POOLED ratios over the rows' requests, never averages of the rows' ratios (the sheet summed its
                    averages and averaged its percentages).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Final

from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.facts import ReportRequest, average, in_round
from bunking.financial_aid.scenarios.committee import pct

UNMATCHED_SESSION: Final = 0


@dataclass(frozen=True)
class RoundBlock:
    apps: int
    requested: Decimal
    asks: int
    awarded: Decimal
    awarded_count: int
    average_request: Decimal | None
    average_award: Decimal | None
    pct_awarded: Decimal | None


@dataclass(frozen=True)
class ProgramRow:
    session_cm_id: int  # 0: "session not matched" (or the subtotal / total rows, which carry no session)
    round1: RoundBlock
    round2: RoundBlock
    round3: RoundBlock
    total_awarded: Decimal


@dataclass(frozen=True)
class PoolGroup:
    pool: str | None
    sessions: tuple[ProgramRow, ...]
    subtotal: ProgramRow


@dataclass(frozen=True)
class ProgramsTable:
    pools: tuple[PoolGroup, ...]
    total: ProgramRow


def _block(requests: Sequence[ReportRequest], n: int) -> RoundBlock:
    members = [r for r in requests if in_round(r, n)]
    requested = live_asked = awarded = ZERO
    asks = awarded_count = 0
    for request in members:
        ask = request.asked((n,))
        if ask is not None:
            requested += ask
            asks += 1
            if request.live:
                live_asked += ask
        money = request.awarded((n,))
        awarded += money
        awarded_count += money > 0
    return RoundBlock(
        apps=len(members),
        requested=requested,
        asks=asks,
        awarded=awarded,
        awarded_count=awarded_count,
        average_request=average(requested, asks),
        average_award=average(awarded, awarded_count),
        pct_awarded=pct(awarded, live_asked),
    )


def _row(session: int, requests: Sequence[ReportRequest]) -> ProgramRow:
    return ProgramRow(
        session_cm_id=session,
        round1=_block(requests, 1),
        round2=_block(requests, 2),
        round3=_block(requests, 3),
        total_awarded=sum((r.awarded() for r in requests), ZERO),
    )


def programs(requests: Iterable[ReportRequest], sessions: Mapping[int, str | None]) -> ProgramsTable:
    """`sessions`: every session a rules program claims -> its program's pool (None: the program has no pool)."""
    every = list(requests)
    by_session: dict[tuple[str | None, int], list[ReportRequest]] = defaultdict(list)
    for request in every:
        session = request.session_cm_id if request.session_cm_id in sessions else UNMATCHED_SESSION
        # A rules session sits in its own program's pool, so a request never splits it across two pools.
        pool = sessions[session] if session != UNMATCHED_SESSION else request.pool
        by_session[(pool, session)].append(request)
    slots: dict[str | None, set[int]] = defaultdict(set)
    for session, pool in sessions.items():
        slots[pool].add(session)
    for pool, session in by_session:
        slots[pool].add(session)
    groups: list[PoolGroup] = []
    for pool in sorted(slots, key=lambda p: (p is None, p or "")):
        ordered = sorted(slots[pool], key=lambda s: (s == UNMATCHED_SESSION, s))
        rows = tuple(_row(session, by_session.get((pool, session), [])) for session in ordered)
        members = [r for session in ordered for r in by_session.get((pool, session), [])]
        groups.append(PoolGroup(pool, rows, _row(UNMATCHED_SESSION, members)))
    return ProgramsTable(tuple(groups), _row(UNMATCHED_SESSION, every))

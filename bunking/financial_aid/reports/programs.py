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
  apps, requested   as Statistics (D72): received requests, cancelled included; their asks capped as Statistics'
                    round chips (owner A1/A2, 2026-10-09: at most the cost less the awards posted before the
                    round), with the asks as keyed beside them for the CSV and Copy (A3).
  awarded           as Statistics (D80, D129): Posted on live requests, net of clawback.
  average request   requested ÷ requests with an ask; average award: awarded ÷ requests with an award (D80, labelled,
                    O-930-16; the sheet divided by every app).
  % awarded         awarded ÷ the live requests' capped asks (A5; the sheet's avg award ÷ avg request is awarded ÷
                    requested).
  subtotals/total   POOLED ratios over the rows' requests, never averages of the rows' ratios (the sheet summed its
                    averages and averaged its percentages).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.facts import ReportRequest, average, capped_ask, in_round, is_capped
from bunking.financial_aid.scenarios.committee import pct

UNMATCHED_SESSION: Final = 0
ProgramsCount = Literal["apps", "asks", "awarded"]
ProgramsPart = Literal["session", "subtotal", "total"]


def block_counts_in(request: ReportRequest, n: int) -> frozenset[ProgramsCount]:
    """The Programs counts a request is in, in round `n`'s block (none when it isn't in that round): one definition
    for the block's counts and the requests behind them (slice 4 ask 1). Awards: awarded above $0 (D80, D157), which
    is 0 on a request that isn't live (D129)."""
    if not request.counts_as_received or not in_round(request, n):
        return frozenset()
    found: set[ProgramsCount] = {"apps"}
    if request.asked((n,)) is not None:
        found.add("asks")
    if request.awarded((n,)) > 0:
        found.add("awarded")
    return frozenset(found)


def _slot(request: ReportRequest, sessions: Mapping[int, str | None]) -> tuple[str | None, int]:
    """The (pool, session) row a request counts in: its own rules session under that session's pool, else its home
    pool's "session not matched" row."""
    session = request.session_cm_id if request.session_cm_id in sessions else UNMATCHED_SESSION
    # A rules session sits in its own program's pool, so a request never splits it across two pools.
    pool = sessions[session] if session != UNMATCHED_SESSION else request.pool
    return pool, session


def program_members(
    requests: Iterable[ReportRequest],
    sessions: Mapping[int, str | None],
    *,
    part: ProgramsPart,
    pool: str | None,
    session: int,
    block: int,
    count: ProgramsCount,
) -> tuple[str, ...]:
    """The requests behind one count of one Programs row: a session's row in `pool` (`session` 0: that group's
    "session not matched"), a pool's subtotal, or the total; in round `block`'s block. Sorted."""

    def in_row(request: ReportRequest) -> bool:
        if part == "total":
            return True
        slot_pool, slot_session = _slot(request, sessions)
        if slot_pool != pool:
            return False
        return part == "subtotal" or slot_session == session

    return tuple(sorted(r.request_id for r in requests if in_row(r) and count in block_counts_in(r, block)))


@dataclass(frozen=True)
class RoundBlock:
    apps: int
    requested: Decimal  # capped (owner A1/A2, 2026-10-09)
    requested_as_typed: Decimal  # the asks as keyed (A3: the CSV and Copy)
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
    requests_capped: int = 0  # received requests whose need is above their session's cost (the All-rounds basis)


def _block(requests: Sequence[ReportRequest], n: int) -> RoundBlock:
    members = [r for r in requests if in_round(r, n)]
    requested = requested_as_typed = live_asked = awarded = ZERO
    asks = awarded_count = 0
    for request in members:
        found = block_counts_in(request, n)
        asks += "asks" in found
        awarded_count += "awarded" in found
        # Owner A1/A2 (2026-10-09): Statistics' round chip, the round's ask at most the cost less the awards before
        if (ask := capped_ask(request, n)) is not None:
            requested += ask
            requested_as_typed += request.asked((n,)) or ZERO  # A3
        if request.live and (in_budget := capped_ask(request, n, in_budget=True)) is not None:
            live_asked += in_budget  # A5: % awarded divides by the same capped asks
        awarded += request.awarded((n,))
    return RoundBlock(
        apps=len(members),
        requested=requested,
        requested_as_typed=requested_as_typed,
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
    every = [r for r in requests if r.counts_as_received]  # a posted duplicate is no application, nor a session's
    by_session: dict[tuple[str | None, int], list[ReportRequest]] = defaultdict(list)
    for request in every:
        by_session[_slot(request, sessions)].append(request)
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
    capped = sum(1 for r in every if r.asked() is not None and is_capped(r))
    return ProgramsTable(tuple(groups), _row(UNMATCHED_SESSION, every), capped)

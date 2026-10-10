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
  one row           the season's SCIT sessions (Counselor and Specialist In-Training: two CampMinder sessions of type
                    scit, the same dates) are ONE row in a pool, summing both (owner 2026-10-10: "approved to combine
                    SCIT"). By session type within the season, never by id; the row takes its first session's id and
                    place in the reader's order, carries every session in it (`session_cm_ids`, which the API names
                    "A + B"), and its counts open every session in it.
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
from bunking.session_order import SessionLike, session_order

UNMATCHED_SESSION: Final = 0
# The session types whose sessions in one pool make one row (owner 2026-10-10: SCIT, CIT + SIT).
ONE_ROW_TYPES: Final = frozenset({"scit"})
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


def one_row_sessions(season: Sequence[SessionLike], sessions: Mapping[int, str | None]) -> dict[int, int]:
    """Each session that shares a row -> the row's session (its group's first in the reader's order): the season's
    sessions of a ONE_ROW_TYPES type that the rules put in the same pool, two or more of them. `sessions`: the rules'
    sessions -> their pool, as `programs` takes them."""
    kinds = {s.cm_id: s.session_type.strip().lower() for s in season}
    shared = [s for s in season if kinds[s.cm_id] in ONE_ROW_TYPES and s.cm_id in sessions]
    groups: dict[tuple[str, str | None], list[int]] = defaultdict(list)
    for cm_id in session_order(shared):
        groups[(kinds[cm_id], sessions[cm_id])].append(cm_id)
    return {member: ids[0] for ids in groups.values() if len(ids) > 1 for member in ids}


def _slot(
    request: ReportRequest, sessions: Mapping[int, str | None], one_row: Mapping[int, int]
) -> tuple[str | None, int]:
    """The (pool, session) row a request counts in: its own rules session (or the row it shares) under that session's
    pool, else its home pool's "session not matched" row."""
    own = request.session_cm_id
    session = one_row.get(own, own) if own in sessions else UNMATCHED_SESSION
    # A rules session sits in its own program's pool, so a request never splits it across two pools.
    pool = sessions[own] if session != UNMATCHED_SESSION else request.pool
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
    one_row: Mapping[int, int] | None = None,
) -> tuple[str, ...]:
    """The requests behind one count of one Programs row: a session's row in `pool` (`session` 0: that group's
    "session not matched"; any session of a shared row names the row), a pool's subtotal, or the total; in round
    `block`'s block. Sorted."""
    shared = one_row or {}
    row = shared.get(session, session)

    def in_row(request: ReportRequest) -> bool:
        if part == "total":
            return True
        slot_pool, slot_session = _slot(request, sessions, shared)
        if slot_pool != pool:
            return False
        return part == "subtotal" or slot_session == row

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
    session_cm_ids: tuple[int, ...] = ()  # the sessions the row counts: one, or a shared row's (SCIT); none on 0


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


def _row(session: int, requests: Sequence[ReportRequest], members: tuple[int, ...] = ()) -> ProgramRow:
    return ProgramRow(
        session_cm_id=session,
        round1=_block(requests, 1),
        round2=_block(requests, 2),
        round3=_block(requests, 3),
        total_awarded=sum((r.awarded() for r in requests), ZERO),
        session_cm_ids=members,
    )


def programs(
    requests: Iterable[ReportRequest],
    sessions: Mapping[int, str | None],
    *,
    rank: Mapping[int, int] | None = None,
    closed_to_aid: frozenset[int] = frozenset(),
    one_row: Mapping[int, int] | None = None,
) -> ProgramsTable:
    """`sessions`: every session a rules program claims -> its program's pool (None: the program has no pool).

    `rank`: each session's place in the reader's order (bunking/session_order.py; owner Q8, 2026-10-09), inside its
    pool; a session it names no place for, and any tie, goes by CampMinder id. "Session not matched" is always last.
    `closed_to_aid`: the sessions whose rules program is not open to aid. One of them with no application is no row
    (owner Q7, 2026-10-10: "hide sessions which are the no pool ones"), keyed off the rules and never the zero count;
    with an application it shows. A session of an aided program shows even at 0.
    `one_row`: each session that shares a row -> the row's session (`one_row_sessions`); the row hides only when all
    its sessions are closed to aid."""
    shared = one_row or {}
    every = [r for r in requests if r.counts_as_received]  # a posted duplicate is no application, nor a session's
    by_session: dict[tuple[str | None, int], list[ReportRequest]] = defaultdict(list)
    for request in every:
        by_session[_slot(request, sessions, shared)].append(request)
    places = rank or {}
    row_sessions: dict[int, list[int]] = defaultdict(list)
    for session in sorted(sessions, key=lambda s: (places.get(s, len(places)), s)):
        row_sessions[shared.get(session, session)].append(session)
    slots: dict[str | None, set[int]] = defaultdict(set)
    for session, pool in sessions.items():
        row = shared.get(session, session)
        if all(m in closed_to_aid for m in row_sessions[row]) and (pool, row) not in by_session:
            continue
        slots[pool].add(row)
    for pool, session in by_session:
        slots[pool].add(session)
    groups: list[PoolGroup] = []
    for pool in sorted(slots, key=lambda p: (p is None, p or "")):
        ordered = sorted(slots[pool], key=lambda s: (s == UNMATCHED_SESSION, places.get(s, len(places)), s))
        rows = tuple(
            _row(session, by_session.get((pool, session), []), tuple(row_sessions.get(session, ())))
            for session in ordered
        )
        members = [r for session in ordered for r in by_session.get((pool, session), [])]
        groups.append(PoolGroup(pool, rows, _row(UNMATCHED_SESSION, members)))
    capped = sum(1 for r in every if r.asked() is not None and is_capped(r))
    return ProgramsTable(tuple(groups), _row(UNMATCHED_SESSION, every), capped)

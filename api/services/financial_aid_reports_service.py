"""Reports' reads and finance's typed history (Reports back end, Part A; clean spec §9.1–§9.3, §9.5, §9.7, §10;
D21, D63, D72, D80, D129–D133, D138).

Three reads, one per surface (D21), all `financial_aid.view`:

  Statistics  one season, live or as of a past day (3c-2), chips (award table × round), the "Decided (not yet
              offered)" basis (D130), the reporting controls (D138), RPT-9's per-tier table and RPT-23's
              outcomes beside it, and D131's cancellations.
  Programs    one season by session (RPT-11), live or as of a past day, with the reporting controls.
  Committee   the year-over-year tables (RPT-1, 2, 6, 7, 8, 13, 24): every season Kindred priced (P) beside finance's
              typed history (r), live.

Each season is priced once through FinancialAidDecisionsService (the Requests grid's own read), so Reports and
casework never disagree; reports read request status, never the budget's Posted (D129, D131).

And finance's typed history (`aid_reported_history`, O-930-13's default): a bulk load that adds or corrects figures
by their natural key, skipping the unchanged ones (a no-op never reaches 4a), and a delete with a reason. Every
write commits with its aid_change_log row (4a), one operation per load.

Past dates (3c-2 prices them, D154): a request cancelled (CampMinder or Kindred) on or before the day is cancelled then
(the decisions service's past read lists those, Decision 11), so the cancellation lines are real counts; tiers, the
Decided basis and grants (the grant placement log as it stood) are shown. What 3c-2 can't rebuild for a request is named
in `not_rebuilt` with its request ids (`Season.gaps`), and a request kept to 3c-1's figures adds no decided amount (never
an estimate). A request whose posted money can't be replayed (`Season.posted_unknown`) has that money left out of
awarded, as the Requests grid and the budget blank it, and a `posted` gap names it.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Final, Literal, Protocol

from api.constants.collections import AID_REPORTED_HISTORY, AID_REQUESTS
from api.schemas.financial_aid_decisions import AsOfAxis, NotRebuiltOut
from api.schemas.financial_aid_reports import (
    AppealsRowOut,
    ApplicationsRowOut,
    BandOut,
    BudgetRowOut,
    CancelledRowOut,
    ChipOut,
    CommitteeResponse,
    CountedOut,
    NotBuiltOut,
    OutcomeRowOut,
    PhaseRowOut,
    PoolGroupOut,
    ProgramRowOut,
    ProgramsResponse,
    ReportedFigureOut,
    ReportedHistoryResponse,
    ReportedLoadOut,
    ReportRequestIdsOut,
    Round1PctRowOut,
    RoundBlockOut,
    StatisticsBasis,
    StatisticsResponse,
    StatisticsRowOut,
    TierAppealsRowOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_cancellations import CANCEL_REASON_LABELS
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    RegisterSource,
    Season,
)
from api.services.financial_aid_ledger_service import as_of_cutoff, money, parse_pb_datetime
from api.services.financial_aid_reports_facts import (
    FrozenAsks,
    frozen_round1_asks,
    received_ids,
    report_requests,
    with_frozen_asks,
)
from api.services.financial_aid_reports_repository import StoredFigure, figure_fields
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.received import edit_predecessors, received_dates, split_by_received
from bunking.financial_aid.reports.committee import (
    NO_DEADLINE_CUT_GAP,
    AppealsRow,
    ApplicationsRow,
    Band,
    BudgetRow,
    Counted,
    NativeSeason,
    PhaseRow,
    Round1PctRow,
    committee_tables,
)
from bunking.financial_aid.reports.facts import ReportRequest
from bunking.financial_aid.reports.history import ReportedFigure, figure_entity, problems
from bunking.financial_aid.reports.programs import (
    ProgramRow,
    ProgramsCount,
    ProgramsPart,
    RoundBlock,
    program_members,
    programs,
)
from bunking.financial_aid.reports.statistics import (
    DUPLICATE_REASON,
    NO_REASON,
    PCT_OF_ASK_DECIDED_LABEL,
    PCT_OF_ASK_LABEL,
    PCT_WITH_GRANTS_DECIDED_LABEL,
    PCT_WITH_GRANTS_LABEL,
    WITHDRAWN_REASON,
    OutcomeKind,
    RoundChip,
    StatisticsCount,
    StatisticsRow,
    cancelled_members,
    outcome_members,
    outcomes,
    statistics,
    tier_appeals,
    tier_members,
)
from bunking.financial_aid.rules import AidRules, resolve_program
from bunking.financial_aid.scenarios.request_set import RequestSet, RequestSetNote, request_set_note
from bunking.pocketbase_batch import MAX_BATCH_REQUESTS

# Finance ruled out reporting before 2022 (COVID): trends start there (§9.5).
FIRST_REPORT_SEASON: Final = 2022
# D138: received dates mean something from 2027 (every 2026 request row was created on 2026-09-27).
FIRST_RECEIVED_SEASON: Final = 2027
# The first season with aid_requests at all: intake starts in 2026, so earlier seasons are typed history only.
FIRST_REQUEST_SEASON: Final = 2026
POSTED_GAP: Final = "posted money a past date can't replay: left out of awarded; still in apps and asks"
CANCELLATION_CAVEAT: Final = (
    "counted as of the day; a registration CampMinder changed since then reads as it stands now"
)
WITHDRAWN_LABEL: Final = "Withdrawn in Kindred"
DUPLICATE_LABEL: Final = "Duplicate"
# RPT-1's two figure columns (owner N2 = C): what each says, server-sent so the screen never words it.
OFFERED_LABEL: Final = "As offered"
END_OF_SEASON_LABEL: Final = "End of season"
END_OF_SEASON_TO_DATE_LABEL: Final = "End of season (to date)"
NO_POOL_LABEL: Final = "No pool"
UNMATCHED_LABEL: Final = "Session not matched"
ALL_POOLS_LABEL: Final = "All pools"
RECONCILIATION_LABEL: Final = "headline − Σ pools"
NOT_BUILT: Final[Mapping[str, str]] = {
    NO_DEADLINE_CUT_GAP: (
        "A season with no received dates (before 2027, D138) or no application deadline can't split Round 1 at the "
        "deadline: phases 1 and 2 are blank; typed history shows the decks' figures"
    ),
    "enrollment_pct_of_goal": "Enrollment % of goal waits for its basis (O-930-15, finance); nothing is shown",
    "round1_pct_start_of_season": (
        "Round 1 % of ask at the start of the season is Scenarios › Compare's rules column (RPT-17), on the frozen "
        "snapshot"
    ),
    "rebuild_history": (
        "Seasons before Kindred's decisions show finance's typed figures only. Kindred's approximate rebuild (≈) is "
        "deferred: demand and application counts from the aid form mirror need an outlier-ask rule, and money by "
        "pool needs the 2017–2024 ledger backfill"
    ),
    "typed_tiers": "Typed per-tier history (RPT-9's earlier seasons) loads but isn't shown yet",
    "typed_cancellations": "Earlier seasons' recipients who cancelled (RPT-22) have no typed history yet",
}


class ReportsRefusedError(FinancialAidError, ValueError):
    """A read or load that can't be answered as asked (422)."""


StatisticsPart = Literal["tier", "total", "cancelled", "outcome"]
OutcomeRowKind = Literal["pool", "no_pool", "headline"]  # OutcomeRowOut.kind's three values


class ReportedFigureNotFoundError(FinancialAidError, LookupError):
    """No aid_reported_history record with that id (404)."""


class ReportsStore(Protocol):
    """What the service needs of the reports repository (ReportsRepository has it; tests use a fake)."""

    async def reported(self) -> list[StoredFigure]: ...
    async def commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None
    ) -> AidOperationResult: ...


@dataclass(frozen=True)
class _Read:
    season: Season
    requests: tuple[ReportRequest, ...]
    note: RequestSetNote | None
    figures_on: date


def _money(value: Decimal | None) -> float | None:
    return money(value) if value is not None else None


def _pct(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _pool_label(document: AidRules | None, pool: str | None) -> str:
    if pool is None:
        return NO_POOL_LABEL
    if document is not None and pool in document.budget.pools:
        return document.budget.pools[pool].label
    return pool


def table_chips(document: AidRules | None) -> list[ChipOut]:
    """Each award table, labelled by the pool its programs share (pool A, pool B, ...), else by
    its programs' labels."""
    if document is None:
        return []
    out: list[ChipOut] = []
    for key in document.award_tables:
        programs_ = [p for p in document.programs.values() if (p.r1_table or "") == key]
        pools = {p.budget_pool for p in programs_}
        if len(pools) == 1 and (pool := next(iter(pools))) is not None and pool in document.budget.pools:
            label = document.budget.pools[pool].label
        else:
            label = " · ".join(p.label for p in programs_) or key
        out.append(ChipOut(key=key, label=label))
    return out


class FinancialAidReportsService:
    def __init__(
        self,
        store: DecisionsStore,
        rules: PricingRules,
        register: RegisterSource,
        history: ReportsStore,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._rules = rules
        self._history = history
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        self._decisions = FinancialAidDecisionsService(store, rules, register, clock=self._clock)

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    # --- the season, as reports read it ---------------------------------------------------------------------

    async def _request_set(self, year: int, through_deadline: bool, through: date | None) -> RequestSet | None:
        """The reporting control asked for (D138), or None. Both at once is refused; so is either before 2027."""
        if through_deadline and through is not None:
            raise ReportsRefusedError("Choose the Round 1 deadline switch or a received-through date, not both")
        if not through_deadline and through is None:
            return None
        if year < FIRST_RECEIVED_SEASON:
            raise ReportsRefusedError(
                f"The reporting controls work from {FIRST_RECEIVED_SEASON}: every {year} request was recorded on one "
                "day, so there is no received date to cut on (D138)"
            )
        if through is not None:
            return RequestSet("date", through)
        approved = await self._rules.latest_approved(year, ["milestones"])
        deadline = approved.document.milestones.application_deadline if approved is not None else None
        if deadline is None:
            raise ReportsRefusedError(
                f"{year}'s approved rules set no application deadline (milestones): choose a received-through date"
            )
        return RequestSet("round1_deadline", deadline)

    async def _received(self, season: Season) -> dict[str, datetime | None]:
        if season.year < FIRST_RECEIVED_SEASON:
            return {}
        log = await self._store.fetch_change_log(season.year, AID_REQUESTS)
        return received_dates(season.requests.keys(), log, predecessors=edit_predecessors(season.requests.values()))

    async def _frozen(self, year: int, season: Season, kept: Collection[str], day: date) -> FrozenAsks:
        """D155: the kept requests' Round 1 asks as they stood at the end of `day`. A day on or after the read's own
        (today for the live read, the read's date for a past one) is the read itself: nothing to rebuild."""
        on = season.as_of if season.as_of is not None else self._today()
        if day >= on:
            return FrozenAsks(day, "as_of_cutoff")
        then = await self._decisions.past_season(year, day, "recorded")  # requests replay alike on both axes
        cutoff = as_of_cutoff(day)
        corrections = [
            c
            for c in await self._store.fetch_corrections(year, None)
            if (made := parse_pb_datetime(c.created)) is not None and made < cutoff
        ]
        return frozen_round1_asks(season, then, corrections, kept, day)

    async def _read(self, year: int, *, as_of: date | None, axis: AsOfAxis, request_set: RequestSet | None) -> _Read:
        today = self._today()
        past = as_of is not None and as_of < today
        season = (
            await self._decisions.past_season(year, as_of, axis)
            if past and as_of
            else await self._decisions.season(year)
        )
        received = await self._received(season)
        corrections = await self._store.fetch_corrections(year, None)
        if past and as_of is not None:
            cutoff = as_of_cutoff(as_of)
            corrections = [
                c for c in corrections if (made := parse_pb_datetime(c.created)) is not None and made < cutoff
            ]
        keep: frozenset[str] | None = None
        note: RequestSetNote | None = None
        if request_set is not None:
            ids = received_ids(season.requests)
            split = split_by_received({rid: received.get(rid) for rid in ids}, as_of_cutoff(request_set.through), ids)
            keep, note = split.kept, request_set_note(request_set, split)
        requests = report_requests(season, received=received, corrections=corrections, keep=keep)
        # Owner N1 (RULED 2026-10-02): the request set only filters; every figure, asks included, reads as it stands
        # today. Only the committee's at-cutoff snapshot row freezes asks (`committee`).
        return _Read(season, requests, note, as_of if past and as_of is not None else today)

    def _gaps(self, read: _Read) -> list[NotRebuiltOut]:
        """What a past read can't rebuild: the requests whose posted money can't be replayed (left out of awarded in
        `report_requests`, as the grid and the budget blank it), then 3c-2's own gaps with their request ids."""
        if read.season.as_of is None:
            return []
        # Only a live request's money is left out (report_requests): a cancelled one's was never awarded.
        ids = sorted(
            rid for rid in read.season.posted_unknown if any(r.request_id == rid and r.live for r in read.requests)
        )
        posted = [NotRebuiltOut(figure="posted", reason=POSTED_GAP, requests=ids)] if ids else []
        # A caveat, not a gap: it names no request, so a reader keeps the counts and only notes the limit.
        caveat = NotRebuiltOut(figure="cancellation", reason=CANCELLATION_CAVEAT)
        return [*posted, caveat, *read.season.gaps]

    # --- Statistics -------------------------------------------------------------------------------------------

    async def _statistics_read(
        self,
        year: int,
        *,
        table: str | None,
        through_deadline: bool,
        through: date | None,
        as_of: date | None,
        axis: AsOfAxis,
    ) -> tuple[_Read, AidRules | None]:
        """Statistics' season as read, and its rules; an award-table chip the rules don't have is refused."""
        read = await self._read(
            year, as_of=as_of, axis=axis, request_set=await self._request_set(year, through_deadline, through)
        )
        document = read.season.rules.document if read.season.rules is not None else None
        if table is not None and (document is None or table not in document.award_tables):
            raise ReportsRefusedError(f"{table!r} is not one of {year}'s award tables")
        return read, document

    async def statistics(
        self,
        year: int,
        *,
        table: str | None = None,
        round_: RoundChip = 1,
        basis: StatisticsBasis = "posted",
        through_deadline: bool = False,
        through: date | None = None,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
    ) -> StatisticsResponse:
        read, document = await self._statistics_read(
            year, table=table, through_deadline=through_deadline, through=through, as_of=as_of, axis=axis
        )
        result = statistics(read.requests, document, table=table, round_=round_, basis=basis)
        return StatisticsResponse(
            year=year,
            as_of=read.season.as_of,
            as_of_axis=read.season.axis,
            figures_on=read.figures_on,
            rules_version=read.season.rules.version if read.season.rules is not None else None,
            basis=basis,
            pct_of_ask_label=PCT_OF_ASK_DECIDED_LABEL if basis == "posted_and_decided" else PCT_OF_ASK_LABEL,
            pct_of_ask_with_grants_label=(
                PCT_WITH_GRANTS_DECIDED_LABEL if basis == "posted_and_decided" else PCT_WITH_GRANTS_LABEL
            ),
            table=table,
            round=round_,
            tables=table_chips(document),
            rows=[_statistics_row(row) for row in result.rows],
            total=_statistics_row(result.total),
            cancelled_applicants=result.total.cancelled,
            recipients_cancelled=[
                CancelledRowOut(
                    reason=row.reason,
                    reason_label=_reason_label(row.reason),
                    pool=row.pool,
                    pool_label=_pool_label(document, row.pool),
                    round=row.round,
                    requests=row.requests,
                    posted=money(row.posted),
                )
                for row in result.recipients_cancelled
            ],
            tier_appeals=[
                TierAppealsRowOut(
                    tier=row.tier,
                    income_from=_money(row.income_from),
                    income_to=_money(row.income_to),
                    round1_apps=row.round1_apps,
                    round1_fee_pct=_pct(row.round1_fee_pct),
                    appeals=row.appeals,
                    round2_max_pct=_pct(row.round2_max_pct),
                    round3_awarded=money(row.round3_awarded),
                    appeal_rate=_pct(row.appeal_rate),
                )
                for row in tier_appeals(read.requests, document, table=table)
            ],
            outcomes=[
                OutcomeRowOut(
                    pool=row.pool,
                    kind=row.kind,
                    pool_label=(
                        NO_POOL_LABEL
                        if row.kind == "no_pool"
                        else ALL_POOLS_LABEL
                        if row.kind == "headline"
                        else _pool_label(document, row.pool)
                    ),
                    accepted=row.accepted,
                    accepted_amount=money(row.accepted_amount),
                    appealed=row.appealed,
                    appealed_asked=money(row.appealed_asked),
                    waiting=row.waiting,
                )
                for row in outcomes(read.requests)
            ],
            request_set=read.note,
            not_rebuilt=self._gaps(read),
        )

    # --- Programs ---------------------------------------------------------------------------------------------

    async def programs(
        self,
        year: int,
        *,
        through_deadline: bool = False,
        through: date | None = None,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
    ) -> ProgramsResponse:
        read = await self._read(
            year, as_of=as_of, axis=axis, request_set=await self._request_set(year, through_deadline, through)
        )
        document = read.season.rules.document if read.season.rules is not None else None
        sessions = rules_sessions(read.season, document)
        table = programs(read.requests, sessions)
        names = {cm_id: row.name for cm_id, row in read.season.sessions.items()}

        def row_out(row: ProgramRow, name: str) -> ProgramRowOut:
            return ProgramRowOut(
                session_cm_id=row.session_cm_id,
                session_name=name,
                round1=_block(row.round1),
                round2=_block(row.round2),
                round3=_block(row.round3),
                total_awarded=money(row.total_awarded),
            )

        return ProgramsResponse(
            year=year,
            as_of=read.season.as_of,
            as_of_axis=read.season.axis,
            figures_on=read.figures_on,
            rules_version=read.season.rules.version if read.season.rules is not None else None,
            pools=[
                PoolGroupOut(
                    pool=group.pool,
                    pool_label=_pool_label(document, group.pool),
                    sessions=[
                        row_out(
                            row, names.get(row.session_cm_id, UNMATCHED_LABEL) if row.session_cm_id else UNMATCHED_LABEL
                        )
                        for row in group.sessions
                    ],
                    subtotal=row_out(group.subtotal, _pool_label(document, group.pool)),
                )
                for group in table.pools
            ],
            total=row_out(table.total, ALL_POOLS_LABEL),
            request_set=read.note,
            not_rebuilt=self._gaps(read),
        )

    # --- the requests behind a count (slice 4 asks 1 and 8; D20) -------------------------------------------------

    async def statistics_request_ids(
        self,
        year: int,
        *,
        part: StatisticsPart,
        table: str | None = None,
        round_: RoundChip = 1,
        basis: StatisticsBasis = "posted",
        through_deadline: bool = False,
        through: date | None = None,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
        tier: int | None = None,
        count: StatisticsCount | None = None,
        reason: str | None = None,
        pool: str | None = None,
        posted_round: int | None = None,
        outcome_row: OutcomeRowKind | None = None,
        outcome: OutcomeKind | None = None,
    ) -> ReportRequestIdsOut:
        """The requests behind one count on the Statistics read with the same parameters: a tier row's count (`tier`
        None: the "no tier" row), the totals' count, an RPT-22 row (its reason, lock pool and round), or an RPT-23
        outcome (its row kind and pool). RPT-22 follows the chips, as its rows do; RPT-23 follows neither the chips
        nor the basis, as its rows don't. Every part follows the date and the reporting control."""
        if part in ("tier", "total") and count is None:
            raise ReportsRefusedError("Choose a count: apps, cancelled, asks, awarded or decided")
        if part == "cancelled" and (reason is None or posted_round is None):
            raise ReportsRefusedError("An RPT-22 row is named by its reason and its round (and its pool, if any)")
        if part == "outcome" and (outcome_row is None or outcome is None or (outcome_row == "pool" and pool is None)):
            raise ReportsRefusedError("An RPT-23 count is named by its row (pool, no_pool or headline) and outcome")
        read, _ = await self._statistics_read(
            year, table=table, through_deadline=through_deadline, through=through, as_of=as_of, axis=axis
        )
        if part == "outcome" and outcome_row is not None and outcome is not None:
            ids = outcome_members(read.requests, kind=outcome_row, pool=pool, outcome=outcome)
        elif part == "cancelled" and reason is not None and posted_round is not None:
            ids = cancelled_members(
                read.requests, table=table, round_=round_, reason=reason, pool=pool, posted_round=posted_round
            )
        elif count is not None:
            ids = tier_members(
                read.requests, table=table, round_=round_, basis=basis, tier=tier, total=part == "total", count=count
            )
        else:  # unreachable: the checks above refused it
            raise ReportsRefusedError("Name the row and the count")
        return _ids_out(year, read, ids)

    async def programs_request_ids(
        self,
        year: int,
        *,
        part: ProgramsPart,
        block: int,
        count: ProgramsCount,
        pool: str | None = None,
        session: int | None = None,
        through_deadline: bool = False,
        through: date | None = None,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
    ) -> ReportRequestIdsOut:
        """The requests behind one count of one Programs row (a session in its pool group, a pool's subtotal, the
        total), in round `block`'s block, on the Programs read with the same parameters. `pool` None is the no-pool
        group; `session` 0 is a group's "session not matched" row."""
        if part == "session" and session is None:
            raise ReportsRefusedError("A Programs session row is named by its pool and its session")
        read = await self._read(
            year, as_of=as_of, axis=axis, request_set=await self._request_set(year, through_deadline, through)
        )
        document = read.season.rules.document if read.season.rules is not None else None
        ids = program_members(
            read.requests,
            rules_sessions(read.season, document),
            part=part,
            pool=pool,
            session=session or 0,
            block=block,
            count=count,
        )
        return _ids_out(year, read, ids)

    # --- the committee's year-over-year tables ---------------------------------------------------------------

    async def committee(self, year: int, *, through: date | None = None) -> CommitteeResponse:
        """Every season from 2022 to `year`: typed rows (r) from finance's history, and a P row for each season
        Kindred priced (from 2027; 2026 once its decisions are loaded, D67). `through` moves RPT-2's cutoff off the
        application deadline."""
        today = self._today()
        if through is not None and year < FIRST_RECEIVED_SEASON:
            raise ReportsRefusedError(
                f"The reporting controls work from {FIRST_RECEIVED_SEASON}: every {year} request was recorded on one "
                "day, so there is no received date to cut on (D138)"
            )
        natives: list[NativeSeason] = []
        for season_year in range(max(FIRST_REQUEST_SEASON, FIRST_REPORT_SEASON), year + 1):
            season = await self._decisions.season(season_year)
            if season_year < FIRST_TICKED_SEASON and not any(
                view.status == "posted" for priced in season.priced.values() for view in priced.rounds
            ):
                continue  # 2026 before its decisions load (D67): typed history only
            received = await self._received(season)
            corrections = await self._store.fetch_corrections(season_year, None)
            document = season.rules.document if season.rules is not None else None
            deadline = document.milestones.application_deadline if document is not None else None
            if season_year < FIRST_RECEIVED_SEASON:
                deadline = None  # no received dates to cut on (D138)
            cutoff = through if through is not None and season_year == year else deadline
            requests = report_requests(season, received=received, corrections=corrections)
            cutoff_requests: tuple[ReportRequest, ...] | None = None
            frozen: FrozenAsks | None = None
            if cutoff is not None:
                cut = as_of_cutoff(cutoff)
                kept = frozenset(r.request_id for r in requests if r.received_at is not None and r.received_at < cut)
                frozen = await self._frozen(season_year, season, kept, cutoff)
                cutoff_requests = with_frozen_asks((r for r in requests if r.request_id in kept), frozen)
            natives.append(
                NativeSeason(
                    year=season_year,
                    season_closed=season_closed(season, document, today),
                    document=document,
                    requests=requests,
                    as_of=today,
                    cutoff=cutoff,
                    cutoff_instant=as_of_cutoff(cutoff) if cutoff is not None else None,
                    deadline_instant=as_of_cutoff(deadline) if deadline is not None else None,
                    cutoff_requests=cutoff_requests,
                    asks_basis=frozen.basis if frozen is not None else None,
                    asks_reason=frozen.reason if frozen is not None else None,
                )
            )
        figures = [s.figure for s in await self._history.reported() if FIRST_REPORT_SEASON <= s.figure.year <= year]
        tables = committee_tables(natives, figures)
        documents = {n.year: n.document for n in natives}
        latest = next((d for d in reversed(list(documents.values())) if d is not None), None)

        def label(row_year: int, pool: str | None, kind: str = "pool") -> str:
            if kind == "reconciliation":
                return RECONCILIATION_LABEL
            if kind == "no_pool":
                return NO_POOL_LABEL
            if pool is None:
                return ALL_POOLS_LABEL
            return _pool_label(documents.get(row_year) or latest, pool)

        seasons = sorted(
            {r.year for r in tables.phases}
            | {r.year for r in tables.applications}
            | {r.year for r in tables.budget}
            | {r.year for r in tables.appeals}
            | {r.year for r in tables.round1_pct}
        )
        return CommitteeResponse(
            year=year,
            figures_on=today,
            seasons=seasons,
            phases=[_phase_out(r) for r in tables.phases],
            applications=[_applications_out(r, label(r.year, r.pool, r.kind)) for r in tables.applications],
            budget=[_budget_out(r, label(r.year, r.pool, r.kind)) for r in tables.budget],
            appeals=[_appeals_out(r) for r in tables.appeals],
            round1_pct=[_round1_out(r, label(r.year, r.pool, r.kind)) for r in tables.round1_pct],
            not_built=[NotBuiltOut(figure=k, reason=v) for k, v in NOT_BUILT.items()],
        )

    # --- finance's typed history ------------------------------------------------------------------------------

    async def reported_history(self) -> ReportedHistoryResponse:
        return ReportedHistoryResponse(figures=[_figure_out(s) for s in await self._history.reported()])

    async def load_reported(self, figures: Sequence[ReportedFigure], *, actor: str) -> ReportedLoadOut:
        """Adds each figure, or corrects it where its natural key is stored; unchanged figures are skipped, and a load
        with nothing to write writes nothing (never an empty 4a operation). All or nothing: one bad figure refuses
        the load."""
        found: list[str] = []
        seen: set[tuple[object, ...]] = set()
        for n, figure in enumerate(figures, start=1):
            found.extend(f"figure {n}: {p}" for p in problems(figure))
            if figure.key in seen:
                found.append(f"figure {n}: the same figure twice in one load")
            seen.add(figure.key)
        if found:
            raise ReportsRefusedError("; ".join(found))
        stored = {s.figure.key: s for s in await self._history.reported()}
        writes: list[AidWrite] = []
        created = updated = unchanged = 0
        for figure in figures:
            fields = figure_fields(figure)
            entity = figure_entity(figure)
            before = stored.get(figure.key)
            if before is None:
                writes.append(
                    AidWrite(
                        collection=AID_REPORTED_HISTORY,
                        action="create",
                        year=figure.year,
                        data=fields,
                        entity_id=entity,
                    )
                )
                created += 1
                continue
            changed = {k: v for k, v in fields.items() if v != figure_fields(before.figure)[k]}
            if not changed:
                unchanged += 1
                continue
            writes.append(
                AidWrite(
                    collection=AID_REPORTED_HISTORY,
                    action="update",
                    year=figure.year,
                    record_id=before.id,
                    before=figure_fields(before.figure),
                    data=changed,
                    entity_id=entity,
                )
            )
            updated += 1
        if 2 * len(writes) > MAX_BATCH_REQUESTS:  # each write and its change-log row, in ONE batch
            raise ReportsRefusedError(
                f"{len(writes)} figures to write is more than one logged load holds ({MAX_BATCH_REQUESTS // 2}): "
                "split it into smaller loads"
            )
        if writes:
            await self._history.commit(writes, actor=actor)
        return ReportedLoadOut(created=created, updated=updated, unchanged=unchanged)

    async def delete_reported(self, record_id: str, *, reason: str, actor: str) -> None:
        stored = next((s for s in await self._history.reported() if s.id == record_id), None)
        if stored is None:
            raise ReportedFigureNotFoundError(f"No typed figure {record_id}")
        await self._history.commit(
            [
                AidWrite(
                    collection=AID_REPORTED_HISTORY,
                    action="delete",
                    year=stored.figure.year,
                    record_id=stored.id,
                    before=figure_fields(stored.figure),
                    entity_id=figure_entity(stored.figure),
                )
            ],
            actor=actor,
            reason=reason,
        )


# --- shapes ----------------------------------------------------------------------------------------------------


def rules_sessions(season: Season, document: AidRules | None) -> dict[int, str | None]:
    """Programs' sessions (§9.3: from the rules, never a hand-kept list): every session of the season a rules
    program claims, with its program's pool."""
    if document is None:
        return {}
    out: dict[int, str | None] = {}
    for cm_id, session in season.sessions.items():
        program = resolve_program(document, cm_id, session.session_type)
        if program is not None:
            out[cm_id] = document.programs[program].budget_pool
    return out


def _end_day(session_end: str) -> date | None:
    """camp_sessions.end_date ("YYYY-MM-DD..."), as a day; None when blank or unreadable."""
    try:
        return date.fromisoformat(session_end[:10])
    except ValueError:
        return None


def season_closed(season: Season, document: AidRules | None, today: date) -> bool:
    """Whether the season's money has stopped moving (coordinator ruling 2026-10-02): the LAST AIDED SESSION has ended,
    counting every program open to aid (fall weekends and the winter family session run after summer, and their aid is
    in the season's Posted). It reads the latest end date of the sessions the season's rules map to an `open_to_aid`
    program; the season is closed once `today` is after it. With no such session carrying an end date, the season
    closes with its calendar year (the year before today's)."""
    ends: list[date] = []
    if document is not None:
        for cm_id, session in season.sessions.items():
            program = resolve_program(document, cm_id, session.session_type)
            if program is None or not document.programs[program].open_to_aid:
                continue
            if (end := _end_day(session.end_date)) is not None:
                ends.append(end)
    if ends:
        return today > max(ends)
    return season.year < today.year


def _reason_label(reason: str) -> str:
    if reason == NO_REASON:
        return "no reason recorded"
    if reason == WITHDRAWN_REASON:
        return WITHDRAWN_LABEL
    if reason == DUPLICATE_REASON:
        return DUPLICATE_LABEL
    for key, label in CANCEL_REASON_LABELS.items():
        if key == reason:
            return label
    return reason


def _ids_out(year: int, read: _Read, ids: Sequence[str]) -> ReportRequestIdsOut:
    return ReportRequestIdsOut(
        year=year,
        as_of=read.season.as_of,
        as_of_axis=read.season.axis,
        figures_on=read.figures_on,
        request_set=read.note,
        request_ids=list(ids),
    )


def _statistics_row(row: StatisticsRow) -> StatisticsRowOut:
    return StatisticsRowOut(
        tier=row.tier,
        income_from=_money(row.income_from),
        income_to=_money(row.income_to),
        fee_pct=_pct(row.fee_pct),
        apps=row.apps,
        cancelled=row.cancelled,
        asked=money(row.asked),
        asks=row.asks,
        average_ask=_money(row.average_ask),
        amount=money(row.amount),
        decided=money(row.decided),
        awarded=money(row.awarded),
        awarded_count=row.awarded_count,
        decided_count=row.decided_count,
        average_award=_money(row.average_award),
        live_asked=money(row.live_asked),
        pct_of_ask=_pct(row.pct_of_ask),
        grants=_money(row.grants),
        pct_of_ask_with_grants=_pct(row.pct_of_ask_with_grants),
    )


def _block(block: RoundBlock) -> RoundBlockOut:
    return RoundBlockOut(
        apps=block.apps,
        requested=money(block.requested),
        asks=block.asks,
        awarded=money(block.awarded),
        awarded_count=block.awarded_count,
        average_request=_money(block.average_request),
        average_award=_money(block.average_award),
        pct_awarded=_pct(block.pct_awarded),
    )


def _band(band: Band | None) -> BandOut | None:
    if band is None:
        return None
    return BandOut(
        low_pct=float(band.low_pct),
        high_pct=float(band.high_pct),
        low=_money(band.low),
        high=_money(band.high),
        position=band.position,
    )


def _phase_out(row: PhaseRow) -> PhaseRowOut:
    return PhaseRowOut(
        year=row.year,
        basis=row.basis,
        offered_label=OFFERED_LABEL,
        end_of_season_label=END_OF_SEASON_TO_DATE_LABEL if row.to_date else END_OF_SEASON_LABEL,
        to_date=row.to_date,
        offered=[_money(p) for p in row.offered],
        offered_as_of=list(row.offered_as_of),
        offered_pct_of_budget=[_pct(p) for p in row.offered_pct_of_budget],
        offered_share_of_phases=[_pct(p) for p in row.offered_share_of_phases],
        phases=[_money(p) for p in row.phases],
        phase_as_of=list(row.phase_as_of),
        total=_money(row.total),
        total_as_of=row.total_as_of,
        budget=_money(row.budget),
        pct_of_budget=[_pct(p) for p in row.pct_of_budget],
        total_pct_of_budget=_pct(row.total_pct_of_budget),
        share_of_phases=[_pct(p) for p in row.share_of_phases],
        reconciliation=_money(row.reconciliation),
        variance=_money(row.variance),
        side=row.side,
        bands=[_band(b) for b in row.bands],
        gaps=list(row.gaps),
    )


def _counted(counted: Counted | None) -> CountedOut | None:
    if counted is None:
        return None
    return CountedOut(apps=counted.apps, asked=_money(counted.asked), average=_money(counted.average))


def _applications_out(row: ApplicationsRow, label: str) -> ApplicationsRowOut:
    return ApplicationsRowOut(
        year=row.year,
        basis=row.basis,
        kind=row.kind,
        pool=row.pool,
        pool_label=label,
        cutoff=row.cutoff,
        at_cutoff=_counted(row.at_cutoff),
        since=_counted(row.since),
        season_end=_counted(row.season_end),
        season_end_as_of=row.season_end_as_of,
        change_apps=row.change_apps,
        change_asked=_money(row.change_asked),
        unknown_received=row.unknown_received,
        asks_basis=row.asks_basis,
        asks_reason=row.asks_reason,
    )


def _budget_out(row: BudgetRow, label: str) -> BudgetRowOut:
    return BudgetRowOut(
        year=row.year,
        basis=row.basis,
        kind=row.kind,
        pool=row.pool,
        pool_label=label,
        budget=_money(row.budget),
        awarded=_money(row.awarded),
        variance=_money(row.variance),
        side=row.side,
        pct_of_budget=_pct(row.pct_of_budget),
        pool_share=_pct(row.pool_share),
        rules_split_pct=_pct(row.rules_split_pct),
        note=row.note,
    )


def _appeals_out(row: AppealsRow) -> AppealsRowOut:
    return AppealsRowOut(
        year=row.year, basis=row.basis, applications=row.applications, appeals=row.appeals, rate=_pct(row.rate)
    )


def _round1_out(row: Round1PctRow, label: str) -> Round1PctRowOut:
    return Round1PctRowOut(
        year=row.year,
        basis=row.basis,
        kind=row.kind,
        pool=row.pool,
        pool_label=label,
        awarded=_money(row.awarded),
        asked=_money(row.asked),
        asked_in_budget=_money(row.asked_in_budget),
        pct_of_ask=_pct(row.pct_of_ask),
    )


def _figure_out(stored: StoredFigure) -> ReportedFigureOut:
    f = stored.figure
    return ReportedFigureOut(
        id=stored.id,
        year=f.year,
        view=f.view,
        metric=f.metric,
        pool=f.pool,
        tier=f.tier,
        phase=f.phase,
        at=f.at,
        as_of=f.as_of,
        value=money(f.value),
        source=f.source,
        note=f.note,
    )

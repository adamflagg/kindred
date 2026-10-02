"""The committee's year-over-year tables (clean spec §9.7 RPT-1, RPT-2, RPT-6, RPT-7, RPT-8, RPT-13, RPT-24; D132,
D133). Pure: no I/O.

Each table has one row per season and basis: **P** (computed from the season's own decisions, awarded = Posted on
live requests, D80, D129) where Kindred has them, and **r** (as reported, typed once, `history.py`) where
finance typed them. A season can carry both (2026: typed phases beside the D67 load). Kindred computes every
percentage and every over/under; nothing typed is a percentage except a target band (history.py).

  RPT-1 phases      (1) Round 1 by the deadline, (2) Round 1 rolling after it, (3) appeals (Rounds 2 and 3), then
                    the total, the budget and the over/under. Each phase as % of budget (finance's basis) and as a share
                    of the phases' sum (the decks' pie); "total − Σ phases" shows any gap. The band beside each phase is
                    finance's typed target. P rows leave phases 1 and 2 empty until the owner sets the phase boundary
                    (O-930-10, named in `gaps`); phase 3 and the total don't depend on it.
  RPT-2 / RPT-6     Round 1 applications and asks received by a cutoff date (default: the season's application
                    deadline), "received since", and the season's end, per pool and in total; the change against the
                    season before; for r rows, "headline − Σ pools" where the typed pools don't sum (O-930-14).
  RPT-7 / RPT-24    per pool and in total: budget, awarded, the over/under, % of budget, the pool's share of the
                    season's awarded money, the rules' split as a reference (D119), and finance's note.
  RPT-8             applications (received, cancelled included) and appeals (any Round 2 or later ask), the rate.
  RPT-13            Round 1 awarded ÷ the live requests' Round 1 asks, end of season, per pool and in total. The
                    start-of-season basis is Scenarios › Compare's rules column (RPT-17, SP9c), not repeated here.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.decisions import allocations
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.facts import AsksBasis, ReportRequest, appeals, average
from bunking.financial_aid.reports.history import PHASES, ReportedFigure
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.scenarios.committee import pct

Basis = Literal["P", "r"]
Side = Literal["over", "under", "on"]
PHASE_BOUNDARY_GAP: Final = "phase_boundary"
# What a per-pool row is: a pool's, the season's headline (every pool), the "headline − Σ pools" reconciliation of a
# typed season whose pools don't sum (O-930-14), or the money no pool holds. Rows sort in this order within a season.
RowKind = Literal["pool", "no_pool", "headline", "reconciliation"]
KIND_ORDER: Final[dict[str, int]] = {"pool": 0, "no_pool": 1, "headline": 2, "reconciliation": 3}


@dataclass(frozen=True)
class NativeSeason:
    """A season Kindred priced: its requests as reports read them (facts.py), its rules, the day the figures are
    as of, RPT-2's cutoff (the chosen date, else the rules' application deadline; None: neither) and the
    application deadline itself."""

    year: int
    document: AidRules | None
    requests: tuple[ReportRequest, ...]
    as_of: date
    cutoff: date | None
    cutoff_instant: datetime | None  # the first instant after the cutoff day ends, camp time
    deadline_instant: datetime | None = None  # the same for the rules' application deadline (RPT-1's phases)
    # D155 (A6b): the requests received by the cutoff, each with its Round 1 ask as it stood that day, and the basis
    # those asks are on. None: no cutoff, or a caller that doesn't freeze (the at-cutoff figure then reads `requests`).
    # OWNER ITEM 49 NOT RULED: only Round 1 asks freeze; Round 2 and 3 asks (appeals) read as they stand now.
    cutoff_requests: tuple[ReportRequest, ...] | None = None
    asks_basis: AsksBasis | None = None
    asks_reason: str | None = None


@dataclass(frozen=True)
class Band:
    low_pct: Decimal
    high_pct: Decimal
    low: Decimal | None  # dollars: low % × budget
    high: Decimal | None
    position: Literal["below", "within", "above"] | None  # the phase's % of budget against the band


@dataclass(frozen=True)
class PhaseRow:
    year: int
    basis: Basis
    phases: tuple[Decimal | None, ...]  # by the deadline, rolling, appeals
    phase_as_of: tuple[date | None, ...]
    total: Decimal | None
    total_as_of: date | None
    budget: Decimal | None
    pct_of_budget: tuple[Decimal | None, ...]
    total_pct_of_budget: Decimal | None
    share_of_phases: tuple[Decimal | None, ...]
    reconciliation: Decimal | None  # total − Σ phases
    variance: Decimal | None  # total − budget
    side: Side | None
    bands: tuple[Band | None, ...]
    gaps: tuple[str, ...]


@dataclass(frozen=True)
class Counted:
    apps: int | None
    asked: Decimal | None
    average: Decimal | None


@dataclass(frozen=True)
class ApplicationsRow:
    year: int
    basis: Basis
    pool: str | None  # None: every pool (the headline)
    cutoff: date | None
    at_cutoff: Counted | None
    since: Counted | None
    season_end: Counted | None
    season_end_as_of: date | None
    change_apps: int | None  # season end against the season before's, same pool
    change_asked: Decimal | None
    unknown_received: int  # P rows: requests with no recorded received date, in the season end only
    kind: RowKind = "pool"
    asks_basis: AsksBasis | None = None  # a P row with a cutoff: its at-cutoff asks' basis (D155); None otherwise
    asks_reason: str | None = None  # why the asks are "now", when they are


@dataclass(frozen=True)
class BudgetRow:
    year: int
    basis: Basis
    pool: str | None  # None: the total
    budget: Decimal | None
    awarded: Decimal | None
    variance: Decimal | None
    side: Side | None
    pct_of_budget: Decimal | None
    pool_share: Decimal | None  # the pool's share of the season's awarded money
    rules_split_pct: Decimal | None  # the rules' pool split, a reference only (D119)
    note: str
    kind: RowKind = "pool"


@dataclass(frozen=True)
class AppealsRow:
    year: int
    basis: Basis
    applications: int | None
    appeals: int | None
    rate: Decimal | None


@dataclass(frozen=True)
class Round1PctRow:
    year: int
    basis: Basis
    pool: str | None
    awarded: Decimal | None
    asked: Decimal | None
    pct_of_ask: Decimal | None
    kind: RowKind = "pool"


@dataclass(frozen=True)
class CommitteeTables:
    phases: tuple[PhaseRow, ...]
    applications: tuple[ApplicationsRow, ...]
    budget: tuple[BudgetRow, ...]
    appeals: tuple[AppealsRow, ...]
    round1_pct: tuple[Round1PctRow, ...]


# --- shared -----------------------------------------------------------------------------------------------------


def _side(variance: Decimal | None) -> Side | None:
    if variance is None:
        return None
    return "over" if variance > 0 else "under" if variance < 0 else "on"


def _sum(values: Iterable[Decimal | None]) -> Decimal | None:
    known = list(values)
    return None if any(v is None for v in known) else sum((v for v in known if v is not None), ZERO)


class _Typed:
    """A season's typed figures, looked up by metric and dimensions (season_end unless asked)."""

    def __init__(self, figures: Iterable[ReportedFigure]) -> None:
        self._by: dict[tuple[str, str, int, int, str], list[ReportedFigure]] = defaultdict(list)
        for figure in figures:
            self._by[(figure.metric, figure.pool, figure.tier, figure.phase, figure.at)].append(figure)

    def get(self, metric: str, *, pool: str = "", tier: int = 0, phase: int = 0) -> ReportedFigure | None:
        found = self._by.get((metric, pool, tier, phase, "season_end"), [])
        return max(found, key=lambda f: f.as_of) if found else None

    def pulls(self, metric: str, *, pool: str = "") -> list[ReportedFigure]:
        return sorted(self._by.get((metric, pool, 0, 0, "pull"), []), key=lambda f: f.as_of)

    def pools(self, metric: str, at: str = "season_end") -> set[str]:
        return {pool for (m, pool, tier, phase, a) in self._by if m == metric and a == at and pool and not tier}

    def value(self, metric: str, *, pool: str = "", tier: int = 0, phase: int = 0) -> Decimal | None:
        figure = self.get(metric, pool=pool, tier=tier, phase=phase)
        return figure.value if figure is not None else None


def _by_year(figures: Iterable[ReportedFigure]) -> dict[int, _Typed]:
    grouped: dict[int, list[ReportedFigure]] = defaultdict(list)
    for figure in figures:
        if figure.view == "finance":
            grouped[figure.year].append(figure)
    return {year: _Typed(rows) for year, rows in grouped.items()}


def _order[R: (PhaseRow, ApplicationsRow, BudgetRow, AppealsRow, Round1PctRow)](rows: Iterable[R]) -> tuple[R, ...]:
    def key(row: R) -> tuple[int, int, str, int, str]:
        pool = getattr(row, "pool", None)
        cutoff = getattr(row, "cutoff", None)
        return (
            row.year,
            0 if row.basis == "r" else 1,
            cutoff.isoformat() if cutoff else "",
            KIND_ORDER[getattr(row, "kind", "pool")],
            pool or "",
        )

    return tuple(sorted(rows, key=key))


# --- RPT-1 ------------------------------------------------------------------------------------------------------


def _bands(typed: _Typed | None, budget: Decimal | None, pcts: Sequence[Decimal | None]) -> tuple[Band | None, ...]:
    out: list[Band | None] = []
    for phase, actual in zip(PHASES, pcts, strict=True):
        low = typed.value("phase_band_low", phase=phase) if typed is not None else None
        high = typed.value("phase_band_high", phase=phase) if typed is not None else None
        if low is None or high is None:
            out.append(None)
            continue
        position: Literal["below", "within", "above"] | None = None
        if actual is not None:
            position = "below" if actual < low else "above" if actual > high else "within"
        out.append(
            Band(
                low_pct=low,
                high_pct=high,
                low=(low * budget / 100).quantize(Decimal("0.01")) if budget is not None else None,
                high=(high * budget / 100).quantize(Decimal("0.01")) if budget is not None else None,
                position=position,
            )
        )
    return tuple(out)


def _phase_row(
    year: int,
    basis: Basis,
    phases: tuple[Decimal | None, ...],
    phase_as_of: tuple[date | None, ...],
    total: Decimal | None,
    total_as_of: date | None,
    budget: Decimal | None,
    typed: _Typed | None,
    gaps: tuple[str, ...] = (),
) -> PhaseRow:
    summed = _sum(phases)
    pcts = tuple(pct(p, budget) if p is not None else None for p in phases)
    variance = total - budget if total is not None and budget is not None else None
    return PhaseRow(
        year=year,
        basis=basis,
        phases=phases,
        phase_as_of=phase_as_of,
        total=total,
        total_as_of=total_as_of,
        budget=budget,
        pct_of_budget=pcts,
        total_pct_of_budget=pct(total, budget) if total is not None else None,
        share_of_phases=tuple(pct(p, summed) if p is not None and summed is not None else None for p in phases),
        reconciliation=total - summed if total is not None and summed is not None else None,
        variance=variance,
        side=_side(variance),
        bands=_bands(typed, budget, pcts),
        gaps=gaps,
    )


def native_phases(season: NativeSeason, typed: _Typed | None) -> PhaseRow:
    appeals_money = sum((r.awarded((2, 3)) for r in season.requests), ZERO)
    total = sum((r.awarded() for r in season.requests), ZERO)
    budget = season.document.budget.total if season.document is not None else None
    return _phase_row(
        season.year,
        "P",
        (None, None, appeals_money),
        (None, None, season.as_of),
        total,
        season.as_of,
        budget,
        typed,
        gaps=(PHASE_BOUNDARY_GAP,),
    )


def typed_phases(year: int, typed: _Typed) -> PhaseRow | None:
    figures = [typed.get("phase_awarded", phase=p) for p in PHASES]
    total = typed.get("awarded")
    budget = typed.value("budget")
    if all(f is None for f in figures) and total is None:
        return None
    return _phase_row(
        year,
        "r",
        tuple(f.value if f is not None else None for f in figures),
        tuple(f.as_of if f is not None else None for f in figures),
        total.value if total is not None else None,
        total.as_of if total is not None else None,
        budget,
        typed,
    )


# --- RPT-2 / RPT-6 ----------------------------------------------------------------------------------------------


def _counted(requests: Sequence[ReportRequest]) -> Counted:
    asks = [a for r in requests if (a := r.asked((1,))) is not None]
    asked = sum(asks, ZERO)
    return Counted(len(requests), asked, average(asked, len(asks)))


def native_applications(season: NativeSeason) -> list[ApplicationsRow]:
    pools: dict[str | None, list[ReportRequest]] = defaultdict(list)
    for request in season.requests:
        pools[request.pool].append(request)
    out: list[ApplicationsRow] = []
    # (pool, members, kind): the named pools, a no-pool row where a request has none (the budget table's way, so the
    # rows sum to the headline), then the headline.
    groups: list[tuple[str | None, list[ReportRequest], RowKind]] = [
        *(
            (p, m, "pool")
            for p, m in sorted(((p, m) for p, m in pools.items() if p is not None), key=lambda pm: pm[0] or "")
        ),
    ]
    if None in pools:
        groups.append((None, pools[None], "no_pool"))
    groups.append((None, list(season.requests), "headline"))
    for pool, members, kind in groups:
        cut = season.cutoff_instant
        frozen = {r.request_id: r for r in season.cutoff_requests or ()}
        before = [
            frozen.get(r.request_id, r)
            for r in members
            if cut is not None and r.received_at is not None and r.received_at < cut
        ]
        after = [r for r in members if cut is not None and r.received_at is not None and r.received_at >= cut]
        out.append(
            ApplicationsRow(
                year=season.year,
                basis="P",
                pool=pool,
                cutoff=season.cutoff,
                at_cutoff=_counted(before) if cut is not None else None,
                since=_counted(after) if cut is not None else None,
                season_end=_counted(members),
                season_end_as_of=season.as_of,
                change_apps=None,
                change_asked=None,
                unknown_received=sum(1 for r in members if r.received_at is None),
                kind=kind,
                asks_basis=season.asks_basis if cut is not None else None,
                asks_reason=season.asks_reason if cut is not None else None,
            )
        )
    return out


def typed_applications(year: int, typed: _Typed) -> list[ApplicationsRow]:
    """One row per pool (and the headline) per pull date; a season with only season-end figures has one row with no
    cutoff. A reconciliation row ("headline − Σ pools") appears where the typed pools don't sum."""
    pulls = sorted({f.as_of for f in typed.pulls("r1_apps")} | {f.as_of for f in typed.pulls("r1_asked")})
    pools = sorted(
        typed.pools("r1_apps")
        | typed.pools("r1_asked")
        | typed.pools("r1_apps", "pull")
        | typed.pools("r1_asked", "pull")
    )
    out: list[ApplicationsRow] = []
    cutoffs: list[date | None] = [*pulls] or [None]
    for cutoff in cutoffs:
        for pool in [*pools, None]:
            key = pool or ""
            apps_pull = next((f for f in typed.pulls("r1_apps", pool=key) if f.as_of == cutoff), None)
            asked_pull = next((f for f in typed.pulls("r1_asked", pool=key) if f.as_of == cutoff), None)
            end_apps = typed.get("r1_apps", pool=key)
            end_asked = typed.get("r1_asked", pool=key)
            if apps_pull is None and asked_pull is None and end_apps is None and end_asked is None:
                continue
            at_cutoff = _typed_counted(apps_pull, asked_pull) if cutoff is not None else None
            season_end = _typed_counted(end_apps, end_asked)
            out.append(
                ApplicationsRow(
                    year=year,
                    basis="r",
                    pool=pool,
                    cutoff=cutoff,
                    at_cutoff=at_cutoff,
                    since=_since(at_cutoff, season_end),
                    season_end=season_end,
                    season_end_as_of=max((f.as_of for f in (end_apps, end_asked) if f is not None), default=None),
                    change_apps=None,
                    change_asked=None,
                    unknown_received=0,
                    kind="headline" if pool is None else "pool",
                )
            )
    return out


def _typed_counted(apps: ReportedFigure | None, asked: ReportedFigure | None) -> Counted | None:
    if apps is None and asked is None:
        return None
    count = int(apps.value) if apps is not None else None
    dollars = asked.value if asked is not None else None
    return Counted(count, dollars, average(dollars, count) if dollars is not None and count else None)


def _since(at: Counted | None, end: Counted | None) -> Counted | None:
    if at is None or end is None:
        return None
    apps = end.apps - at.apps if end.apps is not None and at.apps is not None else None
    asked = end.asked - at.asked if end.asked is not None and at.asked is not None else None
    return Counted(apps, asked, None)


def _gap(headline: ApplicationsRow, pools: Sequence[ApplicationsRow], pick: str) -> Counted | None:
    whole: Counted | None = getattr(headline, pick)
    parts: list[Counted | None] = [getattr(r, pick) for r in pools]
    if whole is None or any(p is None for p in parts):
        return None
    known = [p for p in parts if p is not None]
    apps = (
        whole.apps - sum(p.apps for p in known if p.apps is not None)
        if whole.apps is not None and all(p.apps is not None for p in known)
        else None
    )
    asked = (
        whole.asked - sum((p.asked for p in known if p.asked is not None), ZERO)
        if whole.asked is not None and all(p.asked is not None for p in known)
        else None
    )
    return Counted(apps, asked, None)


def reconciliation(rows: Sequence[ApplicationsRow]) -> list[ApplicationsRow]:
    """For r rows: "headline − Σ pools" at each point, where the typed pools exist (O-930-14's gaps). A P season
    always sums, by construction, so it gets none."""
    out: list[ApplicationsRow] = []
    groups: dict[tuple[int, date | None], list[ApplicationsRow]] = defaultdict(list)
    for row in rows:
        if row.basis == "r":
            groups[(row.year, row.cutoff)].append(row)
    for (year, cutoff), members in groups.items():
        headline = next((r for r in members if r.kind == "headline"), None)
        pools = [r for r in members if r.kind == "pool"]
        if headline is None or not pools:
            continue

        out.append(
            ApplicationsRow(
                year=year,
                basis="r",
                pool=None,
                cutoff=cutoff,
                at_cutoff=_gap(headline, pools, "at_cutoff"),
                since=None,
                season_end=_gap(headline, pools, "season_end"),
                season_end_as_of=headline.season_end_as_of,
                change_apps=None,
                change_asked=None,
                unknown_received=0,
                kind="reconciliation",
            )
        )
    return out


def with_changes(rows: Sequence[ApplicationsRow]) -> list[ApplicationsRow]:
    """Each row's season end against the season before's, same pool: the P row when there is one, else the r row
    with the latest cutoff."""
    best: dict[tuple[int, str, str | None], ApplicationsRow] = {}
    for row in sorted(rows, key=lambda r: (r.basis == "P", r.cutoff or date.min)):
        if row.kind != "reconciliation" and row.season_end is not None:
            best[(row.year, row.kind, row.pool)] = row
    out: list[ApplicationsRow] = []
    for row in rows:
        before = best.get((row.year - 1, row.kind, row.pool))
        end = row.season_end
        prior = before.season_end if before is not None else None
        if end is None or prior is None or row.kind == "reconciliation":
            out.append(row)
            continue
        out.append(
            replace(
                row,
                change_apps=end.apps - prior.apps if end.apps is not None and prior.apps is not None else None,
                change_asked=end.asked - prior.asked if end.asked is not None and prior.asked is not None else None,
            )
        )
    return out


# --- RPT-7 / RPT-24 ---------------------------------------------------------------------------------------------


def _split_pct(document: AidRules | None, pool: str) -> Decimal | None:
    if document is None or pool not in document.budget.pools:
        return None
    share = document.budget.pools[pool]
    if share.share_pct is not None:
        return share.share_pct
    return pct(share.amount, document.budget.total) if share.amount is not None else None


def native_budget(season: NativeSeason, typed: _Typed | None) -> list[BudgetRow]:
    document = season.document
    allocated = allocations(document) if document is not None else {}
    awarded: dict[str | None, Decimal] = defaultdict(lambda: ZERO)
    for request in season.requests:
        if not request.live:
            continue
        for facts in request.rounds:
            if facts.posted is not None:
                awarded[facts.pool] += facts.posted
    total_awarded = sum(awarded.values(), ZERO)
    pools = sorted(set(allocated) | {p for p in awarded if p is not None})
    rows: list[BudgetRow] = []
    for pool in [*pools, *([None] if None in awarded else [])]:
        budget = sum(allocated[pool].values(), ZERO) if pool is not None and pool in allocated else None
        rows.append(
            _budget_row(
                season.year,
                "P",
                pool or "",
                budget,
                awarded.get(pool, ZERO),
                total_awarded,
                document,
                typed,
                no_pool=pool is None,
            )
        )
    total_budget = document.budget.total if document is not None else None
    rows.append(_budget_row(season.year, "P", None, total_budget, total_awarded, total_awarded, document, typed))
    return rows


def _budget_row(
    year: int,
    basis: Basis,
    pool: str | None,
    budget: Decimal | None,
    awarded: Decimal | None,
    total_awarded: Decimal | None,
    document: AidRules | None,
    typed: _Typed | None,
    *,
    no_pool: bool = False,
) -> BudgetRow:
    variance = awarded - budget if awarded is not None and budget is not None else None
    note = ""
    if typed is not None and not no_pool:
        figure = typed.get("budget", pool=pool or "")
        note = figure.note if figure is not None else ""
    return BudgetRow(
        year=year,
        basis=basis,
        pool=None if no_pool else pool,
        budget=budget,
        awarded=awarded,
        variance=variance,
        side=_side(variance),
        pct_of_budget=pct(awarded, budget) if awarded is not None else None,
        pool_share=pct(awarded, total_awarded) if pool is not None and awarded is not None else None,
        rules_split_pct=_split_pct(document, pool) if pool else None,
        note=note,
        kind="no_pool" if no_pool else "headline" if pool is None else "pool",
    )


def typed_budget(year: int, typed: _Typed) -> list[BudgetRow]:
    pools = sorted(typed.pools("budget") | typed.pools("awarded"))
    total_awarded = typed.value("awarded")
    rows = [
        _budget_row(
            year,
            "r",
            pool,
            typed.value("budget", pool=pool),
            typed.value("awarded", pool=pool),
            total_awarded,
            None,
            typed,
        )
        for pool in pools
    ]
    if typed.get("budget") is not None or total_awarded is not None:
        rows.append(_budget_row(year, "r", None, typed.value("budget"), total_awarded, total_awarded, None, typed))
    return rows


# --- RPT-8 and RPT-13 -------------------------------------------------------------------------------------------


def native_appeals(season: NativeSeason) -> AppealsRow:
    applications = len(season.requests)
    appealed = len(appeals(season.requests))
    return AppealsRow(season.year, "P", applications, appealed, pct(Decimal(appealed), Decimal(applications)))


def typed_appeals(year: int, typed: _Typed) -> AppealsRow | None:
    applications = typed.value("r1_apps")
    appealed = typed.value("appeals")
    if applications is None and appealed is None:
        return None
    rate = pct(appealed, applications) if appealed is not None and applications is not None else None
    return AppealsRow(
        year,
        "r",
        int(applications) if applications is not None else None,
        int(appealed) if appealed is not None else None,
        rate,
    )


def native_round1_pct(season: NativeSeason) -> list[Round1PctRow]:
    pools: dict[str | None, list[ReportRequest]] = defaultdict(list)
    for request in season.requests:
        if request.live:
            pools[request.pool].append(request)
    every = [r for r in season.requests if r.live]

    def row(pool: str | None, members: Sequence[ReportRequest], kind: RowKind) -> Round1PctRow:
        awarded = sum((r.awarded((1,)) for r in members), ZERO)
        asked = sum((a for r in members if (a := r.asked((1,))) is not None), ZERO)
        return Round1PctRow(season.year, "P", pool, awarded, asked, pct(awarded, asked), kind)

    named = sorted(p for p in pools if p is not None)
    # A no-pool row where a live request has none, so the pool rows sum to the headline (as the budget table does).
    no_pool = [row(None, pools[None], "no_pool")] if None in pools else []
    return [*(row(p, pools[p], "pool") for p in named), *no_pool, row(None, every, "headline")]


def typed_round1_pct(year: int, typed: _Typed) -> list[Round1PctRow]:
    pools = sorted(typed.pools("r1_awarded"))
    out: list[Round1PctRow] = []
    for pool in [*pools, None]:
        awarded = typed.value("r1_awarded", pool=pool or "")
        asked = typed.value("r1_asked", pool=pool or "")
        if awarded is None:
            continue
        out.append(
            Round1PctRow(
                year,
                "r",
                pool,
                awarded,
                asked,
                pct(awarded, asked) if asked is not None else None,
                "headline" if pool is None else "pool",
            )
        )
    return out


# --- every table -------------------------------------------------------------------------------------------------


def committee_tables(natives: Sequence[NativeSeason], figures: Iterable[ReportedFigure]) -> CommitteeTables:
    typed = _by_year(figures)
    phases: list[PhaseRow] = []
    applications: list[ApplicationsRow] = []
    budget: list[BudgetRow] = []
    appeal_rows: list[AppealsRow] = []
    round1: list[Round1PctRow] = []
    for season in natives:
        mine = typed.get(season.year)
        phases.append(native_phases(season, mine))
        applications.extend(native_applications(season))
        budget.extend(native_budget(season, mine))
        appeal_rows.append(native_appeals(season))
        round1.extend(native_round1_pct(season))
    for year, mine in typed.items():
        if (row := typed_phases(year, mine)) is not None:
            phases.append(row)
        applications.extend(typed_applications(year, mine))
        budget.extend(typed_budget(year, mine))
        if (appealed := typed_appeals(year, mine)) is not None:
            appeal_rows.append(appealed)
        round1.extend(typed_round1_pct(year, mine))
    applications = with_changes([*applications, *reconciliation(applications)])
    return CommitteeTables(
        phases=_order(phases),
        applications=_order(applications),
        budget=_order(budget),
        appeals=_order(appeal_rows),
        round1_pct=_order(round1),
    )

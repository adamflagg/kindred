"""What the committee compares (sub-project 9c; spec §7.4, §9.7 RPT-17, RPT-18, RPT-32; D132). Pure: no I/O.

  Round 1 by tier (RPT-17)   per award table and final tier, then All: requests, families, the tier's Round 1
                             ask and its average, the fee % (the table's Round 1 % for the tier, read from the
                             document, never computed), % of ask (Round 1 ÷ ask), and the average Round 1 (Round 1 ÷
                             requests: the requests the row counts, D80's population); and the tier's held requests,
                             counted apart (a check's hold has a tier, but no Round 1). A counted request with no ask
                             is counted apart too (`no_ask`): in the requests and Round 1, out of the ask-based
                             figures (average ask, % of ask), which stay like for like.
  Round 2 by tier (RPT-32)   per ROUND 2 table and final tier, then All: appeals and their asks (held ones
                             included), the Round 2 max % (the table's total %, a rules value), Round 2 dollars, their
                             average (÷ the appeals priced) and % of ask (÷ those appeals' asks, `priced_asked`). Split
                             by the Round 2 table, not the award table: the max % is that table's cell, and a program's
                             Round 2 table is its own lever (round2.program_tables).
  Not in tiers               Round 1 and Round 2 money the rows don't hold (a withdrawn request's posted round, a
                             request with no tier): rows plus it are the column's Round 1 and Round 2.
  Share of the budget        Round 1 ÷ the document's total budget (RPT-17's headline; RPT-18's "Y%").
  Last season, posted        the prior season's posted money at each lock, by the tier and program recorded at the
                             lock (RPT-17's last-season column, RPT-32's last-season Round 2), under the option
                             columns' rule: rows hold live requests; a withdrawn request's posted money is
                             `not_in_tiers`. Only posted money counts: a season with no posted Round 1 is not loaded,
                             never estimated (D67). `as_of` is its newest lock.
  Last season's rules        this season's rules with last season's criteria copied in (RPT-18): income, tiers, equity,
                             award tables, and the Round 2 and Round 3 policy settings, never their routing.

Every % is Kindred's (§9.7), to one decimal place; an average is to the cent. A row whose denominator is 0 has no
%, never 0%. All's fee % and Round 2 max % are None: each table has its own.

The committee's target band (RPT-1) is not here: where Reports stores it is open (O-930-13), so the band column is a
follow-up.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final, Protocol

from bunking.financial_aid.decisions import PricedRequest, RoundState, RoundView
from bunking.financial_aid.money import HUNDRED, ZERO
from bunking.financial_aid.rules import AidRules, SectionName
from bunking.financial_aid.rules.lookup import resolved_table
from bunking.financial_aid.scenarios.results import (
    AppealTally,
    Round2TierRow,
    TableTierRow,
    TierRow,
    TierTally,
    appeal_ask,
    round1_table,
    round2_rows,
    round2_table,
    table_rows,
    tier_rows,
)

_CENT: Final = Decimal("0.01")
_TENTH: Final = Decimal("0.1")

# RPT-18's "criteria" (Ruling 2026-09-30, plan review): who gets what. Copied whole from last season:
CRITERIA_SECTIONS: Final[tuple[SectionName, ...]] = ("income", "tiers", "equity", "award_tables", "round3")
# Copied from last season but for one key, which stays this season's: Round 2's policy settings without its routing
# (program -> Round 2 table), and the award settings without the decision types (finance's budget lines, which this
# season's stages point to).
CRITERIA_BUT: Final[Mapping[SectionName, str]] = {"round2": "program_tables", "awards": "decision_types"}
# Everything else stays this season's: programs (and so each program's award table), cost, budget, stages, quality
# checks, milestones, and grants whole (D140's minimum cap applies from 2027 on; the offset programs are routing).


def pct(part: Decimal, whole: Decimal | None) -> Decimal | None:
    """part as a % of whole, to one decimal place; None when there is nothing to divide by."""
    if whole is None or whole == 0:
        return None
    return (part * HUNDRED / whole).quantize(_TENTH, rounding=ROUND_HALF_UP)


def _average(total: Decimal, count: int) -> Decimal | None:
    return (total / count).quantize(_CENT, rounding=ROUND_HALF_UP) if count else None


def fee_pct(document: AidRules | None, table: str | None, tier: int) -> Decimal | None:
    """The award table's Round 1 % for a tier, inheritance applied; None for All, no table, or a tier it lacks."""
    if document is None or not table:
        return None
    try:
        cell = resolved_table(document.award_tables, table).get(tier)
    except KeyError, ValueError:
        return None
    return cell.r1_pct if cell is not None else None


def round2_max_pct(document: AidRules | None, table: str | None, tier: int) -> Decimal | None:
    """The Round 2 table's appeal cap (total %) for a tier; None for All, no table, or a tier it lacks."""
    if document is None or not table:
        return None
    try:
        cell = resolved_table(document.round2.tables, table).get(tier)
    except KeyError, ValueError:
        return None
    return cell.total_pct if cell is not None else None


@dataclass(frozen=True)
class TierCompareRow:
    table: str | None  # None: All, every award table together
    tier: int
    requests: int
    families: int
    asked: Decimal
    average_ask: Decimal | None
    fee_pct: Decimal | None
    pct_of_ask: Decimal | None
    round1: Decimal
    average_round1: Decimal | None
    held: int  # the tier's live requests whose Round 1 is held: in none of the figures above
    # Counted requests with no Round 1 ask: in `requests` and `round1` (so the average Round 1), but out of the
    # ask-based figures (`asked`, `average_ask`, `pct_of_ask`), which stay like for like.
    no_ask: int = 0


@dataclass(frozen=True)
class Round2CompareRow:
    table: str | None  # None: All, every Round 2 table together
    tier: int
    appeals: int
    asked: Decimal
    max_pct: Decimal | None
    priced: int
    priced_asked: Decimal  # the priced appeals' asks: what pct_of_ask divides by
    round2: Decimal
    average_round2: Decimal | None
    pct_of_ask: Decimal | None


@dataclass(frozen=True)
class CommitteeView:
    budget_total: Decimal | None  # the document's total budget; None when there is no document (no rules)
    round1: Decimal
    round1_pct_of_budget: Decimal | None
    round2: Decimal
    round1_by_tier: tuple[TierCompareRow, ...]  # each table's tiers (by table), then All's
    round2_by_tier: tuple[Round2CompareRow, ...]
    not_in_tiers: Decimal  # Round 1 no row holds: rows (All) + this = round1
    round2_not_in_tiers: Decimal  # Round 2 no row holds: rows (All) + this = round2


class Figures(Protocol):
    """What a committee view reads: a scenario's results, or last season's posted money."""

    @property
    def round1(self) -> Decimal: ...
    @property
    def round2(self) -> Decimal: ...
    @property
    def by_tier(self) -> Sequence[TierRow]: ...
    @property
    def by_table(self) -> Sequence[TableTierRow]: ...
    @property
    def round2_by_tier(self) -> Sequence[Round2TierRow]: ...
    @property
    def not_in_tiers(self) -> Decimal: ...
    @property
    def round2_not_in_tiers(self) -> Decimal: ...


def _round1_row(table: str | None, row: TierRow | TableTierRow, document: AidRules | None) -> TierCompareRow:
    asked = row.asked or ZERO
    return TierCompareRow(
        table=table,
        tier=row.tier,
        requests=row.requests,
        families=row.families,
        asked=asked,
        average_ask=_average(asked, row.requests - row.no_ask),
        fee_pct=fee_pct(document, table, row.tier),
        pct_of_ask=pct(row.round1 - row.no_ask_round1, asked),
        round1=row.round1,
        average_round1=_average(row.round1, row.requests),
        held=row.held,
        no_ask=row.no_ask,
    )


def tier_compare(
    by_tier: Sequence[TierRow], by_table: Sequence[TableTierRow], document: AidRules | None
) -> tuple[TierCompareRow, ...]:
    """RPT-17's rows: each award table's tiers in table order, then All (`by_tier`)."""
    per_table = [_round1_row(row.table, row, document) for row in sorted(by_table, key=lambda r: (r.table, r.tier))]
    return (*per_table, *(_round1_row(None, row, document) for row in by_tier))


def _round2_row(table: str | None, row: Round2TierRow, document: AidRules | None) -> Round2CompareRow:
    return Round2CompareRow(
        table=table,
        tier=row.tier,
        appeals=row.appeals,
        asked=row.asked,
        max_pct=round2_max_pct(document, table, row.tier),
        priced=row.priced,
        priced_asked=row.priced_asked,
        round2=row.round2,
        average_round2=_average(row.round2, row.priced),
        pct_of_ask=pct(row.round2, row.priced_asked),
    )


def round2_compare(rows: Sequence[Round2TierRow], document: AidRules | None) -> tuple[Round2CompareRow, ...]:
    """RPT-32's rows: each Round 2 table's tiers, then All (every table's rows summed per tier; a request is in one
    table, so the sums are exact)."""
    per_table = [_round2_row(row.table, row, document) for row in sorted(rows, key=lambda r: (r.table, r.tier))]
    summed: dict[int, Round2TierRow] = {}
    for row in rows:
        before = summed.get(row.tier)
        summed[row.tier] = (
            row.model_copy(update={"table": ""})
            if before is None
            else before.model_copy(
                update={
                    "appeals": before.appeals + row.appeals,
                    "asked": before.asked + row.asked,
                    "priced": before.priced + row.priced,
                    "priced_asked": before.priced_asked + row.priced_asked,
                    "round2": before.round2 + row.round2,
                }
            )
        )
    return (*per_table, *(_round2_row(None, summed[tier], document) for tier in sorted(summed)))


def committee_view(figures: Figures, document: AidRules | None) -> CommitteeView:
    total = document.budget.total if document is not None else None
    return CommitteeView(
        budget_total=total,
        round1=figures.round1,
        round1_pct_of_budget=pct(figures.round1, total),
        round2=figures.round2,
        round1_by_tier=tier_compare(figures.by_tier, figures.by_table, document),
        round2_by_tier=round2_compare(figures.round2_by_tier, document),
        not_in_tiers=figures.not_in_tiers,
        round2_not_in_tiers=figures.round2_not_in_tiers,
    )


# --- last season, posted (RPT-17's and RPT-32's last-season columns) --------------------------------------------


@dataclass(frozen=True)
class PostedSeason:
    """A season's posted money by tier: every round posted, counted toward the budget and not clawed back, at its
    lock. `round1` and `round2` are all of it; the rows hold live requests with a tier, and the rest is
    `not_in_tiers` / `round2_not_in_tiers`, as in a scenario's results. `as_of` is the newest lock."""

    round1: Decimal
    round2: Decimal
    by_tier: tuple[TierRow, ...]
    by_table: tuple[TableTierRow, ...]
    round2_by_tier: tuple[Round2TierRow, ...]
    not_in_tiers: Decimal
    round2_not_in_tiers: Decimal
    as_of: datetime | None

    @property
    def loaded(self) -> bool:
        """Whether the season has any posted Round 1: 2026 has none until its decisions load (D67)."""
        return self.round1 != 0 or bool(self.by_tier)


def _posted(view: RoundView | None) -> Decimal | None:
    if view is None or view.status != "posted" or not view.counts_toward_budget or view.clawed_back:
        return None
    return view.locked or ZERO


def _at_lock(state: RoundState | None, key: str) -> Any:
    """A value the lock recorded (its snapshot): the receipt as it was when posted (D43)."""
    snapshot = state.snapshot if state is not None and state.snapshot is not None else {}
    if key == "final_tier":
        result = snapshot.get("result")
        return result.get("final_tier") if isinstance(result, Mapping) else None
    return snapshot.get(key)


def _tier(p: PricedRequest, *states: RoundState | None) -> int | None:
    """A live request's tier as the first of `states` recorded it at its lock, else its own now; None for a request
    that is not live (its money is not_in_tiers, as in a scenario's results)."""
    if not p.live:
        return None
    for state in states:
        recorded = _at_lock(state, "final_tier")
        if isinstance(recorded, int):
            return recorded
    return p.result.final_tier if p.result is not None else None


def posted_season(
    priced: Iterable[PricedRequest], rounds: Mapping[str, Mapping[int, RoundState]], document: AidRules | None
) -> PostedSeason:
    """Posted money by tier. A round's tier and program are those its lock recorded, else the request's own now;
    its table is that program's under `document` (the rules that priced the season). Appeals are live requests
    with a Round 2 ask not clawed back (the budget's rule); only a posted Round 2 is money here."""
    tiers: dict[int, TierTally] = defaultdict(TierTally)
    tables: dict[tuple[str, int], TierTally] = defaultdict(TierTally)
    appeals: dict[tuple[str, int], AppealTally] = defaultdict(AppealTally)
    round1 = round2 = not_in_tiers = round2_not_in_tiers = ZERO
    locks: list[datetime] = []
    for p in priced:
        states = rounds.get(p.request_id, {})
        view1 = p.view(1)
        amount = _posted(view1)
        if view1 is not None and amount is not None:
            round1 += amount
            if (locked_at := states[1].locked_at if 1 in states else None) is not None:
                locks.append(locked_at)
            tier = _tier(p, states.get(1))
            if tier is None:
                not_in_tiers += amount
            else:
                program = _at_lock(states.get(1), "program_key") or p.program_key
                tiers[tier].add(p, amount, view1.ask)
                table = round1_table(document, program) if document is not None else ""
                tables[(table, tier)].add(p, amount, view1.ask)
        view2 = p.view(2)
        money2 = _posted(view2)
        if money2 is not None:
            round2 += money2
            if (locked_at := states[2].locked_at if 2 in states else None) is not None:
                locks.append(locked_at)
        tier2 = _tier(p, states.get(2), states.get(1))
        asked2 = appeal_ask(view2)
        if tier2 is not None and asked2 is not None:
            program2 = _at_lock(states.get(2), "program_key") or p.program_key
            table2 = round2_table(document, program2) if document is not None else ""
            appeals[(table2, tier2)].add(p, asked2, money2)
        elif money2 is not None:
            round2_not_in_tiers += money2
    return PostedSeason(
        round1=round1,
        round2=round2,
        by_tier=tuple(tier_rows(tiers)),
        by_table=tuple(table_rows(tables)),
        round2_by_tier=tuple(round2_rows(appeals)),
        not_in_tiers=not_in_tiers,
        round2_not_in_tiers=round2_not_in_tiers,
        as_of=max(locks, default=None),
    )


# --- last season's rules on this season's applications (RPT-18) --------------------------------------------------


def last_seasons_criteria(this_season: AidRules, last_season: AidRules) -> AidRules:
    """This season's rules with last season's criteria copied in: CRITERIA_SECTIONS whole, and CRITERIA_BUT's
    sections but for the key named, which stays this season's. The year and every other section stay this
    season's (the routing of programs to tables included)."""
    merged: dict[str, Any] = this_season.model_dump(mode="json")
    last = last_season.model_dump(mode="json")
    for name in CRITERIA_SECTIONS:
        merged[name] = last[name]
    for name, kept in CRITERIA_BUT.items():
        merged[name] = {**last[name], kept: merged[name][kept]}
    return AidRules.model_validate(merged)


def _criteria(document: AidRules) -> dict[str, Any]:
    raw = document.model_dump(mode="json")
    criteria: dict[str, Any] = {name: raw[name] for name in CRITERIA_SECTIONS}
    for name, kept in CRITERIA_BUT.items():
        criteria[name] = {key: value for key, value in raw[name].items() if key != kept}
    return criteria


def has_last_seasons_criteria(document: AidRules, last_season: AidRules) -> bool:
    """Whether `document` carries `last_season`'s criteria (what last_seasons_criteria copies in), whatever else it
    holds. Names RPT-18's starting point by its criteria alone, so an edit in place to this season's rules draft (its
    budget, its routing) never renames it."""
    return _criteria(document) == _criteria(last_season)

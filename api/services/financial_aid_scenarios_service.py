"""Campership scenarios (sub-project 9b; spec §7.4, §7.5; D35–D39, D76; main spec §12.2–§12.3).

One draft per person, kept options and the trail, all over one frozen season:

- **Freeze** (`freeze`) records the season's applications as the live season read sees them
  (financial_aid_scenario_pricing). Every scenario is priced on the newest snapshot; freezing an unchanged season
  writes nothing.
- **The draft** is the person's newest trail row. Releasing a setting (`save_draft`) appends a row with its results,
  who and when; loading an option or any row (`load`) appends one too (neither appends when the draft already is
  that), so nothing is ever lost and nothing asks "discard?" (D38). `evaluate` prices without writing: the live
  preview while a slider moves. The draft is "from" its row's kept code, else the row's from code.
- **Keep** locks the draft as an immutable option with the next flat letter (A, B, C: Scenarios addendum §S11.1)
  and a name (staff's, else its label); `rename` changes the name only. Options kept before names (A1, B2) keep
  their codes. "Start from the rules" makes a starting point from the rules draft (the latest version).
- **Compare** puts the rules in effect, last season's rules and the draft (each when asked) beside up to 4 kept
  options, every column counted against the rules in effect (§S11.2); **Fit to budget** finds the tier shift that
  uses Round 1's allocation; **sensitivity** is what one step of each sizing setting moves Round 1 by. **Make it the
  rules draft** hands a kept option to the rules service (SP9a's promotion).

**What the committee compares** (sub-project 9c; spec §9.7 RPT-17, RPT-18, RPT-32) rides on compare: each column
carries its Round 1 and Round 2 tables by tier and its share of the total budget, and, when asked, last season's
posted money beside them (read live through the decisions service; empty and named until last season's decisions
are loaded, never estimated). "Start from last season's rules" makes a starting point from this season's rules with
last season's approved criteria copied in.

Kept options and the trail are shared by everyone with financial_aid.rules; the draft is per person. Nothing here
writes live awards. Every write is one 4a operation whose log rows carry a summary, never a document or the frozen
inputs (plan Decision 15).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal, Protocol, cast

from api.constants.collections import AID_REQUESTS, AID_SCENARIO_OPTIONS, AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_TRAIL
from api.services.camp_calendar import CAMP_TZ, get_camp_date
from api.services.financial_aid_decisions_service import FIRST_TICKED_SEASON, DecisionsStore, Season
from api.services.financial_aid_ledger_service import as_of_cutoff
from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
    ROUND_SECTIONS,
    FinancialAidRulesService,
    PromotionPreview,
    RulesDraft,
    RulesVersion,
    YearMismatchError,
)
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, encode_snapshot, price_document
from api.services.financial_aid_scenarios_repository import OptionRecord, SnapshotMeta, TrailRecord
from bunking.financial_aid.arrival import (
    ArrivalCurve,
    Projection,
    calendar_anchor,
    camp_date_of,
    curve_from_dates,
    project,
    share_by,
)
from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.decisions import PoolBudget, season_budget
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.received import WITHDRAWN, edit_predecessors, received_dates, split_by_received
from bunking.financial_aid.rules import AidRules, SectionName, ValidationIssue, ValidationReport
from bunking.financial_aid.rules.derived import derive_weights
from bunking.financial_aid.rules.fixed import reset_fixed_document
from bunking.financial_aid.rules.lifecycle import changed_sections
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.financial_aid.scenarios import (
    CARD_TITLES,
    SIZING_LEVERS,
    CommitteeView,
    FitResult,
    PoolResult,
    RequestSet,
    RequestSetNote,
    ScenarioResults,
    SizingLever,
    apply_sizing,
    committee_view,
    describe,
    dollar_for_dollar,
    fit_margin,
    fit_tier_shift,
    has_last_seasons_criteria,
    last_seasons_criteria,
    nudge,
    posted_season,
    request_set_note,
    round1_by_request,
    scenario_results,
    shift_round1_tables,
    starting_point_code,
    tightest_pool,
    up_down,
    uses_budget_placeholder,
)
from bunking.logging_config import get_logger

MAX_COMPARED: Final = 4

StartFrom = Literal["rules", "rules_draft", "last_rules"]
# The built-in starting points (§S11.2): a draft from one writes no kept option, and reads its source NOW, so
# "was …" always means what is in effect (or in the rules draft, or last season's merge) when it is read.
BUILT_IN_STARTS: Final[tuple[StartFrom, ...]] = ("rules", "rules_draft", "last_rules")
NAME_MAX: Final = 80  # aid_scenario_options.name (1500000233_aid_scenario_names.js)

# A season's stored arrival curve (aid_arrival_curves), and a season's requests' received moments (D138).
CurveRead = Callable[[int], Awaitable[ArrivalCurve | None]]
ReceivedRead = Callable[[int], Awaitable[list[datetime]]]

# Curves computed from received dates, by the curve's season, per process (§S11.7). Last season's log barely moves;
# Update Applications clears it. Per process: Update Applications clears only the worker that served it.
_COMPUTED: dict[int, ArrivalCurve | None] = {}

logger = get_logger(__name__)


def clear_computed_curves() -> None:
    _COMPUTED.clear()


async def received_moments(store: DecisionsStore, year: int) -> list[datetime]:
    """A season's requests' received moments, exactly as the snapshot's capture reads them (D138): each request that
    is not withdrawn, at its first create row or its withdrawn predecessors' (an edited answer keeps its first date).
    A request with no create row has no known date and is left out (disagreement 8)."""
    requests = await store.fetch_requests(year)
    log = await store.fetch_change_log(year, AID_REQUESTS)
    live = [request.id for request in requests if request.status != WITHDRAWN]
    dates = received_dates(live, log, predecessors=edit_predecessors(requests))
    return [at for at in dates.values() if at is not None]


def _fit_name(text: str) -> str:
    return text if len(text) <= NAME_MAX else text[: NAME_MAX - 1] + "…"


# The sections the sandbox edits (§S11.3). Of `awards` only the minimum is on screen, but a section locks whole, as on
# Rules.
SCENARIO_SECTIONS: Final[tuple[SectionName, ...]] = ("tiers", "award_tables", "round2", "awards", "equity", "income")


def _round_of(section: SectionName) -> int:
    return next((n for n, read in ROUND_SECTIONS.items() if section in read), 1)


def locked_words(sections: Sequence[SectionName]) -> str:
    """§S11.3: "Income tiers and Round 1 award table are locked: Round 1 is posted, so Scenarios models only what is
    still open." The card titles are the Rules tab's; the round is the latest that read any of them."""
    titles = [CARD_TITLES.get(s, s) for s in sections]
    names = titles[0] if len(titles) == 1 else f"{', '.join(titles[:-1])} and {titles[-1]}"
    verb = "is" if len(titles) == 1 else "are"
    posted = max(_round_of(s) for s in sections)
    return f"{names} {verb} locked: Round {posted} is posted, so Scenarios models only what is still open."


class ScenarioNotFoundError(FinancialAidError, LookupError):
    """No such kept option or trail row in the season."""


class ScenarioRefusedError(FinancialAidError, ValueError):
    """An action that can't run as asked; the message is safe to show staff."""


class ScenarioConflictError(FinancialAidError, ValueError):
    """The action would duplicate something that exists (a keep that matches a kept option)."""


class ScenarioSectionLockedError(FinancialAidError, ValueError):
    """An edit or a promotion that changes a section a posted round locked (§S11.3): 409 {"message", "sections"},
    the shape ReplacementNotAcknowledgedError has. Only Scenarios refuses: Rules can still correct a locked section."""

    def __init__(self, sections: Sequence[SectionName]) -> None:
        super().__init__(locked_words(sections))
        self.sections = list(sections)


@dataclass(frozen=True)
class ScenarioPromotion:
    preview: PromotionPreview
    fixed_kept: int  # fixed settings left as the rules draft has them (§S11.3)


SeasonCapture = Callable[[int], Awaitable[SeasonSnapshot]]
# A season read live, as Rounds & budget reads it (FinancialAidDecisionsService.season): last season's posted money.
SeasonRead = Callable[[int], Awaitable[Season]]
# A request set (D138): the Round 1 deadline switch, or the received-through date. None: every frozen request.
RequestSetChoice = Literal["round1_deadline"] | date


class ScenarioStore(Protocol):
    async def latest_snapshot(self, year: int) -> SnapshotMeta | None: ...
    async def snapshot_inputs(self, record_id: str) -> SeasonSnapshot: ...
    async def options(self, year: int) -> list[OptionRecord]: ...
    async def option_round1(self, record_id: str) -> dict[str, Decimal]: ...
    async def latest_trail(self, year: int, actor: str) -> TrailRecord | None: ...
    async def trail_row(self, record_id: str) -> TrailRecord | None: ...
    async def trail_page(self, year: int, page: int, per_page: int) -> tuple[list[TrailRecord], int]: ...
    async def commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None
    ) -> AidOperationResult: ...


@dataclass(frozen=True)
class Priced:
    results: ScenarioResults
    round1: dict[str, Decimal]  # request id -> Round 1, for requests up / down


Pricer = Callable[[AidRules], Awaitable[Priced]]


@dataclass(frozen=True)
class Evaluation:
    document: AidRules
    results: ScenarioResults
    report: ValidationReport
    projection: Projection | None = None


@dataclass(frozen=True)
class Source:
    """What a draft is from: a kept option, or a built-in start read now; `version` is the rules version it was
    taken from (an option's origin_version), which a keep records as the new option's origin."""

    code: str
    document: AidRules
    version: int


@dataclass(frozen=True)
class Draft:
    trail_id: str | None  # None: nothing recorded yet, so the draft is the rules in effect (§S11.2)
    from_code: str  # a kept code, or "rules" | "rules_draft" | "last_rules"
    document: AidRules
    label: str  # what differs from its source, in staff words (§S11.6)
    changes: tuple[FieldChange, ...]  # the same, setting by setting (the screen's amber)
    results: ScenarioResults | None  # None before any freeze
    report: ValidationReport
    recorded_at: datetime | None
    source_document: AidRules | None = None  # what it is from, read now: the strip's starting point and "was"
    same_as: str | None = None  # a kept code whose document equals it, else "rules" when it is the rules in effect
    projection: Projection | None = None
    differs_in: tuple[SectionName, ...] = ()  # the sections whose content differs from the rules in effect (Task 67)


@dataclass(frozen=True)
class KeptOption:
    record: OptionRecord
    label: str
    stale: bool  # its results are from an older snapshot
    promotable: bool = False  # Make it the Rules Draft would copy something (Task 57)
    blocked: str | None = None  # why it can't, in staff words (Task 57)

    @property
    def name(self) -> str:
        """The staff-given name, else the generated label (§S11.1: an option kept before names has none)."""
        return self.record.name or self.label


@dataclass(frozen=True)
class Workspace:
    year: int
    rules_version: int
    snapshot: SnapshotMeta | None
    draft: Draft | None
    options: tuple[KeptOption, ...]
    pricing_version: int | None = None  # the version pricing the season; None while none does (final review 8)
    rules_draft_version: int | None = None  # the rules draft's version while it differs from the rules in effect
    locked_sections: tuple[SectionName, ...] = ()  # a posted round locked these (§S11.3): the screen greys from them
    locked_by_round: int | None = None  # 2 when round2 is locked, 1 when a Round 1 section is: the lock note's words
    last_rules_version: int | None = None  # last season's approved version: Start from's "(none approved)" (Task 67)


@dataclass(frozen=True)
class CompareColumn:
    code: str  # "rules", "last_rules", "draft", or a kept code
    label: str
    document: AidRules
    changes: tuple[FieldChange, ...]  # against the rules in effect (N4): a row lines up across columns
    results: ScenarioResults
    up: int | None  # requests whose Round 1 is higher than under the rules in effect (N3); None for the rules column
    down: int | None
    committee: CommitteeView | None = None  # RPT-17 / RPT-32's tables by tier and the budget share (SP9c)
    version: int | None = None  # the rules version: "rules", or last season's for "last_rules"
    approved_at: datetime | None = None  # the newest approval among the pricing sections, for "rules"
    via: str | None = None  # the kept code "rules" was promoted from (promoted_via)
    projection: Projection | None = None


@dataclass(frozen=True)
class LastSeason:
    """Last season's posted money beside the compare (RPT-17's and RPT-32's last-season columns). `view` is None
    until last season has posted money, and `label` then says it is not loaded: never zeros, never an estimate."""

    year: int
    loaded: bool
    label: str
    rules_version: int | None  # the version that priced it; None when it has no approved rules
    view: CommitteeView | None
    round3: Decimal = ZERO
    pools: tuple[PoolResult, ...] = ()  # each pool's Posted cells (§S11.2)
    remaining: Decimal | None = None  # Allocated − Posted in total, so the client sums nothing (Task 67)


@dataclass(frozen=True)
class Comparison:
    snapshot: SnapshotMeta
    columns: tuple[CompareColumn, ...]
    last_season: LastSeason | None = None  # only when asked for
    last_rules_refused: str | None = None  # why the last season's rules column asked for is left out


@dataclass(frozen=True)
class Fitted:
    fit: FitResult
    tightest_pool: str | None  # information only (D119): the pool with the least Round 1 Remaining at the shift found
    evaluation: Evaluation


@dataclass(frozen=True)
class LeverEffect:
    lever: SizingLever
    round1_change: Decimal
    on: bool | None = None  # a switch's state in the document (dollar-for-dollar); None for a stepped lever


@dataclass(frozen=True)
class Sensitivity:
    results: ScenarioResults  # the document's own figures, which each step moves from
    effects: tuple[LeverEffect, ...]


def _from(row: TrailRecord) -> str:
    return row.kept_code or row.from_code


# Reads whose value moves with the clock rather than the season: the last ledger sync's time changes on every sync,
# even one that brought nothing. A real write still stores the latest.
_CLOCK_READS: Final = frozenset({"fetch_last_ledger_sync"})


def _season_of(encoded: Mapping[str, Any]) -> dict[str, Any]:
    """An encoded snapshot without the moment it was frozen or the last ledger sync's time: what "the season hasn't
    moved" compares."""
    season = {key: value for key, value in encoded.items() if key != "frozen_at"}
    season["calls"] = {name: value for name, value in dict(encoded["calls"]).items() if name not in _CLOCK_READS}
    return season


def _prices(version: RulesVersion) -> bool:
    """Whether a version can price the season: every pricing section approved or locked (the rules service's
    `latest_approved(year, PRICING_SECTIONS)` takes the newest such version)."""
    return all(version.section_status[name].state in ("approved", "locked") for name in PRICING_SECTIONS)


def _rules_name(version: RulesVersion) -> str:
    """ "rules vN" for approved rules, "rules draft vN" for a version that can't price the season (final review 8)."""
    return f"rules v{version.version}" if _prices(version) else f"rules draft v{version.version}"


def _posted_label(year: int, as_of: datetime | None) -> str:
    """Last season's basis and as-of, printed with its figures (spec §9.7). A season Kindred did not tick is the
    one-off reproduction of D67 (§4.7: "reproduced from the repaired sheet"); its as-of is its newest lock."""
    basis = "posted as reproduced from the repaired sheet" if year < FIRST_TICKED_SEASON else "posted"
    if as_of is None:
        return f"{year}, {basis}"
    local = as_of.astimezone(CAMP_TZ)
    return f"{year}, {basis} (as of {local:%b} {local.day}, {local.year})"


def _posted_pool(pool: PoolBudget) -> PoolResult:
    """Last season by pool (§S11.2): each round's Posted cell, never an estimate; Remaining = Allocated − Posted."""
    round1, round2, round3 = (pool.rounds[n].posted for n in (1, 2, 3))
    allocated = pool.total.allocated
    return PoolResult(
        pool=pool.pool,
        label=pool.label,
        round1=round1,
        round2=round2,
        round3=round3,
        round1_allocated=allocated,
        round1_remaining=None if allocated is None else allocated - round1,
        remaining=None if allocated is None else allocated - round1 - round2 - round3,
        round1_unmet=ZERO,
    )


def _approved_at(version: RulesVersion) -> datetime | None:
    stamps = [version.section_status[name].approved_at for name in PRICING_SECTIONS]
    return max((stamp for stamp in stamps if stamp is not None), default=None)


def _last_season_name(last: RulesVersion, year: int, origin: RulesVersion, *, placeholder: bool = False) -> str:
    """RPT-18's starting point: last season's criteria on this season's applications, the rest from this season's
    rules, named as SP9b names them ("rules draft vN" while that version can't price the season)."""
    # `placeholder`: this season had no budget, so last season's stands in for it.
    name = f"{last.year} v{last.version} rules on {year}'s applications, the rest from {_rules_name(origin)}"
    return f"{name}, and {last.year} budget as a placeholder" if placeholder else name


def _introduced(before: Sequence[ValidationIssue], after: Sequence[ValidationIssue]) -> list[ValidationIssue]:
    """The errors a merge added: `after`'s that the rules draft did not already have (same section, code, path)."""
    had = {(issue.section, issue.code, issue.path) for issue in before}
    return [issue for issue in after if (issue.section, issue.code, issue.path) not in had]


def _changes(old: AidRules, new: AidRules) -> tuple[FieldChange, ...]:
    return tuple(field_changes(old.model_dump(), new.model_dump()))


def _same_as(document: AidRules, options: Mapping[str, OptionRecord], effect: RulesVersion) -> str | None:
    """A kept code whose document equals `document`, else "rules" when it is the rules in effect (§S11.2). No read of
    its own: the caller passes the reads it already holds (plan review, minor 3)."""
    same = next((o.code for o in options.values() if o.document == document), None)
    return same if same is not None else ("rules" if document == effect.document else None)


def _scenario_locked(locked: Collection[SectionName]) -> tuple[SectionName, ...]:
    return tuple(name for name in SECTION_NAMES if name in SCENARIO_SECTIONS and name in locked)


def _promotion_document(rules_draft: AidRules, option: AidRules, origin: AidRules) -> tuple[AidRules, int]:
    """What a promotion copies (§S11.3; COORDINATOR RULING, PR 10, 2026-10-07): the option with its fixed settings
    set back to the rules draft's, and the budget total too. A scenario option can never change the budget total: the
    sandbox has no budget editor, and once Round 1 posts the rules save refuses a new total (BudgetTotalLockedError),
    which would fail Confirm and leave the option's other changes unlanded. Always applied, locked or not. The pools'
    shares copy only when the option moved them from `origin`, where it started: otherwise the rules draft's own
    budget edit since then would look moved and be reverted. The count is of fixed settings only; the total is not
    one."""
    document, kept = reset_fixed_document(rules_draft, option)
    pools = document.budget.pools if document.budget.pools != origin.budget.pools else rules_draft.budget.pools
    budget = rules_draft.budget.model_copy(update={"pools": pools})
    if budget != document.budget:
        document = document.model_copy(update={"budget": budget})
    return document, kept


def _when(row: TrailRecord) -> str:
    local = row.created.astimezone(CAMP_TZ)
    return f"{local:%b} {local.day} {local:%H:%M}"


def _fit_margin(results: ScenarioResults) -> Decimal:
    try:
        return fit_margin(results)
    except ValueError as exc:
        raise ScenarioRefusedError(f"There is nothing to fit: {exc}") from exc


class FinancialAidScenariosService:
    def __init__(
        self,
        store: ScenarioStore,
        rules: FinancialAidRulesService,
        capture: SeasonCapture,
        *,
        season_read: SeasonRead | None = None,
        curves: CurveRead | None = None,
        received: ReceivedRead | None = None,
    ) -> None:
        self._store = store
        self._rules = rules
        self._capture = capture
        self._season_read = season_read
        self._curves = curves
        self._received = received

    # --- what every action shares -------------------------------------------------------------------

    async def _meta(self, year: int) -> SnapshotMeta:
        meta = await self._store.latest_snapshot(year)
        if meta is None:
            raise ScenarioRefusedError("Update Applications first: every scenario is priced on the applications held")
        return meta

    async def _deadline(self, year: int) -> date | None:
        approved = await self._rules.latest_approved(year, ["milestones"])
        return approved.document.milestones.application_deadline if approved is not None else None

    async def arrival_curve(self, year: int) -> ArrivalCurve | None:
        """The curve season `year` is projected on: last season's (§S11.7). A stored row first (2026's one-off load,
        or a prior year's); else, for a ticked season (2027 on), computed from its own received dates on its approved
        deadline, memoised per process; else none. 2026's dashboard dates are a bulk load, never arrivals."""
        basis = year - 1
        stored = await self._curves(basis) if self._curves is not None else None
        if stored is not None:
            return stored
        if basis < FIRST_TICKED_SEASON or self._received is None:
            return None
        if basis not in _COMPUTED:
            _COMPUTED[basis] = await self._computed_curve(basis)
        return _COMPUTED[basis]

    async def _computed_curve(self, basis: int) -> ArrivalCurve | None:
        if self._received is None:
            return None
        moments = await self._received(basis)
        if not moments:
            return None
        deadline = await self._deadline(basis)
        return curve_from_dates(
            (camp_date_of(moment) for moment in moments),
            deadline if deadline is not None else calendar_anchor(basis),
            year=basis,
            source="received",
            aligned_on="application_deadline" if deadline is not None else "calendar",
        )

    async def _projector(
        self, year: int, meta: SnapshotMeta, chosen: RequestSet | None
    ) -> Callable[[ScenarioResults], Projection | None]:
        """The projection for one read (§S11.7), its curve and share resolved once: the Price ▾ date when one is set,
        else the held pile's day in camp time. A deadline-aligned curve needs this season's approved deadline: with
        none there is no projection, never a silent switch to the calendar."""

        def none(results: ScenarioResults) -> Projection | None:
            return None

        try:
            curve = await self.arrival_curve(year)
            anchor = (
                await self._deadline(year) if curve is not None and curve.aligned_on == "application_deadline" else None
            )
        except Exception:  # an optional estimate: a bad row or a PocketBase error must not close the read
            logger.warning("Projection skipped for %s: its arrival curve could not be read", year, exc_info=True)
            return none
        if curve is None:
            return none
        through = chosen.through if chosen is not None else get_camp_date(meta.created)
        if curve.aligned_on == "application_deadline":
            if anchor is None:
                return none
        else:
            anchor = calendar_anchor(year)
        share = share_by(curve, through, anchor)
        if share is None:
            return none

        def projected(results: ScenarioResults) -> Projection | None:
            return project(results, share, through=through, basis_year=curve.year, aligned_on=curve.aligned_on)

        return projected

    async def _pricer(self, meta: SnapshotMeta, request_set: RequestSet | None = None) -> Pricer:
        snapshot = await self._store.snapshot_inputs(meta.id)
        base = await self._rules.load(meta.year)
        kept: frozenset[str] | None = None
        note: RequestSetNote | None = None
        if request_set is not None:
            split = split_by_received(snapshot.received, as_of_cutoff(request_set.through), snapshot.live)
            kept, note = split.kept, request_set_note(request_set, split)

        async def price(document: AidRules) -> Priced:
            priced = await price_document(snapshot, document, base, requests=kept)
            requests = list(priced.season.priced.values())
            results = scenario_results(requests, priced.budget, document=document, request_set=note)
            return Priced(results, round1_by_request(requests))

        return price

    async def _request_set(self, year: int, choice: RequestSetChoice | None) -> RequestSet | None:
        """The request set a read asked for (D138): a chosen date, or the Round 1 deadline, which is
        `milestones.application_deadline` in the newest version where milestones are approved (as D76's approved read
        takes a section). Never the draft's."""
        if choice is None:
            return None
        if isinstance(choice, date):
            return RequestSet("date", choice)
        deadline = await self._deadline(year)
        if deadline is None:
            raise ScenarioRefusedError(
                f"{year}'s approved rules set no application deadline (milestones): choose a received-through date"
            )
        return RequestSet("round1_deadline", deadline)

    async def _options(self, year: int) -> dict[str, OptionRecord]:
        return {option.code: option for option in await self._store.options(year)}

    async def _option(self, year: int, code: str) -> OptionRecord:
        option = (await self._options(year)).get(code)
        if option is None:
            raise ScenarioNotFoundError(f"{year} has no kept option {code}")
        return option

    async def _reference(self, option: OptionRecord, options: Mapping[str, OptionRecord]) -> AidRules:
        """What an option's label compares against: a variant's starting point; a starting point's origin rules."""
        if option.starting_point:
            return options[option.starting_point].document
        return (await self._rules.load(option.year, option.origin_version)).document

    async def _last_rules(self, year: int) -> RulesVersion | None:
        """Last season's approved rules: the version that priced it (every pricing section approved)."""
        return await self._rules.latest_approved(year - 1, PRICING_SECTIONS)

    async def _in_effect(self, year: int) -> RulesVersion:
        """The rules in effect (§S11.2): the newest version every pricing section approves, or the latest version
        while none prices the season (the screen then names it "Rules draft · vN")."""
        return await self._rules.latest_approved(year, PRICING_SECTIONS) or await self._rules.load(year)

    @staticmethod
    def _effect_name(version: RulesVersion) -> str:
        return f"Rules v{version.version}" if _prices(version) else f"Rules draft v{version.version}"

    async def _last_rules_document(self, year: int, base: RulesVersion, *, words: str) -> tuple[AidRules, str]:
        """RPT-18's merge on `base` and its name; refused when last season has no approved rules, or when the merge
        adds a validation error `base` did not already have (say which). `words` names `base` in the refusal."""
        last = await self._last_rules(year)
        if last is None:
            raise ScenarioRefusedError(f"{year - 1} has no approved rules to start from: load and approve them first")
        document = last_seasons_criteria(base.document, last.document)
        introduced = _introduced(
            (await self._rules.validate_document(base.document)).errors,
            (await self._rules.validate_document(document)).errors,
        )
        if introduced:
            named = "; ".join(f"{issue.path}: {issue.message}" for issue in introduced[:3])
            raise ScenarioRefusedError(
                f"{year - 1}'s criteria don't fit {year}'s {words} ({named}): start from the rules and edit instead"
            )
        placeholder = uses_budget_placeholder(base.document, last.document)
        return document, _last_season_name(last, year, base, placeholder=placeholder)

    async def _built_in(
        self, year: int, start: StartFrom, *, recorded: AidRules | None = None, effect: RulesVersion | None = None
    ) -> Source:
        """A built-in start, read now. A load passes no `recorded` and keeps last season's two refusals. A read of a
        recorded draft passes the row's own document and never refuses (disagreement 16): the rules in effect can
        change after the load so that the merge no longer fits, and a 422 there would hide Start from, the only way
        out. Its source is then the merge without the check, or the row's own document when last season has no
        approved rules any more (or the merge doesn't even build)."""
        effect = effect if effect is not None else await self._in_effect(year)
        if start == "rules":
            return Source("rules", effect.document, effect.version)
        if start == "rules_draft":
            draft = await self._rules.load(year)
            return Source("rules_draft", draft.document, draft.version)
        if recorded is None:
            document, _ = await self._last_rules_document(year, effect, words="rules in effect")
            return Source("last_rules", document, effect.version)
        last = await self._last_rules(year)
        try:
            merged = recorded if last is None else last_seasons_criteria(effect.document, last.document)
        except ValueError:  # pydantic's ValidationError: a read never fails for its source
            merged = recorded
        return Source("last_rules", merged, effect.version)

    async def _source(
        self,
        year: int,
        code: str,
        options: Mapping[str, OptionRecord] | None = None,
        *,
        recorded: AidRules | None = None,
        effect: RulesVersion | None = None,
    ) -> Source:
        """A draft's source by its row's from code (§S11.2): a kept option's document, or a built-in read now.
        `recorded`: the row's own document, for a read (see `_built_in`)."""
        if code in BUILT_IN_STARTS:
            return await self._built_in(year, code, recorded=recorded, effect=effect)
        option = (options if options is not None else await self._options(year)).get(code)
        if option is None:
            raise ScenarioNotFoundError(f"{year} has no kept option {code}")
        return Source(option.code, option.document, option.origin_version)

    async def _label(
        self, option: OptionRecord, options: Mapping[str, OptionRecord], last: RulesVersion | None = None
    ) -> str:
        """`last`: last season's approved rules, which name a starting point made from them (RPT-18)."""
        if not option.from_code:
            # "rules vN" only when vN is approved rules and the option is them: one started from a draft that was
            # approved later with edits stays "rules draft vN", as it was.
            origin = await self._rules.load(option.year, option.origin_version)
            if origin.document == option.document:
                return f"{_rules_name(origin)} as they were"  # SP9b's name first: exactly the rules
            # RPT-18's start, recognised by its criteria alone: the rules draft it was made from can be edited in
            # place after the start, and that must not rename it. Only when the draft's own criteria are not last
            # season's: a season started from last year's rules carries them, and a plain start from those rules,
            # edited in place, stays "as they were" (a start from last season would have been that same start).
            if (
                last is not None
                and has_last_seasons_criteria(option.document, last.document)
                and not has_last_seasons_criteria(origin.document, last.document)
            ):
                # Last season's budget stands in when the option holds it and the draft's own differs (unset, or
                # set since): named by what the option holds. All three equal needs no note.
                placeholder = (
                    option.document.budget == last.document.budget and option.document.budget != origin.document.budget
                )
                return _last_season_name(last, option.year, origin, placeholder=placeholder)
            if option.name:
                # Kept from a built-in start with changes (§S11.1): its words are what differs from that start, and
                # `name` alone carries staff's words. A start kept before names stores none, so it stays "as they
                # were" below, as SP9b named it, until someone renames it: then it reads as what differs from its
                # origin too (lead ruling, Task 56: narrow, and truthful once the draft was edited in place).
                return describe(origin.document, option.document)
            return f"rules draft v{origin.version} as they were"
        return describe(await self._reference(option, options), option.document)

    @staticmethod
    def _check_year(year: int, document: AidRules) -> None:
        if document.year != year:
            raise ScenarioRefusedError(f"The document is for {document.year}, not {year}")

    @staticmethod
    def _trail_write(
        year: int,
        actor: str,
        *,
        document: AidRules,
        from_code: str,
        change: str,
        results: ScenarioResults,
        meta: SnapshotMeta,
        kept_code: str = "",
    ) -> AidWrite:
        return AidWrite(
            collection=AID_SCENARIO_TRAIL,
            action="create",
            year=year,
            data={
                "year": year,
                "actor": actor,
                "from_code": from_code,
                "document": document.model_dump(mode="json"),
                "change": change,
                "results": results.model_dump(mode="json"),
                "snapshot": meta.id,
                "kept_code": kept_code,
            },
            after={"change": change, "from_code": from_code, "kept_code": kept_code},
            log_action="record",
        )

    @staticmethod
    def _option_write(
        year: int,
        actor: str,
        *,
        code: str,
        starting_point: str,
        from_code: str,
        origin_version: int,
        document: AidRules,
        priced: Priced,
        meta: SnapshotMeta,
        name: str = "",
    ) -> AidWrite:
        return AidWrite(
            collection=AID_SCENARIO_OPTIONS,
            action="create",
            year=year,
            data={
                "year": year,
                "code": code,
                "starting_point": starting_point,
                "from_code": from_code,
                "origin_version": origin_version,
                "name": name,
                "document": document.model_dump(mode="json"),
                "results": priced.results.model_dump(mode="json"),
                "round1_by_request": {rid: str(amount) for rid, amount in priced.round1.items()},
                "snapshot": meta.id,
                "actor": actor,
            },
            after={"code": code, "starting_point": starting_point, "from_code": from_code, "name": name},
            log_action="keep",
            entity_id=f"{year}:{code}",
        )

    async def _record(self, year: int, actor: str, *, document: AidRules, from_code: str, change: str) -> None:
        meta = await self._meta(year)
        priced = await (await self._pricer(meta))(document)
        write = self._trail_write(
            year, actor, document=document, from_code=from_code, change=change, results=priced.results, meta=meta
        )
        await self._store.commit([write], actor=actor)

    async def _draft(
        self,
        year: int,
        actor: str,
        *,
        effect: RulesVersion | None = None,
        options: Mapping[str, OptionRecord] | None = None,
    ) -> Draft:
        """`actor`'s draft: their newest trail row, from its source read now. With no row, the rules in effect,
        unrecorded (§S11.2): the tab opens on them without a write, and the first release records from "rules". A
        read never refuses for its source (disagreement 16). `effect` and `options` are the caller's reads, when it
        holds them: the workspace reads each once (plan review, minor 3)."""
        row = await self._store.latest_trail(year, actor)
        effect = effect if effect is not None else await self._in_effect(year)
        options = options if options is not None else await self._options(year)
        recorded = row.document if row is not None else None
        code = _from(row) if row is not None and recorded is not None else "rules"
        source = await self._source(year, code, options, recorded=recorded, effect=effect)
        document = recorded if recorded is not None else source.document
        meta = await self._store.latest_snapshot(year)
        results: ScenarioResults | None = None
        projection: Projection | None = None
        stored = row.results if row is not None and recorded is not None and meta is not None else None
        if meta is not None and row is not None and row.snapshot == meta.id and stored is not None:
            results = stored
        elif meta is not None:
            try:
                results = (await (await self._pricer(meta))(document)).results
            except SnapshotError:  # unreadable snapshot: the read still opens, so Update Applications stays reachable
                results = None
        if results is not None and meta is not None:
            projection = (await self._projector(year, meta, None))(results)
        return Draft(
            trail_id=row.id if row is not None and recorded is not None else None,
            from_code=source.code,
            document=document,
            label=describe(source.document, document),
            changes=_changes(source.document, document),
            results=results,
            report=await self._rules.validate_document(document),
            recorded_at=row.created if row is not None and recorded is not None else None,
            source_document=source.document,
            same_as=_same_as(document, options, effect),
            projection=projection,
            differs_in=tuple(changed_sections(effect.document, document)),
        )

    # --- freeze, start, read ------------------------------------------------------------------------

    async def _stored_season(self, meta: SnapshotMeta) -> dict[str, Any] | None:
        """What the stored snapshot froze, as freeze compares it; None when this code can't read it, which counts as
        "the season moved", so freezing writes a readable one rather than locking staff out."""
        try:
            return _season_of(encode_snapshot(await self._store.snapshot_inputs(meta.id)))
        except SnapshotError:
            return None

    async def freeze(self, year: int, actor: str) -> SnapshotMeta:
        """Freeze the season's applications as they are now; nothing is written when they haven't moved.

        Two freezes at the same moment can each find the season moved and each write a snapshot: a duplicate, whose
        newest copy every read then uses. Accepted (review ruling): one person works a season's scenarios at a time,
        and a duplicate costs only storage."""
        clear_computed_curves()
        captured = await self._capture(year)
        encoded = encode_snapshot(captured)
        latest = await self._store.latest_snapshot(year)
        if latest is not None and await self._stored_season(latest) == _season_of(encoded):
            return latest  # the season hasn't moved (the moment it was frozen doesn't count)
        write = AidWrite(
            collection=AID_SCENARIO_SNAPSHOTS,
            action="create",
            year=year,
            data={
                "year": year,
                "inputs": encoded,
                "requests": captured.requests,
                "awaiting_rules": captured.awaiting_rules,
                "actor": actor,
            },
            after={"requests": captured.requests, "awaiting_rules": captured.awaiting_rules},
            log_action="freeze",
        )
        await self._store.commit([write], actor=actor)
        return await self._meta(year)

    async def start_from_rules(self, year: int, actor: str) -> Workspace:
        """A new starting point from the rules draft, loaded into `actor`'s draft. When a kept option already is the
        rules draft, it is loaded instead of copied."""
        meta = await self._meta(year)
        rules = await self._rules.load(year)
        options = await self._options(year)
        same = next((o for o in options.values() if o.document == rules.document), None)
        if same is not None:
            await self.load(year, actor, option=same.code)
            return await self.workspace(year, actor)
        code = starting_point_code(sum(1 for o in options.values() if not o.starting_point))
        priced = await (await self._pricer(meta))(rules.document)
        writes = [
            self._option_write(
                year,
                actor,
                code=code,
                starting_point="",
                from_code="",
                origin_version=rules.version,
                document=rules.document,
                priced=priced,
                meta=meta,
            ),
            self._trail_write(
                year,
                actor,
                document=rules.document,
                from_code=code,
                change=f"started from {_rules_name(rules)}",
                results=priced.results,
                meta=meta,
                kept_code=code,
            ),
        ]
        await self._store.commit(writes, actor=actor)
        return await self.workspace(year, actor)

    async def start_from_last_season(self, year: int, actor: str) -> Workspace:
        """RPT-18: a new starting point from the rules draft with last season's approved criteria copied in
        (bunking.financial_aid.scenarios.last_seasons_criteria), loaded into `actor`'s draft. This season's routing,
        grants, decision types, programs, cost, budget (unless it sets none: then last season's stands in as a
        placeholder), quality checks and milestones stay. Refused when last
        season has no approved rules, or when the merge adds a validation error the rules draft did not already have
        (say which; the draft's own errors never block it). When a kept option already is that document, it is
        loaded instead of copied."""
        meta = await self._meta(year)
        rules = await self._rules.load(year)
        document, name = await self._last_rules_document(year, rules, words="rules draft")
        options = await self._options(year)
        same = next((o for o in options.values() if o.document == document), None)
        if same is not None:
            await self.load(year, actor, option=same.code)
            return await self.workspace(year, actor)
        code = starting_point_code(sum(1 for o in options.values() if not o.starting_point))
        priced = await (await self._pricer(meta))(document)
        writes = [
            self._option_write(
                year,
                actor,
                code=code,
                starting_point="",
                from_code="",
                origin_version=rules.version,
                document=document,
                priced=priced,
                meta=meta,
            ),
            self._trail_write(
                year,
                actor,
                document=document,
                from_code=code,
                change=f"started from {name}",
                results=priced.results,
                meta=meta,
                kept_code=code,
            ),
        ]
        await self._store.commit(writes, actor=actor)
        return await self.workspace(year, actor)

    async def workspace(self, year: int, actor: str) -> Workspace:
        rules = await self._rules.load(year)
        pricing = await self._rules.latest_approved(year, PRICING_SECTIONS)
        effect = pricing or rules  # _in_effect's answer, from the reads already here
        meta = await self._store.latest_snapshot(year)
        options = await self._options(year)
        last = await self._last_rules(year)
        locked = await self._rules.sections_locked_anywhere(year)
        promotability = await self._promotability(year, options, rules_draft=rules, effect=effect, locked=locked)
        kept = [
            KeptOption(
                option,
                await self._label(option, options, last),
                stale=meta is None or option.snapshot != meta.id,
                promotable=promotability[option.code][0],
                blocked=promotability[option.code][1],
            )
            for option in options.values()
        ]
        greyed = _scenario_locked(locked)
        return Workspace(
            year,
            rules.version,
            meta,
            await self._draft(year, actor, effect=effect, options=options),
            tuple(kept),
            pricing_version=pricing.version if pricing is not None else None,
            rules_draft_version=rules.version if rules.document != effect.document else None,
            locked_sections=greyed,
            locked_by_round=2 if "round2" in greyed else 1 if any(s in ROUND_SECTIONS[1] for s in greyed) else None,
            last_rules_version=last.version if last is not None else None,
        )

    async def scenario_locked_sections(self, year: int) -> tuple[SectionName, ...]:
        """The Scenarios sections a posted round has locked in any version (§S11.3), in section order. The screen
        greys from these alone."""
        return _scenario_locked(await self._rules.sections_locked_anywhere(year))

    async def _promotion(self, year: int, code: str) -> tuple[OptionRecord, AidRules, ScenarioPromotion]:
        """What "Make ‹B› the Rules Draft" would copy (§S11.3): the option with its fixed settings set back to the
        rules draft's, and the preview of that. Refused (409) when a section it would copy is locked anywhere. The
        rules service's own promote is unchanged for its other callers."""
        option = await self._option(year, code)
        if option.document.year != year:
            raise YearMismatchError(f"The document is for {option.document.year}, not {year}")
        rules_draft = await self._rules.load(year)
        origin = (
            rules_draft
            if option.origin_version == rules_draft.version
            else await self._rules.load(year, option.origin_version)
        )
        try:
            document, kept = _promotion_document(rules_draft.document, option.document, origin.document)
        except ValueError as exc:  # pydantic's ValidationError
            raise ScenarioRefusedError(f"{code}'s fixed settings don't fit the rules draft") from exc
        preview = await self._rules.preview_against(rules_draft, origin=origin, document=document)
        locked = await self._rules.sections_locked_anywhere(year)
        refused = [entry.section for entry in preview.sections if entry.section in locked]
        if refused:
            raise ScenarioSectionLockedError(refused)
        return option, document, ScenarioPromotion(preview, kept)

    async def _promotability(
        self,
        year: int,
        options: Mapping[str, OptionRecord],
        *,
        rules_draft: RulesVersion,
        effect: RulesVersion,
        locked: Collection[SectionName],
    ) -> dict[str, tuple[bool, str | None]]:
        """Each option's `promotable` and `blocked` words (§S11.3; disagreement 5). It previews on the workspace's
        own reads of the rules draft, the rules in effect and the locks, and reads each origin version once, so a
        workspace read stays a handful of reads however many options are kept (plan review, minor 3)."""
        origins: dict[int, RulesVersion] = {rules_draft.version: rules_draft}
        out: dict[str, tuple[bool, str | None]] = {}
        for code, option in options.items():
            if option.origin_version not in origins:
                origins[option.origin_version] = await self._rules.load(year, option.origin_version)
            try:
                document, _ = _promotion_document(
                    rules_draft.document, option.document, origins[option.origin_version].document
                )
            except ValueError:
                out[code] = (False, "its fixed settings don't fit the rules draft")
                continue
            preview = await self._rules.preview_against(
                rules_draft, origin=origins[option.origin_version], document=document
            )
            refused = [entry.section for entry in preview.sections if entry.section in locked]
            if not preview.sections:
                same = rules_draft.document == effect.document
                out[code] = (False, "is the rules in effect" if same else "is already the rules draft")
            elif refused:
                posted = max(_round_of(s) for s in refused)
                out[code] = (False, f"changes Round {posted} settings, locked since Round {posted} posted")
            else:
                out[code] = (True, None)
        return out

    async def trail(self, year: int, *, page: int, per_page: int) -> tuple[tuple[TrailRecord, ...], int]:
        """A page of everyone's trail, newest first; each row says whether its figures are from an older snapshot."""
        rows, total = await self._store.trail_page(year, page, per_page)
        meta = await self._store.latest_snapshot(year)
        return tuple(replace(row, stale=meta is None or row.snapshot != meta.id) for row in rows), total

    # --- the draft ----------------------------------------------------------------------------------

    async def evaluate(
        self,
        year: int,
        document: AidRules,
        *,
        tier_shift: Decimal = ZERO,
        band_width_delta: Decimal = ZERO,
        request_set: RequestSetChoice | None = None,
    ) -> Evaluation:
        """`document` with the relative sizing settings applied, priced on the frozen season (only the requests
        received through a date, when `request_set` asks). Writes nothing."""
        self._check_year(year, document)
        moved = derive_weights(apply_sizing(document, tier_shift=tier_shift, band_width_delta=band_width_delta))
        chosen = await self._request_set(year, request_set)
        meta = await self._meta(year)
        priced = await (await self._pricer(meta, chosen))(moved)
        projection = (await self._projector(year, meta, chosen))(priced.results)
        return Evaluation(moved, priced.results, await self._rules.validate_document(moved), projection=projection)

    async def save_draft(self, year: int, document: AidRules, actor: str) -> Draft:
        """A released setting: the draft becomes `document`, recorded in the trail with what changed. With nothing
        recorded yet, the release records from "rules" (§S11.2)."""
        self._check_year(year, document)
        document = derive_weights(document)
        row = await self._store.latest_trail(year, actor)
        if row is None or row.document is None:
            current, from_code = (await self._source(year, "rules")).document, "rules"
        else:
            current, from_code = row.document, _from(row)
        locked = await self.scenario_locked_sections(year)
        moved = [s for s in locked if getattr(derive_weights(current), s) != getattr(document, s)]
        if moved:
            raise ScenarioSectionLockedError(moved)
        if document != current:
            await self._record(year, actor, document=document, from_code=from_code, change=describe(current, document))
        return await self._draft(year, actor)

    async def load(
        self,
        year: int,
        actor: str,
        *,
        option: str | None = None,
        trail_row: str | None = None,
        start: StartFrom | None = None,
    ) -> Draft:
        """A kept option, any trail row, or a built-in start into `actor`'s draft, recorded as a trail row of its
        own (§S11.2). A built-in writes no kept option. The rules draft is refused while it matches the rules in
        effect, so a stale screen can't start from it."""
        if sum(source is not None for source in (option, trail_row, start)) != 1:
            raise ScenarioRefusedError("Load one kept option, one trail row or one starting point")
        from_code: str
        if start is not None:
            effect = await self._in_effect(year)
            from_code = start
            if start == "last_rules":  # the merge and its two checks run once: the document and its name
                document, name = await self._last_rules_document(year, effect, words="rules in effect")
                change = f"started from {name}"
            else:
                built = await self._built_in(year, start, effect=effect)
                if start == "rules_draft" and built.document == effect.document:
                    raise ScenarioRefusedError("The rules draft matches the rules in effect")
                document = built.document
                if start == "rules":
                    change = f"started from {self._effect_name(effect)}"
                else:
                    change = f"started from Rules draft v{built.version}"
        elif option is not None:
            found = await self._option(year, option)
            document, from_code, change = found.document, found.code, f"loaded {found.code} into the draft"
        else:
            row = await self._store.trail_row(cast(str, trail_row))
            if row is None or row.year != year or row.document is None:
                raise ScenarioNotFoundError(f"{year} has no trail row {trail_row}")
            document, from_code = row.document, _from(row)
            change = f"loaded {row.actor}'s row of {_when(row)} into the draft"
        current = await self._store.latest_trail(year, actor)
        if current is None or current.document != document or _from(current) != from_code:
            await self._record(year, actor, document=document, from_code=from_code, change=change)
        return await self._draft(year, actor)

    async def keep(self, year: int, actor: str, *, name: str | None = None, starting_point: bool = False) -> KeptOption:
        """Lock `actor`'s recorded draft as the next flat lettered option (§S11.1). The letter counts only starting
        points, so variants kept before PR 10 (A1, B2) never take one: A, A1 and B kept make C next. A blank or
        missing `name` stores the draft's label, cut to the name field. `starting_point` is accepted and ignored
        until PR 12 stops sending it. One operation: the option and the trail row's kept code."""
        del starting_point
        row = await self._store.latest_trail(year, actor)
        if row is None or row.document is None:
            raise ScenarioRefusedError("Your draft is the rules in effect: change a setting before keeping it")
        options = await self._options(year)
        same = next((o for o in options.values() if o.document == row.document), None)
        if same is not None:
            raise ScenarioConflictError(f"Your draft is the same as {same.code}: there is nothing new to keep")
        if row.document == (await self._in_effect(year)).document:
            raise ScenarioRefusedError("Your draft is the rules in effect: change a setting before keeping it")
        source = await self._source(year, _from(row), options, recorded=row.document)
        code = starting_point_code(sum(1 for o in options.values() if not o.starting_point))
        stored = _fit_name((name or "").strip() or describe(source.document, row.document))
        meta = await self._meta(year)
        priced = await (await self._pricer(meta))(row.document)
        mark = AidWrite(
            collection=AID_SCENARIO_TRAIL,
            action="update",
            year=year,
            record_id=row.id,
            before={"kept_code": row.kept_code},
            data={"kept_code": code},
            log_action="keep",
        )
        option = self._option_write(
            year,
            actor,
            code=code,
            starting_point="",
            from_code="" if source.code in BUILT_IN_STARTS else source.code,
            origin_version=source.version,
            name=stored,
            document=row.document,
            priced=priced,
            meta=meta,
        )
        await self._store.commit([option, mark], actor=actor)
        options = await self._options(year)
        return KeptOption(options[code], await self._label(options[code], options), stale=False)

    async def rename(self, year: int, code: str, name: str, actor: str) -> KeptOption:
        """A kept option's name (§S11.1): one 4a operation updating the name only; the document and results stay
        immutable. Kept options are shared by everyone with `rules`, so a rename shows for all of them."""
        cleaned = name.strip()
        if not cleaned:
            raise ScenarioRefusedError("Give it a name")
        options = await self._options(year)
        option = options.get(code)
        if option is None:
            raise ScenarioNotFoundError(f"{year} has no kept option {code}")
        if _fit_name(cleaned) != option.name:
            write = AidWrite(
                collection=AID_SCENARIO_OPTIONS,
                action="update",
                year=year,
                record_id=option.id,
                before={"name": option.name},
                data={"name": _fit_name(cleaned)},
                log_action="rename",
                entity_id=f"{year}:{code}",
            )
            await self._store.commit([write], actor=actor)
            options = await self._options(year)
        renamed = options[code]
        meta = await self._store.latest_snapshot(year)
        label = await self._label(renamed, options, await self._last_rules(year))
        return KeptOption(renamed, label, stale=meta is None or renamed.snapshot != meta.id)

    # --- compare, fit, sensitivity ------------------------------------------------------------------

    async def compare(
        self,
        year: int,
        actor: str,
        codes: Sequence[str],
        *,
        request_set: RequestSetChoice | None = None,
        last_season: bool = False,
        rules: bool = False,
        last_rules: bool = False,
        draft: bool = True,
    ) -> Comparison:
        """Columns in §S5 H's fixed order: the rules in effect, last season's rules on these applications, `actor`'s
        draft, then the kept options asked for, in the order they were kept. Every one is on the current snapshot
        and counts its changes and its requests up / down against the rules in effect (N3, N4); the rules column's
        own up / down is None. `draft` defaults on so today's screen is unchanged; PR 12 sends it. `last_season`
        adds last season's posted money beside them (one live read)."""
        wanted = list(dict.fromkeys(codes))
        if len(wanted) > MAX_COMPARED:
            raise ScenarioRefusedError(f"Compare up to {MAX_COMPARED} kept options beside your draft")
        options = await self._options(year)
        missing = [code for code in wanted if code not in options]
        if missing:
            raise ScenarioNotFoundError(f"{year} has no kept option {', '.join(missing)}")
        meta = await self._meta(year)
        chosen = await self._request_set(year, request_set)
        price = await self._pricer(meta, chosen)
        projector = await self._projector(year, meta, chosen)
        effect = await self._in_effect(year)
        last = await self._last_rules(year)
        seen: dict[str, Priced] = {}

        async def of_document(key: str, document: AidRules) -> Priced:
            if key not in seen:
                seen[key] = await price(document)
            return seen[key]

        async def of_option(option: OptionRecord) -> Priced:
            # A kept option's stored figures are on every request of its own snapshot: reused only when both hold,
            # and only when they carry the committee's rows (SP9b stored none).
            if option.code not in seen:
                seen[option.code] = (
                    Priced(option.results, await self._store.option_round1(option.id))
                    if option.snapshot == meta.id and chosen is None and option.results.committee_rows
                    else await price(option.document)
                )
            return seen[option.code]

        # A kept option that IS the rules in effect, on this snapshot and every request, stores their figures: the
        # rules column and the yardstick read them from it, and the rules are priced only when no such option exists.
        same = next(
            (
                option
                for option in options.values()
                if option.document == effect.document and option.snapshot == meta.id and chosen is None
            ),
            None,
        )

        async def of_effect() -> Priced:
            return await of_option(same) if same is not None else await of_document("rules", effect.document)

        # The yardstick needs only Round 1 by request, which a stored option has even without the committee's rows.
        yardstick = (await of_effect()).round1 if same is None else await self._store.option_round1(same.id)

        def column(code: str, label: str, document: AidRules, priced: Priced, **extra: Any) -> CompareColumn:
            up, down = (None, None) if code == "rules" else up_down(yardstick, priced.round1)
            return CompareColumn(
                code,
                label,
                document,
                _changes(effect.document, document),
                priced.results,
                up,
                down,
                committee=committee_view(priced.results, document),
                projection=projector(priced.results),
                **extra,
            )

        columns: list[CompareColumn] = []
        if rules:
            columns.append(
                column(
                    "rules",
                    f"{self._effect_name(effect)} in effect" if _prices(effect) else self._effect_name(effect),
                    effect.document,
                    await of_effect(),
                    version=effect.version,
                    approved_at=_approved_at(effect) if _prices(effect) else None,
                    via=await self._rules.promoted_via(year, effect.version),
                )
            )
        refused: str | None = None
        if last_rules:
            # The load's two refusals (no approved rules last season; a merge that adds an error) leave this one
            # column out, in the server's words: they never fail the whole compare (disagreement 16).
            try:
                merged, _ = await self._last_rules_document(year, effect, words="rules in effect")
            except ScenarioRefusedError as exc:
                refused = str(exc)
            else:
                if last is not None:  # with no `last`, _last_rules_document has refused
                    label = f"{last.year} rules v{last.version}, on these applications"
                    priced_last = await of_document("last_rules", merged)
                    columns.append(column("last_rules", label, merged, priced_last, version=last.version))
        if draft:
            row = await self._store.latest_trail(year, actor)
            if row is not None and row.document is not None:
                source = await self._source(year, _from(row), options, recorded=row.document, effect=effect)
                priced = await of_document("draft", row.document)
                columns.append(column("draft", describe(source.document, row.document), row.document, priced))
        for code in (code for code in options if code in wanted):
            option = options[code]
            label = await self._label(option, options, last)
            columns.append(column(code, label, option.document, await of_option(option)))
        previous = await self.last_season(year) if last_season else None
        if previous is not None and previous.loaded and chosen is not None:
            # Last season is always its whole season: say so beside columns priced on part of this one (D138).
            previous = replace(previous, label=f"{previous.label}, every request")
        return Comparison(meta, tuple(columns), previous, last_rules_refused=refused)

    async def last_season(self, year: int) -> LastSeason:
        """Last season's posted money by tier, read live (RPT-17's and RPT-32's last-season columns): every round
        posted, counted toward the budget and not clawed back, at its lock, with the table cells of the rules that
        priced it, labelled with its basis and as-of. Only posted money counts: until last season has some (the 2026
        load, January 2027, D67) it is empty and says so, never an estimate."""
        if self._season_read is None:
            raise ScenarioRefusedError("Last season can't be read here")
        season = await self._season_read(year - 1)
        document = season.rules.document if season.rules is not None else None
        posted = posted_season(season.priced.values(), season.rounds, document)
        if not posted.loaded:
            label = f"{year - 1}'s decisions are not loaded yet, so there is no last-season column"
            return LastSeason(year - 1, False, label, None, None)
        version = season.rules.version if season.rules is not None else None
        label = _posted_label(year - 1, posted.as_of)
        budget = season_budget(season.priced.values(), document, outside_grants={})
        return LastSeason(
            year - 1,
            True,
            label,
            version,
            committee_view(posted, document),
            round3=budget.total.rounds[3].posted,
            pools=tuple(_posted_pool(pool) for pool in budget.pools),
            remaining=None
            if budget.total.total.allocated is None
            else budget.total.total.allocated - sum((budget.total.rounds[n].posted for n in (1, 2, 3)), ZERO),
        )

    async def fit(self, year: int, document: AidRules, *, request_set: RequestSetChoice | None = None) -> Fitted:
        """Fit to budget: the largest shift of every Round 1 table cell that keeps the total row's Round 1 Remaining
        (money on a program with no pool included) at or above zero, priced on the frozen season (plan Decision 11 (a), RULED 2026-09-30; D119). The
        tightest pool is named as information only; `budget.spillover` is not read. It refuses a request set (owner
        ruling): the fit sizes Round 1 for every request, so it never runs on part of the season."""
        self._check_year(year, document)
        document = derive_weights(document)
        if request_set is not None:
            raise ScenarioRefusedError("Fit to budget uses every request; turn off the request set.")
        price = await self._pricer(await self._meta(year))

        async def remaining_at(shift: Decimal) -> Decimal:
            return _fit_margin((await price(shift_round1_tables(document, shift))).results)

        found = await fit_tier_shift(remaining_at)
        fitted = shift_round1_tables(document, found.shift)
        priced = await price(fitted)
        evaluation = Evaluation(fitted, priced.results, await self._rules.validate_document(fitted))
        tightest = tightest_pool(priced.results)
        return Fitted(found, tightest.pool if tightest is not None else None, evaluation)

    async def sensitivity(
        self, year: int, document: AidRules, *, request_set: RequestSetChoice | None = None
    ) -> Sensitivity:
        """What one step of each sizing setting moves Round 1 by (spec §7.4), on the frozen season. The
        dollar-for-dollar switch's one step is flipping it (D137)."""
        self._check_year(year, document)
        document = derive_weights(document)
        price = await self._pricer(await self._meta(year), await self._request_set(year, request_set))
        base = (await price(document)).results
        effects: list[LeverEffect] = []
        for lever in SIZING_LEVERS:
            moved = (await price(nudge(document, lever))).results.round1
            on = dollar_for_dollar(document) if lever.step is None else None
            effects.append(LeverEffect(lever, moved - base.round1, on))
        return Sensitivity(base, tuple(effects))

    # --- make it the rules draft --------------------------------------------------------------------

    async def rules_draft_preview(self, year: int, code: str) -> ScenarioPromotion:
        _, _, promotion = await self._promotion(year, code)
        return promotion

    async def make_rules_draft(
        self, year: int, code: str, *, base_version: int, acknowledged: Mapping[SectionName, str], actor: str
    ) -> tuple[RulesDraft, int | None]:
        """ "Make B the rules draft" (D39; §S11.3): refused when it copies a locked section; fixed settings stay as
        the rules draft has them. The rules draft as it is after, and the version it branched from."""
        option, document, _ = await self._promotion(year, code)
        saved = await self._rules.promote(
            year,
            origin_version=option.origin_version,
            document=document,
            base_version=base_version,
            acknowledged=acknowledged,
            actor=actor,
            via=code,
        )
        return await self._rules.draft_view(year), saved.branched_from

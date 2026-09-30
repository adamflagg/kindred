"""Campership scenarios (sub-project 9b; spec §7.4, §7.5; D35–D39, D76; main spec §12.2–§12.3).

One draft per person, kept options and the trail, all over one frozen season:

- **Freeze** (`freeze`) records the season's applications as the live season read sees them
  (financial_aid_scenario_pricing). Every scenario is priced on the newest snapshot; freezing an unchanged season
  writes nothing.
- **The draft** is the person's newest trail row. Releasing a setting (`save_draft`) appends a row with its results,
  who and when; loading an option or any row (`load`) appends one too (neither appends when the draft already is
  that), so nothing is ever lost and nothing asks "discard?" (D38). `evaluate` prices without writing: the live
  preview while a slider moves. The draft is "from" its row's kept code, else the row's from code.
- **Keep** locks the draft as an immutable, unnamed option with a spoken code: a variant (A1, B2) under the starting
  point you work from, or a new starting point (B, C). Two levels, never deeper (D36, D38). "Start from the rules"
  makes a starting point from the rules draft (the latest version).
- **Compare** puts the draft beside up to 4 kept options; **Fit to budget** finds the tier shift that uses Round 1's
  allocation; **sensitivity** is what one step of each sizing setting moves Round 1 by. **Make it the rules draft**
  hands a kept option to the rules service (SP9a's promotion).

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

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal, Protocol

from api.constants.collections import AID_SCENARIO_OPTIONS, AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_TRAIL
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import FIRST_TICKED_SEASON, Season
from api.services.financial_aid_ledger_service import as_of_cutoff
from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
    FinancialAidRulesService,
    PromotionPreview,
    RulesDraft,
    RulesVersion,
)
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, encode_snapshot, price_document
from api.services.financial_aid_scenarios_repository import OptionRecord, SnapshotMeta, TrailRecord
from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.received import split_by_received
from bunking.financial_aid.rules import AidRules, SectionName, ValidationIssue, ValidationReport
from bunking.financial_aid.scenarios import (
    SIZING_LEVERS,
    CommitteeView,
    FitResult,
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
    variant_code,
)

MAX_COMPARED: Final = 4


class ScenarioNotFoundError(FinancialAidError, LookupError):
    """No such kept option or trail row in the season."""


class ScenarioRefusedError(FinancialAidError, ValueError):
    """An action that can't run as asked; the message is safe to show staff."""


class ScenarioConflictError(FinancialAidError, ValueError):
    """The action would duplicate something that exists (a keep that matches a kept option)."""


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


@dataclass(frozen=True)
class Draft:
    trail_id: str
    from_code: str
    document: AidRules
    label: str  # what differs from the option it is from
    changes: tuple[FieldChange, ...]  # the same, setting by setting (the screen's amber)
    results: ScenarioResults | None  # None before any freeze
    report: ValidationReport
    recorded_at: datetime


@dataclass(frozen=True)
class KeptOption:
    record: OptionRecord
    label: str
    stale: bool  # its results are from an older snapshot


@dataclass(frozen=True)
class Workspace:
    year: int
    rules_version: int
    snapshot: SnapshotMeta | None
    draft: Draft | None
    options: tuple[KeptOption, ...]
    pricing_version: int | None = None  # the version pricing the season; None while none does (final review 8)


@dataclass(frozen=True)
class CompareColumn:
    code: str  # "draft" for the draft
    label: str
    document: AidRules
    changes: tuple[FieldChange, ...]  # against its reference: the screen's amber
    results: ScenarioResults
    up: int | None  # requests whose Round 1 is higher than in its reference; None for rules as they were
    down: int | None
    committee: CommitteeView | None = None  # RPT-17 / RPT-32's tables by tier and the budget share (SP9c)


@dataclass(frozen=True)
class LastSeason:
    """Last season's posted money beside the compare (RPT-17's and RPT-32's last-season columns). `view` is None
    until last season has posted money, and `label` then says it is not loaded: never zeros, never an estimate."""

    year: int
    loaded: bool
    label: str
    rules_version: int | None  # the version that priced it; None when it has no approved rules
    view: CommitteeView | None


@dataclass(frozen=True)
class Comparison:
    snapshot: SnapshotMeta
    columns: tuple[CompareColumn, ...]
    last_season: LastSeason | None = None  # only when asked for


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


def _last_season_name(last: RulesVersion, year: int, origin: RulesVersion) -> str:
    """RPT-18's starting point: last season's criteria on this season's applications, the rest from this season's
    rules, named as SP9b names them ("rules draft vN" while that version can't price the season)."""
    return f"{last.year} v{last.version} rules on {year}'s applications, the rest from {_rules_name(origin)}"


def _introduced(before: Sequence[ValidationIssue], after: Sequence[ValidationIssue]) -> list[ValidationIssue]:
    """The errors a merge added: `after`'s that the rules draft did not already have (same section, code, path)."""
    had = {(issue.section, issue.code, issue.path) for issue in before}
    return [issue for issue in after if (issue.section, issue.code, issue.path) not in had]


def _changes(old: AidRules, new: AidRules) -> tuple[FieldChange, ...]:
    return tuple(field_changes(old.model_dump(), new.model_dump()))


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
    ) -> None:
        self._store = store
        self._rules = rules
        self._capture = capture
        self._season_read = season_read

    # --- what every action shares -------------------------------------------------------------------

    async def _meta(self, year: int) -> SnapshotMeta:
        meta = await self._store.latest_snapshot(year)
        if meta is None:
            raise ScenarioRefusedError(f"Freeze {year}'s applications first: every scenario runs on a frozen snapshot")
        return meta

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
        approved = await self._rules.latest_approved(year, ["milestones"])
        deadline = approved.document.milestones.application_deadline if approved is not None else None
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
            # place after the start, and that must not rename it.
            if last is not None and has_last_seasons_criteria(option.document, last.document):
                return _last_season_name(last, option.year, origin)
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
                "document": document.model_dump(mode="json"),
                "results": priced.results.model_dump(mode="json"),
                "round1_by_request": {rid: str(amount) for rid, amount in priced.round1.items()},
                "snapshot": meta.id,
                "actor": actor,
            },
            after={"code": code, "starting_point": starting_point, "from_code": from_code},
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

    async def _draft(self, year: int, actor: str) -> Draft | None:
        row = await self._store.latest_trail(year, actor)
        if row is None or row.document is None:
            return None
        source = (await self._options(year)).get(_from(row))
        if source is None:
            raise ScenarioNotFoundError(f"{year} has no kept option {_from(row)}")
        meta = await self._store.latest_snapshot(year)
        results: ScenarioResults | None = None
        if meta is not None and row.snapshot == meta.id and row.results is not None:
            results = row.results
        elif meta is not None:
            results = (await (await self._pricer(meta))(row.document)).results
        return Draft(
            trail_id=row.id,
            from_code=source.code,
            document=row.document,
            label=describe(source.document, row.document),
            changes=_changes(source.document, row.document),
            results=results,
            report=await self._rules.validate_document(row.document),
            recorded_at=row.created,
        )

    async def _my_draft(self, year: int, actor: str) -> Draft:
        draft = await self._draft(year, actor)
        if draft is None:
            raise ScenarioRefusedError("Load a kept option into your draft first")
        return draft

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
        grants, decision types, programs, cost, budget, stages, quality checks and milestones stay. Refused when last
        season has no approved rules, or when the merge adds a validation error the rules draft did not already have
        (say which; the draft's own errors never block it). When a kept option already is that document, it is
        loaded instead of copied."""
        meta = await self._meta(year)
        last = await self._last_rules(year)
        if last is None:
            raise ScenarioRefusedError(f"{year - 1} has no approved rules to start from: load and approve them first")
        rules = await self._rules.load(year)
        document = last_seasons_criteria(rules.document, last.document)
        introduced = _introduced(
            (await self._rules.validate_document(rules.document)).errors,
            (await self._rules.validate_document(document)).errors,
        )
        if introduced:
            named = "; ".join(f"{issue.path}: {issue.message}" for issue in introduced[:3])
            raise ScenarioRefusedError(
                f"{year - 1}'s criteria don't fit {year}'s rules draft ({named}): start from the rules and edit instead"
            )
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
                change=f"started from {_last_season_name(last, year, rules)}",
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
        meta = await self._store.latest_snapshot(year)
        options = await self._options(year)
        last = await self._last_rules(year)
        kept = [
            KeptOption(
                option, await self._label(option, options, last), stale=meta is None or option.snapshot != meta.id
            )
            for option in options.values()
        ]
        return Workspace(
            year,
            rules.version,
            meta,
            await self._draft(year, actor),
            tuple(kept),
            pricing_version=pricing.version if pricing is not None else None,
        )

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
        moved = apply_sizing(document, tier_shift=tier_shift, band_width_delta=band_width_delta)
        chosen = await self._request_set(year, request_set)
        priced = await (await self._pricer(await self._meta(year), chosen))(moved)
        return Evaluation(moved, priced.results, await self._rules.validate_document(moved))

    async def save_draft(self, year: int, document: AidRules, actor: str) -> Draft:
        """A released setting: the draft becomes `document`, recorded in the trail with what changed."""
        self._check_year(year, document)
        row = await self._store.latest_trail(year, actor)
        if row is None or row.document is None:
            raise ScenarioRefusedError("Load a kept option into your draft first")
        if row.document != document:
            await self._record(
                year, actor, document=document, from_code=_from(row), change=describe(row.document, document)
            )
        return await self._my_draft(year, actor)

    async def load(self, year: int, actor: str, *, option: str | None = None, trail_row: str | None = None) -> Draft:
        """A kept option, or any trail row, into `actor`'s draft, recorded as a trail row of its own."""
        if option is not None and trail_row is None:
            found = await self._option(year, option)
            document, from_code, change = found.document, found.code, f"loaded {found.code} into the draft"
        elif trail_row is not None and option is None:
            row = await self._store.trail_row(trail_row)
            if row is None or row.year != year or row.document is None:
                raise ScenarioNotFoundError(f"{year} has no trail row {trail_row}")
            document, from_code = row.document, _from(row)
            change = f"loaded {row.actor}'s row of {_when(row)} into the draft"
        else:
            raise ScenarioRefusedError("Load one kept option or one trail row")
        current = await self._store.latest_trail(year, actor)
        if current is None or current.document != document or _from(current) != from_code:
            await self._record(year, actor, document=document, from_code=from_code, change=change)
        return await self._my_draft(year, actor)

    async def keep(self, year: int, actor: str, *, starting_point: bool) -> KeptOption:
        """Lock `actor`'s draft as a kept option: a variant under the starting point it is from, or a new starting
        point. One operation: the option and the trail row's kept code."""
        row = await self._store.latest_trail(year, actor)
        if row is None or row.document is None:
            raise ScenarioRefusedError("Load a kept option into your draft first")
        options = await self._options(year)
        same = next((o for o in options.values() if o.document == row.document), None)
        if same is not None:
            raise ScenarioConflictError(f"Your draft is the same as {same.code}: there is nothing new to keep")
        source = options.get(_from(row))
        if source is None:
            raise ScenarioNotFoundError(f"{year} has no kept option {_from(row)}")
        if starting_point:
            head = ""
            code = starting_point_code(sum(1 for o in options.values() if not o.starting_point))
        else:
            head = source.starting_point or source.code
            code = variant_code(head, sum(1 for o in options.values() if o.starting_point == head))
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
            starting_point=head,
            from_code=source.code,
            origin_version=source.origin_version,
            document=row.document,
            priced=priced,
            meta=meta,
        )
        await self._store.commit([option, mark], actor=actor)
        options = await self._options(year)
        return KeptOption(options[code], await self._label(options[code], options), stale=False)

    # --- compare, fit, sensitivity ------------------------------------------------------------------

    async def compare(
        self,
        year: int,
        actor: str,
        codes: Sequence[str],
        *,
        request_set: RequestSetChoice | None = None,
        last_season: bool = False,
    ) -> Comparison:
        """`actor`'s draft first, then up to 4 kept options, every one on the current snapshot. Each shows what
        differs from its reference (a variant's starting point; a starting point's origin rules; the draft's
        option), how many requests' Round 1 went up or down against it, and the committee's tables (RPT-17, RPT-32).
        `last_season` adds last season's posted money beside them (one live read of last season)."""
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
        last = await self._last_rules(year)
        seen: dict[str, Priced] = {}

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

        async def round1_of(option: OptionRecord) -> dict[str, Decimal]:
            # A reference needed only for up/down: its stored Round 1 by request is enough when it is on this
            # snapshot and every request, committee rows or not (SP9b's kept options are never priced for them).
            if option.code in seen:
                return seen[option.code].round1
            if option.snapshot == meta.id and chosen is None:
                return await self._store.option_round1(option.id)
            return (await of_option(option)).round1

        async def of_rules(version: int) -> Priced:
            key = f"rules v{version}"
            if key not in seen:
                seen[key] = await price((await self._rules.load(year, version)).document)
            return seen[key]

        columns: list[CompareColumn] = []
        row = await self._store.latest_trail(year, actor)
        if row is not None and row.document is not None:
            source = options.get(_from(row))
            if source is None:
                raise ScenarioNotFoundError(f"{year} has no kept option {_from(row)}")  # as the draft read does
            mine = await price(row.document)
            up, down = up_down(await round1_of(source), mine.round1)
            columns.append(
                CompareColumn(
                    "draft",
                    describe(source.document, row.document),
                    row.document,
                    _changes(source.document, row.document),
                    mine.results,
                    up,
                    down,
                    committee=committee_view(mine.results, row.document),
                )
            )
        for code in wanted:
            option = options[code]
            priced = await of_option(option)
            reference = await self._reference(option, options)
            up_or_down: tuple[int | None, int | None] = (None, None)  # a start from the rules: nothing to be up from
            if option.from_code:
                against = (
                    await round1_of(options[option.starting_point])
                    if option.starting_point
                    else (await of_rules(option.origin_version)).round1
                )
                up_or_down = up_down(against, priced.round1)
            columns.append(
                CompareColumn(
                    code,
                    await self._label(option, options, last),
                    option.document,
                    _changes(reference, option.document),
                    priced.results,
                    *up_or_down,
                    committee=committee_view(priced.results, option.document),
                )
            )
        previous = await self.last_season(year) if last_season else None
        if previous is not None and previous.loaded and chosen is not None:
            # Last season is always its whole season: say so beside columns priced on part of this one (D138).
            previous = replace(previous, label=f"{previous.label}, every request")
        return Comparison(meta, tuple(columns), previous)

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
        return LastSeason(year - 1, True, label, version, committee_view(posted, document))

    async def fit(self, year: int, document: AidRules, *, request_set: RequestSetChoice | None = None) -> Fitted:
        """Fit to budget: the largest shift of every Round 1 table cell that keeps the total row's Round 1 Remaining
        (money on a program with no pool included) at or above zero, priced on the frozen season (plan Decision 11 (a), RULED 2026-09-30; D119). The
        tightest pool is named as information only; `budget.spillover` is not read. It refuses a request set (owner
        ruling): the fit sizes Round 1 for every request, so it never runs on part of the season."""
        self._check_year(year, document)
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
        price = await self._pricer(await self._meta(year), await self._request_set(year, request_set))
        base = (await price(document)).results
        effects: list[LeverEffect] = []
        for lever in SIZING_LEVERS:
            moved = (await price(nudge(document, lever))).results.round1
            on = dollar_for_dollar(document) if lever.step is None else None
            effects.append(LeverEffect(lever, moved - base.round1, on))
        return Sensitivity(base, tuple(effects))

    # --- make it the rules draft --------------------------------------------------------------------

    async def rules_draft_preview(self, year: int, code: str) -> PromotionPreview:
        option = await self._option(year, code)
        return await self._rules.promotion_preview(year, origin_version=option.origin_version, document=option.document)

    async def make_rules_draft(
        self, year: int, code: str, *, base_version: int, acknowledged: Mapping[SectionName, str], actor: str
    ) -> tuple[RulesDraft, int | None]:
        """ "Make B2 the rules draft" (D39): the rules draft as it is after, and the version it branched from."""
        option = await self._option(year, code)
        saved = await self._rules.promote(
            year,
            origin_version=option.origin_version,
            document=option.document,
            base_version=base_version,
            acknowledged=acknowledged,
            actor=actor,
            via=code,
        )
        return await self._rules.draft_view(year), saved.branched_from

"""Campership scenarios (sub-project 9b; spec §7.4, §7.5; D35–D39, D76; main spec §12.2–§12.3).

One draft per person, kept options and the trail, all over one frozen season:

- **Freeze** (`freeze`) records the season's applications as the live season read sees them
  (financial_aid_scenario_pricing). Every scenario is priced on the newest snapshot; freezing an unchanged season
  writes nothing.
- **The draft** is the person's newest trail row. Releasing a setting (`save_draft`) appends a row with its results,
  who and when; loading an option or any row (`load`) appends one too, so nothing is ever lost and nothing asks
  "discard?" (D38). `evaluate` prices without writing: the live preview while a slider moves. The draft is "from"
  its row's kept code, else the row's from code.
- **Keep** locks the draft as an immutable, unnamed option with a spoken code: a variant (A1, B2) under the starting
  point you work from, or a new starting point (B, C). Two levels, never deeper (D36, D38). "Start from the rules"
  makes a starting point from the rules draft (the latest version).
- **Compare** puts the draft beside up to 4 kept options; **Fit to budget** finds the tier shift that uses Round 1's
  allocation; **sensitivity** is what one step of each sizing setting moves Round 1 by. **Make it the rules draft**
  hands a kept option to the rules service (SP9a's promotion).

Kept options and the trail are shared by everyone with financial_aid.rules; the draft is per person. Nothing here
writes live awards. Every write is one 4a operation whose log rows carry a summary, never a document or the frozen
inputs (plan Decision 15).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import AID_SCENARIO_OPTIONS, AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_TRAIL
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_rules_service import FinancialAidRulesService
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, encode_snapshot, price_document
from api.services.financial_aid_scenarios_repository import OptionRecord, SnapshotMeta, TrailRecord
from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules import AidRules, ValidationReport
from bunking.financial_aid.scenarios import (
    ScenarioResults,
    apply_sizing,
    describe,
    round1_by_request,
    scenario_results,
    starting_point_code,
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


def _from(row: TrailRecord) -> str:
    return row.kept_code or row.from_code


def _season_of(encoded: Mapping[str, Any]) -> dict[str, Any]:
    """An encoded snapshot without the moment it was frozen: what "the season hasn't moved" compares."""
    return {key: value for key, value in encoded.items() if key != "frozen_at"}


def _changes(old: AidRules, new: AidRules) -> tuple[FieldChange, ...]:
    return tuple(field_changes(old.model_dump(), new.model_dump()))


def _when(row: TrailRecord) -> str:
    local = row.created.astimezone(CAMP_TZ)
    return f"{local:%b} {local.day} {local:%H:%M}"


class FinancialAidScenariosService:
    def __init__(self, store: ScenarioStore, rules: FinancialAidRulesService, capture: SeasonCapture) -> None:
        self._store = store
        self._rules = rules
        self._capture = capture

    # --- what every action shares -------------------------------------------------------------------

    async def _meta(self, year: int) -> SnapshotMeta:
        meta = await self._store.latest_snapshot(year)
        if meta is None:
            raise ScenarioRefusedError(f"Freeze {year}'s applications first: every scenario runs on a frozen snapshot")
        return meta

    async def _pricer(self, meta: SnapshotMeta) -> Pricer:
        snapshot = await self._store.snapshot_inputs(meta.id)
        base = await self._rules.load(meta.year)

        async def price(document: AidRules) -> Priced:
            priced = await price_document(snapshot, document, base)
            requests = list(priced.season.priced.values())
            return Priced(scenario_results(requests, priced.budget), round1_by_request(requests))

        return price

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

    async def _label(self, option: OptionRecord, options: Mapping[str, OptionRecord]) -> str:
        if not option.from_code:
            return f"rules v{option.origin_version} as they were"
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

    async def freeze(self, year: int, actor: str) -> SnapshotMeta:
        """Freeze the season's applications as they are now; nothing is written when they haven't moved."""
        captured = await self._capture(year)
        encoded = encode_snapshot(captured)
        latest = await self._store.latest_snapshot(year)
        if latest is not None and _season_of(
            encode_snapshot(await self._store.snapshot_inputs(latest.id))
        ) == _season_of(encoded):
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
                change=f"started from rules v{rules.version}",
                results=priced.results,
                meta=meta,
                kept_code=code,
            ),
        ]
        await self._store.commit(writes, actor=actor)
        return await self.workspace(year, actor)

    async def workspace(self, year: int, actor: str) -> Workspace:
        rules = await self._rules.load(year)
        meta = await self._store.latest_snapshot(year)
        options = await self._options(year)
        kept = [
            KeptOption(option, await self._label(option, options), stale=meta is None or option.snapshot != meta.id)
            for option in options.values()
        ]
        return Workspace(year, rules.version, meta, await self._draft(year, actor), tuple(kept))

    async def trail(self, year: int, *, page: int, per_page: int) -> tuple[tuple[TrailRecord, ...], int]:
        rows, total = await self._store.trail_page(year, page, per_page)
        return tuple(rows), total

    # --- the draft ----------------------------------------------------------------------------------

    async def evaluate(
        self, year: int, document: AidRules, *, tier_shift: Decimal = ZERO, band_width_delta: Decimal = ZERO
    ) -> Evaluation:
        """`document` with the relative sizing settings applied, priced on the frozen season. Writes nothing."""
        self._check_year(year, document)
        moved = apply_sizing(document, tier_shift=tier_shift, band_width_delta=band_width_delta)
        priced = await (await self._pricer(await self._meta(year)))(moved)
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

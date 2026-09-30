"""Financial-aid rules: the versioned per-season documents in `aid_rules` (campership design section 7).

Reads and writes go through FastAPI's superuser client: all five PocketBase rules
on `aid_rules` are null, so nothing else can reach the table. The routes in
api/routers/financial_aid.py gate every call on `financial_aid.rules`; this
module does no permission check of its own.

A version is (year, version). Each section has its own lifecycle
(bunking.financial_aid.rules.lifecycle): saving a change to an approved section
sends it back to draft, and a change to a locked section is refused -- that
change needs a new version. Because sections refer to each other, `save` judges
the whole document after the edit: an approved section the edit leaves with
validation errors also goes back to draft (each such change is recorded), and
an edit that would give a locked section new errors is refused. A draft with
validation errors still saves, and the report comes back with it, so staff see
what is wrong; approval and locking are what errors block.

A write to `save`, `approve_section` or `lock_section` targets a specific
version; if that version is no longer the latest for its year, the write is
refused with `NotLatestVersionError` -- an older version is read-only once a
newer one exists. `new_version` is the one write that is allowed to branch from
an older version on purpose (a "what changed since" comparison, or picking up a
draft that was not the last one made); its result always becomes the new latest.

Every write commits through the store's `commit` (sub-project 4a's
commit_aid_writes): the aid_rules write and its aid_change_log row in ONE
PocketBase batch, one operation per call, so a rules change is never saved
without its log row or logged without being saved (spec 4.11, 14.4). The log's
entity is aid_rules and its entity_id "year:version", or "year:version:section"
for an approval or a lock; an approval's note, which names the approving body
(D39), is its reason. A save that sends approved sections back to draft logs
that in the same row, as the section_status change.

Every refusal raised here subclasses FinancialAidError, so a router can map
them with one `except` without catching pydantic's ValidationError.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Collection, Sequence
from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict

from api.constants.collections import AID_RULES, CAMP_SESSIONS
from api.services.financial_aid_change_log_reads import fetch_change_log
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.change_replay import LogRow, replay
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import (
    AidRules,
    SectionName,
    SessionRef,
    ValidationContext,
    ValidationIssue,
    ValidationReport,
    validate_rules,
)
from bunking.financial_aid.rules.lifecycle import (
    DocumentHasErrorsError,
    SectionNotApprovedError,
    SectionStatus,
    SectionStatusMissingError,
    StatusMap,
    apply_edit,
    approve,
    carry_forward,
    initial_status,
    lock,
    status_from_json,
    status_to_json,
)
from bunking.financial_aid.rules.schema import SECTION_NAMES, MilestonesSection
from bunking.pocketbase_batch import BatchRequestFailedError

# Rows per request for every paged read; PocketBase clamps anything above 1000.
PAGE_SIZE = 1000
# Every paged read ends its sort on the record id: LIMIT/OFFSET paging without a
# total order can skip or repeat a row.
STABLE_SORT = "id"


class RulesNotFoundError(FinancialAidError, LookupError):
    """No aid_rules row for the year (and version) asked for."""


class VersionExistsError(FinancialAidError, ValueError):
    """The year already has rules; "start from last year" only starts an empty season."""


class YearMismatchError(FinancialAidError, ValueError):
    """The document's year is not the year it is being saved under."""


class NotLatestVersionError(FinancialAidError, ValueError):
    """A write targeted a version that is no longer the latest for its year.

    An older version is read-only once a newer one exists -- branch from the
    latest version instead (`new_version`).
    """


class NoSectionsNamedError(FinancialAidError, ValueError):
    """An approval must name at least one section."""


class RulesHistoryIncompleteError(FinancialAidError, LookupError):
    """A rules version's change history can't be replayed to the instant asked for (the as-of reads)."""


class RulesVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    record_id: str
    year: int
    version: int
    document: AidRules
    section_status: dict[SectionName, SectionStatus]
    parent_year: int | None
    parent_version: int | None


class AidRulesStore(Protocol):
    async def list_versions(self, year: int) -> list[Any]: ...

    async def fetch_version(self, year: int, version: int) -> Any | None: ...

    async def fetch_session_refs(self, year: int) -> list[SessionRef]: ...

    async def fetch_log(self, year: int) -> list[LogRow]: ...

    async def commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None
    ) -> AidOperationResult: ...


class AidRulesRepository:
    """PocketBase access for aid_rules (and the season's sessions, for validation)."""

    def __init__(self, pb: Any, *, read_only: bool = False) -> None:
        self.pb = pb
        # Intake reads approved rules and must never write them.
        self._read_only = read_only

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await asyncio.to_thread(
            self.pb.collection(collection).get_full_list, batch=PAGE_SIZE, query_params=query_params
        )
        return rows

    async def list_versions(self, year: int) -> list[Any]:
        return await self._page(AID_RULES, {"filter": f"year = {int(year)}", "sort": f"version,{STABLE_SORT}"})

    async def fetch_version(self, year: int, version: int) -> Any | None:
        rows = await self._page(
            AID_RULES, {"filter": f"year = {int(year)} && version = {int(version)}", "sort": STABLE_SORT}
        )
        return rows[0] if rows else None

    async def fetch_session_refs(self, year: int) -> list[SessionRef]:
        rows = await self._page(
            CAMP_SESSIONS,
            {"filter": f"year = {int(year)}", "fields": "id,cm_id,session_type,name", "sort": f"cm_id,{STABLE_SORT}"},
        )
        return [
            SessionRef(
                cm_id=int(row.cm_id),
                session_type=getattr(row, "session_type", None) or None,
                name=getattr(row, "name", None) or None,
            )
            for row in rows
        ]

    async def fetch_log(self, year: int) -> list[LogRow]:
        return await fetch_change_log(self.pb, year, AID_RULES)

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        """Each write and its aid_change_log row in ONE PocketBase batch (sub-project 4a, spec 14.4).

        A unique-index collision on (year, version) arrives from the batch as a 400 whose
        field errors say "Value must be unique."; the batch helper keeps PocketBase's message
        but not its code, so the message is what is matched. Anything else about the body was
        already validated (a real AidRules document, a computed version), so it propagates.
        """
        if self._read_only:
            raise RuntimeError("this repository only reads aid_rules")
        try:
            return await asyncio.to_thread(commit_aid_writes, self.pb, writes, actor=actor, reason=reason)
        except BatchRequestFailedError as exc:
            if exc.status == 400 and any("unique" in message.lower() for message in exc.field_errors.values()):
                first_create = next((w for w in writes if w.action == "create" and w.data is not None), None)
                if first_create is not None and first_create.data is not None:
                    raise VersionExistsError(
                        f"aid_rules already has year {first_create.year} version {first_create.data.get('version')}"
                    ) from exc
                raise VersionExistsError("aid_rules already has that year and version") from exc
            raise


def _json_object(record: Any, field: str) -> dict[str, Any] | None:
    """One PB JSON field, normalised to the dict it always logically is.

    Mirrors `lodging_write_service._json_list`: the Python SDK's own HTTP client
    hands back a native `dict` through `pb.collection(...).get_full_list`/`create`,
    but a mock repository (this file's own tests, or a caller building a
    `AidRulesStore` some other way) can hand over a `SimpleNamespace` straight
    through, or a differently-configured client can still hand back the
    column's raw serialised string.
    """
    value = getattr(record, field, None)
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else None
    return None if value is None else dict(value)


def _to_version(record: Any) -> RulesVersion:
    # PocketBase returns 0 for an unset number field; 0 means "no parent" here.
    parent_year = int(getattr(record, "parent_year", 0) or 0)
    parent_version = int(getattr(record, "parent_version", 0) or 0)
    return RulesVersion(
        record_id=str(record.id),
        year=int(record.year),
        version=int(record.version),
        document=AidRules.model_validate(_json_object(record, "document") or {}),
        section_status=status_from_json(_json_object(record, "section_status")),
        parent_year=parent_year or None,
        parent_version=parent_version or None,
    )


def _body(
    year: int,
    version: int,
    document: AidRules,
    status: StatusMap,
    *,
    parent_year: int | None,
    parent_version: int | None,
) -> dict[str, Any]:
    return {
        "year": year,
        "version": version,
        "document": document.model_dump(mode="json"),
        "section_status": status_to_json(status),
        "parent_year": parent_year or 0,
        "parent_version": parent_version or 0,
    }


def _entity_id(year: int, version: int, section: SectionName | None = None) -> str:
    return f"{year}:{version}" if section is None else f"{year}:{version}:{section}"


def _version_key(row: LogRow) -> str:
    """A version's log rows: "year:version", and its section approvals and locks, "year:version:section"."""
    return ":".join(row.entity_id.split(":")[:2])


def _stored(version: RulesVersion) -> dict[str, Any]:
    """The record's two JSON fields as they are stored: a log row's `before`."""
    return {"document": _dump(version.document), "section_status": status_to_json(version.section_status)}


def _status_write(
    current: RulesVersion,
    before: StatusMap,
    after: StatusMap,
    section: SectionName,
    *,
    log_action: str,
    reason: str | None,
) -> AidWrite:
    return AidWrite(
        collection=AID_RULES,
        action="update",
        year=current.year,
        record_id=current.record_id,
        before={"section_status": status_to_json(before)},
        data={"section_status": status_to_json(after)},
        log_action=log_action,
        entity_id=_entity_id(current.year, current.version, section),
        reason=reason,
    )


class FinancialAidRulesService:
    def __init__(self, store: AidRulesStore, *, clock: Callable[[], datetime] | None = None) -> None:
        self._store = store
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def load(self, year: int, version: int | None = None) -> RulesVersion:
        """One version, or the year's highest version when `version` is None."""
        if version is None:
            rows = await self._store.list_versions(year)
            if not rows:
                raise RulesNotFoundError(f"No aid rules for {year}")
            return _to_version(rows[-1])
        record = await self._store.fetch_version(year, version)
        if record is None:
            raise RulesNotFoundError(f"No aid rules for {year} version {version}")
        return _to_version(record)

    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None:
        """The newest version of `year` in which every section in `sections` is approved or
        locked, or None when no version has them all. A newer version whose section went back to
        draft is skipped for the one before it: readers that must never act on a draft (intake)
        use this, not load()."""
        for row in reversed(await self._store.list_versions(year)):
            version = _to_version(row)
            if all(version.section_status[name].state in ("approved", "locked") for name in sections):
                return version
        return None

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        """The version that priced `year` at the instant `at` (the as-of reads, 3c): each version's
        document and section statuses replayed from aid_change_log to `at` (every create, save,
        approval and lock is logged with its before and after, 4a), then latest_approved's rule. A
        later edit, re-approval or new version changes nothing earlier. A version whose history
        can't be replayed raises rather than letting an older version answer in its place."""
        # `current` settles two same-instant rows that changed the same field with nothing after them.
        # list_versions is read BEFORE fetch_log, so `current` never runs ahead of the log.
        current = {
            _entity_id(year, int(row.version)): {
                "document": _json_object(row, "document"),
                "section_status": _json_object(row, "section_status"),
            }
            for row in await self._store.list_versions(year)
        }
        log = await self._store.fetch_log(year)
        made = {_version_key(row) for row in log if row.before is None and row.entity_id == _version_key(row)}
        replayed = replay(log, as_of=at, key=_version_key, current=current)
        for name in sorted({*replayed, *current}, key=lambda k: int(k.split(":")[1]), reverse=True):
            version = replayed.get(name)
            if version is None:
                # No row by `at`: legitimately made later, unless its create row is missing altogether.
                if name in made:
                    continue
                raise RulesHistoryIncompleteError(f"aid_rules {name}: its change history has no create to replay from")
            if not version.complete:
                raise RulesHistoryIncompleteError(f"aid_rules {name}: its change history can't be replayed to {at}")
            state = version.state
            if state is None:
                continue  # deleted by `at`
            try:
                status = status_from_json(state.get("section_status"))
                if not all(status[section].state in ("approved", "locked") for section in sections):
                    continue
                return RulesVersion(
                    record_id="",  # rebuilt from the log; read-only
                    year=int(state["year"]),
                    version=int(state["version"]),
                    document=AidRules.model_validate(state.get("document") or {}),
                    section_status=status,
                    parent_year=int(state.get("parent_year") or 0) or None,
                    parent_version=int(state.get("parent_version") or 0) or None,
                )
            except (SectionStatusMissingError, KeyError, TypeError, ValueError) as exc:
                # ValueError covers pydantic's ValidationError
                raise RulesHistoryIncompleteError(f"aid_rules {name}: its replayed state is malformed") from exc
        return None

    async def validate_document(self, document: AidRules) -> ValidationReport:
        """Validation against the season's synced sessions. A season with none synced
        warns (no_sessions_to_check) rather than passing the coverage check silently."""
        return validate_rules(document, await self._context(document.year))

    async def _context(self, year: int) -> ValidationContext:
        return ValidationContext(sessions=await self._store.fetch_session_refs(year))

    async def validate(self, year: int, version: int) -> ValidationReport:
        return await self.validate_document((await self.load(year, version)).document)

    async def create_version(self, document: AidRules, *, actor: str) -> RulesVersion:
        version = await self._next_version(document.year)
        body = _body(document.year, version, document, initial_status(), parent_year=None, parent_version=None)
        return await self._create(body, log_action="create", actor=actor)

    async def bootstrap(self, document: AidRules, *, actor: str) -> RulesVersion:
        """Version 1 of a season that has no rules yet, from a whole document (loading 2026 as history).
        Refused when the season already has rules: a retried load must not make a second version, and
        every later change is a save over the latest version (owner ruling 2026-09-28)."""
        if await self._store.list_versions(document.year):
            raise VersionExistsError(f"{document.year} already has aid rules; save over the latest version instead")
        return await self.create_version(document, actor=actor)

    async def save(
        self, year: int, version: int, document: AidRules, *, actor: str
    ) -> tuple[RulesVersion, ValidationReport]:
        if document.year != year:
            raise YearMismatchError(f"The document is for {document.year}, not {year}")
        current = await self.load(year, version)
        await self._assert_latest(year, current.version)
        context = await self._context(year)
        before = validate_rules(current.document, context)
        report = validate_rules(document, context)
        outcome = apply_edit(current.document, document, current.section_status, before=before, after=report)
        stored = _stored(current)
        data = {"document": _dump(document), "section_status": status_to_json(outcome.status)}
        if data == stored:
            return current, report  # nothing changed: nothing to write or log
        write = AidWrite(
            collection=AID_RULES,
            action="update",
            year=year,
            record_id=current.record_id,
            before=stored,
            data=data,
            log_action="save",
            entity_id=_entity_id(year, current.version),
        )
        await self._store.commit([write], actor=actor)
        return await self.load(year, current.version), report

    async def approve_section(
        self, year: int, version: int, section: SectionName, *, actor: str, note: str | None
    ) -> tuple[RulesVersion, ValidationReport]:
        return await self.approve_sections(year, version, [section], actor=actor, note=note)

    async def approve_sections(
        self, year: int, version: int, sections: Sequence[SectionName], *, actor: str, note: str | None
    ) -> tuple[RulesVersion, ValidationReport]:
        """Approve `sections` as ONE operation: a log row per section, the note (naming the
        approving body, D39) as each row's reason. All or nothing: every approval is checked
        before anything is sent, so one section that cannot be approved stops them all.
        The report comes back so its warnings (no_sessions_to_check) reach the approver."""
        named = list(dict.fromkeys(sections))
        if not named:
            raise NoSectionsNamedError("Name at least one section to approve")
        current = await self.load(year, version)
        await self._assert_latest(year, current.version)
        report = await self.validate_document(current.document)
        at = self._clock()
        status = current.section_status
        writes: list[AidWrite] = []
        for section in named:
            updated = approve(status, section, by=actor, at=at, note=note, report=report)
            writes.append(_status_write(current, status, updated, section, log_action="approve", reason=note))
            status = updated
        await self._store.commit(writes, actor=actor, reason=note)
        return await self.load(year, current.version), report

    async def lock_section(self, year: int, version: int, section: SectionName, *, actor: str) -> RulesVersion:
        """Lock an approved section; refused while the document has any validation error."""
        current = await self.load(year, version)
        await self._assert_latest(year, current.version)
        report = await self.validate_document(current.document)
        status = lock(current.section_status, section, at=self._clock(), report=report)
        if status == current.section_status:
            return current  # already locked: nothing to write
        write = _status_write(current, current.section_status, status, section, log_action="lock", reason=None)
        await self._store.commit([write], actor=actor)
        return await self.load(year, current.version)

    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]:
        """The writes that lock `sections` of `version` when a round that read them is first posted
        (spec §7.5, sub-project 10a), for the caller to commit in the SAME operation as the tick.

        A section already locked needs no write. Nothing locks on a version that is no longer the
        latest (it is read-only already), so every section it wanted comes back not locked. A
        section that can't lock (not approved, or the document has a validation error) is returned
        in the second list: the tick still stands, and says so.
        """
        current = await self.load(year, version)
        wanted = [s for s in SECTION_NAMES if s in sections and current.section_status[s].state != "locked"]
        if not wanted:
            return [], []
        if await self._latest_version_number(year) != version:
            return [], wanted
        report = await self.validate_document(current.document)
        at = self._clock()
        status = current.section_status
        writes: list[AidWrite] = []
        not_locked: list[SectionName] = []
        for section in wanted:
            try:
                updated = lock(status, section, at=at, report=report)
            except SectionNotApprovedError, DocumentHasErrorsError:
                not_locked.append(section)
                continue
            writes.append(_status_write(current, status, updated, section, log_action="lock", reason=None))
            status = updated
        return writes, not_locked

    async def new_version(
        self, year: int, from_version: int, *, actor: str, unlock: Collection[SectionName] = ()
    ) -> RulesVersion:
        """Copy `from_version`'s document, approvals and locks into a new, latest version,
        lifting only the locks named in `unlock` (lifecycle.carry_forward).

        `from_version` need not be the current latest -- branching from an older
        version on purpose is the one write this module allows on a superseded
        version, and its result becomes the new latest.
        """
        source = await self.load(year, from_version)
        version = await self._next_version(year)
        body = _body(
            year,
            version,
            source.document,
            carry_forward(source.section_status, unlock=unlock),
            parent_year=year,
            parent_version=from_version,
        )
        return await self._create(body, log_action="new_version", actor=actor)

    async def start_from_last_year(self, year: int, *, actor: str) -> tuple[RulesVersion, ValidationReport]:
        """Copy the previous season's latest version into an empty season, every section draft.

        Milestone dates are cleared: they belong to a season. Tuition and family-camp
        rates are cleared too, with a warning on the report: they are keyed by
        CampMinder session id, and CampMinder reuses session ids across years, so a
        carried price would silently price this year's session of the same id at last
        year's rate. Approvals are not carried: a new season's rules go to the board again.
        """
        if await self._store.list_versions(year):
            raise VersionExistsError(f"{year} already has aid rules; make a new version instead")
        prior = await self.load(year - 1)
        cost = prior.document.cost.model_copy(update={"tuition": {}, "family_rates": []})
        document = prior.document.model_copy(update={"year": year, "milestones": MilestonesSection(), "cost": cost})
        body = _body(year, 1, document, initial_status(), parent_year=prior.year, parent_version=prior.version)
        created = await self._create(body, log_action="start_from_last_year", actor=actor)
        report = await self.validate_document(created.document)
        cleared = ValidationIssue(
            section="cost",
            code="prices_cleared_for_new_season",
            severity="warning",
            path="cost.tuition",
            message=(
                f"Tuition and family-camp rates were not carried from {prior.year}: session ids are reused "
                f"across years, so enter {year}'s prices"
            ),
        )
        return created, ValidationReport(issues=[cleared, *report.issues])

    async def _create(self, body: dict[str, Any], *, log_action: str, actor: str) -> RulesVersion:
        year, version = int(body["year"]), int(body["version"])
        write = AidWrite(
            collection=AID_RULES,
            action="create",
            year=year,
            data=body,
            log_action=log_action,
            entity_id=_entity_id(year, version),
        )
        await self._store.commit([write], actor=actor)
        return await self.load(year, version)

    async def _latest_version_number(self, year: int) -> int | None:
        rows = await self._store.list_versions(year)
        return int(rows[-1].version) if rows else None

    async def _assert_latest(self, year: int, version: int) -> None:
        # NOT atomic with the write that follows it: this read and that write are
        # two separate PocketBase round trips, so a `new_version` that lands in
        # between can still slip a write through against a version that was
        # latest when this check ran but is not by the time the write does.
        # Accepted for a single-user staff tool (campership design section 7);
        # the unique index on (year, version) is what actually protects a
        # concurrent `create` from a torn write, not this check.
        latest = await self._latest_version_number(year)
        if latest != version:
            raise NotLatestVersionError(
                f"Version {version} of {year} is not the latest version ({latest}); "
                "branch from the latest version instead"
            )

    async def _next_version(self, year: int) -> int:
        latest = await self._latest_version_number(year)
        return (latest or 0) + 1


def _dump(document: AidRules) -> dict[str, Any]:
    return document.model_dump(mode="json")

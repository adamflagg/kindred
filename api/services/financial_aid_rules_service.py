"""Financial-aid rules: the versioned per-season documents in `aid_rules` (campership design section 7).

Reads and writes go through FastAPI's superuser client: all five PocketBase rules
on `aid_rules` are null, so nothing else can reach the table. The routes in
api/routers/financial_aid.py gate every call on `financial_aid.rules`, except
D76's approved read (`approved_view`), which needs `financial_aid.view`; this
module does no permission check of its own.

A version is (year, version). Each section has its own lifecycle (bunking.financial_aid.rules.lifecycle): saving a
change to an approved section sends it back to draft, and a change to a locked section is refused -- that change
needs a new version. Because sections refer to each other, `save` judges
the whole document after the edit: an approved section the edit leaves with
validation errors also goes back to draft (each such change is recorded), and
an edit that would give a locked section new errors is refused. A draft with
validation errors still saves, and the report comes back with it, so staff see
what is wrong; approval and locking are what errors block. (On the version
pricing the season, SP9 refuses such a save rather than send approved sections
back to draft: see below.)

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

SP9 adds the rules draft: `save_sections` (the section editors' and a promotion's save, which never overwrites an
approved or locked section in use: see `_protected`), a
first lock that reaches an open rules draft (`lock_writes`), the Rules tab's `draft_view`, D76's `approved_view`, and
`promotion_preview` / `promote` ("Make B2 the rules draft"). The whole-document `save` refuses to touch an approved
section of the version pricing the season, or of programs and cost on the version intake reads
(`PricingVersionInUseError`).

Every refusal raised here subclasses FinancialAidError, so a router can map
them with one `except` without catching pydantic's ValidationError.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final, Literal, Protocol

from pydantic import BaseModel, ConfigDict, ValidationError

from api.constants.collections import AID_RULES, CAMP_SESSIONS
from api.services.financial_aid_change_log_reads import fetch_change_log
from api.services.financial_aid_intake_types import INTAKE_RULES_SECTIONS
from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.change_log import AidGuard, AidOperationResult, AidWrite, commit_aid_writes
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
    changed_sections,
    initial_status,
    lock,
    stamp_edits,
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

# The sections a decision is priced by (sub-project 10a): pricing uses the newest version in which every one
# is approved or locked. Moved here from the decisions service by SP9, which needs it to know which version
# prices the season (a save of an approved or locked section there always branches; D76's approved read serves
# the pricing sections from that version).
PRICING_SECTIONS: Final[tuple[SectionName, ...]] = (
    "income",
    "tiers",
    "equity",
    "award_tables",
    "programs",
    "cost",
    "grants",
    "awards",
    "round2",
    "round3",
    "budget",
    "quality_checks",  # pricing reads the hold-check thresholds, so a draft's settings must not hold live requests
)


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


class PricingVersionInUseError(FinancialAidError, ValueError):
    """A whole-document save would change an approved or locked section of a version that is read for it (the whole
    version when it prices the season, programs and cost when only intake reads it); the section editor branches a
    new version instead."""


class ReplacementNotAcknowledgedError(FinancialAidError, ValueError):
    """A promotion would replace changes the person did not confirm replacing (D39's warning)."""

    def __init__(self, sections: list[SectionName]) -> None:
        super().__init__(
            "This option replaces other changes in the rules draft's "
            + ", ".join(sections)
            + ": confirm each of those sections to replace them"
        )
        self.sections = sections


ReplacementKind = Literal["unapproved_edit", "changed_since"]


@dataclass(frozen=True)
class ReplacementWarning:
    """unapproved_edit: someone's change not yet approved (who, when, from which option); changed_since: an
    approved change made after the option's starting point, which the option would undo (who approved it)."""

    kind: ReplacementKind
    by: str | None
    at: datetime | None
    via: str | None
    # Stands for exactly what the preview showed: the rules draft's copy of the section (content and edit stamps) and
    # the option's. `promote` accepts an acknowledgement only with this token, so a re-edit since the preview, or a
    # different option, invalidates it.
    token: str = ""


@dataclass(frozen=True)
class PromotionSection:
    section: SectionName
    changes: tuple[FieldChange, ...]  # the rules draft now -> the option
    warning: ReplacementWarning | None


@dataclass(frozen=True)
class PromotionPreview:
    origin_version: int
    base_version: int  # the rules draft (the latest version) this preview was made against
    sections: tuple[PromotionSection, ...]
    unchanged: tuple[SectionName, ...]


class SectionInvalidError(FinancialAidError, ValueError):
    """A section editor's content is not a valid section; the message names each bad field."""


@dataclass(frozen=True)
class SectionSaveResult:
    """A section save: the version it landed on, that version's validation report, and the version it branched
    from (None when it saved in place)."""

    version: RulesVersion
    report: ValidationReport
    branched_from: int | None


@dataclass(frozen=True)
class DraftSection:
    """One section of the rules draft: its status and its field-level changes against the version pricing the
    season (none when the draft IS that version, or no version prices it yet): "Draft · n changes"."""

    section: SectionName
    status: SectionStatus
    changes: tuple[FieldChange, ...]


@dataclass(frozen=True)
class RulesDraft:
    version: RulesVersion
    approved_version: int | None
    report: ValidationReport
    sections: tuple[DraftSection, ...]


@dataclass(frozen=True)
class ApprovedSection:
    """One section as D76 shows it, from `version`: its content only when approved or locked there. A section
    approved nowhere has no content, no version and a bare draft status (no edit stamps): the registrar never
    sees a draft."""

    section: SectionName
    status: SectionStatus
    content: dict[str, Any] | None
    version: int | None


@dataclass(frozen=True)
class ApprovedRules:
    year: int
    version: int | None  # the version pricing the season (or the one asked for); None when none prices yet
    sections: tuple[ApprovedSection, ...]


_HELD: Final = ("approved", "locked")


def _approved_section(version: RulesVersion | None, name: SectionName) -> ApprovedSection:
    if version is None or version.section_status[name].state not in _HELD:
        return ApprovedSection(name, SectionStatus(), None, None)
    content = version.document.model_dump(mode="json")[name]
    return ApprovedSection(name, version.section_status[name], content, version.version)


def _replacement(
    current: RulesVersion, origin: RulesVersion, wanted: AidRules, section: SectionName
) -> ReplacementWarning | None:
    if getattr(current.document, section) == getattr(origin.document, section):
        return None
    status = current.section_status[section]
    shown = {
        "section": section,
        "now": current.document.model_dump(mode="json")[section],
        "status": status.model_dump(mode="json"),
        "option": wanted.model_dump(mode="json")[section],
    }
    token = hashlib.sha256(json.dumps(shown, sort_keys=True).encode()).hexdigest()[:16]
    if status.state == "draft":
        return ReplacementWarning("unapproved_edit", status.edited_by, status.edited_at, status.edited_via, token)
    return ReplacementWarning("changed_since", status.approved_by, status.approved_at, None, token)


def parse_section(document: AidRules, section: SectionName, content: Mapping[str, Any]) -> AidRules:
    """`document` with `section` replaced by `content` (that section's JSON, as its editor sends it), validated
    as a whole document so a section is judged exactly as a full save would judge it."""
    body = document.model_dump(mode="json")
    body[section] = dict(content)
    try:
        return AidRules.model_validate(body)
    except ValidationError as exc:
        details = "; ".join(f"{'.'.join(str(part) for part in e['loc'])}: {e['msg']}" for e in exc.errors())
        raise SectionInvalidError(f"{section} is not a valid section: {details}") from exc


def _protected(current: RulesVersion, parent: RulesVersion | None, section: SectionName, *, in_use: bool) -> bool:
    """True when editing `section` in place would lose approved rules, so the edit belongs in a new version.

    A draft section never is. An approved or locked one is when `current` prices the season (`in_use`), or when
    `current` holds the newest approved copy: its same-year parent doesn't have the same content held the same
    way. A lock `current` merely carried from its parent (carry_forward copies locks), or an approval where the
    parent has it approved or locked, is a copy; the parent keeps it.
    """
    state = current.section_status[section].state
    if state == "draft":
        return False
    if in_use or parent is None:
        return True
    held = parent.section_status[section].state
    same = getattr(parent.document, section) == getattr(current.document, section)
    carried = held == state or (state == "approved" and held == "locked")
    return not (same and carried)


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
    # The record's `revision` as read (G6): every write to this version carries it, and PocketBase refuses
    # the write if anything saved the record since. 0 for a version rebuilt from the log (read-only).
    revision: int = 0


class AidRulesStore(Protocol):
    async def list_versions(self, year: int) -> list[Any]: ...

    async def fetch_version(self, year: int, version: int) -> Any | None: ...

    async def fetch_session_refs(self, year: int) -> list[SessionRef]: ...

    async def fetch_log(self, year: int) -> list[LogRow]: ...

    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        reason: str | None = None,
        guards: Sequence[AidGuard] = (),
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

    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        reason: str | None = None,
        guards: Sequence[AidGuard] = (),
    ) -> AidOperationResult:
        """Each write and its aid_change_log row in ONE PocketBase batch (sub-project 4a, spec 14.4).

        `guards` ride in the same batch (G6): a new version guards the version it supersedes. A write or guard
        whose record changed since it was read fails the whole batch as AidWriteConflictError (commit_aid_writes).

        A unique-index collision on (year, version) arrives from the batch as a 400 whose
        field errors say "Value must be unique."; the batch helper keeps PocketBase's message
        but not its code, so the message is what is matched. Anything else about the body was
        already validated (a real AidRules document, a computed version), so it propagates.
        """
        if self._read_only:
            raise RuntimeError("this repository only reads aid_rules")
        extra: dict[str, Any] = {"guards": tuple(guards)} if guards else {}
        try:
            return await asyncio.to_thread(commit_aid_writes, self.pb, writes, actor=actor, reason=reason, **extra)
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
        revision=int(getattr(record, "revision", 0) or 0),
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
        expected_revision=current.revision,
    )


def _approved_at(
    sections: Collection[SectionName], at: datetime, current: Mapping[str, dict[str, Any]], log: Sequence[LogRow]
) -> RulesVersion | None:
    """approved_as_of's replay over one read: the newest version whose `sections` were approved or locked at
    `at`. Raises RulesHistoryIncompleteError for a version whose history can't be replayed to `at`."""
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

    async def draft_view(self, year: int) -> RulesDraft:
        """The Rules tab (spec §7.5, D39): the rules draft (the latest version) section by section, each with its
        status and its changes against the version pricing the season."""
        current = await self.load(year)
        approved = await self.latest_approved(year, PRICING_SECTIONS)
        report = await self.validate_document(current.document)
        base = approved.document.model_dump() if approved is not None and approved.version != current.version else None
        now = current.document.model_dump()
        sections = tuple(
            DraftSection(
                section=name,
                status=current.section_status[name],
                changes=tuple(field_changes(base[name], now[name])) if base is not None else (),
            )
            for name in SECTION_NAMES
        )
        return RulesDraft(current, approved.version if approved is not None else None, report, sections)

    async def approved_view(self, year: int, version: int | None = None) -> ApprovedRules:
        """D76: the approved rules, read only. Drafts are withheld.

        With `version` (a receipt's link): that version alone. Without it, section by section (review ruling,
        plan Decision 5): each PRICING_SECTIONS section from the version pricing the season when there is one
        (the rules that price the registrar's work), and every other section -- or a pricing section while no
        version prices yet -- from the newest version where it is approved or locked (`latest_approved(year,
        [section])`). So editing stages or milestones in a draft never blanks the read.
        """
        if version is not None:
            chosen = await self.load(year, version)
            if all(chosen.section_status[n].state not in _HELD for n in SECTION_NAMES):
                raise RulesNotFoundError(f"{year} version {version} has no approved rules")
            return ApprovedRules(year, chosen.version, tuple(_approved_section(chosen, n) for n in SECTION_NAMES))
        versions = [_to_version(row) for row in await self._store.list_versions(year)]

        def newest(names: Collection[SectionName]) -> RulesVersion | None:
            return next((v for v in reversed(versions) if all(v.section_status[n].state in _HELD for n in names)), None)

        pricing = newest(PRICING_SECTIONS)
        sections = tuple(
            _approved_section(pricing if pricing is not None and name in PRICING_SECTIONS else newest([name]), name)
            for name in SECTION_NAMES
        )
        if all(section.content is None for section in sections):
            raise RulesNotFoundError(f"{year} has no approved rules yet")
        return ApprovedRules(year, pricing.version if pricing is not None else None, sections)

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        """The version that priced `year` at the instant `at` (the as-of reads, 3c): each version's
        document and section statuses replayed from aid_change_log to `at` (every create, save,
        approval and lock is logged with its before and after, 4a), then latest_approved's rule. A
        later edit, re-approval or new version changes nothing earlier. A version whose history
        can't be replayed raises rather than letting an older version answer in its place."""
        current, log = await self._replay_inputs(year)
        return _approved_at(sections, at, current, log)

    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]:
        """approved_as_of at several instants from ONE read of the versions and the log (D16b: the rules at the
        end of each posting day To place checks), and the instants whose history can't be replayed, apart."""
        current, log = await self._replay_inputs(year)
        found: dict[datetime, RulesVersion | None] = {}
        unknown: set[datetime] = set()
        for at in ats:
            try:
                found[at] = _approved_at(sections, at, current, log)
            except RulesHistoryIncompleteError:
                unknown.add(at)
        return found, frozenset(unknown)

    async def _replay_inputs(self, year: int) -> tuple[dict[str, dict[str, Any]], list[LogRow]]:
        """Each version as it stands now (the replay's `current`) and the season's rules log."""
        # `current` settles two same-instant rows that changed the same field with nothing after them.
        # list_versions is read BEFORE fetch_log, so `current` never runs ahead of the log.
        current = {
            _entity_id(year, int(row.version)): {
                "document": _json_object(row, "document"),
                "section_status": _json_object(row, "section_status"),
            }
            for row in await self._store.list_versions(year)
        }
        return current, await self._store.fetch_log(year)

    async def validate_document(self, document: AidRules) -> ValidationReport:
        """Validation against the season's synced sessions. A season with none synced
        warns (no_sessions_to_check) rather than passing the coverage check silently."""
        return validate_rules(document, await self._context(document.year))

    async def _context(self, year: int) -> ValidationContext:
        return ValidationContext(sessions=await self._store.fetch_session_refs(year))

    async def validate(self, year: int, version: int) -> ValidationReport:
        return await self.validate_document((await self.load(year, version)).document)

    async def create_version(self, document: AidRules, *, actor: str) -> RulesVersion:
        latest = await self._latest(document.year)
        version = (latest.version if latest is not None else 0) + 1
        body = _body(document.year, version, document, initial_status(), parent_year=None, parent_version=None)
        return await self._create(body, log_action="create", actor=actor, supersedes=latest)

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
        touched = [*changed_sections(current.document, document), *outcome.reverted]
        # The version that prices the season is guarded whole; one only intake reads, for programs and cost.
        in_use = await self._sections_in_use(current)
        refused = [
            name
            for name in dict.fromkeys(touched)
            if name in in_use and current.section_status[name].state in ("approved", "locked")
        ]
        if refused:
            pricing = await self.latest_approved(year, PRICING_SECTIONS)
            prices = pricing is not None and pricing.version == current.version
            intake = await self.latest_approved(year, INTAKE_RULES_SECTIONS)
            reads = intake is not None and intake.version == current.version
            role = " and ".join(
                part for part, on in (("prices the season", prices), ("is read by intake", reads)) if on
            )
            raise PricingVersionInUseError(
                f"Version {current.version} of {year} {role}: a whole-document save would send its approved "
                f"section(s) {', '.join(refused)} back to draft. "
                "Use the section editor, which branches a new version"
            )
        # This save doesn't stamp (plan Decision 4), so a section it touches drops any earlier edit stamp rather than
        # keep naming someone who no longer made its last change.
        unstamped = {"edited_by": None, "edited_at": None, "edited_via": None}
        status = {name: s.model_copy(update=unstamped) if name in touched else s for name, s in outcome.status.items()}
        stored = _stored(current)
        data = {"document": _dump(document), "section_status": status_to_json(status)}
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
            expected_revision=current.revision,
        )
        await self._store.commit([write], actor=actor)
        return await self.load(year, current.version), report

    async def save_sections(
        self, year: int, base_version: int, candidate: AidRules, *, actor: str, via: str | None = None
    ) -> SectionSaveResult:
        """Save `candidate` over the rules draft (the latest version), which the editor opened as `base_version`.

        This is the section editors' save and a promotion's (SP9, spec §7.5, D39). Unlike the whole-document
        `save`, it never overwrites an approved or locked section in use. (`quality_checks` is a pricing
        section, so a never-approved one does not price the season either.) When a changed section is approved or
        locked here and `_protected` says the approved copy would be lost, the whole candidate becomes a new version
        (parent = this one): changed approved sections go to draft there, and a changed locked section's lock is
        lifted there only. Otherwise it saves in place, lifting any lock that is only a copy of the parent's.

        Each section the edit touched (changed, or sent back to draft by it) is stamped with `actor`, the time and
        `via` (the kept option it came from). One operation, one log row: "save" on the version written. A save
        that changes nothing writes nothing.
        """
        if candidate.year != year:
            raise YearMismatchError(f"The document is for {candidate.year}, not {year}")
        current = await self._rules_draft(year, base_version)
        return await self._save_over(current, candidate, actor=actor, via=via)

    async def save_section(
        self, year: int, base_version: int, section: SectionName, content: Mapping[str, Any], *, actor: str
    ) -> SectionSaveResult:
        """One section editor's save: `content` (that section's JSON) merged into the rules draft this call loads,
        then saved as `save_sections` does. Parsing against the version loaded here, not one a caller loaded
        earlier, means a save that landed in between is never silently reverted."""
        current = await self._rules_draft(year, base_version)
        return await self._save_over(current, parse_section(current.document, section, content), actor=actor, via=None)

    async def _rules_draft(self, year: int, base_version: int) -> RulesVersion:
        current = await self.load(year)
        if current.version != base_version:
            raise NotLatestVersionError(
                f"Version {base_version} of {year} is not the rules draft any more (version {current.version} is); "
                "reload it and make the change again"
            )
        return current

    async def _save_over(
        self, current: RulesVersion, candidate: AidRules, *, actor: str, via: str | None
    ) -> SectionSaveResult:
        year = current.year
        context = await self._context(year)
        before = validate_rules(current.document, context)
        changed = changed_sections(current.document, candidate)
        if not changed:
            return SectionSaveResult(current, before, None)
        after = validate_rules(candidate, context)
        in_use = await self._sections_in_use(current)
        parent = await self._same_year_parent(current)
        locked = [name for name in changed if current.section_status[name].state == "locked"]
        outcome = apply_edit(
            current.document,
            candidate,
            carry_forward(current.section_status, unlock=locked),
            before=before,
            after=after,
        )
        # apply_edit also sends an UNCHANGED approved section back to draft when the edit gives it new
        # validation errors: that loses its approval as surely as editing it, so it counts toward branching.
        touched = [name for name in SECTION_NAMES if name in changed or name in outcome.reverted]
        branch = any(_protected(current, parent, name, in_use=name in in_use) for name in touched)
        status = stamp_edits(outcome.status, touched, by=actor, at=self._clock(), via=via)
        if branch:
            number = await self._next_version(year)
            body = _body(year, number, candidate, status, parent_year=year, parent_version=current.version)
            created = await self._create(body, log_action="save", actor=actor, supersedes=current)
            return SectionSaveResult(created, after, current.version)
        write = AidWrite(
            collection=AID_RULES,
            action="update",
            year=year,
            record_id=current.record_id,
            before=_stored(current),
            data={"document": _dump(candidate), "section_status": status_to_json(status)},
            log_action="save",
            entity_id=_entity_id(year, current.version),
            expected_revision=current.revision,
        )
        await self._store.commit([write], actor=actor)
        return SectionSaveResult(await self.load(year, current.version), after, None)

    async def promotion_preview(self, year: int, *, origin_version: int, document: AidRules) -> PromotionPreview:
        """ "Make B2 the rules draft" (D39): the sections the option changed from the rules version its lineage
        started from (`origin_version`) and that differ from the rules draft now, each old -> new, with a warning
        where the rules draft's copy has moved since that starting point."""
        if document.year != year:
            raise YearMismatchError(f"The document is for {document.year}, not {year}")
        return await self._preview(await self.load(year), origin_version=origin_version, document=document)

    async def _preview(self, current: RulesVersion, *, origin_version: int, document: AidRules) -> PromotionPreview:
        """The promotion preview against `current`, the rules draft as ONE read. `promote` checks the tokens against
        this same read, builds its candidate from it and writes with its revision (Ruling 2026-10-01 (plan review)),
        so a save that lands after the read is a conflict, never silently overwritten by the promotion."""
        year = current.year
        origin = current if origin_version == current.version else await self.load(year, origin_version)
        moved = set(changed_sections(origin.document, document))
        now, wanted = current.document.model_dump(), document.model_dump()
        entries = tuple(
            PromotionSection(
                name, tuple(field_changes(now[name], wanted[name])), _replacement(current, origin, document, name)
            )
            for name in SECTION_NAMES
            if name in moved and getattr(current.document, name) != getattr(document, name)
        )
        listed = {entry.section for entry in entries}
        unchanged = tuple(name for name in SECTION_NAMES if name not in listed)
        return PromotionPreview(origin_version, current.version, entries, unchanged)

    async def promote(
        self,
        year: int,
        *,
        origin_version: int,
        document: AidRules,
        base_version: int,
        acknowledged: Mapping[SectionName, str],
        actor: str,
        via: str,
    ) -> SectionSaveResult:
        """Copy the previewed sections from the option into the rules draft as one save (`save_sections`, so the
        approved rules in use are never overwritten), stamped `via` the option's code. Refused when the rules draft
        moved past `base_version`, or when a warned section is not acknowledged with the token the preview returned
        for it. A section re-edited since the preview has a new token, so its old acknowledgement is refused and the
        section named; nothing is written then."""
        if document.year != year:
            raise YearMismatchError(f"The document is for {document.year}, not {year}")
        # One read of the rules draft for the preview, the tokens, the candidate and the write's revision
        # (Ruling 2026-10-01 (plan review)): a second read could see a save the confirmed preview never showed.
        # Not `_rules_draft`: a promotion was confirmed against a preview, so staff go back to the preview.
        current = await self.load(year)
        if current.version != base_version:
            raise NotLatestVersionError(
                f"The rules draft is version {current.version} now, not {base_version}: look at the changes again"
            )
        preview = await self._preview(current, origin_version=origin_version, document=document)
        unconfirmed = [
            s.section
            for s in preview.sections
            if s.warning is not None and not (s.warning.token and acknowledged.get(s.section) == s.warning.token)
        ]
        if unconfirmed:
            raise ReplacementNotAcknowledgedError(unconfirmed)
        candidate = current.document.model_copy(
            update={entry.section: getattr(document, entry.section) for entry in preview.sections}
        )
        return await self._save_over(current, candidate, actor=actor, via=via)

    async def _sections_in_use(self, version: RulesVersion, *, intake: bool = True) -> frozenset[SectionName]:
        """The sections of `version` a save must not overwrite because a reader takes them from it: every
        section when it prices the season, and just intake's (programs, cost) when only intake reads it. Editing
        an unread section of an intake-only version moves nothing, so it may still save in place."""
        pricing = await self.latest_approved(version.year, PRICING_SECTIONS)
        if pricing is not None and pricing.version == version.version:
            return frozenset(SECTION_NAMES)
        if not intake:
            return frozenset()
        read = await self.latest_approved(version.year, INTAKE_RULES_SECTIONS)
        if read is not None and read.version == version.version:
            return frozenset(INTAKE_RULES_SECTIONS)
        return frozenset()

    async def _same_year_parent(self, version: RulesVersion) -> RulesVersion | None:
        """The version `version` was copied from in the same season; None for version 1 or "start from last year"."""
        if version.parent_year != version.year or not version.parent_version:
            return None
        return await self.load(version.year, version.parent_version)

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
        """The writes that lock `sections` when a round that read them, priced on `version`, is first posted
        (spec §7.5, sub-project 10a), for the caller to commit in the SAME operation as the tick.

        Wanted: each named section not already locked on `version`. Writes only ever go to the LATEST version.
        When `version` is the latest, each wanted section locks there. When a rules draft has branched above it
        (SP9a, plan Decision 18, amending SP10a Decision 11), a wanted section whose content in the latest version
        equals `version`'s is locked there -- the draft carries the very rules the round read -- while a section
        the draft changed is the draft's own edit and stays unlocked. A section already locked in the latest
        needs no write. Anything that can't lock (changed in the draft, not approved there, or the latest
        document has a validation error) is returned in the second list, in section order: the tick still
        stands, and says so.
        """
        priced = await self.load(year, version)
        latest = await self.load(year)
        wanted = [s for s in SECTION_NAMES if s in sections and priced.section_status[s].state != "locked"]
        changed: set[SectionName] = set()
        if latest.version != version:
            changed = {s for s in wanted if getattr(latest.document, s) != getattr(priced.document, s)}
        lockable = [s for s in wanted if s not in changed and latest.section_status[s].state != "locked"]
        not_locked: list[SectionName] = [s for s in wanted if s in changed]
        writes: list[AidWrite] = []
        if lockable:
            report = await self.validate_document(latest.document)
            at = self._clock()
            status = latest.section_status
            for section in lockable:
                try:
                    updated = lock(status, section, at=at, report=report)
                except SectionNotApprovedError, DocumentHasErrorsError:
                    not_locked.append(section)
                    continue
                writes.append(_status_write(latest, status, updated, section, log_action="lock", reason=None))
                status = updated
        return writes, sorted(not_locked, key=SECTION_NAMES.index)

    async def new_version(
        self, year: int, from_version: int, *, actor: str, unlock: Collection[SectionName] = ()
    ) -> RulesVersion:
        """Copy `from_version`'s document, approvals and locks into a new, latest version,
        lifting only the locks named in `unlock` (lifecycle.carry_forward).

        `from_version` need not be the current latest -- branching from an older
        version on purpose is the one write this module allows on a superseded
        version, and its result becomes the new latest.
        """
        # The latest FIRST, and it is the source when branching from it (Ruling 2026-10-01 (plan review)): a source
        # read before the latest could miss a save that landed between the two reads, while the guard, carrying
        # the later read's revision, let the stale copy through.
        latest = await self.load(year)
        source = latest if from_version == latest.version else await self.load(year, from_version)
        version = latest.version + 1
        body = _body(
            year,
            version,
            source.document,
            carry_forward(source.section_status, unlock=unlock),
            parent_year=year,
            parent_version=from_version,
        )
        return await self._create(body, log_action="new_version", actor=actor, supersedes=latest)

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
        created = await self._create(body, log_action="start_from_last_year", actor=actor, supersedes=None)
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

    async def _create(
        self, body: dict[str, Any], *, log_action: str, actor: str, supersedes: RulesVersion | None
    ) -> RulesVersion:
        """Create a version. `supersedes` is the season's latest version as read, None for a season's first: the
        create guards it (G6), so a write still aimed at it as "the latest" (a save, an approval, a tick's lock)
        is refused rather than landing on a version that is no longer the latest, and this create is refused if
        that version changed since it was read."""
        year, version = int(body["year"]), int(body["version"])
        write = AidWrite(
            collection=AID_RULES,
            action="create",
            year=year,
            data=body,
            log_action=log_action,
            entity_id=_entity_id(year, version),
        )
        guards = (
            [AidGuard(collection=AID_RULES, record_id=supersedes.record_id, expected_revision=supersedes.revision)]
            if supersedes is not None
            else []
        )
        await self._store.commit([write], actor=actor, guards=guards)
        return await self.load(year, version)

    async def _latest(self, year: int) -> RulesVersion | None:
        rows = await self._store.list_versions(year)
        return _to_version(rows[-1]) if rows else None

    async def _latest_version_number(self, year: int) -> int | None:
        rows = await self._store.list_versions(year)
        return int(rows[-1].version) if rows else None

    async def _assert_latest(self, year: int, version: int) -> None:
        # The early, friendly refusal. It is not atomic with the write that follows: what makes that write safe
        # is G6's revision check. Every create guards the version it supersedes, so a version that stopped being
        # the latest after this read has a new revision, and the write aimed at it is refused
        # (AidWriteConflictError). The unique index on (year, version) refuses two concurrent creates.
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

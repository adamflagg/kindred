"""Financial-aid rules: the versioned per-season documents in `aid_rules` (campership design section 7).

Reads and writes go through FastAPI's superuser client: all five PocketBase rules
on `aid_rules` are null, so nothing else can reach the table. The router that
exposes this (a later sub-project) gates every call on `financial_aid.rules`;
this module does no permission check of its own.

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

Every write calls the required RulesChangeRecorder, passing the PocketBase
record id of the version written and, for an approval, its note as `reason`.
The change log belongs to sub-project 2, whose writer is synchronous and takes
a different signature, so the router that sub-project 12 adds wires it in here
through a small async adapter that passes `reason` on.

Every refusal raised here subclasses FinancialAidError, so a router can map
them with one `except` without catching pydantic's ValidationError.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]
from pydantic import BaseModel, ConfigDict

from api.constants.collections import AID_RULES, CAMP_SESSIONS
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
    SectionStatus,
    StatusMap,
    apply_edit,
    approve,
    carry_forward,
    initial_status,
    lock,
    status_from_json,
    status_to_json,
)
from bunking.financial_aid.rules.schema import MilestonesSection

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


class RulesVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    record_id: str
    year: int
    version: int
    document: AidRules
    section_status: dict[SectionName, SectionStatus]
    parent_year: int | None
    parent_version: int | None


class RulesChangeRecorder(Protocol):
    async def __call__(
        self,
        *,
        action: str,
        year: int,
        version: int,
        section: SectionName | None,
        record_id: str,
        actor: str,
        before: dict[str, Any] | None,
        after: dict[str, Any] | None,
        reason: str | None,
    ) -> None: ...


class AidRulesStore(Protocol):
    async def list_versions(self, year: int) -> list[Any]: ...

    async def fetch_version(self, year: int, version: int) -> Any | None: ...

    async def fetch_session_refs(self, year: int) -> list[SessionRef]: ...

    async def create(self, body: dict[str, Any]) -> Any: ...

    async def update(self, record_id: str, body: dict[str, Any]) -> Any: ...


class AidRulesRepository:
    """PocketBase access for aid_rules (and the season's sessions, for validation)."""

    def __init__(self, pb: Any) -> None:
        self.pb = pb

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

    async def create(self, body: dict[str, Any]) -> Any:
        try:
            return await asyncio.to_thread(self.pb.collection(AID_RULES).create, body)
        except ClientResponseError as exc:
            # The unique index on (year, version) is one constraint create_version,
            # new_version and start_from_last_year could hit here, but a 400 also covers
            # ordinary field validation (document.maxSize, section_status.maxSize, numeric
            # bounds) -- status alone can't tell those apart. PocketBase nests a
            # `validation_not_unique` code under `data.data.<field>` on a unique-index
            # collision, so check for that specifically before mapping to
            # VersionExistsError; anything else about the body was already validated (a
            # real AidRules document, a computed version number), same reasoning as
            # lodging_write_service's REFUSAL_STATUSES split (401/403 are answers, not this).
            fields = (exc.data or {}).get("data", {}) if isinstance(exc.data, dict) else {}
            not_unique = any(
                isinstance(value, dict) and value.get("code") == "validation_not_unique" for value in fields.values()
            )
            if exc.status == 400 and not_unique:
                raise VersionExistsError(
                    f"aid_rules already has year {body.get('year')} version {body.get('version')}"
                ) from exc
            raise

    async def update(self, record_id: str, body: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(AID_RULES).update, record_id, body)


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


class FinancialAidRulesService:
    def __init__(
        self,
        store: AidRulesStore,
        *,
        recorder: RulesChangeRecorder,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        self._recorder: RulesChangeRecorder = recorder

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
        record = await self._store.create(
            _body(document.year, version, document, initial_status(), parent_year=None, parent_version=None)
        )
        created = _to_version(record)
        await self._record("create", created, section=None, actor=actor, before=None, after=_dump(created.document))
        return created

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
        record = await self._store.update(
            current.record_id, {"document": _dump(document), "section_status": status_to_json(outcome.status)}
        )
        saved = _to_version(record)
        await self._record(
            "save", saved, section=None, actor=actor, before=_dump(current.document), after=_dump(saved.document)
        )
        for name in outcome.reverted:
            await self._record(
                "revert_to_draft",
                saved,
                section=name,
                actor=actor,
                before=current.section_status[name].model_dump(mode="json"),
                after=saved.section_status[name].model_dump(mode="json"),
            )
        return saved, report

    async def approve_section(
        self, year: int, version: int, section: SectionName, *, actor: str, note: str | None
    ) -> tuple[RulesVersion, ValidationReport]:
        """Approve one section. The report comes back so its warnings reach the approver
        (for example no_sessions_to_check when the season has no synced sessions yet)."""
        current = await self.load(year, version)
        await self._assert_latest(year, current.version)
        report = await self.validate_document(current.document)
        status = approve(current.section_status, section, by=actor, at=self._clock(), note=note, report=report)
        return await self._write_status("approve", current, status, section, actor, reason=note), report

    async def lock_section(self, year: int, version: int, section: SectionName, *, actor: str) -> RulesVersion:
        """Lock an approved section; refused while the document has any validation error."""
        current = await self.load(year, version)
        await self._assert_latest(year, current.version)
        report = await self.validate_document(current.document)
        status = lock(current.section_status, section, at=self._clock(), report=report)
        return await self._write_status("lock", current, status, section, actor)

    async def new_version(self, year: int, from_version: int, *, actor: str) -> RulesVersion:
        """Copy `from_version`'s document and approvals (locks lifted) into a new, latest version.

        `from_version` need not be the current latest -- branching from an older
        version on purpose is the one write this module allows on a superseded
        version, and its result becomes the new latest.
        """
        source = await self.load(year, from_version)
        version = await self._next_version(year)
        record = await self._store.create(
            _body(
                year,
                version,
                source.document,
                carry_forward(source.section_status),
                parent_year=year,
                parent_version=from_version,
            )
        )
        created = _to_version(record)
        await self._record(
            "new_version", created, section=None, actor=actor, before=None, after=_dump(created.document)
        )
        return created

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
        record = await self._store.create(
            _body(year, 1, document, initial_status(), parent_year=prior.year, parent_version=prior.version)
        )
        created = _to_version(record)
        await self._record(
            "start_from_last_year", created, section=None, actor=actor, before=None, after=_dump(created.document)
        )
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

    async def _write_status(
        self,
        action: str,
        current: RulesVersion,
        status: StatusMap,
        section: SectionName,
        actor: str,
        *,
        reason: str | None = None,
    ) -> RulesVersion:
        record = await self._store.update(current.record_id, {"section_status": status_to_json(status)})
        updated = _to_version(record)
        await self._record(
            action,
            updated,
            section=section,
            actor=actor,
            before=current.section_status[section].model_dump(mode="json"),
            after=updated.section_status[section].model_dump(mode="json"),
            reason=reason,
        )
        return updated

    async def _record(
        self,
        action: str,
        version: RulesVersion,
        *,
        section: SectionName | None,
        actor: str,
        before: dict[str, Any] | None,
        after: dict[str, Any] | None,
        reason: str | None = None,
    ) -> None:
        await self._recorder(
            action=action,
            year=version.year,
            version=version.version,
            section=section,
            record_id=version.record_id,
            actor=actor,
            before=before,
            after=after,
            reason=reason,
        )


def _dump(document: AidRules) -> dict[str, Any]:
    return document.model_dump(mode="json")

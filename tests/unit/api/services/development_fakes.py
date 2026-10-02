"""An in-memory twin of DevelopmentRepository (Reports back end, Parts B and C). Its one write (a Funding sources
edit) runs 4a's real commit_aid_writes over a fake batch. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any, cast

import httpx

from api.constants.collections import AID_REPORT_DEFINITIONS, AID_SOURCES
from api.services.financial_aid_development_repository import (
    AttendanceRecord,
    GrantorRecord,
    PersonRecord,
    SourceRecord,
    StoredColumns,
)
from bunking.financial_aid.change_log import COLLECTION, AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.reports.zips import HouseholdAddress
from pocketbase import PocketBase
from tests.unit.api.services.financial_aid_fakes import _BatchTwin


def went(
    person: int,
    household: int,
    session: int = 1000101,
    *,
    session_type: str = "main",
    year: int = 2027,
    status: int = 2,
    start: date = date(2027, 6, 20),
    changed_on: date | None = None,
    registered_on: date | None = None,
) -> AttendanceRecord:
    return AttendanceRecord(person, household, session, session_type, start, status, changed_on, year, registered_on)


@dataclass
class FakeDevelopmentStore:
    registrations: list[AttendanceRecord] = field(default_factory=list)
    earlier: list[AttendanceRecord] = field(default_factory=list)
    people: list[PersonRecord] = field(default_factory=list)
    homes: dict[int, HouseholdAddress] = field(default_factory=dict)
    families: dict[int, str] = field(default_factory=dict)
    source_rows: list[SourceRecord] = field(default_factory=list)
    grantor_rows: list[GrantorRecord] = field(default_factory=list)
    earlier_reads: list[tuple[frozenset[int], frozenset[int]]] = field(default_factory=list)
    columns: StoredColumns = field(default_factory=lambda: StoredColumns("", ()))
    log: list[dict[str, Any]] = field(default_factory=list)  # every aid_change_log row that committed
    operations: list[list[AidWrite]] = field(default_factory=list)  # every commit attempted

    async def attendances(self, year: int) -> list[AttendanceRecord]:
        return [r for r in self.registrations if r.year == year]

    async def earlier_attendance(
        self, year: int, person_cm_ids: Iterable[int], household_cm_ids: Iterable[int]
    ) -> list[AttendanceRecord]:
        persons, households = frozenset(person_cm_ids), frozenset(household_cm_ids)
        self.earlier_reads.append((persons, households))
        return [
            r for r in self.earlier if r.year < year and (r.person_cm_id in persons or r.household_cm_id in households)
        ]

    async def persons(self, year: int, person_cm_ids: Iterable[int]) -> list[PersonRecord]:
        wanted = set(person_cm_ids)
        return [p for p in self.people if p.person_cm_id in wanted]

    async def households(self, year: int, household_cm_ids: Iterable[int]) -> dict[int, HouseholdAddress]:
        wanted = set(household_cm_ids)
        return {h: a for h, a in self.homes.items() if h in wanted}

    async def family_keys(self, year: int) -> dict[int, str]:
        return dict(self.families)

    async def sources(self) -> list[SourceRecord]:
        return list(self.source_rows)

    async def grantors(self) -> list[GrantorRecord]:
        return list(self.grantor_rows)

    async def report_columns(self, report: str) -> StoredColumns:
        return self.columns

    async def source(self, source_id: str) -> SourceRecord | None:
        return next((s for s in self.source_rows if s.id == source_id), None)

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        self.operations.append(list(writes))
        return commit_aid_writes(cast(PocketBase, _BatchTwin(self)), writes, actor=actor, reason=reason)

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        results: list[dict[str, Any]] = []
        for item in requests:
            parts = item["url"].strip("/").split("/")
            collection, body = parts[2], dict(item.get("body") or {})
            if collection == COLLECTION:
                self.log.append(body)
            elif collection == AID_SOURCES and item["method"] == "PATCH":
                at = next(i for i, s in enumerate(self.source_rows) if s.id == parts[4])
                current = self.source_rows[at]
                families = body.get("implied_program_families", current.implied_program_families)
                self.source_rows[at] = replace(
                    current,
                    implied_program_families=tuple(families),
                    incentive=bool(body.get("incentive", current.incentive)),
                )
            elif collection == AID_REPORT_DEFINITIONS:
                pairs = tuple((int(c["season"]), date.fromisoformat(c["as_of"])) for c in body["columns"])
                self.columns = StoredColumns(self.columns.id or "rdf000000000001", pairs)
            else:
                raise AssertionError(f"development must not write {collection} ({item['method']})")
            results.append({"status": 200, "body": {**body, "id": parts[-1]}})
        return httpx.Response(200, json=results)

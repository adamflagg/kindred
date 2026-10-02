"""An in-memory twin of DevelopmentRepository (Reports back end, Part B). Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

from api.services.financial_aid_development_repository import AttendanceRecord, PersonRecord, SourceRecord


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
) -> AttendanceRecord:
    return AttendanceRecord(person, household, session, session_type, start, status, changed_on, year)


@dataclass
class FakeDevelopmentStore:
    registrations: list[AttendanceRecord] = field(default_factory=list)
    earlier: list[AttendanceRecord] = field(default_factory=list)
    people: list[PersonRecord] = field(default_factory=list)
    families: dict[int, str] = field(default_factory=dict)
    source_rows: list[SourceRecord] = field(default_factory=list)
    earlier_reads: list[tuple[frozenset[int], frozenset[int]]] = field(default_factory=list)

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

    async def family_keys(self, year: int) -> dict[int, str]:
        return dict(self.families)

    async def sources(self) -> list[SourceRecord]:
        return list(self.source_rows)

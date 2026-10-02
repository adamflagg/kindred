"""PocketBase reads for Reports › Development (Reports back end, Part B; clean spec §5.11, §9.4): the season's
registrations with their sessions and households, the people development counts (age, gender identity), the
earlier seasons' attendance (first-time), aid families
(aid_household_links) and the sources with their incentive flag (D88). Its one write (Part C) is a Funding sources
edit, through 4a.

Development never reads the raw person_custom_values table (§10) and never aid_postings.attributed_* (the grants
register places outside lines; the camp's money comes from the decisions season).
"""

from __future__ import annotations

import asyncio
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import AID_REPORT_DEFINITIONS, ATTENDEES
from api.schemas.financial_aid import SourceChangeOut
from api.services.financial_aid_grants_service import grantor_retired_at
from api.services.financial_aid_ledger_service import last_changes, parse_pb_datetime, source_lines
from api.services.financial_aid_repository import FinancialAidRepository
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes, race_conflict
from bunking.financial_aid.reports.zips import HouseholdAddress
from bunking.pocketbase_batch import BatchRequestFailedError

PAGE_SIZE: Final = 1000
ID_CHUNK: Final = 50  # ids per filter, under PocketBase's 3,500-character filter limit
FIRST_HISTORY_SEASON: Final = 2017  # D99's default: no summer at camp in 2017 on
ENROLLED: Final = 2
CANCELLED_STATUS_IDS: Final = frozenset({32, 256})  # Go's aidCancelledStatusIDs
_FIELDS: Final = (
    "id,person_id,status_id,enrollment_date,effective_date,year,"
    "expand.person.household_id,expand.session.cm_id,expand.session.session_type,expand.session.start_date"
)


@dataclass(frozen=True)
class AttendanceRecord:
    person_cm_id: int
    household_cm_id: int
    session_cm_id: int
    session_type: str
    start: date | None
    status_id: int
    changed_on: date | None  # a cancelled row's day (CampMinder's PostDate); None otherwise
    year: int
    registered_on: date | None = None  # attendees.effective_date: the day the camper registered (Part C)


@dataclass(frozen=True)
class StoredColumns:
    """A report's saved dated columns (aid_report_definitions, Part C): the record id ("" before the first save)
    and its {season, as_of} pairs."""

    id: str
    columns: tuple[tuple[int, date], ...]


@dataclass(frozen=True)
class PersonRecord:
    person_cm_id: int
    household_cm_id: int
    birthdate: date | None
    gender_identity_name: str
    gender_identity_write_in: str


@dataclass(frozen=True)
class SourceRecord:
    id: str
    description_key: str
    source_name: str
    funder_type: str
    incentive: bool
    implied_program_families: tuple[str, ...]
    grantor_key: str = ""  # aid_sources.grantor_key: the description's funder in the grantor directory ("" = none)


def _day(value: Any) -> date | None:
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def attendance_record(record: Any) -> AttendanceRecord:
    expand = getattr(record, "expand", None) or {}
    person = expand.get("person")
    session = expand.get("session")
    status = int(getattr(record, "status_id", 0) or 0)
    changed = parse_pb_datetime(getattr(record, "enrollment_date", None)) if status in CANCELLED_STATUS_IDS else None
    return AttendanceRecord(
        person_cm_id=int(getattr(record, "person_id", 0) or 0),
        household_cm_id=int(getattr(person, "household_id", 0) or 0),
        session_cm_id=int(getattr(session, "cm_id", 0) or 0),
        session_type=str(getattr(session, "session_type", "") or ""),
        start=_day(getattr(session, "start_date", "")),
        status_id=status,
        changed_on=changed.date() if changed is not None else None,
        year=int(getattr(record, "year", 0) or 0),
        registered_on=_day(getattr(record, "effective_date", "")),
    )


def person_record(record: Any) -> PersonRecord:
    return PersonRecord(
        person_cm_id=int(getattr(record, "cm_id", 0) or 0),
        household_cm_id=int(getattr(record, "household_id", 0) or 0),
        birthdate=_day(getattr(record, "birthdate", "")),
        gender_identity_name=str(getattr(record, "gender_identity_name", "") or ""),
        gender_identity_write_in=str(getattr(record, "gender_identity_write_in", "") or ""),
    )


def source_record(record: Any) -> SourceRecord:
    families = getattr(record, "implied_program_families", None) or []
    return SourceRecord(
        id=str(record.id),
        description_key=str(getattr(record, "description_key", "") or ""),
        source_name=str(getattr(record, "source_name", "") or "") or str(getattr(record, "description", "") or ""),
        funder_type=str(getattr(record, "funder_type", "") or ""),
        incentive=bool(getattr(record, "incentive", False)),
        implied_program_families=tuple(sorted(str(f) for f in families)),
        grantor_key=str(getattr(record, "grantor_key", "") or ""),
    )


@dataclass(frozen=True)
class GrantorRecord:
    key: str
    name: str
    retired: bool  # kept for history (aid_grantors.retired_at, D160): it still names its descriptions' row


def grantor_record(record: Any) -> GrantorRecord:
    return GrantorRecord(
        key=str(getattr(record, "key", "") or ""),
        name=str(getattr(record, "name", "") or ""),
        retired=bool(grantor_retired_at(record)),
    )


class DevelopmentRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb
        self._aid = FinancialAidRepository(pb)

    async def _page(self, query: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await asyncio.to_thread(
            self.pb.collection(ATTENDEES).get_full_list, batch=PAGE_SIZE, query_params=query
        )
        return rows

    async def attendances(self, year: int) -> list[AttendanceRecord]:
        """The season's enrolled (2), cancelled (32) and withdrawn (256) registrations: a dated column needs the
        cancelled ones to tell who was still enrolled on its date."""
        rows = await self._page(
            {
                "filter": f"year = {int(year)} && (status_id = 2 || status_id = 32 || status_id = 256)",
                "expand": "person,session",
                "fields": _FIELDS,
                "sort": "id",
            }
        )
        return [attendance_record(row) for row in rows]

    async def earlier_attendance(
        self, year: int, person_cm_ids: Collection[int], household_cm_ids: Collection[int]
    ) -> list[AttendanceRecord]:
        """Enrolled registrations in the seasons from 2017 to the one before `year`, of these campers and of
        everyone in these households (first-time, D99): never the whole history."""
        chunks: list[str] = []
        for field, ids in (("person_id", person_cm_ids), ("person.household_id", household_cm_ids)):
            wanted = sorted({int(i) for i in ids if int(i) > 0})
            chunks.extend(
                " || ".join(f"{field} = {i}" for i in wanted[start : start + ID_CHUNK])
                for start in range(0, len(wanted), ID_CHUNK)
            )
        found = await asyncio.gather(
            *(
                self._page(
                    {
                        "filter": (
                            f"year >= {FIRST_HISTORY_SEASON} && year < {int(year)} && status_id = {ENROLLED} "
                            f"&& ({chunk})"
                        ),
                        "expand": "person,session",
                        "fields": _FIELDS,
                        "sort": "id",
                    }
                )
                for chunk in chunks
            )
        )
        rows: dict[str, Any] = {str(row.id): row for batch in found for row in batch}
        return [attendance_record(row) for row in rows.values()]

    async def persons(self, year: int, person_cm_ids: Collection[int]) -> list[PersonRecord]:
        return [person_record(row) for row in await self._aid.fetch_persons(year, person_cm_ids)]

    async def households(self, year: int, household_cm_ids: Collection[int]) -> dict[int, HouseholdAddress]:
        """The households' billing addresses (the ZIP read; households are year-scoped records)."""
        rows = await self._aid.fetch_households(year, household_cm_ids)
        return {
            int(row.cm_id): HouseholdAddress(
                str(getattr(row, "billing_postal_code", "") or ""), str(getattr(row, "billing_country", "") or "")
            )
            for row in rows
        }

    async def family_keys(self, year: int) -> dict[int, str]:
        """household -> its aid family (aid_household_links), excluded rows dropped."""
        out: dict[int, str] = {}
        for row in await self._aid.fetch_links(year):
            if not bool(getattr(row, "excluded", False)):
                out.setdefault(int(row.household_cm_id), str(row.family_key))
        return out

    async def sources(self) -> list[SourceRecord]:
        return [source_record(row) for row in await self._aid.fetch_sources()]

    async def grantors(self) -> list[GrantorRecord]:
        return [grantor_record(row) for row in await self._aid.fetch_grantors()]

    async def report_columns(self, report: str) -> StoredColumns:
        rows: list[Any] = await asyncio.to_thread(
            self.pb.collection(AID_REPORT_DEFINITIONS).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": f"report = '{pb_escape(report)}'", "sort": "id"},
        )
        if not rows:
            return StoredColumns("", ())
        raw = getattr(rows[0], "columns", None) or []
        pairs = tuple(
            (int(c["season"]), date.fromisoformat(str(c["as_of"])[:10]))
            for c in raw
            if isinstance(c, dict) and "season" in c and "as_of" in c
        )
        return StoredColumns(str(rows[0].id), pairs)

    async def source(self, source_id: str) -> SourceRecord | None:
        row = await self._aid.get_source(source_id)
        return source_record(row) if row is not None else None

    async def source_lines(self, year: int) -> dict[str, tuple[int, Decimal]]:
        """Each description's live lines this season and their net, by the description that classifies them now
        (after any reclassifying override): Money > Sources' count, so Funding sources' agrees with it."""
        return source_lines(await self._aid.fetch_postings(year))

    async def source_changes(self) -> dict[str, SourceChangeOut]:
        """Each aid_sources record's last logged edit, any season (Money > Sources' last change)."""
        return last_changes(await self._aid.fetch_source_changes())

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        """A Funding sources edit and its aid_change_log row, in one batch (4a). A batch that lost a race (the row
        someone removed first) is G6's AidWriteConflictError, answered 409 by _reports_http: nothing was written. Any
        other refused batch goes through as it is."""
        try:
            return await asyncio.to_thread(commit_aid_writes, self.pb, writes, actor=actor, reason=reason)
        except BatchRequestFailedError as exc:
            if (conflict := race_conflict(exc)) is not None:
                raise conflict from exc
            raise

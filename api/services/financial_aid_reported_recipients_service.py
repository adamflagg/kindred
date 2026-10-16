"""A past season's Campership sheet, loaded as "as reported" recipients (owner ruling 2026-10-16, CS-AGES25), the way
finance's typed history loads (`FinancialAidReportsService.load_reported`): all or nothing, added or corrected by
natural key, the unchanged skipped, each write with its aid_change_log row in one logged operation, and a dry run
that only counts. A row whose person had no registration that season (any status) refuses the load, named.

Reports › Development reads these rows for an as-reported season's summer age lines (`sheet_ages`).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import Protocol

from api.constants.collections import AID_REPORTED_RECIPIENTS
from api.schemas.financial_aid_reports import (
    ReportedRecipientOut,
    ReportedRecipientsLoadOut,
    ReportedRecipientsResponse,
)
from api.services.financial_aid_development_repository import AttendanceRecord
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_reported_recipients_repository import StoredRecipient, recipient_fields
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.reports.recipients import ReportedRecipient, problems, recipient_entity


class RecipientsStore(Protocol):
    """What the load reads and writes (DevelopmentRepository has it; tests use a fake)."""

    async def attendances(self, year: int) -> list[AttendanceRecord]: ...
    async def reported_recipients(self, year: int) -> list[StoredRecipient]: ...
    async def reported_recipient(self, record_id: str) -> StoredRecipient | None: ...
    async def commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None
    ) -> AidOperationResult: ...


class ReportedRecipientNotFoundError(FinancialAidError, LookupError):
    """No aid_reported_recipients record with that id (404)."""


def _out(stored: StoredRecipient) -> ReportedRecipientOut:
    r = stored.recipient
    return ReportedRecipientOut(
        id=stored.id,
        year=r.year,
        person_cm_id=r.person_cm_id,
        household_cm_id=r.household_cm_id,
        program=r.program,
        source=r.source,
        funder=r.funder,
        amount=money(r.amount),
        sheet_tab=r.sheet_tab,
        sheet_row=r.sheet_row,
        match=r.match,
    )


class ReportedRecipientsService:
    def __init__(self, store: RecipientsStore) -> None:
        self._store = store

    async def listed(self, year: int) -> ReportedRecipientsResponse:
        return ReportedRecipientsResponse(
            year=year, recipients=[_out(s) for s in await self._store.reported_recipients(year)]
        )

    async def load(
        self, recipients: Sequence[ReportedRecipient], *, actor: str, dry_run: bool = False
    ) -> ReportedRecipientsLoadOut:
        found: list[str] = []
        seen: set[tuple[int, int, str, str, str]] = set()
        by_year: dict[int, list[tuple[int, ReportedRecipient]]] = defaultdict(list)
        for n, recipient in enumerate(recipients, start=1):
            found.extend(f"recipient {n}: {p}" for p in problems(recipient))
            if recipient.key in seen:
                found.append(f"recipient {n}: the same recipient twice in one load")
            seen.add(recipient.key)
            by_year[recipient.year].append((n, recipient))
        stored: dict[tuple[int, int, str, str, str], StoredRecipient] = {}
        for year, rows in sorted(by_year.items()):
            campers = {r.person_cm_id for r in await self._store.attendances(year)}
            found.extend(
                f"recipient {n}: {r.person_cm_id} has no registration in {year}"
                for n, r in rows
                if r.person_cm_id not in campers
            )
            stored.update((s.recipient.key, s) for s in await self._store.reported_recipients(year))
        if found:
            raise ReportsRefusedError("; ".join(found))
        writes: list[AidWrite] = []
        created = updated = unchanged = 0
        for recipient in recipients:
            fields = recipient_fields(recipient)
            before = stored.get(recipient.key)
            if before is None:
                writes.append(
                    AidWrite(
                        collection=AID_REPORTED_RECIPIENTS,
                        action="create",
                        year=recipient.year,
                        data=fields,
                        entity_id=recipient_entity(recipient),
                    )
                )
                created += 1
                continue
            old = recipient_fields(before.recipient)
            changed = {k: v for k, v in fields.items() if v != old[k]}
            if not changed:
                unchanged += 1
                continue
            writes.append(
                AidWrite(
                    collection=AID_REPORTED_RECIPIENTS,
                    action="update",
                    year=recipient.year,
                    record_id=before.id,
                    before=old,
                    data=changed,
                    entity_id=recipient_entity(recipient),
                )
            )
            updated += 1
        if writes and not dry_run:
            await self._store.commit(writes, actor=actor)
        return ReportedRecipientsLoadOut(created=created, updated=updated, unchanged=unchanged, dry_run=dry_run)

    async def delete(self, record_id: str, *, reason: str, actor: str) -> None:
        stored = await self._store.reported_recipient(record_id)
        if stored is None:
            raise ReportedRecipientNotFoundError(f"No reported recipient {record_id}")
        await self._store.commit(
            [
                AidWrite(
                    collection=AID_REPORTED_RECIPIENTS,
                    action="delete",
                    year=stored.recipient.year,
                    record_id=stored.id,
                    before=recipient_fields(stored.recipient),
                    entity_id=recipient_entity(stored.recipient),
                )
            ],
            actor=actor,
            reason=reason,
        )

"""PocketBase access for a past season's Campership sheet, loaded as "as reported" recipients (owner ruling
2026-10-16, CS-AGES25): the aid_reported_recipients collection's reads, parsed into ReportedRecipient. Every write
goes through DevelopmentRepository.commit (4a's commit_aid_writes: each record and its aid_change_log row in one
batch, which also clears the season's caches; a create the unique natural-key index refuses is G6's 409). FastAPI's
superuser client is the only way in: all five PocketBase rules are null.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import AID_REPORTED_RECIPIENTS
from api.services.pb_read import pb_read
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.reports.recipients import MATCHES, PROGRAMS, SOURCES, ReportedRecipient

PAGE_SIZE: Final = 1000


@dataclass(frozen=True)
class StoredRecipient:
    id: str
    recipient: ReportedRecipient


def recipient_fields(recipient: ReportedRecipient) -> dict[str, Any]:
    """The record's fields, as a create writes them and the change log records them."""
    return {
        "year": recipient.year,
        "person_cm_id": recipient.person_cm_id,
        "household_cm_id": recipient.household_cm_id,
        "program": recipient.program,
        "source": recipient.source,
        "funder": recipient.funder,
        "amount": float(recipient.amount),
        "sheet_tab": recipient.sheet_tab,
        "sheet_row": recipient.sheet_row,
        "match": recipient.match,
    }


def _choice[T: str](value: Any, allowed: tuple[T, ...]) -> T:
    text = str(value or "")
    for choice in allowed:
        if choice == text:
            return choice
    raise ValueError(f"aid_reported_recipients: {text!r} is not one of {allowed}")


def recipient_from_record(record: Any) -> StoredRecipient:
    return StoredRecipient(
        id=str(record.id),
        recipient=ReportedRecipient(
            year=int(record.year),
            person_cm_id=int(record.person_cm_id),
            household_cm_id=int(record.household_cm_id),
            program=_choice(record.program, PROGRAMS),
            source=_choice(record.source, SOURCES),
            funder=str(getattr(record, "funder", "") or ""),
            amount=Decimal(str(getattr(record, "amount", 0) or 0)).quantize(Decimal("0.01")),
            sheet_tab=str(getattr(record, "sheet_tab", "") or ""),
            sheet_row=int(getattr(record, "sheet_row", 0) or 0),
            match=_choice(record.match, MATCHES),
        ),
    )


class ReportedRecipientsRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _rows(self, query: str) -> list[StoredRecipient]:
        rows: list[Any] = await pb_read(
            self.pb.collection(AID_REPORTED_RECIPIENTS).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": query, "sort": "person_cm_id,program,source,funder,id"},
        )
        return [recipient_from_record(row) for row in rows]

    async def reported_recipients(self, year: int) -> list[StoredRecipient]:
        """One season's sheet rows (a few hundred at most)."""
        return await self._rows(f"year = {int(year)}")

    async def reported_recipient(self, record_id: str) -> StoredRecipient | None:
        found = await self._rows(f"id = '{pb_escape(record_id)}'")
        return found[0] if found else None

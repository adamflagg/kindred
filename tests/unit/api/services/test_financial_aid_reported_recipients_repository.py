"""ReportedRecipientsRepository (owner ruling 2026-10-16, CS-AGES25): a record's fields round-trip, a season is one
filtered read. Fictional only."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from api.services.financial_aid_reported_recipients_repository import (
    ReportedRecipientsRepository,
    recipient_fields,
    recipient_from_record,
)
from bunking.financial_aid.reports.recipients import ReportedRecipient

pytestmark = pytest.mark.asyncio

GRANT = ReportedRecipient(
    year=2025,
    person_cm_id=1000011,
    household_cm_id=1000001,
    program="summer",
    source="outside",
    funder="Regional Camp Fund",
    amount=Decimal("1200.50"),
    sheet_tab="Grants",
    sheet_row=4,
    match="household_birthdate",
)


async def test_a_records_fields_round_trip() -> None:
    fields = recipient_fields(GRANT)
    assert fields["amount"] == 1200.5
    stored = recipient_from_record(SimpleNamespace(id="rrc000000000001", **fields))
    assert (stored.id, stored.recipient) == ("rrc000000000001", GRANT)


class _Rows:
    def __init__(self, rows: list[Any]) -> None:
        self.rows = rows
        self.asked: list[dict[str, Any]] = []

    def collection(self, name: str) -> _Rows:
        self.name = name
        return self

    def get_full_list(self, batch: int, query_params: dict[str, Any]) -> list[Any]:
        self.asked.append({"collection": self.name, **query_params})
        return self.rows


async def test_a_season_is_one_read_filtered_to_its_year() -> None:
    pb = _Rows([SimpleNamespace(id="rrc000000000001", **recipient_fields(GRANT))])
    [stored] = await ReportedRecipientsRepository(pb).reported_recipients(2025)
    assert stored.recipient == GRANT
    [query] = pb.asked
    assert (query["collection"], query["filter"]) == ("aid_reported_recipients", "year = 2025")

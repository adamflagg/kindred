"""aid_change_log rows as replay input (campership 3c). Read-only; one season, one collection.

The index `idx_aid_change_log_year (year, created)` serves the read. A season's request log is
intake's first run plus every change since: one create row per request, then the few writes after.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Collection
from datetime import UTC, datetime
from typing import Any, Final

from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_repository import chunk_filter_terms
from api.services.pb_precise_datetime import aid_collection
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import COLLECTION
from bunking.financial_aid.change_replay import LogRow

PAGE_SIZE: Final = 1000
_ENTITY: Final = re.compile(r"^aid_[a-z_]+$")
_OPERATION: Final = re.compile(r"^[a-z0-9]{15}$")
_LIST_FIELDS: Final = "id,entity,entity_id,action,actor,reason,operation_id,created"


def _json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else None
    return dict(value) if value is not None else None


def log_row(record: Any) -> LogRow:
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"aid_change_log {record.id} has no created time")
    return LogRow(
        id=str(record.id),
        entity=str(record.entity),
        entity_id=str(record.entity_id),
        before=_json_object(getattr(record, "before", None)),
        after=_json_object(getattr(record, "after", None)),
        created=created,
    )


async def fetch_change_log(pb: Any, year: int, entity: str) -> list[LogRow]:
    """Every logged write to `entity` for the season, in recorded order.

    The season is the log row's own `year`, which is the `AidWrite.year` its writer passed. This read
    relies on every writer passing the written record's own year: a record's history is whole here
    only while its log rows carry the record's season, and a write logged under another year would
    be missing from it."""
    if not _ENTITY.fullmatch(entity):
        raise ValueError(f"{entity!r} is not an aid_* entity")
    rows: list[Any] = await asyncio.to_thread(
        aid_collection(pb, COLLECTION).get_full_list,
        batch=PAGE_SIZE,
        query_params={"filter": f'year = {int(year)} && entity = "{entity}"', "sort": "created,id"},
    )
    return [log_row(row) for row in rows]


async def fetch_entity_log(pb: Any, year: int, *, exact: Collection[str], containing: Collection[str]) -> list[Any]:
    """The season's aid_change_log rows about some records (slice 1: the household page's timeline), in
    recorded order: entity_id equal to one of `exact`, or containing one of `containing` (a request id is
    also the head of its decisions', holds' and payer shares' entity ids, "<request id>:<...>").
    PocketBase refuses a filter over 3,500 characters, so the terms are chunked and the rows merged."""
    terms = [f"entity_id ~ '{pb_escape(i)}'" for i in sorted(set(containing))]
    terms += [f"entity_id = '{pb_escape(i)}'" for i in sorted(set(exact))]
    if not terms:
        return []
    base = f"year = {int(year)}"
    rows: dict[str, Any] = {}
    for chunk in chunk_filter_terms(len(base), terms):
        found: list[Any] = await asyncio.to_thread(
            aid_collection(pb, COLLECTION).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": f"{base} && ({' || '.join(chunk)})", "sort": "created,id"},
        )
        rows.update({str(r.id): r for r in found})
    return sorted(
        rows.values(),
        key=lambda r: (parse_pb_datetime(getattr(r, "created", None)) or datetime.min.replace(tzinfo=UTC), str(r.id)),
    )


class EntityLogReads:
    """fetch_entity_log over one PocketBase client: the household page's HistoryReads."""

    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def fetch_entity_log(self, year: int, *, exact: Collection[str], containing: Collection[str]) -> list[Any]:
        return await fetch_entity_log(self.pb, year, exact=exact, containing=containing)


def log_detail(value: Any) -> dict[str, Any] | None:
    """A log row's before/after JSON object; anything else (malformed, a list, a scalar) is None rather than failing
    the read (the household page's timeline and Season > History both show it)."""
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else None
        except ValueError:
            return None
    return dict(value) if isinstance(value, dict) else None


async def fetch_season_log(pb: Any, year: int) -> list[Any]:
    """Every row of the season's log, in recorded order, without its before/after JSON (History's list; D49)."""
    rows: list[Any] = await asyncio.to_thread(
        aid_collection(pb, COLLECTION).get_full_list,
        batch=PAGE_SIZE,
        query_params={"filter": f"year = {int(year)}", "sort": "created,id", "fields": _LIST_FIELDS},
    )
    return rows


async def fetch_operation(pb: Any, year: int, operation_id: str) -> list[Any]:
    """One operation's rows, whole, in recorded order (History's expanded line)."""
    if not _OPERATION.fullmatch(operation_id):
        raise ValueError(f"{operation_id!r} is not an operation id")
    rows: list[Any] = await asyncio.to_thread(
        aid_collection(pb, COLLECTION).get_full_list,
        batch=PAGE_SIZE,
        query_params={"filter": f'year = {int(year)} && operation_id = "{operation_id}"', "sort": "created,id"},
    )
    return rows


class HistoryLogReads:
    """The two reads over one PocketBase client: Season > History's HistoryReads."""

    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def fetch_season_log(self, year: int) -> list[Any]:
        return await fetch_season_log(self.pb, year)

    async def fetch_operation(self, year: int, operation_id: str) -> list[Any]:
        return await fetch_operation(self.pb, year, operation_id)

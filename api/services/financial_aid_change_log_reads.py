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

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_GRANTS,
    AID_HOUSEHOLD_LINKS,
    AID_REQUESTS,
    AID_RULES,
)
from api.services.financial_aid_ledger_service import household_display_name, parse_pb_datetime, person_display_name
from api.services.financial_aid_repository import FinancialAidRepository, chunk_filter_terms
from api.services.pb_precise_datetime import aid_collection
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import COLLECTION
from bunking.financial_aid.change_replay import LogRow

PAGE_SIZE: Final = 1000
_ENTITY: Final = re.compile(r"^aid_[a-z_]+$")
_OPERATION: Final = re.compile(r"^[a-z0-9]{15}$")
_LIST_FIELDS: Final = "id,entity,entity_id,action,actor,reason,operation_id,created"
_SUBJECT_FIELDS: Final = {
    AID_REQUESTS: "id,application,household_cm_id,person_cm_id",
    AID_APPLICATIONS: "id,household_cm_id",
    AID_APPLICATION_CORRECTIONS: "id,application",
    AID_GRANTS: "id,household_cm_id",
    AID_HOUSEHOLD_LINKS: "id,household_cm_id",
}
_RECORDED_FIELDS: Final = "id,operation_id,entity,action,after"
_RULES_VERSION_FIELDS: Final = "id,year,version,document,section_status"


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


async def _season_list(pb: Any, collection: str, year: int, fields: str) -> list[Any]:
    rows: list[Any] = await asyncio.to_thread(
        aid_collection(pb, collection).get_full_list,
        batch=PAGE_SIZE,
        query_params={"filter": f"year = {int(year)}", "sort": "id", "fields": fields},
    )
    return rows


async def fetch_subject_records(pb: Any, year: int) -> tuple[list[Any], list[Any], list[Any], list[Any], list[Any]]:
    """Who the season's log rows are about (Season › History, H2): its requests, applications, casework corrections,
    grants and household links, as five light reads with no JSON."""
    requests, applications, corrections, grants, links = await asyncio.gather(
        *(_season_list(pb, collection, year, fields) for collection, fields in _SUBJECT_FIELDS.items())
    )
    return requests, applications, corrections, grants, links


async def fetch_recorded(pb: Any, year: int, operation_ids: Collection[str], entities: Collection[str]) -> list[Any]:
    """Some operations' rows of `entities`, with their recorded `after` (Season › History's figures, H1). The
    operation ids are chunked under PocketBase's filter limit: one read per chunk, never one per operation."""
    for entity in entities:
        if not _ENTITY.fullmatch(entity):
            raise ValueError(f"{entity!r} is not an aid_* entity")
    for operation_id in operation_ids:
        if not _OPERATION.fullmatch(operation_id):
            raise ValueError(f"{operation_id!r} is not an operation id")
    if not operation_ids or not entities:
        return []
    kinds = " || ".join(f'entity = "{e}"' for e in sorted(set(entities)))
    base = f"year = {int(year)} && ({kinds})"
    terms = [f'operation_id = "{o}"' for o in sorted(set(operation_ids))]
    rows: list[Any] = []
    for chunk in chunk_filter_terms(len(base), terms):
        found: list[Any] = await asyncio.to_thread(
            aid_collection(pb, COLLECTION).get_full_list,
            batch=PAGE_SIZE,
            query_params={
                "filter": f"{base} && ({' || '.join(chunk)})",
                "sort": "created,id",
                "fields": _RECORDED_FIELDS,
            },
        )
        rows.extend(found)
    return rows


async def fetch_rules_version(pb: Any, year: int, version: int) -> Any | None:
    """One rules version's stored document and approvals (Season › History's diff of a created version, H4)."""
    rows: list[Any] = await asyncio.to_thread(
        aid_collection(pb, AID_RULES).get_full_list,
        batch=PAGE_SIZE,
        query_params={
            "filter": f"year = {int(year)} && version = {int(version)}",
            "sort": "id",
            "fields": _RULES_VERSION_FIELDS,
        },
    )
    return rows[0] if rows else None


class HistoryLogReads:
    """Season > History's HistoryReads over one PocketBase client."""

    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def fetch_season_log(self, year: int) -> list[Any]:
        return await fetch_season_log(self.pb, year)

    async def fetch_operation(self, year: int, operation_id: str) -> list[Any]:
        return await fetch_operation(self.pb, year, operation_id)

    async def fetch_subject_records(self, year: int) -> tuple[list[Any], list[Any], list[Any], list[Any], list[Any]]:
        return await fetch_subject_records(self.pb, year)

    async def fetch_recorded(self, year: int, operation_ids: Collection[str], entities: Collection[str]) -> list[Any]:
        return await fetch_recorded(self.pb, year, operation_ids, entities)

    async def fetch_names(
        self, year: int, households: Collection[int], persons: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]:
        """Family and camper names as the Requests grid makes them (FinancialAidDecisionsRepository.fetch_names),
        read 100 ids a filter: never one read per row."""
        repo = FinancialAidRepository(self.pb)
        found_households, found_persons = await asyncio.gather(
            repo.fetch_households(year, households), repo.fetch_persons(year, persons)
        )
        return (
            {int(h.cm_id): household_display_name(h, int(h.cm_id)) for h in found_households},
            {int(p.cm_id): person_display_name(p) for p in found_persons},
        )

    async def fetch_rules_version(self, year: int, version: int) -> Any | None:
        return await fetch_rules_version(self.pb, year, version)

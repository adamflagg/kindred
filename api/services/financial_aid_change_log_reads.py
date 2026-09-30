"""aid_change_log rows as replay input (campership 3c). Read-only; one season, one collection.

The index `idx_aid_change_log_year (year, created)` serves the read. A season's request log is
intake's first run plus every change since, which is small (the prod snapshot's first run: 1,369 rows).
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Final

from api.services.financial_aid_ledger_service import parse_pb_datetime
from bunking.financial_aid.change_log import COLLECTION
from bunking.financial_aid.change_replay import LogRow

PAGE_SIZE: Final = 1000
_ENTITY: Final = re.compile(r"^aid_[a-z_]+$")


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
    """Every logged write to `entity` for the season, in recorded order."""
    if not _ENTITY.fullmatch(entity):
        raise ValueError(f"{entity!r} is not an aid_* entity")
    rows: list[Any] = await asyncio.to_thread(
        pb.collection(COLLECTION).get_full_list,
        batch=PAGE_SIZE,
        query_params={"filter": f'year = {int(year)} && entity = "{entity}"', "sort": "created,id"},
    )
    return [log_row(row) for row in rows]

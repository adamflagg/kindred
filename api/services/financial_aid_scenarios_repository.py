"""PocketBase access for Camperships scenarios (sub-project 9b): aid_scenario_snapshots, aid_scenario_options and
aid_scenario_trail. Reads parse records into plain types; every write goes through `commit` (sub-project 4a's
commit_aid_writes: each record and its aid_change_log row in one batch). FastAPI's superuser client is the only way
in: all five PocketBase rules on the three collections are null.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import AID_SCENARIO_OPTIONS, AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_TRAIL
from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, decode_snapshot
from api.services.pb_precise_datetime import aid_collection
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.scenarios import ScenarioResults
from bunking.pocketbase_batch import BatchRequestFailedError

PAGE_SIZE: Final = 1000
_PB_ID: Final = re.compile(r"^[a-z0-9]{15}$")
_SNAPSHOT_FIELDS: Final = "id,year,requests,awaiting_rules,actor,created"
_OPTION_FIELDS: Final = "id,year,code,starting_point,from_code,origin_version,document,results,snapshot,actor,created"
_TRAIL_PAGE_FIELDS: Final = "id,year,actor,from_code,change,results,snapshot,kept_code,created"
# Decoded snapshots by record id. A snapshot never changes once written, so a decoded one never goes stale. Three are
# kept (the current one plus two older ones a compare re-prices options on); the least recently used goes first.
_DECODED: OrderedDict[str, SeasonSnapshot] = OrderedDict()
_DECODED_KEPT: Final = 3
# aid_scenario_snapshots.inputs is a PocketBase json field with maxSize 20000000 (1500000218_aid_scenarios.js). A larger
# value comes back from the batch as a 400; check it first so the refusal is ours (422) and names the size.
SNAPSHOT_INPUTS_MAX_BYTES: Final = 20_000_000


class OptionCodeTakenError(FinancialAidError, ValueError):
    """Someone kept or started an option with the same code at the same moment (the unique (year, code) index)."""


class SnapshotMissingError(FinancialAidError, LookupError):
    """No aid_scenario_snapshots row with that id."""


@dataclass(frozen=True)
class SnapshotMeta:
    id: str
    year: int
    requests: int
    actor: str
    created: datetime
    awaiting_rules: int = 0  # live requests frozen while waiting for approved rules: held (plan Decision 8)


@dataclass(frozen=True)
class OptionRecord:
    id: str
    year: int
    code: str
    starting_point: str  # "" for a starting point
    from_code: str  # "" when started from the rules
    origin_version: int
    document: AidRules
    results: ScenarioResults
    snapshot: str
    actor: str
    created: datetime


@dataclass(frozen=True)
class TrailRecord:
    id: str
    year: int
    actor: str
    from_code: str
    document: AidRules | None  # None in a page read, which leaves documents out
    change: str
    results: ScenarioResults | None
    snapshot: str
    kept_code: str
    created: datetime
    # The service's trail read sets it: the row's figures are from an older snapshot than the newest. A record read
    # straight from the store leaves it False.
    stale: bool = False


def _json(value: Any) -> Any:
    """A PocketBase JSON field: the SDK hands back the decoded value, a test or another client may hand back text."""
    if isinstance(value, str):
        return json.loads(value) if value.strip() else None
    return value


def _text(record: Any, field: str) -> str:
    return str(getattr(record, field, "") or "")


def _created(record: Any) -> datetime:
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"{record.id} has no created time")
    return created


def _record_id(value: str) -> str:
    if not _PB_ID.fullmatch(value):
        raise ValueError(f"{value!r} is not a record id")
    return value


def snapshot_meta(record: Any) -> SnapshotMeta:
    return SnapshotMeta(
        id=str(record.id),
        year=int(record.year),
        requests=int(getattr(record, "requests", 0) or 0),
        actor=_text(record, "actor"),
        created=_created(record),
        awaiting_rules=int(getattr(record, "awaiting_rules", 0) or 0),
    )


def option_record(record: Any) -> OptionRecord:
    return OptionRecord(
        id=str(record.id),
        year=int(record.year),
        code=str(record.code),
        starting_point=_text(record, "starting_point"),
        from_code=_text(record, "from_code"),
        origin_version=int(record.origin_version),
        document=AidRules.model_validate(_json(record.document)),
        results=ScenarioResults.model_validate(_json(record.results)),
        snapshot=str(record.snapshot),
        actor=_text(record, "actor"),
        created=_created(record),
    )


def trail_record(record: Any) -> TrailRecord:
    document = _json(getattr(record, "document", None))
    results = _json(getattr(record, "results", None))
    return TrailRecord(
        id=str(record.id),
        year=int(record.year),
        actor=_text(record, "actor"),
        from_code=_text(record, "from_code"),
        document=AidRules.model_validate(document) if document else None,
        change=_text(record, "change"),
        results=ScenarioResults.model_validate(results) if results else None,
        snapshot=_text(record, "snapshot"),
        kept_code=_text(record, "kept_code"),
        created=_created(record),
    )


def _remember(record_id: str, snapshot: SeasonSnapshot) -> None:
    _DECODED[record_id] = snapshot
    _DECODED.move_to_end(record_id)
    while len(_DECODED) > _DECODED_KEPT:
        _DECODED.popitem(last=False)


def clear_decoded_cache() -> None:
    _DECODED.clear()


def snapshot_inputs_size(inputs: Any) -> int:
    """UTF-8 bytes of the inputs as PocketBase_batch sends them (default separators, non-ASCII kept as is)."""
    return len(json.dumps(inputs, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def check_snapshot_sizes(writes: Sequence[AidWrite]) -> None:
    """Refuse a snapshot whose encoded inputs would exceed the field's cap, before anything is committed."""
    for write in writes:
        if write.collection != AID_SCENARIO_SNAPSHOTS or write.action != "create" or write.data is None:
            continue
        size = snapshot_inputs_size(write.data.get("inputs"))
        if size > SNAPSHOT_INPUTS_MAX_BYTES:
            raise SnapshotError(
                f"The frozen season is {size:,} bytes, over the cap of {SNAPSHOT_INPUTS_MAX_BYTES:,} "
                "that a snapshot can hold"
            )


class ScenarioRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await asyncio.to_thread(
            aid_collection(self.pb, collection).get_full_list, batch=PAGE_SIZE, query_params=query_params
        )
        return rows

    async def _first(self, collection: str, query_params: dict[str, Any]) -> Any | None:
        result = await asyncio.to_thread(aid_collection(self.pb, collection).get_list, 1, 1, query_params)
        return result.items[0] if result.items else None

    async def latest_snapshot(self, year: int) -> SnapshotMeta | None:
        record = await self._first(
            AID_SCENARIO_SNAPSHOTS,
            {"filter": f"year = {int(year)}", "sort": "-created,-id", "fields": _SNAPSHOT_FIELDS},
        )
        return snapshot_meta(record) if record is not None else None

    async def snapshot_inputs(self, record_id: str) -> SeasonSnapshot:
        key = _record_id(record_id)  # validated once; every cache touch and the query use the same key
        cached = _DECODED.get(key)
        if cached is not None:
            _DECODED.move_to_end(key)  # a hit is a use: least recently USED goes first
            return cached
        rows = await self._page(AID_SCENARIO_SNAPSHOTS, {"filter": f'id = "{key}"', "fields": "id,inputs"})
        if not rows:
            raise SnapshotMissingError(f"No frozen season {key}")
        snapshot = decode_snapshot(_json(rows[0].inputs))
        _remember(key, snapshot)
        return snapshot

    async def options(self, year: int) -> list[OptionRecord]:
        rows = await self._page(
            AID_SCENARIO_OPTIONS, {"filter": f"year = {int(year)}", "sort": "created,id", "fields": _OPTION_FIELDS}
        )
        return [option_record(row) for row in rows]

    async def option_round1(self, record_id: str) -> dict[str, Decimal]:
        rows = await self._page(
            AID_SCENARIO_OPTIONS, {"filter": f'id = "{_record_id(record_id)}"', "fields": "id,round1_by_request"}
        )
        raw = _json(getattr(rows[0], "round1_by_request", None)) if rows else None
        return {request_id: Decimal(str(amount)) for request_id, amount in (raw or {}).items()}

    async def latest_trail(self, year: int, actor: str) -> TrailRecord | None:
        record = await self._first(
            AID_SCENARIO_TRAIL,
            {"filter": f'year = {int(year)} && actor = "{pb_escape(actor)}"', "sort": "-created,-id"},
        )
        return trail_record(record) if record is not None else None

    async def trail_row(self, record_id: str) -> TrailRecord | None:
        rows = await self._page(AID_SCENARIO_TRAIL, {"filter": f'id = "{_record_id(record_id)}"'})
        return trail_record(rows[0]) if rows else None

    async def trail_page(self, year: int, page: int, per_page: int) -> tuple[list[TrailRecord], int]:
        result = await asyncio.to_thread(
            aid_collection(self.pb, AID_SCENARIO_TRAIL).get_list,
            page,
            per_page,
            {"filter": f"year = {int(year)}", "sort": "-created,-id", "fields": _TRAIL_PAGE_FIELDS},
        )
        return [trail_record(row) for row in result.items], int(result.total_items)

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        """Each write and its aid_change_log row in ONE PocketBase batch. The unique (year, code) index is the only
        refusal expected; it arrives as a 400 whose field errors say "Value must be unique."."""
        check_snapshot_sizes(writes)
        try:
            return await asyncio.to_thread(commit_aid_writes, self.pb, writes, actor=actor, reason=reason)
        except BatchRequestFailedError as exc:
            if exc.status == 400 and any("unique" in message.lower() for message in exc.field_errors.values()):
                raise OptionCodeTakenError("Someone added an option at the same moment: try again.") from exc
            raise

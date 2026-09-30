"""An in-memory twin of ScenarioRepository for the scenarios service tests (sub-project 9b). Every commit runs 4a's
real commit_aid_writes over a fake batch; reads parse rows with the repository's own parsers. Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import httpx

from api.constants.collections import AID_SCENARIO_OPTIONS, AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_TRAIL
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, decode_snapshot
from api.services.financial_aid_scenarios_repository import (
    OptionCodeTakenError,
    OptionRecord,
    SnapshotMeta,
    SnapshotMissingError,
    TrailRecord,
    _record_id,
    check_snapshot_sizes,
    option_record,
    snapshot_meta,
    trail_record,
)
from bunking.financial_aid.change_log import COLLECTION, AidOperationResult, AidWrite, commit_aid_writes
from pocketbase import PocketBase
from tests.unit.api.services.decisions_fakes import T0
from tests.unit.api.services.financial_aid_fakes import _BatchTwin


class FakeScenarioStore:
    def __init__(self) -> None:
        self.rows: dict[str, list[SimpleNamespace]] = {
            AID_SCENARIO_SNAPSHOTS: [],
            AID_SCENARIO_OPTIONS: [],
            AID_SCENARIO_TRAIL: [],
        }
        self.log: list[dict[str, Any]] = []  # every aid_change_log row that committed
        self.operations: list[list[AidWrite]] = []  # every commit the service attempted
        self._clock = T0

    def _of(self, collection: str, year: int) -> list[SimpleNamespace]:
        return [row for row in self.rows[collection] if row.year == year]

    def _by_id(self, collection: str, record_id: str) -> SimpleNamespace | None:
        return next((row for row in self.rows[collection] if row.id == record_id), None)

    @staticmethod
    def _newest(rows: list[SimpleNamespace]) -> SimpleNamespace | None:
        return max(rows, key=lambda row: (row.created, row.id)) if rows else None

    async def latest_snapshot(self, year: int) -> SnapshotMeta | None:
        row = self._newest(self._of(AID_SCENARIO_SNAPSHOTS, year))
        return snapshot_meta(row) if row is not None else None

    async def snapshot_inputs(self, record_id: str) -> SeasonSnapshot:
        row = self._by_id(AID_SCENARIO_SNAPSHOTS, _record_id(record_id))
        if row is None:
            raise SnapshotMissingError(record_id)
        return decode_snapshot(row.inputs)

    async def options(self, year: int) -> list[OptionRecord]:
        return [option_record(r) for r in sorted(self._of(AID_SCENARIO_OPTIONS, year), key=lambda r: (r.created, r.id))]

    async def option_round1(self, record_id: str) -> dict[str, Decimal]:
        row = self._by_id(AID_SCENARIO_OPTIONS, _record_id(record_id))
        raw = row.round1_by_request if row is not None else {}
        return {request_id: Decimal(str(amount)) for request_id, amount in (raw or {}).items()}

    async def latest_trail(self, year: int, actor: str) -> TrailRecord | None:
        row = self._newest([r for r in self._of(AID_SCENARIO_TRAIL, year) if r.actor == actor])
        return trail_record(row) if row is not None else None

    async def trail_row(self, record_id: str) -> TrailRecord | None:
        row = self._by_id(AID_SCENARIO_TRAIL, _record_id(record_id))
        return trail_record(row) if row is not None else None

    async def trail_page(self, year: int, page: int, per_page: int) -> tuple[list[TrailRecord], int]:
        rows = sorted(self._of(AID_SCENARIO_TRAIL, year), key=lambda r: (r.created, r.id), reverse=True)
        chosen = rows[(page - 1) * per_page : page * per_page]
        without_documents = [SimpleNamespace(**{k: v for k, v in vars(r).items() if k != "document"}) for r in chosen]
        return [trail_record(r) for r in without_documents], len(rows)

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        check_snapshot_sizes(writes)
        self.operations.append(list(writes))
        batch_codes: set[tuple[int, str]] = set()
        for write in writes:
            if write.collection == AID_SCENARIO_OPTIONS and write.action == "create" and write.data is not None:
                key = (write.year, write.data["code"])
                taken = any((r.year, r.code) == key for r in self.rows[AID_SCENARIO_OPTIONS])
                if taken or key in batch_codes:
                    raise OptionCodeTakenError("unique (year, code)")
                batch_codes.add(key)
        return commit_aid_writes(cast(PocketBase, _BatchTwin(self)), writes, actor=actor, reason=reason)

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        results: list[dict[str, Any]] = []
        for item in requests:
            parts = item["url"].strip("/").split("/")
            collection, body = parts[2], dict(item.get("body") or {})
            if collection == COLLECTION:
                self.log.append(body)
            elif item["method"] == "POST":
                self._clock += timedelta(seconds=1)
                self.rows[collection].append(SimpleNamespace(**body, created=self._clock.isoformat()))
            else:
                row = self._by_id(collection, parts[4])
                if row is None:
                    raise AssertionError(f"no {collection} row {parts[4]}")
                for key, value in body.items():
                    setattr(row, key, value)
            results.append({"status": 200, "body": {**body, "id": body.get("id", parts[-1])}})
        return httpx.Response(200, json=results)

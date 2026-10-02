"""An in-memory twin of ReportsRepository (Reports back end, Part A), and the fictional season every Reports service
test prices (decisions_fakes): Emma's Round 1 posted at 1,500 on March 9 2027 (tier 2), Liam's 1,100 decided, not
posted. Every commit runs 4a's real commit_aid_writes over a fake batch, and the batch refuses a change-log key
longer than aid_change_log.entity_id allows (64), as PocketBase does. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import httpx

from api.constants.collections import AID_REPORTED_HISTORY, AID_REQUESTS
from api.services.financial_aid_reports_repository import StoredFigure, figure_fields, figure_from_record
from bunking.financial_aid.change_log import COLLECTION, AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.reports.history import ENTITY_MAX, ReportedFigure
from pocketbase import PocketBase
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, log_seeded, seed_request
from tests.unit.api.services.financial_aid_fakes import _BatchTwin


class FakeReportsStore:
    def __init__(self) -> None:
        self.rows: list[SimpleNamespace] = []
        self.log: list[dict[str, Any]] = []  # every aid_change_log row that committed
        self.operations: list[list[AidWrite]] = []  # every commit the service attempted
        self._clock = T0
        self._ids = 0

    def seed(self, figure: ReportedFigure) -> str:
        self._ids += 1
        record_id = f"rph{self._ids:012d}"
        self.rows.append(SimpleNamespace(id=record_id, **figure_fields(figure), created=self._clock.isoformat()))
        return record_id

    async def reported(self) -> list[StoredFigure]:
        return [figure_from_record(row) for row in self.rows]

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        self.operations.append(list(writes))
        return commit_aid_writes(cast(PocketBase, _BatchTwin(self)), writes, actor=actor, reason=reason)

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        results: list[dict[str, Any]] = []
        for item in requests:
            parts = item["url"].strip("/").split("/")
            collection, body = parts[2], dict(item.get("body") or {})
            if collection == COLLECTION:
                if len(str(body.get("entity_id", ""))) > ENTITY_MAX:
                    return httpx.Response(400, json={"message": "entity_id: Must be no more than 64 character(s)."})
                self.log.append(body)
            elif collection != AID_REPORTED_HISTORY:
                raise AssertionError(f"the reports service must not write {collection}")
            elif item["method"] == "POST":
                self._clock += timedelta(seconds=1)
                self._ids += 1
                self.rows.append(
                    SimpleNamespace(**{"id": f"rph{self._ids:012d}", **body}, created=self._clock.isoformat())
                )
            elif item["method"] == "DELETE":
                self.rows = [row for row in self.rows if row.id != parts[4]]
            else:
                row = next(row for row in self.rows if row.id == parts[4])
                for key, value in body.items():
                    setattr(row, key, value)
            results.append({"status": 200, "body": {**body, "id": body.get("id", parts[-1])}})
        return httpx.Response(200, json=results)


EMMA, LIAM = "reqemma00000001", "reqliam00000001"
EARLY = datetime(2027, 1, 20, 18, 0, tzinfo=UTC)  # both requests first recorded (the received date, D138)
LATE = datetime(2027, 2, 20, 18, 0, tzinfo=UTC)


def posted(
    event_id: str, request_id: str, n: int, amount: str, tier: int, *, on: date = date(2027, 3, 9)
) -> DecisionEvent:
    """A Posted tick recorded and dated `on`, locking `amount` at `tier` in the camp pool."""
    return DecisionEvent(
        id=event_id,
        request_id=request_id,
        round=n,
        kind="post",
        created=datetime(on.year, on.month, on.day, 18, 0, tzinfo=UTC),
        amount=Decimal(amount),
        effective_on=on,
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True, "result": {"final_tier": tier}},
    )


def report_season(*, liam_late: bool = False) -> FakeDecisionsStore:
    """Emma (60,000, tier 2, ask 4,000) posted at 1,500; Liam (90,000, tier 3, ask 2,000) decided at 1,100. Both were
    received on January 20, unless `liam_late` moves Liam's to February 20."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021, income=90000.0, ask=2000.0)
    log_seeded(store, EARLY)
    if liam_late:
        store.change_log = [
            replace(row, created=LATE) if row.entity == AID_REQUESTS and row.entity_id == LIAM else row
            for row in store.change_log
        ]
    store.events.append(posted("ev0000000000001", EMMA, 1, "1500", 2))
    return store

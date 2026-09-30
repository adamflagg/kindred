"""An in-memory aid_rules store for the rules service tests (the rules loader, SP9). Written only through `commit`, as 4a requires."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from api.services.financial_aid_rules_service import VersionExistsError
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, change_row, new_operation_id, new_record_id
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.rules import SessionRef
from tests.unit.bunking.financial_aid.fixtures import FICTIONAL_SESSION_IDS

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)


class FakeStore:
    """aid_rules in memory, written only through `commit`, the one write path (4a).

    Each committed operation is kept as the aid_change_log rows commit_aid_writes would write
    for it, built with the same `change_row`, so a write the real helper would refuse (a
    change that changes nothing) fails here too. An operation applies whole or not at all.
    """

    def __init__(self, sessions: list[SessionRef] | None = None, clock: Callable[[], datetime] | None = None) -> None:
        self._now: Callable[[], datetime] = clock or (lambda: AT)
        self.log_rows: list[LogRow] = []
        self.rows: list[SimpleNamespace] = []
        self.sessions = sessions if sessions is not None else [SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS]
        self.operations: list[list[dict[str, Any]]] = []

    async def list_versions(self, year: int) -> list[Any]:
        return sorted((r for r in self.rows if r.year == year), key=lambda r: r.version)

    async def fetch_version(self, year: int, version: int) -> Any | None:
        return next((r for r in self.rows if r.year == year and r.version == version), None)

    async def fetch_session_refs(self, year: int) -> list[SessionRef]:
        return list(self.sessions)

    async def fetch_log(self, year: int) -> list[LogRow]:
        return [r for r in self.log_rows if r.entity_id.startswith(f"{year}:")]

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        operation_id = new_operation_id()
        staged = copy.deepcopy(self.rows)
        log: list[dict[str, Any]] = []
        ids: list[str] = []
        for write in writes:
            data = json.loads(json.dumps(dict(write.data or {})))
            if write.action == "create":
                if any(r.year == data["year"] and r.version == data["version"] for r in staged):
                    raise VersionExistsError("unique index (year, version)")
                record_id = write.record_id or new_record_id()
                staged.append(SimpleNamespace(id=record_id, **data))
                after: dict[str, Any] | None = data
            else:
                assert write.record_id is not None
                assert write.before is not None
                record_id = write.record_id
                row = next(r for r in staged if r.id == record_id)
                for key, value in data.items():
                    setattr(row, key, value)
                after = {**write.before, **data}
            log.append(
                change_row(
                    entity=write.collection,
                    entity_id=write.entity_id or record_id,
                    year=write.year,
                    action=write.log_action or write.action,
                    before=write.before,
                    after=after,
                    actor=actor,
                    reason=write.reason if write.reason is not None else reason,
                    operation_id=operation_id,
                )
            )
            logged = log[-1]
            self.log_rows.append(
                LogRow(
                    id=new_record_id(),
                    entity=logged["entity"],
                    entity_id=logged["entity_id"],
                    before=logged["before"],
                    after=logged["after"],
                    created=self._now(),
                )
            )
            ids.append(record_id)
        self.rows = staged
        self.operations.append(log)
        return AidOperationResult(
            operation_id=operation_id, record_ids=tuple(ids), records=tuple(None for _ in ids), batches=1
        )

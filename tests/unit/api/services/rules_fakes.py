"""An in-memory aid_rules store for the rules service tests (the rules loader, SP9). Written only through `commit`, as 4a requires."""

from __future__ import annotations

import copy
import json
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from api.services.financial_aid_rules_service import VersionExistsError
from bunking.financial_aid.change_log import (
    AidGuard,
    AidOperationResult,
    AidWrite,
    AidWriteConflictError,
    change_row,
    if_match_values,
    new_operation_id,
    new_record_id,
)
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.rules import SessionRef
from tests.unit.bunking.financial_aid.fixtures import FICTIONAL_SESSION_IDS

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)


class FakeStore:
    """aid_rules in memory, written only through `commit`, the one write path (4a).

    Each committed operation is kept as the aid_change_log rows commit_aid_writes would write
    for it, built with the same `change_row`, so a write the real helper would refuse (a
    change that changes nothing) fails here too. An operation applies whole or not at all.

    Each row carries `revision` as pocketbase/aidguard keeps it (G6): 0 on create, +1 on every save (a guard's
    too), and a write or guard whose If-Match (`if_match_values`, the real helper's own arithmetic) is not the
    stored revision refuses the whole operation with AidWriteConflictError. `before_next_commit` runs another
    writer's whole operation when the next commit starts, after its caller read; `after_next_read` runs one right
    after the caller's next read, before any later read: deterministic interleavings.
    """

    def __init__(self, sessions: list[SessionRef] | None = None, clock: Callable[[], datetime] | None = None) -> None:
        self._now: Callable[[], datetime] = clock or (lambda: AT)
        self.log_rows: list[LogRow] = []
        self.rows: list[SimpleNamespace] = []
        self.sessions = sessions if sessions is not None else [SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS]
        self.operations: list[list[dict[str, Any]]] = []
        self.recorded: list[dict[str, Any]] = []  # log-only rows (record_change); never part of the aid_rules log
        self.fail_record = False
        self._interleaved: list[Callable[[], Awaitable[object]]] = []
        self._after_read: list[Callable[[], Awaitable[object]]] = []

    def before_next_commit(self, action: Callable[[], Awaitable[object]]) -> None:
        """Run `action` once, as the next commit starts: after that commit's caller read, before it writes."""
        self._interleaved.append(action)

    def after_next_read(self, action: Callable[[], Awaitable[object]]) -> None:
        """Run `action` once, right after the next version read (`list_versions` or `fetch_version`) has taken
        its rows: another writer landing between two of a caller's reads."""
        self._after_read.append(action)

    async def _read_done(self) -> None:
        if self._after_read:
            await self._after_read.pop(0)()

    async def list_versions(self, year: int, *, include_discarded: bool = False) -> list[Any]:
        rows = sorted(
            (r for r in self.rows if r.year == year and (include_discarded or not getattr(r, "discarded", False))),
            key=lambda r: r.version,
        )
        await self._read_done()
        return rows

    async def fetch_version(self, year: int, version: int) -> Any | None:
        row = next((r for r in self.rows if r.year == year and r.version == version), None)
        await self._read_done()
        return row

    async def fetch_session_refs(self, year: int) -> list[SessionRef]:
        return list(self.sessions)

    async def fetch_log(self, year: int) -> list[LogRow]:
        return [r for r in self.log_rows if r.entity == "aid_rules" and r.entity_id.startswith(f"{year}:")]

    async def record(
        self,
        *,
        entity: str,
        entity_id: str,
        year: int,
        action: str,
        after: dict[str, Any],
        actor: str,
        operation_id: str,
    ) -> None:
        """A log-only row, built with the same change_row record_change uses."""
        if self.fail_record:
            raise RuntimeError("the log write failed")
        self.recorded.append(
            change_row(
                entity=entity,
                entity_id=entity_id,
                year=year,
                action=action,
                before=None,
                after=after,
                actor=actor,
                reason=None,
                operation_id=operation_id,
            )
        )
        # Production writes it to the SAME table the rules replay reads (aid_change_log), so the fake does too.
        row = self.recorded[-1]
        self.log_rows.append(
            LogRow(
                id=new_record_id(),
                entity=row["entity"],
                entity_id=row["entity_id"],
                before=None,
                after=row["after"],
                created=self._now(),
            )
        )

    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        reason: str | None = None,
        guards: Sequence[AidGuard] = (),
    ) -> AidOperationResult:
        if self._interleaved:
            await self._interleaved.pop(0)()
        guard_revisions, write_revisions = if_match_values(writes, guards)
        operation_id = new_operation_id()
        staged = copy.deepcopy(self.rows)

        def save(collection: str, record_id: str, expected: int | None) -> SimpleNamespace:
            row = next(r for r in staged if r.id == record_id)
            if expected is not None and row.revision != expected:
                raise AidWriteConflictError(collection=collection, record_id=record_id)
            row.revision += 1
            return row

        for guard, guarded in zip(guards, guard_revisions, strict=True):
            save(guard.collection, guard.record_id, guarded)
        log: list[dict[str, Any]] = []
        logged_rows: list[LogRow] = []  # kept only if the whole operation applies
        ids: list[str] = []
        for write, wanted in zip(writes, write_revisions, strict=True):
            data = json.loads(json.dumps(dict(write.data or {})))
            if write.action == "create":
                if any(r.year == data["year"] and r.version == data["version"] for r in staged):
                    raise VersionExistsError("unique index (year, version)")
                record_id = write.record_id or new_record_id()
                staged.append(SimpleNamespace(id=record_id, **data, revision=0))
                after: dict[str, Any] | None = data
            else:
                assert write.record_id is not None
                assert write.before is not None
                record_id = write.record_id
                row = save(write.collection, record_id, wanted)
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
            logged_rows.append(
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
        self.log_rows.extend(logged_rows)
        self.operations.append(log)
        return AidOperationResult(
            operation_id=operation_id, record_ids=tuple(ids), records=tuple(None for _ in ids), batches=1
        )

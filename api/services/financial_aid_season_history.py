"""Season › History (D49, app spec §7.6): the season's aid_change_log, one line per operation (operation_id), rules
and casework on one timeline, newest first. Pure: grouping, kinds and filters; the reads are in Task 13's service.

Read access follows the data: rules operations (and session capacity, set on the Rules tab) need financial_aid.rules.
Intake runs (system:intake) are hidden unless asked. The scenario trail stays in Scenarios, so its collections are
left out. Amounts are what the rows recorded at the time, never recomputed."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Final

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_ATTRIBUTION_OVERRIDES,
    AID_CANCELLATIONS,
    AID_DECISIONS,
    AID_FLAG_DISPOSITIONS,
    AID_GRANT_PLACEMENTS,
    AID_GRANTORS,
    AID_GRANTS,
    AID_HOLD_EVENTS,
    AID_HOUSEHOLD_LINKS,
    AID_PAYER_SHARES,
    AID_POSTINGS,
    AID_REQUESTS,
    AID_RULES,
    AID_SCENARIO_OPTIONS,
    AID_SCENARIO_SNAPSHOTS,
    AID_SCENARIO_TRAIL,
    AID_SESSION_CAPACITY,
    AID_SOURCES,
)
from api.schemas.financial_aid_history import HistoryCountOut, HistoryKind, HistoryOperationOut
from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_reconciliation import camp_date

INTAKE_ACTOR: Final = "system:intake"
ENTITY_KINDS: Final[Mapping[str, HistoryKind]] = {
    AID_RULES: "rules",
    AID_SESSION_CAPACITY: "rules",
    AID_DECISIONS: "offers",
    AID_CANCELLATIONS: "offers",
    AID_REQUESTS: "offers",
    AID_HOLD_EVENTS: "holds",
    AID_GRANTS: "grants",
    AID_GRANT_PLACEMENTS: "grants",
    AID_GRANTORS: "grants",
    AID_PAYER_SHARES: "money",
    AID_APPLICATIONS: "money",
    AID_APPLICATION_CORRECTIONS: "money",
    AID_ATTRIBUTION_OVERRIDES: "money",
    AID_HOUSEHOLD_LINKS: "money",
    AID_SOURCES: "money",
    AID_POSTINGS: "money",
    AID_FLAG_DISPOSITIONS: "money",
}
NOT_IN_HISTORY: Final = frozenset({AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_OPTIONS, AID_SCENARIO_TRAIL})
_PRIORITY: Final[tuple[HistoryKind, ...]] = ("rules", "offers", "holds", "grants", "money")


@dataclass(frozen=True)
class LogEntry:
    id: str
    entity: str
    entity_id: str
    action: str
    actor: str
    reason: str
    operation_id: str
    created: datetime


@dataclass(frozen=True)
class Operation:
    operation_id: str
    at: datetime
    actor: str
    kind: HistoryKind
    reason: str
    entries: tuple[LogEntry, ...]


def entry_of(record: Any) -> LogEntry | None:
    """One log row; a row with no created time has no place in the order and is left out."""
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        return None
    return LogEntry(
        id=str(record.id),
        entity=str(record.entity),
        entity_id=str(record.entity_id),
        action=str(record.action),
        actor=str(getattr(record, "actor", "") or ""),
        reason=str(getattr(record, "reason", "") or ""),
        operation_id=str(getattr(record, "operation_id", "") or record.id),
        created=created,
    )


def _kind(entries: tuple[LogEntry, ...]) -> HistoryKind:
    if any(e.actor == INTAKE_ACTOR for e in entries):
        return "intake"
    kinds = {ENTITY_KINDS.get(e.entity, "money") for e in entries}
    return next(k for k in _PRIORITY if k in kinds)


def operations(entries: Iterable[LogEntry]) -> list[Operation]:
    """The rows grouped by operation, scenario rows left out, newest first (by its last row, then id)."""
    grouped: dict[str, list[LogEntry]] = {}
    for entry in entries:
        if entry.entity not in NOT_IN_HISTORY:
            grouped.setdefault(entry.operation_id, []).append(entry)
    out = []
    for operation_id, rows in grouped.items():
        ordered = tuple(sorted(rows, key=lambda e: (e.created, e.id)))
        out.append(
            Operation(
                operation_id=operation_id,
                at=ordered[-1].created,
                actor=ordered[0].actor,
                kind=_kind(ordered),
                reason=next((e.reason for e in ordered if e.reason), ""),
                entries=ordered,
            )
        )
    return sorted(out, key=lambda o: (o.at, o.operation_id), reverse=True)


@dataclass(frozen=True)
class HistoryFilter:
    kinds: frozenset[HistoryKind] = frozenset()
    actor: str | None = None
    since: date | None = None
    until: date | None = None
    text: str = ""
    include_intake: bool = False
    rules: bool = False  # the reader holds financial_aid.rules


def visible(op: Operation, f: HistoryFilter) -> bool:
    if op.kind == "rules" and not f.rules:
        return False
    if op.kind == "intake" and not f.include_intake and "intake" not in f.kinds:
        return False
    if f.kinds and op.kind not in f.kinds:
        return False
    if f.actor is not None and op.actor != f.actor:
        return False
    day = camp_date(op.at)
    if (f.since is not None and day < f.since) or (f.until is not None and day > f.until):
        return False
    needle = f.text.strip().lower()
    if needle:
        hay = " ".join(f"{e.reason} {e.actor} {e.entity_id} {e.entity}" for e in op.entries).lower()
        if needle not in hay:
            return False
    return True


def _rules_parts(op: Operation) -> tuple[list[int], list[str]]:
    versions: set[int] = set()
    sections: set[str] = set()
    for e in op.entries:
        if e.entity != AID_RULES:
            continue
        parts = e.entity_id.split(":")  # "year:version" or "year:version:section" (_entity_id in the rules service)
        if len(parts) >= 2 and parts[1].isdigit():
            versions.add(int(parts[1]))
        if len(parts) == 3:
            sections.add(parts[2])
    return sorted(versions), sorted(sections)


def operation_out(op: Operation) -> HistoryOperationOut:
    counts = Counter((e.entity, e.action) for e in op.entries)
    versions, sections = _rules_parts(op)
    return HistoryOperationOut(
        operation_id=op.operation_id,
        at=op.at,
        actor=op.actor,
        kind=op.kind,
        reason=op.reason,
        rows=len(op.entries),
        counts=[HistoryCountOut(entity=e, action=a, rows=n) for (e, a), n in sorted(counts.items())],
        rules_versions=versions,
        rules_sections=sections,
    )

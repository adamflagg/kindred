"""Season › History (D49, app spec §7.6): the season's aid_change_log, one line per operation (operation_id), rules
and casework on one timeline, newest first. Pure: grouping, kinds and filters; the reads are in Task 13's service.

Read access follows the data: rules rows (and session capacity, set on the Rules tab) need financial_aid.rules. An
operation is "rules" only when every row is; a Posted tick that also locks rules sections is "offers", and a reader
without rules sees it minus those rows (for_reader). A rules-only operation stays hidden from them.
Intake runs (system:intake) are hidden unless asked. The scenario trail stays in Scenarios, so its collections are
left out. Amounts are what the rows recorded at the time, never recomputed."""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any, Final, Protocol

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
    AID_REPORTED_HISTORY,
    AID_REQUESTS,
    AID_RULES,
    AID_SCENARIO_OPTIONS,
    AID_SCENARIO_SNAPSHOTS,
    AID_SCENARIO_TRAIL,
    AID_SESSION_CAPACITY,
    AID_SOURCES,
)
from api.schemas.financial_aid_history import (
    HistoryCountOut,
    HistoryKind,
    HistoryOperationDetailOut,
    HistoryOperationOut,
    HistoryPageOut,
    HistoryRowOut,
)
from api.schemas.financial_aid_rules import field_change_out
from api.services.financial_aid_change_log_reads import log_detail
from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_reconciliation import camp_date
from bunking.financial_aid.change_diff import field_changes
from bunking.financial_aid.errors import FinancialAidError

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
    AID_REPORTED_HISTORY: "money",
    AID_POSTINGS: "money",
    AID_FLAG_DISPOSITIONS: "money",
}
NOT_IN_HISTORY: Final = frozenset({AID_SCENARIO_SNAPSHOTS, AID_SCENARIO_OPTIONS, AID_SCENARIO_TRAIL})
_PRIORITY: Final[tuple[HistoryKind, ...]] = ("rules", "offers", "holds", "grants", "money")


# --- Who a row is about (back-end ask H2) ---------------------------------------------------------------------------

# Collections whose log entity id is "<request id>" or "<request id>:<...>": a decision's ":<round>", a hold's
# ":<code>", a payer share's ":<paying household>" (share_entity_id), a request override's ":<field>".
# (A grant, a household link and a commitment's grant placement are keyed by their own ids: see Subjects.of.)
REQUEST_HEADED: Final = frozenset(
    {AID_REQUESTS, AID_DECISIONS, AID_HOLD_EVENTS, AID_CANCELLATIONS, AID_PAYER_SHARES, AID_APPLICATION_CORRECTIONS}
)


@dataclass(frozen=True)
class Subject:
    household_cm_id: int
    person_cm_id: int  # 0: the row is about the family (an application, a household's own request)
    request_id: str  # "" when the row names no request


@dataclass(frozen=True)
class Subjects:
    """Who the season's log rows are about, from its requests, applications, casework corrections, grants and
    household links. A row is matched by its entity and entity id alone, so the list (which reads no JSON) and the
    opened line agree. A rules-class collection is in none of the branches: a rules row is about no one."""

    requests: Mapping[str, tuple[int, int]]  # request id -> (household, person)
    applications: Mapping[str, int]  # application id -> household
    corrections: Mapping[str, str]  # casework correction id -> application id
    grants: Mapping[str, int]  # grant id -> household (a commitment's placement is keyed by its grant)
    links: Mapping[str, int]  # household link id -> household

    def of(self, entity: str, entity_id: str) -> Subject | None:
        if entity in REQUEST_HEADED:
            request_id = entity_id.split(":", 1)[0]
            found = self.requests.get(request_id)
            if found is not None:
                return Subject(found[0], found[1], request_id)
        household: int | None
        if entity == AID_APPLICATIONS:
            household = self.applications.get(entity_id)
        elif entity == AID_APPLICATION_CORRECTIONS:
            household = self.applications.get(self.corrections.get(entity_id, ""))
        elif entity == AID_GRANTS:
            household = self.grants.get(entity_id)
        elif entity == AID_HOUSEHOLD_LINKS:
            household = self.links.get(entity_id)
        elif entity == AID_GRANT_PLACEMENTS and entity_id.startswith("commitment:"):
            household = self.grants.get(entity_id.removeprefix("commitment:"))
        else:
            return None
        return Subject(household, 0, "") if household is not None else None


NO_SUBJECTS: Final = Subjects({}, {}, {}, {}, {})


def subjects_from(
    requests: Iterable[Any],
    applications: Iterable[Any],
    corrections: Iterable[Any],
    grants: Iterable[Any] = (),
    links: Iterable[Any] = (),
) -> Subjects:
    """The season's five light subject reads (fetch_subject_records) as one lookup."""
    return Subjects(
        requests={str(r.id): (int(r.household_cm_id), int(r.person_cm_id or 0)) for r in requests},
        applications={str(a.id): int(a.household_cm_id) for a in applications},
        corrections={str(c.id): str(c.application or "") for c in corrections},
        grants={str(g.id): int(g.household_cm_id) for g in grants},
        links={str(k.id): int(k.household_cm_id) for k in links},
    )


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


def row_subject(
    entry: LogEntry, subjects: Subjects, before: Mapping[str, Any] | None, after: Mapping[str, Any] | None
) -> Subject | None:
    """Who one opened row is about: what its id names, else the household the row itself recorded (a grant
    placement of a ledger line, `ledger:<txn>`), family-level. A rules row is about no one, whatever it recorded."""
    if ENTITY_KINDS.get(entry.entity) == "rules":
        return None
    found = subjects.of(entry.entity, entry.entity_id)
    if found is not None:
        return found
    for snapshot in (after, before):
        value = (snapshot or {}).get("household_cm_id")
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return Subject(value, 0, "")
    return None


def _kind(entries: tuple[LogEntry, ...]) -> HistoryKind:
    if any(e.actor == INTAKE_ACTOR for e in entries):
        return "intake"
    kinds = {ENTITY_KINDS.get(e.entity, "money") for e in entries}
    # A round's first Posted tick locks rules sections in the same operation: only a rules-only operation is rules.
    return next(k for k in _PRIORITY if k in (kinds - {"rules"} or kinds))


def _is_rules_row(entry: LogEntry) -> bool:
    return ENTITY_KINDS.get(entry.entity, "money") == "rules"


def for_reader(op: Operation, *, rules: bool) -> Operation | None:
    """What this reader may see of an operation: all of it with rules; without, the rows minus the rules rows, and
    None when nothing else is left (a rules-only operation)."""
    if rules:
        return op
    kept = tuple(e for e in op.entries if not _is_rules_row(e))
    if not kept:
        return None
    if len(kept) == len(op.entries):
        return op
    return replace(op, entries=kept, reason=next((e.reason for e in kept if e.reason), ""))


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


class HistoryNotFoundError(FinancialAidError):
    """No such operation this season, or none this reader may see (a rules operation without rules)."""


class HistoryReads(Protocol):
    async def fetch_season_log(self, year: int) -> list[Any]: ...
    async def fetch_operation(self, year: int, operation_id: str) -> list[Any]: ...
    async def fetch_subject_records(
        self, year: int
    ) -> tuple[list[Any], list[Any], list[Any], list[Any], list[Any]]: ...
    async def fetch_recorded(
        self, year: int, operation_ids: Collection[str], entities: Collection[str]
    ) -> list[Any]: ...
    async def fetch_names(
        self, year: int, households: Collection[int], persons: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
    async def fetch_rules_version(self, year: int, version: int) -> Any | None: ...


class SeasonHistoryService:
    def __init__(self, reads: HistoryReads) -> None:
        self._reads = reads

    async def page(self, year: int, f: HistoryFilter, *, page: int, per_page: int) -> HistoryPageOut:
        all_ops = operations(e for r in await self._reads.fetch_season_log(year) if (e := entry_of(r)) is not None)
        ops = [seen for o in all_ops if (seen := for_reader(o, rules=f.rules)) is not None]
        readable = [o for o in ops if visible(o, HistoryFilter(rules=f.rules, include_intake=True))]
        shown = [o for o in ops if visible(o, f)]
        start = (page - 1) * per_page
        return HistoryPageOut(
            year=year,
            page=page,
            per_page=per_page,
            total=len(shown),
            operations=[operation_out(o) for o in shown[start : start + per_page]],
            actors=sorted({o.actor for o in readable if o.kind != "intake"}),
        )

    async def operation(self, year: int, operation_id: str, *, rules: bool) -> HistoryOperationDetailOut:
        records = await self._reads.fetch_operation(year, operation_id)
        found = operations(e for r in records if (e := entry_of(r)) is not None)
        op = for_reader(found[0], rules=rules) if found else None
        if op is None:
            raise HistoryNotFoundError(f"no operation {operation_id} in {year}")
        by_id = {str(r.id): r for r in records}
        rows = []
        for e in op.entries:
            record = by_id[e.id]
            before, after = log_detail(getattr(record, "before", None)), log_detail(getattr(record, "after", None))
            rows.append(
                HistoryRowOut(
                    at=e.created,
                    entity=e.entity,
                    entity_id=e.entity_id,
                    action=e.action,
                    actor=e.actor,
                    reason=e.reason,
                    before=before,
                    after=after,
                    changes=[field_change_out(c) for c in field_changes(before, after)],
                )
            )
        return HistoryOperationDetailOut(year=year, operation=operation_out(op), rows=rows)

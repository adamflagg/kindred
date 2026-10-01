"""Grant placement, logged so a past date can replay it (campership 3c-2; owner rulings 2026-09-30 and
2026-10-01).

The grants register (sub-project 6-core) places each grant line and commitment on aid requests at
read time, from enrollments and records that aren't dated. So a past date can know which request a
grant sat on, every live pricing of the season logs the placement it priced with: it compares the
register's rows with the newest logged row of each grant and appends one aid_grant_placements row
for each grant whose placement is new or changed (`place`), or that has left the register
(`remove`), through sub-project 4a's commit_aid_writes. Nothing is written when nothing moved. The
log is pricing history (system rows, written only on a change), not an access log, so a write that
fails fails the read (owner ruling 2026-10-01). A placement is recorded at the next pricing after it
moves, since the enrollments behind it are undated (owner ruling 2026-10-01).

A past date replays the newest row per grant recorded by the end of that day. A placement has no
CampMinder date, so the cut is when Kindred recorded it on both axes (owner ruling 2026-09-30); on
the campminder axis a line CampMinder posted after the day, or reversed by it, is read on its own
CampMinder dates. A household with a grant by then whose placement no row covers is named, and only
its requests and their pools are left empty (grant_placement).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any, Final, Literal

from pydantic import TypeAdapter

from api.constants.collections import AID_GRANT_PLACEMENTS
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_ledger_service import parse_pb_datetime
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.change_replay import LogRow

# 4a's actor for the placement log, as intake writes as "system:intake".
PLACEMENT_ACTOR: Final = "system:grant-placement"
PLACEMENT_REASON: Final = "Where the grants register placed each grant when Kindred priced the season"

PlacementEvent = Literal["place", "remove"]

# The whole register row, every field pricing and the budget read (a pays-after-camp-aid flag, D143,
# included), money as exact text. One adapter both ways, as the scenario snapshot stores its rows
# (financial_aid_scenario_pricing), so a field the register gains later is logged with no edit here.
_ROW: Final = TypeAdapter(RegisterRow)


def grant_key(row: RegisterRow) -> str:
    """One grant's key in the log: its CampMinder transaction, or its commitment record."""
    return f"ledger:{row.transaction_cm_id}" if row.kind == "ledger" else f"commitment:{row.commitment_id}"


def placement_json(row: RegisterRow) -> dict[str, Any]:
    """The register row as the log stores it."""
    out: dict[str, Any] = _ROW.dump_python(row, mode="json")
    return out


def register_row(placement: Mapping[str, Any]) -> RegisterRow:
    """A logged placement back into the register row it recorded."""
    return _ROW.validate_python(dict(placement))


@dataclass(frozen=True)
class PlacementRecord:
    """One aid_grant_placements row."""

    id: str
    grant: str
    household_cm_id: int
    event: PlacementEvent
    placement: Mapping[str, Any] | None  # None on a remove
    created: datetime


def placement_record(record: Any) -> PlacementRecord:
    """One aid_grant_placements record as the log reads it."""
    event = str(record.event)
    if event not in ("place", "remove"):
        raise ValueError(f"aid_grant_placements {record.id}: unknown event {event!r}")
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"aid_grant_placements {record.id} has no created time")
    placement = getattr(record, "placement", None)
    return PlacementRecord(
        id=str(record.id),
        grant=str(record.grant),
        household_cm_id=int(getattr(record, "household_cm_id", 0) or 0),
        event="place" if event == "place" else "remove",
        placement=dict(placement) if isinstance(placement, Mapping) else None,
        created=created,
    )


def newest(records: Iterable[PlacementRecord], at: datetime | None = None) -> dict[str, PlacementRecord]:
    """Each grant's newest row recorded by `at` (every row when None), in recorded order; the record id
    breaks a tie in the same instant, as the folds do."""
    out: dict[str, PlacementRecord] = {}
    for record in sorted(records, key=lambda r: (r.created, r.id)):
        if at is None or record.created <= at:
            out[record.grant] = record
    return out


def _write(year: int, grant: str, household_cm_id: int, event: PlacementEvent, placement: Any) -> AidWrite:
    data = {
        "year": year,
        "grant": grant,
        "household_cm_id": household_cm_id,
        "event": event,
        "placement": placement,
        "actor": PLACEMENT_ACTOR,
    }
    return AidWrite(
        collection=AID_GRANT_PLACEMENTS,
        action="create",
        year=year,
        data=data,
        after={key: value for key, value in data.items() if key != "actor"},
        log_action=event,
        entity_id=grant,
    )


def placement_writes(year: int, rows: Sequence[RegisterRow], records: Iterable[PlacementRecord]) -> list[AidWrite]:
    """The rows to append so the log holds the register's placement now: a `place` for each grant that
    is new or whose placement changed, a `remove` for each logged grant no longer in the register.
    [] when the log already holds it."""
    logged = newest(records)
    writes: list[AidWrite] = []
    seen: set[str] = set()
    for row in rows:
        key = grant_key(row)
        seen.add(key)
        body = placement_json(row)
        last = logged.get(key)
        if last is not None and last.event == "place" and dict(last.placement or {}) == body:
            continue
        writes.append(_write(year, key, row.household_cm_id, "place", body))
    for key, last in sorted(logged.items()):
        if key not in seen and last.event == "place":
            writes.append(_write(year, key, last.household_cm_id, "remove", None))
    return writes


@dataclass(frozen=True)
class PlacementsAsOf:
    """The grants as the log had placed them by an instant, and what the log can't place."""

    rows: tuple[RegisterRow, ...]  # the logged placements standing then, read on the axis
    households: frozenset[int]  # households with a grant by then that no logged row places
    people: frozenset[int]  # the people those grants name
    requests: frozenset[str]  # the requests today's register places those grants on (widening only)


def placements_as_of(
    records: Sequence[PlacementRecord],
    register_now: Sequence[RegisterRow],
    grant_log: Sequence[LogRow],
    at: datetime,
    *,
    posted_by: date | None = None,
) -> PlacementsAsOf:
    """The grant placements standing at `at`, from the log, and the grants it can't place.

    `posted_by` is the campminder axis's day (None: the recorded axis), as fold_rounds takes it. On it
    a ledger line CampMinder posted after the day is left out, and one CampMinder reversed by the day
    counts nowhere, read from the grant's newest row (today's register first): a line's post and
    reversal dates are CampMinder's. Its placement stays the one logged by `at`.

    A grant is unplaced when it could have existed by `at` and no row for it was recorded by then:
    a register row recorded by then (its recorded_at is its CampMinder post date, or when Kindred
    recorded the commitment), or a commitment whose create was logged by then (a withdrawn one has
    left the register). This is wide on purpose: the register carries no sync time, so a line posted
    before the date but synced after it is named too. It only ever empties, never mis-states. A ledger
    line CampMinder deleted outright before the log began is invisible here."""
    logged = newest(records, at)
    latest = newest(records)
    now = {grant_key(row): row for row in register_now}
    rows: list[RegisterRow] = []
    for key, record in sorted(logged.items()):
        if record.event != "place" or record.placement is None:
            continue
        row = register_row(record.placement)
        if posted_by is not None and row.kind == "ledger":
            if row.recorded_on[:10] > posted_by.isoformat():
                continue
            newest_placement = latest[key].placement  # a remove since keeps its reversal unknown: none
            current = now.get(key) or (register_row(newest_placement) if newest_placement is not None else None)
            if (
                current is not None
                and current.is_reversed
                and current.reversal_date[:10] <= posted_by.isoformat()
                and not row.is_reversed
            ):
                row = replace(row, is_reversed=True, reversal_date=current.reversal_date, counts=False, requests=())
        rows.append(row)
    unplaced = [
        row for key, row in now.items() if key not in logged and (row.recorded_at is None or row.recorded_at <= at)
    ]
    commitments = [
        entry.after
        for entry in grant_log
        if entry.before is None
        and entry.after is not None
        and entry.created <= at
        and f"commitment:{entry.entity_id}" not in logged
        and f"commitment:{entry.entity_id}" not in now
    ]
    households = {row.household_cm_id for row in unplaced} | {int(c.get("household_cm_id") or 0) for c in commitments}
    people = {row.person_cm_id for row in unplaced} | {int(c.get("person_cm_id") or 0) for c in commitments}
    return PlacementsAsOf(
        rows=tuple(rows),
        households=frozenset(households - {0}),
        people=frozenset(people - {0}),
        requests=frozenset(share.request_id for row in unplaced for share in row.requests),
    )

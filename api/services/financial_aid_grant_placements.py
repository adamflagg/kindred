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
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from pydantic import TypeAdapter

from api.constants.collections import AID_GRANT_PLACEMENTS
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_ledger_service import parse_pb_datetime
from bunking.financial_aid.change_log import AidWrite

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

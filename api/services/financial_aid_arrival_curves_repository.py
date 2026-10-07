"""PocketBase access for aid_arrival_curves (Scenarios addendum §S11.7): one season's aggregate arrival curve. The
superuser client is the only way in (all five rules null). A save is one logged operation (action "load") through
commit_aid_writes, like every aid write, and replaces the season's row: a bad year is corrected the way it was
loaded. Nothing changed, nothing written: a re-run with the same figures leaves the row and the log alone."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any, Final

from api.constants.collections import AID_ARRIVAL_CURVES
from api.services.pb_precise_datetime import aid_collection
from bunking.financial_aid.arrival import ArrivalCurve, points_from_json, points_json
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import AidWrite, commit_aid_writes

_FIELDS: Final = ("year", "source", "aligned_on", "anchor", "points", "counted", "actor")  # every key curve_data sends


def curve_record(record: Any) -> ArrivalCurve:
    return ArrivalCurve(
        year=int(record.year),
        aligned_on=record.aligned_on,
        anchor=date.fromisoformat(str(record.anchor)),
        points=points_from_json(record.points),
        counted=int(record.counted),
        source=record.source,
    )


def curve_data(curve: ArrivalCurve, actor: str) -> dict[str, Any]:
    return {
        "year": curve.year,
        "source": curve.source,
        "aligned_on": curve.aligned_on,
        "anchor": curve.anchor.isoformat(),
        "points": points_json(curve),
        "counted": curve.counted,
        "actor": actor,
    }


class ArrivalCurveRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _row(self, year: int) -> Any | None:
        result = await asyncio.to_thread(
            aid_collection(self.pb, AID_ARRIVAL_CURVES).get_list, 1, 1, {"filter": f"year = {int(year)}"}
        )
        return result.items[0] if result.items else None

    async def curve(self, year: int) -> ArrivalCurve | None:
        row = await self._row(year)
        return curve_record(row) if row is not None else None

    async def save(self, curve: ArrivalCurve, *, actor: str) -> bool:
        """Store the season's curve; False when its row already holds these figures (nothing written)."""
        data = curve_data(curve, actor)
        row = await self._row(curve.year)
        if row is None:
            write = AidWrite(
                collection=AID_ARRIVAL_CURVES,
                action="create",
                year=curve.year,
                data=data,
                log_action="load",
                entity_id=str(curve.year),
            )
        else:
            before = {name: getattr(row, name, None) for name in _FIELDS}
            if changed_fields(before, data) == ({}, {}):
                return False
            write = AidWrite(
                collection=AID_ARRIVAL_CURVES,
                action="update",
                year=curve.year,
                record_id=str(row.id),
                before=before,
                data=data,
                log_action="load",
                entity_id=str(curve.year),
            )
        await asyncio.to_thread(commit_aid_writes, self.pb, [write], actor=actor)
        return True

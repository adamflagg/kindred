"""PocketBase access for Reports' typed history (Reports back end, Part A; O-930-13's default): the
aid_reported_history collection. Reads parse records into ReportedFigure; every write goes through `commit` (4a's
commit_aid_writes: each record and its aid_change_log row in one batch). FastAPI's superuser client is the only way
in: all five PocketBase rules are null.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import AID_REPORTED_HISTORY
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.reports.history import ATS, VIEWS, ReportedFigure
from bunking.pocketbase_batch import BatchRequestFailedError

PAGE_SIZE: Final = 1000


class ReportedFigureTakenError(FinancialAidError, ValueError):
    """Someone stored the same figure (the unique natural-key index) at the same moment."""


@dataclass(frozen=True)
class StoredFigure:
    id: str
    figure: ReportedFigure


def figure_fields(figure: ReportedFigure) -> dict[str, Any]:
    """The record's fields, as a create writes them and the change log records them."""
    return {
        "year": figure.year,
        "view": figure.view,
        "metric": figure.metric,
        "pool": figure.pool,
        "tier": figure.tier,
        "phase": figure.phase,
        "at": figure.at,
        "as_of": figure.as_of.isoformat(),
        "value": float(figure.value),
        "source": figure.source,
        "note": figure.note,
    }


def _choice[T: str](value: Any, allowed: tuple[T, ...]) -> T:
    text = str(value or "")
    for choice in allowed:
        if choice == text:
            return choice
    raise ValueError(f"aid_reported_history: {text!r} is not one of {allowed}")


def _date(value: Any) -> date:
    return date.fromisoformat(str(value).strip()[:10])


def figure_from_record(record: Any) -> StoredFigure:
    return StoredFigure(
        id=str(record.id),
        figure=ReportedFigure(
            year=int(record.year),
            view=_choice(record.view, VIEWS),
            metric=str(record.metric),
            pool=str(getattr(record, "pool", "") or ""),
            tier=int(getattr(record, "tier", 0) or 0),
            phase=int(getattr(record, "phase", 0) or 0),
            at=_choice(record.at, ATS),
            as_of=_date(record.as_of),
            value=Decimal(str(getattr(record, "value", 0) or 0)).quantize(Decimal("0.01")),
            source=str(getattr(record, "source", "") or ""),
            note=str(getattr(record, "note", "") or ""),
        ),
    )


class ReportsRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def reported(self) -> list[StoredFigure]:
        """Every typed figure, every season and view (they are few: a few hundred in all)."""
        rows: list[Any] = await asyncio.to_thread(
            self.pb.collection(AID_REPORTED_HISTORY).get_full_list,
            batch=PAGE_SIZE,
            query_params={"sort": "year,view,metric,pool,tier,phase,at,as_of"},
        )
        return [figure_from_record(row) for row in rows]

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        """Each write and its aid_change_log row in ONE batch. The unique natural-key index is the only refusal
        expected (two loads of one figure at the same moment)."""
        try:
            return await asyncio.to_thread(commit_aid_writes, self.pb, writes, actor=actor, reason=reason)
        except BatchRequestFailedError as exc:
            if exc.status == 400 and any("unique" in message.lower() for message in exc.field_errors.values()):
                raise ReportedFigureTakenError(
                    "Someone stored the same figure at the same moment: load again."
                ) from exc
            raise

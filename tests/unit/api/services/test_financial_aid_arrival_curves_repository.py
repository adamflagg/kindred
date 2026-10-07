"""aid_arrival_curves access (Scenarios addendum §S11.7): one season's aggregate curve, read and upserted as a logged
operation. A test double for PocketBase; fictional figures only."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services import financial_aid_arrival_curves_repository as module
from api.services.financial_aid_arrival_curves_repository import ArrivalCurveRepository, curve_record
from bunking.financial_aid.arrival import ArrivalCurve, CurvePoint

CURVE = ArrivalCurve(
    2026,
    "application_deadline",
    date(2026, 2, 4),
    (CurvePoint(-1, Decimal("0.4")), CurvePoint(0, Decimal(1))),
    5,
    "workbook",
)


def _row(**fields: Any) -> SimpleNamespace:
    base = {
        "id": "arc000000000001",
        "year": 2026,
        "source": "workbook",
        "aligned_on": "application_deadline",
        "anchor": "2026-02-04",
        "points": [{"week": -1, "share": "0.4"}, {"week": 0, "share": "1"}],
        "counted": 5,
        "actor": "system:arrival-curve-loader",
    }
    return SimpleNamespace(**{**base, **fields})


def _pb(items: list[Any]) -> MagicMock:
    pb = MagicMock()
    pb.collection.return_value.get_list.return_value = SimpleNamespace(items=items)
    return pb


def test_a_stored_row_reads_as_its_curve() -> None:
    assert curve_record(_row()) == CURVE


@pytest.mark.asyncio
async def test_a_season_with_no_row_has_no_curve() -> None:
    assert await ArrivalCurveRepository(_pb([])).curve(2026) is None


@pytest.mark.asyncio
async def test_a_first_save_creates_the_row_and_logs_one_load(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[Any] = []
    monkeypatch.setattr(
        module, "commit_aid_writes", lambda pb, writes, *, actor, reason=None: sent.append((writes, actor))
    )
    await ArrivalCurveRepository(_pb([])).save(CURVE, actor="system:arrival-curve-loader")
    [(writes, actor)] = sent
    [write] = writes
    assert (write.collection, write.action, write.log_action, write.entity_id, actor) == (
        "aid_arrival_curves",
        "create",
        "load",
        "2026",
        "system:arrival-curve-loader",
    )
    assert write.data == {
        "year": 2026,
        "source": "workbook",
        "aligned_on": "application_deadline",
        "anchor": "2026-02-04",
        "points": [{"week": -1, "share": "0.4"}, {"week": 0, "share": "1"}],
        "counted": 5,
        "actor": "system:arrival-curve-loader",
    }


@pytest.mark.asyncio
async def test_a_rerun_replaces_the_seasons_row(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[Any] = []
    monkeypatch.setattr(module, "commit_aid_writes", lambda pb, writes, *, actor, reason=None: sent.append(writes))
    await ArrivalCurveRepository(_pb([_row(counted=4)])).save(CURVE, actor="system:arrival-curve-loader")
    [[write]] = sent
    assert (write.action, write.record_id, write.before["counted"], write.data["counted"]) == (
        "update",
        "arc000000000001",
        4,
        5,
    )

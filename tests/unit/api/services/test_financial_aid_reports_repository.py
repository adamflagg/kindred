"""ReportsRepository.commit (Reports back end, Part A): the reason travels to the change log through the real
repository, not just the in-memory twin. Fictional only."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.constants.collections import AID_REPORTED_HISTORY
from api.services.financial_aid_reports_repository import ReportsRepository, figure_fields
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.reports.history import ReportedFigure
from tests.unit.api.services.financial_aid_fakes import _BatchTwin
from tests.unit.api.services.reports_fakes import FakeReportsStore

pytestmark = pytest.mark.asyncio


async def test_commit_passes_the_reason_through_to_the_change_log() -> None:
    store = FakeReportsStore()
    figure = ReportedFigure(2026, "finance", "budget", "", 0, 0, "season_end", date(2026, 10, 10), Decimal(500000))
    record_id = store.seed(figure)
    repository = ReportsRepository(_BatchTwin(store))
    await repository.commit(
        [
            AidWrite(
                collection=AID_REPORTED_HISTORY,
                action="delete",
                year=2026,
                record_id=record_id,
                before=figure_fields(figure),
            )
        ],
        actor="finance@example.com",
        reason="typed against the wrong date",
    )
    assert store.rows == []
    assert store.log[-1]["reason"] == "typed against the wrong date"

"""Intake writes nothing for a season before AID_INTAKE_FLOOR_YEAR.

Owner ruling: "2024 and prior dont need aid lists". Every caller (the Go sync trigger, the addition rebuild)
goes through FinancialAidIntakeService.build, so the floor sits there. Fictional data only.
"""

from __future__ import annotations

import logging

import pytest

from api.services.financial_aid_intake_service import AID_INTAKE_FLOOR_YEAR, FinancialAidIntakeService
from tests.unit.api.services.financial_aid_fakes import FakeAidStore, fa_row, intake_rules

HOUSEHOLD = 1000001


def store_with_a_form() -> FakeAidStore:
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [fa_row(1000011, HOUSEHOLD)]
    return store


def test_the_floor_is_2025() -> None:
    assert AID_INTAKE_FLOOR_YEAR == 2025


@pytest.mark.asyncio
@pytest.mark.parametrize("year", [2017, 2024])
async def test_a_season_below_the_floor_reads_and_writes_nothing(year: int, caplog: pytest.LogCaptureFixture) -> None:
    store = store_with_a_form()
    with caplog.at_level(logging.INFO):
        report = await FinancialAidIntakeService(store).build(year)
    assert (store.writes, store.operations, store.years_read) == ([], [], set())
    assert report.year == year
    assert (report.households, report.requests_created, report.applications_created, report.operation_id) == (
        0,
        0,
        0,
        "",
    )
    assert report.skipped_reason == "year below intake floor"
    assert sum("intake skipped: year < floor" in r.getMessage() for r in caplog.records) == 1


@pytest.mark.asyncio
async def test_the_floor_season_runs_as_before() -> None:
    store = store_with_a_form()
    report = await FinancialAidIntakeService(store).build(AID_INTAKE_FLOOR_YEAR)
    assert report.skipped_reason == ""
    assert store.years_read == {AID_INTAKE_FLOOR_YEAR}

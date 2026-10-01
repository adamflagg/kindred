"""A past date priced from the change log and the grant placement log (campership 3c-2). Fictional
only; figures as in decisions_fakes: Session 2 costs 2,000, so a tier-2 family (60,000) gets Round 1 =
1,500, and an outside grant of 500 on the request brings it to 1,000."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_APPLICATIONS, AID_GRANTS, AID_REQUESTS
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, _applications_as_of
from api.services.financial_aid_grant_placements import PlacementRecord, grant_key, placement_json
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY, EquityAnswers
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import DecisionEvent
from tests.unit.api.services.decisions_fakes import (
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    log_seeded,
    log_update,
    seed_line,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA, LIAM = "reqemma00000001", "reqliam00000001"
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
MAR_9 = date(2027, 3, 9)


def _day(month: int, day: int) -> datetime:
    return datetime(2027, month, day, 18, 0, tzinfo=UTC)


def _service(store: FakeDecisionsStore, register: Sequence[RegisterRow] = ()) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    return FinancialAidDecisionsService(store, FakeRules(approved()), rows, clock=lambda: NOW)


def _two_families(*, equity: EquityAnswers | None = UNKNOWN_EQUITY) -> FakeDecisionsStore:
    """Emma (household 1000001) and Liam (1000002), both tier 2 in Session 2, logged on Feb 1 with the
    equity answers intake recorded (None: before intake recorded any)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    for request_id, request in store.requests.items():
        store.requests[request_id] = replace(request, equity=equity)
    log_seeded(store, SEEDED)
    return store


def _placed(store: FakeDecisionsStore, row: RegisterRow, at: datetime) -> None:
    """One grant placement logged at `at`, as live pricing logs it."""
    store.grant_placements.append(
        PlacementRecord(
            id=f"gpl{len(store.grant_placements):012d}",
            grant=grant_key(row),
            household_cm_id=row.household_cm_id,
            event="place",
            placement=placement_json(row),
            created=at,
        )
    )


def _row(out: Any, request_id: str) -> Any:
    return next(row for row in out.rows if row.request_id == request_id)


def _pool(out: Any, key: str) -> Any:
    return next(p for p in out.pools if p.pool == key)


def test_an_application_replays_to_the_instant_and_one_with_no_create_row_is_unreplayable() -> None:
    store = _two_families()
    app_id = store.requests[EMMA].application_id
    log_update(
        store,
        AID_APPLICATIONS,
        app_id,
        {"answers": {"total_gross_income": 60000.0}},
        {"answers": {"total_gross_income": 500.0}},
        _day(3, 20),
    )
    app_log = [r for r in store.change_log if r.entity == AID_APPLICATIONS]
    then, bad = _applications_as_of(app_log, _day(3, 9), store.applications)
    assert (then[app_id].answers["total_gross_income"], bad) == (60000.0, frozenset())
    later, _ = _applications_as_of(app_log, _day(3, 21), store.applications)
    assert later[app_id].answers["total_gross_income"] == 500.0
    missing, bad = _applications_as_of([r for r in app_log if r.entity_id != app_id], _day(3, 9), store.applications)
    assert (app_id in missing, bad) == (False, frozenset({app_id}))

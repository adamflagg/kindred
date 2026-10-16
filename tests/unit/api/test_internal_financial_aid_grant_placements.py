"""POST /api/internal/financial-aid/grant-placements -- the Go grant_placements sync step (campership 3c-2).

The route records where the grants register places each grant, for its season, so a past date can replay it
(owner ruling 2026-10-16: the sync step and the warm record placements; an interactive read never does). Fictional
only."""

from __future__ import annotations

from collections.abc import Sequence
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import internal
from api.services.financial_aid_grant_placements import PLACEMENT_ACTOR
from api.services.financial_aid_grants_register import RegisterRow
from tests.unit.api.services.decisions_fakes import EMMA, FakeDecisionsStore, grant_row, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR

ROUTE = "/api/internal/financial-aid/grant-placements"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(internal.router)
    return TestClient(app)


def _post(store: FakeDecisionsStore, register: Sequence[RegisterRow], year: int = YEAR) -> tuple[int, object]:
    async def rows(season: int) -> Sequence[RegisterRow]:
        assert season == year
        return register

    with (
        patch.object(internal, "FinancialAidDecisionsRepository", return_value=store),
        patch.object(internal, "GrantsService") as grants,
    ):
        grants.return_value.register_rows = rows
        response = _client().post(ROUTE, json={"year": year})
    return response.status_code, response.json()


def test_the_route_records_the_seasons_placements_and_returns_counts() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    status, body = _post(store, [grant_row(EMMA, "500")])
    assert (status, body) == (200, {"year": YEAR, "placed": 1, "removed": 0})
    (logged,) = store.grant_placements
    assert (logged.grant, logged.event) == ("ledger:9001", "place")
    assert [row["actor"] for row in store.log] == [PLACEMENT_ACTOR]


def test_a_rerun_with_nothing_moved_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    register = [grant_row(EMMA, "500")]
    _post(store, register)
    operations = len(store.operations)
    status, body = _post(store, register)
    assert (status, body) == (200, {"year": YEAR, "placed": 0, "removed": 0})
    assert len(store.operations) == operations
    assert len(store.grant_placements) == 1


def test_a_season_before_the_log_is_rejected() -> None:
    """2017-2025 have no aid requests (the replay seasons); the Go step never asks for them, and the route refuses."""
    store = FakeDecisionsStore()
    status, _ = _post(store, [grant_row(EMMA, "500")], year=2025)
    assert status == 422
    assert store.operations == []

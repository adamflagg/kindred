"""POST /api/internal/financial-aid/intake -- the Go FA sync's trigger."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import internal
from api.services.financial_aid_intake_service import IntakeReport


def test_the_trigger_builds_the_named_season_and_returns_the_report() -> None:
    report = IntakeReport(2027, 2, 2, 0, 3, 0, 1, 0, 1, 1)
    with patch.object(internal, "FinancialAidIntakeService") as service_cls:
        service_cls.return_value.build = AsyncMock(return_value=report)
        app = FastAPI()
        app.include_router(internal.router)
        response = TestClient(app).post("/api/internal/financial-aid/intake", json={"year": 2027})
    assert response.status_code == 200
    assert response.json()["requests_created"] == 3
    service_cls.return_value.build.assert_awaited_once_with(2027)


def test_the_report_carries_the_season_warnings() -> None:
    report = IntakeReport(
        2027, 2, 2, 0, 3, 0, 1, 0, 1, 1, warnings=("equity_field_never_true: unemployment (0 of 7 applicants)",)
    )
    with patch.object(internal, "FinancialAidIntakeService") as service_cls:
        service_cls.return_value.build = AsyncMock(return_value=report)
        app = FastAPI()
        app.include_router(internal.router)
        response = TestClient(app).post("/api/internal/financial-aid/intake", json={"year": 2027})
    assert response.status_code == 200
    assert response.json()["warnings"] == ["equity_field_never_true: unemployment (0 of 7 applicants)"]


def test_an_out_of_range_year_is_rejected() -> None:
    app = FastAPI()
    app.include_router(internal.router)
    assert TestClient(app).post("/api/internal/financial-aid/intake", json={"year": 1999}).status_code == 422


def test_the_trigger_sees_the_mirror_the_same_sync_just_wrote() -> None:
    """The Go FA sync calls this route right after writing the mirror and BEFORE its job-completion cache clear.

    Layer 1 (aid_sync_inputs) holds the FA mirror, so a season it warmed earlier still holds the previous sync's
    rows at that moment: the trigger must rebuild from the mirror as it is now, or a new applicant reaches intake a
    sync late and a deleted row lingers."""
    from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
    from tests.unit.api.services.aid_parity_fixture import PARITY_YEAR, parity_pb

    fake_pb = parity_pb()
    seen: list[set[int]] = []

    class _RecordingService:
        def __init__(self, repo: FinancialAidIntakeRepository) -> None:
            self.repo = repo

        async def build(self, year: int) -> IntakeReport:
            seen.append({r.person_cm_id for r in await self.repo.fetch_fa_rows(year)})
            return IntakeReport(year, 0, 0, 0, 0, 0, 0, 0, 0, 0)

    app = FastAPI()
    app.include_router(internal.router)
    client = TestClient(app)
    with patch.object(internal, "pb", fake_pb), patch.object(internal, "FinancialAidIntakeService", _RecordingService):
        # A staff page warms layer 1 with the season as the previous sync left it.
        warm = asyncio.run(FinancialAidIntakeRepository(fake_pb).fetch_fa_rows(PARITY_YEAR))
        # The FA sync writes the mirror: a new applicant row lands.
        mirror = fake_pb.tables["financial_aid_applications"]
        template = next(r for r in mirror if r.is_applicant is True and int(r.year) == PARITY_YEAR)
        new_cm = 4_242_424
        mirror.append(SimpleNamespace(**{**vars(template), "id": "fanewapplicant1", "person_id": new_cm}))
        # Its in-job trigger, before the completion clear.
        assert client.post("/api/internal/financial-aid/intake", json={"year": PARITY_YEAR}).status_code == 200

    assert new_cm not in {r.person_cm_id for r in warm}
    assert new_cm in seen[0], "the intake rebuild read the previous sync's mirror from layer 1"


# -- CLOSED-SEASONS-DONE: intake never rewrites a done season's requests -----------------------------------------------


def _intake_on(season: int | None, year: int) -> tuple[int, dict[str, object], AsyncMock]:
    """POST the trigger for `year` with the dashboard's season `season` (None: it can't be read)."""
    import api.dependencies as dependencies
    from api.services.aid_season_state import SeasonYearUnknownError

    async def configured() -> int:
        if season is None:
            raise SeasonYearUnknownError("The dashboard's season couldn't be read")
        return season

    build = AsyncMock(return_value=IntakeReport(year, 1, 1, 0, 1, 0, 0, 0, 0, 0))
    with (
        patch.object(dependencies, "dashboard_season", configured),
        patch.object(internal, "FinancialAidIntakeService") as service_cls,
    ):
        service_cls.return_value.build = build
        app = FastAPI()
        app.include_router(internal.router)
        response = TestClient(app).post("/api/internal/financial-aid/intake", json={"year": year})
    return response.status_code, response.json(), build


def test_intake_skips_a_done_season_and_says_why() -> None:
    """Owner ruling NG-01 / CSD-8: nothing changes a closed season's requests, so a replay of 2025 builds nothing. It
    answers 200 with the skip, as the intake floor does, so the Go sync logs no failure."""
    status, body, build = _intake_on(2027, 2025)
    assert status == 200
    assert body["skipped_reason"] == "closed season: its requests are history"
    assert body["requests_created"] == body["requests_updated"] == 0
    build.assert_not_awaited()


def test_intake_still_builds_the_open_seasons() -> None:
    for year in (2026, 2027):
        status, _, build = _intake_on(2027, year)
        assert status == 200
        build.assert_awaited_once_with(year)


def test_intake_on_an_unreadable_season_never_blocks_an_open_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """The nightly's behaviour for open seasons is unchanged: a sync-status blip falls back to the Oct 15 rule rather
    than refusing the build (the gate's write side is strict; intake is the sync's own rebuild, never a staff write)."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2027")
    status, _, build = _intake_on(None, 2026)
    assert status == 200
    build.assert_awaited_once_with(2026)
    status, body, build = _intake_on(None, 2025)
    assert body["skipped_reason"] == "closed season: its requests are history"
    build.assert_not_awaited()

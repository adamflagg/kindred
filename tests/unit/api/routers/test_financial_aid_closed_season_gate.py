"""The closed-season write gate (CLOSED-SEASONS-DONE; owner ruling CSD-8 = a, 2026-10-28): the server refuses every
write to a done season's requests with a 409, and there is no Unlock. The allow-list stays open: reported history and
recipients, development columns, funding sources, rules (their own done-season lock), sources, funders, the rules'
scenario sandbox, and the read-only previews.

The route-table walk fails when a new write endpoint under /api/financial-aid is neither gated nor allow-listed.
Fictional only."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import api.dependencies as dependencies
from api.routers import financial_aid
from api.schemas.financial_aid_decisions import DecisionWriteOut
from api.services.aid_season_state import SeasonYearUnknownError
from bunking.auth_middleware import AuthUser, get_current_user

WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
REQ = "reqemma00000001"
WRITE = DecisionWriteOut(year=2025, written=1, unchanged=0, operation_id="o" * 15)


def _calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    for sub in dependant.dependencies:
        if sub.call is not None:
            yield sub.call
        yield from _calls(sub)


def _write_routes() -> list[APIRoute]:
    return [
        route
        for route in financial_aid.router.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/financial-aid") and route.methods & WRITES
    ]


def _key(route: APIRoute) -> tuple[str, str]:
    (method,) = route.methods & WRITES
    return method, route.path


def _gated(route: APIRoute) -> bool:
    return any(call in financial_aid.CLOSED_SEASON_GATES for call in _calls(route.dependant))


# -- The route-table walk ----------------------------------------------------------------------------------------


def test_every_write_is_gated_or_allow_listed() -> None:
    """A new write endpoint fails here until it carries a closed-season gate or is named on the allow-list with why."""
    loose = [
        _key(r) for r in _write_routes() if not _gated(r) and _key(r) not in financial_aid.CLOSED_SEASON_OPEN_WRITES
    ]
    assert loose == []


def test_no_write_is_both_gated_and_allow_listed() -> None:
    both = [_key(r) for r in _write_routes() if _gated(r) and _key(r) in financial_aid.CLOSED_SEASON_OPEN_WRITES]
    assert both == []


def test_every_allow_listed_write_is_a_real_route_with_a_reason() -> None:
    routes = {_key(r) for r in _write_routes()}
    assert set(financial_aid.CLOSED_SEASON_OPEN_WRITES) <= routes
    assert all(reason.strip() for reason in financial_aid.CLOSED_SEASON_OPEN_WRITES.values())


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/financial-aid/reports/reported-history/bulk"),
        ("DELETE", "/api/financial-aid/reports/reported-history/{record_id}"),
        ("POST", "/api/financial-aid/reports/reported-recipients/bulk"),
        ("DELETE", "/api/financial-aid/reports/reported-recipients/{record_id}"),
        ("PUT", "/api/financial-aid/reports/development/columns"),
        ("PUT", "/api/financial-aid/reports/{year}/funding-sources/{source_id}"),
        ("PUT", "/api/financial-aid/reports/{year}/funding-sources/funders/{grantor_key}"),
        ("PATCH", "/api/financial-aid/sources/{source_id}"),
        ("PUT", "/api/financial-aid/rules/{year}/sections/{section}"),
    ],
)
def test_the_owners_allow_list_stays_open(method: str, path: str) -> None:
    """CSD-8: how totals tie to the development lead's work, plus rules (their own lock) and sources."""
    assert (method, path) in financial_aid.CLOSED_SEASON_OPEN_WRITES


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/financial-aid/requests/{request_id}/asks"),
        ("POST", "/api/financial-aid/requests/{request_id}/session"),
        ("POST", "/api/financial-aid/requests/{request_id}/cancellation"),
        ("POST", "/api/financial-aid/decisions/{year}/posted"),
        ("POST", "/api/financial-aid/decisions/{year}/accepted"),
        ("POST", "/api/financial-aid/requests/{year}/additions"),
        ("POST", "/api/financial-aid/requests/{year}/additions/{addition_id}/review"),
        ("POST", "/api/financial-aid/applications/{year}/{household_cm_id}/corrections"),
        ("POST", "/api/financial-aid/household-links"),
        ("DELETE", "/api/financial-aid/household-links/{link_id}"),
        ("POST", "/api/financial-aid/grants/{year}/placements"),
        ("POST", "/api/financial-aid/money/{year}/to-place/place"),
    ],
)
def test_the_casework_writes_are_gated(method: str, path: str) -> None:
    route = next(r for r in _write_routes() if _key(r) == (method, path))
    assert _gated(route)


# -- The gate's answers ------------------------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """An admin over the bare router; the dashboard's season is 2027, so 2025 is done and 2026 is open."""

    async def season() -> int:
        return 2027

    monkeypatch.setattr(dependencies, "dashboard_season", season)
    app = FastAPI()
    app.include_router(financial_aid.router)
    admin = AuthUser(username="admin", email="admin@example.com", display_name="Admin", groups=[], is_admin=True)
    app.dependency_overrides[get_current_user] = lambda: admin
    return TestClient(app, raise_server_exceptions=False)


def _year_of(year: int | None) -> AsyncMock:
    return AsyncMock(return_value=year)


def _posted(client: TestClient, year: int) -> Any:
    return client.post(
        f"/api/financial-aid/decisions/{year}/posted",
        json={"rows": [{"request_id": REQ, "round": 1, "amount": "100"}]},
    )


def test_a_write_to_a_done_season_is_refused_with_a_409(client: TestClient) -> None:
    decisions = MagicMock()
    decisions.tick_posted = AsyncMock(return_value=WRITE)
    with patch.object(financial_aid, "_decisions", return_value=decisions):
        answer = _posted(client, 2025)
    assert answer.status_code == 409
    assert "2025 is closed" in answer.json()["detail"]
    decisions.tick_posted.assert_not_called()


def test_a_write_to_an_open_season_goes_through(client: TestClient) -> None:
    decisions = MagicMock()
    decisions.tick_posted = AsyncMock(return_value=WRITE.model_copy(update={"year": 2026}))
    with patch.object(financial_aid, "_decisions", return_value=decisions):
        answer = _posted(client, 2026)
    assert answer.status_code == 200
    decisions.tick_posted.assert_awaited_once()


def test_a_write_when_the_season_cannot_be_read_is_refused_with_a_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def unreadable() -> int:
        raise SeasonYearUnknownError("The dashboard's season couldn't be read")

    monkeypatch.setattr(dependencies, "dashboard_season", unreadable)
    decisions = MagicMock()
    decisions.tick_posted = AsyncMock(return_value=WRITE)
    with patch.object(financial_aid, "_decisions", return_value=decisions):
        answer = _posted(client, 2026)
    assert answer.status_code == 503
    decisions.tick_posted.assert_not_called()


def test_a_request_keyed_write_reads_the_requests_own_season(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    looked = _year_of(2025)
    monkeypatch.setattr(dependencies, "aid_record_year", looked)
    decisions = MagicMock()
    decisions.key_ask = AsyncMock(return_value=WRITE)
    with patch.object(financial_aid, "_decisions", return_value=decisions):
        answer = client.post(
            f"/api/financial-aid/requests/{REQ}/asks", json={"round": 2, "amount": "400", "asked_on": "2025-03-20"}
        )
    assert answer.status_code == 409
    assert looked.await_args is not None and looked.await_args.args == ("aid_requests", REQ)
    decisions.key_ask.assert_not_called()


def test_a_request_the_gate_cannot_find_is_left_to_the_write(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No such request: the gate has no season to refuse, and the write answers its own 404."""
    monkeypatch.setattr(dependencies, "aid_record_year", _year_of(None))
    casework = MagicMock()
    casework.resolve_session = AsyncMock(return_value=MagicMock())
    with patch.object(financial_aid, "_casework", return_value=casework):
        client.post(
            f"/api/financial-aid/requests/{REQ}/session", json={"session_cm_id": 1000101, "reason": "Fixing it"}
        )
    casework.resolve_session.assert_awaited_once()


def test_a_body_keyed_write_reads_the_season_from_its_body(client: TestClient) -> None:
    writes = MagicMock()
    writes.create_link = AsyncMock()
    with patch.object(financial_aid, "_writes", return_value=writes):
        answer = client.post(
            "/api/financial-aid/household-links",
            json={"year": 2025, "household_cm_id": 1000001, "family_key": "johnson", "note": "Same family"},
        )
    assert answer.status_code == 409
    writes.create_link.assert_not_called()


def test_a_link_delete_reads_the_links_own_season(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    looked = _year_of(2025)
    monkeypatch.setattr(dependencies, "aid_record_year", looked)
    writes = MagicMock()
    writes.delete_link = AsyncMock()
    with patch.object(financial_aid, "_writes", return_value=writes):
        answer = client.delete("/api/financial-aid/household-links/lnk000000000001", params={"reason": "Wrong family"})
    assert answer.status_code == 409
    assert looked.await_args is not None and looked.await_args.args == ("aid_household_links", "lnk000000000001")
    writes.delete_link.assert_not_called()

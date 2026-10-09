"""Campership ledger endpoints (sub-project 4): the permission matrix for all
fourteen routes over SP2's five personas, and the service-error mapping.
Builds a bare FastAPI app (SP2's persona_client) rather than importing api.main,
which poisons auth for xdist."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.financial_aid import (
    AidSourceRow,
    AidSourcesResponse,
    BulkLoadResult,
    DataQualityResponse,
    FaRequested,
    HouseholdDetailResponse,
    HouseholdLinkRow,
    NetTotalsResponse,
    SummaryResponse,
)
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

VIEW, CASEWORK, RULES = Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_CASEWORK, Permission.FINANCIAL_AID_RULES

SOURCE = AidSourceRow(
    id="src1",
    description_key="k",
    description="K",
    source_name="K",
    source_family="pj",
    funder_type="outside",
    counts_as_aid=True,
    counts_toward_budget=False,
    grantor_key="",
    implied_program_families=[],
    classified_by="staff",
    note="n",
)
LINK = HouseholdLinkRow(
    id="l1", year=2026, household_cm_id=600, family_key="hh-100", source="staff", excluded=False, note="n", actor="a"
)
LINK_BODY = {"year": 2026, "household_cm_id": 600, "family_key": "hh-100", "note": "Same family"}
SOURCE_BODY = {
    "source_name": "X",
    "source_family": "pj",
    "funder_type": "outside",
    "counts_as_aid": True,
    "counts_toward_budget": False,
    "note": "n",
}
OVERRIDE_BODY = {
    "year": 2026,
    "source": "staff",
    "reason": "Reviewed placements",
    "rows": [{"transaction_cm_id": 9001, "program_family": "summer"}],
}

# (method, url, json body, permission required, success status)
ROUTES: list[tuple[str, str, dict[str, Any] | None, str | tuple[str, ...], int]] = [
    ("GET", "/api/financial-aid/households/100?year=2026", None, VIEW, 200),
    ("GET", "/api/financial-aid/summary?year=2026&as_of=2026-03-10", None, VIEW, 200),
    ("GET", "/api/financial-aid/net-totals?year=2026", None, VIEW, 200),
    ("GET", "/api/financial-aid/data-quality?year=2026", None, VIEW, 200),
    # Owner ruling 2026-10-01: view OR grantors may read the source list (development edits its mappings).
    ("GET", "/api/financial-aid/sources", None, (VIEW, Permission.FINANCIAL_AID_GRANTORS), 200),
    ("PATCH", "/api/financial-aid/sources/src1", SOURCE_BODY, RULES, 200),
    ("POST", "/api/financial-aid/household-links", LINK_BODY, CASEWORK, 201),
    ("DELETE", "/api/financial-aid/household-links/l1?reason=merged%20by%20mistake", None, CASEWORK, 204),
    ("POST", "/api/financial-aid/overrides/bulk", OVERRIDE_BODY, RULES, 200),
    # Owner ruling 2026-10-01: remapping a description to a grantor is the grantor directory's permission.
    (
        "PUT",
        "/api/financial-aid/sources/src1/grantor",
        {"grantor_key": "regional_fund", "note": "n"},
        Permission.FINANCIAL_AID_GRANTORS,
        200,
    ),
]


def _client(persona: str) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub_services() -> tuple[Any, Any]:
    ledger = patch("api.routers.financial_aid.FinancialAidLedgerService").start()
    ledger.return_value.household = AsyncMock(
        return_value=HouseholdDetailResponse(
            year=2026,
            household_cm_id=100,
            display_name="x",
            family_households=[100],
            total_aid=0,
            postings=[],
            enrollments=[],
            fa_requested=FaRequested(),
        )
    )
    ledger.return_value.summary = AsyncMock(
        return_value=SummaryResponse(
            year=2026, as_of="2026-03-10", total_aid=0, counts_toward_budget=0, by_level={}, cells=[]
        )
    )
    ledger.return_value.net_totals = AsyncMock(
        return_value=NetTotalsResponse(year=2026, as_of=None, total_aid=0, rows=[])
    )
    ledger.return_value.data_quality = AsyncMock(
        return_value=DataQualityResponse(
            year=2026,
            unclassified_sources=[],
            orphan_reversal_legs=[],
            flag_counts={},
            accepted_flag_counts={},
            flagged_postings=[],
            no_enrollment_postings=0,
            dangling_overrides=[],
            dangling_dispositions=[],
            stale_staff_links=[],
            cross_season_sessions=[],
            unknown_sessions=[],
            aid_like_outside_categories=[],
        )
    )
    ledger.return_value.sources = AsyncMock(return_value=AidSourcesResponse(sources=[SOURCE]))
    writes = patch("api.routers.financial_aid.FinancialAidWriteService").start()
    writes.return_value.classify_source = AsyncMock(return_value=SOURCE)
    writes.return_value.map_source_grantor = AsyncMock(return_value=SOURCE)
    writes.return_value.create_link = AsyncMock(return_value=LINK)
    writes.return_value.delete_link = AsyncMock(return_value=None)
    writes.return_value.load_overrides = AsyncMock(return_value=BulkLoadResult(year=2026, dry_run=False))
    return ledger, writes


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "required", "ok"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, required: str | tuple[str, ...], ok: int
) -> None:
    _stub_services()
    response = _client(persona).request(method, url, json=body)
    accepted = (required,) if isinstance(required, str) else required
    expected = ok if any(r in PERSONAS[persona] for r in accepted) else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_development_remaps_a_description_but_never_classifies_one() -> None:
    """Owner ruling 2026-10-01: development holds financial_aid.grantors, not rules. Mapping a description to its
    grantor is the directory's; classifying a description (what counts as aid) stays with rules."""
    _stub_services()
    client = _client(PERSONA_DEVELOPMENT)
    mapping = {"grantor_key": "regional_fund", "note": "Development true-up"}
    assert client.put("/api/financial-aid/sources/src1/grantor", json=mapping).status_code == 200
    assert client.patch("/api/financial-aid/sources/src1", json=SOURCE_BODY).status_code == 403
    assert client.post("/api/financial-aid/overrides/bulk", json=OVERRIDE_BODY).status_code == 403
    assert _client(PERSONA_REGISTRAR).put("/api/financial-aid/sources/src1/grantor", json=mapping).status_code == 403


def test_the_actor_is_the_callers_email() -> None:
    _, writes = _stub_services()
    _client(PERSONA_FINANCE).post("/api/financial-aid/overrides/bulk", json=OVERRIDE_BODY)
    email = persona_user(PERSONA_FINANCE).email
    assert writes.return_value.load_overrides.await_args.args[1] == email


def test_as_of_reaches_the_service_as_a_date() -> None:
    ledger, _ = _stub_services()
    _client(PERSONA_FINANCE).get("/api/financial-aid/net-totals", params={"year": 2026, "as_of": "2026-03-10"})
    assert str(ledger.return_value.net_totals.await_args.kwargs["as_of"]) == "2026-03-10"


def test_service_errors_map_to_404_and_422() -> None:
    ledger, writes = _stub_services()
    ledger.return_value.household = AsyncMock(side_effect=FinancialAidNotFoundError("no rows"))
    writes.return_value.create_link = AsyncMock(side_effect=FinancialAidValidationError("already linked"))
    writes.return_value.load_overrides = AsyncMock(side_effect=FinancialAidValidationError("split it"))
    client = _client(PERSONA_FINANCE)
    missing = client.get("/api/financial-aid/households/100", params={"year": 2026})
    refused = client.post("/api/financial-aid/household-links", json=LINK_BODY)
    too_big = client.post("/api/financial-aid/overrides/bulk", json=OVERRIDE_BODY)
    assert missing.status_code == 404
    assert (refused.status_code, refused.json()["detail"]) == (422, "already linked")
    assert too_big.status_code == 422  # a load over one batch is refused whole


@pytest.mark.parametrize(
    "url",
    [
        "/api/financial-aid/summary",
        "/api/financial-aid/summary?year=2026&as_of=not-a-date",
    ],
)
def test_bad_query_parameters_are_422(url: str) -> None:
    _stub_services()
    assert _client(PERSONA_FINANCE).get(url).status_code == 422


def test_the_old_per_household_ledger_route_is_gone() -> None:
    """Retired: Money > Ledger (GET /money/{year}/ledger) supersedes it."""
    _stub_services()
    assert _client(PERSONA_FINANCE).get("/api/financial-aid/ledger?year=2026").status_code in (404, 405)


def test_household_link_delete_blank_reason_is_422_and_never_writes() -> None:
    """A whitespace-only reason must not reach commit_aid_writes (4a's helper
    raises ValueError there, which would otherwise surface as a 500)."""
    _, writes = _stub_services()
    response = _client(PERSONA_FINANCE).delete("/api/financial-aid/household-links/l1?reason=%20%20%20")
    assert response.status_code == 422
    writes.return_value.delete_link.assert_not_called()


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", "/api/financial-aid/flag-dispositions?year=2026"),
        ("POST", "/api/financial-aid/flag-dispositions/bulk"),
        ("DELETE", "/api/financial-aid/flag-dispositions/d1?reason=x"),
    ],
)
def test_the_old_flag_disposition_routes_are_gone(method: str, url: str) -> None:
    """Owner ruling 2026-10-01: the table stays (To place's Leave/Reopen use it); the routes do not.

    Finance holds both view and rules, so a 403 cannot hide a route that still exists."""
    _stub_services()
    response = _client(PERSONA_FINANCE).request(method, url, json={} if method == "POST" else None)
    assert response.status_code in (404, 405), (method, url, response.text)


def test_a_household_link_that_lost_a_race_with_the_sync_is_409() -> None:
    _, writes = _stub_services()
    writes.return_value.create_link = AsyncMock(
        side_effect=AidWriteConflictError(collection="aid_household_links", record_id="l1")
    )
    response = _client(PERSONA_FINANCE).post("/api/financial-aid/household-links", json=LINK_BODY)
    assert (response.status_code, response.json()["detail"]) == (409, CONFLICT_MESSAGE)


def test_a_grantors_only_user_reads_the_source_list() -> None:
    """Owner ruling 2026-10-01: financial_aid.grantors alone (no view) may read the source list."""
    from fastapi import FastAPI

    from api.routers.financial_aid import router
    from bunking.auth_middleware import get_current_user

    _stub_services()
    user = persona_user(PERSONA_DEVELOPMENT)
    user.permissions = {Permission.FINANCIAL_AID_GRANTORS}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    assert TestClient(app, raise_server_exceptions=False).get("/api/financial-aid/sources").status_code == 200


@pytest.mark.parametrize(
    ("method", "url", "body", "service_method"),
    [
        ("PATCH", "/api/financial-aid/sources/src1", SOURCE_BODY, "classify_source"),
        (
            "PUT",
            "/api/financial-aid/sources/src1/grantor",
            {"grantor_key": "regional_fund", "note": "n"},
            "map_source_grantor",
        ),
    ],
)
def test_a_source_write_that_lost_a_race_is_409(
    method: str, url: str, body: dict[str, Any], service_method: str
) -> None:
    _, writes = _stub_services()
    setattr(
        writes.return_value,
        service_method,
        AsyncMock(side_effect=AidWriteConflictError(collection="aid_sources", record_id="src1")),
    )
    response = _client(PERSONA_FINANCE).request(method, url, json=body)
    assert response.status_code == 409, response.text  # read the status first: an unmapped error is a plain-text 500
    assert response.json()["detail"] == CONFLICT_MESSAGE


def test_the_source_list_counts_the_season_asked_and_only_when_asked() -> None:
    ledger, _ = _stub_services()
    client = _client(PERSONA_FINANCE)
    assert client.get("/api/financial-aid/sources?year=2027").status_code == 200
    ledger.return_value.sources.assert_awaited_with(2027)
    assert client.get("/api/financial-aid/sources").status_code == 200
    ledger.return_value.sources.assert_awaited_with(None)
    assert client.get("/api/financial-aid/sources?year=1999").status_code == 422


def _stub_decisions() -> Any:
    from api.services.financial_aid_reconciliation import SeasonLedger

    decisions = patch("api.routers.financial_aid.FinancialAidDecisionsService").start()
    decisions.return_value.season = AsyncMock(
        return_value=SimpleNamespace(ledger=SeasonLedger(), splits={}, camp_lines=())
    )
    return decisions.return_value


def test_a_live_summary_from_2027_reads_kindreds_placements() -> None:
    """Ask 7, D151: the levels read the priced season's placements."""
    ledger, _ = _stub_services()
    decisions = _stub_decisions()
    assert _client(PERSONA_FINANCE).get("/api/financial-aid/summary?year=2027").status_code == 200
    decisions.season.assert_awaited_once_with(2027)
    assert ledger.return_value.summary.call_args.kwargs == {"as_of": None, "split_placed": {}}


@pytest.mark.parametrize("query", ["year=2026", "year=2027&as_of=2027-03-10"])
def test_a_past_day_or_a_season_before_to_place_reads_gos_levels(query: str) -> None:
    """No split exists before 2027; a past day's placement is the past season's (Known limit 2)."""
    ledger, _ = _stub_services()
    decisions = _stub_decisions()
    assert _client(PERSONA_FINANCE).get(f"/api/financial-aid/summary?{query}").status_code == 200
    decisions.season.assert_not_awaited()
    assert ledger.return_value.summary.call_args.kwargs.get("split_placed") is None  # main's route passes only as_of


@pytest.mark.asyncio
async def test_summary_program_labels_come_from_the_approved_programs_never_a_draft() -> None:
    from api.routers import financial_aid as router
    from tests.unit.bunking.financial_aid.fixtures import fictional_rules

    version = SimpleNamespace(document=fictional_rules())
    rules = SimpleNamespace(latest_approved=AsyncMock(return_value=version), load=AsyncMock())
    with patch.object(router, "_rules", return_value=rules):
        assert (await router._program_labels(2027))["summer"] == "Summer"
    rules.latest_approved.assert_awaited_once_with(2027, ["programs"])
    rules.load.assert_not_awaited()  # load() is the newest version, a draft included

    rules = SimpleNamespace(latest_approved=AsyncMock(return_value=None))
    with patch.object(router, "_rules", return_value=rules):
        assert "summer" not in await router._program_labels(2027)

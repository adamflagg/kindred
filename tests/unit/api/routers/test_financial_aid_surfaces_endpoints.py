"""Slice 1's reads (clean spec §12.2 "Slice 1's own reads"): the definitions registry, the jump-box
index, Today, the household page and the request editor's preview. The permission matrix over SP2's
personas, and what each route passes to its service. Builds a bare FastAPI app (persona_client); never
imports api.main."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
)

VIEW, SUMMARY, CASEWORK = (
    Permission.FINANCIAL_AID_VIEW,
    Permission.FINANCIAL_AID_SUMMARY,
    Permission.FINANCIAL_AID_CASEWORK,
)


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


# --- the definitions registry (§4.8, D20) ---------------------------------------------------------


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_definitions_open_to_view_or_summary(persona: str) -> None:
    """Shared with Reports › Development (D20), so development's summary reads it too (D65)."""
    response = _client(persona).get("/api/financial-aid/definitions?surface=household")
    expected = 200 if {VIEW, SUMMARY} & set(PERSONAS[persona]) else 403
    assert response.status_code == expected, persona


def test_a_surfaces_notes_are_numbered_from_1_with_the_camp_name_filled_in() -> None:
    with patch("api.routers.financial_aid.camp_label", return_value="Camp Fictional"):
        body = _client(PERSONA_DEVELOPMENT).get("/api/financial-aid/definitions?surface=household").json()
    assert body["surface"] == "household"
    assert [(n["n"], n["key"]) for n in body["notes"]] == [
        (1, "cost"),
        (2, "decided"),
        (3, "grants"),
        (4, "family_share"),
        (5, "posted"),
        (6, "confirmation"),
    ]  # owner 2026-10-05: the "would change by" note is gone, so nothing follows confirmation
    assert body["notes"][3] == {
        "key": "family_share",
        "n": 4,
        "text": (
            "Family's share = cost − Camp Fictional aid (decided) − grants, over the family's included requests. "
            "It is not a balance: CampMinder's balance also holds payments, deposits and other charges. For a "
            "split family it is the family total."
        ),
    }
    assert "{camp}" not in str(body)


def test_an_unknown_surface_is_404_and_a_missing_one_422() -> None:
    assert _client().get("/api/financial-aid/definitions?surface=nowhere").status_code == 404
    assert _client().get("/api/financial-aid/definitions").status_code == 422


# --- the jump box's index (§3.5, D13, D65) ---------------------------------------------------------


def _stub_jump() -> Any:
    from api.schemas.financial_aid_surfaces import JumpIndexResponse

    service = patch("api.routers.financial_aid.JumpIndexService").start().return_value
    service.read = AsyncMock(return_value=JumpIndexResponse(year=2031, households=[]))
    return service


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_jump_index_is_view_only(persona: str) -> None:
    """D65: a summary-only user has no jump box."""
    _stub_jump()
    response = _client(persona).get("/api/financial-aid/jump-index/2031")
    assert response.status_code == (200 if VIEW in PERSONAS[persona] else 403), persona


def test_the_jump_index_reads_the_season_asked() -> None:
    service = _stub_jump()
    assert _client().get("/api/financial-aid/jump-index/2031").json() == {"year": 2031, "households": []}
    service.read.assert_awaited_once_with(2031)


def test_the_jump_index_refuses_a_year_out_of_range() -> None:
    _stub_jump()
    assert _client().get("/api/financial-aid/jump-index/1999").status_code == 422


# --- Today (§6.4) ---------------------------------------------------------------------------------------


def _stub_today() -> Any:
    from api.schemas.financial_aid_surfaces import TodayResponse

    service = patch("api.routers.financial_aid.TodayService").start().return_value
    service.read = AsyncMock(return_value=TodayResponse(year=2031, casework=None, finance=None))
    return service


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_today_is_view_only(persona: str) -> None:
    _stub_today()
    response = _client(persona).get("/api/financial-aid/today/2031")
    assert response.status_code == (200 if VIEW in PERSONAS[persona] else 403), persona


@pytest.mark.parametrize(
    ("persona", "casework", "finance"), [(PERSONA_REGISTRAR, True, False), (PERSONA_FINANCE, True, True)]
)
def test_todays_sections_follow_the_users_permissions(persona: str, casework: bool, finance: bool) -> None:
    """§6.4: Casework lines for casework, Finance lines for rules."""
    service = _stub_today()
    assert _client(persona).get("/api/financial-aid/today/2031").status_code == 200
    service.read.assert_awaited_once_with(2031, casework=casework, finance=finance)


def test_today_counts_to_place_on_the_repository_it_prices_with() -> None:
    """Ask 3: Today's To place line reads To place's own three reads, from the same repository (SP11)."""
    from api.schemas.financial_aid_surfaces import TodayResponse

    today = patch("api.routers.financial_aid.TodayService").start()
    today.return_value.read = AsyncMock(return_value=TodayResponse(year=2031, casework=None, finance=None))
    assert _client(PERSONA_REGISTRAR).get("/api/financial-aid/today/2031").status_code == 200
    kwargs = today.call_args.kwargs
    assert kwargs.get("to_place") is kwargs["store"]


# --- the household page (§6.3) --------------------------------------------------------------------------


def _stub_page() -> Any:
    from api.services.financial_aid_household_page import HouseholdNotFoundError

    service = patch("api.routers.financial_aid.HouseholdPageService").start().return_value
    service.read = AsyncMock(side_effect=HouseholdNotFoundError("household 1000009 has no aid activity in 2031"))
    return service


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_household_page_is_view_only(persona: str) -> None:
    """D57, D65: family-level; development never sees a family."""
    _stub_page()
    response = _client(persona).get("/api/financial-aid/household-page/2031/1000009")
    assert response.status_code == (404 if VIEW in PERSONAS[persona] else 403), persona


def test_a_household_with_no_aid_activity_is_404() -> None:
    service = _stub_page()
    response = _client().get("/api/financial-aid/household-page/2031/1000009")
    assert response.json() == {"detail": "household 1000009 has no aid activity in 2031"}
    service.read.assert_awaited_once_with(2031, 1000009)


def test_a_household_id_that_isnt_positive_is_422() -> None:
    _stub_page()
    assert _client().get("/api/financial-aid/household-page/2031/0").status_code == 422


# --- the request editor's preview (§4.6, D22) ---------------------------------------------------------------

REQ = "reqemma00000001"


def _stub_preview() -> Any:
    from api.schemas.financial_aid_decisions import EditorPreviewOut

    service = patch("api.routers.financial_aid.FinancialAidDecisionsService").start().return_value
    service.preview = AsyncMock(
        return_value=EditorPreviewOut(
            award=300.0,
            trace=[],
            stage_after="needs_offer",
            stage_after_label="Needs an offer",
            shares=[],
            pending_approval=False,
        )
    )
    return service


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_preview_is_casework_only(persona: str) -> None:
    _stub_preview()
    response = _client(persona).post(f"/api/financial-aid/requests/{REQ}/preview", json={"round": 2, "amount": "400"})
    assert response.status_code == (200 if CASEWORK in PERSONAS[persona] else 403), persona


@pytest.mark.parametrize(("persona", "can_approve"), [(PERSONA_FINANCE, True), (PERSONA_REGISTRAR, False)])
def test_the_preview_knows_whether_the_typist_can_approve_their_own_round_3(persona: str, can_approve: bool) -> None:
    service = _stub_preview()
    _client(persona).post(f"/api/financial-aid/requests/{REQ}/preview", json={"round": 3, "amount": "900"})
    assert service.preview.call_args.kwargs["can_approve"] is can_approve


@pytest.mark.parametrize(("refusal", "status"), [("not_found", 404), ("refused", 422)])
def test_a_preview_refusal_maps_like_the_write(refusal: str, status: int) -> None:
    from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError

    service = _stub_preview()
    error = DecisionNotFoundError("no such request") if refusal == "not_found" else DecisionRefusedError("on hold")
    service.preview = AsyncMock(side_effect=error)
    response = _client().post(f"/api/financial-aid/requests/{REQ}/preview", json={"round": 2, "amount": "400"})
    assert response.status_code == status


def test_a_preview_of_round_1_is_422() -> None:
    _stub_preview()
    response = _client().post(f"/api/financial-aid/requests/{REQ}/preview", json={"round": 1, "amount": "400"})
    assert response.status_code == 422


# --- the household search (owner F3 #27) -------------------------------------------------------------------------


def _stub_search() -> Any:
    from api.schemas.financial_aid_surfaces import HouseholdSearchResponse

    service = patch("api.routers.financial_aid.HouseholdSearchService").start().return_value
    service.search = AsyncMock(return_value=HouseholdSearchResponse(year=2031, matches=[], truncated=False))
    return service


@pytest.mark.parametrize("persona", sorted(PERSONAS))
def test_the_household_search_is_view_as_the_household_links_are(persona: str) -> None:
    _stub_search()
    response = _client(persona).get("/api/financial-aid/household-search/2031?q=garcia")
    assert response.status_code == (200 if VIEW in PERSONAS[persona] else 403), persona


def test_the_household_search_passes_the_season_and_query() -> None:
    service = _stub_search()
    assert _client().get("/api/financial-aid/household-search/2031?q=garcia").json() == {
        "year": 2031,
        "matches": [],
        "truncated": False,
    }
    service.search.assert_awaited_once_with(2031, "garcia")


@pytest.mark.parametrize("query", ["", "a", "x" * 101])
def test_the_household_search_refuses_a_query_too_short_or_too_long(query: str) -> None:
    _stub_search()
    assert _client().get(f"/api/financial-aid/household-search/2031?q={query}").status_code == 422


@pytest.mark.parametrize(("surface", "notes"), [("money-to-place", 4), ("money-sources", 3), ("grants", 5)])
def test_slice_3s_surfaces_serve_their_numbered_notes(surface: str, notes: int) -> None:
    with patch("api.routers.financial_aid.camp_label", return_value="Camp Fictional"):
        response = _client().get(f"/api/financial-aid/definitions?surface={surface}")
    assert response.status_code == 200
    assert [n["n"] for n in response.json()["notes"]] == list(range(1, notes + 1))
    assert "{camp}" not in response.text

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
        (7, "would_change_by"),
    ]
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

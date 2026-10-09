"""The Requests grid row carries `session_type` (the row's session's CampMinder type, "" for none) and, for a
household-level row (no camper), the household's label as Money and Grants name it (`household_label`, plus
`household_label_tiebreak` only where two households on the grid read alike). A camper row reads "" for both.
Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

import pytest

from api.schemas.financial_aid_decisions import GridRowOut
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.to_place_fakes import FakeLabels

CAMPER = "reqcamper0000001"
FAMILY_A = "reqfamilya000001"
FAMILY_B = "reqfamilyb000001"
UNSET = "requnset00000001"


def _service(store: FakeDecisionsStore, labels: FakeLabels | None) -> FinancialAidDecisionsService:
    async def register(year: int) -> list[RegisterRow]:
        return []

    return FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0, labels=labels)


async def _rows(store: FakeDecisionsStore, labels: FakeLabels | None) -> dict[str, GridRowOut]:
    return {r.request_id: r for r in (await _service(store, labels).grid(YEAR)).rows}


def _store() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, CAMPER, household=1000001, person=1000011, session=1000101)
    seed_request(store, FAMILY_A, household=1000002, person=0, session=1000201)
    return store


@pytest.mark.asyncio
async def test_a_row_carries_its_sessions_type() -> None:
    rows = await _rows(_store(), FakeLabels())
    assert rows[CAMPER].session_type == "main"
    assert rows[FAMILY_A].session_type == "family"


@pytest.mark.asyncio
async def test_a_row_with_no_session_has_an_empty_session_type() -> None:
    store = _store()
    seed_request(store, UNSET, household=1000003, person=1000031, session=0)
    assert (await _rows(store, FakeLabels()))[UNSET].session_type == ""


@pytest.mark.asyncio
async def test_a_household_row_reads_the_label_money_and_grants_show() -> None:
    row = (await _rows(_store(), FakeLabels({1000002: "Marta & Luis Garcia"})))[FAMILY_A]
    assert (row.household_label, row.household_label_tiebreak) == ("Marta & Luis Garcia", "")


@pytest.mark.asyncio
async def test_two_households_that_read_alike_get_the_tiebreak() -> None:
    store = _store()
    seed_request(store, FAMILY_B, household=1000005, person=0, session=1000202)
    rows = await _rows(store, FakeLabels({1000002: "The Garcias", 1000005: "The Garcias"}))
    assert rows[FAMILY_A].household_label_tiebreak == "#1000002"
    assert rows[FAMILY_B].household_label_tiebreak == "#1000005"


@pytest.mark.asyncio
async def test_a_camper_row_has_no_household_label_and_is_not_asked_for() -> None:
    labels = FakeLabels()
    rows = await _rows(_store(), labels)
    assert (rows[CAMPER].household_label, rows[CAMPER].household_label_tiebreak) == ("", "")
    assert labels.calls == [frozenset({1000002})]


@pytest.mark.asyncio
async def test_a_household_row_falls_back_to_the_family_name_without_a_label() -> None:
    row = (await _rows(_store(), None))[FAMILY_A]
    assert (row.household_label, row.household_label_tiebreak) == (row.family_name, "")


def test_the_requests_route_names_households_with_the_household_pages_label_helper() -> None:
    from unittest.mock import patch

    from api.routers import financial_aid as router

    with patch.object(router, "FinancialAidDecisionsService") as service:
        router._decisions()
    assert service.call_args.kwargs["labels"] is not None

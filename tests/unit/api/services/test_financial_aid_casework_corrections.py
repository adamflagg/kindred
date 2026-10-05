"""add_correction: validated, layered, logged with its write (spec 3.3, 9.3, 14.4)."""

from __future__ import annotations

from typing import Any

import pytest

from api.services.financial_aid_casework_service import CaseworkNotFoundError, FinancialAidCaseworkService
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, seeded_store

ACTOR = "registrar@example.com"


async def built() -> tuple[FakeAidStore, FinancialAidCaseworkService]:
    store = seeded_store()
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    return store, FinancialAidCaseworkService(store)


def staff_rows(store: FakeAidStore) -> list[dict[str, Any]]:
    return [row for row in store.change_log if row["actor"] != "system:intake"]


@pytest.mark.asyncio
async def test_a_household_correction_keeps_the_original_and_is_logged_with_it() -> None:
    store, casework = await built()
    out = await casework.add_correction(YEAR, 1000001, "total_gross_income", "$92,000", "Tax return.", ACTOR)
    assert (out.field, out.new_value, out.original_value, out.actor, out.request_id) == (
        "total_gross_income",
        "92000.00",
        "85000.00",
        ACTOR,
        "",
    )
    assert out.created  # PocketBase's own timestamp, from the batch response
    application = await store.fetch_application(YEAR, 1000001)
    assert application is not None
    assert application.answers["total_gross_income"] == 85000.0
    (row,) = staff_rows(store)
    assert (row["entity"], row["entity_id"], row["year"], row["action"], row["before"]) == (
        "aid_application_corrections",
        out.id,
        YEAR,
        "correct",
        None,
    )
    assert row["after"] == {"field": "total_gross_income", "value": "92000.00", "previous_value": "85000.00"}
    assert (row["actor"], row["reason"]) == (ACTOR, "Tax return.")
    (operation,) = store.operations
    assert operation["require_reason"] is False  # B30 (owner 2026-10-05): a correction's reason is optional
    assert [(w.collection, w.action) for w in operation["writes"]] == [("aid_application_corrections", "create")]


@pytest.mark.asyncio
async def test_an_ask_correction_names_its_request() -> None:
    store, casework = await built()
    request = store.request_for(person=1000011, program="summer")
    out = await casework.add_correction(YEAR, 1000001, "ask", "1200", "Family lowered it.", ACTOR, request.id)
    assert (out.request_id, out.original_value, out.new_value) == (request.id, "1500.00", "1200.00")


@pytest.mark.asyncio
async def test_an_ask_correction_for_another_familys_request_is_not_found() -> None:
    store, casework = await built()
    other = store.request_for(person=1000021, program="summer")
    with pytest.raises(CaseworkNotFoundError):
        await casework.add_correction(YEAR, 1000001, "ask", "1200", "r", ACTOR, other.id)


@pytest.mark.asyncio
async def test_an_uncorrectable_field_or_bad_value_is_refused_and_nothing_is_written() -> None:
    store, casework = await built()
    with pytest.raises(CorrectionError):
        await casework.add_correction(YEAR, 1000001, "contact_email", "x", "r", ACTOR)
    with pytest.raises(CorrectionError):
        await casework.add_correction(YEAR, 1000001, "total_gross_income", "-1", "r", ACTOR)
    # A blank reason is no longer refused (B30): test_a_correction_needs_no_reason_and_stores_and_logs_it_blank.
    assert store.corrections == []
    assert (store.operations, store.change_log) == ([], [])  # refused before anything was sent


@pytest.mark.asyncio
async def test_an_unknown_application_is_not_found() -> None:
    _, casework = await built()
    with pytest.raises(CaseworkNotFoundError):
        await casework.add_correction(YEAR, 1000099, "total_gross_income", "1", "r", ACTOR)


@pytest.mark.asyncio
async def test_staff_can_enter_an_income_taken_by_phone_as_an_income_override() -> None:
    store, casework = await built()
    out = await casework.add_correction(
        YEAR, 1000002, "income_override", "staff_entered:$52,000", "Phoned the family.", ACTOR
    )
    assert (out.field, out.new_value, out.original_value) == ("income_override", "staff_entered:52000.00", "")
    assert staff_rows(store)[-1]["after"] == {
        "field": "income_override",
        "value": "staff_entered:52000.00",
        "previous_value": "",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["cost_override", "include_override"])
async def test_the_generic_correction_refuses_the_request_overrides(field: str) -> None:
    store, casework = await built()
    request = next(r for r in await store.fetch_requests(YEAR) if r.household_cm_id == 1000001)
    with pytest.raises(CorrectionError, match=f"{field} cannot be corrected here"):
        await casework.add_correction(YEAR, 1000001, field, "discount:100.00", "Phone call", ACTOR, request.id)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["", "   "])
async def test_a_correction_needs_no_reason_and_stores_and_logs_it_blank(reason: str) -> None:
    """B30 (owner 2026-10-05): the correction reason is optional; a blank one is stored and logged as "", never refused
    and never as whitespace, so the History and the CSV have nothing to print after a separator."""
    store, casework = await built()
    out = await casework.add_correction(YEAR, 1000001, "total_gross_income", "$92,000", reason, ACTOR)
    assert (out.new_value, out.reason) == ("92000.00", "")
    (row,) = staff_rows(store)
    assert row["reason"] == ""

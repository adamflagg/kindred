"""Casework reads (campership sub-project 5)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.financial_aid_casework_service import CaseworkNotFoundError, FinancialAidCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from tests.unit.api.services.financial_aid_fakes import YEAR, fa_row, seeded_store

ACTOR = "registrar@example.com"


async def casework_with_conflict() -> tuple[object, FinancialAidCaseworkService]:
    store = seeded_store()
    store.fa_rows[1] = fa_row(
        1000012,
        1000001,
        fc="Family Camp 6",
        fc_ask=900.0,
        total_gross_income=95000.0,
        special_circumstances="Moved in spring.",
        total_rent=1800.0,
    )
    store.fa_rows.append(fa_row(1000013, 1000001, total_gross_income=95000.0, summer="Session 2a", summer_ask=300.0))
    await FinancialAidIntakeService(store).build(YEAR)
    return store, FinancialAidCaseworkService(store)


@pytest.mark.asyncio
async def test_the_list_summarises_each_family_without_amounts() -> None:
    _, casework = await casework_with_conflict()
    await casework.add_correction(YEAR, 1000001, "num_children", "3", "Counted.", ACTOR)
    listing = await casework.list_applications(YEAR)
    assert [a.household_cm_id for a in listing.applications] == [1000001, 1000002]
    first = listing.applications[0]
    assert first.requests_by_status == {"active": 3}
    assert "income_conflict" in first.flag_codes
    assert "not_enrolled" in first.flag_codes
    assert first.corrected_fields == 1


@pytest.mark.asyncio
async def test_detail_shows_synced_and_effective_values_and_marks_a_decided_conflict() -> None:
    _, casework = await casework_with_conflict()
    before = await casework.application_detail(YEAR, 1000001)
    conflict = next(f for f in before.flags if f.code == "income_conflict")
    assert conflict.detail.get("resolved_by_correction") is not True

    assert all(
        ("household_income_conflict", "hold") in [(i.code, i.severity) for i in r.issues] for r in before.requests
    )

    await casework.add_correction(YEAR, 1000001, "total_gross_income", "90000", "Tax return.", ACTOR)
    detail = await casework.application_detail(YEAR, 1000001)
    income = next(a for a in detail.answers if a.field == "total_gross_income")
    assert (income.synced, income.effective, income.corrected) == ("", "90000.00", True)  # conflicting: never picked
    assert [h.reason for h in income.history] == ["Tax return."]
    assert next(f for f in detail.flags if f.code == "income_conflict").detail["resolved_by_correction"] is True
    assert {r.program_key for r in detail.requests} == {"summer", "family_camp"}
    assert all(r.issues == [] for r in detail.requests)


@pytest.mark.asyncio
async def test_detail_shows_every_income_field_the_notes_and_each_requests_payers() -> None:
    _, casework = await casework_with_conflict()
    detail = await casework.application_detail(YEAR, 1000001)
    fields = {a.field for a in detail.answers}
    assert {"total_adjusted_income", "total_rent", "still_unemployed", "gov_subsidies", "income_override"} <= fields
    assert next(a for a in detail.answers if a.field == "total_rent").effective == "1800.00"
    assert next(a for a in detail.answers if a.field == "total_adjusted_income").synced == ""  # blank: unknown
    assert detail.notes["special_circumstances"] == "Moved in spring."
    assert "gov_subsidies_detail" in detail.notes
    for request in detail.requests:
        assert [(s.household_cm_id, s.share_pct) for s in request.payer_shares] == [(1000001, Decimal(100))]
        assert request.payer_share_status == "complete"
    # Controller ruling C2: a share_pct read back is Decimal("100"), which Pydantic must
    # serialise as the plain string "100" -- never exponent notation ("1E+2"). Regression
    # guard: the repository's `_exact_pct` (Task 6/7) already normalises this.
    json_detail = detail.model_dump(mode="json")
    json_shares = [s for r in json_detail["requests"] for s in r["payer_shares"]]
    assert json_shares
    assert all(s["share_pct"] == "100" for s in json_shares)


@pytest.mark.asyncio
async def test_detail_for_an_unknown_family_is_not_found() -> None:
    _, casework = await casework_with_conflict()
    with pytest.raises(CaseworkNotFoundError):
        await casework.application_detail(YEAR, 1000099)


@pytest.mark.asyncio
async def test_the_queue_lists_only_the_requested_status() -> None:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 9", summer_ask=100.0))
    await FinancialAidIntakeService(store).build(YEAR)
    queue = await FinancialAidCaseworkService(store).list_requests(YEAR, "unmatched_session")
    assert [(r.person_cm_id, r.program_option_text) for r in queue.requests] == [(1000015, "Session 9")]
    assert queue.requests[0].flags[0].code == "unmatched_session"


@pytest.mark.asyncio
async def test_requests_waiting_for_approved_rules_have_their_own_queue_and_a_visible_hold() -> None:  # Q4
    store = seeded_store()
    store.rules = None
    await FinancialAidIntakeService(store).build(YEAR)
    casework = FinancialAidCaseworkService(store)
    waiting = await casework.list_requests(YEAR, "active", "awaiting_approved_rules")
    assert len(waiting.requests) == 3
    assert (await casework.list_requests(YEAR, "active", "no_program_for_session")).requests == []
    detail = await casework.application_detail(YEAR, 1000001)
    assert all(("awaiting_approved_rules", "hold") in [(i.code, i.severity) for i in r.issues] for r in detail.requests)
    listing = await casework.list_applications(YEAR)
    assert all("awaiting_approved_rules" in a.flag_codes for a in listing.applications)

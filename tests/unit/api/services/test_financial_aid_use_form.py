"""Use X's Form (owner-approved, household-v3 section 3): one action applies one sibling's form to every answer the
household's forms disagree on, as one atomic operation of ordinary corrections. Fictional throughout."""

from __future__ import annotations

from typing import Any

import pytest

from api.services.financial_aid_casework_service import CaseworkNotFoundError, FinancialAidCaseworkService
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AttendeeRow
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"
HOUSEHOLD = 1000001
EMMA, LIAM, OLIVIA, RILEY = 1000011, 1000012, 1000013, 1000014


async def three_forms() -> tuple[FakeAidStore, FinancialAidCaseworkService]:
    """Emma's, Liam's and Olivia's forms disagree on two income answers (total and expected gross income) and two
    other answers (rent, children). Olivia left expected income blank; Riley's form answers none of them."""
    store = seeded_store()
    store.fa_rows[0] = fa_row(
        EMMA,
        HOUSEHOLD,
        summer="Session 2",
        summer_ask=1500.0,
        total_gross_income=85000.0,
        expected_gross_income=90000.0,
        total_rent=1800.0,
        num_children=3,
    )
    store.fa_rows[1] = fa_row(
        LIAM,
        HOUSEHOLD,
        fc="Family Camp 6",
        fc_ask=900.0,
        total_gross_income=95000.0,
        expected_gross_income=99000.0,
        total_rent=2000.0,
        num_children=2,
    )
    store.fa_rows.append(
        fa_row(OLIVIA, HOUSEHOLD, summer="Session 2", summer_ask=300.0, total_gross_income=95000.0, total_rent=2000.0)
    )
    store.fa_rows.append(fa_row(RILEY, HOUSEHOLD, summer="Session 2", summer_ask=200.0))
    store.attendees += [AttendeeRow(OLIVIA, HOUSEHOLD, 1000101, 2), AttendeeRow(RILEY, HOUSEHOLD, 1000101, 2)]
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    return store, FinancialAidCaseworkService(store)


def staff_rows(store: FakeAidStore) -> list[dict[str, Any]]:
    return [row for row in store.change_log if row["actor"] != "system:intake"]


async def answers(casework: FinancialAidCaseworkService) -> dict[str, tuple[str, bool]]:
    detail = await casework.application_detail(YEAR, HOUSEHOLD)
    return {a.field: (a.effective, a.corrected) for a in detail.answers}


async def holds(casework: FinancialAidCaseworkService) -> set[str]:
    detail = await casework.application_detail(YEAR, HOUSEHOLD)
    return {i.code for r in detail.requests for i in r.issues if i.severity == "hold"}


@pytest.mark.asyncio
async def test_the_fixture_disagrees_on_four_answers_and_holds_on_income() -> None:
    _, casework = await three_forms()
    detail = await casework.application_detail(YEAR, HOUSEHOLD)
    flags = {f.code: set(f.detail["fields"]) for f in detail.flags if "fields" in f.detail}
    assert flags == {
        "income_conflict": {"total_gross_income", "expected_gross_income"},
        "household_answer_conflict": {"total_rent", "num_children"},
    }
    assert "household_income_conflict" in await holds(casework)


@pytest.mark.asyncio
async def test_using_a_form_corrects_every_disagreeing_answer_in_one_operation() -> None:
    store, casework = await three_forms()
    out = await casework.use_form(YEAR, HOUSEHOLD, EMMA, "Called the family.", ACTOR)
    assert (out.household_cm_id, out.person_cm_id) == (HOUSEHOLD, EMMA)
    assert {c.field: c.new_value for c in out.applied} == {
        "total_gross_income": "85000.00",
        "expected_gross_income": "90000.00",
        "total_rent": "1800.00",
        "num_children": "3",
    }
    assert {c.reason for c in out.applied} == {"Called the family."}
    assert (out.skipped_blank, out.unchanged, out.still_disagreeing) == ([], [], [])
    (operation,) = store.operations  # ONE atomic operation
    assert len(operation["writes"]) == 4
    rows = staff_rows(store)
    assert {r["operation_id"] for r in rows} == {out.operation_id}
    assert {r["action"] for r in rows} == {"correct"}  # an ordinary correction to every existing reader
    assert {r["after"]["form_person_cm_id"] for r in rows} == {EMMA}  # the marker History groups by
    by_field = {r["after"]["field"]: r["after"] for r in rows}
    assert by_field["total_rent"] == {
        "field": "total_rent",
        "value": "1800.00",
        "previous_value": "2000.00",  # the value the household read before (most forms agreed on it)
        "form_person_cm_id": EMMA,
    }
    now = await answers(casework)
    assert now["total_gross_income"] == ("85000.00", True)
    assert now["num_children"] == ("3", True)
    detail = await casework.application_detail(YEAR, HOUSEHOLD)
    assert all(f.detail["resolved_by_correction"] for f in detail.flags if "fields" in f.detail)
    assert "household_income_conflict" not in await holds(casework)  # nothing disagrees: the hold clears


@pytest.mark.asyncio
async def test_a_form_that_left_an_answer_blank_leaves_that_answer_disagreeing_and_the_hold_on() -> None:
    store, casework = await three_forms()
    out = await casework.use_form(YEAR, HOUSEHOLD, OLIVIA, "", ACTOR)
    assert {c.field for c in out.applied} == {"total_gross_income", "total_rent"}
    assert (out.skipped_blank, out.still_disagreeing) == (
        ["expected_gross_income", "num_children"],
        ["expected_gross_income", "num_children"],
    )
    assert (await answers(casework))["expected_gross_income"][1] is False
    assert "household_income_conflict" in await holds(casework)  # an income answer still disagrees
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_the_chosen_form_overwrites_a_hand_correction_and_the_log_keeps_the_old_value() -> None:
    store, casework = await three_forms()
    await casework.add_correction(YEAR, HOUSEHOLD, "total_gross_income", "90000", "Tax return.", ACTOR)
    store.change_log.clear()
    out = await casework.use_form(YEAR, HOUSEHOLD, LIAM, "", ACTOR)
    assert {c.field: c.new_value for c in out.applied}["total_gross_income"] == "95000.00"
    row = next(r for r in staff_rows(store) if r["after"]["field"] == "total_gross_income")
    assert row["after"]["previous_value"] == "90000.00"
    detail = await casework.application_detail(YEAR, HOUSEHOLD)
    income = next(a for a in detail.answers if a.field == "total_gross_income")
    assert [h.new_value for h in income.history] == ["90000.00", "95000.00"]  # the hand correction stays in history


@pytest.mark.asyncio
async def test_an_answer_already_corrected_to_the_forms_value_gets_no_new_write() -> None:
    store, casework = await three_forms()
    await casework.add_correction(YEAR, HOUSEHOLD, "total_rent", "1800", "Lease.", ACTOR)
    store.operations.clear()
    out = await casework.use_form(YEAR, HOUSEHOLD, EMMA, "", ACTOR)
    assert out.unchanged == ["total_rent"]
    assert "total_rent" not in {c.field for c in out.applied}
    (operation,) = store.operations
    assert len(operation["writes"]) == 3
    assert out.still_disagreeing == []


@pytest.mark.asyncio
async def test_a_blank_reason_is_stored_and_logged_blank() -> None:
    store, casework = await three_forms()
    out = await casework.use_form(YEAR, HOUSEHOLD, EMMA, "   ", ACTOR)
    assert {c.reason for c in out.applied} == {""}
    assert {r["reason"] for r in staff_rows(store)} == {""}
    assert {c.reason for c in store.corrections} == {""}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("household", "person", "message"),
    [
        (HOUSEHOLD, 1000021, "that is not one of this household's forms"),
        (1000002, 1000021, "nothing on this application disagrees"),
        (HOUSEHOLD, RILEY, "that form leaves every disagreeing answer blank"),
    ],
)
async def test_a_use_that_cannot_apply_is_refused_and_nothing_is_written(
    household: int, person: int, message: str
) -> None:
    store, casework = await three_forms()
    with pytest.raises(CorrectionError) as refused:
        await casework.use_form(YEAR, household, person, "", ACTOR)
    assert str(refused.value) == message
    assert (store.operations, store.change_log, store.corrections) == ([], [], [])


@pytest.mark.asyncio
async def test_a_value_over_the_correction_ceiling_refuses_the_whole_use() -> None:
    store, casework = await three_forms()
    store.fa_rows[0] = fa_row(EMMA, HOUSEHOLD, summer="Session 2", summer_ask=1500.0, total_rent=20000000.0)
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    with pytest.raises(CorrectionError):
        await casework.use_form(YEAR, HOUSEHOLD, EMMA, "", ACTOR)
    assert (store.operations, store.corrections) == ([], [])


@pytest.mark.asyncio
async def test_an_unknown_application_is_not_found() -> None:
    _, casework = await three_forms()
    with pytest.raises(CaseworkNotFoundError):
        await casework.use_form(YEAR, 1000099, EMMA, "", ACTOR)

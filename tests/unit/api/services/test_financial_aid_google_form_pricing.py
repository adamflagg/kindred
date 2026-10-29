"""GF-2 = B (owner and registrar, 2026-10-29): an adult aid form request is priced from its OWN form's figures.

Owner: "the additional adult may not be the same household, or may be individually employed, not a parent, etc."
Registrar: "yes, separate payment, separate FA application". So a request whose answers_source is "google_form" is
priced from aid_requests.answers, the household application's answers never price it, and the application's
income_conflict never holds it. Every other request is priced exactly as before. The calculator (bunking/) is
unchanged: only which answers feed ApplicationInputs changes (test_contract pins its shape).

GF-3 = B: a Family Camp request from the adult form is the one adult's, so per_person pricing counts one person.

Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from api.services.financial_aid_calc_inputs import (
    calculator_inputs,
    effective_ask,
    pricing_answers,
    to_request_inputs,
)
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_corrections import CorrectionError
from api.services.financial_aid_decisions_service import _cost_only, _to_price
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from tests.unit.api.services.financial_aid_fakes import fa_row, intake_rules
from tests.unit.api.services.financial_aid_gform_fakes import (
    ACTOR,
    ADULT_REG_6,
    ADULT_WEEKEND_A,
    FAMILY_CAMP_6,
    GRACE,
    GRACE_HOUSEHOLD,
    RACHEL,
    RACHEL_HOUSEHOLD,
    enrolled,
    form_response,
    gform_store,
)
from tests.unit.bunking.financial_aid.fixtures import with_lever

CHILD = 1000092


async def both_forms() -> tuple[object, FinancialAidCaseworkService]:
    """Rachel's household filed CampMinder's form for a child at $96,000 (and her sibling at $50,000, a household
    income_conflict); her own adult form says $104,000."""
    sibling = 1000093
    store = gform_store(
        form_response(total_gross_income=104000.0, expected_gross_income=104000.0),
        attendees=[
            *enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A),
            *enrolled(CHILD, RACHEL_HOUSEHOLD, 1000101),
            *enrolled(sibling, RACHEL_HOUSEHOLD, 1000101),
        ],
        fa_rows=[
            fa_row(CHILD, RACHEL_HOUSEHOLD, summer="Session 2", summer_ask=1500.0, total_gross_income=96000.0),
            fa_row(sibling, RACHEL_HOUSEHOLD, summer="Session 2", summer_ask=1500.0, total_gross_income=50000.0),
        ],
    )
    await FinancialAidIntakeService(store).build(2027)
    return store, FinancialAidCaseworkService(store)


def _codes(issues: object) -> set[str]:
    return {i.code for i in issues}  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_casework_prices_the_adult_from_her_own_form_and_the_household_conflict_never_holds_her() -> None:
    store, casework = await both_forms()
    results = {r.request_id: r for r in await casework.calculator_inputs_for(2027, RACHEL_HOUSEHOLD, intake_rules())}
    adult = store.request_for(person=RACHEL, program="adult_weekend")  # type: ignore[attr-defined]
    priced = results[adult.id]
    assert priced.application.prior_year_gross == Decimal("104000.00")
    assert "household_income_conflict" not in _codes(priced.issues)
    # The children's requests still read the household application, held by its conflict as before.
    others = [r for rid, r in results.items() if rid != adult.id]
    assert len(others) == 2
    assert all("household_income_conflict" in _codes(r.issues) for r in others)
    assert all(r.application.prior_year_gross is None for r in others)


@pytest.mark.asyncio
async def test_the_decisions_service_prices_the_adult_from_her_own_form() -> None:
    store, _ = await both_forms()
    adult = store.request_for(person=RACHEL, program="adult_weekend")  # type: ignore[attr-defined]
    application = store.applications[adult.application_id]  # type: ignore[attr-defined]
    sessions = {s.cm_id: s for s in store.sessions}  # type: ignore[attr-defined]
    priced = _to_price(adult, application, [], sessions, [], None, {}, (), intake_rules())
    assert priced.application.prior_year_gross == Decimal("104000.00")
    assert "household_income_conflict" not in _codes(priced.issues)
    # No rules: the issues still come from the request's own answers.
    unpriced = _to_price(adult, application, [], sessions, [], None, {}, (), None)
    assert "household_income_conflict" not in _codes(unpriced.issues)


def test_pricing_answers_pick_the_requests_own_set_only_when_it_has_one() -> None:
    from api.services.financial_aid_intake_types import ApplicationRecord, RequestRecord

    application = ApplicationRecord("app1", 2027, RACHEL_HOUSEHOLD, "active", {"total_gross_income": 96000.0}, (), ())
    base = RequestRecord(
        "req1", 2027, "app1", RACHEL_HOUSEHOLD, RACHEL, ADULT_WEEKEND_A, "adult_weekend", "", "", "enrollment",
        400.0, 0, 0, "", "active", "",
    )  # fmt: skip
    own = replace(base, answers={"total_gross_income": 104000.0}, answers_source="google_form")
    assert pricing_answers(base, application, [])["total_gross_income"].effective == "96000.00"
    assert pricing_answers(own, application, [])["total_gross_income"].effective == "104000.00"


@pytest.mark.asyncio
async def test_an_adult_family_camp_request_is_priced_as_one_person() -> None:
    response = form_response(
        "resp-grace-1", person=GRACE, household=GRACE_HOUSEHOLD, program="family_camp", weekend=FAMILY_CAMP_6
    )
    store = gform_store(response, attendees=enrolled(GRACE, GRACE_HOUSEHOLD, ADULT_REG_6))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=GRACE, program="family_camp")
    inputs = to_request_inputs(request, effective_ask(request, []), None, "family_camp")
    assert inputs.headcount is not None
    assert (inputs.headcount.standard, inputs.headcount.infants, inputs.headcount.children) == (1, 0, 0)
    rules = with_lever(
        intake_rules(), "cost.family_rates", [{"session_cm_id": FAMILY_CAMP_6, "standard": "600", "infant": "300"}]
    )
    application = store.applications[request.application_id]
    sessions = {s.cm_id: s for s in store.sessions}
    assert _cost_only(request, application, [], sessions, [], None, rules) == Decimal(600)


@pytest.mark.asyncio
async def test_staff_correct_the_adults_own_income_on_her_request() -> None:
    store, casework = await both_forms()
    adult = store.request_for(person=RACHEL, program="adult_weekend")  # type: ignore[attr-defined]
    out = await casework.add_correction(
        2027, RACHEL_HOUSEHOLD, "total_gross_income", "99000", "Called her.", ACTOR, request_id=adult.id
    )
    assert (out.field, out.new_value) == ("total_gross_income", "99000.00")
    results = {r.request_id: r for r in await casework.calculator_inputs_for(2027, RACHEL_HOUSEHOLD, intake_rules())}
    assert results[adult.id].application.prior_year_gross == Decimal("99000.00")
    # The household's own figure is untouched by the adult's correction (the children stay held).
    child = store.request_for(person=CHILD, program="summer")  # type: ignore[attr-defined]
    assert results[child.id].application.prior_year_gross is None


@pytest.mark.asyncio
async def test_a_campminder_request_still_refuses_an_income_correction_scoped_to_it() -> None:
    store, casework = await both_forms()
    child = store.request_for(person=CHILD, program="summer")  # type: ignore[attr-defined]
    with pytest.raises(CorrectionError):
        await casework.add_correction(
            2027, RACHEL_HOUSEHOLD, "total_gross_income", "99000", "x", ACTOR, request_id=child.id
        )


@pytest.mark.asyncio
async def test_the_household_page_shows_the_adults_own_answer_set_on_her_request() -> None:
    store, casework = await both_forms()
    detail = await casework.application_detail(2027, RACHEL_HOUSEHOLD)
    adult = next(r for r in detail.requests if r.person_cm_id == RACHEL)
    assert (adult.origin, adult.form_source, adult.answers_source) == ("form", "google_form", "google_form")
    assert adult.answers is not None
    assert {a.field: a.effective for a in adult.answers}["total_gross_income"] == "104000.00"
    assert not any(i.code == "household_income_conflict" for i in adult.issues)
    child = next(r for r in detail.requests if r.person_cm_id == CHILD)
    assert (child.form_source, child.answers_source, child.answers) == ("campminder", "", None)


def test_calculator_inputs_skip_the_application_conflict_for_an_own_answer_request() -> None:
    from api.services.financial_aid_intake_types import ApplicationRecord, RequestRecord

    flags = ({"code": "income_conflict", "detail": {"fields": {"total_gross_income": []}}},)
    application = ApplicationRecord("app1", 2027, RACHEL_HOUSEHOLD, "active", {}, (), flags)
    request = RequestRecord(
        "req1", 2027, "app1", RACHEL_HOUSEHOLD, RACHEL, ADULT_WEEKEND_A, "adult_weekend",
        "", f"gform:{ADULT_WEEKEND_A}", "enrollment", 400.0, 0, 0, "", "active", "",
        answers={"total_gross_income": 104000.0}, answers_source="google_form",
    )  # fmt: skip
    answers = pricing_answers(request, application, [])
    converted = calculator_inputs(request, application, answers, [], {}, [], None, intake_rules())
    assert "household_income_conflict" not in _codes(converted.issues)


@pytest.mark.asyncio
async def test_the_household_page_names_who_filed_each_answer_set_and_when() -> None:
    _, casework = await both_forms()
    detail = await casework.application_detail(2027, RACHEL_HOUSEHOLD)
    adult = next(r for r in detail.requests if r.person_cm_id == RACHEL)
    assert (adult.form_response_id, adult.form_submitted_at) == ("resp-rachel-1", "2026-11-05T17:00:00Z")

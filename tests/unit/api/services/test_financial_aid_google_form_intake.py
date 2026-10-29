"""Intake makes Camperships requests from the adult aid Google Form (adult-aid form design PR 2; owner rulings 10-29).

From 2027 an adult-only Family Camp attendee (an "Adult Reg: Family Camp N" registration) and an adult-weekend guest
file the adult aid Google Form, not CampMinder's. PR 1 mirrors each response into aid_form_responses and matches it
to a person. This PR turns a matched, live response into a request:

  - GF-3 = B: each response is its own PERSON-level request, the same shape as an adult-weekend request, on the
    adult's own household. Two adults of one household at one weekend are two requests.
  - GF-2 = B: the response's own figures price that request, never the household application's. They are stored on
    the request (aid_requests.answers, answers_source "google_form") and NEVER fed to choose_household_answers, so a
    household that filed both forms raises no cross-form income_conflict.
  - The request's key is "gform:<weekend session id>", so a relabelled choice is the same request; its origin is
    "form" and its form_source "google_form".
  - GF-4 (owner: the form is no longer editable): before a decision an edit or newer response re-applies and a
    deleted response withdraws the request; after a decision neither is applied, and the request is flagged.
  - 2026 is frozen: nothing reads the mirror before GOOGLE_FORM_FIRST_SEASON (2027).

Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from api.services.financial_aid_decisions_repository import decision_event
from api.services.financial_aid_google_form import GOOGLE_FORM_FIRST_SEASON
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import request_origin
from tests.unit.api.services.financial_aid_fakes import fa_row
from tests.unit.api.services.financial_aid_gform_fakes import (
    ADULT_REG_6,
    ADULT_WEEKEND_A,
    DANA,
    DANA_HOUSEHOLD,
    FAMILY_CAMP_6,
    GRACE,
    GRACE_HOUSEHOLD,
    RACHEL,
    RACHEL_HOUSEHOLD,
    RILEY,
    enrolled,
    form_response,
    gform_store,
)


def _flag_codes(request: object) -> set[str]:
    return {str(f.get("code")) for f in request.flags}  # type: ignore[attr-defined]


def _decide(store: object, request_id: str) -> None:
    """A Round 1 award recorded on the request: a decision exists from here on."""
    store.decision_events.append(  # type: ignore[attr-defined]
        decision_event(
            SimpleNamespace(
                id="dec000000000001",
                request=request_id,
                round=1,
                event="award",
                amount=300,
                created=datetime(2026, 12, 1, tzinfo=UTC),
                actor="registrar@example.com",
            )
        )
    )


def test_the_first_season_is_2027() -> None:
    assert GOOGLE_FORM_FIRST_SEASON == 2027


@pytest.mark.asyncio
async def test_a_matched_adult_weekend_response_makes_the_adults_own_request() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    report = await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert (request.household_cm_id, request.session_cm_id, request.status, request.ask) == (
        RACHEL_HOUSEHOLD,
        ADULT_WEEKEND_A,
        "active",
        400.0,
    )
    assert request.program_option_key == f"gform:{ADULT_WEEKEND_A}"
    assert request_origin(request.program_option_key) == "form"
    assert (request.answers_source, request.form_response_id, request.form_submitted_at) == (
        "google_form",
        "resp-rachel-1",
        "2026-11-05T17:00:00Z",
    )
    assert request.answers is not None
    assert (request.answers["total_gross_income"], request.answers["expected_gross_income"]) == (80000.0, 72000.0)
    # The household has no CampMinder form: intake still makes its application (a request needs one), blank.
    (application,) = store.applications.values()
    assert application.household_cm_id == RACHEL_HOUSEHOLD
    assert application.answers["total_gross_income"] is None
    assert request.application_id == application.id
    assert report.requests_created == 1


@pytest.mark.asyncio
async def test_an_adult_reg_family_camp_response_is_a_person_level_request_on_its_weekend() -> None:
    response = form_response(
        "resp-grace-1", person=GRACE, household=GRACE_HOUSEHOLD, program="family_camp", weekend=FAMILY_CAMP_6
    )
    store = gform_store(response, attendees=enrolled(GRACE, GRACE_HOUSEHOLD, ADULT_REG_6))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=GRACE, program="family_camp")
    assert (request.person_cm_id, request.household_cm_id, request.session_cm_id, request.status) == (
        GRACE,
        GRACE_HOUSEHOLD,
        FAMILY_CAMP_6,
        "active",
    )
    assert request.program_option_key == f"gform:{FAMILY_CAMP_6}"
    # A person-level request: no household headcount is written or flagged (pricing counts the one adult).
    assert "family_camp_headcount_missing" not in _flag_codes(request)


@pytest.mark.asyncio
async def test_a_matched_adult_not_yet_enrolled_waits_session_unclear() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A, status=8))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert (request.status, request.session_cm_id) == ("unmatched_session", 0)


@pytest.mark.asyncio
async def test_the_request_follows_only_the_responses_own_weekend() -> None:
    # Enrolled in two adult weekends: the response names A, so the request lands on A, never "Session unclear".
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A, 1000402))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert (request.status, request.session_cm_id) == ("active", ADULT_WEEKEND_A)


@pytest.mark.asyncio
async def test_an_unclear_weekend_keys_the_request_by_the_normalised_choice() -> None:
    response = form_response(weekend=0, choice="Adult  Weekend A (Sep 10-12)")
    store = gform_store(response, attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert request.program_option_key == "gform:adult weekend a (sep 10-12)"
    assert (request.status, request.session_cm_id) == ("active", ADULT_WEEKEND_A)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status", ["suggested", "registered_elsewhere", "not_registered", "unmatched", "ignored", "superseded"]
)
async def test_only_a_confirmed_or_staff_linked_response_makes_a_request(status: str) -> None:
    store = gform_store(
        form_response(match_status=status), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A)
    )
    await FinancialAidIntakeService(store).build(2027)
    assert store.requests == {}


@pytest.mark.asyncio
async def test_a_staff_linked_response_makes_a_request() -> None:
    store = gform_store(
        form_response(match_status="staff"), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A)
    )
    await FinancialAidIntakeService(store).build(2027)
    assert store.request_for(person=RACHEL, program="adult_weekend").status == "active"


@pytest.mark.asyncio
async def test_2026_never_reads_the_mirror() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    await FinancialAidIntakeService(store).build(2026)
    assert store.requests == {}
    assert 2026 not in store.form_years_read


@pytest.mark.asyncio
async def test_the_adults_figures_never_reach_the_household_application_and_raise_no_cross_form_conflict() -> None:
    # The household filed CampMinder's form for a child at $96,000; the mother's adult form says $104,000.
    child = 1000092
    store = gform_store(
        form_response(total_gross_income=104000.0, expected_gross_income=104000.0),
        attendees=[
            *enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A),
            *enrolled(child, RACHEL_HOUSEHOLD, 1000101),
        ],
        fa_rows=[
            fa_row(
                child,
                RACHEL_HOUSEHOLD,
                summer="Session 2",
                summer_ask=1500.0,
                total_gross_income=96000.0,
                expected_gross_income=96000.0,
            )
        ],
    )
    await FinancialAidIntakeService(store).build(2027)
    (application,) = store.applications.values()
    assert application.answers["total_gross_income"] == 96000.0
    assert "income_conflict" not in {f.get("code") for f in application.flags}
    assert application.member_person_cm_ids == (child,)
    adult = store.request_for(person=RACHEL, program="adult_weekend")
    assert adult.answers is not None
    assert adult.answers["total_gross_income"] == 104000.0
    summer = store.request_for(person=child, program="summer")
    assert (summer.answers, summer.answers_source) == (None, "")


@pytest.mark.asyncio
async def test_two_adults_of_one_household_at_one_weekend_are_two_requests() -> None:
    store = gform_store(
        form_response("resp-dana", person=DANA, household=DANA_HOUSEHOLD, program="family_camp", weekend=FAMILY_CAMP_6),
        form_response(
            "resp-riley",
            person=RILEY,
            household=DANA_HOUSEHOLD,
            program="family_camp",
            weekend=FAMILY_CAMP_6,
            ask=250.0,
            total_gross_income=50000.0,
        ),
        attendees=[*enrolled(DANA, DANA_HOUSEHOLD, ADULT_REG_6), *enrolled(RILEY, DANA_HOUSEHOLD, ADULT_REG_6)],
    )
    await FinancialAidIntakeService(store).build(2027)
    dana = store.request_for(person=DANA, program="family_camp")
    riley = store.request_for(person=RILEY, program="family_camp")
    assert (dana.status, riley.status) == ("active", "active")
    assert (dana.ask, riley.ask) == (400.0, 250.0)
    assert "ask_conflict" not in _flag_codes(dana) | _flag_codes(riley)
    assert riley.answers is not None
    assert riley.answers["total_gross_income"] == 50000.0
    (application,) = store.applications.values()
    assert "income_conflict" not in {f.get("code") for f in application.flags}


@pytest.mark.asyncio
async def test_an_unreadable_figure_stays_unknown_never_zero() -> None:
    response = form_response(
        total_gross_income=0.0,
        reported=("expected_gross_income",),
        notes={"total_gross_income": {"typed": "80-90k", "read": None, "note": "a range: not read"}},
    )
    store = gform_store(response, attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert request.answers is not None
    assert (request.answers["total_gross_income"], request.answers["expected_gross_income"]) == (None, 72000.0)


@pytest.mark.asyncio
async def test_a_reported_zero_income_is_a_real_zero() -> None:
    response = form_response(total_gross_income=0.0, reported=("total_gross_income", "expected_gross_income"))
    store = gform_store(response, attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert request.answers is not None
    assert request.answers["total_gross_income"] == 0.0


@pytest.mark.asyncio
async def test_a_rebuild_on_unchanged_inputs_writes_nothing() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    store.writes.clear()
    report = await service.build(2027)
    assert store.writes == []
    assert report.operation_id == ""


# -- GF-4: edits, newer responses and deletes ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_before_a_decision_an_edit_re_applies() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    store.form_responses = [form_response(submitted="2026-11-09T09:00:00Z", ask=500.0, total_gross_income=60000.0)]
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert request.answers is not None
    assert (request.ask, request.answers["total_gross_income"], request.form_submitted_at) == (
        500.0,
        60000.0,
        "2026-11-09T09:00:00Z",
    )
    assert not _flag_codes(request) & {"form_changed_after_decision", "form_response_deleted"}


@pytest.mark.asyncio
async def test_before_a_decision_a_newer_response_replaces_the_older_one() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    store.form_responses = [
        form_response(match_status="superseded", superseded_by="resp-rachel-2"),
        form_response("resp-rachel-2", submitted="2026-11-09T09:00:00Z", ask=450.0),
    ]
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert (request.ask, request.form_response_id, request.status) == (450.0, "resp-rachel-2", "active")


@pytest.mark.asyncio
async def test_two_live_linked_responses_for_one_weekend_take_the_newest() -> None:
    # A staff link is never superseded by the job ("PR 2 sees both"): the newest response still wins here.
    store = gform_store(
        form_response(match_status="staff"),
        form_response("resp-rachel-2", submitted="2026-11-09T09:00:00Z", ask=450.0),
        attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A),
    )
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    assert (request.ask, request.form_response_id) == (450.0, "resp-rachel-2")


@pytest.mark.asyncio
async def test_before_a_decision_a_deleted_response_withdraws_the_request() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    store.form_responses = [form_response(form_status="deleted")]
    await service.build(2027)
    assert store.request_for(person=RACHEL, program="adult_weekend").status == "withdrawn"


@pytest.mark.asyncio
async def test_after_a_decision_an_edit_is_flagged_and_not_applied() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    _decide(store, request.id)
    store.form_responses = [form_response(submitted="2026-12-10T09:00:00Z", ask=900.0, total_gross_income=20000.0)]
    await service.build(2027)
    after = store.requests[request.id]
    assert after.answers is not None
    assert (after.ask, after.answers["total_gross_income"], after.form_submitted_at) == (
        400.0,
        80000.0,
        "2026-11-05T17:00:00Z",
    )
    assert after.status == "active"
    assert "form_changed_after_decision" in _flag_codes(after)


@pytest.mark.asyncio
async def test_after_a_decision_a_newer_response_is_flagged_and_not_applied() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    _decide(store, request.id)
    store.form_responses = [
        form_response(match_status="superseded", superseded_by="resp-rachel-2"),
        form_response("resp-rachel-2", submitted="2026-12-10T09:00:00Z", ask=900.0),
    ]
    await service.build(2027)
    assert len(store.requests) == 1
    after = store.requests[request.id]
    assert (after.ask, after.form_response_id) == (400.0, "resp-rachel-1")
    assert "form_changed_after_decision" in _flag_codes(after)


@pytest.mark.asyncio
async def test_after_a_decision_a_deleted_response_is_flagged_and_the_request_stays() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    _decide(store, request.id)
    store.form_responses = [form_response(form_status="deleted")]
    await service.build(2027)
    after = store.requests[request.id]
    assert (after.status, after.ask) == ("active", 400.0)
    assert "form_response_deleted" in _flag_codes(after)


@pytest.mark.asyncio
async def test_a_family_ask_event_alone_is_not_a_decision() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    store.decision_events.append(
        decision_event(
            SimpleNamespace(
                id="dec000000000002",
                request=request.id,
                round=2,
                event="ask",
                amount=200,
                created=datetime(2026, 12, 1, tzinfo=UTC),
                actor="registrar@example.com",
            )
        )
    )
    store.form_responses = [form_response(submitted="2026-12-10T09:00:00Z", ask=900.0)]
    await service.build(2027)
    assert store.requests[request.id].ask == 900.0

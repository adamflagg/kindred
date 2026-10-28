"""IN-FORM-ONLY = A (owner 2026-10-28): from 2027 an adult-weekend request comes only from an aid form or staff's Add a
Request, never from a registration ask alone.

The registrar's answer (2026-10-27): only enrolled people can have aid processed, and the amount someone put on the
registration form is just a signal they may file later; intake starts when someone fills out the aid FORM. Adults
apply through an aid Jotform linked from their registration confirmation (tracker IN-AW-JOTFORM, not built yet).
This restores R-G1-015 / R-G4-097 ("a registration 'yes' with no aid form is not a request") and R-G1-055 (from 2027 a
request is made when the aid form arrives). 2026 is the tie-off season and keeps what it has (owner guidance 10-17).

The ask is still a signal: Form intake lists it under Registration ask only. Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

import pytest

from api.services import financial_aid_household
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AttendeeRow
from tests.unit.api.services.financial_aid_fakes import FakeAidStore, fa_row
from tests.unit.api.services.test_financial_aid_request_additions import ACTOR, make_store

ADULT_HOUSEHOLD, ADULT = 1000008, 1000081  # a fictional adult who typed $400 on the adult-weekend registration
ADULT_WEEKEND_A = 1000401
STATUSES = (
    pytest.param(2, id="enrolled"),
    pytest.param(4, id="applied"),
    pytest.param(8, id="waitlisted"),
    pytest.param(512, id="incomplete"),
)


def registration_only_adult(status_id: int, *, ask: float = 400.0) -> FakeAidStore:
    return make_store(
        fa_row(ADULT, ADULT_HOUSEHOLD, interest=True, registration_ask=ask),
        attendees=[AttendeeRow(ADULT, ADULT_HOUSEHOLD, ADULT_WEEKEND_A, status_id)],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status_id", STATUSES)
async def test_a_2027_registration_ask_with_no_aid_form_makes_no_request_or_application(status_id: int) -> None:
    store = registration_only_adult(status_id)
    report = await FinancialAidIntakeService(store).build(2027)
    assert (store.requests, store.applications, store.payer_shares) == ({}, {}, {})
    assert (report.requests_created, report.rows_without_request) == (0, 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("status_id", STATUSES)
async def test_a_2026_registration_ask_still_makes_its_adult_weekend_request(status_id: int) -> None:
    store = registration_only_adult(status_id)
    await FinancialAidIntakeService(store).build(2026)
    request = store.request_for(person=ADULT, program="adult_weekend")
    expected = ("active", ADULT_WEEKEND_A) if status_id == 2 else ("unmatched_session", 0)
    assert (request.year, request.ask, (request.status, request.session_cm_id)) == (2026, 400.0, expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("status_id", STATUSES)
async def test_the_2027_ask_still_shows_on_form_intake_as_registration_ask_only(status_id: int) -> None:
    # Form intake reads the ask from the FA row itself (financial_aid_form_intake's _named_subjects /
    # registration_ask / interest_only), not from a request, so the signal survives the request going away.
    store = registration_only_adult(status_id)
    await FinancialAidIntakeService(store).build(2027)
    out = await FormIntakeService(store).forms(2027)
    (adult,) = [r for r in out.rows if (r.household_cm_id, r.person_cm_id) == (ADULT_HOUSEHOLD, ADULT)]
    assert (adult.filed, adult.registration_only, adult.why_not, adult.became) == (
        False,
        True,
        "registration_only",
        [],
    )
    assert adult.registration_ask is not None
    assert adult.registration_ask.amount == 400.0
    assert out.counts.registration_only == 1
    if status_id == 2:
        # Enrolled: staff's Add a Request is the way in, and it still works.
        assert ([g.session_cm_id for g in adult.gap_sessions], adult.can_add) == ([ADULT_WEEKEND_A], True)


@pytest.mark.asyncio
async def test_an_interest_tick_with_no_amount_still_shows_as_registration_ask_only_in_2027() -> None:
    store = registration_only_adult(8, ask=0.0)
    await FinancialAidIntakeService(store).build(2027)
    out = await FormIntakeService(store).forms(2027)
    (adult,) = [r for r in out.rows if r.person_cm_id == ADULT]
    assert (adult.registration_only, adult.why_not, adult.registration_ask) == (True, "registration_only", None)


@pytest.mark.asyncio
async def test_staff_add_a_request_still_makes_a_2027_adult_weekend_request() -> None:
    store = registration_only_adult(2)
    await FinancialAidIntakeService(store).build(2027)
    await FinancialAidCaseworkService(store).add_request(
        2027, ADULT_HOUSEHOLD, ADULT, ADULT_WEEKEND_A, 400.0, "Asked by phone", ACTOR
    )
    request = store.request_for(person=ADULT, program="adult_weekend")
    assert (request.status, request.session_cm_id, request.program_option_key) == (
        "active",
        ADULT_WEEKEND_A,
        f"added:{ADULT_WEEKEND_A}",
    )


@pytest.mark.asyncio
async def test_the_nightly_rebuild_withdraws_a_2027_request_the_old_path_made_and_never_deletes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Prod's stray: a 2027 adult_weekend request the old path made for a waitlisted adult, unmatched_session, no
    # decisions, placements or scenarios. Make it as the old code did, then rebuild under the ruling.
    store = registration_only_adult(8)
    service = FinancialAidIntakeService(store)
    with monkeypatch.context() as old_code:
        old_code.setattr(financial_aid_household, "ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON", 2028)
        await service.build(2027)
    stray = store.request_for(person=ADULT, program="adult_weekend")
    assert (stray.status, stray.session_cm_id, stray.program_option_key) == ("unmatched_session", 0, "")
    (application,) = store.applications.values()
    store.change_log.clear()

    report = await service.build(2027)

    assert set(store.requests) == {stray.id}  # the same row, kept: withdrawn, not deleted
    assert store.requests[stray.id].status == "withdrawn"
    assert store.applications[application.id].status == "withdrawn"
    assert (report.requests_created, report.requests_updated, report.unmatched_sessions) == (0, 1, 0)
    statuses = {(r["entity"], r["entity_id"]): r for r in store.change_log if r["action"] == "status"}
    logged = statuses[("aid_requests", stray.id)]
    assert (logged["actor"], logged["reason"], logged["before"], logged["after"]) == (
        "system:intake",
        "intake rebuild",
        {"status": "unmatched_session"},
        {"status": "withdrawn"},
    )
    assert ("aid_applications", application.id) in statuses

    writes = len(store.writes)
    await service.build(2027)  # and stays withdrawn: the next run writes nothing
    assert (len(store.writes), store.requests[stray.id].status) == (writes, "withdrawn")

    out = await FormIntakeService(store).forms(2027)
    (adult,) = [r for r in out.rows if r.person_cm_id == ADULT]
    assert (adult.registration_only, adult.why_not) == (True, "registration_only")  # still the signal

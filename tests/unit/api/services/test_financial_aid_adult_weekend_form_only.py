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

from api.schemas.financial_aid_form_intake import FormIntakeRowOut
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
    # The row as the sync writes it: the legacy pair, which 2026 reads, and the adult-weekend pair, which 2027 reads
    # (IN-BUCKETS, migration 1500000253).
    return make_store(
        fa_row(ADULT, ADULT_HOUSEHOLD, interest=True, registration_ask=ask, weekend_interest=True, weekend_ask=ask),
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


# IN-BUCKETS (owner 2026-10-28): "if the summer aid form was filed, only the summer enrollment status should be
# checked. summer registration should not impact if we're looking at aid for family, or adult programs, and vice versa
# for each situation. they are separate buckets and people need to fill out the correct aid form for the requisite type
# of session(s) being attended, else they haven't actually asked for aid". So an adult's adult-weekend ask is judged on
# adult-weekend facts alone, never on the summer form their household filed for a child.
# Emma Johnson's household files the aid form for her summer; an adult of the household asks at the adult weekend.
JOHNSONS, EMMA, PARENT = 1000007, 1000071, 1000072
SESSION_2 = 1000101
INCOME = 90000.0
INCOME_ON_ADULT_ROW = (
    pytest.param(False, id="adult-row-blank"),
    pytest.param(True, id="adult-row-carries-the-household-income"),
)


def filed_for_a_child(adult_status: int, *, income_on_adult_row: bool = False) -> FakeAidStore:
    adult = fa_row(PARENT, JOHNSONS, interest=True, registration_ask=400.0, weekend_interest=True, weekend_ask=400.0)
    if income_on_adult_row:
        adult = fa_row(
            PARENT,
            JOHNSONS,
            interest=True,
            registration_ask=400.0,
            weekend_interest=True,
            weekend_ask=400.0,
            total_gross_income=INCOME,
        )
    return make_store(
        fa_row(EMMA, JOHNSONS, summer="Session 2", summer_ask=1500.0, total_gross_income=INCOME),
        adult,
        attendees=[
            AttendeeRow(EMMA, JOHNSONS, SESSION_2, 2),
            AttendeeRow(PARENT, JOHNSONS, ADULT_WEEKEND_A, adult_status),
        ],
    )


def row_of(rows: list[FormIntakeRowOut], person: int) -> FormIntakeRowOut:
    (found,) = [r for r in rows if (r.household_cm_id, r.person_cm_id) == (JOHNSONS, person)]
    return found


@pytest.mark.asyncio
@pytest.mark.parametrize("income_on_adult_row", INCOME_ON_ADULT_ROW)
@pytest.mark.parametrize("status_id", STATUSES)
async def test_from_2027_an_adult_weekend_ask_is_registration_ask_only_though_the_household_filed_for_a_child(
    status_id: int, income_on_adult_row: bool
) -> None:
    store = filed_for_a_child(status_id, income_on_adult_row=income_on_adult_row)
    await FinancialAidIntakeService(store).build(2027)
    service = FormIntakeService(store)
    out = await service.forms(2027)

    adult = row_of(out.rows, PARENT)
    # filed stays the household's fact; the adult-weekend bucket has no aid form, so the ask is the only signal.
    assert (adult.filed, adult.registration_only, adult.why_not, adult.why_not_detail, adult.became) == (
        True,
        True,
        "registration_only",
        None,
        [],
    )
    assert adult.registration_ask is not None
    assert adult.registration_ask.amount == 400.0
    # Not a needs-look row: no aid form means they have not asked for aid (IN-FORM-ONLY = A).
    assert (adult.needs_look, adult.look_reasons) == (False, [])
    assert (out.counts.registration_only, out.counts.needs_look) == (1, 0)
    summary = await service.summary(2027)
    assert (summary.registration_only, summary.needs_look) == (1, 0)
    assert (await service.needs_a_look(2027)).rows == ()
    if status_id == 2:
        # Enrolled: Add a Request… stays the way in.
        assert ([g.session_cm_id for g in adult.gap_sessions], adult.can_add) == ([ADULT_WEEKEND_A], True)
    else:
        assert (adult.gap_sessions, adult.can_add) == ([], False)


@pytest.mark.asyncio
@pytest.mark.parametrize("status_id", STATUSES)
async def test_the_childs_summer_request_is_unaffected_by_the_adult_weekend_bucket_in_2027(status_id: int) -> None:
    store = filed_for_a_child(status_id)
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=EMMA, program="summer")
    assert (request.status, request.session_cm_id, request.ask) == ("active", SESSION_2, 1500.0)
    assert [r.program_key for r in store.requests.values()] == ["summer"]

    emma = row_of((await FormIntakeService(store).forms(2027)).rows, EMMA)
    assert (emma.filed, emma.registration_only, emma.why_not, emma.needs_look) == (True, False, None, False)
    assert [(a.program_key, a.ask) for a in emma.answers] == [("summer", 1500.0)]
    assert [(b.program_key, b.status, b.session_cm_id) for b in emma.became] == [("summer", "active", SESSION_2)]


@pytest.mark.asyncio
@pytest.mark.parametrize("status_id", STATUSES)
async def test_2026_still_judges_the_adult_by_the_households_filing(status_id: int) -> None:
    # 2026 is the tie-off season: the ask makes the adult's request there, and Form intake reads it as before.
    store = filed_for_a_child(status_id)
    await FinancialAidIntakeService(store).build(2026)
    adult = row_of((await FormIntakeService(store).forms(2026)).rows, PARENT)
    expected = ("active", ADULT_WEEKEND_A) if status_id == 2 else ("session_unclear", 0)
    assert (adult.filed, adult.registration_only) == (True, False)
    assert [(b.program_key, b.status, b.session_cm_id) for b in adult.became] == [("adult_weekend", *expected)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_id", "why", "needs_look"),
    [
        pytest.param(2, "enrolled_no_request", True, id="enrolled"),
        pytest.param(8, "adult_not_registered", False, id="waitlisted"),
    ],
)
async def test_2026_form_intake_explains_a_missing_adult_request_exactly_as_before(
    status_id: int, why: str, needs_look: bool
) -> None:
    # Form intake read before intake ran (no request yet): 2026's explanation is unchanged, household filing and all.
    store = filed_for_a_child(status_id)
    adult = row_of((await FormIntakeService(store).forms(2026)).rows, PARENT)
    assert (adult.filed, adult.registration_only, adult.why_not, adult.needs_look) == (True, False, why, needs_look)

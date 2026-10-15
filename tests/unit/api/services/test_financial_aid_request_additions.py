"""Staff-added requests (aid_request_additions): a second-program request intake keeps.

Intake is the only creator of aid_requests, and it withdraws every request its inputs do not produce. A request
the aid form never named (a Teen Winter Retreat or B*Mitzvah request beside a summer one) therefore needs a stored,
staff-owned input intake reads: one addition row per (season, household, camper, session). Fictional data only.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from api.services.financial_aid_casework_service import (
    AdditionItem,
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
    request_out,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService, IntakeReport
from api.services.financial_aid_intake_types import (
    AdditionRecord,
    AttendeeRow,
    BillingLine,
    FaRow,
    RequestRecord,
    SessionRow,
)
from bunking.financial_aid.decisions.rounds import DecisionEvent
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, FakeAidStore, fa_row, intake_rules

ACTOR = "registrar@example.com"

SCIT = 1000107  # "Counselor In-Training", a summer (scit) session
SESSION_2 = 1000101
BMITZVAH_1 = 1000301
BMITZVAH_2 = 1000302
WINTER = 1000501  # a winter retreat: session type "teen", which the resolver counts as summer
ADULT_REG = 1000601  # an Adult Reg (family_adult) session: no program names it
FAMILY_CAMP_6 = 1000202

EXTRA_SESSIONS = (
    SessionRow(BMITZVAH_2, "The Camp's B*Mitzvah Program Year 2 - East", "bmitzvah", "2027-01-17"),
    SessionRow(WINTER, "Winter Retreat", "teen", "2027-12-27"),
    SessionRow(ADULT_REG, "Adult Reg 6", "family_adult", "2027-08-20", parent_cm_id=1000202),
)

# Emma Johnson's household: she files the aid form for summer and is also enrolled in the winter retreat.
EMMA_HOUSEHOLD, EMMA = 1000007, 1000071
# Liam Garcia's household never filed the aid form at all.
LIAM_HOUSEHOLD, LIAM = 1000008, 1000081
# Olivia Chen's household comes to Family Camp and never filed the aid form either.
OLIVIA_HOUSEHOLD, OLIVIA = 1000006, 1000061


def enrolled(person: int, household: int, *sessions: int, status: int = 2) -> list[AttendeeRow]:
    return [AttendeeRow(person, household, session, status) for session in sessions]


def make_store(*rows: FaRow, attendees: list[AttendeeRow]) -> FakeAidStore:
    store = FakeAidStore()
    store.rules = intake_rules()
    store.sessions = [*SESSIONS, *EXTRA_SESSIONS]
    store.fa_rows = list(rows)
    store.attendees = attendees
    return store


def addition(
    person: int = EMMA,
    household: int = EMMA_HOUSEHOLD,
    session: int = WINTER,
    *,
    ask: float = 600.0,
    retired_at: str = "",
    retired_by: str = "",
    retire_reason: str = "",
) -> AdditionRecord:
    return AdditionRecord(
        id=f"add{person:08d}{session % 10000:04d}",
        year=YEAR,
        household_cm_id=household,
        person_cm_id=person,
        program_key="summer",
        session_cm_id=session,
        ask=ask,
        source="staff",
        reason="Second program, staff added",
        actor=ACTOR,
        retired_at=retired_at,
        retired_by=retired_by,
        retire_reason=retire_reason,
    )


def added_request(store: FakeAidStore, person: int = EMMA, session: int = WINTER) -> RequestRecord:
    found = [
        r for r in store.requests.values() if r.person_cm_id == person and r.program_option_key == f"added:{session}"
    ]
    assert len(found) == 1, found
    return found[0]


async def build(store: FakeAidStore) -> IntakeReport:
    return await FinancialAidIntakeService(store).build(YEAR)


# -- intake reads the additions --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_request_from_an_addition_is_created_staff_resolved_and_survives_a_rebuild() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0, total_gross_income=70000.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    live = addition()
    store.additions[live.id] = live
    await build(store)

    request = added_request(store)
    assert (request.session_cm_id, request.session_resolution, request.status, request.ask) == (
        WINTER,
        "staff",
        "active",
        600.0,
    )
    assert request.program_key == "summer"
    # The form's own summer request is untouched beside it.
    (form,) = [r for r in store.requests.values() if r.program_option_key == "session 2"]
    assert (form.status, form.session_cm_id) == ("active", SESSION_2)
    writes = len(store.writes)
    report = await build(store)
    assert len(store.writes) == writes
    assert (report.requests_created, report.requests_updated) == (0, 0)
    assert added_request(store).status == "active"


@pytest.mark.asyncio
async def test_an_added_request_whose_camper_leaves_the_session_is_flagged_not_enrolled_and_kept() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    live = addition()
    store.additions[live.id] = live
    await build(store)
    store.attendees = []  # dropped out of the retreat
    await build(store)
    request = added_request(store)
    assert (request.session_cm_id, request.status) == (WINTER, "active")
    assert {"code": "not_enrolled", "detail": {"session_cm_id": WINTER}} in [dict(f) for f in request.flags]


@pytest.mark.asyncio
async def test_a_retired_addition_makes_no_request() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    retired = addition(retired_at="2027-02-01 00:00:00.000Z", retired_by=ACTOR, retire_reason="Entered in error")
    store.additions[retired.id] = retired
    await build(store)
    assert store.requests == {}


@pytest.mark.asyncio
async def test_a_household_with_an_addition_and_no_form_rows_gets_an_application_with_blank_answers() -> None:
    store = make_store(attendees=enrolled(LIAM, LIAM_HOUSEHOLD, WINTER))
    live = addition(LIAM, LIAM_HOUSEHOLD)
    store.additions[live.id] = live
    report = await build(store)

    (application,) = store.applications.values()
    assert (application.household_cm_id, application.status, application.member_person_cm_ids) == (
        LIAM_HOUSEHOLD,
        "active",
        (),
    )
    assert application.answers["total_gross_income"] is None  # unknown, never 0: staff type it as a correction
    assert application.answers["special_circumstances"] == ""
    assert added_request(store, LIAM).application_id == application.id
    assert report.households == 1


@pytest.mark.asyncio
async def test_a_registration_only_household_with_an_addition_gets_its_application_from_its_rows() -> None:
    store = make_store(
        fa_row(LIAM, LIAM_HOUSEHOLD, interest=True, registration_ask=500.0, total_gross_income=0.0),
        attendees=enrolled(LIAM, LIAM_HOUSEHOLD, WINTER),
    )
    first = await build(store)
    assert store.applications == {}
    assert first.rows_without_request == 1
    live = addition(LIAM, LIAM_HOUSEHOLD)
    store.additions[live.id] = live
    second = await build(store)
    (application,) = store.applications.values()
    assert application.member_person_cm_ids == (LIAM,)
    assert second.rows_without_request == 0


@pytest.mark.asyncio
async def test_a_later_form_answer_on_the_added_slot_becomes_duplicate_pending() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    casework = FinancialAidCaseworkService(store)
    added = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat request", ACTOR)
    # The family's form later names the retreat (its option text is the session's own name).
    store.fa_rows = [fa_row(EMMA, EMMA_HOUSEHOLD, summer="Winter Retreat", summer_ask=650.0)]
    await build(store)

    form = store.request_for(person=EMMA, program="summer", status="duplicate_pending")
    assert form.program_option_key == "winter retreat"
    assert (form.session_cm_id, form.duplicate_of) == (WINTER, added.request.id)
    assert added_request(store).status == "active"


# -- an added session is not a candidate for the camper's other requests --------------------------------------------


@pytest.mark.asyncio
async def test_an_added_winter_request_takes_the_retreat_out_of_the_campers_summer_candidates() -> None:
    # Enrolled in an in-training session AND the retreat: both count as summer, so the summer answer
    # (which names neither) is "Session unclear" until the retreat has its own request.
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Summer 2027", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SCIT, WINTER),
    )
    await build(store)
    summer = store.request_for(person=EMMA, program="summer")
    assert (summer.status, summer.session_cm_id) == ("unmatched_session", 0)
    assert {"code": "unmatched_session", "detail": {"candidates": [SCIT, WINTER]}} in [dict(f) for f in summer.flags]

    await FinancialAidCaseworkService(store).add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    await build(store)

    summer = store.requests[summer.id]
    assert (summer.status, summer.session_cm_id, summer.session_resolution) == ("active", SCIT, "enrollment")
    assert added_request(store).status == "active"


@pytest.mark.asyncio
async def test_an_added_bmitzvah_request_takes_its_session_out_of_the_campers_other_bmitzvah_candidates() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, tbm="B*Mitzvah Program", tbm_ask=1200.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, BMITZVAH_1, BMITZVAH_2),
    )
    await build(store)
    form = store.request_for(person=EMMA, program="bmitzvah")
    assert form.status == "unmatched_session"

    added = await FinancialAidCaseworkService(store).add_request(
        YEAR, EMMA_HOUSEHOLD, EMMA, BMITZVAH_2, 800.0, "Second year", ACTOR
    )
    assert added.request.program_key == "bmitzvah"
    await build(store)
    form = store.requests[form.id]
    assert (form.status, form.session_cm_id) == ("active", BMITZVAH_1)


@pytest.mark.asyncio
async def test_a_request_whose_candidates_do_not_include_the_added_session_is_unchanged() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, BMITZVAH_1),
    )
    await build(store)
    summer = store.request_for(person=EMMA, program="summer")
    await FinancialAidCaseworkService(store).add_request(
        YEAR, EMMA_HOUSEHOLD, EMMA, BMITZVAH_1, 800.0, "B*Mitzvah too", ACTOR
    )
    store.writes.clear()
    await build(store)
    assert store.requests[summer.id] == summer
    assert store.writes == []


@pytest.mark.asyncio
async def test_a_form_answer_whose_only_session_is_the_added_one_stays_on_it() -> None:
    # Dropping the added session leaves nothing: the answer keeps it, so staff see the clash as duplicate_pending.
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 9", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER),
    )
    live = addition()
    store.additions[live.id] = live
    await build(store)
    form = store.request_for(person=EMMA, program="summer", status="duplicate_pending")
    assert form.session_cm_id == WINTER


# -- casework: add_request ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adding_writes_the_addition_the_request_and_its_share_as_one_logged_operation() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await build(store)
    store.operations.clear()
    store.change_log.clear()

    out = await FinancialAidCaseworkService(store).add_request(
        YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "  Retreat request  ", ACTOR
    )

    assert len(store.operations) == 1
    assert [(row["entity"], row["action"]) for row in store.change_log] == [
        ("aid_request_additions", "add_request"),
        ("aid_requests", "add_request"),
        ("aid_payer_shares", "add_request"),
    ]
    assert {row["actor"] for row in store.change_log} == {ACTOR}
    assert {row["reason"] for row in store.change_log} == {"Retreat request"}
    (stored,) = store.additions.values()
    assert (stored.source, stored.reason, stored.actor, stored.retired_at) == ("staff", "Retreat request", ACTOR, "")
    assert (out.addition.id, out.addition.request_id) == (stored.id, out.request.id)
    assert (out.request.status, out.request.session_resolution, out.request.origin) == ("active", "staff", "added")
    (share,) = [s for s in store.payer_shares.values() if s.request_id == out.request.id]
    assert (share.household_cm_id, share.share_pct) == (EMMA_HOUSEHOLD, Decimal(100))


@pytest.mark.asyncio
async def test_intake_after_an_add_finds_the_request_already_matched_and_writes_nothing() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await build(store)
    await FinancialAidCaseworkService(store).add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    # Liam's household has no application at all: the add creates the one intake would.
    store.attendees += enrolled(LIAM, LIAM_HOUSEHOLD, WINTER)
    await FinancialAidCaseworkService(store).add_request(YEAR, LIAM_HOUSEHOLD, LIAM, WINTER, 300.0, "Retreat", ACTOR)
    writes = len(store.writes)

    report = await build(store)

    assert len(store.writes) == writes
    assert (report.requests_created, report.requests_updated, report.applications_created) == (0, 0, 0)
    assert (report.applications_updated, report.payer_shares_created) == (0, 0)
    liam = added_request(store, LIAM)
    assert liam.status == "active"
    assert store.applications[liam.application_id].status == "active"


@pytest.mark.asyncio
async def test_adding_refuses_a_camper_not_enrolled_in_that_session() -> None:
    store = make_store(
        attendees=[
            *enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2),
            *enrolled(EMMA, EMMA_HOUSEHOLD, WINTER, status=8),  # waitlisted, not enrolled
        ]
    )
    casework = FinancialAidCaseworkService(store)
    with pytest.raises(CaseworkValidationError, match="enrolled"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    with pytest.raises(CaseworkValidationError, match="enrolled"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, BMITZVAH_1, 600.0, "B*Mitzvah", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_adding_refuses_an_ask_of_zero() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    with pytest.raises(CaseworkValidationError, match="ask"):
        await FinancialAidCaseworkService(store).add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 0.0, "Retreat", ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_adding_refuses_an_occupied_slot_naming_its_holder() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2),
    )
    await build(store)
    holder = store.request_for(person=EMMA, program="summer")
    store.operations.clear()
    with pytest.raises(DuplicateRequestError) as caught:
        await FinancialAidCaseworkService(store).add_request(
            YEAR, EMMA_HOUSEHOLD, EMMA, SESSION_2, 600.0, "Again", ACTOR
        )
    assert caught.value.holder_id == holder.id
    assert store.operations == []


@pytest.mark.asyncio
async def test_adding_refuses_a_session_no_program_can_name() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, ADULT_REG))
    casework = FinancialAidCaseworkService(store)
    with pytest.raises(CaseworkValidationError, match="program"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, ADULT_REG, 600.0, "Adult Reg", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, 1009999, 600.0, "No such session", ACTOR)


@pytest.mark.asyncio
async def test_adding_refuses_a_camper_on_a_family_camp_session_a_household_elsewhere_and_a_blank_reason() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER, FAMILY_CAMP_6))
    casework = FinancialAidCaseworkService(store)
    with pytest.raises(CaseworkValidationError, match="household"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, FAMILY_CAMP_6, 600.0, "Family Camp", ACTOR)
    with pytest.raises(CaseworkValidationError, match="household"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, 0, WINTER, 600.0, "Retreat", ACTOR)
    with pytest.raises(CaseworkValidationError, match="reason"):
        await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "   ", ACTOR)
    assert store.operations == []


# -- Family Camp: a household request (person 0) ------------------------------------------------------------------------


def _family_camp_store() -> FakeAidStore:
    # Olivia Chen's household never filed the aid form: no form row, no application. Her parent and she are billed
    # for Family Camp 6, where she is enrolled.
    store = make_store(attendees=enrolled(OLIVIA, OLIVIA_HOUSEHOLD, FAMILY_CAMP_6))
    store.billing = [
        BillingLine(OLIVIA_HOUSEHOLD, 0, 0, 17006, "Family Camp 6", "Family Camp 6 - Adult", 1, 600.0, False),
        BillingLine(
            OLIVIA_HOUSEHOLD, OLIVIA, FAMILY_CAMP_6, 17006, "Family Camp 6", "Family Camp 6 - Child", 1, 600.0, False
        ),
    ]
    return store


@pytest.mark.asyncio
async def test_a_family_camp_household_request_is_added_with_intakes_billed_headcount_and_kept() -> None:
    store = _family_camp_store()
    out = await FinancialAidCaseworkService(store).add_request(
        YEAR, OLIVIA_HOUSEHOLD, 0, FAMILY_CAMP_6, 900.0, "Registration ask", ACTOR
    )
    assert (out.request.person_cm_id, out.request.program_key, out.request.status) == (0, "family_camp", "active")
    assert (out.request.headcount_non_infant, out.request.headcount_infant, out.request.headcount_source) == (
        2,
        0,
        "billed",
    )
    (application,) = store.applications.values()
    assert (application.household_cm_id, application.member_person_cm_ids) == (OLIVIA_HOUSEHOLD, ())
    writes = len(store.writes)
    report = await build(store)
    assert len(store.writes) == writes
    assert (report.requests_created, report.requests_updated, report.applications_updated) == (0, 0, 0)
    assert store.requests[out.request.id].status == "active"


@pytest.mark.asyncio
async def test_a_family_camp_addition_needs_someone_in_the_household_enrolled() -> None:
    store = _family_camp_store()
    store.attendees = enrolled(OLIVIA, OLIVIA_HOUSEHOLD, FAMILY_CAMP_6, status=8)  # waitlisted only
    with pytest.raises(CaseworkValidationError, match="enrolled"):
        await FinancialAidCaseworkService(store).add_request(
            YEAR, OLIVIA_HOUSEHOLD, 0, FAMILY_CAMP_6, 900.0, "Registration ask", ACTOR
        )


@pytest.mark.asyncio
async def test_a_family_camp_form_answer_on_the_added_weekend_becomes_duplicate_pending() -> None:
    store = _family_camp_store()
    added = await FinancialAidCaseworkService(store).add_request(
        YEAR, OLIVIA_HOUSEHOLD, 0, FAMILY_CAMP_6, 900.0, "Registration ask", ACTOR
    )
    store.fa_rows = [fa_row(OLIVIA, OLIVIA_HOUSEHOLD, fc="Family Camp 6", fc_ask=950.0)]
    await build(store)
    form = store.request_for(household=OLIVIA_HOUSEHOLD, program="family_camp", status="duplicate_pending")
    assert (form.session_cm_id, form.duplicate_of) == (FAMILY_CAMP_6, added.request.id)


@pytest.mark.asyncio
async def test_adding_refuses_a_household_the_camper_is_not_in() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    with pytest.raises(CaseworkValidationError, match="household"):
        await FinancialAidCaseworkService(store).add_request(YEAR, 1000099, EMMA, WINTER, 600.0, "Typo", ACTOR)


@pytest.mark.asyncio
async def test_adding_for_another_household_that_filed_for_the_camper_is_allowed() -> None:
    # A second parent's household filed the form for the camper: its application lists her.
    store = make_store(
        fa_row(EMMA, 1000009, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await build(store)
    out = await FinancialAidCaseworkService(store).add_request(YEAR, 1000009, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    assert out.request.household_cm_id == 1000009


# -- casework: retire_addition -----------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retiring_an_addition_withdraws_its_request_at_once_and_keeps_it() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await build(store)
    casework = FinancialAidCaseworkService(store)
    added = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    store.change_log.clear()

    out = await casework.retire_addition(YEAR, added.addition.id, "Entered in error", ACTOR)

    assert out.addition.retired_at
    assert (out.addition.retired_by, out.addition.retire_reason) == (ACTOR, "Entered in error")
    assert out.request.status == "withdrawn"
    assert [(row["entity"], row["action"]) for row in store.change_log] == [
        ("aid_request_additions", "remove_added_request"),
        ("aid_requests", "status"),
    ]
    # Never deleted: the request, its payer share and anything decided on it stay attached.
    assert added.request.id in store.requests
    assert [s for s in store.payer_shares.values() if s.request_id == added.request.id]
    assert not any(method.startswith("DELETE") for method, _ in store.writes)
    writes = len(store.writes)
    await build(store)
    assert len(store.writes) == writes
    assert store.requests[added.request.id].status == "withdrawn"


@pytest.mark.asyncio
async def test_retiring_an_already_retired_addition_is_a_clean_error() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    casework = FinancialAidCaseworkService(store)
    added = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    await casework.retire_addition(YEAR, added.addition.id, "Entered in error", ACTOR)
    operations = len(store.operations)
    with pytest.raises(CaseworkValidationError, match="already"):
        await casework.retire_addition(YEAR, added.addition.id, "Again", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.retire_addition(YEAR, "add000000000000", "Missing", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.retire_addition(YEAR + 1, added.addition.id, "Wrong season", ACTOR)
    assert len(store.operations) == operations


@pytest.mark.asyncio
async def test_retiring_an_addition_whose_round_is_posted_is_refused_and_writes_nothing() -> None:
    # Aid CampMinder shows as posted always keeps a request that counts (owner): Retire would leave it on a
    # withdrawn one. The same rule as keeping the other request of a duplicate pair: undo Posted first.
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    casework = FinancialAidCaseworkService(store)
    added = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    store.decision_events.append(
        DecisionEvent(
            id="evt000000000000",
            request_id=added.request.id,
            round=1,
            kind="post",
            created=datetime(2027, 3, 9, tzinfo=UTC),
        )
    )
    operations = len(store.operations)
    with pytest.raises(CaseworkValidationError, match="Round 1 is posted"):
        await casework.retire_addition(YEAR, added.addition.id, "Entered in error", ACTOR)
    assert len(store.operations) == operations
    assert store.additions[added.addition.id].live
    assert store.requests[added.request.id].status == "active"
    # Undone, it retires as usual.
    store.decision_events.append(
        replace(
            store.decision_events[0], id="evt000000000001", kind="unpost", created=datetime(2027, 3, 10, tzinfo=UTC)
        )
    )
    out = await casework.retire_addition(YEAR, added.addition.id, "Entered in error", ACTOR)
    assert out.request.status == "withdrawn"


@pytest.mark.asyncio
async def test_a_retired_slot_can_be_added_again_and_revives_the_same_request() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    casework = FinancialAidCaseworkService(store)
    first = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    await casework.retire_addition(YEAR, first.addition.id, "Wrong ask", ACTOR)
    again = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 650.0, "Right ask", ACTOR)
    assert again.request.id == first.request.id
    assert (again.request.status, again.request.ask.synced) == ("active", "650.00")
    assert len(store.additions) == 2
    assert len([s for s in store.payer_shares.values() if s.request_id == first.request.id]) == 1
    writes = len(store.writes)
    await build(store)
    assert len(store.writes) == writes


# -- casework: bulk ---------------------------------------------------------------------------------------------------


def _bulk_store() -> FakeAidStore:
    return make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=[
            *enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
            *enrolled(LIAM, LIAM_HOUSEHOLD, WINTER, BMITZVAH_1),
        ],
    )


@pytest.mark.asyncio
async def test_a_bulk_dry_run_reports_every_item_and_writes_nothing() -> None:
    store = _bulk_store()
    items = [
        AdditionItem(EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat"),
        AdditionItem(LIAM_HOUSEHOLD, LIAM, BMITZVAH_1, 800.0, "B*Mitzvah"),
    ]
    result = await FinancialAidCaseworkService(store).add_requests(YEAR, items, "2026 sitting", ACTOR, dry_run=True)
    assert (result.dry_run, result.written, result.operation_id) == (True, False, None)
    assert [(i.ok, i.program_key, i.error) for i in result.items] == [(True, "summer", ""), (True, "bmitzvah", "")]
    assert (store.operations, store.additions, store.requests) == ([], {}, {})


@pytest.mark.asyncio
async def test_a_bulk_add_is_all_or_nothing() -> None:
    store = _bulk_store()
    items = [
        AdditionItem(EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat"),
        AdditionItem(LIAM_HOUSEHOLD, LIAM, BMITZVAH_1, 0.0, "No ask yet"),  # refused: ask 0
        AdditionItem(LIAM_HOUSEHOLD, LIAM, WINTER, 300.0, ""),  # the operation's reason stands in
    ]
    result = await FinancialAidCaseworkService(store).add_requests(YEAR, items, "2026 sitting", ACTOR, dry_run=False)
    assert (result.written, result.operation_id) == (False, None)
    assert [i.ok for i in result.items] == [True, False, True]
    assert "ask" in result.items[1].error
    assert (store.operations, store.additions, store.requests) == ([], {}, {})


@pytest.mark.asyncio
async def test_a_bulk_add_refuses_two_items_for_one_slot() -> None:
    store = _bulk_store()
    items = [
        AdditionItem(EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat"),
        AdditionItem(EMMA_HOUSEHOLD, EMMA, WINTER, 650.0, "Retreat again"),
    ]
    result = await FinancialAidCaseworkService(store).add_requests(YEAR, items, "2026 sitting", ACTOR, dry_run=True)
    assert [i.ok for i in result.items] == [True, False]
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_bulk_add_writes_every_item_as_one_operation() -> None:
    store = _bulk_store()
    await build(store)
    store.operations.clear()
    items = [
        AdditionItem(EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat"),
        AdditionItem(LIAM_HOUSEHOLD, LIAM, BMITZVAH_1, 800.0, "B*Mitzvah"),
        AdditionItem(LIAM_HOUSEHOLD, LIAM, WINTER, 300.0, ""),
    ]
    result = await FinancialAidCaseworkService(store).add_requests(YEAR, items, "2026 sitting", ACTOR, dry_run=False)
    assert result.written
    assert result.operation_id
    assert len(store.operations) == 1
    assert all(i.ok and i.request_id and i.addition_id for i in result.items)
    assert len([a for a in store.applications.values() if a.household_cm_id == LIAM_HOUSEHOLD]) == 1
    assert sorted(a.reason for a in store.additions.values()) == ["2026 sitting", "B*Mitzvah", "Retreat"]
    writes = len(store.writes)
    await build(store)
    assert len(store.writes) == writes


# -- RequestOut.origin and the intake report ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_request_names_its_origin() -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await build(store)
    await FinancialAidCaseworkService(store).add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    form = next(r for r in store.requests.values() if r.program_option_key == "session 2")
    added = added_request(store)
    assert request_out(form, []).origin == "form"
    assert request_out(added, []).origin == "added"
    from_registration = replace(added, program_option_key=f"registration_ask:{WINTER}")
    assert request_out(from_registration, []).origin == "registration_ask"


@pytest.mark.asyncio
async def test_the_intake_log_line_carries_the_counts_of_rows_that_made_no_request(
    caplog: pytest.LogCaptureFixture,
) -> None:
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        fa_row(1000091, 0, summer="Session 2", summer_ask=500.0),  # no household
        fa_row(LIAM, LIAM_HOUSEHOLD, interest=True, registration_ask=500.0),  # registration only
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2),
    )
    with caplog.at_level(logging.INFO, logger="api.services.financial_aid_intake_service"):
        await build(store)
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Financial-aid intake built")]
    assert "rows_without_request=1" in line
    assert "rows_without_household=1" in line

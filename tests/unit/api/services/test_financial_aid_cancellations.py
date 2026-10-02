"""A request's cancellation (campership sub-project 10b; spec §5.6, §6.2, §6.3; D54, D101, D141).
Fictional throughout: household 1000001, camper 1000011, parent 1000019; summer sessions 1000101 and
1000104, Quest 1000106, a Family Camp weekend 1000201."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from api.services.financial_aid_cancellations import (
    CANCEL_REASON_LABELS,
    CANCEL_REASONS,
    CancelEvent,
    Cancellation,
    CancelState,
    EnrollmentState,
    cancellations_by_request,
    enrollment_cancelled,
    first_cancelled_on,
    fold_cancellations,
    needs_reason,
    parse_reason,
)
from api.services.financial_aid_grants_register import registrations_cancelled
from api.services.financial_aid_intake_types import RequestRecord, SessionRow

SESSIONS = (
    SessionRow(1000101, "Session 2", "main"),
    SessionRow(1000104, "Taste of Camp 1", "main"),
    SessionRow(1000106, "Quest", "quest"),
    SessionRow(1000201, "Family Weekend 1", "family"),
)
TYPES = {s.cm_id: s.session_type for s in SESSIONS}
MAR9 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)
APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
MAY2 = date(2027, 5, 2)
MAY3 = datetime(2027, 5, 3, 18, 0, tzinfo=UTC)


def request(
    rid: str = "emma",
    *,
    person: int = 1000011,
    session: int = 1000101,
    program: str = "summer",
    status: str = "active",
    resolution: str = "",
) -> RequestRecord:
    return RequestRecord(
        id=rid,
        year=2027,
        application_id="app000001000001",
        household_cm_id=1000001,
        person_cm_id=person,
        session_cm_id=session,
        program_key=program,
        program_option_text="",
        program_option_key="",
        session_resolution=resolution or ("enrollment" if session else "unmatched"),
        ask=2000.0,
        headcount_non_infant=0,
        headcount_infant=0,
        headcount_source="",
        status=status,
        duplicate_of="",
    )


def row(status: int, *, person: int = 1000011, session: int = 1000101, on: date | None = MAY2) -> EnrollmentState:
    return EnrollmentState(person, 1000001, session, status, on)


def test_a_cancelled_registration_in_the_requests_session_cancels_it_on_that_day() -> None:
    assert enrollment_cancelled(request(), [row(32)], TYPES) == (True, MAY2)
    assert enrollment_cancelled(request(), [row(256, on=None)], TYPES) == (True, None)


def test_an_enrolled_registration_in_that_session_means_not_cancelled() -> None:
    assert enrollment_cancelled(request(), [row(32), row(2)], TYPES) == (False, None)
    assert enrollment_cancelled(request(), [], TYPES) == (False, None)


def test_an_unmatched_request_is_cancelled_by_its_programs_registrations() -> None:
    """Intake turns a cancelled camper's request unmatched (session 0) on its next run."""
    lost = request(session=0, status="unmatched_session")
    assert enrollment_cancelled(lost, [row(32, session=1000104)], TYPES) == (True, MAY2)
    assert enrollment_cancelled(lost, [row(32, session=1000201)], TYPES) == (False, None)  # another program


def test_a_camper_who_switched_sessions_is_not_cancelled() -> None:
    lost = request(session=0, status="unmatched_session")
    assert enrollment_cancelled(lost, [row(32, session=1000104), row(2, session=1000101)], TYPES) == (False, None)
    assert enrollment_cancelled(lost, [row(32, session=1000104), row(2, session=1000106)], TYPES) == (False, None)


def test_a_staff_set_session_is_not_cancelled_when_the_camper_enrolled_elsewhere_in_the_program() -> None:
    """Intake keeps a staff-set session on every run, so without the program rule a camper who switched
    would read cancelled for good. Not so for a resolved one: intake moves it the next night."""
    staff = request(resolution="staff")
    switched = [row(32), row(2, session=1000104)]
    assert enrollment_cancelled(staff, switched, TYPES) == (False, None)
    assert enrollment_cancelled(staff, [row(32)], TYPES) == (True, MAY2)
    assert enrollment_cancelled(staff, [row(32), row(2, session=1000201)], TYPES) == (True, MAY2)  # another program
    assert enrollment_cancelled(request(), switched, TYPES) == (True, MAY2)  # until intake re-resolves it


def test_a_staff_set_session_is_cancelled_by_a_cancellation_anywhere_in_the_program() -> None:
    """Final review (ruled): program-wide both ways. Staff set Session 2; the camper's only registration,
    in Taste of Camp 1, was cancelled; nothing is enrolled anywhere: the request is cancelled."""
    staff = request(resolution="staff")
    assert enrollment_cancelled(staff, [row(32, session=1000104)], TYPES) == (True, MAY2)
    assert enrollment_cancelled(staff, [row(32, session=1000201)], TYPES) == (False, None)  # another program


def test_the_cancellation_day_is_the_latest_cancelled_rows() -> None:
    lost = request(session=0, status="unmatched_session")
    rows = [row(32, session=1000104, on=date(2027, 4, 20)), row(256, session=1000101)]
    assert enrollment_cancelled(lost, rows, TYPES) == (True, MAY2)
    assert enrollment_cancelled(lost, list(reversed(rows)), TYPES) == (True, MAY2)


def test_a_waitlisted_or_applied_row_keeps_nothing_on_and_an_enrolled_row_does() -> None:
    """Owner ruling 2026-09-30 (owner + data): only an enrolled (2) row keeps a registration on."""
    lost = request(session=0, status="unmatched_session")
    rows = [row(32, session=1000104), row(8, session=1000101), row(4, session=1000106)]
    assert enrollment_cancelled(lost, rows, TYPES) == (True, MAY2)
    assert enrollment_cancelled(lost, [*rows, row(2, session=1000101)], TYPES) == (False, None)


def test_the_rule_is_the_grants_registers_own() -> None:
    """One definition of "CampMinder cancelled it", shared with the grants register (plan review): a
    cancelled or withdrawn registration and no enrolled one, whatever else is in scope."""
    assert (registrations_cancelled([32]), registrations_cancelled([256, 8, 4])) == (True, True)
    assert (registrations_cancelled([32, 2]), registrations_cancelled([8]), registrations_cancelled([])) == (
        False,
        False,
        False,
    )


def test_a_family_camp_request_is_cancelled_when_every_household_member_is() -> None:
    weekend = request("fam", person=0, session=1000201, program="family_camp")
    parent, child = row(32, person=1000019, session=1000201), row(32, person=1000011, session=1000201)
    assert enrollment_cancelled(weekend, [parent, child], TYPES) == (True, MAY2)
    assert enrollment_cancelled(weekend, [parent, row(2, person=1000011, session=1000201)], TYPES) == (False, None)


def test_another_households_cancelled_row_does_not_cancel_a_family_camp_request() -> None:
    weekend = request("fam", person=0, session=1000201, program="family_camp")
    neighbour = EnrollmentState(1000021, 1000002, 1000201, 32, MAY2)
    assert cancellations_by_request([weekend], [], [neighbour], SESSIONS) == {}
    assert enrollment_cancelled(weekend, [neighbour], TYPES) == (False, None)


def test_the_latest_event_wins_and_a_reopen_clears_the_reason() -> None:
    events = [
        CancelEvent("c1", "emma", "cancel", MAR9, reason="not_known", in_kindred=True),
        CancelEvent("c2", "emma", "cancel", APR1, reason="schedule", in_kindred=True, note="Emailed"),
        CancelEvent("c3", "liam", "cancel", MAR9, reason="not_known", in_kindred=True),
        CancelEvent("c4", "liam", "reopen", APR1, note="Found the money"),
    ]
    states = fold_cancellations(events)
    assert states["emma"] == CancelState(in_kindred=True, reason="schedule", note="Emailed", at=APR1)
    assert states["liam"] == CancelState()
    assert fold_cancellations(events, as_of=MAR9)["emma"].reason == "not_known"


def test_cancellations_come_from_campminder_or_kindred_and_only_live_requests_take_one() -> None:
    requests = [
        request("emma"),
        request("liam", person=1000012),
        request("riley", person=1000013),
        request("gone", person=1000011, status="withdrawn"),
    ]
    events = [
        CancelEvent("c1", "liam", "cancel", MAR9, reason="aid_not_enough", in_kindred=True),
        CancelEvent("c2", "gone", "cancel", MAR9, reason="not_known", in_kindred=True),
    ]
    out = cancellations_by_request(requests, events, [row(32)], SESSIONS)
    assert out == {
        "emma": Cancellation("campminder", MAY2, None, ""),
        "liam": Cancellation("kindred", date(2027, 3, 9), "aid_not_enough", ""),
    }


def test_a_reason_given_for_a_campminder_cancellation_travels_with_it() -> None:
    events = [CancelEvent("c1", "emma", "cancel", MAY3, reason="another_reason", note="Moved away")]
    out = cancellations_by_request([request()], events, [row(32)], SESSIONS)
    assert out["emma"] == Cancellation("campminder", MAY2, "another_reason", "Moved away")


def test_a_campminder_cancellations_reason_stands_when_campminder_re_dates_it() -> None:
    """Owner 2026-10-01: families cancel once and never un-cancel, so a recorded reason always answers the
    request's cancellation, even when CampMinder later moves the cancellation's date past it."""
    events = [CancelEvent("c1", "emma", "cancel", APR1, reason="schedule", note="Summer job")]
    out = cancellations_by_request([request()], events, [row(32)], SESSIONS)
    assert out["emma"] == Cancellation("campminder", MAY2, "schedule", "Summer job")
    assert needs_reason(out["emma"], 2027) is False


def test_a_kindred_cancellations_reason_stands_when_campminder_cancels_after_it() -> None:
    """The family declined in Kindred first; CampMinder's later cancellation is the same one, not a new one."""
    events = [CancelEvent("c1", "emma", "cancel", MAR9, reason="aid_not_enough", in_kindred=True)]
    out = cancellations_by_request([request()], events, [row(32)], SESSIONS)
    assert out["emma"] == Cancellation("campminder", MAY2, "aid_not_enough", "")


def test_d141s_nine_reasons_each_have_a_staff_label() -> None:
    assert CANCEL_REASONS == (
        "aid_not_enough",
        "medical",
        "schedule",
        "not_ready",
        "did_not_want_to_appeal",
        "not_financially_related",
        "early_cancel",
        "another_reason",
        "not_known",
    )
    assert set(CANCEL_REASON_LABELS) == set(CANCEL_REASONS)
    assert CANCEL_REASON_LABELS["aid_not_enough"] == "declined: aid not enough / financial constraints"
    assert CANCEL_REASON_LABELS["did_not_want_to_appeal"] == "did not want to appeal"


def test_a_reason_outside_d141s_list_is_refused() -> None:
    assert [parse_reason(r) for r in CANCEL_REASONS] == list(CANCEL_REASONS)
    assert parse_reason("") is None
    with pytest.raises(ValueError, match="cancel reason"):
        parse_reason("moved")


def test_the_to_do_asks_from_2027_and_only_while_no_reason_is_given() -> None:
    """Clean spec §5.6: cancel reasons exist from 2027; an earlier season's cancellation asks for none."""
    missing = Cancellation("campminder", MAY2, None, "")
    assert (needs_reason(missing, 2027), needs_reason(missing, 2026)) == (True, False)
    assert needs_reason(Cancellation("kindred", MAY2, "medical", ""), 2027) is False
    assert needs_reason(None, 2027) is False


def test_a_past_read_dates_a_cancellation_by_its_earliest_cancelled_registration() -> None:
    """3c-2 final review: a past date masks a request live then whose registration CampMinder had cancelled
    by that day, so the earliest cancelled row dates it (live on that day already saw it). An undated
    cancelled row dates it unknown."""
    may20 = date(2027, 5, 20)
    assert first_cancelled_on(request(), [row(32), row(256, on=may20)], TYPES) == (True, MAY2)
    assert first_cancelled_on(request(), [row(32, on=may20), row(256, on=None)], TYPES) == (True, None)
    assert first_cancelled_on(request(), [row(32), row(2)], TYPES) == (False, None)
    staff = request(session=1000104, resolution="staff")
    assert first_cancelled_on(staff, [row(32, session=1000101)], TYPES) == enrollment_cancelled(
        staff, [row(32, session=1000101)], TYPES
    )

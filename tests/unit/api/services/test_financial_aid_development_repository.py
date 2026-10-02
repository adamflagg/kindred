"""DevelopmentRepository's parsers (Reports back end, Part B): PocketBase records (expanded attendees, persons,
sources) to plain types. Fictional records only."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from api.services.financial_aid_development_repository import attendance_record, person_record, source_record


def test_an_attendee_reads_its_expanded_session_and_household() -> None:
    record = SimpleNamespace(
        person_id=1000011,
        status_id=2,
        enrollment_date="2026-11-20 08:00:00.000Z",
        year=2027,
        expand={
            "person": SimpleNamespace(household_id=1000001),
            "session": SimpleNamespace(cm_id=1000101, session_type="main", start_date="2027-06-20 00:00:00.000Z"),
        },
    )
    out = attendance_record(record)
    assert (out.person_cm_id, out.household_cm_id, out.session_cm_id, out.session_type) == (
        1000011,
        1000001,
        1000101,
        "main",
    )
    assert (out.start, out.status_id, out.changed_on, out.year) == (date(2027, 6, 20), 2, None, 2027)


def test_a_cancelled_attendee_keeps_its_cancellation_day() -> None:
    """The cancellations module's rule: a cancelled row's enrollment_date is CampMinder's PostDate."""
    record = SimpleNamespace(
        person_id=1000011, status_id=32, enrollment_date="2027-05-02 19:00:00.000Z", year=2027, expand={}
    )
    out = attendance_record(record)
    assert (out.status_id, out.changed_on, out.household_cm_id, out.session_cm_id) == (32, date(2027, 5, 2), 0, 0)


def test_a_person_without_a_birthdate_or_gender_reads_blank() -> None:
    out = person_record(SimpleNamespace(cm_id=1000011, household_id=1000001, birthdate="", gender_identity_name=""))
    assert (out.birthdate, out.gender_identity_name, out.gender_identity_write_in) == (None, "", "")


def test_a_source_without_the_incentive_field_reads_need_based() -> None:
    """Before Part C adds the field (D88), every source reads incentive false: need-based, the default."""
    out = source_record(
        SimpleNamespace(
            id="src000000000001",
            description_key="regional grant",
            source_name="",
            description="Regional Grant",
            funder_type="outside",
            implied_program_families=["summer"],
        )
    )
    assert (out.source_name, out.incentive, out.implied_program_families) == ("Regional Grant", False, ("summer",))

"""DevelopmentRepository's parsers (Reports back end, Part B): PocketBase records (expanded attendees, persons,
sources) to plain types. Fictional records only."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from api.services.financial_aid_development_repository import (
    DevelopmentRepository,
    attendance_record,
    person_record,
    source_record,
)


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


def test_a_person_record_reads_the_gender_write_in_field() -> None:
    """D94: a write-in is the camper's own words; the record must carry the `gender_identity_write_in` field."""
    record = SimpleNamespace(
        cm_id=1000021,
        household_id=1000002,
        birthdate="2012-01-01",
        gender_identity_name="",
        gender_identity_write_in="their own words",
    )
    out = person_record(record)
    assert (out.gender_identity_name, out.gender_identity_write_in) == ("", "their own words")
    assert (out.person_cm_id, out.household_cm_id, out.birthdate) == (1000021, 1000002, date(2012, 1, 1))


def test_an_attendee_reads_the_day_it_registered() -> None:
    """A dated column leaves out campers who registered after its day (attendees.effective_date)."""
    record = SimpleNamespace(
        person_id=1000011,
        status_id=2,
        enrollment_date="",
        effective_date="2026-11-20 08:00:00.000Z",
        year=2027,
        expand={},
    )
    assert attendance_record(record).registered_on == date(2026, 11, 20)
    assert attendance_record(SimpleNamespace(person_id=1, status_id=2, year=2027, expand={})).registered_on is None


class _Postings:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def collection(self, name: str) -> _Postings:
        return self

    def get_full_list(self, batch: int, query_params: dict[str, object]) -> list[SimpleNamespace]:
        return self.rows


def _posting(txn: int, funder_type: str, amount: float, **kw: object) -> SimpleNamespace:
    base: dict[str, object] = {
        "transaction_cm_id": txn,
        "household_cm_id": 1000002,
        "person_cm_id": 0,
        "attributed_person_cm_id": 1000021,
        "attribution_level": "person",
        "source_key": "valley youth summer",
        "effective_source_key": "",
        "program_family": "summer",
        "funder_type": funder_type,
        "amount": amount,
        "is_reversed": False,
    }
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_outside_credits_are_the_live_outside_and_incentive_credits_by_their_effective_source() -> None:
    """#55: a credit is negative in CampMinder's sign; the camp's own lines and an unclassified one aren't outside."""
    pb = _Postings(
        [
            _posting(1, "outside", -300.0),
            _posting(2, "incentive", -100.0, effective_source_key="incentive fund"),
            _posting(3, "outside", 300.0),  # a charge, not a credit
            _posting(4, "camp", -900.0),
            _posting(5, "unknown", -50.0),
        ]
    )
    credits = await DevelopmentRepository(pb).outside_credits(2025)
    assert [(c.source_key, c.attributed_person_cm_id, c.attribution_level) for c in credits] == [
        ("valley youth summer", 1000021, "person"),
        ("incentive fund", 1000021, "person"),
    ]

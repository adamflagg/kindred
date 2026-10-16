"""DevelopmentRepository's parsers (Reports back end, Part B): PocketBase records (expanded attendees, persons,
sources) to plain types. Fictional records only."""

from __future__ import annotations

import operator
import re
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from api.services.financial_aid_development_repository import (
    DevelopmentRepository,
    attendance_record,
    person_record,
    source_record,
)
from api.services.financial_aid_ledger_service import aid_dollars


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


class _PostingsPage:
    """aid_postings answering a one-row page: `rows` is what the filter found."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows
        self.asked: list[tuple[str, int, int, dict[str, object]]] = []

    def collection(self, name: str) -> _PostingsPage:
        self.name = name
        return self

    def get_list(self, page: int, per_page: int, query_params: dict[str, object]) -> SimpleNamespace:
        self.asked.append((self.name, page, per_page, dict(query_params)))
        return SimpleNamespace(items=self.rows[:per_page])


@pytest.mark.asyncio
@pytest.mark.parametrize(("rows", "found"), [([SimpleNamespace(id="apo000000000001")], True), ([], False)])
async def test_a_season_has_live_grant_lines_when_one_page_row_answers(
    rows: list[SimpleNamespace], found: bool
) -> None:
    """The cheap "is there anything to rebuild?" read before a season's register: ONE row of aid_postings, filtered
    to what the register would count as an outside grant (D158: live, a credit, outside or incentive), no count."""
    pb = _PostingsPage(rows)
    assert await DevelopmentRepository(pb).has_live_grant_lines(2024) is found
    [(collection, page, per_page, query)] = pb.asked
    assert (collection, page, per_page) == ("aid_postings", 1, 1)
    assert query["filter"] == (
        "year = 2024 && (funder_type = 'outside' || funder_type = 'incentive') && is_reversed = false && amount < 0"
    )
    assert query["skipTotal"] is True


class _SignedPostings(_PostingsPage):
    """aid_postings in CampMinder's sign, applying the filter's `amount` comparison to each row, as PocketBase does."""

    def get_list(self, page: int, per_page: int, query_params: dict[str, object]) -> SimpleNamespace:
        self.asked.append((self.name, page, per_page, dict(query_params)))
        match = re.search(r"amount\s*(<=|>=|<|>)\s*(-?\d+)", str(query_params["filter"]))
        assert match is not None, query_params["filter"]
        compare = {"<": operator.lt, ">": operator.gt, "<=": operator.le, ">=": operator.ge}[match[1]]
        found = [r for r in self.rows if compare(Decimal(str(r.amount)), Decimal(match[2]))]
        return SimpleNamespace(items=found[:per_page])


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [-250.0, 250.0])
async def test_the_grant_line_probe_finds_exactly_the_lines_the_register_counts(amount: float) -> None:
    """aid_postings keeps CampMinder's sign (a grant credit is negative) and the register flips it (aid_dollars), then
    counts `amount > 0`. The probe reads the raw column, so it must ask for `amount < 0`: asking `> 0` finds no real
    grant line, and a season with grants but no camp line would lose its rebuilt ages."""
    posting = SimpleNamespace(id="apo000000000002", amount=amount)
    counted_by_register = aid_dollars(posting.amount) > 0
    assert await DevelopmentRepository(_SignedPostings([posting])).has_live_grant_lines(2024) is counted_by_register

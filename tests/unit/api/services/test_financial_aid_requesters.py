"""Requested by: the aid form's contact name, resolved own row, then household-unique, else None. Fictional only."""

from __future__ import annotations

from dataclasses import replace

import pytest

from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_requesters import FaContact, contact_name, requester_names
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR

HOME = 1000001
EMMA, LIAM, SIBLING = "reqemma00000001", "reqliam00000001", "reqriley0000001"
EMMA_CM, LIAM_CM, RILEY_CM = 1000011, 1000012, 1000013


def _requests(*specs: tuple[str, int, int]) -> list:
    store = FakeDecisionsStore()
    return [seed_request(store, rid, household=household, person=person) for rid, household, person in specs]


def _c(person: int, first: str, last: str, household: int = HOME) -> FaContact:
    return FaContact(person, household, first, last)


def test_the_campers_own_row_wins_even_when_the_household_has_other_names() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(LIAM_CM, "David", "Chen"), _c(EMMA_CM, "Maria", "Garcia")]
    assert requester_names(contacts, reqs) == {EMMA: "Maria Garcia"}


def test_a_household_with_one_name_names_a_camper_with_no_row_of_their_own() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(LIAM_CM, "David", "Chen"), _c(RILEY_CM, "David", "Chen")]
    assert requester_names(contacts, reqs) == {EMMA: "David Chen"}


def test_an_ambiguous_household_names_nobody() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(LIAM_CM, "David", "Chen"), _c(RILEY_CM, "Maria", "Garcia")]
    assert requester_names(contacts, reqs) == {EMMA: None}


def test_blank_contacts_name_nobody() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(EMMA_CM, "", ""), _c(LIAM_CM, "  ", " ")]
    assert requester_names(contacts, reqs) == {EMMA: None}


def test_a_blank_own_row_falls_back_to_the_households_one_name() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(EMMA_CM, "", ""), _c(LIAM_CM, "David", "Chen")]
    assert requester_names(contacts, reqs) == {EMMA: "David Chen"}


def test_a_request_with_no_form_rows_at_all_names_nobody() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    assert requester_names([], reqs) == {EMMA: None}


def test_a_contact_in_another_household_does_not_name_this_one() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    assert requester_names([_c(LIAM_CM, "David", "Chen", household=HOME + 1)], reqs) == {EMMA: None}


@pytest.mark.parametrize(
    ("first", "last", "expected"),
    [("Maria", "", "Maria"), ("", "Garcia", "Garcia"), (" Maria ", " Garcia ", "Maria Garcia"), ("", " ", None)],
)
def test_a_name_is_trimmed_and_a_blank_part_is_dropped(first: str, last: str, expected: str | None) -> None:
    assert contact_name(first, last) == expected


def test_a_one_part_name_is_returned_as_is() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    assert requester_names([_c(EMMA_CM, "Maria", "")], reqs) == {EMMA: "Maria"}


def test_distinctness_ignores_case_and_returns_the_first_stored_casing() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(LIAM_CM, " maria  ", "GARCIA"), _c(RILEY_CM, "Maria", "Garcia")]
    assert requester_names(contacts, reqs) == {EMMA: "maria GARCIA"}


def test_a_campers_own_rows_that_disagree_name_nobody_rather_than_fall_back() -> None:
    reqs = _requests((EMMA, HOME, EMMA_CM))
    contacts = [_c(EMMA_CM, "Maria", "Garcia"), _c(EMMA_CM, "David", "Chen"), _c(LIAM_CM, "Maria", "Garcia")]
    assert requester_names(contacts, reqs) == {EMMA: None}


def test_a_household_level_request_with_no_camper_uses_the_household() -> None:
    reqs = [replace(r, person_cm_id=0) for r in _requests((EMMA, HOME, EMMA_CM))]
    contacts = [_c(0, "Ignored", "Person"), _c(LIAM_CM, "David", "Chen")]
    # person 0 is never a camper match: a zero id is "no person", so only the household chain applies.
    assert requester_names(contacts, reqs) == {EMMA: None}  # two names in the household


def _service(store: FakeDecisionsStore) -> FinancialAidDecisionsService:
    async def register(year: int) -> list:
        return []

    return FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0)


@pytest.mark.asyncio
async def test_the_grid_rows_carry_requested_by_from_one_contact_read() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=HOME, person=EMMA_CM)
    seed_request(store, LIAM, household=HOME + 1, person=LIAM_CM)
    store.fa_contacts = [_c(EMMA_CM, "Maria", "Garcia"), _c(LIAM_CM, "", "", household=HOME + 1)]
    rows = {r.request_id: r for r in (await _service(store).grid(YEAR)).rows}
    assert rows[EMMA].requested_by == "Maria Garcia"
    assert rows[LIAM].requested_by is None
    assert store.fa_contact_reads == 1


@pytest.mark.asyncio
async def test_a_past_date_grid_carries_requested_by_too() -> None:
    from datetime import date

    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=HOME, person=EMMA_CM)
    store.fa_contacts = [_c(EMMA_CM, "Maria", "Garcia")]
    (row,) = (await _service(store).grid(YEAR, as_of=date(2027, 12, 31))).rows
    assert row.requested_by == "Maria Garcia"

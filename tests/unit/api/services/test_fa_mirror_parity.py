"""Pins what the four FA-mirror (financial_aid_applications) readers return TODAY, over the parity fixture's mirror
rows (aid_parity_fixture.parity_pb, f1-f9), whose PocketBase double evaluates the filters these reads send. A
whole-year cache of the mirror must answer these exactly the same, so these tests are the proof that no number on a
screen moves.

Every expected value is written by hand from the fixture. If one fails, the fixture or the expectation is wrong
-- never edit a repository to make it pass."""

from __future__ import annotations

import pytest

from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_household import HOUSEHOLD_ANSWER_FIELDS
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_intake_types import FaRow
from api.services.financial_aid_jump_index import JumpIndexRepository
from api.services.financial_aid_repository import FaRequestRow, FinancialAidRepository
from api.services.financial_aid_requesters import FaContact
from tests.unit.api.services.aid_parity_fixture import (
    H1,
    H2,
    H3,
    H4,
    H5,
    H6,
    P1,
    P2,
    P3,
    P4,
    P5,
    P11,
    P12,
    P13,
    PARITY_YEAR,
    PRIOR_YEAR,
    parity_pb,
)

_NO_ANSWERS = dict.fromkeys(HOUSEHOLD_ANSWER_FIELDS)
# Households per per-household FA read when these tests were written (financial_aid_repository.HOUSEHOLD_CHUNK):
# a request wider than this made that read chunk. Held here so the test outlives the constant.
HOUSEHOLD_CHUNK = 8


def _fa_row(person: int, household: int, **kw: object) -> FaRow:
    fields: dict[object, object] = {
        "answers": _NO_ANSWERS,
        "summer_program": "",
        "summer_amount_requested": 0.0,
        "fc_program": "",
        "fc_amount_requested": 0.0,
        "tbm_program": "",
        "tbm_amount_requested": 0.0,
        "interest_expressed": False,
        "registration_ask": 0.0,
        "reported_income_fields": frozenset(),
    }
    fields.update(kw)
    return FaRow(person_cm_id=person, household_cm_id=household, **fields)  # type: ignore[arg-type]


def test_the_fixture_evaluates_the_mirror_operators_and_refuses_them_elsewhere() -> None:
    pb = parity_pb()
    asked = pb.collection("financial_aid_applications").get_full_list(
        query_params={"filter": f"year = {PARITY_YEAR} && fc_amount_requested > 0", "sort": "id"}
    )
    assert [int(r.person_id) for r in asked] == [P2]
    # SQLite's LIKE folds ASCII only: "yeſ" (LONG S) is not "yes", though casefold() would make it so.
    yes = pb.collection("financial_aid_applications").get_full_list(
        query_params={"filter": f"year = {PARITY_YEAR} && one_happy_camper ~ 'yes'", "sort": "id"}
    )
    assert [int(r.person_id) for r in yes] == [P1, P2, P5]
    with pytest.raises(NotImplementedError):  # `>` stays refused on the sync tables
        pb.collection("persons").get_full_list(query_params={"filter": "year > 2025"})


# --- the intake rows (applicants only) ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fa_rows_are_the_seasons_applicants_in_id_order() -> None:
    rows = await FinancialAidIntakeRepository(parity_pb()).fetch_fa_rows(PARITY_YEAR)
    # f4 and f6 are not applicants; f9 is 2025's.
    assert [(r.person_cm_id, r.household_cm_id) for r in rows] == [
        (P4, H6),  # f1
        (P1, H1),  # f2
        (P2, H2),  # f3
        (P5, 0),  # f5: no household
        (P12, H5),  # f7
        (P13, H1),  # f8
    ]


@pytest.mark.asyncio
async def test_fa_rows_carry_every_column_intake_reads() -> None:
    rows = await FinancialAidIntakeRepository(parity_pb()).fetch_fa_rows(PARITY_YEAR)
    by_person = {r.person_cm_id: r for r in rows}
    assert by_person[P1] == _fa_row(
        P1,
        H1,
        answers=_NO_ANSWERS
        | {"total_gross_income": 0, "unemployment": "No", "special_circumstances": "Moved this year"},
        summer_program="Session One",
        summer_amount_requested=1500.0,
        interest_expressed=True,
        registration_ask=700.0,
        reported_income_fields=frozenset({"total_gross_income"}),
    )
    assert by_person[P2] == _fa_row(
        P2, H2, answers=_NO_ANSWERS | {"gov_subsidies": "Yes"}, fc_program="Family Camp 2", fc_amount_requested=800.0
    )
    assert by_person[P4] == _fa_row(P4, H6, tbm_program="B-Mitzvah", tbm_amount_requested=600.0)
    assert by_person[P5] == _fa_row(P5, 0, summer_amount_requested=900.0)
    assert by_person[P12] == _fa_row(P12, H5)
    assert by_person[P13] == _fa_row(P13, H1, summer_amount_requested=700.0, tbm_amount_requested=250.0)


# --- the contact names (every row of the season) ------------------------------------------------------------------

_CONTACTS = [
    FaContact(P4, H6, "Riley", "Sam"),  # f1
    FaContact(P1, H1, "Dana", "Johnson"),  # f2
    FaContact(P2, H2, "Maria", "Garcia"),  # f3
    FaContact(P3, H3, "Wei", "Chen"),  # f4: donation-only rows name a household too
    FaContact(P5, 0, "Samuel", "Johnson"),  # f5: no household
    FaContact(P11, H4, "", ""),  # f6: no contact name
    FaContact(P12, H5, "Ava", "Okafor"),  # f7
    FaContact(P13, H1, "Dana", "Johnson"),  # f8
]


@pytest.mark.asyncio
async def test_fa_contacts_are_every_row_of_the_season_in_id_order() -> None:
    assert await FinancialAidIntakeRepository(parity_pb()).fetch_fa_contacts(PARITY_YEAR) == _CONTACTS


@pytest.mark.asyncio
async def test_the_jump_index_reads_the_same_contacts() -> None:
    assert await JumpIndexRepository(parity_pb()).fetch_fa_contacts(PARITY_YEAR) == _CONTACTS


@pytest.mark.asyncio
async def test_fa_contacts_of_another_season_are_its_own() -> None:
    contacts = await FinancialAidIntakeRepository(parity_pb()).fetch_fa_contacts(PRIOR_YEAR)
    assert contacts == [FaContact(P1, H1, "Old", "Johnson")]  # f9: 2025's H1, which shares the cm_id


# --- the per-program asks -------------------------------------------------------------------------------------------

_REQUESTS = [
    FaRequestRow(H6, 0.0, 0.0, 600.0),  # f1
    FaRequestRow(H1, 1500.0, 0.0, 0.0),  # f2: fc unset reads 0
    FaRequestRow(H2, 0.0, 800.0, 0.0),  # f3: summer and tbm unset
    FaRequestRow(H4, 300.0, 0.0, 0.0),  # f6: not an applicant, but it asks
    FaRequestRow(H1, 700.0, 0.0, 250.0),  # f8
]  # f5 asks but has no household: left out. f4 and f7 ask nothing. f9 is 2025's.


@pytest.mark.asyncio
async def test_fa_requests_for_the_season_are_the_rows_that_ask_in_id_order() -> None:
    assert await FinancialAidRepository(parity_pb()).fetch_fa_requests(PARITY_YEAR) == _REQUESTS


@pytest.mark.asyncio
async def test_fa_requests_for_many_households_are_theirs_across_chunks() -> None:
    """More households than one HOUSEHOLD_CHUNK, so today's read chunks: H6 sorts into the second chunk. Compared as
    a multiset, because the chunked read's order is per chunk; its one consumer (the ledger's household detail,
    FinancialAidLedgerService.household -> _requested) takes the max per program, which no order changes."""
    wanted = [11, 12, 13, H1, H2, H3, H4, H5, H6]
    assert len(wanted) > HOUSEHOLD_CHUNK
    got = await FinancialAidRepository(parity_pb()).fetch_fa_requests(PARITY_YEAR, wanted)
    key = lambda r: (r.household_cm_id, r.summer, r.family_camp, r.bmitzvah)  # noqa: E731
    assert sorted(got, key=key) == sorted(_REQUESTS, key=key)


@pytest.mark.asyncio
async def test_fa_requests_for_one_household_are_its_rows_in_id_order() -> None:
    repo = FinancialAidRepository(parity_pb())
    assert await repo.fetch_fa_requests(PARITY_YEAR, [H1]) == [_REQUESTS[1], _REQUESTS[4]]
    assert await repo.fetch_fa_requests(PARITY_YEAR, [H5]) == []  # f7 asks nothing
    assert await repo.fetch_fa_requests(PARITY_YEAR, [H3]) == []  # f4 asks nothing
    assert await repo.fetch_fa_requests(PARITY_YEAR, [999]) == []
    assert await repo.fetch_fa_requests(PARITY_YEAR, []) == []
    assert await repo.fetch_fa_requests(PARITY_YEAR, [0, -1]) == []


@pytest.mark.asyncio
async def test_fa_requests_of_another_season_are_its_own() -> None:
    repo = FinancialAidRepository(parity_pb())
    assert await repo.fetch_fa_requests(PRIOR_YEAR) == [FaRequestRow(H1, 2000.0, 0.0, 0.0)]
    assert await repo.fetch_fa_requests(PRIOR_YEAR, [H1, H6]) == [FaRequestRow(H1, 2000.0, 0.0, 0.0)]


# --- the grant answers ----------------------------------------------------------------------------------------------


def _answers(rows: list[object]) -> list[tuple[int, str, str, int]]:
    out = []
    for r in rows:
        household = (getattr(r, "expand", None) or {}).get("household")
        out.append(
            (int(r.person_id), r.one_happy_camper, r.synagogue_grant, int(getattr(household, "cm_id", 0) or 0))  # type: ignore[attr-defined]
        )
    return out


@pytest.mark.asyncio
async def test_grant_answers_are_the_rows_whose_answers_contain_yes_in_any_ascii_case() -> None:
    rows = await GrantsRepository(parity_pb()).fetch_grant_answers(PARITY_YEAR)
    assert _answers(rows) == [
        (P1, "yes", "", H1),  # f2
        (P2, "YES", "no", H2),  # f3
        (P3, "", "Yes, please", H3),  # f4: a donation-only row still answers
        (P5, "Yes", "", 0),  # f5: no household
        (P13, "", "YES", H1),  # f8
    ]  # never f1 ("yeſ" / "No"), f6 ("no"), f7 ("maybe"), or 2025's f9


@pytest.mark.asyncio
async def test_grant_answers_of_another_season_are_its_own() -> None:
    rows = await GrantsRepository(parity_pb()).fetch_grant_answers(PRIOR_YEAR)
    assert _answers(rows) == [(P1, "yes", "yes", H1)]

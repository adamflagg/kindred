"""Pins what the person, household, enrollment and equity reads return TODAY, over a fixture that holds every
membership route (see aid_parity_fixture.parity_pb). A whole-year cache must answer these exactly the same, so
these tests are the proof that no number on a screen moves.

Every expected value is written by hand from the fixture. If one fails, the fixture or the expectation is wrong
-- never edit a repository to make it pass."""

from __future__ import annotations

from datetime import date

import pytest

from api.services import financial_aid_intake_repository as intake
from api.services.financial_aid_cancellations import EnrollmentState
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_intake_types import EquityAnswers
from api.services.financial_aid_repository import FinancialAidRepository
from tests.unit.api.services.aid_parity_fixture import (
    ADULT_FIELD_CM,
    ATTENDEE_ID,
    CAMPER_FIELD_CM,
    H1,
    H2,
    H3,
    H4,
    H5,
    H6,
    HH_ID,
    OTHER_FIELD_CM,
    P1,
    P2,
    P3,
    P4,
    P5,
    P6_CM,
    PARITY_YEAR,
    PERSON_ID,
    S1,
    S2,
    FilteringPb,
    parity_pb,
)

ALL_HOUSEHOLDS = [H1, H2, H3, H4, H5, H6]


def _cm_ids(rows: list[object]) -> list[int]:
    return [int(r.cm_id) for r in rows]  # type: ignore[attr-defined]


def test_fixture_refuses_a_filter_shape_it_does_not_know() -> None:
    pb = parity_pb()
    with pytest.raises(NotImplementedError):
        pb.collection("persons").get_full_list(query_params={"filter": "year > 2025"})
    with pytest.raises(NotImplementedError):
        pb.collection("persons").get_full_list(query_params={"filter": "last_name = 'Garcia'"})


def test_fixture_serves_the_whole_year_and_cache_shaped_filters() -> None:
    pb = parity_pb()
    year_rows = pb.collection("persons").get_full_list(query_params={"filter": f"year = {PARITY_YEAR}", "sort": "id"})
    assert [r.id for r in year_rows] == [PERSON_ID[p] for p in (P2, P1, P3, P4, P5)]
    values = pb.collection("person_custom_values").get_full_list(
        query_params={
            "filter": f'year = {PARITY_YEAR} && (field_definition = "fd0000000000g01" || field_definition = "fd0000000000g02")'
        }
    )
    assert sorted(r.id for r in values) == sorted(f"pv00000000000{k}" for k in ("v1", "v2", "v3", "v6"))
    defs = pb.collection("custom_field_defs").get_full_list(query_params={"filter": "cm_id = 165525 || cm_id = 209079"})
    assert len(defs) == 3  # both seasons' camper definition, plus the adult one
    # The expand a person carries is the very household object the households collection returns.
    expanded = pb.collection("persons").get_full_list(
        query_params={"filter": f"year = {PARITY_YEAR}", "expand": "primary_childhood_household"}
    )
    p2 = next(r for r in expanded if r.cm_id == P2)
    assert set(p2.expand) == {"primary_childhood_household"}  # only what the query asked to expand
    assert next(r for r in year_rows if r.cm_id == P2).expand == {}
    # What a person expands to is the stored household the households collection serves (compared by value: a
    # read returns copies).
    stored = next(r for r in pb.tables["households"] if r.id == HH_ID[H1])
    served = pb.collection("households").get_full_list(query_params={"filter": f"cm_id = {H1} && year = {PARITY_YEAR}"})
    assert [vars(r) | {"expand": {}} for r in served] == [vars(stored) | {"expand": {}}]
    assert p2.expand["primary_childhood_household"] is stored


# --- household membership -------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_household_persons_by_household_counts_every_membership_route() -> None:
    repo = FinancialAidRepository(parity_pb())
    found = await repo.fetch_household_persons_by_household(PARITY_YEAR, ALL_HOUSEHOLDS)
    assert {h: sorted(int(p.cm_id) for p in ps) for h, ps in found.items()} == {
        H1: [P1, P2],
        H2: [P2],
        H3: [P3],
        H4: [P3],
        H5: [P4],
        H6: [P4],
    }


@pytest.mark.asyncio
async def test_a_person_in_two_households_appears_under_both_and_never_twice() -> None:
    repo = FinancialAidRepository(parity_pb())
    found = await repo.fetch_household_persons_by_household(PARITY_YEAR, ALL_HOUSEHOLDS)
    # P2: own household H2 plus primary childhood household H1. P4: household_id H5, `household` relation H6.
    assert [p.id for p in found[H1] if int(p.cm_id) == P2] == [PERSON_ID[P2]]
    assert [p.id for p in found[H2]] == [PERSON_ID[P2]]
    assert [p.id for p in found[H5]] == [PERSON_ID[P4]]
    assert [p.id for p in found[H6]] == [PERSON_ID[P4]]
    for people in found.values():
        assert len({p.id for p in people}) == len(people)


@pytest.mark.asyncio
async def test_household_persons_by_household_leaves_out_households_with_nobody_and_other_years() -> None:
    repo = FinancialAidRepository(parity_pb())
    # 11-13 and 999 hold nobody. H1's 2025 look-alike (P6, same cm_id as P1) must not leak in. Nine ids cross the
    # eight-household chunk boundary, with P4 matched in both chunks (H5 in the first, H6 in the second).
    found = await repo.fetch_household_persons_by_household(PARITY_YEAR, [11, 12, 13, 999, *ALL_HOUSEHOLDS, 0, -4])
    assert sorted(found) == ALL_HOUSEHOLDS
    assert {h: sorted(int(p.cm_id) for p in ps) for h, ps in found.items()} == {
        H1: [P1, P2],
        H2: [P2],
        H3: [P3],
        H4: [P3],
        H5: [P4],
        H6: [P4],
    }
    assert {int(p.year) for ps in found.values() for p in ps} == {PARITY_YEAR}
    assert await repo.fetch_household_persons_by_household(PARITY_YEAR, []) == {}


@pytest.mark.asyncio
async def test_household_persons_is_everyone_a_household_claims_in_id_order() -> None:
    repo = FinancialAidRepository(parity_pb())
    # H1: P1 lives there, P2's primary childhood household. One household is one read, `sort=id`, and P2's id
    # sorts before P1's, so this order is the read's; across households the order is incidental (compared sorted).
    assert [int(p.cm_id) for p in await repo.fetch_household_persons(PARITY_YEAR, [H1])] == [P2, P1]
    # A person claimed by two requested households is returned once.
    assert sorted(_cm_ids(await repo.fetch_household_persons(PARITY_YEAR, [H1, H2]))) == [P1, P2]
    assert _cm_ids(await repo.fetch_household_persons(PARITY_YEAR, [H3, H4])) == [P3]
    assert _cm_ids(await repo.fetch_household_persons(PARITY_YEAR, [H5, H6])) == [P4]
    assert await repo.fetch_household_persons(PARITY_YEAR, [999, 0]) == []


@pytest.mark.asyncio
async def test_household_members_are_only_people_whose_own_household_it_is() -> None:
    repo = FinancialAidRepository(parity_pb())
    members = await repo.fetch_household_members(PARITY_YEAR, [H1, H5])
    # P2 is a childhood-household member of H1, not a member; P4 is under H5 by household_id. Order is the read's `sort=id` (one chunk).
    assert [(int(p.cm_id), int(p.household_id)) for p in members] == [(P1, H1), (P4, H5)]
    assert {int(p.year) for p in members} == {PARITY_YEAR}
    assert await repo.fetch_household_members(PARITY_YEAR, [H6, 999]) == []


# --- persons and households -----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persons_by_cm_id_come_back_in_their_season_only_and_unknown_ids_are_absent() -> None:
    repo = FinancialAidRepository(parity_pb())
    found = await repo.fetch_persons(PARITY_YEAR, [P1, P6_CM, 999, 0, -1])
    assert [(p.id, int(p.cm_id), int(p.year), p.birthdate) for p in found] == [
        (PERSON_ID[P1], P1, PARITY_YEAR, "2012-04-09")
    ]
    assert (found[0].first_name, found[0].last_name) == ("Emma", "Johnson")
    assert await repo.fetch_persons(PARITY_YEAR, []) == []


@pytest.mark.asyncio
async def test_persons_come_back_in_id_order() -> None:
    repo = FinancialAidRepository(parity_pb())
    # Order is the read's `sort=id` (one chunk of ids).
    assert _cm_ids(await repo.fetch_persons(PARITY_YEAR, [P1, P2, P3, P4, P5])) == [P2, P1, P3, P4, P5]


@pytest.mark.asyncio
async def test_households_by_cm_id_with_and_without_adults() -> None:
    repo = FinancialAidRepository(parity_pb())
    with_adults = await repo.fetch_households(PARITY_YEAR, [H1, 999], adults=True)
    assert [(h.id, int(h.cm_id), int(h.year), h.mailing_title, h.greeting) for h in with_adults] == [
        (HH_ID[H1], H1, PARITY_YEAR, "Mr. and Mrs. Johnson", "Johnson Family")
    ]
    assert with_adults[0].aid_adults == '[{"first_name": "Dana", "last_name": "Johnson"}]'
    plain = await repo.fetch_households(PARITY_YEAR, [H2, H1])
    # Order is the read's `sort=id` (one chunk), whatever order they were asked in.
    assert [int(h.cm_id) for h in plain] == [H1, H2]
    # The plain read projects HOUSEHOLD_COLUMNS, which leaves out the adults CampMinder names.
    assert all(not hasattr(h, "aid_adults") for h in plain)
    assert [h.mailing_title for h in plain] == ["Mr. and Mrs. Johnson", ""]
    assert await repo.fetch_households(PARITY_YEAR, [999]) == []


# --- enrollments ----------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_enrollments_return_every_status_with_the_session_expanded_in_id_order() -> None:
    repo = FinancialAidRepository(parity_pb())
    rows = await repo.fetch_enrollments(PARITY_YEAR, [P1, P2])
    # Order is the read's `sort=id` (one chunk).
    assert [(r.id, int(r.person_id), int(r.status_id), int(r.expand["session"].cm_id)) for r in rows] == [
        (ATTENDEE_ID["a1"], P1, 2, S1),
        (ATTENDEE_ID["a2"], P1, 4, S2),
        (ATTENDEE_ID["a3"], P2, 32, S1),
        (ATTENDEE_ID["a4"], P2, 256, S2),
    ]  # status 4 is kept, and P1's 2025 registration (same cm_id) is not here


@pytest.mark.asyncio
async def test_an_enrollment_with_no_session_carries_no_session_expand() -> None:
    repo = FinancialAidRepository(parity_pb())
    rows = await repo.fetch_enrollments(PARITY_YEAR, [P3])
    assert [(r.id, int(r.status_id)) for r in rows] == [(ATTENDEE_ID["a5"], 2)]
    assert (rows[0].expand or {}).get("session") is None
    assert await repo.fetch_enrollments(PARITY_YEAR, [P5, 999]) == []


@pytest.mark.asyncio
async def test_enrollment_states_are_enrolled_cancelled_and_withdrawn_only() -> None:
    repo = FinancialAidDecisionsRepository(parity_pb())
    states = await repo.fetch_enrollment_states(PARITY_YEAR, [P1], [H2])
    # P1 by person id (its status-4 row is dropped); P2 by household H2. Household and session are resolved.
    assert sorted(states, key=lambda s: (s.person_cm_id, s.status_id)) == [
        EnrollmentState(P1, H1, S1, 2, date(2026, 3, 5)),
        EnrollmentState(P2, H2, S1, 32, date(2026, 4, 10)),
        EnrollmentState(P2, H2, S2, 256, date(2026, 4, 11)),
    ]


@pytest.mark.asyncio
async def test_enrollment_states_name_a_row_once_and_resolve_a_missing_session_to_zero() -> None:
    repo = FinancialAidDecisionsRepository(parity_pb())
    # P2 named directly and through H2: each registration once.
    both = await repo.fetch_enrollment_states(PARITY_YEAR, [P2], [H2])
    assert sorted((s.person_cm_id, s.status_id) for s in both) == [(P2, 32), (P2, 256)]
    states = await repo.fetch_enrollment_states(PARITY_YEAR, [P3], [])
    assert states == [EnrollmentState(P3, H3, 0, 2, date(2026, 2, 1))]
    assert await repo.fetch_enrollment_states(PARITY_YEAR, [], []) == []
    assert await repo.fetch_enrollment_states(PARITY_YEAR, [P5, 999], [H6]) == []


# --- equity, birthdates, names --------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_equity_answers_read_the_two_allowlisted_fields_and_the_person_columns() -> None:
    repo = FinancialAidIntakeRepository(parity_pb())
    answers = await repo.fetch_equity_answers(PARITY_YEAR, [P1, P2, P3])
    assert answers == {
        # camper field "Yes" wins over the adult field "No"; the 2025 "No" for the same cm_id is another season
        P1: EquityAnswers(True, "Girl", "she/her"),
        P2: EquityAnswers(True, "", "he/him"),  # only the adult field, "yes"
        P3: EquityAnswers(None, "Nonbinary", ""),  # an unrelated field's "Yes" is ignored
    }


@pytest.mark.asyncio
async def test_equity_allowlist_is_what_keeps_an_unrelated_field_out(monkeypatch: pytest.MonkeyPatch) -> None:
    # P3's only custom value is "Yes" on an unrelated field one cm_id off the camper field. Today's allowlist keeps
    # it out (P3 unanswered, above). Widen the allowlist and the fixture lets it through, so a read that stops
    # narrowing to the two equity fields would show here.
    monkeypatch.setattr(intake, "EQUITY_FIELD_CM_IDS", (CAMPER_FIELD_CM, ADULT_FIELD_CM, OTHER_FIELD_CM))
    answers = await FinancialAidIntakeRepository(parity_pb()).fetch_equity_answers(PARITY_YEAR, [P3])
    assert answers[P3].bipoc is True


@pytest.mark.asyncio
async def test_equity_answers_leave_unparseable_or_missing_answers_unanswered() -> None:
    repo = FinancialAidIntakeRepository(parity_pb())
    answers = await repo.fetch_equity_answers(PARITY_YEAR, [P4, P5, 999, 0])
    assert answers == {
        P4: EquityAnswers(None, "", ""),  # "maybe" parses to unanswered
        P5: EquityAnswers(None, "", ""),
        999: EquityAnswers(None, "", ""),  # nobody by that id: the unknown default, still keyed
    }
    assert await repo.fetch_equity_answers(PARITY_YEAR, []) == {}


@pytest.mark.asyncio
async def test_birthdates_by_person_in_their_season_only() -> None:
    repo = FinancialAidIntakeRepository(parity_pb())
    assert await repo.fetch_birthdates(PARITY_YEAR, [P1, 999]) == {P1: "2012-04-09"}  # 2025's P6 says 2009
    assert await repo.fetch_birthdates(PARITY_YEAR, [P5, P3, 0]) == {P5: "", P3: "2013-08-30"}
    assert await repo.fetch_birthdates(PARITY_YEAR, []) == {}


@pytest.mark.asyncio
async def test_names_for_the_requests_grid() -> None:
    repo = FinancialAidDecisionsRepository(parity_pb())
    families, campers = await repo.fetch_names(PARITY_YEAR, [H1, H2, H3, 999], [P1, P2, 999])
    assert families == {
        H1: "Mr. and Mrs. Johnson",  # mailing_title first
        H2: "Garcia Family",  # blank mailing_title falls back to the greeting
        H3: "Household 4000103",  # neither: the id
    }  # 999 has no record, so it is absent (the caller falls back)
    assert campers == {P1: "Emma Johnson", P2: "Lee Garcia"}  # preferred name over first name


def test_the_fixture_double_is_a_filtering_pb() -> None:
    assert isinstance(parity_pb(), FilteringPb)

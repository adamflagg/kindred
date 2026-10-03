"""The March bulk file (campership slice 3, ask 6; clean spec §8.3; D21, D73; owner ruling S3-7). Fictional only.
Prices under financial_aid_fakes.intake_rules(): Session 2 gives a tier-2 family Round 1 = 1,500."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, cast
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, camper_name
from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_march_file import MarchFileService, march_rows, march_shares
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _posted, _service
from tests.unit.bunking.financial_aid.test_decision_budget import priced, view

if TYPE_CHECKING:
    from api.services.financial_aid_decisions_service import FinancialAidDecisionsService

EMMA = "reqemma00000001"  # Emma Johnson, household 1000001
LIAM = "reqliam00000001"  # Liam Garcia, household 1000002
OLIVIA = "reqoliv00000001"  # Olivia Chen, household 1000003
NOAH = "reqnoah00000001"  # household 1000005
FAMILY = "reqfami00000001"  # a household's own Family Camp request (no camper)


def _shares(store: FakeDecisionsStore) -> dict[str, tuple[PayerShareRecord, ...]]:
    return {rid: tuple(s for s in store.shares if s.request_id == rid) for rid in store.requests}


def _split_emma(store: FakeDecisionsStore) -> None:
    """Emma's request paid 60/40 by her household and a second home (1000004)."""
    store.shares = [
        *(s for s in store.shares if s.request_id != EMMA),
        share_row(EMMA, 1000001, "60"),
        share_row(EMMA, 1000004, "40"),
    ]


# --- the rows (pure) ---------------------------------------------------------------------------


def test_one_row_per_payer_share_at_its_whole_dollar_part_of_round_1() -> None:
    """S3-7: one row per payer share at that share's Round 1 decided amount; split_award's whole dollars add up to
    Round 1 exactly, the remainder on the applying household. An unsplit request is one row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _split_emma(store)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1501")),
        LIAM: priced(LIAM, 1000002, view(1, "needs_offer", decided="1200")),
    }
    found = march_shares(store.requests, priced_by_id, _shares(store))
    assert sorted((s.request_id, s.household_cm_id, s.amount, s.applicant, s.person_cm_id) for s in found) == [
        (EMMA, 1000001, Decimal(901), True, 1000011),
        (EMMA, 1000004, Decimal(600), False, 1000011),
        (LIAM, 1000002, Decimal(1200), True, 1000021),
    ]


def test_only_a_round_1_that_still_needs_its_offer_is_sent() -> None:
    """§8.3: over Needs an offer's Round 1 group. A posted Round 1 never goes again (D73: it would double-post),
    whatever its later rounds need; a held or undecided one has nothing to send."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_request(store, OLIVIA, household=1000003, person=1000031)
    seed_request(store, NOAH, household=1000005, person=1000051)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500")),
        LIAM: priced(LIAM, 1000002, view(1, "posted", locked="1500"), view(2, "needs_offer", ask="900", decided="300")),
        OLIVIA: priced(OLIVIA, 1000003, view(1, "held")),
        NOAH: priced(NOAH, 1000005, view(1, "not_decided")),
    }
    assert [s.request_id for s in march_shares(store.requests, priced_by_id, _shares(store))] == [EMMA]


def test_a_zero_round_1_is_a_zero_row() -> None:
    """Owner question 2 (default): $0 is a real zero (D74) and still needs its offer, so it is a $0 row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    priced_by_id = {EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="0"))}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), {1000011: ("Emma", "Johnson")})
    assert [(r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id) for r in rows] == [
        ("Emma", "Johnson", 0.0, 1000001, 1000011),
    ]


def test_a_household_request_is_a_row_with_no_camper_and_no_personal_id() -> None:
    """Owner question 1 (default): a Family Camp request is the household's, so its row names no camper and has no
    Personal Id (None); Primary Childhood ID is the household."""
    store = FakeDecisionsStore()
    seed_request(store, FAMILY, household=1000003, person=0, session=1000201)
    priced_by_id = {FAMILY: priced(FAMILY, 1000003, view(1, "needs_offer", decided="800"))}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), {1000011: ("Emma", "Johnson")})
    assert [(r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id) for r in rows] == [
        ("", "", 800.0, 1000003, None),
    ]


def test_rows_sort_by_camper_then_request_with_the_applying_household_first() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _split_emma(store)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500")),
        LIAM: priced(LIAM, 1000002, view(1, "needs_offer", decided="1200")),
    }
    names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia")}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), names)
    assert [(r.request_id, r.camper_last, r.primary_childhood_id, r.total_award) for r in rows] == [
        (LIAM, "Garcia", 1000002, 1200.0),
        (EMMA, "Johnson", 1000001, 900.0),
        (EMMA, "Johnson", 1000004, 600.0),
    ]


def test_shares_that_do_not_split_leave_the_request_out() -> None:
    """Defensive: incomplete shares hold the request, so this can't reach the file; if it ever did, no guessed row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60")]
    priced_by_id = {EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500"))}
    left_out: list[str] = []
    assert march_shares(store.requests, priced_by_id, _shares(store), left_out) == []
    assert left_out == [EMMA]  # counted, so the read's log line can say left_out=1


# --- CampMinder's names -------------------------------------------------------------------------


def test_a_campers_names_are_campminders_never_the_preferred_name() -> None:
    record = SimpleNamespace(cm_id=1000011, first_name=" Emma ", last_name="Johnson ", preferred_name="Em")
    assert camper_name(record) == ("Emma", "Johnson")
    assert camper_name(SimpleNamespace(cm_id=1000011, first_name=None, last_name="")) == ("", "")


@pytest.mark.asyncio
async def test_the_names_read_asks_persons_for_the_season_and_the_campers() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        SimpleNamespace(cm_id=1000011, first_name="Emma", last_name="Johnson", preferred_name="")
    ]
    names = await FinancialAidDecisionsRepository(pb).fetch_camper_names(YEAR, [1000011])
    assert names == {1000011: ("Emma", "Johnson")}
    pb.collection.assert_called_with("persons")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert f"year = {YEAR}" in query["filter"]
    assert "1000011" in query["filter"]


# --- the read -----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_read_sends_each_share_of_every_round_1_offer_with_campminders_names() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_request(store, OLIVIA, household=1000003, person=1000031, status="withdrawn")
    _split_emma(store)
    _posted(store, LIAM, 1, "1500")
    store.camper_names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia"), 1000031: ("Olivia", "Chen")}
    out = await MarchFileService(_service(store), store).read(YEAR)
    assert out.year == YEAR
    assert [
        (r.request_id, r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id)
        for r in out.rows
    ] == [
        (EMMA, "Emma", "Johnson", 900.0, 1000001, 1000011),
        (EMMA, "Emma", "Johnson", 600.0, 1000004, 1000011),
    ]


# --- a Family Camp row names the oldest child attending (owner ruling A3 (a), 2026-10-02) ---------
# Family Camp 3 (session 1000201) starts 2027-05-28: someone born 2009-05-28 turns 18 that day.

HOUSEHOLD = 1000003
FC_SESSION = 1000201
EMMA_ID, LIAM_ID, SAM_ID, RILEY_ID, SAMUEL_ID = 1000011, 1000021, 1000041, 1000042, 1000043


def _member(
    person: int, born: str | None, *, status: int = 2, session: int = FC_SESSION, household: int = HOUSEHOLD
) -> SimpleNamespace:
    """One registration of a household member (HouseholdAttendee's shape)."""
    return SimpleNamespace(
        household_cm_id=household,
        person_cm_id=person,
        session_cm_id=session,
        status_id=status,
        birthdate=date.fromisoformat(born) if born else None,
    )


def _fc_store(*members: SimpleNamespace) -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, FAMILY, household=HOUSEHOLD, person=0, session=FC_SESSION)
    store.household_attendees = list(members)
    store.camper_names = {
        EMMA_ID: ("Emma", "Johnson"),
        LIAM_ID: ("Liam", "Garcia"),
        SAM_ID: ("Riley", "Sam"),
        RILEY_ID: ("Olivia", "Chen"),
        SAMUEL_ID: ("Samuel", "Johnson"),
    }
    return store


async def _fc_rows(store: FakeDecisionsStore, decided: str = "800") -> list[tuple[str, str, float, int, int | None]]:
    priced_by_id = {FAMILY: priced(FAMILY, HOUSEHOLD, view(1, "needs_offer", decided=decided))}

    async def season(year: int) -> SimpleNamespace:
        return _season(store, priced_by_id)

    service = SimpleNamespace(season=season, with_unticked=_as_is)
    out = await MarchFileService(cast("FinancialAidDecisionsService", service), store).read(YEAR)
    return [(r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id) for r in out.rows]


def _season(store: FakeDecisionsStore, priced_by_id: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(
        requests=store.requests,
        priced=priced_by_id,
        shares=_shares(store),
        sessions={s.cm_id: s for s in store.sessions},
        in_campminder=frozenset,  # no ledger here: CampMinder holds money for no round (D162)
    )


async def _as_is(season: SimpleNamespace) -> SimpleNamespace:
    """The service's with_unticked on a season with no ledger read: the season unchanged."""
    return season


@pytest.mark.asyncio
async def test_a_family_camp_row_names_the_oldest_child_attending() -> None:
    """Ages 9 and 13 on the first day: the 13-year-old, with that child's Personal Id; Primary Childhood ID stays the
    household."""
    store = _fc_store(_member(EMMA_ID, "2018-01-10"), _member(LIAM_ID, "2014-03-02"))
    assert await _fc_rows(store) == [("Liam", "Garcia", 800.0, HOUSEHOLD, LIAM_ID)]


@pytest.mark.asyncio
async def test_twins_tie_on_birthdate_to_the_lowest_personal_id() -> None:
    store = _fc_store(_member(RILEY_ID, "2015-04-04"), _member(SAM_ID, "2015-04-04"))
    assert await _fc_rows(store) == [("Riley", "Sam", 800.0, HOUSEHOLD, SAM_ID)]


@pytest.mark.asyncio
async def test_a_child_who_is_not_actively_enrolled_is_skipped() -> None:
    """Status 32 (cancelled): the older child is out, the younger enrolled one is named."""
    store = _fc_store(_member(LIAM_ID, "2012-03-02", status=32), _member(EMMA_ID, "2018-01-10"))
    assert await _fc_rows(store) == [("Emma", "Johnson", 800.0, HOUSEHOLD, EMMA_ID)]


@pytest.mark.asyncio
async def test_a_child_in_another_session_is_skipped() -> None:
    store = _fc_store(_member(LIAM_ID, "2012-03-02", session=1000202), _member(EMMA_ID, "2018-01-10"))
    assert await _fc_rows(store) == [("Emma", "Johnson", 800.0, HOUSEHOLD, EMMA_ID)]


@pytest.mark.asyncio
async def test_an_all_adult_household_keeps_the_blank_row() -> None:
    store = _fc_store(_member(SAMUEL_ID, "1985-06-01"), _member(EMMA_ID, None))  # an adult, and an undated person
    assert await _fc_rows(store) == [("", "", 800.0, HOUSEHOLD, None)]


@pytest.mark.asyncio
async def test_a_second_payer_share_names_the_same_child() -> None:
    store = _fc_store(_member(EMMA_ID, "2018-01-10"), _member(LIAM_ID, "2014-03-02"))
    store.shares = [share_row(FAMILY, HOUSEHOLD, "60"), share_row(FAMILY, 1000004, "40")]
    assert await _fc_rows(store, "1000") == [
        ("Liam", "Garcia", 600.0, HOUSEHOLD, LIAM_ID),
        ("Liam", "Garcia", 400.0, 1000004, LIAM_ID),
    ]


@pytest.mark.asyncio
async def test_someone_who_turns_18_on_the_first_day_is_not_a_child() -> None:
    """Born 2009-05-28, 18 on 2027-05-28: not a child; the one born the next day (17) is."""
    store = _fc_store(_member(LIAM_ID, "2009-05-28"), _member(EMMA_ID, "2009-05-29"))
    assert await _fc_rows(store) == [("Emma", "Johnson", 800.0, HOUSEHOLD, EMMA_ID)]


@pytest.mark.asyncio
async def test_someone_born_after_the_first_day_is_never_named() -> None:
    """A birthdate after the first day (2027-05-28) is bad data, not a child at camp: the row stays blank."""
    store = _fc_store(_member(EMMA_ID, "2027-06-01"))
    assert await _fc_rows(store) == [("", "", 800.0, HOUSEHOLD, None)]


@pytest.mark.asyncio
async def test_a_session_with_no_start_date_names_no_child() -> None:
    store = _fc_store(_member(EMMA_ID, "2018-01-10"))
    store.sessions = [replace(s, start_date="") if s.cm_id == FC_SESSION else s for s in store.sessions]
    assert await _fc_rows(store) == [("", "", 800.0, HOUSEHOLD, None)]


@pytest.mark.asyncio
async def test_a_session_missing_from_the_season_names_no_child() -> None:
    store = _fc_store(_member(EMMA_ID, "2018-01-10"))
    store.sessions = [s for s in store.sessions if s.cm_id != FC_SESSION]
    assert await _fc_rows(store) == [("", "", 800.0, HOUSEHOLD, None)]


@pytest.mark.asyncio
async def test_the_household_members_are_read_once_for_the_whole_file() -> None:
    store = _fc_store(_member(EMMA_ID, "2018-01-10"))
    await _fc_rows(store)
    assert store.household_attendee_reads == [frozenset({HOUSEHOLD})]


@pytest.mark.asyncio
async def test_two_family_camp_requests_share_one_read_and_each_names_its_own_child() -> None:
    """Two Family Camp requests in two households: one read naming both, and each row its own household's child."""
    store = _fc_store(_member(EMMA_ID, "2018-01-10"), _member(LIAM_ID, "2014-03-02", household=1000004))
    seed_request(store, "reqfam200000001", household=1000004, person=0, session=FC_SESSION)
    priced_by_id = {
        FAMILY: priced(FAMILY, HOUSEHOLD, view(1, "needs_offer", decided="800")),
        "reqfam200000001": priced("reqfam200000001", 1000004, view(1, "needs_offer", decided="500")),
    }

    async def season(year: int) -> SimpleNamespace:
        return _season(store, priced_by_id)

    service = SimpleNamespace(season=season, with_unticked=_as_is)
    out = await MarchFileService(cast("FinancialAidDecisionsService", service), store).read(YEAR)
    assert store.household_attendee_reads == [frozenset({HOUSEHOLD, 1000004})]
    assert sorted((r.primary_childhood_id, r.personal_id) for r in out.rows) == [
        (HOUSEHOLD, EMMA_ID),
        (1000004, LIAM_ID),
    ]


@pytest.mark.asyncio
async def test_the_household_attendees_read_is_two_reads_by_the_membership_rule() -> None:
    """The people of the households (own or childhood household), then their registrations: two collections read."""
    people = [
        SimpleNamespace(
            id="p1", cm_id=LIAM_ID, household_id=HOUSEHOLD, birthdate="2014-03-02 00:00:00.000Z", expand={}
        ),
        SimpleNamespace(id="p2", cm_id=EMMA_ID, household_id=999, birthdate="", expand={}),
    ]
    session = SimpleNamespace(cm_id=FC_SESSION)
    enrolments = [
        SimpleNamespace(person_id=LIAM_ID, status_id=2, expand={"session": session}),
        SimpleNamespace(person_id=777, status_id=2, expand={"session": session}),  # nobody asked for
    ]
    pb = MagicMock()
    asked: list[str] = []

    def full_list(**kwargs: Any) -> list[SimpleNamespace]:
        name = pb.collection.call_args.args[0]
        asked.append(name)
        return people if name == "persons" else enrolments

    pb.collection.return_value.get_full_list.side_effect = full_list
    found = await FinancialAidDecisionsRepository(pb).fetch_household_attendees(YEAR, [HOUSEHOLD])
    assert [(a.household_cm_id, a.person_cm_id, a.session_cm_id, a.status_id, a.birthdate) for a in found] == [
        (HOUSEHOLD, LIAM_ID, FC_SESSION, 2, date(2014, 3, 2))
    ]
    assert asked == ["persons", "attendees"]

"""PR 4b: a registration aid ask makes a request, 2027 on (design 96 §3-§5; owner ruling #8 = 8a).

One test (or a pair) per row of the design's §7.2 table, numbered as it numbers them, written before the rule. Each
shape is the 2026 one the design measured, rebuilt with fictional ids: people and households from 1000001, sessions
as the other intake tests name them (tests/CLAUDE.md). Nothing here is, or resembles, a real family.

The rule runs inside intake's own build, so almost every test drives FinancialAidIntakeService over the fake store and
reads what it wrote; the pure function is also called directly where a shape is easier to see that way."""

from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace

import pytest

import api.services.financial_aid_decisions_service as decisions_service
from api.schemas.financial_aid_form_intake import FormIntakeRowOut
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_intake_service import FinancialAidIntakeService, IntakeReport
from api.services.financial_aid_intake_types import (
    ADDITION_SOURCE_REGISTRATION_ASK,
    REGISTERED_STATUS_IDS,
    AdditionRecord,
    AttendeeRow,
    FaRow,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_registration_ask import (
    REGISTRATION_ASK_ACTOR,
    REGISTRATION_ASK_RULE_FIRST_SEASON,
    AskHistoryRow,
    AttendeeDates,
    registration_ask_additions,
)
from api.services.financial_aid_season_history import (
    HistoryFilter,
    entry_of,
    operations,
    subjects_from,
    visible,
)
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, FakeAidStore, fa_row, intake_rules

ACTOR = "registrar@example.com"

SESSION_2, AG_2, TASTE_1, QUEST, SCIT = 1000101, 1000103, 1000104, 1000106, 1000107
TASTE_OF_QUEST, TLI, TWR = 1000109, 1000110, 1000501
FAMILY_CAMP_2, BMITZVAH = 1000203, 1000301
HEBREW, SCHOOL, OTHER = 1000701, 1000702, 1000703

EXTRA_SESSIONS = (
    SessionRow(TASTE_OF_QUEST, "Taste of Quest", "quest", "2027-06-13"),
    SessionRow(TLI, "Teen Leadership Institute", "tli", "2027-06-20"),
    SessionRow(TWR, "Teen Winter Retreat", "teen", "2027-12-27"),
    SessionRow(FAMILY_CAMP_2, "Family Camp 2", "family", "2027-06-04"),
    SessionRow(HEBREW, "Hebrew School Sundays", "hebrew", "2027-09-12"),
    SessionRow(SCHOOL, "School Partnership Week", "school", "2027-04-05"),
    SessionRow(OTHER, "Alumni Day", "other", "2027-05-01"),
)
# The fixture's AG session sits under Session 2, as the sessions sync sets parent_id for an exact date match.
SEASON_SESSIONS = tuple(
    SessionRow(s.cm_id, s.name, s.session_type, s.start_date, s.end_date, SESSION_2) if s.cm_id == AG_2 else s
    for s in (*SESSIONS, *EXTRA_SESSIONS)
)

# Fictional families. The Johnsons file for Emma; her twin Noah is not on the form.
JOHNSON, EMMA, NOAH = 1000001, 1000011, 1000012
CHEN, OLIVIA = 1000002, 1000021
SAM, RILEY = 1000004, 1000041
GARCIA, LIAM = 1000005, 1000051


def make_store() -> FakeAidStore:
    store = FakeAidStore()
    store.rules = intake_rules()
    store.sessions = list(SEASON_SESSIONS)
    return store


def register(
    store: FakeAidStore,
    person: int,
    household: int,
    session: int,
    *,
    day: str,
    status: int = 2,
    posted: str = "",
) -> None:
    """One registration: the all-status dated row the rule reads, and intake's registered-status row when it counts.
    `day` is the registration day (effective_date, a calendar date stored at 00:00Z); `posted` the status date."""
    store.attendee_dates.append(
        AttendeeDates(person, household, session, status, f"{day} 00:00:00.000Z", posted or f"{day} 19:00:00.000Z")
    )
    if status in REGISTERED_STATUS_IDS:
        store.attendees.append(AttendeeRow(person, household, session, status))


def set_status(store: FakeAidStore, person: int, session: int, status: int) -> None:
    store.attendee_dates = [
        AttendeeDates(a.person_cm_id, a.household_cm_id, a.session_cm_id, status, a.effective_date, a.enrollment_date)
        if (a.person_cm_id, a.session_cm_id) == (person, session)
        else a
        for a in store.attendee_dates
    ]
    rows = [a for a in store.attendees if (a.person_cm_id, a.session_cm_id) != (person, session)]
    household = next(a.household_cm_id for a in store.attendee_dates if a.person_cm_id == person)
    if status in REGISTERED_STATUS_IDS:
        rows.append(AttendeeRow(person, household, session, status))
    store.attendees = rows


def ask(store: FakeAidStore, person: int, amount: float, at: str) -> None:
    """One history row as the Go recorder writes it: CampMinder's last_updated verbatim, in arrival order."""
    n = len(store.ask_history)
    store.ask_history.append(
        AskHistoryRow(person, amount, at, observed_at=f"2027-01-01 00:00:{n:02d}.000Z", created=f"{n:04d}")
    )


async def build(store: FakeAidStore, year: int = YEAR) -> IntakeReport:
    return await FinancialAidIntakeService(store).build(year)


def rule_made(store: FakeAidStore) -> list[AdditionRecord]:
    return sorted(
        (a for a in store.additions.values() if a.source == ADDITION_SOURCE_REGISTRATION_ASK),
        key=lambda a: (a.person_cm_id, a.session_cm_id),
    )


def made(store: FakeAidStore) -> list[tuple[int, int, str, float]]:
    return [(a.person_cm_id, a.session_cm_id, a.program_key, a.ask) for a in rule_made(store)]


def request_on(store: FakeAidStore, person: int, session: int) -> list[str]:
    return [
        r.program_option_key
        for r in store.requests.values()
        if r.person_cm_id == person and r.session_cm_id == session and r.status == "active"
    ]


def summer(person: int, household: int, text: str, ask_amount: float = 3000.0) -> FaRow:
    return fa_row(person, household, summer=text, summer_ask=ask_amount, total_gross_income=85000.0)


# -- the gate ---------------------------------------------------------------------------------------------------------


def test_the_rule_has_its_own_first_season_beside_it_not_the_ledgers() -> None:
    """§5: its own constant, so moving the ledger's FIRST_TICKED_SEASON never moves the rule (or back)."""
    assert REGISTRATION_ASK_RULE_FIRST_SEASON == 2027
    assert "REGISTRATION_ASK_RULE_FIRST_SEASON" not in vars(decisions_service)
    assert REGISTRATION_ASK_ACTOR == "system:registration_ask"


# -- row 1: TLI + TWR, summer request matched; the ask dated the TWR registration day -----------------------------------


@pytest.mark.asyncio
async def test_row_1_a_twr_registration_ask_beside_a_matched_summer_request_makes_one_twr_request() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Teen Leadership Institute", 4000.0)]
    register(store, EMMA, JOHNSON, TLI, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:14:05.120+00:00")
    report = await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 290.0)]
    assert request_on(store, EMMA, TWR) == [f"registration_ask:{TWR}"]
    assert request_on(store, EMMA, TLI) == ["teen leadership institute"]
    assert report.registration_ask_added == 1


# -- row 2: SCIT + TWR, summer request UNMATCHED [SCIT, TWR] --------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_2_the_twr_exception_fires_and_pr1s_drop_then_resolves_the_summer_request_to_scit() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Summer 2027 teen programs")]
    register(store, EMMA, JOHNSON, SCIT, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-10-01")
    ask(store, EMMA, 585.0, "2027-10-01T17:02:11.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 585.0)]
    # The same run: the rule's addition holds TWR, so the form's request is no longer unclear between the two.
    assert request_on(store, EMMA, SCIT) == ["summer 2027 teen programs"]
    assert request_on(store, EMMA, TWR) == [f"registration_ask:{TWR}"]


@pytest.mark.asyncio
async def test_row_2_an_existing_unmatched_request_still_lets_the_twr_ask_fire() -> None:
    """The shape as the 2026 snapshot holds it: the unmatched summer request already exists when the ask lands."""
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Summer 2027 teen programs")]
    register(store, EMMA, JOHNSON, SCIT, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-10-01")
    await build(store)
    (unclear,) = [r for r in store.requests.values() if r.person_cm_id == EMMA]
    assert (unclear.status, unclear.session_cm_id) == ("unmatched_session", 0)
    ask(store, EMMA, 585.0, "2027-10-01T17:02:11.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 585.0)]
    assert store.requests[unclear.id].session_cm_id == SCIT


# -- row 3: ask 18:35 UTC on registration day, PostDate 27 h later -------------------------------------------------------


@pytest.mark.asyncio
async def test_row_3_an_ask_on_registration_day_fires_though_the_status_date_is_27_hours_later() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-08-02", posted="2027-08-03 21:27:00.000Z")
    ask(store, EMMA, 500.0, "2027-08-02T18:35:00.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 500.0)]


def test_row_3_the_status_date_alone_also_matches_a_back_dated_registration_day() -> None:
    """§3.1's second test: the status date within 24 hours of the ask, whatever the registration day says."""
    result = registration_ask_additions(
        YEAR,
        fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[
            AttendeeDates(EMMA, JOHNSON, SESSION_2, 2, "2026-11-12 00:00:00.000Z", "2026-11-12 19:00:00.000Z"),
            AttendeeDates(EMMA, JOHNSON, TWR, 2, "2027-07-01 00:00:00.000Z", "2027-08-02 09:00:00.000Z"),
        ],
        history=[AskHistoryRow(EMMA, 500.0, "2027-08-02T18:35:00.000+00:00")],
        additions=[],
        requests=[],
    )
    assert [(a.person_cm_id, a.session_cm_id, a.ask) for a in result.additions] == [(EMMA, TWR, 500.0)]


# -- row 4: B*Mitzvah, ask 05:40 UTC the day after the Pacific registration ---------------------------------------------


@pytest.mark.asyncio
async def test_row_4_a_bmitzvah_ask_typed_the_next_utc_day_fires_with_its_amount() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, BMITZVAH, day="2027-07-27")
    ask(store, EMMA, 5000.0, "2027-07-28T05:40:00.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, BMITZVAH, "bmitzvah", 5000.0)]
    (addition,) = rule_made(store)
    assert addition.actor == REGISTRATION_ASK_ACTOR
    # The evidence in words, the day in camp time: 05:40 UTC on the 28th is the evening of the 27th.
    assert addition.reason == "CampMinder registration ask $5,000, typed 2027-07-27 at this session's registration"


def test_row_4_the_next_utc_day_matches_on_the_registration_day_alone() -> None:
    """Scan of #3270: the same shape with the status date weeks away, so only the ±1-day registration-day window can
    tie the ask (the test above also matches on the status date's 24 hours)."""
    result = registration_ask_additions(
        YEAR,
        fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[AttendeeDates(EMMA, JOHNSON, BMITZVAH, 2, "2027-07-27 00:00:00.000Z", "2027-08-20 19:00:00.000Z")],
        history=[AskHistoryRow(EMMA, 5000.0, "2027-07-28T05:40:00.000+00:00")],
        additions=[],
        requests=[],
    )
    assert [(a.person_cm_id, a.session_cm_id, a.ask) for a in result.additions] == [(EMMA, BMITZVAH, 5000.0)]


# -- row 5: the household filed no form ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_5_a_household_that_filed_no_form_gets_nothing() -> None:
    store = make_store()
    store.fa_rows = [fa_row(LIAM, GARCIA, interest=True, registration_ask=400.0)]  # no program answer: not filed
    register(store, LIAM, GARCIA, SESSION_2, day="2026-11-12")
    register(store, LIAM, GARCIA, TWR, day="2027-09-30")
    ask(store, LIAM, 400.0, "2026-11-12T18:00:00.000+00:00")
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)


# -- row 6: unmatched summer request [TOC1, Taste of Quest], ask at TOC1's registration -----------------------------------


@pytest.mark.asyncio
async def test_row_6_a_candidate_of_an_unmatched_request_is_held_when_no_candidate_is_twr() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Summer 2027")]
    register(store, EMMA, JOHNSON, TASTE_1, day="2026-11-12")
    register(store, EMMA, JOHNSON, TASTE_OF_QUEST, day="2026-12-01")
    ask(store, EMMA, 1200.0, "2026-11-12T18:00:00.000+00:00")
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)


# -- row 7: one ask, TOC1 and FC2 registered the same day -----------------------------------------------------------------


def _row_7_store() -> FakeAidStore:
    store = make_store()
    store.fa_rows = [
        fa_row(EMMA, JOHNSON, fc="Family Camp 2", fc_ask=900.0, total_gross_income=85000.0),
        fa_row(NOAH, JOHNSON, registration_ask=1500.0),
    ]
    register(store, NOAH, JOHNSON, TASTE_1, day="2026-11-12")
    register(store, NOAH, JOHNSON, FAMILY_CAMP_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, FAMILY_CAMP_2, day="2026-11-12")
    ask(store, NOAH, 1500.0, "2026-11-12T18:00:00.000+00:00")
    return store


@pytest.mark.asyncio
async def test_row_7_one_ask_on_a_day_that_registered_two_sessions_is_ambiguous_and_makes_nothing() -> None:
    store = _row_7_store()
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (1, 0)
    noah = next(r for r in (await FormIntakeService(store).forms(YEAR)).rows if r.person_cm_id == NOAH)
    assert (noah.why_not, noah.why_not_detail) == ("registration_ask_ambiguous", None)
    assert noah.needs_look is True


# -- row 8: B*Mitzvah registered after the ask's date ---------------------------------------------------------------------


def _row_8_store() -> FakeAidStore:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, BMITZVAH, day="2027-02-19")
    ask(store, EMMA, 3000.0, "2026-11-12T18:00:00.000+00:00")
    return store


@pytest.mark.asyncio
async def test_row_8_an_ask_older_than_the_registration_is_unattributed_to_it() -> None:
    store = _row_8_store()
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 1)
    emma = next(r for r in (await FormIntakeService(store).forms(YEAR)).rows if r.person_cm_id == EMMA)
    assert (emma.why_not, emma.why_not_detail) == ("registration_ask_unattributed", "ask_predates_registration")


def test_row_8_an_ask_typed_outside_any_registration_is_unattributed_without_the_predates_detail() -> None:
    result = registration_ask_additions(
        YEAR,
        fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[AttendeeDates(EMMA, JOHNSON, BMITZVAH, 2, "2027-02-19 00:00:00.000Z", "2027-02-19 19:00:00.000Z")],
        history=[AskHistoryRow(EMMA, 3000.0, "2027-03-30T18:00:00.000+00:00")],  # after it, outside any registration
        additions=[],
        requests=[],
    )
    assert result.additions == ()
    assert [(f.person_cm_id, f.session_cm_id, f.predates) for f in result.unattributed] == [(EMMA, BMITZVAH, False)]


def test_row_8_an_ask_two_days_from_the_registration_is_not_tied_to_it() -> None:
    """Scan of #3270: the window is one day. An ask typed two days after the registration day, with the status date
    weeks away, is unattributed, not a request."""
    result = registration_ask_additions(
        YEAR,
        fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[AttendeeDates(EMMA, JOHNSON, BMITZVAH, 2, "2027-02-19 00:00:00.000Z", "2027-03-20 19:00:00.000Z")],
        history=[AskHistoryRow(EMMA, 3000.0, "2027-02-21T18:00:00.000+00:00")],
        additions=[],
        requests=[],
    )
    assert result.additions == ()
    assert [(f.person_cm_id, f.session_cm_id, f.predates) for f in result.unattributed] == [(EMMA, BMITZVAH, False)]


def _request(person: int, session: int, status: str) -> RequestRecord:
    """A request of the camper's on a session, as intake reads it back (form-made: its key is the option text)."""
    return RequestRecord(
        id=f"req{person}{session}",
        year=YEAR,
        application_id="app1",
        household_cm_id=JOHNSON,
        person_cm_id=person,
        session_cm_id=session,
        program_key="summer",
        program_option_text="Session 2",
        program_option_key="session 2",
        session_resolution="enrollment",
        ask=3000.0,
        headcount_non_infant=1,
        headcount_infant=0,
        headcount_source="form",
        status=status,
        duplicate_of="",
    )


def test_a_withdrawn_request_does_not_hold_its_session() -> None:
    """Scan of #3270, design §4.2: a request holds its session in any status BUT withdrawn."""

    def on_twr(status: str) -> tuple[AdditionRecord, ...]:
        return registration_ask_additions(
            YEAR,
            fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
            sessions=SEASON_SESSIONS,
            attendees=[AttendeeDates(EMMA, JOHNSON, TWR, 2, "2027-09-30 00:00:00.000Z", "2027-09-30 19:00:00.000Z")],
            history=[AskHistoryRow(EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")],
            additions=[],
            requests=[_request(EMMA, TWR, status)],
        ).additions

    assert [(a.person_cm_id, a.session_cm_id) for a in on_twr("withdrawn")] == [(EMMA, TWR)]
    assert on_twr("cancelled") == ()


# -- row 9: a camper the form didn't name ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_9_a_twin_the_form_did_not_name_gets_a_request_on_their_session() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2"), fa_row(NOAH, JOHNSON, registration_ask=1800.0)]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, NOAH, JOHNSON, SESSION_2, day="2026-11-12")
    ask(store, EMMA, 3000.0, "2026-11-12T18:00:00.000+00:00")
    ask(store, NOAH, 1800.0, "2026-11-12T18:01:00.000+00:00")
    await build(store)
    assert made(store) == [(NOAH, SESSION_2, "summer", 1800.0)]
    assert request_on(store, NOAH, SESSION_2) == [f"registration_ask:{SESSION_2}"]
    assert request_on(store, EMMA, SESSION_2) == ["session 2"]


# -- row 10: the late form ------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_10_an_ask_in_november_fires_only_once_the_form_lands_in_march() -> None:
    store = make_store()
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, NOAH, JOHNSON, SESSION_2, day="2026-11-12")
    ask(store, NOAH, 1800.0, "2026-11-12T18:00:00.000+00:00")
    await build(store)
    assert made(store) == []
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]  # March: the family files the form for Emma
    await build(store)
    assert made(store) == [(NOAH, SESSION_2, "summer", 1800.0)]


# -- row 11: the ask after the form ---------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_11_a_twr_ask_in_october_fires_on_the_run_after_it_is_captured() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    await build(store)
    assert made(store) == []
    register(store, EMMA, JOHNSON, TWR, day="2027-10-02")
    await build(store)
    assert made(store) == []  # registered, but the ask is not captured yet
    ask(store, EMMA, 250.0, "2027-10-02T16:00:00.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 250.0)]


# -- row 12: the slot overwritten before the form --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_12_an_ask_overwritten_before_the_form_still_fires_from_history() -> None:
    store = make_store()
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, BMITZVAH, day="2027-06-03")
    ask(store, EMMA, 5000.0, "2027-06-03T20:00:00.000+00:00")
    register(store, EMMA, JOHNSON, FAMILY_CAMP_2, day="2027-07-10")
    ask(store, EMMA, 1500.0, "2027-07-10T20:00:00.000+00:00")  # the Family Camp registration overwrote the slot
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]  # the form lands in August
    await build(store)
    assert made(store) == [(EMMA, BMITZVAH, "bmitzvah", 5000.0)]


# -- row 13: the slot changes after firing ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_13_a_later_amount_and_then_zero_leave_the_addition_and_its_request_alone() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    (request_id,) = [r.id for r in store.requests.values() if r.session_cm_id == TWR]
    for amount, at in ((600.0, "2027-10-05T21:00:00.000+00:00"), (0.0, "2027-10-09T21:00:00.000+00:00")):
        ask(store, EMMA, amount, at)
        report = await build(store)
        assert report.operation_id == ""  # nothing written
    assert made(store) == [(EMMA, TWR, "summer", 290.0)]
    assert (store.requests[request_id].ask, store.requests[request_id].status) == (290.0, "active")


# -- row 14: staff remove the rule-made addition ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_14_a_removed_rule_made_request_is_never_made_again() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    (addition,) = rule_made(store)
    await FinancialAidCaseworkService(store).retire_addition(YEAR, addition.id, "Asked in error", ACTOR)
    for _ in range(2):
        report = await build(store)
        assert report.registration_ask_added == 0
    assert [a.id for a in rule_made(store)] == [addition.id]
    assert not store.additions[addition.id].live
    assert request_on(store, EMMA, TWR) == []


# -- row 15: waitlisted, later enrolled ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_15_a_waitlisted_camper_fires_on_the_run_after_they_are_enrolled() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30", status=8)
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)
    set_status(store, EMMA, TWR, 2)  # enrolled weeks later; the registration day is unchanged
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 290.0)]


# -- row 16: the enrollment is cancelled after firing ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_16_a_cancelled_enrollment_flags_the_request_not_enrolled_and_keeps_the_addition() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    set_status(store, EMMA, TWR, 32)  # cancelled: no longer a registered status
    await build(store)
    (addition,) = rule_made(store)
    assert addition.live
    (request,) = [r for r in store.requests.values() if r.program_option_key == f"registration_ask:{TWR}"]
    assert any(f.get("code") == "not_enrolled" for f in request.flags)


# -- row 17: Hebrew, school and other session types -------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("session", [HEBREW, SCHOOL, OTHER])
async def test_row_17_hebrew_school_and_other_sessions_never_get_a_request(session: int) -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, session, day="2027-08-20")
    ask(store, EMMA, 700.0, "2027-08-20T18:00:00.000+00:00")
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)


# -- row 18: two runs in a row ----------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_18_two_runs_in_a_row_make_one_addition() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    first = await build(store)
    second = await build(store)
    assert (first.registration_ask_added, second.registration_ask_added) == (1, 0)
    assert second.operation_id == ""
    assert len(rule_made(store)) == 1


# -- row 19: same-day edits -------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_19_of_two_attributable_rows_the_latest_amount_wins() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 650.0, "2027-09-30T23:10:00.000+00:00")  # captured first, typed later the same day
    ask(store, EMMA, 500.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    assert made(store) == [(EMMA, TWR, "summer", 650.0)]


# -- row 20: an AG session and its parent main session, the same day ----------------------------------------------------------


@pytest.mark.asyncio
async def test_row_20_an_ag_session_and_its_parent_registered_together_are_one_registration() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Taste of Camp 1"), fa_row(NOAH, JOHNSON, registration_ask=2000.0)]
    register(store, EMMA, JOHNSON, TASTE_1, day="2026-11-12")
    register(store, NOAH, JOHNSON, SESSION_2, day="2026-11-13", status=32)  # switched to the AG cabins that day
    register(store, NOAH, JOHNSON, AG_2, day="2026-11-13")
    ask(store, NOAH, 2000.0, "2026-11-13T18:00:00.000+00:00")
    report = await build(store)
    assert made(store) == [(NOAH, AG_2, "summer", 2000.0)]
    assert report.registration_ask_ambiguous == 0


@pytest.mark.asyncio
async def test_row_20_an_ag_session_and_its_parent_both_enrolled_get_one_request_however_many_runs() -> None:
    """Scan of #3270: one registration is one request. The AG session and its parent both at status 2 make the AG's
    request, the parent is not reported unattributed, and the next run never makes a second one on the parent."""
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Taste of Camp 1"), fa_row(NOAH, JOHNSON, registration_ask=2000.0)]
    register(store, EMMA, JOHNSON, TASTE_1, day="2026-11-12")
    register(store, NOAH, JOHNSON, SESSION_2, day="2026-11-13")
    register(store, NOAH, JOHNSON, AG_2, day="2026-11-13")
    ask(store, NOAH, 2000.0, "2026-11-13T18:00:00.000+00:00")
    first = await build(store)
    second = await build(store)
    assert made(store) == [(NOAH, AG_2, "summer", 2000.0)]
    assert (first.registration_ask_added, second.registration_ask_added) == (1, 0)
    assert (first.registration_ask_unattributed, first.registration_ask_ambiguous) == (0, 0)


def test_row_20_a_request_on_the_parent_holds_its_ag_session_too() -> None:
    """Scan of #3270: the parent session already has the camper's request (a form-made one), so the AG session
    registered with it that day is the same registration and the rule makes no second request on it."""
    result = registration_ask_additions(
        YEAR,
        fa_rows=[summer(NOAH, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[
            AttendeeDates(NOAH, JOHNSON, SESSION_2, 2, "2026-11-13 00:00:00.000Z", "2026-11-13 19:00:00.000Z"),
            AttendeeDates(NOAH, JOHNSON, AG_2, 2, "2026-11-13 00:00:00.000Z", "2026-11-13 19:00:00.000Z"),
        ],
        history=[AskHistoryRow(NOAH, 2000.0, "2026-11-13T18:00:00.000+00:00")],
        additions=[],
        requests=[_request(NOAH, SESSION_2, "active")],
    )
    assert (result.additions, result.ambiguous, result.unattributed) == ((), (), ())


# -- row 21: the same shapes in 2026 write nothing ----------------------------------------------------------------------------


def _firing_shapes(store: FakeAidStore) -> None:
    """Rows 1, 4 and 9 at once: each fires in 2027."""
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2"), fa_row(NOAH, JOHNSON, registration_ask=1800.0)]
    register(store, EMMA, JOHNSON, SESSION_2, day="2025-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2026-09-30")
    register(store, NOAH, JOHNSON, SESSION_2, day="2025-11-12")
    register(store, OLIVIA, CHEN, BMITZVAH, day="2026-07-27")
    store.fa_rows.append(summer(OLIVIA, CHEN, "Session 2"))
    register(store, OLIVIA, CHEN, SESSION_2, day="2025-11-12")
    ask(store, EMMA, 290.0, "2026-09-30T21:00:00.000+00:00")
    ask(store, NOAH, 1800.0, "2025-11-12T18:00:00.000+00:00")
    ask(store, OLIVIA, 5000.0, "2026-07-28T05:40:00.000+00:00")


@pytest.mark.asyncio
async def test_row_21_in_2026_the_rule_writes_nothing_and_reads_no_history() -> None:
    store = make_store()
    _firing_shapes(store)
    report = await build(store, 2026)
    assert made(store) == []
    assert (report.registration_ask_added, report.registration_ask_ambiguous, report.registration_ask_unattributed) == (
        0,
        0,
        0,
    )
    assert not any(r.program_option_key.startswith("registration_ask:") for r in store.requests.values())


@pytest.mark.asyncio
async def test_row_21_the_same_shapes_fire_in_2027() -> None:
    store = make_store()
    _firing_shapes(store)
    report = await build(store)
    assert report.registration_ask_added == 3


def test_row_21_the_pure_rule_is_off_before_its_first_season() -> None:
    result = registration_ask_additions(
        REGISTRATION_ASK_RULE_FIRST_SEASON - 1,
        fa_rows=[summer(EMMA, JOHNSON, "Session 2")],
        sessions=SEASON_SESSIONS,
        attendees=[AttendeeDates(EMMA, JOHNSON, TWR, 2, "2026-09-30 00:00:00.000Z", "2026-09-30 19:00:00.000Z")],
        history=[AskHistoryRow(EMMA, 290.0, "2026-09-30T21:00:00.000+00:00")],
        additions=[],
        requests=[],
    )
    assert (result.additions, result.ambiguous, result.unattributed) == ((), (), ())


# -- row 22: one operation, and the report -------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_row_22_the_addition_and_its_request_land_in_the_runs_one_operation_and_the_report_counts() -> None:
    store = _row_8_store()  # Emma: one unattributed (her B*Mitzvah)
    register(store, NOAH, JOHNSON, SESSION_2, day="2026-11-12")  # Noah: fires
    ask(store, NOAH, 1800.0, "2026-11-12T18:01:00.000+00:00")
    register(store, RILEY, JOHNSON, TASTE_1, day="2026-11-14")  # Riley: ambiguous (Taste of Camp 1 + Family Camp 2)
    register(store, RILEY, JOHNSON, FAMILY_CAMP_2, day="2026-11-14")
    ask(store, RILEY, 900.0, "2026-11-14T18:00:00.000+00:00")
    report = await build(store)
    assert (report.registration_ask_added, report.registration_ask_ambiguous, report.registration_ask_unattributed) == (
        1,
        1,
        1,
    )
    (operation,) = store.operations
    collections = [(w.collection, w.action) for w in operation["writes"]]
    assert ("aid_request_additions", "create") in collections
    assert ("aid_requests", "create") in collections
    assert operation["actor"] == "system:intake"
    assert {row["operation_id"] for row in store.change_log} == {report.operation_id}
    (logged,) = [row for row in store.change_log if row["entity"] == "aid_request_additions"]
    assert logged["action"] == "add_request"
    assert logged["reason"] == "CampMinder registration ask $1,800, typed 2026-11-12 at this session's registration"
    assert logged["after"]["source"] == "registration_ask"
    assert logged["after"]["actor"] == REGISTRATION_ASK_ACTOR


@pytest.mark.asyncio
async def test_row_22_the_run_logs_counts_never_names(caplog: pytest.LogCaptureFixture) -> None:
    store = _row_7_store()
    with caplog.at_level("INFO"):
        await build(store)
    line = next(r.getMessage() for r in caplog.records if "intake built" in r.getMessage())
    assert "registration_ask_added=0 registration_ask_ambiguous=1 registration_ask_unattributed=0" in line
    assert str(NOAH) not in line


# -- Needs a look, end to end (owner: it sits there until Mark Reviewed) -----------------------------------------------------


@pytest.mark.asyncio
async def test_a_rule_made_request_sits_in_needs_a_look_until_mark_reviewed() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    (addition,) = rule_made(store)

    def emma(rows: Sequence[FormIntakeRowOut]) -> FormIntakeRowOut:
        return next(r for r in rows if r.person_cm_id == EMMA)

    row = emma((await FormIntakeService(store).forms(YEAR)).rows)
    assert row.look_reasons == ["registration_ask_unreviewed"]
    assert row.why_not is None

    await FinancialAidCaseworkService(store).review_addition(YEAR, addition.id, ACTOR)
    await build(store)
    row = emma((await FormIntakeService(store).forms(YEAR)).rows)
    assert (row.needs_look, row.look_reasons) == (False, [])


# -- Season › History (brief item 6): a rule-made add reads as a staff add does, inside its intake run -----------------


@pytest.mark.asyncio
async def test_history_shows_the_rule_made_add_as_request_added_about_the_camper_in_the_intake_run() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, TWR, day="2027-09-30")
    ask(store, EMMA, 290.0, "2027-09-30T21:00:00.000+00:00")
    await build(store)
    entries = [
        entry_of(SimpleNamespace(**row, id=f"log{n:012d}", created=f"2027-10-01 04:00:{n:02d}.000Z"))
        for n, row in enumerate(store.change_log)
    ]
    (operation,) = operations(e for e in entries if e is not None)
    # The run is one operation, an intake tick: it shows with "Show the nightly intake runs" (hidden by default).
    assert operation.kind == "intake"
    assert visible(operation, HistoryFilter(include_intake=True))
    assert not visible(operation, HistoryFilter())
    (added,) = [e for e in operation.entries if e.entity == "aid_request_additions"]
    assert added.action == "add_request"  # historyModel's "Request added", as a staff add logs its addition
    assert added.reason.startswith("CampMinder registration ask $290")
    subjects = subjects_from(
        [SimpleNamespace(**vars(r)) for r in store.requests.values()],
        [],
        [],
        additions=[SimpleNamespace(**vars(a)) for a in store.additions.values()],
    )
    subject = subjects.of(added.entity, added.entity_id)
    assert subject is not None
    assert (subject.household_cm_id, subject.person_cm_id, subject.session_cm_id) == (JOHNSON, EMMA, TWR)
    assert subject.request_id == next(r.id for r in store.requests.values() if r.session_cm_id == TWR)

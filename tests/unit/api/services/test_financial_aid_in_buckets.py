"""IN-BUCKETS (owner 2026-10-28), 2027 on: each kind of program is its own bucket, judged on its own facts.

The owner, verbatim: "if the summer aid form was filed, only the summer enrollment status should be checked. summer
registration should not impact if we're looking at aid for family, or adult programs, and vice versa for each
situation. they are separate buckets and people need to fill out the correct aid form for the requisite type of
sessinon(s) being attended, else they haven't actually asked for aid - and they can't ask for that aid without being
registered for the correct type of session"

The buckets (IB-1 = yes): summer (Quest and the teen programs TWR, SCIT and TLI included), B*Mitzvah, Family Camp and
adult weekends. IB-2 = yes: 2027 forward only; 2026 is the tie-off season and behaves exactly as before. IB-3: one
household income answer set still prices every bucket (untouched here).

This file holds the registration-ask rule's half (financial_aid_registration_ask); Form intake's half follows. Every
person, household and session is fictional (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from api.schemas.financial_aid_form_intake import FormIntakeRowOut
from api.services.financial_aid_form_intake import IN_BUCKETS_FIRST_SEASON, FormIntakeService
from api.services.financial_aid_household import ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AttendeeRow, FaRow
from api.services.financial_aid_registration_ask import (
    AskHistoryRow,
    AttendeeDates,
    RegistrationAskResult,
    registration_ask_additions,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row
from tests.unit.api.services.test_financial_aid_registration_ask import (
    BMITZVAH,
    EMMA,
    FAMILY_CAMP_2,
    JOHNSON,
    NOAH,
    QUEST,
    SEASON_SESSIONS,
    SESSION_2,
    TASTE_1,
    TWR,
    ask,
    build,
    made,
    make_store,
    register,
    summer,
)

ADULT_WEEKEND_A = 1000401  # the fakes' adult weekend (financial_aid_fakes.SESSIONS)
ASK_DAY = "2027-01-12"
ASK_AT = "2027-01-12T18:00:00.000+00:00"


def family_camp_form(person: int = EMMA) -> FaRow:
    return fa_row(person, JOHNSON, fc="Family Camp 2", fc_ask=900.0, total_gross_income=85000.0)


def bmitzvah_form(person: int = EMMA) -> FaRow:
    return fa_row(person, JOHNSON, tbm="B*Mitzvah", tbm_ask=2000.0, total_gross_income=85000.0)


def rule(fa_rows: list[FaRow], attendees: list[AttendeeDates], history: list[AskHistoryRow]) -> RegistrationAskResult:
    return registration_ask_additions(
        YEAR,
        fa_rows=fa_rows,
        sessions=SEASON_SESSIONS,
        attendees=attendees,
        history=history,
        additions=[],
        requests=[],
    )


def dated(person: int, session: int, day: str = ASK_DAY, status: int = 2) -> AttendeeDates:
    return AttendeeDates(person, JOHNSON, session, status, f"{day} 00:00:00.000Z", f"{day} 19:00:00.000Z")


# -- item 1: a filing for another bucket makes no summer request -----------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "form",
    [pytest.param(family_camp_form, id="family-camp-only"), pytest.param(bmitzvah_form, id="bmitzvah-only")],
)
async def test_a_filing_for_another_bucket_makes_no_summer_request_from_a_siblings_ask(
    form: Callable[[], FaRow],
) -> None:
    store = make_store()
    store.fa_rows = [form()]
    register(store, NOAH, JOHNSON, SESSION_2, day=ASK_DAY)
    ask(store, NOAH, 1500.0, ASK_AT)
    report = await build(store)
    assert made(store) == []
    # Not a target at all: nothing for Form intake to explain as ambiguous or unattributed either.
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)


@pytest.mark.asyncio
async def test_a_summer_filing_still_makes_a_siblings_summer_request() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, NOAH, JOHNSON, QUEST, day=ASK_DAY)
    ask(store, NOAH, 1500.0, ASK_AT)
    await build(store)
    assert made(store) == [(NOAH, QUEST, "summer", 1500.0)]


# -- item 2: a summer filing makes no B*Mitzvah request (IB-1) -------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_summer_filing_makes_no_bmitzvah_request_from_the_campers_ask() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
    register(store, EMMA, JOHNSON, SESSION_2, day="2026-11-12")
    register(store, EMMA, JOHNSON, BMITZVAH, day="2027-07-27")
    ask(store, EMMA, 5000.0, "2027-07-28T05:40:00.000+00:00")
    report = await build(store)
    assert made(store) == []
    assert (report.registration_ask_ambiguous, report.registration_ask_unattributed) == (0, 0)


@pytest.mark.asyncio
async def test_a_bmitzvah_filing_makes_a_siblings_bmitzvah_request_from_their_ask() -> None:
    # The B*Mitzvah question answered on the household's form (for Emma) opens the bucket; Noah's own B*Mitzvah
    # registration ask then makes his request, as a summer filing does for a sibling's summer session.
    store = make_store()
    store.fa_rows = [bmitzvah_form(EMMA)]
    register(store, EMMA, JOHNSON, BMITZVAH, day="2026-11-12")
    register(store, NOAH, JOHNSON, BMITZVAH, day="2027-07-27")
    ask(store, NOAH, 5000.0, "2027-07-28T05:40:00.000+00:00")
    await build(store)
    assert made(store) == [(NOAH, BMITZVAH, "bmitzvah", 5000.0)]


# -- item 3: only registrations in the target's bucket make an ask ambiguous ----------------------------------------------


@pytest.mark.parametrize(
    "other",
    [
        pytest.param(FAMILY_CAMP_2, id="family-camp-same-day"),
        pytest.param(ADULT_WEEKEND_A, id="adult-weekend-same-day"),
        pytest.param(BMITZVAH, id="bmitzvah-same-day-not-filed"),
    ],
)
def test_another_buckets_registration_the_same_day_does_not_make_a_summer_ask_ambiguous(other: int) -> None:
    result = rule(
        [summer(EMMA, JOHNSON, "Session 2")],
        [dated(EMMA, SESSION_2, "2026-11-12"), dated(NOAH, TASTE_1), dated(NOAH, other)],
        [AskHistoryRow(NOAH, 1500.0, ASK_AT)],
    )
    assert [(a.person_cm_id, a.session_cm_id, a.program_key, a.ask) for a in result.additions] == [
        (NOAH, TASTE_1, "summer", 1500.0)
    ]
    assert result.ambiguous == ()


def test_two_summer_registrations_the_same_day_are_still_ambiguous() -> None:
    result = rule(
        [summer(EMMA, JOHNSON, "Session 2")],
        [dated(EMMA, SESSION_2, "2026-11-12"), dated(NOAH, TASTE_1), dated(NOAH, TWR)],
        [AskHistoryRow(NOAH, 1500.0, ASK_AT)],
    )
    assert result.additions == ()
    assert sorted((f.person_cm_id, f.session_cm_id) for f in result.ambiguous) == [(NOAH, TASTE_1), (NOAH, TWR)]


def test_with_both_buckets_filed_one_ask_on_a_summer_and_a_bmitzvah_registration_is_judged_per_bucket() -> None:
    # The literal reading of "only registrations in the target's bucket count": each bucket has one registration that
    # day, so each is attributed. Pinned so a change to it is deliberate (the PR names it for an owner ruling).
    result = rule(
        [summer(EMMA, JOHNSON, "Session 2"), bmitzvah_form(EMMA)],
        [
            dated(EMMA, SESSION_2, "2026-11-12"),
            dated(EMMA, BMITZVAH, "2026-11-12"),
            dated(NOAH, TASTE_1),
            dated(NOAH, BMITZVAH),
        ],
        [AskHistoryRow(NOAH, 1500.0, ASK_AT)],
    )
    assert sorted((a.person_cm_id, a.session_cm_id, a.program_key) for a in result.additions) == [
        (NOAH, TASTE_1, "summer"),
        (NOAH, BMITZVAH, "bmitzvah"),
    ]


# -- 2026 is the tie-off season: the rule never runs there ---------------------------------------------------------------


@pytest.mark.parametrize("form", [family_camp_form, bmitzvah_form])
def test_the_rule_still_makes_nothing_in_2026(form: Callable[[], FaRow]) -> None:
    result = registration_ask_additions(
        2026,
        fa_rows=[form()],
        sessions=SEASON_SESSIONS,
        attendees=[dated(NOAH, SESSION_2)],
        history=[AskHistoryRow(NOAH, 1500.0, ASK_AT)],
        additions=[],
        requests=[],
    )
    assert result == RegistrationAskResult()


# == Form intake (financial_aid_form_intake) ==============================================================================
# Each person row is judged per bucket. A registration ask is the camper form's (CA-) or the adult-weekend form's
# (WW-), read from its own column pair (migration 1500000253); the camper ask is for the buckets the person is
# registered in, the adult-weekend ask for adult weekends. A bucket the household filed no aid form for makes the ask
# "Registration ask only" for that bucket (IN-FORM-ONLY = A: no aid form for it, no request), and no aid form covers
# adult weekends yet. 2026 reads everything exactly as before.

PARENT = 1000013  # an adult of the Johnsons' household (fictional)
FORM_YEAR = 2027


def camper_asker(person: int, amount: float = 1500.0, **form: Any) -> FaRow:
    """A row with the camper registration ask, both pairs as the sync writes them."""
    return fa_row(
        person, JOHNSON, interest=True, registration_ask=amount, camper_interest=True, camper_ask=amount, **form
    )


def weekend_asker(person: int, amount: float = 400.0, **form: Any) -> FaRow:
    """A row with the adult-weekend registration ask, both pairs as the sync writes them."""
    return fa_row(
        person, JOHNSON, interest=True, registration_ask=amount, weekend_interest=True, weekend_ask=amount, **form
    )


def enrol(store: FakeAidStore, person: int, session: int, status: int = 2) -> None:
    store.attendees.append(AttendeeRow(person, JOHNSON, session, status))


async def rows_of(store: FakeAidStore, year: int, *, built: bool = True) -> dict[int, FormIntakeRowOut]:
    if built:
        await FinancialAidIntakeService(store).build(year)
    out = await FormIntakeService(store).forms(year)
    return {r.person_cm_id: r for r in out.rows if r.household_cm_id == JOHNSON}


def facts(r: FormIntakeRowOut) -> tuple[object, ...]:
    return (r.filed, r.registration_only, r.registration_only_programs, r.why_not, r.needs_look)


# -- item 4: the household's filing for another bucket no longer decides a person row ------------------------------------


def _family_camp_filed_sibling_asks_for_summer() -> FakeAidStore:
    store = make_store()
    store.fa_rows = [family_camp_form(EMMA), camper_asker(NOAH)]
    enrol(store, EMMA, FAMILY_CAMP_2)
    enrol(store, NOAH, SESSION_2)
    return store


@pytest.mark.asyncio
async def test_a_summer_ask_beside_a_family_camp_filing_is_registration_ask_only_for_summer() -> None:
    noah = (await rows_of(_family_camp_filed_sibling_asks_for_summer(), FORM_YEAR))[NOAH]
    assert facts(noah) == (True, True, ["summer"], "registration_only", False)
    assert ([g.session_cm_id for g in noah.gap_sessions], noah.can_add) == ([SESSION_2], True)


@pytest.mark.asyncio
async def test_2026_judges_that_summer_ask_by_the_households_filing_as_before() -> None:
    noah = (await rows_of(_family_camp_filed_sibling_asks_for_summer(), 2026))[NOAH]
    assert facts(noah) == (True, False, [], "enrolled_no_request", True)
    assert "registration_only_programs" not in noah.model_dump(mode="json")


def _summer_filed_camper_asks_for_bmitzvah() -> FakeAidStore:
    store = make_store()
    store.fa_rows = [camper_asker(EMMA, summer="Session 2", summer_ask=3000.0, total_gross_income=85000.0)]
    enrol(store, EMMA, SESSION_2)
    enrol(store, EMMA, BMITZVAH)
    return store


@pytest.mark.asyncio
async def test_a_bmitzvah_enrolment_beside_a_summer_filing_is_registration_ask_only_for_bmitzvah() -> None:
    emma = (await rows_of(_summer_filed_camper_asks_for_bmitzvah(), FORM_YEAR))[EMMA]
    # Her summer request stands; the B*Mitzvah has no aid form, so the ask is the only signal and it needs no look.
    assert facts(emma) == (True, True, ["bmitzvah"], "registration_only", False)
    assert [(b.program_key, b.status) for b in emma.became] == [("summer", "active")]
    assert [g.session_cm_id for g in emma.gap_sessions] == [BMITZVAH]


@pytest.mark.asyncio
async def test_2026_reads_that_bmitzvah_gap_as_needs_a_look_as_before() -> None:
    emma = (await rows_of(_summer_filed_camper_asks_for_bmitzvah(), 2026))[EMMA]
    assert facts(emma) == (True, False, [], "enrolled_no_request", True)


@pytest.mark.asyncio
async def test_a_summer_ask_in_a_summer_filed_household_is_not_registration_ask_only() -> None:
    store = make_store()
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2"), camper_asker(NOAH)]
    enrol(store, EMMA, SESSION_2)
    enrol(store, NOAH, SESSION_2)
    noah = (await rows_of(store, FORM_YEAR, built=False))[NOAH]
    # The summer bucket was filed: an enrolment no request holds is a gap that needs a look, as before.
    assert facts(noah) == (True, False, [], "enrolled_no_request", True)


@pytest.mark.asyncio
async def test_a_household_that_filed_nothing_reads_today_s_words() -> None:
    store = make_store()
    store.fa_rows = [camper_asker(NOAH)]
    enrol(store, NOAH, SESSION_2)
    noah = (await rows_of(store, FORM_YEAR))[NOAH]
    assert facts(noah) == (False, True, ["summer"], "registration_only", False)


# -- items 5 and 7: a correct reason in 2027 where "no adult is registered" and "enrolled anywhere" misled ------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "why_2027"),
    [
        pytest.param(None, "registration_ask_not_registered", id="registered-for-nothing"),
        pytest.param(8, "registration_ask_not_enrolled", id="waitlisted-for-summer"),
    ],
)
async def test_a_siblings_ask_that_is_not_enrolled_gets_a_per_bucket_reason_from_2027(
    status: int | None, why_2027: str
) -> None:
    def store_() -> FakeAidStore:
        store = make_store()
        store.fa_rows = [summer(EMMA, JOHNSON, "Session 2"), camper_asker(NOAH)]
        enrol(store, EMMA, SESSION_2)
        if status is not None:
            enrol(store, NOAH, SESSION_2, status)
        return store

    noah_2027 = (await rows_of(store_(), FORM_YEAR))[NOAH]
    assert facts(noah_2027) == (True, False, [], why_2027, False)
    noah_2026 = (await rows_of(store_(), 2026))[NOAH]
    # 2026 keeps its words, "no adult is registered for it", wrong as they are for a camper: it is frozen.
    assert facts(noah_2026) == (True, False, [], "adult_not_registered", False)


@pytest.mark.asyncio
async def test_a_summer_answer_with_only_a_family_camp_enrolment_reads_not_enrolled_from_2027() -> None:
    def store_() -> FakeAidStore:
        store = make_store()
        store.fa_rows = [summer(EMMA, JOHNSON, "Session 2")]
        enrol(store, EMMA, FAMILY_CAMP_2)
        return store

    # Read before intake runs (no request yet): only the summer bucket's sessions say whether she is enrolled.
    assert (await rows_of(store_(), FORM_YEAR, built=False))[EMMA].why_not == "not_enrolled"
    assert (await rows_of(store_(), 2026, built=False))[EMMA].why_not is None


# -- item 6: an adult's adult-weekend ask is judged on adult-weekend facts only ------------------------------------------


@pytest.mark.asyncio
async def test_a_family_camp_answer_on_the_adults_own_row_no_longer_hides_their_adult_weekend_ask() -> None:
    def store_() -> FakeAidStore:
        store = make_store()
        store.fa_rows = [weekend_asker(PARENT, fc="Family Camp 2", fc_ask=900.0, total_gross_income=85000.0)]
        enrol(store, PARENT, FAMILY_CAMP_2)
        enrol(store, PARENT, ADULT_WEEKEND_A)
        return store

    parent = (await rows_of(store_(), FORM_YEAR))[PARENT]
    assert facts(parent) == (True, True, ["adult_weekend"], "registration_only", False)
    assert parent.registration_ask is not None
    assert parent.registration_ask.amount == 400.0
    assert ([g.session_cm_id for g in parent.gap_sessions], parent.can_add) == ([ADULT_WEEKEND_A], True)
    assert PARENT not in await rows_of(store_(), 2026)  # 2026: the row stays as it was, hidden


@pytest.mark.asyncio
async def test_an_adults_summer_answer_does_not_put_their_adult_weekend_ask_in_needs_a_look() -> None:
    # CodeRabbit on #3318: the summer answer made interest_only false, so the adult-weekend gap needed a look.
    store = make_store()
    store.fa_rows = [weekend_asker(PARENT, summer="Session 2", summer_ask=500.0, total_gross_income=85000.0)]
    enrol(store, PARENT, ADULT_WEEKEND_A)
    parent = (await rows_of(store, FORM_YEAR))[PARENT]
    assert facts(parent) == (True, True, ["adult_weekend"], "registration_only", False)
    assert parent.look_reasons == []


@pytest.mark.asyncio
async def test_a_camper_ask_beside_an_adult_weekend_ask_on_one_row_keeps_both_buckets() -> None:
    # Item 10's other half: the two asks no longer share a column, so each bucket sees its own.
    store = make_store()
    row = fa_row(PARENT, JOHNSON, interest=True, registration_ask=500.0, camper_interest=True, camper_ask=500.0,
                 weekend_interest=True, weekend_ask=300.0)  # fmt: skip
    store.fa_rows = [summer(EMMA, JOHNSON, "Session 2"), row]
    enrol(store, EMMA, SESSION_2)
    enrol(store, PARENT, SESSION_2)
    enrol(store, PARENT, ADULT_WEEKEND_A)
    parent = (await rows_of(store, FORM_YEAR, built=False))[PARENT]
    # Summer was filed (a needs-look gap, as for any sibling the form missed); adult weekends were not.
    assert facts(parent) == (True, True, ["adult_weekend"], "enrolled_no_request", True)
    assert parent.look_reasons == ["enrolled_no_request"]


# -- counts, the summary and Today's line follow the rows ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_counts_summary_and_todays_line_follow_the_per_bucket_rows() -> None:
    for year, expected in ((FORM_YEAR, (1, 0)), (2026, (0, 1))):
        store = _family_camp_filed_sibling_asks_for_summer()
        await FinancialAidIntakeService(store).build(year)
        service = FormIntakeService(store)
        out = await service.forms(year)
        summary = await service.summary(year)
        look = await service.needs_a_look(year)
        assert (out.counts.registration_only, out.counts.needs_look) == expected
        assert (summary.registration_only, summary.needs_look) == expected
        assert len(look.rows) == expected[1]


def test_the_bucket_gate_moves_with_the_adult_weekend_form_only_gate() -> None:
    assert IN_BUCKETS_FIRST_SEASON == 2027
    # Form intake lists an adult-weekend ask as registration ask only from IN_BUCKETS_FIRST_SEASON; intake stops making
    # its request from ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON. Listing an ask the season still makes a request from would
    # be wrong, so the bucket gate is never the earlier one.
    assert IN_BUCKETS_FIRST_SEASON >= ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON


@pytest.mark.asyncio
async def test_an_adult_weekend_ask_beside_a_family_camp_answer_shows_even_when_not_registered() -> None:
    # CodeRabbit on #3320: the Family Camp answer is the household row's, and an adult-weekend ask is never that row's,
    # so the adult keeps their own row and its reason though they are registered for no adult weekend.
    store = make_store()
    store.fa_rows = [weekend_asker(PARENT, fc="Family Camp 2", fc_ask=900.0, total_gross_income=85000.0)]
    enrol(store, PARENT, FAMILY_CAMP_2)
    parent = (await rows_of(store, FORM_YEAR))[PARENT]
    assert facts(parent) == (True, False, [], "registration_ask_not_registered", False)

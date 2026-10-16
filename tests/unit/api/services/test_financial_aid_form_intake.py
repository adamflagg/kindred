"""Requests › Form intake's explain service (PR 3; spec 71 §2.4): every aid form answer and registration ask, the
request it became or why not, CampMinder's aid on the family, and Needs a look (owner rulings 1a-5a).

Every request here is made by intake's own build (or casework's add), so the rows explain what intake really did.
Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from api.schemas.financial_aid_form_intake import FormIntakeResponse, FormIntakeRowOut
from api.services.financial_aid_addition_view import addition_view, additions_by_request_key
from api.services.financial_aid_campminder_money import aid_on_no_request
from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AdditionRecord, AttendeeRow, FaRow
from api.services.financial_aid_reconciliation import CampLine
from bunking.financial_aid.decisions.budget import TOTAL
from bunking.financial_aid.decisions.rounds import DecisionEvent
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row
from tests.unit.api.services.test_financial_aid_request_additions import ACTOR, WINTER, make_store

SESSION_2, TASTE_1, TASTE_2 = 1000101, 1000104, 1000105
FAMILY_CAMP_6 = 1000202
ADULT_A = 1000401

# Households and people (fictional): the Johnsons file for Emma (summer) and she is also in the winter retreat;
# Samuel Johnson is on the form too. The Chens' Olivia asks "Session 2 or Taste 2" and is in both. The Sams never
# filed the aid form: Riley asked at registration only. Liam Garcia's row on the form names no household.
JOHNSON, EMMA, SAMUEL = 1000001, 1000011, 1000012
CHEN, OLIVIA = 1000003, 1000031
SAM, RILEY = 1000004, 1000041
GARCIA_NONE, LIAM = 0, 1000051
OKAFOR = 1000006  # Family Camp only, never on the form


def enrolled(person: int, household: int, *sessions: int, status: int = 2) -> list[AttendeeRow]:
    return [AttendeeRow(person, household, s, status) for s in sessions]


def camp(txn: int, household: int, amount: str, *, session: int, person: int = 0, day: int = 20) -> CampLine:
    return CampLine(
        transaction_cm_id=txn,
        household_cm_id=household,
        person_cm_id=person,
        amount=Decimal(amount),
        post_date=datetime(YEAR, 2, day, 18, 0, tzinfo=UTC),
        is_reversed=False,
        reversal_date=None,
        attributed_person_cm_id=person,
        attributed_session_cm_id=session,
    )


async def intake(*rows: FaRow, attendees: list[AttendeeRow], lines: Sequence[CampLine] = ()) -> FakeAidStore:
    store = make_store(*rows, attendees=attendees)
    store.camp_lines = list(lines)
    await FinancialAidIntakeService(store).build(YEAR)
    return store


async def forms(store: FakeAidStore, **kwargs: Any) -> FormIntakeResponse:
    return await FormIntakeService(store, **kwargs).forms(YEAR)


def row(out: FormIntakeResponse, household: int, person: int) -> FormIntakeRowOut:
    found = [r for r in out.rows if (r.household_cm_id, r.person_cm_id) == (household, person)]
    assert len(found) == 1, [r.key for r in out.rows]
    return found[0]


# -- what each answer became --------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_form_answer_that_became_an_active_request_needs_no_look() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0, total_gross_income=70000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2),
    )
    out = await forms(store)
    emma = row(out, JOHNSON, EMMA)
    assert (emma.key, emma.filed, emma.registration_only) == (f"{JOHNSON}:{EMMA}", True, False)
    assert [(a.program_key, a.option_text, a.ask) for a in emma.answers] == [("summer", "Session 2", 3000.0)]
    assert emma.enrolled_session_cm_ids == [SESSION_2]
    (became,) = emma.became
    assert (became.status, became.origin, became.session_cm_id, became.why) == ("active", "form", SESSION_2, None)
    assert (emma.why_not, emma.gap_sessions, emma.needs_look, emma.can_add) == (None, [], False, False)
    assert emma.camper_name == f"Camper {EMMA}"  # the store's display name
    assert emma.household_label == f"Family {JOHNSON}"


@pytest.mark.asyncio
async def test_an_enrolled_session_no_request_holds_is_a_gap_add_a_request_may_add() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2, WINTER),
    )
    emma = row(await forms(store), JOHNSON, EMMA)
    assert [(g.session_cm_id, g.program_key, g.campminder_amount) for g in emma.gap_sessions] == [
        (WINTER, "summer", None)
    ]
    assert (emma.why_not, emma.can_add, emma.needs_look, emma.look_reasons) == (
        "enrolled_no_request",
        True,
        True,
        ["enrolled_no_request"],
    )

    # Added: the gap closes and the request is marked added, with who, when and why.
    await FinancialAidCaseworkService(store).add_request(YEAR, JOHNSON, EMMA, WINTER, 290.0, "Asked at retreat", ACTOR)
    emma = row(await forms(store), JOHNSON, EMMA)
    assert (emma.gap_sessions, emma.why_not, emma.needs_look) == ([], None, False)
    added = next(b for b in emma.became if b.origin == "added")
    assert (added.status, added.session_cm_id, added.added_by, added.added_reason) == (
        "active",
        WINTER,
        ACTOR,
        "Asked at retreat",
    )
    assert added.addition_id


@pytest.mark.asyncio
async def test_an_unclear_session_holds_every_candidate_and_needs_a_look() -> None:
    store = await intake(
        fa_row(OLIVIA, CHEN, summer="Session 2 or Taste of Camp 2", summer_ask=3500.0),
        attendees=enrolled(OLIVIA, CHEN, SESSION_2, TASTE_2),
    )
    olivia = row(await forms(store), CHEN, OLIVIA)
    (became,) = olivia.became
    assert (became.status, sorted(became.candidate_session_cm_ids), became.session_cm_id) == (
        "session_unclear",
        [SESSION_2, TASTE_2],
        0,
    )
    assert olivia.gap_sessions == []
    assert olivia.look_reasons == ["session_unclear"]


@pytest.mark.asyncio
async def test_an_answer_with_no_enrolled_session_is_not_enrolled_and_needs_no_look() -> None:
    store = await intake(fa_row(SAMUEL, JOHNSON, summer="Session 2", summer_ask=3000.0), attendees=[])
    samuel = row(await forms(store), JOHNSON, SAMUEL)
    (became,) = samuel.became
    assert (became.status, became.why) == ("session_unclear", "not_enrolled")
    assert (samuel.why_not, samuel.needs_look) == ("not_enrolled", False)


@pytest.mark.asyncio
async def test_an_edited_answer_withdraws_the_old_request_beside_the_new_one() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2, TASTE_1),
    )
    store.fa_rows = [fa_row(EMMA, JOHNSON, summer="Taste of Camp 1", summer_ask=3000.0)]
    await FinancialAidIntakeService(store).build(YEAR)
    emma = row(await forms(store), JOHNSON, EMMA)
    statuses = {(b.status, b.why) for b in emma.became}
    assert statuses == {("withdrawn", "answer_edited"), ("active", None)}


@pytest.mark.asyncio
async def test_a_cancelled_request_and_its_posted_rounds_show() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0), attendees=enrolled(EMMA, JOHNSON, SESSION_2)
    )
    (request,) = store.requests.values()
    store.cancel_events = [
        CancelEvent(
            id="can000000000001",
            request_id=request.id,
            kind="cancel",
            created=datetime(YEAR, 3, 1, tzinfo=UTC),
            reason="schedule",
            note="",
            in_kindred=True,
        )
    ]
    store.decision_events.append(
        DecisionEvent(
            id="evt000000000001",
            request_id=request.id,
            round=1,
            kind="post",
            created=datetime(YEAR, 3, 2, tzinfo=UTC),
            amount=Decimal(1200),
        )
    )
    (became,) = row(await forms(store), JOHNSON, EMMA).became
    assert (became.status, became.posted_rounds, became.round1_posted) == ("cancelled", [1], 1200.0)


# -- the why-not codes --------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_registration_only_family_waits_in_its_own_filter_until_campminder_posts_aid() -> None:
    # Owner Q3-A: a family that only ticked "financial assistance" at registration is in Needs a look only when
    # CampMinder posted aid on it; otherwise it sits in Registration ask only.
    store = await intake(fa_row(RILEY, SAM, registration_ask=2500.0), attendees=enrolled(RILEY, SAM, TASTE_1))
    out = await forms(store)
    riley = row(out, SAM, RILEY)
    assert (riley.filed, riley.registration_only, riley.why_not) == (False, True, "registration_only")
    assert riley.registration_ask is not None
    assert riley.registration_ask.amount == 2500.0
    assert [g.session_cm_id for g in riley.gap_sessions] == [TASTE_1]
    assert (riley.can_add, riley.needs_look) == (True, False)
    assert (out.counts.needs_look, out.counts.registration_only, out.counts.all) == (0, 1, 1)

    store.camp_lines = [camp(59000001, SAM, "2258", session=TASTE_1, person=RILEY)]
    out = await forms(store)
    riley = row(out, SAM, RILEY)
    assert (riley.needs_look, riley.look_reasons) == (True, ["campminder_aid"])
    assert [(c.session_cm_id, c.amount, c.on_request, c.posted_on) for c in riley.campminder_aid] == [
        (TASTE_1, 2258.0, False, f"{YEAR}-02-20")
    ]
    assert riley.gap_sessions[0].campminder_amount == 2258.0
    assert out.campminder_aid_on_no_request == 2258.0


@pytest.mark.asyncio
async def test_a_camper_with_no_household_has_nowhere_for_a_request() -> None:
    store = await intake(
        fa_row(LIAM, GARCIA_NONE, summer="Session 2", summer_ask=3400.0), attendees=enrolled(LIAM, 0, SESSION_2)
    )
    liam = row(await forms(store), GARCIA_NONE, LIAM)
    assert (liam.why_not, liam.can_add, liam.became) == ("no_household", False, [])
    assert liam.household_label == ""


@pytest.mark.asyncio
async def test_an_adults_weekend_ask_with_no_one_registered_says_so() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        fa_row(1000013, JOHNSON, interest=True, registration_ask=450.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2),
    )
    adult = row(await forms(store), JOHNSON, 1000013)
    assert (adult.why_not, adult.needs_look, adult.registration_only) == ("adult_not_registered", False, False)


@pytest.mark.asyncio
async def test_a_family_camp_household_campminder_paid_with_no_form_row_is_a_household_row() -> None:
    store = await intake(
        attendees=enrolled(1000061, OKAFOR, FAMILY_CAMP_6),
        lines=[camp(59000002, OKAFOR, "458", session=FAMILY_CAMP_6)],
    )
    out = await forms(store)
    household = row(out, OKAFOR, 0)
    assert (household.camper_name, household.filed, household.why_not) == ("", False, "enrolled_no_request")
    assert [(g.session_cm_id, g.program_key, g.campminder_amount) for g in household.gap_sessions] == [
        (FAMILY_CAMP_6, "family_camp", 458.0)
    ]
    assert (household.can_add, household.look_reasons) == (True, ["campminder_aid", "enrolled_no_request"])


# -- Mark Reviewed (Q2-A) -----------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_rule_made_request_needs_a_look_until_it_is_reviewed() -> None:
    store = make_store(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2, WINTER),
    )
    made = AdditionRecord(
        id="add000000000rul",
        year=YEAR,
        household_cm_id=JOHNSON,
        person_cm_id=EMMA,
        program_key="summer",
        session_cm_id=WINTER,
        ask=290.0,
        source="registration_ask",
        reason="Registration ask dated with the enrollment",
        actor="system:intake",
    )
    store.additions[made.id] = made
    await FinancialAidIntakeService(store).build(YEAR)
    emma = row(await forms(store), JOHNSON, EMMA)
    rule = next(b for b in emma.became if b.origin == "registration_ask")
    assert (rule.reviewed, rule.addition_id) == (False, made.id)
    assert emma.look_reasons == ["registration_ask_unreviewed"]

    await FinancialAidCaseworkService(store).review_addition(YEAR, made.id, ACTOR)
    emma = row(await forms(store), JOHNSON, EMMA)
    rule = next(b for b in emma.became if b.origin == "registration_ask")
    assert (rule.reviewed, rule.reviewed_by, emma.needs_look) == (True, ACTOR, False)


# -- the figures agree --------------------------------------------------------------------------------------------------


def _d170_store_lines() -> list[CampLine]:
    return [
        camp(59000001, SAM, "2258", session=TASTE_1, person=RILEY, day=20),
        camp(59000003, SAM, "42", session=TASTE_1, person=RILEY, day=27),
        camp(59000002, OKAFOR, "458", session=FAMILY_CAMP_6),
        camp(59000004, JOHNSON, "600", session=SESSION_2, person=EMMA),  # on Emma's request: not D170
    ]


async def _d170_store() -> FakeAidStore:
    return await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        fa_row(RILEY, SAM, registration_ask=2500.0),
        attendees=[
            *enrolled(EMMA, JOHNSON, SESSION_2),
            *enrolled(RILEY, SAM, TASTE_1),
            *enrolled(1000061, OKAFOR, FAMILY_CAMP_6),
        ],
        lines=_d170_store_lines(),
    )


@pytest.mark.asyncio
async def test_the_d170_lines_are_one_per_family_x_session_with_the_add_prefill_and_match_seasons_figure() -> None:
    store = await _d170_store()
    out = await FormIntakeService(store).aid_on_no_request(YEAR)
    assert [(line.household_cm_id, line.person_cm_id, line.session_cm_id, line.amount) for line in out.lines] == [
        (SAM, RILEY, TASTE_1, 2300.0),
        (OKAFOR, 0, FAMILY_CAMP_6, 458.0),
    ]
    riley = out.lines[0]
    assert (riley.prefill.session_cm_id, riley.prefill.ask, riley.prefill.round1_campminder) == (
        TASTE_1,
        2300.0,
        2300.0,
    )
    assert (riley.row_key, riley.posted_on, riley.can_add, riley.pool) == (
        f"{SAM}:{RILEY}",
        f"{YEAR}-02-27",
        True,
        "camp_pool",
    )
    season = aid_on_no_request(store.camp_lines, list(store.requests.values()), [], lambda s: None)
    assert out.total == float(season[TOTAL].amount) == 2758.0
    assert out.families == season[TOTAL].families == 2
    assert (await forms(store)).campminder_aid_on_no_request == out.total


@pytest.mark.asyncio
async def test_adding_with_campminders_round_1_takes_the_family_off_the_d170_lines() -> None:
    store = await _d170_store()
    await FinancialAidCaseworkService(store).add_request(
        YEAR, SAM, RILEY, TASTE_1, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2300.0
    )
    out = await FormIntakeService(store).aid_on_no_request(YEAR)
    assert [line.household_cm_id for line in out.lines] == [OKAFOR]
    riley = row(await forms(store), SAM, RILEY)
    assert [(c.amount, c.on_request) for c in riley.campminder_aid] == [(2300.0, True)]
    (became,) = riley.became
    assert (became.origin, became.round1_posted, riley.needs_look) == ("added", 2300.0, False)


@pytest.mark.asyncio
async def test_summary_counts_are_the_forms_counts_and_the_grants_line_is_read() -> None:
    store = await _d170_store()

    async def waiting(year: int) -> int:
        return 2

    out = await forms(store, grants_waiting=waiting)
    summary = await FormIntakeService(store).summary(YEAR)
    assert (summary.needs_look, summary.registration_only, summary.all) == (
        out.counts.needs_look,
        out.counts.registration_only,
        out.counts.all,
    )
    assert out.grants_waiting_for_camper == 2
    assert {s.session_cm_id for s in out.sessions} >= {SESSION_2, TASTE_1, FAMILY_CAMP_6}
    assert next(s for s in out.sessions if s.session_cm_id == FAMILY_CAMP_6).program_key == "family_camp"


# -- Find a Camper Not Listed… ------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_find_lists_enrolled_campers_on_no_row_in_the_row_shape() -> None:
    sofia = 1000032
    store = await intake(
        fa_row(OLIVIA, CHEN, summer="Session 2", summer_ask=3500.0),
        attendees=[*enrolled(OLIVIA, CHEN, SESSION_2), *enrolled(sofia, CHEN, TASTE_1), *enrolled(1000099, 0, TASTE_2)],
    )
    asked: list[Sequence[str]] = []

    async def people(year: int, words: Sequence[str]) -> list[Any]:
        asked.append(words)
        return [SimpleNamespace(cm_id=sofia), SimpleNamespace(cm_id=OLIVIA)]  # Olivia is on a row already

    found = await FormIntakeService(store, people_search=people).unlisted(YEAR, "Sofia Chen")
    assert asked == [["Sofia", "Chen"]]
    (one,) = found.rows
    assert (one.household_cm_id, one.person_cm_id, one.why_not, one.can_add) == (
        CHEN,
        sofia,
        "enrolled_no_request",
        True,
    )
    assert [g.session_cm_id for g in one.gap_sessions] == [TASTE_1]

    by_id = await FormIntakeService(store, people_search=people).unlisted(YEAR, "1000099")
    (alone,) = by_id.rows
    assert (alone.why_not, alone.can_add) == ("no_household", False)
    assert (await FormIntakeService(store, people_search=people).unlisted(YEAR, "S")).rows == []


@pytest.mark.asyncio
async def test_the_labeler_names_households_as_the_household_page_does() -> None:
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0), attendees=enrolled(EMMA, JOHNSON, SESSION_2)
    )

    async def labels(year: int, households: Collection[int]) -> dict[int, Any]:
        return {h: SimpleNamespace(label="Mia & Noah Johnson", tiebreak="") for h in households}

    emma = row(await forms(store, labels=labels), JOHNSON, EMMA)
    assert emma.household_label == "Mia & Noah Johnson"


# -- Today's to-do line ("Form intake · N need a look", shown only while non-zero) -----------------------------------


@pytest.mark.asyncio
async def test_todays_line_counts_the_needs_a_look_rows_as_form_intake_does() -> None:
    from api.services.financial_aid_today import CASEWORK_LINES, build_today
    from tests.unit.api.services.test_financial_aid_today import _inputs, _line

    store = await _d170_store()
    look = await FormIntakeService(store).needs_a_look(YEAR)
    counts = (await forms(store)).counts
    assert len(look.rows) == counts.needs_look == 2

    out = build_today(_inputs([], form_intake=look), casework=True, finance=False)
    line = _line(out.casework, "form_intake")
    assert (line.items, line.families, line.item_kind) == (2, 2, "campers")
    assert {(r.code, r.items) for r in line.reasons} == {("campminder_aid", 2), ("enrolled_no_request", 1)}
    assert {n.household_cm_id for n in line.next_up} == {SAM, OKAFOR}
    assert next(n for n in line.next_up if n.household_cm_id == SAM).label == f"Camper {RILEY}"
    assert "form_intake" in CASEWORK_LINES

    empty = build_today(_inputs([]), casework=True, finance=False)
    assert _line(empty.casework, "form_intake").items == 0


@pytest.mark.asyncio
async def test_today_reads_form_intake_only_for_casework() -> None:
    from api.services.financial_aid_form_intake import FormIntakeLook
    from api.services.financial_aid_today import TodayService
    from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved
    from tests.unit.api.services.test_financial_aid_today import _Drafts, _Grants, _grants, _Ledger, _line

    calls: list[int] = []

    async def reader(year: int) -> FormIntakeLook:
        calls.append(year)
        return await FormIntakeService(await _d170_store()).needs_a_look(YEAR)

    def service() -> TodayService:
        return TodayService(
            store=FakeDecisionsStore(),
            pricing=FakeRules(approved()),
            rules=_Drafts(None),
            grants=_Grants(_grants(year=YEAR)),
            ledger=_Ledger(),
            form_intake=reader,
            clock=lambda: T0,
        )

    out = await service().read(YEAR, casework=True, finance=False)
    assert _line(out.casework, "form_intake").items == 2
    await service().read(YEAR, casework=False, finance=True)
    assert calls == [YEAR]


# -- the audit's fixes (form-intake visual audit, 2026-10-15) -----------------------------------------------------------

FAMILY_CAMP_3 = 1000201


@pytest.mark.asyncio
async def test_the_d170_lines_name_every_session_their_add_editor_offers() -> None:
    """A Family Camp household's line offers every Family Camp weekend it is in (its gap sessions), not only the one the
    posting suggests: the read names them all, so the session picker never reads "a session"."""
    store = await intake(
        attendees=enrolled(1000061, OKAFOR, FAMILY_CAMP_3, FAMILY_CAMP_6),
        lines=[camp(59000002, OKAFOR, "458", session=FAMILY_CAMP_6)],
    )
    out = await FormIntakeService(store).aid_on_no_request(YEAR)
    (line,) = out.lines
    assert {g.session_cm_id for g in line.gap_sessions} == {FAMILY_CAMP_3, FAMILY_CAMP_6}
    assert {s.session_cm_id for s in out.sessions} >= {FAMILY_CAMP_3, FAMILY_CAMP_6}


@pytest.mark.asyncio
async def test_every_session_carries_its_program_family_so_a_teen_answer_reads_teen_programs() -> None:
    """Form asked names an answer's program by the family of the session it names (the Requests grid's words: At Camp,
    Quests, Teen Programs), so the read sends each session's family beside the program that can name it."""
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2, 1000106, WINTER),
    )
    out = await forms(store)
    family = {s.session_cm_id: (s.program_key, s.program_family) for s in out.sessions}
    assert family[SESSION_2] == ("summer", "summer")
    assert family[1000106] == ("summer", "quest")
    assert family[WINTER] == ("summer", "teen")


@pytest.mark.asyncio
async def test_a_removed_addition_says_who_removed_it_when_and_why() -> None:
    """The household card's "Removed by Pat, Mar 3: “…” · its decisions are kept" (mock step 17): the addition view
    carries who retired it, when and why, as it carries who added it."""
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(EMMA, JOHNSON, SESSION_2, WINTER),
    )
    added = await FinancialAidCaseworkService(store).add_request(
        YEAR, JOHNSON, EMMA, WINTER, 290.0, "Asked at TWR registration", ACTOR
    )
    await FinancialAidCaseworkService(store).retire_addition(YEAR, added.addition.id, "Not attending after all", ACTOR)
    request = store.requests[added.request.id]
    view = addition_view(request, additions_by_request_key(store.additions.values()), {})
    assert view is not None
    assert (view.live, view.retired_by, view.retire_reason) == (False, ACTOR, "Not attending after all")
    assert view.retired_at != ""


@pytest.mark.asyncio
async def test_an_answer_names_the_one_session_its_text_names() -> None:
    """Form asked shows a named session in its short form and by its family (the mock's "Teen Programs: Teen
    Leadership Institute"): the read names it (`named_session_cm_id`), 0 when the text names none or several."""
    store = await intake(
        fa_row(EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        fa_row(OLIVIA, CHEN, summer="Session 2 or Taste 2", summer_ask=3500.0),
        attendees=[*enrolled(EMMA, JOHNSON, SESSION_2), *enrolled(OLIVIA, CHEN, SESSION_2, TASTE_2)],
    )
    out = await forms(store)
    assert [a.named_session_cm_id for a in row(out, JOHNSON, EMMA).answers] == [SESSION_2]
    assert [a.named_session_cm_id for a in row(out, CHEN, OLIVIA).answers] == [0]


@pytest.mark.asyncio
async def test_a_household_rows_enrolled_lists_its_family_camp_weekends_only() -> None:
    """A household (Family Camp) row is about the household's Family Camp request, so its Enrolled names the household's
    Family Camp weekends (the mock's "FC2 · WFC"), not every session its campers are in: those are on their own rows."""
    store = await intake(
        attendees=[*enrolled(1000061, OKAFOR, FAMILY_CAMP_6), *enrolled(1000062, OKAFOR, SESSION_2)],
        lines=[camp(59000002, OKAFOR, "458", session=FAMILY_CAMP_6)],
    )
    assert row(await forms(store), OKAFOR, 0).enrolled_session_cm_ids == [FAMILY_CAMP_6]


# -- Follow-up A (coordinator ruling): siblings in one session. Form intake's amber cell, its gap's campminder_amount,
#    the D170 drill-in line's prefill and Add a Request…'s guard all offer the SAME per-camper money: the lines credited
#    to that camper, plus lines credited to no camper only when that camper is the household's one camper enrolled
#    (status 2) in the session. A household (Family Camp) row keeps the household x session's money. ---------------


async def _siblings(*lines: CampLine, samuel_enrolled: bool = True) -> FakeAidStore:
    """Emma and Samuel Johnson asked at registration only, and are both enrolled in Taste of Camp 1 (unless not)."""
    return await intake(
        fa_row(EMMA, JOHNSON, registration_ask=1500.0),
        fa_row(SAMUEL, JOHNSON, registration_ask=1500.0),
        attendees=[
            *enrolled(EMMA, JOHNSON, TASTE_1),
            *enrolled(SAMUEL, JOHNSON, TASTE_1, status=2 if samuel_enrolled else 4),
        ],
        lines=lines,
    )


def _offered(r: FormIntakeRowOut) -> list[tuple[int, float | None]]:
    return [(g.session_cm_id, g.campminder_amount) for g in r.gap_sessions]


def _amber(r: FormIntakeRowOut) -> list[tuple[int, float]]:
    return [(a.session_cm_id, a.amount) for a in r.campminder_aid if not a.on_request]


@pytest.mark.asyncio
async def test_two_credited_siblings_in_one_session_are_each_offered_their_own_money() -> None:
    store = await _siblings(
        camp(59000011, JOHNSON, "1000", session=TASTE_1, person=EMMA),
        camp(59000012, JOHNSON, "500", session=TASTE_1, person=SAMUEL),
    )
    out = await forms(store)
    emma, samuel = row(out, JOHNSON, EMMA), row(out, JOHNSON, SAMUEL)
    assert (_amber(emma), _offered(emma)) == ([(TASTE_1, 1000.0)], [(TASTE_1, 1000.0)])
    assert (_amber(samuel), _offered(samuel)) == ([(TASTE_1, 500.0)], [(TASTE_1, 500.0)])

    drill = await FormIntakeService(store).aid_on_no_request(YEAR)
    assert sorted(
        (x.person_cm_id, x.session_cm_id, x.amount, x.prefill.person_cm_id, x.prefill.round1_campminder)
        for x in drill.lines
    ) == [(EMMA, TASTE_1, 1000.0, EMMA, 1000.0), (SAMUEL, TASTE_1, 500.0, SAMUEL, 500.0)]
    assert (drill.total, drill.families) == (1500.0, 1)


@pytest.mark.asyncio
async def test_money_credited_to_no_camper_with_two_enrolled_siblings_is_offered_to_neither() -> None:
    store = await _siblings(camp(59000013, JOHNSON, "700", session=TASTE_1))
    out = await forms(store)
    emma, samuel = row(out, JOHNSON, EMMA), row(out, JOHNSON, SAMUEL)
    assert (_amber(emma), _offered(emma)) == ([], [(TASTE_1, None)])
    assert (_amber(samuel), _offered(samuel)) == ([], [(TASTE_1, None)])
    assert emma.can_add  # Add a Request… still works, with no Round 1 box
    assert samuel.can_add

    # It stays on D170: the line is the household's, and Add a Request… there offers no Round 1.
    drill = await FormIntakeService(store).aid_on_no_request(YEAR)
    (line,) = drill.lines
    assert (line.person_cm_id, line.session_cm_id, line.amount, line.prefill.round1_campminder) == (
        0,
        TASTE_1,
        700.0,
        None,
    )
    assert drill.total == out.campminder_aid_on_no_request == 700.0


@pytest.mark.asyncio
async def test_money_credited_to_no_camper_is_offered_to_the_one_enrolled_camper() -> None:
    store = await _siblings(camp(59000014, JOHNSON, "700", session=TASTE_1), samuel_enrolled=False)
    emma = row(await forms(store), JOHNSON, EMMA)
    assert (_amber(emma), _offered(emma)) == ([(TASTE_1, 700.0)], [(TASTE_1, 700.0)])
    (line,) = (await FormIntakeService(store).aid_on_no_request(YEAR)).lines
    assert (line.person_cm_id, line.prefill.person_cm_id, line.prefill.round1_campminder) == (EMMA, EMMA, 700.0)


@pytest.mark.asyncio
async def test_a_household_row_keeps_the_household_x_session_money() -> None:
    # Family Camp: CampMinder's lines on the weekend, whichever member they credit, are the household's request's.
    store = await intake(
        attendees=[*enrolled(1000061, OKAFOR, FAMILY_CAMP_6), *enrolled(1000062, OKAFOR, FAMILY_CAMP_6)],
        lines=[
            camp(59000015, OKAFOR, "300", session=FAMILY_CAMP_6, person=1000061),
            camp(59000016, OKAFOR, "158", session=FAMILY_CAMP_6),
        ],
    )
    household = row(await forms(store), OKAFOR, 0)
    assert (_amber(household), _offered(household)) == ([(FAMILY_CAMP_6, 458.0)], [(FAMILY_CAMP_6, 458.0)])
    (line,) = (await FormIntakeService(store).aid_on_no_request(YEAR)).lines
    assert (line.person_cm_id, line.amount, line.prefill.round1_campminder) == (0, 458.0, 458.0)

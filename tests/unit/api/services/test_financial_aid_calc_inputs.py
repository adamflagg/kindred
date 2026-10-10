"""Application + request (+ corrections + rules) -> sub-project 3's calculator inputs and intake's checks."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any, get_args

import pytest

from api.services.financial_aid_calc_inputs import (
    NotCalculableError,
    calculator_inputs,
    priced_program,
    rules_program_key,
    to_application_inputs,
    to_request_inputs,
)
from api.services.financial_aid_casework_service import CaseworkValidationError, FinancialAidCaseworkService
from api.services.financial_aid_corrections import APPLICATION_CORRECTABLE, REQUEST_CORRECTABLE, effective_values
from api.services.financial_aid_household import BOOL_FIELDS, INCOME_FIELDS, NUMBER_FIELDS, TEXT_FIELDS
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import CorrectionRecord, EquityAnswers, RequestRecord, SessionRow
from api.services.financial_aid_payer_shares import ShareSpec
from bunking.financial_aid.calculator import IncomeOverride, calculate
from bunking.financial_aid.rules.schema import IncomeFigure
from tests.unit.api.services.financial_aid_fakes import (
    SESSIONS,
    YEAR,
    fa_row,
    intake_rules,
    seeded_store,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever

ACTOR = "registrar@example.com"
SESSIONS_BY_ID = {s.cm_id: s for s in SESSIONS}


def stored_answers(**values: Any) -> dict[str, Any]:
    """A household's answers as intake stores them: every field present; blanks None / False / ""."""
    answers: dict[str, Any] = dict.fromkeys((*INCOME_FIELDS, *NUMBER_FIELDS))
    answers.update(dict.fromkeys(BOOL_FIELDS, False))
    answers.update(dict.fromkeys(TEXT_FIELDS, ""))
    answers.update(values)
    return answers


def fix(field: str, new: str, original: str = "") -> CorrectionRecord:
    return CorrectionRecord("c1", YEAR, "a1", "", field, new, original, "r", ACTOR, "2027-01-01")


def effective(answers: dict[str, Any], *corrections: CorrectionRecord) -> dict[str, Any]:
    return effective_values(answers, APPLICATION_CORRECTABLE, list(corrections))


async def built(store: Any = None) -> tuple[Any, FinancialAidCaseworkService]:
    store = store or seeded_store()
    await FinancialAidIntakeService(store).build(YEAR)
    return store, FinancialAidCaseworkService(store)


def test_application_inputs_use_corrected_values_as_decimals_and_carry_every_figure_and_answer() -> None:
    answers = stored_answers(
        total_gross_income=85000.0,
        expected_gross_income=80000.0,
        total_adjusted_income=70000.0,
        income_confirmed=84000.0,
        total_medical_expenses=6000.0,
        non_retirement_savings=1000.0,
        num_children=3.0,
        total_rent=1800.0,
        total_housing_expenses=2400.0,
        gov_subsidies=True,
        single_parent=True,
    )
    inputs = to_application_inputs(1000001, effective(answers, fix("total_gross_income", "90000.00", "85000.00")))
    assert inputs.prior_year_gross == Decimal("90000.00")
    assert (inputs.current_year_gross, inputs.prior_year_confirmed, inputs.prior_year_agi) == (
        Decimal("80000.00"),
        Decimal("84000.00"),
        Decimal("70000.00"),
    )
    assert inputs.savings == Decimal("1000.00")
    assert inputs.dependents == 3
    assert inputs.education_expenses is None  # blank: SP3 counts it as 0
    assert set(inputs.figures) == set(get_args(IncomeFigure))
    assert (inputs.figures["total_rent"], inputs.figures["total_housing_expenses"]) == (
        Decimal("1800.00"),
        Decimal("2400.00"),
    )
    assert inputs.answers == {
        "unemployment": "No",
        "gov_subsidies": "Yes",
        "single_parent": "Yes",
    }
    assert inputs.income_override is None


def test_the_session_name_reaches_the_calculator_for_words_only() -> None:
    named = to_request_inputs(
        _summer_request(), _ask("1500.00"), None, "summer", session=SessionRow(1000102, "Session 2", "main")
    )
    assert named.session_name == "Session 2"
    assert to_request_inputs(_summer_request(), _ask("1500.00"), None, "summer").session_name is None


def test_a_blank_gross_income_reaches_the_calculator_as_none_and_is_not_priced() -> None:  # Review Focus 6
    inputs = to_application_inputs(1000001, effective(stored_answers()))
    assert (inputs.prior_year_gross, inputs.current_year_gross, inputs.prior_year_agi) == (None, None, None)
    request = to_request_inputs(_summer_request(), _ask("1500.00"), None, "summer")
    result = calculate(inputs, request, intake_rules())
    assert result.status == "needs_input"
    assert "income_missing" in result.issue_codes()


def test_a_reported_zero_gross_is_priced_and_the_placeholder_check_holds() -> None:
    inputs = to_application_inputs(
        1000001, effective(stored_answers(total_gross_income=0.0, expected_gross_income=0.0))
    )
    assert inputs.prior_year_gross == Decimal("0.00")
    result = calculate(inputs, to_request_inputs(_summer_request(), _ask("1500.00"), None, "summer"), intake_rules())
    assert result.status == "ok"
    assert ("placeholder_income", "hold") in [(i.code, i.severity) for i in result.issues]


def test_an_income_taken_by_phone_prices_a_household_with_no_income_answers() -> None:
    inputs = to_application_inputs(
        1000001, effective(stored_answers(), fix("income_override", "staff_entered:52000.00"))
    )
    assert inputs.income_override == IncomeOverride(mode="staff_entered", amount=Decimal("52000.00"))
    result = calculate(inputs, to_request_inputs(_summer_request(), _ask("1500.00"), None, "summer"), intake_rules())
    assert result.status == "ok"


def test_a_mode_only_income_override_passes_through() -> None:
    inputs = to_application_inputs(
        1000001, effective(stored_answers(total_gross_income=60000.0), fix("income_override", "prior_year_only"))
    )
    assert inputs.income_override == IncomeOverride(mode="prior_year_only")


@pytest.mark.asyncio
async def test_request_inputs_carry_the_campers_own_equity_the_corrected_ask_and_the_rules_program() -> None:
    store, _ = await built()
    summer = store.request_for(person=1000011, program="summer")
    ask = effective_values(
        {"ask": summer.ask},
        REQUEST_CORRECTABLE,
        [
            CorrectionRecord(
                "c1", YEAR, summer.application_id, summer.id, "ask", "1200.00", "1500.00", "r", ACTOR, "2027-01-01"
            )
        ],
        summer.id,
    )["ask"]
    program = rules_program_key(summer, SESSIONS_BY_ID, intake_rules())
    inputs = to_request_inputs(summer, ask, EquityAnswers(True, "Non-binary", "They/Them"), program or "")
    assert (inputs.ask, inputs.person_cm_id, inputs.session_cm_id, inputs.program_key) == (
        Decimal("1200.00"),
        1000011,
        1000101,
        "summer",
    )
    assert inputs.equity_answers == {"bipoc": "Yes", "gender_identity": "Non-binary", "pronouns": "They/Them"}
    assert inputs.headcount is None


def test_the_calculator_program_comes_from_the_rules_not_the_fa_question() -> None:
    quest = replace(_summer_request(), session_cm_id=1000106)  # a summer FA answer for the Quest session
    assert rules_program_key(quest, SESSIONS_BY_ID, intake_rules()) == "quest"
    unclaimed = replace(_summer_request(), program_key="adult_weekend", session_cm_id=1000402)
    assert rules_program_key(unclaimed, SESSIONS_BY_ID, intake_rules()) is None


@pytest.mark.asyncio
async def test_a_family_request_has_a_headcount_and_unknown_equity() -> None:
    store, _ = await built()
    family = store.request_for(household=1000001, program="family_camp")
    ask = effective_values({"ask": family.ask}, REQUEST_CORRECTABLE, [], family.id)["ask"]
    inputs = to_request_inputs(family, ask, EquityAnswers(True, "x", "y"), "family_camp")
    assert inputs.person_cm_id is None
    assert inputs.headcount is not None
    assert (inputs.headcount.standard, inputs.headcount.infants) == (3, 0)
    assert inputs.equity_answers == {}


def test_a_blank_ask_is_none_never_zero() -> None:
    blank = effective_values({"ask": None}, REQUEST_CORRECTABLE, [], "req000000000001")["ask"]
    assert to_request_inputs(_summer_request(), blank, None, "summer").ask is None


def test_an_unmatched_request_cannot_be_converted() -> None:
    with pytest.raises(NotCalculableError, match="unmatched"):
        to_request_inputs(replace(_summer_request(), session_cm_id=0), _ask("1500.00"), None, "summer")


@pytest.mark.asyncio
async def test_calculator_inputs_for_covers_live_requests_with_their_equity_and_no_issues() -> None:
    store, casework = await built()
    store.equity = {1000011: EquityAnswers(False, "Girl", "She/Her")}
    results = await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())
    assert sorted(
        (r.request.program_key, r.request.equity_answers.get("bipoc")) for r in results if r.request is not None
    ) == [("family_camp", None), ("summer", "No")]
    assert len(results) == 2
    assert all(r.application.household_cm_id == 1000001 and r.issues == () and r.blocked == "" for r in results)


@pytest.mark.asyncio
async def test_an_income_conflict_holds_until_staff_choose_a_figure() -> None:
    store = seeded_store()
    store.fa_rows[1] = fa_row(1000012, 1000001, fc="Family Camp 6", fc_ask=900.0, total_gross_income=95000.0)
    store, casework = await built(store)
    before = await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())
    assert len(before) == 2  # the summer and family-camp requests: all() below must not pass on nothing
    assert all(("household_income_conflict", "hold") in [(i.code, i.severity) for i in r.issues] for r in before)
    assert all(r.application.prior_year_gross is None for r in before)  # never picked
    await casework.add_correction(YEAR, 1000001, "total_gross_income", "90000", "Called the family.", ACTOR)
    after = await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())
    assert len(after) == 2
    assert all(r.issues == () and r.application.prior_year_gross == Decimal("90000.00") for r in after)


@pytest.mark.asyncio
@pytest.mark.parametrize("check", [{"severity": "warn"}, {"enabled": False}])
async def test_an_income_conflict_holds_whatever_the_rules_say(check: dict[str, Any]) -> None:  # owner ruling Q3
    store = seeded_store()
    store.fa_rows[1] = fa_row(1000012, 1000001, fc="Family Camp 6", fc_ask=900.0, total_gross_income=95000.0)
    store, casework = await built(store)
    lax = with_lever(intake_rules(), "quality_checks.checks.household_income_conflict", check)
    results = await casework.calculator_inputs_for(YEAR, 1000001, lax)
    assert len(results) == 2
    assert all(("household_income_conflict", "hold") in [(i.code, i.severity) for i in r.issues] for r in results)


@pytest.mark.asyncio
async def test_a_request_waiting_for_approved_rules_is_blocked_never_priced() -> None:  # owner ruling Q4
    store = seeded_store()
    store.rules = None  # intake ran before finance approved the programs and cost sections
    store, casework = await built(store)
    results = await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())
    assert results
    assert all(r.request is None and r.blocked.startswith("waiting for approved rules") for r in results)
    assert all(("awaiting_approved_rules", "hold") in [(i.code, i.severity) for i in r.issues] for r in results)


@pytest.mark.asyncio
async def test_an_incomplete_payer_split_holds() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    await casework.set_payer_shares(summer.id, [ShareSpec(1000001, Decimal(60))], "One parent so far.", ACTOR)
    results = {r.request_id: r for r in await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())}
    assert [(i.code, i.severity) for i in results[summer.id].issues] == [("payer_shares_incomplete", "hold")]


@pytest.mark.asyncio
async def test_an_unmatched_or_unclaimed_request_comes_back_blocked_never_dropped() -> None:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 9", summer_ask=100.0))
    store, casework = await built(store)
    results = await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())
    unmatched = next(r for r in results if r.blocked == "the session is unmatched")
    assert unmatched.request is None
    assert ("unmatched_session", "hold") in [(i.code, i.severity) for i in unmatched.issues]


@pytest.mark.asyncio
async def test_a_session_other_than_the_answer_names_is_information_never_a_hold() -> None:
    # The family answered "Session 2" but is enrolled in Session 2a (owner ruling 2026-09-27).
    store = seeded_store()
    store.attendees[0] = replace(store.attendees[0], session_cm_id=1000102)
    store, casework = await built(store)
    summer = store.request_for(person=1000011, program="summer")
    assert summer.session_cm_id == 1000102
    assert {"code": "session_differs_from_answer", "detail": {"named_session_cm_id": 1000101}} in [
        dict(f) for f in summer.flags
    ]
    results = {r.request_id: r for r in await casework.calculator_inputs_for(YEAR, 1000001, intake_rules())}
    assert (results[summer.id].issues, results[summer.id].blocked) == ((), "")
    assert results[summer.id].request is not None


@pytest.mark.asyncio
async def test_rules_for_another_season_are_refused() -> None:
    _, casework = await built()
    with pytest.raises(CaseworkValidationError, match="2031"):
        await casework.calculator_inputs_for(YEAR, 1000001, fictional_rules())


AG_ROW = SessionRow(1000103, "AG Session 2", "ag", "2027-06-20", parent_cm_id=1000101)
EMBEDDED_ROW = SessionRow(1000102, "Session 2b", "embedded", "2027-06-20", parent_cm_id=1000101)


def test_an_ag_session_carries_its_parent_into_the_calculator() -> None:
    request = replace(_summer_request(), session_cm_id=1000103)
    inputs = to_request_inputs(request, _ask("1500.00"), None, "summer", session=AG_ROW)
    assert inputs.ag_parent_cm_id == 1000101


@pytest.mark.parametrize(
    "session",
    [EMBEDDED_ROW, SessionRow(1000103, "AG Session 2", "ag", "2027-06-20"), None],
    ids=["embedded-with-a-parent", "ag-without-a-parent", "no-session-row"],
)
def test_only_an_ag_session_with_a_parent_falls_back(session: SessionRow | None) -> None:
    request = replace(_summer_request(), session_cm_id=1000103)
    assert to_request_inputs(request, _ask("1500.00"), None, "summer", session=session).ag_parent_cm_id is None


@pytest.mark.asyncio
async def test_calculator_inputs_hands_the_requests_own_session_row_over() -> None:
    store, _ = await built()
    application = next(a for a in store.applications.values() if a.household_cm_id == 1000001)
    request = replace(_summer_request(), session_cm_id=1000103)
    sessions = {**SESSIONS_BY_ID, 1000103: AG_ROW}
    out = calculator_inputs(request, application, effective(stored_answers()), [], sessions, [], None, intake_rules())
    assert out.request is not None
    assert out.request.ag_parent_cm_id == 1000101


def test_an_ag_session_no_program_claims_is_priced_under_its_parents_program() -> None:
    """Review M7: never "No program in the rules claims session ..." while its parent is claimed."""
    rules = with_lever(intake_rules(), "programs.summer.session_types", ["main", "embedded"])  # "ag" not claimed
    request = replace(_summer_request(), session_cm_id=1000199)
    sessions = {
        **SESSIONS_BY_ID,
        1000199: SessionRow(1000199, "AG Session 2", "ag", "2027-06-20", parent_cm_id=1000101),
    }
    assert priced_program(request, sessions, rules) == ("summer", "")
    orphan = {**SESSIONS_BY_ID, 1000199: SessionRow(1000199, "AG Session 2", "ag", "2027-06-20")}
    assert priced_program(request, orphan, rules)[0] is None


def test_an_unclaimed_ag_session_follows_a_parent_the_programs_claim_by_type() -> None:
    """Regression guard. The parent's own type (not just its id) reaches the program lookup."""
    rules = with_lever(intake_rules(), "programs.summer.session_types", ["main", "embedded"])  # "ag" not claimed
    request = replace(_summer_request(), session_cm_id=1000199)
    sessions = {
        1000199: SessionRow(1000199, "AG Session 2", "ag", "2027-06-20", parent_cm_id=1000998),
        1000998: SessionRow(1000998, "Session 9", "main", "2027-06-20"),  # claimed by type "main", not by id
    }
    assert priced_program(request, sessions, rules) == ("summer", "")


def _summer_request() -> RequestRecord:
    return RequestRecord(
        "req000000000001",
        YEAR,
        "app000000000001",
        1000001,
        1000011,
        1000101,
        "summer",
        "Session 2",
        "session 2",
        "exact",
        1500.0,
        0,
        0,
        "",
        "active",
        "",
    )


def _ask(value: str) -> Any:
    return effective_values({"ask": Decimal(value)}, REQUEST_CORRECTABLE, [], "req000000000001")["ask"]

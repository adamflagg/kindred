"""The import paths and shapes sub-projects 5, 9 and 10 build on. Changing one breaks them."""

import inspect

from bunking.financial_aid.calculator import ApplicationInputs, CalcResult, RequestInputs, TraceStep, calculate
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req


def test_calculate_takes_application_request_rules() -> None:
    params = inspect.signature(calculate).parameters
    assert list(params) == ["application", "request", "rules"]


def test_application_inputs_are_household_level() -> None:
    assert {
        "household_cm_id",
        "prior_year_gross",
        "prior_year_agi",
        "prior_year_confirmed",
        "current_year_gross",
        "medical_expenses",
        "education_expenses",
        "savings",
        "dependents",
        "answers",
        "income_override",
    } == set(ApplicationInputs.model_fields)


def test_request_inputs_are_per_request() -> None:
    assert {
        "person_cm_id",
        "session_cm_id",
        "program_key",
        "ask",
        "equity_answers",
        "cost_override",
        "headcount",
        "grants_applicable",
        "incentives",
        "appeal_amount",
        "round2_decided",
        "round3_amount",
        "round3_statement_of_need",
        "decision_type",
        "discretionary_amount",
        "r1_decided_at",
    } == set(RequestInputs.model_fields)


def test_the_result_and_trace_shapes() -> None:
    assert set(TraceStep.model_fields) == {"key", "label", "value", "inputs", "bound", "note"}
    for name in ("status", "r1", "r1_bound", "r2", "r2_cap", "r3", "top_up", "total", "trace", "issues"):
        assert name in CalcResult.model_fields


def test_a_result_snapshot_round_trips_as_json() -> None:
    # Sub-project 10 freezes the result on a decision row as JSON. The money fields come
    # back as Decimal; free-form trace values come back JSON-equal (a Decimal inside a
    # trace step's inputs is stored as its string), which is all the screen needs.
    result = calculate(app(), req(appeal_amount="400"), fictional_rules())
    restored = CalcResult.model_validate_json(result.model_dump_json())
    assert (restored.r1, restored.r2, restored.total) == (result.r1, result.r2, result.total)
    assert restored.model_dump(mode="json") == result.model_dump(mode="json")


def test_the_rules_document_is_importable_from_its_fixed_path() -> None:
    assert "programs" in AidRules.model_fields

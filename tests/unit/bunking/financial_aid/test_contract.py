"""The import paths and shapes sub-projects 5, 9 and 10 build on. Changing one breaks them."""

import inspect
import typing

from pydantic import BaseModel

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
        "figures",
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
        "r2_decided_at",
    } == set(RequestInputs.model_fields)


def test_the_result_and_trace_shapes() -> None:
    assert set(TraceStep.model_fields) == {"key", "label", "value", "inputs", "bound", "note"}
    for name in ("status", "r1", "r1_bound", "r2", "r2_cap", "r3", "top_up", "total", "trace", "issues"):
        assert name in CalcResult.model_fields


def _optional(model: type[BaseModel], name: str) -> bool:
    return type(None) in typing.get_args(model.model_fields[name].annotation)


def test_the_result_field_set_is_pinned() -> None:
    assert set(CalcResult.model_fields) == {
        "status",
        "adjusted_income",
        "income_tier",
        "equity_shift",
        "final_tier",
        "cost",
        "grants_offset",
        "r1_potential",
        "r1",
        "r1_bound",
        "r2_cap",
        "r2",
        "r2_bound",
        "r3",
        "r3_bound",
        "top_up",
        "discretionary",
        "total",
        "trace",
        "issues",
    }


def test_every_computed_figure_is_optional_so_it_can_stay_none_until_evaluated() -> None:
    # I5 (final review), a deliberate contract change made before sub-projects 5 and 10
    # consume it: a figure the calculator never reached is None, never 0.
    for name in ("equity_shift", "grants_offset", "top_up", "adjusted_income", "income_tier", "r1", "r2", "total"):
        assert _optional(CalcResult, name), name
    # Inputs, not computed: always present.
    for name in ("status", "discretionary", "trace", "issues"):
        assert not _optional(CalcResult, name), name


def test_the_ask_is_required_but_may_be_none() -> None:
    field = RequestInputs.model_fields["ask"]
    assert field.is_required()
    assert _optional(RequestInputs, "ask")


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

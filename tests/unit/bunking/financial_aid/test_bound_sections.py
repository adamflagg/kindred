"""Which rules section a trace step's limit comes from (D76; slice 2 missing read 7). Fictional rules."""

from typing import Any

import pytest

from bunking.financial_aid.calculator.bound_sections import NOT_A_SETTING, bound_section
from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.result import CalcResult, TraceStep
from bunking.financial_aid.rules.schema import SECTION_NAMES, AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever

TIER_6 = {"prior_year_gross": "250000", "current_year_gross": "250000"}
CEILING = with_lever(fictional_rules(), "tiers.income_ceiling", "220000")
TOTAL_CAP = with_lever(fictional_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": True})


def _calc(rules: AidRules | None = None, application: ApplicationInputs | None = None, **request: Any) -> CalcResult:
    return calculate(application or app(), req(**request), rules or fictional_rules())


def _step(result: CalcResult, key: str) -> TraceStep:
    return next(s for s in result.trace if s.key == key)


@pytest.mark.parametrize(
    ("result", "key", "bound", "section"),
    [
        (_calc(), "r1", "table", "award_tables"),
        (_calc(ask="1200"), "r1", "ask", "awards"),
        (_calc(application=app(**TIER_6), session_cm_id=1000101), "r1", "minimum", "awards"),
        (
            _calc(CEILING, application=app(prior_year_gross="230000", current_year_gross="230000")),
            "r1",
            "income_ceiling",
            "tiers",
        ),
        (_calc(appeal_amount="1000"), "r2", "cap", "round2"),
        (_calc(appeal_amount="400"), "r2", "appeal", None),
        (_calc(TOTAL_CAP, appeal_amount="1000"), "r2", "total_cap", "round2"),
    ],
    ids=["table", "ask", "minimum", "income_ceiling", "r2_cap", "appeal", "total_cap"],
)
def test_the_step_names_the_section_whose_setting_bound_it(
    result: CalcResult, key: str, bound: str, section: str | None
) -> None:
    step = _step(result, key)
    assert (step.bound, step.section) == (bound, section)
    assert step.model_dump(mode="json")["section"] == section  # it travels in every response that carries a trace


def test_the_same_code_maps_by_step_where_two_sections_share_it() -> None:
    assert (bound_section("r2", "cap"), bound_section("r3", "cap")) == ("round2", "round3")
    assert (bound_section("r1", "no_table"), bound_section("r2", "no_table")) == ("programs", "round2")
    assert bound_section("r1", None) is None


def test_every_limit_the_engine_emits_has_a_section_or_is_named_as_no_setting() -> None:
    """A new limit code fails here until it is mapped (or named as not a setting)."""
    runs = [
        _calc(),
        _calc(ask="1200"),
        _calc(application=app(**TIER_6), session_cm_id=1000101),
        _calc(CEILING, application=app(prior_year_gross="230000", current_year_gross="230000"), appeal_amount="500"),
        _calc(appeal_amount="1000"),
        _calc(appeal_amount="400"),
        _calc(TOTAL_CAP, appeal_amount="1000"),
    ]
    for result in runs:
        for step in result.trace:
            if step.bound is not None and step.bound not in NOT_A_SETTING:
                assert step.section in SECTION_NAMES, (step.key, step.bound)


def test_a_stored_trace_with_a_section_key_reads_back_and_re_derives_it() -> None:
    """A locked receipt's stored trace now carries "section"; reading it back ignores the stored key and re-derives
    it, and a retrace (model_copy with a new bound) re-derives it too."""
    stored = {"key": "r2", "label": "Round 2 award", "value": "100", "bound": "cap", "section": "awards"}
    step = TraceStep.model_validate(stored)
    assert step.section == "round2"
    assert step.model_copy(update={"bound": "total_cap"}).section == "round2"
    assert step.model_copy(update={"bound": "appeal"}).section is None

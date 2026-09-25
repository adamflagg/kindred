"""Structure of the rules document. Cross-field policy checks are in test_validation.py."""

import json
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from bunking.financial_aid.rules.defaults import DEFAULT_PROGRAM_KEYS, default_program_profiles
from bunking.financial_aid.rules.schema import (
    SECTION_NAMES,
    AidRules,
    AwardTable,
    BudgetPool,
    DecisionType,
    EquityCriterion,
    EquitySection,
    IncomeSection,
    ProgramProfile,
    StageDef,
    TierPercents,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json, with_lever

_INCOME = {
    "weights": {"prior_year": "0.7", "current_year": "0.3"},
    "medical_threshold": "4000",
    "education_threshold": "1000",
    "savings_threshold": "150000",
    "dependents_mode": "income_reduction",
    "floor_applies_after": "all_reductions",
}


def test_the_fourteen_sections_in_spec_order() -> None:
    assert SECTION_NAMES == (
        "income",
        "tiers",
        "equity",
        "award_tables",
        "programs",
        "cost",
        "grants",
        "awards",
        "round2",
        "round3",
        "budget",
        "stages",
        "quality_checks",
        "milestones",
    )


def test_income_defaults_are_the_neutral_ones() -> None:
    income = IncomeSection.model_validate(_INCOME)
    assert income.basis == "gross"
    assert income.current_year_zero_fallback == "blend"
    assert income.medical_rate == income.education_rate == income.savings_inclusion_rate == Decimal(1)
    assert income.per_dependent_reduction == Decimal(0)
    assert income.floor == Decimal(0)


def test_an_unknown_field_is_rejected_not_ignored() -> None:
    with pytest.raises(ValidationError, match="surprise"):
        IncomeSection.model_validate({**_INCOME, "surprise": 1})


def test_an_income_weight_above_one_is_rejected() -> None:
    with pytest.raises(ValidationError):
        IncomeSection.model_validate({**_INCOME, "weights": {"prior_year": "1.2", "current_year": "0"}})


@pytest.mark.parametrize(("r1", "total"), [("101", "100"), ("50", "100.5"), ("-1", "10")])
def test_percentages_stay_between_0_and_100(r1: str, total: str) -> None:
    with pytest.raises(ValidationError):
        TierPercents.model_validate({"r1_pct": r1, "total_pct": total})


def test_a_negative_equity_weight_is_rejected() -> None:
    # The sheet let a negative weight through and ROUNDUP moved it away from zero.
    with pytest.raises(ValidationError):
        EquitySection.model_validate({"criteria": [], "weights": {"camp": {"bipoc": "-0.5"}}})


def test_at_least_needs_min_value_and_text_matches_need_values() -> None:
    base = {"key": "dependents", "label": "Dependents", "source": "household", "field": "dependents"}
    with pytest.raises(ValidationError, match="min_value"):
        EquityCriterion.model_validate({**base, "match": "at_least"})
    with pytest.raises(ValidationError, match="at least one value"):
        EquityCriterion.model_validate({**base, "match": "equals_any", "values": []})
    ok = EquityCriterion.model_validate({**base, "match": "at_least", "min_value": "4"})
    assert ok.min_value == Decimal(4)


def test_also_fields_defaults_to_empty_and_accepts_a_list() -> None:
    base = {
        "key": "gender_identity",
        "label": "Gender identity",
        "source": "camper",
        "field": "gender_identity",
        "match": "equals_any",
        "values": ["transgender", "nonbinary"],
    }
    default = EquityCriterion.model_validate(base)
    assert default.also_fields == []
    with_also = EquityCriterion.model_validate({**base, "also_fields": ["pronouns"]})
    assert with_also.also_fields == ["pronouns"]


def test_stage_round_is_bounded_1_to_3() -> None:
    # Exercises "stages.stages.round": the calculator does not read it (sub-project 10
    # will), but it shares awards.decision_types.*.round's bounds and is proven the
    # same way -- a bad value is refused, a good one is kept.
    base = {"code": "r1_offered", "label": "Round 1 offered"}
    with pytest.raises(ValidationError):
        StageDef.model_validate({**base, "round": 4})
    with pytest.raises(ValidationError):
        StageDef.model_validate({**base, "round": 0})
    assert StageDef.model_validate({**base, "round": 1}).round == 1
    assert StageDef.model_validate(base).round is None


def test_a_table_either_lists_tiers_or_inherits_and_overrides() -> None:
    row = {"r1_pct": "50", "total_pct": "60"}
    with pytest.raises(ValidationError, match="overrides"):
        AwardTable.model_validate({"tiers": {"1": row}, "overrides": {"1": {"r1_pct": "40"}}})
    with pytest.raises(ValidationError, match="tiers"):
        AwardTable.model_validate({"inherits": "camp", "tiers": {"1": row}})
    inheriting = AwardTable.model_validate({"inherits": "camp", "overrides": {"2": {"r1_pct": "40"}}})
    assert inheriting.overrides[2].r1_pct == Decimal(40)
    assert inheriting.overrides[2].total_pct is None


def test_program_tables_may_be_null_meaning_no_table() -> None:
    profile = ProgramProfile.model_validate(
        {
            "label": "Adult weekend",
            "r1_table": None,
            "r2_table": "family",
            "equity_class": "family",
            "budget_pool": "weekend_pool",
            "cost_source": "catalog",
        }
    )
    assert profile.r1_table is None
    assert profile.open_to_aid is True
    assert profile.session_cm_ids == []


def test_a_program_must_say_which_tables_it_uses() -> None:
    with pytest.raises(ValidationError, match="r1_table"):
        ProgramProfile.model_validate(
            {"label": "Summer", "r2_table": "camp", "equity_class": None, "budget_pool": None, "cost_source": "catalog"}
        )


def test_the_fictional_season_is_a_valid_document() -> None:
    rules = fictional_rules()
    assert rules.year == 2031
    assert set(rules.programs) == set(DEFAULT_PROGRAM_KEYS)
    for name in SECTION_NAMES:
        assert hasattr(rules, name), name


def test_json_round_trip_through_strings_is_lossless() -> None:
    # (Review Focus) PocketBase stores the document as JSON: Decimals become strings
    # and integer tier / session keys become string keys. It must come back equal.
    rules = fictional_rules()
    stored = json.loads(rules.model_dump_json())
    assert stored["award_tables"]["camp"]["tiers"]["2"]["r1_pct"] == "75"
    assert AidRules.model_validate(stored) == rules


def test_program_keys_must_be_lower_snake_case() -> None:
    doc = fictional_rules_json()
    doc["programs"]["Summer Camp"] = doc["programs"].pop("summer")
    with pytest.raises(ValidationError):
        AidRules.model_validate(doc)


def test_an_unknown_quality_check_is_rejected() -> None:
    doc = fictional_rules_json()
    doc["quality_checks"]["checks"]["gut_feeling"] = {"severity": "warn"}
    with pytest.raises(ValidationError, match="gut_feeling"):
        AidRules.model_validate(doc)


def test_a_budget_pool_is_a_share_or_an_amount_never_both_or_neither() -> None:
    with pytest.raises(ValidationError, match="exactly one"):
        BudgetPool.model_validate({"label": "Camp", "share_pct": "80", "amount": "400000"})
    with pytest.raises(ValidationError, match="exactly one"):
        BudgetPool.model_validate({"label": "Camp"})


def test_decision_type_amounts_must_fit_the_kind() -> None:
    with pytest.raises(ValidationError, match="needs amount"):
        DecisionType.model_validate({"label": "Top-up", "kind": "top_up", "round": 2, "budget_line": "t"})
    with pytest.raises(ValidationError, match="fixed amount"):
        DecisionType.model_validate(
            {"label": "Full", "kind": "full_cost", "round": 1, "amount": "10", "budget_line": "f"}
        )
    with pytest.raises(ValidationError, match="extra_amount"):
        DecisionType.model_validate(
            {"label": "Top-up", "kind": "top_up", "round": 2, "amount": "10", "extra_amount": "5", "budget_line": "t"}
        )


# Levers the calculator does not read. Sub-projects 5, 9 and 10 consume them; here
# they are exercised by proving a bad value is refused and a good one is kept.
_NON_CALCULATOR_LEVERS: list[tuple[str, Any, Any]] = [
    ("cost.infant_age_cutoff_months", -1, 18),
    ("awards.rounding", "half_even", "half_up"),
    ("budget.total", "-1", "750000"),
    ("budget.spillover", "sideways", "shared"),
    ("budget.commit_on", "posted", "accepted"),
    ("awards.decision_types.appeal_top_up.round", 4, 3),
    ("awards.decision_types.appeal_top_up.budget_line", "", "appeal_top_ups"),
    ("awards.decision_types.appeal_top_up.kind", "gift", "top_up"),
    ("awards.decision_types.appeal_top_up.amount", None, "125"),
    ("awards.decision_types.full_cost_program.extra_amount", "-1", "20"),
    ("quality_checks.checks.income_above.severity", "fatal", "block"),
]


@pytest.mark.parametrize(("path", "bad", "good"), _NON_CALCULATOR_LEVERS)
def test_non_calculator_levers_refuse_bad_values_and_keep_good_ones(path: str, bad: Any, good: Any) -> None:
    rules = fictional_rules()
    with pytest.raises(ValidationError):
        with_lever(rules, path, bad)
    changed = with_lever(rules, path, good)
    node: Any = changed.model_dump(mode="json")
    for part in path.split("."):
        node = node[part]
    assert str(node) == str(good)


def test_default_programs_start_closed_to_aid() -> None:
    # A brand-new season awards nothing until staff route each program.
    profiles = default_program_profiles()
    assert tuple(profiles) == DEFAULT_PROGRAM_KEYS
    assert DEFAULT_PROGRAM_KEYS == (
        "summer",
        "quest",
        "teen",
        "bmitzvah",
        "family_camp",
        "adult_weekend",
        "family_school",
        "other",
    )
    assert all(not p.open_to_aid for p in profiles.values())
    assert all(p.r1_table is None and p.r2_table is None for p in profiles.values())
    assert profiles["family_camp"].cost_source == "per_person"
    assert {k for k, p in profiles.items() if p.cost_source == "catalog"} == set(DEFAULT_PROGRAM_KEYS) - {"family_camp"}

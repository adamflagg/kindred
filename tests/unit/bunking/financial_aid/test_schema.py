"""Structure of the rules document. Cross-field policy checks are in test_validation.py."""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from bunking.financial_aid.rules.schema import (
    SECTION_NAMES,
    AwardTable,
    EquityCriterion,
    EquitySection,
    IncomeSection,
    ProgramProfile,
    TierPercents,
)

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

"""Structure of the rules document. Cross-field policy checks are in test_validation.py."""

import json
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from bunking.financial_aid.rules.schema import (
    SECTION_NAMES,
    AidRules,
    AwardTable,
    BudgetSection,
    DecisionType,
    EquityCriterion,
    EquitySection,
    IncomeSection,
    ProgramProfile,
    QualityCheck,
    R1Percent,
    Round2Table,
    TotalPercent,
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


def test_the_thirteen_sections_in_spec_order() -> None:
    """Ruled change (§6.4, §9.9): stages left the schema, so the sections are thirteen."""
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


@pytest.mark.parametrize("pct", ["101", "100.5", "-1"])
def test_percentages_stay_between_0_and_100(pct: str) -> None:
    with pytest.raises(ValidationError):
        R1Percent.model_validate({"r1_pct": pct})
    with pytest.raises(ValidationError):
        TotalPercent.model_validate({"total_pct": pct})


def test_a_round_1_table_carries_no_round_2_percentage() -> None:
    # The total (appeal cap) % is a Round 2 lever and lives in round2.tables (spec 7.1).
    with pytest.raises(ValidationError, match="total_pct"):
        AwardTable.model_validate({"tiers": {"1": {"r1_pct": "50", "total_pct": "60"}}})


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
    row = {"r1_pct": "50"}
    with pytest.raises(ValidationError, match="overrides"):
        AwardTable.model_validate({"tiers": {"1": row}, "overrides": {"1": {"r1_pct": "40"}}})
    with pytest.raises(ValidationError, match="tiers"):
        AwardTable.model_validate({"inherits": "camp", "tiers": {"1": row}})
    inheriting = AwardTable.model_validate({"inherits": "camp", "overrides": {"2": {"r1_pct": "40"}}})
    assert inheriting.overrides[2].r1_pct == Decimal(40)
    with pytest.raises(ValidationError, match="tiers"):
        Round2Table.model_validate({"inherits": "camp", "tiers": {"1": {"total_pct": "60"}}})


def test_program_tables_may_be_null_meaning_no_table() -> None:
    profile = ProgramProfile.model_validate(
        {
            "label": "Adult weekend",
            "r1_table": None,
            "equity_class": "family",
            "budget_pool": "weekend_pool",
            "cost_source": "catalog",
        }
    )
    assert profile.r1_table is None
    assert profile.open_to_aid is True
    assert profile.session_cm_ids == []


def test_a_program_without_r1_table_loads_by_its_equity_class() -> None:
    """Ruled change (§8.5): a program no longer names its tables; its equity class does."""
    profile = ProgramProfile.model_validate(
        {"label": "Summer", "equity_class": None, "budget_pool": None, "cost_source": "catalog"}
    )
    assert profile.table_from_equity_class is True
    assert profile.r1_table is None


def test_the_fictional_season_is_a_valid_document() -> None:
    rules = fictional_rules()
    assert rules.year == 2031
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


def test_a_full_cost_after_aid_type_never_counts_toward_the_budget() -> None:
    """Owner 10-06: the fund's remainder sits below the line. `counts_toward_budget` defaults to True, and a type that
    counts takes its whole round into the budget (budget.counted_part), so this kind must say False."""
    fund = {"label": "Named full-cost fund", "kind": "full_cost_after_aid", "round": 1, "allows_appeal": False}
    with pytest.raises(ValidationError, match="doesn't count toward the budget"):
        DecisionType.model_validate(fund)
    assert DecisionType.model_validate({**fund, "counts_toward_budget": False}).kind == "full_cost_after_aid"


# Type checks only: each path refuses a bad value and keeps a good one. This is not
# lever coverage -- test_lever_coverage.py deliberately ignores this file. The levers
# here that the calculator reads (a decision type's kind, amount and extra_amount, a
# check's severity) are exercised in test_decision_types.py and test_quality.py; the
# ones nothing reads yet are deferred in test_lever_coverage._WIRED_BY_LATER_SUBPROJECT.
_SCHEMA_TYPE_CHECKS: list[tuple[str, Any, Any]] = [
    ("cost.infant_age_cutoff_months", -1, 18),
    ("awards.rounding", "half_even", "half_up"),
    ("budget.total", "-1", "750000"),
    ("awards.decision_types.appeal_top_up.round", 4, 3),
    ("awards.decision_types.appeal_top_up.kind", "gift", "top_up"),
    ("awards.decision_types.appeal_top_up.amount", None, "125"),
    ("awards.decision_types.full_cost_program.extra_amount", "-1", "20"),
    ("quality_checks.checks.income_above.severity", "block", "hold"),
    ("awards.decision_types.appeal_top_up.counts_toward_budget", "maybe", False),
]


def test_a_quality_check_holds_unless_the_season_says_warn() -> None:
    # Owner ruling 2026-09-25: every check holds by default and may be made a warning.
    assert QualityCheck().severity == "hold"


def test_a_decision_type_counts_toward_the_budget_and_is_stopped_by_the_ceiling_by_default() -> None:
    decision = DecisionType.model_validate(
        {"label": "Top-up", "kind": "top_up", "round": 3, "amount": "10", "budget_line": "t"}
    )
    assert (decision.counts_toward_budget, decision.ceiling_exempt) == (True, False)


@pytest.mark.parametrize(("path", "bad", "good"), _SCHEMA_TYPE_CHECKS)
def test_the_schema_refuses_bad_lever_values_and_keeps_good_ones(path: str, bad: Any, good: Any) -> None:
    rules = fictional_rules()
    with pytest.raises(ValidationError):
        with_lever(rules, path, bad)
    changed = with_lever(rules, path, good)
    node: Any = changed.model_dump(mode="json")
    for part in path.split("."):
        node = node[part]
    assert str(node) == str(good)


def test_a_stored_document_with_every_retired_budget_key_still_loads_and_never_writes_them() -> None:
    """Review Focus 1, §9.1: 2026 and the preview's 2027 v4/v5 carry reserves, spillover and commit_on."""
    doc = fictional_rules_json()
    doc["budget"] |= {
        "reserves": {"camp_pool": {"r2": "10", "r3": "5"}},
        "spillover": "shared",
        "commit_on": "accepted",
    }
    rules = AidRules.model_validate(doc)
    dumped = rules.model_dump(mode="json")["budget"]
    assert set(dumped) == {"total", "pools"}


def test_a_pool_given_as_an_amount_loads_as_its_exact_share() -> None:
    """§8.4: amount / total x 100, exact in Decimal; validation then judges it like any typed share."""
    section = BudgetSection.model_validate(
        {
            "total": "600000",
            "pools": {"a": {"label": "Pool A", "amount": "150000"}, "b": {"label": "Pool B", "share_pct": "75"}},
        }
    )
    assert section.pools["a"].share_pct == Decimal(25)
    assert "amount" not in section.pools["a"].model_dump()


def test_a_pool_given_a_null_share_and_an_amount_takes_the_amount() -> None:
    section = BudgetSection.model_validate(
        {"total": "200", "pools": {"a": {"label": "Pool A", "share_pct": None, "amount": "50"}}}
    )
    assert section.pools["a"].share_pct == Decimal(25)


@pytest.mark.parametrize("amount", ["lots", [1], {"x": 1}])
def test_a_pool_amount_that_is_not_a_number_is_refused_not_a_crash(amount: Any) -> None:
    """A non-numeric amount derives no share, so the missing share is refused as a 422, never a raw 500."""
    with pytest.raises(ValidationError):
        BudgetSection.model_validate({"total": "200", "pools": {"a": {"label": "Pool A", "amount": amount}}})


def test_a_pool_needs_a_share() -> None:
    """Regression guard."""
    with pytest.raises(ValidationError):
        BudgetSection.model_validate({"total": "100", "pools": {"a": {"label": "Pool A"}}})


def test_an_equity_criterion_is_enabled_unless_stored_otherwise() -> None:
    """§8.6: no stored criterion carries `enabled`, so every stored document prices the same."""
    rules = fictional_rules()
    assert all(c.enabled for c in rules.equity.criteria)


def test_the_programs_editor_writes_the_flag_and_no_r1_table() -> None:
    """§9.9: a program sent with the flag true and no r1_table loads by class; the minimum-without-table switch and
    program_tables keep defaults (legacy)."""
    doc = fictional_rules_json()
    doc["programs"]["summer"] = {k: v for k, v in doc["programs"]["summer"].items() if k != "r1_table"} | {
        "table_from_equity_class": True
    }
    del doc["awards"]["minimum_without_table"]
    rules = AidRules.model_validate(doc)
    assert (rules.programs["summer"].table_from_equity_class, rules.programs["summer"].r1_table) == (True, None)
    assert rules.awards.minimum_without_table is True


CULLED = {
    "stages": {"stages": [{"code": "r1_offered", "label": "Round 1 offered", "round": 1, "is_offer": True}]},
}


def test_a_stored_v4_shaped_document_with_every_culled_key_loads_and_never_writes_them() -> None:
    """Review Focus 1, §9.9: stages, incentives, a child rate and a budget line are popped on load."""
    doc = fictional_rules_json() | CULLED
    doc["grants"]["incentives"] = {"new_family": {"mode": "ignore"}}
    doc["cost"]["family_rates"][0]["child"] = "450"
    doc["awards"]["decision_types"]["appeal_top_up"]["budget_line"] = "top_ups"
    rules = AidRules.model_validate(doc)
    dumped = rules.model_dump(mode="json")
    assert "stages" not in dumped
    assert "incentives" not in dumped["grants"]
    assert "child" not in dumped["cost"]["family_rates"][0]
    assert "budget_line" not in dumped["awards"]["decision_types"]["appeal_top_up"]


def test_every_class_has_a_weight_for_every_criterion_zeros_included() -> None:
    """§9.9: a missing weight already counted as 0; the loader now stores the 0, so the equity editor shows a box."""
    weights = fictional_rules().equity.weights
    keys = {c.key for c in fictional_rules().equity.criteria}
    assert all(set(row) == keys for row in weights.values())
    assert weights["family"]["bipoc"] == Decimal(0)
    assert weights["camp"]["bipoc"] == Decimal("0.5")


def test_the_full_matrix_also_fills_criteria_built_as_models() -> None:
    """Code that builds the section from EquityCriterion instances, not dicts, gets the same zeros."""
    criterion = EquityCriterion(
        key="first_time", label="First time", source="camper", field="is_first_year", match="equals_any", values=["yes"]
    )
    section = EquitySection.model_validate({"criteria": [criterion], "weights": {"camp": {}}})
    assert section.weights == {"camp": {"first_time": Decimal(0)}}


def test_stages_is_no_longer_a_section() -> None:
    """The cull leaves thirteen sections."""
    assert "stages" not in SECTION_NAMES
    assert len(SECTION_NAMES) == 13

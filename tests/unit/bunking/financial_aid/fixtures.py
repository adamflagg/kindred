"""A fictional financial-aid season for the engine tests.

EVERY value here is invented. It is shaped like a real season -- tier bands,
two-percentage award tables, program profiles, pools, per-person family-camp
rates -- but no figure is a real policy value. Never paste a real season's
numbers into this file; the real 2026 document lives only in the gitignored
docs/plans/campership-data/.

Levers are changed with ``with_lever(rules, "dotted.path", value)``. Pass the path
as a string LITERAL: test_lever_coverage.py finds every lever by searching the
test sources for these literals.
"""

from __future__ import annotations

from typing import Any

from bunking.financial_aid.calculator.inputs import ApplicationInputs, RequestInputs
from bunking.financial_aid.rules.schema import AidRules

# summer 1000101-1000102 · quest 1000103 · teen 1000104 · bmitzvah 1000301 ·
# family camp 1000201 · adult weekend 1000401 · family school 1000501
FICTIONAL_SESSION_IDS: tuple[int, ...] = (1000101, 1000102, 1000103, 1000104, 1000201, 1000301, 1000401, 1000501)


def _program(
    label: str,
    sessions: list[int],
    r1: str | None,
    equity: str | None,
    pool: str | None,
    cost_source: str,
    *,
    session_types: list[str] | None = None,
    open_to_aid: bool = True,
) -> dict[str, Any]:
    return {
        "label": label,
        "session_cm_ids": sessions,
        "session_types": session_types or [],
        "r1_table": r1,
        "equity_class": equity,
        "budget_pool": pool,
        "cost_source": cost_source,
        "open_to_aid": open_to_aid,
    }


def fictional_rules_json() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "year": 2031,
        "income": {
            "weights": {"prior_year": "0.7", "current_year": "0.3"},
            "basis": "gross",
            "current_year_zero_fallback": "blend",
            "medical_threshold": "4000",
            "medical_rate": "1",
            "education_threshold": "1000",
            "education_rate": "1",
            "savings_threshold": "150000",
            "savings_inclusion_rate": "1",
            "dependents_mode": "income_reduction",
            "per_dependent_reduction": "0",
            "floor": "0",
            "floor_applies_after": "all_reductions",
        },
        "tiers": {
            "bands": [
                {"lower": "0", "upper": "40000"},
                {"lower": "40001", "upper": "80000"},
                {"lower": "80001", "upper": "120000"},
                {"lower": "120001", "upper": "160000"},
                {"lower": "160001", "upper": "200000"},
                {"lower": "200001"},
            ],
            "income_ceiling": None,
            "floor_tier": 1,
        },
        "equity": {
            "criteria": [
                {
                    "key": "unemployment",
                    "label": "Unemployment",
                    "source": "household",
                    "field": "unemployment",
                    "match": "equals_any",
                    "values": ["yes"],
                },
                {
                    "key": "single_parent",
                    "label": "Single parent",
                    "source": "household",
                    "field": "single_parent",
                    "match": "equals_any",
                    "values": ["yes"],
                },
                {
                    "key": "bipoc",
                    "label": "Person of color",
                    "source": "camper",
                    "field": "bipoc",
                    "match": "equals_any",
                    "values": ["yes"],
                },
                {
                    "key": "trans_nb",
                    "label": "Transgender or non-binary",
                    "source": "camper",
                    "field": "gender_identity",
                    "match": "contains_any",
                    "values": ["trans", "non-binary", "nonbinary"],
                },
                {
                    "key": "dependents",
                    "label": "Four or more dependents",
                    "source": "household",
                    "field": "dependents",
                    "match": "at_least",
                    "min_value": "4",
                },
            ],
            "weights": {
                "camp": {"bipoc": "0.5", "trans_nb": "0.5"},
                "teen": {"bipoc": "0.5", "trans_nb": "0.5"},
                "family": {},
            },
            "aggregation": "ceil",
            "max_shift": None,
        },
        "award_tables": {
            "camp": {
                "tiers": {
                    "1": {"r1_pct": "90"},
                    "2": {"r1_pct": "75"},
                    "3": {"r1_pct": "55"},
                    "4": {"r1_pct": "35"},
                    "5": {"r1_pct": "15"},
                    "6": {"r1_pct": "2"},
                }
            },
            "family": {"inherits": "camp"},
            "teen": {"inherits": "camp", "overrides": {"2": {"r1_pct": "70"}}},
        },
        "programs": {
            "summer": _program(
                "Summer", [1000101, 1000102], "camp", "camp", "camp_pool", "catalog", session_types=["main"]
            ),
            "quest": _program("Quest", [1000103], "camp", "camp", "camp_pool", "catalog"),
            "teen": _program("Teen", [1000104], "teen", "teen", "camp_pool", "catalog"),
            "bmitzvah": _program("B'mitzvah", [1000301], "camp", "camp", "bmitzvah_pool", "catalog"),
            "family_camp": _program("Family camp", [1000201], "family", None, "weekend_pool", "per_person"),
            "adult_weekend": _program("Adult weekend", [1000401], None, "family", "weekend_pool", "catalog"),
            "family_school": _program("Family school", [1000501], None, None, "weekend_pool", "typed"),
            "other": _program("Other", [], None, None, None, "catalog", open_to_aid=False),
        },
        "cost": {
            "tuition": {
                "1000101": "2000",
                "1000102": "4000",
                "1000103": "6000",
                "1000104": "5000",
                "1000301": "3000",
                "1000401": "900",
            },
            "family_rates": [{"session_cm_id": 1000201, "standard": "600", "infant": "300", "child": None}],
            "infant_age_cutoff_months": 24,
            "override_reasons": [
                "headcount",
                "partial_session",
                "discount",
                "missing_catalog",
                "typed_household_total",
            ],
        },
        "grants": {
            "offset_programs": ["summer", "quest"],
            "offset_mode": "dollar",
            "minimum_after_grants": True,
            "minimum_when_fully_covered": True,
            "count_when": "committed",
            "late_grant_policy": "flag",
            "incentives": {"new_family": {"mode": "ignore"}},
        },
        "awards": {
            "minimum": "100",
            "minimum_when_cost_unknown": True,
            "minimum_without_table": True,
            "rounding": "half_up",
            "ask_cap": True,
            "decision_types": {
                "full_cost_program": {
                    "label": "Full-cost program",
                    "kind": "full_cost",
                    "round": 1,
                    "extra_amount": "50",
                    "allows_appeal": False,
                    "budget_line": "full_cost",
                },
                "appeal_top_up": {
                    "label": "Appeal top-up",
                    "kind": "top_up",
                    "round": 2,
                    "amount": "250",
                    "budget_line": "top_ups",
                },
                "discretionary": {
                    "label": "Discretionary",
                    "kind": "discretionary",
                    "round": 3,
                    "budget_line": "discretionary",
                },
            },
        },
        "round2": {
            "cap_subtracts_grants": False,
            "cap_by_original_ask": False,
            "tables": {
                "camp": {
                    "tiers": {
                        "1": {"total_pct": "97"},
                        "2": {"total_pct": "90"},
                        "3": {"total_pct": "75"},
                        "4": {"total_pct": "55"},
                        "5": {"total_pct": "30"},
                        "6": {"total_pct": "12"},
                    }
                },
                "family": {"inherits": "camp"},
                "teen": {"inherits": "camp", "overrides": {"2": {"total_pct": "90"}}},
            },
            "program_tables": {
                "summer": "camp",
                "quest": "camp",
                "teen": "teen",
                "bmitzvah": "camp",
                "family_camp": "family",
                "adult_weekend": "family",
                "family_school": None,
                "other": None,
            },
            "total_cap": None,
        },
        "round3": {
            "require_round2": True,
            "require_statement_of_need": True,
            "max_amount": "1500",
            "max_total_pct_of_cost": None,
        },
        "budget": {
            "total": "500000",
            "pools": {
                "camp_pool": {"label": "Camp", "share_pct": "80"},
                "weekend_pool": {"label": "Weekends", "share_pct": "15"},
                "bmitzvah_pool": {"label": "B'mitzvah", "share_pct": "5"},
            },
            "reserves": {"camp_pool": {"r2": "10", "r3": "5"}},
            "spillover": "none",
            "commit_on": "offered",
        },
        "stages": {
            "stages": [
                {"code": "r1_offered", "label": "Round 1 offered", "round": 1, "is_offer": True},
                {"code": "r1_accepted", "label": "Round 1 accepted", "round": 1, "is_accepted": True},
                {
                    "code": "full_cost",
                    "label": "Full-cost program",
                    "round": 1,
                    "decision_type": "full_cost_program",
                    "allows_appeal": False,
                },
                {
                    "code": "cancelled",
                    "label": "Cancelled",
                    "is_cancel": True,
                    "counts_toward_budget": False,
                    "include_default": False,
                },
            ]
        },
        "quality_checks": {
            "checks": {
                "ask_above_cost": {"severity": "warn"},
                "py_confirm_tier_change": {"severity": "warn"},
                "income_above": {"severity": "warn", "threshold": "400000"},
                "expense_above": {"severity": "warn", "threshold": "30000"},
                "multiple_grants": {"severity": "warn"},
                "placeholder_income": {"severity": "hold", "threshold": "1000"},
                "award_above_cost": {"severity": "hold"},
                "appeal_above_ask": {"severity": "warn"},
                "implausible_dependents": {"severity": "warn", "threshold": "12"},
                "family_cost_missing": {"severity": "hold"},
            }
        },
        "milestones": {
            "application_deadline": "2031-02-01",
            "r1_run": "2031-03-01",
            "response_deadline": "2031-03-20",
            "r2_window_start": "2031-03-01",
            "r2_window_end": "2031-06-30",
            "r3_window_start": "2031-05-01",
            "r3_window_end": "2031-08-15",
        },
    }


def fictional_rules() -> AidRules:
    return AidRules.model_validate(fictional_rules_json())


def with_levers(rules: AidRules, changes: dict[str, Any]) -> AidRules:
    """A copy of ``rules`` with levers changed. Keys are dotted lever paths."""
    doc = rules.model_dump(mode="json")
    for path, value in changes.items():
        node: Any = doc
        parts = path.split(".")
        for part in parts[:-1]:
            node = node[part]
        node[parts[-1]] = value
    return AidRules.model_validate(doc)


def with_lever(rules: AidRules, path: str, value: Any) -> AidRules:
    """A copy of ``rules`` with one lever changed, e.g. ``"grants.minimum_after_grants"``."""
    return with_levers(rules, {path: value})


def app(**fields: Any) -> ApplicationInputs:
    """A fictional household application. Default: 60,000 both years -> tier 2."""
    base: dict[str, Any] = {"household_cm_id": 1000001, "prior_year_gross": "60000", "current_year_gross": "60000"}
    return ApplicationInputs.model_validate({**base, **fields})


def req(**fields: Any) -> RequestInputs:
    """A fictional request. Default: Emma Johnson (1000002), summer session 1000102 (4,000), asking 4,000."""
    base: dict[str, Any] = {"person_cm_id": 1000002, "session_cm_id": 1000102, "program_key": "summer", "ask": "4000"}
    return RequestInputs.model_validate({**base, **fields})

"""Policy checks over a structurally valid document: errors block approval, warnings inform."""

from decimal import Decimal

import pytest

from bunking.financial_aid.rules import (
    SessionRef,
    ValidationContext,
    resolve_program,
    resolved_table,
    validate_rules,
)
from tests.unit.bunking.financial_aid.fixtures import FICTIONAL_SESSION_IDS, fictional_rules, with_lever, with_levers


def _context(*extra: SessionRef) -> ValidationContext:
    return ValidationContext(sessions=[SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS] + list(extra))


def test_the_fictional_season_has_no_errors_and_only_the_expected_warnings() -> None:
    report = validate_rules(fictional_rules(), _context())
    assert report.ok
    assert report.errors == []
    # adult_weekend and family_school deliberately have no Round 1 table.
    assert sorted((w.code, w.path) for w in report.warnings) == [
        ("no_round1_table", "programs.adult_weekend.r1_table"),
        ("no_round1_table", "programs.family_school.r1_table"),
    ]


# --- award tables ---------------------------------------------------------------------


def test_r1_above_total_at_a_tier_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.3.r1_pct", "80")
    report = validate_rules(rules)
    assert "r1_above_total" in report.codes()
    assert report.errors_in("award_tables")


def test_r1_rising_with_tier_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "award_tables.teen.overrides.2.r1_pct", "95")
    assert "r1_increases_with_tier" in validate_rules(rules).codes()


def test_total_rising_with_tier_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.4.total_pct", "80")
    assert "total_increases_with_tier" in validate_rules(rules).codes()


def test_a_table_must_cover_every_band() -> None:
    rules = with_lever(fictional_rules(), "tiers.bands", [{"lower": "0"}, {"lower": "50001"}])
    report = validate_rules(rules)
    assert "tiers_do_not_match_bands" in report.codes()


def test_an_inheriting_table_must_name_a_real_parent() -> None:
    rules = with_lever(fictional_rules(), "award_tables.teen.inherits", "nowhere")
    assert "unknown_parent_table" in validate_rules(rules).codes()


def test_an_override_changes_only_the_tiers_it_names() -> None:
    rules = with_lever(fictional_rules(), "award_tables.teen.overrides.2.total_pct", "88")
    table = resolved_table(rules, "teen")
    assert table[2].r1_pct == Decimal(70)
    assert table[2].total_pct == Decimal(88)
    assert table[3] == resolved_table(rules, "camp")[3]


def test_a_value_that_cannot_bind_is_a_warning() -> None:
    # 1% of the dearest price routed to the camp table (6,000) is 60, below the 100
    # minimum, so the minimum decides every tier-6 award and the setting does nothing.
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.6.r1_pct", "1")
    report = validate_rules(rules)
    assert report.ok
    assert ("value_cannot_bind", "award_tables.camp.tiers.6") in {(w.code, w.path) for w in report.warnings}


# --- tiers ----------------------------------------------------------------------------


def test_bands_must_start_at_zero_and_rise() -> None:
    rules = fictional_rules()
    assert "first_band_not_zero" in validate_rules(with_lever(rules, "tiers.bands", [{"lower": "10"}])).codes()
    falling = [{"lower": "0"}, {"lower": "50000"}, {"lower": "40000"}]
    assert "bands_not_increasing" in validate_rules(with_lever(rules, "tiers.bands", falling)).codes()


def test_the_floor_tier_must_exist() -> None:
    rules = with_lever(fictional_rules(), "tiers.floor_tier", 7)
    assert "floor_tier_out_of_range" in validate_rules(rules).codes()


def test_an_upper_bound_on_the_last_band_is_not_enforced() -> None:
    # Exercises "tiers.bands.upper": the calculator never reads it (the lookup uses
    # lower bounds only), but validation does -- setting it on the last band warns.
    bands = [{"lower": "0", "upper": "40000"}, {"lower": "40001", "upper": "80000"}]
    rules = with_levers(
        fictional_rules(),
        {
            "tiers.bands": bands,
            "award_tables.camp.tiers": {
                "1": {"r1_pct": "90", "total_pct": "97"},
                "2": {"r1_pct": "75", "total_pct": "90"},
            },
            "award_tables.teen.overrides": {},
        },
    )
    assert "last_band_upper_not_enforced" in {w.code for w in validate_rules(rules).warnings}


# --- equity ---------------------------------------------------------------------------


def test_weights_must_name_known_criteria() -> None:
    rules = with_lever(fictional_rules(), "equity.weights", {"camp": {"astrology": "1"}, "teen": {}, "family": {}})
    assert "unknown_criterion" in validate_rules(rules).codes()


def test_criterion_keys_are_unique() -> None:
    rules = fictional_rules()
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    rules = with_lever(rules, "equity.criteria", [*criteria, criteria[0]])
    assert "duplicate_criterion" in validate_rules(rules).codes()


def test_a_dependents_weight_without_tier_shift_mode_cannot_bind() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "equity.weights": {"camp": {"dependents": "1"}, "teen": {}, "family": {}},
            "income.dependents_mode": "income_reduction",
        },
    )
    assert "dependents_weight_cannot_bind" in {w.code for w in validate_rules(rules).warnings}


# --- income ---------------------------------------------------------------------------


def test_weights_that_do_not_sum_to_one_warn() -> None:
    rules = with_lever(fictional_rules(), "income.weights.prior_year", "0.6")
    assert "weights_do_not_sum_to_one" in {w.code for w in validate_rules(rules).warnings}


def test_the_sheet_floor_order_with_a_dependent_reduction_warns() -> None:
    rules = with_levers(
        fictional_rules(),
        {"income.floor_applies_after": "deductions", "income.per_dependent_reduction": "2500"},
    )
    assert "negative_income_possible" in {w.code for w in validate_rules(rules).warnings}


def test_a_dependent_reduction_outside_income_mode_cannot_bind() -> None:
    rules = with_levers(
        fictional_rules(), {"income.dependents_mode": "tier_shift", "income.per_dependent_reduction": "2500"}
    )
    assert "dependent_reduction_cannot_bind" in {w.code for w in validate_rules(rules).warnings}


# --- programs -------------------------------------------------------------------------


def test_an_unmapped_session_is_an_error_never_a_silent_zero() -> None:
    report = validate_rules(fictional_rules(), _context(SessionRef(cm_id=1000999, session_type="hebrew")))
    assert [(e.code, e.section) for e in report.errors] == [("unmapped_session", "programs")]
    assert "1000999" in report.errors[0].message


def test_a_session_type_maps_a_session_no_program_lists() -> None:
    report = validate_rules(fictional_rules(), _context(SessionRef(cm_id=1000777, session_type="main")))
    assert report.ok
    assert resolve_program(fictional_rules(), 1000777, "main") == "summer"
    assert resolve_program(fictional_rules(), 1000103, "main") == "quest"  # the explicit id wins
    assert resolve_program(fictional_rules(), 1000999, None) is None


def test_a_session_claimed_by_two_programs_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "programs.quest.session_cm_ids", [1000103, 1000101])
    assert "session_in_two_programs" in validate_rules(rules).codes()


def test_a_session_type_claimed_by_two_programs_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "programs.quest.session_types", ["main"])
    assert "session_type_in_two_programs" in validate_rules(rules).codes()


@pytest.mark.parametrize(
    ("path", "value", "code"),
    [
        ("programs.summer.r1_table", "gold", "unknown_table"),
        ("programs.summer.equity_class", "nobody", "unknown_equity_class"),
        ("programs.summer.budget_pool", "piggy_bank", "unknown_budget_pool"),
    ],
)
def test_a_program_must_reference_things_that_exist(path: str, value: str, code: str) -> None:
    assert code in validate_rules(with_lever(fictional_rules(), path, value)).codes()


def test_an_open_program_with_no_pool_is_unclassified() -> None:
    rules = with_lever(fictional_rules(), "programs.summer.budget_pool", None)
    assert "unclassified_program" in {w.code for w in validate_rules(rules).warnings}


def test_grants_may_offset_only_known_programs() -> None:
    rules = with_lever(fictional_rules(), "grants.offset_programs", ["summer", "space_camp"])
    assert "unknown_program" in validate_rules(rules).codes()


# --- cost -----------------------------------------------------------------------------


def test_a_per_person_session_without_a_rate_warns() -> None:
    rules = with_lever(fictional_rules(), "cost.family_rates", [])
    assert ("family_rate_missing", "programs.family_camp.session_cm_ids") in {
        (w.code, w.path) for w in validate_rules(rules).warnings
    }


def test_a_catalog_session_without_tuition_warns() -> None:
    rules = with_lever(fictional_rules(), "cost.tuition", {"1000101": "2000"})
    assert "tuition_missing" in {w.code for w in validate_rules(rules).warnings}


# --- budget ---------------------------------------------------------------------------


def test_pool_shares_must_sum_to_100() -> None:
    rules = with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79.9")
    assert "pool_shares_not_100" in validate_rules(rules).codes()


def test_pools_are_all_shares_or_all_amounts() -> None:
    rules = with_levers(
        fictional_rules(), {"budget.pools.camp_pool.share_pct": None, "budget.pools.camp_pool.amount": "400000"}
    )
    assert "mixed_pool_kinds" in validate_rules(rules).codes()


def test_pool_amounts_must_sum_to_the_total() -> None:
    rules = with_lever(
        fictional_rules(),
        "budget.pools",
        {
            "camp_pool": {"label": "Camp", "amount": "400000"},
            "weekend_pool": {"label": "Weekends", "amount": "75000"},
            "bmitzvah_pool": {"label": "B'mitzvah", "amount": "20000"},
        },
    )
    assert "pool_amounts_not_total" in validate_rules(rules).codes()


def test_reserves_name_real_pools_and_never_exceed_100() -> None:
    rules = with_lever(fictional_rules(), "budget.reserves", {"camp_pool": {"r2": "70", "r3": "40"}, "ghost": {}})
    codes = validate_rules(rules).codes()
    assert "reserves_exceed_pool" in codes
    assert "unknown_reserve_pool" in codes


# --- stages and milestones ------------------------------------------------------------


def test_stage_codes_are_unique_and_decision_types_exist() -> None:
    # Exercises "stages.stages.code" (duplicate_stage) and "stages.stages.decision_type"
    # (unknown_decision_type).
    stages = [
        {"code": "r1_offered", "label": "Offered"},
        {"code": "r1_offered", "label": "Offered again"},
        {"code": "full_cost", "label": "Full cost", "decision_type": "mystery_type"},
    ]
    codes = validate_rules(with_lever(fictional_rules(), "stages.stages", stages)).codes()
    assert "duplicate_stage" in codes
    assert "unknown_decision_type" in codes


@pytest.mark.parametrize(
    ("earlier", "later"),
    [
        ("milestones.application_deadline", "milestones.r1_run"),
        ("milestones.r1_run", "milestones.response_deadline"),
        ("milestones.r2_window_start", "milestones.r2_window_end"),
        ("milestones.r3_window_start", "milestones.r3_window_end"),
    ],
)
def test_milestones_run_forward(earlier: str, later: str) -> None:
    rules = with_levers(fictional_rules(), {earlier: "2031-07-01", later: "2031-06-01"})
    report = validate_rules(rules)
    assert ("milestones_out_of_order", later) in {(e.code, e.path) for e in report.errors}
    assert {e.code for e in report.errors} == {"milestones_out_of_order"}


# --- final review minors ----------------------------------------------------------------


@pytest.mark.parametrize("key", ["income_above", "expense_above", "placeholder_income", "implausible_dependents"])
def test_an_enabled_check_that_needs_a_threshold_and_has_none_warns(key: str) -> None:
    # Without a threshold the check can never fire, so staff think they are covered
    # when they are not.
    rules = with_lever(fictional_rules(), f"quality_checks.checks.{key}", {"severity": "warn"})
    report = validate_rules(rules, _context())
    assert ("quality_checks", "check_has_no_threshold", f"quality_checks.checks.{key}.threshold") in {
        (w.section, w.code, w.path) for w in report.warnings
    }
    assert report.ok  # a warning, not an error
    disabled = with_lever(fictional_rules(), f"quality_checks.checks.{key}", {"enabled": False, "severity": "warn"})
    assert "check_has_no_threshold" not in validate_rules(disabled, _context()).codes()


def test_a_check_that_needs_no_threshold_does_not_warn_without_one() -> None:
    report = validate_rules(fictional_rules(), _context())  # ask_above_cost etc. carry none
    assert "check_has_no_threshold" not in report.codes()


def test_a_season_with_no_synced_sessions_warns_instead_of_skipping_coverage() -> None:
    # An empty session list used to make the unmapped-session check pass by skipping it.
    report = validate_rules(fictional_rules(), ValidationContext(sessions=[]))
    assert ("programs", "no_sessions_to_check") in {(w.section, w.code) for w in report.warnings}
    assert report.ok
    # No context at all (the parity harness) is a deliberate choice and stays quiet.
    assert "no_sessions_to_check" not in validate_rules(fictional_rules()).codes()

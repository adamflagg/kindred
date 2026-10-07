"""Policy checks over a structurally valid document: errors block approval, warnings inform."""

from decimal import Decimal

import pytest

from bunking.financial_aid.rules import (
    SectionName,
    SessionRef,
    ValidationContext,
    resolve_program,
    resolved_table,
    validate_rules,
)
from bunking.financial_aid.rules.schema import AidRules
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
    # Round 1's and Round 2's tables sit in different sections; each program's pair is
    # checked, and the error belongs to Round 2, the later-set lever.
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.3.r1_pct", "80")
    report = validate_rules(rules)
    assert "r1_above_total" in report.codes()
    assert {i.code for i in report.errors_in("round2")} == {"r1_above_total"}


def test_r1_rising_with_tier_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "award_tables.teen.overrides.2.r1_pct", "95")
    assert "r1_increases_with_tier" in validate_rules(rules).codes()


def test_total_rising_with_tier_is_an_error() -> None:
    rules = with_lever(fictional_rules(), "round2.tables.camp.tiers.4.total_pct", "80")
    assert "total_increases_with_tier" in validate_rules(rules).codes()


def test_a_table_must_cover_every_band() -> None:
    rules = with_lever(fictional_rules(), "tiers.bands", [{"lower": "0"}, {"lower": "50001"}])
    report = validate_rules(rules)
    assert "tiers_do_not_match_bands" in report.codes()


@pytest.mark.parametrize(
    ("path", "section"), [("award_tables.teen.inherits", "award_tables"), ("round2.tables.teen.inherits", "round2")]
)
def test_an_inheriting_table_must_name_a_real_parent(path: str, section: SectionName) -> None:
    report = validate_rules(with_lever(fictional_rules(), path, "nowhere"))
    assert "unknown_parent_table" in {i.code for i in report.errors_in(section)}


def test_an_override_changes_only_the_tiers_it_names() -> None:
    rules = with_levers(
        fictional_rules(),
        {"award_tables.teen.overrides.2.r1_pct": "65", "round2.tables.teen.overrides.2.total_pct": "88"},
    )
    assert resolved_table(rules.award_tables, "teen")[2].r1_pct == Decimal(65)
    assert resolved_table(rules.round2.tables, "teen")[2].total_pct == Decimal(88)
    assert resolved_table(rules.round2.tables, "teen")[3] == resolved_table(rules.round2.tables, "camp")[3]


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
    changes = {
        "award_tables.camp.tiers": {
            "1": {"r1_pct": "90"},
            "2": {"r1_pct": "75"},
        },
        "award_tables.teen.overrides": {},
        "round2.tables.camp.tiers": {"1": {"total_pct": "97"}, "2": {"total_pct": "90"}},
        "round2.tables.teen.overrides": {},
    }
    with_upper = with_levers(
        fictional_rules(),
        {**changes, "tiers.bands": [{"lower": "0", "upper": "40000"}, {"lower": "40001", "upper": "80000"}]},
    )
    assert "last_band_upper_not_enforced" in {w.code for w in validate_rules(with_upper).warnings}

    # Proves the warning is actually driven by "tiers.bands.upper", not merely present
    # alongside it: clearing the last band's upper bound (everything else unchanged)
    # removes the warning.
    without_upper = with_levers(
        fictional_rules(),
        {**changes, "tiers.bands": [{"lower": "0", "upper": "40000"}, {"lower": "40001"}]},
    )
    assert "last_band_upper_not_enforced" not in {w.code for w in validate_rules(without_upper).warnings}


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


def _with_criterion(**criterion: object) -> list[dict[str, object]]:
    base = [c.model_dump(mode="json") for c in fictional_rules().equity.criteria]
    return [*base, {"key": "probe", "label": "Probe", "source": "household", **criterion}]


@pytest.mark.parametrize(
    ("match", "values"),
    [
        ("equals_any", ["no"]),
        ("equals_any", ["yes", "False"]),
        ("equals_any", ["0"]),
        ("contains_any", ["o"]),  # a substring of "No" matches it too
    ],
)
def test_a_household_yes_no_criterion_that_matches_no_is_refused(match: str, values: list[str]) -> None:
    # A blank yes/no answer reaches the calculator as No (the mirror stores it as a bool), so a
    # criterion matching No would hand its weight to every family that never answered.
    rules = with_lever(
        fictional_rules(), "equity.criteria", _with_criterion(field="unemployment", match=match, values=values)
    )
    report = validate_rules(rules)
    (issue,) = [i for i in report.errors_in("equity") if i.code == "yes_no_criterion_matches_no"]
    assert issue.path == f"equity.criteria.{len(rules.equity.criteria) - 1}.values"
    assert "unemployment" in issue.message
    assert "never answered" in issue.message


def test_a_yes_no_criterion_matching_no_through_an_also_field_is_refused() -> None:
    criteria = _with_criterion(
        field="dependents_note", also_fields=["gov_subsidies"], match="equals_any", values=["no"]
    )
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "yes_no_criterion_matches_no" in {i.code for i in report.errors}


@pytest.mark.parametrize(
    "criterion",
    [
        {"field": "gov_subsidies", "match": "equals_any", "values": ["yes"]},  # the 2026 shape
        {"field": "special_note", "match": "equals_any", "values": ["no"]},  # not a yes/no answer
    ],
)
def test_a_yes_no_criterion_matching_only_yes_or_a_non_yes_no_field_passes(criterion: dict[str, object]) -> None:
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", _with_criterion(**criterion)))
    assert "yes_no_criterion_matches_no" not in report.codes()


def test_a_camper_answer_matching_no_passes_because_a_blank_camper_answer_stays_unknown() -> None:
    # Named like the household answer, so only the source tells them apart.
    criteria = _with_criterion(field="unemployment", match="equals_any", values=["no"])
    criteria[-1]["source"] = "camper"
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "yes_no_criterion_matches_no" not in report.codes()


# --- retired household fields (owner ruling 2026-09-27: live questions only) -----------


@pytest.mark.parametrize("field", ["still_unemployed", "owns_home"])
def test_a_household_criterion_on_a_retired_field_is_refused(field: str) -> None:
    # These were live through 2025 (or earlier) and are gone from the current CampMinder
    # form: a criterion built against one would never fire, so validation refuses it
    # outright rather than leaving a silently-dead criterion in the document.
    criteria = _with_criterion(field=field, match="equals_any", values=["yes"])
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    (issue,) = [i for i in report.errors if i.code == "retired_household_field"]
    assert field in issue.message


def test_a_household_criterion_may_name_single_parent() -> None:
    # Owner ruling D144 (+ 2026-09-30 follow-up): every tier-boost question stays on the
    # form and finance can switch it on, so single_parent is a live optional field again.
    criteria = _with_criterion(field="single_parent", match="equals_any", values=["yes"])
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "retired_household_field" not in report.codes()
    assert not report.errors


def test_a_single_parent_criterion_matching_no_is_refused_like_the_other_yes_no_fields() -> None:
    criteria = _with_criterion(field="single_parent", match="equals_any", values=["no"])
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "yes_no_criterion_matches_no" in report.codes()


def test_a_household_criterion_on_a_retired_also_field_is_refused() -> None:
    criteria = _with_criterion(
        field="unemployment", also_fields=["still_unemployed"], match="equals_any", values=["yes"]
    )
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "retired_household_field" in {i.code for i in report.errors}


def test_a_camper_criterion_on_a_field_named_like_a_retired_one_is_not_refused() -> None:
    # Guarded by source, the same as the No-matching check.
    criteria = _with_criterion(field="owns_home", match="equals_any", values=["yes"])
    criteria[-1]["source"] = "camper"
    report = validate_rules(with_lever(fictional_rules(), "equity.criteria", criteria))
    assert "retired_household_field" not in report.codes()


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


def test_round_2_routing_names_real_programs_and_tables() -> None:
    rules = fictional_rules()
    unknown_table = with_lever(rules, "round2.program_tables.summer", "gold")
    assert "unknown_table" in {i.code for i in validate_rules(unknown_table).errors_in("round2")}
    routing = {**rules.round2.program_tables, "sailing": "camp"}
    unknown_program = rules.model_copy(update={"round2": rules.round2.model_copy(update={"program_tables": routing})})
    assert "unknown_program" in {i.code for i in validate_rules(unknown_program).errors_in("round2")}


def test_an_open_program_must_say_which_round_2_table_it_uses() -> None:
    # Null is an answer ("no Round 2 table"); a program left out entirely is not.
    rules = fictional_rules()
    routing = {k: v for k, v in rules.round2.program_tables.items() if k != "summer"}
    rules = rules.model_copy(update={"round2": rules.round2.model_copy(update={"program_tables": routing})})
    report = validate_rules(rules)
    assert ("missing_round2_table", "round2.program_tables.summer") in {(i.code, i.path) for i in report.errors}


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


def test_count_when_received_is_an_error_while_receipts_are_parked() -> None:
    """Spec §13 / D55: no grant is ever recorded as received, so "received" would drop every grant."""
    rules = fictional_rules()
    received = rules.model_copy(update={"grants": rules.grants.model_copy(update={"count_when": "received"})})
    report = validate_rules(received)
    assert "grants_count_when_received" in {i.code for i in report.errors}
    assert "grants_count_when_received" not in validate_rules(rules).codes()


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


def test_shares_summing_to_100_by_decimal_are_clean_and_99_99_is_an_error() -> None:
    """Regression guard. Review Focus 3: exact Decimal sums; no float drift."""
    thirds = with_levers(
        fictional_rules(),
        {
            "budget.pools.camp_pool.share_pct": "33.34",
            "budget.pools.weekend_pool.share_pct": "33.33",
            "budget.pools.bmitzvah_pool.share_pct": "33.33",
        },
    )
    assert "pool_shares_not_100" not in validate_rules(thirds).codes()
    short = with_lever(fictional_rules(), "budget.pools.bmitzvah_pool.share_pct", "4.99")
    (issue,) = [i for i in validate_rules(short).errors if i.code == "pool_shares_not_100"]
    assert issue.message == "Pool shares sum to 99.99%, not 100%"


def test_no_reserve_or_amount_code_survives() -> None:
    """Regression guard."""
    codes = validate_rules(fictional_rules()).codes()
    assert not codes & {"mixed_pool_kinds", "pool_amounts_not_total", "unknown_reserve_pool", "reserves_exceed_pool"}


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


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("quality_checks.checks.award_above_cost.severity", "warn"),
        ("quality_checks.checks.award_above_cost.enabled", False),
    ],
)
def test_the_above_cost_check_cannot_be_made_a_warning_or_switched_off(path: str, value: object) -> None:
    # Owner ruling 2026-09-25: never above cost before the offer; the check always holds.
    report = validate_rules(with_lever(fictional_rules(), path, value))
    assert "award_above_cost_must_hold" in {i.code for i in report.errors_in("quality_checks")}


@pytest.mark.parametrize("check", [{"severity": "warn"}, {"enabled": False}, {"enabled": False, "severity": "hold"}])
def test_the_income_conflict_check_cannot_be_made_a_warning_or_switched_off(check: dict[str, object]) -> None:
    # Owner ruling 2026-09-25: an income conflict always holds; staff call the family and choose the figure.
    rules = with_lever(fictional_rules(), "quality_checks.checks.household_income_conflict", check)
    report = validate_rules(rules)
    assert "household_income_conflict_must_hold" in {i.code for i in report.errors_in("quality_checks")}


def test_an_income_conflict_check_that_holds_or_is_not_listed_is_fine() -> None:
    held = with_lever(fictional_rules(), "quality_checks.checks.household_income_conflict", {"severity": "hold"})
    assert "household_income_conflict_must_hold" not in validate_rules(held).codes()
    assert "household_income_conflict_must_hold" not in validate_rules(fictional_rules()).codes()  # unlisted


def test_a_disabled_dependents_criterion_with_a_weight_does_not_warn() -> None:
    """§9.2: a weight on a disabled criterion is stored, unused."""
    doc = fictional_rules().model_dump(mode="json")
    doc["equity"]["weights"]["camp"]["dependents"] = "1"
    enabled = AidRules.model_validate(doc)
    assert "dependents_weight_cannot_bind" in validate_rules(enabled).codes()
    for criterion in doc["equity"]["criteria"]:
        if criterion["key"] == "dependents":
            criterion["enabled"] = False
    assert "dependents_weight_cannot_bind" not in validate_rules(AidRules.model_validate(doc)).codes()


BY_CLASS = {
    f"programs.{k}.table_from_equity_class": True
    for k in ("summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school")
}


def test_an_open_program_by_class_with_no_class_warns_in_the_mocks_words() -> None:
    rules = with_levers(fictional_rules(), BY_CLASS)  # family_camp and family_school have no class
    warnings = [i for i in validate_rules(rules).warnings if i.code == "no_equity_class"]
    assert {i.path for i in warnings} == {"programs.family_camp.equity_class", "programs.family_school.equity_class"}
    for warning in warnings:
        key = warning.path.split(".")[1]
        label = rules.programs[key].label
        assert warning.message == f"Open to aid but no equity class, so no award table: its requests hold ({label})"


def test_a_class_with_no_table_is_an_error() -> None:
    rules = with_levers(fictional_rules(), BY_CLASS | {"equity.weights.extra": {}})
    rules = with_lever(rules, "programs.summer.equity_class", "extra")
    codes = {(i.code, i.path) for i in validate_rules(rules).errors}
    assert ("class_without_table", "programs.summer.equity_class") in codes


def test_a_program_by_class_needs_no_program_tables_entry() -> None:
    doc = with_levers(fictional_rules(), BY_CLASS).model_dump(mode="json")
    doc["round2"]["program_tables"] = {}
    codes = {i.code for i in validate_rules(AidRules.model_validate(doc)).errors}
    assert "missing_round2_table" not in codes


def test_a_legacy_program_still_needs_its_program_tables_entry() -> None:
    """Regression guard."""
    doc = fictional_rules().model_dump(mode="json")
    del doc["round2"]["program_tables"]["quest"]
    codes = {i.code for i in validate_rules(AidRules.model_validate(doc)).errors}
    assert "missing_round2_table" in codes

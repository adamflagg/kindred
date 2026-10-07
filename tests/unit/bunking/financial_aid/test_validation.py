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
from tests.unit.bunking.financial_aid.fixtures import (
    FICTIONAL_SESSION_IDS,
    fictional_rules,
    fictional_rules_json,
    with_lever,
    with_levers,
)


def _context(*extra: SessionRef) -> ValidationContext:
    return ValidationContext(sessions=[SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS] + list(extra))


def test_the_fictional_season_has_no_errors_and_only_the_expected_warnings() -> None:
    report = validate_rules(fictional_rules(), _context())
    assert report.ok
    assert report.errors == []
    # adult_weekend and family_school deliberately have no Round 1 table; the fixture's Camp pool mixes classes camp
    # and teen, its B'mitzvah program uses class camp from another pool, and Family camp routes to the family table
    # with no class (spec §9.3's drifts).
    assert sorted((w.code, w.path) for w in report.warnings) == [
        ("group_mismatch", "programs.bmitzvah.equity_class"),
        ("group_mismatch", "programs.family_camp.equity_class"),
        ("group_mismatch", "programs.quest.equity_class"),
        ("group_mismatch", "programs.summer.equity_class"),
        ("group_mismatch", "programs.teen.equity_class"),
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


def test_a_value_that_cannot_bind_is_a_note_not_a_warning() -> None:
    # 1% of the dearest price routed to the camp table (6,000) is 60, below the 100
    # minimum, so the minimum decides every tier-6 award and the setting does nothing.
    # RULED (owner, via the coordinator, 2026-10-07): a note ("min" mark), never counted as a warning.
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.6.r1_pct", "1")
    report = validate_rules(rules)
    assert report.ok
    assert ("value_cannot_bind", "award_tables.camp.tiers.6") in {(n.code, n.path) for n in report.notes}
    assert "value_cannot_bind" not in {w.code for w in report.warnings}
    assert all(n.severity == "note" for n in report.notes)


def _bind_notes(rules: AidRules) -> dict[str, str]:
    return {n.path: n.message for n in validate_rules(rules).notes if n.code == "value_cannot_bind"}


def test_the_minimum_deciding_at_the_dearest_program_covers_every_cheaper_program() -> None:
    """Summer's dearest session is 4,000 and quest is 6,000: 1% of 6,000 is 60, below the 100 minimum."""
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.6.r1_pct", "1")
    assert _bind_notes(rules)["award_tables.camp.tiers.6"] == (
        "Camp table, tier 6: Quest at $6,000 gets $60, so the $100 minimum applies, "
        "and to every cheaper program on this table"
    )


def test_a_minimum_that_decides_only_the_cheaper_programs_names_the_dearest_of_them() -> None:
    """The fixture's 2% at tier 6: Quest (6,000) gets 120, but Summer (4,000) gets 80 and B'mitzvah 60."""
    note = _bind_notes(fictional_rules())["award_tables.camp.tiers.6"]
    assert note == "Camp table, tier 6: Summer at $4,000 gets $80, so the $100 minimum applies"


def test_a_figure_with_cents_is_shown_to_the_cent_and_the_minimum_is_whole_when_whole() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "cost.tuition": {"1000101": "810", "1000102": "810", "1000103": "810", "1000104": "5000", "1000301": "810"},
            "award_tables.camp.tiers.6.r1_pct": "8.5",
            "awards.minimum": "108",
        },
    )
    assert _bind_notes(rules)["award_tables.camp.tiers.6"] == (
        "Camp table, tier 6: Summer at $810 gets $68.85, so the $108 minimum applies, "
        "and to every cheaper program on this table"
    )


def test_only_catalog_priced_programs_are_judged() -> None:
    """A per-person or typed program's real price is not the catalog, so it never makes a note."""
    rules = with_levers(
        fictional_rules(),
        {
            "programs.family_camp.r1_table": "camp",
            "programs.family_camp.session_cm_ids": [1000201],
            "programs.family_school.r1_table": "camp",
            "programs.family_school.session_cm_ids": [1000501],
            "cost.tuition": {
                "1000101": "2000",
                "1000102": "4000",
                "1000103": "6000",
                "1000104": "5000",
                "1000301": "3000",
                "1000401": "900",
                "1000201": "9000",
                "1000501": "9000",
            },
        },
    )
    rules = with_lever(rules, "award_tables.camp.tiers.6.r1_pct", "1")
    assert _bind_notes(rules)["award_tables.camp.tiers.6"].startswith("Camp table, tier 6: Quest at $6,000")


def test_a_tables_note_uses_its_groups_name_never_the_key_title_cased() -> None:
    """Spec §9.2: notes read "‹group label› table". The label keeps its capitals: "FFP table", never "Ffp table"."""
    rules = with_levers(
        fictional_rules(),
        {"budget.pools.camp_pool.label": "FFP", "award_tables.camp.tiers.6.r1_pct": "1"},
    )
    assert _bind_notes(rules)["award_tables.camp.tiers.6"].startswith("FFP table, tier 6: ")


def test_a_table_no_group_pairs_with_keeps_its_key_words() -> None:
    rules = with_levers(
        fictional_rules(),
        {"award_tables.teen.overrides": {"6": {"r1_pct": "1"}}, "programs.teen.r1_table": "teen"},
    )
    note = _bind_notes(rules).get("award_tables.teen.tiers.6")
    assert note is not None
    assert note.startswith("Teen table, tier 6: ")


def _routed_to(table: str) -> AidRules:
    """`table` added as a copy of the camp table, with tier 6 at 1% so a note binds, and adult_weekend routed to it."""
    return with_levers(
        fictional_rules(),
        {
            f"award_tables.{table}": {"inherits": "camp", "overrides": {"6": {"r1_pct": "1"}}},
            "programs.adult_weekend.table_from_equity_class": False,
            "programs.adult_weekend.r1_table": table,
        },
    )


def test_a_tables_key_words_are_sentence_case() -> None:
    """Review minor 11: the server words a key as the front end's keyWords does ("Spring rates"), never "Spring Rates"."""
    notes = _bind_notes(_routed_to("spring_rates"))
    assert notes["award_tables.spring_rates.tiers.6"].startswith("Spring rates table, tier 6: ")


def test_notes_come_in_numeric_tier_order() -> None:
    reversed_tiers = {str(t): {"r1_pct": "1"} for t in (6, 5, 4, 3, 2, 1)}
    reversed_tiers["4"] = {"r1_pct": "1"}
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers", reversed_tiers)
    paths = [n.path for n in validate_rules(rules).notes if n.path.startswith("award_tables.camp.")]
    assert paths == [f"award_tables.camp.tiers.{t}" for t in range(1, 7)]


def test_notes_never_mention_r1_percent() -> None:
    rules = with_lever(fictional_rules(), "award_tables.camp.tiers.6.r1_pct", "1")
    assert all("R1 %" not in n.message for n in validate_rules(rules).notes)


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
    assert (
        report.errors[0].message
        == "Session 1000999 is in no group, so it can't get aid. Move it to a group, or save it under Not open to aid."
    )
    assert report.errors[0].session_cm_ids == [1000999]


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


def _messages(rules: AidRules, code: str, context: ValidationContext | None = None) -> list[str]:
    return [i.message for i in validate_rules(rules, context).issues if i.code == code]


def test_a_program_that_claims_no_sessions_skips_the_table_and_pool_warnings() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.other": {**fictional_rules_json()["programs"]["other"], "open_to_aid": True},
        },
    )
    paths = {i.path for i in validate_rules(rules).issues}
    assert "programs.other.r1_table" not in paths
    assert "programs.other.budget_pool" not in paths


def test_a_program_with_a_session_type_but_no_session_ids_still_warns() -> None:
    """Regression guard."""
    rules = with_levers(
        fictional_rules(),
        {
            "programs.other": {
                **fictional_rules_json()["programs"]["other"],
                "open_to_aid": True,
                "session_types": ["extra_kind"],
            },
        },
    )
    paths = {i.path for i in validate_rules(rules).issues}
    assert {"programs.other.r1_table", "programs.other.budget_pool"} <= paths


def test_a_programs_warning_names_the_program() -> None:
    rules = with_lever(fictional_rules(), "programs.summer.budget_pool", None)
    assert _messages(rules, "unclassified_program") == ["Summer: open to aid but in no budget pool"]
    assert _messages(fictional_rules(), "no_round1_table") == [
        "Adult weekend: no Round 1 table: only the minimum award can apply in Round 1",
        "Family school: no Round 1 table: only the minimum award can apply in Round 1",
    ]
    held = with_lever(fictional_rules(), "awards.minimum_without_table", False)
    assert _messages(held, "no_round1_table")[0] == (
        "Adult weekend: no Round 1 table: every request in this program holds until finance names one"
    )


@pytest.mark.parametrize(
    ("path", "value", "code", "expected"),
    [
        ("programs.summer.r1_table", "gold", "unknown_table", "Summer: no award table 'gold'"),
        ("programs.summer.equity_class", "nobody", "unknown_equity_class", "Summer: no equity class 'nobody'"),
        ("programs.summer.budget_pool", "piggy_bank", "unknown_budget_pool", "Summer: no pool 'piggy_bank'"),
    ],
)
def test_a_reference_error_names_the_program(path: str, value: str, code: str, expected: str) -> None:
    assert _messages(with_lever(fictional_rules(), path, value), code) == [expected]


def test_a_session_claimed_twice_names_both_programs_by_label() -> None:
    rules = with_lever(fictional_rules(), "programs.quest.session_cm_ids", [1000103, 1000101])
    assert _messages(rules, "session_in_two_programs") == ["Quest: session 1000101 is also in Summer"]


def test_a_session_type_claimed_twice_names_both_programs_by_label() -> None:
    rules = with_lever(fictional_rules(), "programs.quest.session_types", ["main"])
    assert _messages(rules, "session_type_in_two_programs") == ["Quest: session type 'main' is also in Summer"]


def test_a_class_without_a_table_names_the_program() -> None:
    rules = with_levers(fictional_rules(), BY_CLASS | {"equity.weights.extra": {}})
    rules = with_lever(rules, "programs.summer.equity_class", "extra")
    assert _messages(rules, "class_without_table") == ["Summer: equity class 'extra' has no Round 1 award table"]


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


def _named(*pairs: tuple[int, str | None]) -> ValidationContext:
    return ValidationContext(sessions=[SessionRef(cm_id=cm_id, name=name) for cm_id, name in pairs])


def test_a_per_person_session_without_a_rate_warns_for_its_group() -> None:
    rules = with_lever(fictional_rules(), "cost.family_rates", [])
    assert ("family_rate_missing", "cost.family_rates") in {(w.code, w.path) for w in validate_rules(rules).warnings}


def test_a_catalog_session_without_tuition_warns() -> None:
    rules = with_lever(fictional_rules(), "cost.tuition", {"1000101": "2000"})
    assert "tuition_missing" in {w.code for w in validate_rules(rules).warnings}


def test_a_missing_tuition_names_the_group_and_the_sessions_and_carries_their_ids() -> None:
    rules = with_lever(
        fictional_rules(), "cost.tuition", {"1000103": "6000", "1000104": "5000", "1000301": "3000", "1000401": "900"}
    )
    context = _named((1000101, "Session One"), (1000102, "Session Two"))
    issue = next(i for i in validate_rules(rules, context).warnings if i.code == "tuition_missing")
    assert issue.message == "Camp: no tuition for Session One and Session Two"
    assert (issue.session_cm_ids, issue.path) == ([1000101, 1000102], "cost.tuition")


def test_three_names_join_with_commas_and_and_an_unnamed_session_falls_back_to_its_id() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.summer.session_cm_ids": [1000101, 1000102, 1000123],
            "cost.tuition": {"1000103": "6000", "1000104": "5000", "1000301": "3000", "1000401": "900"},
        },
    )
    context = _named((1000101, "Session One"), (1000102, "Session Two"), (1000123, None))
    message = next(i.message for i in validate_rules(rules, context).warnings if i.code == "tuition_missing")
    assert message == "Camp: no tuition for Session One, Session Two and session 1000123"


def test_more_than_five_names_read_as_the_first_three_and_a_count() -> None:
    ids = [1000101, 1000102, 1000131, 1000132, 1000133, 1000134]
    rules = with_levers(
        fictional_rules(),
        {
            "programs.summer.session_cm_ids": ids,
            "cost.tuition": {"1000103": "6000", "1000104": "5000", "1000301": "3000", "1000401": "900"},
        },
    )
    message = next(i.message for i in validate_rules(rules).warnings if i.code == "tuition_missing")
    assert message == "Camp: no tuition for session 1000101, session 1000102, session 1000131 and 3 more"


def test_without_a_context_every_missing_session_is_named_by_its_id() -> None:
    rules = with_lever(fictional_rules(), "cost.tuition", {"1000101": "2000"})
    message = next(i.message for i in validate_rules(rules).warnings if i.code == "tuition_missing")
    assert message.startswith("Camp: no tuition for session 1000102")
    assert "[" not in message


def test_a_group_whose_only_per_person_session_has_no_rate_says_so() -> None:
    rules = with_lever(fictional_rules(), "cost.family_rates", [])
    issue = next(
        i for i in validate_rules(rules, _named((1000201, "Session Three"))).warnings if i.code == "family_rate_missing"
    )
    assert issue.message == "Weekends: no per-person rates for its one per-person session (Session Three)"
    assert issue.session_cm_ids == [1000201]


def test_some_per_person_sessions_missing_are_named() -> None:
    rules = with_levers(fictional_rules(), {"programs.family_camp.session_cm_ids": [1000201, 1000202]})
    issue = next(i for i in validate_rules(rules).warnings if i.code == "family_rate_missing")
    assert issue.message == "Weekends: no per-person rates for session 1000202"


def test_a_group_with_no_running_session_priced_says_no_price_yet() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "cost.tuition": {
                "1000101": "2000",
                "1000102": "4000",
                "1000103": "6000",
                "1000104": "5000",
                "1000401": "900",
            }
        },
    )
    issue = next(i for i in validate_rules(rules).warnings if i.path == "cost" and "B'mitzvah" in i.message)
    assert (issue.code, issue.message) == ("price_missing", "B'mitzvah: no price yet for its one running session")


def test_a_group_missing_both_kinds_says_no_price() -> None:
    tuition = {"1000101": "2000", "1000102": "4000", "1000103": "6000", "1000104": "5000", "1000301": "3000"}
    rules = with_levers(fictional_rules(), {"cost.family_rates": [], "cost.tuition": tuition})
    issue = next(i for i in validate_rules(rules).warnings if i.message.startswith("Weekends:"))
    assert (issue.code, issue.message) == ("price_missing", "Weekends: no price yet for any of its 2 running sessions")
    rules = with_levers(
        rules,
        {
            "programs.adult_weekend.session_cm_ids": [1000401, 1000402],
            "cost.tuition": {**tuition, "1000402": "900"},
        },
    )
    issue = next(i for i in validate_rules(rules).warnings if i.message.startswith("Weekends:"))
    assert (issue.code, issue.message) == (
        "price_missing",
        "Weekends: no price for session 1000201 and session 1000401",
    )


def test_a_typed_program_never_needs_a_price() -> None:
    assert not any(1000501 in i.session_cm_ids for i in validate_rules(fictional_rules(), _context()).issues)


def test_a_session_type_claim_counts_toward_its_group() -> None:
    context = _context(SessionRef(cm_id=1000777, session_type="main", name="Session Nine"))
    issue = next(i for i in validate_rules(fictional_rules(), context).warnings if i.code == "tuition_missing")
    assert issue.message == "Camp: no tuition for Session Nine"


def test_an_ag_session_with_a_parent_is_never_listed_as_missing_tuition() -> None:
    """Spec §8: its parent's line carries the warning. 1000199 is an AG session under 1000101 (priced 2,000)."""
    rules = with_lever(fictional_rules(), "programs.summer.session_cm_ids", [1000101, 1000102, 1000199])
    context = _context(SessionRef(cm_id=1000199, session_type="ag", parent_id=1000101))
    assert "tuition_missing" not in validate_rules(rules, context).codes()


def test_an_ag_session_with_no_parent_still_needs_its_own_tuition() -> None:
    """Pin. Passes before and after A1: an AG session with no parent has no parent's line to carry the warning."""
    rules = with_lever(fictional_rules(), "programs.summer.session_cm_ids", [1000101, 1000102, 1000199])
    context = _context(SessionRef(cm_id=1000199, session_type="ag"))
    assert "tuition_missing" in validate_rules(rules, context).codes()


def test_an_issue_without_sessions_has_an_empty_session_list() -> None:
    """Regression guard."""
    rules = with_lever(fictional_rules(), "programs.summer.budget_pool", None)
    assert next(i for i in validate_rules(rules).warnings if i.code == "unclassified_program").session_cm_ids == []


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


def test_a_closed_program_needs_no_table_for_its_class() -> None:
    """A program closed to aid prices nothing, so its class missing a table is no error (as no_equity_class)."""
    rules = with_levers(fictional_rules(), BY_CLASS | {"equity.weights.extra": {}})
    rules = with_levers(rules, {"programs.summer.equity_class": "extra", "programs.summer.open_to_aid": False})
    assert "class_without_table" not in validate_rules(rules).codes()


def test_an_unknown_class_is_one_error_not_two() -> None:
    """A class the equity section doesn't name reports unknown_equity_class alone, not also class_without_table."""
    rules = with_levers(fictional_rules(), BY_CLASS | {"programs.summer.equity_class": "nobody"})
    codes = [(i.code, i.path) for i in validate_rules(rules).errors if i.path == "programs.summer.equity_class"]
    assert codes == [("unknown_equity_class", "programs.summer.equity_class")]


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


def test_an_ag_session_no_program_claims_is_in_its_parents_program_not_unmapped() -> None:
    """Review M7: no unmapped_session error for an AG session whose parent a program claims."""
    context = _context(SessionRef(cm_id=1000199, session_type="ag", parent_id=1000101))
    assert "unmapped_session" not in validate_rules(fictional_rules(), context).codes()
    orphan = _context(SessionRef(cm_id=1000199, session_type="ag"))
    assert "unmapped_session" in validate_rules(fictional_rules(), orphan).codes()


def test_an_unclaimed_ag_session_follows_a_parent_the_programs_claim_by_type() -> None:
    """Regression guard. The parent's own type (not just its id) reaches the program lookup."""
    context = _context(
        SessionRef(cm_id=1000998, session_type="main"),  # claimed by type "main", not by id
        SessionRef(cm_id=1000199, session_type="ag", parent_id=1000998),
    )
    assert "unmapped_session" not in validate_rules(fictional_rules(), context).codes()


def test_an_ag_session_with_a_parent_is_never_listed_as_missing_a_family_rate() -> None:
    """Regression guard. Spec §8 applies to a per-person program's list too."""
    rules = with_lever(fictional_rules(), "programs.family_camp.session_cm_ids", [1000201, 1000199])
    with_parent = _context(SessionRef(cm_id=1000199, session_type="ag", parent_id=1000201))
    assert "family_rate_missing" not in validate_rules(rules, with_parent).codes()
    orphan = _context(SessionRef(cm_id=1000199, session_type="ag"))
    assert "family_rate_missing" in validate_rules(rules, orphan).codes()


def test_a_not_running_session_needs_no_tuition_and_no_program() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "cost.tuition": {
                "1000101": "2000",
                "1000103": "6000",
                "1000104": "5000",
                "1000301": "3000",
                "1000401": "900",
            },
            "cost.not_running_session_cm_ids": [1000102, 1000999],
        },
    )
    report = validate_rules(rules, _context(SessionRef(cm_id=1000999, session_type="hebrew")))
    assert "tuition_missing" not in report.codes()
    assert "unmapped_session" not in report.codes()


def test_an_ag_child_of_a_not_running_session_needs_no_tuition() -> None:
    """Pin. Passes before A2: A1's _ag_children already skips an AG session with a parent."""
    rules = with_levers(
        fictional_rules(),
        {"programs.summer.session_cm_ids": [1000101, 1000102, 1000199], "cost.not_running_session_cm_ids": [1000101]},
    )
    context = _context(SessionRef(cm_id=1000199, session_type="ag"))  # no parent: would need its own tuition
    assert "tuition_missing" in validate_rules(rules, context).codes()
    context = _context(SessionRef(cm_id=1000199, session_type="ag", parent_id=1000101))
    assert "tuition_missing" not in validate_rules(rules, context).codes()


POOL_WORDS = "a program's pool, equity class and award table are one group."


def _mismatch(rules: AidRules) -> dict[str, str]:
    return {i.path: i.message for i in validate_rules(rules).warnings if i.code == "group_mismatch"}


def test_a_pool_shared_by_two_classes_warns_on_each_program() -> None:
    found = _mismatch(fictional_rules())
    assert found["programs.teen.equity_class"] == (
        f"Teen: its pool (Camp) also has programs of another equity class; {POOL_WORDS}"
    )
    assert found["programs.summer.equity_class"].startswith("Summer: its pool (Camp) also has programs of another")


def test_a_class_shared_by_two_pools_warns() -> None:
    rules = with_lever(fictional_rules(), "programs.teen.equity_class", "camp")  # Camp pool is all camp now
    assert _mismatch(rules)["programs.bmitzvah.equity_class"] == (
        f"B'mitzvah: its equity class (Camp) is also used by programs of another pool; {POOL_WORDS}"
    )


def test_a_class_is_named_by_its_groups_label_never_title_cased() -> None:
    """Review M4: the class's words are its group's label, capitals kept ("FFP"), never the key title-cased."""
    rules = with_levers(
        fictional_rules(), {"programs.teen.equity_class": "camp", "budget.pools.camp_pool.label": "FFP"}
    )
    assert _mismatch(rules)["programs.bmitzvah.equity_class"] == (
        f"B'mitzvah: its equity class (FFP) is also used by programs of another pool; {POOL_WORDS}"
    )


def test_a_legacy_round_1_table_that_isnt_its_class_warns() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.teen.equity_class": "camp",
            "programs.bmitzvah.budget_pool": "camp_pool",
            "programs.adult_weekend.r1_table": "camp",
        },
    )
    assert _mismatch(rules)["programs.adult_weekend.equity_class"] == (
        "Adult weekend: its Round 1 table isn't its equity class's (Weekends)"
    )


def test_a_legacy_appeal_table_that_isnt_its_class_warns() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.teen.equity_class": "camp",
            "programs.bmitzvah.budget_pool": "camp_pool",
            "round2.program_tables.adult_weekend": "camp",
        },
    )
    assert _mismatch(rules)["programs.adult_weekend.equity_class"] == (
        "Adult weekend: its appeal caps table isn't its equity class's (Weekends)"
    )


def test_a_minimum_only_legacy_program_is_not_a_mismatch() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.teen.equity_class": "camp",
            "programs.teen.r1_table": "camp",
            "round2.program_tables.teen": "camp",
            "programs.bmitzvah.budget_pool": "camp_pool",
            "programs.family_camp.equity_class": "family",
        },
    )
    assert _mismatch(rules) == {}  # adult_weekend and family_school route to None: the "minimum only" pill says it


def test_an_ag_price_that_differs_from_its_parents_warns() -> None:
    tuition = {**fictional_rules_json()["cost"]["tuition"], "1000199": "1900"}
    rules = with_levers(
        fictional_rules(),
        {"programs.summer.session_cm_ids": [1000101, 1000102, 1000199], "cost.tuition": tuition},
    )
    context = ValidationContext(
        sessions=[
            SessionRef(cm_id=1000199, session_type="ag", parent_id=1000101, name="AG Session 2"),
            SessionRef(cm_id=1000101, name="Session 2"),
        ]
    )
    issue = next(i for i in validate_rules(rules, context).warnings if i.code == "ag_price_differs")
    assert issue.message == (
        "AG Session 2 has its own tuition ($1,900), different from its parent Session 2's ($2,000); "
        "AG sessions use their parent's price on screen"
    )
    assert (issue.section, issue.path, issue.session_cm_ids) == ("cost", "cost.tuition.1000199", [1000199])


def test_an_ag_price_equal_to_its_parents_or_with_no_parent_does_not_warn() -> None:
    """Pin: the warning needs an AG session with a parent whose own price differs."""
    tuition = fictional_rules_json()["cost"]["tuition"]
    equal = with_levers(fictional_rules(), {"cost.tuition": {**tuition, "1000199": "2000"}})
    with_parent = ValidationContext(sessions=[SessionRef(cm_id=1000199, session_type="ag", parent_id=1000101)])
    assert "ag_price_differs" not in validate_rules(equal, with_parent).codes()
    differs = with_levers(fictional_rules(), {"cost.tuition": {**tuition, "1000199": "1900"}})
    orphan = ValidationContext(sessions=[SessionRef(cm_id=1000199, session_type="ag")])
    assert "ag_price_differs" not in validate_rules(differs, orphan).codes()
    assert "ag_price_differs" not in validate_rules(differs).codes()


def test_an_id_that_isnt_a_session_this_season_warns() -> None:
    rules = with_lever(fictional_rules(), "cost.not_running_session_cm_ids", [1000102, 1000888])
    issue = next(i for i in validate_rules(rules, _context()).warnings if i.code == "not_running_unknown_session")
    assert (issue.section, issue.path, issue.session_cm_ids) == ("cost", "cost.not_running_session_cm_ids", [1000888])
    assert issue.message == "1000888 is marked not running but isn't a session in 2031"


def test_without_a_context_no_id_is_judged_unknown() -> None:
    """Pin. Passes before A2: with no context there is nothing to judge an id against."""
    rules = with_lever(fictional_rules(), "cost.not_running_session_cm_ids", [1000888])
    assert "not_running_unknown_session" not in validate_rules(rules).codes()


def test_an_ag_child_of_a_not_running_session_that_maps_to_no_program_is_not_unmapped() -> None:
    """Regression guard. The child of a not-running parent is skipped by derivation, even when the parent's own type
    maps nowhere. Written after the code to kill a mutant (the derived children dropped) that survived the plan's tests."""
    rules = with_lever(fictional_rules(), "cost.not_running_session_cm_ids", [1000999])
    context = _context(
        SessionRef(cm_id=1000999, session_type="hebrew"),
        SessionRef(cm_id=1000998, session_type="ag", parent_id=1000999),
    )
    assert "unmapped_session" not in validate_rules(rules, context).codes()
    running = with_lever(fictional_rules(), "cost.not_running_session_cm_ids", [])
    assert "unmapped_session" in validate_rules(running, context).codes()

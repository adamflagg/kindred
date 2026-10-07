"""The draft label in staff words (Scenarios addendum §S11.6; the mock's autoName). Fictional rules (fixtures.py):
the camp table is 90/75/55/35/15/2 by tier, teen inherits camp and overrides tier 2 to 70, family inherits camp; the
Round 1 + 2 cap's camp table is 97/90/75/55/30/12; bands are $40,000 wide from $0, six tiers; the minimum is 100;
the prior-year weight is 0.7 and Dependents lowers the income."""

from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from typing import Any

from bunking.financial_aid.rules.schema import AidRules
from bunking.financial_aid.scenarios import (
    CARD_TITLES,
    CHANGE_MAX_CHARS,
    change_phrases,
    describe,
    shift_round1_tables,
    widen_bands,
    with_minimum,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever, with_levers

RULES = fictional_rules()
REPO = Path(__file__).resolve().parents[4]  # this file sits at tests/unit/bunking/financial_aid/


def _even_bands(start: int, width: int, count: int) -> list[dict[str, Any]]:
    """The tiers editor's even bands: tier n starts at start + width × (n−1) + 1 (parent Task 44's bandsOf)."""
    return [
        {"lower": str(start if i == 0 else start + i * width + 1)}
        | ({} if i == count - 1 else {"upper": str(start + (i + 1) * width)})
        for i in range(count)
    ]


def _with_tier_count(rules: AidRules, count: int) -> AidRules:
    """What the sandbox records for a new count (§S5 F1): even bands, both tables trimmed above it, or each own
    table's last tier copied into each new one."""
    doc = rules.model_dump(mode="json")
    doc["tiers"]["bands"] = _even_bands(0, 40000, count)
    for tables in (doc["award_tables"], doc["round2"]["tables"]):
        for table in tables.values():
            tiers = table.get("tiers") or {}
            if tiers:
                last = tiers[str(max(int(t) for t in tiers))]
                table["tiers"] = {str(t): tiers.get(str(t), last) for t in range(1, count + 1)}
            table["overrides"] = {t: v for t, v in (table.get("overrides") or {}).items() if int(t) <= count}
    return AidRules.model_validate(doc)


def test_a_run_of_the_root_tables_round1_cells_moved_alike_reads_as_one_phrase() -> None:
    moved = with_levers(RULES, {f"award_tables.camp.tiers.{t}.r1_pct": str(v) for t, v in ((3, 60), (4, 40), (5, 20))})
    assert describe(RULES, moved) == "Tiers 3–5 +5%"
    assert describe(RULES, with_lever(RULES, "award_tables.camp.tiers.4.r1_pct", "40")) == "Tier 4 +5%"


def test_cells_moved_unevenly_or_apart_are_counted() -> None:
    uneven = with_levers(RULES, {"award_tables.camp.tiers.3.r1_pct": "60", "award_tables.camp.tiers.4.r1_pct": "45"})
    apart = with_levers(RULES, {"award_tables.camp.tiers.2.r1_pct": "80", "award_tables.camp.tiers.4.r1_pct": "40"})
    assert (describe(RULES, uneven), describe(RULES, apart)) == ("2 tiers moved", "2 tiers moved")


def test_the_round_1_plus_2_cap_runs_read_as_round_2_caps() -> None:
    caps = with_levers(
        RULES, {f"round2.tables.camp.tiers.{t}.total_pct": str(v) for t, v in ((4, 60), (5, 35), (6, 17))}
    )
    assert describe(RULES, caps) == "Round 2 caps tiers 4–6 +5%"


def test_another_tables_cell_or_override_names_its_class() -> None:
    """Disagreement 4: a class is named by its key, never a program; the teen table inherits camp."""
    assert describe(RULES, with_lever(RULES, "award_tables.teen.overrides.2.r1_pct", "75")) == (
        "Round 1 % › Teen › Tier 2 75%"
    )
    assert describe(RULES, with_lever(RULES, "round2.tables.teen.overrides.2.total_pct", "92")) == (
        "Round 1 + 2 cap › Teen › Tier 2 92%"
    )


def test_the_minimum_and_the_bands_read_as_the_tiers_line_says_them() -> None:
    assert describe(RULES, with_minimum(RULES, Decimal(75))) == "Minimum $75"
    assert describe(RULES, with_minimum(RULES, Decimal("150.5"))) == "Minimum $150.50"
    assert describe(RULES, widen_bands(RULES, Decimal(1000))) == "Band width $41,000"
    started = with_lever(RULES, "tiers.bands", _even_bands(5000, 40000, 6))
    assert describe(RULES, started) == "Bands start $5,000"
    assert describe(RULES, with_lever(RULES, "tiers.income_ceiling", "300000")) == "Income ceiling $300,000"
    ceiling = with_lever(RULES, "tiers.income_ceiling", "300000")
    assert describe(ceiling, RULES) == "Income ceiling none"


def test_a_tier_count_change_reads_as_tiers_n_and_hides_the_table_rows_it_moved() -> None:
    """Review Focus 2: the rows above the smaller count are the count's consequence, not three more phrases."""
    assert describe(RULES, _with_tier_count(RULES, 5)) == "Tiers 5"
    assert describe(RULES, _with_tier_count(RULES, 7)) == "Tiers 7"


def _criterion(rules: AidRules, key: str, **update: Any) -> AidRules:
    """`with_lever` can't index a list, so a criterion is changed through the model."""
    criteria = [c.model_copy(update=update) if c.key == key else c for c in rules.equity.criteria]
    return rules.model_copy(update={"equity": rules.equity.model_copy(update={"criteria": criteria})})


def test_each_setting_the_sandbox_edits_reads_label_then_value() -> None:
    cases = {
        "income.weights.prior_year": ("0.6", "Prior-year weight 60%"),
        "income.medical_threshold": ("5000", "Medical expenses count above $5,000"),
        "income.education_threshold": ("1500", "Education expenses count above $1,500"),
        "income.savings_threshold": ("100000", "Savings count above $100,000"),
        "income.dependents_mode": ("tier_shift", "Dependents Move the tier"),
        "income.per_dependent_reduction": ("2500", "Taken off per dependent $2,500"),
        "equity.weights.camp.bipoc": ("0.75", "Weight › Camp › Person of color 0.75"),
    }
    for path, (value, words) in cases.items():
        assert describe(RULES, with_lever(RULES, path, value)) == words, path
    assert describe(RULES, _criterion(RULES, "unemployment", enabled=False)) == "Unemployment › Enabled unchecked"


def test_the_derived_current_year_weight_never_reads_as_a_change_of_its_own() -> None:
    moved = with_levers(RULES, {"income.weights.prior_year": "0.6", "income.weights.current_year": "0.4"})
    assert change_phrases(RULES, moved) == ["Prior-year weight 60%"]


def test_any_other_change_reads_as_its_cards_count() -> None:
    assert describe(RULES, with_lever(RULES, "income.floor", "500")) == "Counting a family's income: 1 change"
    two = with_levers(RULES, {"grants.offset_mode": "reduce_cost_basis", "grants.late_grant_policy": "recalculate"})
    assert describe(RULES, two) == "Outside grants: 2 changes"
    mixed = with_levers(RULES, {"income.floor": "500", "income.medical_threshold": "5000"})
    assert change_phrases(RULES, mixed) == [
        "Medical expenses count above $5,000",
        "Counting a family's income: 1 change",
    ]


def test_phrases_read_runs_first_then_section_order_and_fold_after_three() -> None:
    moved = with_minimum(shift_round1_tables(RULES, Decimal(-2)), Decimal(150))
    assert describe(RULES, moved) == "Tiers 1–6 −2% · Round 1 % › Teen › Tier 2 68% · Minimum $150"
    four = with_lever(moved, "income.medical_threshold", "5000")
    assert describe(RULES, four) == "Tiers 1–6 −2% · Medical expenses count above $5,000 + 2 more"


def test_a_uniform_shift_reads_in_percent_never_points() -> None:
    """§S11.6: "pts" and "points" leave the label (Fit keeps them, unchanged by ruling)."""
    text = describe(RULES, shift_round1_tables(RULES, Decimal(2)))
    assert text == "Tiers 1–6 +2% · Round 1 % › Teen › Tier 2 72%"
    assert "pts" not in text
    assert "points" not in text
    assert describe(RULES, shift_round1_tables(RULES, Decimal("-0.5"))) == (
        "Tiers 1–6 −0.5% · Round 1 % › Teen › Tier 2 69.5%"
    )


def test_a_clamped_shift_is_not_one_run_so_it_is_counted() -> None:
    # 2 − 5 clamps to 0 (a move of −2), so the six moves are not alike.
    assert describe(RULES, shift_round1_tables(RULES, Decimal(-5))) == "6 tiers moved · Round 1 % › Teen › Tier 2 65%"


def test_uneven_bands_count_their_bounds_under_the_tiers_card() -> None:
    bands = [b.model_dump(mode="json") for b in RULES.tiers.bands]
    bands[1]["upper"] = "81000"
    bands[2]["lower"] = "81001"
    assert describe(RULES, with_lever(RULES, "tiers.bands", bands)) == "Income tiers: 2 changes"


def test_a_label_too_long_for_the_trail_column_is_cut_with_an_ellipsis() -> None:
    long = _criterion(RULES, "bipoc", label="a very long label " * 150)
    text = describe(long, with_lever(long, "equity.weights.camp.bipoc", "0.75"))
    assert (len(text), text[-1]) == (CHANGE_MAX_CHARS, "…")
    assert text.startswith("Weight › Camp › a very long label")


def test_no_change_says_so() -> None:
    assert describe(RULES, fictional_rules()) == "no changes"


def test_the_card_titles_are_the_rules_tabs() -> None:
    """Parent §6.2 D (parent Task 19's SECTION_TITLES): the lock words and the counts say the Rules tab's titles."""
    assert (CARD_TITLES["tiers"], CARD_TITLES["award_tables"], CARD_TITLES["round2"]) == (
        "Income tiers",
        "Round 1 award table",
        "Appeal caps",
    )
    assert (CARD_TITLES["income"], CARD_TITLES["equity"], CARD_TITLES["awards"]) == (
        "Counting a family's income",
        "Moving a family up a tier",
        "Minimum award and named awards",
    )


def test_the_card_titles_are_the_rules_tabs_section_titles_word_for_word() -> None:
    """CARD_TITLES copies rulesModel.ts' SECTION_TITLES (parent Task 19). This reads the TypeScript literal, so a
    rename on either side fails here instead of drifting (plan review, minor 17)."""
    source = (REPO / "frontend/src/components/camperships/season/rules/rulesModel.ts").read_text(encoding="utf-8")
    block = source.split("export const SECTION_TITLES = {", 1)[1].split("}", 1)[0]
    titles = {key: text for key, _, text in re.findall(r"^\s*(\w+):\s*(['\"])(.*)\2,?\s*$", block, re.MULTILINE)}
    assert titles == dict(CARD_TITLES)

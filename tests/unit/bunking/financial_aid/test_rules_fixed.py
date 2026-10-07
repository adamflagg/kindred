"""Fixed settings (spec §6.4, §9.9): what the Rules tab hides or shows read-only, and the section save refuses to
change. A safety net: the editor never sends one changed. Fictional only."""

from decimal import Decimal
from typing import Any

from bunking.financial_aid.rules.fixed import FIXED_PATHS, changed_fixed, reset_fixed, reset_fixed_document
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_levers


def _section(name: str) -> dict[str, Any]:
    section: dict[str, Any] = fictional_rules().model_dump()[name]
    return section


def test_every_hidden_read_only_and_legacy_setting_is_listed() -> None:
    """§6.4: 21 hidden labels, 16 read-only ones (the current-year weight is the server's to write; the Round 1 and appeal
    tables' "same as" settings share one label), and the legacy no-table minimum: 38 labels."""
    labels = [s.label for settings in FIXED_PATHS.values() for s in settings]
    assert len(set(labels)) == 38
    assert "Current-year weight" not in labels


def test_a_changed_rate_is_named_by_its_label() -> None:
    before = _section("income")
    after = before | {"medical_rate": before["medical_rate"] / 2}
    assert changed_fixed("income", before, after) == ["Share of medical costs taken off"]


def test_an_equal_decimal_written_differently_is_not_a_change() -> None:
    before = _section("income")
    after = before | {"medical_rate": Decimal("1.0")}
    assert changed_fixed("income", before, after) == []


def test_a_criterion_added_or_its_match_changed_is_refused_but_enabled_is_not() -> None:
    before = _section("equity")
    toggled = {**before, "criteria": [{**c, "enabled": False} for c in before["criteria"]]}
    assert changed_fixed("equity", before, toggled) == []
    added = {**before, "criteria": [*before["criteria"], {**before["criteria"][0], "key": "extra"}]}
    assert changed_fixed("equity", before, added)[0] == "The list of criteria"


def test_a_check_added_is_refused_but_its_severity_is_not() -> None:
    before = _section("quality_checks")
    first = next(iter(before["checks"]))
    softer = {"checks": {**before["checks"], first: {**before["checks"][first], "severity": "warn"}}}
    assert changed_fixed("quality_checks", before, softer) == []
    more = {
        "checks": {**before["checks"], "unmatched_session": {"enabled": True, "severity": "hold", "threshold": None}}
    }
    assert changed_fixed("quality_checks", before, more) == ["The list of checks"]


def test_a_named_award_added_or_its_kind_changed_is_refused() -> None:
    """Owner 10-06 (c): named funds are managed in Grants › Grantors (slice 3), never added or re-kinded by a rules
    save. A new key reads as a change to every per-award fixed setting, Kind first."""
    before = _section("awards")
    fund = {
        "label": "Named full-cost fund",
        "kind": "full_cost_after_aid",
        "round": 1,
        "amount": None,
        "extra_amount": Decimal(0),
        "allows_appeal": False,
        "counts_toward_budget": False,
        "ceiling_exempt": False,
    }
    added = {**before, "decision_types": {**before["decision_types"], "named_full_cost_fund": fund}}
    assert changed_fixed("awards", before, added)[0] == "Named award › Kind"
    types = before["decision_types"]
    rekinded = {
        **before,
        "decision_types": {**types, "full_cost_program": {**types["full_cost_program"], "kind": "top_up"}},
    }
    assert changed_fixed("awards", before, rekinded) == ["Named award › Kind"]


# --- a promotion keeps fixed settings as the rules draft has them (Scenarios addendum §S11.3; disagreement 10) ------


def test_reset_fixed_sets_a_fixed_setting_back_and_keeps_the_edit_beside_it() -> None:
    base = fictional_rules()
    wanted = with_levers(base, {"awards.ask_cap": not base.awards.ask_cap, "awards.minimum": "150"})
    reset = reset_fixed("awards", base.awards.model_dump(), wanted.awards.model_dump())
    assert changed_fixed("awards", base.awards.model_dump(), reset) == []
    assert (reset["ask_cap"], reset["minimum"]) == (base.awards.ask_cap, Decimal(150))


def test_reset_fixed_drops_a_named_award_the_option_added() -> None:
    base = fictional_rules()
    raw = base.model_dump(mode="json")
    raw["awards"]["decision_types"]["named_full_cost_fund"] = {
        "label": "Named full-cost fund",
        "kind": "full_cost_after_aid",
        "round": 1,
        "counts_toward_budget": False,
    }
    wanted = AidRules.model_validate(raw)
    reset = reset_fixed("awards", base.awards.model_dump(), wanted.awards.model_dump())
    assert "named_full_cost_fund" not in reset["decision_types"]
    assert changed_fixed("awards", base.awards.model_dump(), reset) == []


def test_reset_fixed_matches_criteria_by_key_whatever_their_order_or_membership() -> None:
    """Coordinator ruling (PR 10, 2026-10-07): a promotion matches equity criteria by key, never by list position, so
    a reordered list, or one a criterion was added to or dropped from, never moves an Enabled flag onto the wrong
    criterion. Base's order and membership stand; a criterion only the option has goes; one it lacks comes back whole.
    """
    base = fictional_rules()
    by_key = {c.key: c for c in base.equity.criteria}
    off = {"enabled": False}
    extra = by_key["bipoc"].model_copy(update={"key": "extra_need", "label": "Extra need", "enabled": False})
    criteria = [  # reversed, without gov_subsidies, plus a criterion base doesn't have
        by_key["dependents"].model_copy(update=off),
        by_key["trans_nb"],
        by_key["bipoc"].model_copy(update=off),
        by_key["unemployment"],
        extra,
    ]
    wanted = base.model_copy(update={"equity": base.equity.model_copy(update={"criteria": criteria})})
    reset = reset_fixed("equity", base.equity.model_dump(), wanted.equity.model_dump())
    assert changed_fixed("equity", base.equity.model_dump(), reset) == []
    assert [(c["key"], c["enabled"]) for c in reset["criteria"]] == [
        ("unemployment", True),
        ("gov_subsidies", True),
        ("bipoc", False),
        ("trans_nb", True),
        ("dependents", False),
    ]


def test_reset_fixed_resets_each_criterions_fixed_settings_and_keeps_its_enabled() -> None:
    base = fictional_rules()
    first = base.equity.criteria[0].model_copy(update={"label": "Renamed", "enabled": False})
    extra = base.equity.criteria[0].model_copy(update={"key": "extra_need", "label": "Extra need"})
    criteria = [first, *base.equity.criteria[1:], extra]
    wanted = base.model_copy(update={"equity": base.equity.model_copy(update={"criteria": criteria})})
    reset = reset_fixed("equity", base.equity.model_dump(), wanted.equity.model_dump())
    assert changed_fixed("equity", base.equity.model_dump(), reset) == []
    assert [c["key"] for c in reset["criteria"]] == [c.key for c in base.equity.criteria]
    assert (reset["criteria"][0]["label"], reset["criteria"][0]["enabled"]) == (base.equity.criteria[0].label, False)


def test_reset_fixed_keeps_the_rules_drafts_list_of_checks() -> None:
    base = fictional_rules()
    wanted = with_levers(base, {"quality_checks.checks.household_income_conflict": {"severity": "hold"}})
    reset = reset_fixed("quality_checks", base.quality_checks.model_dump(), wanted.quality_checks.model_dump())
    assert sorted(reset["checks"]) == sorted(base.quality_checks.model_dump()["checks"])


def test_a_whole_document_is_reset_and_counted_by_distinct_setting() -> None:
    base = fictional_rules()
    wanted = with_levers(
        base, {"awards.ask_cap": not base.awards.ask_cap, "income.floor": "500", "awards.minimum": "150"}
    )
    document, kept = reset_fixed_document(base, wanted)
    assert kept == 2  # "Never give more than the family asked for" and "Income floor"
    assert (document.awards.ask_cap, document.income.floor, document.awards.minimum) == (
        base.awards.ask_cap,
        base.income.floor,
        Decimal(150),
    )

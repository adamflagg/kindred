"""Fixed settings (spec §6.4, §9.9): what the Rules tab hides or shows read-only, and the section save refuses to
change. A safety net: the editor never sends one changed. Fictional only."""

from decimal import Decimal
from typing import Any

from bunking.financial_aid.rules.fixed import FIXED_PATHS, changed_fixed
from tests.unit.bunking.financial_aid.fixtures import fictional_rules


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

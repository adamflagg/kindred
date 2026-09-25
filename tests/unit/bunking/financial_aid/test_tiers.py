"""Tier edges, the equity shift and its aggregation, and the per-request final tier."""

from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.tiers import criterion_met, equity_shift, final_tier, income_tier
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers


@pytest.mark.parametrize(
    ("income", "tier"),
    [("0", 1), ("40000", 1), ("40001", 2), ("80000", 2), ("80001", 3), ("200000", 5), ("200001", 6), ("9000000", 6)],
)
def test_tier_edges_use_lower_bounds(income: str, tier: int) -> None:
    assert income_tier(Decimal(income), fictional_rules()) == tier


def test_below_the_first_band_there_is_no_tier() -> None:
    assert income_tier(Decimal(-1), fictional_rules()) is None


def test_the_band_table_is_a_lever() -> None:
    # Exercises "tiers.bands.lower": each band's own lower bound, not one collapsed
    # "tiers.bands" setting, decides where an income lands.
    rules = with_lever(fictional_rules(), "tiers.bands", [{"lower": "0"}, {"lower": "25000"}])
    assert income_tier(Decimal(30000), rules) == 2


def _final(
    rules: AidRules,
    *,
    program: str = "summer",
    tier: int = 3,
    application: ApplicationInputs | None = None,
    **answers: Any,
) -> tuple[int, str | None]:
    shift, _ = equity_shift(
        application or app(), req(program_key=program, equity_answers=answers), rules.programs[program], rules
    )
    return final_tier(tier, shift, rules)


def test_no_answers_no_shift() -> None:
    assert _final(fictional_rules()) == (3, None)


@pytest.mark.parametrize("answer", ["Yes", "yes", "YES"])
def test_a_qualifying_answer_is_case_insensitive(answer: str) -> None:
    assert _final(fictional_rules(), bipoc=answer)[0] == 2


def test_two_half_weights_are_still_one_tier_under_ceil() -> None:
    assert _final(fictional_rules(), bipoc="Yes", gender_identity="Non-Binary")[0] == 2


@pytest.mark.parametrize(("identity", "tier"), [("nonbinary", 2), ("Trans man", 2), ("woman", 3), ("", 3)])
def test_contains_any_matches_any_listed_spelling(identity: str, tier: int) -> None:
    assert _final(fictional_rules(), gender_identity=identity)[0] == tier


@pytest.mark.parametrize(("aggregation", "tier"), [("ceil", 2), ("round", 2), ("floor", 3)])
def test_aggregation_of_one_half_weight(aggregation: str, tier: int) -> None:
    rules = with_lever(fictional_rules(), "equity.aggregation", aggregation)
    assert _final(rules, bipoc="Yes")[0] == tier


@pytest.mark.parametrize(("aggregation", "tier"), [("ceil", 2), ("round", 2), ("floor", 3)])
def test_aggregation_of_three_quarters(aggregation: str, tier: int) -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "equity.weights": {"camp": {"bipoc": "0.5", "unemployment": "0.25"}, "teen": {}, "family": {}},
            "equity.aggregation": aggregation,
        },
    )
    assert _final(rules, application=app(answers={"unemployment": "Yes"}), bipoc="Yes")[0] == tier


def test_max_shift_caps_the_shift_and_the_trace_says_so() -> None:
    rules = with_lever(
        fictional_rules(), "equity.weights", {"camp": {"bipoc": "1", "trans_nb": "1"}, "teen": {}, "family": {}}
    )
    assert _final(rules, bipoc="Yes", gender_identity="trans")[0] == 1
    capped = with_lever(rules, "equity.max_shift", 1)
    assert _final(capped, bipoc="Yes", gender_identity="trans")[0] == 2
    shift, step = equity_shift(
        app(), req(equity_answers={"bipoc": "Yes", "gender_identity": "trans"}), capped.programs["summer"], capped
    )
    assert (shift, step.bound) == (1, "max_shift")


def test_the_shift_cannot_go_below_the_floor_tier() -> None:
    assert _final(fictional_rules(), tier=1, bipoc="Yes") == (1, "tier_floor")


def test_the_floor_tier_is_a_lever() -> None:
    rules = with_lever(fictional_rules(), "tiers.floor_tier", 2)
    assert _final(rules, tier=1) == (2, "tier_floor")


def test_a_program_with_no_equity_class_never_shifts() -> None:
    assert _final(fictional_rules(), program="family_camp", bipoc="Yes")[0] == 3
    rules = with_lever(fictional_rules(), "programs.summer.equity_class", None)
    assert _final(rules, bipoc="Yes")[0] == 3
    shift, step = equity_shift(app(), req(equity_answers={"bipoc": "Yes"}), rules.programs["summer"], rules)
    assert (shift, step.note) == (0, "This program has no equity class")


def test_a_class_with_no_weights_never_shifts() -> None:
    assert _final(fictional_rules(), program="adult_weekend", bipoc="Yes")[0] == 3


def test_an_unknown_equity_class_gives_no_shift_and_an_explicit_note() -> None:
    # The program's equity_class points at a class the season never defined weights
    # for. Separate rules validation flags this too, but the calculator must not
    # silently zero it out without saying why (spec principle 5: an unknown is
    # explicit, never a silent no-op).
    rules = with_lever(fictional_rules(), "programs.summer.equity_class", "nosuch")
    shift, step = equity_shift(app(), req(equity_answers={"bipoc": "Yes"}), rules.programs["summer"], rules)
    assert shift == 0
    assert step.note is not None
    assert "nosuch" in step.note


def test_siblings_in_one_household_can_land_in_different_tiers() -> None:
    # Same application, so the same income tier; each camper's own answers differ.
    rules = fictional_rules()
    household = app(prior_year_gross="100000", current_year_gross="100000")
    first, _ = equity_shift(household, req(equity_answers={"bipoc": "Yes"}), rules.programs["summer"], rules)
    second, _ = equity_shift(household, req(person_cm_id=1000003), rules.programs["summer"], rules)
    assert (final_tier(3, first, rules)[0], final_tier(3, second, rules)[0]) == (2, 3)


def test_the_dependents_criterion_counts_only_in_tier_shift_mode() -> None:
    weights = {"camp": {"dependents": "1"}, "teen": {}, "family": {}}
    shifting = with_levers(fictional_rules(), {"income.dependents_mode": "tier_shift", "equity.weights": weights})
    assert _final(shifting, application=app(dependents=5))[0] == 2
    assert _final(shifting, application=app(dependents=3))[0] == 3
    reducing = with_lever(shifting, "income.dependents_mode", "income_reduction")
    assert _final(reducing, application=app(dependents=5))[0] == 3


def test_the_dependents_threshold_is_a_per_criterion_lever() -> None:
    # Exercises "equity.criteria.min_value": raising the fixture's "4 or more
    # dependents" threshold to 6 moves a household of 5 from meeting the criterion
    # (and shifting) to not meeting it.
    weights = {"camp": {"dependents": "1"}, "teen": {}, "family": {}}
    shifting = with_levers(fictional_rules(), {"income.dependents_mode": "tier_shift", "equity.weights": weights})
    assert _final(shifting, application=app(dependents=5))[0] == 2
    criteria = [c.model_dump(mode="json") for c in shifting.equity.criteria]
    for criterion in criteria:
        if criterion["key"] == "dependents":
            criterion["min_value"] = "6"
    raised = with_lever(shifting, "equity.criteria", criteria)
    assert _final(raised, application=app(dependents=5))[0] == 3


def test_household_answers_come_from_the_application_not_the_request() -> None:
    # Exercises "equity.criteria.source": "household" reads ApplicationInputs.answers;
    # a camper's own equity_answers on the request never satisfy a household criterion.
    rules = with_lever(fictional_rules(), "equity.weights", {"camp": {"unemployment": "1"}, "teen": {}, "family": {}})
    assert _final(rules, application=app(answers={"unemployment": "Yes"}))[0] == 2
    assert _final(rules, unemployment="Yes")[0] == 3


def test_a_new_criterion_is_data_not_code() -> None:
    # Exercises "equity.criteria.key", "equity.criteria.field", "equity.criteria.match"
    # and "equity.criteria.values": a criterion defined purely in the rules document,
    # with none of these four hard-coded, changes who gets shifted.
    rules = fictional_rules()
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    criteria.append(
        {
            "key": "pronoun_they",
            "label": "They/them pronouns",
            "source": "camper",
            "field": "pronouns",
            "match": "contains_any",
            "values": ["they/them"],
        }
    )
    rules = with_levers(
        rules,
        {"equity.criteria": criteria, "equity.weights": {"camp": {"pronoun_they": "1"}, "teen": {}, "family": {}}},
    )
    assert _final(rules, pronouns="they/them")[0] == 2
    assert _final(rules, pronouns="she/they")[0] == 3


def test_the_shift_trace_lists_the_criteria_met() -> None:
    rules = fictional_rules()
    _, step = equity_shift(
        app(), req(equity_answers={"bipoc": "Yes", "gender_identity": "trans"}), rules.programs["summer"], rules
    )
    assert step.key == "equity_shift"
    assert step.inputs["criteria_met"] == "bipoc,trans_nb"
    assert step.inputs["weight_sum"] == Decimal(1)


# --- P6a: EquityCriterion.also_fields --------------------------------------
# Exercises "equity.criteria.also_fields".
#
# A criterion is met if `field` OR any `also_fields` entry qualifies under the
# criterion's match rule. It still contributes its weight once, however many
# of its fields match.


def _criterion_with_also_fields(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "key": "gender_nonconforming",
        "label": "Gender identity or pronouns",
        "source": "camper",
        "field": "gender_identity",
        "also_fields": ["pronouns"],
        "match": "contains_any",
        "values": ["nonbinary", "they"],
    }
    base.update(overrides)
    return base


def _rules_with_also_fields_criterion(**overrides: Any) -> AidRules:
    rules = fictional_rules()
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    criteria.append(_criterion_with_also_fields(**overrides))
    return with_levers(
        rules,
        {
            "equity.criteria": criteria,
            "equity.weights": {"camp": {"gender_nonconforming": "0.5"}, "teen": {}, "family": {}},
        },
    )


def test_also_fields_criterion_met_via_the_secondary_field() -> None:
    rules = _rules_with_also_fields_criterion()
    criterion = rules.equity.criteria[-1]
    request = req(equity_answers={"gender_identity": "", "pronouns": "They/Them"})
    assert criterion_met(criterion, app(), request) is True


def test_a_criterion_met_by_both_fields_still_shifts_once() -> None:
    # "they" (not "nonbinary") in both fields, so this doesn't also trip the
    # fixture's separate trans_nb criterion, which shares the gender_identity
    # field -- the point here is the new criterion's own dedup, not overlap
    # between two different criteria.
    rules = _rules_with_also_fields_criterion()
    request = req(equity_answers={"gender_identity": "they", "pronouns": "they/them"})
    shift, step = equity_shift(app(), request, rules.programs["summer"], rules)
    assert shift == 1
    assert step.inputs["criteria_met"] == "gender_nonconforming"
    assert step.inputs["weight_sum"] == Decimal("0.5")


def test_empty_also_fields_behaves_exactly_as_before() -> None:
    rules = fictional_rules()
    criterion = next(c for c in rules.equity.criteria if c.key == "bipoc")
    assert criterion.also_fields == []
    assert criterion_met(criterion, app(), req(equity_answers={"bipoc": "Yes"})) is True
    assert criterion_met(criterion, app(), req(equity_answers={})) is False

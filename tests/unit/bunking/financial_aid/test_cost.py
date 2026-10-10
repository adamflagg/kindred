"""One cost resolver: override, catalog tuition, family-camp headcount x rate, or typed."""

from decimal import Decimal
from typing import Any

from bunking.financial_aid.calculator.cost import resolve_cost
from bunking.financial_aid.calculator.inputs import RequestInputs
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, req, with_lever


def test_catalog_programs_use_the_session_tuition() -> None:
    cost = resolve_cost(req(session_cm_id=1000101), fictional_rules())
    assert (cost.amount, cost.source) == (Decimal(2000), "catalog")


def test_tuition_is_a_season_lever() -> None:
    rules = with_lever(fictional_rules(), "cost.tuition", {"1000101": "2100"})
    assert resolve_cost(req(session_cm_id=1000101), rules).amount == Decimal(2100)


def test_a_session_with_no_tuition_is_unknown_not_zero() -> None:
    cost = resolve_cost(req(session_cm_id=1000999), fictional_rules())
    assert (cost.amount, cost.source) == (None, "unknown")
    assert "1000999" in (cost.missing or "")


def test_a_catalog_request_with_no_session_is_unknown() -> None:
    assert resolve_cost(req(session_cm_id=None), fictional_rules()).amount is None


def test_an_override_wins_and_carries_its_reason() -> None:
    cost = resolve_cost(req(cost_override={"amount": "3500", "reason": "discount"}), fictional_rules())
    assert (cost.amount, cost.source, cost.issues) == (Decimal(3500), "override", [])


def test_an_override_with_an_unknown_reason_warns_but_still_applies() -> None:
    cost = resolve_cost(req(cost_override={"amount": "3500", "reason": "whim"}), fictional_rules())
    assert cost.amount == Decimal(3500)
    assert [(i.code, i.severity) for i in cost.issues] == [("unknown_override_reason", "warn")]
    rules = with_lever(fictional_rules(), "cost.override_reasons", ["whim"])
    assert resolve_cost(req(cost_override={"amount": "3500", "reason": "whim"}), rules).issues == []


def _family(**fields: Any) -> RequestInputs:
    return req(**{"person_cm_id": None, "program_key": "family_camp", "session_cm_id": 1000201, **fields})


def test_family_camp_is_headcount_times_the_season_rate() -> None:
    # Exercises "cost.family_rates.standard" and "cost.family_rates.infant": the
    # per-person cost is headcount x each field's own rate, not one lump sum.
    cost = resolve_cost(_family(headcount={"standard": 3, "infants": 1}), fictional_rules())
    assert (cost.amount, cost.source) == (Decimal(2100), "per_person")


def test_a_stored_child_rate_is_ignored_and_every_non_infant_pays_the_standard_rate() -> None:
    """Owner 10-06: the child rate is removed. A stored document that still carries one ($450) loads, and its children
    price at the standard rate ($600)."""
    rules = with_lever(
        fictional_rules(),
        "cost.family_rates",
        [{"session_cm_id": 1000201, "standard": "600", "infant": "300", "child": "450"}],
    )
    headcount = {"standard": 3, "infants": 1, "children": 2}
    assert resolve_cost(_family(headcount=headcount), rules).amount == Decimal(600) * 5 + Decimal(300)


def test_a_family_rate_only_applies_to_its_own_session() -> None:
    # Exercises "cost.family_rates.session_cm_id": a rate is scoped to the session it
    # names, not to family camp in general -- changing it moves which request it prices.
    rules = with_lever(
        fictional_rules(),
        "cost.family_rates",
        [{"session_cm_id": 1000299, "standard": "600", "infant": "300", "child": None}],
    )
    cost = resolve_cost(_family(headcount={"standard": 2}), rules)  # requests the fixture's default session 1000201
    assert cost.amount is None
    assert "1000201" in (cost.missing or "")


def test_family_camp_without_a_headcount_is_unknown() -> None:
    cost = resolve_cost(_family(), fictional_rules())
    assert (cost.amount, cost.source) == (None, "unknown")


def test_an_all_zero_headcount_is_missing_not_free() -> None:
    # (Review Focus) A household of nobody is a data problem, never a $0 cost.
    cost = resolve_cost(_family(headcount={"standard": 0, "infants": 0}), fictional_rules())
    assert cost.amount is None
    assert cost.missing == "the family-camp number of people is missing"  # staff read "number of people" (owner)


def test_family_camp_with_no_rate_for_the_session_is_unknown() -> None:
    cost = resolve_cost(_family(session_cm_id=1000299, headcount={"standard": 2}), fictional_rules())
    assert cost.amount is None
    assert "1000299" in (cost.missing or "")


def test_a_missing_family_rate_names_the_session_by_its_name_not_its_id() -> None:
    cost = resolve_cost(
        _family(session_cm_id=1000299, session_name="Family Camp 2", headcount={"standard": 2}),
        fictional_rules(),
    )
    assert cost.missing == "no family-camp rate for Family Camp 2"


def test_a_missing_tuition_names_the_session_by_its_name_when_known() -> None:
    cost = resolve_cost(req(session_cm_id=1000999, session_name="Session 9"), fictional_rules())
    assert cost.missing == "no tuition for Session 9"


def test_a_typed_program_needs_an_override() -> None:
    typed = req(program_key="family_school", session_cm_id=1000501)
    assert resolve_cost(typed, fictional_rules()).amount is None
    rules = with_lever(fictional_rules(), "programs.summer.cost_source", "typed")
    assert resolve_cost(req(), rules).amount is None
    assert resolve_cost(req(cost_override={"amount": "1000", "reason": "missing_catalog"}), rules).amount == Decimal(
        1000
    )


def test_an_ag_session_with_no_price_of_its_own_takes_its_parents() -> None:
    """Owner 10-07 (R7): AG session costs auto-link to their parent session. The fixture prices 1000101 at 2,000."""
    cost = resolve_cost(req(session_cm_id=1000199, ag_parent_cm_id=1000101), fictional_rules())
    assert (cost.amount, cost.source) == (Decimal(2000), "catalog")


def test_an_ag_sessions_own_price_wins_over_its_parents() -> None:
    rules = with_lever(fictional_rules(), "cost.tuition", {"1000101": "2000", "1000199": "1900"})
    assert resolve_cost(req(session_cm_id=1000199, ag_parent_cm_id=1000101), rules).amount == Decimal(1900)


def test_an_ag_session_whose_parent_has_no_price_is_unknown_and_names_the_session() -> None:
    cost = resolve_cost(req(session_cm_id=1000199, ag_parent_cm_id=1000188), fictional_rules())
    assert (cost.amount, cost.source) == (None, "unknown")
    assert "1000199" in (cost.missing or "")


def test_a_request_without_a_parent_never_falls_back() -> None:
    """Pin. Passes before and after A1 (no parent, so no fallback)."""
    assert resolve_cost(req(session_cm_id=1000199), fictional_rules()).amount is None


def test_an_ag_session_with_no_family_rate_of_its_own_takes_its_parents() -> None:
    """Owner 10-07 (R7): AG session costs auto-link to their parent session, per-person rates included, as validation's
    family-rate skip assumes. The fixture rates 1000201 at 600 standard."""
    cost = resolve_cost(
        _family(session_cm_id=1000299, ag_parent_cm_id=1000201, headcount={"standard": 2}), fictional_rules()
    )
    assert (cost.amount, cost.source) == (Decimal(1200), "per_person")


def test_an_ag_sessions_own_family_rate_wins_over_its_parents() -> None:
    """Pin. Passes before the fallback too (it reads the own rate); guards the own-first order."""
    rules = with_lever(
        fictional_rules(),
        "cost.family_rates",
        [
            {"session_cm_id": 1000201, "standard": "600", "infant": "300"},
            {"session_cm_id": 1000299, "standard": "500", "infant": "250"},
        ],
    )
    cost = resolve_cost(_family(session_cm_id=1000299, ag_parent_cm_id=1000201, headcount={"standard": 2}), rules)
    assert cost.amount == Decimal(1000)

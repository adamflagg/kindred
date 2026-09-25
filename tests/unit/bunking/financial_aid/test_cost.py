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
    cost = resolve_cost(_family(headcount={"standard": 3, "infants": 1}), fictional_rules())
    assert (cost.amount, cost.source) == (Decimal(2100), "per_person")


def test_children_use_the_standard_rate_unless_a_child_rate_is_set() -> None:
    headcount = {"standard": 3, "infants": 1, "children": 2}
    assert resolve_cost(_family(headcount=headcount), fictional_rules()).amount == Decimal(3300)
    rules = with_lever(
        fictional_rules(),
        "cost.family_rates",
        [{"session_cm_id": 1000201, "standard": "600", "infant": "300", "child": "450"}],
    )
    assert resolve_cost(_family(headcount=headcount), rules).amount == Decimal(3000)


def test_family_camp_without_a_headcount_is_unknown() -> None:
    cost = resolve_cost(_family(), fictional_rules())
    assert (cost.amount, cost.source) == (None, "unknown")


def test_an_all_zero_headcount_is_missing_not_free() -> None:
    # (Review Focus) A household of nobody is a data problem, never a $0 cost.
    cost = resolve_cost(_family(headcount={"standard": 0, "infants": 0}), fictional_rules())
    assert cost.amount is None
    assert "headcount" in (cost.missing or "")


def test_family_camp_with_no_rate_for_the_session_is_unknown() -> None:
    cost = resolve_cost(_family(session_cm_id=1000299, headcount={"standard": 2}), fictional_rules())
    assert cost.amount is None
    assert "1000299" in (cost.missing or "")


def test_a_typed_program_needs_an_override() -> None:
    typed = req(program_key="family_school", session_cm_id=1000501)
    assert resolve_cost(typed, fictional_rules()).amount is None
    rules = with_lever(fictional_rules(), "programs.summer.cost_source", "typed")
    assert resolve_cost(req(), rules).amount is None
    assert resolve_cost(req(cost_override={"amount": "1000", "reason": "missing_catalog"}), rules).amount == Decimal(
        1000
    )

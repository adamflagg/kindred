"""The per-program CampMinder description (app spec §6.2 Needs an offer, §13; Decision 7): a label staff post a
program's aid under. It is a lever, so it is changed with with_lever like every other, and it never moves an award."""

from __future__ import annotations

from bunking.financial_aid.calculator import calculate
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever


def test_a_programs_description_is_kept_and_prices_nothing() -> None:
    rules = fictional_rules()
    named = with_lever(rules, "programs.summer.campminder_description", "Summer financial assistance")
    assert named.programs["summer"].campminder_description == "Summer financial assistance"
    assert rules.programs["summer"].campminder_description == ""
    assert calculate(app(), req(), named) == calculate(app(), req(), rules)

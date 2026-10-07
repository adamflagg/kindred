"""The current-year weight is the server's: 1 − the prior-year weight (parent §9.9; Scenarios addendum §S11.5).
Fictional rules only."""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.rules.derived import derive_weights, with_current_year_weight
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_levers


def test_a_sections_content_gets_one_minus_the_prior_year_weight() -> None:
    out = with_current_year_weight({"weights": {"prior_year": "0.6", "current_year": "0.9"}, "floor": "0"})
    assert out == {"weights": {"prior_year": "0.6", "current_year": "0.4"}, "floor": "0"}


def test_content_it_cannot_read_comes_back_untouched_for_the_parse_to_name() -> None:
    assert with_current_year_weight({"weights": {"prior_year": "abc", "current_year": "0.3"}}) == {
        "weights": {"prior_year": "abc", "current_year": "0.3"}
    }
    assert with_current_year_weight({"weights": None}) == {"weights": None}


def test_a_document_is_made_consistent_and_a_consistent_one_is_returned_as_is() -> None:
    skewed = with_levers(fictional_rules(), {"income.weights.prior_year": "0.6", "income.weights.current_year": "0.9"})
    assert derive_weights(skewed).income.weights.current_year == Decimal("0.4")
    consistent = fictional_rules()  # 0.7 / 0.3
    assert derive_weights(consistent) is consistent

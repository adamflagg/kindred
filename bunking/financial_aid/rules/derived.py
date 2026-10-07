"""The settings the server owns (parent §9.9; Scenarios addendum §S11.5): the current-year weight is 1 − the
prior-year weight, whatever was sent. One derivation, called by the rules section save (`_with_derived`) and by every
scenario document the server records or prices (evaluate, the draft, Fit), so a scenario can't hold inconsistent
weights and a promotion carries consistent ones. Pure."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

from bunking.financial_aid.money import ONE
from bunking.financial_aid.rules.schema import AidRules


def with_current_year_weight(income: Mapping[str, Any]) -> dict[str, Any]:
    """The income section's content with the current-year weight derived; untouched when the prior-year weight is
    not a number (the section parse names the bad figure)."""
    out = dict(income)
    weights = out.get("weights")
    if not isinstance(weights, Mapping):
        return out
    try:
        prior = Decimal(str(weights.get("prior_year")))
    except InvalidOperation:
        return out
    if not prior.is_finite():
        return out
    out["weights"] = {**weights, "current_year": str(ONE - prior)}
    return out


def derive_weights(rules: AidRules) -> AidRules:
    """The document with its current-year weight derived; the same object when it already is."""
    weights = rules.income.weights
    current = ONE - weights.prior_year
    if weights.current_year == current:
        return rules
    income = rules.income.model_copy(update={"weights": weights.model_copy(update={"current_year": current})})
    return rules.model_copy(update={"income": income})

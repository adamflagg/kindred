"""Campership scenarios (sub-project 9b): sizing moves, labels and codes, results, and fit to budget. Pure: no I/O."""

from bunking.financial_aid.scenarios.describe import change_phrases, describe, starting_point_code, variant_code
from bunking.financial_aid.scenarios.sizing import (
    SIZING_LEVERS,
    SizingError,
    SizingLever,
    SizingLeverKey,
    apply_sizing,
    dollar_for_dollar,
    nudge,
    shift_round1_tables,
    widen_bands,
    with_dollar_for_dollar,
    with_minimum,
)

__all__ = [
    "SIZING_LEVERS",
    "SizingError",
    "SizingLever",
    "SizingLeverKey",
    "apply_sizing",
    "change_phrases",
    "describe",
    "dollar_for_dollar",
    "nudge",
    "shift_round1_tables",
    "starting_point_code",
    "variant_code",
    "widen_bands",
    "with_dollar_for_dollar",
    "with_minimum",
]

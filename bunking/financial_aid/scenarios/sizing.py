"""Sizing moves on a scenario's rules document (sub-project 9b; spec §7.4; main spec §12.3 method 1). Pure.

A scenario draft is a whole rules document (D39). These are the moves its sizing settings make on it, and the
one-step moves beside each setting ("what one step moves Round 1 by"):

  shift_round1_tables  every Round 1 table's every percentage moved by the same points, clamped to 0-100: the
                       tiers a table lists and the overrides of one that inherits (its inherited tiers move with
                       its parent). "Shift every tier" is how staff size a season (the 2026 table is 2025's
                       shifted), and it is what Fit to budget searches.
  widen_bands          every income band the same dollars wider (narrower when negative). Band i's bounds move by
                       i x delta and (i+1) x delta, so the first band keeps its floor and the bands stay contiguous.
  with_minimum         the minimum award.
  with_dollar_for_dollar
                       the grant-offset method as the named yes/no "dollar-for-dollar" lever (D117, D137):
                       on is `grants.offset_mode` "dollar" (each counted grant dollar lowers the award a dollar,
                       the default); off is "reduce_cost_basis". It is a finance rules setting that also sits in
                       the sizing set, not only under All settings, because `grants` locks at the first Round 1
                       posting (§7.5): its effect has to be seen before March.

SIZING_LEVERS' steps are the screen's steps (the mock's), not policy figures. A switch has no step (`step` None):
its one step is flipping it.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import HUNDRED, ZERO
from bunking.financial_aid.rules.schema import AidRules, R1Percent, TierBand


class SizingError(FinancialAidError, ValueError):
    """A sizing move that would make an impossible document (a band below $0, a negative minimum)."""


SizingLeverKey = Literal["tier_shift", "minimum", "band_width", "dollar_for_dollar"]


@dataclass(frozen=True)
class SizingLever:
    key: SizingLeverKey
    label: str
    step: Decimal | None  # None: a yes/no switch, whose one step is flipping it


SIZING_LEVERS: Final[tuple[SizingLever, ...]] = (
    SizingLever("tier_shift", "Shift every tier (Round 1 %)", Decimal(1)),
    SizingLever("minimum", "Minimum award", Decimal(10)),
    SizingLever("band_width", "Band width", Decimal(1000)),
    SizingLever("dollar_for_dollar", "Grants offset dollar-for-dollar", None),
)


def _moved(percent: R1Percent, points: Decimal) -> R1Percent:
    return R1Percent(r1_pct=min(HUNDRED, max(ZERO, percent.r1_pct + points)))


def shift_round1_tables(rules: AidRules, points: Decimal) -> AidRules:
    if points == 0:
        return rules
    tables = {
        key: table.model_copy(
            update={
                "tiers": {tier: _moved(value, points) for tier, value in table.tiers.items()},
                "overrides": {tier: _moved(value, points) for tier, value in table.overrides.items()},
            }
        )
        for key, table in rules.award_tables.items()
    }
    return rules.model_copy(update={"award_tables": tables})


def widen_bands(rules: AidRules, delta: Decimal) -> AidRules:
    if delta == 0:
        return rules
    bands: list[TierBand] = []
    for index, band in enumerate(rules.tiers.bands):
        lower = band.lower + index * delta
        upper = band.upper + (index + 1) * delta if band.upper is not None else None
        if lower < 0 or (upper is not None and upper < lower):
            wording = "narrower" if delta < 0 else "wider"
            raise SizingError(f"Bands ${abs(delta):,} {wording} would leave band {index + 1} empty or below $0")
        bands.append(band.model_copy(update={"lower": lower, "upper": upper}))
    return rules.model_copy(update={"tiers": rules.tiers.model_copy(update={"bands": bands})})


def with_minimum(rules: AidRules, amount: Decimal) -> AidRules:
    if amount < 0:
        raise SizingError("The minimum award can't be below $0")
    return rules.model_copy(update={"awards": rules.awards.model_copy(update={"minimum": amount})})


def dollar_for_dollar(rules: AidRules) -> bool:
    return rules.grants.offset_mode == "dollar"


def with_dollar_for_dollar(rules: AidRules, on: bool) -> AidRules:
    mode: Literal["dollar", "reduce_cost_basis"] = "dollar" if on else "reduce_cost_basis"
    if rules.grants.offset_mode == mode:
        return rules
    return rules.model_copy(update={"grants": rules.grants.model_copy(update={"offset_mode": mode})})


def apply_sizing(rules: AidRules, *, tier_shift: Decimal = ZERO, band_width_delta: Decimal = ZERO) -> AidRules:
    """The draft's two relative sizing settings applied to `rules` (the document the slider started from)."""
    return shift_round1_tables(widen_bands(rules, band_width_delta), tier_shift)


def nudge(rules: AidRules, lever: SizingLever) -> AidRules:
    """`rules` moved one step of `lever` (a switch flipped)."""
    if lever.step is None:
        return with_dollar_for_dollar(rules, not dollar_for_dollar(rules))
    if lever.key == "tier_shift":
        return shift_round1_tables(rules, lever.step)
    if lever.key == "minimum":
        return with_minimum(rules, rules.awards.minimum + lever.step)
    return widen_bands(rules, lever.step)

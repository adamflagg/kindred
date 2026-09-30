"""What a scenario changed, in a few words, and the kept options' spoken codes (sub-project 9b; D36, D38). Pure.

A kept option is unnamed: its label is only what differs from its starting point, one phrase per change, in
rules-section order, joined by " · ":

  "Round 1 % −2 pts"     every Round 1 table cell moved by the same points (a clamped shift is not uniform)
  "bands $5,000 wider"   every band widened alike (sizing.widen_bands)
  "minimum $150"         the minimum award
  "dollar-for-dollar off"  the grant-offset method, by its sizing-lever name (D137)
  "income.floor 0 → 500"   any other single change
  "income: 2 changes"    several other changes in one section (bands moved unevenly count bound by bound)

A label longer than the trail's change column (CHANGE_MAX_CHARS) is cut, ending in "…".

Codes: starting points A..Z, AA, AB...; variants are their starting point's code and a count (A1, B2).
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Final

from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.rules.lifecycle import changed_sections
from bunking.financial_aid.rules.schema import AidRules

# aid_scenario_trail.change is a text field capped at 2,000 characters (1500000218_aid_scenarios.js).
CHANGE_MAX_CHARS: Final = 2000


def _number(value: Decimal) -> str:
    return format(value.normalize(), ",f")


def _money(value: Decimal) -> str:
    """Dollars as staff write them: $150, $150.50, $5,000."""
    return f"{value:,.0f}" if value == value.to_integral_value() else f"{value:,.2f}"


def _text(value: object) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, Decimal):
        return _number(value)
    if isinstance(value, (list, tuple)):
        return ", ".join(_text(item) for item in value) or "none"
    if value is None:
        return "none"
    return str(value)


def _table_shift(old: AidRules, new: AidRules) -> Decimal | None:
    """The one number of points every Round 1 table cell moved by; None when they moved unevenly."""
    if old.award_tables.keys() != new.award_tables.keys():
        return None
    deltas: set[Decimal] = set()
    for key, table in old.award_tables.items():
        other = new.award_tables[key]
        if (
            table.inherits != other.inherits
            or table.tiers.keys() != other.tiers.keys()
            or table.overrides.keys() != other.overrides.keys()
        ):
            return None
        deltas.update(other.tiers[t].r1_pct - v.r1_pct for t, v in table.tiers.items())
        deltas.update(other.overrides[t].r1_pct - v.r1_pct for t, v in table.overrides.items())
    if len(deltas) != 1:
        return None
    (delta,) = deltas
    return delta or None


def _band_widening(old: AidRules, new: AidRules) -> Decimal | None:
    """The dollars every band widened by (sizing.widen_bands); None when the bands changed some other way."""
    before, after = old.tiers.bands, new.tiers.bands
    if len(before) != len(after) or len(before) < 2:
        return None
    delta = after[1].lower - before[1].lower
    if delta == 0:
        return None
    for index, (was, now) in enumerate(zip(before, after, strict=True)):
        if now.lower - was.lower != index * delta or (was.upper is None) != (now.upper is None):
            return None
        if was.upper is not None and now.upper is not None and now.upper - was.upper != (index + 1) * delta:
            return None
    return delta


def _band_leaves(old: AidRules, new: AidRules) -> list[FieldChange]:
    """The bands' changes bound by bound ("bands.2.upper"), bands counted from 1: the diff compares a list whole, which
    would read as one change printing every band."""
    before, after = old.tiers.bands, new.tiers.bands
    if len(before) != len(after):
        return [FieldChange(("bands",), "changed", f"{len(before)} bands", f"{len(after)} bands")]
    leaves: list[FieldChange] = []
    for index, (was, now) in enumerate(zip(before, after, strict=True), start=1):
        leaves.extend(
            replace(change, path=("bands", str(index), *change.path))
            for change in field_changes(was.model_dump(), now.model_dump())
        )
    return leaves


def _one(section: str, change: FieldChange) -> str:
    path = ".".join(str(part) for part in (section, *change.path))
    return f"{path} {_text(change.before)} → {_text(change.after)}"


def change_phrases(old: AidRules, new: AidRules) -> list[str]:
    phrases: list[str] = []
    before, after = old.model_dump(), new.model_dump()
    for section in changed_sections(old, new):
        leaves = field_changes(before[section], after[section])
        shift = _table_shift(old, new) if section == "award_tables" else None
        if shift is not None:
            phrases.append(f"Round 1 % {'+' if shift > 0 else '−'}{_number(abs(shift))} pts")
            continue
        if section == "tiers" and old.tiers.bands != new.tiers.bands:
            widening = _band_widening(old, new)
            leaves = [change for change in leaves if change.path[0] != "bands"]
            if widening is not None:
                phrases.append(f"bands ${_money(abs(widening))} {'wider' if widening > 0 else 'narrower'}")
            else:
                leaves = [*_band_leaves(old, new), *leaves]
        if section == "grants" and old.grants.offset_mode != new.grants.offset_mode:
            phrases.append(f"dollar-for-dollar {'on' if new.grants.offset_mode == 'dollar' else 'off'}")
            leaves = [change for change in leaves if change.path != ("offset_mode",)]
        if section == "awards" and old.awards.minimum != new.awards.minimum:
            phrases.append(f"minimum ${_money(new.awards.minimum)}")
            leaves = [change for change in leaves if change.path != ("minimum",)]
        if len(leaves) == 1:
            phrases.append(_one(section, leaves[0]))
        elif leaves:
            phrases.append(f"{section}: {len(leaves)} changes")
    return phrases


def describe(old: AidRules, new: AidRules) -> str:
    """The label, cut to the trail's change column so a long multi-section change never fails the write."""
    text = " · ".join(change_phrases(old, new)) or "no changes"
    return text if len(text) <= CHANGE_MAX_CHARS else text[: CHANGE_MAX_CHARS - 1] + "…"


def starting_point_code(index: int) -> str:
    """The code of the `index`-th starting point, counting from 0: A..Z, then AA, AB..."""
    letters = ""
    number = index + 1
    while number:
        number, rest = divmod(number - 1, 26)
        letters = chr(ord("A") + rest) + letters
    return letters


def variant_code(head: str, existing: int) -> str:
    """The next variant under starting point `head`, which already has `existing` variants."""
    return f"{head}{existing + 1}"

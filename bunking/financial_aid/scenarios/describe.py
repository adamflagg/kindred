"""What a scenario changed, in staff words, and the kept options' spoken codes (sub-project 9b; D36, D38; Scenarios
addendum §S11.6, which absorbs follow-up V#17). Pure.

The label prefills Keep…'s name, heads the draft's Compare column and fills the trail's change text, so it is written
in the words the Scenarios cards and the Rules tab use (rulesCards.ts), never a dotted path:

  "Tiers 3–5 +5%" / "Tier 4 +5%"   a run of the root Round 1 table's cells moved alike ("6 tiers moved" when not)
  "Round 2 caps tiers 4–6 +5%"     the same for the root Round 1 + 2 cap table
  "Minimum $75"                    the minimum award
  "Bands start $5,000" · "Band width $40,000" · "Tiers 12" · "Income ceiling $300,000" | "Income ceiling none"
  "‹Label› ‹value›"                any other setting the sandbox edits ("Prior-year weight 70%",
                                   "Weight › Camp › Unemployment 0.75", "Unemployment › Enabled checked",
                                   "Dependents Lower the income", "Round 1 % › Teen › Tier 2 75%")
  "‹Card title›: ‹n› changes"      every other change in a section (a Last season's start can carry them)

The root table is the first in its section's order that inherits nothing: the one the grid's other columns are
"same as". No class or program is named in code; a class reads as its key. A changed tier count hides the table rows
above the smaller count: they are the count's consequence. The runs come first, then every other phrase in section
order; more than three fold to "‹first› · ‹second› + ‹n› more". "pts" never appears: Fit keeps it (owner: Fit
unchanged). A label longer than the trail's change column (CHANGE_MAX_CHARS) is cut, ending in "…".

Codes: starting points A..Z, AA, AB...; variants (kept before PR 10, D38) are their starting point's code and a count.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from decimal import Decimal
from typing import Any, Final

from bunking.financial_aid.change_diff import FieldChange, field_changes
from bunking.financial_aid.rules.lifecycle import changed_sections
from bunking.financial_aid.rules.schema import AidRules, EquitySection, IncomeSection, SectionName, TierBand

# aid_scenario_trail.change is a text field capped at 2,000 characters (1500000218_aid_scenarios.js).
CHANGE_MAX_CHARS: Final = 2000
_SHOWN: Final = 3

# Parent §6.2 D's card titles: the Rules tab's SECTION_TITLES (parent Task 19). A section's count and the lock's
# words read them, so Scenarios and Rules name a section alike. test_scenario_labels.py reads the TypeScript literal,
# so the two can't drift.
CARD_TITLES: Final[Mapping[SectionName, str]] = {
    "income": "Counting a family's income",
    "tiers": "Income tiers",
    "equity": "Moving a family up a tier",
    "award_tables": "Round 1 award table",
    "programs": "Programs and their sessions",
    "cost": "Costs and Family Camp rates",
    "grants": "Outside grants",
    "awards": "Minimum award and named awards",
    "round2": "Appeal caps",
    "round3": "Who can ask, and how much",
    "budget": "Budget and pools",
    "quality_checks": "Quality checks",
    "milestones": "Dates",
}
# The Income counting card's money rows (rulesCards.ts CARD_SPECS.income), by field.
_INCOME_MONEY: Final[Mapping[str, str]] = {
    "medical_threshold": "Medical expenses count above",
    "education_threshold": "Education expenses count above",
    "savings_threshold": "Savings count above",
    "per_dependent_reduction": "Taken off per dependent",
}
# rulesCards.ts CHOICE_WORDS.dependents_mode.
_DEPENDENTS: Final[Mapping[str, str]] = {
    "tier_shift": "Move the tier",
    "income_reduction": "Lower the income",
    "none": "Not counted",
}


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _money(value: Decimal) -> str:
    """Dollars as staff write them: $150, $150.50, $5,000."""
    return f"${value:,.0f}" if value == value.to_integral_value() else f"${value:,.2f}"


def _signed(value: Decimal) -> str:
    return f"{'+' if value > 0 else '−'}{_plain(abs(value))}"


def _words(key: str) -> str:
    text = key.replace("_", " ")
    return text[:1].upper() + text[1:]


def _count(section: SectionName, n: int) -> str:
    return f"{CARD_TITLES.get(section, _words(section))}: {n} change{'' if n == 1 else 's'}"


def _even(bands: Sequence[TierBand]) -> tuple[Decimal, Decimal, int] | None:
    """(start, width, count) when the bands are the tiers editor's even bands (parent Task 44's bandsOf: tier n
    starts at start + width × (n−1) + 1, the top band open); None for bands set by hand."""
    if len(bands) < 2 or bands[0].upper is None:
        return None
    start, width = bands[0].lower, bands[0].upper - bands[0].lower
    for index, band in enumerate(bands):
        lower = start if index == 0 else start + index * width + 1
        upper = None if index == len(bands) - 1 else start + (index + 1) * width
        if band.lower != lower or band.upper != upper:
            return None
    return start, width, len(bands)


def _root(tables: Mapping[str, Any]) -> str | None:
    return next((key for key, table in tables.items() if table.inherits is None), None)


def _run(old: Mapping[str, Any], new: Mapping[str, Any], field: str, top: int) -> tuple[str | None, str | None]:
    """The root table's cells (tiers up to `top`) that moved, as "tier(s) a–b ±d%" or "n tiers moved"; with the
    root's key, so the section's other phrases skip what the run said."""
    root = _root(new)
    if root is None or root not in old or old[root].inherits is not None:
        return None, None
    before, after = old[root].tiers, new[root].tiers
    moved = sorted(
        t for t in before.keys() & after.keys() if t <= top and getattr(before[t], field) != getattr(after[t], field)
    )
    if not moved:
        return None, root
    deltas = {getattr(after[t], field) - getattr(before[t], field) for t in moved}
    if moved == list(range(moved[0], moved[-1] + 1)) and len(deltas) == 1:
        (delta,) = deltas
        span = f"tier {moved[0]}" if len(moved) == 1 else f"tiers {moved[0]}–{moved[-1]}"
        return f"{span} {_signed(delta)}%", root
    return f"{len(moved)} tiers moved", root


def _table_phrases(
    old: Mapping[str, Any], new: Mapping[str, Any], *, field: str, label: str, root: str | None, top: int
) -> tuple[list[str], int]:
    """A table section's leaves the run didn't say: a cell of another own table, or an override, as "‹label› ›
    ‹Class› › Tier n v%"; a row above `top` hidden; anything else counted."""
    phrases: list[str] = []
    rest = 0

    def dump(tables: Mapping[str, Any]) -> dict[str, Any]:
        return {key: table.model_dump() for key, table in tables.items()}

    for change in field_changes(dump(old), dump(new)):
        table, *more = change.path
        if table in old and len(more) == 3 and more[0] in ("tiers", "overrides") and more[2] == field:
            tier = int(more[1])
            if tier > top or (table == root and more[0] == "tiers" and change.kind == "changed"):
                continue  # the count's consequence, or the run's cell
            if change.kind != "removed":
                phrases.append(f"{label} › {_words(str(table))} › Tier {tier} {_plain(change.after)}%")
                continue
        rest += 1
    return phrases, rest


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


def _tier_phrases(old: AidRules, new: AidRules) -> tuple[list[str], int]:
    phrases: list[str] = []
    rest = 0
    if old.tiers.bands != new.tiers.bands:
        was, now = _even(old.tiers.bands), _even(new.tiers.bands)
        if was is not None and now is not None:
            if now[0] != was[0]:
                phrases.append(f"Bands start {_money(now[0])}")
            if now[1] != was[1]:
                phrases.append(f"Band width {_money(now[1])}")
            if now[2] != was[2]:
                phrases.append(f"Tiers {now[2]}")
        else:
            rest += len(_band_leaves(old, new))
    if old.tiers.income_ceiling != new.tiers.income_ceiling:
        ceiling = new.tiers.income_ceiling
        phrases.append(f"Income ceiling {'none' if ceiling is None else _money(ceiling)}")
    others = field_changes(old.tiers.model_dump(), new.tiers.model_dump())
    rest += sum(1 for c in others if c.path[0] not in ("bands", "income_ceiling"))
    return phrases, rest


def _equity_phrases(old: EquitySection, new: EquitySection) -> tuple[list[str], int]:
    labels = {c.key: c.label for c in new.criteria}
    phrases: list[str] = []
    rest = 0
    if old.criteria != new.criteria:
        pairs = list(zip(old.criteria, new.criteria, strict=False))
        only_enabled = len(old.criteria) == len(new.criteria) and all(
            a.model_copy(update={"enabled": b.enabled}) == b for a, b in pairs
        )
        if only_enabled:
            phrases += [
                f"{b.label} › Enabled {'checked' if b.enabled else 'unchecked'}"
                for a, b in pairs
                if a.enabled != b.enabled
            ]
        else:
            rest += 1  # the list itself changed (a Last season's start): counted, never spelled out
    for change in field_changes(old.weights, new.weights):
        if change.kind == "changed" and len(change.path) == 2:
            cls, key = (str(part) for part in change.path)
            phrases.append(f"Weight › {_words(cls)} › {labels.get(key, _words(key))} {_plain(change.after)}")
        else:
            rest += 1
    others = field_changes(old.model_dump(), new.model_dump())
    rest += sum(1 for c in others if c.path[0] not in ("criteria", "weights"))
    return phrases, rest


def _income_phrases(old: IncomeSection, new: IncomeSection) -> tuple[list[str], int]:
    phrases: list[str] = []
    rest = 0
    prior_moved = old.weights.prior_year != new.weights.prior_year
    for change in field_changes(old.model_dump(), new.model_dump()):
        path = tuple(str(part) for part in change.path)
        if path == ("weights", "current_year") and prior_moved:
            continue  # derived: 1 − the prior-year weight (§S11.5); the prior-year phrase says it
        if path == ("weights", "prior_year") and change.kind == "changed":
            phrases.append(f"Prior-year weight {_plain(change.after * 100)}%")
        elif len(path) == 1 and path[0] in _INCOME_MONEY and change.kind == "changed":
            phrases.append(f"{_INCOME_MONEY[path[0]]} {_money(change.after)}")
        elif path == ("dependents_mode",):
            phrases.append(f"Dependents {_DEPENDENTS.get(str(change.after), str(change.after))}")
        else:
            rest += 1
    return phrases, rest


def change_phrases(old: AidRules, new: AidRules) -> list[str]:
    top = min(len(old.tiers.bands), len(new.tiers.bands))
    run1, root1 = _run(old.award_tables, new.award_tables, "r1_pct", top)
    run2, root2 = _run(old.round2.tables, new.round2.tables, "total_pct", top)
    phrases: list[str] = []
    if run1 is not None:
        phrases.append(run1[:1].upper() + run1[1:])
    if run2 is not None:
        phrases.append(f"Round 2 caps {run2}")
    before, after = old.model_dump(), new.model_dump()
    for section in changed_sections(old, new):
        if section == "tiers":
            said, rest = _tier_phrases(old, new)
        elif section == "equity":
            said, rest = _equity_phrases(old.equity, new.equity)
        elif section == "income":
            said, rest = _income_phrases(old.income, new.income)
        elif section == "award_tables":
            said, rest = _table_phrases(
                old.award_tables, new.award_tables, field="r1_pct", label="Round 1 %", root=root1, top=top
            )
        elif section == "round2":
            said, rest = _table_phrases(
                old.round2.tables, new.round2.tables, field="total_pct", label="Round 1 + 2 cap", root=root2, top=top
            )
            others = field_changes(before["round2"], after["round2"])
            rest += sum(1 for c in others if c.path[0] != "tables")
        elif section == "awards":
            said = [f"Minimum {_money(new.awards.minimum)}"] if old.awards.minimum != new.awards.minimum else []
            rest = sum(1 for c in field_changes(before["awards"], after["awards"]) if c.path != ("minimum",))
        else:
            said, rest = [], len(field_changes(before[section], after[section]))
        phrases += said
        if rest:
            phrases.append(_count(section, rest))
    return phrases


def describe(old: AidRules, new: AidRules) -> str:
    """The label, cut to the trail's change column so a long change never fails the write."""
    phrases = change_phrases(old, new)
    if not phrases:
        return "no changes"
    text = " · ".join(phrases) if len(phrases) <= _SHOWN else f"{phrases[0]} · {phrases[1]} + {len(phrases) - 2} more"
    text = text[:1].upper() + text[1:]
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

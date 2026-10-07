"""Settings the Rules tab hides or shows read-only (spec §6.4), which the section save refuses to change (§9.9).

A safety net: the editor never sends one changed. Hidden settings are kept as stored, so 2026 replays from its own
file (`grants.minimum_when_fully_covered` differs by year, so none of them is a constant in code). The scenario levers
("All settings") don't go through the section save and are unchanged. The current-year weight is read-only on screen
but the server writes it (1 − the prior-year weight), so it is not here.

A path is dotted inside its section: "*" is any key or list position, and a final "#keys" compares a mapping's keys
only (the list of checks is fixed; each check's own settings are not).
"""

from __future__ import annotations

import copy
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from bunking.financial_aid.rules.schema import AidRules, SectionName


@dataclass(frozen=True)
class FixedSetting:
    path: str
    label: str


FIXED_PATHS: Final[Mapping[SectionName, tuple[FixedSetting, ...]]] = {
    "income": (
        FixedSetting("medical_rate", "Share of medical costs taken off"),
        FixedSetting("education_rate", "Share of education costs taken off"),
        FixedSetting("savings_inclusion_rate", "Share of savings added"),
        FixedSetting("extra_terms", "Other figures in the formula"),
        FixedSetting("floor", "Income floor"),
        FixedSetting("floor_applies_after", "Floor tested"),
    ),
    "tiers": (FixedSetting("floor_tier", "Lowest final tier"),),
    "equity": (
        FixedSetting("criteria.*.key", "The list of criteria"),
        FixedSetting("criteria.*.label", "The list of criteria"),
        FixedSetting("criteria.*.source", "Whose answer"),
        FixedSetting("criteria.*.field", "Reads"),
        FixedSetting("criteria.*.also_fields", "Reads"),
        FixedSetting("criteria.*.match", "Counts when"),
        FixedSetting("criteria.*.values", "Counts when"),
        FixedSetting("criteria.*.min_value", "Counts when"),
        FixedSetting("aggregation", "Rounding the total"),
    ),
    "award_tables": (FixedSetting("*.inherits", "Same as another table"),),
    "awards": (
        FixedSetting("minimum_when_cost_unknown", "Pay the minimum when the cost is unknown"),
        FixedSetting("minimum_without_table", "Pay the minimum when the program has no award table"),
        FixedSetting("ask_cap", "Never give more than the family asked for"),
        FixedSetting("rounding", "Rounding"),
        # Owner 10-06 (c): named funds are managed in Grants › Grantors (slice 3), never by a rules save. This entry
        # also refuses a save that ADDS a decision type (a new key's `kind` reads as a change). Until slice 3, 2027's
        # rules starting file carries the named-fund row as data; nothing in code seeds or adds one.
        FixedSetting("decision_types.*.kind", "Named award › Kind"),
        FixedSetting("decision_types.*.round", "Named award › Round"),
        FixedSetting("decision_types.*.allows_appeal", "Named award › Allows an appeal"),
        FixedSetting("decision_types.*.counts_toward_budget", "Named award › Counts toward the budget"),
        FixedSetting("decision_types.*.ceiling_exempt", "Named award › Pays above the income ceiling"),
    ),
    "grants": (
        FixedSetting("count_when", "A grant counts once it is"),
        FixedSetting("minimum_when_fully_covered", "Pay the minimum when grants cover the whole cost"),
        FixedSetting("late_grant_policy", "A grant recorded after Round 1"),
        FixedSetting("minimum_after_grants", "Minimum on a partial grant"),
        FixedSetting("minimum_capped_at_share", "Cap on the minimum"),
    ),
    "round2": (
        FixedSetting("cap_subtracts_grants", "The appeal cap subtracts outside grants"),
        FixedSetting("cap_by_original_ask", "Cap the appeal at the original ask"),
        FixedSetting("total_cap", "Cap on every round together"),
        FixedSetting("tables.*.inherits", "Same as another table"),
    ),
    "round3": (
        FixedSetting("require_round2", "Needs a Round 2 decision first"),
        FixedSetting("require_statement_of_need", "Needs a statement of need"),
    ),
    "programs": (
        FixedSetting("*.session_types", "Session types"),
        FixedSetting("*.campminder_description", "CampMinder description"),
        FixedSetting("*.cost_source", "Cost from"),
    ),
    "cost": (
        FixedSetting("infant_age_cutoff_months", "Infant under (months)"),
        FixedSetting("override_reasons", "Reasons staff can give for changing a cost"),
    ),
    "quality_checks": (FixedSetting("checks.#keys", "The list of checks"),),
}


def _values(node: Any, parts: Sequence[str], at: tuple[str, ...] = ()) -> Iterator[tuple[tuple[str, ...], Any]]:
    if not parts:
        yield at, node
        return
    head, rest = parts[0], parts[1:]
    if head == "#keys":
        yield (*at, "#keys"), sorted(str(k) for k in node) if isinstance(node, Mapping) else None
    elif head == "*":
        pairs = node.items() if isinstance(node, Mapping) else enumerate(node) if isinstance(node, list) else ()
        for key, child in pairs:
            yield from _values(child, rest, (*at, str(key)))
    elif isinstance(node, Mapping) and head in node:
        yield from _values(node[head], rest, (*at, head))
    else:
        yield (*at, head), None


def changed_fixed(section: SectionName, before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    """The labels of the fixed settings `after` changes, in FIXED_PATHS' order, each once. Pass python-mode dumps
    (`model_dump()`), so equal decimals written differently ("1" and "1.0") compare equal."""
    out: list[str] = []
    for setting in FIXED_PATHS.get(section, ()):
        parts = setting.path.split(".")
        if dict(_values(before, parts)) != dict(_values(after, parts)) and setting.label not in out:
            out.append(setting.label)
    return out


def _reset(base: Any, wanted: Any, parts: Sequence[str]) -> Any:
    """`wanted` with the value(s) at `parts` set to `base`'s (FIXED_PATHS' grammar: `*` is every key or list
    position, `#keys` the set of keys). A `*` over a mapping keeps `base`'s keys only (an added named award or
    program goes; a removed one comes back); over a list it matches entries by their `key`, in `base`'s order (an
    entry only `wanted` has goes; one it lacks comes back whole). Where `wanted` lacks the shape, `base`'s value
    stands."""
    if not parts:
        return copy.deepcopy(base)
    head, rest = parts[0], parts[1:]
    if head == "#keys":
        if isinstance(base, Mapping) and isinstance(wanted, Mapping):
            return {key: copy.deepcopy(wanted.get(key, base[key])) for key in base}
        return copy.deepcopy(base)
    if head == "*":
        if isinstance(base, Mapping) and isinstance(wanted, Mapping):
            return {
                key: _reset(base[key], wanted[key], rest) if key in wanted else copy.deepcopy(base[key]) for key in base
            }
        if isinstance(base, list) and isinstance(wanted, list):
            # Coordinator ruling (PR 10, 2026-10-07): list entries (equity criteria) match by `key`, never by
            # position, so a reordered or re-membered list never moves an Enabled flag onto the wrong criterion.
            by_key = {item["key"]: item for item in wanted if isinstance(item, Mapping) and "key" in item}
            return [
                _reset(item, by_key[item["key"]], rest)
                if isinstance(item, Mapping) and item.get("key") in by_key
                else copy.deepcopy(item)
                for item in base
            ]
        return copy.deepcopy(base)
    if not isinstance(wanted, Mapping):
        return copy.deepcopy(base)
    out = dict(wanted)
    if isinstance(base, Mapping) and head in base:
        out[head] = _reset(base[head], wanted[head], rest) if head in wanted else copy.deepcopy(base[head])
    else:
        out.pop(head, None)
    return out


def reset_fixed(section: SectionName, base: Mapping[str, Any], wanted: Mapping[str, Any]) -> dict[str, Any]:
    """`wanted`'s section with every fixed setting set back to `base`'s (Scenarios addendum §S11.3): a promotion
    never writes a setting the Rules tab hides or shows read-only. Everything else `wanted` changed stays, except an
    entry a `*` or `#keys` path adds or removes: the set of keys is itself fixed, so it follows `base` whole. Its
    contract: `changed_fixed(section, base, reset_fixed(section, base, wanted)) == []`."""
    out: Any = dict(wanted)
    for setting in FIXED_PATHS.get(section, ()):
        out = _reset(base, out, setting.path.split("."))
    return dict(out)


def reset_fixed_document(base: AidRules, wanted: AidRules) -> tuple[AidRules, int]:
    """`wanted` with every section's fixed settings set back to `base`'s, and how many distinct fixed settings that
    changed back (the promotion dialog says "‹n› fixed settings stay as the rules draft has them")."""
    before, after = base.model_dump(), wanted.model_dump()
    base_json, out = base.model_dump(mode="json"), wanted.model_dump(mode="json")
    kept = 0
    for section in FIXED_PATHS:
        labels = changed_fixed(section, before[section], after[section])
        if labels:
            kept += len(labels)
            out[section] = reset_fixed(section, base_json[section], out[section])
    return AidRules.model_validate(out), kept

"""Lookups over a rules document, shared by validation and the calculator."""

from __future__ import annotations

from bunking.financial_aid.rules.schema import AidRules, EquityCriterion, TierPercents


def is_dependents_criterion(criterion: EquityCriterion) -> bool:
    """The household criterion that reads the application's dependents count.

    It only shifts the tier when income.dependents_mode is "tier_shift".
    """
    return criterion.source == "household" and criterion.field == "dependents"


def resolved_table(rules: AidRules, name: str) -> dict[int, TierPercents]:
    """The effective tier -> percentages of table `name`, inheritance applied.

    Raises KeyError for an unknown table or an override of a tier the parent does
    not have, and ValueError for inheritance more than one level deep.
    """
    table = rules.award_tables[name]
    if table.inherits is None:
        return dict(table.tiers)
    parent = rules.award_tables[table.inherits]
    if parent.inherits is not None:
        raise ValueError(f"table '{name}' inherits '{table.inherits}', which itself inherits")
    resolved = dict(parent.tiers)
    for tier, override in table.overrides.items():
        base = resolved[tier]
        resolved[tier] = TierPercents(
            r1_pct=override.r1_pct if override.r1_pct is not None else base.r1_pct,
            total_pct=override.total_pct if override.total_pct is not None else base.total_pct,
        )
    return resolved


def resolve_program(rules: AidRules, session_cm_id: int | None, session_type: str | None = None) -> str | None:
    """Which program a CampMinder session belongs to this season, or None.

    An explicit session id wins over a session type, so staff can pull one
    session out of a type-wide mapping.
    """
    if session_cm_id is not None:
        for key, program in rules.programs.items():
            if session_cm_id in program.session_cm_ids:
                return key
    if session_type is not None:
        for key, program in rules.programs.items():
            if session_type in program.session_types:
                return key
    return None

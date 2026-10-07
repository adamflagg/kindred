"""Lookups over a rules document, shared by validation and the calculator."""

from __future__ import annotations

from collections.abc import Mapping

from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules.schema import (
    AidRules,
    EquityCriterion,
    ProgramProfile,
    R1Percent,
    TierTable,
    TotalPercent,
)


def is_dependents_criterion(criterion: EquityCriterion) -> bool:
    """The household criterion that reads the application's dependents count.

    It only shifts the tier when income.dependents_mode is "tier_shift".
    """
    return criterion.source == "household" and criterion.field == "dependents"


def resolved_table[V: (R1Percent, TotalPercent)](tables: Mapping[str, TierTable[V]], name: str) -> dict[int, V]:
    """The effective tier -> percentage of table `name` in `tables` (``rules.award_tables``
    or ``rules.round2.tables``), inheritance applied.

    Raises KeyError for an unknown table or an override of a tier the parent does
    not have, and ValueError for inheritance more than one level deep.
    """
    table = tables[name]
    if table.inherits is None:
        return dict(table.tiers)
    parent = tables[table.inherits]
    if parent.inherits is not None:
        raise ValueError(f"table '{name}' inherits '{table.inherits}', which itself inherits")
    resolved = dict(parent.tiers)
    for tier, override in table.overrides.items():
        if tier not in resolved:
            raise KeyError(tier)
        resolved[tier] = override
    return resolved


def resolve_program(
    rules: AidRules,
    session_cm_id: int | None,
    session_type: str | None = None,
    *,
    ag_parent: tuple[int, str | None] | None = None,
) -> str | None:
    """Which program a CampMinder session belongs to this season, or None.

    An explicit session id wins over a session type, so staff can pull one
    session out of a type-wide mapping. An AG session (type "ag") that no program
    claims takes its parent session's program when `ag_parent` (the parent's id and
    type) is given (spec §8; plan review M7): the Rules card hides AG sessions under
    their parent, so a new one is never left in no program.
    """
    if session_cm_id is not None:
        for key, program in rules.programs.items():
            if session_cm_id in program.session_cm_ids:
                return key
    if session_type is not None:
        for key, program in rules.programs.items():
            if session_type in program.session_types:
                return key
    if session_type == "ag" and ag_parent is not None and ag_parent[0] > 0:
        return resolve_program(rules, ag_parent[0], ag_parent[1])
    return None


class Round2TableNotListedError(FinancialAidError, KeyError):
    """A legacy program that round2.program_tables does not list: the engine's "does not say which Round 2 table"
    error."""

    def __init__(self, program_key: str) -> None:
        super().__init__(program_key)
        self.program_key = program_key


def round1_table(rules: AidRules, program: ProgramProfile) -> str | None:
    """The award table a program's Round 1 reads (spec §9.9): its equity class when it routes by class, else its
    legacy `r1_table`. None: no table (by class: no class, so its requests hold; legacy: the minimum only)."""
    return program.equity_class if program.table_from_equity_class else program.r1_table


def round2_table(rules: AidRules, program_key: str) -> str | None:
    """The appeal-cap table a program's Round 2 reads: its equity class by class, else `round2.program_tables`
    (None there means no Round 2 table). A legacy program the map doesn't list raises Round2TableNotListedError."""
    program = rules.programs.get(program_key)
    if program is not None and program.table_from_equity_class:
        return program.equity_class
    if program_key not in rules.round2.program_tables:
        raise Round2TableNotListedError(program_key)
    return rules.round2.program_tables[program_key]

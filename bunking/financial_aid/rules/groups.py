"""The one group concept (spec §4.1; owner 10-07: equity class, pool and award table "basically mean the same thing").

A group is a budget pool: its name is the pool's label and its order the pools' order. Its class is the equity class
most of the pool's open, session-claiming programs use (ties to document order), read from the programs, never written
in code. Validation (the group warnings and the table names), the rules reads and the Programs and costs card all use
this one definition. The data collapse of programs into groups is #3048, later.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from bunking.financial_aid.rules.schema import AidRules, ProgramProfile


@dataclass(frozen=True)
class Group:
    pool: str
    label: str
    equity_class: str | None


def claims_sessions(program: ProgramProfile) -> bool:
    """A program that claims a session by id or by type (the test validation.py's `claims_sessions` uses)."""
    return bool(program.session_cm_ids or program.session_types)


def _most_used(classes: list[str]) -> str | None:
    if not classes:
        return None
    counts = Counter(classes)
    top = max(counts.values())
    return next(c for c in classes if counts[c] == top)


def season_groups(rules: AidRules) -> list[Group]:
    groups: list[Group] = []
    for pool, spec in rules.budget.pools.items():
        classes = [
            program.equity_class
            for program in rules.programs.values()
            if program.open_to_aid
            and program.budget_pool == pool
            and claims_sessions(program)
            and program.equity_class is not None
        ]
        groups.append(Group(pool, spec.label, _most_used(classes)))
    return groups


def group_of_pool(rules: AidRules, pool: str | None) -> Group | None:
    return next((g for g in season_groups(rules) if g.pool == pool), None) if pool is not None else None


def group_of_class(rules: AidRules, class_key: str) -> Group | None:
    return next((g for g in season_groups(rules) if g.equity_class == class_key), None)

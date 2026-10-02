"""Which rules section a trace step's limit comes from (D76: a receipt opens the rules "at the section that bound the
award"; slice 2 missing read 7). The engine names each limit with a code (TraceStep.bound); this maps a step and its
code to the section holding the setting, so the frontend never mirrors the engine (slice 2 plan Decision 26). A code in
NOT_A_SETTING binds on something that isn't a rules setting: the family's own appeal or Round 3 request, or a posted
lock (D43)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from bunking.financial_aid.rules.schema import SectionName

NOT_A_SETTING: Final = frozenset({"appeal", "request", "locked"})

# Codes two sections share, told apart by the step.
_BY_STEP: Final[Mapping[tuple[str, str], SectionName]] = {
    ("r1_potential", "no_table"): "programs",  # the program names no Round 1 table
    ("r1", "no_table"): "programs",
    ("r2", "no_table"): "round2",  # round2.program_tables routes it to none
    ("r2_cap", "cap"): "round2",
    ("r2", "cap"): "round2",
    ("r3", "cap"): "round3",  # round3.max_total_pct_of_cost
}
_BY_CODE: Final[Mapping[str, SectionName]] = {
    "floor": "income",  # income.floor
    "max_shift": "equity",  # equity.max_shift
    "tier_floor": "tiers",  # tiers.floor_tier
    "income_ceiling": "tiers",  # tiers.income_ceiling
    "table": "award_tables",
    "full_cost": "awards",  # a full_cost decision type
    "minimum": "awards",  # awards.minimum
    "ask": "awards",  # awards.ask_cap
    "not_allowed": "awards",  # the decision type's allows_appeal
    "grants_cover": "grants",
    "original_ask": "round2",  # round2.cap_by_original_ask
    "total_cap": "round2",  # round2.total_cap
    "not_eligible": "round3",  # round3.require_round2 / require_statement_of_need
    "max_amount": "round3",  # round3.max_amount
}


def bound_section(key: str, bound: str | None) -> SectionName | None:
    """The section whose setting bound step `key`, or None when no setting did."""
    if bound is None or bound in NOT_A_SETTING:
        return None
    return _BY_STEP.get((key, bound)) or _BY_CODE.get(bound)

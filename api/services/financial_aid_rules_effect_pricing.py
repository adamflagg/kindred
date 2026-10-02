"""Measures a rules approval's effect (H3): the season priced on the version that priced it before the approval,
then on the one that prices it after, compared by approval_counts. Writes nothing: the decisions service is built
with log_placements=False (no grant-placement rows), and PinnedRules refuses lock_writes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Collection
from datetime import datetime
from typing import Protocol

from api.services.financial_aid_decisions_service import PricingRules, Season
from api.services.financial_aid_rules_effect import ApprovalEffect, approval_counts
from api.services.financial_aid_rules_service import PRICING_SECTIONS, RulesVersion
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.rules import SectionName

SeasonOn = Callable[[PricingRules, int], Awaitable[Season]]


class VersionedRules(PricingRules, Protocol):
    async def load(self, year: int, version: int | None = None) -> RulesVersion: ...


class PinnedRules:
    """PricingRules with the version that prices the season pinned: `latest_approved` for the pricing sections answers
    `pinned`; every other read is the real one. Measuring never locks, so `lock_writes` refuses."""

    def __init__(self, rules: PricingRules, pinned: RulesVersion | None) -> None:
        self._rules = rules
        self._pinned = pinned

    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None:
        if frozenset(sections) == frozenset(PRICING_SECTIONS):
            return self._pinned
        return await self._rules.latest_approved(year, sections)

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        return await self._rules.approved_as_of(year, sections, at)

    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]:
        return await self._rules.approved_as_of_each(year, sections, ats)

    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]:
        raise RuntimeError("measuring an approval's effect never locks")


class SeasonApprovalEffects:
    def __init__(self, rules: VersionedRules, season_on: SeasonOn) -> None:
        self._rules = rules
        self._season_on = season_on

    async def measure(self, year: int, before: int, after: int) -> ApprovalEffect:
        """`before`/`after`: the version pricing the season either side of the approval (0: none). Equal: nothing was
        re-priced, and nothing is priced. Otherwise the season is priced twice, one after the other."""
        if before == after:
            return ApprovalEffect(before, after, 0, 0)
        was_rules = await self._rules.load(year, before) if before else None
        now_rules = await self._rules.load(year, after) if after else None
        was = await self._season_on(PinnedRules(self._rules, was_rules), year)
        now = await self._season_on(PinnedRules(self._rules, now_rules), year)
        repriced, flagged = approval_counts(was.priced, now.priced)
        return ApprovalEffect(before, after, repriced, flagged)

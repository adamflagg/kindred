"""A rules approval's recorded effect (Season › History back-end ask H3). Fictional only."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import fields
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import cast

import pytest

from api.services.financial_aid_decisions_service import PricingRules, Season
from api.services.financial_aid_rules_effect import RULES_EFFECT_ENTITY, ApprovalEffect, approval_counts
from api.services.financial_aid_rules_effect_pricing import PinnedRules, SeasonApprovalEffects
from api.services.financial_aid_rules_service import PRICING_SECTIONS, RulesVersion
from api.services.financial_aid_season_history import ENTITY_KINDS
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.decisions import PricedRequest, RoundStatus, RoundView
from bunking.financial_aid.rules import SectionName
from tests.unit.api.services.decisions_fakes import approved
from tests.unit.bunking.financial_aid.fixtures import app

EMMA, SAMUEL, LIAM = "reqemma00000001", "reqsamuel000001", "reqliam00000001"


def _d(value: str | None) -> Decimal | None:
    return Decimal(value) if value is not None else None


def _view(n: int, status: RoundStatus, *, decided: str | None = None, clawed_back: bool = False) -> RoundView:
    return RoundView(
        round=n,
        status=status,
        ask=None,
        decided=_d(decided),
        locked=_d(decided) if status == "posted" else None,
        accepted=False,
        pending=None,
        counts_toward_budget=True,
        pool="camp_pool",
        clawed_back=clawed_back,
    )


def _priced(request_id: str, *views: RoundView, live: bool = True) -> PricedRequest:
    return PricedRequest(
        request_id=request_id,
        household_cm_id=1000001,
        live=live,
        program_key="summer",
        pool="camp_pool",
        rounds=views,
        holds=(),
        notes=(),
        application=app(),
        inputs=None,
        result=None,
    )


def test_an_unsent_round_whose_amount_moved_is_re_priced_once_per_request() -> None:
    was = {
        EMMA: _priced(EMMA, _view(1, "needs_offer", decided="1420"), _view(2, "needs_offer", decided="300")),
        SAMUEL: _priced(SAMUEL, _view(1, "needs_offer", decided="900")),
    }
    now = {
        EMMA: _priced(EMMA, _view(1, "needs_offer", decided="1380"), _view(2, "needs_offer", decided="310")),
        SAMUEL: _priced(SAMUEL, _view(1, "needs_offer", decided="900")),
    }
    assert approval_counts(was, now) == 1  # Emma once, though two of her rounds moved


def test_a_held_round_that_becomes_priced_is_re_priced() -> None:
    was = {LIAM: _priced(LIAM, _view(1, "held"))}
    now = {LIAM: _priced(LIAM, _view(1, "needs_offer", decided="500"))}
    assert approval_counts(was, now) == 1


def test_a_priced_round_that_becomes_held_is_re_priced() -> None:
    """Either direction counts (the Owner question's default): priced becoming held moved the amount too."""
    was = {LIAM: _priced(LIAM, _view(1, "needs_offer", decided="500"))}
    now = {LIAM: _priced(LIAM, _view(1, "held"))}
    assert approval_counts(was, now) == 1


def test_sent_offers_are_never_counted() -> None:
    """Owner 2026-10-05: posted rounds are history, so an approval counts only the unsent requests it re-priced; no
    sent offer is "flagged" and a round has no "would change by" to flag."""
    assert "flagged" not in {f.name for f in fields(ApprovalEffect)}
    assert "would_change_by" not in {f.name for f in fields(RoundView)}


def test_a_posted_amount_never_re_prices_and_clawed_back_or_closed_requests_count_nowhere() -> None:
    was = {
        EMMA: _priced(EMMA, _view(1, "posted", decided="1500")),
        SAMUEL: _priced(SAMUEL, _view(1, "posted", decided="900", clawed_back=True)),
        LIAM: _priced(LIAM, _view(1, "needs_offer", decided="400"), live=False),
    }
    now = {
        EMMA: _priced(EMMA, _view(1, "posted", decided="1500")),
        SAMUEL: _priced(SAMUEL, _view(1, "posted", decided="900", clawed_back=True)),
        LIAM: _priced(LIAM, _view(1, "needs_offer", decided="450"), live=False),
    }
    assert approval_counts(was, now) == 0


def test_the_logged_effect_is_three_whole_numbers() -> None:
    assert ApprovalEffect(3, 4, 41).log() == {"from_version": 3, "to_version": 4, "repriced": 41}


def test_an_effect_row_is_a_rules_row_in_history() -> None:
    """RBAC: without this mapping the row defaults to "money" and a registrar would see a rules approval."""
    assert ENTITY_KINDS.get(RULES_EFFECT_ENTITY) == "rules"


class _Rules:
    """The rules reads the measurer uses: `load` and the four PricingRules reads (only the pinned one is used)."""

    def __init__(self) -> None:
        self.loads: list[tuple[int, int | None]] = []

    async def load(self, year: int, version: int | None = None) -> RulesVersion:
        self.loads.append((year, version))
        return approved(version=version or 1)

    # Typed exactly like PricingRules (dict and list are invariant), so `_Rules()` is accepted as a VersionedRules.
    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None:
        return approved(version=99)

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        return None

    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]:
        return {}, frozenset()

    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]:
        raise AssertionError("measuring never locks")


def _season_on(priced_by: list[int | None]):  # type: ignore[no-untyped-def]
    async def season_on(pricing: PricingRules, year: int) -> Season:
        pinned = await pricing.latest_approved(year, PRICING_SECTIONS)
        version = pinned.version if pinned is not None else None
        priced_by.append(version)
        decided = "1420" if version == 3 else "1380"
        return cast(Season, SimpleNamespace(priced={EMMA: _priced(EMMA, _view(1, "needs_offer", decided=decided))}))

    return season_on


@pytest.mark.asyncio
async def test_an_approval_that_moved_no_pricing_prices_nothing() -> None:
    priced_by: list[int | None] = []
    effect = await SeasonApprovalEffects(_Rules(), _season_on(priced_by)).measure(2027, 3, 3)
    assert (effect, priced_by) == (ApprovalEffect(3, 3, 0), [])


@pytest.mark.asyncio
async def test_the_season_is_priced_on_the_old_version_then_the_new_one() -> None:
    priced_by: list[int | None] = []
    rules = _Rules()
    effect = await SeasonApprovalEffects(rules, _season_on(priced_by)).measure(2027, 3, 4)
    assert effect == ApprovalEffect(3, 4, 1)
    assert priced_by == [3, 4]
    assert rules.loads == [(2027, 3), (2027, 4)]


@pytest.mark.asyncio
async def test_a_season_no_rules_priced_before_is_priced_on_none() -> None:
    priced_by: list[int | None] = []
    await SeasonApprovalEffects(_Rules(), _season_on(priced_by)).measure(2027, 0, 1)
    assert priced_by == [None, 1]


@pytest.mark.asyncio
async def test_pinned_rules_answer_only_the_pricing_read_and_never_lock() -> None:
    pinned = PinnedRules(_Rules(), approved(version=3))
    assert (await pinned.latest_approved(2027, PRICING_SECTIONS)).version == 3  # type: ignore[union-attr]
    assert (await pinned.latest_approved(2027, ("programs", "cost"))).version == 99  # type: ignore[union-attr]
    with pytest.raises(RuntimeError, match="never locks"):
        await pinned.lock_writes(2027, 3, cast(list[SectionName], ["budget"]))

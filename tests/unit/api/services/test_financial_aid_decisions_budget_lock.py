"""Round 1's real post and the budget total's lock (owner 10-06 (b); coordinator correction 10-06 late).

`ROUND_SECTIONS` leaves `budget` out on purpose (D119), so a Posted tick never locks the budget section. The total's
lock must therefore follow the Round 1 sections the tick DOES lock. This posts a tick through the real decisions
service and the real rules service (no stand-in `lock_section`), then saves the budget. Fictional only."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_rules_service import (
    BUDGET_TOTAL_LOCKED,
    BudgetTotalLockedError,
    FinancialAidRulesService,
)
from bunking.financial_aid.rules.schema import SECTION_NAMES
from tests.unit.api.services.decisions_fakes import ACTOR, EMMA, FakeDecisionsStore, seed_request, tick
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules

T0 = datetime(2027, 3, 9, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


class _Capturing:
    """The real rules service, remembering the lock writes the decisions service asks it for."""

    def __init__(self, inner: FinancialAidRulesService) -> None:
        self._inner = inner
        self.locks: list[Any] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def lock_writes(self, year: int, version: int, sections: Any) -> Any:
        writes, not_locked = await self._inner.lock_writes(year, version, sections)
        self.locks.extend(writes)
        return writes, not_locked


async def _season_with_round_one_posted() -> FinancialAidRulesService:
    """2027 rules, every section approved; EMMA's Round 1 ticked Posted through the real tick, and the rules locks it
    wrote applied to the rules store (the decisions fake only records them)."""
    rules_store = FakeStore()
    rules = FinancialAidRulesService(rules_store, clock=lambda: T0)
    await rules.create_version(intake_rules(), actor=FINANCE)
    await rules.approve_sections(YEAR, 1, list(SECTION_NAMES), actor=FINANCE, note="Board")
    capture = _Capturing(rules)
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    record = next(iter(rules_store.rows))
    store.rules_revision[record.id] = record.revision

    async def no_register(year: int) -> list[Any]:
        return []

    service = FinancialAidDecisionsService(store, capture, no_register, clock=lambda: T0)
    out = await service.tick_posted(YEAR, tick((EMMA, 1, "1500")), ACTOR)
    assert out.sections_not_locked == []
    await rules_store.commit(capture.locks, actor=ACTOR)
    return rules


def _budget(**changes: object) -> dict[str, object]:
    return fictional_rules().budget.model_dump(mode="json") | changes


def _new_split() -> dict[str, dict[str, str]]:
    shares = {"camp_pool": "75", "weekend_pool": "20", "bmitzvah_pool": "5"}
    pools = fictional_rules().budget.pools
    return {key: {"label": pools[key].label, "share_pct": share} for key, share in shares.items()}


@pytest.mark.asyncio
async def test_a_round_one_post_leaves_the_budget_section_unlocked_but_locks_its_total() -> None:
    rules = await _season_with_round_one_posted()
    assert (await rules.load(YEAR)).section_status["budget"].state == "approved"  # D119: a tick never locks it
    assert (await rules.draft_view(YEAR)).budget_total_locked is True
    with pytest.raises(BudgetTotalLockedError, match=rf"^{re.escape(BUDGET_TOTAL_LOCKED)}$"):
        await rules.save_section(YEAR, 1, "budget", _budget(total="520000"), actor=FINANCE)


@pytest.mark.asyncio
async def test_after_a_real_round_one_post_a_shares_only_budget_save_passes() -> None:
    rules = await _season_with_round_one_posted()
    saved = await rules.save_section(YEAR, 1, "budget", _budget(pools=_new_split()), actor=FINANCE)
    budget = saved.version.document.budget
    assert (budget.total, budget.pools["camp_pool"].share_pct) == (fictional_rules().budget.total, Decimal(75))

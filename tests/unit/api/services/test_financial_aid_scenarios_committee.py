"""What the committee compares (sub-project 9c; spec §7.4, §9.7 RPT-17, RPT-18, RPT-32; D132) through the scenarios
service, with real pricing over a frozen fictional season (decisions_fakes): Emma's family has 60,000 (tier 2: 75% of
2,000 = 1,500) and Liam's 90,000 (tier 3: 55% = 1,100), each asking 4,000; the total budget is 500,000.

Last season (2026) is a second fake store: Emma's Round 1 was posted at 1,500 (tier 2 at the lock) and her 400
appeal at 300, Liam's Round 1 at 1,100 (tier 3), and Riley's request was never posted; every lock is dated Mar 9
(T0). Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_SCENARIO_OPTIONS
from api.services import financial_aid_scenarios_repository as repository_module
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_rules_service import FinancialAidRulesService
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, capture_season
from api.services.financial_aid_scenarios_service import FinancialAidScenariosService
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.rules import AidRules
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.api.services.scenarios_fakes import FakeScenarioStore
from tests.unit.bunking.financial_aid.fixtures import with_levers

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
RILEY = "reqrile00000001"
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"
LAST = YEAR - 1


@pytest.fixture(autouse=True)
def _fresh_decoded_cache() -> None:
    repository_module.clear_decoded_cache()


@dataclass
class World:
    service: FinancialAidScenariosService
    store: FakeScenarioStore
    rules: FinancialAidRulesService
    last_season_reads: list[int]


def _post(event_id: str, request_id: str, round_: int, amount: str, tier: int) -> DecisionEvent:
    return DecisionEvent(
        id=event_id,
        request_id=request_id,
        round=round_,
        kind="post",
        created=T0,
        amount=Decimal(amount),
        effective_on=date(LAST, 3, 9),
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True, "result": {"final_tier": tier}},
    )


def _last_season(*, posted: bool) -> FakeDecisionsStore:
    """Last season, seeded with the 2027 fixtures and moved to 2026 (the fakes seed one season)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021, income=90000.0)
    seed_request(store, RILEY, household=1000003, person=1000031)
    store.applications = [replace(a, year=LAST) for a in store.applications]
    store.requests = {rid: replace(r, year=LAST) for rid, r in store.requests.items()}
    store.shares = [replace(s, year=LAST) for s in store.shares]
    if posted:
        store.events += [
            _post("ev0000000000001", EMMA, 1, "1500", 2),
            _post("ev0000000000002", LIAM, 1, "1100", 3),
            DecisionEvent(
                id="ev0000000000003",
                request_id=EMMA,
                round=2,
                kind="ask",
                created=T0,
                amount=Decimal(400),
                effective_on=date(LAST, 4, 1),
            ),
            _post("ev0000000000004", EMMA, 2, "300", 2),
        ]
    return store


def last_season_rules() -> AidRules:
    """2026's rules: the camp table gave tier 2 80%, not 75%."""
    return with_levers(intake_rules(), {"year": LAST, "award_tables.camp.tiers.2.r1_pct": "80"})


async def _world(*, last_posted: bool = True, this_season: AidRules | None = None) -> World:
    """`this_season`: 2027's v1 (every section draft); intake_rules() by default."""
    season = FakeDecisionsStore()
    seed_request(season, EMMA)
    seed_request(season, LIAM, household=1000002, person=1000021, income=90000.0)
    rules = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    await rules.create_version(this_season or intake_rules(), actor=FINANCE)
    last_store = _last_season(posted=last_posted)
    reads: list[int] = []

    async def register(year: int) -> Sequence[RegisterRow]:
        return ()

    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(season, register, FakeRules(approved()), year)

    async def season_read(year: int) -> Season:
        reads.append(year)
        service = FinancialAidDecisionsService(last_store, FakeRules(approved(last_season_rules())), register)
        return await service.season(year)

    store = FakeScenarioStore()
    service = FinancialAidScenariosService(store, rules, capture, season_read=season_read)
    return World(service, store, rules, reads)


async def _started(**kwargs: Any) -> World:
    world = await _world(**kwargs)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)
    return world


# --- RPT-17 / RPT-32: each column's tables ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compare_carries_each_columns_round1_by_tier_and_its_share_of_the_budget() -> None:
    world = await _started()
    comparison = await world.service.compare(YEAR, FINANCE, ["A"])
    for column in comparison.columns:
        assert column.committee is not None
        assert (column.committee.budget_total, column.committee.round1) == (Decimal(500000), Decimal(2600))
        assert column.committee.round1_pct_of_budget == Decimal("0.5")  # 2,600 of 500,000
        rows = [
            (r.table, r.tier, r.requests, r.asked, r.fee_pct, r.pct_of_ask, r.round1, r.average_round1)
            for r in column.committee.round1_by_tier
        ]
        assert rows == [
            ("camp", 2, 1, Decimal(4000), Decimal(75), Decimal("37.5"), Decimal(1500), Decimal("1500.00")),
            ("camp", 3, 1, Decimal(4000), Decimal(55), Decimal("27.5"), Decimal(1100), Decimal("1100.00")),
            (None, 2, 1, Decimal(4000), None, Decimal("37.5"), Decimal(1500), Decimal("1500.00")),  # All
            (None, 3, 1, Decimal(4000), None, Decimal("27.5"), Decimal(1100), Decimal("1100.00")),
        ]


@pytest.mark.asyncio
async def test_each_columns_fee_percent_is_its_own_documents() -> None:
    world = await _started()
    draft = with_levers(intake_rules(), {"award_tables.camp.tiers.2.r1_pct": "80"})
    await world.service.save_draft(YEAR, draft, FINANCE)
    comparison = await world.service.compare(YEAR, FINANCE, ["A"])
    mine, kept = comparison.columns
    assert mine.committee is not None
    assert kept.committee is not None
    assert (mine.committee.round1_by_tier[0].fee_pct, mine.committee.round1_by_tier[0].round1) == (
        Decimal(80),
        Decimal(1600),
    )
    assert (kept.committee.round1_by_tier[0].fee_pct, kept.committee.round1_by_tier[0].round1) == (
        Decimal(75),
        Decimal(1500),
    )


@pytest.mark.asyncio
async def test_an_option_kept_before_sp9c_is_priced_again_for_its_committee_rows() -> None:
    world = await _started()
    [row] = world.store.rows[AID_SCENARIO_OPTIONS]
    sp9c = {"by_table", "round2_by_tier", "round2_not_in_tiers", "round2_allocated", "round2_remaining"}
    stored = {key: value for key, value in row.results.items() if key not in sp9c | {"committee_rows"}}
    stored["by_tier"] = [{k: v for k, v in tier.items() if k != "asked"} for tier in stored["by_tier"]]
    row.results = stored  # as SP9b stored it
    comparison = await world.service.compare(YEAR, FINANCE, ["A"])
    kept = comparison.columns[1]
    assert kept.results.committee_rows
    assert kept.committee is not None
    assert [(r.table, r.tier, r.asked) for r in kept.committee.round1_by_tier][:2] == [
        ("camp", 2, Decimal(4000)),
        ("camp", 3, Decimal(4000)),
    ]

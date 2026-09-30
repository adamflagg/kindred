"""Campership scenarios (sub-project 9b; spec §7.4; D35–D39): freezing, the per-person draft, the trail, keeping in
two levels, compare, fit to budget, the one-step sensitivity, and making a kept option the rules draft.

Real pricing over a frozen fictional season (decisions_fakes): Emma's family has 60,000 (tier 2, Round 1 1,500) and
Liam's 90,000 (tier 3, 1,100), so Round 1 is 2,600; +5 points makes it 2,800. Round 1's allocation is 440,000.
Rules and scenarios live in memory, and every write runs 4a's real helper."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import Decimal

import pytest

from api.services import financial_aid_scenarios_repository as repository_module
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES
from api.services.financial_aid_rules_service import FinancialAidRulesService
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, capture_season
from api.services.financial_aid_scenarios_service import (
    FinancialAidScenariosService,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioRefusedError,
)
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.scenarios import shift_round1_tables, with_minimum
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.api.services.scenarios_fakes import FakeScenarioStore
from tests.unit.bunking.financial_aid.fixtures import with_lever

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
RILEY = "reqrile00000001"
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"


@pytest.fixture(autouse=True)
def _fresh_decoded_cache() -> None:
    repository_module.clear_decoded_cache()


@dataclass
class World:
    service: FinancialAidScenariosService
    store: FakeScenarioStore
    season: FakeDecisionsStore
    rules: FinancialAidRulesService


async def _world(rows: Sequence[RegisterRow] = ()) -> World:
    """`rows`: the grants register the season prices with."""
    season = FakeDecisionsStore()
    seed_request(season, EMMA)
    seed_request(season, LIAM, household=1000002, person=1000021, income=90000.0)
    rules = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    await rules.create_version(intake_rules(), actor=FINANCE)  # 2027 v1, every section draft

    async def register(year: int) -> Sequence[RegisterRow]:
        return rows

    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(season, register, FakeRules(approved()), year)

    store = FakeScenarioStore()
    return World(FinancialAidScenariosService(store, rules, capture), store, season, rules)


async def _started() -> World:
    """Frozen, and FINANCE started from the rules: option A, and FINANCE's draft from A."""
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)
    return world


def _shifted(document: AidRules, points: str) -> AidRules:
    return shift_round1_tables(document, Decimal(points))


def _add_riley(world: World) -> None:
    seed_request(world.season, RILEY, household=1000003, person=1000031)


# --- freeze and start ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_freezing_records_the_season_and_logs_it_light() -> None:
    world = await _world()
    frozen = await world.service.freeze(YEAR, FINANCE)
    assert (frozen.requests, frozen.actor) == (2, FINANCE)
    [row] = world.store.log
    assert (row["entity"], row["action"], row["after"]) == (
        "aid_scenario_snapshots",
        "freeze",
        {"requests": 2, "awaiting_rules": 0},
    )


@pytest.mark.asyncio
async def test_freezing_an_unchanged_season_writes_nothing() -> None:
    world = await _world()
    first = await world.service.freeze(YEAR, FINANCE)
    again = await world.service.freeze(YEAR, TREASURER)
    assert again.id == first.id
    assert len(world.store.operations) == 1


@pytest.mark.asyncio
async def test_a_season_that_moved_freezes_anew() -> None:
    world = await _world()
    first = await world.service.freeze(YEAR, FINANCE)
    _add_riley(world)
    second = await world.service.freeze(YEAR, FINANCE)
    assert (second.id != first.id, second.requests) == (True, 3)


@pytest.mark.asyncio
async def test_a_season_frozen_before_its_rules_are_approved_holds_those_requests_and_says_how_many() -> None:
    world = await _world()
    flag = {"code": FLAG_AWAITING_RULES, "detail": {"sections": ["programs", "cost"]}}
    world.season.requests[LIAM] = replace(world.season.requests[LIAM], flags=(flag,))
    frozen = await world.service.freeze(YEAR, FINANCE)
    assert (frozen.requests, frozen.awaiting_rules) == (2, 1)
    # Held under any document until the season is frozen again after approval (plan Decision 8): +5 points moves
    # only Emma's Round 1 (1,500 -> 1,600).
    evaluation = await world.service.evaluate(YEAR, shift_round1_tables(intake_rules(), Decimal(5)))
    assert (evaluation.results.held, evaluation.results.round1) == (1, Decimal(1600))


@pytest.mark.asyncio
async def test_nothing_runs_before_the_applications_are_frozen() -> None:
    world = await _world()
    with pytest.raises(ScenarioRefusedError, match="Freeze"):
        await world.service.start_from_rules(YEAR, FINANCE)


@pytest.mark.asyncio
async def test_starting_from_the_rules_keeps_a_and_puts_it_in_my_draft() -> None:
    world = await _started()
    workspace = await world.service.workspace(YEAR, FINANCE)
    [a] = workspace.options
    assert (a.record.code, a.record.starting_point, a.record.from_code, a.record.origin_version) == ("A", "", "", 1)
    assert (a.label, a.stale, a.record.results.round1) == ("rules v1 as they were", False, Decimal(2600))
    assert workspace.draft is not None
    assert (workspace.draft.from_code, workspace.draft.label, workspace.rules_version) == ("A", "no changes", 1)


@pytest.mark.asyncio
async def test_starting_from_unchanged_rules_again_loads_a_rather_than_copy_it() -> None:
    world = await _started()
    await world.service.start_from_rules(YEAR, TREASURER)
    workspace = await world.service.workspace(YEAR, TREASURER)
    assert [o.record.code for o in workspace.options] == ["A"]
    assert workspace.draft is not None
    assert workspace.draft.from_code == "A"


# --- the draft and the trail --------------------------------------------------------------------------


async def _a(world: World) -> AidRules:
    return (await world.service.workspace(YEAR, FINANCE)).options[0].record.document


@pytest.mark.asyncio
async def test_releasing_a_setting_records_a_trail_row_with_its_results() -> None:
    world = await _started()
    draft = await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    assert (draft.from_code, draft.label) == ("A", "Round 1 % +5 pts")
    assert draft.results is not None
    assert draft.results.round1 == Decimal(2800)
    assert {c.path[0] for c in draft.changes} == {"award_tables"}
    rows, total = await world.service.trail(YEAR, page=1, per_page=50)
    assert (total, rows[0].change, rows[0].actor) == (2, "Round 1 % +5 pts", FINANCE)


@pytest.mark.asyncio
async def test_releasing_the_same_settings_twice_records_once() -> None:
    world = await _started()
    a = await _a(world)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    assert (await world.service.trail(YEAR, page=1, per_page=50))[1] == 2


@pytest.mark.asyncio
async def test_the_draft_is_per_person() -> None:
    world = await _started()
    assert (await world.service.workspace(YEAR, TREASURER)).draft is None
    with pytest.raises(ScenarioRefusedError, match="Load"):
        await world.service.save_draft(YEAR, intake_rules(), TREASURER)


@pytest.mark.asyncio
async def test_loading_an_option_or_an_old_row_never_loses_the_draft() -> None:
    world = await _started()
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    loaded = await world.service.load(YEAR, FINANCE, option="A")
    assert (loaded.from_code, loaded.label) == ("A", "no changes")
    rows, total = await world.service.trail(YEAR, page=1, per_page=50)
    assert (total, rows[0].change) == (3, "loaded A into the draft")
    back = await world.service.load(YEAR, FINANCE, trail_row=rows[1].id)
    assert back.label == "Round 1 % +5 pts"
    newest, _ = await world.service.trail(YEAR, page=1, per_page=1)
    assert newest[0].change.startswith(f"loaded {FINANCE}'s row of ")


@pytest.mark.asyncio
async def test_loading_needs_exactly_one_thing_that_exists() -> None:
    world = await _started()
    with pytest.raises(ScenarioRefusedError):
        await world.service.load(YEAR, FINANCE)
    with pytest.raises(ScenarioNotFoundError):
        await world.service.load(YEAR, FINANCE, option="Q")
    with pytest.raises(ScenarioNotFoundError):
        await world.service.load(YEAR, FINANCE, trail_row="trl000000000999")


@pytest.mark.asyncio
async def test_evaluate_applies_the_sizing_settings_and_writes_nothing() -> None:
    world = await _started()
    before = len(world.store.operations)
    evaluation = await world.service.evaluate(YEAR, intake_rules(), tier_shift=Decimal(5))
    assert evaluation.results.round1 == Decimal(2800)
    assert evaluation.document.award_tables["camp"].tiers[1].r1_pct == Decimal(95)
    assert len(world.store.operations) == before


@pytest.mark.asyncio
async def test_scenarios_hold_still_while_the_season_moves() -> None:
    world = await _started()
    _add_riley(world)
    assert (await world.service.evaluate(YEAR, intake_rules())).results.requests == 2


@pytest.mark.asyncio
async def test_a_document_for_another_season_is_refused() -> None:
    world = await _started()
    with pytest.raises(ScenarioRefusedError, match="2026"):
        await world.service.evaluate(YEAR, with_lever(intake_rules(), "year", 2026))


# --- keep ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keeping_lands_variants_under_their_starting_point_two_levels_deep() -> None:
    world = await _started()
    service, a = world.service, await _a(world)
    await service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    a1 = await service.keep(YEAR, FINANCE, starting_point=False)
    await service.save_draft(YEAR, _shifted(a, "10"), FINANCE)
    a2 = await service.keep(YEAR, FINANCE, starting_point=False)
    await service.save_draft(YEAR, with_minimum(_shifted(a, "10"), Decimal(150)), FINANCE)
    b = await service.keep(YEAR, FINANCE, starting_point=True)
    await service.save_draft(YEAR, with_minimum(_shifted(a, "10"), Decimal(175)), FINANCE)
    b1 = await service.keep(YEAR, FINANCE, starting_point=False)
    kept = [(k.record.code, k.record.starting_point, k.record.from_code) for k in (a1, a2, b, b1)]
    assert kept == [("A1", "A", "A"), ("A2", "A", "A1"), ("B", "", "A2"), ("B1", "B", "B")]
    assert (a1.label, a2.label) == ("Round 1 % +5 pts", "Round 1 % +10 pts")
    assert (b.label, b1.label) == ("Round 1 % +10 pts · minimum $150", "minimum $175")
    draft = (await service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert (draft.from_code, draft.label) == ("B1", "no changes")


@pytest.mark.asyncio
async def test_keeping_a_draft_that_matches_a_kept_option_is_refused() -> None:
    world = await _started()
    with pytest.raises(ScenarioConflictError, match="same as A"):
        await world.service.keep(YEAR, FINANCE, starting_point=False)


@pytest.mark.asyncio
async def test_a_keep_is_one_operation_and_its_log_carries_no_document() -> None:
    world = await _started()
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE, starting_point=False)
    option_row, trail_row = world.store.log[-2:]
    assert (option_row["entity"], option_row["entity_id"], option_row["action"]) == (
        "aid_scenario_options",
        f"{YEAR}:A1",
        "keep",
    )
    assert (trail_row["entity"], trail_row["after"]) == ("aid_scenario_trail", {"kept_code": "A1"})
    assert option_row["operation_id"] == trail_row["operation_id"]
    assert "document" not in option_row["after"]

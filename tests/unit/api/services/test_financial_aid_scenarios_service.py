"""Campership scenarios (sub-project 9b; spec §7.4; D35–D39): freezing, the per-person draft, the trail, keeping in
two levels, compare, fit to budget, the one-step sensitivity, and making a kept option the rules draft.

Real pricing over a frozen fictional season (decisions_fakes): Emma's family has 60,000 (tier 2, Round 1 1,500) and
Liam's 90,000 (tier 3, 1,100), so Round 1 is 2,600; +5 points makes it 2,800. Round 1's allocation is 440,000.
Rules and scenarios live in memory, and every write runs 4a's real helper."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from api.constants.collections import AID_REQUESTS, AID_SCENARIO_SNAPSHOTS
from api.services import financial_aid_scenarios_repository as repository_module
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES
from api.services.financial_aid_rules_service import FinancialAidRulesService
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, capture_season
from api.services.financial_aid_scenarios_service import (
    FinancialAidScenariosService,
    RequestSetChoice,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioRefusedError,
)
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.financial_aid.scenarios import RequestSetNote, shift_round1_tables, with_minimum
from tests.unit.api.services.decisions_fakes import (
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    log_seeded,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.api.services.scenarios_fakes import FakeScenarioStore
from tests.unit.bunking.financial_aid.fixtures import with_lever, with_levers

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
async def test_a_season_whose_only_move_is_the_ledger_sync_time_writes_nothing() -> None:
    world = await _world()
    world.season.synced_at = T0
    first = await world.service.freeze(YEAR, FINANCE)
    world.season.synced_at = T0 + timedelta(hours=6)  # a later sync that brought nothing new
    again = await world.service.freeze(YEAR, FINANCE)
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
async def test_a_stored_season_this_code_cant_read_is_refused_and_freezing_replaces_it() -> None:
    world = await _started()
    [row] = world.store.rows[AID_SCENARIO_SNAPSHOTS]
    row.inputs = {key: value for key, value in row.inputs.items() if key != "live"}  # a required key dropped
    with pytest.raises(SnapshotError, match="freeze the applications again"):
        await world.service.evaluate(YEAR, intake_rules())
    frozen = await world.service.freeze(YEAR, FINANCE)  # an unreadable latest counts as "the season moved"
    assert frozen.id != row.id
    assert len(world.store.rows[AID_SCENARIO_SNAPSHOTS]) == 2
    assert (await world.service.evaluate(YEAR, intake_rules())).results.round1 == Decimal(2600)


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
    # 2027 v1 is every section a draft here: it prices nothing yet, so it is "rules draft v1" (final review 8).
    assert (a.label, a.stale, a.record.results.round1) == ("rules draft v1 as they were", False, Decimal(2600))
    assert workspace.draft is not None
    assert (workspace.draft.from_code, workspace.draft.label, workspace.rules_version) == ("A", "no changes", 1)
    assert workspace.pricing_version is None
    rows, _ = await world.service.trail(YEAR, page=1, per_page=50)
    assert rows[0].change == "started from rules draft v1"


@pytest.mark.asyncio
async def test_starting_from_unchanged_rules_again_loads_a_rather_than_copy_it() -> None:
    world = await _started()
    await world.service.start_from_rules(YEAR, TREASURER)
    workspace = await world.service.workspace(YEAR, TREASURER)
    assert [o.record.code for o in workspace.options] == ["A"]
    assert workspace.draft is not None
    assert workspace.draft.from_code == "A"


@pytest.mark.asyncio
async def test_a_starting_point_says_rules_only_for_rules_that_price_the_season() -> None:
    """Final review 8. v1 approved prices the season: "rules v1". A later v2 draft that changes the minimum is a
    new starting point (its lineage starts at v2) labelled "rules draft v2", while A keeps "rules v1"."""
    world = await _world()
    await world.rules.approve_sections(YEAR, 1, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    await world.service.freeze(YEAR, FINANCE)
    started = await world.service.start_from_rules(YEAR, FINANCE)
    assert ([o.label for o in started.options], started.pricing_version) == (["rules v1 as they were"], 1)
    await world.rules.create_version(with_minimum(intake_rules(), Decimal(150)), actor=FINANCE)
    later = await world.service.start_from_rules(YEAR, TREASURER)
    labels = [(o.record.code, o.record.origin_version, o.label) for o in later.options]
    assert labels == [("A", 1, "rules v1 as they were"), ("B", 2, "rules draft v2 as they were")]
    assert (later.rules_version, later.pricing_version) == (2, 1)
    rows, _ = await world.service.trail(YEAR, page=1, per_page=50)
    assert [r.change for r in rows] == ["started from rules draft v2", "started from rules v1"]


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


# --- compare, fit, sensitivity ------------------------------------------------------------------------


async def _kept_a1(world: World) -> AidRules:
    """FINANCE shifts A by +5 and keeps it: A1. Returns A's document."""
    a = await _a(world)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE, starting_point=False)
    return a


@pytest.mark.asyncio
async def test_compare_puts_the_draft_first_beside_the_ticked_options() -> None:
    world = await _started()
    a = await _kept_a1(world)
    await world.service.save_draft(YEAR, _shifted(a, "10"), FINANCE)
    comparison = await world.service.compare(YEAR, FINANCE, ["A", "A1", "A"])
    assert [c.code for c in comparison.columns] == ["draft", "A", "A1"]
    draft, first, variant = comparison.columns
    assert (draft.label, draft.up, draft.down) == ("Round 1 % +5 pts", 2, 0)
    assert (first.label, first.up, first.down) == ("rules draft v1 as they were", None, None)  # v1 prices nothing
    assert (variant.label, variant.up, variant.down, variant.results.round1) == (
        "Round 1 % +5 pts",
        2,
        0,
        Decimal(2800),
    )
    assert {c.path[0] for c in variant.changes} == {"award_tables"}


@pytest.mark.asyncio
async def test_compare_takes_at_most_four_options_that_exist() -> None:
    world = await _started()
    with pytest.raises(ScenarioRefusedError, match="up to 4"):
        await world.service.compare(YEAR, FINANCE, ["A", "B", "C", "D", "E"])
    with pytest.raises(ScenarioNotFoundError, match="Q"):
        await world.service.compare(YEAR, FINANCE, ["Q"])


@pytest.mark.asyncio
async def test_an_option_kept_on_an_older_snapshot_is_repriced_for_compare_but_keeps_its_figures() -> None:
    world = await _started()
    _add_riley(world)
    await world.service.freeze(YEAR, FINANCE)
    workspace = await world.service.workspace(YEAR, FINANCE)
    assert workspace.options[0].stale
    _, a = (await world.service.compare(YEAR, FINANCE, ["A"])).columns
    assert (a.results.requests, a.results.round1) == (3, Decimal(4100))
    assert workspace.options[0].record.results.round1 == Decimal(2600)


@pytest.mark.asyncio
async def test_fit_to_budget_uses_the_pools_summed_round1_remaining_and_names_the_tightest_pool() -> None:
    world = await _started()
    # Budget 3,000: Round 1's allocations are Camp 2,040 (after its reserves), Weekends 450 and B'mitzvah 150, so
    # 2,640 in all. Both requests are Camp's, spending 2,600 at no shift, and each point adds 40: +1 spends 2,640.
    # Camp alone is then 600 over; it is named, not enforced (D119: only the total is hard).
    fitted = await world.service.fit(YEAR, with_lever(intake_rules(), "budget.total", "3000"))
    assert (fitted.fit.kind, fitted.fit.shift, fitted.tightest_pool) == ("fits", Decimal(1), "camp_pool")
    results = fitted.evaluation.results
    pools = {p.pool: p for p in results.pools}
    assert (results.round1, results.round1_remaining) == (Decimal(2640), Decimal("0.00"))
    assert pools["camp_pool"].round1_remaining == Decimal("-600.00")
    assert fitted.evaluation.document.award_tables["camp"].tiers[2].r1_pct == Decimal(76)


@pytest.mark.asyncio
async def test_fit_reads_no_spillover_setting() -> None:
    world = await _started()
    shared = with_levers(intake_rules(), {"budget.total": "3000", "budget.spillover": "shared"})
    fitted = await world.service.fit(YEAR, shared)
    assert (fitted.fit.kind, fitted.fit.shift, fitted.tightest_pool) == ("fits", Decimal(1), "camp_pool")


@pytest.mark.asyncio
async def test_fit_says_when_even_the_lowest_shift_is_over() -> None:
    world = await _started()
    fitted = await world.service.fit(YEAR, with_lever(intake_rules(), "budget.total", "100"))
    assert (fitted.fit.kind, fitted.fit.shift, fitted.tightest_pool) == ("over_at_lowest", Decimal(-100), "camp_pool")


@pytest.mark.asyncio
async def test_fit_never_moves_a_posted_round1() -> None:
    world = await _world()
    world.season.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=T0,
            amount=Decimal(1400),
            effective_on=date(2027, 3, 9),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    await world.service.freeze(YEAR, FINANCE)
    # Emma's Round 1 stays at its 1,400 lock under every shift; only Liam's 1,100 moves, 20 a point. The 2,640 Round 1
    # allocation leaves 140 for him: +7. Were Emma's money moving too, the fit would stop at +1.
    fitted = await world.service.fit(YEAR, with_lever(intake_rules(), "budget.total", "3000"))
    assert (fitted.fit.kind, fitted.fit.shift, fitted.evaluation.results.round1) == ("fits", Decimal(7), Decimal(2640))


@pytest.mark.asyncio
async def test_money_on_a_program_with_no_pool_counts_against_the_fit() -> None:
    world = await _started()
    # Summer has no pool here, so both requests are "No pool" money: no allocation of its own, but it spends the
    # budget. The fit still stops at +1 (2,600 + 2 x 20 = 2,640), not at the highest shift.
    no_pool = with_levers(intake_rules(), {"budget.total": "3000", "programs.summer.budget_pool": None})
    fitted = await world.service.fit(YEAR, no_pool)
    pools = {p.pool: p for p in fitted.evaluation.results.pools}
    assert (fitted.fit.kind, fitted.fit.shift) == ("fits", Decimal(1))
    assert (pools[""].round1, pools[""].round1_allocated) == (Decimal(2640), None)
    assert fitted.tightest_pool == "bmitzvah_pool"


@pytest.mark.asyncio
async def test_one_step_of_each_sizing_setting() -> None:
    # A 250 outside grant on Emma's request. Dollar-for-dollar (the default) takes it off her award: 1,500 - 250 =
    # 1,250. Flipped to reduce_cost_basis it comes off the cost instead: (2,000 - 250) x 75% = 1,312.50, which the
    # rules round half up to 1,313: +63.
    world = await _world(rows=[grant_row(EMMA, "250")])
    await world.service.freeze(YEAR, FINANCE)
    sensitivity = await world.service.sensitivity(YEAR, intake_rules())
    assert sensitivity.results.round1 == Decimal(2350)
    assert [(e.lever.key, e.round1_change, e.on) for e in sensitivity.effects] == [
        ("tier_shift", Decimal(40), None),
        ("minimum", Decimal(0), None),
        ("band_width", Decimal(0), None),
        ("dollar_for_dollar", Decimal(63), True),
    ]


@pytest.mark.asyncio
async def test_the_trail_is_shared_and_newest_first() -> None:
    world = await _started()
    await _kept_a1(world)
    await world.service.load(YEAR, TREASURER, option="A1")
    rows, total = await world.service.trail(YEAR, page=1, per_page=2)
    assert total == 3
    assert [(r.actor, r.change) for r in rows] == [
        (TREASURER, "loaded A1 into the draft"),
        (FINANCE, "Round 1 % +5 pts"),
    ]
    assert (rows[1].kept_code, rows[0].document) == ("A1", None)


# --- make it the rules draft --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_making_a_kept_option_the_rules_draft() -> None:
    world = await _started()
    await _kept_a1(world)
    preview = await world.service.rules_draft_preview(YEAR, "A1")
    assert ([s.section for s in preview.sections], preview.base_version) == (["award_tables"], 1)
    draft, branched_from = await world.service.make_rules_draft(
        YEAR, "A1", base_version=1, acknowledged={}, actor=FINANCE
    )
    assert (branched_from, draft.version.version) == (None, 1)  # 2027 v1 is not approved yet: saved in place
    status = draft.version.section_status["award_tables"]
    assert (status.edited_by, status.edited_via) == (FINANCE, "A1")
    assert draft.version.document.award_tables["camp"].tiers[1].r1_pct == Decimal(95)


@pytest.mark.asyncio
async def test_an_unknown_option_is_not_found() -> None:
    world = await _started()
    with pytest.raises(ScenarioNotFoundError):
        await world.service.rules_draft_preview(YEAR, "Z9")


# --- the request set (D138) ----------------------------------------------------------------------------

JAN20 = datetime(2027, 1, 20, 18, 0, tzinfo=UTC)


async def _late_world(riley_received: datetime | None, *, riley_status: str = "active") -> World:
    """Emma's and Liam's requests were first recorded on Jan 20; Riley's at `riley_received` (None: no create row)."""
    world = await _world()
    log_seeded(world.season, JAN20)
    seed_request(world.season, RILEY, household=1000003, person=1000031, status=riley_status)
    if riley_received is not None:
        world.season.change_log.append(
            LogRow(
                id="log000000000099",
                entity=AID_REQUESTS,
                entity_id=RILEY,
                before=None,
                after={"year": YEAR, "household_cm_id": 1000003},
                created=riley_received,
            )
        )
    await world.service.freeze(YEAR, FINANCE)
    return world


@pytest.mark.asyncio
async def test_a_request_set_prices_only_requests_received_through_the_date_and_labels_them() -> None:
    world = await _late_world(datetime(2027, 2, 10, 18, 0, tzinfo=UTC))
    everyone = await world.service.evaluate(YEAR, intake_rules())
    assert (everyone.results.requests, everyone.results.round1, everyone.results.request_set) == (
        3,
        Decimal(4100),
        None,
    )
    through = await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 2, 1))
    assert (through.results.requests, through.results.round1) == (2, Decimal(2600))
    assert through.results.request_set == RequestSetNote(
        basis="date", through=date(2027, 2, 1), label="requests received through Feb 1, 2027", left_out=1, unknown=0
    )


@pytest.mark.asyncio
async def test_the_date_is_a_whole_camp_time_day() -> None:
    world = await _late_world(datetime(2027, 2, 2, 7, 30, tzinfo=UTC))  # 11:30 pm on Feb 1, Pacific
    assert (await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 2, 1))).results.requests == 3
    assert (await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 1, 31))).results.requests == 2


@pytest.mark.asyncio
async def test_through_the_round1_deadline_reads_the_approved_application_deadline() -> None:
    world = await _late_world(datetime(2027, 2, 10, 18, 0, tzinfo=UTC))
    version = await world.rules.create_version(
        with_lever(intake_rules(), "milestones.application_deadline", "2027-02-01"), actor=FINANCE
    )
    await world.rules.approve_sections(YEAR, version.version, ["milestones"], actor=TREASURER, note="Finance committee")
    evaluation = await world.service.evaluate(YEAR, intake_rules(), request_set="round1_deadline")
    assert evaluation.results.request_set is not None
    assert (evaluation.results.request_set.basis, evaluation.results.request_set.through) == (
        "round1_deadline",
        date(2027, 2, 1),
    )
    assert evaluation.results.requests == 2


@pytest.mark.asyncio
async def test_the_round1_deadline_is_never_read_from_a_draft() -> None:
    world = await _late_world(None)
    await world.rules.create_version(
        with_lever(intake_rules(), "milestones.application_deadline", "2027-02-01"), actor=FINANCE
    )  # a draft: milestones not approved anywhere
    with pytest.raises(ScenarioRefusedError, match="approved rules set no application deadline"):
        await world.service.evaluate(YEAR, intake_rules(), request_set="round1_deadline")


@pytest.mark.asyncio
async def test_only_live_requests_count_as_left_out() -> None:
    world = await _late_world(datetime(2027, 2, 10, 18, 0, tzinfo=UTC), riley_status="withdrawn")
    evaluation = await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 2, 1))
    assert evaluation.results.request_set is not None
    assert (evaluation.results.requests, evaluation.results.request_set.left_out) == (2, 0)


@pytest.mark.asyncio
async def test_a_request_with_no_recorded_date_is_left_out_and_counted() -> None:
    world = await _late_world(None)
    evaluation = await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 2, 1))
    assert evaluation.results.request_set is not None
    assert (evaluation.results.requests, evaluation.results.request_set.unknown) == (2, 1)


@pytest.mark.asyncio
async def test_a_request_set_writes_nothing_and_leaves_kept_figures_alone() -> None:
    world = await _late_world(datetime(2027, 2, 10, 18, 0, tzinfo=UTC))
    await world.service.start_from_rules(YEAR, FINANCE)
    scenario_writes, season_writes, season_log = (
        len(world.store.operations),
        len(world.season.operations),
        list(world.season.change_log),
    )
    through = date(2027, 2, 1)
    _, a = (await world.service.compare(YEAR, FINANCE, ["A"], request_set=through)).columns
    effects = await world.service.sensitivity(YEAR, intake_rules(), request_set=through)
    assert (a.results.requests, effects.results.requests) == (2, 2)  # fit refuses a request set (final review 5)
    assert a.results.request_set is not None
    kept = (await world.service.workspace(YEAR, FINANCE)).options[0]
    assert (kept.record.results.requests, kept.record.results.request_set) == (3, None)
    assert (len(world.store.operations), len(world.season.operations)) == (scenario_writes, season_writes)
    assert world.season.change_log == season_log


@pytest.mark.asyncio
async def test_a_family_that_edited_its_answer_after_the_deadline_keeps_its_on_time_date() -> None:
    """Intake withdrew Riley's first request (Jan 20) when the family edited its answer, and created a replacement on
    Feb 10: the replacement was received when the family first applied, so a request set through Feb 1 keeps it."""
    world = await _world()
    log_seeded(world.season, JAN20)
    first = seed_request(world.season, "reqrile00000009", household=1000003, person=1000031, status="withdrawn")
    world.season.change_log.append(
        LogRow(
            id="log000000000098",
            entity=AID_REQUESTS,
            entity_id=first.id,
            before=None,
            after={"year": YEAR, "household_cm_id": 1000003},
            created=JAN20,
        )
    )
    replacement = seed_request(world.season, RILEY, household=1000003, person=1000031)
    world.season.requests[RILEY] = replace(replacement, program_option_key="session 3")
    world.season.change_log.append(
        LogRow(
            id="log000000000099",
            entity=AID_REQUESTS,
            entity_id=RILEY,
            before=None,
            after={"year": YEAR, "household_cm_id": 1000003},
            created=datetime(2027, 2, 10, 18, 0, tzinfo=UTC),
        )
    )
    await world.service.freeze(YEAR, FINANCE)
    through = await world.service.evaluate(YEAR, intake_rules(), request_set=date(2027, 2, 1))
    assert through.results.request_set is not None
    assert (through.results.requests, through.results.request_set.left_out) == (3, 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("request_set", [date(2027, 2, 1), "round1_deadline"])
async def test_fit_to_budget_refuses_while_a_request_set_is_on(request_set: RequestSetChoice) -> None:
    """Owner ruling: Fit to budget sizes the whole season, so it never runs on part of it."""
    world = await _late_world(datetime(2027, 2, 10, 18, 0, tzinfo=UTC))
    refusal = re.escape("Fit to budget uses every request; turn off the request set.")
    with pytest.raises(ScenarioRefusedError, match=refusal):
        await world.service.fit(YEAR, intake_rules(), request_set=request_set)


@pytest.mark.asyncio
async def test_trail_rows_say_whether_their_figures_are_from_an_older_snapshot() -> None:
    world = await _started()
    [started] = (await world.service.trail(YEAR, page=1, per_page=50))[0]
    assert started.stale is False
    _add_riley(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    rows, _ = await world.service.trail(YEAR, page=1, per_page=50)
    assert (rows[0].change, rows[0].stale) == ("Round 1 % +5 pts", False)  # priced on the newest snapshot
    assert [r.stale for r in rows] == [False, True]  # the start row's figures are from the first snapshot

"""Campership scenarios (sub-project 9b; spec §7.4; D35–D39): freezing, the per-person draft, the trail, keeping in
two levels, compare, fit to budget, the one-step sensitivity, and making a kept option the rules draft.

Real pricing over a frozen fictional season (decisions_fakes): Emma's family has 60,000 (tier 2, Round 1 1,500) and
Liam's 90,000 (tier 3, 1,100), so Round 1 is 2,600; +5 points makes it 2,800. Round 1's allocation is 440,000.
Rules and scenarios live in memory, and every write runs 4a's real helper."""

from __future__ import annotations

import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from api.constants.collections import (
    AID_REQUESTS,
    AID_SCENARIO_OPTIONS,
    AID_SCENARIO_SNAPSHOTS,
    AID_SCENARIO_TRAIL,
)
from api.schemas.financial_aid_decisions import CellOut, RoundCellOut
from api.services import financial_aid_scenarios_repository as repository_module
from api.services import financial_aid_scenarios_service as service_module
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES
from api.services.financial_aid_rules_service import (
    ROUND_SECTIONS,
    FinancialAidRulesService,
    NotLatestVersionError,
    ReplacementNotAcknowledgedError,
    RulesVersion,
)
from api.services.financial_aid_scenario_pricing import (
    PricedSeason,
    SeasonSnapshot,
    SnapshotError,
    capture_season,
    price_document,
)
from api.services.financial_aid_scenarios_service import (
    FinancialAidScenariosService,
    RequestSetChoice,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioRefusedError,
    ScenarioSectionLockedError,
)
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules import AidRules, SectionName
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
    rules_store: FakeStore


async def _world(rows: Sequence[RegisterRow] = ()) -> World:
    """`rows`: the grants register the season prices with."""
    season = FakeDecisionsStore()
    seed_request(season, EMMA)
    seed_request(season, LIAM, household=1000002, person=1000021, income=90000.0)
    rules_store = FakeStore()
    rules = FinancialAidRulesService(rules_store, clock=lambda: T0)
    await rules.create_version(intake_rules(), actor=FINANCE)  # 2027 v1, every section draft

    async def register(year: int) -> Sequence[RegisterRow]:
        return rows

    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(season, register, FakeRules(approved()), year)

    store = FakeScenarioStore()
    return World(FinancialAidScenariosService(store, rules, capture), store, season, rules, rules_store)


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
    with pytest.raises(SnapshotError, match="Update Applications again"):
        await world.service.evaluate(YEAR, intake_rules())
    frozen = await world.service.freeze(YEAR, FINANCE)  # an unreadable latest counts as "the season moved"
    assert frozen.id != row.id
    assert len(world.store.rows[AID_SCENARIO_SNAPSHOTS]) == 2
    assert (await world.service.evaluate(YEAR, intake_rules())).results.round1 == Decimal(2600)


@pytest.mark.asyncio
async def test_nothing_runs_before_the_applications_are_frozen() -> None:
    world = await _world()
    with pytest.raises(ScenarioRefusedError, match="Update Applications first"):
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
    assert (draft.from_code, draft.label) == ("A", "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%")
    assert draft.results is not None
    assert draft.results.round1 == Decimal(2800)
    assert {c.path[0] for c in draft.changes} == {"award_tables"}
    rows, total = await world.service.trail(YEAR, page=1, per_page=50)
    assert (total, rows[0].change, rows[0].actor) == (2, "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%", FINANCE)


@pytest.mark.asyncio
async def test_releasing_the_same_settings_twice_records_once() -> None:
    world = await _started()
    a = await _a(world)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    assert (await world.service.trail(YEAR, page=1, per_page=50))[1] == 2


@pytest.mark.asyncio
async def test_the_draft_is_per_person() -> None:
    """Ruled (§S11.2): TREASURER has recorded nothing, so their draft is the rules in effect, unrecorded, beside
    FINANCE's draft from A. Their first release records from "rules", and FINANCE's draft is untouched."""
    world = await _started()
    theirs = (await world.service.workspace(YEAR, TREASURER)).draft
    assert theirs is not None
    assert (theirs.trail_id, theirs.from_code, theirs.label) == (None, "rules", "no changes")
    released = await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), TREASURER)
    assert (released.from_code, released.label) == ("rules", PLUS_FIVE)  # +5 against v1: Task 53's derivation
    assert released.trail_id is not None
    mine = (await world.service.workspace(YEAR, FINANCE)).draft
    assert mine is not None
    assert (mine.from_code, mine.label) == ("A", "no changes")


@pytest.mark.asyncio
async def test_loading_an_option_or_an_old_row_never_loses_the_draft() -> None:
    world = await _started()
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    loaded = await world.service.load(YEAR, FINANCE, option="A")
    assert (loaded.from_code, loaded.label) == ("A", "no changes")
    rows, total = await world.service.trail(YEAR, page=1, per_page=50)
    assert (total, rows[0].change) == (3, "loaded A into the draft")
    back = await world.service.load(YEAR, FINANCE, trail_row=rows[1].id)
    assert back.label == "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%"
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
async def test_keeping_a_draft_that_matches_a_kept_option_is_refused() -> None:
    world = await _started()
    with pytest.raises(ScenarioConflictError, match="same as A"):
        await world.service.keep(YEAR, FINANCE)


@pytest.mark.asyncio
async def test_a_keep_is_one_operation_and_its_log_carries_no_document() -> None:
    world = await _started()
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE)
    option_row, trail_row = world.store.log[-2:]
    assert (option_row["entity"], option_row["entity_id"], option_row["action"]) == (
        "aid_scenario_options",
        f"{YEAR}:B",
        "keep",
    )
    assert (trail_row["entity"], trail_row["after"]) == ("aid_scenario_trail", {"kept_code": "B"})
    assert option_row["operation_id"] == trail_row["operation_id"]
    assert "document" not in option_row["after"]


# --- compare, fit, sensitivity ------------------------------------------------------------------------


async def _kept_b(world: World) -> AidRules:
    """FINANCE shifts A by +5 and keeps it: B. Returns A's document."""
    a = await _a(world)
    await world.service.save_draft(YEAR, _shifted(a, "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE)
    return a


@pytest.mark.asyncio
async def test_compare_puts_the_draft_first_beside_the_ticked_options() -> None:
    world = await _started()
    a = await _kept_b(world)
    await world.service.save_draft(YEAR, _shifted(a, "10"), FINANCE)
    comparison = await world.service.compare(YEAR, FINANCE, ["A", "B", "A"])
    assert [c.code for c in comparison.columns] == ["draft", "A", "B"]
    draft, first, variant = comparison.columns
    assert (draft.label, draft.up, draft.down) == ("Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 80%", 2, 0)
    assert (first.label, first.up, first.down) == ("rules draft v1 as they were", None, None)  # v1 prices nothing
    assert (variant.label, variant.up, variant.down, variant.results.round1) == (
        "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%",
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
    # Budget 3,000: the pools' allocations are Camp 2,400, Weekends 450 and B'mitzvah 150, so 3,000 in all (no
    # reserves: §8.2). Both requests are Camp's, spending 2,600 at no shift, and each point adds 40: +10 spends
    # 3,000; +10.5 would spend 3,020. Camp alone is then 600 over (3,000 - 2,400); it is named, not enforced (D119:
    # only the total is hard).
    fitted = await world.service.fit(YEAR, with_lever(intake_rules(), "budget.total", "3000"))
    assert (fitted.fit.kind, fitted.fit.shift, fitted.tightest_pool) == ("fits", Decimal(10), "camp_pool")
    results = fitted.evaluation.results
    pools = {p.pool: p for p in results.pools}
    assert (results.round1, results.round1_remaining) == (Decimal(3000), Decimal("0.00"))
    assert pools["camp_pool"].round1_remaining == Decimal("-600.00")
    assert fitted.evaluation.document.award_tables["camp"].tiers[2].r1_pct == Decimal(85)


@pytest.mark.asyncio
async def test_fit_reads_no_spillover_setting() -> None:
    world = await _started()
    shared = with_levers(intake_rules(), {"budget.total": "3000", "budget.spillover": "shared"})
    fitted = await world.service.fit(YEAR, shared)
    assert (fitted.fit.kind, fitted.fit.shift, fitted.tightest_pool) == ("fits", Decimal(10), "camp_pool")


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
    # Emma's Round 1 stays at its 1,400 lock under every shift; only Liam's 1,100 moves, 20 a point. The 3,000 of
    # allocations leaves 1,600 for him: +25 (55% + 25 = 80% of 2,000); +25.5 would be 1,610. Were Emma's money moving
    # too, the fit would stop at +10.
    fitted = await world.service.fit(YEAR, with_lever(intake_rules(), "budget.total", "3000"))
    assert (fitted.fit.kind, fitted.fit.shift, fitted.evaluation.results.round1) == ("fits", Decimal(25), Decimal(3000))


@pytest.mark.asyncio
async def test_money_on_a_program_with_no_pool_counts_against_the_fit() -> None:
    world = await _started()
    # Summer has no pool here, so both requests are "No pool" money: no allocation of its own, but it spends the
    # budget. The fit still stops at +10 (2,600 + 10 x 40 = 3,000), not at the highest shift. The pools keep their
    # whole allocations (Camp 2,400, Weekends 450, B'mitzvah 150) and spend nothing, so B'mitzvah has the least left.
    no_pool = with_levers(intake_rules(), {"budget.total": "3000", "programs.summer.budget_pool": None})
    fitted = await world.service.fit(YEAR, no_pool)
    pools = {p.pool: p for p in fitted.evaluation.results.pools}
    assert (fitted.fit.kind, fitted.fit.shift) == ("fits", Decimal(10))
    assert (pools[""].round1, pools[""].round1_allocated) == (Decimal(3000), None)
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
    await _kept_b(world)
    await world.service.load(YEAR, TREASURER, option="B")
    rows, total = await world.service.trail(YEAR, page=1, per_page=2)
    assert total == 3
    assert [(r.actor, r.change) for r in rows] == [
        (TREASURER, "loaded B into the draft"),
        (FINANCE, "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%"),
    ]
    assert (rows[1].kept_code, rows[0].document) == ("B", None)


# --- make it the rules draft --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_making_a_kept_option_the_rules_draft() -> None:
    world = await _started()
    await _kept_b(world)
    promotion = await world.service.rules_draft_preview(YEAR, "B")
    preview = promotion.preview
    assert ([s.section for s in preview.sections], preview.base_version) == (["award_tables"], 1)
    draft, branched_from = await world.service.make_rules_draft(
        YEAR, "B", base_version=1, acknowledged={}, actor=FINANCE
    )
    assert (branched_from, draft.version.version) == (None, 1)  # 2027 v1 is not approved yet: saved in place
    status = draft.version.section_status["award_tables"]
    assert (status.edited_by, status.edited_via) == (FINANCE, "B")
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
    assert (rows[0].change, rows[0].stale) == (
        "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%",
        False,
    )  # priced on the newest snapshot
    assert [r.stale for r in rows] == [False, True]  # the start row's figures are from the first snapshot


# --- parity with the live Rounds & budget read (final review 10a) ------------------------------------------


@pytest.mark.asyncio
async def test_a_scenario_on_the_base_rules_shows_the_live_rounds_and_budget_figures() -> None:
    rows = [grant_row(EMMA, "250")]
    world = await _world(rows=rows)
    world.season.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=LIAM,
            round=1,
            kind="post",
            created=T0,
            amount=Decimal(1000),
            effective_on=date(2027, 3, 9),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    await world.service.freeze(YEAR, FINANCE)
    scenario = (await world.service.evaluate(YEAR, approved().document)).results

    async def register(year: int) -> Sequence[RegisterRow]:
        return rows

    live = await FinancialAidDecisionsService(world.season, FakeRules(approved()), register).budget(YEAR)

    def round1(cell: RoundCellOut | CellOut) -> Decimal:
        return sum((Decimal(str(v or 0)) for v in (cell.posted, cell.needs_offer, cell.pending_approval)), ZERO)

    def _minus(allocated: float | None, spent: Decimal) -> float | None:
        # §8.2: Round 1 remaining is the pool's Allocated less every Round 1 dollar.
        return None if allocated is None else float(Decimal(str(allocated)) - spent)

    def cents(value: float | None) -> Decimal | None:
        return None if value is None else Decimal(str(value)).quantize(Decimal("0.01"))

    total_round1 = next(cell for cell in live.total.rounds if cell.round == 1)
    assert scenario.round1 == round1(total_round1) == Decimal(2250)  # Emma 1,500 - 250 grant; Liam posted 1,000
    assert (scenario.round1_remaining, scenario.remaining) == (
        cents(_minus(live.total.total.allocated, round1(total_round1))),
        cents(live.total.total.remaining),
    )
    live_pools = {
        p.pool: (
            round1(next(c for c in p.rounds if c.round == 1)),
            cents(_minus(p.total.allocated, round1(next(c for c in p.rounds if c.round == 1)))),
            cents(p.total.remaining),
        )
        for p in live.pools
    }
    scenario_pools = {p.pool: (p.round1, p.round1_remaining, p.remaining) for p in scenario.pools}
    assert scenario_pools == live_pools


# --- the parked B6 minors -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_after_a_new_freeze_the_kept_option_is_stale_and_the_draft_reprices_on_the_newer_snapshot() -> None:
    world = await _started()
    _add_riley(world)
    newer = await world.service.freeze(YEAR, FINANCE)
    workspace = await world.service.workspace(YEAR, FINANCE)
    assert (workspace.snapshot, workspace.options[0].stale) == (newer, True)
    assert workspace.draft is not None
    assert workspace.draft.results is not None
    assert (workspace.draft.results.requests, workspace.draft.results.round1) == (3, Decimal(4100))


@pytest.mark.asyncio
async def test_a_trail_row_of_another_year_is_not_found() -> None:
    world = await _started()
    [row], _ = await world.service.trail(YEAR, page=1, per_page=1)
    with pytest.raises(ScenarioNotFoundError):
        await world.service.load(YEAR + 1, FINANCE, trail_row=row.id)


@pytest.mark.asyncio
async def test_a_freeze_refused_as_a_snapshot_error_writes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    world = await _world()
    monkeypatch.setattr(repository_module, "SNAPSHOT_INPUTS_MAX_BYTES", 10)
    with pytest.raises(SnapshotError, match="over the cap"):
        await world.service.freeze(YEAR, FINANCE)
    assert (world.store.rows[AID_SCENARIO_SNAPSHOTS], world.store.operations, world.store.log) == ([], [], [])


@pytest.mark.asyncio
async def test_freezes_and_trail_rows_log_who_made_them() -> None:
    world = await _world()
    await world.service.freeze(YEAR, TREASURER)
    await world.service.start_from_rules(YEAR, FINANCE)
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    logged = [(row["entity"], row["action"], row["actor"]) for row in world.store.log]
    assert logged == [
        ("aid_scenario_snapshots", "freeze", TREASURER),
        ("aid_scenario_options", "keep", FINANCE),
        ("aid_scenario_trail", "record", FINANCE),
        ("aid_scenario_trail", "record", FINANCE),
    ]


# --- the parked B7 minors -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_sizing_step_moves_round1_when_a_family_sits_on_its_edge() -> None:
    """Riley's family has 250,000 (tier 6: 2% of 2,000 is 40, so the 100 minimum): +10 on the minimum is +10. Olivia's
    has 81,500, just into tier 3 (1,100); bands 1,000 wider put it in tier 2 (1,500): +400. Dollar-for-dollar is off
    in this document, with a 250 grant on Emma: flipping it on takes 1,313 to 1,250, -63. One more point: Emma's
    1,750 basis +17.50 (rounded, +17), Liam +20, Olivia +20, Riley still the minimum: +57."""
    world = await _world(rows=[grant_row(EMMA, "250")])
    seed_request(world.season, RILEY, household=1000003, person=1000031, income=250000.0)
    seed_request(world.season, "reqoliv00000001", household=1000004, person=1000041, income=81500.0)
    await world.service.freeze(YEAR, FINANCE)
    off = with_lever(intake_rules(), "grants.offset_mode", "reduce_cost_basis")
    sensitivity = await world.service.sensitivity(YEAR, off)
    assert [(e.lever.key, e.round1_change, e.on) for e in sensitivity.effects] == [
        ("tier_shift", Decimal(57), None),
        ("minimum", Decimal(10), None),
        ("band_width", Decimal(400), None),
        ("dollar_for_dollar", Decimal(-63), False),
    ]


@pytest.mark.asyncio
async def test_making_the_rules_draft_hands_off_the_previews_token_for_a_warned_section() -> None:
    world = await _world()
    await world.rules.approve_sections(YEAR, 1, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)  # A, from the approved v1
    a = await _kept_b(world)
    # Someone edits Round 1's tables after A was taken: the edit branches v2 (v1 prices the season), unapproved, and
    # B would replace it.
    edited = _shifted(a, "-3").model_dump(mode="json")["award_tables"]
    await world.rules.save_section(YEAR, 1, "award_tables", edited, actor=TREASURER)
    promotion = await world.service.rules_draft_preview(YEAR, "B")
    preview = promotion.preview
    [section] = preview.sections
    assert section.warning is not None
    assert (preview.base_version, section.section, section.warning.kind, section.warning.by) == (
        2,
        "award_tables",
        "unapproved_edit",
        TREASURER,
    )
    token: dict[SectionName, str] = {"award_tables": section.warning.token}
    with pytest.raises(ReplacementNotAcknowledgedError):
        await world.service.make_rules_draft(YEAR, "B", base_version=2, acknowledged={}, actor=FINANCE)
    with pytest.raises(NotLatestVersionError):
        await world.service.make_rules_draft(YEAR, "B", base_version=1, acknowledged=token, actor=FINANCE)
    draft, _ = await world.service.make_rules_draft(YEAR, "B", base_version=2, acknowledged=token, actor=FINANCE)
    assert (draft.version.version, draft.version.section_status["award_tables"].edited_via) == (2, "B")
    assert draft.version.document.award_tables == _shifted(a, "5").award_tables


@pytest.mark.asyncio
async def test_compare_prices_no_reference_for_a_starting_point_from_the_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    """A starting point from the rules shows no up / down, so its rules are loaded for the changes, never priced."""
    world = await _started()
    priced: list[AidRules] = []

    async def counting(
        snapshot: SeasonSnapshot, document: AidRules, base: RulesVersion, *, requests: Collection[str] | None = None
    ) -> PricedSeason:
        priced.append(document)
        return await price_document(snapshot, document, base, requests=requests)

    monkeypatch.setattr(service_module, "price_document", counting)
    await world.service.load(YEAR, TREASURER, option="A")  # TREASURER's draft is A, unchanged
    priced.clear()
    draft, a = (await world.service.compare(YEAR, TREASURER, ["A"])).columns
    assert (a.code, a.changes, a.up, a.down) == ("A", (), None, None)
    assert len(priced) == 1  # the draft only: A's figures are stored, and v1 is never priced as its reference


@pytest.mark.asyncio
async def test_compare_refuses_a_draft_whose_option_is_gone_as_the_draft_does() -> None:
    world = await _started()
    world.store.rows[AID_SCENARIO_OPTIONS].clear()
    with pytest.raises(ScenarioNotFoundError, match="no kept option A"):
        await world.service.workspace(YEAR, FINANCE)
    with pytest.raises(ScenarioNotFoundError, match="no kept option A"):
        await world.service.compare(YEAR, FINANCE, [])


@pytest.mark.asyncio
async def test_every_scenario_read_and_write_derives_the_current_year_weight() -> None:
    """§S11.5: a document sent with weights that don't sum to 1 is priced and recorded with current = 1 − prior."""
    world = await _started()
    skewed = with_levers(intake_rules(), {"income.weights.prior_year": "0.6", "income.weights.current_year": "0.9"})
    assert (await world.service.evaluate(YEAR, skewed)).document.income.weights.current_year == Decimal("0.4")
    assert (await world.service.save_draft(YEAR, skewed, FINANCE)).document.income.weights.current_year == Decimal(
        "0.4"
    )
    fitted = await world.service.fit(YEAR, with_lever(skewed, "budget.total", "3000"))
    assert fitted.evaluation.document.income.weights.current_year == Decimal("0.4")


# --- built-in starts and the implicit draft (Scenarios addendum §S11.2) --------------------------------------------


async def _frozen() -> World:
    """Frozen, nothing loaded: FINANCE's draft is the implicit one, from the rules in effect."""
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    return world


async def _approved_v1(world: World) -> None:
    await world.rules.approve_sections(YEAR, 1, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")


PLUS_FIVE = "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%"


@pytest.mark.asyncio
async def test_with_no_draft_recorded_the_tab_opens_on_the_rules_in_effect_without_a_write() -> None:
    world = await _frozen()
    writes = len(world.store.operations)
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert (draft.trail_id, draft.recorded_at, draft.from_code, draft.label, draft.changes) == (
        None,
        None,
        "rules",
        "no changes",
        (),
    )
    assert draft.document == draft.source_document == intake_rules()  # v1: nothing approved, so the latest version
    assert draft.same_as == "rules"
    assert draft.results is not None
    assert draft.results.round1 == Decimal(2600)
    assert len(world.store.operations) == writes  # opening the tab wrote nothing


@pytest.mark.asyncio
async def test_the_first_release_records_the_draft_from_the_rules() -> None:
    world = await _frozen()
    draft = await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    assert (draft.from_code, draft.label, draft.same_as, draft.source_document) == (
        "rules",
        PLUS_FIVE,
        None,
        intake_rules(),
    )
    assert draft.trail_id is not None
    rows, _ = await world.service.trail(YEAR, page=1, per_page=10)
    assert [(r.from_code, r.change) for r in rows] == [("rules", PLUS_FIVE)]
    assert world.store.rows[AID_SCENARIO_OPTIONS] == []


@pytest.mark.asyncio
async def test_loading_the_rules_records_a_start_from_the_version_in_effect_and_keeps_nothing() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await world.rules.create_version(with_minimum(intake_rules(), Decimal(150)), actor=FINANCE)  # v2, a draft
    draft = await world.service.load(YEAR, FINANCE, start="rules")
    assert (draft.from_code, draft.document, draft.label) == ("rules", intake_rules(), "no changes")
    workspace = await world.service.workspace(YEAR, FINANCE)
    assert (workspace.rules_draft_version, workspace.options) == (2, ())
    rows, _ = await world.service.trail(YEAR, page=1, per_page=10)
    assert [(r.from_code, r.change) for r in rows] == [("rules", "started from Rules v1")]


@pytest.mark.asyncio
async def test_loading_the_rules_draft_records_it_now_while_it_differs() -> None:
    """§S15 item 4 ("draft sure"): a third start, offered only while the draft differs from the rules in effect."""
    world = await _frozen()
    await _approved_v1(world)
    await world.rules.create_version(with_minimum(intake_rules(), Decimal(150)), actor=FINANCE)
    draft = await world.service.load(YEAR, FINANCE, start="rules_draft")
    assert (draft.from_code, draft.document.awards.minimum, draft.label) == ("rules_draft", Decimal(150), "no changes")
    rows, _ = await world.service.trail(YEAR, page=1, per_page=10)
    assert rows[0].change == "started from Rules draft v2"


@pytest.mark.asyncio
async def test_the_rules_draft_is_refused_when_it_matches_the_rules_in_effect() -> None:
    world = await _frozen()
    await _approved_v1(world)
    assert (await world.service.workspace(YEAR, FINANCE)).rules_draft_version is None
    with pytest.raises(ScenarioRefusedError, match=r"^The rules draft matches the rules in effect$"):
        await world.service.load(YEAR, FINANCE, start="rules_draft")
    assert world.store.rows[AID_SCENARIO_TRAIL] == []


@pytest.mark.asyncio
async def test_a_draft_from_the_rules_reads_its_edits_against_the_version_in_effect_now() -> None:
    """§S11.2, deliberate: after a new version is approved, "was" means what is in effect then."""
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    v2 = await world.rules.create_version(with_minimum(intake_rules(), Decimal(150)), actor=FINANCE)
    await world.rules.approve_sections(YEAR, v2.version, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.source_document is not None
    assert draft.source_document.awards.minimum == Decimal(150)
    assert draft.label == f"{PLUS_FIVE} · Minimum $100"


@pytest.mark.asyncio
async def test_same_as_names_a_kept_option_first_then_the_rules() -> None:
    world = await _started()  # A is the rules draft v1, which is also the rules in effect (none approved)
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.same_as == "A"
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.same_as is None


@pytest.mark.asyncio
async def test_a_load_names_exactly_one_thing() -> None:
    world = await _frozen()
    with pytest.raises(ScenarioRefusedError, match="one kept option, one trail row or one starting point"):
        await world.service.load(YEAR, FINANCE, option="A", start="rules")
    with pytest.raises(ScenarioRefusedError, match="one kept option, one trail row or one starting point"):
        await world.service.load(YEAR, FINANCE)


# --- names, rename and flat letters (Scenarios addendum §S11.1) ----------------------------------------------------


def _seed_legacy_option(world: World, code: str, starting_point: str, day: int) -> None:
    """An option kept before PR 10 (two levels, no name): a copy of A's row under `code`."""
    [a] = [row for row in world.store.rows[AID_SCENARIO_OPTIONS] if row.code == "A"]
    world.store.rows[AID_SCENARIO_OPTIONS].append(
        SimpleNamespace(
            **{
                **vars(a),
                "id": f"opt{code.lower():0>12}",
                "code": code,
                "starting_point": starting_point,
                "from_code": starting_point,
                "created": (T0 + timedelta(days=day)).isoformat(),
            }
        )
    )


def _criterion_label(rules: AidRules, label: str) -> AidRules:
    criteria = [c.model_copy(update={"label": label}) if c.key == "bipoc" else c for c in rules.equity.criteria]
    return rules.model_copy(update={"equity": rules.equity.model_copy(update={"criteria": criteria})})


@pytest.mark.asyncio
async def test_keep_with_a_name_stores_it_and_a_blank_one_stores_the_label() -> None:
    world = await _frozen()
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    named = await world.service.keep(YEAR, FINANCE, name="  Every tier up  ")
    assert (named.record.code, named.name, named.record.from_code, named.record.starting_point) == (
        "A",
        "Every tier up",
        "",  # kept from a built-in start: from_code "" (aid_scenario_options.from_code is unchanged)
        "",
    )
    assert named.record.origin_version == 1
    await world.service.save_draft(YEAR, with_minimum(_shifted(intake_rules(), "5"), Decimal(150)), FINANCE)
    blank = await world.service.keep(YEAR, FINANCE, name="   ")
    assert (blank.record.code, blank.name, blank.record.from_code) == ("B", "Minimum $150", "A")


@pytest.mark.asyncio
async def test_an_option_kept_from_the_rules_is_labelled_by_its_name_not_as_the_rules_as_they_were() -> None:
    world = await _frozen()
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    kept = await world.service.keep(YEAR, FINANCE)
    assert kept.label == kept.record.name


@pytest.mark.asyncio
async def test_after_a_a1_and_b_the_next_keep_is_c_and_a_legacy_variant_keeps_its_label_as_its_name() -> None:
    """Review Focus 3: variants kept before PR 10 never take a letter; an unnamed option reads as its label."""
    world = await _started()  # A
    _seed_legacy_option(world, "A1", "A", 1)
    _seed_legacy_option(world, "B", "", 2)
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    kept = await world.service.keep(YEAR, FINANCE)
    assert kept.record.code == "C"
    options = {o.record.code: o for o in (await world.service.workspace(YEAR, FINANCE)).options}
    assert options["A1"].name == options["A1"].label  # no stored name: its generated label stands in
    assert options["A1"].record.name == ""


@pytest.mark.asyncio
async def test_a_name_longer_than_the_field_is_cut_when_the_label_stands_in() -> None:
    """aid_scenario_options.name holds 80 characters (Task 52): a long label is cut with "…", never refused."""
    world = await _frozen()
    long = _criterion_label(intake_rules(), "a very long label " * 10)
    await world.service.save_draft(YEAR, with_lever(long, "equity.weights.camp.bipoc", "0.75"), FINANCE)
    kept = await world.service.keep(YEAR, FINANCE)
    assert (len(kept.name), kept.name[-1]) == (80, "…")


@pytest.mark.asyncio
async def test_a_rename_is_one_logged_operation_and_leaves_the_document_alone() -> None:
    world = await _started()
    document = await _a(world)
    renamed = await world.service.rename(YEAR, "A", "  The rules, as approved ", TREASURER)
    assert (renamed.name, renamed.record.document) == ("The rules, as approved", document)
    row = world.store.log[-1]
    assert (row["entity"], row["entity_id"], row["action"]) == ("aid_scenario_options", f"{YEAR}:A", "rename")
    assert (row["before"], row["after"]) == ({"name": ""}, {"name": "The rules, as approved"})
    operations = len(world.store.operations)
    await world.service.rename(YEAR, "A", "The rules, as approved", FINANCE)  # the same name: nothing written
    assert len(world.store.operations) == operations


@pytest.mark.asyncio
async def test_a_rename_refuses_a_blank_name_and_an_unknown_code() -> None:
    world = await _started()
    with pytest.raises(ScenarioRefusedError, match=r"^Give it a name$"):
        await world.service.rename(YEAR, "A", "   ", FINANCE)
    with pytest.raises(ScenarioNotFoundError, match="no kept option Q"):
        await world.service.rename(YEAR, "Q", "Anything", FINANCE)


@pytest.mark.asyncio
async def test_a_keep_with_nothing_recorded_is_refused() -> None:
    world = await _frozen()
    with pytest.raises(
        ScenarioRefusedError, match=r"^Your draft is the rules in effect: change a setting before keeping it$"
    ):
        await world.service.keep(YEAR, FINANCE)


# --- the lock (Scenarios addendum §S11.3) ---------------------------------------------------------------------------


async def _post_round(world: World, round_: int) -> None:
    """A round's first Posted tick as the decisions service makes it: lock_writes for the sections the round read,
    committed (ROUND_SECTIONS; spec §7.5). Never lock_section: production never calls it (parent coordinator
    correction, 2026-10-06 late)."""
    writes, not_locked = await world.rules.lock_writes(YEAR, 1, ROUND_SECTIONS[round_])
    assert not_locked == []
    await world.rules_store.commit(writes, actor=TREASURER)


@pytest.mark.asyncio
async def test_the_lock_reads_any_version_and_names_the_round_that_posted() -> None:
    world = await _frozen()
    await _approved_v1(world)
    before = await world.service.workspace(YEAR, FINANCE)
    assert (before.locked_sections, before.locked_by_round) == ((), None)
    await _post_round(world, 1)
    await world.rules.new_version(YEAR, 1, actor=FINANCE, unlock=["award_tables"])  # v2 lifts it; v1 keeps it
    after = await world.service.workspace(YEAR, FINANCE)
    assert after.locked_sections == ("income", "tiers", "equity", "award_tables", "awards")
    assert after.locked_by_round == 1
    await _post_round(world, 2)
    assert (await world.service.workspace(YEAR, FINANCE)).locked_by_round == 2


@pytest.mark.asyncio
async def test_a_release_that_changes_a_section_locked_since_the_screen_opened_is_refused_and_records_nothing() -> None:
    """Review Focus 1: the screen still showed it editable; the edit is refused in staff words, the strip still
    prices it, and nothing is recorded."""
    world = await _frozen()
    await _approved_v1(world)
    await _post_round(world, 1)
    plus_five = _shifted(intake_rules(), "5")
    with pytest.raises(ScenarioSectionLockedError) as refused:
        await world.service.save_draft(YEAR, plus_five, FINANCE)
    assert str(refused.value) == (
        "Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open."
    )
    assert refused.value.sections == ["award_tables"]
    assert world.store.rows[AID_SCENARIO_TRAIL] == []
    assert (await world.service.evaluate(YEAR, plus_five)).results.round1 == Decimal(2800)


@pytest.mark.asyncio
async def test_two_locked_sections_are_named_together() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await _post_round(world, 1)
    both = with_minimum(_shifted(intake_rules(), "5"), Decimal(150))
    with pytest.raises(
        ScenarioSectionLockedError,
        match=r"^Round 1 award table and Minimum award and named awards are locked: Round 1",
    ):
        await world.service.save_draft(YEAR, both, FINANCE)


@pytest.mark.asyncio
async def test_the_round_1_plus_2_cap_stays_open_until_round_2_posts() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await _post_round(world, 1)
    caps = with_lever(intake_rules(), "round2.tables.camp.tiers.4.total_pct", "60")
    assert (await world.service.save_draft(YEAR, caps, FINANCE)).from_code == "rules"
    await _post_round(world, 2)
    with pytest.raises(ScenarioSectionLockedError, match=r"^Appeal caps is locked: Round 2 is posted"):
        await world.service.save_draft(YEAR, with_lever(caps, "round2.tables.camp.tiers.4.total_pct", "65"), FINANCE)


@pytest.mark.asyncio
async def test_an_option_kept_before_the_lock_still_loads_and_prices_but_cannot_be_promoted() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE, name="Every tier up")  # A
    await _post_round(world, 1)
    await world.service.load(YEAR, TREASURER, option="A")  # a load is no edit
    assert (await world.service.evaluate(YEAR, await _a(world))).results.round1 == Decimal(2800)
    versions = len(await world.rules_store.list_versions(YEAR))
    with pytest.raises(ScenarioSectionLockedError, match="Round 1 award table is locked"):
        await world.service.rules_draft_preview(YEAR, "A")
    with pytest.raises(ScenarioSectionLockedError):
        await world.service.make_rules_draft(YEAR, "A", base_version=1, acknowledged={}, actor=FINANCE)
    assert len(await world.rules_store.list_versions(YEAR)) == versions  # nothing written


@pytest.mark.asyncio
async def test_each_option_says_whether_it_can_be_promoted_and_why_not() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await world.service.load(YEAR, FINANCE, start="rules")
    await world.service.keep(YEAR, FINANCE)  # A: the rules in effect, unchanged
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE)  # B: Round 1 % moved
    await world.service.save_draft(
        YEAR, with_lever(intake_rules(), "round2.tables.camp.tiers.4.total_pct", "60"), FINANCE
    )
    await world.service.keep(YEAR, FINANCE)  # C: the cap alone

    def why(workspace: Any) -> dict[str, tuple[bool, str | None]]:
        return {o.record.code: (o.promotable, o.blocked) for o in workspace.options}

    assert why(await world.service.workspace(YEAR, FINANCE)) == {
        "A": (False, "is the rules in effect"),
        "B": (True, None),
        "C": (True, None),
    }
    await _post_round(world, 1)
    assert why(await world.service.workspace(YEAR, FINANCE)) == {
        "A": (False, "is the rules in effect"),
        "B": (False, "changes Round 1 settings, locked since Round 1 posted"),
        "C": (True, None),
    }


@pytest.mark.asyncio
async def test_a_promotion_keeps_fixed_settings_as_the_rules_draft_has_them_and_says_how_many() -> None:
    """§S11.3 (decided in the addendum): an option from last season's rules can carry last season's hidden values."""
    world = await _frozen()
    last = with_levers(
        intake_rules(), {"year": YEAR - 1, "awards.ask_cap": False, "award_tables.camp.tiers.2.r1_pct": "80"}
    )
    await world.rules.create_version(last, actor=FINANCE)
    await world.rules.approve_sections(YEAR - 1, 1, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    await world.service.load(YEAR, FINANCE, start="last_rules")
    await world.service.keep(YEAR, FINANCE)  # A
    promotion = await world.service.rules_draft_preview(YEAR, "A")
    assert ([s.section for s in promotion.preview.sections], promotion.fixed_kept) == (["award_tables"], 1)
    draft, _ = await world.service.make_rules_draft(YEAR, "A", base_version=1, acknowledged={}, actor=FINANCE)
    assert draft.version.document.awards.ask_cap is True
    assert draft.version.document.award_tables["camp"].tiers[2].r1_pct == Decimal(80)


# --- the budget total is never an option's to change (COORDINATOR RULING, PR 10, 2026-10-07) ---------------------------


@pytest.mark.asyncio
async def test_a_promotion_after_the_lock_keeps_the_pricing_total_and_lands_the_rest() -> None:
    """A scenario option can never change the budget total: the sandbox has no budget editor, and once Round 1 posts
    the rules save refuses a new total. The promotion sets it back, so Confirm never fails with that 422."""
    world = await _frozen()
    await _approved_v1(world)
    await _post_round(world, 1)
    caps = with_levers(intake_rules(), {"round2.tables.camp.tiers.4.total_pct": "60", "budget.total": "600000"})
    await world.service.save_draft(YEAR, caps, FINANCE)  # budget is no Scenarios section: the release records
    await world.service.keep(YEAR, FINANCE)  # A
    draft, _ = await world.service.make_rules_draft(YEAR, "A", base_version=1, acknowledged={}, actor=FINANCE)
    assert draft.version.document.budget.total == intake_rules().budget.total
    assert draft.version.document.round2.tables["camp"].tiers[4].total_pct == Decimal(60)


@pytest.mark.asyncio
async def test_a_budget_total_alone_is_nothing_to_promote() -> None:
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(YEAR, with_lever(intake_rules(), "budget.total", "600000"), FINANCE)
    await world.service.keep(YEAR, FINANCE)  # A
    [option] = (await world.service.workspace(YEAR, FINANCE)).options
    assert (option.promotable, option.blocked) == (False, "is the rules in effect")
    assert (await world.service.rules_draft_preview(YEAR, "A")).preview.sections == ()

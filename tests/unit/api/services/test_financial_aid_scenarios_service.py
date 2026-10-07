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
    CurveRead,
    FinancialAidScenariosService,
    ReceivedRead,
    RequestSetChoice,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioRefusedError,
    ScenarioSectionLockedError,
)
from bunking.financial_aid.arrival import ArrivalCurve, CurvePoint
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


@pytest.fixture(autouse=True)
def _fresh_curve_memo() -> None:
    service_module.clear_computed_curves()


@dataclass
class World:
    service: FinancialAidScenariosService
    store: FakeScenarioStore
    season: FakeDecisionsStore
    rules: FinancialAidRulesService
    rules_store: FakeStore


async def _world(
    rows: Sequence[RegisterRow] = (),
    *,
    document: AidRules | None = None,
    curves: CurveRead | None = None,
    received: ReceivedRead | None = None,
) -> World:
    """`rows`: the grants register the season prices with."""
    season = FakeDecisionsStore()
    seed_request(season, EMMA)
    seed_request(season, LIAM, household=1000002, person=1000021, income=90000.0)
    rules_store = FakeStore()
    rules = FinancialAidRulesService(rules_store, clock=lambda: T0)
    await rules.create_version(document or intake_rules(), actor=FINANCE)  # 2027 v1, every section draft

    async def register(year: int) -> Sequence[RegisterRow]:
        return rows

    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(season, register, FakeRules(approved()), year)

    store = FakeScenarioStore()
    return World(
        FinancialAidScenariosService(store, rules, capture, curves=curves, received=received),
        store,
        season,
        rules,
        rules_store,
    )


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


# --- compare (Scenarios addendum §S11.2; N3, N4, N11) ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_compare_counts_every_column_against_the_rules_in_effect_in_the_fixed_order() -> None:
    """N3, N4, N11 (ruled): one yardstick, the rules in effect, for every column; §S5 H's fixed order, never the
    order asked."""
    world = await _started()  # A: the rules draft v1, which is also the rules in effect (none approved)
    a = await _kept_b(world)  # B: A +5
    await world.service.save_draft(YEAR, _shifted(a, "10"), FINANCE)  # the draft: A +10, from B
    comparison = await world.service.compare(YEAR, FINANCE, ["B", "A", "B"], rules=True)
    assert [c.code for c in comparison.columns] == ["rules", "draft", "A", "B"]
    rules, draft, first, variant = comparison.columns
    assert (rules.label, rules.version, rules.up, rules.down, rules.changes) == ("Rules draft v1", 1, None, None, ())
    assert (draft.label, draft.up, draft.down) == ("Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 80%", 2, 0)
    assert {c.path[0] for c in draft.changes} == {"award_tables"}  # against the rules in effect, not B
    assert (first.up, first.down, first.changes) == (0, 0, ())
    assert (variant.up, variant.down, variant.results.round1) == (2, 0, Decimal(2800))


@pytest.mark.asyncio
async def test_the_draft_column_is_left_out_when_not_asked_for() -> None:
    world = await _started()
    await world.service.save_draft(YEAR, _shifted(await _a(world), "5"), FINANCE)
    comparison = await world.service.compare(YEAR, FINANCE, ["A"], draft=False)
    assert [c.code for c in comparison.columns] == ["A"]


@pytest.mark.asyncio
async def test_the_rules_column_carries_its_version_approval_and_the_option_it_came_from() -> None:
    """Disagreement 2: approval clears a section's edited_via, so `via` is read from the rules log."""
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE, name="Every tier up")  # A
    await world.service.make_rules_draft(YEAR, "A", base_version=1, acknowledged={}, actor=FINANCE)  # v2, via A
    later = T0 + timedelta(hours=2)
    world.rules._clock = lambda: later  # v2's award_tables is approved after every other section's v1 stamp
    await world.rules.approve_sections(YEAR, 2, ["award_tables"], actor=TREASURER, note="Finance committee")
    [rules] = (await world.service.compare(YEAR, FINANCE, [], rules=True, draft=False)).columns
    assert (rules.code, rules.label, rules.version, rules.via, rules.approved_at) == (
        "rules",
        "Rules v2 in effect",
        2,
        "A",
        later,  # the newest approval among the pricing sections
    )


@pytest.mark.asyncio
async def test_the_drafts_up_down_and_changes_are_against_the_rules_in_effect_not_its_source() -> None:
    """Regression guard. N3, N4 (ruled): a draft from B set back to A's tables moved nothing against the rules in
    effect (A), though against B both requests went down."""
    world = await _started()  # A is the rules in effect
    a = await _kept_b(world)  # B: A +5; FINANCE's draft is now from B
    await world.service.save_draft(YEAR, _shifted(a, "0"), FINANCE)  # back to A's tables, still from B
    [draft] = (await world.service.compare(YEAR, FINANCE, [])).columns
    assert (draft.code, draft.up, draft.down, draft.changes) == ("draft", 0, 0, ())


@pytest.mark.asyncio
async def test_the_rules_column_is_served_from_a_kept_option_that_is_the_rules_in_effect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A kept option equal to the rules in effect stores its figures, so the rules column prices nothing."""
    world = await _started()  # A is the rules in effect, stored on this snapshot
    priced: list[AidRules] = []

    async def counting(
        snapshot: SeasonSnapshot, document: AidRules, base: RulesVersion, *, requests: Collection[str] | None = None
    ) -> PricedSeason:
        priced.append(document)
        return await price_document(snapshot, document, base, requests=requests)

    monkeypatch.setattr(service_module, "price_document", counting)
    [rules] = (await world.service.compare(YEAR, FINANCE, [], rules=True, draft=False)).columns
    assert rules.code == "rules"
    assert priced == []


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
    """A starting point that is the rules in effect moves nothing (0 up, 0 down), and the yardstick is its stored
    Round 1, so those rules are never priced."""
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
    assert (a.code, a.changes, a.up, a.down) == ("A", (), 0, 0)  # A is the rules in effect: nothing moved
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


@pytest.mark.asyncio
async def test_sensitivity_prices_the_derived_current_year_weight_as_evaluate_does(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§S11.5 (PR 10 scan): sensitivity prices a scenario document too, so its base and every one-step nudge are
    priced with current = 1 − prior, as evaluate, the draft and Fit are."""
    world = await _started()
    skewed = with_levers(intake_rules(), {"income.weights.prior_year": "0.6", "income.weights.current_year": "0.9"})
    priced: list[Decimal] = []
    pricer = world.service._pricer

    async def spying(*args: Any, **kwargs: Any) -> Any:
        price = await pricer(*args, **kwargs)

        async def recorded(document: AidRules) -> Any:
            priced.append(document.income.weights.current_year)
            return await price(document)

        return recorded

    monkeypatch.setattr(world.service, "_pricer", spying)
    await world.service.sensitivity(YEAR, skewed)
    assert priced
    assert set(priced) == {Decimal("0.4")}


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
async def test_an_option_kept_from_the_rules_keeps_its_generated_label_whatever_its_name() -> None:
    """I6/m1: never "… as they were" for a document that differs; a rename changes `name`, never `label`."""
    world = await _frozen()
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    kept = await world.service.keep(YEAR, FINANCE)
    words = "Tiers 1–6 +5% · Round 1 % › Teen › Tier 2 75%"
    assert (kept.label, kept.name) == (words, words)
    renamed = await world.service.rename(YEAR, "A", "Every tier up", FINANCE)
    assert (renamed.label, renamed.name) == (words, "Every tier up")
    [listed] = (await world.service.workspace(YEAR, FINANCE)).options
    assert (listed.label, listed.name) == (words, "Every tier up")


@pytest.mark.asyncio
async def test_a_draft_that_is_the_rules_in_effect_is_not_kept() -> None:
    world = await _frozen()
    await world.service.load(YEAR, FINANCE, start="rules")
    with pytest.raises(
        ScenarioRefusedError, match=r"^Your draft is the rules in effect: change a setting before keeping it$"
    ):
        await world.service.keep(YEAR, FINANCE)
    assert not world.store.rows[AID_SCENARIO_OPTIONS]


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
    renamed = await world.service.rename(YEAR, "A1", "Older idea", FINANCE)
    assert (renamed.name, renamed.record.code) == ("Older idea", "A1")


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
    await world.service.start_from_rules(YEAR, FINANCE)  # A: the rules in effect, unchanged (keep refuses that)
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


@pytest.mark.asyncio
async def test_an_unreadable_snapshot_still_opens_an_unrecorded_draft_so_update_applications_stays_reachable() -> None:
    """Review I1: an unrecorded draft is priced on read. A snapshot this code can't read must not turn the workspace
    into a 422 for someone with nothing recorded (that hides Update Applications, the only way out). Writes still
    refuse in the same words."""
    world = await _started()
    [row] = world.store.rows[AID_SCENARIO_SNAPSHOTS]
    row.inputs = {key: value for key, value in row.inputs.items() if key != "live"}  # a required key dropped
    draft = (await world.service.workspace(YEAR, TREASURER)).draft
    assert draft is not None
    assert (draft.from_code, draft.results) == ("rules", None)
    with pytest.raises(SnapshotError, match="Update Applications again"):
        await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), TREASURER)
    await world.service.freeze(YEAR, FINANCE)
    priced = (await world.service.workspace(YEAR, TREASURER)).draft
    assert priced is not None
    assert priced.results is not None
    assert priced.results.round1 == Decimal(2600)


# --- Fix round 1: the strip must not make an untouched budget look moved; the pools still land -------------------------

SPLIT_70_25 = {
    "budget.pools.camp_pool.share_pct": "70",
    "budget.pools.weekend_pool.share_pct": "25",
}


@pytest.mark.asyncio
async def test_an_option_that_never_touched_the_budget_does_not_revert_the_drafts_newer_budget() -> None:
    """Finance moves the rules draft's total and split after A was kept from v1; A changed round2 only, so the
    promotion lists round2 alone and v2's budget stays."""
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(
        YEAR, with_lever(intake_rules(), "round2.tables.camp.tiers.4.total_pct", "60"), FINANCE
    )
    await world.service.keep(YEAR, FINANCE)  # A
    budget = with_levers(intake_rules(), {"budget.total": "550000", **SPLIT_70_25}).budget
    await world.rules.save_section(YEAR, 1, "budget", budget.model_dump(mode="json"), actor=FINANCE)  # branches v2
    promotion = await world.service.rules_draft_preview(YEAR, "A")
    assert [s.section for s in promotion.preview.sections] == ["round2"]
    draft, _ = await world.service.make_rules_draft(YEAR, "A", base_version=2, acknowledged={}, actor=FINANCE)
    assert draft.version.document.budget.total == Decimal(550000)
    assert draft.version.document.budget.pools["camp_pool"].share_pct == Decimal(70)
    assert draft.version.document.round2.tables["camp"].tiers[4].total_pct == Decimal(60)


@pytest.mark.asyncio
async def test_the_pools_an_option_moved_still_land_when_its_total_is_stripped_after_the_lock() -> None:
    """Regression guard: the strip takes the total only."""
    world = await _frozen()
    await _approved_v1(world)
    await _post_round(world, 1)
    await world.service.save_draft(
        YEAR, with_levers(intake_rules(), {"budget.total": "600000", **SPLIT_70_25}), FINANCE
    )
    await world.service.keep(YEAR, FINANCE)  # A
    draft, _ = await world.service.make_rules_draft(YEAR, "A", base_version=1, acknowledged={}, actor=FINANCE)
    assert draft.version.document.budget.total == intake_rules().budget.total
    assert draft.version.document.budget.pools["camp_pool"].share_pct == Decimal(70)


@pytest.mark.asyncio
async def test_a_release_compares_against_the_persons_draft_not_the_rules() -> None:
    """Regression guard. §S11.3: an option kept before the lock still loads, and an edit to a still-open section saves."""
    world = await _frozen()
    await _approved_v1(world)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE)  # A, before the lock
    await _post_round(world, 1)
    await world.service.load(YEAR, TREASURER, option="A")
    caps = with_lever(await _a(world), "round2.tables.camp.tiers.4.total_pct", "60")
    saved = await world.service.save_draft(YEAR, caps, TREASURER)
    assert saved.document.round2.tables["camp"].tiers[4].total_pct == Decimal(60)


@pytest.mark.asyncio
async def test_an_option_equal_to_a_rules_draft_that_differs_from_the_rules_in_effect_says_so() -> None:
    """Regression guard: disagreement 5's second wording."""
    world = await _frozen()
    await _approved_v1(world)
    edited = _shifted(intake_rules(), "-3").model_dump(mode="json")["award_tables"]
    await world.rules.save_section(YEAR, 1, "award_tables", edited, actor=TREASURER)  # branches v2
    await world.service.load(YEAR, FINANCE, start="rules_draft")
    await world.service.keep(YEAR, FINANCE)  # A: the rules draft itself
    [option] = (await world.service.workspace(YEAR, FINANCE)).options
    assert (option.promotable, option.blocked) == (False, "is already the rules draft")


# --- the projection (Scenarios addendum §S11.7) ---------------------------------------------------------------------

LAST_DEADLINE = date(YEAR - 1, 2, 4)
# A flat stored curve: half of last season's applications were in at any week from 60 before its deadline to 9
# after, so every share read inside that span is exactly 0.5 and every figure doubles.
FLAT = ArrivalCurve(
    YEAR - 1,
    "application_deadline",
    LAST_DEADLINE,
    (CurvePoint(-60, Decimal("0.5")), CurvePoint(10, Decimal(1))),
    400,
    "workbook",
)
WITH_DEADLINE = with_lever(intake_rules(), "milestones.application_deadline", f"{YEAR}-02-03")


async def _stored(curve: ArrivalCurve | None) -> CurveRead:
    async def read(year: int) -> ArrivalCurve | None:
        return curve if curve is not None and year == curve.year else None

    return read


async def _projected_world(curve: ArrivalCurve | None = FLAT, document: AidRules = WITH_DEADLINE) -> World:
    world = await _world(document=document, curves=await _stored(curve))
    await world.rules.approve_sections(YEAR, 1, ["milestones"], actor=TREASURER, note="Finance committee")
    await world.service.freeze(YEAR, FINANCE)
    return world


@pytest.mark.asyncio
async def test_a_stored_curve_projects_evaluate_and_the_draft() -> None:
    """At a share of 0.5: requests 2 → 4; Round 1 2,600 → 5,200; Remaining 500,000 − 5,200 = 494,800; Camp's
    400,000 − 5,200 = 394,800. Read for the held pile's camp day (the snapshot's, Mar 9)."""
    world = await _projected_world()
    projection = (await world.service.evaluate(YEAR, WITH_DEADLINE)).projection
    assert projection is not None
    assert (projection.share, projection.basis_year, projection.aligned_on, projection.through) == (
        Decimal("0.5000"),
        YEAR - 1,
        "application_deadline",
        date(YEAR, 3, 9),
    )
    assert (projection.requests, projection.round1, projection.remaining) == (
        4,
        Decimal("5200.00"),
        Decimal("494800.00"),
    )
    camp = next(p for p in projection.pools if p.pool == "camp_pool")
    assert camp.remaining == Decimal("394800.00")
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.projection is not None
    assert draft.projection.round1 == Decimal("5200.00")


@pytest.mark.asyncio
async def test_the_share_is_read_for_the_price_date_when_one_is_set() -> None:
    world = await _projected_world()
    projection = (await world.service.evaluate(YEAR, WITH_DEADLINE, request_set=date(YEAR, 1, 20))).projection
    assert projection is not None
    assert projection.through == date(YEAR, 1, 20)


@pytest.mark.asyncio
async def test_a_season_with_no_deadline_has_no_projection_under_a_deadline_aligned_curve() -> None:
    """Review Focus 5 (coordinator: "A season with no deadline has NO projection. No silent calendar switch.")."""
    world = await _projected_world(document=with_lever(intake_rules(), "milestones.application_deadline", None))
    assert (await world.service.evaluate(YEAR, intake_rules())).projection is None


@pytest.mark.asyncio
async def test_a_calendar_curve_projects_a_season_with_no_deadline() -> None:
    calendar = ArrivalCurve(
        YEAR - 1,
        "calendar",
        date(YEAR - 1, 1, 1),
        (CurvePoint(-60, Decimal("0.5")), CurvePoint(60, Decimal(1))),
        400,
        "workbook",
    )
    world = await _projected_world(
        calendar, document=with_lever(intake_rules(), "milestones.application_deadline", None)
    )
    projection = (await world.service.evaluate(YEAR, intake_rules())).projection
    assert projection is not None
    assert (projection.share, projection.aligned_on) == (Decimal("0.5000"), "calendar")


@pytest.mark.asyncio
async def test_no_curve_means_no_projection() -> None:
    world = await _projected_world(curve=None)
    assert (await world.service.evaluate(YEAR, WITH_DEADLINE)).projection is None


@pytest.mark.asyncio
async def test_every_compare_column_carries_one() -> None:
    """A kept option's stored results never carry one: `ScenarioResults` has no projection field, so that is pinned
    where it can fail, by the router's `test_a_kept_options_results_carry_no_projection` (plan review, minor 9)."""
    world = await _projected_world()
    await world.service.save_draft(YEAR, _shifted(WITH_DEADLINE, "5"), FINANCE)
    await world.service.keep(YEAR, FINANCE)  # A
    comparison = await world.service.compare(YEAR, FINANCE, ["A"], rules=True)
    assert all(column.projection is not None for column in comparison.columns)


@pytest.mark.asyncio
async def test_from_2027_on_the_curve_is_computed_from_received_dates_once_per_process() -> None:
    """§S11.7 source 2: last season (2027, a ticked season) from its own received dates, on its approved deadline.
    Jan 20 and Feb 3 (10 am Pacific) against a Feb 3 deadline: weeks −2 and 0."""
    reads: list[int] = []

    async def received(year: int) -> list[datetime]:
        reads.append(year)
        return [datetime(2027, 1, 20, 18, 0, tzinfo=UTC), datetime(2027, 2, 3, 18, 0, tzinfo=UTC)]

    world = await _world(document=WITH_DEADLINE, curves=await _stored(None), received=received)
    await world.rules.approve_sections(YEAR, 1, ["milestones"], actor=TREASURER, note="Finance committee")
    curve = await world.service.arrival_curve(YEAR + 1)
    assert curve is not None
    assert (curve.year, curve.source, curve.aligned_on, curve.anchor, curve.counted) == (
        YEAR,
        "received",
        "application_deadline",
        date(YEAR, 2, 3),
        2,
    )
    assert [(p.week, p.share) for p in curve.points] == [
        (-2, Decimal("0.5000")),
        (-1, Decimal("0.5000")),
        (0, Decimal("1.0000")),
    ]
    await world.service.arrival_curve(YEAR + 1)
    assert reads == [YEAR]  # memoised
    await world.service.freeze(YEAR, FINANCE)  # Update Applications clears it
    await world.service.arrival_curve(YEAR + 1)
    assert reads == [YEAR, YEAR]


@pytest.mark.asyncio
async def test_a_computed_curve_for_a_season_with_no_approved_deadline_lines_up_on_jan_1() -> None:
    """Regression guard. §S11.7: a year with no deadline lines up from Jan 1 and is stored as "calendar". 2027's
    milestones never approved: Jan 20 and Feb 3 against Jan 1 are weeks 2 and 4."""

    async def received(year: int) -> list[datetime]:
        return [datetime(2027, 1, 20, 18, 0, tzinfo=UTC), datetime(2027, 2, 3, 18, 0, tzinfo=UTC)]

    world = await _world(document=WITH_DEADLINE, curves=await _stored(None), received=received)
    curve = await world.service.arrival_curve(YEAR + 1)
    assert curve is not None
    assert (curve.aligned_on, curve.anchor, curve.points[0].week, curve.points[-1].week) == (
        "calendar",
        date(YEAR, 1, 1),
        2,
        4,
    )


@pytest.mark.asyncio
async def test_2026_is_never_computed_from_its_bulk_loaded_dates() -> None:
    """§S11.7: 2026 was bulk-loaded on 2026-09-27, so its dashboard dates are no arrival dates; only a stored row."""

    async def received(year: int) -> list[datetime]:
        raise AssertionError("2026's received dates must not be read")

    world = await _world(curves=await _stored(None), received=received)
    assert await world.service.arrival_curve(YEAR) is None


@pytest.mark.asyncio
async def test_received_moments_are_live_requests_dated_as_the_capture_dates_them() -> None:
    season = FakeDecisionsStore()
    seed_request(season, EMMA)
    seed_request(season, LIAM, household=1000002, person=1000021)
    seed_request(season, RILEY, household=1000003, person=1000031, status="withdrawn")
    log_seeded(season, JAN20)
    assert await service_module.received_moments(season, YEAR) == [JAN20, JAN20]


@pytest.mark.asyncio
async def test_the_share_lines_up_on_this_seasons_deadline() -> None:
    """Regression guard. Last year's deadline was Feb 4; this season's is Feb 3. Read on this season's deadline day:
    week 0, day 0, so 0.5 + (1 - 0.5) x 1/7 = 0.5714. Last year's date moved to this year (Feb 4) would read week -1: 0.5."""
    stepped = ArrivalCurve(
        YEAR - 1,
        "application_deadline",
        LAST_DEADLINE,
        (CurvePoint(-2, Decimal("0.5")), CurvePoint(-1, Decimal("0.5")), CurvePoint(0, Decimal(1))),
        400,
        "workbook",
    )
    world = await _projected_world(stepped)
    projection = (await world.service.evaluate(YEAR, WITH_DEADLINE, request_set=date(YEAR, 2, 3))).projection
    assert projection is not None
    assert projection.share == Decimal("0.5714")


@pytest.mark.asyncio
async def test_an_edited_answer_keeps_its_first_date_and_an_unlogged_request_is_left_out() -> None:
    """Regression guard. Disagreement 8: an edited answer keeps its first date; a request with no create row is out."""
    jan10 = datetime(YEAR, 1, 10, 18, 0, tzinfo=UTC)
    season = FakeDecisionsStore()
    seed_request(season, RILEY, household=1000003, person=1000031, status="withdrawn")
    log_seeded(season, jan10)
    seed_request(season, "req-riley-edited", household=1000003, person=1000031)
    log_seeded(season, JAN20)
    seed_request(season, EMMA)  # live, never logged: no known date
    assert await service_module.received_moments(season, YEAR) == [jan10]


@pytest.mark.asyncio
async def test_a_curve_read_that_raises_gives_no_projection_and_still_evaluates() -> None:
    """A bad curve row or a PocketBase error mutes the estimate; it never closes the read."""

    async def broken(year: int) -> ArrivalCurve | None:
        raise ValueError("unreadable curve row")

    world = await _world(document=WITH_DEADLINE, curves=broken)
    await world.rules.approve_sections(YEAR, 1, ["milestones"], actor=TREASURER, note="Finance committee")
    await world.service.freeze(YEAR, FINANCE)
    evaluation = await world.service.evaluate(YEAR, WITH_DEADLINE)
    assert evaluation.results is not None
    assert evaluation.projection is None
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.projection is None


@pytest.mark.asyncio
async def test_the_workspace_names_last_seasons_approved_version_and_the_draft_where_it_differs() -> None:
    """Task 67: the client's cue for Start from's "(none approved)" and the strip's "posted Round 1 stands"."""
    world = await _frozen()
    assert (await world.service.workspace(YEAR, FINANCE)).last_rules_version is None
    await world.rules.create_version(with_lever(intake_rules(), "year", YEAR - 1), actor=FINANCE)
    await world.rules.approve_sections(YEAR - 1, 1, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    await world.service.save_draft(YEAR, with_minimum(_shifted(intake_rules(), "5"), Decimal(150)), FINANCE)
    workspace = await world.service.workspace(YEAR, FINANCE)
    assert workspace.last_rules_version == 1
    assert workspace.draft is not None
    assert workspace.draft.differs_in == ("award_tables", "awards")


# --- a draft remembers the rules version it was built on (A11) -------------------------------------------------------


async def _v2_approved(world: World) -> None:
    """v1 is in effect, then someone approves a v2 that moves the minimum: the rules in effect are v2 now."""
    await world.rules.create_version(with_minimum(intake_rules(), Decimal(150)), actor=FINANCE)
    await world.rules.approve_sections(YEAR, 2, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")


@pytest.mark.asyncio
async def test_a_draft_kept_after_a_new_approval_records_the_version_it_was_built_on() -> None:
    """Owner 10-07: v1 in effect when the draft starts; v2 approved mid-session; the kept option's origin is v1."""
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.load(YEAR, FINANCE, start="rules")
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await _v2_approved(world)
    kept = await world.service.keep(YEAR, FINANCE)
    assert kept.record.origin_version == 1
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.built_on_version == 1


@pytest.mark.asyncio
async def test_a_first_release_with_no_row_records_the_version_in_effect_then() -> None:
    """The implicit draft (no row yet) is the rules in effect: its first released setting records that version."""
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await _v2_approved(world)
    kept = await world.service.keep(YEAR, FINANCE)
    assert kept.record.origin_version == 1


@pytest.mark.asyncio
async def test_each_later_trail_row_copies_the_previous_rows_version() -> None:
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.load(YEAR, FINANCE, start="rules")
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await _v2_approved(world)
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "6"), FINANCE)  # recorded after v2 is in effect
    versions = [row.built_on_version for row in world.store.rows[AID_SCENARIO_TRAIL]]
    assert versions == [1, 1, 1]


@pytest.mark.asyncio
async def test_a_started_option_and_its_trail_row_record_the_version_it_started_from() -> None:
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)
    [row] = world.store.rows[AID_SCENARIO_TRAIL]
    assert row.built_on_version == 1
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.built_on_version == 1


@pytest.mark.asyncio
async def test_a_draft_loaded_from_a_kept_option_is_built_on_that_options_version() -> None:
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)  # A, origin v1
    await _v2_approved(world)
    await world.service.load(YEAR, TREASURER, option="A")
    draft = (await world.service.workspace(YEAR, TREASURER)).draft
    assert draft is not None
    assert draft.built_on_version == 1


@pytest.mark.asyncio
async def test_a_draft_with_no_recorded_version_reports_none_and_keeps_the_old_behaviour() -> None:
    """Rows from before the field read 0 = not recorded: the draft says None and a keep uses the version read now."""
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.load(YEAR, FINANCE, start="rules")
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    for row in world.store.rows[AID_SCENARIO_TRAIL]:
        row.built_on_version = 0
    await _v2_approved(world)
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert draft.built_on_version is None
    kept = await world.service.keep(YEAR, FINANCE)
    assert kept.record.origin_version == 2


# --- Make … the Rules Draft is off for an option built on an older version (A11) ---------------------------------------


@pytest.mark.asyncio
async def test_an_option_built_on_an_older_version_cannot_be_promoted_until_restarted() -> None:
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.load(YEAR, FINANCE, start="rules")
    await world.service.save_draft(YEAR, _shifted(intake_rules(), "5"), FINANCE)
    await _v2_approved(world)
    kept = await world.service.keep(YEAR, FINANCE)
    options = (await world.service.workspace(YEAR, FINANCE)).options
    option = next(o for o in options if o.record.code == kept.record.code)
    assert (option.promotable, option.blocked) == (
        False,
        "built on v1, v2 is in effect now: start it again from the rules in effect",
    )
    with pytest.raises(ScenarioRefusedError, match="built on v1, v2 is in effect now"):
        await world.service.make_rules_draft(YEAR, kept.record.code, base_version=2, acknowledged={}, actor=FINANCE)
    columns = await world.service.compare(YEAR, FINANCE, codes=[kept.record.code])  # Compare is unaffected
    assert [c.code for c in columns.columns][-1] == kept.record.code


@pytest.mark.asyncio
async def test_an_option_built_on_the_version_in_effect_can_still_be_promoted() -> None:
    """Pin. The check is strictly older: an option on the version in effect now stays promotable."""
    world = await _world()
    await _approved_v1(world)
    await world.service.freeze(YEAR, FINANCE)
    await world.service.start_from_rules(YEAR, FINANCE)
    await _kept_b(world)
    option = next(o for o in (await world.service.workspace(YEAR, FINANCE)).options if o.record.code == "B")
    assert (option.record.origin_version, option.promotable, option.blocked) == (1, True, None)
    _, branched_from = await world.service.make_rules_draft(YEAR, "B", base_version=1, acknowledged={}, actor=FINANCE)
    assert branched_from == 1

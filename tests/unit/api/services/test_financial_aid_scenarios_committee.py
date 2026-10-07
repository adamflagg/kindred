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

from api.constants.collections import AID_SCENARIO_OPTIONS, AID_SCENARIO_TRAIL
from api.services import financial_aid_scenarios_repository as repository_module
from api.services import financial_aid_scenarios_service as service_module
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_rules_service import FinancialAidRulesService
from api.services.financial_aid_scenario_pricing import PricedSeason, SeasonSnapshot, capture_season, price_document
from api.services.financial_aid_scenarios_service import FinancialAidScenariosService, ScenarioRefusedError
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.schema import SECTION_NAMES
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


async def _world(
    *, last_posted: bool = True, this_season: AidRules | None = None, last_has_rules: bool = True
) -> World:
    """`this_season`: 2027's v1 (every section draft); intake_rules() by default. `last_has_rules`: whether last
    season's read finds approved rules."""
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
        last_rules = FakeRules(approved(last_season_rules()) if last_has_rules else None)
        service = FinancialAidDecisionsService(last_store, last_rules, register)
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


# --- RPT-17 / RPT-32: last season, posted ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compare_shows_last_seasons_posted_money_by_tier_with_its_own_rules() -> None:
    world = await _started()
    comparison = await world.service.compare(YEAR, FINANCE, ["A"], last_season=True)
    last = comparison.last_season
    assert last is not None
    assert last.view is not None
    assert (last.year, last.loaded, last.rules_version) == (LAST, True, 1)
    # Its basis and as-of (spec §9.7, §4.7): 2026 is the one-off reproduction; its newest lock is Mar 9 (T0).
    assert last.label == "2026, posted as reproduced from the repaired sheet (as of Mar 9, 2027)"
    assert (last.view.round1, last.view.round2) == (Decimal(2600), Decimal(300))  # Riley was never posted
    assert [(r.table, r.tier, r.fee_pct, r.round1) for r in last.view.round1_by_tier] == [
        ("camp", 2, Decimal(80), Decimal(1500)),  # 2026's table: 80% at tier 2
        ("camp", 3, Decimal(55), Decimal(1100)),
        (None, 2, None, Decimal(1500)),
        (None, 3, None, Decimal(1100)),
    ]
    [camp, every] = last.view.round2_by_tier
    assert (camp.table, camp.tier, camp.appeals, camp.asked, camp.max_pct, camp.round2) == (
        "camp",
        2,
        1,
        Decimal(400),
        Decimal(90),
        Decimal(300),
    )
    assert (every.table, every.priced_asked, every.pct_of_ask) == (None, Decimal(400), Decimal("75.0"))
    assert (last.view.not_in_tiers, last.view.round2_not_in_tiers) == (Decimal(0), Decimal(0))
    assert world.last_season_reads == [LAST]


@pytest.mark.asyncio
async def test_last_season_not_loaded_is_said_not_zeroed() -> None:
    world = await _started(last_posted=False)
    last = (await world.service.compare(YEAR, FINANCE, [], last_season=True)).last_season
    assert last is not None
    assert (last.loaded, last.view, last.rules_version) == (False, None, None)
    assert last.label == "2026's decisions are not loaded yet, so there is no last-season column"
    assert world.last_season_reads == [LAST]


@pytest.mark.asyncio
async def test_last_season_is_read_only_when_asked() -> None:
    world = await _started()
    comparison = await world.service.compare(YEAR, FINANCE, ["A"])
    assert comparison.last_season is None
    assert world.last_season_reads == []


async def _last_rules_approved(world: World, document: AidRules | None = None) -> None:
    version = await world.rules.create_version(document or last_season_rules(), actor=FINANCE)
    await world.rules.approve_sections(
        LAST, version.version, list(SECTION_NAMES), actor=TREASURER, note="Campership committee"
    )


# --- RPT-18: start from last season's rules -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_last_seasons_criteria_on_this_seasons_applications() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    workspace = await world.service.start_from_last_season(YEAR, FINANCE)
    [option] = workspace.options
    # 2027 v1 can't price the season yet (every section draft), so it is named as SP9b names it.
    assert (option.record.code, option.label) == (
        "A",
        "2026 v1 rules on 2027's applications, the rest from rules draft v1",
    )
    # Emma at 2026's 80% of 2,000 = 1,600; Liam's tier 3 is 55% in both: 1,100.
    assert option.record.results.round1 == Decimal(2700)
    assert workspace.draft is not None
    assert workspace.draft.from_code == "A"
    [trail] = (await world.service.trail(YEAR, page=1, per_page=10))[0]
    assert trail.change == "started from 2026 v1 rules on 2027's applications, the rest from rules draft v1"
    comparison = await world.service.compare(YEAR, FINANCE, ["A"])
    committee = comparison.columns[1].committee
    assert committee is not None
    assert (committee.round1, committee.round1_pct_of_budget) == (Decimal(2700), Decimal("0.5"))


@pytest.mark.asyncio
async def test_this_seasons_routing_grants_budget_lines_programs_cost_and_budget_are_kept() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    raw_last = last_season_rules().model_dump(mode="json")
    raw_last["round2"]["program_tables"]["quest"] = "teen"  # a different Round 2 table for one program
    raw_last["grants"]["offset_programs"] = ["summer"]  # and a different set of offset programs
    last = with_levers(
        AidRules.model_validate(raw_last),
        {
            "budget.total": "400000",
            "cost.tuition.1000101": "1800",
            "grants.offset_mode": "reduce_cost_basis",
            "awards.minimum": "150",
            "awards.decision_types.discretionary.label": "Last season's line",
        },
    )
    await _last_rules_approved(world, last)
    workspace = await world.service.start_from_last_season(YEAR, FINANCE)
    document = workspace.options[0].record.document
    this_season = intake_rules()
    assert (document.year, document.budget, document.cost, document.programs) == (
        YEAR,
        this_season.budget,
        this_season.cost,
        this_season.programs,
    )
    assert (document.grants, document.awards.decision_types, document.round2.program_tables) == (
        this_season.grants,
        this_season.awards.decision_types,
        this_season.round2.program_tables,
    )
    assert last.round2.program_tables != this_season.round2.program_tables
    assert last.grants.offset_programs != this_season.grants.offset_programs
    assert document.grants.offset_programs == this_season.grants.offset_programs
    assert (document.award_tables, document.awards.minimum) == (last.award_tables, Decimal(150))


@pytest.mark.asyncio
async def test_a_season_with_no_budget_starts_from_last_seasons_budget_as_a_placeholder() -> None:
    raw = intake_rules().model_dump(mode="json")
    raw["budget"] = {**raw["budget"], "total": "0", "pools": {}, "reserves": {}}
    world = await _world(this_season=AidRules.model_validate(raw))
    await world.service.freeze(YEAR, FINANCE)
    last = with_levers(last_season_rules(), {"budget.total": "400000"})
    await _last_rules_approved(world, last)
    workspace = await world.service.start_from_last_season(YEAR, FINANCE)
    [option] = workspace.options
    assert option.record.document.budget == last.budget
    expected = "2026 v1 rules on 2027's applications, the rest from rules draft v1, and 2026 budget as a placeholder"
    assert option.label == expected
    [trail] = (await world.service.trail(YEAR, page=1, per_page=10))[0]
    assert trail.change == f"started from {expected}"


@pytest.mark.asyncio
async def test_the_placeholder_note_stays_after_this_season_sets_its_own_budget_in_place() -> None:
    raw = intake_rules().model_dump(mode="json")
    raw["budget"] = {**raw["budget"], "total": "0", "pools": {}, "reserves": {}}
    world = await _world(this_season=AidRules.model_validate(raw))
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world, with_levers(last_season_rules(), {"budget.total": "400000"}))
    await world.service.start_from_last_season(YEAR, FINANCE)
    await world.rules.save_sections(YEAR, 1, with_levers(intake_rules(), {"budget.total": "450000"}), actor=FINANCE)
    [option] = (await world.service.workspace(YEAR, FINANCE)).options
    assert option.label.endswith(", and 2026 budget as a placeholder")


@pytest.mark.asyncio
async def test_a_season_with_a_budget_keeps_it_and_the_label_does_not_mention_a_placeholder() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world, with_levers(last_season_rules(), {"budget.total": "400000"}))
    [option] = (await world.service.start_from_last_season(YEAR, FINANCE)).options
    assert option.record.document.budget == intake_rules().budget
    assert "placeholder" not in option.label


@pytest.mark.asyncio
async def test_no_approved_rules_last_season_is_refused() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await world.rules.create_version(last_season_rules(), actor=FINANCE)  # a 2026 draft, never approved
    with pytest.raises(ScenarioRefusedError, match="2026 has no approved rules to start from"):
        await world.service.start_from_last_season(YEAR, FINANCE)
    assert world.store.rows[AID_SCENARIO_OPTIONS] == []
    assert world.store.rows[AID_SCENARIO_TRAIL] == []


@pytest.mark.asyncio
async def test_last_seasons_rules_that_dont_fit_this_seasons_programs_are_refused() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    raw = last_season_rules().model_dump(mode="json")
    raw["programs"]["teen"]["r1_table"] = "camp"  # 2026 had no teen table
    del raw["award_tables"]["teen"]
    await _last_rules_approved(world, AidRules.model_validate(raw))
    with pytest.raises(
        ScenarioRefusedError, match=r"2026's criteria don't fit 2027's rules draft \(programs\.teen\.r1_table"
    ):
        await world.service.start_from_last_season(YEAR, FINANCE)
    assert world.store.rows[AID_SCENARIO_OPTIONS] == []
    assert world.store.rows[AID_SCENARIO_TRAIL] == []


@pytest.mark.asyncio
async def test_the_rules_drafts_own_errors_never_block_a_start_from_last_season() -> None:
    raw = intake_rules().model_dump(mode="json")
    del raw["round2"]["program_tables"]["quest"]  # the 2027 draft's own error: quest names no Round 2 table
    world = await _world(this_season=AidRules.model_validate(raw))
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    workspace = await world.service.start_from_last_season(YEAR, FINANCE)
    assert [option.record.code for option in workspace.options] == ["A"]


@pytest.mark.asyncio
async def test_starting_from_last_season_again_loads_the_option_it_made() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    await world.service.start_from_last_season(YEAR, FINANCE)
    again = await world.service.start_from_last_season(YEAR, TREASURER)
    assert [o.record.code for o in again.options] == ["A"]
    assert again.draft is not None
    assert again.draft.from_code == "A"


@pytest.mark.asyncio
async def test_a_plain_start_from_the_rules_keeps_its_name_when_last_seasons_criteria_match() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world, with_levers(intake_rules(), {"year": LAST}))
    workspace = await world.service.start_from_rules(YEAR, FINANCE)
    assert workspace.options[0].label == "rules draft v1 as they were"


@pytest.mark.asyncio
async def test_a_plain_start_from_the_rules_keeps_its_name_after_an_edit_in_place_when_the_criteria_match() -> None:
    # A season started from last year's rules carries their criteria (start_from_last_year), so a plain start from
    # the rules matches last season's criteria; an edit in place to the draft must not rename it a last-season start.
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world, with_levers(intake_rules(), {"year": LAST}))
    await world.service.start_from_rules(YEAR, FINANCE)
    saved = await world.rules.save_sections(
        YEAR, 1, with_levers(intake_rules(), {"budget.total": "450000"}), actor=FINANCE
    )
    assert (saved.branched_from, saved.version.version) == (None, 1)  # in place: the option's origin moved
    workspace = await world.service.workspace(YEAR, FINANCE)
    assert workspace.options[0].label == "rules draft v1 as they were"


@pytest.mark.asyncio
async def test_a_start_from_last_season_keeps_its_name_after_the_rules_draft_is_edited_in_place() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    await world.service.start_from_last_season(YEAR, FINANCE)
    saved = await world.rules.save_sections(
        YEAR, 1, with_levers(intake_rules(), {"budget.total": "450000"}), actor=FINANCE
    )
    assert (saved.branched_from, saved.version.version) == (None, 1)  # in place: the option's origin moved
    workspace = await world.service.workspace(YEAR, FINANCE)
    # Expectation changed with the placeholder rule: the label says what the option holds now (2026's budget, which
    # today's draft no longer has), not how it was started.
    assert workspace.options[0].label == (
        "2026 v1 rules on 2027's applications, the rest from rules draft v1, and 2026 budget as a placeholder"
    )


# --- SP9c final review: the last-season label on a request set, up/down references, and last season's edges -------


@pytest.mark.asyncio
async def test_last_season_says_it_is_every_request_when_a_request_set_is_on() -> None:
    world = await _started()
    plain = (await world.service.compare(YEAR, FINANCE, ["A"], last_season=True)).last_season
    on_a_set = (
        await world.service.compare(YEAR, FINANCE, ["A"], request_set=date(YEAR, 12, 31), last_season=True)
    ).last_season
    assert plain is not None
    assert on_a_set is not None
    assert plain.label == "2026, posted as reproduced from the repaired sheet (as of Mar 9, 2027)"
    assert on_a_set.label == "2026, posted as reproduced from the repaired sheet (as of Mar 9, 2027), every request"
    assert on_a_set.view == plain.view  # the whole season either way


@pytest.mark.asyncio
async def test_a_starting_point_kept_before_sp9c_used_only_as_a_reference_prices_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    world = await _started()
    await world.service.save_draft(
        YEAR, with_levers(intake_rules(), {"award_tables.camp.tiers.2.r1_pct": "80"}), FINANCE
    )
    await world.service.keep(YEAR, FINANCE)  # B, kept with the committee's rows
    [start] = [row for row in world.store.rows[AID_SCENARIO_OPTIONS] if row.code == "A"]
    start.results = {**start.results, "committee_rows": False}  # A as SP9b stored it
    priced: list[AidRules] = []

    async def counting(snapshot: SeasonSnapshot, document: AidRules, *args: Any, **kwargs: Any) -> PricedSeason:
        priced.append(document)
        return await price_document(snapshot, document, *args, **kwargs)

    monkeypatch.setattr(service_module, "price_document", counting)
    comparison = await world.service.compare(YEAR, FINANCE, ["B"])
    # the draft only: B's figures are stored, and the yardstick is A's stored Round 1 (A is the rules in effect)
    assert len(priced) == 1
    kept = comparison.columns[1]
    assert (kept.code, kept.up, kept.down) == ("B", 1, 0)  # Emma's tier 2 went from 75% to 80%


@pytest.mark.asyncio
async def test_last_season_with_no_approved_rules_shows_its_posted_money_with_no_rules_figures() -> None:
    world = await _started(last_has_rules=False)
    last = (await world.service.compare(YEAR, FINANCE, [], last_season=True)).last_season
    assert last is not None
    assert last.view is not None
    assert (last.loaded, last.rules_version) == (True, None)
    assert (last.view.budget_total, last.view.round1_pct_of_budget, last.view.round1) == (None, None, Decimal(2600))
    assert [(r.table, r.tier, r.fee_pct, r.round1) for r in last.view.round1_by_tier] == [
        ("", 2, None, Decimal(1500)),  # no rules: no table, no fee %
        ("", 3, None, Decimal(1100)),
        (None, 2, None, Decimal(1500)),
        (None, 3, None, Decimal(1100)),
    ]
    assert [(r.table, r.max_pct) for r in last.view.round2_by_tier] == [("", None), (None, None)]


@pytest.mark.asyncio
async def test_last_season_without_a_season_read_is_refused() -> None:
    world = await _started()
    service = FinancialAidScenariosService(world.store, world.rules, _no_capture)
    with pytest.raises(ScenarioRefusedError, match="Last season can't be read here"):
        await service.last_season(YEAR)
    with pytest.raises(ScenarioRefusedError, match="Last season can't be read here"):
        await service.compare(YEAR, FINANCE, [], last_season=True)


async def _no_capture(year: int) -> SeasonSnapshot:
    raise AssertionError("never captured")


@pytest.mark.asyncio
async def test_last_seasons_rules_load_as_a_built_in_start_and_write_no_option() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    draft = await world.service.load(YEAR, FINANCE, start="last_rules")
    # Emma at 2026's 80% of 2,000 = 1,600; Liam's tier 3 is 55% in both: 1,100.
    assert (draft.from_code, draft.label) == ("last_rules", "no changes")
    assert draft.results is not None
    assert draft.results.round1 == Decimal(2700)
    assert world.store.rows[AID_SCENARIO_OPTIONS] == []
    [trail] = (await world.service.trail(YEAR, page=1, per_page=10))[0]
    assert (trail.from_code, trail.change) == (
        "last_rules",
        "started from 2026 v1 rules on 2027's applications, the rest from rules draft v1",
    )


@pytest.mark.asyncio
async def test_last_seasons_rules_as_a_start_keep_their_two_refusals() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await world.rules.create_version(last_season_rules(), actor=FINANCE)  # a 2026 draft, never approved
    with pytest.raises(ScenarioRefusedError, match="2026 has no approved rules to start from"):
        await world.service.load(YEAR, FINANCE, start="last_rules")
    assert world.store.rows[AID_SCENARIO_TRAIL] == []


@pytest.mark.asyncio
async def test_last_seasons_rules_that_dont_fit_are_refused_as_a_start_too() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    raw = last_season_rules().model_dump(mode="json")
    raw["programs"]["teen"]["r1_table"] = "camp"  # 2026 had no teen table
    del raw["award_tables"]["teen"]
    await _last_rules_approved(world, AidRules.model_validate(raw))
    with pytest.raises(ScenarioRefusedError, match=r"2026's criteria don't fit 2027's rules in effect \("):
        await world.service.load(YEAR, FINANCE, start="last_rules")
    assert world.store.rows[AID_SCENARIO_TRAIL] == []


@pytest.mark.asyncio
async def test_a_draft_from_last_seasons_rules_still_opens_after_the_rules_in_effect_stop_fitting_them() -> None:
    """Disagreement 16 (plan review M2): the two refusals guard a load only. 2027 v1 sends teen to the camp table, so
    2026's rules (no teen table) fit and load. Then v2, which sends teen to its own table, is approved: a new load is
    refused, but the recorded draft still reads, so finance can still reach Start from."""
    camp_only = intake_rules().model_dump(mode="json")
    camp_only["programs"]["teen"]["r1_table"] = "camp"
    world = await _world(this_season=AidRules.model_validate(camp_only))
    await world.service.freeze(YEAR, FINANCE)
    raw = last_season_rules().model_dump(mode="json")
    raw["programs"]["teen"]["r1_table"] = "camp"  # 2026 had no teen table
    del raw["award_tables"]["teen"]
    await _last_rules_approved(world, AidRules.model_validate(raw))
    await world.service.load(YEAR, FINANCE, start="last_rules")
    v2 = await world.rules.create_version(intake_rules(), actor=FINANCE)
    await world.rules.approve_sections(YEAR, v2.version, list(SECTION_NAMES), actor=TREASURER, note="Finance committee")
    refused = r"2026's criteria don't fit 2027's rules in effect \(programs\.teen"
    with pytest.raises(ScenarioRefusedError, match=refused):
        await world.service.load(YEAR, FINANCE, start="last_rules")
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    # Its source is now the merge on v2 (teen to its own table); the recorded draft kept v1's routing (teen to camp).
    # Only programs.teen.r1_table differs, one change on the Programs card.
    assert (draft.from_code, draft.label) == ("last_rules", "Programs and their sessions: 1 change")


@pytest.mark.asyncio
async def test_a_draft_from_last_seasons_rules_reads_as_its_own_document_when_last_season_has_no_rules_any_more(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression guard. Disagreement 16, the `last is None` fallback of a read: the source is the row's own document."""
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    await world.service.load(YEAR, FINANCE, start="last_rules")

    async def _none(year: int) -> None:
        return None

    monkeypatch.setattr(world.service, "_last_rules", _none)
    draft = (await world.service.workspace(YEAR, FINANCE)).draft
    assert draft is not None
    assert (draft.from_code, draft.label) == ("last_rules", "no changes")


@pytest.mark.asyncio
async def test_last_seasons_rules_column_prices_the_merge_on_these_applications() -> None:
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    await _last_rules_approved(world)
    [column] = (await world.service.compare(YEAR, FINANCE, [], last_rules=True, draft=False)).columns
    # Emma at 2026's 80% (1,600, up from 1,500 under the rules in effect); Liam unchanged at 1,100.
    assert (column.code, column.version, column.results.round1, column.up, column.down) == (
        "last_rules",
        1,
        Decimal(2700),
        1,
        0,
    )


@pytest.mark.asyncio
async def test_last_season_posted_reads_by_pool_from_its_posted_cells() -> None:
    """§S11.2: each pool's Posted cell per round; Allocated is last season's pool allocation (500,000 × 80%);
    Remaining is Allocated − Posted. Never an estimate."""
    world = await _started()
    last = (await world.service.compare(YEAR, FINANCE, ["A"], last_season=True)).last_season
    assert last is not None
    camp = next(p for p in last.pools if p.pool == "camp_pool")
    assert (camp.round1, camp.round2, camp.round3) == (Decimal(2600), Decimal(300), Decimal(0))
    assert (camp.round1_allocated, camp.remaining) == (Decimal("400000.00"), Decimal("397100.00"))
    assert last.round3 == Decimal(0)


@pytest.mark.asyncio
async def test_a_last_seasons_rules_column_that_does_not_fit_is_left_out_with_the_reason() -> None:
    """Disagreement 16 (plan review, minor 5): the merge's refusal leaves that one column out and says why; the
    other columns still price. 2026 had no teen table, and 2027 v1 sends teen to its own."""
    world = await _world()
    await world.service.freeze(YEAR, FINANCE)
    raw = last_season_rules().model_dump(mode="json")
    raw["programs"]["teen"]["r1_table"] = "camp"
    del raw["award_tables"]["teen"]
    await _last_rules_approved(world, AidRules.model_validate(raw))
    comparison = await world.service.compare(YEAR, FINANCE, [], rules=True, last_rules=True, draft=False)
    assert [c.code for c in comparison.columns] == ["rules"]
    assert comparison.last_rules_refused is not None
    assert comparison.last_rules_refused.startswith(
        "2026's criteria don't fit 2027's rules in effect (programs.teen.r1_table"
    )


@pytest.mark.asyncio
async def test_last_season_not_loaded_has_no_pools() -> None:
    world = await _started(last_posted=False)
    last = (await world.service.compare(YEAR, FINANCE, [], last_season=True)).last_season
    assert last is not None
    assert (last.loaded, last.pools, last.round3) == (False, (), Decimal(0))

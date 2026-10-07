"""The rules draft (SP9a; spec §7.5, D39, D76): section saves that never overwrite the newest approved copy
of a section, the Rules tab's draft read, D76's approved read, and making a kept option the rules draft.
FinancialAidRulesService over the in-memory FakeStore; fictional season 2031 only."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from api.services.financial_aid_rules_service import (
    BUDGET_TOTAL_LOCKED,
    PRICING_SECTIONS,
    BudgetTotalLockedError,
    FinancialAidRulesService,
    FixedSettingError,
    NotLatestVersionError,
    PricingVersionInUseError,
    ReplacementNotAcknowledgedError,
    RulesNotFoundError,
    SectionInvalidError,
    YearMismatchError,
    parse_section,
)
from bunking.financial_aid.change_diff import FieldChange
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.lifecycle import LockedSectionInvalidatedError
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.financial_aid.rules.validation import ValidationIssue, ValidationReport, validate_rules
from tests.unit.api.services.decisions_fakes import T0
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json, with_lever, with_levers

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"


def _service(store: FakeStore) -> FinancialAidRulesService:
    return FinancialAidRulesService(store, clock=lambda: AT)


async def _approved_v1(store: FakeStore) -> FinancialAidRulesService:
    """2031 version 1 with every section approved: the version pricing the season."""
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    return service


def _minimum(rules: AidRules, amount: str) -> AidRules:
    return with_lever(rules, "awards.minimum", amount)


# --- parse_section ---------------------------------------------------------------------------------


def test_a_section_is_parsed_into_the_whole_document() -> None:
    awards = fictional_rules_json()["awards"] | {"minimum": "150"}
    parsed = parse_section(fictional_rules(), "awards", awards)
    assert parsed.awards.minimum == Decimal(150)
    assert parsed.income == fictional_rules().income


def test_a_section_that_does_not_parse_is_refused_naming_the_field() -> None:
    awards = fictional_rules_json()["awards"] | {"minimum": "-5"}
    with pytest.raises(SectionInvalidError, match=r"awards\.minimum"):
        parse_section(fictional_rules(), "awards", awards)


@pytest.mark.asyncio
async def test_the_draft_and_approved_reads_name_the_groups() -> None:
    service = await _approved_v1(FakeStore())
    draft = await service.draft_view(2031)
    approved = await service.approved_view(2031)
    assert [g.label for g in draft.groups] == ["Camp", "Weekends", "B'mitzvah"]
    assert approved.groups == draft.groups


@pytest.mark.asyncio
async def test_a_receipts_version_read_names_that_versions_groups() -> None:
    """Pin: the groups come from the version asked for, not the one pricing the season. Version 2 renames the Camp
    pool and prices the season, so only a read of version 1's own document still says "Camp"."""
    service = await _approved_v1(FakeStore())
    renamed = with_lever(fictional_rules(), "budget.pools.camp_pool.label", "Pool A")
    await service.save_sections(2031, 1, renamed, actor=TREASURER)
    await service.approve_sections(2031, 2, list(SECTION_NAMES), actor=FINANCE, note="Board, Feb 1")
    assert [g.label for g in (await service.approved_view(2031)).groups] == ["Pool A", "Weekends", "B'mitzvah"]
    approved = await service.approved_view(2031, 1)
    assert [g.label for g in approved.groups] == ["Camp", "Weekends", "B'mitzvah"]


@pytest.mark.asyncio
async def test_a_version_read_never_names_groups_from_a_draft_programs_or_budget_section() -> None:
    """D76: a draft section has no content on the approved read, so its pool labels and classes stay hidden too.
    Version 2 holds an approved section but its renamed budget is still a draft."""
    service = await _approved_v1(FakeStore())
    renamed = with_lever(fictional_rules(), "budget.pools.camp_pool.label", "Pool A")
    await service.save_sections(2031, 1, renamed, actor=TREASURER)
    v2 = await service.load(2031, 2)
    assert v2.section_status["budget"].state not in ("approved", "locked")
    assert any(v2.section_status[n].state in ("approved", "locked") for n in SECTION_NAMES)
    assert (await service.approved_view(2031, 2)).groups == ()


# --- save_sections ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_edit_to_a_draft_section_saves_in_place_and_is_stamped() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    saved = await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (None, 1)
    assert saved.version.document.awards.minimum == Decimal(150)
    awards = saved.version.section_status["awards"]
    assert (awards.state, awards.edited_by, awards.edited_at, awards.edited_via) == ("draft", TREASURER, AT, None)
    assert saved.version.section_status["income"].edited_by is None
    [row] = store.operations[-1]
    assert (row["action"], row["entity_id"], row["actor"]) == ("save", "2031:1", TREASURER)


@pytest.mark.asyncio
async def test_an_edit_to_an_approved_section_branches_a_new_version() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    saved = await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER, via="B2")
    assert (saved.branched_from, saved.version.version, saved.version.parent_version) == (1, 2, 1)
    status = saved.version.section_status
    assert (status["awards"].state, status["awards"].edited_via) == ("draft", "B2")
    assert status["income"].state == "approved"  # carried
    v1 = await service.load(2031, 1)
    assert (v1.document.awards.minimum, v1.section_status["awards"].state) == (Decimal(100), "approved")
    [row] = store.operations[-1]
    assert (row["action"], row["entity_id"]) == ("save", "2031:2")


@pytest.mark.asyncio
async def test_an_edit_to_a_section_carried_from_the_parent_saves_in_place() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    v2 = await service.load(2031, 2)  # awards draft, so v2 does not price the season
    again = await service.save_sections(2031, 2, with_lever(v2.document, "income.floor", "500"), actor=TREASURER)
    assert (again.branched_from, again.version.version) == (None, 2)
    assert again.version.section_status["income"].state == "draft"
    assert (await service.load(2031, 1)).document.income.floor == Decimal(0)


@pytest.mark.asyncio
async def test_an_edit_to_the_version_pricing_the_season_always_branches() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Jan 15")
    v2 = await service.load(2031, 2)  # every section approved again: v2 prices the season
    saved = await service.save_sections(2031, 2, with_lever(v2.document, "income.floor", "500"), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (2, 3)
    assert (await service.load(2031, 2)).section_status["income"].state == "approved"


@pytest.mark.asyncio
async def test_an_edit_to_a_locked_section_branches_and_unlocks_only_that_section() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    await service.lock_section(2031, 1, "tiers", actor=FINANCE)
    saved = await service.save_sections(2031, 1, with_lever(fictional_rules(), "income.floor", "500"), actor=TREASURER)
    status = saved.version.section_status
    assert saved.branched_from == 1
    assert (status["income"].state, status["tiers"].state) == ("draft", "locked")
    assert (await service.load(2031, 1)).section_status["income"].state == "locked"


@pytest.mark.asyncio
async def test_a_lock_carried_from_the_parent_is_lifted_in_place() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    await service.lock_section(2031, 1, "tiers", actor=FINANCE)
    await service.save_sections(2031, 1, with_lever(fictional_rules(), "income.floor", "500"), actor=TREASURER)
    v2 = await service.load(2031, 2)
    saved = await service.save_sections(
        2031, 2, with_lever(v2.document, "tiers.income_ceiling", "900000"), actor=TREASURER
    )
    assert (saved.branched_from, saved.version.version) == (None, 2)
    assert saved.version.section_status["tiers"].state == "draft"
    assert (await service.load(2031, 1)).section_status["tiers"].state == "locked"


@pytest.mark.asyncio
async def test_a_save_against_an_older_version_is_refused() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    before = len(store.operations)
    with pytest.raises(NotLatestVersionError):
        await service.save_sections(2031, 1, _minimum(fictional_rules(), "175"), actor=FINANCE)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_save_that_changes_nothing_writes_nothing() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    before = len(store.operations)
    saved = await service.save_sections(2031, 1, fictional_rules(), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (None, 1)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_an_edit_that_would_break_a_locked_section_is_refused() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "programs", actor=FINANCE)
    broken = fictional_rules_json()
    del broken["award_tables"]["teen"]  # programs.teen.r1_table now names no table
    before = len(store.operations)
    with pytest.raises(LockedSectionInvalidatedError):
        await service.save_sections(2031, 1, AidRules.model_validate(broken), actor=TREASURER)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_document_for_another_season_is_refused() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    with pytest.raises(YearMismatchError):
        await service.save_sections(2031, 1, with_lever(fictional_rules(), "year", 2030), actor=TREASURER)


@pytest.mark.asyncio
async def test_a_section_save_merges_into_the_version_it_loads_not_an_earlier_read() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, with_lever(fictional_rules(), "income.floor", "500"), actor=FINANCE)  # v2
    awards = fictional_rules_json()["awards"] | {"minimum": "150"}
    saved = await service.save_section(2031, 2, "awards", awards, actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (None, 2)
    assert saved.version.document.income.floor == Decimal(500)  # the save that landed first is kept
    assert saved.version.document.awards.minimum == Decimal(150)
    assert saved.version.section_status["awards"].edited_by == TREASURER
    assert saved.version.section_status["income"].edited_by == FINANCE


@pytest.mark.asyncio
async def test_a_section_save_that_does_not_parse_is_refused_and_writes_nothing() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    before = len(store.operations)
    with pytest.raises(SectionInvalidError, match=r"awards\.minimum"):
        await service.save_section(
            2031, 1, "awards", fictional_rules_json()["awards"] | {"minimum": "-5"}, actor=FINANCE
        )
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_section_save_against_an_older_version_is_refused() -> None:
    service = await _approved_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    with pytest.raises(NotLatestVersionError):
        await service.save_section(2031, 1, "awards", fictional_rules_json()["awards"], actor=FINANCE)


def test_pricing_reads_the_same_sections_the_decisions_service_did() -> None:
    from api.services import financial_aid_decisions_service

    assert financial_aid_decisions_service.PRICING_SECTIONS is PRICING_SECTIONS


def _without_bmitzvah_pool(document: AidRules) -> AidRules:
    body = document.model_dump(mode="json")
    del body["budget"]["pools"]["bmitzvah_pool"]  # programs.bmitzvah.budget_pool now names no pool
    return AidRules.model_validate(body)


@pytest.mark.asyncio
async def test_an_edit_to_a_draft_section_that_knocks_back_an_approved_one_branches() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    others = [name for name in SECTION_NAMES if name != "budget"]
    await service.approve_sections(2031, 1, others, actor=FINANCE, note="Board, Jan 8")  # budget stays draft
    saved = await service.save_sections(2031, 1, _without_bmitzvah_pool(fictional_rules()), actor=TREASURER)
    # Only `budget` changed, and it is a draft, so it alone would not branch: the branch is decided over the
    # sections the edit touched, which includes approved programs, sent back to draft by the pool it can no
    # longer find.
    assert (saved.branched_from, saved.version.version) == (1, 2)
    status = saved.version.section_status
    assert (status["budget"].state, status["programs"].state) == ("draft", "draft")
    assert status["programs"].edited_by == TREASURER  # a reverted section is stamped too
    assert (await service.load(2031, 1)).section_status["programs"].state == "approved"
    latest = await service.latest_approved(2031, ["programs"])
    assert latest is not None
    assert latest.version == 1


@pytest.mark.asyncio
async def test_a_version_the_intake_reads_is_protected_even_when_it_does_not_price() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    v2 = await service.load(2031, 2)  # awards is draft: v2 does not price, but programs and cost are approved
    saved = await service.save_sections(2031, 2, _without_teen_table_of(v2.document), actor=TREASURER)
    assert saved.branched_from == 2
    assert (await service.load(2031, 2)).section_status["programs"].state == "approved"


def _without_teen_table_of(document: AidRules) -> AidRules:
    body = document.model_dump(mode="json")
    del body["award_tables"]["teen"]
    return AidRules.model_validate(body)


@pytest.mark.asyncio
async def test_an_approved_section_on_a_version_not_pricing_and_not_a_copy_branches() -> None:
    """Decision 2(b): approved on this version itself (its parent holds it as a draft), so this is the newest
    approved copy, though the version prices nothing and feeds no intake."""
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, ["income"], actor=FINANCE, note="Board, Jan 8")
    await service.save_sections(2031, 1, with_lever(fictional_rules(), "income.floor", "500"), actor=TREASURER)
    v2 = await service.load(2031, 2)  # branched: income draft on v2
    await service.approve_sections(2031, 2, ["income"], actor=FINANCE, note="Board, Feb 1")
    saved = await service.save_sections(2031, 2, with_lever(v2.document, "income.floor", "600"), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (2, 3)
    assert (await service.load(2031, 2)).section_status["income"].state == "approved"


@pytest.mark.asyncio
async def test_a_branched_version_replays_through_approved_as_of() -> None:
    clock_now = [AT]
    store = FakeStore(clock=lambda: clock_now[0])
    service = FinancialAidRulesService(store, clock=lambda: clock_now[0])
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    clock_now[0] = AT + timedelta(days=10)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    clock_now[0] = AT + timedelta(days=20)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Feb 1")
    before = await service.approved_as_of(2031, PRICING_SECTIONS, AT + timedelta(days=15))
    after = await service.approved_as_of(2031, PRICING_SECTIONS, AT + timedelta(days=25))
    assert before is not None
    assert after is not None
    assert (before.version, after.version) == (1, 2)
    assert after.document.awards.minimum == Decimal(150)


# --- quality_checks prices the season ---------------------------------------------------------------------


def test_quality_checks_is_a_pricing_section() -> None:
    assert "quality_checks" in PRICING_SECTIONS


@pytest.mark.asyncio
async def test_a_draft_quality_checks_section_does_not_change_the_version_pricing_the_season() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    lax = with_lever(fictional_rules(), "quality_checks.checks.household_income_conflict", {"severity": "warn"})
    saved = await service.save_sections(2031, 1, lax, actor=TREASURER)
    assert saved.branched_from == 1  # branches rather than editing the version pricing the season
    assert (await service.latest_approved(2031, PRICING_SECTIONS)).version == 1  # type: ignore[union-attr]
    assert (await service.load(2031, 1)).document.quality_checks == fictional_rules().quality_checks
    draft = await service.draft_view(2031)
    assert draft.approved_version == 1
    assert {s.section: len(s.changes) for s in draft.sections}["quality_checks"] > 0


# --- the whole-document save (save) refuses to overwrite approved rules in use -------------------------


@pytest.mark.asyncio
async def test_a_whole_document_save_over_approved_pricing_rules_is_refused() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    before = len(store.operations)
    with pytest.raises(PricingVersionInUseError, match="section editor") as refused:
        await service.save(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    assert "awards" in str(refused.value)
    assert "prices the season" in str(refused.value)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_whole_document_save_that_only_knocks_back_an_approved_section_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = FakeStore()
    service = await _priced_v1(store)
    # No real edit reaches this path on a pricing version today (the only draft sections are stages,
    # quality_checks and milestones, and their validators flag only themselves), so the validator is stubbed:
    # the save changes nothing, but the candidate gains an error in approved `programs` that the stored
    # document lacks. That is a knock-back and nothing else.
    real = validate_rules
    calls: list[int] = []

    def flagging(document: AidRules, context: object) -> ValidationReport:
        calls.append(1)
        report = real(document, context)  # type: ignore[arg-type]
        if len(calls) < 2:  # the first call validates the stored document, the second the candidate
            return report
        issue = ValidationIssue(section="programs", code="stub", severity="error", path="programs", message="stub")
        return ValidationReport(issues=[*report.issues, issue])

    monkeypatch.setattr("api.services.financial_aid_rules_service.validate_rules", flagging)
    before = len(store.operations)
    with pytest.raises(PricingVersionInUseError):
        await service.save(2031, 1, fictional_rules(), actor=TREASURER)
    assert len(store.operations) == before
    assert (await service.load(2031, 1)).section_status["programs"].state == "approved"


async def _intake_only_v2(store: FakeStore) -> FinancialAidRulesService:
    """v1 prices the season; v2 (awards back to draft) is the newest version with programs and cost approved,
    so intake reads v2 for them while pricing stays on v1."""
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    assert (await service.latest_approved(2031, PRICING_SECTIONS)).version == 1  # type: ignore[union-attr]
    return service


@pytest.mark.asyncio
async def test_a_whole_document_save_over_approved_programs_or_cost_that_intake_reads_is_refused() -> None:
    store = FakeStore()
    service = await _intake_only_v2(store)
    before = len(store.operations)
    for lever, value in (("cost.infant_age_cutoff_months", 30), ("programs.quest.label", "Quest II")):
        edited = with_lever(_minimum(fictional_rules(), "150"), lever, value)
        with pytest.raises(PricingVersionInUseError) as refused:
            await service.save(2031, 2, edited, actor=TREASURER)
        assert lever.split(".")[0] in str(refused.value)
        assert "read by intake" in str(refused.value)
        assert "prices the season" not in str(refused.value)
    assert len(store.operations) == before
    status = (await service.load(2031, 2)).section_status
    assert (status["programs"].state, status["cost"].state) == ("approved", "approved")


@pytest.mark.asyncio
async def test_a_whole_document_save_of_a_draft_section_on_the_intake_version_still_saves() -> None:
    store = FakeStore()
    service = await _intake_only_v2(store)
    saved, _ = await service.save(2031, 2, _minimum(fictional_rules(), "175"), actor=TREASURER)
    assert saved.document.awards.minimum == Decimal(175)


@pytest.mark.asyncio
async def test_a_whole_document_save_on_a_version_not_in_use_still_saves() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)  # bootstrap-shaped: nothing approved
    await service.approve_sections(2031, 1, ["income"], actor=FINANCE, note="Board")
    saved, _ = await service.save(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    assert saved.document.awards.minimum == Decimal(150)


@pytest.mark.asyncio
async def test_a_whole_document_save_clears_an_earlier_editors_stamp_on_the_section_it_changes() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)  # every section a draft
    edited = with_lever(_minimum(fictional_rules(), "150"), "income.floor", "500")
    await service.save_sections(2031, 1, edited, actor=TREASURER)  # awards and income stamped
    saved, _ = await service.save(
        2031, 1, with_lever(_minimum(fictional_rules(), "175"), "income.floor", "500"), actor=FINANCE
    )
    # The whole-document save doesn't stamp (plan Decision 4), so it must not leave the earlier editor's stamp
    # naming someone who no longer made the section's last change; a section it left alone keeps its stamp.
    awards = saved.section_status["awards"]
    assert (awards.edited_by, awards.edited_at, awards.edited_via) == (None, None, None)
    assert saved.section_status["income"].edited_by == TREASURER


# --- a first lock under an open rules draft ------------------------------------------------------------


async def _commit(store: FakeStore, writes: list[AidWrite]) -> None:
    if writes:
        await store.commit(writes, actor=FINANCE)


@pytest.mark.asyncio
async def test_on_the_latest_version_a_first_lock_locks_there_as_before() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    writes, not_locked = await service.lock_writes(2031, 1, ["income", "tiers"])
    assert ([w.entity_id for w in writes], not_locked) == (["2031:1:income", "2031:1:tiers"], [])


@pytest.mark.asyncio
async def test_a_first_lock_under_an_open_draft_locks_the_drafts_identical_sections() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # v2, awards draft
    writes, not_locked = await service.lock_writes(2031, 1, ["income", "tiers", "awards"])
    assert [w.entity_id for w in writes] == ["2031:2:income", "2031:2:tiers"]
    assert not_locked == ["awards"]  # the draft's own edit stays unlocked
    await _commit(store, writes)
    v2, v1 = await service.load(2031, 2), await service.load(2031, 1)
    assert (v2.section_status["income"].state, v2.section_status["awards"].state) == ("locked", "draft")
    assert v1.section_status["income"].state == "approved"  # writes only ever go to the latest


@pytest.mark.asyncio
async def test_a_section_the_draft_changed_stays_unlocked_even_once_approved_there() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Feb 3")
    writes, not_locked = await service.lock_writes(2031, 1, ["awards"])
    assert (writes, not_locked) == ([], ["awards"])


@pytest.mark.asyncio
async def test_a_section_already_locked_in_the_draft_needs_no_write() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # v2
    await _commit(store, (await service.lock_writes(2031, 1, ["income"]))[0])  # an earlier tick locked it on v2
    writes, not_locked = await service.lock_writes(2031, 1, ["income", "tiers"])
    assert ([w.entity_id for w in writes], not_locked) == (["2031:2:tiers"], [])


@pytest.mark.asyncio
async def test_a_draft_with_a_validation_error_locks_nothing_and_says_so() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    broken = fictional_rules_json()
    del broken["award_tables"]["teen"]  # programs.teen.r1_table names no table: an error in programs
    await service.save_sections(2031, 1, AidRules.model_validate(broken), actor=TREASURER)  # v2, with the error
    writes, not_locked = await service.lock_writes(2031, 1, ["income", "tiers"])
    assert (writes, not_locked) == ([], ["income", "tiers"])


@pytest.mark.asyncio
async def test_a_lock_written_on_the_draft_reads_back_through_approved_as_of() -> None:
    now = [AT]
    store = FakeStore(clock=lambda: now[0])
    service = FinancialAidRulesService(store, clock=lambda: now[0])
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    now[0] = AT + timedelta(days=10)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # v2, awards draft
    now[0] = AT + timedelta(days=20)
    writes, _ = await service.lock_writes(2031, 1, ["income"])
    await _commit(store, writes)
    early = await service.approved_as_of(2031, ["income"], AT + timedelta(days=15))
    late = await service.approved_as_of(2031, ["income"], AT + timedelta(days=25))
    assert early is not None
    assert late is not None
    assert (early.version, early.section_status["income"].state) == (2, "approved")
    assert (late.version, late.section_status["income"].state) == (2, "locked")


@pytest.mark.asyncio
async def test_editing_a_section_locked_on_the_draft_branches_and_the_old_draft_keeps_the_lock() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # v2, awards draft
    await _commit(store, (await service.lock_writes(2031, 1, ["income"]))[0])  # income locked on v2 only
    v2 = await service.load(2031, 2)
    saved = await service.save_sections(2031, 2, with_lever(v2.document, "income.floor", "500"), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (2, 3)
    assert saved.version.section_status["income"].state == "draft"
    assert (await service.load(2031, 2)).section_status["income"].state == "locked"


@pytest.mark.asyncio
async def test_a_draft_section_cannot_lock_and_is_reported() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # v2: awards is draft
    writes, not_locked = await service.lock_writes(2031, 2, ["awards", "income"])
    assert ([w.entity_id for w in writes], not_locked) == (["2031:2:income"], ["awards"])


# --- draft_view and approved_view --------------------------------------------------------------------


async def _priced_v1(store: FakeStore) -> FinancialAidRulesService:
    """Version 1 with only the pricing sections approved: stages, quality_checks and milestones stay draft."""
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board, Jan 8")
    return service


@pytest.mark.asyncio
async def test_the_approved_read_is_the_pricing_version_and_never_shows_a_draft_section() -> None:
    service = await _priced_v1(FakeStore())
    approved = await service.approved_view(2031)
    assert (approved.year, approved.version) == (2031, 1)
    sections = {s.section: s for s in approved.sections}
    assert sections["income"].content == fictional_rules().model_dump(mode="json")["income"]
    assert (sections["income"].status.approved_by, sections["income"].version) == (FINANCE, 1)
    assert (sections["milestones"].content, sections["milestones"].version) == (None, None)  # approved nowhere
    assert sections["milestones"].status.state == "draft"


@pytest.mark.asyncio
async def test_the_approved_read_stays_on_the_approved_version_while_a_draft_is_open() -> None:
    service = await _priced_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)  # branches v2
    approved = {s.section: s for s in (await service.approved_view(2031)).sections}
    assert (approved["awards"].version, approved["awards"].content["minimum"]) == (1, "100")  # type: ignore[index]
    at_v2 = {s.section: s for s in (await service.approved_view(2031, 2)).sections}
    assert at_v2["awards"].content is None  # draft in v2: withheld, and its edit stamp too
    assert at_v2["awards"].status.edited_by is None
    assert at_v2["income"].content is not None


@pytest.mark.asyncio
async def test_a_season_description_section_edited_in_a_draft_stays_readable() -> None:
    service = await _approved_v1(FakeStore())
    moved = with_lever(fictional_rules(), "milestones.r1_run", "2031-03-02")
    await service.save_sections(2031, 1, moved, actor=TREASURER)  # v2: milestones draft
    milestones = {s.section: s for s in (await service.approved_view(2031)).sections}["milestones"]
    assert (milestones.version, milestones.content["r1_run"]) == (1, "2031-03-01")  # type: ignore[index]


@pytest.mark.asyncio
async def test_a_pricing_section_approved_in_a_draft_that_cannot_price_yet_is_not_shown() -> None:
    service = await _approved_v1(FakeStore())
    both = with_lever(_minimum(fictional_rules(), "150"), "award_tables.camp.tiers.1.r1_pct", "88")
    await service.save_sections(2031, 1, both, actor=TREASURER)  # v2: award_tables and awards draft
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Feb 3")  # v2 still can't price
    awards = {s.section: s for s in (await service.approved_view(2031)).sections}["awards"]
    assert (awards.version, awards.content["minimum"]) == (1, "100")  # type: ignore[index]


@pytest.mark.asyncio
async def test_a_version_with_nothing_approved_has_no_approved_read() -> None:
    service = _service(FakeStore())
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(RulesNotFoundError):
        await service.approved_view(2031, 1)


@pytest.mark.asyncio
async def test_an_old_version_of_drafts_has_no_approved_read_though_a_later_one_is_approved() -> None:
    service = _service(FakeStore())
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.new_version(2031, 1, actor=FINANCE)
    await service.approve_sections(2031, 2, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    with pytest.raises(RulesNotFoundError):
        await service.approved_view(2031, 1)
    assert (await service.approved_view(2031, 2)).version == 2


@pytest.mark.asyncio
async def test_a_missing_version_has_no_approved_read() -> None:
    service = await _approved_v1(FakeStore())
    with pytest.raises(RulesNotFoundError):
        await service.approved_view(2031, 9)


@pytest.mark.asyncio
async def test_a_season_with_no_approved_rules_has_no_approved_read() -> None:
    service = _service(FakeStore())
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(RulesNotFoundError):
        await service.approved_view(2031)


@pytest.mark.asyncio
async def test_the_draft_read_lists_each_sections_changes_against_the_approved_rules() -> None:
    service = await _priced_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    draft = await service.draft_view(2031)
    assert (draft.version.version, draft.approved_version) == (2, 1)
    sections = {s.section: s for s in draft.sections}
    assert sections["awards"].changes == (FieldChange(("minimum",), "changed", Decimal(100), Decimal(150)),)
    assert sections["awards"].status.edited_by == TREASURER
    assert sections["income"].changes == ()
    assert [s.section for s in draft.sections] == list(SECTION_NAMES)


@pytest.mark.asyncio
async def test_the_draft_read_has_no_changes_when_it_is_the_approved_version_or_there_is_none() -> None:
    service = _service(FakeStore())
    await service.create_version(fictional_rules(), actor=FINANCE)
    draft = await service.draft_view(2031)
    assert draft.approved_version is None
    assert all(s.changes == () for s in draft.sections)
    await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board")
    draft = await service.draft_view(2031)
    assert draft.approved_version == 1
    assert all(s.changes == () for s in draft.sections)


# --- promotion ----------------------------------------------------------------------------------------


def _option() -> AidRules:
    """A kept option from 2031 v1: Round 1 tier 1 two points lower, minimum $150."""
    return with_levers(fictional_rules(), {"awards.minimum": "150", "award_tables.camp.tiers.1.r1_pct": "88"})


@pytest.mark.asyncio
async def test_the_preview_lists_only_the_sections_the_option_changed() -> None:
    service = await _approved_v1(FakeStore())
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    assert (preview.origin_version, preview.base_version) == (1, 1)
    assert [s.section for s in preview.sections] == ["award_tables", "awards"]
    awards = preview.sections[1]
    assert awards.changes == (FieldChange(("minimum",), "changed", Decimal(100), Decimal(150)),)
    assert [c.path for c in preview.sections[0].changes] == [("camp", "tiers", 1, "r1_pct")]  # type: ignore[comparison-overlap]  # FieldChange.path is typed tuple[str, ...] but holds the int tier
    assert all(s.warning is None for s in preview.sections)
    assert len(preview.unchanged) == len(SECTION_NAMES) - 2


@pytest.mark.asyncio
async def test_promoting_branches_the_approved_rules_and_stamps_the_option() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    saved = await service.promote(
        2031, origin_version=1, document=_option(), base_version=1, acknowledged={}, actor=FINANCE, via="B2"
    )
    assert (saved.branched_from, saved.version.version) == (1, 2)
    awards = saved.version.section_status["awards"]
    assert (awards.state, awards.edited_by, awards.edited_via) == ("draft", FINANCE, "B2")
    assert saved.version.document.awards.minimum == Decimal(150)
    assert (await service.load(2031, 1)).document.awards.minimum == Decimal(100)


@pytest.mark.asyncio
async def test_replacing_an_unapproved_edit_needs_confirming() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)  # v2, awards draft
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    warned = {s.section: s.warning for s in preview.sections}
    assert preview.base_version == 2
    assert warned["awards"] is not None
    assert (warned["awards"].kind, warned["awards"].by, warned["awards"].at) == ("unapproved_edit", TREASURER, AT)
    assert warned["award_tables"] is None
    before = len(store.operations)
    with pytest.raises(ReplacementNotAcknowledgedError) as refused:
        await service.promote(
            2031, origin_version=1, document=_option(), base_version=2, acknowledged={}, actor=FINANCE, via="B2"
        )
    assert refused.value.sections == ["awards"]
    assert len(store.operations) == before
    assert warned["awards"].token  # the preview hands back what to confirm
    saved = await service.promote(
        2031,
        origin_version=1,
        document=_option(),
        base_version=2,
        acknowledged={"awards": warned["awards"].token},
        actor=FINANCE,
        via="B2",
    )
    assert (saved.branched_from, saved.version.version) == (None, 2)  # v2 is already a draft version
    assert saved.version.document.awards.minimum == Decimal(150)
    assert saved.version.section_status["awards"].edited_by == FINANCE


@pytest.mark.asyncio
async def test_an_acknowledgement_expires_when_the_warned_section_is_edited_again_after_the_preview() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)  # v2, awards draft
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    token = {s.section: s.warning for s in preview.sections}["awards"].token  # type: ignore[union-attr]
    # Someone edits awards again (in place on v2) between the preview and the apply.
    await service.save_sections(2031, 2, _minimum(fictional_rules(), "130"), actor=FINANCE)
    before = len(store.operations)
    with pytest.raises(ReplacementNotAcknowledgedError) as refused:
        await service.promote(
            2031,
            origin_version=1,
            document=_option(),
            base_version=2,
            acknowledged={"awards": token},
            actor=FINANCE,
            via="B2",
        )
    assert refused.value.sections == ["awards"]
    assert len(store.operations) == before
    assert (await service.load(2031, 2)).document.awards.minimum == Decimal(130)  # the re-edit was not overwritten
    fresh = {
        s.section: s.warning
        for s in (await service.promotion_preview(2031, origin_version=1, document=_option())).sections
    }
    saved = await service.promote(
        2031,
        origin_version=1,
        document=_option(),
        base_version=2,
        acknowledged={"awards": fresh["awards"].token},  # type: ignore[union-attr]
        actor=FINANCE,
        via="B2",
    )
    assert saved.version.document.awards.minimum == Decimal(150)


@pytest.mark.asyncio
async def test_an_empty_acknowledgement_token_is_refused() -> None:
    service = await _approved_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)
    with pytest.raises(ReplacementNotAcknowledgedError):
        await service.promote(
            2031,
            origin_version=1,
            document=_option(),
            base_version=2,
            acknowledged={"awards": ""},
            actor=FINANCE,
            via="B2",
        )


@pytest.mark.asyncio
async def test_a_token_from_one_section_does_not_acknowledge_another() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    both = with_lever(_minimum(fictional_rules(), "120"), "award_tables.camp.tiers.1.r1_pct", "85")
    await service.save_sections(2031, 1, both, actor=TREASURER)  # v2: awards and award_tables both draft
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    warned = {s.section: s.warning for s in preview.sections}
    assert warned["awards"] is not None
    assert warned["award_tables"] is not None
    assert warned["awards"].token != warned["award_tables"].token
    before = len(store.operations)
    with pytest.raises(ReplacementNotAcknowledgedError) as refused:
        await service.promote(
            2031,
            origin_version=1,
            document=_option(),
            base_version=2,
            acknowledged={"awards": warned["awards"].token, "award_tables": warned["awards"].token},
            actor=FINANCE,
            via="B2",
        )
    assert refused.value.sections == ["award_tables"]
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_an_acknowledgement_from_one_option_does_not_cover_another_option() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)  # v2, awards draft
    option_a = _option()  # minimum $150
    option_b = with_lever(fictional_rules(), "awards.minimum", "175")
    preview = await service.promotion_preview(2031, origin_version=1, document=option_a)
    token = {s.section: s.warning for s in preview.sections}["awards"].token  # type: ignore[union-attr]
    before = len(store.operations)
    with pytest.raises(ReplacementNotAcknowledgedError) as refused:
        await service.promote(
            2031,
            origin_version=1,
            document=option_b,
            base_version=2,
            acknowledged={"awards": token},
            actor=FINANCE,
            via="B",
        )
    assert refused.value.sections == ["awards"]
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_undoing_an_approved_change_made_since_the_option_started_is_warned() -> None:
    service = await _approved_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Jan 20")
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    warning = {s.section: s.warning for s in preview.sections}["awards"]
    assert warning is not None
    assert (warning.kind, warning.by) == ("changed_since", FINANCE)


@pytest.mark.asyncio
async def test_promoting_against_an_older_rules_draft_is_refused() -> None:
    service = await _approved_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)
    with pytest.raises(NotLatestVersionError):
        await service.promote(
            2031,
            origin_version=1,
            document=_option(),
            base_version=1,
            acknowledged={"awards": "x"},
            actor=FINANCE,
            via="B2",
        )


@pytest.mark.asyncio
async def test_promoting_against_an_older_rules_draft_says_to_look_at_the_changes_again() -> None:
    """A promotion is confirmed against a preview, so its stale-base refusal sends staff back to the preview, not
    to "make the change again" as a section save's does."""
    service = await _approved_v1(FakeStore())
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "120"), actor=TREASURER)
    with pytest.raises(NotLatestVersionError) as refused:
        await service.promote(
            2031,
            origin_version=1,
            document=_option(),
            base_version=1,
            acknowledged={"awards": "x"},
            actor=FINANCE,
            via="B2",
        )
    assert str(refused.value) == "The rules draft is version 2 now, not 1: look at the changes again"


@pytest.mark.asyncio
async def test_an_option_that_changes_nothing_promotes_nothing() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    before = len(store.operations)
    saved = await service.promote(
        2031, origin_version=1, document=fictional_rules(), base_version=1, acknowledged={}, actor=FINANCE, via="A"
    )
    assert (saved.branched_from, saved.version.version) == (None, 1)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_an_unstamped_draft_the_option_would_replace_is_an_unapproved_edit() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)  # v1: every section a draft
    await service.new_version(2031, 1, actor=FINANCE)  # v2, the rules draft
    await service.save(2031, 2, _minimum(fictional_rules(), "120"), actor=FINANCE)  # a whole-document save: no stamp
    preview = await service.promotion_preview(2031, origin_version=1, document=_option())
    warning = {s.section: s.warning for s in preview.sections}["awards"]
    assert warning is not None
    assert (warning.kind, warning.by, warning.at, warning.via) == ("unapproved_edit", None, None, None)


@pytest.mark.asyncio
async def test_a_section_the_option_did_not_change_keeps_the_drafts_newer_copy() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_sections(2031, 1, with_lever(fictional_rules(), "income.floor", "500"), actor=TREASURER)  # v2
    saved = await service.promote(
        2031, origin_version=1, document=_option(), base_version=2, acknowledged={}, actor=FINANCE, via="B2"
    )
    assert saved.version.document.awards.minimum == Decimal(150)  # the option's change lands
    assert saved.version.document.income.floor == Decimal(500)  # the draft's newer copy of an untouched section stays
    assert saved.version.section_status["income"].edited_by == TREASURER


@pytest.mark.asyncio
async def test_a_save_that_changes_a_fixed_setting_is_refused_with_its_label() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    income = fictional_rules_json()["income"] | {"medical_rate": "0.5"}
    with pytest.raises(
        FixedSettingError, match=r"^Share of medical costs taken off is fixed and can't be changed here$"
    ):
        await service.save_section(2031, 1, "income", income, actor=FINANCE)


@pytest.mark.asyncio
async def test_the_current_year_weight_is_the_servers_one_minus_the_prior_year() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    income = fictional_rules_json()["income"] | {"weights": {"prior_year": "0.6"}}
    await service.save_section(2031, 1, "income", income, actor=FINANCE)
    weights = (await service.load(2031)).document.income.weights
    assert (weights.prior_year, weights.current_year) == (Decimal("0.6"), Decimal("0.4"))


def _bands(n: int) -> list[dict[str, str | None]]:
    out: list[dict[str, str | None]] = [{"lower": "0", "upper": "40000"}]
    out += [{"lower": str(40000 * i + 1), "upper": str(40000 * (i + 1))} for i in range(1, n - 1)]
    out.append({"lower": str(40000 * (n - 1) + 1), "upper": None})
    return out


@pytest.mark.asyncio
async def test_fewer_tiers_trims_every_table_and_override_in_one_operation() -> None:
    """Review Focus 2: 6 -> 5 tiers drops tier 6 from both tables, a child's override of tier 6 included."""
    store = FakeStore()
    service = _service(store)
    seeded = with_lever(fictional_rules(), "award_tables.teen.overrides", {"2": {"r1_pct": "70"}, "6": {"r1_pct": "1"}})
    await service.create_version(seeded, actor=FINANCE)
    before = len(store.operations)
    tiers = fictional_rules_json()["tiers"] | {"bands": _bands(5)}
    await service.save_section(2031, 1, "tiers", tiers, actor=FINANCE)
    doc = (await service.load(2031)).document
    assert set(doc.award_tables["camp"].tiers) == {1, 2, 3, 4, 5}
    assert set(doc.award_tables["teen"].overrides) == {2}
    assert set(doc.round2.tables["camp"].tiers) == {1, 2, 3, 4, 5}
    assert len(store.operations) == before + 1
    assert "tiers_do_not_match_bands" not in validate_rules(doc).codes()


@pytest.mark.asyncio
async def test_fewer_tiers_on_approved_rules_sends_both_tables_to_draft() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    tiers = fictional_rules_json()["tiers"] | {"bands": _bands(5)}
    saved = await service.save_section(2031, 1, "tiers", tiers, actor=FINANCE)
    status = (await service.load(2031, saved.version.version)).section_status
    assert {status[s].state for s in ("tiers", "award_tables", "round2")} == {"draft"}


@pytest.mark.asyncio
async def test_more_tiers_writes_nothing_else_and_validation_blocks_approval() -> None:
    """Review Focus 2: the new tiers' cells are empty; validation's tier-count error holds approval."""
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    tiers = fictional_rules_json()["tiers"] | {"bands": _bands(7)}
    await service.save_section(2031, 1, "tiers", tiers, actor=FINANCE)
    doc = (await service.load(2031)).document
    assert set(doc.award_tables["camp"].tiers) == {1, 2, 3, 4, 5, 6}
    errors = {(i.code, i.section) for i in validate_rules(doc).errors}
    assert ("tiers_do_not_match_bands", "award_tables") in errors


def _budget(**changes: object) -> dict[str, object]:
    """The fixture's budget section as Edit Plan... sends it (`{total, pools}`), with `changes` applied."""
    return fictional_rules().budget.model_dump(mode="json") | changes


def _new_split() -> dict[str, dict[str, str]]:
    """The fixture's pools with new shares only: each label is read from the fixture, never typed here."""
    shares = {"camp_pool": "75", "weekend_pool": "20", "bmitzvah_pool": "5"}
    pools = fictional_rules().budget.pools
    return {key: {"label": pools[key].label, "share_pct": share} for key, share in shares.items()}


@pytest.mark.asyncio
async def test_before_any_round_posts_the_budget_total_saves() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    saved = await service.save_section(2031, 1, "budget", _budget(total="520000"), actor=FINANCE)
    assert saved.version.document.budget.total == Decimal(520000)
    assert (await service.draft_view(2031)).budget_total_locked is False


@pytest.mark.asyncio
async def test_after_round_one_posts_a_shares_only_change_still_saves() -> None:
    """Owner 10-06 (b): "budget does lock but only the total dollar number." The split saves and goes through the draft
    -> Approve as usual; the total stands. Round 1's first post locks a Round 1 section, never the budget (D119)."""
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    saved = await service.save_section(2031, 1, "budget", _budget(pools=_new_split()), actor=FINANCE)
    budget = saved.version.document.budget
    assert (budget.total, budget.pools["camp_pool"].share_pct) == (Decimal(500000), Decimal(75))
    assert saved.version.section_status["budget"].state == "draft"


@pytest.mark.asyncio
async def test_after_round_one_posts_a_total_change_is_refused_in_the_lock_words() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    before = len(store.operations)
    with pytest.raises(BudgetTotalLockedError, match=f"^{re.escape(BUDGET_TOTAL_LOCKED)}$"):
        await service.save_section(2031, 1, "budget", _budget(total="520000", pools=_new_split()), actor=FINANCE)
    assert len(store.operations) == before
    assert (await service.draft_view(2031)).budget_total_locked is True


@pytest.mark.asyncio
async def test_the_total_stays_locked_when_a_later_save_lifts_round_ones_lock_in_a_new_version() -> None:
    """Editing the locked income section branches v2 with income back in draft (the lock lifted there only). The total a
    posted round read must still not move on v2, so the lock is found on any version of the season."""
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    income = fictional_rules_json()["income"] | {"weights": {"prior_year": "0.6"}}
    saved = await service.save_section(2031, 1, "income", income, actor=FINANCE)
    assert (saved.version.version, saved.version.section_status["income"].state) == (2, "draft")
    with pytest.raises(BudgetTotalLockedError):
        await service.save_section(2031, 2, "budget", _budget(total="520000"), actor=FINANCE)
    assert (await service.draft_view(2031)).budget_total_locked is True


@pytest.mark.asyncio
async def test_a_total_saved_before_round_one_posts_cannot_be_approved_after_it() -> None:
    """The draft saved while the total was still open must not become the pricing total once Round 1 has posted."""
    store = FakeStore()
    service = await _approved_v1(store)
    saved = await service.save_section(2031, 1, "budget", _budget(total="520000"), actor=FINANCE)
    assert saved.version.version == 2
    await service.lock_section(2031, 2, "income", actor=FINANCE)
    before = len(store.operations)
    with pytest.raises(BudgetTotalLockedError, match=f"^{re.escape(BUDGET_TOTAL_LOCKED)}$"):
        await service.approve_sections(2031, 2, ["budget"], actor=FINANCE, note="Board, Mar 1")
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_shares_only_budget_saved_before_round_one_posts_still_approves_after_it() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_section(2031, 1, "budget", _budget(pools=_new_split()), actor=FINANCE)
    await service.lock_section(2031, 2, "income", actor=FINANCE)
    approved, _ = await service.approve_sections(2031, 2, ["budget"], actor=FINANCE, note="Board, Mar 1")
    assert approved.section_status["budget"].state == "approved"
    assert approved.document.budget.total == Decimal(500000)


@pytest.mark.asyncio
async def test_a_total_approved_before_round_one_cannot_become_the_pricing_total_after_it() -> None:
    """Scan #3039: v2's new total is approved while v1 still prices the season (v2's `awards` is still draft). Round 1
    posts from v1's total. Approving v2's last draft section would make v2 the pricing version at the new total, though
    `budget` is not among the sections named: the guard runs on every approval, against the pricing version."""
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_section(2031, 1, "budget", _budget(total="520000"), actor=FINANCE)
    awards = _minimum(fictional_rules(), "75").awards.model_dump(mode="json")
    await service.save_section(2031, 2, "awards", awards, actor=FINANCE)
    await service.approve_sections(2031, 2, ["budget"], actor=FINANCE, note="Board, Feb 1")
    pricing = await service.latest_approved(2031, PRICING_SECTIONS)
    assert pricing is not None
    assert pricing.version == 1
    await service.lock_section(2031, 2, "income", actor=FINANCE)
    before = len(store.operations)
    with pytest.raises(BudgetTotalLockedError, match=f"^{re.escape(BUDGET_TOTAL_LOCKED)}$"):
        await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Mar 1")
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_a_new_version_cannot_branch_from_a_version_carrying_another_total_once_locked() -> None:
    """Scan #3039: v2 prices the season at 520000 (approved before Round 1 posted); v1 carries 500000. Branching v3 from
    v1 would make it, all approvals carried, the pricing version at the old total."""
    store = FakeStore()
    service = await _approved_v1(store)
    await service.save_section(2031, 1, "budget", _budget(total="520000"), actor=FINANCE)
    await service.approve_sections(2031, 2, ["budget"], actor=FINANCE, note="Board, Feb 1")
    await service.lock_section(2031, 2, "income", actor=FINANCE)
    before = len(store.operations)
    with pytest.raises(BudgetTotalLockedError, match=f"^{re.escape(BUDGET_TOTAL_LOCKED)}$"):
        await service.new_version(2031, 1, actor=FINANCE)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_after_round_one_posts_an_unmoved_total_still_approves_and_branches() -> None:
    store = FakeStore()
    service = await _approved_v1(store)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    awards = _minimum(fictional_rules(), "75").awards.model_dump(mode="json")
    saved = await service.save_section(2031, 1, "awards", awards, actor=FINANCE)
    approved, _ = await service.approve_sections(2031, saved.version.version, ["awards"], actor=FINANCE, note="Mar 1")
    assert approved.section_status["awards"].state == "approved"
    branched = await service.new_version(2031, approved.version, actor=FINANCE)
    assert branched.document.budget.total == Decimal(500000)


@pytest.mark.asyncio
async def test_the_rules_save_never_adds_a_named_award() -> None:
    """Owner 10-06 (c): a named fund comes from Grants > Grantors (slice 3) or, until then, 2027's starting file. A
    section save that adds a decision type is refused: the new key's kind reads as a change to a fixed setting."""
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    awards = fictional_rules().awards.model_dump(mode="json")
    awards["decision_types"]["named_full_cost_fund"] = {
        "label": "Named full-cost fund",
        "kind": "full_cost_after_aid",
        "round": 1,
        "allows_appeal": False,
        "counts_toward_budget": False,
    }
    before = len(store.operations)
    with pytest.raises(FixedSettingError, match=r"^Named award › Kind is fixed and can't be changed here$"):
        await service.save_section(2031, 1, "awards", awards, actor=FINANCE)
    assert len(store.operations) == before


@pytest.mark.asyncio
async def test_promoted_via_reads_the_option_from_the_versions_log_after_approval_cleared_it() -> None:
    """Scenarios addendum §S11.2, disagreement 2: approval replaces the status (edited_via goes), the log keeps it."""
    service = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    await service.create_version(fictional_rules(), actor="finance@example.com")
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor="treasurer@example.com", note="Committee")
    moved = with_lever(fictional_rules(), "awards.minimum", "150")
    await service.promote(
        2031, origin_version=1, document=moved, base_version=1, acknowledged={}, actor="finance@example.com", via="B"
    )
    await service.approve_sections(2031, 2, ["awards"], actor="treasurer@example.com", note="Committee")
    assert (await service.load(2031, 2)).section_status["awards"].edited_via is None
    assert await service.promoted_via(2031, 2) == "B"
    assert await service.promoted_via(2031, 1) is None


@pytest.mark.asyncio
async def test_promoted_via_stops_at_a_later_save_that_unstamped_the_section() -> None:
    """Plan review, minor 4: a Rules save after the promotion is the version's newest whole-version row. A section
    save stamps its section with no via, so the version no longer reads as promoted from B. (Approval rows are per
    section, so they never count.)"""
    service = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    await service.create_version(fictional_rules(), actor="finance@example.com")
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor="treasurer@example.com", note="Committee")
    moved = with_lever(fictional_rules(), "awards.minimum", "150")
    await service.promote(
        2031, origin_version=1, document=moved, base_version=1, acknowledged={}, actor="finance@example.com", via="B"
    )
    assert await service.promoted_via(2031, 2) == "B"
    awards = with_lever(moved, "awards.minimum", "175").model_dump(mode="json")["awards"]
    await service.save_section(2031, 2, "awards", awards, actor="treasurer@example.com")  # v2's awards is a draft
    assert await service.promoted_via(2031, 2) is None


@pytest.mark.asyncio
async def test_promoted_via_reads_the_newest_of_two_promotions_into_one_draft() -> None:
    """Regression guard. An update row logs only the sections whose stamp changed, so a read of the whole status
    would answer "A" (the first section in order); the newest promotion, "B", is the answer."""
    service = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    await service.create_version(fictional_rules(), actor="finance@example.com")
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor="treasurer@example.com", note="Committee")
    first = with_lever(fictional_rules(), "income.floor", "500")
    await service.promote(
        2031, origin_version=1, document=first, base_version=1, acknowledged={}, actor="finance@example.com", via="A"
    )
    second = with_lever(first, "awards.minimum", "150")
    await service.promote(
        2031, origin_version=1, document=second, base_version=2, acknowledged={}, actor="finance@example.com", via="B"
    )
    assert await service.promoted_via(2031, 2) == "B"

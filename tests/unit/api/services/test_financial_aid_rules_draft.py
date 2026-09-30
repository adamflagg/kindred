"""The rules draft (SP9a; spec §7.5, D39, D76): section saves that never overwrite the newest approved copy
of a section, the Rules tab's draft read, D76's approved read, and making a kept option the rules draft.
FinancialAidRulesService over the in-memory FakeStore; fictional season 2031 only."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
    FinancialAidRulesService,
    NotLatestVersionError,
    SectionInvalidError,
    YearMismatchError,
    parse_section,
)
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.lifecycle import LockedSectionInvalidatedError
from bunking.financial_aid.rules.schema import SECTION_NAMES
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json, with_lever

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


def test_pricing_reads_the_same_sections_the_decisions_service_did() -> None:
    from api.services import financial_aid_decisions_service

    assert financial_aid_decisions_service.PRICING_SECTIONS is PRICING_SECTIONS

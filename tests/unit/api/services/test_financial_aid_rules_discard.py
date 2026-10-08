"""Discard the rules draft (owner 2026-10-08: "there is no way to discard a draft once we have a draft"; one
button, the whole draft). The versions newer than the one in effect are marked discarded, never deleted: the page
goes back to the version in effect, a scenario built on a discarded version still loads it by number, and the next
save never reuses its number."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
    DraftApprovedError,
    FinancialAidRulesService,
    NoDraftToDiscardError,
    NotLatestVersionError,
    RulesNotFoundError,
)
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.schema import SECTION_NAMES
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever, with_levers

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"


def _minimum(rules: AidRules, amount: str) -> AidRules:
    return with_lever(rules, "awards.minimum", amount)


def _two_edits(minimum: str) -> AidRules:
    """Awards and round 3 edited together: approving one leaves the other a draft, so v1 stays in effect."""
    return with_levers(fictional_rules(), {"awards.minimum": minimum, "round3.registrar_limit": "400"})


async def _draft_v2(store: FakeStore) -> FinancialAidRulesService:
    """v1 approved whole (in effect); v2 branched from it by an edit to awards, a draft."""
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    saved = await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    assert saved.version.version == 2
    return service


@pytest.mark.asyncio
async def test_discarding_the_draft_goes_back_to_the_version_in_effect() -> None:
    store = FakeStore()
    service = await _draft_v2(store)
    await service.discard_draft(2031, 2, actor=FINANCE)
    current = await service.load(2031)
    assert current.version == 1
    assert current.document == fictional_rules()
    view = await service.draft_view(2031)
    assert (view.version.version, view.approved_version) == (1, 1)
    assert all(not section.changes for section in view.sections)


@pytest.mark.asyncio
async def test_a_discarded_version_is_kept_and_still_loads_by_number() -> None:
    """A kept scenario option built on the draft names it as its origin: it must still load."""
    store = FakeStore()
    service = await _draft_v2(store)
    await service.discard_draft(2031, 2, actor=FINANCE)
    kept = await service.load(2031, 2)
    assert kept.document.awards.minimum == _minimum(fictional_rules(), "150").awards.minimum
    assert any(r.version == 2 for r in store.rows)


@pytest.mark.asyncio
async def test_the_next_save_after_a_discard_takes_a_new_number() -> None:
    store = FakeStore()
    service = await _draft_v2(store)
    await service.discard_draft(2031, 2, actor=FINANCE)
    saved = await service.save_sections(2031, 1, _minimum(fictional_rules(), "175"), actor=TREASURER)
    assert (saved.branched_from, saved.version.version) == (1, 3)
    assert (await service.load(2031)).version == 3


@pytest.mark.asyncio
async def test_a_new_version_after_a_discard_takes_a_new_number() -> None:
    """`new_version` numbers from every version, discarded ones too: numbering from the version in effect would
    reuse the discarded draft's number, which the unique index on (year, version) refuses every time."""
    store = FakeStore()
    service = await _draft_v2(store)
    await service.discard_draft(2031, 2, actor=FINANCE)
    created = await service.new_version(2031, 1, actor=FINANCE)
    assert created.version == 3
    assert (await service.load(2031)).version == 3


@pytest.mark.asyncio
async def test_a_whole_document_version_after_a_discard_takes_a_new_number() -> None:
    store = FakeStore()
    service = await _draft_v2(store)
    await service.discard_draft(2031, 2, actor=FINANCE)
    created = await service.create_version(_minimum(fictional_rules(), "175"), actor=FINANCE)
    assert created.version == 3


@pytest.mark.asyncio
async def test_a_discard_is_one_logged_operation_naming_the_version() -> None:
    store = FakeStore()
    service = await _draft_v2(store)
    before = len(store.operations)
    await service.discard_draft(2031, 2, actor=FINANCE)
    assert len(store.operations) == before + 1
    [row] = store.operations[-1]
    assert (row["action"], row["entity_id"], row["actor"]) == ("discard", "2031:2", FINANCE)


@pytest.mark.asyncio
async def test_an_approval_in_an_earlier_draft_version_refuses_too() -> None:
    """A second draft version only exists when something in the first was approved since: v2's awards approved
    (round 3 still a draft, so v1 stays in effect), then the next edit to awards branches v3 from it. Discarding v3
    would throw that approval away with it, so it is refused, naming the section."""
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    await service.save_sections(2031, 1, _two_edits("150"), actor=TREASURER)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Feb 2")
    saved = await service.save_sections(2031, 2, _two_edits("175"), actor=TREASURER)
    assert saved.version.version == 3
    assert (await service.draft_view(2031)).approved_version == 1
    with pytest.raises(DraftApprovedError, match="Minimum award and named awards"):
        await service.discard_draft(2031, 3, actor=FINANCE)


@pytest.mark.asyncio
async def test_a_draft_holding_an_approval_of_its_own_is_refused_and_nothing_is_written() -> None:
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    await service.save_sections(2031, 1, _two_edits("150"), actor=TREASURER)
    await service.approve_sections(2031, 2, ["awards"], actor=FINANCE, note="Board, Feb 2")
    before = len(store.operations)
    with pytest.raises(DraftApprovedError):
        await service.discard_draft(2031, 2, actor=FINANCE)
    assert len(store.operations) == before
    assert (await service.load(2031)).version == 2


@pytest.mark.asyncio
async def test_nothing_newer_than_the_version_in_effect_is_nothing_to_discard() -> None:
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    with pytest.raises(NoDraftToDiscardError):
        await service.discard_draft(2031, 1, actor=FINANCE)


@pytest.mark.asyncio
async def test_a_season_with_nothing_in_effect_has_nothing_to_go_back_to() -> None:
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(NoDraftToDiscardError):
        await service.discard_draft(2031, 1, actor=FINANCE)


@pytest.mark.asyncio
async def test_a_stale_page_cannot_discard_a_draft_it_has_not_seen() -> None:
    store = FakeStore()
    service = await _draft_v2(store)
    with pytest.raises(NotLatestVersionError):
        await service.discard_draft(2031, 1, actor=FINANCE)


@pytest.mark.asyncio
async def test_an_unknown_season_is_not_found() -> None:
    service = FinancialAidRulesService(FakeStore(), clock=lambda: AT)
    with pytest.raises(RulesNotFoundError):
        await service.discard_draft(2031, 1, actor=FINANCE)


@pytest.mark.asyncio
async def test_the_rules_as_of_any_instant_still_replay_after_a_discard() -> None:
    """approved_as_of replays the log: a discarded version must neither break it nor answer for an instant."""
    clock = [AT]
    store = FakeStore(clock=lambda: clock[0])
    service = FinancialAidRulesService(store, clock=lambda: clock[0])
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    clock[0] = AT + timedelta(hours=1)
    await service.save_sections(2031, 1, _minimum(fictional_rules(), "150"), actor=TREASURER)
    clock[0] = AT + timedelta(hours=2)
    await service.discard_draft(2031, 2, actor=FINANCE)
    for at in (AT + timedelta(minutes=30), AT + timedelta(hours=3)):
        found = await service.approved_as_of(2031, PRICING_SECTIONS, at)
        assert found is not None
        assert found.version == 1

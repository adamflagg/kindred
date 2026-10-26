"""Discard the rules draft (owner 2026-10-08: "there is no way to discard a draft once we have a draft"; one
button, the whole draft). The versions newer than the one in effect are marked discarded, never deleted: the page
goes back to the version in effect, a scenario built on a discarded version still loads it by number, and the next
save never reuses its number."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from api.constants.collections import (
    AID_DECISIONS,
    AID_GRANT_PLACEMENTS,
    AID_REQUESTS,
    AID_SCENARIO_OPTIONS,
    AID_SCENARIO_SNAPSHOTS,
    AID_SCENARIO_TRAIL,
)
from api.services.financial_aid_rules_service import (
    PRICING_SECTIONS,
    DraftApprovedError,
    FinancialAidRulesService,
    FirstDraftInUseError,
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
ADMIN = "admin@example.com"


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
async def test_the_draft_read_names_the_number_the_next_version_takes_past_a_discarded_one() -> None:
    """After a discard the draft read is back on v1, but v2 is spent: the next edit starts v3, and the read says so."""
    store = FakeStore()
    service = await _draft_v2(store)
    assert (await service.draft_view(2031)).next_version == 3
    await service.discard_draft(2031, 2, actor=FINANCE)
    view = await service.draft_view(2031)
    assert (view.version.version, view.next_version) == (1, 3)


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


@pytest.mark.asyncio
async def test_a_section_a_posted_round_locked_in_the_draft_refuses_in_words_that_say_so() -> None:
    """A round posting while a draft is open locks the draft's unchanged sections (lock_writes). Nobody approved
    anything, so the refusal must not say only "approval"; the draft is in use and stays."""
    store = FakeStore()
    service = await _draft_v2(store)
    await service.lock_section(2031, 2, "income", actor=FINANCE)
    with pytest.raises(DraftApprovedError, match=r"an approval or a posted round's lock .*Counting a family's income"):
        await service.discard_draft(2031, 2, actor=FINANCE)


# --- a season's first draft (owner ruling R27-9 = A, 2026-10-25) --------------------------------------------------
# "Let 'Discard draft' (admin only) discard a season's first draft when nothing in it is approved or locked and no
# request or scenario has read it; then load the reviewed file as v2." The route is admin-only; the service holds
# every other guard.


async def _first_draft(store: FakeStore) -> FinancialAidRulesService:
    """v1 of an empty season, every section a draft (what Start from last year leaves)."""
    service = FinancialAidRulesService(store, clock=lambda: AT)
    created = await service.create_version(fictional_rules(), actor=FINANCE)
    assert created.version == 1
    assert all(created.section_status[name].state == "draft" for name in SECTION_NAMES)
    return service


@pytest.mark.asyncio
async def test_a_first_draft_nothing_reads_is_discarded_and_the_reviewed_file_then_loads_as_v2() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    await service.discard_first_draft(2031, 1, actor=ADMIN)
    with pytest.raises(RulesNotFoundError):
        await service.load(2031)  # the season reads as having no rules
    assert await service.discarded_versions(2031) == frozenset({1})
    assert (await service.load(2031, 1)).version == 1  # kept, never deleted
    reviewed = _minimum(fictional_rules(), "175")
    created = await service.bootstrap(reviewed, actor=ADMIN)
    assert created.version == 2
    assert (await service.load(2031)).document == reviewed
    [discarded], [made] = store.operations[-2:]
    assert (discarded["action"], discarded["entity_id"], discarded["actor"]) == ("discard", "2031:1", ADMIN)
    assert (made["action"], made["entity_id"]) == ("create", "2031:2")


@pytest.mark.asyncio
async def test_every_live_version_of_an_all_draft_season_is_discarded_in_one_operation() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    await service.create_version(fictional_rules(), actor=FINANCE)  # v2, still all draft
    await service.discard_first_draft(2031, 2, actor=ADMIN)
    assert await service.discarded_versions(2031) == frozenset({1, 2})
    assert [(row["action"], row["entity_id"]) for row in store.operations[-1]] == [
        ("discard", "2031:1"),
        ("discard", "2031:2"),
    ]
    assert (await service.bootstrap(fictional_rules(), actor=ADMIN)).version == 3


@pytest.mark.asyncio
async def test_a_first_draft_with_an_approved_section_is_refused_and_nothing_is_written() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    await service.approve_sections(2031, 1, ["awards"], actor=FINANCE, note="Board, Jan 8")
    before = len(store.operations)
    with pytest.raises(FirstDraftInUseError, match="Minimum award and named awards"):
        await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert len(store.operations) == before
    assert (await service.load(2031)).version == 1


@pytest.mark.asyncio
async def test_a_first_draft_with_a_locked_section_is_refused() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    await service.approve_sections(2031, 1, ["income"], actor=FINANCE, note="Board, Jan 8")
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    with pytest.raises(FirstDraftInUseError, match="Counting a family's income"):
        await service.discard_first_draft(2031, 1, actor=ADMIN)


@pytest.mark.asyncio
async def test_an_approval_in_an_earlier_version_of_the_season_refuses_too() -> None:
    """Every live version counts, not only the draft named: v1's approval must not go with it."""
    store = FakeStore()
    service = await _first_draft(store)
    await service.approve_sections(2031, 1, ["awards"], actor=FINANCE, note="Board, Jan 8")
    await service.create_version(fictional_rules(), actor=FINANCE)  # v2, all draft
    with pytest.raises(FirstDraftInUseError, match="Minimum award and named awards"):
        await service.discard_first_draft(2031, 2, actor=ADMIN)


@pytest.mark.parametrize(
    ("collection", "words"),
    [
        (AID_REQUESTS, "aid requests"),
        (AID_DECISIONS, "decisions or posted rounds"),
        (AID_GRANT_PLACEMENTS, "grant placements"),
        (AID_SCENARIO_SNAPSHOTS, "scenario snapshots"),
        (AID_SCENARIO_OPTIONS, "kept scenario options"),
        (AID_SCENARIO_TRAIL, "scenario drafts"),
    ],
)
@pytest.mark.asyncio
async def test_a_first_draft_something_in_the_season_has_read_is_refused(collection: str, words: str) -> None:
    store = FakeStore()
    service = await _first_draft(store)
    store.readers = {2031: [collection]}
    before = len(store.operations)
    with pytest.raises(FirstDraftInUseError, match=words):
        await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert len(store.operations) == before
    assert (await service.load(2031)).version == 1


# How intake stores a request it recorded before finance approved programs and cost (Flag.as_dict).
_WAITING = {"code": "awaiting_approved_rules", "detail": {"sections": ["programs", "cost"]}}


@pytest.mark.asyncio
async def test_requests_still_waiting_for_rules_do_not_refuse_a_first_draft_discard() -> None:
    """Intake runs before the rules are approved and records each request as waiting for them. Those requests have
    read nothing (R27-9: "no request ... has read it"), so the first draft can still go."""
    store = FakeStore()
    service = await _first_draft(store)
    store.requests = {
        2031: [SimpleNamespace(id="req1", flags=[_WAITING]), SimpleNamespace(id="req2", flags=[_WAITING])]
    }
    await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert await service.discarded_versions(2031) == frozenset({1})


@pytest.mark.asyncio
async def test_a_request_the_rules_were_read_for_refuses_a_first_draft_discard() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    store.requests = {2031: [SimpleNamespace(id="req1", flags=[_WAITING]), SimpleNamespace(id="req2", flags=[])]}
    with pytest.raises(FirstDraftInUseError, match="aid requests"):
        await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert await service.discarded_versions(2031) == frozenset()


@pytest.mark.asyncio
async def test_another_seasons_readers_do_not_refuse() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    store.readers = {2030: [AID_REQUESTS, AID_SCENARIO_OPTIONS]}
    await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert await service.discarded_versions(2031) == frozenset({1})


@pytest.mark.asyncio
async def test_a_season_with_rules_in_effect_is_refused_by_the_first_draft_discard() -> None:
    """The normal case stays Discard draft's: a season with a version in effect is never emptied this way."""
    store = FakeStore()
    service = await _draft_v2(store)
    with pytest.raises(FirstDraftInUseError):
        await service.discard_first_draft(2031, 2, actor=ADMIN)
    assert (await service.load(2031)).version == 2


@pytest.mark.asyncio
async def test_a_stale_page_cannot_discard_a_first_draft_it_has_not_seen() -> None:
    store = FakeStore()
    service = await _first_draft(store)
    await service.create_version(fictional_rules(), actor=FINANCE)  # v2
    with pytest.raises(NotLatestVersionError):
        await service.discard_first_draft(2031, 1, actor=ADMIN)


@pytest.mark.asyncio
async def test_a_season_with_no_rules_has_no_first_draft_to_discard() -> None:
    service = FinancialAidRulesService(FakeStore(), clock=lambda: AT)
    with pytest.raises(RulesNotFoundError):
        await service.discard_first_draft(2031, 1, actor=ADMIN)


@pytest.mark.asyncio
async def test_the_normal_discard_still_refuses_a_first_draft() -> None:
    """Discard draft, the staff path, is unchanged: a first draft has nothing to go back to."""
    store = FakeStore()
    service = await _first_draft(store)
    with pytest.raises(NoDraftToDiscardError):
        await service.discard_draft(2031, 1, actor=FINANCE)


@pytest.mark.asyncio
async def test_a_version_made_after_the_page_read_is_not_discarded_unseen() -> None:
    """The draft the caller named is checked on one read and the versions to discard come from the next: a version
    another writer makes between the two must refuse the discard, not go with it unseen."""
    store = FakeStore()
    service = await _first_draft(store)

    async def another_writer_makes_v2() -> None:
        await service.create_version(fictional_rules(), actor=FINANCE)

    store.after_next_read(another_writer_makes_v2)  # lands right after the discard reads the draft it was named
    with pytest.raises(NotLatestVersionError):
        await service.discard_first_draft(2031, 1, actor=ADMIN)
    assert await service.discarded_versions(2031) == frozenset()
    assert (await service.load(2031)).version == 2

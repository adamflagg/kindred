"""Write only if unchanged on aid_rules (campership G6): two writers that read the same version can no longer
overwrite each other. Each race is interleaved deterministically through the FakeStore: one writer reads, the
other commits, then the first commits and is refused (AidWriteConflictError) with nothing written, while the
change that landed stays intact. Fictional season 2031 only."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from api.services.financial_aid_rules_service import PRICING_SECTIONS, FinancialAidRulesService
from bunking.financial_aid.change_log import AidWriteConflictError
from bunking.financial_aid.rules import AidRules, SectionName
from bunking.financial_aid.rules.schema import SECTION_NAMES
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json, with_lever

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"
LEDGER = "system:ledger"


def _service(store: FakeStore) -> FinancialAidRulesService:
    return FinancialAidRulesService(store, clock=lambda: AT)


async def _v1(store: FakeStore, approved: tuple[SectionName, ...]) -> FinancialAidRulesService:
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(approved), actor=FINANCE, note="Board, Jan 8")
    return service


async def _tick_locks_income(service: FinancialAidRulesService, store: FakeStore) -> None:
    """A Posted tick's lock of income, read and committed as the decisions service does."""
    locks, _ = await service.lock_writes(2031, 1, ["income"])
    await store.commit(locks, actor=LEDGER)


# --- the revision itself -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_new_version_reads_revision_0_and_each_save_moves_it_on_by_one() -> None:
    store = FakeStore()
    service = _service(store)
    created = await service.create_version(fictional_rules(), actor=FINANCE)
    assert created.revision == 0
    approved = await service.approve_sections(2031, 1, list(SECTION_NAMES), actor=FINANCE, note="Board, Jan 8")
    assert approved[0].revision == len(SECTION_NAMES)  # one operation, one save per section
    assert len(store.operations[-1]) == len(SECTION_NAMES)


# --- race 1: a Posted tick's lock and a finance approval or save ------------------------------------------


@pytest.mark.asyncio
async def test_a_tick_lock_read_before_an_approval_is_refused_and_the_approval_stands() -> None:
    store = FakeStore()
    service = await _v1(store, tuple(s for s in SECTION_NAMES if s != "tiers"))
    locks, _ = await service.lock_writes(2031, 1, ["income"])  # the tick reads
    await service.approve_sections(2031, 1, ["tiers"], actor=FINANCE, note="Board, Jan 15")  # finance lands first
    logged = len(store.log_rows)
    with pytest.raises(AidWriteConflictError):
        await store.commit(locks, actor=LEDGER)
    v1 = await service.load(2031, 1)
    assert (v1.section_status["tiers"].state, v1.section_status["income"].state) == ("approved", "approved")
    assert len(store.log_rows) == logged  # the refused lock wrote nothing, not even its log row
    await _tick_locks_income(service, store)  # re-derived from a fresh read, it locks
    v1 = await service.load(2031, 1)
    assert (v1.section_status["tiers"].state, v1.section_status["income"].state) == ("approved", "locked")


@pytest.mark.asyncio
async def test_an_approval_read_before_a_tick_lock_is_refused_and_the_lock_stands() -> None:
    store = FakeStore()
    service = await _v1(store, tuple(s for s in SECTION_NAMES if s != "tiers"))
    store.before_next_commit(lambda: _tick_locks_income(service, store))  # lands after the approval's read
    logged = len(store.log_rows)
    with pytest.raises(AidWriteConflictError, match="reload and try again"):
        await service.approve_sections(2031, 1, ["tiers"], actor=FINANCE, note="Board, Jan 15")
    v1 = await service.load(2031, 1)
    assert (v1.section_status["tiers"].state, v1.section_status["income"].state) == ("draft", "locked")
    assert [row.entity_id for row in store.log_rows[logged:]] == ["2031:1:income"]  # the lock's row alone
    await service.approve_sections(2031, 1, ["tiers"], actor=FINANCE, note="Board, Jan 15")  # reloaded: it lands
    v1 = await service.load(2031, 1)
    assert (v1.section_status["tiers"].state, v1.section_status["income"].state) == ("approved", "locked")


@pytest.mark.asyncio
async def test_a_stale_tick_lock_can_no_longer_undo_a_saves_knock_back() -> None:
    """Without G6 the lock wrote back the whole section_status it read: awards approved again, over content the
    save had just changed and sent back to draft."""
    store = FakeStore()
    service = await _v1(store, tuple(s for s in SECTION_NAMES if s != "tiers"))  # tiers draft: v1 prices nothing
    locks, _ = await service.lock_writes(2031, 1, ["income"])
    await service.save(2031, 1, with_lever(fictional_rules(), "awards.minimum", "150"), actor=TREASURER)
    with pytest.raises(AidWriteConflictError):
        await store.commit(locks, actor=LEDGER)
    v1 = await service.load(2031, 1)
    assert (str(v1.document.awards.minimum), v1.section_status["awards"].state) == ("150", "draft")
    assert v1.section_status["income"].state == "approved"


# --- race 2: a tick's lock and a section save on the same rules draft -------------------------------------


def _new_deadline() -> AidRules:
    return with_lever(fictional_rules(), "milestones.response_deadline", "2031-03-01")


@pytest.mark.asyncio
async def test_a_tick_lock_read_before_an_in_place_section_save_is_refused() -> None:
    store = FakeStore()
    service = await _v1(store, PRICING_SECTIONS)  # milestones stays draft, so editing it saves in place
    locks, _ = await service.lock_writes(2031, 1, ["income"])
    saved = await service.save_sections(2031, 1, _new_deadline(), actor=TREASURER)
    assert saved.branched_from is None
    with pytest.raises(AidWriteConflictError):
        await store.commit(locks, actor=LEDGER)
    v1 = await service.load(2031, 1)
    assert v1.section_status["milestones"].edited_by == TREASURER  # the save's stamp survives
    assert v1.section_status["income"].state == "approved"


@pytest.mark.asyncio
async def test_an_in_place_section_save_read_before_a_tick_lock_is_refused_and_saves_after_a_reload() -> None:
    store = FakeStore()
    service = await _v1(store, PRICING_SECTIONS)
    store.before_next_commit(lambda: _tick_locks_income(service, store))
    with pytest.raises(AidWriteConflictError):
        await service.save_sections(2031, 1, _new_deadline(), actor=TREASURER)
    v1 = await service.load(2031, 1)
    assert v1.document.milestones == fictional_rules().milestones  # the refused save wrote nothing
    assert v1.section_status["income"].state == "locked"
    saved = await service.save_sections(2031, 1, _new_deadline(), actor=TREASURER)
    assert (saved.branched_from, saved.version.section_status["income"].state) == (None, "locked")


@pytest.mark.asyncio
async def test_a_tick_lock_read_before_a_branching_save_is_refused_and_relocks_on_the_new_draft() -> None:
    store = FakeStore()
    service = await _v1(store, SECTION_NAMES)  # v1 prices the season: an awards edit branches
    locks, _ = await service.lock_writes(2031, 1, ["income"])  # aimed at v1, the latest when read
    saved = await service.save_sections(
        2031, 1, with_lever(fictional_rules(), "awards.minimum", "150"), actor=TREASURER
    )
    assert saved.version.version == 2
    with pytest.raises(AidWriteConflictError):
        await store.commit(locks, actor=LEDGER)  # v1 is no longer the latest: refused, not written there
    assert (await service.load(2031, 1)).section_status["income"].state == "approved"
    await _tick_locks_income(service, store)  # re-derived: the draft carries the same income, so it locks there
    assert (await service.load(2031, 2)).section_status["income"].state == "locked"


@pytest.mark.asyncio
async def test_a_branching_save_read_before_a_tick_lock_is_refused_and_creates_nothing() -> None:
    store = FakeStore()
    service = await _v1(store, SECTION_NAMES)
    store.before_next_commit(lambda: _tick_locks_income(service, store))
    with pytest.raises(AidWriteConflictError):
        await service.save_sections(2031, 1, with_lever(fictional_rules(), "awards.minimum", "150"), actor=TREASURER)
    assert [row.version for row in await store.list_versions(2031)] == [1]
    saved = await service.save_sections(
        2031, 1, with_lever(fictional_rules(), "awards.minimum", "150"), actor=TREASURER
    )
    assert (saved.version.version, saved.version.section_status["income"].state) == (2, "locked")  # carried


# --- the gap _assert_latest used to leave ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_approval_read_before_a_new_version_is_refused_rather_than_landing_on_an_old_version() -> None:
    store = FakeStore()
    service = await _v1(store, tuple(s for s in SECTION_NAMES if s != "tiers"))
    store.before_next_commit(lambda: service.new_version(2031, 1, actor=FINANCE))
    with pytest.raises(AidWriteConflictError):
        await service.approve_sections(2031, 1, ["tiers"], actor=FINANCE, note="Board, Jan 15")
    assert (await service.load(2031, 1)).section_status["tiers"].state == "draft"
    assert (await service.load(2031)).version == 2


# --- Ruling 2026-10-01 (plan review): one read where two could disagree ------------------------------------


@pytest.mark.asyncio
async def test_a_new_version_from_the_latest_copies_the_same_read_its_guard_carries() -> None:
    """A lock landing between new_version's reads must not be dropped from the copy: the latest is read first and
    is the source, so the guard carries that read's revision and the create is refused."""
    store = FakeStore()
    service = await _v1(store, SECTION_NAMES)
    store.after_next_read(lambda: _tick_locks_income(service, store))
    with pytest.raises(AidWriteConflictError):
        await service.new_version(2031, 1, actor=FINANCE)
    assert [row.version for row in await store.list_versions(2031)] == [1]
    copied = await service.new_version(2031, 1, actor=FINANCE)  # reloaded: the copy carries the lock
    assert copied.section_status["income"].state == "locked"


def _tables_option() -> AidRules:
    """A kept option from v1 that changes award_tables only, so promoting it needs no acknowledgement."""
    return with_lever(fictional_rules(), "award_tables.camp.tiers.1.r1_pct", "88")


@pytest.mark.asyncio
async def test_a_save_landing_between_a_promotions_preview_and_its_apply_is_a_conflict() -> None:
    store = FakeStore()
    service = await _v1(store, SECTION_NAMES)
    await service.save_sections(2031, 1, with_lever(fictional_rules(), "awards.minimum", "120"), actor=TREASURER)
    edited = with_lever(fictional_rules(), "awards.minimum", "130")  # v2's awards edited again, in place

    async def another_save() -> None:
        await service.save_sections(2031, 2, edited, actor=TREASURER)

    store.after_next_read(another_save)  # lands right after promote reads the rules draft
    with pytest.raises(AidWriteConflictError):
        await service.promote(
            2031, origin_version=1, document=_tables_option(), base_version=2, acknowledged={}, actor=FINANCE, via="B2"
        )
    v2 = await service.load(2031, 2)
    assert str(v2.document.awards.minimum) == "130"  # the save stands
    assert v2.document.award_tables == fictional_rules().award_tables  # and the promotion wrote nothing


# --- a section fingerprint and the revision: the check passes on a stale read, the write is still refused --------


@pytest.mark.asyncio
async def test_a_same_section_save_landing_after_the_read_is_refused_and_the_other_value_kept() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    opened = {s.section: s.fingerprint for s in (await service.draft_view(2031)).sections}
    awards = fictional_rules_json()["awards"]
    store.after_next_read(
        lambda: service.save_section(
            2031, 1, "awards", awards | {"minimum": "175"}, actor=FINANCE, expected_fingerprint=opened["awards"]
        )
    )
    with pytest.raises(AidWriteConflictError):
        await service.save_section(
            2031, 1, "awards", awards | {"minimum": "150"}, actor=TREASURER, expected_fingerprint=opened["awards"]
        )
    assert str((await service.load(2031)).document.awards.minimum) == "175"


@pytest.mark.asyncio
async def test_an_approval_read_before_a_save_of_a_ticked_section_is_refused_and_both_stay_draft() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    opened = {s.section: s.fingerprint for s in (await service.draft_view(2031)).sections}
    awards = fictional_rules_json()["awards"]
    store.before_next_commit(
        lambda: service.save_section(
            2031, 1, "awards", awards | {"minimum": "175"}, actor=TREASURER, expected_fingerprint=opened["awards"]
        )
    )
    with pytest.raises(AidWriteConflictError):
        await service.approve_sections(
            2031,
            1,
            ["awards", "income"],
            actor=FINANCE,
            note="Board",
            fingerprints={s: opened[s] for s in ("awards", "income")},
        )
    v1 = await service.load(2031)
    assert (v1.section_status["awards"].state, v1.section_status["income"].state) == ("draft", "draft")
    assert str(v1.document.awards.minimum) == "175"

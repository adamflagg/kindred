"""Layer 2 of the Camperships cache (api/services/aid_season_cache.py): the priced season, built once and shared.

These pin single-flight (concurrent readers share one build), the key (year and camp-time day), what clears it
(every Camperships write through commit_aid_writes' listener, every sync, the layer-1 TTL), the generation guard (a
build that straddles a clear is handed to the readers who joined it but never stored), shielding (one reader leaving
never cancels the build the others wait on), the warm after a clear, and which service constructions use it (every
staff read) and which never may (pricing with candidate rules, the overnight tick)."""

from __future__ import annotations

import ast
import asyncio
import copy
import logging
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.dependencies import aid_inputs_cache, aid_season_cache
from api.schemas.financial_aid_decisions import ManualHoldIn
from api.services import aid_season_cache as layer2
from api.services import aid_sync_inputs as layer1
from api.services.aid_season_cache import (
    AID_SEASON_SYNC_RUN_SERVICES,
    AID_SEASON_SYNC_TABLES,
    SEASON_SPANNING_COLLECTIONS,
    AidSeasonCache,
    bind_warm_loop,
    on_aid_commit,
    sync_changes_aid_season,
)
from api.services.aid_sync_inputs import set_placement_recorder, set_season_warmer
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grant_placements import PLACEMENT_ACTOR
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import OneGrantsLoad
from api.services.financial_aid_rules_service import PRICING_SECTIONS, AidRulesRepository, FinancialAidRulesService
from bunking.financial_aid import change_log
from bunking.financial_aid.change_log import AidWrite, add_commit_listener
from bunking.financial_aid.decisions import DecisionEvent
from tests.unit.api.services.aid_commit_spy import spy_on_commits
from tests.unit.api.services.decisions_fakes import (
    EMMA,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules

ROOT = Path(__file__).resolve().parents[4]
LIAM = "reqliam00000001"
STAFF = "staff@example.org"


class _CountingStore(FakeDecisionsStore):
    """Counts season builds (each reads the season's requests once), and can hold a build open or fail it."""

    def __init__(self) -> None:
        super().__init__()
        self.builds: Counter[int] = Counter()
        self.started = asyncio.Event()
        self.gate: asyncio.Event | None = None
        self.fail: Exception | None = None

    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[Any]:
        if application_id is None:
            self.builds[year] += 1
            self.started.set()
            if self.gate is not None:
                await self.gate.wait()
            if self.fail is not None:
                raise self.fail
        return await super().fetch_requests(year, application_id)


def _store() -> _CountingStore:
    store = _CountingStore()
    seed_request(store, EMMA)
    return store


def _service(
    store: FakeDecisionsStore,
    cache: AidSeasonCache | None,
    *,
    clock: Any = None,
    register: Sequence[RegisterRow] = (),
) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return list(register)

    return FinancialAidDecisionsService(
        store, FakeRules(approved()), rows, clock=clock or (lambda: T0), season_cache=cache
    )


def _staff_write(year: int) -> AidWrite:
    return AidWrite(
        collection="aid_requests",
        action="update",
        year=year,
        record_id="req000000000001",
        before={"ask": 1500.0},
        data={"ask": 1600.0},
    )


# --- single flight and the key ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_three_concurrent_reads_share_one_build() -> None:
    store = _store()
    service = _service(store, AidSeasonCache())
    seasons = await asyncio.gather(*(service.season(YEAR) for _ in range(3)))
    assert store.builds[YEAR] == 1
    assert seasons[0] is seasons[1] is seasons[2]


@pytest.mark.asyncio
async def test_season_and_named_season_share_one_build() -> None:
    store = _store()
    cache = AidSeasonCache()
    season = await _service(store, cache).season(YEAR)
    named, (families, campers) = await _service(store, cache).named_season(YEAR)
    assert store.builds[YEAR] == 1
    assert season is named
    # The cached build is the named one, a superset of season()'s.
    assert families
    assert campers


@pytest.mark.asyncio
async def test_a_fresh_service_per_request_still_shares_the_cache() -> None:
    store = _store()
    cache = AidSeasonCache()
    await _service(store, cache).season(YEAR)
    await _service(store, cache).season(YEAR)
    assert store.builds[YEAR] == 1


@pytest.mark.asyncio
async def test_invalidating_the_year_rebuilds_it_and_another_year_does_not() -> None:
    store = _store()
    cache = AidSeasonCache()
    service = _service(store, cache)
    await service.season(YEAR)
    cache.invalidate_year(YEAR - 1)
    await service.season(YEAR)
    assert store.builds[YEAR] == 1
    cache.invalidate_year(YEAR)
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


@pytest.mark.asyncio
async def test_a_new_camp_time_day_rebuilds() -> None:
    store = _store()
    cache = AidSeasonCache()
    now = [T0]
    service = _service(store, cache, clock=lambda: now[0])
    await service.season(YEAR)
    now[0] = T0 + timedelta(hours=1)  # the same day in camp time
    await service.season(YEAR)
    assert store.builds[YEAR] == 1
    now[0] = T0 + timedelta(days=1)
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


@pytest.mark.asyncio
async def test_years_are_separate_entries_and_never_clear_each_other() -> None:
    """Reports and scenarios read last season (year - 1) beside this one: each year is its own entry."""
    store = _store()
    seed_request(store, LIAM)
    cache = AidSeasonCache()
    service = _service(store, cache)
    this, last = await service.season(YEAR), await service.season(YEAR - 1)
    assert this is not last
    assert (this.year, last.year) == (YEAR, YEAR - 1)
    cache.invalidate_year(YEAR - 1)
    assert await service.season(YEAR) is this
    assert await service.season(YEAR - 1) is not last
    assert store.builds == Counter({YEAR: 1, YEAR - 1: 2})


@pytest.mark.asyncio
async def test_an_entry_expires_after_its_ttl() -> None:
    clock = [1000.0]
    cache = AidSeasonCache(ttl_seconds=300, max_size=4, monotonic=lambda: clock[0])
    builds = 0

    async def build() -> object:
        nonlocal builds
        builds += 1
        return object()

    first = await cache.get_or_build(YEAR, date(2027, 3, 9), build)
    clock[0] += 300
    assert await cache.get_or_build(YEAR, date(2027, 3, 9), build) is first
    clock[0] += 1
    assert await cache.get_or_build(YEAR, date(2027, 3, 9), build) is not first
    assert builds == 2


@pytest.mark.asyncio
async def test_it_holds_at_most_max_size_entries_and_drops_the_oldest() -> None:
    clock = [0.0]
    cache = AidSeasonCache(ttl_seconds=300, max_size=2, monotonic=lambda: clock[0])
    built: list[int] = []

    def build_for(year: int) -> Any:
        async def build() -> int:
            built.append(year)
            return year

        return build

    day = date(2027, 3, 9)
    for year in (2025, 2026, 2027):
        clock[0] += 1
        await cache.get_or_build(year, day, build_for(year))
    await cache.get_or_build(2027, day, build_for(2027))
    await cache.get_or_build(2026, day, build_for(2026))
    await cache.get_or_build(2025, day, build_for(2025))  # the oldest, dropped for 2027
    assert built == [2025, 2026, 2027, 2025]


def test_the_process_singleton_is_five_minutes_and_four_entries() -> None:
    assert aid_season_cache.ttl_seconds == 300
    assert aid_season_cache.max_size == 4


# --- a failed build, a write mid-build, a reader leaving ----------------------------------------------------------


@pytest.mark.asyncio
async def test_a_failed_build_reaches_every_waiter_and_is_never_cached() -> None:
    store = _store()
    store.gate = asyncio.Event()
    store.fail = RuntimeError("PocketBase is down")
    service = _service(store, AidSeasonCache())
    waiters = [asyncio.create_task(service.season(YEAR)) for _ in range(2)]
    await store.started.wait()
    store.gate.set()
    for waiter in waiters:
        with pytest.raises(RuntimeError, match="PocketBase is down"):
            await waiter
    assert store.builds[YEAR] == 1
    store.fail = None
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


@pytest.mark.asyncio
async def test_a_write_mid_build_hands_the_early_waiter_its_season_but_never_stores_it() -> None:
    """The writer's own refetch, after the write, starts a fresh build even while the old one runs."""
    store = _store()
    store.gate = asyncio.Event()
    cache = AidSeasonCache()
    service = _service(store, cache)
    early = asyncio.create_task(service.season(YEAR))
    await store.started.wait()
    cache.invalidate_year(YEAR)
    late = asyncio.create_task(service.season(YEAR))
    await asyncio.sleep(0)
    store.gate.set()
    early_season, late_season = await early, await late
    assert early_season.year == YEAR
    assert early_season is not late_season
    assert store.builds[YEAR] == 2
    assert await service.season(YEAR) is late_season  # the post-write build is the one stored
    assert store.builds[YEAR] == 2


@pytest.mark.asyncio
async def test_a_write_from_the_committing_thread_mid_build_is_guarded_the_same_way() -> None:
    """The same, as production runs it: commit_aid_writes' listener fires on a worker thread."""
    store = _store()
    store.gate = asyncio.Event()
    cache = AidSeasonCache()
    service = _service(store, cache)
    early = asyncio.create_task(service.season(YEAR))
    await store.started.wait()
    await asyncio.to_thread(cache.invalidate_year, YEAR)
    store.gate.set()
    early_season = await early
    assert early_season.year == YEAR
    assert store.builds[YEAR] == 1
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


@pytest.mark.asyncio
async def test_invalidate_all_drops_every_entry_and_an_in_flight_build_is_not_stored() -> None:
    store = _store()
    cache = AidSeasonCache()
    service = _service(store, cache)
    await service.season(YEAR - 1)
    store.gate = asyncio.Event()
    in_flight = asyncio.create_task(service.season(YEAR))
    await asyncio.sleep(0)
    while store.builds[YEAR] == 0:
        await asyncio.sleep(0)
    cache.invalidate_all()
    store.gate.set()
    await in_flight
    await service.season(YEAR)
    await service.season(YEAR - 1)
    assert store.builds == Counter({YEAR: 2, YEAR - 1: 2})


@pytest.mark.asyncio
async def test_a_reader_that_leaves_never_cancels_the_build_the_others_wait_on() -> None:
    """A browser that disconnects mid-build cancels its own request, not everyone's."""
    store = _store()
    store.gate = asyncio.Event()
    service = _service(store, AidSeasonCache())
    leaving = asyncio.create_task(service.season(YEAR))
    staying = asyncio.create_task(service.season(YEAR))
    await store.started.wait()
    leaving.cancel()
    with pytest.raises(asyncio.CancelledError):
        await leaving
    store.gate.set()
    assert (await staying).year == YEAR
    await service.season(YEAR)
    assert store.builds[YEAR] == 1


class _GatedGrants:
    """A grants loader whose register load waits on `gate`: the read a OneGrantsLoad surface shares with its build."""

    def __init__(self) -> None:
        self.gate = asyncio.Event()
        self.loads = 0

    async def read_with_rows(self, year: int) -> tuple[Any, list[RegisterRow]]:
        self.loads += 1
        await self.gate.wait()
        return SimpleNamespace(year=year), []


@pytest.mark.asyncio
async def test_a_disconnect_on_a_screen_that_shares_its_grants_load_never_cancels_the_build() -> None:
    """Grants, Today, Today-week and the household page price the season on their own request's grants load
    (OneGrantsLoad), so the shared build awaits that load. Their request leaving must not cancel it for the others."""
    store = _store()
    cache = AidSeasonCache()
    grants = _GatedGrants()
    shared = OneGrantsLoad(grants, YEAR)
    screen = FinancialAidDecisionsService(
        store, FakeRules(approved()), shared.register, clock=lambda: T0, season_cache=cache
    )

    async def grants_read() -> Any:  # as GrantsRegisterService.read does
        return await asyncio.gather(screen.season(YEAR), shared.read())

    leaving = asyncio.create_task(grants_read())
    await store.started.wait()
    staying = asyncio.create_task(_service(store, cache).season(YEAR))
    await asyncio.sleep(0)
    leaving.cancel()
    with pytest.raises(asyncio.CancelledError):
        await leaving
    grants.gate.set()
    assert (await staying).year == YEAR
    assert store.builds[YEAR] == 1
    assert grants.loads == 1


# --- the listener -------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_live_build_commits_nothing_and_stays_cached() -> None:
    """Owner ruling 2026-10-16: a season build no longer logs grant placements (the sync step and the warm record
    them, record_placements), so it commits nothing, through the real commit_aid_writes or otherwise."""
    store = _store()
    heard: list[str] = []

    def listener(writes: Sequence[AidWrite], actor: str) -> None:
        heard.append(actor)
        on_aid_commit(writes, actor)

    remove = add_commit_listener(listener)
    try:
        service = _service(store, aid_season_cache, register=[grant_row(EMMA, "500")])
        first = await service.season(YEAR)
        assert (heard, store.grant_placements) == ([], [])
        assert await service.season(YEAR) is first
        assert store.builds[YEAR] == 1
    finally:
        remove()


@pytest.mark.asyncio
async def test_recording_placements_never_clears_the_cached_season() -> None:
    """record_placements commits as PLACEMENT_ACTOR through the real commit_aid_writes; the listener skips that actor,
    so recording after a warm never throws away the season the warm just built."""
    store = _store()
    remove = add_commit_listener(on_aid_commit)
    try:
        service = _service(store, aid_season_cache, register=[grant_row(EMMA, "500")])
        first = await service.season(YEAR)
        await service.record_placements(YEAR)
        assert len(store.grant_placements) == 1
        assert await service.season(YEAR) is first
        assert store.builds[YEAR] == 1
    finally:
        remove()


@pytest.mark.asyncio
async def test_the_placement_actor_never_clears_and_a_staff_write_clears_only_its_year() -> None:
    store = _store()
    service = _service(store, aid_season_cache)
    this, last = await service.season(YEAR), await service.season(YEAR - 1)
    on_aid_commit([_staff_write(YEAR)], PLACEMENT_ACTOR)
    assert await service.season(YEAR) is this
    on_aid_commit([_staff_write(YEAR)], STAFF)
    assert await service.season(YEAR) is not this
    assert await service.season(YEAR - 1) is last
    assert store.builds == Counter({YEAR: 2, YEAR - 1: 1})


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", ["aid_sources", "aid_grantors"])
async def test_a_write_to_a_season_spanning_table_clears_every_year(collection: str) -> None:
    """Funding sources and grantors span seasons, so their writes are logged under the current season only, yet every
    cached year was priced on them (Reports reads last season beside this one)."""
    store = _store()
    service = _service(store, aid_season_cache)
    this, last = await service.season(YEAR), await service.season(YEAR - 1)
    write = AidWrite(
        collection=collection,
        action="update",
        year=YEAR,
        record_id="src000000000001",
        before={"source_family": "other_outside"},
        data={"source_family": "camp"},
    )
    on_aid_commit([write], STAFF)
    assert await service.season(YEAR - 1) is not last
    assert await service.season(YEAR) is not this


def test_the_season_spanning_tables_are_every_aid_table_with_no_year() -> None:
    """Derived from the generated PocketBase types: an aid_* collection with no `year` field spans seasons."""
    types = (ROOT / "frontend" / "src" / "types" / "pocketbase-types.ts").read_text()
    yearless: set[str] = set()
    for match in re.finditer(r"export type (Aid\w*)Record(?:<[^>]*>)? = \{(.*?)\n\}", types, re.DOTALL):
        if not re.search(r"\n\s*year\??:", match.group(2)):
            yearless.add(re.sub(r"(?<!^)(?=[A-Z])", "_", match.group(1)).lower())
    assert len(re.findall(r"export type Aid\w*Record", types)) > 15, "the scan found too few aid tables"
    assert yearless == SEASON_SPANNING_COLLECTIONS


@pytest.mark.asyncio
async def test_a_write_through_the_service_clears_the_season() -> None:
    """The decisions service's own write (a manual hold) commits through commit_aid_writes, whose listener clears the
    season, so the writer's refetch reprices."""
    store = _store()
    remove = add_commit_listener(on_aid_commit)
    try:
        service = _service(store, aid_season_cache)
        before = await service.season(YEAR)
        await service.set_manual_hold(EMMA, ManualHoldIn(held=True, note="Waiting on the tax return"), STAFF)
        after = await service.season(YEAR)
        assert after is not before
        assert store.builds[YEAR] == 2
    finally:
        remove()


@pytest.mark.asyncio
async def test_a_rules_approval_clears_the_season() -> None:
    """Rules are not in the key: an approval commits through commit_aid_writes like any write, and its writes carry
    the season year, so the listener clears that season."""
    rules_store = FakeStore()
    committed: list[list[AidWrite]] = []
    store_commit = rules_store.commit

    async def capture(writes: Sequence[AidWrite], **kwargs: Any) -> Any:
        committed.append(list(writes))
        return await store_commit(writes, **kwargs)

    rules_store.commit = capture  # type: ignore[method-assign]
    rules = FinancialAidRulesService(rules_store)
    draft = await rules.create_version(fictional_rules(), actor=STAFF)
    await rules.approve_sections(draft.year, draft.version, list(PRICING_SECTIONS), actor=STAFF, note="Board, Jan 8")
    approval = committed[-1]
    assert approval
    assert {w.year for w in approval} == {draft.year}

    store = _store()
    service = _service(store, aid_season_cache)
    before = await service.season(draft.year)
    spy = spy_on_commits("api.services.financial_aid_rules_service")
    remove = add_commit_listener(on_aid_commit)
    try:
        # The approval's own writes, through the rules repository's real commit path.
        await AidRulesRepository(MagicMock()).commit(approval, actor=STAFF, reason="Board, Jan 8")
    finally:
        remove()
        patch.stopall()
    assert spy.called
    assert await service.season(draft.year) is not before


def test_pricing_with_candidate_rules_can_never_use_the_cache() -> None:
    with pytest.raises(ValueError, match="never be cached"):
        FinancialAidDecisionsService(
            FakeDecisionsStore(),
            FakeRules(approved()),
            AsyncMock(return_value=[]),
            log_placements=False,
            season_cache=AidSeasonCache(),
        )


@pytest.mark.asyncio
async def test_a_service_with_no_cache_builds_every_time() -> None:
    store = _store()
    service = _service(store, None)
    await service.season(YEAR)
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


class _CountingCache(AidSeasonCache):
    def __init__(self) -> None:
        super().__init__()
        self.asked = 0

    async def get_or_build(self, year: int, day: date, build: Any) -> Any:
        self.asked += 1
        return await super().get_or_build(year, day, build)


@pytest.mark.asyncio
async def test_a_past_date_read_never_touches_the_cache() -> None:
    """Only the live season is cached; a past date (as_of) prices from history every time."""
    store = _store()
    cache = _CountingCache()
    service = _service(store, cache)
    past = T0.date() - timedelta(days=3)
    await service.grid(YEAR, as_of=past)
    await service.budget(YEAR, as_of=past)
    await service.remaining(YEAR, as_of=past)
    await service.past_season(YEAR, past)
    assert cache.asked == 0
    await service.grid(YEAR)
    assert cache.asked == 1


@pytest.mark.asyncio
async def test_the_reads_that_share_a_cached_season_never_change_it() -> None:
    """A cached Season is one object every request reads: a read that wrote into it would change another's numbers."""
    store = _store()
    seed_request(store, LIAM, household=1000002, person=1000021)
    store.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=T0,
            amount=Decimal(1500),
            effective_on=T0.date(),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    seed_line(store, 7001, "1500")
    service = _service(store, aid_season_cache, register=[grant_row(LIAM, "250")])
    season, names = await service.named_season(YEAR)
    frozen: tuple[Season, Any] = copy.deepcopy((season, names))
    await service.grid(YEAR)
    await service.budget(YEAR)
    await service.remaining(YEAR)
    unticked = await service.with_unticked(season)
    for request_id in season.priced:
        service.row_of(unticked, names, request_id)
    assert await service.named_season(YEAR) == frozen
    assert store.builds[YEAR] == 1


# --- clears from syncs and the layer-1 TTL ------------------------------------------------------------------------


# Every job that writes something a season build reads: layer 1's tables (the people, their registrations and
# sessions, the equity answers and the FA mirror), the ledger (aid_postings writes aid_sources and the household links
# too), and the two jobs whose sync_runs rows date the ledger. `aid_postings` is the clear the 2026 loader's printed
# instruction relies on (#3230). No job named, an empty name, and a job nobody has classified all clear: fail safe.
SEASON_CLEARING = [
    "aid_postings",
    "financial_aid_applications",
    "financial_transactions",
    "persons",
    "attendees",
    "sessions",
    "custom_field_defs",
    "person_custom_values",
    "person_custom_values_family_camp",
    "normalize_geographic",
    None,
    "",
    "a_job_nobody_classified",
]
# The hourly bunk_assignments run above all: after Oct 15 the N-1 pass runs it too, and it wrote nothing aid reads.
SEASON_KEEPING = [
    "bunk_assignments",
    "bunks",
    "lodging_assignments",
    "staff",
    "process_requests",
    "jotform_submissions",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("sync_type", SEASON_CLEARING)
async def test_a_sync_that_writes_what_the_season_reads_clears_it_and_schedules_a_warm(sync_type: str | None) -> None:
    from api.routers.metrics import invalidate_server_caches

    store = _store()
    service = _service(store, aid_season_cache)
    before = await service.season(YEAR)
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm") as warm:
        invalidate_server_caches(sync_type)
    warm.assert_called_once()
    assert await service.season(YEAR) is not before


@pytest.mark.asyncio
@pytest.mark.parametrize("sync_type", SEASON_KEEPING)
async def test_a_sync_that_writes_nothing_the_season_reads_keeps_it_and_warms_nothing(sync_type: str) -> None:
    from api.routers.metrics import invalidate_server_caches

    store = _store()
    service = _service(store, aid_season_cache)
    before = await service.season(YEAR)
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm") as warm:
        invalidate_server_caches(sync_type)
    warm.assert_not_called()
    assert await service.season(YEAR) is before
    assert store.builds[YEAR] == 1


@pytest.mark.asyncio
async def test_the_season_sync_scope_is_exactly_what_a_season_build_reads() -> None:
    """Derived, not guessed: a real cold season build over the budget fixture, every PocketBase read recorded. Its
    sync-written collections (those some job in SYNC_JOB_WRITES writes) are the scope's tables, and the services
    its sync_runs reads name are the scope's run services. A new read of a sync-written table fails here until
    the scope names it; a table the scope names that no build reads fails too, so the scope never over-clears."""
    from api.constants.sync_job_writes import SYNC_JOB_WRITES
    from tests.unit.api.services.pb_recording import RecordingPb
    from tests.unit.api.services.test_aid_pb_budget import _build_tables
    from tests.unit.api.services.test_aid_pb_budget import _service as budget_service

    pb = RecordingPb(_build_tables())
    await budget_service(pb, cached=True).named_season(YEAR)
    read = {collection for collection, _ in pb.calls}
    sync_written = frozenset().union(*SYNC_JOB_WRITES.values())
    assert read & sync_written == AID_SEASON_SYNC_TABLES
    services = {m for c, f in pb.calls if c == "sync_runs" for m in re.findall(r"service = [\"']([a-z_]+)[\"']", f)}
    assert services == AID_SEASON_SYNC_RUN_SERVICES
    assert set(layer1.AID_SYNC_INPUT_TABLES) <= AID_SEASON_SYNC_TABLES  # a layer-1 clear always clears layer 2


@pytest.mark.parametrize("sync_type", SEASON_CLEARING)
def test_the_scope_predicate_clears_for_every_clearing_job(sync_type: str | None) -> None:
    assert sync_changes_aid_season(sync_type)


@pytest.mark.parametrize("sync_type", SEASON_KEEPING)
def test_the_scope_predicate_keeps_for_every_unrelated_job(sync_type: str) -> None:
    assert not sync_changes_aid_season(sync_type)


@pytest.mark.asyncio
async def test_a_sync_that_writes_no_layer_one_table_still_leaves_layer_one_alone() -> None:
    from api.routers.metrics import invalidate_server_caches

    filled = object()
    aid_inputs_cache.set("load", YEAR, filled)
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches("bunk_assignments")
    assert aid_inputs_cache.get("load", YEAR) is filled


@pytest.mark.asyncio
async def test_the_layer_one_refresher_clears_the_season_too() -> None:
    store = _store()
    service = _service(store, aid_season_cache)
    await service.season(YEAR)
    passes = 0

    async def fake_warm(year: int) -> None:
        nonlocal passes
        passes += 1

    async def fake_year() -> int:
        return YEAR

    task = asyncio.create_task(layer1.refresh_aid_inputs_forever(interval=0.01, warm=fake_warm, year=fake_year))
    for _ in range(200):
        await asyncio.sleep(0.005)
        if passes >= 2:
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert passes >= 2
    await service.season(YEAR)
    assert store.builds[YEAR] == 2


# --- the warm -----------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_warm_fills_layer_one_then_the_season_and_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    order: list[str] = []
    layer1_fill = AsyncMock(side_effect=lambda pb, year: order.append(f"inputs {year}"))
    monkeypatch.setattr(layer1, "aid_sync_inputs", layer1_fill)
    monkeypatch.setattr(layer1, "_season_warmer", None)

    async def warm_season(year: int) -> None:
        order.append(f"season {year}")

    set_season_warmer(warm_season)
    await layer1.warm_aid_year(YEAR)
    assert order == [f"inputs {YEAR}", f"season {YEAR}"]

    async def failing(year: int) -> None:
        raise RuntimeError("no rules")

    set_season_warmer(failing)
    await layer1.warm_aid_year(YEAR)  # logged, not raised


@pytest.mark.asyncio
async def test_a_write_rebuilds_the_configured_season_in_the_background_and_a_read_mid_warm_joins_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store()
    store.gate = asyncio.Event()
    monkeypatch.setattr(layer1, "_synced_years", AsyncMock(return_value=[YEAR]))
    monkeypatch.setattr(layer1, "aid_sync_inputs", AsyncMock())
    monkeypatch.setattr(layer1, "_season_warmer", None)
    monkeypatch.setattr(layer2, "_warm_loop", None)
    set_season_warmer(lambda year: _service(store, aid_season_cache).named_season(year))
    bind_warm_loop(asyncio.get_running_loop())

    await asyncio.to_thread(on_aid_commit, [_staff_write(YEAR)], STAFF)  # the committing worker thread
    await asyncio.wait_for(store.started.wait(), timeout=5)
    assert store.builds[YEAR] == 1  # the warm is building, with nobody asking yet
    read = asyncio.create_task(_service(store, aid_season_cache).season(YEAR))
    await asyncio.sleep(0)
    store.gate.set()
    assert (await read).year == YEAR
    assert store.builds[YEAR] == 1
    warm = layer1._warm_task
    assert warm is not None
    await warm


async def _commit_and_settle(writes: Sequence[AidWrite], actor: str = STAFF) -> None:
    """Commit from a worker thread, as commit_aid_writes' listener runs, and wait out the warm it schedules."""
    bind_warm_loop(asyncio.get_running_loop())
    await asyncio.to_thread(on_aid_commit, writes, actor)
    for _ in range(200):
        await asyncio.sleep(0)
        task = layer1._warm_task
        if task is not None and task.done():
            task.result()  # a warm never raises
            return
    raise AssertionError("the warm never finished")


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """The warm's placement recordings, in order, with both synced seasons and no real fill."""
    seen: list[int] = []

    async def record(year: int) -> None:
        seen.append(year)

    monkeypatch.setattr(layer1, "_synced_years", AsyncMock(return_value=[YEAR + 1, YEAR]))
    monkeypatch.setattr(layer1, "aid_sync_inputs", AsyncMock())
    monkeypatch.setattr(layer1, "_season_warmer", None)
    monkeypatch.setattr(layer1, "_placement_recorder", None)
    monkeypatch.setattr(layer1, "_warm_task", None)
    monkeypatch.setattr(layer2, "_warm_loop", None)
    set_placement_recorder(record)
    return seen


@pytest.mark.asyncio
async def test_a_staff_write_records_its_own_seasons_placements(recorded: list[int]) -> None:
    """The warm after a commit records the commit's own season, synced or not: a 2026 write in a later year
    is still that season's history, and the nightly sync step only reaches the synced seasons."""
    await _commit_and_settle([_staff_write(YEAR - 1)])
    assert recorded == [YEAR - 1]


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", ["aid_sources", "aid_grantors"])
async def test_a_season_spanning_write_records_every_register_season(recorded: list[int], collection: str) -> None:
    """A source's grantor mapping or a grantor's pays-after-camp-aid flag places grants in EVERY season, though the
    write is logged under one. So the warm records every register season from 2026 to the newest synced season,
    not only the seasons it warms: the gap a season-scoped record would leave."""
    write = replace(_staff_write(YEAR), collection=collection, record_id="src000000000001")
    await _commit_and_settle([write])
    assert recorded == [2026, 2027, 2028]


@pytest.mark.asyncio
async def test_a_write_to_a_season_before_the_log_records_nothing(recorded: list[int]) -> None:
    await _commit_and_settle([_staff_write(2025)])
    assert recorded == []


@pytest.mark.asyncio
async def test_a_failed_recording_is_logged_at_warning_and_the_warm_goes_on(
    monkeypatch: pytest.MonkeyPatch, recorded: list[int], caplog: pytest.LogCaptureFixture
) -> None:
    warmed: list[int] = []

    async def failing(year: int) -> None:
        raise RuntimeError("PocketBase refused the batch")

    async def warm_season(year: int) -> None:
        warmed.append(year)

    set_placement_recorder(failing)
    monkeypatch.setattr(layer1, "_season_warmer", warm_season)
    with caplog.at_level(logging.WARNING, logger=layer1.__name__):
        await _commit_and_settle([_staff_write(YEAR)])
    assert warmed == [YEAR + 1, YEAR]
    assert any(
        r.levelno == logging.WARNING and "placement" in r.getMessage() and str(YEAR) in r.getMessage()
        for r in caplog.records
    )


@pytest.mark.asyncio
async def test_a_placement_commit_schedules_no_warm(monkeypatch: pytest.MonkeyPatch) -> None:
    loop = MagicMock()
    monkeypatch.setattr(layer2, "_warm_loop", loop)
    on_aid_commit([_staff_write(YEAR)], PLACEMENT_ACTOR)
    on_aid_commit([], STAFF)
    loop.call_soon_threadsafe.assert_not_called()


@pytest.mark.asyncio
async def test_cancelling_the_warm_ignores_a_task_from_another_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    other = asyncio.new_event_loop()

    async def never() -> None:
        await asyncio.Event().wait()

    coro = never()
    try:
        stranded = other.create_task(coro)
        other.close()
        monkeypatch.setattr(layer1, "_warm_task", stranded)
        layer1.cancel_aid_warm()  # cancelling it would schedule onto a closed loop and raise
        assert not stranded.done()
    finally:
        coro.close()


@pytest.mark.asyncio
async def test_startup_registers_the_listener_and_the_season_warmer_and_shutdown_removes_them() -> None:
    from api import main

    settings = SimpleNamespace(skip_pb_auth=False, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "authenticate_pb", AsyncMock()),
        patch.object(main, "start_pb_token_refresh", AsyncMock(return_value=None)),
        patch.object(main, "ConfigLoader", MagicMock()),
        patch.object(main, "close_connection", MagicMock()),
        patch.object(main, "start_lodging_cache_refresher", MagicMock(return_value=None)),
        patch.object(main, "start_aid_inputs_refresher", MagicMock(return_value=None)),
        patch.object(main, "cancel_aid_warm"),
    ):
        async with main.lifespan(MagicMock()):
            assert on_aid_commit in change_log._LISTENERS
            assert layer2._warm_loop is asyncio.get_running_loop()
            assert layer1._season_warmer is not None
            assert layer1._placement_recorder is not None
        assert on_aid_commit not in change_log._LISTENERS
        assert layer2._warm_loop is None
        assert layer1._season_warmer is None
        assert layer1._placement_recorder is None


@pytest.mark.asyncio
async def test_a_failed_startup_leaves_no_listener_registered() -> None:
    from api import main

    settings = SimpleNamespace(skip_pb_auth=False, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "authenticate_pb", AsyncMock(side_effect=RuntimeError("PocketBase is down"))),
        patch.object(main, "close_connection", MagicMock()),
    ):
        with pytest.raises(RuntimeError, match="PocketBase is down"):
            async with main.lifespan(MagicMock()):
                pass
    assert on_aid_commit not in change_log._LISTENERS


# --- which constructions use it -----------------------------------------------------------------------------------

# Every FinancialAidDecisionsService construction in api/ decides: staff reads pass season_cache, and these never do.
_NEVER = {
    # A rules approval's effect: the season priced on candidate rules, before and after (log_placements=False).
    ("api/routers/financial_aid.py", "season_on"),
    # The overnight tick runs right after the ledger sync writes aid_postings and before that job's cache clear.
    ("api/routers/internal.py", "run_financial_aid_ledger_ticks"),
    # The grant placement record (3c-2) reads only the register and the log: it builds no season to cache.
    ("api/routers/internal.py", "record_grant_placements"),
    # Scenarios: a frozen season and its replay on candidate rules (log_placements=False).
    ("api/services/financial_aid_scenario_pricing.py", "capture_season"),
    ("api/services/financial_aid_scenario_pricing.py", "price_document"),
}


def _constructions() -> list[tuple[str, str, bool]]:
    """(file, enclosing function, passes season_cache) for every FinancialAidDecisionsService(...) in api/."""
    found: list[tuple[str, str, bool]] = []
    for path in sorted((ROOT / "api").rglob("*.py")):
        tree = ast.parse(path.read_text())
        for function in ast.walk(tree):
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.Call)
                    and getattr(node.func, "id", None) == "FinancialAidDecisionsService"
                    # the innermost function owns it: skip a call that sits in a nested function of this one
                    and not any(
                        node in ast.walk(inner)
                        for inner in ast.walk(function)
                        if inner is not function and isinstance(inner, (ast.FunctionDef, ast.AsyncFunctionDef))
                    )
                ):
                    passes = any(k.arg == "season_cache" for k in node.keywords)
                    found.append((str(path.relative_to(ROOT)), function.name, passes))
    return found


def test_every_staff_read_construction_passes_the_cache_and_the_others_never_do() -> None:
    found = _constructions()
    assert len(found) >= 11, found  # the scan must see every construction to mean anything
    assert {(f, fn) for f, fn, passes in found if not passes} == _NEVER
    assert all(passes for f, fn, passes in found if (f, fn) not in _NEVER)


def test_the_router_factories_hand_their_decisions_service_the_process_cache() -> None:
    from api.routers import financial_aid as fa

    assert fa._decisions()._season_cache is aid_season_cache
    assert fa._grants_register()._season_cache is aid_season_cache
    assert fa._reports()._decisions._season_cache is aid_season_cache
    assert fa._development()._decisions._season_cache is aid_season_cache
    assert fa._to_place()._decisions._season_cache is aid_season_cache
    assert fa._money_ledger()._decisions._season_cache is aid_season_cache
    assert fa._march_file()._decisions._season_cache is aid_season_cache
    assert fa._scenarios()._season_read.__self__._season_cache is aid_season_cache  # type: ignore[union-attr]


_ADMIN = SimpleNamespace(is_admin=True, permissions=frozenset(), email=STAFF)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("service", "route", "args"),
    [
        ("TodayService", "get_today", (YEAR,)),
        ("TodayWeekService", "get_today_week", (YEAR,)),
        ("HouseholdPageService", "get_household_page", (YEAR, 1000001)),
    ],
)
async def test_the_routes_that_build_their_own_service_pass_the_process_cache(
    service: str, route: str, args: tuple[int, ...]
) -> None:
    from api.routers import financial_aid as fa

    built = MagicMock()
    built.return_value.read = AsyncMock(return_value=None)
    with patch.object(fa, service, built):
        await getattr(fa, route)(*args, user=_ADMIN)
    assert built.call_args.kwargs["season_cache"] is aid_season_cache


@pytest.mark.asyncio
async def test_a_rules_approvals_effect_pricing_never_uses_the_cache() -> None:
    from api.routers import financial_aid as fa

    built = MagicMock()
    built.return_value.season = AsyncMock(return_value=None)
    with patch.object(fa, "FinancialAidDecisionsService", built):
        await fa._rules_approving()._effects._season_on(FakeRules(approved()), YEAR)  # type: ignore[union-attr]
    assert built.call_args.kwargs.get("season_cache") is None
    assert built.call_args.kwargs["log_placements"] is False


@pytest.mark.asyncio
async def test_the_overnight_ledger_tick_never_uses_the_cache() -> None:
    from api.routers import internal

    built = MagicMock()
    built.return_value.ledger_ticks = AsyncMock(return_value=None)
    with patch.object(internal, "FinancialAidDecisionsService", built):
        await internal.run_financial_aid_ledger_ticks(internal.FinancialAidLedgerTicksRun(year=YEAR))
    assert built.call_args.kwargs.get("season_cache") is None
